import { AirportId, GameDifficulty, GameSettings } from '../aircraft/types';
import { createInitialSimulationState, SimulationState } from '../simulation/engine';
import { computeAmanSequence, getRunwayConfig } from '../aircraft/physics';

export interface Mission {
  id: string; titleCn: string; titleEn: string; descriptionCn: string; descriptionEn: string;
  airportId: AirportId; difficulty: GameDifficulty; arrivals: number; departures: number;
  trafficCap: number; parTimeSec: number; wind?: boolean; emergencies?: boolean;
}
export const MISSIONS: Mission[] = [
  { id: 'FIRST_LANDING', titleCn: '第一关：我的首架落地', titleEn: '1. Your first landing',
    descriptionCn: '只有一架进港飞机。先说“可以盲降”，看它完成落地。',
    descriptionEn: 'One arrival. Say "cleared ILS approach" and guide it to touchdown.',
    airportId: 'ZSHB', difficulty: 'EASY', arrivals: 1, departures: 0, trafficCap: 1, parTimeSec: 240 },
  { id: 'FIRST_DEPARTURE', titleCn: '第二关：进出港搭配', titleEn: '2. Arrivals and departures',
    descriptionCn: '两架飞机，练习起飞、引导进近和移交；没有特情和坏天气。',
    descriptionEn: 'Two aircraft. Practice takeoff, approach and handoff in calm weather.',
    airportId: 'ZSHB', difficulty: 'EASY', arrivals: 1, departures: 1, trafficCap: 2, parTimeSec: 600 },
  { id: 'PUDONG_FLOW', titleCn: '第三关：浦东双跑道', titleEn: '3. Pudong parallel flow',
    descriptionCn: '管理三架飞机，安排双跑道进出港；进近后还需发布着陆许可。',
    descriptionEn: 'Manage three aircraft on parallel runways. Issue a separate landing clearance.',
    airportId: 'ZSPD', difficulty: 'NORMAL', arrivals: 2, departures: 1, trafficCap: 3, parTimeSec: 840 },
  { id: 'HANEDA_CROSSING', titleCn: '第四关：羽田交叉挑战', titleEn: '4. Haneda crossing challenge',
    descriptionCn: '交叉跑道需要取舍，先看五边，再给起飞许可。',
    descriptionEn: 'Check final before clearing takeoff on intersecting runways.',
    airportId: 'RJTT', difficulty: 'NORMAL', arrivals: 3, departures: 2, trafficCap: 4, parTimeSec: 1200, wind: true },
  { id: 'HEATHROW_MASTER', titleCn: '第五关：希思罗值班长', titleEn: '5. Heathrow shift leader',
    descriptionCn: '综合运用等待、排序和移交，应对繁忙流量与特情。',
    descriptionEn: 'Use holding, sequencing and handoffs to manage busy traffic and emergencies.',
    airportId: 'EGLL', difficulty: 'HARD', arrivals: 4, departures: 2, trafficCap: 6, parTimeSec: 1500, wind: true, emergencies: true },
];
export interface MissionRecord { stars: number; bestScore: number; bestTimeSec: number; }
export type MissionProgress = Record<string, MissionRecord>;
const STORAGE_KEY = 'atc2.missions';
export function loadMissionProgress(): MissionProgress {
  try {
    if (typeof window === 'undefined') return {};
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    const result: MissionProgress = {};
    for (const mission of MISSIONS) {
      const record = parsed?.[mission.id];
      if (record && Number.isFinite(record.stars) && record.stars >= 1) {
        result[mission.id] = { stars: Math.min(3, Math.floor(record.stars)),
          bestScore: Number.isFinite(record.bestScore) ? Math.max(0, record.bestScore) : 0,
          bestTimeSec: Number.isFinite(record.bestTimeSec) ? Math.max(0, record.bestTimeSec) : 0 };
      }
    }
    return result;
  } catch { return {}; }
}
export function saveMissionProgress(progress: MissionProgress): void {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); } catch { /* optional storage */ }
}
export function isMissionUnlocked(id: string, progress: MissionProgress): boolean {
  const index = MISSIONS.findIndex((mission) => mission.id === id);
  return index >= 0 && (index === 0 || Boolean(progress[MISSIONS[index - 1].id]));
}
export function missionStars(state: SimulationState, mission: Mission): number {
  if (state.status !== 'VICTORY' || state.landedCount < mission.arrivals || state.departedCount < mission.departures) return 0;
  const clean = state.conflictCount === 0 && state.exitedCount === 0;
  return 1 + Number(clean) + Number(clean && state.simTimeSec <= mission.parTimeSec);
}
export function createMissionState(mission: Mission, settings: GameSettings): SimulationState {
  const sim = createInitialSimulationState(mission.difficulty, true, { ...settings,
    airportId: mission.airportId, difficulty: mission.difficulty, altitudeUnit: 'METRIC',
    enableRookieCoach: true, voiceAssistEnabled: true, showAmanTimeline: true,
    requireLandingClearance: MISSIONS.findIndex((item) => item.id === mission.id) >= 2,
    enableWeatherCb: false, enableRestrictedZones: false,
    enableWind: Boolean(mission.wind), enableEmergencies: Boolean(mission.emergencies), gameOverRuleMode: 'REALISTIC' });
  const arrivals = sim.aircraft.filter((ac) => ac.category === 'ARRIVAL').slice(0, Math.min(mission.arrivals, mission.trafficCap - Number(mission.departures > 0)));
  const departures = sim.aircraft.filter((ac) => ac.category === 'DEPARTURE').slice(0, Number(mission.departures > 0));
  const aircraft = [...arrivals, ...departures];
  if (mission.id === 'FIRST_LANDING') {
    const ac = aircraft[0], runway = getRunwayConfig(sim.airport, ac.assignedRunway);
    const headingRad = runway.heading * Math.PI / 180;
    ac.position = { x: runway.threshold.x - Math.sin(headingRad) * 5.5,
      y: runway.threshold.y - Math.cos(headingRad) * 5.5 };
    ac.altitude = ac.targetAltitude = 2000; ac.heading = ac.targetHeading = runway.heading;
    ac.speed = ac.targetSpeed = 170; ac.trail = [];
  }
  return { ...sim, aircraft, landedTarget: mission.arrivals, departedTarget: mission.departures,
    trafficCap: mission.trafficCap, selectedAircraftId: aircraft[0]?.id || null,
    amanSequence: computeAmanSequence(aircraft, sim.airport),
    radioLogs: sim.radioLogs.filter((entry) => !entry.callsign || aircraft.some((ac) => ac.callsign === entry.callsign)) };
}
