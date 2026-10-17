import {
  Aircraft,
  AirportConfig,
  EmergencyType,
  FlightCategory,
  GameDifficulty,
  ProcedureLeg,
  RunwayCountMode,
  RunwayDirectionConfig,
  RunwayId,
} from '../aircraft/types';
import {
  AIRCRAFT_MODELS,
  AIRLINES,
  AirlineBrandInfo,
  getActiveRunwaysForDirection,
} from '../airport/harborAirport';
import {
  distanceNM,
  getIcaoDirectionalLevelsFt,
  getRunwayConfig,
} from '../aircraft/physics';

export interface DifficultyConfig {
  difficulty: GameDifficulty;
  labelCn: string;
  labelEn: string;
  spawnIntervalSec: number;
  maxConcurrentActive: number;
  initialArrivals: number;
  initialDepartures: number;
}

export const DIFFICULTY_CONFIGS: Record<GameDifficulty, DifficultyConfig> = {
  EASY: {
    difficulty: 'EASY',
    labelCn: '简单 (低流量)',
    labelEn: 'EASY',
    spawnIntervalSec: 55,
    maxConcurrentActive: 5,
    initialArrivals: 2,
    initialDepartures: 1,
  },
  NORMAL: {
    difficulty: 'NORMAL',
    labelCn: '普通 (标准流量)',
    labelEn: 'NORMAL',
    spawnIntervalSec: 38,
    maxConcurrentActive: 8,
    initialArrivals: 3,
    initialDepartures: 2,
  },
  HARD: {
    difficulty: 'HARD',
    labelCn: '困难 (高峰流量)',
    labelEn: 'HARD',
    spawnIntervalSec: 24,
    maxConcurrentActive: 11,
    initialArrivals: 4,
    initialDepartures: 2,
  },
};

const MODEL_KEYS = ['A320', 'B738', 'C919', 'A333', 'B77W', 'A388', 'C208'];

let nextNumericId = 1;
const usedCallsigns = new Set<string>();

export function resetSpawnerCounters(): void {
  nextNumericId = 1;
  usedCallsigns.clear();
}

function generateUniqueCallsign(
  seedIndex: number,
  airport?: AirportConfig
): {
  callsign: string;
  airlineName: string;
  airlineCn: string;
} {
  let pool: AirlineBrandInfo[] = AIRLINES;
  if (airport?.preferredAirlines && airport.preferredAirlines.length > 0) {
    const filtered = AIRLINES.filter((a) => airport.preferredAirlines!.includes(a.icao));
    if (filtered.length > 0) {
      pool = filtered;
    }
  }
  const airline = pool[seedIndex % pool.length];
  let flightNum = 100 + ((seedIndex * 373 + 213) % 890);
  let callsign = `${airline.icao}${flightNum}`;
  while (usedCallsigns.has(callsign)) {
    flightNum = ((flightNum + 17) % 8900) + 100;
    callsign = `${airline.icao}${flightNum}`;
  }
  usedCallsigns.add(callsign);
  return {
    callsign,
    airlineName: airline.callsignPrefix,
    airlineCn: airline.nameCn,
  };
}

function generateOctalSquawk(seed: number): string {
  const d1 = (seed % 6) + 1;
  const d2 = (seed * 3) % 8;
  const d3 = (seed * 5 + 2) % 8;
  const d4 = (seed * 7 + 1) % 8;
  return `${d1}${d2}${d4}${d3}`;
}

/**
 * 创建初始开局航班队列
 * 严格遵循 ICAO Annex 2 / CAAC 300米 (1000英尺) 标准高度层配备表与进离场程序高度要求：
 * - 五边中间进近段 (IF)：900m (3000ft)
 * - 交叉/等待或西向双数进场层 (180°–359°)：1200m (4000ft) / 1800m (6000ft) / 2400m (8000ft)
 * - 东向单数进场层 (000°–179°)：1500m (5000ft) / 2100m (7000ft)
 */
export function createInitialTraffic(
  airport: AirportConfig,
  difficulty: GameDifficulty,
  activeDir: RunwayDirectionConfig = '09',
  runwayCountMode: RunwayCountMode = 'DUAL'
): Aircraft[] {
  resetSpawnerCounters();
  const cfg = DIFFICULTY_CONFIGS[difficulty];
  const { arrivalRunway, departureRunway } = getActiveRunwaysForDirection(
    activeDir,
    runwayCountMode,
    airport
  );
  const depRwyCfg = getRunwayConfig(airport, departureRunway);
  const initialList: Aircraft[] = [];

  // 1. 东京羽田国际机场 (RJTT — 交叉跑道 34R 337° × 22 222°)
  if (airport.id === 'RJTT') {
    const secondArrRwy: RunwayId =
      runwayCountMode === 'DUAL' ? departureRunway : arrivalRunway;

    // 1号进港：ANA852 在 KAIHO 五边 IF 段，标准层 900m (3000ft)
    initialList.push(
      createCustomAircraft({
        callsign: 'ANA852',
        airlineName: 'ALL NIPPON',
        airlineCn: '全日空',
        model: 'B77W',
        category: 'ARRIVAL',
        position: { x: 5.4, y: -11.8 },
        heading: 337,
        altitude: 3000, // 900m 标准 IF 进近层
        speed: 188,
        assignedRunway: arrivalRunway,
        entryGateId: 'HND-SOUTH',
        labelOffsetIndex: 0,
      })
    );
    usedCallsigns.add('ANA852');

    // 2号进港：JAL514 在 ARLNS (RWY 22 IF 段，磁航向 222° 西向双数)，标准层 1200m (4000ft)，与 34R 五边错开 300m！
    initialList.push(
      createCustomAircraft({
        callsign: 'JAL514',
        airlineName: 'JAPAN AIR',
        airlineCn: '日本航空',
        model: 'A333',
        category: 'ARRIVAL',
        position: { x: 9.2, y: 10.1 },
        heading: 222,
        altitude: 4000, // 1200m 西向双数标准层 (ARLNS-2B 程序要求高度)
        speed: 195,
        assignedRunway: secondArrRwy,
        entryGateId: 'HND-NE',
        labelOffsetIndex: 2,
      })
    );
    usedCallsigns.add('JAL514');

    if (cfg.initialArrivals >= 3) {
      // 3号进港：SKY107 飞向 MIURA (磁航向 055° 东向单数)，标准层 1500m (5000ft)
      initialList.push(
        createCustomAircraft({
          callsign: 'SKY107',
          airlineName: 'SKYMARK',
          airlineCn: '天马航空',
          model: 'B738',
          category: 'ARRIVAL',
          position: { x: -4.2, y: -15.2 },
          heading: 55,
          altitude: 5000, // 1500m 东向单数标准层 (KAIHO-1A 起始高度)
          speed: 215,
          assignedRunway: arrivalRunway,
          entryGateId: 'HND-SW',
          labelOffsetIndex: 4,
        })
      );
      usedCallsigns.add('SKY107');
    }

    if (cfg.initialArrivals >= 4) {
      // 4号进港：ADO62 磁航向 295° 西向双数，标准层 1800m (6000ft)
      initialList.push(
        createCustomAircraft({
          callsign: 'ADO62',
          airlineName: 'AIR DO',
          airlineCn: '北海道航空',
          model: 'B738',
          category: 'ARRIVAL',
          position: { x: 14.5, y: -11.5 },
          heading: 295,
          altitude: 6000, // 1800m 西向双数标准层
          speed: 225,
          assignedRunway: secondArrRwy,
          entryGateId: 'HND-SE',
          labelOffsetIndex: 6,
        })
      );
      usedCallsigns.add('ADO62');
    }

    initialList.push(
      createCustomAircraft({
        callsign: 'ANA203',
        airlineName: 'ALL NIPPON',
        airlineCn: '全日空',
        model: 'A320',
        category: 'DEPARTURE',
        position: { ...depRwyCfg.holdingPoint },
        heading: depRwyCfg.heading,
        altitude: 0,
        speed: 0,
        assignedRunway: departureRunway,
        assignedExitId: 'OPPER',
        labelOffsetIndex: 1,
      })
    );
    usedCallsigns.add('ANA203');

    if (cfg.initialDepartures >= 2) {
      initialList.push(
        createCustomAircraft({
          callsign: 'JAL309',
          airlineName: 'JAPAN AIR',
          airlineCn: '日本航空',
          model: 'B77W',
          category: 'DEPARTURE',
          position: {
            x: depRwyCfg.holdingPoint.x + 0.32,
            y: depRwyCfg.holdingPoint.y + 0.25,
          },
          heading: depRwyCfg.heading,
          altitude: 0,
          speed: 0,
          assignedRunway: departureRunway,
          assignedExitId: 'URAGA',
          labelOffsetIndex: 3,
        })
      );
      usedCallsigns.add('JAL309');
    }

    return initialList;
  }

  // 2. 上海浦东国际机场 (ZSPD — 南北偏西北 348° 远距错列平行双跑道 34L / 35R)
  if (airport.id === 'ZSPD') {
    const secondArrRwy: RunwayId =
      runwayCountMode === 'DUAL' ? departureRunway : arrivalRunway;

    // 1号进港：CES5101 在 DUMET IF 段，标准层 900m (3000ft)
    initialList.push(
      createCustomAircraft({
        callsign: 'CES5101',
        airlineName: 'CHINA EASTERN',
        airlineCn: '东方航空',
        model: 'C919',
        category: 'ARRIVAL',
        position: { x: 2.1, y: -13.6 },
        heading: 348,
        altitude: 3000, // 900m 标准 IF 进近层
        speed: 188,
        assignedRunway: arrivalRunway,
        entryGateId: 'PVG-S',
        labelOffsetIndex: 0,
      })
    );
    usedCallsigns.add('CES5101');

    // 2号进港：CKK208 在 HSN (磁航向 305° 西向双数)，标准层 1800m (6000ft，匹配 HSN-1A 程序起始高度)
    initialList.push(
      createCustomAircraft({
        callsign: 'CKK208',
        airlineName: 'CARGO KING',
        airlineCn: '中货航',
        model: 'B77W',
        category: 'ARRIVAL',
        position: { x: 10.8, y: -14.2 },
        heading: 305,
        altitude: 6000, // 1800m 西向双数标准层
        speed: 215,
        assignedRunway: secondArrRwy,
        entryGateId: 'PVG-SE',
        labelOffsetIndex: 2,
      })
    );
    usedCallsigns.add('CKK208');

    if (cfg.initialArrivals >= 3) {
      // 3号进港：CSN6522 在 AND (磁航向 065° 东向单数)，标准层 1500m (5000ft，匹配 AND-2A 程序起始高度)
      initialList.push(
        createCustomAircraft({
          callsign: 'CSN6522',
          airlineName: 'CHINA SOUTHERN',
          airlineCn: '南方航空',
          model: 'A333',
          category: 'ARRIVAL',
          position: { x: -9.2, y: -9.5 },
          heading: 65,
          altitude: 5000, // 1500m 东向单数标准层
          speed: 220,
          assignedRunway: arrivalRunway,
          entryGateId: 'PVG-SW',
          labelOffsetIndex: 4,
        })
      );
      usedCallsigns.add('CSN6522');
    }

    if (cfg.initialArrivals >= 4) {
      // 4号进港：SIA830 磁航向 245° 西向双数，标准层 2400m (8000ft)
      initialList.push(
        createCustomAircraft({
          callsign: 'SIA830',
          airlineName: 'SINGAPORE',
          airlineCn: '新加坡航空',
          model: 'A388',
          category: 'ARRIVAL',
          position: { x: 16.5, y: -6.5 },
          heading: 245,
          altitude: 8000, // 2400m 西向双数标准层
          speed: 230,
          assignedRunway: secondArrRwy,
          entryGateId: 'PVG-E',
          labelOffsetIndex: 6,
        })
      );
      usedCallsigns.add('SIA830');
    }

    initialList.push(
      createCustomAircraft({
        callsign: 'CCA915',
        airlineName: 'AIR CHINA',
        airlineCn: '中国国航',
        model: 'A333',
        category: 'DEPARTURE',
        position: { ...depRwyCfg.holdingPoint },
        heading: depRwyCfg.heading,
        altitude: 0,
        speed: 0,
        assignedRunway: departureRunway,
        assignedExitId: 'ODULO',
        labelOffsetIndex: 1,
      })
    );
    usedCallsigns.add('CCA915');

    if (cfg.initialDepartures >= 2) {
      initialList.push(
        createCustomAircraft({
          callsign: 'CES588',
          airlineName: 'CHINA EASTERN',
          airlineCn: '东方航空',
          model: 'A320',
          category: 'DEPARTURE',
          position: {
            x: depRwyCfg.holdingPoint.x + 0.35,
            y: depRwyCfg.holdingPoint.y - 0.25,
          },
          heading: depRwyCfg.heading,
          altitude: 0,
          speed: 0,
          assignedRunway: departureRunway,
          assignedExitId: 'NSH',
          labelOffsetIndex: 3,
        })
      );
      usedCallsigns.add('CES588');
    }

    return initialList;
  }

  // 3. 伦敦希思罗国际机场 (EGLL — 西向 270° 平行双跑道 27L/27R + 四角等待栈 BNN/LAM/BIG/OCK)
  if (airport.id === 'EGLL') {
    const secondArrRwy: RunwayId =
      runwayCountMode === 'DUAL' ? departureRunway : arrivalRunway;

    // 1号进港：BAW117 在 CITYL 五边 IF 段，标准层 900m (3000ft)
    initialList.push(
      createCustomAircraft({
        callsign: 'BAW117',
        airlineName: 'SPEEDBIRD',
        airlineCn: '英国航空',
        model: 'A388',
        category: 'ARRIVAL',
        position: { x: 13.8, y: -0.68 },
        heading: 270,
        altitude: 3000, // 900m 标准 IF 进近层
        speed: 185,
        assignedRunway: arrivalRunway,
        entryGateId: 'LHR-NE',
        labelOffsetIndex: 0,
      })
    );
    usedCallsigns.add('BAW117');

    // 2号进港：VIR402 在 LAM 东北等待栈 (磁航向 215° 西向双数)，标准层 1200m (4000ft)
    initialList.push(
      createCustomAircraft({
        callsign: 'VIR402',
        airlineName: 'VIRGIN',
        airlineCn: '维珍大西洋',
        model: 'B77W',
        category: 'ARRIVAL',
        position: { x: 12.2, y: 10.2 },
        heading: 215,
        altitude: 4000, // 1200m 西向双数等待栈层 (LAM-27L 起始高度)
        speed: 210,
        assignedRunway: arrivalRunway,
        entryGateId: 'LHR-NE',
        labelOffsetIndex: 2,
      })
    );
    usedCallsigns.add('VIR402');

    if (cfg.initialArrivals >= 3) {
      // 3号进港：EZY809 在 BIG 东南等待栈 (磁航向 330° 西向双数)，错开 1800m (6000ft) 标准双数层
      initialList.push(
        createCustomAircraft({
          callsign: 'EZY809',
          airlineName: 'EASY',
          airlineCn: '易捷航空',
          model: 'A320',
          category: 'ARRIVAL',
          position: { x: 12.0, y: -10.2 },
          heading: 330,
          altitude: 6000, // 1800m 西向双数标准层
          speed: 210,
          assignedRunway: secondArrRwy,
          entryGateId: 'LHR-SE',
          labelOffsetIndex: 4,
        })
      );
      usedCallsigns.add('EZY809');
    }

    if (cfg.initialArrivals >= 4) {
      // 4号进港：DLH903 在 BNN 西北等待栈 (磁航向 115° 东向单数)，标准层 1500m (5000ft)
      initialList.push(
        createCustomAircraft({
          callsign: 'DLH903',
          airlineName: 'LUFTHANSA',
          airlineCn: '汉莎航空',
          model: 'A320',
          category: 'ARRIVAL',
          position: { x: -9.5, y: 11.5 },
          heading: 115,
          altitude: 5000, // 1500m 东向单数等待栈层 (BNN 标准高度)
          speed: 225,
          assignedRunway: secondArrRwy,
          entryGateId: 'LHR-NW',
          labelOffsetIndex: 6,
        })
      );
      usedCallsigns.add('DLH903');
    }

    initialList.push(
      createCustomAircraft({
        callsign: 'BAW285',
        airlineName: 'SPEEDBIRD',
        airlineCn: '英国航空',
        model: 'A333',
        category: 'DEPARTURE',
        position: { ...depRwyCfg.holdingPoint },
        heading: depRwyCfg.heading,
        altitude: 0,
        speed: 0,
        assignedRunway: departureRunway,
        assignedExitId: 'CPT',
        labelOffsetIndex: 1,
      })
    );
    usedCallsigns.add('BAW285');

    if (cfg.initialDepartures >= 2) {
      initialList.push(
        createCustomAircraft({
          callsign: 'AFR168',
          airlineName: 'AIRFRANS',
          airlineCn: '法国航空',
          model: 'B738',
          category: 'DEPARTURE',
          position: {
            x: depRwyCfg.holdingPoint.x + 0.35,
            y: depRwyCfg.holdingPoint.y + 0.25,
          },
          heading: depRwyCfg.heading,
          altitude: 0,
          speed: 0,
          assignedRunway: departureRunway,
          assignedExitId: 'DOVR',
          labelOffsetIndex: 3,
        })
      );
      usedCallsigns.add('AFR168');
    }

    return initialList;
  }

  // 4. 默认：海湾国际机场 (ZSHB — 09L/09R 经典东西向平行双跑道)
  initialList.push(
    createCustomAircraft({
      callsign: 'CES5213',
      airlineName: 'CHINA EASTERN',
      airlineCn: '东方航空',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -13.5, y: 2.3 },
      heading: 110,
      altitude: 3000, // 900m 标准 IF 进近层 (BAYVW)
      speed: 190,
      assignedRunway: arrivalRunway,
      entryGateId: 'GATE-NW',
      labelOffsetIndex: 0,
    })
  );
  usedCallsigns.add('CES5213');

  initialList.push(
    createCustomAircraft({
      callsign: 'CCA1802',
      airlineName: 'AIR CHINA',
      airlineCn: '中国国航',
      model: 'B77W',
      category: 'ARRIVAL',
      position: { x: -17.5, y: -9.0 },
      heading: 55,
      altitude: 4000, // 1200m 标准层 (SOUTH-1A 起始高度 4000ft)
      speed: 215,
      assignedRunway: arrivalRunway,
      entryGateId: 'GATE-SW',
      labelOffsetIndex: 2,
    })
  );
  usedCallsigns.add('CCA1802');

  if (cfg.initialArrivals >= 3) {
    initialList.push(
      createCustomAircraft({
        callsign: 'CSN3309',
        airlineName: 'CHINA SOUTHERN',
        airlineCn: '南方航空',
        model: 'C919',
        category: 'ARRIVAL',
        position: { x: -5.5, y: 15.0 },
        heading: 215,
        altitude: 5000, // 1500m 标准层 (NORTH-1A 起始高度 5000ft)
        speed: 225,
        assignedRunway: arrivalRunway,
        entryGateId: 'GATE-N',
        labelOffsetIndex: 4,
      })
    );
    usedCallsigns.add('CSN3309');
  }

  if (cfg.initialArrivals >= 4) {
    initialList.push(
      createCustomAircraft({
        callsign: 'SIA380',
        airlineName: 'SINGAPORE',
        airlineCn: '新加坡航空',
        model: 'A388',
        category: 'ARRIVAL',
        position: { x: -4.0, y: -16.5 },
        heading: 330,
        altitude: 6000, // 1800m 西向双数标准层
        speed: 235,
        assignedRunway: runwayCountMode === 'DUAL' ? departureRunway : arrivalRunway,
        entryGateId: 'GATE-S',
        labelOffsetIndex: 6,
      })
    );
    usedCallsigns.add('SIA380');
  }

  initialList.push(
    createCustomAircraft({
      callsign: 'CHH7601',
      airlineName: 'HAINAN',
      airlineCn: '海南航空',
      model: 'A333',
      category: 'DEPARTURE',
      position: { ...depRwyCfg.holdingPoint },
      heading: depRwyCfg.heading,
      altitude: 0,
      speed: 0,
      assignedRunway: departureRunway,
      assignedExitId: 'OCEAN',
      labelOffsetIndex: 1,
    })
  );
  usedCallsigns.add('CHH7601');

  if (cfg.initialDepartures >= 2) {
    initialList.push(
      createCustomAircraft({
        callsign: 'CXA8190',
        airlineName: 'XIAMEN AIR',
        airlineCn: '厦门航空',
        model: 'B738',
        category: 'DEPARTURE',
        position: {
          x: depRwyCfg.holdingPoint.x - 0.35,
          y: depRwyCfg.holdingPoint.y - 0.25,
        },
        heading: depRwyCfg.heading,
        altitude: 0,
        speed: 0,
        assignedRunway: departureRunway,
        assignedExitId: 'COAST',
        labelOffsetIndex: 3,
      })
    );
    usedCallsigns.add('CXA8190');
  }

  return initialList;
}

export interface CustomAircraftInit {
  callsign: string;
  airlineName: string;
  airlineCn: string;
  model: string;
  category: FlightCategory;
  position: { x: number; y: number };
  heading: number;
  altitude: number;
  speed: number;
  assignedRunway?: RunwayId;
  entryGateId?: string;
  assignedExitId?: string;
  activeProcedureId?: string | null;
  procedureLegs?: ProcedureLeg[];
  emergencyType?: EmergencyType;
  squawkCode?: string;
  radarIdentified?: boolean;
  simTimeSec?: number;
  labelOffsetIndex?: number;
}

export function createCustomAircraft(init: CustomAircraftInit): Aircraft {
  const numericSeed = nextNumericId;
  const id = `AC-${nextNumericId++}`;
  const spec = AIRCRAFT_MODELS[init.model] || AIRCRAFT_MODELS.A320;
  const isDeparture = init.category === 'DEPARTURE';
  const defaultRunway: RunwayId = init.assignedRunway || (isDeparture ? '09R' : '09L');
  const emergencyType: EmergencyType = init.emergencyType || 'NONE';

  let squawk = init.squawkCode || generateOctalSquawk(numericSeed);
  if (emergencyType === 'SQUAWK_7700_ENGINE' || emergencyType === 'SQUAWK_7700_FUEL') {
    squawk = '7700';
  } else if (emergencyType === 'SQUAWK_7600_NORDO') {
    squawk = '7600';
  }

  let cmdTag = isDeparture
    ? `HOLD SHORT ${defaultRunway} -> ${init.assignedExitId || 'EXIT'}`
    : `RADAR CONTACT [${spec.wakeCode}]`;
  if (emergencyType === 'SQUAWK_7700_ENGINE') cmdTag = '🚨 7700 ENG FAIL';
  else if (emergencyType === 'SQUAWK_7700_FUEL') cmdTag = '🚨 7700 MAYDAY FUEL';
  else if (emergencyType === 'SQUAWK_7600_NORDO') cmdTag = '📻 7600 NORDO';

  return {
    id,
    callsign: init.callsign,
    airlineName: init.airlineName,
    airlineCn: init.airlineCn,
    model: spec.typeCode,
    wakeCategory: spec.wakeCategory,
    wakeCode: spec.wakeCode,
    recatCode: spec.recatCode,
    category: init.category,
    phase: isDeparture ? 'HOLDING_GROUND' : 'ARRIVING',
    squawkCode: squawk,
    radarIdentified: init.radarIdentified ?? true,
    identFlashTimerSec: 0,
    emergencyType,
    tcasRaActive: false,
    tcasRaDirection: null,
    ntzPenetration: false,
    position: { ...init.position },
    heading: init.heading,
    targetHeading: init.heading,
    turnDirection: 'AUTO',
    altitude: init.altitude,
    // 离场航班初始放行高度层严格设为 1200m (4000ft)，与上方 1500m (5000ft) 进港流建立 300m 垂直间隔
    targetAltitude: isDeparture ? 4000 : init.altitude,
    preTcasTargetAltitude: null,
    verticalSpeed: 0,
    speed: init.speed,
    groundSpeed: init.speed,
    targetSpeed: isDeparture ? Math.min(230, spec.cruiseSpeed) : init.speed,
    maxTurnRate: spec.maxTurnRate,
    maxClimbRate: spec.maxClimbRate,
    maxDescentRate: spec.maxDescentRate,
    acceleration: spec.acceleration,
    directWaypointId: null,
    activeProcedureId: init.activeProcedureId || null,
    procedureLegs: init.procedureLegs ? [...init.procedureLegs] : [],
    holdState: null,
    clearedApproach: false,
    clearedTakeoff: false,
    independentApproachMode: false,
    assignedRunway: defaultRunway,
    crossingRunwayId: null,
    assignedExitId: init.assignedExitId || null,
    entryGateId: init.entryGateId || null,
    trail: isDeparture ? [] : [{ ...init.position }],
    trailTimer: 0,
    lastCommandText: cmdTag,
    spawnTimeSec: init.simTimeSec || 0,
    canHandoff: false,
    inWeatherHazard: false,
    inRestrictedZone: false,
    conflictLevel: 'NONE',
    labelOffsetIndex: init.labelOffsetIndex ?? (numericSeed % 8),
  };
}

export function spawnNextTraffic(
  airport: AirportConfig,
  existingAircraft: Aircraft[],
  simTimeSec: number,
  spawnCounter: number,
  preferCategory?: FlightCategory,
  activeDir: RunwayDirectionConfig = '09',
  runwayCountMode: RunwayCountMode = 'DUAL',
  enableEmergencies: boolean = false
): Aircraft | null {
  const category: FlightCategory =
    preferCategory || (spawnCounter % 3 === 2 ? 'DEPARTURE' : 'ARRIVAL');
  const { callsign, airlineName, airlineCn } = generateUniqueCallsign(spawnCounter + 10, airport);
  const model = MODEL_KEYS[(spawnCounter + 2) % MODEL_KEYS.length];
  const { arrivalRunway, departureRunway } = getActiveRunwaysForDirection(
    activeDir,
    runwayCountMode,
    airport
  );

  if (category === 'DEPARTURE') {
    const groundQueue = existingAircraft.filter((a) => a.phase === 'HOLDING_GROUND');
    if (groundQueue.length >= 3) {
      return spawnArrivalTraffic(
        airport,
        existingAircraft,
        simTimeSec,
        spawnCounter,
        callsign,
        airlineName,
        airlineCn,
        model,
        arrivalRunway,
        enableEmergencies
      );
    }
    const depRwyCfg = getRunwayConfig(airport, departureRunway);
    const exitId = airport.departureExits[spawnCounter % airport.departureExits.length];
    const queueOffset = groundQueue.length * 0.35;
    return createCustomAircraft({
      callsign,
      airlineName,
      airlineCn,
      model,
      category: 'DEPARTURE',
      position: {
        x: depRwyCfg.holdingPoint.x - queueOffset * 0.5,
        y: depRwyCfg.holdingPoint.y - queueOffset * 0.3,
      },
      heading: depRwyCfg.heading,
      altitude: 0,
      speed: 0,
      assignedRunway: departureRunway,
      assignedExitId: exitId,
      simTimeSec,
    });
  }

  return spawnArrivalTraffic(
    airport,
    existingAircraft,
    simTimeSec,
    spawnCounter,
    callsign,
    airlineName,
    airlineCn,
    model,
    arrivalRunway,
    enableEmergencies
  );
}

function spawnArrivalTraffic(
  airport: AirportConfig,
  existingAircraft: Aircraft[],
  simTimeSec: number,
  spawnCounter: number,
  callsign: string,
  airlineName: string,
  airlineCn: string,
  model: string,
  arrivalRunway: RunwayId,
  enableEmergencies: boolean
): Aircraft | null {
  const gates = airport.arrivalGates;
  const activeAirborne = existingAircraft.filter(
    (a) =>
      a.phase !== 'HOLDING_GROUND' &&
      a.phase !== 'HOLD_CROSSING' &&
      a.phase !== 'LANDED' &&
      a.phase !== 'HANDED_OFF' &&
      a.phase !== 'EXITED_AIRSPACE'
  );

  const hasActiveEmergency = activeAirborne.some((a) => a.emergencyType !== 'NONE');
  let emergencyType: EmergencyType = 'NONE';
  if (enableEmergencies && !hasActiveEmergency && spawnCounter % 3 === 1) {
    const types: EmergencyType[] = [
      'SQUAWK_7700_ENGINE',
      'SQUAWK_7700_FUEL',
      'SQUAWK_7600_NORDO',
    ];
    emergencyType = types[spawnCounter % types.length];
  }

  for (let offset = 0; offset < gates.length; offset++) {
    const gate = gates[(spawnCounter + offset) % gates.length];
    // 严格按照进港走廊初始磁航向遵守 ICAO 东单西双高度层配备标准 + 该走廊 STAR 起始高度
    const dirLevels = getIcaoDirectionalLevelsFt(gate.initialHeading).levelsFt;
    const allStandardLevels = [
      gate.initialAltitude,
      ...dirLevels,
      4000,
      5000,
      6000,
      7000,
      8000,
      9000,
    ];
    const uniqueStandardLevels = Array.from(new Set(allStandardLevels));

    for (let aIdx = 0; aIdx < uniqueStandardLevels.length; aIdx++) {
      const candidateAlt = uniqueStandardLevels[aIdx];
      const tooClose = activeAirborne.some(
        (other) =>
          (distanceNM(other.position, gate.position) < 9.5 &&
            Math.abs(other.altitude - candidateAlt) < 1000) ||
          Math.abs(other.altitude - candidateAlt) < 900
      );
      if (!tooClose) {
        return createCustomAircraft({
          callsign,
          airlineName,
          airlineCn,
          model,
          category: 'ARRIVAL',
          position: { ...gate.position },
          heading: gate.initialHeading,
          altitude: candidateAlt,
          speed: Math.min(gate.initialSpeed, AIRCRAFT_MODELS[model]?.cruiseSpeed || 230),
          assignedRunway: arrivalRunway,
          entryGateId: gate.id,
          emergencyType,
          simTimeSec,
        });
      }
    }
  }

  return null;
}
