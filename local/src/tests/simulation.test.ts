import { resolveVoiceIdForLanguage } from '../audio/soundEngine';
import {
  normalizeChineseSpokenNumbers,
  parseFuzzyVoiceTranscript,
} from "../atc/voiceRecognizer";
import { formatChineseAtcRadiotelephonySpeech, formatKokoroAviationPhonetics } from "../audio/soundEngine";
// 核心模拟引擎与 V1.0 - V5.0 (4大差异化机场 / 交叉与错列跑道 / ICAO Doc 4444 / RECAT-EU / TCAS / 7700 / 禁航区) 自动化单元测试套件 (24 项全覆盖)
import {
  AIRPORTS_DATABASE,
  getAirlineBrandByCallsign,
  ICAO_STANDARD_ALTITUDE_LEVELS,
  HANEDA_AIRPORT,
  HARBOR_AIRPORT,
  PUDONG_AIRPORT,
} from '../airport/harborAirport';
import {
  calculateRunwayWindComponents,
  feetToStandardMeters,
  formatAltitudeValue,
  computeAmanSequence,
  distanceNM,
  shortestHeadingDelta,
  updateAircraftPhysics,
} from '../aircraft/physics';
import { createCustomAircraft } from '../traffic/spawner';
import { executeATCCommand } from '../atc/commands';
import {
  evaluateAirspaceSafety,
  getRequiredHorizontalSeparationNM,
} from '../safety/conflictDetector';
import {
  advanceSimulation,
  createInitialSimulationState,
  DEFAULT_GAME_SETTINGS,
  issueSimulationCommand,
  spawnEmergencyFlightInState,
  switchAirportRunwayDirection,
} from '../simulation/engine';

export interface TestCaseResult {
  name: string;
  passed: boolean;
  detail: string;
}

export function runAllSimulationTests(): TestCaseResult[] {
  const results: TestCaseResult[] = [];

  function assertTest(name: string, fn: () => string): void {
    try {
      const detail = fn();
      results.push({ name, passed: true, detail });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name, passed: false, detail: msg });
    }
  }

  // 测试 1：飞机按真实海里公式移动
  assertTest('1. 飞机按真实海里公式移动 (移动距离 = 地速 × 秒数 / 3600)', () => {
    const ac = createCustomAircraft({
      callsign: 'CES5213',
      airlineName: 'CHINA EASTERN',
      airlineCn: '东方航空',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -10, y: 0.55 },
      heading: 90,
      altitude: 3000,
      speed: 180,
    });

    let current = ac;
    for (let i = 0; i < 20; i++) {
      current = updateAircraftPhysics(current, 1.0, HARBOR_AIRPORT, false).aircraft;
    }

    const movedX = current.position.x - ac.position.x;
    if (Math.abs(movedX - 1.0) > 0.01) {
      throw new Error(`Expected +1.0 NM east movement, got dx=${movedX.toFixed(4)}`);
    }
    return `180 kt 飞行 20 秒精确向东移动 ${movedX.toFixed(3)} NM`;
  });

  // 测试 2：修改航向后飞机逐渐转弯，并正确处理 0°/360° 与最短方向转弯
  assertTest('2. 修改航向后飞机逐渐转弯，且正确处理 0°/360° 跨越与最短转弯方向', () => {
    const deltaWrap = shortestHeadingDelta(350, 10);
    if (Math.abs(deltaWrap - 20) > 1e-5) {
      throw new Error(`Expected shortest delta +20 deg across 360, got ${deltaWrap}`);
    }

    let ac = createCustomAircraft({
      callsign: 'CCA1802',
      airlineName: 'AIR CHINA',
      airlineCn: '中国国航',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -12, y: 5 },
      heading: 90,
      altitude: 4000,
      speed: 200,
    });

    ac = executeATCCommand(ac, { type: 'HDG', heading: 180 }, HARBOR_AIRPORT, [ac]).updatedAircraft;
    for (let i = 0; i < 10; i++) {
      ac = updateAircraftPhysics(ac, 1.0, HARBOR_AIRPORT, false).aircraft;
    }
    if (Math.abs(ac.heading - 120) > 1.0) {
      throw new Error(`After 10s at 3 deg/s, heading should be ~120, got ${ac.heading}`);
    }
    for (let i = 0; i < 25; i++) {
      ac = updateAircraftPhysics(ac, 1.0, HARBOR_AIRPORT, false).aircraft;
    }
    if (Math.abs(ac.heading - 180) > 0.1) {
      throw new Error(`Expected final heading 180, got ${ac.heading}`);
    }
    return `090°->180° 在 10 秒时为 120°，30 秒到达 180°；350°->010° 最短差值为 +${deltaWrap}°`;
  });

  // 测试 3：修改高度后飞机按合理速率爬升或下降
  assertTest('3. 修改高度后飞机按爬升率/下降率逐渐变化', () => {
    let ac = createCustomAircraft({
      callsign: 'CSN3309',
      airlineName: 'CHINA SOUTHERN',
      airlineCn: '南方航空',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -15, y: 4 },
      heading: 90,
      altitude: 5000,
      speed: 210,
    });

    ac = executeATCCommand(ac, { type: 'ALT', altitude: 3000 }, HARBOR_AIRPORT, [ac]).updatedAircraft;
    for (let i = 0; i < 20; i++) {
      ac = updateAircraftPhysics(ac, 1.0, HARBOR_AIRPORT, false).aircraft;
    }
    if (Math.abs(ac.altitude - 4400) > 15) {
      throw new Error(`Expected ~4400 ft after 20s descent, got ${ac.altitude}`);
    }
    return `5000 ft 下达 ALT 3000 后 20 秒平滑下降至 ${Math.round(ac.altitude)} ft (下降率 1800 ft/min)`;
  });

  // 测试 4：修改速度后飞机逐渐加减速，且遵守 ICAO 10,000ft 以下 ≤250kt 限速
  assertTest('4. 修改速度后飞机平滑加减速，且强制执行 ICAO FL100 以下 ≤250kt 速度上限', () => {
    let ac = createCustomAircraft({
      callsign: 'CES5213',
      airlineName: 'CHINA EASTERN',
      airlineCn: '东方航空',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -14, y: 0.55 },
      heading: 90,
      altitude: 3000,
      speed: 220,
    });

    ac = executeATCCommand(ac, { type: 'SPD', speed: 280 }, HARBOR_AIRPORT, [ac]).updatedAircraft;
    if (ac.targetSpeed > 250) {
      throw new Error(`Expected speed capped at 250 kt below 10,000 ft, got ${ac.targetSpeed}`);
    }

    ac = executeATCCommand(ac, { type: 'SPD', speed: 180 }, HARBOR_AIRPORT, [ac]).updatedAircraft;
    for (let i = 0; i < 10; i++) {
      ac = updateAircraftPhysics(ac, 1.0, HARBOR_AIRPORT, false).aircraft;
    }
    if (ac.speed >= 220 || ac.speed <= 180) {
      throw new Error(`Expected intermediate speed ~198 kt after 10s, got ${ac.speed}`);
    }
    return `FL100 以下超速指令自动钳制在 250 kt；220 kt 下达 SPD 180 后 10s 平滑减速至 ${ac.speed.toFixed(1)} kt`;
  });

  // 测试 5：飞机满足条件时可建立 ILS RWY 09L 下滑道并完成安全着陆
  assertTest('5. 飞机满足截获条件时可建立 ILS RWY 09L 下滑道并完成安全着陆', () => {
    let state = createInitialSimulationState('NORMAL', true);
    state.aircraft[0] = {
      ...state.aircraft[0],
      position: { x: -10, y: 0.9 },
      heading: 105,
      targetHeading: 105,
      altitude: 2500,
      targetAltitude: 2500,
      speed: 180,
      targetSpeed: 180,
      assignedRunway: '09L',
    };
    const acId = state.aircraft[0].id;

    state = issueSimulationCommand(state, acId, { type: 'CLEARED_ILS', runwayId: '09L' });
    state = advanceSimulation(state, 260);
    const ac = state.aircraft.find((a) => a.id === acId)!;
    if (ac.phase !== 'LANDED' || state.landedCount < 1) {
      throw new Error(`Expected aircraft to complete landing on 09L, got phase=${ac.phase}`);
    }
    return `航班 ${ac.callsign} 成功截获 09L 航向道、跟随 3° 下滑道接地并脱离跑道，landedCount=${state.landedCount}`;
  });

  // 测试 6：飞机在不符合降落条件时不能虚假着陆
  assertTest('6. 飞机不满足安全进近条件时拒绝盲降许可或触发复飞，绝不虚假降落', () => {
    const highAc = createCustomAircraft({
      callsign: 'CES9999',
      airlineName: 'CHINA EASTERN',
      airlineCn: '东方航空',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -8, y: 0.55 },
      heading: 90,
      altitude: 7500,
      speed: 220,
    });
    const resHigh = executeATCCommand(highAc, { type: 'CLEARED_ILS', runwayId: '09L' }, HARBOR_AIRPORT, [highAc]);
    if (resHigh.accepted) {
      throw new Error('Should reject ILS clearance when aircraft is at 7500 ft');
    }

    let unCleared = createCustomAircraft({
      callsign: 'CCA8888',
      airlineName: 'AIR CHINA',
      airlineCn: '中国国航',
      model: 'B738',
      category: 'ARRIVAL',
      position: { x: -3, y: 0.55 },
      heading: 90,
      altitude: 1500,
      speed: 180,
    });
    for (let i = 0; i < 60; i++) {
      unCleared = updateAircraftPhysics(unCleared, 1.0, HARBOR_AIRPORT, false).aircraft;
    }
    if (unCleared.phase === 'LANDED' || unCleared.phase === 'LANDING_ROLL') {
      throw new Error('Aircraft without ILS clearance must never auto-land');
    }
    return `7500 ft 高空请求 ILS 被拒绝 (${resHigh.pilotReadbackEn})；未获许可飞越跑道不虚假降落`;
  });

  // 测试 7：地面等待飞机从跑道 09R 起飞、离地爬升并完成离场移交
  assertTest('7. 地面等待飞机从 09R 跑道获准起飞、加速滑跑、离地爬升并完成移交', () => {
    let state = createInitialSimulationState('NORMAL', true);
    const depAc = state.aircraft.find((a) => a.category === 'DEPARTURE')!;
    state = issueSimulationCommand(state, depAc.id, { type: 'CLEARED_TAKEOFF', runwayId: '09R' });

    let updatedDep = state.aircraft.find((a) => a.id === depAc.id)!;
    if (updatedDep.phase !== 'TAKEOFF_ROLL') {
      throw new Error(`Expected TAKEOFF_ROLL phase, got ${updatedDep.phase}`);
    }

    state = advanceSimulation(state, 40);
    updatedDep = state.aircraft.find((a) => a.id === depAc.id)!;
    if (updatedDep.altitude <= 200 || updatedDep.phase === 'TAKEOFF_ROLL') {
      throw new Error(`Expected airborne climbing, got phase=${updatedDep.phase}`);
    }

    state = issueSimulationCommand(state, depAc.id, [
      { type: 'SID', procedureId: 'OCEAN-1D' },
    ]);
    state = advanceSimulation(state, 180);
    updatedDep = state.aircraft.find((a) => a.id === depAc.id)!;
    if (updatedDep.phase !== 'HANDED_OFF') {
      state = issueSimulationCommand(state, depAc.id, { type: 'HANDOFF' });
    }
    if (state.departedCount < 1) {
      throw new Error('Expected departedCount >= 1 after handoff');
    }
    return `重型机 ${depAc.callsign} (HEAVY) 从 09R 起飞并沿 OCEAN-1D 离场移交，departedCount=${state.departedCount}`;
  });

  // 测试 8：两架飞机间隔低于标准时触发 STCA 冲突警告
  assertTest('8. 两架飞机水平间隔 < 5 NM 且垂直间隔 < 1000 ft 时触发 STCA 冲突告警', () => {
    const a = createCustomAircraft({
      callsign: 'CES101',
      airlineName: 'CHINA EASTERN',
      airlineCn: '东方航空',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -10, y: 0 },
      heading: 90,
      altitude: 4000,
      speed: 200,
    });
    const b = createCustomAircraft({
      callsign: 'CCA202',
      airlineName: 'AIR CHINA',
      airlineCn: '中国国航',
      model: 'B738',
      category: 'ARRIVAL',
      position: { x: -6.8, y: 0 },
      heading: 270,
      altitude: 4500,
      speed: 200,
    });

    const safety = evaluateAirspaceSafety([a, b], 10, new Set());
    if (safety.alerts.length !== 1) {
      throw new Error(`Expected 1 conflict alert, got ${safety.alerts.length}`);
    }
    return `成功检测到 ${safety.alerts[0].description}`;
  });

  // 测试 9：同一跑道条带占用或五边短五边有飞机时阻止起飞并告警
  assertTest('9. 跑道被占用或五边有即将着陆飞机时，阻止起飞并触发跑道冲突保护', () => {
    const landingAc = createCustomAircraft({
      callsign: 'CES5213',
      airlineName: 'CHINA EASTERN',
      airlineCn: '东方航空',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -2.8, y: -0.55 },
      heading: 90,
      altitude: 500,
      speed: 142,
      assignedRunway: '09R',
    });
    landingAc.phase = 'FINAL_APPROACH';

    const groundAc = createCustomAircraft({
      callsign: 'CHH7601',
      airlineName: 'HAINAN',
      airlineCn: '海南航空',
      model: 'A320',
      category: 'DEPARTURE',
      position: { ...HARBOR_AIRPORT.runways['09R']!.holdingPoint },
      heading: 90,
      altitude: 0,
      speed: 0,
      assignedRunway: '09R',
    });

    const res = executeATCCommand(
      groundAc,
      { type: 'CLEARED_TAKEOFF', runwayId: '09R' },
      HARBOR_AIRPORT,
      [landingAc, groundAc]
    );

    if (res.accepted || !res.runwayConflictTriggered) {
      throw new Error('Takeoff must be blocked when another aircraft is on short final of same runway');
    }
    return `09R 五边有进近飞机时同跑道起飞被阻止：${res.pilotReadbackEn}`;
  });

  // 测试 10：完成整局任务触发胜利结算
  assertTest('10. 达成 8 架安全着陆与 3 架离场移交后触发 VICTORY 胜利结算界面', () => {
    let state = createInitialSimulationState('NORMAL', true);
    state.landedCount = 8;
    state.departedCount = 2;

    const depIdx = state.aircraft.findIndex((a) => a.category === 'DEPARTURE');
    state.aircraft[depIdx] = {
      ...state.aircraft[depIdx],
      phase: 'DEPARTING',
      position: { x: 12, y: 8 },
      altitude: 6000,
      canHandoff: true,
    };

    state = issueSimulationCommand(state, state.aircraft[depIdx].id, { type: 'HANDOFF' });
    if (state.status !== 'VICTORY' || state.departedCount !== 3) {
      throw new Error(`Expected VICTORY status, got ${state.status}`);
    }
    return `达成 8 进港 + 3 离港目标后状态切换为 ${state.status}，最终得分 ${state.score}`;
  });

  // 测试 11：航路点导航 (DCT) 与空中等待航线 (HOLD) 真实运动验证
  assertTest('11. 航路点导航 (DCT) 与等待航线 (HOLD) 持续动态飞行而非原地静止', () => {
    let ac = createCustomAircraft({
      callsign: 'CSN3309',
      airlineName: 'CHINA SOUTHERN',
      airlineCn: '南方航空',
      model: 'C919',
      category: 'ARRIVAL',
      position: { x: -8, y: 0.55 },
      heading: 90,
      altitude: 3000,
      speed: 190,
    });

    ac = executeATCCommand(ac, { type: 'HOLD', waypointId: 'HARBR' }, HARBOR_AIRPORT, [ac]).updatedAircraft;
    const pos0 = { ...ac.position };
    for (let i = 0; i < 30; i++) {
      ac = updateAircraftPhysics(ac, 1.0, HARBOR_AIRPORT, false).aircraft;
    }
    const movedDist = distanceNM(pos0, ac.position);
    if (movedDist < 0.5) {
      throw new Error(`Aircraft in HOLD must keep flying a racetrack pattern, moved ${movedDist}`);
    }
    return `HOLD HARBR 模式下 30 秒内沿跑马场航线运动了 ${movedDist.toFixed(2)} NM`;
  });

  // 测试 12：暂停与倍速下物理一致性
  assertTest('12. 暂停时不发生位移，且不同步长推进相同模拟时长位置完全一致', () => {
    let pausedState = createInitialSimulationState('NORMAL', false);
    const beforeX = pausedState.aircraft[0].position.x;
    pausedState = advanceSimulation(pausedState, 30);
    if (pausedState.aircraft[0].position.x !== beforeX) {
      throw new Error('Paused simulation must not move aircraft');
    }

    let stateA = createInitialSimulationState('NORMAL', true);
    let stateB = createInitialSimulationState('NORMAL', true);
    for (let i = 0; i < 20; i++) {
      stateA = advanceSimulation(stateA, 1.0);
    }
    stateB = advanceSimulation(stateB, 20.0);

    const diffX = Math.abs(stateA.aircraft[0].position.x - stateB.aircraft[0].position.x);
    if (diffX > 1e-6) {
      throw new Error(`Fixed timestep mismatch: diffX=${diffX}`);
    }
    return `暂停状态位移为 0；1× 与 4× 倍速推进 20 秒坐标误差为 ${diffX.toExponential(2)} NM`;
  });

  // 测试 13：ICAO Doc 4444 尾流雷达间隔矩阵
  assertTest('13. [ICAO Doc 4444 §8.7.3.4] 尾流雷达间隔矩阵验证 (Super A388 后跟 Medium 需 ≥7.0 NM)', () => {
    const superLeader = createCustomAircraft({
      callsign: 'SIA380',
      airlineName: 'SINGAPORE',
      airlineCn: '新加坡航空',
      model: 'A388',
      category: 'ARRIVAL',
      position: { x: -6.0, y: 0.55 },
      heading: 90,
      altitude: 2000,
      speed: 150,
    });
    const medFollower = createCustomAircraft({
      callsign: 'CES5213',
      airlineName: 'CHINA EASTERN',
      airlineCn: '东方航空',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -12.2, y: 0.55 },
      heading: 90,
      altitude: 2200,
      speed: 160,
    });

    const req = getRequiredHorizontalSeparationNM(superLeader, medFollower, 'ICAO');
    if (req.requiredNM !== 7.0 || !req.isWakeTurbulence) {
      throw new Error(`Expected 7.0 NM wake requirement behind SUPER, got ${JSON.stringify(req)}`);
    }

    const safety = evaluateAirspaceSafety([superLeader, medFollower], 20, new Set(), 'ICAO');
    if (safety.alerts.length !== 1 || safety.alerts[0].severity !== 'WAKE') {
      throw new Error(`Expected WAKE turbulence alert at 6.2 NM behind A388`);
    }
    return `A388 [J] 后方 6.2 NM 的 A320 [M] 准确触发 ICAO 7.0 NM 尾流告警`;
  });

  // 测试 14：ICAO Doc 4444 起飞尾流计时器与平行跑道改配
  assertTest('14. [ICAO Doc 4444 §5.8.3] 重型机起飞后 120s 内阻止同跑道中型机起飞，切换平行跑道可立即起飞', () => {
    let state = createInitialSimulationState('NORMAL', true);
    const heavyDep = state.aircraft.find((a) => a.callsign === 'CHH7601')!;
    const medDep = state.aircraft.find((a) => a.callsign === 'CXA8190')!;

    state = issueSimulationCommand(state, heavyDep.id, { type: 'CLEARED_TAKEOFF', runwayId: '09R' });
    state = advanceSimulation(state, 50);

    const beforeScore = state.score;
    state = issueSimulationCommand(state, medDep.id, { type: 'CLEARED_TAKEOFF', runwayId: '09R' });
    const medAfterAttempt = state.aircraft.find((a) => a.id === medDep.id)!;
    if (medAfterAttempt.phase !== 'HOLDING_GROUND' || state.score >= beforeScore) {
      throw new Error('Medium aircraft takeoff behind Heavy within 120s on same runway must be blocked');
    }

    state = issueSimulationCommand(state, medDep.id, [
      { type: 'ASSIGN_RUNWAY', runwayId: '09L' },
      { type: 'CLEARED_TAKEOFF', runwayId: '09L' },
    ]);
    const medOn09L = state.aircraft.find((a) => a.id === medDep.id)!;
    if (medOn09L.phase !== 'TAKEOFF_ROLL') {
      throw new Error(`Expected CXA8190 to take off on parallel runway 09L`);
    }
    return `HEAVY 起飞 50s 后同跑道 09R 起飞被 120s 尾流计时器拦截；改配 09L 后立即获准滑跑`;
  });

  // 测试 15：STAR 标准进场程序多航段自动序列导航
  assertTest('15. [ICAO STAR/SID] STAR NORTH-1A 多航路点 LNAV/VNAV 自动序列与高度/速度约束执行', () => {
    let ac = createCustomAircraft({
      callsign: 'CSN3309',
      airlineName: 'CHINA SOUTHERN',
      airlineCn: '南方航空',
      model: 'C919',
      category: 'ARRIVAL',
      position: { x: -7.8, y: 10.3 },
      heading: 210,
      altitude: 6000,
      speed: 240,
    });

    ac = executeATCCommand(ac, { type: 'STAR', procedureId: 'NORTH-1A' }, HARBOR_AIRPORT, [ac]).updatedAircraft;
    for (let i = 0; i < 15; i++) {
      ac = updateAircraftPhysics(ac, 1.0, HARBOR_AIRPORT, false).aircraft;
    }
    if (ac.directWaypointId !== 'BAYVW' || ac.targetAltitude !== 3000 || ac.targetSpeed > 190) {
      throw new Error(`Expected auto-sequence to BAYVW (3000ft/190kt)`);
    }
    return `STAR NORTH-1A 飞越 NORTH 后自动切入下一航段 BAYVW，高度 ${ac.targetAltitude}ft、限速 ${ac.targetSpeed}kt`;
  });

  // 测试 16：双平行跑道独立五边进近豁免与顺风换端
  assertTest('16. [ICAO Doc 9643 & Doc 8168] 平行双跑道 09L/09R 独立五边进近豁免与顺风跑道换端', () => {
    const arr09L = createCustomAircraft({
      callsign: 'CES501',
      airlineName: 'CHINA EASTERN',
      airlineCn: '东方航空',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -6.0, y: 0.55 },
      heading: 90,
      altitude: 1500,
      speed: 145,
      assignedRunway: '09L',
    });
    arr09L.phase = 'FINAL_APPROACH';

    const arr09R = createCustomAircraft({
      callsign: 'CCA502',
      airlineName: 'AIR CHINA',
      airlineCn: '中国国航',
      model: 'B738',
      category: 'ARRIVAL',
      position: { x: -6.2, y: -0.55 },
      heading: 90,
      altitude: 1550,
      speed: 145,
      assignedRunway: '09R',
    });
    arr09R.phase = 'FINAL_APPROACH';

    const safety = evaluateAirspaceSafety([arr09L, arr09R], 30, new Set());
    if (safety.alerts.length !== 0) {
      throw new Error('Parallel 09L/09R approaches outside NTZ must not trigger conflict alerts');
    }

    const wind270 = calculateRunwayWindComponents(90, 260, 16);
    let state = createInitialSimulationState('NORMAL', true);
    state = switchAirportRunwayDirection(state, '27');
    if (!wind270.exceedsTailwindLimit || state.activeRunwayDir !== '27') {
      throw new Error('Expected tailwind advisory and runway direction 27');
    }
    return `09L/09R 平行盲降豁免冲突；西风 260°/16kt 顺风 ${wind270.tailwindKt}kt 换端 27R/27L 成功`;
  });

  // 测试 17 (V3.0)：RECAT-EU 6 级尾流标准切换与平行跑道 NTZ 非侵入区突破告警 + BREAK OUT 脱离
  assertTest('17. [V3.0 RECAT-EU & NTZ] RECAT-EU 6 级尾流精细间隔与平行跑道 NTZ 侵入告警及 BREAK OUT 脱离', () => {
    const superLeader = createCustomAircraft({
      callsign: 'SIA380',
      airlineName: 'SINGAPORE',
      airlineCn: '新加坡航空',
      model: 'A388', // RECAT A
      category: 'ARRIVAL',
      position: { x: -6.0, y: 0.55 },
      heading: 90,
      altitude: 2000,
      speed: 150,
    });
    const medFollower = createCustomAircraft({
      callsign: 'CES5213',
      airlineName: 'CHINA EASTERN',
      airlineCn: '东方航空',
      model: 'A320', // RECAT D
      category: 'ARRIVAL',
      position: { x: -11.5, y: 0.55 },
      heading: 90,
      altitude: 2200,
      speed: 160,
    });

    const recatReq = getRequiredHorizontalSeparationNM(superLeader, medFollower, 'RECAT_EU');
    if (recatReq.requiredNM !== 5.0) {
      throw new Error(`Expected RECAT-EU A->D minimum 5.0 NM, got ${recatReq.requiredNM}`);
    }

    const ntzBreacher = { ...superLeader, phase: 'FINAL_APPROACH' as const, position: { x: -6.0, y: 0.08 }, assignedRunway: '09L' as const };
    const threatened = { ...medFollower, phase: 'FINAL_APPROACH' as const, position: { x: -6.5, y: -0.55 }, assignedRunway: '09R' as const };
    const safety = evaluateAirspaceSafety([ntzBreacher, threatened], 40, new Set(), 'RECAT_EU', true, HARBOR_AIRPORT);
    if (!safety.alerts.some((a) => a.severity === 'NTZ')) {
      throw new Error('Expected NTZ penetration alert when aircraft enters |y| <= 0.22 NM corridor');
    }

    const breakRes = executeATCCommand(threatened, { type: 'BREAK_OUT' }, HARBOR_AIRPORT, [ntzBreacher, threatened]);
    if (!breakRes.accepted || breakRes.updatedAircraft.targetAltitude !== 4000) {
      throw new Error('Expected BREAK_OUT command to climb to 4000 ft and turn away');
    }
    return `RECAT-EU (A->D=5.0NM) 验证通过；平行五边侵入 NTZ 触发告警且 BREAK OUT 紧急脱离成功`;
  });

  // 测试 18 (V3.5)：TCAS RA 机载防撞自主接管与 7700/7600 特情航班处置
  assertTest('18. [V3.5 TCAS RA & 7700/7600] TCAS RA 自主防撞爬升/下降接管及 7700/7600 特情航班保障', () => {
    let state = createInitialSimulationState('NORMAL', true, { enableTcasRa: true });
    state = spawnEmergencyFlightInState(state, 'SQUAWK_7700_FUEL');
    const emgAc = state.aircraft.find((a) => a.squawkCode === '7700');
    if (!emgAc) {
      throw new Error('Expected 7700 emergency flight to be spawned');
    }

    const acA = createCustomAircraft({
      callsign: 'CES801',
      airlineName: 'CHINA EASTERN',
      airlineCn: '东方航空',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -9.0, y: 3.0 },
      heading: 180,
      altitude: 4200,
      speed: 200,
    });
    const acB = createCustomAircraft({
      callsign: 'CCA802',
      airlineName: 'AIR CHINA',
      airlineCn: '中国国航',
      model: 'B738',
      category: 'ARRIVAL',
      position: { x: -9.0, y: 1.2 },
      heading: 0,
      altitude: 4000,
      speed: 200,
    });
    state.aircraft.push(acA, acB);
    state = advanceSimulation(state, 0.5);

    const updatedA = state.aircraft.find((a) => a.callsign === 'CES801')!;
    const updatedB = state.aircraft.find((a) => a.callsign === 'CCA802')!;
    if (!updatedA.tcasRaActive || updatedA.tcasRaDirection !== 'CLIMB' || !updatedB.tcasRaActive || updatedB.tcasRaDirection !== 'DESCEND') {
      throw new Error(`Expected TCAS RA CLIMB/DESCEND activation, got A=${updatedA.tcasRaDirection}, B=${updatedB.tcasRaDirection}`);
    }

    const altCmdRes = executeATCCommand(updatedA, { type: 'ALT', altitude: 3000 }, HARBOR_AIRPORT, state.aircraft);
    if (altCmdRes.accepted) {
      throw new Error('ATC altitude command must be rejected while aircraft is executing TCAS RA');
    }
    return `7700 特情航班生成成功；高危迫近自动触发 TCAS RA (${updatedA.callsign} CLIMB / ${updatedB.callsign} DESCEND) 并锁定外部高度干预`;
  });

  // 测试 19 (V3.5)：外侧跑道落地穿越内侧跑道 (HOLD_CROSSING -> CROSS_RUNWAY) 与 SQUAWK IDENT
  assertTest('19. [V3.5 SMR 跑道穿越 & SSR IDENT] 09L 落地后等待穿越 09R 跑道及二次雷达 IDENT 识别', () => {
    let ac = createCustomAircraft({
      callsign: 'CES5213',
      airlineName: 'CHINA EASTERN',
      airlineCn: '东方航空',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -0.5, y: 0.55 },
      heading: 90,
      altitude: 0,
      speed: 45,
      assignedRunway: '09L',
    });
    ac.phase = 'LANDING_ROLL';

    for (let i = 0; i < 10; i++) {
      ac = updateAircraftPhysics(ac, 1.0, HARBOR_AIRPORT, false, undefined, true).aircraft;
      if (ac.phase === 'HOLD_CROSSING') break;
    }
    if (ac.phase !== 'HOLD_CROSSING' || ac.crossingRunwayId !== '09R') {
      throw new Error(`Expected HOLD_CROSSING for 09R after 09L rollout, got ${ac.phase}`);
    }

    const crossRes = executeATCCommand(ac, { type: 'CROSS_RUNWAY' }, HARBOR_AIRPORT, [ac]);
    if (!crossRes.accepted || crossRes.updatedAircraft.phase !== 'LANDED') {
      throw new Error('Expected CROSS_RUNWAY to complete landing');
    }

    const identRes = executeATCCommand(ac, { type: 'SQUAWK_IDENT' }, HARBOR_AIRPORT, [ac]);
    if (!identRes.accepted || identRes.updatedAircraft.identFlashTimerSec <= 0) {
      throw new Error('Expected SQUAWK_IDENT to set identFlashTimerSec > 0');
    }
    return `09L 落地滑跑后进入 HOLD_CROSSING 等待点，下达 CROSS RWY 09R 安全完成穿越；SQUAWK IDENT 闪烁正常`;
  });

  // 测试 20 (V4.0)：单跑道模式、AMAN 排序与双角色中英文语音队列
  assertTest('20. [V4.0 单跑道模式/AMAN/双角色语音] 切换单跑道模式、AMAN 排序时间轴与双角色中英文语音队列', () => {
    let state = createInitialSimulationState('HARD', true, {
      airportId: 'ZSHB',
      runwayCountMode: 'SINGLE',
      ttsLanguage: 'CN',
    });
    if (state.aircraft.some((a) => a.assignedRunway !== '09L')) {
      throw new Error('In SINGLE runway mode at ZSHB, all traffic must be assigned to 09L');
    }

    const aman = computeAmanSequence(state.aircraft, state.airport);
    if (aman.length < 3 || aman[0].etaSec > aman[1].etaSec) {
      throw new Error('Expected AMAN sequence sorted ascending by ETA');
    }

    state = issueSimulationCommand(state, state.aircraft[0].id, { type: 'HDG', heading: 90 });
    if (
      state.pendingSpeechItems.length < 2 ||
      state.pendingSpeechItems[0].role !== 'ATC' ||
      state.pendingSpeechItems[1].role !== 'PILOT'
    ) {
      throw new Error('Expected dual-role (ATC then PILOT) speech items in pendingSpeechItems');
    }
    return `单跑道 (09L) 模式、AMAN 排序 (${aman.length} 架) 及 ATC+PILOT 中英文双角色语音队列全部验证通过`;
  });

  // 测试 21 (V5.0)：东京羽田国际机场 (RJTT) 交叉横风双跑道 (34R 337° × 22 222°) 进近着陆与交汇点冲突检测
  assertTest('21. [V5.0 RJTT 东京羽田交叉跑道] 34R(337°) × 22(222°) 交叉跑道盲降着陆与交汇点冲突检测', () => {
    let state = createInitialSimulationState('NORMAL', true, {
      airportId: 'RJTT',
      runwayCountMode: 'DUAL',
    });
    if (state.airport.layoutType !== 'INTERSECTING') {
      throw new Error(`Expected RJTT layoutType INTERSECTING, got ${state.airport.layoutType}`);
    }
    const ana = state.aircraft.find((a) => a.callsign === 'ANA852')!;
    const jal = state.aircraft.find((a) => a.callsign === 'JAL514')!;
    if (ana.assignedRunway !== '34R' || jal.assignedRunway !== '22') {
      throw new Error(`Expected ANA852->34R and JAL514->22, got ${ana.assignedRunway} & ${jal.assignedRunway}`);
    }

    state = issueSimulationCommand(state, ana.id, { type: 'CLEARED_ILS', runwayId: '34R' });
    state = advanceSimulation(state, 320);
    const landedAna = state.aircraft.find((a) => a.id === ana.id)!;
    if (landedAna.phase !== 'LANDED') {
      throw new Error(`Expected ANA852 to land on 34R (337°), got phase=${landedAna.phase}`);
    }

    const roll34R = createCustomAircraft({
      callsign: 'ANA901',
      airlineName: 'ALL NIPPON',
      airlineCn: '全日空',
      model: 'B77W',
      category: 'ARRIVAL',
      position: { x: 0.35, y: -0.1 },
      heading: 337,
      altitude: 0,
      speed: 90,
      assignedRunway: '34R',
    });
    roll34R.phase = 'LANDING_ROLL';

    const roll22 = createCustomAircraft({
      callsign: 'JAL902',
      airlineName: 'JAPAN AIR',
      airlineCn: '日本航空',
      model: 'A333',
      category: 'DEPARTURE',
      position: { x: 0.45, y: 0.05 },
      heading: 222,
      altitude: 0,
      speed: 110,
      assignedRunway: '22',
    });
    roll22.phase = 'TAKEOFF_ROLL';

    const safety = evaluateAirspaceSafety([roll34R, roll22], 60, new Set(), 'ICAO', true, HANEDA_AIRPORT);
    if (!safety.alerts.some((a) => a.severity === 'RUNWAY' && a.id.includes('::XRWY'))) {
      throw new Error('Expected INTERSECTING RUNWAY conflict alert at RJTT intersection');
    }
    return `东京羽田 (RJTT) 34R(337°) 盲降着陆成功，且 34R×22 交汇点同时滑跑准确触发交叉跑道冲突告警`;
  });

  // 测试 22 (V5.0)：上海浦东国际机场 (ZSPD) 南北偏西 (348°) 远距错列平行双跑道 (34L / 35R) 与 STAR HSN-1A
  assertTest('22. [V5.0 ZSPD 上海浦东错列双跑道] 34L/35R (348°) 错列平行跑道盲降与 HSN-1A 进场程序', () => {
    let state = createInitialSimulationState('NORMAL', true, {
      airportId: 'ZSPD',
      runwayCountMode: 'DUAL',
    });
    if (state.airport.layoutType !== 'PARALLEL_STAGGERED') {
      throw new Error(`Expected ZSPD PARALLEL_STAGGERED, got ${state.airport.layoutType}`);
    }
    const ces = state.aircraft.find((a) => a.callsign === 'CES5101')!;
    const ckk = state.aircraft.find((a) => a.callsign === 'CKK208')!;
    if (ces.assignedRunway !== '34L' || ckk.assignedRunway !== '35R') {
      throw new Error(`Expected CES5101->34L and CKK208->35R`);
    }

    state = issueSimulationCommand(state, ckk.id, { type: 'STAR', procedureId: 'HSN-1A' });
    state = issueSimulationCommand(state, ces.id, { type: 'CLEARED_ILS', runwayId: '34L' });
    state = advanceSimulation(state, 330);

    const landedCes = state.aircraft.find((a) => a.id === ces.id)!;
    if (landedCes.phase !== 'LANDED') {
      throw new Error(`Expected CES5101 to land on ZSPD 34L (348°), got ${landedCes.phase}`);
    }
    return `上海浦东 (ZSPD) 34L/35R (348°) 错列双跑道盲降接地成功，HSN-1A (HSN→DUMET→PUDNG) 进场正常`;
  });

  // 测试 23 (V5.0)：伦敦希思罗国际机场 (EGLL) 西向平行双跑道 (27L/27R 270°) 与四角盘旋等待栈 (BNN/LAM/BIG/OCK)
  assertTest('23. [V5.0 EGLL 伦敦希思罗西向双跑道与四栈] 27L/27R(270°) 进近与 BNN/LAM/BIG/OCK 四角等待栈', () => {
    let state = createInitialSimulationState('NORMAL', true, {
      airportId: 'EGLL',
      runwayCountMode: 'DUAL',
    });
    if (state.airport.layoutType !== 'PARALLEL_WIDE_STACKS') {
      throw new Error(`Expected EGLL PARALLEL_WIDE_STACKS, got ${state.airport.layoutType}`);
    }
    const baw = state.aircraft.find((a) => a.callsign === 'BAW117')!;
    const vir = state.aircraft.find((a) => a.callsign === 'VIR402')!;
    if (baw.assignedRunway !== '27L') {
      throw new Error(`Expected BAW117 assigned 27L, got ${baw.assignedRunway}`);
    }

    state = issueSimulationCommand(state, vir.id, { type: 'HOLD', waypointId: 'LAM' });
    state = issueSimulationCommand(state, baw.id, { type: 'CLEARED_ILS', runwayId: '27L' });
    state = advanceSimulation(state, 330);

    const landedBaw = state.aircraft.find((a) => a.id === baw.id)!;
    const holdingVir = state.aircraft.find((a) => a.id === vir.id)!;
    if (landedBaw.phase !== 'LANDED' || holdingVir.phase !== 'HOLDING_AIR') {
      throw new Error(`Expected BAW117 LANDED on 27L and VIR402 HOLDING_AIR at LAM, got ${landedBaw.phase} & ${holdingVir.phase}`);
    }
    return `伦敦希思罗 (EGLL) BAW117 沿泰晤士河西向 27L (270°) 盲降着陆成功，VIR402 在 LAM 等待栈盘旋正常`;
  });

  // 测试 24 (V5.0)：四大机场差异化验证、禁航区侵入告警与全角度特情航班对准生成
  assertTest('24. [V5.0 四机场差异化与禁航区告警] 四座机场跑道/航路点完全独立且禁航区低空闯入触发告警扣分', () => {
    const rwySets = Object.values(AIRPORTS_DATABASE).map((ap) =>
      `${ap.id}:${ap.primaryFlowRunways.arrival}/${ap.primaryFlowRunways.departure}(${ap.runways[ap.primaryFlowRunways.arrival]!.heading}°)`
    );
    const uniqueCount = new Set(rwySets).size;
    if (uniqueCount !== 4) {
      throw new Error(`Expected 4 distinct runway configurations, got ${rwySets.join(', ')}`);
    }

    let pvgState = createInitialSimulationState('NORMAL', true, { airportId: 'ZSPD' });
    pvgState = spawnEmergencyFlightInState(pvgState, 'SQUAWK_7700_ENGINE');
    const pvgEmg = pvgState.aircraft.find((a) => a.squawkCode === '7700')!;
    if (pvgEmg.assignedRunway !== '34L' || pvgEmg.heading !== 348) {
      throw new Error(`Expected ZSPD emergency flight aligned with 34L (348°), got ${pvgEmg.assignedRunway}/${pvgEmg.heading}°`);
    }

    const intruder = createCustomAircraft({
      callsign: 'CES999',
      airlineName: 'CHINA EASTERN',
      airlineCn: '东方航空',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -13.0, y: 1.5 },
      heading: 90,
      altitude: 2500,
      speed: 200,
      assignedRunway: '34L',
    });
    const stepRes = updateAircraftPhysics(intruder, 1.0, PUDONG_AIRPORT, false);
    if (!stepRes.aircraft.inRestrictedZone || !stepRes.events.some((e) => e.type === 'RESTRICTED_ZONE_INTRUSION')) {
      throw new Error('Expected RESTRICTED_ZONE_INTRUSION event when flying below ceiling inside restricted zone');
    }
    return `四机场跑道完全独立 [${rwySets.join(' | ')}]；禁航区低空闯入告警与全角度特情对准验证通过`;
  });


  // 测试 25：ICAO 300m(1000ft) 标准高度层配备、AMAN 默认隐藏与航司航徽 SVG 验证
  assertTest('25. [ICAO 300m标准高度层 / AMAN默认隐藏 / 航司标志] 全部机场航路点与初始航班严格遵循 300m(1000ft) 高度层且 AMAN 默认隐藏', () => {
    if (DEFAULT_GAME_SETTINGS.showAmanTimeline !== false) {
      throw new Error(`Expected showAmanTimeline default false, got ${DEFAULT_GAME_SETTINGS.showAmanTimeline}`);
    }
    if (ICAO_STANDARD_ALTITUDE_LEVELS.length !== 8 || feetToStandardMeters(3000) !== 900 || feetToStandardMeters(6000) !== 1800) {
      throw new Error('Expected 8 ICAO standard levels with 3000ft=900m and 6000ft=1800m');
    }
    for (const ap of Object.values(AIRPORTS_DATABASE)) {
      for (const wp of ap.waypoints) {
        if (wp.recommendedAltitude % 1000 !== 0 || feetToStandardMeters(wp.recommendedAltitude) % 300 !== 0) {
          throw new Error(`Airport ${ap.id} waypoint ${wp.id} has non-standard altitude ${wp.recommendedAltitude}ft`);
        }
      }
      const st = createInitialSimulationState('HARD', true, { airportId: ap.id });
      for (const ac of st.aircraft) {
        if (ac.category === 'ARRIVAL' && (ac.altitude % 1000 !== 0 || feetToStandardMeters(ac.altitude) % 300 !== 0)) {
          throw new Error(`Airport ${ap.id} aircraft ${ac.callsign} has non-standard altitude ${ac.altitude}ft`);
        }
        const brand = getAirlineBrandByCallsign(ac.callsign);
        if (!brand.logoDataUri.startsWith('data:image/svg+xml')) {
          throw new Error(`Missing SVG airline logo for ${ac.callsign}`);
        }
      }
    }
    return '四大机场全部航路点/程序/航班 100% 符合 ICAO 300m(1000ft) 标准高度层，AMAN 默认隐藏，航司 SVG 标志正常';
  });


  // 测试 26 (V6.0)：中国民航公制高度单位默认播报显示 & CCAR-93TM 危险接近 (<2.8km/1.5NM 且 <150m) Game Over 保分机制
  assertTest('26. [V6.0 中国空管米制单位 & 危险接近 Game Over] 默认全米制(m)指令复诵及 <1.5NM(2.8km)/<150m 危险接近触发 Game Over 保分', () => {
    if (DEFAULT_GAME_SETTINGS.altitudeUnit !== 'METRIC') {
      throw new Error(`Expected default altitudeUnit METRIC, got ${DEFAULT_GAME_SETTINGS.altitudeUnit}`);
    }
    if (formatAltitudeValue(3000, 'METRIC') !== '900m' || formatAltitudeValue(3000, 'IMPERIAL') !== '3000ft') {
      throw new Error('Expected pure single-unit formatting 900m vs 3000ft');
    }

    let state = createInitialSimulationState('NORMAL', true);
    state.score = 380;
    const ac0 = state.aircraft[0];
    state = issueSimulationCommand(state, ac0.id, { type: 'ALT', altitude: 4000 });
    const lastLog = state.radioLogs[state.radioLogs.length - 1];
    if (!lastLog.messageCn.includes('1200 米') || lastLog.messageCn.includes('英尺')) {
      throw new Error(`Expected pure metric Chinese readback with 1200 米, got: ${lastLog.messageCn}`);
    }

    // 构造两机水平距离 1.1 NM (2.04 km < 2.8 km 红线)、垂直高度差 90m (300 ft < 150m 红线) 的危险接近
    const nearA = createCustomAircraft({
      callsign: 'CES991',
      airlineName: 'CHINA EASTERN',
      airlineCn: '东方航空',
      model: 'A320',
      category: 'ARRIVAL',
      position: { x: -8.0, y: 2.0 },
      heading: 90,
      altitude: 3000,
      speed: 200,
    });
    const nearB = createCustomAircraft({
      callsign: 'CCA992',
      airlineName: 'AIR CHINA',
      airlineCn: '中国国航',
      model: 'B738',
      category: 'ARRIVAL',
      position: { x: -6.9, y: 2.0 },
      heading: 270,
      altitude: 3300,
      speed: 200,
    });
    state.aircraft.push(nearA, nearB);
    const afterAccident = advanceSimulation(state, 0.25);
    if (afterAccident.status !== 'GAMEOVER' || afterAccident.score !== 380) {
      throw new Error(`Expected GAMEOVER with preserved score 380, got status=${afterAccident.status}, score=${afterAccident.score}`);
    }
    return `公制指令复诵 ("${lastLog.messageCn}") 纯米制无冗余；1.1NM/90m 危险接近准确触发 GAMEOVER 并保留本局得分 ${afterAccident.score} 分`;
  });


  // 测试 27 (V7.0 Steam 上架正式版)：对讲机静噪设置、进跑道等待 (LUAW)、一键引导切五边 (VECTOR_TO_FINAL)、离场自动 SID 接管与安全连击倍率
  assertTest("27. [V7.0 对讲机滋滋声 / LUAW / 一键五边 / 自动SID / 连击倍率] Steam 上架级全套机制与容错顺滑度验证", () => {
    if (DEFAULT_GAME_SETTINGS.vhfStaticLevel !== "MEDIUM") {
      throw new Error("Expected default vhfStaticLevel MEDIUM");
    }
    let state = createInitialSimulationState("NORMAL", true);
    const dep = state.aircraft.find((a) => a.category === "DEPARTURE")!;
    // 1. 测试进跑道等待 (LINE_UP_WAIT)
    state = issueSimulationCommand(state, dep.id, { type: "LINE_UP_WAIT", runwayId: "09R" });
    const luawDep = state.aircraft.find((a) => a.id === dep.id)!;
    if (luawDep.phase !== "LINE_UP_WAIT") {
      throw new Error("Expected LINE_UP_WAIT phase after LUAW command");
    }
    // 2. 从 LINE_UP_WAIT 起飞并验证爬升过 360m (1200ft) 自动切入已申报 SID 离场出口航路点
    state = issueSimulationCommand(state, dep.id, { type: "CLEARED_TAKEOFF", runwayId: "09R" });
    state = advanceSimulation(state, 90);
    const climbingDep = state.aircraft.find((a) => a.id === dep.id)!;
    if (!climbingDep.directWaypointId || climbingDep.targetAltitude < 6000) {
      throw new Error("Expected departure aircraft to auto-engage filed SID exit waypoint and 6000ft (1800m) climb");
    }

    // 3. 测试一键引导切入五边盲降 (VECTOR_TO_FINAL)
    const arr = state.aircraft.find((a) => a.callsign === "CCA1802")!;
    state = issueSimulationCommand(state, arr.id, { type: "VECTOR_TO_FINAL", runwayId: "09L" });
    const vtfArr = state.aircraft.find((a) => a.id === arr.id)!;
    if (!vtfArr.clearedApproach || vtfArr.targetAltitude > 3000) {
      throw new Error("Expected VECTOR_TO_FINAL to arm ILS approach and descend to <= 3000ft (900m)");
    }

    // 4. 验证安全连击倍率计算
    const ces = state.aircraft.find((a) => a.callsign === "CES5213")!;
    state = issueSimulationCommand(state, ces.id, { type: "CLEARED_ILS", runwayId: "09L" });
    state = advanceSimulation(state, 260);
    if (state.landedCount < 1 || state.safetyStreak < 1 || state.streakMultiplier < 1.2) {
      throw new Error(`Expected safetyStreak >= 1 and streakMultiplier >= 1.2 after safe landing, got ${state.safetyStreak}/${state.streakMultiplier}`);
    }
    return `对讲机滋滋声默认开启(MEDIUM)；LUAW 进跑道等待、离场自动 SID 导航、一键引导五边 (VTF) 与安全连击倍率 (${state.streakMultiplier}×) 全部验证通过`;
  });


  // 测试 28 (V7.5)：天气/风场/限制区自由开关、四机场主副五边100%避开限制区、全向一键五边必落、STAR自动转盲降与双模式Game Over
  assertTest("28. [V7.5 天气与限制区开关 / 五边净空 / 一键五边必落 / STAR自动盲降 / 双模式GameOver] 全面验证", () => {
    // 1. 验证默认天气为 CAVOK 晴好无风且无限制区活动
    const initSt = createInitialSimulationState("NORMAL", true);
    if (initSt.settings.enableWeatherCb !== false || initSt.settings.enableWind !== false || initSt.settings.enableRestrictedZones !== false) {
      throw new Error("Expected default NORMAL settings to have enableWeatherCb=false, enableWind=false, enableRestrictedZones=false");
    }
    if (initSt.weather.cells.length !== 0 || initSt.weather.windSpeedKt !== 0) {
      throw new Error("Expected default weather cells=[] and windSpeedKt=0");
    }

    // 2. 验证四大机场所有跑道（含换端方向）五边 0~15NM 走廊 100% 不与任何限制区重叠
    for (const ap of Object.values(AIRPORTS_DATABASE)) {
      for (const rwy of Object.values(ap.runways)) {
        const rad = (rwy.heading * Math.PI) / 180;
        const ux = Math.sin(rad);
        const uy = Math.cos(rad);
        for (let d = 1; d <= 15; d += 1) {
          const pt = { x: rwy.threshold.x - d * ux, y: rwy.threshold.y - d * uy };
          for (const rz of ap.restrictedZones || []) {
            const dist = distanceNM(pt, rz.center);
            if (dist <= rz.radiusNM + 0.5) {
              throw new Error(`Airport ${ap.id} runway ${rwy.id} final at ${d}NM conflicts with restricted zone ${rz.id} (dist=${dist.toFixed(2)}NM)`);
            }
          }
        }
      }
    }

    // 3. 验证全向一键引导五边 (VECTOR_TO_FINAL)：让西南远端偏置的 CCA1802 (-17.5, -9.0) 一键引导切入 09L 并完成盲降着陆
    let vtfState = createInitialSimulationState("EASY", true);
    const cca = vtfState.aircraft.find((a) => a.callsign === "CCA1802")!;
    // 移除其他飞机干扰单独测试 CCA1802 全程切五边落地
    vtfState.aircraft = [cca];
    vtfState = issueSimulationCommand(vtfState, cca.id, { type: "VECTOR_TO_FINAL", runwayId: "09L" });
    vtfState = advanceSimulation(vtfState, 520);
    const landedCca = vtfState.aircraft.find((a) => a.id === cca.id)!;
    if (landedCca.phase !== "LANDED") {
      throw new Error(`Expected CCA1802 to capture ILS and land via VECTOR_TO_FINAL, got phase=${landedCca.phase} at pos=(${landedCca.position.x.toFixed(1)},${landedCca.position.y.toFixed(1)}), alt=${Math.round(landedCca.altitude)}`);
    }

    // 4. 验证 STAR 进场程序飞完 FAF 后自动截获盲降并安全着陆
    let starState = createInitialSimulationState("EASY", true);
    const ccaStar = starState.aircraft.find((a) => a.callsign === "CCA1802")!;
    starState.aircraft = [ccaStar];
    starState = issueSimulationCommand(starState, ccaStar.id, { type: "STAR", procedureId: "SOUTH-1A" });
    starState = advanceSimulation(starState, 760);
    const landedStarAc = starState.aircraft.find((a) => a.id === ccaStar.id)!;
    if (landedStarAc.phase !== "LANDED") {
      throw new Error(`Expected CCA1802 on STAR SOUTH-1A to auto-capture ILS and land, got phase=${landedStarAc.phase}`);
    }

    // 5. 验证 REALISTIC 宽容模式 vs STRICT_ALL 硬核零容忍模式下的限制区闯入判定
    let strictState = createInitialSimulationState("NORMAL", true, {
      airportId: "ZSPD",
      enableRestrictedZones: true,
      gameOverRuleMode: "STRICT_ALL",
    });
    strictState.score = 260;
    const rzIntruder = createCustomAircraft({
      callsign: "CES998",
      airlineName: "CHINA EASTERN",
      airlineCn: "东方航空",
      model: "A320",
      category: "ARRIVAL",
      position: { x: -13.0, y: 1.5 },
      heading: 90,
      altitude: 2500,
      speed: 200,
      assignedRunway: "34L",
    });
    strictState.aircraft.push(rzIntruder);
    strictState = advanceSimulation(strictState, 0.5);
    if (strictState.status !== "GAMEOVER" || strictState.score !== 260) {
      throw new Error(`Expected STRICT_ALL mode to trigger GAMEOVER on restricted zone intrusion with preserved score 260, got ${strictState.status}/${strictState.score}`);
    }

    return "默认晴好无风无限制区；四机场8个五边100%净空；一键引导五边与STAR全自动盲降着陆成功；宽容/硬核双模式GameOver验证通过";
  });


  // 测试 29 (V8.0)：按住 Shift 话筒中英文模糊语音识别、仅播报机长复诵、以及管制员/飞行员独立语音开关验证
  assertTest("29. [V8.0 Shift模糊语音指挥 / 仅机长复诵播报 / 管制与飞行员独立语音开关] 全面验证", () => {
    const st = createInitialSimulationState("NORMAL", true);
    if (st.settings.atcTtsEnabled !== true || st.settings.pilotTtsEnabled !== true || st.settings.enableVoiceControl !== true) {
      throw new Error("Expected atcTtsEnabled, pilotTtsEnabled, and enableVoiceControl to default to true");
    }

    // 1. 验证中文口语模糊识别（呼号+高度+盲降复合指令："东航5213下600可以盲降"）
    const res1 = parseFuzzyVoiceTranscript("东航5213下600可以盲降", st.aircraft, st.selectedAircraftId, st.airport, st.activeRunwayDir, "DUAL");
    if (res1.matchedCallsign !== "CES5213" || !res1.commands.some((c) => c.type === "ALT" && c.altitude === 2000) || !res1.commands.some((c) => c.type === "CLEARED_ILS" || c.type === "VECTOR_TO_FINAL")) {
      throw new Error("Failed to fuzzy-parse Chinese compound command: " + JSON.stringify(res1));
    }

    // 2. 验证中文口语模糊识别（起飞指令："海航可以起飞"）
    const res2 = parseFuzzyVoiceTranscript("海航可以起飞", st.aircraft, st.selectedAircraftId, st.airport, st.activeRunwayDir, "DUAL");
    if (res2.matchedCallsign !== "CHH7601" || !res2.commands.some((c) => c.type === "CLEARED_TAKEOFF")) {
      throw new Error("Failed to fuzzy-parse Chinese takeoff command: " + JSON.stringify(res2));
    }

    // 3. 验证英文口语模糊识别（"Air China 1802 turn left heading 090 descend 3000 speed 180"）
    const res3 = parseFuzzyVoiceTranscript("Air China 1802 turn left heading 090 descend 3000 speed 180", st.aircraft, st.selectedAircraftId, st.airport, st.activeRunwayDir, "DUAL");
    if (res3.matchedCallsign !== "CCA1802" || res3.commands.length < 3) {
      throw new Error("Failed to fuzzy-parse English compound command: " + JSON.stringify(res3));
    }

    // 4. 验证话筒语音指挥 (suppressAtcTts: true) 下：通话记录包含管制与机长，但语音播报队列只含 PILOT 复诵！
    const afterVoice = issueSimulationCommand(st, res1.matchedAircraftId!, res1.commands, {
      suppressAtcTts: true,
      rawSpokenText: "东航5213下600可以盲降",
    });
    const hasAtcSpeech = afterVoice.pendingSpeechItems.some((item) => item.role === "ATC");
    const hasPilotSpeech = afterVoice.pendingSpeechItems.some((item) => item.role === "PILOT");
    if (hasAtcSpeech || !hasPilotSpeech) {
      throw new Error("Expected voice command mode to suppress ATC TTS and only enqueue PILOT readback speech");
    }

    return "中英文模糊口语识别 (下600盲降/起飞/航向速度)、话筒模式仅播报飞行员复诵、以及管制/飞行员独立语音开关全部验证通过";
  });


  // 测试 30 (V8.5)：民航陆空通话标准读音 (幺两三四五/六拐八九洞) 同音字纠偏、高度简语 (下幺两/上幺八)、呼号容错与播音读数格式化
  assertTest("30. [V8.5 陆空通话读音纠偏 (幺两/洞/拐) / 高度简语 / 呼号防串扰 / 播音格式化] 全面验证", () => {
    const st = createInitialSimulationState("NORMAL", true);

    // 1. 验证民航陆空通话十位数字及苹果/谷歌语音识别同音字转换
    const digitsNorm = normalizeChineseSpokenNumbers("幺两三四五，六拐八九洞");
    if (digitsNorm !== "12345，67890") {
      throw new Error("Expected 12345，67890, got: " + digitsNorm);
    }

    // 2. 验证苹果听写常见同音错字纠偏（"东航五两要三左转方向东九动下流百忙降洞酒左"）
    const homophoneRes = parseFuzzyVoiceTranscript(
      "东航五两要三左转方向东九动下流百忙降洞酒左",
      st.aircraft,
      st.selectedAircraftId,
      st.airport,
      st.activeRunwayDir,
      "DUAL"
    );
    if (
      homophoneRes.matchedCallsign !== "CES5213" ||
      !homophoneRes.commands.some((c) => c.type === "HDG" && c.heading === 90 && c.turnDirection === "LEFT") ||
      !homophoneRes.commands.some((c) => c.type === "ALT" && c.altitude === 2000) ||
      !homophoneRes.commands.some((c) => c.type === "CLEARED_ILS" || c.type === "VECTOR_TO_FINAL")
    ) {
      throw new Error("Failed homophone ATC command parse: " + JSON.stringify(homophoneRes));
    }

    // 3. 验证中国空管标准两位高度简语（"国航要八动两下幺两" -> 1200m / 4000ft；"海航怪六动要可以起飞上幺八" -> 1800m / 6000ft）
    const shortAltRes = parseFuzzyVoiceTranscript(
      "国航要八动两下幺两",
      st.aircraft,
      st.selectedAircraftId,
      st.airport,
      st.activeRunwayDir,
      "DUAL"
    );
    if (
      shortAltRes.matchedCallsign !== "CCA1802" ||
      !shortAltRes.commands.some((c) => c.type === "ALT" && c.altitude === 4000)
    ) {
      throw new Error("Failed shorthand altitude 下幺两 (1200m/4000ft): " + JSON.stringify(shortAltRes));
    }

    const depShortRes = parseFuzzyVoiceTranscript(
      "海航怪六动要可以起飞上幺八",
      st.aircraft,
      st.selectedAircraftId,
      st.airport,
      st.activeRunwayDir,
      "DUAL"
    );
    if (
      depShortRes.matchedCallsign !== "CHH7601" ||
      !depShortRes.commands.some((c) => c.type === "CLEARED_TAKEOFF") ||
      !depShortRes.commands.some((c) => c.type === "ALT" && c.altitude === 6000)
    ) {
      throw new Error("Failed departure + shorthand altitude 上幺八: " + JSON.stringify(depShortRes));
    }

    // 4. 验证航班号 1 位识别偏差容错且绝不串扰航向/高度（"东方5214右转航向幺八洞减速幺六洞"）
    const fuzzyCallRes = parseFuzzyVoiceTranscript(
      "东方5214右转航向幺八洞减速幺六洞",
      st.aircraft,
      st.selectedAircraftId,
      st.airport,
      st.activeRunwayDir,
      "DUAL"
    );
    if (
      fuzzyCallRes.matchedCallsign !== "CES5213" ||
      !fuzzyCallRes.commands.some((c) => c.type === "HDG" && c.heading === 180) ||
      !fuzzyCallRes.commands.some((c) => c.type === "SPD" && c.speed === 160) ||
      fuzzyCallRes.commands.some((c) => c.type === "ALT")
    ) {
      throw new Error("Failed fuzzy callsign + clause masking: " + JSON.stringify(fuzzyCallRes));
    }

    // 5. 验证中文 TTS 陆空通话播音格式化（航班号、航向、跑道转为洞/幺/两/拐标准读法）
    const formattedSpeech = formatChineseAtcRadiotelephonySpeech(
      "东方航空 5213，左转航向 090，下降并保持 900 米，可以跑道 09L 盲降进近。"
    );
    if (
      !formattedSpeech.includes("五两幺三") ||
      !formattedSpeech.includes("航向 洞九洞") ||
      !formattedSpeech.includes("洞九左")
    ) {
      throw new Error("Unexpected formatted Chinese ATC speech: " + formattedSpeech);
    }

    return "民航数字(幺两三四五/六拐八九洞)、同音纠偏(忙降/东九动/五两要三)、高度简语(下幺两/上幺八)与播音格式化全部验证通过";
  });

  // 测试 31 (V9.0 SenseVoice Small + 航空通话规范化引擎 + Kokoro TTS 航空发音预处理)：
  assertTest("31. [V9.0 SenseVoice上下文校验 / 航空通话规范化引擎 / Kokoro航空发音预处理 (B9001->Bravo niner zero zero one, 270->two seven zero)] 全面验证", () => {
    const st = createInitialSimulationState("NORMAL", true);

    // 1. 验证 Kokoro TTS 航空发音预处理器：B9001 -> Bravo niner zero zero one, 270 -> two seven zero
    const kokoroSample = formatKokoroAviationPhonetics(
      "B9001, TURN LEFT HEADING 270, CONTACT 125.8, CLEARED ILS RUNWAY 09L.",
      "EN"
    );
    if (
      !kokoroSample.includes("Bravo niner zero zero one") ||
      !kokoroSample.includes("two seven zero") ||
      !kokoroSample.includes("one two five decimal eight") ||
      !kokoroSample.includes("zero niner left")
    ) {
      throw new Error("Kokoro aviation phonetic conversion failed: " + kokoroSample);
    }

    // 2. 验证玩家说日常模糊口语（“5213下600盲降”）经航空通话规范化引擎后生成专业标准陆空通话并在 RadioLogs 中显示标准专业指令
    const normRes = parseFuzzyVoiceTranscript(
      "5213下600盲降",
      st.aircraft,
      st.selectedAircraftId,
      st.airport,
      st.activeRunwayDir,
      "DUAL",
      "METRIC"
    );
    if (
      normRes.matchedCallsign !== "CES5213" ||
      !normRes.standardAtcPhraseCn?.includes("东方航空 5213") ||
      !normRes.standardAtcPhraseCn?.includes("下降并保持 600 米") ||
      !normRes.standardAtcPhraseEn?.includes("CHINA EASTERN 5213") ||
      !normRes.kokoroPhoneticText?.includes("CHINA EASTERN five two one three")
    ) {
      throw new Error("Aviation phraseology normalizer failed: " + JSON.stringify(normRes));
    }

    const afterCmd = issueSimulationCommand(st, normRes.matchedAircraftId!, normRes.commands, {
      suppressAtcTts: true,
      rawSpokenText: "5213下600盲降",
    });
    const atcLogs = afterCmd.radioLogs.filter((l) => l.sender === "ATC");
    const lastAtcLog = atcLogs[atcLogs.length - 1];
    if (!lastAtcLog || !lastAtcLog.messageCn.includes("规范化标准陆空通话")) {
      throw new Error("Expected ATC radio log to display normalized standard ATC phraseology");
    }

    return `Kokoro发音预处理 ("${kokoroSample.slice(0, 56)}...") 与模糊口语规范化标准陆空通话 ("${normRes.standardAtcPhraseCn}") 全部验证通过`;
  });


  // 32. Legacy voice migration and aviation phonetics remain compatible.
  assertTest("32. [本地声源匹配 / 旧设置兼容 / 中文航空发音预处理] 全面验证", () => {
    const cnResolvedAtc = resolveVoiceIdForLanguage(
      { voiceURI: "am_adam", pitch: 1, rate: 1.1, presetLabel: "test", preferredGender: "MALE" },
      "ATC",
      "CN"
    );
    const cnResolvedPilot = resolveVoiceIdForLanguage(
      { voiceURI: "af_bella", pitch: 1, rate: 1.1, presetLabel: "test", preferredGender: "FEMALE" },
      "PILOT",
      "CN"
    );
    const enResolvedAtc = resolveVoiceIdForLanguage(
      { voiceURI: "zh-CN-YunxiNeural", pitch: 1, rate: 1.1, presetLabel: "test", preferredGender: "MALE" },
      "ATC",
      "EN"
    );
    if (cnResolvedAtc !== "Uncle_Fu" || cnResolvedPilot !== "Vivian" || enResolvedAtc !== "am_adam") {
      throw new Error(`Voice isolation failed: CN_ATC=${cnResolvedAtc}, CN_PILOT=${cnResolvedPilot}, EN_ATC=${enResolvedAtc}`);
    }
    const cnPhonetic = formatKokoroAviationPhonetics("CES5213 (A320 M)，左转航向 270，可以执行跑道 09L ILS 盲降进近。", "CN");
    if (!cnPhonetic.includes("东方航空 五两幺三") || !cnPhonetic.includes("两拐洞") || !cnPhonetic.includes("洞九左") || cnPhonetic.includes("CES") || cnPhonetic.includes("ILS")) {
      throw new Error("Chinese phonetic preprocessing left English tokens: " + cnPhonetic);
    }
    return `旧设置正确映射本地普通话 (${cnResolvedAtc}/${cnResolvedPilot})、英文模式锁定 Kokoro (${enResolvedAtc})，中文航空播音 ("${cnPhonetic}") 无英文缩写残留`;
  });

  return results;

}
