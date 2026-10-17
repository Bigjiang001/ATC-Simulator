import {
  Aircraft,
  AirportConfig,
  AltitudeUnit,
  Point2D,
  RunwayConfig,
  RunwayId,
  SimulationEvent,
  TurnDirection,
  WeatherState,
  AmanSequenceItem,
} from './types';
import { AIRCRAFT_MODELS } from '../airport/harborAirport';

export function normalizeHeading(deg: number): number {
  const mod = ((deg % 360) + 360) % 360;
  return mod === 360 ? 0 : mod;
}

export function formatHeading(deg: number): string {
  const rounded = Math.round(normalizeHeading(deg)) % 360;
  return String(rounded).padStart(3, '0');
}

/**
 * 本游戏的教学高度层映射：1000ft 对应标称 300m。
 * 用于本游戏的显示与指令，不是精确单位换算（1ft=0.3048m），也不替代各国高度层表。
 */
export function feetToStandardMeters(altitudeFt: number): number {
  if (altitudeFt <= 0) return 0;
  const nearestThousand = Math.round(altitudeFt / 1000) * 1000;
  if (Math.abs(altitudeFt - nearestThousand) <= 40) {
    return (nearestThousand / 1000) * 300;
  }
  return Math.round((altitudeFt * 0.3) / 10) * 10;
}

/**
 * 根据当前高度计量制式返回纯粹的单制式显示文本（不混排 m 与 ft）：
 * - METRIC (默认): "900m"
 * - IMPERIAL: "3000ft"
 */
export function formatAltitudeValue(altitudeFt: number, unit: AltitudeUnit = 'METRIC'): string {
  if (unit === 'IMPERIAL') {
    return `${Math.round(altitudeFt)}ft`;
  }
  return `${feetToStandardMeters(altitudeFt)}m`;
}

/**
 * 根据当前高度计量制式返回纯数值：
 * - METRIC (默认): 900
 * - IMPERIAL: 3000
 */
export function getAltitudeNumber(altitudeFt: number, unit: AltitudeUnit = 'METRIC'): number {
  if (unit === 'IMPERIAL') {
    return Math.round(altitudeFt);
  }
  return feetToStandardMeters(altitudeFt);
}

/**
 * 根据当前高度计量制式返回陆空通话中文读数（默认：“900 米”；英制：“3000 英尺”）
 */
export function formatAltitudeSpeechCn(altitudeFt: number, unit: AltitudeUnit = 'METRIC'): string {
  if (unit === 'IMPERIAL') {
    return `${Math.round(altitudeFt)} 英尺`;
  }
  return `${feetToStandardMeters(altitudeFt)} 米`;
}

/**
 * 根据当前高度计量制式返回陆空通话英文读数（默认：“900 METERS”；英制：“3000 FEET”）
 */
export function formatAltitudeSpeechEn(altitudeFt: number, unit: AltitudeUnit = 'METRIC'): string {
  if (unit === 'IMPERIAL') {
    return `${Math.round(altitudeFt)} FEET`;
  }
  return `${feetToStandardMeters(altitudeFt)} METERS`;
}

/**
 * 根据磁航向返回符合中国民航 / ICAO 半圆规则（东单西双）的标准高度层列表
 */
export function getIcaoDirectionalLevelsFt(
  headingDeg: number,
  unit: AltitudeUnit = 'METRIC'
): {
  isEastbound: boolean;
  ruleNameCn: string;
  levelsFt: number[];
} {
  const norm = normalizeHeading(headingDeg);
  const isEastbound = norm >= 0 && norm < 180;
  if (unit === 'IMPERIAL') {
    return {
      isEastbound,
      ruleNameCn: isEastbound
        ? '东向单数高度层 (000°–179° · 3000ft/5000ft/7000ft/9000ft)'
        : '西向双数高度层 (180°–359° · 4000ft/6000ft/8000ft)',
      levelsFt: isEastbound ? [3000, 5000, 7000, 9000] : [4000, 6000, 8000],
    };
  }
  return {
    isEastbound,
    ruleNameCn: isEastbound
      ? '东向单数高度层 (000°–179° · 900m/1500m/2100m/2700m)'
      : '西向双数高度层 (180°–359° · 1200m/1800m/2400m)',
    levelsFt: isEastbound ? [3000, 5000, 7000, 9000] : [4000, 6000, 8000],
  };
}

/**
 * 结合航班当前进离场程序 (STAR/SID)、航路点高度约束与东单西双标准，返回当前推荐指派的标准高度层
 */
export function getProcedureRecommendedAltitude(
  ac: Aircraft,
  airport: AirportConfig,
  unit: AltitudeUnit = 'METRIC'
): {
  altitudeFt: number;
  meters: number;
  reasonCn: string;
} {
  if (ac.category === 'DEPARTURE') {
    if (ac.phase === 'HOLDING_GROUND' || ac.phase === 'LINE_UP_WAIT' || ac.altitude < 3500) {
      return {
        altitudeFt: 4000,
        meters: 1200,
        reasonCn: `SID 离场初始爬升限制层 ${formatAltitudeValue(4000, unit)}，避让上方进港流`,
      };
    }
    return {
      altitudeFt: 6000,
      meters: 1800,
      reasonCn: `SID 离场移交标准层 ${formatAltitudeValue(6000, unit)} (飞向 ${ac.assignedExitId || '出口'})`,
    };
  }

  if (ac.procedureLegs && ac.procedureLegs.length > 0 && ac.procedureLegs[0].targetAltitude) {
    const legAlt = ac.procedureLegs[0].targetAltitude;
    return {
      altitudeFt: legAlt,
      meters: feetToStandardMeters(legAlt),
      reasonCn: `STAR ${ac.activeProcedureId || ''} 程序点 ${ac.procedureLegs[0].waypointId} 要求高度 ${formatAltitudeValue(legAlt, unit)}`,
    };
  }

  if (ac.directWaypointId) {
    const wp = airport.waypoints.find((w) => w.id === ac.directWaypointId);
    if (wp) {
      return {
        altitudeFt: wp.recommendedAltitude,
        meters: feetToStandardMeters(wp.recommendedAltitude),
        reasonCn: `航路点 ${wp.id} (${wp.role}) 标准程序高度 ${formatAltitudeValue(wp.recommendedAltitude, unit)}`,
      };
    }
  }

  const rwy = getRunwayConfig(airport, ac.assignedRunway);
  const dist = distanceNM(ac.position, rwy.threshold);
  if (dist <= 9.5) {
    return {
      altitudeFt: 2000,
      meters: 600,
      reasonCn: `五边最终进近段 (FAF) 标准截获高度层 ${formatAltitudeValue(2000, unit)}`,
    };
  }
  if (dist <= 15.0) {
    return {
      altitudeFt: 3000,
      meters: 900,
      reasonCn: `五边中间进近段 (IF) 标准切入高度层 ${formatAltitudeValue(3000, unit)}`,
    };
  }

  const dirInfo = getIcaoDirectionalLevelsFt(ac.heading, unit);
  const recFt = dirInfo.isEastbound ? 5000 : 4000;
  return {
    altitudeFt: recFt,
    meters: feetToStandardMeters(recFt),
    reasonCn: `终端区进港过渡层 (${dirInfo.isEastbound ? '东单' : '西双'} ${formatAltitudeValue(recFt, unit)})`,
  };
}

export function shortestHeadingDelta(current: number, target: number): number {
  const c = normalizeHeading(current);
  const t = normalizeHeading(target);
  return ((t - c + 540) % 360) - 180;
}

export function stepHeading(
  current: number,
  target: number,
  maxTurnRateDegPerSec: number,
  dtSec: number,
  turnDirection: TurnDirection = 'AUTO'
): { heading: number; remainingTurnDirection: TurnDirection } {
  const c = normalizeHeading(current);
  const t = normalizeHeading(target);
  const maxStep = maxTurnRateDegPerSec * dtSec;
  const shortest = shortestHeadingDelta(c, t);

  if (Math.abs(shortest) <= maxStep) {
    return { heading: t, remainingTurnDirection: 'AUTO' };
  }

  let dir = 1;
  if (turnDirection === 'LEFT') {
    dir = -1;
  } else if (turnDirection === 'RIGHT') {
    dir = 1;
  } else {
    dir = shortest >= 0 ? 1 : -1;
  }

  const nextHeading = normalizeHeading(c + dir * maxStep);
  const nextShortest = shortestHeadingDelta(nextHeading, t);
  const nextTurnDir: TurnDirection = Math.abs(nextShortest) < 90 ? 'AUTO' : turnDirection;

  return { heading: nextHeading, remainingTurnDirection: nextTurnDir };
}

export function stepScalar(
  current: number,
  target: number,
  maxDeltaPerSec: number,
  dtSec: number
): number {
  const diff = target - current;
  const maxStep = maxDeltaPerSec * dtSec;
  if (Math.abs(diff) <= maxStep) {
    return target;
  }
  return current + Math.sign(diff) * maxStep;
}

export function distanceNM(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

export function bearingTo(from: Point2D, to: Point2D): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const rad = Math.atan2(dx, dy);
  return normalizeHeading((rad * 180) / Math.PI);
}

export function calculateRunwayWindComponents(
  runwayHeadingDeg: number,
  windDirectionDeg: number,
  windSpeedKt: number
): {
  headwindKt: number;
  tailwindKt: number;
  crosswindKt: number;
  exceedsTailwindLimit: boolean;
} {
  if (windSpeedKt <= 0.1) {
    return {
      headwindKt: 0,
      tailwindKt: 0,
      crosswindKt: 0,
      exceedsTailwindLimit: false,
    };
  }
  const angleDiffRad = ((windDirectionDeg - runwayHeadingDeg) * Math.PI) / 180;
  const headwind = windSpeedKt * Math.cos(angleDiffRad);
  const crosswind = Math.abs(windSpeedKt * Math.sin(angleDiffRad));
  const tailwind = headwind < 0 ? Math.abs(headwind) : 0;
  return {
    headwindKt: Number(headwind.toFixed(1)),
    tailwindKt: Number(tailwind.toFixed(1)),
    crosswindKt: Number(crosswind.toFixed(1)),
    exceedsTailwindLimit: tailwind > 5.5,
  };
}

export function getRunwayConfig(
  airport: AirportConfig,
  runwayId?: RunwayId | '09' | '27'
): RunwayConfig {
  if (runwayId && airport.runways[runwayId as RunwayId]) {
    return airport.runways[runwayId as RunwayId]!;
  }
  if (runwayId === '09') {
    const primaryArr = airport.primaryFlowRunways?.arrival;
    if (primaryArr && airport.runways[primaryArr]) return airport.runways[primaryArr]!;
  }
  if (runwayId === '27') {
    const revArr = airport.reverseFlowRunways?.arrival;
    if (revArr && airport.runways[revArr]) return airport.runways[revArr]!;
  }
  const fallbackKey =
    airport.primaryFlowRunways?.arrival || (Object.keys(airport.runways)[0] as RunwayId);
  return airport.runways[fallbackKey]!;
}

/**
 * 任意角度跑道 (0°–359°) 的通用二维航向道与下滑道向量几何解算器
 */
export function computeRunwayLocalizerGeometry(
  pos: Point2D,
  rwy: RunwayConfig
): {
  axialDistNM: number;
  rolloutDistNM: number;
  signedCrossTrackNM: number;
  crossTrackErrorNM: number;
  forwardUnit: Point2D;
  rightNormalUnit: Point2D;
} {
  const rad = (rwy.heading * Math.PI) / 180;
  const ux = Math.sin(rad);
  const uy = Math.cos(rad);
  const nx = Math.cos(rad);
  const ny = -Math.sin(rad);

  const dxFromThreshold = pos.x - rwy.threshold.x;
  const dyFromThreshold = pos.y - rwy.threshold.y;

  const rolloutDistNM = dxFromThreshold * ux + dyFromThreshold * uy;
  const axialDistNM = -rolloutDistNM;
  const signedCrossTrackNM = dxFromThreshold * nx + dyFromThreshold * ny;
  const crossTrackErrorNM = Math.abs(signedCrossTrackNM);

  return {
    axialDistNM,
    rolloutDistNM,
    signedCrossTrackNM,
    crossTrackErrorNM,
    forwardUnit: { x: ux, y: uy },
    rightNormalUnit: { x: nx, y: ny },
  };
}

export interface IlsCaptureCheck {
  runwayId: RunwayId;
  canAcceptClearance: boolean;
  canLockLocalizer: boolean;
  canTouchdown: boolean;
  distToThresholdNM: number;
  axialDistNM: number;
  crossTrackErrorNM: number;
  headingErrorDeg: number;
  idealGlideslopeAltFt: number;
  maxInterceptAngleDeg: number;
  reasonEn?: string;
  reasonCn?: string;
}

export function checkIlsConditions(
  ac: Aircraft,
  airport: AirportConfig,
  overrideRunwayId?: RunwayId | '09' | '27',
  unit: AltitudeUnit = 'METRIC'
): IlsCaptureCheck {
  const rwy = getRunwayConfig(airport, overrideRunwayId || ac.assignedRunway);
  const geom = computeRunwayLocalizerGeometry(ac.position, rwy);
  const { axialDistNM, crossTrackErrorNM } = geom;

  const distToThresholdNM = distanceNM(ac.position, rwy.threshold);
  const headingErrorDeg = Math.abs(shortestHeadingDelta(ac.heading, rwy.heading));
  const maxInterceptAngleDeg = ac.independentApproachMode ? 30 : 45;
  const glideslopeDist = Math.max(0, axialDistNM);
  const idealGlideslopeAltFt = Math.min(3600, Math.round(glideslopeDist * 318));

  const canTouchdown =
    crossTrackErrorNM <= 0.35 &&
    headingErrorDeg <= 15 &&
    ac.altitude <= 420 &&
    ac.speed <= 178;

  if (axialDistNM <= 1.0) {
    return {
      runwayId: rwy.id,
      canAcceptClearance: false,
      canLockLocalizer: false,
      canTouchdown,
      distToThresholdNM,
      axialDistNM,
      crossTrackErrorNM,
      headingErrorDeg,
      idealGlideslopeAltFt,
      maxInterceptAngleDeg,
      reasonEn: `UNABLE ILS RWY ${rwy.id}, PAST APPROACH GATE`,
      reasonCn: `无法直接建立 ILS ${rwy.id}：飞机已越过五边切入点（请点击【🎯 一键引导五边】自动掉头切入）`,
    };
  }

  if (axialDistNM > 20.0) {
    return {
      runwayId: rwy.id,
      canAcceptClearance: false,
      canLockLocalizer: false,
      canTouchdown,
      distToThresholdNM,
      axialDistNM,
      crossTrackErrorNM,
      headingErrorDeg,
      idealGlideslopeAltFt,
      maxInterceptAngleDeg,
      reasonEn: `UNABLE ILS RWY ${rwy.id}, TOO FAR FROM LOCALIZER (>20 NM)`,
      reasonCn: `无法直接建立 ILS ${rwy.id}：距离跑道过远 (>20 NM，请先点 STAR 或【🎯 一键引导五边】)`,
    };
  }

  if (ac.altitude > 5000) {
    return {
      runwayId: rwy.id,
      canAcceptClearance: false,
      canLockLocalizer: false,
      canTouchdown,
      distToThresholdNM,
      axialDistNM,
      crossTrackErrorNM,
      headingErrorDeg,
      idealGlideslopeAltFt,
      maxInterceptAngleDeg,
      reasonEn: `UNABLE ILS RWY ${rwy.id}, ALTITUDE TOO HIGH (MUST BE AT OR BELOW ${formatAltitudeSpeechEn(5000, unit)})`,
      reasonCn: `无法直接建立 ILS ${rwy.id}：当前高度过高（需降至 ≤${formatAltitudeValue(5000, unit)}，或点【🎯 一键引导五边】自动下高切入）`,
    };
  }

  if (ac.speed > 245) {
    return {
      runwayId: rwy.id,
      canAcceptClearance: false,
      canLockLocalizer: false,
      canTouchdown,
      distToThresholdNM,
      axialDistNM,
      crossTrackErrorNM,
      headingErrorDeg,
      idealGlideslopeAltFt,
      maxInterceptAngleDeg,
      reasonEn: `UNABLE ILS RWY ${rwy.id}, AIRSPEED TOO FAST (REDUCE BELOW 240 KT)`,
      reasonCn: `无法直接建立 ILS ${rwy.id}：当前速度过快（请减速至 ≤240 节或点【🎯 一键引导五边】）`,
    };
  }

  if (crossTrackErrorNM > 6.5) {
    return {
      runwayId: rwy.id,
      canAcceptClearance: false,
      canLockLocalizer: false,
      canTouchdown,
      distToThresholdNM,
      axialDistNM,
      crossTrackErrorNM,
      headingErrorDeg,
      idealGlideslopeAltFt,
      maxInterceptAngleDeg,
      reasonEn: `UNABLE ILS RWY ${rwy.id}, TOO FAR OFF CENTERLINE (>6.5 NM)`,
      reasonCn: `无法直接建立 ILS ${rwy.id}：横向偏离延长线过远 (>6.5 NM，请点【🎯 一键引导五边】自动切入)`,
    };
  }

  if (headingErrorDeg > 105) {
    return {
      runwayId: rwy.id,
      canAcceptClearance: false,
      canLockLocalizer: false,
      canTouchdown,
      distToThresholdNM,
      axialDistNM,
      crossTrackErrorNM,
      headingErrorDeg,
      idealGlideslopeAltFt,
      maxInterceptAngleDeg,
      reasonEn: `UNABLE ILS RWY ${rwy.id}, HEADING AWAY FROM FINAL APPROACH COURSE`,
      reasonCn: `无法直接建立 ILS ${rwy.id}：当前航向背离五边方向 (${formatHeading(rwy.heading)}°，请点【🎯 一键引导五边】)`,
    };
  }

  const targetHdgErrorDeg = Math.abs(shortestHeadingDelta(ac.targetHeading, rwy.heading));
  const effectiveInterceptAngle = Math.min(headingErrorDeg, targetHdgErrorDeg);

  const canLockLocalizer =
    axialDistNM >= 0.8 &&
    axialDistNM <= rwy.ilsRangeNM &&
    crossTrackErrorNM <= 1.2 &&
    effectiveInterceptAngle <= maxInterceptAngleDeg + 5 &&
    ac.altitude <= idealGlideslopeAltFt + 1500;

  return {
    runwayId: rwy.id,
    canAcceptClearance: true,
    canLockLocalizer,
    canTouchdown,
    distToThresholdNM,
    axialDistNM,
    crossTrackErrorNM,
    headingErrorDeg,
    idealGlideslopeAltFt,
    maxInterceptAngleDeg,
  };
}

/**
 * 计算 AMAN (Arrival Manager) 进港航班队列排序与调速建议
 */
export function computeAmanSequence(
  aircraftList: Aircraft[],
  airport: AirportConfig
): AmanSequenceItem[] {
  const arrivals = aircraftList.filter(
    (a) =>
      a.category === 'ARRIVAL' &&
      a.phase !== 'LANDED' &&
      a.phase !== 'EXITED_AIRSPACE' &&
      a.phase !== 'HOLD_CROSSING'
  );

  const items: AmanSequenceItem[] = arrivals.map((ac) => {
    const rwy = getRunwayConfig(airport, ac.assignedRunway);
    const dist = distanceNM(ac.position, rwy.threshold);
    const gs = Math.max(120, ac.groundSpeed);
    const etaSec = Math.round((dist / gs) * 3600);
    return {
      aircraftId: ac.id,
      callsign: ac.callsign,
      wakeBadge: `${ac.model}/${ac.wakeCode}`,
      assignedRunway: ac.assignedRunway,
      distToThresholdNM: Number(dist.toFixed(1)),
      etaSec,
      recommendedActionCn: '保持当前速度',
      isEmergency: ac.emergencyType !== 'NONE',
    };
  });

  items.sort((a, b) => a.etaSec - b.etaSec);

  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    if (cur.isEmergency) {
      cur.recommendedActionCn = '🚨 7700/7600 特情优先落地';
      continue;
    }
    if (i > 0) {
      const prev = items[i - 1];
      const gapSec = cur.etaSec - prev.etaSec;
      if (gapSec < 50 && cur.assignedRunway === prev.assignedRunway) {
        cur.recommendedActionCn = `⚠ 距前机过近(+${gapSec}s)，建议减速 160kt 或改配次跑道`;
      } else if (gapSec < 85 && cur.assignedRunway === prev.assignedRunway) {
        cur.recommendedActionCn = `建议减速至 180kt 拉开尾流间隔`;
      } else {
        cur.recommendedActionCn = `间隔正常 (+${gapSec}s)`;
      }
    } else {
      cur.recommendedActionCn = '五边排首 (一号落地)';
    }
  }

  return items;
}

/**
 * 单架飞机的固定时间步长物理与状态机更新
 */
export function updateAircraftPhysics(
  ac: Aircraft,
  dtSec: number,
  airport: AirportConfig,
  runwayOccupiedByOther: boolean,
  weather?: WeatherState,
  enableRunwayCrossing: boolean = false,
  altitudeUnit: AltitudeUnit = 'METRIC',
  enableRestrictedZones: boolean = true,
  requireLandingClearance: boolean = false
): { aircraft: Aircraft; events: SimulationEvent[] } {
  if (
    ac.phase === 'HOLDING_GROUND' ||
    ac.phase === 'LINE_UP_WAIT' ||
    ac.phase === 'HOLD_CROSSING' ||
    ac.phase === 'LANDED' ||
    ac.phase === 'HANDED_OFF' ||
    ac.phase === 'EXITED_AIRSPACE'
  ) {
    return { aircraft: ac, events: [] };
  }

  const next: Aircraft = {
    ...ac,
    position: { ...ac.position },
    trail: ac.trail,
    procedureLegs: ac.procedureLegs ? [...ac.procedureLegs] : [],
    holdState: ac.holdState
      ? { ...ac.holdState, center: { ...ac.holdState.center } }
      : null,
    identFlashTimerSec: Math.max(0, (ac.identFlashTimerSec || 0) - dtSec),
  };
  const events: SimulationEvent[] = [];
  const spec = AIRCRAFT_MODELS[next.model] || AIRCRAFT_MODELS.A320;
  const rwy = getRunwayConfig(airport, next.assignedRunway);

  // 0. 若为 7600 无线电通信失效 (NORDO) 航班，机组自主飞向五边 FAF/IF 建立盲降
  if (
    next.emergencyType === 'SQUAWK_7600_NORDO' &&
    next.category === 'ARRIVAL' &&
    next.phase === 'ARRIVING'
  ) {
    const ilsCheck = checkIlsConditions(next, airport, rwy.id, altitudeUnit);
    if (ilsCheck.canAcceptClearance) {
      next.clearedApproach = true;
      next.phase = ilsCheck.canLockLocalizer ? 'FINAL_APPROACH' : 'INTERCEPTING';
    } else if (!next.directWaypointId) {
      const candidateFixes = airport.waypoints.filter(
        (w) => w.role === 'FAF' || w.role === 'IF'
      );
      let bestFix = candidateFixes[0]?.id || airport.waypoints[0]?.id || 'HARBR';
      let bestScore = Infinity;
      for (const fix of candidateFixes) {
        const g = computeRunwayLocalizerGeometry(fix.position, rwy);
        if (g.axialDistNM > 2 && g.crossTrackErrorNM < 3.5 && g.axialDistNM < bestScore) {
          bestScore = g.axialDistNM;
          bestFix = fix.id;
        }
      }
      next.directWaypointId = bestFix;
      next.targetAltitude = 2000;
      next.targetSpeed = 180;
    }
  }

  // 1. 起飞滑跑阶段 (TAKEOFF_ROLL)
  if (next.phase === 'TAKEOFF_ROLL') {
    next.heading = rwy.heading;
    next.targetHeading = rwy.heading;
    next.altitude = 0;
    next.verticalSpeed = 0;
    next.speed = stepScalar(next.speed, spec.rotationSpeed + 15, spec.takeoffAccel, dtSec);
    next.groundSpeed = next.speed;

    const moveDistNM = (next.speed * dtSec) / 3600;
    const rad = (next.heading * Math.PI) / 180;
    next.position.x += moveDistNM * Math.sin(rad);
    next.position.y += moveDistNM * Math.cos(rad);

    if (next.speed >= spec.rotationSpeed) {
      next.phase = 'INITIAL_CLIMB';
      if (next.targetAltitude < 2000) {
        next.targetAltitude = 4000;
      }
      if (next.targetSpeed < 200) {
        next.targetSpeed = Math.min(230, spec.cruiseSpeed);
      }
      events.push({
        type: 'AIRBORNE',
        aircraftId: next.id,
        callsign: next.callsign,
        runwayId: rwy.id,
        detailEn: `${next.callsign} AIRBORNE RWY ${rwy.id}, CLIMBING TO ${formatAltitudeSpeechEn(next.targetAltitude, altitudeUnit)}.`,
        detailCn: `${next.callsign} 已从 ${rwy.id} 跑道离地，按标准高度层爬升至 ${formatAltitudeSpeechCn(next.targetAltitude, altitudeUnit)}。`,
      });
    }
    return { aircraft: next, events };
  }

  // 2. 着陆滑跑阶段 (LANDING_ROLL)
  if (next.phase === 'LANDING_ROLL') {
    next.heading = rwy.heading;
    next.targetHeading = rwy.heading;
    next.altitude = 0;
    next.targetAltitude = 0;
    next.verticalSpeed = 0;
    next.speed = stepScalar(next.speed, 25, spec.landingDecel, dtSec);
    next.groundSpeed = next.speed;

    const moveDistNM = (next.speed * dtSec) / 3600;
    const rad = (next.heading * Math.PI) / 180;
    next.position.x += moveDistNM * Math.sin(rad);
    next.position.y += moveDistNM * Math.cos(rad);

    const geom = computeRunwayLocalizerGeometry(next.position, rwy);
    next.position.x = rwy.threshold.x + geom.rolloutDistNM * geom.forwardUnit.x;
    next.position.y = rwy.threshold.y + geom.rolloutDistNM * geom.forwardUnit.y;

    const passedEnd = geom.rolloutDistNM >= rwy.lengthNM;

    if (next.speed <= 35 || passedEnd) {
      next.speed = 0;
      next.groundSpeed = 0;
      next.targetSpeed = 0;

      const isPrimaryArrRwy =
        rwy.id === airport.primaryFlowRunways.arrival ||
        rwy.id === airport.reverseFlowRunways.arrival;
      const innerRwy: RunwayId =
        rwy.id === airport.primaryFlowRunways.arrival
          ? airport.primaryFlowRunways.departure
          : airport.reverseFlowRunways.departure;

      if (enableRunwayCrossing && isPrimaryArrRwy && innerRwy !== rwy.id) {
        next.phase = 'HOLD_CROSSING';
        next.crossingRunwayId = innerRwy;
        const innerCfg = getRunwayConfig(airport, innerRwy);
        next.position = {
          x: (rwy.end.x + innerCfg.threshold.x) * 0.5,
          y: (rwy.end.y + innerCfg.threshold.y) * 0.5,
        };
        next.lastCommandText = `HOLD SHORT ${innerRwy}`;
        events.push({
          type: 'HOLD_CROSSING',
          aircraftId: next.id,
          callsign: next.callsign,
          runwayId: innerRwy,
          detailEn: `${next.callsign} VACATED RWY ${rwy.id}, HOLDING SHORT OF RWY ${innerRwy}, REQUEST CROSSING TO TERMINAL.`,
          detailCn: `${next.callsign} 已脱离 ${rwy.id} 跑道，在滑行道等待点请求穿越跑道 ${innerRwy} 回航站楼！`,
        });
      } else {
        next.phase = 'LANDED';
        events.push({
          type: 'LANDED',
          aircraftId: next.id,
          callsign: next.callsign,
          runwayId: rwy.id,
          detailEn: `${next.callsign} TOUCHDOWN AND VACATED RWY ${rwy.id}. WELCOME TO ${airport.icao}!`,
          detailCn: `${next.callsign} 已安全降落并脱离 ${rwy.id} 跑道！`,
        });
      }
    }
    return { aircraft: next, events };
  }

  // 离场飞机爬升越过 360m (1200ft) 后转入 DEPARTING 阶段；
  // 若玩家尚未手动指定其他航向且飞机有飞行计划离场点 (assignedExitId)，自动接通离场航路并爬升至移交层 1800m (6000ft)
  if (next.phase === 'INITIAL_CLIMB' && next.altitude >= 1200) {
    next.phase = 'DEPARTING';
    if (
      !next.directWaypointId &&
      next.procedureLegs.length === 0 &&
      next.assignedExitId &&
      Math.abs(shortestHeadingDelta(next.targetHeading, rwy.heading)) < 5
    ) {
      const exitWp = airport.waypoints.find((w) => w.id === next.assignedExitId);
      if (exitWp) {
        next.directWaypointId = exitWp.id;
        next.targetAltitude = Math.max(next.targetAltitude, exitWp.recommendedAltitude || 6000);
        next.lastCommandText = `SID ${exitWp.id}`;
      }
    }
  }

  // 3. STAR / SID 多航段自动序列与航路点直飞 (DCT)
  if (next.procedureLegs.length > 0 && !next.directWaypointId) {
    const firstLeg = next.procedureLegs[0];
    next.directWaypointId = firstLeg.waypointId;
    if (firstLeg.targetAltitude && !next.tcasRaActive) {
      next.targetAltitude = firstLeg.targetAltitude;
    }
    if (firstLeg.maxSpeed) {
      next.targetSpeed = Math.min(next.targetSpeed, firstLeg.maxSpeed);
    }
  }

  if (next.directWaypointId && next.phase !== 'FINAL_APPROACH' && next.phase !== 'HOLDING_AIR') {
    const wp = airport.waypoints.find((w) => w.id === next.directWaypointId);
    if (wp) {
      const dist = distanceNM(next.position, wp.position);
      if (dist <= 0.75) {
        const reachedId = wp.id;
        const wasOnStarProcedure = Boolean(next.activeProcedureId && next.category === 'ARRIVAL');
        if (next.procedureLegs.length > 0 && next.procedureLegs[0].waypointId === reachedId) {
          next.procedureLegs.shift();
        }

        if (next.procedureLegs.length > 0) {
          const nextLeg = next.procedureLegs[0];
          next.directWaypointId = nextLeg.waypointId;
          if (nextLeg.targetAltitude && !next.tcasRaActive) {
            next.targetAltitude = nextLeg.targetAltitude;
          }
          if (nextLeg.maxSpeed) {
            next.targetSpeed = Math.min(next.targetSpeed, nextLeg.maxSpeed);
          }
          events.push({
            type: 'WAYPOINT_REACHED',
            aircraftId: next.id,
            callsign: next.callsign,
            detailEn: `${next.callsign} PASSING ${reachedId}, PROCEEDING DIRECT ${nextLeg.waypointId} ON ${next.activeProcedureId || 'ROUTE'}.`,
            detailCn: `${next.callsign} 已飞越 ${reachedId}，按程序继续直飞下一航路点 ${nextLeg.waypointId}。`,
          });
        } else {
          next.directWaypointId = null;
          next.activeProcedureId = null;
          events.push({
            type: 'WAYPOINT_REACHED',
            aircraftId: next.id,
            callsign: next.callsign,
            detailEn: `${next.callsign} OVER ${reachedId}.`,
            detailCn: `${next.callsign} 已飞越航路点 ${reachedId}。`,
          });
          // 若进港航班飞完 STAR 标准进场程序的最终进近点 (FAF/IF) 或已预位盲降，自动转入 INTERCEPTING 对正五边下滑道！
          if (next.category === 'ARRIVAL' && (next.clearedApproach || wasOnStarProcedure)) {
            next.clearedApproach = true;
            next.phase = 'INTERCEPTING';
            next.targetHeading = rwy.heading;
            next.targetAltitude = Math.min(next.targetAltitude, 2000);
            next.targetSpeed = Math.min(next.targetSpeed, 175);
            next.lastCommandText = `LOC RWY ${rwy.id}`;
          } else if (wp.role === 'FAF' || wp.role === 'IF') {
            next.targetHeading = rwy.heading;
          }
        }
      } else {
        next.targetHeading = bearingTo(next.position, wp.position);
        next.turnDirection = 'AUTO';
      }
    }
  }

  // 4. 空中等待航线 (HOLD)
  if (next.phase === 'HOLDING_AIR' && next.holdState) {
    const hs = next.holdState;
    const distToFix = distanceNM(next.position, hs.center);
    const inbound = normalizeHeading(hs.inboundHeading);
    const outbound = normalizeHeading(inbound + 180);

    if (hs.legPhase === 'TO_FIX') {
      next.targetHeading = bearingTo(next.position, hs.center);
      next.turnDirection = 'AUTO';
      if (distToFix <= 0.5) {
        hs.legPhase = 'OUTBOUND_TURN';
        hs.legTimerSec = 0;
        next.targetHeading = outbound;
        next.turnDirection = 'RIGHT';
      }
    } else if (hs.legPhase === 'OUTBOUND_TURN') {
      next.targetHeading = outbound;
      next.turnDirection = 'RIGHT';
      if (Math.abs(shortestHeadingDelta(next.heading, outbound)) <= 5) {
        hs.legPhase = 'OUTBOUND_LEG';
        hs.legTimerSec = 0;
      }
    } else if (hs.legPhase === 'OUTBOUND_LEG') {
      next.targetHeading = outbound;
      hs.legTimerSec += dtSec;
      if (hs.legTimerSec >= 25) {
        hs.legPhase = 'INBOUND_TURN';
        hs.legTimerSec = 0;
        next.targetHeading = inbound;
        next.turnDirection = 'RIGHT';
      }
    } else if (hs.legPhase === 'INBOUND_TURN') {
      next.targetHeading = inbound;
      next.turnDirection = 'RIGHT';
      if (Math.abs(shortestHeadingDelta(next.heading, inbound)) <= 8) {
        hs.legPhase = 'INBOUND_LEG';
        hs.legTimerSec = 0;
      }
    } else if (hs.legPhase === 'INBOUND_LEG') {
      next.targetHeading = bearingTo(next.position, hs.center);
      next.turnDirection = 'AUTO';
      if (distToFix <= 0.5 || hs.legTimerSec >= 35) {
        hs.legPhase = 'OUTBOUND_TURN';
        hs.legTimerSec = 0;
        next.targetHeading = outbound;
        next.turnDirection = 'RIGHT';
      } else {
        hs.legTimerSec += dtSec;
      }
    }
  }

  // 5. ILS 进近双阶段智能截获控制器 (INTERCEPTING -> FINAL_APPROACH)
  if (next.clearedApproach && next.phase === 'INTERCEPTING') {
    const geom = computeRunwayLocalizerGeometry(next.position, rwy);

    if (!next.directWaypointId) {
      // 阶段 A：若飞机尚在跑道正切/三边位置 (axialDistNM < 5.2 NM) 或偏离延长线较远 (crossTrackErrorNM > 3.2 NM)，
      // 先平滑引向五边延长线 10.5 NM 的对正切入点 (Approach Gate)，高度降至 900m (3000ft)
      if (geom.axialDistNM < 5.2 || geom.crossTrackErrorNM > 3.2) {
        const gateDist = Math.max(9.5, Math.min(13.0, geom.axialDistNM + 3.5));
        const gatePt = {
          x: rwy.threshold.x - gateDist * geom.forwardUnit.x,
          y: rwy.threshold.y - gateDist * geom.forwardUnit.y,
        };
        next.targetHeading = bearingTo(next.position, gatePt);
        next.turnDirection = 'AUTO';
        if (!next.tcasRaActive) {
          next.targetAltitude = Math.min(next.targetAltitude, 3000);
        }
        next.targetSpeed = Math.min(next.targetSpeed, 185);
      } else {
        // 阶段 B：已进入五边扇区 (axialDistNM >= 5.2 NM 且 crossTrackErrorNM <= 3.2 NM)，
        // 动态瞄准中心线上前方前瞻点，以 ≤38° 截获角平滑切入航向道并跟随下滑道高度
        const lookaheadNM = Math.max(2.0, Math.min(4.2, geom.crossTrackErrorNM * 1.3 + 1.6));
        const aimAxial = Math.max(1.2, geom.axialDistNM - lookaheadNM);
        const aimPt = {
          x: rwy.threshold.x - aimAxial * geom.forwardUnit.x,
          y: rwy.threshold.y - aimAxial * geom.forwardUnit.y,
        };
        const rawInterceptHdg = bearingTo(next.position, aimPt);
        const diffFromRwy = shortestHeadingDelta(rwy.heading, rawInterceptHdg);
        const clampedDiff = Math.max(-42, Math.min(42, diffFromRwy));
        next.targetHeading = normalizeHeading(rwy.heading + clampedDiff);
        next.turnDirection = 'AUTO';
        if (!next.tcasRaActive) {
          const gsAlt = Math.max(1800, Math.min(3000, Math.round(geom.axialDistNM * 310)));
          next.targetAltitude = Math.min(next.targetAltitude, gsAlt);
        }
        next.targetSpeed = Math.min(next.targetSpeed, 175);
      }
    }

    const ilsCheck = checkIlsConditions(next, airport, rwy.id, altitudeUnit);
    if (ilsCheck.canLockLocalizer) {
      next.phase = 'FINAL_APPROACH';
      next.directWaypointId = null;
      next.procedureLegs = [];
      next.activeProcedureId = null;
      next.holdState = null;
      next.lastCommandText = `ILS RWY ${rwy.id}`;
      events.push({
        type: 'LOCALIZER_CAPTURED',
        aircraftId: next.id,
        callsign: next.callsign,
        runwayId: rwy.id,
        detailEn: `${next.callsign} ESTABLISHED ON ILS RWY ${rwy.id} (CRS ${formatHeading(rwy.heading)}°).`,
        detailCn: `${next.callsign} 已截获 ${rwy.id} 跑道 (${formatHeading(rwy.heading)}°) 盲降航向道与下滑道，建立五边进近。`,
      });
    } else if (
      geom.axialDistNM < 0.3 &&
      geom.crossTrackErrorNM <= 1.8 &&
      Math.abs(shortestHeadingDelta(next.heading, rwy.heading)) <= 50
    ) {
      triggerGoAround(next, rwy, events, 'MISSED LOCALIZER INTERCEPT', altitudeUnit);
    }
  }

  // 6. 五边最终进近 (FINAL_APPROACH)
  if (next.phase === 'FINAL_APPROACH') {
    const geom = computeRunwayLocalizerGeometry(next.position, rwy);
    const { axialDistNM, signedCrossTrackNM, crossTrackErrorNM } = geom;

    if (requireLandingClearance && !next.clearedToLand && axialDistNM <= 0.8 &&
        next.emergencyType !== 'SQUAWK_7600_NORDO') {
      triggerGoAround(next, rwy, events, 'NO LANDING CLEARANCE', altitudeUnit);
      return { aircraft: next, events };
    }

    const interceptCorrection = Math.max(-28, Math.min(28, -signedCrossTrackNM * 26));
    next.targetHeading = normalizeHeading(rwy.heading + interceptCorrection);
    next.turnDirection = 'AUTO';

    if (!next.tcasRaActive) {
      const glideslopeAlt = Math.max(0, Math.min(3500, Math.round(axialDistNM * 318)));
      next.targetAltitude = glideslopeAlt;
    }

    if (axialDistNM <= 6.5) {
      next.targetSpeed = Math.min(next.targetSpeed, spec.approachSpeed);
    } else {
      next.targetSpeed = Math.min(next.targetSpeed, 175);
    }

    if (axialDistNM <= 2.2 && crossTrackErrorNM <= 0.35) {
      const targetCenterPos = {
        x: rwy.threshold.x - axialDistNM * geom.forwardUnit.x,
        y: rwy.threshold.y - axialDistNM * geom.forwardUnit.y,
      };
      next.position.x = stepScalar(next.position.x, targetCenterPos.x, 0.16, dtSec);
      next.position.y = stepScalar(next.position.y, targetCenterPos.y, 0.16, dtSec);
    }

    if (axialDistNM <= 0.2) {
      const ilsCheck = checkIlsConditions(next, airport, rwy.id, altitudeUnit);
      if (runwayOccupiedByOther) {
        triggerGoAround(next, rwy, events, `RUNWAY ${rwy.id} OCCUPIED`, altitudeUnit);
      } else if (!ilsCheck.canTouchdown) {
        triggerGoAround(next, rwy, events, 'UNSTABLE APPROACH (HIGH/FAST/OFF-COURSE)', altitudeUnit);
      } else {
        next.phase = 'LANDING_ROLL';
        next.position.x = rwy.threshold.x;
        next.position.y = rwy.threshold.y;
        next.altitude = 0;
        next.targetAltitude = 0;
        next.verticalSpeed = 0;
        next.heading = rwy.heading;
        next.targetHeading = rwy.heading;
        return { aircraft: next, events };
      }
    }
  }

  // 7. 核心运动学更新
  const turnRes = stepHeading(
    next.heading,
    next.targetHeading,
    next.maxTurnRate,
    dtSec,
    next.turnDirection
  );
  next.heading = turnRes.heading;
  next.turnDirection = turnRes.remainingTurnDirection;

  const altDiff = next.targetAltitude - next.altitude;
  if (Math.abs(altDiff) < 1) {
    next.altitude = next.targetAltitude;
    next.verticalSpeed = 0;
  } else if (altDiff > 0) {
    const effectiveClimbRate = next.tcasRaActive
      ? Math.max(next.maxClimbRate, 2800)
      : next.maxClimbRate;
    const climbPerSec = effectiveClimbRate / 60;
    next.altitude = stepScalar(next.altitude, next.targetAltitude, climbPerSec, dtSec);
    next.verticalSpeed = effectiveClimbRate;
  } else {
    const effectiveDescentRate = next.tcasRaActive
      ? Math.max(next.maxDescentRate, 2600)
      : next.phase === 'FINAL_APPROACH' || next.phase === 'INTERCEPTING'
      ? Math.max(next.maxDescentRate, 2150)
      : next.maxDescentRate;
    const descentPerSec = effectiveDescentRate / 60;
    next.altitude = stepScalar(next.altitude, next.targetAltitude, descentPerSec, dtSec);
    next.verticalSpeed = -effectiveDescentRate;
  }

  const maxAllowedBelow10k = next.altitude < 10000 ? Math.min(spec.maxSpeed, 250) : spec.maxSpeed;
  const clampedTargetSpeed = Math.max(
    spec.minSpeed,
    Math.min(maxAllowedBelow10k, next.targetSpeed)
  );
  next.speed = stepScalar(next.speed, clampedTargetSpeed, next.acceleration, dtSec);

  let effectiveGroundSpeed = next.speed;
  if (weather && weather.windSpeedKt > 0 && next.phase !== 'FINAL_APPROACH') {
    const windToRad = (((weather.windDirectionDeg + 180) % 360) * Math.PI) / 180;
    const hdgRad = (next.heading * Math.PI) / 180;
    const alongTrackWind = weather.windSpeedKt * Math.cos(windToRad - hdgRad) * 0.25;
    effectiveGroundSpeed = Math.max(80, next.speed + alongTrackWind);
  }
  next.groundSpeed = Number(effectiveGroundSpeed.toFixed(1));

  const moveDistNM = (effectiveGroundSpeed * dtSec) / 3600;
  const headingRad = (next.heading * Math.PI) / 180;
  next.position.x += moveDistNM * Math.sin(headingRad);
  next.position.y += moveDistNM * Math.cos(headingRad);

  // 8. 检测是否误入 CB 雷雨云团回波区 (仅当 weather.cells 非空时生效)
  if (weather && weather.cells && weather.cells.length > 0) {
    const wasInHazard = next.inWeatherHazard;
    const hitCell = weather.cells.find(
      (cell) => distanceNM(next.position, cell.position) <= cell.radiusNM
    );
    next.inWeatherHazard = Boolean(hitCell);
    if (!wasInHazard && hitCell) {
      events.push({
        type: 'WEATHER_HAZARD',
        aircraftId: next.id,
        callsign: next.callsign,
        detailEn: `WARNING: ${next.callsign} ENTERED SEVERE CB WEATHER CELL (${hitCell.name})! REQUESTING IMMEDIATE VECTOR AROUND WEATHER!`,
        detailCn: `⚡ 危险雷雨告警：${next.callsign} 误入强雷雨积雨云区 (${hitCell.name}) 遭遇颠簸！请立即拖拽航向引导绕飞！`,
      });
    }
  } else {
    next.inWeatherHazard = false;
  }

  // 9. 检测是否闯入机场周边禁航区 / 限高区 (仅当 enableRestrictedZones === true 时生效)
  if (enableRestrictedZones && airport.restrictedZones && airport.restrictedZones.length > 0) {
    const wasInRestricted = Boolean(next.inRestrictedZone);
    const hitZone = airport.restrictedZones.find(
      (z) =>
        distanceNM(next.position, z.center) <= z.radiusNM &&
        next.altitude < z.maxAltitudeFt
    );
    next.inRestrictedZone = Boolean(hitZone);
    if (!wasInRestricted && hitZone) {
      events.push({
        type: 'RESTRICTED_ZONE_INTRUSION',
        aircraftId: next.id,
        callsign: next.callsign,
        detailEn: `AIRSPACE INFRINGEMENT: ${next.callsign} ENTERED RESTRICTED ZONE ${hitZone.id} (${hitZone.nameEn}) BELOW ${formatAltitudeSpeechEn(hitZone.maxAltitudeFt, altitudeUnit)}!`,
        detailCn: `🚨 禁航区侵入告警：${next.callsign} 低于 ${formatAltitudeSpeechCn(hitZone.maxAltitudeFt, altitudeUnit)} 闯入【${hitZone.nameCn}】！请立即转向脱离或爬升至 ${formatAltitudeSpeechCn(hitZone.maxAltitudeFt, altitudeUnit)} 以上！`,
      });
    }
  } else {
    next.inRestrictedZone = false;
  }

  next.trailTimer += dtSec;
  if (next.trailTimer >= 4.0) {
    next.trailTimer = 0;
    next.trail = [
      ...next.trail.slice(-9),
      { x: Number(next.position.x.toFixed(3)), y: Number(next.position.y.toFixed(3)) },
    ];
  }

  if (
    next.phase === 'GO_AROUND' &&
    next.altitude >= 2400 &&
    distanceNM(next.position, rwy.threshold) >= 2.0
  ) {
    next.phase = 'ARRIVING';
  }

  if (
    next.category === 'DEPARTURE' &&
    (next.phase === 'INITIAL_CLIMB' || next.phase === 'DEPARTING')
  ) {
    const distFromCenter = Math.hypot(next.position.x, next.position.y);
    let nearExit = false;
    for (const exitId of airport.departureExits) {
      const wp = airport.waypoints.find((w) => w.id === exitId);
      if (wp && distanceNM(next.position, wp.position) <= 5.0) {
        nearExit = true;
        break;
      }
    }
    const wasReady = next.canHandoff;
    next.canHandoff =
      (next.altitude >= 4800 && distFromCenter >= 7.0) ||
      (nearExit && next.altitude >= 3600) ||
      (distFromCenter >= airport.airspaceRadiusNM - 5 && next.altitude >= 3600);
    if (!wasReady && next.canHandoff) {
      events.push({
        type: 'HANDOFF_READY',
        aircraftId: next.id,
        callsign: next.callsign,
        detailEn: `${next.callsign} PASSING ${formatAltitudeSpeechEn(next.altitude, altitudeUnit)}, READY FOR CENTER HANDOFF.`,
        detailCn: `${next.callsign} 高度已达 ${formatAltitudeSpeechCn(next.altitude, altitudeUnit)}，可移交区域管制中心 (HANDOFF)。`,
      });
    }

    if (next.canHandoff && distFromCenter >= airport.airspaceRadiusNM - 2) {
      next.phase = 'HANDED_OFF';
      events.push({
        type: 'HANDED_OFF',
        aircraftId: next.id,
        callsign: next.callsign,
        detailEn: `${next.callsign} CONTACTING CENTER 125.8, GOOD DAY!`,
        detailCn: `${next.callsign} 已自动移交区调 125.8，再见！`,
      });
      return { aircraft: next, events };
    }
  }

  const distFromAirport = Math.hypot(next.position.x, next.position.y);
  if (distFromAirport > airport.airspaceRadiusNM + 3.5) {
    next.phase = 'EXITED_AIRSPACE';
    events.push({
      type: 'EXITED_AIRSPACE',
      aircraftId: next.id,
      callsign: next.callsign,
      detailEn: `WARNING: ${next.callsign} LEFT TERMINAL AIRSPACE WITHOUT CLEARANCE!`,
      detailCn: `🚨 越界告警：${next.callsign} 未经引导飞出终端管制空域边界！`,
    });
  }

  return { aircraft: next, events };
}

function triggerGoAround(
  ac: Aircraft,
  rwy: RunwayConfig,
  events: SimulationEvent[],
  reason: string,
  altitudeUnit: AltitudeUnit = 'METRIC'
): void {
  ac.phase = 'GO_AROUND';
  ac.clearedApproach = false;
  ac.clearedToLand = false;
  ac.directWaypointId = null;
  ac.procedureLegs = [];
  ac.activeProcedureId = null;
  ac.targetHeading = rwy.heading;
  ac.targetAltitude = 3000;
  ac.targetSpeed = 200;
  ac.lastCommandText = 'GO AROUND';

  events.push({
    type: 'GO_AROUND',
    aircraftId: ac.id,
    callsign: ac.callsign,
    runwayId: rwy.id,
    detailEn: `${ac.callsign} GOING AROUND RWY ${rwy.id}! (${reason}) CLIMBING TO ${formatAltitudeSpeechEn(3000, altitudeUnit)}.`,
    detailCn: `${ac.callsign} 正在执行 ${rwy.id} 复飞！(${reason}) 爬升至标准复飞层 ${formatAltitudeSpeechCn(3000, altitudeUnit)}。`,
  });
}
