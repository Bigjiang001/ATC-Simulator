export type FlightCategory = 'ARRIVAL' | 'DEPARTURE';

export type WakeCategory = 'SUPER' | 'HEAVY' | 'MEDIUM' | 'LIGHT';

export type WakeCode = 'J' | 'H' | 'M' | 'L';

// RECAT-EU 6 级尾流分类码 (A: Super, B: Upper Heavy, C: Lower Heavy, D: Upper Medium, E: Lower Medium, F: Light)
export type RecatCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export type WakeStandard = 'ICAO' | 'RECAT_EU';

export type RunwayCountMode = 'SINGLE' | 'DUAL';

export type AirportId = 'ZSHB' | 'RJTT' | 'ZSPD' | 'EGLL';

/**
 * 高度表拨正与高度层计量制式：
 * - 'METRIC': 中国民航 CAAC 标准公制高度层（单位：米 / m，每 300 米一个高度层，默认）
 * - 'IMPERIAL': 国际民航组织 ICAO 标准英制高度层（单位：英尺 / ft，每 1000 英尺一个高度层）
 */
export type AltitudeUnit = 'METRIC' | 'IMPERIAL';

export type RunwayLayoutType =
  | 'PARALLEL_CLOSE'       // ZSHB: 东西向近距平行双跑道 (09L/27R & 09R/27L)
  | 'INTERSECTING'         // RJTT: 交叉横风双跑道 (34R/16L 337° 与 22/04 222° 物理斜交)
  | 'PARALLEL_STAGGERED'   // ZSPD: 南北偏西北远距错列平行双跑道 (34L/16R & 35R/17L 348°)
  | 'PARALLEL_WIDE_STACKS'; // EGLL: 西向宽距平行双跑道 (27L/09R & 27R/09L 270°) + 四角等待栈

export type RunwayId =
  | '09L'
  | '09R'
  | '27R'
  | '27L'
  | '34R'
  | '16L'
  | '22'
  | '04'
  | '34L'
  | '16R'
  | '35R'
  | '17L';

// '09' 代表机场正向主运行流向 (Primary Flow)，'27' 代表换端反向运行流向 (Reverse Flow)
export type RunwayDirectionConfig = '09' | '27';

export type EmergencyType =
  | 'NONE'
  | 'SQUAWK_7700_ENGINE'
  | 'SQUAWK_7700_FUEL'
  | 'SQUAWK_7600_NORDO';

export type TtsLanguage = 'EN' | 'CN';

export type FlightPhase =
  | 'HOLDING_GROUND'   // 地面跑道外等待起飞
  | 'LINE_UP_WAIT'     // 进跑道等待 (Line Up and Wait - 已进入跑道头对正待命)
  | 'TAKEOFF_ROLL'     // 起飞滑跑中（占用跑道）
  | 'INITIAL_CLIMB'    // 起飞离地初始爬升
  | 'DEPARTING'        // 离场爬升前往移交点
  | 'ARRIVING'         // 进港引导中
  | 'HOLDING_AIR'      // 空中等待航线盘旋中
  | 'INTERCEPTING'     // 已获准 ILS 进近，正在切入航向道
  | 'FINAL_APPROACH'   // 已截获航向道与下滑道，五边最终进近
  | 'LANDING_ROLL'     // 接地着陆滑跑（占用跑道）
  | 'HOLD_CROSSING'    // 外侧跑道落地脱离后等待穿越内侧跑道 (SMR 跑道穿越)
  | 'GO_AROUND'        // 复飞爬升中
  | 'LANDED'           // 已安全脱离跑道完成降落
  | 'HANDED_OFF'       // 已完成离场管制移交
  | 'EXITED_AIRSPACE'; // 飞出管制空域边界

export type TurnDirection = 'LEFT' | 'RIGHT' | 'AUTO';

export interface Point2D {
  x: number; // 海里 (NM), +x 为正东 (090°)
  y: number; // 海里 (NM), +y 为正北 (000°)
}

export interface TerrainPolygon {
  id: string;
  label?: string;
  kind: 'COASTLINE' | 'ISLAND' | 'RIVER';
  points: Point2D[];
  closed?: boolean;
}

export interface RestrictedZone {
  id: string;
  nameCn: string;
  nameEn: string;
  center: Point2D;
  radiusNM: number;
  maxAltitudeFt: number;
}

export interface AircraftModelSpec {
  typeCode: string;
  name: string;
  wakeCategory: WakeCategory;
  wakeCode: WakeCode;
  recatCode: RecatCode;
  mtowKg: number;
  cruiseSpeed: number;
  approachSpeed: number;
  touchdownSpeed: number;
  rotationSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  maxTurnRate: number;
  maxClimbRate: number;
  maxDescentRate: number;
  acceleration: number;
  takeoffAccel: number;
  landingDecel: number;
}

export interface HoldPatternState {
  waypointId: string;
  center: Point2D;
  inboundHeading: number;
  legPhase: 'TO_FIX' | 'OUTBOUND_TURN' | 'OUTBOUND_LEG' | 'INBOUND_TURN' | 'INBOUND_LEG';
  legTimerSec: number;
}

export interface ProcedureLeg {
  waypointId: string;
  targetAltitude?: number;
  maxSpeed?: number;
}

export interface StandardProcedure {
  id: string;
  name: string;
  type: 'STAR' | 'SID';
  runwayConfig: RunwayDirectionConfig;
  targetRunway?: RunwayId;
  description: string;
  legs: ProcedureLeg[];
}

export interface WeatherCell {
  id: string;
  name: string;
  position: Point2D;
  radiusNM: number;
  coreRadiusNM: number;
  velocityNMPerSec: Point2D;
  intensity: 'MODERATE' | 'SEVERE';
}

export interface WeatherState {
  atisLetter: string;
  windDirectionDeg: number;
  windSpeedKt: number;
  qnhHpa: number;
  cells: WeatherCell[];
  nextWindShiftSec: number;
}

export interface RunwayWakeRecord {
  lastTakeoffTimeSec: number;
  lastWakeCategory: WakeCategory;
  lastRecatCode: RecatCode;
  lastCallsign: string;
}

export interface VoiceProfileConfig {
  voiceURI: string;    // Exact local Qwen/Kokoro speaker ID
  pitch: number;       // 0.85 - 1.18
  rate: number;        // 0.9 - 1.5, pitch-preserving tempo
  presetLabel: string; // Selected voice display name
  languageProfiles?: Partial<Record<TtsLanguage, { voiceURI: string; rate: number }>>;
  preferredGender?: 'MALE' | 'FEMALE';
}

export type VhfStaticLevel = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * 游戏结束 (Game Over) 判定严格度模式：
 * - 'REALISTIC' (默认推荐·民航宽容模式)：仅当两机发生危险接近/相撞 (<2.8km & <150m) 或同跑道碰撞时触发 Game Over；误入限制区(-35分)、飞出空域边界(-60分)或进雷雨区(-30分)仅触发声光告警与扣分，避免过难劝退玩家。
 * - 'STRICT_ALL' (硬核零容忍模式·对标经典街机空管)：危险接近/相撞、闯入激活的限制区、或未经移交飞出空域边界，任一发生均立即触发 Game Over。
 */
export type GameOverRuleMode = 'REALISTIC' | 'STRICT_ALL';

export interface GameSettings {
  airportId: AirportId;
  runwayCountMode: RunwayCountMode;   // 'SINGLE' (单跑道) | 'DUAL' (双平行/交叉跑道)
  difficulty: GameDifficulty;
  altitudeUnit: AltitudeUnit;         // 'METRIC' (中国民航米制 m，默认) | 'IMPERIAL' (英制 ft)
  wakeStandard: WakeStandard;         // 'ICAO' | 'RECAT_EU'
  enableWeatherCb: boolean;           // 是否开启 CB 雷雨积雨云团回波（可随时开关）
  enableWind: boolean;                // 是否开启地面风与随机风向切变（关闭时为静风 00KT CAVOK）
  enableRestrictedZones: boolean;     // 是否开启空域限制区/军方活动（关闭时无空方限制区活动）
  gameOverRuleMode: GameOverRuleMode; // 'REALISTIC' | 'STRICT_ALL'
  enableEmergencies: boolean;         // 是否开启 7700/7600 特情航班
  enableTcasRa: boolean;              // 是否开启 TCAS RA 自主防撞避让
  enableNtzMonitoring: boolean;       // 是否开启平行/交叉跑道 NTZ 与交汇点监控
  showAmanTimeline: boolean;          // 是否显示 AMAN 进港排序时间轴
  enableRunwayCrossing: boolean;      // 是否开启外侧落地航班穿越内侧跑道请求
  enableSquawkIdent: boolean;         // 是否开启二次雷达应答机识别显示
  enableRookieCoach: boolean;         // 是否开启实时新手教练引导横幅
  showRestrictedZones: boolean;       // 是否显示地形海岸线图层
  ttsEnabled: boolean;                // 兼容总开关
  atcTtsEnabled: boolean;             // 是否开启【管制员 ATC】语音播报（关闭后仅文字显示在底部通话记录）
  pilotTtsEnabled: boolean;           // 是否开启【飞行员 PILOT】语音播报（关闭后仅文字显示在底部通话记录）
  voiceAssistEnabled?: boolean;       // Allow contextual callsign/Chinese command assistance
  requireLandingClearance?: boolean;  // Separate approach and landing clearance in procedure training
  enableVoiceControl: boolean;        // 是否开启【按住 Shift 麦克风语音指挥飞机模式】（开启后按住Shift说话识别，仅播报机长复诵）
  ttsLanguage: TtsLanguage;           // 'CN' (中文播报/识别) | 'EN' (英文播报/识别)
  vhfStaticLevel: VhfStaticLevel;     // 甚高频对讲机滋滋声与静噪尾音强度 ('OFF' | 'LOW' | 'MEDIUM' | 'HIGH')
  atcVoice: VoiceProfileConfig;       // 管制员声音配置
  pilotVoice: VoiceProfileConfig;     // 飞行员声音配置
}

export interface TutorialState {
  active: boolean;
  step: number; // 1..8
  licensePassed: boolean;
  licenseCertNo: string;
}

export interface Aircraft {
  id: string;
  callsign: string;
  airlineName: string;
  airlineCn: string;
  model: string;
  wakeCategory: WakeCategory;
  wakeCode: WakeCode;
  recatCode: RecatCode;
  category: FlightCategory;
  phase: FlightPhase;

  // 二次雷达应答机与特情状态
  squawkCode: string;
  radarIdentified: boolean;
  identFlashTimerSec: number;
  emergencyType: EmergencyType;
  tcasRaActive: boolean;
  tcasRaDirection: 'CLIMB' | 'DESCEND' | null;
  ntzPenetration: boolean;

  // 实时运动物理状态
  position: Point2D;
  heading: number;
  targetHeading: number;
  turnDirection: TurnDirection;

  altitude: number;
  targetAltitude: number;
  preTcasTargetAltitude: number | null;
  verticalSpeed: number;

  speed: number;
  groundSpeed: number;
  targetSpeed: number;

  // 性能包线
  maxTurnRate: number;
  maxClimbRate: number;
  maxDescentRate: number;
  acceleration: number;

  // 导航与管制许可状态
  directWaypointId: string | null;
  activeProcedureId: string | null;
  procedureLegs: ProcedureLeg[];
  holdState: HoldPatternState | null;
  clearedApproach: boolean;
  clearedToLand?: boolean;
  clearedTakeoff: boolean;
  independentApproachMode: boolean;
  assignedRunway: RunwayId;
  crossingRunwayId: RunwayId | null;
  assignedExitId: string | null;
  entryGateId: string | null;

  // 历史航迹与标牌
  trail: Point2D[];
  trailTimer: number;
  lastCommandText: string;
  spawnTimeSec: number;
  canHandoff: boolean;
  inWeatherHazard: boolean;
  inRestrictedZone?: boolean;
  conflictLevel: 'NONE' | 'WARNING' | 'CRITICAL' | 'ACCIDENT';
  labelOffsetIndex: number;
}

export interface AmanSequenceItem {
  aircraftId: string;
  callsign: string;
  wakeBadge: string;
  assignedRunway: RunwayId;
  distToThresholdNM: number;
  etaSec: number;
  recommendedActionCn: string;
  isEmergency: boolean;
}

export interface Waypoint {
  id: string;
  name: string;
  position: Point2D;
  role: 'IF' | 'FAF' | 'TRANSITION' | 'EXIT' | 'HOLD_STACK';
  recommendedAltitude: number;
  description: string;
}

export interface ArrivalGate {
  id: string;
  name: string;
  position: Point2D;
  initialHeading: number;
  initialAltitude: number;
  initialSpeed: number;
  defaultStarId?: string;
}

export interface RunwayConfig {
  id: RunwayId;
  oppositeId: RunwayId;
  physicalStripId: string;
  pairName: string;
  directionGroup: RunwayDirectionConfig;
  role: 'PRIMARY_ARR' | 'PRIMARY_DEP';
  heading: number;
  threshold: Point2D;
  end: Point2D;
  lengthNM: number;
  ilsRangeNM: number;
  glideslopeDeg: number;
  holdingPoint: Point2D;
}

export interface RunwayFlowPair {
  arrival: RunwayId;
  departure: RunwayId;
  labelCn: string;
  labelEn: string;
}

export interface AirportConfig {
  id: AirportId;
  icao: string;
  iata: string;
  nameEn: string;
  nameCn: string;
  cityCn: string;
  layoutType: RunwayLayoutType;
  layoutBadgeCn: string;
  layoutDescCn: string;
  elevationFt: number;
  airspaceRadiusNM: number;
  terminalRadarMinNM: number;
  defaultWindDirDeg: number;
  defaultWindSpeedKt: number;
  primaryFlowRunways: RunwayFlowPair;
  reverseFlowRunways: RunwayFlowPair;
  intersectionPoint?: Point2D;
  runways: Partial<Record<RunwayId, RunwayConfig>> & Record<string, RunwayConfig>;
  waypoints: Waypoint[];
  procedures: StandardProcedure[];
  arrivalGates: ArrivalGate[];
  departureExits: string[];
  terrainPolygons?: TerrainPolygon[];
  restrictedZones?: RestrictedZone[];
  preferredAirlines?: string[];
}

export type ConflictSeverity =
  | 'WARNING'
  | 'CRITICAL'
  | 'ACCIDENT'
  | 'RUNWAY'
  | 'WAKE'
  | 'NTZ'
  | 'RESTRICTED';

export interface ConflictAlert {
  id: string;
  aircraftIds: [string, string];
  callsigns: [string, string];
  horizontalDistNM: number;
  requiredHorizontalNM: number;
  verticalDistFt: number;
  severity: ConflictSeverity;
  isWakeTurbulence: boolean;
  description: string;
  timestampSec: number;
}

export interface RadioLogEntry {
  id: string;
  timeStr: string;
  simTimeSec: number;
  sender: 'ATC' | 'PILOT' | 'SYSTEM' | 'ALERT';
  callsign?: string;
  messageEn: string;
  messageCn: string;
}

export type GameDifficulty = 'EASY' | 'NORMAL' | 'HARD';

export type GameStatus = 'BRIEFING' | 'RUNNING' | 'PAUSED' | 'VICTORY' | 'GAMEOVER';

export interface SpeechQueueItem {
  role: 'ATC' | 'PILOT';
  textEn: string;
  textCn: string;
}

export interface CareerAchievement {
  id: string;
  titleCn: string;
  titleEn: string;
  descCn: string;
  icon: string;
  unlocked: boolean;
  unlockedAt?: string;
}

export interface CareerProfile {
  totalLanded: number;
  totalDeparted: number;
  totalEmergenciesHandled: number;
  totalShiftsCompleted: number;
  highScoreByAirport: Record<AirportId, number>;
  bestGradeByAirport: Record<AirportId, string>;
  unlockedAchievementIds: string[];
}

export interface SimulationEvent {
  type:
    | 'LANDED'
    | 'HOLD_CROSSING'
    | 'GO_AROUND'
    | 'AIRBORNE'
    | 'HANDOFF_READY'
    | 'HANDED_OFF'
    | 'EXITED_AIRSPACE'
    | 'LOCALIZER_CAPTURED'
    | 'WAYPOINT_REACHED'
    | 'WEATHER_HAZARD'
    | 'RESTRICTED_ZONE_INTRUSION'
    | 'TCAS_RA_ACTIVATED'
    | 'TCAS_RA_CLEARED'
    | 'NTZ_PENETRATION'
    | 'EMERGENCY_DECLARED';
  aircraftId: string;
  callsign: string;
  runwayId?: RunwayId;
  detailEn: string;
  detailCn: string;
}

export type AtcSoundEvent = 'SELECT' | 'COMMAND' | 'READBACK' | 'NEW_FLIGHT' | 'CONFLICT_WARNING'
  | 'CONFLICT_CRITICAL' | 'LANDED' | 'VICTORY' | 'GAMEOVER';
export interface AiVoiceEngineStatus {
  connected: boolean; senseVoiceLoaded: boolean; kokoroLoaded: boolean; qwenLoaded: boolean; lastTtsError: string;
  device: string; cachedUtterancesCount: number; lastLatencyMs: number; endpointUrl: string;
}
