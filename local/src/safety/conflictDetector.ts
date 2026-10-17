import {
  Aircraft,
  AirportConfig,
  ConflictAlert,
  ConflictSeverity,
  WakeStandard,
} from '../aircraft/types';
import {
  bearingTo,
  computeRunwayLocalizerGeometry,
  distanceNM,
  feetToStandardMeters,
  getRunwayConfig,
  shortestHeadingDelta,
} from '../aircraft/physics';
import {
  HARBOR_AIRPORT,
  ICAO_WAKE_RADAR_MINIMA_NM,
  RECAT_EU_RADAR_MINIMA_NM,
} from '../airport/harborAirport';

export interface SafetyEvaluationResult {
  alerts: ConflictAlert[];
  aircraftConflictLevels: Record<string, 'NONE' | 'WARNING' | 'CRITICAL' | 'ACCIDENT'>;
  ntzPenetratingIds: Set<string>;
  tcasRaPairs: Array<{ climbId: string; descendId: string }>;
  hasNewWarning: boolean;
  hasNewCritical: boolean;
  hasNewAccident: boolean;
  hasRunwayConflict: boolean;
}

const SEVERITY_RANK: Record<'NONE' | 'WARNING' | 'CRITICAL' | 'ACCIDENT', number> = {
  NONE: 0,
  WARNING: 1,
  CRITICAL: 2,
  ACCIDENT: 3,
};

/** Game-over thresholds chosen for this game; not a regulatory incident classification.
 * The simplified safety model uses 5 NM / 1000 ft normally, with wake/parallel exceptions.
 */
export const GAME_DANGEROUS_PROXIMITY_NM = 1.5;
export const GAME_DANGEROUS_PROXIMITY_FT = 500;

/**
 * 根据当前选择的尾流标准 (ICAO Doc 4444 4级 vs RECAT-EU 6级) 计算两机之间的最低雷达水平间隔标准 (NM)
 */
export function getRequiredHorizontalSeparationNM(
  a: Aircraft,
  b: Aircraft,
  wakeStandard: WakeStandard = 'ICAO',
  airport: AirportConfig = HARBOR_AIRPORT,
  allowIndependentParallelApproaches: boolean = true
): {
  requiredNM: number;
  isWakeTurbulence: boolean;
  leaderCallsign?: string;
} {
  // 1. 平行跑道五边独立进近豁免 (ICAO Doc 4444 §6.7.3.2 Mode 1 Independent Parallel Approaches)
  if (
    allowIndependentParallelApproaches &&
    a.phase === 'FINAL_APPROACH' &&
    b.phase === 'FINAL_APPROACH' &&
    a.assignedRunway !== b.assignedRunway &&
    airport.layoutType !== 'INTERSECTING'
  ) {
    const rwyA = getRunwayConfig(airport, a.assignedRunway);
    const rwyB = getRunwayConfig(airport, b.assignedRunway);
    if (Math.abs(shortestHeadingDelta(rwyA.heading, rwyB.heading)) <= 5) {
      const geomA = computeRunwayLocalizerGeometry(a.position, rwyA);
      const geomB = computeRunwayLocalizerGeometry(b.position, rwyB);
      if (geomA.crossTrackErrorNM <= 0.35 && geomB.crossTrackErrorNM <= 0.35) {
        return { requiredNM: 0.8, isWakeTurbulence: false };
      }
    }
  }

  // 2. 判断前机 (Leader) 与后机 (Follower) 尾流跟驰关系
  const candidates: Array<[Aircraft, Aircraft]> = [
    [a, b],
    [b, a],
  ];

  for (const [leader, follower] of candidates) {
    const wakeMin =
      wakeStandard === 'RECAT_EU'
        ? RECAT_EU_RADAR_MINIMA_NM[leader.recatCode]?.[follower.recatCode] ?? 3.0
        : ICAO_WAKE_RADAR_MINIMA_NM[leader.wakeCategory]?.[follower.wakeCategory] ?? 3.0;

    if (wakeMin > 3.0) {
      const bearingLeaderToFollower = bearingTo(leader.position, follower.position);
      const leaderTailBearing = (leader.heading + 180) % 360;
      const tailAngleDiff = Math.abs(shortestHeadingDelta(bearingLeaderToFollower, leaderTailBearing));
      const followerNotAboveLeader = follower.altitude <= leader.altitude + 250;

      if (tailAngleDiff <= 75 && followerNotAboveLeader) {
        return {
          requiredNM: wakeMin,
          isWakeTurbulence: true,
          leaderCallsign: leader.callsign,
        };
      }
    }
  }

  return { requiredNM: 5.0, isWakeTurbulence: false };
}

/**
 * 检测所有活动航班之间的间隔冲突、尾流违规、平行跑道 NTZ 突破、交叉跑道交汇冲突、TCAS RA 触发以及 CAAC 严重差错（危险接近/相撞）
 */
export function evaluateAirspaceSafety(
  aircraftList: Aircraft[],
  simTimeSec: number,
  previousAlertIds: Set<string>,
  wakeStandard: WakeStandard = 'ICAO',
  enableNtzMonitoring: boolean = true,
  airport: AirportConfig = HARBOR_AIRPORT
): SafetyEvaluationResult {
  const alerts: ConflictAlert[] = [];
  const aircraftConflictLevels: Record<string, 'NONE' | 'WARNING' | 'CRITICAL' | 'ACCIDENT'> = {};
  const ntzPenetratingIds = new Set<string>();
  const tcasRaPairs: Array<{ climbId: string; descendId: string }> = [];

  for (const ac of aircraftList) {
    aircraftConflictLevels[ac.id] = 'NONE';
  }

  const activeList = aircraftList.filter(
    (ac) =>
      ac.phase !== 'HOLDING_GROUND' &&
      ac.phase !== 'HOLD_CROSSING' &&
      ac.phase !== 'LANDED' &&
      ac.phase !== 'HANDED_OFF' &&
      ac.phase !== 'EXITED_AIRSPACE'
  );

  let hasNewWarning = false;
  let hasNewCritical = false;
  let hasNewAccident = false;
  let hasRunwayConflict = false;

  // 1. 按每条物理跑道条带 (physicalStripId) 检测同时滑跑或进跑道等待占用冲突
  const runwayUsers = activeList.filter(
    (ac) =>
      ac.phase === 'TAKEOFF_ROLL' ||
      ac.phase === 'LANDING_ROLL' ||
      ac.phase === 'LINE_UP_WAIT'
  );
  const byStrip = new Map<string, Aircraft[]>();
  for (const ac of runwayUsers) {
    const rwy = getRunwayConfig(airport, ac.assignedRunway);
    const stripKey = rwy.physicalStripId || rwy.id;
    const list = byStrip.get(stripKey) || [];
    list.push(ac);
    byStrip.set(stripKey, list);
  }

  for (const [, stripUsers] of byStrip.entries()) {
    if (stripUsers.length >= 2) {
      const a = stripUsers[0];
      const b = stripUsers[1];
      const pairKey = [a.id, b.id].sort().join('::RWY');
      const hDist = distanceNM(a.position, b.position);
      alerts.push({
        id: pairKey,
        aircraftIds: [a.id, b.id],
        callsigns: [a.callsign, b.callsign],
        horizontalDistNM: Number(hDist.toFixed(2)),
        requiredHorizontalNM: 2.5,
        verticalDistFt: 0,
        severity: 'RUNWAY',
        isWakeTurbulence: false,
        description: `RUNWAY ${a.assignedRunway} INCURSION: ${a.callsign} & ${b.callsign} ON SAME RUNWAY STRIP!`,
        timestampSec: simTimeSec,
      });
      aircraftConflictLevels[a.id] = 'CRITICAL';
      aircraftConflictLevels[b.id] = 'CRITICAL';
      if (!previousAlertIds.has(pairKey)) {
        hasRunwayConflict = true;
      }
    }
  }

  // 1B. 交叉跑道 (RJTT 34R × 22) 交汇点同时滑跑/短五边冲突检测
  if (airport.layoutType === 'INTERSECTING' && airport.intersectionPoint && runwayUsers.length >= 2) {
    for (let i = 0; i < runwayUsers.length; i++) {
      for (let j = i + 1; j < runwayUsers.length; j++) {
        const a = runwayUsers[i];
        const b = runwayUsers[j];
        if (a.phase === 'LINE_UP_WAIT' && b.phase === 'LINE_UP_WAIT') continue;
        const rwyA = getRunwayConfig(airport, a.assignedRunway);
        const rwyB = getRunwayConfig(airport, b.assignedRunway);
        if (rwyA.physicalStripId !== rwyB.physicalStripId) {
          const distA = distanceNM(a.position, airport.intersectionPoint);
          const distB = distanceNM(b.position, airport.intersectionPoint);
          if (distA <= 1.8 && distB <= 1.8) {
            const pairKey = [a.id, b.id].sort().join('::XRWY');
            const hDist = distanceNM(a.position, b.position);
            alerts.push({
              id: pairKey,
              aircraftIds: [a.id, b.id],
              callsigns: [a.callsign, b.callsign],
              horizontalDistNM: Number(hDist.toFixed(2)),
              requiredHorizontalNM: 2.0,
              verticalDistFt: 0,
              severity: 'RUNWAY',
              isWakeTurbulence: false,
              description: `INTERSECTING RUNWAY HAZARD (${a.assignedRunway} × ${b.assignedRunway}): ${a.callsign} & ${b.callsign} CONVERGING AT INTERSECTION!`,
              timestampSec: simTimeSec,
            });
            aircraftConflictLevels[a.id] = 'CRITICAL';
            aircraftConflictLevels[b.id] = 'CRITICAL';
            if (!previousAlertIds.has(pairKey)) {
              hasRunwayConflict = true;
            }
          }
        }
      }
    }
  }

  // 2. 平行跑道 NTZ (No Transgression Zone) 非侵入区检测 (ICAO Doc 9643)
  if (enableNtzMonitoring && airport.layoutType !== 'INTERSECTING') {
    const rwyPrimaryArr = getRunwayConfig(airport, airport.primaryFlowRunways.arrival);
    const rwyPrimaryDep = getRunwayConfig(airport, airport.primaryFlowRunways.departure);
    const midThreshold = {
      x: (rwyPrimaryArr.threshold.x + rwyPrimaryDep.threshold.x) * 0.5,
      y: (rwyPrimaryArr.threshold.y + rwyPrimaryDep.threshold.y) * 0.5,
    };
    const midDummyRwy = {
      ...rwyPrimaryArr,
      threshold: midThreshold,
    };

    const approachAircraft = activeList.filter((ac) => {
      if (ac.phase !== 'FINAL_APPROACH' && ac.phase !== 'INTERCEPTING') return false;
      const g = computeRunwayLocalizerGeometry(ac.position, midDummyRwy);
      return g.axialDistNM >= 0.2 && g.axialDistNM <= 16.0;
    });

    for (const ac of approachAircraft) {
      const gMid = computeRunwayLocalizerGeometry(ac.position, midDummyRwy);
      if (gMid.crossTrackErrorNM <= 0.22) {
        ntzPenetratingIds.add(ac.id);
        const threatened = approachAircraft.find((other) => {
          if (other.id === ac.id || other.assignedRunway === ac.assignedRunway) return false;
          const gOther = computeRunwayLocalizerGeometry(other.position, midDummyRwy);
          return Math.abs(gOther.axialDistNM - gMid.axialDistNM) <= 4.0;
        });
        if (threatened) {
          const alertId = [ac.id, threatened.id].sort().join('::NTZ');
          alerts.push({
            id: alertId,
            aircraftIds: [ac.id, threatened.id],
            callsigns: [ac.callsign, threatened.callsign],
            horizontalDistNM: Number(distanceNM(ac.position, threatened.position).toFixed(2)),
            requiredHorizontalNM: 1.0,
            verticalDistFt: Math.round(Math.abs(ac.altitude - threatened.altitude)),
            severity: 'NTZ',
            isWakeTurbulence: false,
            description: `ICAO NTZ PENETRATION: ${ac.callsign} DEVIATED INTO NO TRANSGRESSION ZONE THREATENING ${threatened.callsign}!`,
            timestampSec: simTimeSec,
          });
          aircraftConflictLevels[ac.id] = 'CRITICAL';
          aircraftConflictLevels[threatened.id] = 'CRITICAL';
          if (!previousAlertIds.has(alertId)) {
            hasNewCritical = true;
          }
        }
      }
    }
  }

  // 3. 空中两两间隔、尾流与民航严重差错（危险接近 AIRPROX / 相撞）检测
  const airborneList = activeList.filter(
    (ac) =>
      ac.phase !== 'TAKEOFF_ROLL' &&
      ac.phase !== 'LANDING_ROLL' &&
      ac.phase !== 'LINE_UP_WAIT'
  );

  for (let i = 0; i < airborneList.length; i++) {
    for (let j = i + 1; j < airborneList.length; j++) {
      const a = airborneList[i];
      const b = airborneList[j];

      const hDist = distanceNM(a.position, b.position);
      const vDist = Math.abs(a.altitude - b.altitude);
      const vMeters = feetToStandardMeters(vDist);
      const hKm = Number((hDist * 1.852).toFixed(2));
      const { requiredNM, isWakeTurbulence, leaderCallsign } = getRequiredHorizontalSeparationNM(
        a,
        b,
        wakeStandard,
        airport,
        enableNtzMonitoring
      );

      // Simplified game separation model, not an operational approval of these minima.
      if (hDist < requiredNM && vDist < 1000) {
        let severity: ConflictSeverity = isWakeTurbulence ? 'WAKE' : 'WARNING';
        let level: 'WARNING' | 'CRITICAL' | 'ACCIDENT' = 'WARNING';

        // Game difficulty threshold; do not label this a CAAC/ICAO incident definition.
        if (hDist < GAME_DANGEROUS_PROXIMITY_NM && vDist < GAME_DANGEROUS_PROXIMITY_FT) {
          severity = 'ACCIDENT';
          level = 'ACCIDENT';
        } else if (hDist < 2.5 && vDist < 600) {
          severity = 'CRITICAL';
          level = 'CRITICAL';
          const climbAc = a.altitude >= b.altitude ? a : b;
          const descendAc = a.altitude >= b.altitude ? b : a;
          tcasRaPairs.push({ climbId: climbAc.id, descendId: descendAc.id });
        }

        const pairBase = [a.id, b.id].sort().join('::');
        const alertId = `${pairBase}::${severity}`;
        const wakeTag = isWakeTurbulence
          ? ` [${wakeStandard} WAKE MIN ${requiredNM}NM BEHIND ${leaderCallsign}]`
          : '';

        alerts.push({
          id: alertId,
          aircraftIds: [a.id, b.id],
          callsigns: [a.callsign, b.callsign],
          horizontalDistNM: Number(hDist.toFixed(2)),
          requiredHorizontalNM: requiredNM,
          verticalDistFt: Math.round(vDist),
          severity,
          isWakeTurbulence,
          description:
            severity === 'ACCIDENT'
              ? `AIRPROX / SERIOUS INCIDENT: ${a.callsign} & ${b.callsign} (${hKm}KM/${hDist.toFixed(2)}NM < 2.8KM, ${vMeters}M < 150M)`
              : severity === 'CRITICAL'
              ? `CRITICAL TRAFFIC ALERT: ${a.callsign} & ${b.callsign} (${hDist.toFixed(1)} NM / ${Math.round(vDist)} FT)${wakeTag}`
              : isWakeTurbulence
              ? `${wakeStandard} WAKE TURBULENCE LOSS: ${a.callsign} & ${b.callsign} (${hDist.toFixed(1)} NM < ${requiredNM} NM / ${Math.round(vDist)} FT)${wakeTag}`
              : `SEPARATION LOSS: ${a.callsign} & ${b.callsign} (${hDist.toFixed(1)} NM / ${Math.round(vDist)} FT)`,
          timestampSec: simTimeSec,
        });

        if (SEVERITY_RANK[level] > SEVERITY_RANK[aircraftConflictLevels[a.id]]) {
          aircraftConflictLevels[a.id] = level;
        }
        if (SEVERITY_RANK[level] > SEVERITY_RANK[aircraftConflictLevels[b.id]]) {
          aircraftConflictLevels[b.id] = level;
        }

        if (!previousAlertIds.has(alertId)) {
          if (severity === 'ACCIDENT') hasNewAccident = true;
          else if (severity === 'CRITICAL') hasNewCritical = true;
          else hasNewWarning = true;
        }
      }
    }
  }

  return {
    alerts,
    aircraftConflictLevels,
    ntzPenetratingIds,
    tcasRaPairs,
    hasNewWarning,
    hasNewCritical,
    hasNewAccident,
    hasRunwayConflict,
  };
}
