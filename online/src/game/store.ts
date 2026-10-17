import { MISSIONS, MissionProgress, loadMissionProgress, saveMissionProgress, isMissionUnlocked, createMissionState, missionStars } from './missions';
import { UiLanguage, loadUiLanguage, saveUiLanguage } from '../i18n/language';
import { useEffect, useState } from 'react';
import {
  AirportId,
  CareerAchievement,
  CareerProfile,
  GameDifficulty,
  GameSettings,
  RunwayDirectionConfig,
  SpeechQueueItem,
  TutorialState,
} from '../aircraft/types';
import {
  advanceSimulation,
  createDefaultCbCells,
  createInitialSimulationState,
  issueSimulationCommand,
  SimulationState,
  spawnEmergencyFlightInState,
  switchAirportRunwayDirection,
} from '../simulation/engine';
import { ATCCommand, parseTextCommand } from '../atc/commands';
import { parseVoiceCandidates, formatKokoroAviationPhonetics } from '../atc/voiceRecognizer';
import { RadarViewport } from '../radar/renderer';
import { soundEngine } from '../audio/soundEngine';
import { normalizeVoiceProfile, saveVoicePreferences, loadVoicePreferences } from '../audio/voiceCatalog';
import { createCustomAircraft } from '../traffic/spawner';
import { CAREER_ACHIEVEMENTS_CATALOG } from '../airport/harborAirport';
import { formatAltitudeSpeechCn } from '../aircraft/physics';

const CAREER_STORAGE_KEY = 'atc_command_v5_career_profile';

const DEFAULT_CAREER_PROFILE: CareerProfile = {
  totalLanded: 0,
  totalDeparted: 0,
  totalEmergenciesHandled: 0,
  totalShiftsCompleted: 0,
  highScoreByAirport: {
    ZSHB: 0,
    RJTT: 0,
    ZSPD: 0,
    EGLL: 0,
  },
  bestGradeByAirport: {
    ZSHB: '-',
    RJTT: '-',
    ZSPD: '-',
    EGLL: '-',
  },
  unlockedAchievementIds: [],
};

function loadCareerProfile(): CareerProfile {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_CAREER_PROFILE };
    }
    const raw = window.localStorage.getItem(CAREER_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CAREER_PROFILE };
    const parsed = JSON.parse(raw);
    return {
      totalLanded: parsed.totalLanded || 0,
      totalDeparted: parsed.totalDeparted || 0,
      totalEmergenciesHandled: parsed.totalEmergenciesHandled || 0,
      totalShiftsCompleted: parsed.totalShiftsCompleted || 0,
      highScoreByAirport: {
        ...DEFAULT_CAREER_PROFILE.highScoreByAirport,
        ...(parsed.highScoreByAirport || {}),
      },
      bestGradeByAirport: {
        ...DEFAULT_CAREER_PROFILE.bestGradeByAirport,
        ...(parsed.bestGradeByAirport || {}),
      },
      unlockedAchievementIds: Array.isArray(parsed.unlockedAchievementIds)
        ? parsed.unlockedAchievementIds
        : [],
    };
  } catch {
    return { ...DEFAULT_CAREER_PROFILE };
  }
}

function saveCareerProfile(profile: CareerProfile): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify(profile));
    }
  } catch {
    // ignore storage errors
  }
}

export interface GameOverSummary {
  score: number;
  landedCount: number;
  departedCount: number;
  conflictCount: number;
  reasonCn: string;
  reasonEn: string;
  airportNameCn: string;
  airportIcao: string;
}

export interface VoicePttState {
  candidateAircraftIds?: string[];
  correctionNote?: string;
  isListening: boolean;
  interimTranscript: string;
  lastSummaryCn: string;
  lastSpokenRaw: string;
  standardAtcPhraseCn?: string;
  standardAtcPhraseEn?: string;
  kokoroPhoneticPreview?: string;
  pipelineStage?: 'IDLE' | 'SHIFT_RECORDING' | 'SENSEVOICE_ASR' | 'AVIATION_NORMALIZER' | 'KOKORO_TTS_DONE';
  statusType: 'IDLE' | 'LISTENING' | 'SUCCESS' | 'WARN';
}

export type FeaturedScenarioId =
  | 'HARBOR_TUTORIAL'
  | 'PUDONG_STORM'
  | 'HANEDA_EMERGENCY'
  | 'HEATHROW_STACK_RUSH';

export interface AtcGameStore extends SimulationState {
  missionProgress: MissionProgress;
  missionRun: { id: string; recorded: boolean; stars: number } | null;
  startMission: (id: string) => void;
  uiLanguage: UiLanguage;
  setUiLanguage: (language: UiLanguage) => void;
  viewport: RadarViewport;
  isMuted: boolean;
  showPreGameLobby: boolean;
  showHelpModal: boolean;
  showSettingsModal: boolean;
  showCareerModal: boolean;
  commLogHeightPx: number;
  activeTab: 'ALL' | 'ARRIVAL' | 'DEPARTURE' | 'COMPLETED';
  career: CareerProfile;
  achievementToast: CareerAchievement | null;
  gamepadConnected: boolean;
  tutorial: TutorialState;
  lastGameOverSummary: GameOverSummary | null;
  voicePtt: VoicePttState;

  // Actions
  tickSimulation: (realDeltaSec: number) => void;
  selectAircraft: (aircraftId: string | null) => void;
  sendCommand: (cmd: ATCCommand | ATCCommand[], viaDragVector?: boolean) => void;
  sendTextCommand: (rawText: string) => boolean;
  sendVoiceCommand: (rawSpokenText: string, alternatives?: string[]) => {
    accepted: boolean;
    summaryCn: string;
    callsign: string | null;
  };
  setVoicePttState: (partial: Partial<VoicePttState>) => void;
  setGameSpeed: (speed: 1 | 2 | 4) => void;
  togglePause: () => void;
  setDifficulty: (difficulty: GameDifficulty) => void;
  updateSettings: (partial: Partial<GameSettings>, restartShift?: boolean) => void;
  applyLobbyConfigAndStart: (
    newSettings: Partial<GameSettings>,
    initialSpeed?: 1 | 2 | 4,
    startTutorial?: boolean
  ) => void;
  startFeaturedScenario: (scenarioId: FeaturedScenarioId) => void;
  openPreGameLobby: () => void;
  restartGame: (difficulty?: GameDifficulty, autoStart?: boolean) => void;
  startShift: () => void;
  enableFreePlay: () => void;
  toggleMute: () => void;
  switchRunwayConfig: (dir?: RunwayDirectionConfig) => void;
  simulateWindShift: (windDirDeg: number, windSpeedKt: number) => void;
  triggerEmergencyScenario: (
    type?: 'SQUAWK_7700_ENGINE' | 'SQUAWK_7700_FUEL' | 'SQUAWK_7600_NORDO'
  ) => void;
  previewVoice: (role: 'ATC' | 'PILOT', dryPlayback?: boolean) => void;
  previewWalkieTalkie: () => void;
  setShowHelpModal: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
  setShowCareerModal: (show: boolean) => void;
  dismissAchievementToast: () => void;
  unlockAchievement: (achievementId: string) => void;
  setGamepadConnected: (connected: boolean) => void;
  setCommLogHeightPx: (heightPx: number) => void;
  setActiveTab: (tab: 'ALL' | 'ARRIVAL' | 'DEPARTURE' | 'COMPLETED') => void;
  updateViewport: (partial: Partial<RadarViewport>) => void;
  resetViewport: () => void;
  spawnTestConflictScenario: () => void;

  // 新手教学与执照考核专用 Actions
  startRookieTutorial: () => void;
  advanceTutorialStep: () => void;
  completeTutorialLicenseExam: () => void;
  exitTutorialMode: () => void;
}

const DEFAULT_VIEWPORT: RadarViewport = {
  zoom: 1.0,
  panX: 0,
  panY: 0,
  showRangeRings: true,
  showWaypoints: true,
  showVectors: true,
  showTrails: true,
  showApproachCone: true,
  showWeatherRadar: true,
  showSeparationRings: false,
  vectorMinutes: 1,
};

type Listener = () => void;

class StoreContainer {
  private state: AtcGameStore;
  private listeners: Set<Listener> = new Set();

  constructor() {
    const initialSim = createInitialSimulationState('NORMAL', false);
    const initialCareer = loadCareerProfile();
    const voices = loadVoicePreferences(initialSim.settings.atcVoice, initialSim.settings.pilotVoice);
    initialSim.settings = { ...initialSim.settings, atcVoice: voices.atc, pilotVoice: voices.pilot };

    this.state = {
      ...initialSim,
      missionProgress: loadMissionProgress(),
      missionRun: null,
      startMission: (id: string) => {
        const cur = this.state;
        const mission = MISSIONS.find((item) => item.id === id);
        if (!mission || !isMissionUnlocked(id, cur.missionProgress)) return;
        soundEngine.stopAllSpeech();
        const sim = createMissionState(mission, cur.settings);
        this.setState({ ...sim, gameSpeed: 1, showPreGameLobby: false, showSettingsModal: false,
          lastGameOverSummary: null, missionRun: { id, recorded: false, stars: 0 },
          tutorial: { ...cur.tutorial, active: false, licensePassed: false } });
      },
      uiLanguage: loadUiLanguage(),
      setUiLanguage: (language: UiLanguage) => {
        if (language !== 'CN' && language !== 'EN') return;
        saveUiLanguage(language);
        this.setState({ uiLanguage: language });
      },
      viewport: { ...DEFAULT_VIEWPORT },
      isMuted: false,
      showPreGameLobby: true,
      showHelpModal: false,
      showSettingsModal: false,
      showCareerModal: false,
      commLogHeightPx: 136,
      activeTab: 'ALL',
      career: initialCareer,
      achievementToast: null,
      gamepadConnected: false,
      tutorial: {
        active: false,
        step: 1,
        licensePassed: false,
        licenseCertNo: 'ATC2-SIM-ZSHB-2026',
      },
      lastGameOverSummary: null,
      voicePtt: {
        isListening: false,
        interimTranscript: '',
        lastSummaryCn: '按住 Shift 或话筒说话，松开发送指令',
        lastSpokenRaw: '',
        standardAtcPhraseCn: '东方航空 5213，下降并保持 600 米，可以执行跑道 09L ILS 盲降进近。',
        standardAtcPhraseEn: 'CHINA EASTERN 5213, DESCEND AND MAINTAIN 600 METERS, CLEARED ILS RUNWAY 09L APPROACH.',
        kokoroPhoneticPreview: 'China Eastern five two one three, descend and maintain six hundred meters, cleared I L S runway zero niner left approach.',
        pipelineStage: 'IDLE',
        statusType: 'IDLE',
      },

      tickSimulation: (realDeltaSec: number) => {
        const cur = this.state;
        if (cur.isPaused || cur.status !== 'RUNNING') return;
        const simDelta = Math.min(Math.max(realDeltaSec, 0), 0.5) * cur.gameSpeed;
        const prevLanded = cur.landedCount;
        const prevDeparted = cur.departedCount;
        const nextSim = advanceSimulation(cur, simDelta);
        this.consumeSounds(nextSim.pendingSoundEvents, nextSim.pendingSpeechItems, false);

        if (nextSim.status === 'GAMEOVER') {
          const summary: GameOverSummary = {
            score: nextSim.score,
            landedCount: nextSim.landedCount,
            departedCount: nextSim.departedCount,
            conflictCount: nextSim.conflictCount,
            reasonCn: nextSim.endReasonCn,
            reasonEn: nextSim.endReasonEn,
            airportNameCn: nextSim.airport.nameCn,
            airportIcao: nextSim.airport.icao,
          };
          // Keep the failure scene for review; retry is explicit and preserves mission choice.
          this.setState({ ...nextSim, isPaused: true, lastGameOverSummary: summary,
            pendingSoundEvents: [], pendingSpeechItems: [] });
          return;
        }

        this.setState({
          ...nextSim,
          pendingSoundEvents: [],
          pendingSpeechItems: [],
        });
        this.evaluateCareerProgress(prevLanded, prevDeparted, nextSim);
        this.evaluateTutorialProgress(nextSim);
      },

      selectAircraft: (aircraftId: string | null) => {
        if (aircraftId && aircraftId !== this.state.selectedAircraftId) {
          soundEngine.play('SELECT');
        }
        this.setState({ selectedAircraftId: aircraftId });
      },

      sendCommand: (cmd: ATCCommand | ATCCommand[], viaDragVector: boolean = false) => {
        const cur = this.state;
        if (!cur.selectedAircraftId) return;
        const prevLanded = cur.landedCount;
        const prevDeparted = cur.departedCount;
        const nextSim = issueSimulationCommand(cur, cur.selectedAircraftId, cmd);
        this.consumeSounds(nextSim.pendingSoundEvents, nextSim.pendingSpeechItems, true);
        this.setState({
          ...nextSim,
          pendingSoundEvents: [],
          pendingSpeechItems: [],
        });
        if (viaDragVector) {
          this.state.unlockAchievement('DRAG_VECTOR_ACE');
        }
        this.evaluateCareerProgress(prevLanded, prevDeparted, nextSim);
        this.evaluateTutorialProgress(nextSim, cmd);
      },

      sendTextCommand: (rawText: string) => {
        const cur = this.state;
        if (!cur.selectedAircraftId) return false;
        const parsed = parseTextCommand(rawText);
        if (parsed) {
          const prevLanded = cur.landedCount;
          const prevDeparted = cur.departedCount;
          const nextSim = issueSimulationCommand(cur, cur.selectedAircraftId, parsed);
          this.consumeSounds(nextSim.pendingSoundEvents, nextSim.pendingSpeechItems, true);
          this.setState({
            ...nextSim,
            pendingSoundEvents: [],
            pendingSpeechItems: [],
          });
          this.evaluateCareerProgress(prevLanded, prevDeparted, nextSim);
          this.evaluateTutorialProgress(nextSim, parsed);
          return Boolean(nextSim.lastCommandResults?.some((result) => result.accepted));
        }
        // 若简令框输入的是中文自然语言口语（如“下600可以盲降”），自动调用模糊语义解析执行！
        const fuzzyRes = this.state.sendVoiceCommand(rawText);
        return fuzzyRes.accepted;
      },

      /**
       * V8.0 核心升级：按住 Shift 麦克风语音指挥飞机模式
       * 识别中英文模糊语音指令并执行，且语音里只播放飞行员 (PILOT) 的复诵声音！
       */
      sendVoiceCommand: (rawSpokenText: string, alternatives: string[] = []) => {
        const cur = this.state;
        const parsed = parseVoiceCandidates(
          rawSpokenText, alternatives,
          cur.aircraft,
          cur.selectedAircraftId,
          cur.airport,
          cur.activeRunwayDir,
          cur.settings.runwayCountMode,
          cur.settings.altitudeUnit,
          cur.settings.voiceAssistEnabled !== false
        );

        if (!parsed.matchedAircraftId || parsed.commands.length === 0) {
          this.setState({
            voicePtt: {
              ...this.state.voicePtt,
              isListening: false,
              interimTranscript: '',
              lastSpokenRaw: rawSpokenText,
              lastSummaryCn: parsed.summaryCn,
              candidateAircraftIds: parsed.candidateAircraftIds || [],
              correctionNote: parsed.correctionNote,
              pipelineStage: 'AVIATION_NORMALIZER',
              statusType: 'WARN',
            },
          });
          return {
            accepted: false,
            summaryCn: parsed.summaryCn,
            callsign: parsed.matchedCallsign,
          };
        }

        const prevLanded = cur.landedCount;
        const prevDeparted = cur.departedCount;
        const nextSim = issueSimulationCommand(
          {
            ...cur,
            selectedAircraftId: parsed.matchedAircraftId,
          },
          parsed.matchedAircraftId,
          parsed.commands,
          {
            suppressAtcTts: true, // 玩家已通过话筒亲口下达指令，语音里只听飞行员 Qwen / Kokoro TTS 复诵！
            rawSpokenText,
          }
        );

        const results = nextSim.lastCommandResults || [];
        const accepted = results.some((result) => result.accepted);
        const allAccepted = results.length > 0 && results.every((result) => result.accepted);
        const actualSummary = allAccepted ? `✓ 已执行：${results.map((result) => result.messageCn).join(' ')}`
          : accepted ? `部分执行：${results.map((result) => result.messageCn).join(' ')}`
          : `机组未执行：${results.map((result) => result.messageCn).join(' ')}`;
        this.consumeSounds(nextSim.pendingSoundEvents, nextSim.pendingSpeechItems, true);
        this.setState({
          ...nextSim,
          selectedAircraftId: parsed.matchedAircraftId,
          pendingSoundEvents: [],
          pendingSpeechItems: [],
          voicePtt: {
            isListening: false,
            interimTranscript: '',
            lastSpokenRaw: rawSpokenText,
            standardAtcPhraseCn: results.map((result) => result.atcMessageCn).join(' '),
            standardAtcPhraseEn: results.map((result) => result.atcMessageEn).join(' '),
            kokoroPhoneticPreview: formatKokoroAviationPhonetics(results.map((result) => result.atcMessageEn).join(' '), 'EN'),
            pipelineStage: accepted ? 'KOKORO_TTS_DONE' : 'AVIATION_NORMALIZER',
            lastSummaryCn: actualSummary,
            candidateAircraftIds: [], correctionNote: parsed.correctionNote,
            statusType: allAccepted ? 'SUCCESS' : 'WARN',
          },
        });
        this.evaluateCareerProgress(prevLanded, prevDeparted, nextSim);
        this.evaluateTutorialProgress(nextSim, parsed.commands);

        return {
          accepted,
          summaryCn: actualSummary,
          callsign: parsed.matchedCallsign,
        };
      },

      setVoicePttState: (partial: Partial<VoicePttState>) => {
        this.setState({
          voicePtt: {
            ...this.state.voicePtt,
            ...partial,
          },
        });
      },

      setGameSpeed: (speed: 1 | 2 | 4) => {
        const cur = this.state;
        this.setState({
          gameSpeed: speed,
          isPaused: cur.showPreGameLobby ? true : false,
          status: cur.showPreGameLobby ? 'BRIEFING' : 'RUNNING',
        });
      },

      togglePause: () => {
        const cur = this.state;
        if (cur.status === 'BRIEFING') {
          this.setState({ status: 'RUNNING', isPaused: false, showPreGameLobby: false });
        } else if (cur.status === 'RUNNING' || cur.status === 'PAUSED') {
          const nextPaused = !cur.isPaused;
          this.setState({
            isPaused: nextPaused,
            status: nextPaused ? 'PAUSED' : 'RUNNING',
          });
        }
      },

      setDifficulty: (difficulty: GameDifficulty) => {
        const cur = this.state;
        if (cur.showPreGameLobby) {
          const freshSim = createInitialSimulationState(difficulty, false, {
            ...cur.settings,
            difficulty,
          });
          this.setState({
            ...freshSim,
            gameSpeed: cur.gameSpeed,
            showPreGameLobby: true,
          });
        } else {
          this.setState({
            difficulty,
            settings: {
              ...cur.settings,
              difficulty,
            },
          });
        }
      },

      updateSettings: (partial: Partial<GameSettings>, restartShift: boolean = false) => {
        const cur = this.state;
        const safePartial = { ...partial };
        if (
          !cur.showPreGameLobby &&
          cur.status === 'RUNNING' &&
          safePartial.airportId &&
          safePartial.airportId !== cur.settings.airportId &&
          !restartShift
        ) {
          delete safePartial.airportId;
        }

        const nextLang = safePartial.ttsLanguage || cur.settings.ttsLanguage;
        const mergedSettings: GameSettings = {
          ...cur.settings, ...safePartial,
          atcVoice: normalizeVoiceProfile(cur.settings.atcVoice, safePartial.atcVoice, 'ATC', cur.settings.ttsLanguage, nextLang),
          pilotVoice: normalizeVoiceProfile(cur.settings.pilotVoice, safePartial.pilotVoice, 'PILOT', cur.settings.ttsLanguage, nextLang),
        };
        if (safePartial.atcVoice || safePartial.pilotVoice || safePartial.ttsLanguage) {
          soundEngine.stopAllSpeech();
          saveVoicePreferences(mergedSettings.atcVoice, mergedSettings.pilotVoice);
        }

        if (restartShift) {
          const freshSim = createInitialSimulationState(
            mergedSettings.difficulty,
            !cur.showPreGameLobby,
            mergedSettings
          );
          this.setState({
            ...freshSim,
            gameSpeed: cur.gameSpeed,
            settings: mergedSettings,
          });
        } else {
          const updatedWeather = {
            ...cur.weather,
            windSpeedKt: mergedSettings.enableWind
              ? cur.weather.windSpeedKt > 0
                ? cur.weather.windSpeedKt
                : cur.airport.defaultWindSpeedKt
              : 0,
            windDirectionDeg: mergedSettings.enableWind
              ? cur.weather.windDirectionDeg || cur.airport.defaultWindDirDeg
              : 0,
            cells: mergedSettings.enableWeatherCb
              ? cur.weather.cells.length > 0
                ? cur.weather.cells
                : createDefaultCbCells()
              : [],
          };

          const updatedAircraft = cur.aircraft.map((ac) => ({
            ...ac,
            inWeatherHazard: mergedSettings.enableWeatherCb ? ac.inWeatherHazard : false,
            inRestrictedZone: mergedSettings.enableRestrictedZones ? ac.inRestrictedZone : false,
          }));

          this.setState({
            settings: mergedSettings,
            difficulty: mergedSettings.difficulty,
            weather: updatedWeather,
            aircraft: updatedAircraft,
            viewport: {
              ...cur.viewport,
              showWeatherRadar: mergedSettings.enableWeatherCb
                ? true
                : cur.viewport.showWeatherRadar,
            },
          });
        }
      },

      applyLobbyConfigAndStart: (
        newSettings: Partial<GameSettings>,
        initialSpeed: 1 | 2 | 4 = 1,
        startTutorial: boolean = false
      ) => {
        if (startTutorial) {
          this.state.startRookieTutorial();
          return;
        }
        const cur = this.state;
        const mergedSettings: GameSettings = {
          ...cur.settings,
          ...newSettings,
        };
        const freshSim = createInitialSimulationState(
          mergedSettings.difficulty,
          true,
          mergedSettings
        );
        soundEngine.play('COMMAND');
        this.setState({
          ...freshSim,
          missionRun: null,
          gameSpeed: initialSpeed,
          settings: mergedSettings,
          showPreGameLobby: false,
          showSettingsModal: false,
          lastGameOverSummary: null,
          tutorial: {
            ...cur.tutorial,
            active: false,
            licensePassed: false,
          },
        });
      },

      startFeaturedScenario: (scenarioId: FeaturedScenarioId) => {
        this.setState({ missionRun: null });
        if (scenarioId === 'HARBOR_TUTORIAL') {
          this.state.startRookieTutorial();
          return;
        }
        const cur = this.state;
        if (scenarioId === 'PUDONG_STORM') {
          const settings: GameSettings = {
            ...cur.settings,
            airportId: 'ZSPD',
            difficulty: 'NORMAL',
            runwayCountMode: 'DUAL',
            altitudeUnit: 'METRIC',
            enableWeatherCb: true,
            enableWind: true,
            enableRestrictedZones: true,
            enableEmergencies: true,
          };
          const sim = createInitialSimulationState('NORMAL', true, settings);
          soundEngine.play('COMMAND');
          this.setState({
            ...sim,
            gameSpeed: 2,
            settings,
            showPreGameLobby: false,
            showSettingsModal: false,
            tutorial: { ...cur.tutorial, active: false, licensePassed: false },
          });
          return;
        }
        if (scenarioId === 'HANEDA_EMERGENCY') {
          const settings: GameSettings = {
            ...cur.settings,
            airportId: 'RJTT',
            difficulty: 'NORMAL',
            runwayCountMode: 'DUAL',
            altitudeUnit: 'METRIC',
            enableWeatherCb: false,
            enableWind: true,
            enableRestrictedZones: false,
            enableEmergencies: true,
          };
          let sim = createInitialSimulationState('NORMAL', true, settings);
          sim = spawnEmergencyFlightInState(sim, 'SQUAWK_7700_FUEL');
          this.consumeSounds(sim.pendingSoundEvents, sim.pendingSpeechItems, true);
          this.setState({
            ...sim,
            gameSpeed: 1,
            settings,
            showPreGameLobby: false,
            showSettingsModal: false,
            pendingSoundEvents: [],
            pendingSpeechItems: [],
            tutorial: { ...cur.tutorial, active: false, licensePassed: false },
          });
          return;
        }
        if (scenarioId === 'HEATHROW_STACK_RUSH') {
          const settings: GameSettings = {
            ...cur.settings,
            airportId: 'EGLL',
            difficulty: 'HARD',
            runwayCountMode: 'DUAL',
            altitudeUnit: 'IMPERIAL',
            wakeStandard: 'RECAT_EU',
            enableWeatherCb: true,
            enableWind: true,
            enableRestrictedZones: true,
            enableEmergencies: true,
          };
          const sim = createInitialSimulationState('HARD', true, settings);
          soundEngine.play('COMMAND');
          this.setState({
            ...sim,
            gameSpeed: 2,
            settings,
            showPreGameLobby: false,
            showSettingsModal: false,
            tutorial: { ...cur.tutorial, active: false, licensePassed: false },
          });
        }
      },

      openPreGameLobby: () => {
        soundEngine.cancelPttRecording();
        soundEngine.stopAllSpeech();
        this.setState({
          missionRun: null,
          isPaused: true,
          status: 'BRIEFING',
          showPreGameLobby: true,
          showSettingsModal: false,
        });
      },

      restartGame: (difficulty?: GameDifficulty, autoStart: boolean = true) => {
        const cur = this.state;
        if (cur.missionRun) { cur.startMission(cur.missionRun.id); return; }
        const targetDiff = difficulty || cur.difficulty;
        const freshSim = createInitialSimulationState(targetDiff, autoStart, {
          ...cur.settings,
          difficulty: targetDiff,
        });
        this.setState({
          ...freshSim,
          gameSpeed: cur.gameSpeed,
          showPreGameLobby: false,
          lastGameOverSummary: null,
        });
      },

      startShift: () => {
        this.setState({
          status: 'RUNNING',
          isPaused: false,
          showPreGameLobby: false,
          showSettingsModal: false,
        });
      },

      enableFreePlay: () => {
        this.setState({
          missionRun: null, trafficCap: undefined,
          status: 'RUNNING',
          isPaused: false,
          freePlayMode: true,
        });
      },

      toggleMute: () => {
        const muted = soundEngine.toggleMuted();
        this.setState({ isMuted: muted });
      },

      switchRunwayConfig: (dir?: RunwayDirectionConfig) => {
        const cur = this.state;
        const nextDir: RunwayDirectionConfig = dir || (cur.activeRunwayDir === '09' ? '27' : '09');
        const nextSim = switchAirportRunwayDirection(cur, nextDir);
        soundEngine.play('COMMAND');
        this.setState({ ...nextSim });
      },

      simulateWindShift: (windDirDeg: number, windSpeedKt: number) => {
        const cur = this.state;
        this.setState({
          settings: {
            ...cur.settings,
            enableWind: windSpeedKt > 0,
          },
          weather: {
            ...cur.weather,
            windDirectionDeg: windDirDeg,
            windSpeedKt,
            atisLetter: 'CHARLIE',
          },
        });
      },

      triggerEmergencyScenario: (
        type: 'SQUAWK_7700_ENGINE' | 'SQUAWK_7700_FUEL' | 'SQUAWK_7600_NORDO' = 'SQUAWK_7700_FUEL'
      ) => {
        const cur = this.state;
        const nextSim = spawnEmergencyFlightInState(cur, type);
        this.consumeSounds(nextSim.pendingSoundEvents, nextSim.pendingSpeechItems, true);
        this.setState({
          ...nextSim,
          pendingSoundEvents: [],
          pendingSpeechItems: [],
          showSettingsModal: false,
        });
      },

      previewVoice: (role: 'ATC' | 'PILOT', dryPlayback = false) => {
        soundEngine.previewRoleVoice(role, this.state.settings, dryPlayback);
      },

      previewWalkieTalkie: () => {
        soundEngine.previewWalkieTalkieSquelch(this.state.settings);
      },

      setShowHelpModal: (show: boolean) => {
        this.setState({ showHelpModal: show });
      },

      setShowSettingsModal: (show: boolean) => {
        this.setState({ showSettingsModal: show });
      },

      setShowCareerModal: (show: boolean) => {
        this.setState({ showCareerModal: show });
      },

      dismissAchievementToast: () => {
        this.setState({ achievementToast: null });
      },

      unlockAchievement: (achievementId: string) => {
        const curCareer = this.state.career;
        if (curCareer.unlockedAchievementIds.includes(achievementId)) return;
        const def = CAREER_ACHIEVEMENTS_CATALOG.find((a) => a.id === achievementId);
        if (!def) return;
        const nextCareer: CareerProfile = {
          ...curCareer,
          unlockedAchievementIds: [...curCareer.unlockedAchievementIds, achievementId],
        };
        saveCareerProfile(nextCareer);
        soundEngine.play('VICTORY');
        this.setState({
          career: nextCareer,
          achievementToast: {
            ...def,
            unlocked: true,
            unlockedAt: new Date().toLocaleTimeString(),
          },
        });
      },

      setGamepadConnected: (connected: boolean) => {
        if (this.state.gamepadConnected !== connected) {
          this.setState({ gamepadConnected: connected });
        }
      },

      setCommLogHeightPx: (heightPx: number) => {
        const clamped = Math.max(76, Math.min(420, Math.round(heightPx)));
        this.setState({ commLogHeightPx: clamped });
      },

      setActiveTab: (tab: 'ALL' | 'ARRIVAL' | 'DEPARTURE' | 'COMPLETED') => {
        this.setState({ activeTab: tab });
      },

      updateViewport: (partial: Partial<RadarViewport>) => {
        this.setState({
          viewport: { ...this.state.viewport, ...partial },
        });
      },

      resetViewport: () => {
        this.setState({ viewport: { ...DEFAULT_VIEWPORT } });
      },

      spawnTestConflictScenario: () => {
        const cur = this.state;
        const ac1 = createCustomAircraft({
          callsign: 'CES901',
          airlineName: 'CHINA EASTERN',
          airlineCn: '东方航空',
          model: 'B77W',
          category: 'ARRIVAL',
          position: { x: -9.0, y: 2.0 },
          heading: 180,
          altitude: 4000,
          speed: 210,
          simTimeSec: cur.simTimeSec,
        });
        const ac2 = createCustomAircraft({
          callsign: 'CCA902',
          airlineName: 'AIR CHINA',
          airlineCn: '中国国航',
          model: 'B738',
          category: 'ARRIVAL',
          position: { x: -9.0, y: 0.9 },
          heading: 0,
          altitude: 4200,
          speed: 210,
          simTimeSec: cur.simTimeSec,
        });

        const nextSim = advanceSimulation(
          {
            ...cur,
            isPaused: false,
            status: 'RUNNING',
            aircraft: [...cur.aircraft, ac1, ac2],
            selectedAircraftId: ac1.id,
          },
          0.25
        );
        this.consumeSounds(nextSim.pendingSoundEvents, nextSim.pendingSpeechItems, false);
        this.setState({
          ...nextSim,
          pendingSoundEvents: [],
          pendingSpeechItems: [],
        });
      },

      // ==================== 海湾机场 (ZSHB) 8 步新手教学与终端管制执照考核 ====================
      startRookieTutorial: () => {
        this.setState({ missionRun: null });
        const cur = this.state;
        const tutorialSettings: GameSettings = {
          ...cur.settings,
          airportId: 'ZSHB',
          runwayCountMode: 'DUAL',
          difficulty: 'EASY',
          altitudeUnit: 'METRIC',
          enableWeatherCb: false,
          enableWind: false,
          enableRestrictedZones: false,
          enableEmergencies: false,
          enableRookieCoach: true,
        };
        const freshSim = createInitialSimulationState('EASY', false, tutorialSettings);
        freshSim.trafficCap = 3;
        freshSim.landedTarget = 2;
        freshSim.departedTarget = 1;
        soundEngine.play('COMMAND');
        this.setState({
          ...freshSim,
          settings: tutorialSettings,
          gameSpeed: 1,
          isPaused: true,
          status: 'PAUSED',
          showPreGameLobby: false,
          showSettingsModal: false,
          lastGameOverSummary: null,
          tutorial: {
            active: true,
            step: 1,
            licensePassed: false,
            licenseCertNo: `CAAC-TRACON-ZSHB-${1000 + Math.floor(Math.random() * 8999)}`,
          },
        });
      },

      advanceTutorialStep: () => {
        const cur = this.state;
        if (!cur.tutorial.active) return;
        const nextStep = Math.min(8, cur.tutorial.step + 1);
        soundEngine.play('SELECT');

        if (nextStep === 5) {
          const depAc = cur.aircraft.find((a) => a.category === 'DEPARTURE');
          this.setState({
            isPaused: false,
            status: 'RUNNING',
            selectedAircraftId: depAc ? depAc.id : cur.selectedAircraftId,
            tutorial: {
              ...cur.tutorial,
              step: nextStep,
            },
          });
          return;
        }

        if (nextStep === 6) {
          const arrAc =
            cur.aircraft.find((a) => a.callsign === 'CES5213') ||
            cur.aircraft.find((a) => a.category === 'ARRIVAL');
          this.setState({
            isPaused: false,
            status: 'RUNNING',
            selectedAircraftId: arrAc ? arrAc.id : cur.selectedAircraftId,
            tutorial: {
              ...cur.tutorial,
              step: nextStep,
            },
          });
          return;
        }

        this.setState({
          tutorial: {
            ...cur.tutorial,
            step: nextStep,
          },
        });
      },

      completeTutorialLicenseExam: () => {
        if (this.state.landedCount < 2 || this.state.departedCount < 1) return;
        const cur = this.state;
        soundEngine.play('VICTORY');
        this.state.unlockAchievement('SHIFT_COMPLETED');
        this.setState({
          isPaused: true,
          tutorial: {
            ...cur.tutorial,
            active: true,
            step: 8,
            licensePassed: true,
          },
        });
      },

      exitTutorialMode: () => {
        const cur = this.state;
        this.setState({
          isPaused: false,
          status: 'RUNNING',
          tutorial: {
            ...cur.tutorial,
            active: false,
            licensePassed: false,
          },
        });
      },
    };
  }

  private evaluateTutorialProgress(
    nextSim: SimulationState,
    issuedCmd?: ATCCommand | ATCCommand[]
  ): void {
    const cur = this.state;
    if (!cur.tutorial.active || cur.tutorial.licensePassed) return;

    const requested = issuedCmd ? (Array.isArray(issuedCmd) ? issuedCmd : [issuedCmd]) : [];
    const cmdList = requested.filter((_, index) => nextSim.lastCommandResults?.[index]?.accepted);
    let step = cur.tutorial.step;

    if (
      step === 5 &&
      (cmdList.some((c) => c.type === 'CLEARED_TAKEOFF') ||
        nextSim.aircraft.some(
          (a) =>
            a.category === 'DEPARTURE' &&
            a.phase !== 'HOLDING_GROUND' &&
            a.phase !== 'LINE_UP_WAIT'
        ))
    ) {
      step = 6;
      const ces = nextSim.aircraft.find((a) => a.callsign === 'CES5213');
      if (ces) {
        this.setState({ selectedAircraftId: ces.id });
      }
    }

    if (
      step === 6 &&
      (cmdList.some((c) => c.type === 'CLEARED_ILS' || c.type === 'VECTOR_TO_FINAL') ||
        nextSim.aircraft.some((a) => a.clearedApproach || a.phase === 'FINAL_APPROACH'))
    ) {
      step = 7;
    }

    if (
      step === 7 &&
      cmdList.some(
        (c) =>
          c.type === 'STAR' ||
          c.type === 'SID' ||
          c.type === 'ALT' ||
          c.type === 'HDG' ||
          c.type === 'DCT' ||
          c.type === 'HANDOFF' ||
          c.type === 'VECTOR_TO_FINAL'
      )
    ) {
      step = 8;
    }

    if (
      (nextSim.landedCount >= 2 && nextSim.departedCount >= 1) ||
      nextSim.status === 'VICTORY'
    ) {
      soundEngine.play('VICTORY');
      this.state.unlockAchievement('SHIFT_COMPLETED');
      this.setState({
        status: 'RUNNING',
        isPaused: true,
        tutorial: {
          ...cur.tutorial,
          step: 8,
          licensePassed: true,
        },
      });
      return;
    }

    if (step !== cur.tutorial.step) {
      this.setState({
        tutorial: {
          ...cur.tutorial,
          step,
        },
      });
    }
  }

  private evaluateCareerProgress(
    prevLanded: number,
    prevDeparted: number,
    nextSim: SimulationState
  ): void {
    const run = this.state.missionRun;
    if (nextSim.status === 'VICTORY' && run && !run.recorded) {
      const mission = MISSIONS.find((item) => item.id === run.id)!;
      const stars = missionStars(nextSim, mission), old = this.state.missionProgress[run.id];
      if (stars > 0) {
        const missionProgress = { ...this.state.missionProgress, [run.id]: {
          stars: Math.max(stars, old?.stars || 0), bestScore: Math.max(nextSim.score, old?.bestScore || 0),
          bestTimeSec: old ? Math.min(old.bestTimeSec, nextSim.simTimeSec) : nextSim.simTimeSec } };
        saveMissionProgress(missionProgress);
        this.setState({ missionProgress, missionRun: { ...run, recorded: true, stars } });
      }
    }
    const landedDelta = Math.max(0, nextSim.landedCount - prevLanded);
    const departedDelta = Math.max(0, nextSim.departedCount - prevDeparted);
    if (landedDelta === 0 && departedDelta === 0 && nextSim.status !== 'VICTORY') {
      return;
    }

    const curCareer = { ...this.state.career };
    curCareer.totalLanded += landedDelta;
    curCareer.totalDeparted += departedDelta;

    const apId: AirportId = nextSim.airport.id;
    if (nextSim.score > (curCareer.highScoreByAirport[apId] || 0)) {
      curCareer.highScoreByAirport = {
        ...curCareer.highScoreByAirport,
        [apId]: nextSim.score,
      };
    }

    if (nextSim.status === 'VICTORY') {
      curCareer.totalShiftsCompleted += 1;
      const grade =
        nextSim.score >= 1200 && nextSim.conflictCount === 0
          ? 'S'
          : nextSim.score >= 950 && nextSim.conflictCount <= 1
          ? 'A'
          : nextSim.score >= 650
          ? 'B'
          : 'C';
      curCareer.bestGradeByAirport = {
        ...curCareer.bestGradeByAirport,
        [apId]: grade,
      };
    }

    saveCareerProfile(curCareer);
    this.setState({ career: curCareer });

    if (landedDelta > 0) {
      this.state.unlockAchievement('FIRST_LANDING');
      if (nextSim.settings.wakeStandard === 'RECAT_EU') {
        this.state.unlockAchievement('RECAT_SPECIALIST');
      }
      if (apId === 'RJTT') this.state.unlockAchievement('HANEDA_CROSSWIND');
      if (apId === 'ZSPD') this.state.unlockAchievement('PUDONG_HEAVY_HUB');
      if (apId === 'EGLL') this.state.unlockAchievement('HEATHROW_STACK_PRO');

      const landedEmg = nextSim.aircraft.find(
        (a) => a.phase === 'LANDED' && a.emergencyType !== 'NONE'
      );
      if (landedEmg) {
        if (landedEmg.emergencyType === 'SQUAWK_7600_NORDO') {
          this.state.unlockAchievement('NORDO_WHISPERER');
        } else {
          this.state.unlockAchievement('MAYDAY_SAVIOR');
        }
      }
    }

    if (departedDelta > 0) {
      this.state.unlockAchievement('FIRST_HANDOFF');
    }

    if (curCareer.totalLanded + curCareer.totalDeparted >= 50) {
      this.state.unlockAchievement('VETERAN_50_MOVEMENTS');
    }

    if (nextSim.status === 'VICTORY') {
      this.state.unlockAchievement('SHIFT_COMPLETED');
      if (nextSim.score >= 1200 && nextSim.conflictCount === 0) {
        this.state.unlockAchievement('S_RANK_MASTER');
      }
    }
  }

  private consumeSounds(
    events: SimulationState['pendingSoundEvents'],
    speechItems: SpeechQueueItem[],
    cancelPreviousSpeech: boolean = false
  ): void {
    if (events && events.length > 0) {
      const unique = Array.from(new Set(events));
      for (const ev of unique) {
        soundEngine.play(ev);
      }
    }
    if (speechItems && speechItems.length > 0) {
      soundEngine.speakQueue(speechItems, this.state.settings, cancelPreviousSpeech);
    }
  }

  public getState = (): AtcGameStore => {
    return this.state;
  };

  public setState = (partial: Partial<AtcGameStore>): void => {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l());
  };

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

const storeInstance = new StoreContainer();

export function useGameStore(): AtcGameStore;
export function useGameStore<T>(selector: (state: AtcGameStore) => T): T;
export function useGameStore<T>(selector?: (state: AtcGameStore) => T): T | AtcGameStore {
  const [, forceRender] = useState(0);

  useEffect(() => {
    return storeInstance.subscribe(() => {
      forceRender((n) => n + 1);
    });
  }, []);

  const state = storeInstance.getState();
  return selector ? selector(state) : state;
}

useGameStore.getState = storeInstance.getState;
useGameStore.setState = storeInstance.setState;
useGameStore.subscribe = storeInstance.subscribe;

if (typeof window !== 'undefined') {
  (window as unknown as { __ATC_STORE__?: typeof useGameStore }).__ATC_STORE__ = useGameStore;
}
export { formatAltitudeSpeechCn };
