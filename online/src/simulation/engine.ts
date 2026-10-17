import { normalizePilotMessages, formatPilotReadback } from '../atc/radiotelephony';
import {
  Aircraft,
  AirportConfig,
  AmanSequenceItem,
  ConflictAlert,
  EmergencyType,
  GameDifficulty,
  GameSettings,
  GameStatus,
  RadioLogEntry,
  RunwayDirectionConfig,
  RunwayWakeRecord,
  SpeechQueueItem,
  WeatherCell,
  WeatherState,
} from '../aircraft/types';
import {
  AIRPORTS_DATABASE,
  getActiveRunwaysForDirection,
} from '../airport/harborAirport';
import {
  calculateRunwayWindComponents,
  computeAmanSequence,
  feetToStandardMeters,
  formatAltitudeSpeechCn,
  formatAltitudeSpeechEn,
  formatAltitudeValue,
  formatHeading,
  getRunwayConfig,
  updateAircraftPhysics,
} from '../aircraft/physics';
import {
  ATCCommand,
  executeATCCommand,
  getPhysicalRunwayStripKey,
  getRadioCallsign,
} from '../atc/commands';
import { evaluateAirspaceSafety } from '../safety/conflictDetector';
import {
  createCustomAircraft,
  createInitialTraffic,
  DIFFICULTY_CONFIGS,
  spawnNextTraffic,
} from '../traffic/spawner';

export interface ScoreBreakdown {
  landingsScore: number;
  departuresScore: number;
  emergencyBonus: number;
  efficiencyBonus: number;
  conflictPenalties: number;
  runwayPenalties: number;
  wakePenalties: number;
  weatherPenalties: number;
  airspaceExitPenalties: number;
}

export interface SimulationState {
  trafficCap?: number;
  lastCommandResults?: Array<{ type: ATCCommand['type']; accepted: boolean; messageCn: string; messageEn: string; atcMessageCn: string; atcMessageEn: string }>;
  status: GameStatus;
  difficulty: GameDifficulty;
  settings: GameSettings;
  simTimeSec: number;
  gameSpeed: 1 | 2 | 4;
  isPaused: boolean;
  airport: AirportConfig;
  activeRunwayDir: RunwayDirectionConfig;
  weather: WeatherState;
  runwayWakeMap: Record<string, RunwayWakeRecord>;
  aircraft: Aircraft[];
  amanSequence: AmanSequenceItem[];
  selectedAircraftId: string | null;
  conflicts: ConflictAlert[];
  knownAlertIds: string[];
  radioLogs: RadioLogEntry[];

  // 计分、安全连击倍率与任务统计
  score: number;
  safetyStreak: number;
  streakMultiplier: number;
  scoreBreakdown: ScoreBreakdown;
  landedCount: number;
  landedTarget: number;
  departedCount: number;
  departedTarget: number;
  conflictCount: number;
  goAroundCount: number;
  exitedCount: number;
  endReasonCn: string;
  endReasonEn: string;
  freePlayMode: boolean;

  // 流量生成计时器
  nextSpawnTimerSec: number;
  spawnCounter: number;

  // 音效与双角色语音读回队列
  pendingSoundEvents: Array<
    | 'SELECT'
    | 'COMMAND'
    | 'READBACK'
    | 'NEW_FLIGHT'
    | 'CONFLICT_WARNING'
    | 'CONFLICT_CRITICAL'
    | 'LANDED'
    | 'VICTORY'
    | 'GAMEOVER'
  >;
  pendingSpeechItems: SpeechQueueItem[];
}

export const FIXED_PHYSICS_STEP_SEC = 0.25;

export function computeStreakMultiplier(streak: number): number {
  if (streak >= 8) return 2.5;
  if (streak >= 5) return 2.0;
  if (streak >= 3) return 1.5;
  if (streak >= 1) return 1.2;
  return 1.0;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  airportId: 'ZSHB',
  runwayCountMode: 'DUAL',
  difficulty: 'NORMAL',
  altitudeUnit: 'METRIC',
  wakeStandard: 'ICAO',
  enableWeatherCb: false,
  enableWind: false,
  enableRestrictedZones: false,
  gameOverRuleMode: 'REALISTIC',
  enableEmergencies: true,
  enableTcasRa: true,
  enableNtzMonitoring: true,
  showAmanTimeline: false,
  enableRunwayCrossing: false,
  enableSquawkIdent: true,
  enableRookieCoach: true,
  showRestrictedZones: true,
  ttsEnabled: true,
  // 管制员与飞行员独立语音播报开关（默认双开，可在各自面板单独开关）
  atcTtsEnabled: true,
  pilotTtsEnabled: true,
  // 默认开启按住 Shift 键麦克风语音指挥飞机模式
  enableVoiceControl: true,
  voiceAssistEnabled: true,
  requireLandingClearance: false,
  ttsLanguage: 'CN',
  vhfStaticLevel: 'MEDIUM',
  atcVoice: {
    voiceURI: 'browser:auto:female',
    pitch: 1,
    rate: 1.15,
    presetLabel: '自动匹配女声',
    preferredGender: 'FEMALE',
  },
  pilotVoice: {
    voiceURI: 'browser:auto:male',
    pitch: 1,
    rate: 1.15,
    presetLabel: '自动匹配男声',
    preferredGender: 'MALE',
  },
};

export function formatUtcClock(simTimeSec: number): string {
  const baseSec = 14 * 3600 + Math.floor(simTimeSec);
  const hh = Math.floor((baseSec / 3600) % 24);
  const mm = Math.floor((baseSec % 3600) / 60);
  const ss = baseSec % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}Z`;
}

export function formatMetarString(
  airportIcao: string,
  weather: WeatherState,
  activeDir: RunwayDirectionConfig,
  airport?: AirportConfig
): string {
  const windDir = String(Math.round(weather.windDirectionDeg)).padStart(3, '0');
  const windSpd = String(Math.round(weather.windSpeedKt)).padStart(2, '0');
  const ap =
    airport ||
    AIRPORTS_DATABASE[airportIcao as keyof typeof AIRPORTS_DATABASE] ||
    AIRPORTS_DATABASE.ZSHB;
  const flow = activeDir === '09' ? ap.primaryFlowRunways : ap.reverseFlowRunways;
  const rwyPair = `${flow.arrival}/${flow.departure}`;
  const windTag = weather.windSpeedKt <= 0 ? '00000KT (CALM)' : `${windDir}${windSpd}KT`;
  const cbTag = weather.cells.length > 0 ? ' SCT025CB' : ' CAVOK';
  return `${airportIcao} ATIS ${weather.atisLetter} · ${windTag}${cbTag} Q${weather.qnhHpa} · RWY ${rwyPair}`;
}

let logSeq = 1;
function makeLog(
  simTimeSec: number,
  sender: RadioLogEntry['sender'],
  messageEn: string,
  messageCn: string,
  callsign?: string
): RadioLogEntry {
  return {
    id: `LOG-${logSeq++}`,
    timeStr: formatUtcClock(simTimeSec),
    simTimeSec,
    sender,
    callsign,
    messageEn,
    messageCn,
  };
}

export function createDefaultCbCells(): WeatherCell[] {
  return [
    {
      id: 'CB-1',
      name: 'CB-ALPHA',
      position: { x: -12.5, y: -6.8 },
      radiusNM: 2.2,
      coreRadiusNM: 1.0,
      velocityNMPerSec: { x: 0.008, y: 0.004 },
      intensity: 'SEVERE',
    },
    {
      id: 'CB-2',
      name: 'CB-BRAVO',
      position: { x: 6.5, y: 12.0 },
      radiusNM: 2.4,
      coreRadiusNM: 1.1,
      velocityNMPerSec: { x: -0.006, y: -0.005 },
      intensity: 'MODERATE',
    },
  ];
}

export function createInitialWeather(
  airport?: AirportConfig,
  enableWeatherCb: boolean = false,
  enableWind: boolean = false
): WeatherState {
  const windDirectionDeg = enableWind ? (airport?.defaultWindDirDeg ?? 80) : 0;
  const windSpeedKt = enableWind ? (airport?.defaultWindSpeedKt ?? 12) : 0;
  return {
    atisLetter: 'ALPHA',
    windDirectionDeg,
    windSpeedKt,
    qnhHpa: 1013,
    nextWindShiftSec: 210,
    cells: enableWeatherCb ? createDefaultCbCells() : [],
  };
}

/**
 * 创建全新的模拟游戏状态
 */
function createInitialSimulationStateRaw(
  difficulty: GameDifficulty = 'NORMAL',
  autoStart: boolean = true,
  customSettings?: Partial<GameSettings>
): SimulationState {
  logSeq = 1;
  const settings: GameSettings = {
    ...DEFAULT_GAME_SETTINGS,
    difficulty,
    ...customSettings,
  };
  const unit = settings.altitudeUnit || 'METRIC';
  const airport = AIRPORTS_DATABASE[settings.airportId] || AIRPORTS_DATABASE.ZSHB;
  const activeRunwayDir: RunwayDirectionConfig = '09';
  const weather = createInitialWeather(
    airport,
    Boolean(settings.enableWeatherCb),
    Boolean(settings.enableWind)
  );
  const initialAircraft = createInitialTraffic(
    airport,
    settings.difficulty,
    activeRunwayDir,
    settings.runwayCountMode
  );
  const syncedAircraft = initialAircraft.map((ac) => ({
    ...ac,
    lastCommandText:
      ac.category === 'DEPARTURE'
        ? `HOLD SHORT ${ac.assignedRunway} -> ${ac.assignedExitId || 'EXIT'}`
        : `RADAR CONTACT [${ac.wakeCode}]`,
  }));

  const cfg = DIFFICULTY_CONFIGS[settings.difficulty];
  const activeFlow = getActiveRunwaysForDirection(
    activeRunwayDir,
    settings.runwayCountMode,
    airport
  );

  const firstArr = syncedAircraft.find((a) => a.category === 'ARRIVAL');
  const firstDep = syncedAircraft.find((a) => a.category === 'DEPARTURE');

  const unitLabelCn =
    unit === 'METRIC'
      ? '中国民航公制标准 (米/m · 每300米一层)'
      : 'ICAO 英制标准 (英尺/ft · 每1000英尺一层)';

  const wxSummaryCn = `${settings.enableWind ? `地面风 ${formatHeading(weather.windDirectionDeg)}°/${weather.windSpeedKt}kt` : '静风 (00KT)'}，${settings.enableWeatherCb ? '有雷雨积雨云 (CB)' : '天气晴好 (CAVOK 无CB)'}，${settings.enableRestrictedZones ? '限制区军演激活' : '无空方限制区活动'}`;

  const initialLogs: RadioLogEntry[] = [
    makeLog(
      0,
      'SYSTEM',
      `${airport.icao} (${airport.nameEn}) TRACON READY. LAYOUT: ${airport.layoutType} (${activeFlow.flowLabelEn}), ALT UNIT: ${unit}.`,
      `${airport.nameCn} (${airport.icao}) 管制中心已就绪。构型：${airport.layoutBadgeCn}，当前运行：${activeFlow.flowLabelCn}。`
    ),
    makeLog(
      0,
      'SYSTEM',
      `${formatMetarString(airport.icao, weather, activeRunwayDir, airport)} · PUSH-TO-TALK (HOLD SHIFT) VOICE CONTROL READY.`,
      `气象与空域通播：${wxSummaryCn}。高度制式：${unitLabelCn}。按住 Shift 键即可通过麦克风语音指挥航班！`
    ),
  ];

  if (firstArr) {
    initialLogs.push(
      makeLog(
        0,
        'PILOT',
        `${getRadioCallsign(firstArr)}, MAINTAINING ${formatAltitudeSpeechEn(firstArr.altitude, unit)}, INBOUND FOR ILS RUNWAY ${firstArr.assignedRunway}.`,
        `${firstArr.airlineCn} ${firstArr.callsign.slice(3)} (${firstArr.model} ${firstArr.wakeCode})，保持高度 ${formatAltitudeSpeechCn(firstArr.altitude, unit)}，进港请求跑道 ${firstArr.assignedRunway} 盲降进近。`,
        firstArr.callsign
      )
    );
  }

  if (firstDep) {
    initialLogs.push(
      makeLog(
        0,
        'PILOT',
        `${getRadioCallsign(firstDep)}, HOLDING SHORT RUNWAY ${firstDep.assignedRunway}, READY FOR DEPARTURE TO ${firstDep.assignedExitId}.`,
        `${firstDep.airlineCn} ${firstDep.callsign.slice(3)} (${firstDep.model} ${firstDep.wakeCode})，在 ${firstDep.assignedRunway} 跑道外等待完毕，准备好按 ${firstDep.assignedExitId} 离场。`,
        firstDep.callsign
      )
    );
  }

  return {
    status: autoStart ? 'RUNNING' : 'BRIEFING',
    difficulty: settings.difficulty,
    settings,
    simTimeSec: 0,
    gameSpeed: 1,
    isPaused: !autoStart,
    airport,
    activeRunwayDir,
    weather,
    runwayWakeMap: {},
    aircraft: syncedAircraft,
    amanSequence: computeAmanSequence(syncedAircraft, airport),
    selectedAircraftId: syncedAircraft[0]?.id || null,
    conflicts: [],
    knownAlertIds: [],
    radioLogs: initialLogs,
    score: 100,
    safetyStreak: 0,
    streakMultiplier: 1.0,
    scoreBreakdown: {
      landingsScore: 0,
      departuresScore: 0,
      emergencyBonus: 0,
      efficiencyBonus: 0,
      conflictPenalties: 0,
      runwayPenalties: 0,
      wakePenalties: 0,
      weatherPenalties: 0,
      airspaceExitPenalties: 0,
    },
    landedCount: 0,
    trafficCap: undefined,
    lastCommandResults: [],
    landedTarget: 8,
    departedCount: 0,
    departedTarget: 3,
    conflictCount: 0,
    goAroundCount: 0,
    exitedCount: 0,
    endReasonCn: '',
    endReasonEn: '',
    freePlayMode: false,
    nextSpawnTimerSec: cfg.spawnIntervalSec,
    spawnCounter: syncedAircraft.length,
    pendingSoundEvents: [],
    pendingSpeechItems: [],
  };
}

/**
 * 手动或随机注入一架 7700 / 7600 应急特情航班
 */
function spawnEmergencyFlightInStateRaw(
  state: SimulationState,
  emergencyType: EmergencyType = 'SQUAWK_7700_FUEL'
): SimulationState {
  const { arrivalRunway } = getActiveRunwaysForDirection(
    state.activeRunwayDir,
    state.settings.runwayCountMode,
    state.airport
  );
  const rwyCfg = getRunwayConfig(state.airport, arrivalRunway);
  const rad = (rwyCfg.heading * Math.PI) / 180;
  const ux = Math.sin(rad);
  const uy = Math.cos(rad);
  const nx = Math.cos(rad);
  const ny = -Math.sin(rad);

  const spawnPos = {
    x: Number((rwyCfg.threshold.x - 14.2 * ux - 0.4 * nx).toFixed(2)),
    y: Number((rwyCfg.threshold.y - 14.2 * uy - 0.4 * ny).toFixed(2)),
  };

  const emgAc = createCustomAircraft({
    callsign: emergencyType === 'SQUAWK_7600_NORDO' ? 'ANA760' : 'CPA770',
    airlineName: emergencyType === 'SQUAWK_7600_NORDO' ? 'ALL NIPPON' : 'CATHAY',
    airlineCn: emergencyType === 'SQUAWK_7600_NORDO' ? '全日空' : '国泰航空',
    model: 'B77W',
    category: 'ARRIVAL',
    position: spawnPos,
    heading: rwyCfg.heading,
    altitude: 3000,
    speed: 192,
    assignedRunway: arrivalRunway,
    emergencyType,
    simTimeSec: state.simTimeSec,
  });

  const detailEn =
    emergencyType === 'SQUAWK_7600_NORDO'
      ? `ALERT: ${emgAc.callsign} SQUAWKING 7600 (RADIO FAILURE NORDO)! AUTONOMOUSLY INTERCEPTING ILS RWY ${arrivalRunway}!`
      : emergencyType === 'SQUAWK_7700_ENGINE'
      ? `MAYDAY MAYDAY MAYDAY! ${emgAc.callsign} HEAVY SQUAWKING 7700, ENGINE #1 FIRE, REQUEST IMMEDIATE PRIORITY LANDING RWY ${arrivalRunway}!`
      : `MAYDAY MAYDAY MAYDAY! ${emgAc.callsign} HEAVY SQUAWKING 7700, EMERGENCY FUEL, REQUEST IMMEDIATE PRIORITY LANDING RWY ${arrivalRunway}!`;

  const detailCn =
    emergencyType === 'SQUAWK_7600_NORDO'
      ? `🚨 特情告警：${emgAc.callsign} 挂出应答机 7600（无线电通信失效）！机组正自主切入 ${arrivalRunway} 五边，请立即指挥周边飞机避让！`
      : emergencyType === 'SQUAWK_7700_ENGINE'
      ? `🚨 MAYDAY 特情告警：${emgAc.callsign} 重型机挂出应答机 7700（左发失效火警），请求优先引导降落 ${arrivalRunway}！`
      : `🚨 MAYDAY 特情告警：${emgAc.callsign} 重型机挂出应答机 7700（紧急燃油剩余不足），请求立即优先降落 ${arrivalRunway}！`;

  const nextAircraft = [...state.aircraft, emgAc];
  return {
    ...state,
    aircraft: nextAircraft,
    amanSequence: computeAmanSequence(nextAircraft, state.airport),
    selectedAircraftId: emgAc.id,
    radioLogs: [
      ...state.radioLogs,
      makeLog(state.simTimeSec, 'ALERT', detailEn, detailCn, emgAc.callsign),
    ].slice(-80),
    pendingSoundEvents: [...state.pendingSoundEvents, 'CONFLICT_CRITICAL'],
    pendingSpeechItems: [
      ...state.pendingSpeechItems,
      { role: 'PILOT', textEn: detailEn, textCn: detailCn },
    ],
  };
}

export function switchAirportRunwayDirection(
  state: SimulationState,
  newDir: RunwayDirectionConfig
): SimulationState {
  if (state.activeRunwayDir === newDir) return state;
  const activeFlow = getActiveRunwaysForDirection(
    newDir,
    state.settings.runwayCountMode,
    state.airport
  );
  const { arrivalRunway, departureRunway } = activeFlow;
  const depRwyCfg = getRunwayConfig(state.airport, departureRunway);

  const updatedAircraft = state.aircraft.map((ac) => {
    if (ac.phase === 'HOLDING_GROUND' || ac.phase === 'LINE_UP_WAIT') {
      return {
        ...ac,
        phase: 'HOLDING_GROUND' as const,
        assignedRunway: departureRunway,
        position: { ...depRwyCfg.holdingPoint },
        heading: depRwyCfg.heading,
        targetHeading: depRwyCfg.heading,
        lastCommandText: `HOLD SHORT ${departureRunway}`,
      };
    }
    if (ac.category === 'ARRIVAL' && ac.phase === 'ARRIVING') {
      return {
        ...ac,
        assignedRunway: arrivalRunway,
        clearedApproach: false,
      };
    }
    return ac;
  });

  const log = makeLog(
    state.simTimeSec,
    'SYSTEM',
    `RUNWAY CONFIGURATION CHANGED TO ${activeFlow.flowLabelEn} PER ICAO WIND/TRAFFIC MANAGEMENT.`,
    `跑道运行方向已切换为【${activeFlow.flowLabelCn}】！地面等待与进港航班已自动更新分配跑道。`
  );

  return {
    ...state,
    activeRunwayDir: newDir,
    aircraft: updatedAircraft,
    amanSequence: computeAmanSequence(updatedAircraft, state.airport),
    radioLogs: [...state.radioLogs, log].slice(-80),
  };
}

function advanceSimulationRaw(
  state: SimulationState,
  elapsedSimSec: number
): SimulationState {
  if (state.isPaused || state.status !== 'RUNNING' || elapsedSimSec <= 0) {
    return state;
  }

  let current: SimulationState = {
    ...state,
    aircraft: [...state.aircraft],
    radioLogs: [...state.radioLogs],
    knownAlertIds: [...state.knownAlertIds],
    scoreBreakdown: { ...state.scoreBreakdown },
    runwayWakeMap: { ...state.runwayWakeMap },
    weather: {
      ...state.weather,
      cells: state.weather.cells.map((c) => ({
        ...c,
        position: { ...c.position },
      })),
    },
    pendingSoundEvents: [...state.pendingSoundEvents],
    pendingSpeechItems: [...state.pendingSpeechItems],
  };

  let remaining = elapsedSimSec;
  while (remaining > 1e-6) {
    const dt = Math.min(FIXED_PHYSICS_STEP_SEC, remaining);
    remaining -= dt;
    current = stepSinglePhysicsTick(current, dt);
    if (current.status !== 'RUNNING') {
      break;
    }
  }

  current.amanSequence = computeAmanSequence(current.aircraft, current.airport);
  return current;
}

function stepSinglePhysicsTick(
  state: SimulationState,
  dt: number
): SimulationState {
  const simTimeSec = Number((state.simTimeSec + dt).toFixed(4));
  const airport = state.airport;
  const unit = state.settings.altitudeUnit || 'METRIC';
  const cbEnabled = state.settings.enableWeatherCb !== false;
  const windEnabled = state.settings.enableWind !== false;
  const restrictedEnabled = state.settings.enableRestrictedZones !== false;
  const strictGameOver = state.settings.gameOverRuleMode === 'STRICT_ALL';

  const activeCells = cbEnabled
    ? (state.weather.cells.length > 0 ? state.weather.cells : createDefaultCbCells()).map(
        (cell) => {
          let nx = cell.position.x + cell.velocityNMPerSec.x * dt;
          let ny = cell.position.y + cell.velocityNMPerSec.y * dt;
          let vx = cell.velocityNMPerSec.x;
          let vy = cell.velocityNMPerSec.y;
          if (Math.abs(nx) > 18) vx = -vx;
          if (Math.abs(ny) > 16) vy = -vy;
          return {
            ...cell,
            position: { x: nx, y: ny },
            velocityNMPerSec: { x: vx, y: vy },
          };
        }
      )
    : [];

  const nextWeather: WeatherState = {
    ...state.weather,
    windSpeedKt: windEnabled
      ? state.weather.windSpeedKt > 0
        ? state.weather.windSpeedKt
        : airport.defaultWindSpeedKt
      : 0,
    windDirectionDeg: windEnabled
      ? state.weather.windDirectionDeg
      : 0,
    nextWindShiftSec: windEnabled ? state.weather.nextWindShiftSec - dt : 240,
    cells: activeCells,
  };

  const nextAircraft: Aircraft[] = [];
  const newLogs: RadioLogEntry[] = [];
  const soundEvents = [...state.pendingSoundEvents];
  const speechItems = [...state.pendingSpeechItems];

  if (windEnabled && nextWeather.nextWindShiftSec <= 0) {
    nextWeather.nextWindShiftSec = 240;
    const letters = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO'];
    const curIdx = letters.indexOf(nextWeather.atisLetter);
    nextWeather.atisLetter = letters[(curIdx + 1) % letters.length];
    nextWeather.windDirectionDeg = (nextWeather.windDirectionDeg + 20) % 360;
  }

  let score = state.score;
  let safetyStreak = state.safetyStreak || 0;
  let streakMultiplier = computeStreakMultiplier(safetyStreak);
  const breakdown = { ...state.scoreBreakdown };
  let landedCount = state.landedCount;
  let departedCount = state.departedCount;
  let conflictCount = state.conflictCount;
  let goAroundCount = state.goAroundCount;
  let exitedCount = state.exitedCount;
  let status: GameStatus = state.status;
  let isPaused = state.isPaused;
  let endReasonCn = state.endReasonCn;
  let endReasonEn = state.endReasonEn;

  // 1. 更新每架飞机的物理状态
  for (const ac of state.aircraft) {
    const stripKey = getPhysicalRunwayStripKey(ac.assignedRunway, airport);
    const runwayOccupiedByOther = state.aircraft.some(
      (other) =>
        other.id !== ac.id &&
        (other.phase === 'TAKEOFF_ROLL' ||
          other.phase === 'LANDING_ROLL' ||
          other.phase === 'LINE_UP_WAIT') &&
        (getPhysicalRunwayStripKey(other.assignedRunway, airport) === stripKey ||
          airport.layoutType === 'INTERSECTING')
    );

    const { aircraft: updatedAc, events } = updateAircraftPhysics(
      ac,
      dt,
      airport,
      runwayOccupiedByOther,
      nextWeather,
      state.settings.enableRunwayCrossing && state.settings.runwayCountMode === 'DUAL',
      unit,
      restrictedEnabled,
      Boolean(state.settings.requireLandingClearance)
    );
    nextAircraft.push(updatedAc);

    for (const ev of events) {
      if (ev.type === 'LANDED') {
        landedCount += 1;
        safetyStreak += 1;
        streakMultiplier = computeStreakMultiplier(safetyStreak);
        const flightDuration = simTimeSec - updatedAc.spawnTimeSec;
        const speedBonus = flightDuration < 320 ? 30 : 10;
        const emgBonus = updatedAc.emergencyType !== 'NONE' ? 120 : 0;
        const basePts = Math.round(150 * streakMultiplier);
        const pts = basePts + speedBonus + emgBonus;
        score += pts;
        breakdown.landingsScore += basePts;
        breakdown.efficiencyBonus += speedBonus;
        breakdown.emergencyBonus += emgBonus;
        soundEvents.push('LANDED');
        newLogs.push(
          makeLog(
            simTimeSec,
            'PILOT',
            ev.detailEn,
            `${ev.detailCn} (+${pts} 分 · 🔥${streakMultiplier}×安全连击${emgBonus > 0 ? ' 含特情保障奖!' : ''})`,
            ev.callsign
          )
        );
      } else if (ev.type === 'HOLD_CROSSING') {
        soundEvents.push('READBACK');
        newLogs.push(makeLog(simTimeSec, 'PILOT', ev.detailEn, ev.detailCn, ev.callsign));
      } else if (ev.type === 'HANDED_OFF') {
        departedCount += 1;
        safetyStreak += 1;
        streakMultiplier = computeStreakMultiplier(safetyStreak);
        const pts = Math.round(120 * streakMultiplier);
        score += pts;
        breakdown.departuresScore += pts;
        soundEvents.push('READBACK');
        newLogs.push(
          makeLog(
            simTimeSec,
            'PILOT',
            ev.detailEn,
            `${ev.detailCn} (+${pts} 分 · 🔥${streakMultiplier}×安全连击)`,
            ev.callsign
          )
        );
      } else if (ev.type === 'GO_AROUND') {
        goAroundCount += 1;
        safetyStreak = 0;
        streakMultiplier = 1.0;
        score = Math.max(0, score - 25);
        soundEvents.push('CONFLICT_WARNING');
        speechItems.push({ role: 'PILOT', textEn: ev.detailEn, textCn: ev.detailCn });
        newLogs.push(makeLog(simTimeSec, 'ALERT', ev.detailEn, `${ev.detailCn} (-25 分 · 连击重置)`, ev.callsign));
      } else if (ev.type === 'WEATHER_HAZARD') {
        safetyStreak = 0;
        streakMultiplier = 1.0;
        score = Math.max(0, score - 30);
        breakdown.weatherPenalties += 30;
        soundEvents.push('CONFLICT_WARNING');
        speechItems.push({ role: 'PILOT', textEn: ev.detailEn, textCn: ev.detailCn });
        newLogs.push(makeLog(simTimeSec, 'ALERT', ev.detailEn, `${ev.detailCn} (-30 分)`, ev.callsign));
      } else if (ev.type === 'RESTRICTED_ZONE_INTRUSION') {
        const achievedScoreBeforeIntrusion = score;
        safetyStreak = 0;
        streakMultiplier = 1.0;
        conflictCount += 1;
        soundEvents.push('CONFLICT_CRITICAL');
        speechItems.push({ role: 'PILOT', textEn: ev.detailEn, textCn: ev.detailCn });
        newLogs.push(makeLog(simTimeSec, 'ALERT', ev.detailEn, `${ev.detailCn} (-35 分)`, ev.callsign));

        if (strictGameOver && !state.freePlayMode) {
          status = 'GAMEOVER';
          isPaused = true;
          score = achievedScoreBeforeIntrusion;
          endReasonCn = `【硬核零容忍模式 · 闯入禁航限制区 Game Over】航班 ${ev.callsign} 违规闯入激活的空域禁航/限制区！本局已暂停，可复盘后重试，您刚才取得的最终分数为：${achievedScoreBeforeIntrusion} 分。（提示：可在设置中关闭限制区活动或切回民航宽容计分模式）`;
          endReasonEn = `RESTRICTED ZONE INFRINGEMENT BY ${ev.callsign}. FINAL SCORE: ${achievedScoreBeforeIntrusion}.`;
          soundEvents.push('GAMEOVER');
        } else {
          score = Math.max(0, score - 35);
          breakdown.conflictPenalties += 35;
        }
      } else if (ev.type === 'EXITED_AIRSPACE') {
        const achievedScoreBeforeExit = score;
        exitedCount += 1;
        safetyStreak = 0;
        streakMultiplier = 1.0;
        soundEvents.push('CONFLICT_CRITICAL');
        speechItems.push({ role: 'PILOT', textEn: ev.detailEn, textCn: ev.detailCn });
        newLogs.push(makeLog(simTimeSec, 'ALERT', ev.detailEn, `${ev.detailCn} (-60 分)`, ev.callsign));

        if (strictGameOver && !state.freePlayMode) {
          status = 'GAMEOVER';
          isPaused = true;
          score = achievedScoreBeforeExit;
          endReasonCn = `【硬核零容忍模式 · 航班飞出空域边界 Game Over】航班 ${ev.callsign} 未经引导或移交飞出终端管制扇区边界！本局已暂停，可复盘后重试，您刚才取得的最终分数为：${achievedScoreBeforeExit} 分。（提示：可在设置中切回民航宽容计分模式）`;
          endReasonEn = `AIRCRAFT ${ev.callsign} EXITED TERMINAL AIRSPACE WITHOUT CLEARANCE. FINAL SCORE: ${achievedScoreBeforeExit}.`;
          soundEvents.push('GAMEOVER');
        } else {
          score = Math.max(0, score - 60);
          breakdown.airspaceExitPenalties += 60;
        }
      } else {
        newLogs.push(makeLog(simTimeSec, 'PILOT', ev.detailEn, ev.detailCn, ev.callsign));
      }
    }
  }

  // 2. 评估空域安全、尾流、NTZ、交叉跑道冲突、TCAS RA 以及严重差错（危险接近 AIRPROX / 相撞）
  const knownSet = new Set(state.knownAlertIds);
  const safety = evaluateAirspaceSafety(
    nextAircraft,
    simTimeSec,
    knownSet,
    state.settings.wakeStandard,
    state.settings.enableNtzMonitoring && state.settings.runwayCountMode === 'DUAL',
    airport
  );

  const activeClimbIds = new Set(safety.tcasRaPairs.map((p) => p.climbId));
  const activeDescendIds = new Set(safety.tcasRaPairs.map((p) => p.descendId));

  for (let i = 0; i < nextAircraft.length; i++) {
    const ac = nextAircraft[i];
    const level = safety.aircraftConflictLevels[ac.id] || 'NONE';
    const ntz = safety.ntzPenetratingIds.has(ac.id);

    let tcasRaActive = ac.tcasRaActive;
    let tcasRaDirection = ac.tcasRaDirection;
    let targetAltitude = ac.targetAltitude;
    let preTcasTargetAltitude = ac.preTcasTargetAltitude;
    let lastCommandText = ac.lastCommandText;

    if (state.settings.enableTcasRa) {
      if (activeClimbIds.has(ac.id) && !ac.tcasRaActive) {
        tcasRaActive = true;
        tcasRaDirection = 'CLIMB';
        preTcasTargetAltitude = ac.targetAltitude;
        targetAltitude = Math.min(12000, Math.round((ac.altitude + 1000) / 1000) * 1000);
        lastCommandText = 'TCAS RA CLIMB!';
        newLogs.push(
          makeLog(
            simTimeSec,
            'ALERT',
            `${ac.callsign}, TCAS RA! CLIMBING AUTONOMOUSLY!`,
            `🚨 机载防撞触发：${ac.callsign} 报告 "TCAS RA!"，机组已自主接管并紧急爬升至 ${formatAltitudeSpeechCn(targetAltitude, unit)}！`,
            ac.callsign
          )
        );
      } else if (activeDescendIds.has(ac.id) && !ac.tcasRaActive) {
        tcasRaActive = true;
        tcasRaDirection = 'DESCEND';
        preTcasTargetAltitude = ac.targetAltitude;
        targetAltitude = Math.max(2000, Math.round((ac.altitude - 1000) / 1000) * 1000);
        lastCommandText = 'TCAS RA DESCEND!';
        newLogs.push(
          makeLog(
            simTimeSec,
            'ALERT',
            `${ac.callsign}, TCAS RA! DESCENDING AUTONOMOUSLY!`,
            `🚨 机载防撞触发：${ac.callsign} 报告 "TCAS RA!"，机组已自主接管并紧急下降至 ${formatAltitudeSpeechCn(targetAltitude, unit)}！`,
            ac.callsign
          )
        );
      } else if (ac.tcasRaActive && level === 'NONE') {
        tcasRaActive = false;
        tcasRaDirection = null;
        if (preTcasTargetAltitude != null) {
          targetAltitude = preTcasTargetAltitude;
          preTcasTargetAltitude = null;
        }
        lastCommandText = 'CLEAR OF CONFLICT';
        newLogs.push(
          makeLog(
            simTimeSec,
            'PILOT',
            `${ac.callsign}, CLEAR OF CONFLICT, RETURNING TO ASSIGNED CLEARANCE.`,
            `${ac.callsign} 报告：TCAS 冲突已解除 (Clear of Conflict)，恢复执行管制高度指令。`,
            ac.callsign
          )
        );
      }
    }

    nextAircraft[i] = {
      ...ac,
      conflictLevel: level,
      ntzPenetration: ntz,
      tcasRaActive,
      tcasRaDirection,
      targetAltitude,
      preTcasTargetAltitude,
      lastCommandText,
    };
  }

  for (const alert of safety.alerts) {
    if (!knownSet.has(alert.id)) {
      knownSet.add(alert.id);
      conflictCount += 1;
      safetyStreak = 0;
      streakMultiplier = 1.0;
      const vText = formatAltitudeValue(alert.verticalDistFt, unit);
      const hKm = (alert.horizontalDistNM * 1.852).toFixed(2);

      if (alert.severity === 'ACCIDENT') {
        const achievedScoreBeforeAccident = score;
        soundEvents.push('CONFLICT_CRITICAL');
        newLogs.push(
          makeLog(
            simTimeSec,
            'ALERT',
            alert.description,
            `🚨 严重差错（危险接近 AIRPROX / 相撞）：${alert.callsigns[0]} 与 ${alert.callsigns[1]} 水平仅 ${hKm}km (${alert.horizontalDistNM}NM < 2.8km红线)，垂直仅 ${feetToStandardMeters(alert.verticalDistFt)}m (< 150m红线)！`
          )
        );
        if (!state.freePlayMode) {
          status = 'GAMEOVER';
          isPaused = true;
          score = achievedScoreBeforeAccident;
          endReasonCn = `触发本游戏的严重差错阈值：${alert.callsigns[0]} 与 ${alert.callsigns[1]} 危险接近，实测水平 ${hKm} 公里 (${alert.horizontalDistNM} 海里)，垂直 ${feetToStandardMeters(alert.verticalDistFt)} 米。本局已暂停，可复盘后重试，您刚才取得的最终分数为：${achievedScoreBeforeAccident} 分。`;
          endReasonEn = `SERIOUS ATC INCIDENT (AIRPROX / COLLISION) BETWEEN ${alert.callsigns[0]} AND ${alert.callsigns[1]} (${hKm}KM / ${feetToStandardMeters(alert.verticalDistFt)}M). FINAL SCORE: ${achievedScoreBeforeAccident}.`;
          soundEvents.push('GAMEOVER');
        }
      } else if (alert.severity === 'NTZ') {
        score = Math.max(0, score - 60);
        breakdown.conflictPenalties += 60;
        soundEvents.push('CONFLICT_CRITICAL');
        newLogs.push(
          makeLog(
            simTimeSec,
            'ALERT',
            alert.description,
            `平行跑道 NTZ 非侵入区告警：${alert.callsigns[0]} 偏入两跑道中央禁入区威胁 ${alert.callsigns[1]}！请立即点击 "紧急脱离 (BREAK OUT)"！(-60 分)`
          )
        );
      } else if (alert.severity === 'CRITICAL') {
        score = Math.max(0, score - 80);
        breakdown.conflictPenalties += 80;
        soundEvents.push('CONFLICT_CRITICAL');
        newLogs.push(
          makeLog(
            simTimeSec,
            'ALERT',
            alert.description,
            `高危冲突告警：${alert.callsigns[0]} 与 ${alert.callsigns[1]} 距离缩小至 ${hKm}km (${alert.horizontalDistNM}NM) / 垂直差 ${vText}！(-80 分)`
          )
        );
      } else if (alert.severity === 'RUNWAY') {
        score = Math.max(0, score - 100);
        breakdown.runwayPenalties += 100;
        soundEvents.push('CONFLICT_CRITICAL');
        newLogs.push(
          makeLog(
            simTimeSec,
            'ALERT',
            alert.description,
            `跑道冲突告警：${alert.callsigns[0]} 与 ${alert.callsigns[1]} 同时占用或交汇冲突！(-100 分)`
          )
        );
      } else if (alert.severity === 'WAKE') {
        score = Math.max(0, score - 45);
        breakdown.wakePenalties += 45;
        soundEvents.push('CONFLICT_WARNING');
        newLogs.push(
          makeLog(
            simTimeSec,
            'ALERT',
            alert.description,
            `尾流间隔不足告警：${alert.callsigns[0]} 与 ${alert.callsigns[1]} 当前 ${alert.horizontalDistNM} NM（低于 ${state.settings.wakeStandard} 标准 ${alert.requiredHorizontalNM} NM）(-45 分)`
          )
        );
      } else {
        score = Math.max(0, score - 40);
        breakdown.conflictPenalties += 40;
        soundEvents.push('CONFLICT_WARNING');
        newLogs.push(
          makeLog(
            simTimeSec,
            'ALERT',
            alert.description,
            `STCA 间隔小于规定警告：${alert.callsigns[0]} 与 ${alert.callsigns[1]} 水平 ${hKm}km (${alert.horizontalDistNM}NM) / 垂直差 ${vText} (-40 分)`
          )
        );
      }
    }
  }

  // 3. 动态航班生成
  const diffCfg = DIFFICULTY_CONFIGS[state.difficulty];
  let nextSpawnTimerSec = state.nextSpawnTimerSec - dt;
  let spawnCounter = state.spawnCounter;

  const activeAircraftCount = nextAircraft.filter(
    (a) =>
      a.phase !== 'LANDED' &&
      a.phase !== 'HANDED_OFF' &&
      a.phase !== 'EXITED_AIRSPACE'
  ).length;

  if (nextSpawnTimerSec <= 0 || activeAircraftCount < 2) {
    nextSpawnTimerSec = diffCfg.spawnIntervalSec;
    if (activeAircraftCount < (state.trafficCap ?? diffCfg.maxConcurrentActive)) {
      const activeArrivals = nextAircraft.filter(
        (a) => a.category === 'ARRIVAL' && a.phase !== 'LANDED' && a.phase !== 'EXITED_AIRSPACE'
      ).length;
      const activeDepartures = nextAircraft.filter(
        (a) => a.category === 'DEPARTURE' && a.phase !== 'HANDED_OFF' && a.phase !== 'EXITED_AIRSPACE'
      ).length;

      let preferCategory: 'ARRIVAL' | 'DEPARTURE' = 'ARRIVAL';
      if (
        departedCount + activeDepartures < state.departedTarget &&
        activeDepartures === 0
      ) {
        preferCategory = 'DEPARTURE';
      } else if (
        landedCount + activeArrivals < state.landedTarget &&
        spawnCounter % 3 !== 2
      ) {
        preferCategory = 'ARRIVAL';
      } else {
        preferCategory = spawnCounter % 3 === 2 ? 'DEPARTURE' : 'ARRIVAL';
      }

      const needArrival = landedCount + activeArrivals < state.landedTarget;
      const needDeparture = departedCount + activeDepartures < state.departedTarget;
      if (state.trafficCap !== undefined) preferCategory = needArrival ? 'ARRIVAL' : 'DEPARTURE';
      const spawned = state.trafficCap !== undefined && !needArrival && !needDeparture ? null : spawnNextTraffic(
        airport,
        nextAircraft,
        simTimeSec,
        spawnCounter,
        preferCategory,
        state.activeRunwayDir,
        state.settings.runwayCountMode,
        state.settings.enableEmergencies
      );
      if (spawned) {
        spawnCounter += 1;
        nextAircraft.push(spawned);
        soundEvents.push(spawned.emergencyType !== 'NONE' ? 'CONFLICT_CRITICAL' : 'NEW_FLIGHT');
        const radioCall = getRadioCallsign(spawned);
        if (spawned.emergencyType !== 'NONE') {
          const emgEn = `${radioCall}, SQUAWKING ${spawned.squawkCode}, EMERGENCY INBOUND FOR RWY ${spawned.assignedRunway}!`;
          const emgCn = `🚨 特情航班进扇：${spawned.airlineCn} ${spawned.callsign} 应答机 ${spawned.squawkCode} (${spawned.lastCommandText})，请求优先引导降落 ${spawned.assignedRunway}！`;
          newLogs.push(makeLog(simTimeSec, 'ALERT', emgEn, emgCn, spawned.callsign));
          speechItems.push({ role: 'PILOT', textEn: emgEn, textCn: emgCn });
        } else if (spawned.category === 'ARRIVAL') {
          const arrEn = `${radioCall}, ENTERING SECTOR AT ${formatAltitudeSpeechEn(spawned.altitude, unit)}, SPEED ${spawned.speed} KNOTS, REQUESTING ILS RWY ${spawned.assignedRunway}.`;
          const arrCn = `${spawned.airlineCn} ${spawned.callsign} [${spawned.wakeCode}/${spawned.recatCode}] 进扇 (${spawned.entryGateId})，保持标准高度层 ${formatAltitudeSpeechCn(spawned.altitude, unit)}，请求 ${spawned.assignedRunway} 进近。`;
          newLogs.push(makeLog(simTimeSec, 'PILOT', arrEn, arrCn, spawned.callsign));
          speechItems.push({ role: 'PILOT', textEn: arrEn, textCn: arrCn });
        } else {
          const depEn = `${radioCall}, HOLDING SHORT RWY ${spawned.assignedRunway}, READY FOR DEPARTURE TO ${spawned.assignedExitId}.`;
          const depCn = `${spawned.airlineCn} ${spawned.callsign} [${spawned.wakeCode}/${spawned.recatCode}] 在 ${spawned.assignedRunway} 跑道外等待完毕，申请起飞前往 ${spawned.assignedExitId}。`;
          newLogs.push(makeLog(simTimeSec, 'PILOT', depEn, depCn, spawned.callsign));
          speechItems.push({ role: 'PILOT', textEn: depEn, textCn: depCn });
        }
      }
    }
  }

  // 4. 检查任务完成条件
  if (
    status === 'RUNNING' &&
    !state.freePlayMode &&
    landedCount >= state.landedTarget &&
    departedCount >= state.departedTarget
  ) {
    status = 'VICTORY';
    isPaused = true;
    score += 200;
    breakdown.efficiencyBonus += 200;
    endReasonCn = `恭喜！你已在 ${airport.nameCn} (${airport.icao}) 成功引导 ${landedCount} 架进港航班安全着陆，并指挥 ${departedCount} 架离港航班顺利移交！`;
    endReasonEn = `SHIFT COMPLETE AT ${airport.icao}! ${landedCount} ARRIVALS LANDED SAFELY & ${departedCount} DEPARTURES HANDED OFF.`;
    soundEvents.push('VICTORY');
    newLogs.push(
      makeLog(
        simTimeSec,
        'SYSTEM',
        endReasonEn,
        `${endReasonCn} (+200 班次奖励)`
      )
    );
  }

  const mergedLogs =
    newLogs.length > 0
      ? [...state.radioLogs, ...newLogs].slice(-80)
      : state.radioLogs;

  return {
    ...state,
    status,
    isPaused,
    simTimeSec,
    weather: nextWeather,
    aircraft: nextAircraft,
    conflicts: safety.alerts,
    knownAlertIds: Array.from(knownSet),
    radioLogs: mergedLogs,
    score,
    safetyStreak,
    streakMultiplier,
    scoreBreakdown: breakdown,
    landedCount,
    departedCount,
    conflictCount,
    goAroundCount,
    exitedCount,
    endReasonCn,
    endReasonEn,
    nextSpawnTimerSec,
    spawnCounter,
    pendingSoundEvents: soundEvents,
    pendingSpeechItems: speechItems,
  };
}

export interface IssueCommandOptions {
  /**
   * 当玩家通过麦克风按住 Shift 语音指挥下达指令时为 true：
   * 因为玩家自己已经通过话筒说出了管制员指令，语音合成中将不再重复播报管制员 (ATC) 声音，只播报飞行员 (PILOT) 的复诵声音！
   */
  suppressAtcTts?: boolean;
  rawSpokenText?: string;
}

function issueSimulationCommandRaw(
  state: SimulationState,
  aircraftId: string,
  commands: ATCCommand | ATCCommand[],
  options?: IssueCommandOptions
): SimulationState {
  if (state.status === 'VICTORY' || state.status === 'GAMEOVER') {
    return { ...state, lastCommandResults: [], pendingSoundEvents: [], pendingSpeechItems: [] };
  }
  const cmdList = Array.isArray(commands) ? commands : [commands];
  const commandResults: NonNullable<SimulationState['lastCommandResults']> = [];
  if (cmdList.length === 0) return state;

  const idx = state.aircraft.findIndex((a) => a.id === aircraftId);
  if (idx === -1) return state;

  let currentAc = state.aircraft[idx];
  const newLogs: RadioLogEntry[] = [];
  const soundEvents = [...state.pendingSoundEvents];
  const speechItems = [...state.pendingSpeechItems];
  const pilotResponses: SpeechQueueItem[] = [];
  const nextWakeMap = { ...state.runwayWakeMap };
  let score = state.score;
  let safetyStreak = state.safetyStreak || 0;
  let streakMultiplier = computeStreakMultiplier(safetyStreak);
  const breakdown = { ...state.scoreBreakdown };
  let landedCount = state.landedCount;
  let departedCount = state.departedCount;
  let conflictCount = state.conflictCount;
  const unit = state.settings.altitudeUnit || 'METRIC';
  const isVoiceMic = Boolean(options?.suppressAtcTts);

  for (const cmd of cmdList) {
    if (['LANDED', 'HANDED_OFF', 'EXITED_AIRSPACE'].includes(currentAc.phase)) break;
    const res = executeATCCommand(
      currentAc,
      cmd,
      state.airport,
      state.aircraft,
      state.simTimeSec,
      nextWakeMap,
      unit
    );
    currentAc = res.updatedAircraft;
    commandResults.push({ type: cmd.type, accepted: res.accepted, messageCn: res.pilotReadbackCn, messageEn: res.pilotReadbackEn,
      atcMessageCn: res.atcMessageCn, atcMessageEn: res.atcMessageEn });

    const spokenTag = options?.rawSpokenText
      ? `  ‹🎙️ SenseVoice口语:“${options.rawSpokenText}” ➔ 规范化标准陆空通话›`
      : '  ‹🎙️ 规范化标准陆空通话›';
    const atcCnText = isVoiceMic
      ? `${res.atcMessageCn}${spokenTag}`
      : res.atcMessageCn;

    newLogs.push(
      makeLog(state.simTimeSec, 'ATC', res.atcMessageEn, atcCnText, currentAc.callsign)
    );
    newLogs.push(
      makeLog(
        state.simTimeSec,
        res.accepted ? 'PILOT' : 'ALERT',
        res.pilotReadbackEn,
        res.pilotReadbackCn,
        currentAc.callsign
      )
    );

    // 若不是通过麦克风话筒语音发令，才将管制员 (ATC) 加入语音队列；若是话筒语音指挥，则只播放飞行员 (PILOT) 的复诵！
    if (!isVoiceMic) {
      speechItems.push({
        role: 'ATC',
        textEn: res.atcMessageEn,
        textCn: res.atcMessageCn,
      });
    }
    if (currentAc.emergencyType !== 'SQUAWK_7600_NORDO') {
      pilotResponses.push({
        role: 'PILOT',
        textEn: res.pilotReadbackEn,
        textCn: res.pilotReadbackCn,
      });
    }

    if (res.takeoffRunwayUsed) {
      const stripKey = getPhysicalRunwayStripKey(res.takeoffRunwayUsed, state.airport);
      nextWakeMap[stripKey] = {
        lastTakeoffTimeSec: state.simTimeSec,
        lastWakeCategory: currentAc.wakeCategory,
        lastRecatCode: currentAc.recatCode,
        lastCallsign: currentAc.callsign,
      };
    }

    if (res.runwayConflictTriggered) {
      safetyStreak = 0;
      streakMultiplier = 1.0;
      score = Math.max(0, score - 50);
      breakdown.runwayPenalties += 50;
      conflictCount += 1;
      soundEvents.push('CONFLICT_WARNING');
    } else if (res.wakeViolationTriggered) {
      safetyStreak = 0;
      streakMultiplier = 1.0;
      score = Math.max(0, score - 35);
      breakdown.wakePenalties += 35;
      conflictCount += 1;
      soundEvents.push('CONFLICT_WARNING');
    } else if (res.crossingLandingCompleted) {
      landedCount += 1;
      safetyStreak += 1;
      streakMultiplier = computeStreakMultiplier(safetyStreak);
      const emgBonus = currentAc.emergencyType !== 'NONE' ? 120 : 0;
      const basePts = Math.round(150 * streakMultiplier);
      const pts = basePts + 15 + emgBonus;
      score += pts;
      breakdown.landingsScore += basePts;
      breakdown.efficiencyBonus += 15;
      breakdown.emergencyBonus += emgBonus;
      soundEvents.push('LANDED');
    } else if (res.handoffCompleted) {
      departedCount += 1;
      safetyStreak += 1;
      streakMultiplier = computeStreakMultiplier(safetyStreak);
      const pts = Math.round(120 * streakMultiplier);
      score += pts;
      breakdown.departuresScore += pts;
      soundEvents.push('LANDED');
    } else if (res.accepted) {
      soundEvents.push('READBACK');
    } else {
      soundEvents.push('CONFLICT_WARNING');
    }
  }

  if (pilotResponses.length) speechItems.push({ role: 'PILOT',
    textCn: formatPilotReadback(currentAc, pilotResponses.map((item) => item.textCn).join(' '), 'CN'),
    textEn: formatPilotReadback(currentAc, pilotResponses.map((item) => item.textEn).join(' '), 'EN') });

  const updatedList = [...state.aircraft];
  updatedList[idx] = currentAc;

  let status: GameStatus = state.status;
  let isPaused = state.isPaused;
  let endReasonCn = state.endReasonCn;
  let endReasonEn = state.endReasonEn;

  if (
    status === 'RUNNING' &&
    !state.freePlayMode &&
    landedCount >= state.landedTarget &&
    departedCount >= state.departedTarget
  ) {
    status = 'VICTORY';
    isPaused = true;
    score += 200;
    breakdown.efficiencyBonus += 200;
    endReasonCn = `恭喜！你已在 ${state.airport.nameCn} (${state.airport.icao}) 成功引导 ${landedCount} 架进港航班安全着陆，并指挥 ${departedCount} 架离港航班顺利移交！`;
    endReasonEn = `SHIFT COMPLETE! ${landedCount} ARRIVALS LANDED SAFELY & ${departedCount} DEPARTURES HANDED OFF.`;
    soundEvents.push('VICTORY');
  }

  return {
    ...state,
    lastCommandResults: commandResults,
    status,
    isPaused,
    runwayWakeMap: nextWakeMap,
    aircraft: updatedList,
    amanSequence: computeAmanSequence(updatedList, state.airport),
    radioLogs: [...state.radioLogs, ...newLogs].slice(-80),
    score,
    safetyStreak,
    streakMultiplier,
    scoreBreakdown: breakdown,
    landedCount,
    departedCount,
    conflictCount,
    endReasonCn,
    endReasonEn,
    pendingSoundEvents: soundEvents,
    pendingSpeechItems: speechItems,
  };
}

export { calculateRunwayWindComponents };

export function createInitialSimulationState(...args: Parameters<typeof createInitialSimulationStateRaw>): SimulationState {
  return normalizePilotMessages(createInitialSimulationStateRaw(...args));
}

export function advanceSimulation(...args: Parameters<typeof advanceSimulationRaw>): SimulationState {
  return normalizePilotMessages(advanceSimulationRaw(...args));
}

export function issueSimulationCommand(...args: Parameters<typeof issueSimulationCommandRaw>): SimulationState {
  return normalizePilotMessages(issueSimulationCommandRaw(...args));
}

export function spawnEmergencyFlightInState(...args: Parameters<typeof spawnEmergencyFlightInStateRaw>): SimulationState {
  return normalizePilotMessages(spawnEmergencyFlightInStateRaw(...args));
}
