import { formatPilotReadback } from './radiotelephony';
import {
  Aircraft,
  AirportConfig,
  AltitudeUnit,
  RunwayId,
  RunwayWakeRecord,
  TurnDirection,
} from '../aircraft/types';
import {
  bearingTo,
  checkIlsConditions,
  computeRunwayLocalizerGeometry,
  distanceNM,
  formatAltitudeSpeechCn,
  formatAltitudeSpeechEn,
  formatAltitudeValue,
  formatHeading,
  getRunwayConfig,
  normalizeHeading,
  shortestHeadingDelta,
} from '../aircraft/physics';
import {
  AIRCRAFT_MODELS,
  HARBOR_AIRPORT,
  ICAO_WAKE_DEPARTURE_MINIMA_SEC,
} from '../airport/harborAirport';

export type ATCCommandType =
  | 'HDG'
  | 'ALT'
  | 'SPD'
  | 'DCT'
  | 'STAR'
  | 'SID'
  | 'HOLD'
  | 'ASSIGN_RUNWAY'
  | 'CLEARED_ILS'
  | 'CLEARED_LAND'
  | 'VECTOR_TO_FINAL'
  | 'LINE_UP_WAIT'
  | 'CLEARED_TAKEOFF'
  | 'GO_AROUND'
  | 'HANDOFF'
  | 'BREAK_OUT'
  | 'CROSS_RUNWAY'
  | 'SQUAWK_IDENT';

export interface ATCCommand {
  type: ATCCommandType;
  heading?: number;
  turnDirection?: TurnDirection;
  altitude?: number;
  speed?: number;
  waypointId?: string;
  procedureId?: string;
  runwayId?: RunwayId | '09' | '27';
}

export interface CommandExecutionResult {
  accepted: boolean;
  updatedAircraft: Aircraft;
  atcMessageEn: string;
  atcMessageCn: string;
  pilotReadbackEn: string;
  pilotReadbackCn: string;
  runwayConflictTriggered?: boolean;
  wakeViolationTriggered?: boolean;
  handoffCompleted?: boolean;
  crossingLandingCompleted?: boolean;
  takeoffRunwayUsed?: RunwayId;
}

/**
 * ICAO Doc 4444 §4.9.2 标准无线电呼号生成
 */
export function getRadioCallsign(ac: Aircraft): string {
  const numPart = ac.callsign.replace(/^[A-Z]{3}/, '');
  const wakeSuffix =
    ac.wakeCategory === 'SUPER'
      ? ' SUPER'
      : ac.wakeCategory === 'HEAVY'
      ? ' HEAVY'
      : '';
  const maydayPrefix =
    ac.emergencyType === 'SQUAWK_7700_ENGINE' || ac.emergencyType === 'SQUAWK_7700_FUEL'
      ? 'MAYDAY '
      : '';
  return `${maydayPrefix}${ac.airlineName} ${numPart}${wakeSuffix}`;
}

export function getPhysicalRunwayStripKey(
  rwyId: RunwayId,
  airport: AirportConfig = HARBOR_AIRPORT
): string {
  const rwy = airport.runways[rwyId];
  if (rwy && rwy.physicalStripId) return rwy.physicalStripId;
  return rwyId === '09L' || rwyId === '27R' ? 'ZSHB_NORTH' : 'ZSHB_SOUTH';
}

export function checkDepartureWakeTimer(
  ac: Aircraft,
  rwyId: RunwayId,
  simTimeSec: number,
  runwayWakeMap?: Record<string, RunwayWakeRecord>,
  airport: AirportConfig = HARBOR_AIRPORT
): {
  blocked: boolean;
  remainingSec: number;
  leaderCallsign?: string;
  leaderWake?: string;
} {
  if (!runwayWakeMap) return { blocked: false, remainingSec: 0 };
  const stripKey = getPhysicalRunwayStripKey(rwyId, airport);
  const record = runwayWakeMap[stripKey];
  if (!record) return { blocked: false, remainingSec: 0 };

  const requiredSec =
    ICAO_WAKE_DEPARTURE_MINIMA_SEC[record.lastWakeCategory]?.[ac.wakeCategory] ?? 0;
  if (requiredSec <= 0) return { blocked: false, remainingSec: 0 };

  const elapsed = simTimeSec - record.lastTakeoffTimeSec;
  if (elapsed < requiredSec) {
    return {
      blocked: true,
      remainingSec: Math.ceil(requiredSec - elapsed),
      leaderCallsign: record.lastCallsign,
      leaderWake: record.lastWakeCategory,
    };
  }
  return { blocked: false, remainingSec: 0 };
}

/** Conservative game protection for entering/crossing an active runway. */
function runwayBlockingTraffic(ac: Aircraft, runwayId: RunwayId, airport: AirportConfig, aircraft: Aircraft[]): Aircraft | undefined {
  const strip = getPhysicalRunwayStripKey(runwayId, airport);
  return aircraft.find((other) => {
    if (other.id === ac.id) return false;
    const sameStrip = getPhysicalRunwayStripKey(other.assignedRunway, airport) === strip;
    const intersects = airport.layoutType === 'INTERSECTING';
    if (!sameStrip && !intersects) return false;
    if (['TAKEOFF_ROLL', 'LANDING_ROLL', 'LINE_UP_WAIT'].includes(other.phase)) return true;
    if (other.phase !== 'FINAL_APPROACH') return false;
    const geometry = computeRunwayLocalizerGeometry(other.position, getRunwayConfig(airport, other.assignedRunway));
    return geometry.axialDistNM >= 0 && geometry.axialDistNM <= 3 && geometry.crossTrackErrorNM <= 0.5;
  });
}

/**
 * 对指定飞机执行一条管制指令，返回更新后的飞机状态与标准陆空通话记录
 */
function executeATCCommandRaw(
  ac: Aircraft,
  cmd: ATCCommand,
  airport: AirportConfig,
  allAircraft: Aircraft[],
  simTimeSec: number = 0,
  runwayWakeMap?: Record<string, RunwayWakeRecord>,
  altitudeUnit: AltitudeUnit = 'METRIC'
): CommandExecutionResult {
  const radioName = getRadioCallsign(ac);
  const spec = AIRCRAFT_MODELS[ac.model] || AIRCRAFT_MODELS.A320;
  const next: Aircraft = {
    ...ac,
    position: { ...ac.position },
    trail: [...ac.trail],
    procedureLegs: ac.procedureLegs ? [...ac.procedureLegs] : [],
    holdState: ac.holdState
      ? { ...ac.holdState, center: { ...ac.holdState.center } }
      : null,
  };

  // 7600 无线电通信失效 (NORDO) 保护
  if (ac.emergencyType === 'SQUAWK_7600_NORDO' && cmd.type !== 'SQUAWK_IDENT') {
    return {
      accepted: false,
      updatedAircraft: ac,
      atcMessageEn: `${ac.callsign}, RADIO CHECK ON 119.75.`,
      atcMessageCn: `${ac.callsign}，119.75 信号检查。`,
      pilotReadbackEn: `[NO RADIO RESPONSE - SQUAWK 7600 NORDO. AIRCRAFT PROCEEDING AUTONOMOUSLY TO ILS RWY ${ac.assignedRunway}]`,
      pilotReadbackCn: `[无无线电回应 — 应答机 7600 通信失效！机组正按无线电失效程序自主建立 ${ac.assignedRunway} 盲降，请清空航道避让]`,
    };
  }

  // 二次雷达应答机识别 (SQUAWK IDENT)
  if (cmd.type === 'SQUAWK_IDENT') {
    next.radarIdentified = true;
    next.identFlashTimerSec = 8.0;
    next.lastCommandText = `IDENT ${next.squawkCode}`;
    return {
      accepted: true,
      updatedAircraft: next,
      atcMessageEn: `${ac.callsign}, SQUAWK ${next.squawkCode} AND IDENT.`,
      atcMessageCn: `${ac.callsign}，应答机编码 ${next.squawkCode}，请按识别键 (IDENT)。`,
      pilotReadbackEn: `${radioName}, SQUAWKING ${next.squawkCode} WITH IDENT.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，应答机 ${next.squawkCode} 已按识别，建立雷达联系。`,
    };
  }

  // 地面跑道穿越许可 (CROSS_RUNWAY)
  if (cmd.type === 'CROSS_RUNWAY') {
    const crossRwy = next.crossingRunwayId || airport.primaryFlowRunways.departure;
    if (ac.phase !== 'HOLD_CROSSING') {
      return {
        accepted: false,
        updatedAircraft: ac,
        atcMessageEn: `${ac.callsign}, CROSS RUNWAY ${crossRwy}.`,
        atcMessageCn: `${ac.callsign}，准许穿越跑道 ${crossRwy}。`,
        pilotReadbackEn: `${radioName}, NEGATIVE, NOT HOLDING FOR RUNWAY CROSSING.`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，当前不在跑道等待穿越点。`,
      };
    }

    const occupying = runwayBlockingTraffic(ac, crossRwy, airport, allAircraft);
    if (occupying) {
      return {
        accepted: false,
        updatedAircraft: ac,
        runwayConflictTriggered: true,
        atcMessageEn: `${ac.callsign}, CROSS RUNWAY ${crossRwy}.`,
        atcMessageCn: `${ac.callsign}，可以穿越跑道 ${crossRwy}。`,
        pilotReadbackEn: `${radioName}, UNABLE TO CROSS RUNWAY ${crossRwy}, TRAFFIC ${occupying.callsign}, HOLDING SHORT.`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，无法穿越跑道 ${crossRwy}，冲突航班 ${occupying.callsign}，保持跑道外等待。`,
      };
    }

    next.phase = 'LANDED';
    next.crossingRunwayId = null;
    next.lastCommandText = `CROSSED ${crossRwy}`;
    return {
      accepted: true,
      updatedAircraft: next,
      crossingLandingCompleted: true,
      atcMessageEn: `${ac.callsign}, CROSS RUNWAY ${crossRwy}, CONTACT GROUND 121.9 ON THE OTHER SIDE.`,
      atcMessageCn: `${ac.callsign}，可以穿越跑道 ${crossRwy}，脱离后联系地面 121.9。`,
      pilotReadbackEn: `${radioName}, CROSSING RUNWAY ${crossRwy}, CONTACT GROUND 121.9 AFTER VACATING.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，正在穿越跑道 ${crossRwy}，脱离后联系地面 121.9。`,
    };
  }

  // 平行或交叉跑道五边防侵入紧急脱离指令 (BREAK_OUT)
  if (cmd.type === 'BREAK_OUT') {
    const rwy = getRunwayConfig(airport, ac.assignedRunway);
    const rad = (rwy.heading * Math.PI) / 180;
    const rightNormalX = Math.cos(rad);
    const rightNormalY = -Math.sin(rad);
    const sideDot = rwy.threshold.x * rightNormalX + rwy.threshold.y * rightNormalY;
    const turnDir: TurnDirection = sideDot >= 0 ? 'RIGHT' : 'LEFT';
    const rawBreakoutHdg = normalizeHeading(
      rwy.heading + (turnDir === 'RIGHT' ? 90 : -90)
    );
    const displayHdg = rawBreakoutHdg === 0 ? 360 : Math.round(rawBreakoutHdg);

    next.phase = 'ARRIVING';
    next.clearedApproach = false;
    next.directWaypointId = null;
    next.procedureLegs = [];
    next.activeProcedureId = null;
    next.targetHeading = rawBreakoutHdg;
    next.turnDirection = turnDir;
    next.targetAltitude = 4000;
    next.targetSpeed = 200;
    next.lastCommandText = `BREAKOUT H${formatHeading(displayHdg)}`;

    return {
      accepted: true,
      updatedAircraft: next,
      atcMessageEn: `${ac.callsign}, TRAFFIC ALERT! BREAK OUT IMMEDIATELY, TURN ${turnDir} HEADING ${formatHeading(displayHdg)}, CLIMB AND MAINTAIN ${formatAltitudeSpeechEn(4000, altitudeUnit)}!`,
      atcMessageCn: `${ac.callsign}，五边冲突告警！立即终止进近脱离，${turnDir === 'LEFT' ? '左转' : '右转'}航向 ${formatHeading(displayHdg)}，爬升保持 ${formatAltitudeSpeechCn(4000, altitudeUnit)}！`,
      pilotReadbackEn: `${radioName}, BREAKING OUT! TURNING ${turnDir} HEADING ${formatHeading(displayHdg)}, CLIMBING TO ${formatAltitudeSpeechEn(4000, altitudeUnit)}!`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，收到紧急脱离！${turnDir === 'LEFT' ? '左转' : '右转'}航向 ${formatHeading(displayHdg)}，爬升至 ${formatAltitudeSpeechCn(4000, altitudeUnit)}！`,
    };
  }

  // 0. 切换分配跑道 (ASSIGN_RUNWAY)
  if (cmd.type === 'ASSIGN_RUNWAY' && cmd.runwayId) {
    const rwy = getRunwayConfig(airport, cmd.runwayId);
    next.assignedRunway = rwy.id;
    next.clearedApproach = false;
    if (next.phase === 'HOLDING_GROUND' || next.phase === 'LINE_UP_WAIT') {
      next.phase = 'HOLDING_GROUND';
      next.position = { ...rwy.holdingPoint };
      next.heading = rwy.heading;
      next.targetHeading = rwy.heading;
    }
    next.lastCommandText = `EXP RWY ${rwy.id}`;
    return {
      accepted: true,
      updatedAircraft: next,
      atcMessageEn: `${ac.callsign}, EXPECT RUNWAY ${rwy.id}.`,
      atcMessageCn: `${ac.callsign}，预计使用跑道 ${rwy.id}。`,
      pilotReadbackEn: `${radioName}, WILCO, EXPECTING RUNWAY ${rwy.id}.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，收到，预计跑道 ${rwy.id}。`,
    };
  }

  // 1A. 进跑道等待指令 (LINE UP AND WAIT / LUAW)
  if (cmd.type === 'LINE_UP_WAIT') {
    const rwy = getRunwayConfig(airport, cmd.runwayId || ac.assignedRunway);
    if (ac.phase !== 'HOLDING_GROUND') {
      return {
        accepted: false,
        updatedAircraft: ac,
        atcMessageEn: `${ac.callsign}, RUNWAY ${rwy.id}, LINE UP AND WAIT.`,
        atcMessageCn: `${ac.callsign}，跑道 ${rwy.id}，进跑道等待。`,
        pilotReadbackEn: `${radioName}, NEGATIVE, ALREADY ON RUNWAY OR AIRBORNE.`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，已在跑道内或已升空。`,
      };
    }

    const occupyingAc = runwayBlockingTraffic(ac, rwy.id, airport, allAircraft);
    if (occupyingAc) {
      return {
        accepted: false,
        updatedAircraft: ac,
        atcMessageEn: `${ac.callsign}, RUNWAY ${rwy.id}, LINE UP AND WAIT.`,
        atcMessageCn: `${ac.callsign}，跑道 ${rwy.id}，进跑道等待。`,
        pilotReadbackEn: `${radioName}, UNABLE TO LINE UP, ${occupyingAc.callsign} IS ON RUNWAY ${rwy.id}. HOLDING SHORT.`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，跑道 ${rwy.id} 已被 ${occupyingAc.callsign} 占用，保持跑道外等待。`,
      };
    }

    next.assignedRunway = rwy.id;
    next.phase = 'LINE_UP_WAIT';
    next.position = { ...rwy.threshold };
    next.heading = rwy.heading;
    next.targetHeading = rwy.heading;
    next.lastCommandText = `LUAW RWY ${rwy.id}`;
    return {
      accepted: true,
      updatedAircraft: next,
      atcMessageEn: `${ac.callsign}, RUNWAY ${rwy.id}, LINE UP AND WAIT.`,
      atcMessageCn: `${ac.callsign}，跑道 ${rwy.id}，进跑道对正等待 (LINE UP AND WAIT)。`,
      pilotReadbackEn: `${radioName}, LINING UP AND WAITING RUNWAY ${rwy.id}.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，进跑道 ${rwy.id} 等待。`,
    };
  }

  // 1B. 起飞许可 (CLEARED TAKEOFF)
  if (cmd.type === 'CLEARED_TAKEOFF') {
    const rwy = getRunwayConfig(
      airport,
      cmd.runwayId && cmd.runwayId !== '09' ? cmd.runwayId : ac.assignedRunway
    );
    if (ac.phase !== 'HOLDING_GROUND' && ac.phase !== 'LINE_UP_WAIT') {
      return {
        accepted: false,
        updatedAircraft: ac,
        atcMessageEn: `${ac.callsign}, CLEARED FOR TAKEOFF RWY ${rwy.id}.`,
        atcMessageCn: `${ac.callsign}，跑道 ${rwy.id} 可以起飞。`,
        pilotReadbackEn: `${radioName}, NEGATIVE, WE ARE ALREADY AIRBORNE.`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，无法执行，我们已在空中。`,
      };
    }

    const targetStrip = getPhysicalRunwayStripKey(rwy.id, airport);
    const occupyingAc = allAircraft.find(
      (other) =>
        other.id !== ac.id &&
        (other.phase === 'TAKEOFF_ROLL' || other.phase === 'LANDING_ROLL' || other.phase === 'LINE_UP_WAIT') &&
        (getPhysicalRunwayStripKey(other.assignedRunway, airport) === targetStrip ||
          airport.layoutType === 'INTERSECTING')
    );

    const shortFinalAc = allAircraft.find((other) => {
      if (other.id === ac.id || other.phase !== 'FINAL_APPROACH') return false;
      const sameOrIntersecting =
        getPhysicalRunwayStripKey(other.assignedRunway, airport) === targetStrip ||
        airport.layoutType === 'INTERSECTING';
      if (!sameOrIntersecting) return false;
      const otherRwy = getRunwayConfig(airport, other.assignedRunway);
      const geom = computeRunwayLocalizerGeometry(other.position, otherRwy);
      return geom.axialDistNM <= 3.2 && geom.axialDistNM >= -0.5;
    });

    if (occupyingAc || shortFinalAc) {
      const conflictCallsign = occupyingAc
        ? occupyingAc.callsign
        : shortFinalAc!.callsign;
      return {
        accepted: false,
        updatedAircraft: ac,
        runwayConflictTriggered: true,
        atcMessageEn: `${ac.callsign}, CLEARED FOR TAKEOFF RWY ${rwy.id}.`,
        atcMessageCn: `${ac.callsign}，跑道 ${rwy.id} 可以起飞。`,
        pilotReadbackEn: `${radioName}, UNABLE TAKEOFF! RUNWAY ${rwy.id} CONFLICT WITH ${conflictCallsign}! HOLDING SHORT.`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，拒绝起飞！跑道存在冲突航班 (${conflictCallsign})，保持跑道外等待！`,
      };
    }

    const wakeCheck = checkDepartureWakeTimer(
      ac,
      rwy.id,
      simTimeSec,
      runwayWakeMap,
      airport
    );
    if (wakeCheck.blocked) {
      return {
        accepted: false,
        updatedAircraft: ac,
        wakeViolationTriggered: true,
        atcMessageEn: `${ac.callsign}, CLEARED FOR TAKEOFF RWY ${rwy.id}.`,
        atcMessageCn: `${ac.callsign}，跑道 ${rwy.id} 可以起飞。`,
        pilotReadbackEn: `${radioName}, UNABLE IMMEDIATE TAKEOFF, WAKE TURBULENCE SEPARATION BEHIND ${wakeCheck.leaderCallsign} (${wakeCheck.leaderWake}), HOLDING ${wakeCheck.remainingSec} SECONDS PER ICAO DOC 4444.`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，受前机 ${wakeCheck.leaderCallsign} (${wakeCheck.leaderWake}) 尾流间隔限制，按空管规范还需等待 ${wakeCheck.remainingSec} 秒！`,
      };
    }

    next.assignedRunway = rwy.id;
    next.clearedTakeoff = true;
    next.phase = 'TAKEOFF_ROLL';
    next.position = { ...rwy.threshold };
    next.heading = rwy.heading;
    next.targetHeading = rwy.heading;
    if (next.targetAltitude < 3000) {
      next.targetAltitude = 4000;
    }
    next.targetSpeed = Math.min(230, spec.cruiseSpeed);
    next.lastCommandText = `CTO RWY ${rwy.id}`;

    const hdgStr = formatHeading(rwy.heading);
    return {
      accepted: true,
      updatedAircraft: next,
      takeoffRunwayUsed: rwy.id,
      atcMessageEn: `${ac.callsign}, RUNWAY ${rwy.id}, CLEARED FOR TAKEOFF, FLY RUNWAY HEADING ${hdgStr}, CLIMB AND MAINTAIN ${formatAltitudeSpeechEn(next.targetAltitude, altitudeUnit)}.`,
      atcMessageCn: `${ac.callsign}，跑道 ${rwy.id} 可以起飞，保持跑道航向 ${hdgStr}，上升并保持 ${formatAltitudeSpeechCn(next.targetAltitude, altitudeUnit)}。`,
      pilotReadbackEn: `${radioName}, CLEARED FOR TAKEOFF RUNWAY ${rwy.id}, RUNWAY HEADING ${hdgStr}, CLIMB AND MAINTAIN ${formatAltitudeSpeechEn(next.targetAltitude, altitudeUnit)}.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，跑道 ${rwy.id} 可以起飞，保持航向 ${hdgStr}，上升至 ${formatAltitudeSpeechCn(next.targetAltitude, altitudeUnit)}。`,
    };
  }

  // 2. 标准进场 / 离场程序指令 (STAR / SID) — 支持离港飞机在地面等待时提前预置 SID！
  if ((cmd.type === 'STAR' || cmd.type === 'SID') && cmd.procedureId) {
    const proc = airport.procedures.find((p) => p.id === cmd.procedureId);
    if (!proc || proc.legs.length === 0) {
      return {
        accepted: false,
        updatedAircraft: ac,
        atcMessageEn: `${ac.callsign}, CLEARED ${cmd.procedureId}.`,
        atcMessageCn: `${ac.callsign}，许可执行 ${cmd.procedureId} 程序。`,
        pilotReadbackEn: `${radioName}, UNABLE, PROCEDURE ${cmd.procedureId} NOT IN FMS DATABASE.`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，未找到程序 ${cmd.procedureId}。`,
      };
    }

    // 若 STAR 指定了目标跑道（如羽田 ARLNS-2B 对应 RWY 22），自动同步更新目标跑道
    if (proc.type === 'STAR' && proc.targetRunway) {
      next.assignedRunway = proc.targetRunway;
    }

    // 智能选择 STAR 起始航段：若飞机已经飞过了第 1 个过渡点（距离后续航段明显更近），直接从最近的前方航段切入，避免倒飞绕远！
    let startIdx = 0;
    if (proc.type === 'STAR' && proc.legs.length >= 2) {
      const rwyCfg = getRunwayConfig(airport, next.assignedRunway);
      const acDistToRwy = distanceNM(ac.position, rwyCfg.threshold);
      for (let i = 0; i < proc.legs.length - 1; i++) {
        const wpCur = airport.waypoints.find((w) => w.id === proc.legs[i].waypointId);
        const wpNext = airport.waypoints.find((w) => w.id === proc.legs[i + 1].waypointId);
        if (wpCur && wpNext) {
          const wpCurDistToRwy = distanceNM(wpCur.position, rwyCfg.threshold);
          const distToCur = distanceNM(ac.position, wpCur.position);
          const distToNext = distanceNM(ac.position, wpNext.position);
          if (acDistToRwy < wpCurDistToRwy - 1.5 && distToNext < distToCur) {
            startIdx = i + 1;
          }
        }
      }
    }

    const activeLegs = proc.legs.slice(startIdx).map((l) => ({ ...l }));
    const firstLeg = activeLegs[0];
    const firstWp = airport.waypoints.find((w) => w.id === firstLeg.waypointId);

    next.activeProcedureId = proc.id;
    next.procedureLegs = activeLegs;
    next.holdState = null;

    if (ac.phase === 'HOLDING_GROUND' || ac.phase === 'LINE_UP_WAIT') {
      // 地面预位 SID：起飞后自动导航至该 SID 航路点
      next.assignedExitId = firstLeg.waypointId;
      if (firstLeg.targetAltitude) {
        next.targetAltitude = firstLeg.targetAltitude;
      }
      next.lastCommandText = `PRE-SID ${proc.id}`;
      return {
        accepted: true,
        updatedAircraft: next,
        atcMessageEn: `${ac.callsign}, CLEARED ${proc.id} DEPARTURE, CLIMB VIA SID TO ${formatAltitudeSpeechEn(next.targetAltitude, altitudeUnit)}.`,
        atcMessageCn: `${ac.callsign}，地面预位 ${proc.id} 标准离场程序，起飞后直飞 ${firstLeg.waypointId} 并爬升至 ${formatAltitudeSpeechCn(next.targetAltitude, altitudeUnit)}。`,
        pilotReadbackEn: `${radioName}, CLEARED ${proc.id} DEPARTURE, CLIMB VIA SID TO ${formatAltitudeSpeechEn(next.targetAltitude, altitudeUnit)} AFTER DEPARTURE.`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，收到 ${proc.id} 离场程序，起飞后爬升至 ${formatAltitudeSpeechCn(next.targetAltitude, altitudeUnit)}。`,
      };
    }

    next.directWaypointId = firstLeg.waypointId;
    if (proc.type === 'STAR') {
      next.clearedApproach = true;
    } else if (proc.type === 'SID') {
      next.assignedExitId = proc.legs[proc.legs.length - 1].waypointId;
    }

    if (next.phase === 'HOLDING_AIR' || next.phase === 'INTERCEPTING' || next.phase === 'FINAL_APPROACH') {
      next.phase = next.category === 'ARRIVAL' ? 'ARRIVING' : 'DEPARTING';
    }
    if (firstWp) {
      next.targetHeading = bearingTo(next.position, firstWp.position);
      next.turnDirection = 'AUTO';
    }
    if (firstLeg.targetAltitude && !next.tcasRaActive) {
      next.targetAltitude = firstLeg.targetAltitude;
    }
    if (firstLeg.maxSpeed) {
      next.targetSpeed = Math.min(next.targetSpeed, firstLeg.maxSpeed);
    }
    next.lastCommandText = `${proc.type} ${proc.id}`;

    const typeLabel = proc.type === 'STAR' ? 'ARRIVAL' : 'DEPARTURE';
    return {
      accepted: true,
      updatedAircraft: next,
      atcMessageEn: `${ac.callsign}, CLEARED ${proc.id} ${typeLabel}, PROCEED DIRECT ${firstLeg.waypointId}, CROSS AT ${formatAltitudeSpeechEn(next.targetAltitude, altitudeUnit)}, CLEARED ILS RWY ${next.assignedRunway}.`,
      atcMessageCn: `${ac.callsign}，准许按 ${proc.id} 标准程序飞行，直飞 ${firstLeg.waypointId}，保持高度 ${formatAltitudeSpeechCn(next.targetAltitude, altitudeUnit)}${proc.type === 'STAR' ? `，并预位 ${next.assignedRunway} 盲降` : ''}。`,
      pilotReadbackEn: `${radioName}, CLEARED ${proc.id} ${typeLabel}, DIRECT ${firstLeg.waypointId}, MAINTAIN ${formatAltitudeSpeechEn(next.targetAltitude, altitudeUnit)}.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，可以执行 ${proc.id} 程序，直飞 ${firstLeg.waypointId}，保持 ${formatAltitudeSpeechCn(next.targetAltitude, altitudeUnit)}。`,
    };
  }

  if (ac.phase === 'HOLDING_GROUND' || ac.phase === 'LINE_UP_WAIT') {
    return {
      accepted: false,
      updatedAircraft: ac,
      atcMessageEn: `${ac.callsign}, STANDBY.`,
      atcMessageCn: `${ac.callsign}，地面等待中，请先发布起飞许可 (CLEARED FOR TAKEOFF)。`,
      pilotReadbackEn: `${radioName}, HOLDING SHORT RUNWAY ${ac.assignedRunway}, READY FOR DEPARTURE.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，在跑道 ${ac.assignedRunway} 等待起飞许可。`,
    };
  }

  // 1C. 一键雷达引导切入五边盲降 (VECTOR_TO_FINAL — 双阶段全向捕获，确保任意位置 100% 切入五边并建立盲降！)
  if (cmd.type === 'VECTOR_TO_FINAL') {
    if (ac.category !== 'ARRIVAL') {
      return {
        accepted: false,
        updatedAircraft: ac,
        atcMessageEn: `${ac.callsign}, STANDBY.`,
        atcMessageCn: `${ac.callsign}，离场航班无需切入五边盲降。`,
        pilotReadbackEn: `${radioName}, WE ARE A DEPARTURE FLIGHT.`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，我们是离港航班。`,
      };
    }

    const rwy = getRunwayConfig(airport, cmd.runwayId || ac.assignedRunway);
    const geom = computeRunwayLocalizerGeometry(ac.position, rwy);

    let aimPt = {
      x: rwy.threshold.x - 10.5 * geom.forwardUnit.x,
      y: rwy.threshold.y - 10.5 * geom.forwardUnit.y,
    };
    let targetAltFt = 3000;

    if (geom.axialDistNM >= 5.2 && geom.crossTrackErrorNM <= 3.2) {
      const lookaheadNM = Math.max(2.0, Math.min(4.2, geom.crossTrackErrorNM * 1.3 + 1.6));
      const aimAxial = Math.max(1.5, geom.axialDistNM - lookaheadNM);
      aimPt = {
        x: rwy.threshold.x - aimAxial * geom.forwardUnit.x,
        y: rwy.threshold.y - aimAxial * geom.forwardUnit.y,
      };
      targetAltFt = geom.axialDistNM <= 9.5 ? 2000 : 3000;
    }

    const targetHdg = Math.round(bearingTo(ac.position, aimPt));
    const hdgStr = formatHeading(targetHdg === 0 ? 360 : targetHdg);
    const delta = shortestHeadingDelta(ac.heading, targetHdg);
    const turnDir: TurnDirection = delta < 0 ? 'LEFT' : 'RIGHT';

    next.assignedRunway = rwy.id;
    next.directWaypointId = null;
    next.procedureLegs = [];
    next.activeProcedureId = null;
    next.holdState = null;
    next.targetHeading = targetHdg;
    next.turnDirection = turnDir;
    if (!next.tcasRaActive) {
      next.targetAltitude = Math.min(next.targetAltitude, targetAltFt);
    }
    next.targetSpeed = Math.min(next.targetSpeed, 180);
    next.clearedApproach = true;

    const ilsCheckNow = checkIlsConditions(next, airport, rwy.id, altitudeUnit);
    next.phase = ilsCheckNow.canLockLocalizer ? 'FINAL_APPROACH' : 'INTERCEPTING';
    next.lastCommandText =
      next.phase === 'FINAL_APPROACH' ? `ILS RWY ${rwy.id}` : `VEC ILS ${rwy.id}`;

    const turnCn = turnDir === 'LEFT' ? '左转' : '右转';
    return {
      accepted: true,
      updatedAircraft: next,
      atcMessageEn: `${ac.callsign}, TURN ${turnDir} HEADING ${hdgStr}, DESCEND AND MAINTAIN ${formatAltitudeSpeechEn(next.targetAltitude, altitudeUnit)}, REDUCE SPEED TO 180 KNOTS, CLEARED ILS RUNWAY ${rwy.id} APPROACH.`,
      atcMessageCn: `${ac.callsign}，${turnCn}航向 ${hdgStr}，下降并保持 ${formatAltitudeSpeechCn(next.targetAltitude, altitudeUnit)}，减速至 180 节，雷达引导切入跑道 ${rwy.id} ILS 盲降。`,
      pilotReadbackEn: `${radioName}, ${turnDir} HEADING ${hdgStr}, DESCEND AND MAINTAIN ${formatAltitudeSpeechEn(next.targetAltitude, altitudeUnit)}, 180 KNOTS, CLEARED ILS RUNWAY ${rwy.id}.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，${turnCn}航向 ${hdgStr}，下降至 ${formatAltitudeSpeechCn(next.targetAltitude, altitudeUnit)}，正在切入跑道 ${rwy.id} 盲降五边。`,
    };
  }

  // 3. 航向控制 (HDG)
  if (cmd.type === 'HDG' && typeof cmd.heading === 'number') {
    const targetHdg = normalizeHeading(cmd.heading);
    const delta = shortestHeadingDelta(ac.heading, targetHdg);
    const chosenTurn: TurnDirection =
      cmd.turnDirection && cmd.turnDirection !== 'AUTO'
        ? cmd.turnDirection
        : delta < 0
        ? 'LEFT'
        : 'RIGHT';

    next.targetHeading = targetHdg;
    next.turnDirection = chosenTurn;
    next.directWaypointId = null;
    next.procedureLegs = [];
    next.activeProcedureId = null;
    next.holdState = null;
    if (
      next.phase === 'HOLDING_AIR' ||
      next.phase === 'INTERCEPTING' ||
      next.phase === 'FINAL_APPROACH'
    ) {
      next.phase = next.category === 'ARRIVAL' ? 'ARRIVING' : 'DEPARTING';
      next.clearedApproach = false;
    }

    const hdgStr = formatHeading(targetHdg === 0 ? 360 : targetHdg);
    const turnWordEn = chosenTurn === 'LEFT' ? 'TURN LEFT' : 'TURN RIGHT';
    const turnWordCn = chosenTurn === 'LEFT' ? '左转' : '右转';
    next.lastCommandText = `${chosenTurn === 'LEFT' ? 'L' : 'R'} HDG ${hdgStr}`;

    return {
      accepted: true,
      updatedAircraft: next,
      atcMessageEn: `${ac.callsign}, ${turnWordEn} HEADING ${hdgStr}.`,
      atcMessageCn: `${ac.callsign}，${turnWordCn}航向 ${hdgStr}。`,
      pilotReadbackEn: `${radioName}, ${turnWordEn} HEADING ${hdgStr}.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，${turnWordCn}航向 ${hdgStr}。`,
    };
  }

  // 4. 高度控制 (ALT) — 含 TCAS RA 期间管制员高度干预锁定
  if (cmd.type === 'ALT' && typeof cmd.altitude === 'number') {
    if (ac.tcasRaActive) {
      return {
        accepted: false,
        updatedAircraft: ac,
        atcMessageEn: `${ac.callsign}, MAINTAIN ${formatAltitudeSpeechEn(cmd.altitude, altitudeUnit)}.`,
        atcMessageCn: `${ac.callsign}，保持高度 ${formatAltitudeSpeechCn(cmd.altitude, altitudeUnit)}。`,
        pilotReadbackEn: `${radioName}, UNABLE, TCAS RA! FOLLOWING AUTONOMOUS ${ac.tcasRaDirection} MANEUVER PER ICAO DOC 4444!`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，拒绝高度指令！正在执行 TCAS RA 机载防撞决断 (${ac.tcasRaDirection === 'CLIMB' ? '紧急爬升' : '紧急下降'})！`,
      };
    }

    const clampedAlt = Math.max(1500, Math.min(12000, Math.round(cmd.altitude / 100) * 100));
    const isClimbing = clampedAlt >= ac.altitude;
    next.targetAltitude = clampedAlt;
    if (next.phase === 'FINAL_APPROACH') {
      next.phase = 'ARRIVING';
      next.clearedApproach = false;
    }
    next.lastCommandText = `ALT ${formatAltitudeValue(clampedAlt, altitudeUnit)}`;

    const actionEn = isClimbing ? 'CLIMB AND MAINTAIN' : 'DESCEND AND MAINTAIN';
    const actionCn = isClimbing ? '上升并保持' : '下降并保持';

    return {
      accepted: true,
      updatedAircraft: next,
      atcMessageEn: `${ac.callsign}, ${actionEn} ${formatAltitudeSpeechEn(clampedAlt, altitudeUnit)}.`,
      atcMessageCn: `${ac.callsign}，${actionCn} ${formatAltitudeSpeechCn(clampedAlt, altitudeUnit)}。`,
      pilotReadbackEn: `${radioName}, ${actionEn} ${formatAltitudeSpeechEn(clampedAlt, altitudeUnit)}.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，${actionCn} ${formatAltitudeSpeechCn(clampedAlt, altitudeUnit)}。`,
    };
  }

  // 5. 速度控制 (SPD)
  if (cmd.type === 'SPD' && typeof cmd.speed === 'number') {
    const clampedSpd = Math.max(spec.minSpeed, Math.min(250, Math.round(cmd.speed)));
    next.targetSpeed = clampedSpd;
    next.lastCommandText = `SPD ${clampedSpd}`;
    const isSlowing = clampedSpd <= ac.speed;
    const actionEn = isSlowing ? 'REDUCE SPEED TO' : 'INCREASE SPEED TO';
    const actionCn = isSlowing ? '减速至' : '加速至';

    return {
      accepted: true,
      updatedAircraft: next,
      atcMessageEn: `${ac.callsign}, ${actionEn} ${clampedSpd} KNOTS.`,
      atcMessageCn: `${ac.callsign}，${actionCn} ${clampedSpd} 节。`,
      pilotReadbackEn: `${radioName}, ${actionEn} ${clampedSpd} KNOTS.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，速度调整至 ${clampedSpd} 节。`,
    };
  }

  // 6. 直飞航路点 (DCT)
  if (cmd.type === 'DCT' && cmd.waypointId) {
    const wp = airport.waypoints.find(
      (w) => w.id.toUpperCase() === cmd.waypointId!.toUpperCase()
    );
    if (!wp) {
      return {
        accepted: false,
        updatedAircraft: ac,
        atcMessageEn: `${ac.callsign}, PROCEED DIRECT ${cmd.waypointId}.`,
        atcMessageCn: `${ac.callsign}，直飞 ${cmd.waypointId}。`,
        pilotReadbackEn: `${radioName}, UNABLE, WAYPOINT ${cmd.waypointId} NOT FOUND.`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，无法识别航路点 ${cmd.waypointId}。`,
      };
    }

    next.directWaypointId = wp.id;
    next.procedureLegs = [];
    next.activeProcedureId = null;
    next.holdState = null;
    next.targetHeading = bearingTo(next.position, wp.position);
    next.turnDirection = 'AUTO';
    if (next.phase === 'HOLDING_AIR' || next.phase === 'FINAL_APPROACH') {
      next.phase = next.category === 'ARRIVAL' ? 'ARRIVING' : 'DEPARTING';
      next.clearedApproach = false;
    }
    next.lastCommandText = `DCT ${wp.id}`;

    return {
      accepted: true,
      updatedAircraft: next,
      atcMessageEn: `${ac.callsign}, PROCEED DIRECT ${wp.id}.`,
      atcMessageCn: `${ac.callsign}，直飞航路点 ${wp.id}。`,
      pilotReadbackEn: `${radioName}, PROCEEDING DIRECT ${wp.id}.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，直飞 ${wp.id}。`,
    };
  }

  // 7. 空中等待指令 (HOLD)
  if (cmd.type === 'HOLD') {
    const wpId = cmd.waypointId ? cmd.waypointId.toUpperCase() : '';
    const wp = airport.waypoints.find((w) => w.id === wpId);
    const center = wp ? { ...wp.position } : { ...ac.position };
    const holdName = wp ? wp.id : 'PRESENT POSITION';
    const rwy = getRunwayConfig(airport, ac.assignedRunway);

    next.phase = 'HOLDING_AIR';
    next.clearedApproach = false;
    next.directWaypointId = null;
    next.procedureLegs = [];
    next.activeProcedureId = null;
    next.holdState = {
      waypointId: holdName,
      center,
      inboundHeading: rwy.heading,
      legPhase: wp && distanceNM(ac.position, wp.position) > 0.8 ? 'TO_FIX' : 'OUTBOUND_TURN',
      legTimerSec: 0,
    };
    next.targetSpeed = Math.min(next.targetSpeed, 210);
    next.lastCommandText = `HOLD ${holdName}`;

    return {
      accepted: true,
      updatedAircraft: next,
      atcMessageEn: `${ac.callsign}, HOLD AT ${holdName} AS PUBLISHED, RIGHT TURNS, MAINTAIN ${formatAltitudeSpeechEn(next.targetAltitude, altitudeUnit)}.`,
      atcMessageCn: `${ac.callsign}，在 ${holdName} 建立标准右转等待航线，保持高度 ${formatAltitudeSpeechCn(next.targetAltitude, altitudeUnit)}。`,
      pilotReadbackEn: `${radioName}, ENTERING HOLD AT ${holdName}, MAINTAIN ${formatAltitudeSpeechEn(next.targetAltitude, altitudeUnit)}.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，进入 ${holdName} 等待航线，保持 ${formatAltitudeSpeechCn(next.targetAltitude, altitudeUnit)}。`,
    };
  }

  // 8. 进近盲降许可 (CLEARED ILS)
  if (cmd.type === 'CLEARED_LAND') {
    const rwy = getRunwayConfig(airport, cmd.runwayId || ac.assignedRunway);
    const approachReady = ac.category === 'ARRIVAL' && ac.clearedApproach &&
      ['INTERCEPTING', 'FINAL_APPROACH'].includes(ac.phase) && rwy.id === ac.assignedRunway;
    const blocking = allAircraft.find((other) => other.id !== ac.id &&
      (getPhysicalRunwayStripKey(other.assignedRunway, airport) === getPhysicalRunwayStripKey(rwy.id, airport) || airport.layoutType === 'INTERSECTING') &&
      (['TAKEOFF_ROLL', 'LANDING_ROLL', 'LINE_UP_WAIT'].includes(other.phase) ||
        (other.clearedToLand && ['INTERCEPTING', 'FINAL_APPROACH'].includes(other.phase))));
    const accepted = approachReady && !blocking;
    if (accepted) { next.clearedToLand = true; next.lastCommandText = `LAND RWY ${rwy.id}`; }
    return { accepted, updatedAircraft: accepted ? next : ac,
      atcMessageEn: `${ac.callsign}, RUNWAY ${rwy.id}, CLEARED TO LAND.`,
      atcMessageCn: `${ac.callsign}，跑道 ${rwy.id}，可以着陆。`,
      pilotReadbackEn: accepted ? `${radioName}, RUNWAY ${rwy.id}, CLEARED TO LAND.`
        : `${radioName}, UNABLE LANDING CLEARANCE RUNWAY ${rwy.id}, ${blocking ? 'CONFLICTING RUNWAY TRAFFIC' : 'APPROACH NOT ESTABLISHED ON ASSIGNED RUNWAY'}.`,
      pilotReadbackCn: accepted ? `${ac.airlineCn}${ac.callsign.slice(3)}，跑道 ${rwy.id}，可以着陆。`
        : `${ac.airlineCn}${ac.callsign.slice(3)}，无法接受跑道 ${rwy.id} 着陆许可，${blocking ? '存在冲突航班' : '请先建立所分配跑道的进近'}。` };
  }

  if (cmd.type === 'CLEARED_ILS') {
    const targetRwyId =
      cmd.runwayId && cmd.runwayId !== '09' ? cmd.runwayId : ac.assignedRunway;
    const rwy = getRunwayConfig(airport, targetRwyId);
    const ilsCheck = checkIlsConditions(ac, airport, rwy.id, altitudeUnit);
    if (!ilsCheck.canAcceptClearance) {
      return {
        accepted: false,
        updatedAircraft: ac,
        atcMessageEn: `${ac.callsign}, CLEARED ILS RUNWAY ${rwy.id} APPROACH.`,
        atcMessageCn: `${ac.callsign}，可以执行跑道 ${rwy.id} ILS 盲降进近。`,
        pilotReadbackEn: `${radioName}, ${ilsCheck.reasonEn || 'UNABLE ILS APPROACH AT THIS TIME'}.`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，${ilsCheck.reasonCn || '当前不满足盲降截获条件'}。`,
      };
    }

    const headingDiffToLoc = Math.abs(shortestHeadingDelta(ac.heading, rwy.heading));
    const targetDiffToLoc = Math.abs(shortestHeadingDelta(ac.targetHeading, rwy.heading));
    const geom = computeRunwayLocalizerGeometry(ac.position, rwy);

    next.assignedRunway = rwy.id;
    next.clearedApproach = true;
    next.holdState = null;
    next.procedureLegs = [];
    next.activeProcedureId = null;

    if (ilsCheck.canLockLocalizer) {
      next.phase = 'FINAL_APPROACH';
      next.directWaypointId = null;
      next.lastCommandText = `ILS RWY ${rwy.id}`;
    } else {
      next.phase = 'INTERCEPTING';
      next.directWaypointId = null;
      if (geom.crossTrackErrorNM > 0.2 && (headingDiffToLoc > 15 || targetDiffToLoc > 15)) {
        const interceptHdg =
          geom.signedCrossTrackNM > 0
            ? normalizeHeading(rwy.heading - 30)
            : normalizeHeading(rwy.heading + 30);
        next.targetHeading = interceptHdg;
      }
      next.targetAltitude = Math.min(next.targetAltitude, 2000);
      next.targetSpeed = Math.min(next.targetSpeed, 180);
      next.lastCommandText = `LOC RWY ${rwy.id}`;
    }

    return {
      accepted: true,
      updatedAircraft: next,
      atcMessageEn: `${ac.callsign}, MAINTAIN ${formatAltitudeSpeechEn(next.targetAltitude, altitudeUnit)} UNTIL ESTABLISHED, CLEARED ILS RUNWAY ${rwy.id} APPROACH.`,
      atcMessageCn: `${ac.callsign}，截获前保持 ${formatAltitudeSpeechCn(next.targetAltitude, altitudeUnit)}，可以执行跑道 ${rwy.id} ILS 盲降进近。`,
      pilotReadbackEn: `${radioName}, MAINTAIN ${formatAltitudeSpeechEn(next.targetAltitude, altitudeUnit)} UNTIL ESTABLISHED, CLEARED ILS RUNWAY ${rwy.id} APPROACH.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，截获前保持 ${formatAltitudeSpeechCn(next.targetAltitude, altitudeUnit)}，可以跑道 ${rwy.id} ILS 进近。`,
    };
  }

  // 9. 强制复飞指令 (GO_AROUND)
  if (cmd.type === 'GO_AROUND') {
    const rwy = getRunwayConfig(airport, ac.assignedRunway);
    next.phase = 'GO_AROUND';
    next.clearedApproach = false;
    next.clearedToLand = false;
    next.directWaypointId = null;
    next.procedureLegs = [];
    next.activeProcedureId = null;
    next.holdState = null;
    next.targetHeading = rwy.heading;
    next.targetAltitude = 3000;
    next.targetSpeed = 200;
    next.lastCommandText = 'GO AROUND';

    const hdgStr = formatHeading(rwy.heading);
    return {
      accepted: true,
      updatedAircraft: next,
      atcMessageEn: `${ac.callsign}, GO AROUND, FLY RUNWAY HEADING ${hdgStr}, CLIMB AND MAINTAIN ${formatAltitudeSpeechEn(3000, altitudeUnit)}.`,
      atcMessageCn: `${ac.callsign}，立即复飞！保持跑道航向 ${hdgStr}，爬升保持 ${formatAltitudeSpeechCn(3000, altitudeUnit)}。`,
      pilotReadbackEn: `${radioName}, GOING AROUND, RUNWAY HEADING ${hdgStr}, CLIMBING TO ${formatAltitudeSpeechEn(3000, altitudeUnit)}.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，正在复飞，航向 ${hdgStr}，爬升至 ${formatAltitudeSpeechCn(3000, altitudeUnit)}。`,
    };
  }

  // 10. 离场移交指令 (HANDOFF)
  if (cmd.type === 'HANDOFF') {
    if (ac.category !== 'DEPARTURE') {
      return {
        accepted: false,
        updatedAircraft: ac,
        atcMessageEn: `${ac.callsign}, CONTACT CENTER 125.8.`,
        atcMessageCn: `${ac.callsign}，联系区调 125.8。`,
        pilotReadbackEn: `${radioName}, NEGATIVE, WE ARE AN ARRIVAL FLIGHT FOR ${airport.icao}.`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，我们是本场进港航班，无法移交区调。`,
      };
    }

    if (!ac.canHandoff) {
      return {
        accepted: false,
        updatedAircraft: ac,
        atcMessageEn: `${ac.callsign}, CONTACT CENTER 125.8.`,
        atcMessageCn: `${ac.callsign}，联系区调 125.8。`,
        pilotReadbackEn: `${radioName}, UNABLE HANDOFF YET, PASSING ${formatAltitudeSpeechEn(ac.altitude, altitudeUnit)} (REQUIRE ≥${formatAltitudeSpeechEn(5000, altitudeUnit)} OR NEAR SID EXIT).`,
        pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，当前高度 ${formatAltitudeSpeechCn(ac.altitude, altitudeUnit)}，需爬升至 ${formatAltitudeSpeechCn(5000, altitudeUnit)}以上或接近离场出口方可移交。`,
      };
    }

    next.phase = 'HANDED_OFF';
    next.lastCommandText = 'HANDOFF 125.8';
    return {
      accepted: true,
      updatedAircraft: next,
      handoffCompleted: true,
      atcMessageEn: `${ac.callsign}, RADAR SERVICE TERMINATED, CONTACT CENTER ON 125.8, GOOD DAY!`,
      atcMessageCn: `${ac.callsign}，雷达服务终止，请联系区域管制 125.8，再见！`,
      pilotReadbackEn: `${radioName}, CONTACT CENTER 125.8, GOOD DAY.`,
      pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)} 转频 125.8，感谢引导，再见！`,
    };
  }

  return {
    accepted: false,
    updatedAircraft: ac,
    atcMessageEn: `${ac.callsign}, SAY AGAIN.`,
    atcMessageCn: `${ac.callsign}，请重复指令。`,
    pilotReadbackEn: `${radioName}, STANDING BY.`,
    pilotReadbackCn: `${ac.airlineCn}${ac.callsign.slice(3)}，保持守听。`,
  };
}

/**
 * 解析底部快捷文本命令框输入
 */
export function parseTextCommand(rawInput: string): ATCCommand | null {
  const cleaned = rawInput.trim().toUpperCase();
  if (!cleaned) return null;

  if (cleaned === 'IDENT' || cleaned === 'SQK' || cleaned === 'SQUAWK IDENT') {
    return { type: 'SQUAWK_IDENT' };
  }

  if (cleaned === 'LUAW' || cleaned === 'LINE UP' || cleaned === 'LINE UP AND WAIT') {
    return { type: 'LINE_UP_WAIT' };
  }

  if (cleaned === 'VTF' || cleaned === 'VECTOR' || cleaned === 'VECTOR FINAL') {
    return { type: 'VECTOR_TO_FINAL' };
  }

  if (cleaned === 'CROSS' || cleaned.startsWith('CROSS ')) {
    return { type: 'CROSS_RUNWAY' };
  }

  if (cleaned === 'BREAKOUT' || cleaned === 'BREAK OUT' || cleaned === 'BO') {
    return { type: 'BREAK_OUT' };
  }

  const hdgMatch = cleaned.match(/^(?:([LR]|LEFT|RIGHT)\s+)?(?:HDG|H|HEADING)\s*(\d{1,3})$/);
  if (hdgMatch) {
    const dirRaw = hdgMatch[1];
    const turnDirection: TurnDirection =
      dirRaw === 'L' || dirRaw === 'LEFT'
        ? 'LEFT'
        : dirRaw === 'R' || dirRaw === 'RIGHT'
        ? 'RIGHT'
        : 'AUTO';
    return {
      type: 'HDG',
      heading: Number(hdgMatch[2]),
      turnDirection,
    };
  }

  const altMatch = cleaned.match(/^(?:ALT|A|CLIMB|DESCEND)\s*(\d{2,5})([MF]?)$/);
  if (altMatch) {
    let val = Number(altMatch[1]);
    const suffix = altMatch[2];
    if (
      suffix === 'M' ||
      (suffix !== 'F' && val >= 600 && val <= 3600 && val % 300 === 0 && val !== 2000 && val !== 3000)
    ) {
      val = Math.round(val / 300) * 1000;
    } else if (val <= 150) {
      val *= 100;
    }
    return {
      type: 'ALT',
      altitude: val,
    };
  }

  const spdMatch = cleaned.match(/^(?:SPD|S|SPEED)\s*(\d{3})$/);
  if (spdMatch) {
    return {
      type: 'SPD',
      speed: Number(spdMatch[1]),
    };
  }

  const starMatch = cleaned.match(/^STAR\s+([A-Z0-9-]+)$/);
  if (starMatch) {
    return {
      type: 'STAR',
      procedureId: starMatch[1],
    };
  }

  const sidMatch = cleaned.match(/^SID\s+([A-Z0-9-]+)$/);
  if (sidMatch) {
    return {
      type: 'SID',
      procedureId: sidMatch[1],
    };
  }

  const dctMatch = cleaned.match(/^(?:DCT|DIRECT)\s+([A-Z0-9]+)$/);
  if (dctMatch) {
    return {
      type: 'DCT',
      waypointId: dctMatch[1],
    };
  }

  const holdMatch = cleaned.match(/^HOLD(?:\s+([A-Z0-9]+))?$/);
  if (holdMatch) {
    return {
      type: 'HOLD',
      waypointId: holdMatch[1],
    };
  }

  const rwyAssignMatch = cleaned.match(
    /^RWY\s+(09L|09R|27R|27L|34R|16L|22|04|34L|16R|35R|17L)$/
  );
  if (rwyAssignMatch) {
    return {
      type: 'ASSIGN_RUNWAY',
      runwayId: rwyAssignMatch[1] as RunwayId,
    };
  }

  const ilsMatch = cleaned.match(
    /^(?:CLEARED\s+ILS|ILS|APP)(?:\s+(?:RWY\s*)?(09L|09R|27R|27L|34R|16L|22|04|34L|16R|35R|17L|09|27))?$/
  );
  if (ilsMatch) {
    return {
      type: 'CLEARED_ILS',
      runwayId: ilsMatch[1] as RunwayId | '09' | '27' | undefined,
    };
  }

  const landMatch = cleaned.match(/^(?:LAND|CLEARED TO LAND)(?:\s+(?:RUNWAY\s+|RWY\s+)?(\d{2}[LR]?))?$/);
  if (landMatch) return { type: 'CLEARED_LAND', runwayId: landMatch[1] as RunwayId | undefined };

  if (
    cleaned === 'TAKEOFF' ||
    cleaned === 'CTO' ||
    cleaned === 'T/O' ||
    cleaned.startsWith('CLEARED TAKEOFF') ||
    cleaned.startsWith('CTO ')
  ) {
    const rwyMatch = cleaned.match(/(09L|09R|27R|27L|34R|16L|22|04|34L|16R|35R|17L)/);
    return {
      type: 'CLEARED_TAKEOFF',
      runwayId: rwyMatch ? (rwyMatch[1] as RunwayId) : undefined,
    };
  }

  if (cleaned === 'GA' || cleaned === 'GO AROUND') {
    return { type: 'GO_AROUND' };
  }

  if (cleaned === 'HO' || cleaned === 'HANDOFF' || cleaned === 'CONTACT CENTER') {
    return { type: 'HANDOFF' };
  }

  return null;
}

export function executeATCCommand(...args: Parameters<typeof executeATCCommandRaw>): CommandExecutionResult {
  const [ac, cmd, airport] = args;
  const invalidRunway = cmd.runwayId && !airport.runways[cmd.runwayId as RunwayId];
  const invalidNumber = (cmd.type === 'HDG' && (!Number.isFinite(cmd.heading) || cmd.heading! < 0 || cmd.heading! > 360)) ||
    (cmd.type === 'ALT' && (!Number.isFinite(cmd.altitude) || cmd.altitude! < 0)) ||
    (cmd.type === 'SPD' && (!Number.isFinite(cmd.speed) || cmd.speed! < 100 || cmd.speed! > 350));
  if (invalidRunway || invalidNumber || ['LANDED', 'HANDED_OFF', 'EXITED_AIRSPACE'].includes(ac.phase)) {
    return { accepted: false, updatedAircraft: ac,
      atcMessageCn: `${ac.callsign}，请核对指令。`, atcMessageEn: `${ac.callsign}, CHECK INSTRUCTION.`,
      pilotReadbackCn: formatPilotReadback(ac, '无法执行，请核对跑道、数值和航班状态', 'CN'),
      pilotReadbackEn: formatPilotReadback(ac, 'UNABLE, CHECK RUNWAY, VALUE AND FLIGHT STATUS', 'EN') };
  }
  const result = executeATCCommandRaw(...args);
  if (result.accepted && (result.updatedAircraft.assignedRunway !== ac.assignedRunway || !result.updatedAircraft.clearedApproach)) {
    result.updatedAircraft.clearedToLand = false;
  }
  return { ...result,
    pilotReadbackCn: formatPilotReadback(args[0], result.pilotReadbackCn, 'CN'),
    pilotReadbackEn: formatPilotReadback(args[0], result.pilotReadbackEn, 'EN'),
  };
}
