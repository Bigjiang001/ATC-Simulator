import {
  AircraftModelSpec,
  AirportConfig,
  AirportId,
  CareerAchievement,
  RecatCode,
  RunwayCountMode,
  RunwayDirectionConfig,
  RunwayId,
  WakeCategory,
} from '../aircraft/types';

/**
 * ICAO Doc 4444 第 8.7.3.4 节：基于尾流等级的最小雷达水平间隔矩阵（单位：海里 NM）
 * 行：前机 (Leader)，列：后机 (Follower)
 */
export const ICAO_WAKE_RADAR_MINIMA_NM: Record<WakeCategory, Record<WakeCategory, number>> = {
  SUPER: { SUPER: 4.0, HEAVY: 6.0, MEDIUM: 7.0, LIGHT: 8.0 },
  HEAVY: { SUPER: 4.0, HEAVY: 4.0, MEDIUM: 5.0, LIGHT: 6.0 },
  MEDIUM: { SUPER: 3.0, HEAVY: 3.0, MEDIUM: 3.0, LIGHT: 5.0 },
  LIGHT: { SUPER: 3.0, HEAVY: 3.0, MEDIUM: 3.0, LIGHT: 3.0 },
};

/**
 * EUROCONTROL RECAT-EU 6 级精细尾流雷达水平间隔矩阵（单位：海里 NM）
 */
export const RECAT_EU_RADAR_MINIMA_NM: Record<RecatCode, Record<RecatCode, number>> = {
  A: { A: 3.0, B: 4.0, C: 5.0, D: 5.0, E: 6.0, F: 8.0 },
  B: { A: 3.0, B: 3.0, C: 4.0, D: 4.0, E: 5.0, F: 7.0 },
  C: { A: 3.0, B: 3.0, C: 3.0, D: 3.0, E: 4.0, F: 6.0 },
  D: { A: 3.0, B: 3.0, C: 3.0, D: 3.0, E: 3.0, F: 5.0 },
  E: { A: 3.0, B: 3.0, C: 3.0, D: 3.0, E: 3.0, F: 4.0 },
  F: { A: 3.0, B: 3.0, C: 3.0, D: 3.0, E: 3.0, F: 3.0 },
};

/**
 * ICAO Doc 4444 第 5.8.3 节：同跑道起飞尾流最小时间间隔矩阵（单位：秒）
 */
export const ICAO_WAKE_DEPARTURE_MINIMA_SEC: Record<WakeCategory, Record<WakeCategory, number>> = {
  SUPER: { SUPER: 120, HEAVY: 120, MEDIUM: 180, LIGHT: 180 },
  HEAVY: { SUPER: 90, HEAVY: 90, MEDIUM: 120, LIGHT: 120 },
  MEDIUM: { SUPER: 0, HEAVY: 0, MEDIUM: 0, LIGHT: 120 },
  LIGHT: { SUPER: 0, HEAVY: 0, MEDIUM: 0, LIGHT: 0 },
};

export interface StandardAltitudeLevel {
  meters: number;
  feet: number;
  semiCircleRule: 'EAST_ODD' | 'WEST_EVEN' | 'COMMON_FAF';
  ruleBadgeCn: string;
  procedureUsageCn: string;
}

/**
 * 本游戏简化的终端区教学高度层表。标称 300m 对应游戏内部 1000ft；
 * 不代表真实机场程序或完整的国家高度层配备表。
 */
export const ICAO_STANDARD_ALTITUDE_LEVELS: StandardAltitudeLevel[] = [
  {
    meters: 600,
    feet: 2000,
    semiCircleRule: 'COMMON_FAF',
    ruleBadgeCn: 'FAF盲降层',
    procedureUsageCn: '600m (2000ft) · 最终进近定位点 (FAF) 盲降下滑道截获层',
  },
  {
    meters: 900,
    feet: 3000,
    semiCircleRule: 'EAST_ODD',
    ruleBadgeCn: 'IF五边/东单',
    procedureUsageCn: '900m (3000ft) · 中间进近定位点 (IF) / 东向单数底层',
  },
  {
    meters: 1200,
    feet: 4000,
    semiCircleRule: 'WEST_EVEN',
    ruleBadgeCn: 'SID初始/西双',
    procedureUsageCn: '1200m (4000ft) · SID 离场初始爬升限制层 / 西向双数等待层',
  },
  {
    meters: 1500,
    feet: 5000,
    semiCircleRule: 'EAST_ODD',
    ruleBadgeCn: 'HOLD等待/东单',
    procedureUsageCn: '1500m (5000ft) · 标准空中等待底层 / STAR 东向单数过渡层',
  },
  {
    meters: 1800,
    feet: 6000,
    semiCircleRule: 'WEST_EVEN',
    ruleBadgeCn: 'SID移交/西双',
    procedureUsageCn: '1800m (6000ft) · SID 离场标准移交区调层 / STAR 西向双数进场层',
  },
  {
    meters: 2100,
    feet: 7000,
    semiCircleRule: 'EAST_ODD',
    ruleBadgeCn: 'STAR东单',
    procedureUsageCn: '2100m (7000ft) · STAR 东向单数起始进场层 (000°–179°)',
  },
  {
    meters: 2400,
    feet: 8000,
    semiCircleRule: 'WEST_EVEN',
    ruleBadgeCn: 'STAR西双',
    procedureUsageCn: '2400m (8000ft) · STAR 西向双数高扇进场层 (180°–359°)',
  },
  {
    meters: 2700,
    feet: 9000,
    semiCircleRule: 'EAST_ODD',
    ruleBadgeCn: '高扇东单',
    procedureUsageCn: '2700m (9000ft) · 终端区高扇东向单数顶层',
  },
];

/**
 * 1. ZSHB — 海湾国际机场 (Harbor International Airport)
 * 构型：经典东西向近距平行双跑道 (09L/27R & 09R/27L, 090° / 270°)
 * 核实：
 * - 09 向东进场：NORTH(1500m) / SOUTH(1200m) -> BAYVW(900m, IF 距入口12.7NM) -> HARBR(600m, FAF 距入口6.7NM) -> 对正 09L/09R
 * - 27 向西换端进场：NORTH(1500m) / SOUTH(1200m) -> EASTF(900m, IF 距入口12.7NM) -> HARBE(600m, FAF 距入口6.7NM) -> 对正 27R/27L
 * - 限制区 ZS-R101 位于东南外海 (15.5, -15.5)，彻底避开东西两端五边进近走廊与离场航线！
 */
export const HARBOR_AIRPORT: AirportConfig = {
  id: 'ZSHB',
  icao: 'ZSHB',
  iata: 'HBR',
  nameEn: 'Harbor International Airport',
  nameCn: '海湾国际机场',
  cityCn: '海湾新区 · 东西向近距平行双跑道 (09L/09R)',
  layoutType: 'PARALLEL_CLOSE',
  layoutBadgeCn: '东西向平行双跑道 (090°/270°)',
  layoutDescCn:
    '北跑道 09L/27R 与南跑道 09R/27L 平行分布，配备标准西五边 BAYVW(900m)-HARBR(600m) 与东五边 EASTF(900m)-HARBE(600m) 对中引导走廊。',
  elevationFt: 18,
  airspaceRadiusNM: 28,
  terminalRadarMinNM: 3.0,
  defaultWindDirDeg: 80,
  defaultWindSpeedKt: 10,
  primaryFlowRunways: {
    arrival: '09L',
    departure: '09R',
    labelCn: '向东运行 09L(降)/09R(起)',
    labelEn: 'EASTFLOW RWY 09L/09R',
  },
  reverseFlowRunways: {
    arrival: '27R',
    departure: '27L',
    labelCn: '向西运行 27R(降)/27L(起)',
    labelEn: 'WESTFLOW RWY 27R/27L',
  },
  runways: {
    '09L': {
      id: '09L',
      oppositeId: '27R',
      physicalStripId: 'ZSHB_NORTH',
      pairName: 'RWY 09L/27R (北跑道)',
      directionGroup: '09',
      role: 'PRIMARY_ARR',
      heading: 90,
      threshold: { x: -1.3, y: 0.55 },
      end: { x: 1.3, y: 0.55 },
      lengthNM: 2.6,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: -1.3, y: 0.95 },
    },
    '09R': {
      id: '09R',
      oppositeId: '27L',
      physicalStripId: 'ZSHB_SOUTH',
      pairName: 'RWY 09R/27L (南跑道)',
      directionGroup: '09',
      role: 'PRIMARY_DEP',
      heading: 90,
      threshold: { x: -1.3, y: -0.55 },
      end: { x: 1.3, y: -0.55 },
      lengthNM: 2.6,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: -1.3, y: -0.95 },
    },
    '27R': {
      id: '27R',
      oppositeId: '09L',
      physicalStripId: 'ZSHB_NORTH',
      pairName: 'RWY 09L/27R (北跑道)',
      directionGroup: '27',
      role: 'PRIMARY_ARR',
      heading: 270,
      threshold: { x: 1.3, y: 0.55 },
      end: { x: -1.3, y: 0.55 },
      lengthNM: 2.6,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: 1.3, y: 0.95 },
    },
    '27L': {
      id: '27L',
      oppositeId: '09R',
      physicalStripId: 'ZSHB_SOUTH',
      pairName: 'RWY 09R/27L (南跑道)',
      directionGroup: '27',
      role: 'PRIMARY_DEP',
      heading: 270,
      threshold: { x: 1.3, y: -0.55 },
      end: { x: -1.3, y: -0.55 },
      lengthNM: 2.6,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: 1.3, y: -0.95 },
    },
  },
  waypoints: [
    {
      id: 'BAYVW',
      name: 'BAYVW',
      position: { x: -14, y: 0.55 },
      role: 'IF',
      recommendedAltitude: 3000,
      description: 'RWY 09L/09R 西五边中间进近定位点 (IF · 标准层 900m/3000ft, ≤200kt)',
    },
    {
      id: 'HARBR',
      name: 'HARBR',
      position: { x: -8, y: 0.55 },
      role: 'FAF',
      recommendedAltitude: 2000,
      description: 'RWY 09L/09R 西五边最终进近定位点 (FAF · 标准层 600m/2000ft, ≤180kt)',
    },
    {
      id: 'NORTH',
      name: 'NORTH',
      position: { x: -8, y: 10 },
      role: 'TRANSITION',
      recommendedAltitude: 5000,
      description: '北侧进港起始汇聚定位点 (IAF · 东向单数层 1500m/5000ft)',
    },
    {
      id: 'SOUTH',
      name: 'SOUTH',
      position: { x: -8, y: -10 },
      role: 'TRANSITION',
      recommendedAltitude: 4000,
      description: '南侧进港起始汇聚定位点 (IAF · 错层配备 1200m/4000ft)',
    },
    {
      id: 'EASTF',
      name: 'EASTF',
      position: { x: 14, y: 0.55 },
      role: 'IF',
      recommendedAltitude: 3000,
      description: 'RWY 27R/27L 东五边中间进近定位点 (IF · 标准层 900m/3000ft)',
    },
    {
      id: 'HARBE',
      name: 'HARBE',
      position: { x: 8, y: 0.55 },
      role: 'FAF',
      recommendedAltitude: 2000,
      description: 'RWY 27R/27L 东五边最终进近定位点 (FAF · 标准层 600m/2000ft)',
    },
    {
      id: 'OCEAN',
      name: 'OCEAN',
      position: { x: 15, y: 9 },
      role: 'EXIT',
      recommendedAltitude: 6000,
      description: '东北远洋离场移交走廊 (SID 移交点 · 标准层 1800m/6000ft)',
    },
    {
      id: 'COAST',
      name: 'COAST',
      position: { x: 15, y: -9 },
      role: 'EXIT',
      recommendedAltitude: 6000,
      description: '东南海岸离场移交走廊 (SID 移交点 · 标准层 1800m/6000ft)',
    },
  ],
  procedures: [
    {
      id: 'NORTH-1A',
      name: 'NORTH-1A (09 北进场)',
      type: 'STAR',
      runwayConfig: '09',
      description: 'NORTH(1500m) → BAYVW(900m) → HARBR(600m → 自动对正 09L/09R 盲降)',
      legs: [
        { waypointId: 'NORTH', targetAltitude: 5000, maxSpeed: 220 },
        { waypointId: 'BAYVW', targetAltitude: 3000, maxSpeed: 190 },
        { waypointId: 'HARBR', targetAltitude: 2000, maxSpeed: 170 },
      ],
    },
    {
      id: 'SOUTH-1A',
      name: 'SOUTH-1A (09 南进场)',
      type: 'STAR',
      runwayConfig: '09',
      description: 'SOUTH(1200m) → BAYVW(900m) → HARBR(600m → 自动对正 09L/09R 盲降)',
      legs: [
        { waypointId: 'SOUTH', targetAltitude: 4000, maxSpeed: 220 },
        { waypointId: 'BAYVW', targetAltitude: 3000, maxSpeed: 190 },
        { waypointId: 'HARBR', targetAltitude: 2000, maxSpeed: 170 },
      ],
    },
    {
      id: 'EAST-2B',
      name: 'EAST-2B (27 换端东进场)',
      type: 'STAR',
      runwayConfig: '27',
      description: 'EASTF(900m) → HARBE(600m → 自动对正 27R/27L 盲降)',
      legs: [
        { waypointId: 'EASTF', targetAltitude: 3000, maxSpeed: 190 },
        { waypointId: 'HARBE', targetAltitude: 2000, maxSpeed: 170 },
      ],
    },
    {
      id: 'OCEAN-1D',
      name: 'OCEAN-1D (东北离场 SID)',
      type: 'SID',
      runwayConfig: '09',
      description: '起飞初始爬升 1200m → 直飞 OCEAN 爬升至 1800m (6000ft / 250kt)',
      legs: [{ waypointId: 'OCEAN', targetAltitude: 6000, maxSpeed: 250 }],
    },
    {
      id: 'COAST-1D',
      name: 'COAST-1D (东南离场 SID)',
      type: 'SID',
      runwayConfig: '09',
      description: '起飞初始爬升 1200m → 直飞 COAST 爬升至 1800m (6000ft / 250kt)',
      legs: [{ waypointId: 'COAST', targetAltitude: 6000, maxSpeed: 250 }],
    },
  ],
  arrivalGates: [
    {
      id: 'GATE-NW',
      name: 'NW CORRIDOR',
      position: { x: -21, y: 12 },
      initialHeading: 120,
      initialAltitude: 7000,
      initialSpeed: 230,
      defaultStarId: 'NORTH-1A',
    },
    {
      id: 'GATE-SW',
      name: 'SW CORRIDOR',
      position: { x: -21, y: -12 },
      initialHeading: 60,
      initialAltitude: 5000,
      initialSpeed: 220,
      defaultStarId: 'SOUTH-1A',
    },
    {
      id: 'GATE-N',
      name: 'NORTH ARRIVAL',
      position: { x: -2, y: 20 },
      initialHeading: 215,
      initialAltitude: 6000,
      initialSpeed: 240,
      defaultStarId: 'NORTH-1A',
    },
    {
      id: 'GATE-S',
      name: 'SOUTH ARRIVAL',
      position: { x: -2, y: -20 },
      initialHeading: 325,
      initialAltitude: 6000,
      initialSpeed: 230,
      defaultStarId: 'SOUTH-1A',
    },
  ],
  departureExits: ['OCEAN', 'COAST'],
  terrainPolygons: [
    {
      id: 'HARBOR-COAST-W',
      label: '海湾西岸',
      kind: 'COASTLINE',
      points: [
        { x: -26, y: 20 },
        { x: -16, y: 14 },
        { x: -11, y: 6 },
        { x: -6, y: 2 },
        { x: -5, y: -3 },
        { x: -12, y: -9 },
        { x: -22, y: -19 },
      ],
    },
    {
      id: 'BEACON-ISLAND',
      label: '灯塔岛',
      kind: 'ISLAND',
      closed: true,
      points: [
        { x: 6, y: 3.5 },
        { x: 9.5, y: 4.2 },
        { x: 10.8, y: 2.1 },
        { x: 8.2, y: 1.1 },
        { x: 5.8, y: 1.8 },
      ],
    },
  ],
  restrictedZones: [
    {
      id: 'ZS-R101',
      nameCn: 'R101 东南外海演习禁航区',
      nameEn: 'NAVAL RESTRICTED R101',
      center: { x: 14.5, y: -15.5 },
      radiusNM: 2.8,
      maxAltitudeFt: 4000, // 1200m，远离 09/27 五边与 COAST(15,-9) 离场点
    },
  ],
  preferredAirlines: ['CES', 'CCA', 'CSN', 'CHH', 'CPA', 'CXA', 'CSC', 'SIA'],
};

/**
 * 2. RJTT — 东京羽田国际机场 (Tokyo Haneda International Airport)
 * 构型：交叉横风双跑道构型 (34R/16L 航向 337°/157° 与 22/04 航向 222°/042° 物理斜交汇聚)
 * 核实修正：
 * - 34R (337°) 进场：MIURA(1500m) -> KAIHO(900m, IF) -> CREAM(600m, FAF) -> 严格对正 34R 中心线
 * - 22 (222°) 进场：ARLNS(1200m, IF) -> CHIBA(600m, FAF) -> 严格对正 22 中心线 (并自动配给 22 跑道)
 * - 16L (157°) 南风换端进场：JONAN(900m, IF) -> HANED(600m, FAF) -> 严格对正 16L 中心线
 * - 皇居禁飞区 RJ-P1 移至西北内陆 (-12.5, 9.5)，彻底让开 16L 北五边 JONAN->HANED 进近走廊，换跑道落地绝不会撞限制区！
 */
export const HANEDA_AIRPORT: AirportConfig = {
  id: 'RJTT',
  icao: 'RJTT',
  iata: 'HND',
  nameEn: 'Tokyo Haneda International Airport',
  nameCn: '东京羽田国际机场',
  cityCn: '日本东京湾 · 交叉横风双跑道 (34R 337° × 22 222°)',
  layoutType: 'INTERSECTING',
  layoutBadgeCn: '交叉横风双跑道 (337° × 222°)',
  layoutDescCn:
    'C跑道 (34R/16L, 337°/157°) 与 B跑道 (22/04, 222°/042°) 斜交汇聚！五边分别从东京湾海堡 KAIHO-CREAM (对正 34R)、千叶 ARLNS-CHIBA (对正 22) 与城南 JONAN-HANED (对正 16L) 精确引入。',
  elevationFt: 35,
  airspaceRadiusNM: 28,
  terminalRadarMinNM: 3.0,
  defaultWindDirDeg: 320,
  defaultWindSpeedKt: 12,
  intersectionPoint: { x: 0.35, y: -0.05 },
  primaryFlowRunways: {
    arrival: '34R',
    departure: '22',
    labelCn: '北风交叉运行 34R(337°降) / 22(222°交叉起降)',
    labelEn: 'NORTHERN CROSSFLOW RWY 34R & RWY 22',
  },
  reverseFlowRunways: {
    arrival: '16L',
    departure: '04',
    labelCn: '南风交叉运行 16L(157°降) / 04(042°交叉起降)',
    labelEn: 'SOUTHERN CROSSFLOW RWY 16L & RWY 04',
  },
  runways: {
    '34R': {
      id: '34R',
      oppositeId: '16L',
      physicalStripId: 'RJTT_STRIP_C',
      pairName: 'RWY 34R/16L (C跑道 337°)',
      directionGroup: '09',
      role: 'PRIMARY_ARR',
      heading: 337,
      threshold: { x: 0.95, y: -1.35 },
      end: { x: -0.14, y: 1.23 },
      lengthNM: 2.8,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: 1.35, y: -1.20 },
    },
    '22': {
      id: '22',
      oppositeId: '04',
      physicalStripId: 'RJTT_STRIP_B',
      pairName: 'RWY 22/04 (B横风跑道 222°)',
      directionGroup: '09',
      role: 'PRIMARY_DEP',
      heading: 222,
      threshold: { x: 1.15, y: 0.95 },
      end: { x: -0.65, y: -1.05 },
      lengthNM: 2.7,
      ilsRangeNM: 15,
      glideslopeDeg: 3.0,
      holdingPoint: { x: 1.48, y: 0.72 },
    },
    '16L': {
      id: '16L',
      oppositeId: '34R',
      physicalStripId: 'RJTT_STRIP_C',
      pairName: 'RWY 34R/16L (C跑道 157°)',
      directionGroup: '27',
      role: 'PRIMARY_ARR',
      heading: 157,
      threshold: { x: -0.14, y: 1.23 },
      end: { x: 0.95, y: -1.35 },
      lengthNM: 2.8,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: 0.25, y: 1.40 },
    },
    '04': {
      id: '04',
      oppositeId: '22',
      physicalStripId: 'RJTT_STRIP_B',
      pairName: 'RWY 22/04 (B横风跑道 042°)',
      directionGroup: '27',
      role: 'PRIMARY_DEP',
      heading: 42,
      threshold: { x: -0.65, y: -1.05 },
      end: { x: 1.15, y: 0.95 },
      lengthNM: 2.7,
      ilsRangeNM: 15,
      glideslopeDeg: 3.0,
      holdingPoint: { x: -0.95, y: -0.82 },
    },
  },
  waypoints: [
    {
      id: 'KAIHO',
      name: 'KAIHO',
      position: { x: 5.64, y: -12.40 },
      role: 'IF',
      recommendedAltitude: 3000,
      description: '东京湾第二海堡定位点 (RWY 34R 五边 IF · 标准层 900m/3000ft, ≤200kt)',
    },
    {
      id: 'CREAM',
      name: 'CREAM',
      position: { x: 3.72, y: -7.89 },
      role: 'FAF',
      recommendedAltitude: 2000,
      description: 'RWY 34R 东京湾最终进近定位点 (FAF · 标准层 600m/2000ft, ≤175kt)',
    },
    {
      id: 'ARLNS',
      name: 'ARLNS',
      position: { x: 9.85, y: 10.61 },
      role: 'IF',
      recommendedAltitude: 4000,
      description: '千叶东北进近定位点 (交叉跑道 RWY 22 IF · 西向双数层 1200m/4000ft)',
    },
    {
      id: 'CHIBA',
      name: 'CHIBA',
      position: { x: 5.83, y: 6.15 },
      role: 'FAF',
      recommendedAltitude: 2000,
      description: '交叉跑道 RWY 22 最终进近定位点 (FAF · 标准层 600m/2000ft)',
    },
    {
      id: 'MIURA',
      name: 'MIURA',
      position: { x: -4.5, y: -15.5 },
      role: 'TRANSITION',
      recommendedAltitude: 5000,
      description: '三浦半岛西南进港汇聚定位点 (IAF · 东向单数层 1500m/5000ft)',
    },
    {
      id: 'JONAN',
      name: 'JONAN',
      position: { x: -4.83, y: 12.28 },
      role: 'IF',
      recommendedAltitude: 3000,
      description: '城南岛北五边中间进近点 (南风 RWY 16L IF · 标准层 900m/3000ft)',
    },
    {
      id: 'HANED',
      name: 'HANED',
      position: { x: -2.87, y: 7.67 },
      role: 'FAF',
      recommendedAltitude: 2000,
      description: '南风 RWY 16L 北五边最终进近点 (FAF · 标准层 600m/2000ft)',
    },
    {
      id: 'OPPER',
      name: 'OPPER',
      position: { x: 16.5, y: -3.5 },
      role: 'EXIT',
      recommendedAltitude: 6000,
      description: '房总半岛东向太平洋离场出口 (SID 移交点 · 标准层 1800m/6000ft)',
    },
    {
      id: 'URAGA',
      name: 'URAGA',
      position: { x: -13.5, y: -12.5 },
      role: 'EXIT',
      recommendedAltitude: 6000,
      description: '浦贺水道西南离场移交出口 (SID 移交点 · 标准层 1800m/6000ft)',
    },
  ],
  procedures: [
    {
      id: 'KAIHO-1A',
      name: 'KAIHO-1A (34R 主进场)',
      type: 'STAR',
      runwayConfig: '09',
      targetRunway: '34R',
      description: 'MIURA(1500m) → KAIHO(900m) → CREAM(600m → 自动对正 RWY 34R 盲降)',
      legs: [
        { waypointId: 'MIURA', targetAltitude: 5000, maxSpeed: 220 },
        { waypointId: 'KAIHO', targetAltitude: 3000, maxSpeed: 190 },
        { waypointId: 'CREAM', targetAltitude: 2000, maxSpeed: 170 },
      ],
    },
    {
      id: 'ARLNS-2B',
      name: 'ARLNS-2B (22 交叉跑道进场)',
      type: 'STAR',
      runwayConfig: '09',
      targetRunway: '22',
      description: 'ARLNS(1200m) → CHIBA(600m → 自动对正 RWY 22 盲降)',
      legs: [
        { waypointId: 'ARLNS', targetAltitude: 4000, maxSpeed: 190 },
        { waypointId: 'CHIBA', targetAltitude: 2000, maxSpeed: 170 },
      ],
    },
    {
      id: 'JONAN-1C',
      name: 'JONAN-1C (16L 南风换端进场)',
      type: 'STAR',
      runwayConfig: '27',
      targetRunway: '16L',
      description: 'JONAN(900m) → HANED(600m → 自动对正 RWY 16L 盲降)',
      legs: [
        { waypointId: 'JONAN', targetAltitude: 3000, maxSpeed: 190 },
        { waypointId: 'HANED', targetAltitude: 2000, maxSpeed: 170 },
      ],
    },
    {
      id: 'OPPER-1D',
      name: 'OPPER-1D (东京湾东离场 SID)',
      type: 'SID',
      runwayConfig: '09',
      description: '起飞初始爬升 1200m → 直飞 OPPER 爬升至 1800m (6000ft / 250kt)',
      legs: [{ waypointId: 'OPPER', targetAltitude: 6000, maxSpeed: 250 }],
    },
    {
      id: 'URAGA-2D',
      name: 'URAGA-2D (浦贺西南离场 SID)',
      type: 'SID',
      runwayConfig: '09',
      description: '起飞初始爬升 1200m → 直飞 URAGA 爬升至 1800m (6000ft / 250kt)',
      legs: [{ waypointId: 'URAGA', targetAltitude: 6000, maxSpeed: 250 }],
    },
  ],
  arrivalGates: [
    {
      id: 'HND-SOUTH',
      name: 'OSHIMA SOUTH',
      position: { x: 4.5, y: -22.5 },
      initialHeading: 350,
      initialAltitude: 6000,
      initialSpeed: 225,
      defaultStarId: 'KAIHO-1A',
    },
    {
      id: 'HND-SW',
      name: 'SAGAMI SW',
      position: { x: -14.0, y: -19.5 },
      initialHeading: 55,
      initialAltitude: 5000,
      initialSpeed: 230,
      defaultStarId: 'KAIHO-1A',
    },
    {
      id: 'HND-NE',
      name: 'TSUKUBA NE',
      position: { x: 18.0, y: 16.5 },
      initialHeading: 225,
      initialAltitude: 6000,
      initialSpeed: 220,
      defaultStarId: 'ARLNS-2B',
    },
    {
      id: 'HND-SE',
      name: 'BOSO SE',
      position: { x: 19.5, y: -13.5 },
      initialHeading: 300,
      initialAltitude: 8000,
      initialSpeed: 235,
      defaultStarId: 'KAIHO-1A',
    },
  ],
  departureExits: ['OPPER', 'URAGA'],
  terrainPolygons: [
    {
      id: 'TOKYO-WEST-SHORE',
      label: '横滨·川崎海岸线',
      kind: 'COASTLINE',
      points: [
        { x: -3.5, y: 18 },
        { x: -1.8, y: 7 },
        { x: -1.5, y: 0 },
        { x: -4.2, y: -6 },
        { x: -7.5, y: -14 },
        { x: -8.8, y: -22 },
      ],
    },
    {
      id: 'BOSO-EAST-SHORE',
      label: '千叶·木更津海岸线',
      kind: 'COASTLINE',
      points: [
        { x: 6.5, y: 16 },
        { x: 11.5, y: 9 },
        { x: 9.2, y: -2 },
        { x: 7.5, y: -9 },
        { x: 4.8, y: -18 },
      ],
    },
  ],
  restrictedZones: [
    {
      id: 'RJ-P1',
      nameCn: 'RJ-P1 东京皇居都心禁飞区',
      nameEn: 'IMPERIAL PALACE PROHIBITED RJ-P1',
      center: { x: -12.5, y: 9.5 }, // 位于西北内陆，彻底避开 16L (JONAN-HANED) 与 34R/22 所有进近五边！
      radiusNM: 2.6,
      maxAltitudeFt: 4000, // 1200m
    },
  ],
  preferredAirlines: ['ANA', 'JAL', 'SKY', 'ADO', 'CPA', 'SIA', 'CES', 'CCA'],
};

/**
 * 3. ZSPD — 上海浦东国际机场 (Shanghai Pudong International Airport)
 * 构型：南北偏北北西 (348°/168°) 远距错列平行双跑道 (34L/16R & 35R/17L)
 * 核实修正：
 * - 34L/35R (348°) 北向进场：HSN(1800m)/AND(1500m) -> DUMET(900m, IF) -> PUDNG(600m, FAF) -> 严格对正 34L (348°)
 * - 16R/17L (168°) 南向换端进场：CHONG(-3.98, 14.49, 900m IF) -> JIANG(-2.77, 8.82, 600m FAF) -> 严格对正 16R (168°) 延长中心线！
 */
export const PUDONG_AIRPORT: AirportConfig = {
  id: 'ZSPD',
  icao: 'ZSPD',
  iata: 'PVG',
  nameEn: 'Shanghai Pudong International Airport',
  nameCn: '上海浦东国际机场',
  cityCn: '中国上海 · 南北偏西错列平行双跑道 (34L / 35R 348°)',
  layoutType: 'PARALLEL_STAGGERED',
  layoutBadgeCn: '南北向错列双跑道 (348°/168°)',
  layoutDescCn:
    '一号跑道 (34L/16R) 与四号跑道 (35R/17L) 沿 348°/168° 海岸线呈南北纵向错列分布，进港航班按东单西双高度层从 HSN(1800m)/AND(1500m) → DUMET(900m) → PUDNG(600m) 阶梯下降对正五边。',
  elevationFt: 13,
  airspaceRadiusNM: 28,
  terminalRadarMinNM: 3.0,
  defaultWindDirDeg: 350,
  defaultWindSpeedKt: 11,
  primaryFlowRunways: {
    arrival: '34L',
    departure: '35R',
    labelCn: '向北运行 34L(降)/35R(起) · 348°',
    labelEn: 'NORTHFLOW RWY 34L/35R (348°)',
  },
  reverseFlowRunways: {
    arrival: '16R',
    departure: '17L',
    labelCn: '向南运行 16R(降)/17L(起) · 168°',
    labelEn: 'SOUTHFLOW RWY 16R/17L (168°)',
  },
  runways: {
    '34L': {
      id: '34L',
      oppositeId: '16R',
      physicalStripId: 'ZSPD_WEST',
      pairName: 'RWY 34L/16R (西侧一号跑道 348°)',
      directionGroup: '09',
      role: 'PRIMARY_ARR',
      heading: 348,
      threshold: { x: -0.55, y: -1.65 },
      end: { x: -1.13, y: 1.09 },
      lengthNM: 2.8,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: -0.95, y: -1.75 },
    },
    '35R': {
      id: '35R',
      oppositeId: '17L',
      physicalStripId: 'ZSPD_EAST',
      pairName: 'RWY 35R/17L (东侧四号错列跑道 348°)',
      directionGroup: '09',
      role: 'PRIMARY_DEP',
      heading: 348,
      threshold: { x: 0.85, y: -0.65 },
      end: { x: 0.27, y: 2.09 },
      lengthNM: 2.8,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: 1.25, y: -0.55 },
    },
    '16R': {
      id: '16R',
      oppositeId: '34L',
      physicalStripId: 'ZSPD_WEST',
      pairName: 'RWY 34L/16R (西侧一号跑道 168°)',
      directionGroup: '27',
      role: 'PRIMARY_ARR',
      heading: 168,
      threshold: { x: -1.13, y: 1.09 },
      end: { x: -0.55, y: -1.65 },
      lengthNM: 2.8,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: -1.53, y: 1.00 },
    },
    '17L': {
      id: '17L',
      oppositeId: '35R',
      physicalStripId: 'ZSPD_EAST',
      pairName: 'RWY 35R/17L (东侧四号错列跑道 168°)',
      directionGroup: '27',
      role: 'PRIMARY_DEP',
      heading: 168,
      threshold: { x: 0.27, y: 2.09 },
      end: { x: 0.85, y: -0.65 },
      lengthNM: 2.8,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: 0.67, y: 2.18 },
    },
  },
  waypoints: [
    {
      id: 'DUMET',
      name: 'DUMET',
      position: { x: 2.26, y: -14.85 },
      role: 'IF',
      recommendedAltitude: 3000,
      description: '杭州湾南五边中间进近点 (RWY 34L/35R IF · 标准层 900m/3000ft, ≤195kt)',
    },
    {
      id: 'PUDNG',
      name: 'PUDNG',
      position: { x: 0.99, y: -8.89 },
      role: 'FAF',
      recommendedAltitude: 2000,
      description: '浦东 34L/35R 南五边最终进近点 (FAF · 标准层 600m/2000ft, ≤175kt)',
    },
    {
      id: 'HSN',
      name: 'HSN',
      position: { x: 11.5, y: -14.5 },
      role: 'TRANSITION',
      recommendedAltitude: 6000,
      description: '舟山方向东南洋面进港汇聚点 (IAF · 西向双数层 1800m/6000ft)',
    },
    {
      id: 'AND',
      name: 'AND',
      position: { x: -9.5, y: -9.5 },
      role: 'TRANSITION',
      recommendedAltitude: 5000,
      description: '安亭方向西南内陆进港过渡点 (IAF · 东向单数层 1500m/5000ft)',
    },
    {
      id: 'CHONG',
      name: 'CHONG',
      position: { x: -3.98, y: 14.49 },
      role: 'IF',
      recommendedAltitude: 3000,
      description: '崇明岛北五边中间进近点 (RWY 16R/17L IF · 标准层 900m/3000ft)',
    },
    {
      id: 'JIANG',
      name: 'JIANG',
      position: { x: -2.77, y: 8.82 },
      role: 'FAF',
      recommendedAltitude: 2000,
      description: '长江口北五边最终进近点 (RWY 16R/17L FAF · 标准层 600m/2000ft)',
    },
    {
      id: 'ODULO',
      name: 'ODULO',
      position: { x: 15.5, y: 9.0 },
      role: 'EXIT',
      recommendedAltitude: 6000,
      description: '东海东北远洋离场移交走廊 (SID 移交点 · 标准层 1800m/6000ft)',
    },
    {
      id: 'NSH',
      name: 'NSH',
      position: { x: -8.5, y: 16.5 },
      role: 'EXIT',
      recommendedAltitude: 6000,
      description: '南通北向干线离场移交走廊 (SID 移交点 · 标准层 1800m/6000ft)',
    },
  ],
  procedures: [
    {
      id: 'HSN-1A',
      name: 'HSN-1A (34L/35R 东海进场)',
      type: 'STAR',
      runwayConfig: '09',
      description: 'HSN(1800m) → DUMET(900m) → PUDNG(600m → 自动对正 34L/35R 盲降)',
      legs: [
        { waypointId: 'HSN', targetAltitude: 6000, maxSpeed: 220 },
        { waypointId: 'DUMET', targetAltitude: 3000, maxSpeed: 190 },
        { waypointId: 'PUDNG', targetAltitude: 2000, maxSpeed: 170 },
      ],
    },
    {
      id: 'AND-2A',
      name: 'AND-2A (34L/35R 内陆进场)',
      type: 'STAR',
      runwayConfig: '09',
      description: 'AND(1500m) → DUMET(900m) → PUDNG(600m → 自动对正 34L/35R 盲降)',
      legs: [
        { waypointId: 'AND', targetAltitude: 5000, maxSpeed: 220 },
        { waypointId: 'DUMET', targetAltitude: 3000, maxSpeed: 190 },
        { waypointId: 'PUDNG', targetAltitude: 2000, maxSpeed: 170 },
      ],
    },
    {
      id: 'CHONG-1B',
      name: 'CHONG-1B (16R/17L 换端进场)',
      type: 'STAR',
      runwayConfig: '27',
      description: 'CHONG(900m) → JIANG(600m → 自动对正 16R/17L 盲降)',
      legs: [
        { waypointId: 'CHONG', targetAltitude: 3000, maxSpeed: 190 },
        { waypointId: 'JIANG', targetAltitude: 2000, maxSpeed: 170 },
      ],
    },
    {
      id: 'ODULO-1D',
      name: 'ODULO-1D (东海远洋离场 SID)',
      type: 'SID',
      runwayConfig: '09',
      description: '起飞初始爬升 1200m → 直飞 ODULO 爬升至 1800m (6000ft / 250kt)',
      legs: [{ waypointId: 'ODULO', targetAltitude: 6000, maxSpeed: 250 }],
    },
    {
      id: 'NSH-2D',
      name: 'NSH-2D (江北走廊离场 SID)',
      type: 'SID',
      runwayConfig: '09',
      description: '起飞初始爬升 1200m → 直飞 NSH 爬升至 1800m (6000ft / 250kt)',
      legs: [{ waypointId: 'NSH', targetAltitude: 6000, maxSpeed: 250 }],
    },
  ],
  arrivalGates: [
    {
      id: 'PVG-SE',
      name: 'EAST CHINA SEA SE',
      position: { x: 16.5, y: -18.5 },
      initialHeading: 315,
      initialAltitude: 6000,
      initialSpeed: 235,
      defaultStarId: 'HSN-1A',
    },
    {
      id: 'PVG-S',
      name: 'HANGZHOU BAY S',
      position: { x: 2.5, y: -23.5 },
      initialHeading: 350,
      initialAltitude: 4000,
      initialSpeed: 220,
      defaultStarId: 'HSN-1A',
    },
    {
      id: 'PVG-SW',
      name: 'ZHEJIANG SW',
      position: { x: -16.5, y: -16.0 },
      initialHeading: 55,
      initialAltitude: 5000,
      initialSpeed: 230,
      defaultStarId: 'AND-2A',
    },
    {
      id: 'PVG-E',
      name: 'OCEANIC EAST',
      position: { x: 22.0, y: -4.0 },
      initialHeading: 240,
      initialAltitude: 8000,
      initialSpeed: 240,
      defaultStarId: 'HSN-1A',
    },
  ],
  departureExits: ['ODULO', 'NSH'],
  terrainPolygons: [
    {
      id: 'PUDONG-COASTLINE',
      label: '浦东长江口海岸线',
      kind: 'COASTLINE',
      points: [
        { x: -9, y: 12 },
        { x: -1.5, y: 6.5 },
        { x: 2.8, y: 2.2 },
        { x: 3.2, y: -5.5 },
        { x: -1.2, y: -11.5 },
        { x: -14, y: -15 },
      ],
    },
    {
      id: 'CHONGMING-ISLAND',
      label: '崇明岛',
      kind: 'ISLAND',
      closed: true,
      points: [
        { x: -14, y: 18 },
        { x: -1, y: 12 },
        { x: 2, y: 14 },
        { x: -10, y: 21 },
      ],
    },
  ],
  restrictedZones: [
    {
      id: 'ZSSS-TMA',
      nameCn: 'ZSSS 虹桥塔台管制禁入区',
      nameEn: 'HONGQIAO TOWER RESTRICTED',
      center: { x: -13.0, y: 1.5 }, // 位于正西 13NM 内陆，与南北向 34L/16R 五边相距 >11NM，互不干扰
      radiusNM: 3.2,
      maxAltitudeFt: 4000, // 1200m
    },
  ],
  preferredAirlines: ['CES', 'CSN', 'CCA', 'CHH', 'CPA', 'CKK', 'SIA', 'ANA'],
};

/**
 * 4. EGLL — 伦敦希思罗国际机场 (London Heathrow Airport)
 * 构型：正西向宽距平行双跑道 (27L/09R & 27R/09L, 默认向西 270°) + 伦敦经典四角盘旋等待栈 (BNN / LAM / BIG / OCK)
 * 核实修正：
 * - 27L/27R (270°) 西向进场：LAM/BIG(1200m) -> CITYL(900m, IF) -> THAME(600m, FAF) -> 对正 27L/27R
 * - 09L/09R (090°) 东风换端进场：BNN(1500m) -> WINDS(900m, IF) -> SLOUH(600m, FAF) -> 对正 09L/09R
 * - 威斯敏斯特限高区 EG-R157 移至正北 (0.0, 14.5)，彻底避开东西两端 27L/27R 与 09L/09R 进近五边！
 */
export const HEATHROW_AIRPORT: AirportConfig = {
  id: 'EGLL',
  icao: 'EGLL',
  iata: 'LHR',
  nameEn: 'London Heathrow Airport',
  nameCn: '伦敦希思罗国际机场',
  cityCn: '英国伦敦 · 西向平行双跑道 (27L/27R 270°) + 四角等待栈',
  layoutType: 'PARALLEL_WIDE_STACKS',
  layoutBadgeCn: '西向双跑道 (270°) + 四角等待栈',
  layoutDescCn:
    '默认使用 27L(南跑道) 与 27R(北跑道) 由东向西 (270°) 越过泰晤士河进近；空域四角布设 BNN/OCK(1500m) 与 LAM/BIG(1200m) 四大等待栈，东五边 CITYL-THAME 与西五边 WINDS-SLOUH 精确对正跑道。',
  elevationFt: 83,
  airspaceRadiusNM: 28,
  terminalRadarMinNM: 3.0,
  defaultWindDirDeg: 260,
  defaultWindSpeedKt: 12,
  primaryFlowRunways: {
    arrival: '27L',
    departure: '27R',
    labelCn: '西风运行 27L(降)/27R(起) · 270°',
    labelEn: 'WESTERLY OPS RWY 27L/27R (270°)',
  },
  reverseFlowRunways: {
    arrival: '09L',
    departure: '09R',
    labelCn: '东风运行 09L(降)/09R(起) · 090°',
    labelEn: 'EASTERLY OPS RWY 09L/09R (090°)',
  },
  runways: {
    '27L': {
      id: '27L',
      oppositeId: '09R',
      physicalStripId: 'EGLL_SOUTH',
      pairName: 'RWY 27L/09R (南跑道 270°)',
      directionGroup: '09',
      role: 'PRIMARY_ARR',
      heading: 270,
      threshold: { x: 1.35, y: -0.68 },
      end: { x: -1.35, y: -0.68 },
      lengthNM: 2.7,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: 1.35, y: -1.10 },
    },
    '27R': {
      id: '27R',
      oppositeId: '09L',
      physicalStripId: 'EGLL_NORTH',
      pairName: 'RWY 27R/09L (北跑道 270°)',
      directionGroup: '09',
      role: 'PRIMARY_DEP',
      heading: 270,
      threshold: { x: 1.35, y: 0.68 },
      end: { x: -1.35, y: 0.68 },
      lengthNM: 2.7,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: 1.35, y: 1.10 },
    },
    '09L': {
      id: '09L',
      oppositeId: '27R',
      physicalStripId: 'EGLL_NORTH',
      pairName: 'RWY 09L/27R (北跑道 090°)',
      directionGroup: '27',
      role: 'PRIMARY_ARR',
      heading: 90,
      threshold: { x: -1.35, y: 0.68 },
      end: { x: 1.35, y: 0.68 },
      lengthNM: 2.7,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: -1.35, y: 1.10 },
    },
    '09R': {
      id: '09R',
      oppositeId: '27L',
      physicalStripId: 'EGLL_SOUTH',
      pairName: 'RWY 09R/27L (南跑道 090°)',
      directionGroup: '27',
      role: 'PRIMARY_DEP',
      heading: 90,
      threshold: { x: -1.35, y: -0.68 },
      end: { x: 1.35, y: -0.68 },
      lengthNM: 2.7,
      ilsRangeNM: 16,
      glideslopeDeg: 3.0,
      holdingPoint: { x: -1.35, y: -1.10 },
    },
  },
  waypoints: [
    {
      id: 'BNN',
      name: 'BNN',
      position: { x: -9.5, y: 11.5 },
      role: 'HOLD_STACK',
      recommendedAltitude: 5000,
      description: 'Bovingdon 西北等待定位栈 (HOLD STACK · 东向单数层 1500m/5000ft)',
    },
    {
      id: 'LAM',
      name: 'LAM',
      position: { x: 12.0, y: 10.5 },
      role: 'HOLD_STACK',
      recommendedAltitude: 4000,
      description: 'Lambourne 东北等待定位栈 (HOLD STACK · 西向双数层 1200m/4000ft)',
    },
    {
      id: 'BIG',
      name: 'BIG',
      position: { x: 12.0, y: -10.5 },
      role: 'HOLD_STACK',
      recommendedAltitude: 4000,
      description: 'Biggin 东南等待定位栈 (HOLD STACK · 西向双数层 1200m/4000ft)',
    },
    {
      id: 'OCK',
      name: 'OCK',
      position: { x: -9.5, y: -10.5 },
      role: 'HOLD_STACK',
      recommendedAltitude: 5000,
      description: 'Ockham 西南等待定位栈 (HOLD STACK · 东向单数层 1500m/5000ft)',
    },
    {
      id: 'CITYL',
      name: 'CITYL',
      position: { x: 14.5, y: -0.68 },
      role: 'IF',
      recommendedAltitude: 3000,
      description: '伦敦东五边中间进近定位点 (RWY 27L/27R IF · 标准层 900m/3000ft, ≤190kt)',
    },
    {
      id: 'THAME',
      name: 'THAME',
      position: { x: 8.5, y: -0.68 },
      role: 'FAF',
      recommendedAltitude: 2000,
      description: '泰晤士河东五边最终进近点 (RWY 27L/27R FAF · 标准层 600m/2000ft, ≤170kt)',
    },
    {
      id: 'WINDS',
      name: 'WINDS',
      position: { x: -13.5, y: 0.68 },
      role: 'IF',
      recommendedAltitude: 3000,
      description: '温莎西五边中间进近定位点 (RWY 09L/09R IF · 标准层 900m/3000ft)',
    },
    {
      id: 'SLOUH',
      name: 'SLOUH',
      position: { x: -7.8, y: 0.68 },
      role: 'FAF',
      recommendedAltitude: 2000,
      description: '温莎西五边最终进近定位点 (RWY 09L/09R FAF · 标准层 600m/2000ft)',
    },
    {
      id: 'DOVR',
      name: 'DOVR',
      position: { x: 15.5, y: -15.5 },
      role: 'EXIT',
      recommendedAltitude: 6000,
      description: '多佛尔海峡东南离场移交走廊 (SID 移交点 · 标准层 1800m/6000ft)',
    },
    {
      id: 'CPT',
      name: 'CPT',
      position: { x: -16.5, y: 4.5 },
      role: 'EXIT',
      recommendedAltitude: 6000,
      description: 'Compton 西向跨大西洋离场移交走廊 (SID 移交点 · 标准层 1800m/6000ft)',
    },
  ],
  procedures: [
    {
      id: 'LAM-27L',
      name: 'LAM-27L (东北栈西向进场)',
      type: 'STAR',
      runwayConfig: '09',
      description: 'LAM(1200m) → CITYL(900m) → THAME(600m → 自动对正 27L/27R 盲降)',
      legs: [
        { waypointId: 'LAM', targetAltitude: 4000, maxSpeed: 220 },
        { waypointId: 'CITYL', targetAltitude: 3000, maxSpeed: 190 },
        { waypointId: 'THAME', targetAltitude: 2000, maxSpeed: 170 },
      ],
    },
    {
      id: 'BIG-27L',
      name: 'BIG-27L (东南栈西向进场)',
      type: 'STAR',
      runwayConfig: '09',
      description: 'BIG(1200m) → CITYL(900m) → THAME(600m → 自动对正 27L/27R 盲降)',
      legs: [
        { waypointId: 'BIG', targetAltitude: 4000, maxSpeed: 220 },
        { waypointId: 'CITYL', targetAltitude: 3000, maxSpeed: 190 },
        { waypointId: 'THAME', targetAltitude: 2000, maxSpeed: 170 },
      ],
    },
    {
      id: 'BNN-09L',
      name: 'BNN-09L (东风 09 换端进场)',
      type: 'STAR',
      runwayConfig: '27',
      description: 'BNN(1500m) → WINDS(900m) → SLOUH(600m → 自动对正 09L/09R 盲降)',
      legs: [
        { waypointId: 'BNN', targetAltitude: 5000, maxSpeed: 210 },
        { waypointId: 'WINDS', targetAltitude: 3000, maxSpeed: 185 },
        { waypointId: 'SLOUH', targetAltitude: 2000, maxSpeed: 170 },
      ],
    },
    {
      id: 'DOVR-1D',
      name: 'DOVR-1D (多佛尔东南离场 SID)',
      type: 'SID',
      runwayConfig: '09',
      description: '起飞初始爬升 1200m → 直飞 DOVR 爬升至 1800m (6000ft / 250kt)',
      legs: [{ waypointId: 'DOVR', targetAltitude: 6000, maxSpeed: 250 }],
    },
    {
      id: 'CPT-2D',
      name: 'CPT-2D (康普顿西向离场 SID)',
      type: 'SID',
      runwayConfig: '09',
      description: '起飞初始爬升 1200m → 直飞 CPT 爬升至 1800m (6000ft / 250kt)',
      legs: [{ waypointId: 'CPT', targetAltitude: 6000, maxSpeed: 250 }],
    },
  ],
  arrivalGates: [
    {
      id: 'LHR-NE',
      name: 'ESSEX NE',
      position: { x: 21.0, y: 14.0 },
      initialHeading: 240,
      initialAltitude: 6000,
      initialSpeed: 230,
      defaultStarId: 'LAM-27L',
    },
    {
      id: 'LHR-SE',
      name: 'KENT SE',
      position: { x: 21.0, y: -14.0 },
      initialHeading: 300,
      initialAltitude: 6000,
      initialSpeed: 225,
      defaultStarId: 'BIG-27L',
    },
    {
      id: 'LHR-NW',
      name: 'MIDLANDS NW',
      position: { x: -18.5, y: 16.0 },
      initialHeading: 125,
      initialAltitude: 7000,
      initialSpeed: 235,
      defaultStarId: 'LAM-27L',
    },
    {
      id: 'LHR-SW',
      name: 'SURREY SW',
      position: { x: -17.5, y: -16.0 },
      initialHeading: 65,
      initialAltitude: 5000,
      initialSpeed: 230,
      defaultStarId: 'BIG-27L',
    },
  ],
  departureExits: ['DOVR', 'CPT'],
  terrainPolygons: [
    {
      id: 'RIVER-THAMES',
      label: '泰晤士河 (River Thames)',
      kind: 'RIVER',
      points: [
        { x: -16, y: -2.5 },
        { x: -6, y: -3.2 },
        { x: -1.5, y: -2.0 },
        { x: 4.5, y: -1.2 },
        { x: 9.5, y: 0.4 },
        { x: 14.5, y: -0.8 },
        { x: 22.0, y: -1.5 },
      ],
    },
  ],
  restrictedZones: [
    {
      id: 'EG-R157',
      nameCn: 'EG-R157 伦敦北郊空域限高区',
      nameEn: 'NORTH LONDON RESTRICTED EG-R157',
      center: { x: 0.0, y: 14.5 }, // 位于正北 14.5NM，完全避开 27L/27R 与 09L/09R 东西五边走廊！
      radiusNM: 2.3,
      maxAltitudeFt: 3000, // 900m
    },
  ],
  preferredAirlines: ['BAW', 'VIR', 'EZY', 'DLH', 'AFR', 'CPA', 'SIA', 'CCA'],
};

/**
 * 4 大截然不同的特色机场数据库
 */
export const AIRPORTS_DATABASE: Record<AirportId, AirportConfig> = {
  ZSHB: HARBOR_AIRPORT,
  RJTT: HANEDA_AIRPORT,
  ZSPD: PUDONG_AIRPORT,
  EGLL: HEATHROW_AIRPORT,
};

/**
 * 根据机场、当前运行方向 ('09' 主运行 / '27' 换端运行) 与单/双跑道模式，返回当前活动的进港与离港跑道
 */
export function getActiveRunwaysForDirection(
  dir: RunwayDirectionConfig,
  runwayCountMode: RunwayCountMode = 'DUAL',
  airportOrId: AirportConfig | AirportId = 'ZSHB'
): {
  arrivalRunway: RunwayId;
  departureRunway: RunwayId;
  allActive: RunwayId[];
  flowLabelCn: string;
  flowLabelEn: string;
} {
  const airport =
    typeof airportOrId === 'string'
      ? AIRPORTS_DATABASE[airportOrId] || HARBOR_AIRPORT
      : airportOrId;
  const pair = dir === '09' ? airport.primaryFlowRunways : airport.reverseFlowRunways;

  if (runwayCountMode === 'SINGLE') {
    return {
      arrivalRunway: pair.arrival,
      departureRunway: pair.arrival,
      allActive: [pair.arrival],
      flowLabelCn: `${pair.arrival}(单跑道混合起降)`,
      flowLabelEn: `SINGLE RWY ${pair.arrival}`,
    };
  }
  return {
    arrivalRunway: pair.arrival,
    departureRunway: pair.departure,
    allActive: [pair.arrival, pair.departure],
    flowLabelCn: pair.labelCn,
    flowLabelEn: pair.labelEn,
  };
}

export const AIRCRAFT_MODELS: Record<string, AircraftModelSpec> = {
  A388: {
    typeCode: 'A388',
    name: 'Airbus A380-800 (SUPER)',
    wakeCategory: 'SUPER',
    wakeCode: 'J',
    recatCode: 'A',
    mtowKg: 560000,
    cruiseSpeed: 250,
    approachSpeed: 145,
    touchdownSpeed: 136,
    rotationSpeed: 155,
    minSpeed: 138,
    maxSpeed: 295,
    maxTurnRate: 2.2,
    maxClimbRate: 1800,
    maxDescentRate: 1500,
    acceleration: 1.7,
    takeoffAccel: 4.8,
    landingDecel: 6.5,
  },
  B77W: {
    typeCode: 'B77W',
    name: 'Boeing 777-300ER (HEAVY)',
    wakeCategory: 'HEAVY',
    wakeCode: 'H',
    recatCode: 'B',
    mtowKg: 351500,
    cruiseSpeed: 250,
    approachSpeed: 149,
    touchdownSpeed: 140,
    rotationSpeed: 154,
    minSpeed: 142,
    maxSpeed: 295,
    maxTurnRate: 2.4,
    maxClimbRate: 2000,
    maxDescentRate: 1650,
    acceleration: 1.9,
    takeoffAccel: 5.4,
    landingDecel: 7.0,
  },
  A333: {
    typeCode: 'A333',
    name: 'Airbus A330-300 (HEAVY)',
    wakeCategory: 'HEAVY',
    wakeCode: 'H',
    recatCode: 'B',
    mtowKg: 242000,
    cruiseSpeed: 250,
    approachSpeed: 145,
    touchdownSpeed: 136,
    rotationSpeed: 150,
    minSpeed: 138,
    maxSpeed: 290,
    maxTurnRate: 2.5,
    maxClimbRate: 1900,
    maxDescentRate: 1600,
    acceleration: 1.8,
    takeoffAccel: 5.2,
    landingDecel: 6.8,
  },
  A320: {
    typeCode: 'A320',
    name: 'Airbus A320-200 (MEDIUM)',
    wakeCategory: 'MEDIUM',
    wakeCode: 'M',
    recatCode: 'D',
    mtowKg: 78000,
    cruiseSpeed: 250,
    approachSpeed: 140,
    touchdownSpeed: 131,
    rotationSpeed: 144,
    minSpeed: 134,
    maxSpeed: 285,
    maxTurnRate: 3.0,
    maxClimbRate: 2200,
    maxDescentRate: 1800,
    acceleration: 2.2,
    takeoffAccel: 6.0,
    landingDecel: 7.5,
  },
  B738: {
    typeCode: 'B738',
    name: 'Boeing 737-800 (MEDIUM)',
    wakeCategory: 'MEDIUM',
    wakeCode: 'M',
    recatCode: 'D',
    mtowKg: 79000,
    cruiseSpeed: 250,
    approachSpeed: 143,
    touchdownSpeed: 134,
    rotationSpeed: 146,
    minSpeed: 136,
    maxSpeed: 285,
    maxTurnRate: 3.0,
    maxClimbRate: 2300,
    maxDescentRate: 1900,
    acceleration: 2.3,
    takeoffAccel: 6.2,
    landingDecel: 7.8,
  },
  C919: {
    typeCode: 'C919',
    name: 'COMAC C919 (MEDIUM)',
    wakeCategory: 'MEDIUM',
    wakeCode: 'M',
    recatCode: 'D',
    mtowKg: 77300,
    cruiseSpeed: 245,
    approachSpeed: 139,
    touchdownSpeed: 130,
    rotationSpeed: 142,
    minSpeed: 133,
    maxSpeed: 280,
    maxTurnRate: 3.0,
    maxClimbRate: 2100,
    maxDescentRate: 1800,
    acceleration: 2.1,
    takeoffAccel: 5.8,
    landingDecel: 7.5,
  },
  C208: {
    typeCode: 'C208',
    name: 'Cessna 208 Caravan (LIGHT)',
    wakeCategory: 'LIGHT',
    wakeCode: 'L',
    recatCode: 'F',
    mtowKg: 3969,
    cruiseSpeed: 175,
    approachSpeed: 105,
    touchdownSpeed: 90,
    rotationSpeed: 95,
    minSpeed: 88,
    maxSpeed: 185,
    maxTurnRate: 3.5,
    maxClimbRate: 1400,
    maxDescentRate: 1400,
    acceleration: 2.4,
    takeoffAccel: 5.5,
    landingDecel: 8.0,
  },
};

export interface AirlineBrandInfo {
  icao: string;
  callsignPrefix: string;
  nameCn: string;
  primaryColor: string;
  accentColor: string;
  svgInner: string;
}

export const AIRLINES: AirlineBrandInfo[] = [
  {
    icao: 'CES',
    callsignPrefix: 'CHINA EASTERN',
    nameCn: '东方航空',
    primaryColor: '#0f2b5b',
    accentColor: '#e11d48',
    svgInner:
      '<circle cx="12" cy="12" r="9.5" fill="#0f2b5b" stroke="#38bdf8" stroke-width="1"/><path d="M5 11.5 C9 7, 15 7, 19 10.5 C15 10.5, 11 11, 5 11.5 Z" fill="#e11d48"/><path d="M5 13 C10 13, 14 14.5, 18.5 16.5 C13.5 16.8, 9 15.5, 5 13 Z" fill="#2563eb"/><circle cx="15.5" cy="9.8" r="1.1" fill="#ffffff"/>',
  },
  {
    icao: 'CCA',
    callsignPrefix: 'AIR CHINA',
    nameCn: '中国国航',
    primaryColor: '#991b1b',
    accentColor: '#fbbf24',
    svgInner:
      '<circle cx="12" cy="12" r="9.5" fill="#7f1d1d" stroke="#f87171" stroke-width="1"/><path d="M7 15.5 C6.5 10, 10.5 6, 15.5 6.8 C12.5 8.5, 11.2 11.5, 13.8 13.5 C15.8 14.8, 17.5 13.5, 18 11.5 C17.8 15.8, 13 18.2, 7 15.5 Z" fill="#ef4444" stroke="#fde047" stroke-width="0.9"/><circle cx="13.5" cy="9.2" r="1.2" fill="#fde047"/>',
  },
  {
    icao: 'CSN',
    callsignPrefix: 'CHINA SOUTHERN',
    nameCn: '南方航空',
    primaryColor: '#0284c7',
    accentColor: '#ef4444',
    svgInner:
      '<circle cx="12" cy="12" r="9.5" fill="#0369a1" stroke="#38bdf8" stroke-width="1"/><path d="M12 5.2 L14.1 9.8 L18.5 9.2 L15.2 12.8 L16.5 17.2 L12 14.8 L7.5 17.2 L8.8 12.8 L5.5 9.2 L9.9 9.8 Z" fill="#ef4444" stroke="#ffffff" stroke-width="0.7"/><circle cx="12" cy="11.8" r="1.6" fill="#fde047"/>',
  },
  {
    icao: 'CHH',
    callsignPrefix: 'HAINAN',
    nameCn: '海南航空',
    primaryColor: '#b91c1c',
    accentColor: '#f59e0b',
    svgInner:
      '<circle cx="12" cy="12" r="9.5" fill="#991b1b" stroke="#fbbf24" stroke-width="1.2"/><circle cx="12" cy="8.2" r="2.2" fill="#fde047"/><path d="M5.2 14.2 Q12 10.2 18.8 14.2 Q12 17.5 5.2 14.2 Z" fill="#f59e0b"/><path d="M7.5 16.5 Q12 14.2 16.5 16.5" stroke="#fef08a" stroke-width="1.3" fill="none"/>',
  },
  {
    icao: 'CPA',
    callsignPrefix: 'CATHAY',
    nameCn: '国泰航空',
    primaryColor: '#065f46',
    accentColor: '#f8fafc',
    svgInner:
      '<rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#065f46" stroke="#34d399" stroke-width="1"/><path d="M6.5 16.8 C9.5 14.5, 13.2 10.5, 17.5 6.2 C15.2 11.2, 13.5 14.5, 14.5 16.8 Z" fill="#ffffff"/><path d="M5.5 17.5 L18.5 17.5" stroke="#ef4444" stroke-width="1.3"/>',
  },
  {
    icao: 'CXA',
    callsignPrefix: 'XIAMEN AIR',
    nameCn: '厦门航空',
    primaryColor: '#0284c7',
    accentColor: '#ffffff',
    svgInner:
      '<rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#0284c7" stroke="#7dd3fc" stroke-width="1"/><path d="M6 16.2 C8.5 12, 12.5 8.5, 18 7 C14.5 10.8, 12.8 13.5, 15.5 16.2 Z" fill="#ffffff"/>',
  },
  {
    icao: 'CSC',
    callsignPrefix: 'SICHUAN',
    nameCn: '四川航空',
    primaryColor: '#b91c1c',
    accentColor: '#fbbf24',
    svgInner:
      '<circle cx="12" cy="12" r="9.5" fill="#991b1b" stroke="#fbbf24" stroke-width="1.1"/><path d="M6 13.5 Q12 7 18 11.5 Q13 13 6 13.5 Z" fill="#fde047"/><path d="M7.5 16 Q12 13 17 15.5" stroke="#ffffff" stroke-width="1.3" fill="none"/>',
  },
  {
    icao: 'CKK',
    callsignPrefix: 'CARGO KING',
    nameCn: '中货航',
    primaryColor: '#1e3a8a',
    accentColor: '#f59e0b',
    svgInner:
      '<rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="#1e3a8a" stroke="#f59e0b" stroke-width="1.1"/><polygon points="6,15 11,7 18,7 13,15" fill="#f59e0b"/><polygon points="10,17 14,11 19,11 15,17" fill="#ef4444"/>',
  },
  {
    icao: 'ANA',
    callsignPrefix: 'ALL NIPPON',
    nameCn: '全日空',
    primaryColor: '#00205b',
    accentColor: '#00a0e9',
    svgInner:
      '<rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="#00205b" stroke="#38bdf8" stroke-width="1"/><polygon points="6,17.5 12.2,5.5 15.5,5.5 9.3,17.5" fill="#1d4ed8"/><polygon points="10.2,17.5 16.2,5.5 18.8,5.5 12.8,17.5" fill="#00a0e9"/>',
  },
  {
    icao: 'JAL',
    callsignPrefix: 'JAPAN AIR',
    nameCn: '日本航空',
    primaryColor: '#dc2626',
    accentColor: '#ffffff',
    svgInner:
      '<circle cx="12" cy="12" r="9.5" fill="#dc2626" stroke="#ffffff" stroke-width="1.1"/><path d="M6.5 11.5 C6.5 8, 9.5 6, 12 6 C14.5 6, 17.5 8, 17.5 11.5 C15.2 9.8, 13.5 9.8, 12 12.2 C10.5 9.8, 8.8 9.8, 6.5 11.5 Z" fill="#ffffff"/><polygon points="10.5,14.5 13.5,14.5 12,18" fill="#ffffff"/>',
  },
  {
    icao: 'SKY',
    callsignPrefix: 'SKYMARK',
    nameCn: '天马航空',
    primaryColor: '#1e1b4b',
    accentColor: '#facc15',
    svgInner:
      '<rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#1e1b4b" stroke="#60a5fa" stroke-width="1"/><polygon points="12,5 14,9.8 19,10.2 15,13.5 16.3,18.5 12,15.8 7.7,18.5 9,13.5 5,10.2 10,9.8" fill="#facc15"/>',
  },
  {
    icao: 'ADO',
    callsignPrefix: 'AIR DO',
    nameCn: '北海道航空',
    primaryColor: '#0284c7',
    accentColor: '#fde047',
    svgInner:
      '<rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#0284c7" stroke="#fde047" stroke-width="1.1"/><circle cx="12" cy="12" r="4.5" fill="#fde047"/><path d="M12 5 L12 19 M5 12 L19 12" stroke="#ffffff" stroke-width="1.4"/>',
  },
  {
    icao: 'BAW',
    callsignPrefix: 'SPEEDBIRD',
    nameCn: '英国航空',
    primaryColor: '#1e3a8a',
    accentColor: '#ef4444',
    svgInner:
      '<rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#0f172a" stroke="#60a5fa" stroke-width="1"/><path d="M4.5 11.5 C9.5 8.5, 15.5 8.5, 19.5 10.5 C14.5 11.2, 9.5 12.2, 5.5 14 Z" fill="#ffffff"/><path d="M5.5 14 C10.5 12.8, 15 13.2, 18.8 15.8 C13.8 16.5, 8.8 15.8, 5.5 14 Z" fill="#ef4444"/>',
  },
  {
    icao: 'VIR',
    callsignPrefix: 'VIRGIN',
    nameCn: '维珍大西洋',
    primaryColor: '#be123c',
    accentColor: '#f8fafc',
    svgInner:
      '<rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#be123c" stroke="#fda4af" stroke-width="1"/><path d="M6 7.5 L11.5 16.8 L18 7.5 L15.2 7.5 L11.5 13.5 L8.8 7.5 Z" fill="#ffffff"/>',
  },
  {
    icao: 'EZY',
    callsignPrefix: 'EASY',
    nameCn: '易捷航空',
    primaryColor: '#ea580c',
    accentColor: '#ffffff',
    svgInner:
      '<rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#ea580c" stroke="#fed7aa" stroke-width="1"/><polygon points="5,16.5 13,6.5 18.5,6.5 10.5,16.5" fill="#ffffff"/>',
  },
  {
    icao: 'DLH',
    callsignPrefix: 'LUFTHANSA',
    nameCn: '汉莎航空',
    primaryColor: '#0f172a',
    accentColor: '#facc15',
    svgInner:
      '<circle cx="12" cy="12" r="9.5" fill="#0f172a" stroke="#facc15" stroke-width="1.4"/><path d="M6 13.2 L12.5 8.2 L11.5 11.2 L18 10.5 L12.2 14.8 L9.5 13.5 Z" fill="#facc15"/>',
  },
  {
    icao: 'AFR',
    callsignPrefix: 'AIRFRANS',
    nameCn: '法国航空',
    primaryColor: '#1e3a8a',
    accentColor: '#ef4444',
    svgInner:
      '<rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#f8fafc" stroke="#94a3b8" stroke-width="1"/><polygon points="5,17 10,6.5 13,6.5 8,17" fill="#1e3a8a"/><polygon points="9.5,17 14.5,6.5 16.2,6.5 11.2,17" fill="#ffffff"/><polygon points="12,17 17,6.5 19.5,6.5 14.5,17" fill="#ef4444"/>',
  },
  {
    icao: 'SIA',
    callsignPrefix: 'SINGAPORE',
    nameCn: '新加坡航空',
    primaryColor: '#172554',
    accentColor: '#f59e0b',
    svgInner:
      '<rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#172554" stroke="#f59e0b" stroke-width="1.1"/><path d="M12 5.5 L15.5 11.5 L19 13 L13.5 14.5 L12 18.5 L10.5 14.5 L5 13 L8.5 11.5 Z" fill="#fbbf24"/>',
  },
];

/**
 * 根据航班呼号或航司三字码返回专属 SVG 航徽 Data URI 与品牌配色
 */
export function getAirlineBrandByCallsign(callsignOrIcao: string): {
  icao: string;
  nameCn: string;
  primaryColor: string;
  accentColor: string;
  logoDataUri: string;
} {
  const prefix = (callsignOrIcao || '').slice(0, 3).toUpperCase();
  const found = AIRLINES.find((a) => a.icao === prefix);
  const inner =
    found?.svgInner ||
    '<circle cx="12" cy="12" r="9.5" fill="#0f172a" stroke="#38bdf8" stroke-width="1.2"/><path d="M6 13 L18 9 L14 15 L11 13 Z" fill="#38bdf8"/>';
  const svgXml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">${inner}</svg>`;
  return {
    icao: found?.icao || prefix || 'ATC',
    nameCn: found?.nameCn || '民航航班',
    primaryColor: found?.primaryColor || '#0f172a',
    accentColor: found?.accentColor || '#38bdf8',
    logoDataUri: `data:image/svg+xml;utf8,${encodeURIComponent(svgXml)}`,
  };
}

/**
 * Steam / Apple Game Center / Xbox 商业发行级 12 项生涯成就定义
 */
export const CAREER_ACHIEVEMENTS_CATALOG: Omit<CareerAchievement, 'unlocked' | 'unlockedAt'>[] = [
  {
    id: 'FIRST_LANDING',
    titleCn: '初试锋芒 · 首架安全落地',
    titleEn: 'First Safe Touchdown',
    descCn: '成功引导第一架进港航班截获盲降并安全着陆脱离。',
    icon: '🛬',
  },
  {
    id: 'FIRST_HANDOFF',
    titleCn: '蓝天接力 · 首次离场移交',
    titleEn: 'Cleared to Enroute',
    descCn: '成功指挥一架离港航班起飞爬升并完成区域管制移交。',
    icon: '🛫',
  },
  {
    id: 'SHIFT_COMPLETED',
    titleCn: '值班圆满 · 首次通关班次',
    titleEn: 'Tour of Duty Complete',
    descCn: '完整达成单局 8 进港 + 3 离港目标并顺利结班。',
    icon: '🎖️',
  },
  {
    id: 'S_RANK_MASTER',
    titleCn: '首席教员 · 零违章 S 级评价',
    titleEn: 'ICAO Chief Instructor (Rank S)',
    descCn: '在零冲突告警、高分状态下获得 S 级（ICAO 首席雷达管制教员）评定。',
    icon: '🏆',
  },
  {
    id: 'MAYDAY_SAVIOR',
    titleCn: '特情守护神 · 7700 紧急救援',
    titleEn: 'Mayday Savior (Squawk 7700)',
    descCn: '成功优先引导一架挂出 7700（发动机火警或燃油紧急）的特情航班安全落地。',
    icon: '🚨',
  },
  {
    id: 'NORDO_WHISPERER',
    titleCn: '静默护航 · 7600 失联机保障',
    titleEn: 'NORDO Whisperer (Squawk 7600)',
    descCn: '成功清空五边走廊，保障一架 7600 无线电失联航班自主盲降落地。',
    icon: '📻',
  },
  {
    id: 'HANEDA_CROSSWIND',
    titleCn: '东京湾之鹰 · 羽田交叉跑道执勤',
    titleEn: 'Haneda Intersecting Master',
    descCn: '在东京羽田国际机场 (RJTT) 交叉双跑道 (34R × 22) 模式下完成航班起降。',
    icon: '🗼',
  },
  {
    id: 'PUDONG_HEAVY_HUB',
    titleCn: '东海枢纽 · 浦东错列双跑道执勤',
    titleEn: 'Pudong Staggered Hub',
    descCn: '在上海浦东国际机场 (ZSPD) 34L/35R 错列平行跑道模式下完成航班起降。',
    icon: '🏙️',
  },
  {
    id: 'HEATHROW_STACK_PRO',
    titleCn: '泰晤士指挥家 · 希思罗四栈调度',
    titleEn: 'Heathrow Stack Maestro',
    descCn: '在伦敦希思罗国际机场 (EGLL) 27L/27R 西向平行跑道模式下完成航班起降。',
    icon: '🎡',
  },
  {
    id: 'RECAT_SPECIALIST',
    titleCn: '尾流精算师 · RECAT-EU 6级认证',
    titleEn: 'RECAT-EU Wake Specialist',
    descCn: '开启 RECAT-EU 六级精细尾流标准完成进港排序与落地。',
    icon: '📐',
  },
  {
    id: 'DRAG_VECTOR_ACE',
    titleCn: '指尖领航 · 雷达直接拖拽引导',
    titleEn: 'Tactical Drag-Vector Ace',
    descCn: '在雷达屏幕上直接按住飞机拖拽航向线或吸附航路点下达管制指令。',
    icon: '🎯',
  },
  {
    id: 'VETERAN_50_MOVEMENTS',
    titleCn: '万米守望者 · 生涯累计 50 架次起降',
    titleEn: '50 Safe Movements Veteran',
    descCn: '生涯累计安全引导着陆与离场移交总数达到 50 架次。',
    icon: '⭐',
  },
];
