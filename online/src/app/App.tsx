import { uiText } from '../i18n/language';
import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../game/store';
import { TopStatusBar } from '../components/TopStatusBar';
import { RadarScopeCanvas } from '../components/RadarScopeCanvas';
import { FlightStripBay } from '../components/FlightStripBay';
import { CommandPanel } from '../components/CommandPanel';
import { RadioCommLog } from '../components/RadioCommLog';
import { GameModals } from '../components/GameModals';
import { normalizeHeading } from '../aircraft/physics';
import { soundEngine } from '../audio/soundEngine';

export const App: React.FC = () => {
  const commLogHeightPx = useGameStore((s) => s.commLogHeightPx);
  const shiftHeldRef = useRef(false);
  const uiLanguage = useGameStore((s) => s.uiLanguage);
  useEffect(() => {
    document.documentElement.lang = uiLanguage === 'EN' ? 'en' : 'zh-CN';
    document.title = uiText('ATC2.0 · 空中交通管制模拟', uiLanguage).trim();
  }, [uiLanguage]);

  // 固定步长模拟时钟；浏览器语音能力检测不发起网络请求。
  useEffect(() => {
    let lastTick = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dtSec = Math.min(0.5, Math.max(0.05, (now - lastTick) / 1000));
      lastTick = now;
      useGameStore.getState().tickSimulation(dtSec);
    }, 250);

    void soundEngine.checkLocalAiEngineHealth();

    return () => {
      window.clearInterval(timer);

    };
  }, []);

  // Shift 浏览器识别 → 现有指令解析与标准复诵。
  useEffect(() => {
    let pttRequest = 0;
    const startPttListening = () => {
      pttRequest += 1;
      const st = useGameStore.getState();
      if (!st.settings.enableVoiceControl || st.showPreGameLobby || st.showSettingsModal || shiftHeldRef.current) return;
      shiftHeldRef.current = true;

      // 半双工对讲机制：按下话筒瞬间立即停止扬声器正在播报的语音，防止串音
      soundEngine.stopAllSpeech();
      soundEngine.playVhfSquelchBurst('START', 'ATC', st.settings.vhfStaticLevel);

      st.setVoicePttState({
        isListening: true,
        pipelineStage: 'SHIFT_RECORDING',
        interimTranscript:
          '正在收音，请说出指令，松开 Shift 发送…',
        statusType: 'LISTENING',
      });

      void soundEngine
        .startPttRecording(st.settings.ttsLanguage, (liveText, volPct) => {
          if (!shiftHeldRef.current) return;
          const volBar = volPct > 0 ? `[音量 ${volPct}%] ` : '';
          useGameStore.getState().setVoicePttState({
            interimTranscript: liveText
              ? `🎤 ${volBar}实时识别中: “${liveText}”`
              : `🎤 ${volBar}正在收音，请说话（说完后松开 Shift 键立即执行）...`,
          });
        })
        .then((res) => {
          if (!res.ok && shiftHeldRef.current) {
            shiftHeldRef.current = false;
            useGameStore.getState().setVoicePttState({
              isListening: false,
              interimTranscript: '',
              lastSummaryCn: `⚠ ${res.errorMsg || '麦克风采集未就绪'}（也可在右下角输入指令）`,
              statusType: 'WARN',
            });
          }
        });
    };

    const stopPttListening = () => {
      if (!shiftHeldRef.current) return;
      shiftHeldRef.current = false;

      const st = useGameStore.getState();
      const requestId = pttRequest;
      const dispatchSettings = st.settings;
      soundEngine.playVhfSquelchBurst('END', 'ATC', st.settings.vhfStaticLevel);
      st.setVoicePttState({
        isListening: true,
        pipelineStage: 'SENSEVOICE_ASR',
        interimTranscript:
          '正在识别指令，请稍候…',
        statusType: 'LISTENING',
      });

      const activeCallsigns = st.aircraft
        .filter(
          (a) =>
            a.phase !== 'LANDED' &&
            a.phase !== 'HANDED_OFF' &&
            a.phase !== 'EXITED_AIRSPACE'
        )
        .map((a) => a.callsign);
      const waypoints = st.airport.waypoints.map((w) => w.id);
      const runways = Object.keys(st.airport.runways);

      void soundEngine
        .stopPttRecordingAndTranscribe({
          activeCallsigns,
          waypoints,
          runways,
          lang: st.settings.ttsLanguage,
        })
        .then((asrRes) => {
          const latestSt = useGameStore.getState();
          if (requestId !== pttRequest || latestSt.showPreGameLobby || latestSt.settings !== dispatchSettings) return;
          if (asrRes.ok && asrRes.verifiedTranscript.trim()) {
            latestSt.sendVoiceCommand((asrRes.rawTranscript || asrRes.verifiedTranscript).trim(), asrRes.alternatives || []);
          } else if (asrRes.errorDetail) {
            latestSt.setVoicePttState({
              isListening: false,
              pipelineStage: 'IDLE',
              interimTranscript: '',
              lastSummaryCn: `⚠ 语音未触发：${asrRes.errorDetail}`,
              statusType: 'WARN',
            });
          } else if (asrRes.engineOffline) {
            latestSt.setVoicePttState({
              isListening: false,
              pipelineStage: 'IDLE',
              interimTranscript: '',
              lastSummaryCn:
                '浏览器语音识别暂不可用，请使用文字输入或按钮',
              statusType: 'WARN',
            });
          } else {
            latestSt.setVoicePttState({
              isListening: false,
              pipelineStage: 'IDLE',
              interimTranscript: '',
              lastSummaryCn:
                '未检测到清晰语音片段（请按住 Shift 键不放、说完指令后再松开）',
              statusType: 'IDLE',
            });
          }
        });
    };

    (window as unknown as { __ATC_PTT_START__?: () => void }).__ATC_PTT_START__ = startPttListening;
    (window as unknown as { __ATC_PTT_STOP__?: () => void }).__ATC_PTT_STOP__ = stopPttListening;

    const cycleAircraft = (dir: 1 | -1) => {
      const st = useGameStore.getState();
      const active = st.aircraft.filter(
        (a) =>
          a.phase !== 'LANDED' &&
          a.phase !== 'HANDED_OFF' &&
          a.phase !== 'EXITED_AIRSPACE'
      );
      if (active.length === 0) return;
      const curIdx = active.findIndex((a) => a.id === st.selectedAircraftId);
      const nextIdx = (curIdx + dir + active.length) % active.length;
      st.selectAircraft(active[nextIdx].id);
    };

    const triggerPrimaryAction = () => {
      const st = useGameStore.getState();
      const ac = st.aircraft.find((a) => a.id === st.selectedAircraftId);
      if (!ac) return;
      if (ac.phase === 'HOLDING_GROUND' || ac.phase === 'LINE_UP_WAIT') {
        st.sendCommand({ type: 'CLEARED_TAKEOFF', runwayId: ac.assignedRunway });
      } else if (ac.phase === 'HOLD_CROSSING') {
        st.sendCommand({ type: 'CROSS_RUNWAY' });
      } else if (ac.category === 'DEPARTURE' && ac.canHandoff) {
        st.sendCommand({ type: 'HANDOFF' });
      } else if (ac.category === 'ARRIVAL') {
        st.sendCommand({ type: st.settings.requireLandingClearance && ac.clearedApproach && !ac.clearedToLand
          ? 'CLEARED_LAND' : 'CLEARED_ILS', runwayId: ac.assignedRunway });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      const tag = targetEl?.tagName;
      const isTextInput =
        tag === 'TEXTAREA' ||
        (tag === 'INPUT' && (targetEl as HTMLInputElement).type === 'text');

      // 兼容 Windows 11 中文输入法状态下按 Shift 返回 e.key === 'Process' 但 e.code === 'ShiftLeft'/'ShiftRight' 的情况！
      const isShiftKey =
        e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight';

      const st = useGameStore.getState();

      if (isShiftKey && !isTextInput && !e.repeat && st.settings.enableVoiceControl && !st.showPreGameLobby) {
        startPttListening();
        return;
      }

      if (isTextInput || tag === 'INPUT' || tag === 'SELECT') return;

      const ac = st.aircraft.find((a) => a.id === st.selectedAircraftId);

      if (e.code === 'Space') {
        e.preventDefault();
        st.togglePause();
      } else if (e.key === '1') {
        st.setGameSpeed(1);
      } else if (e.key === '2') {
        st.setGameSpeed(2);
      } else if (e.key === '4' || e.key === '3') {
        st.setGameSpeed(4);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleAircraft(e.shiftKey ? -1 : 1);
      } else if (e.key === 'ArrowLeft' && ac) {
        e.preventDefault();
        st.sendCommand({
          type: 'HDG',
          heading: normalizeHeading(Math.round(ac.targetHeading - 15)),
          turnDirection: 'LEFT',
        });
      } else if (e.key === 'ArrowRight' && ac) {
        e.preventDefault();
        st.sendCommand({
          type: 'HDG',
          heading: normalizeHeading(Math.round(ac.targetHeading + 15)),
          turnDirection: 'RIGHT',
        });
      } else if (e.key === 'ArrowUp' && ac) {
        e.preventDefault();
        st.sendCommand({
          type: 'ALT',
          altitude: Math.min(12000, Math.round((ac.targetAltitude + 1000) / 1000) * 1000),
        });
      } else if (e.key === 'ArrowDown' && ac) {
        e.preventDefault();
        st.sendCommand({
          type: 'ALT',
          altitude: Math.max(2000, Math.round((ac.targetAltitude - 1000) / 1000) * 1000),
        });
      } else if (e.key === 'Enter' && ac) {
        e.preventDefault();
        triggerPrimaryAction();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const isShiftKey =
        e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight';
      if (isShiftKey) {
        stopPttListening();
      }
    };

    const onWindowBlur = () => {
      if (shiftHeldRef.current) {
        pttRequest += 1;
        shiftHeldRef.current = false;
        soundEngine.cancelPttRecording();
        useGameStore.getState().setVoicePttState({isListening:false, interimTranscript:'', pipelineStage:'IDLE'});
      }
    };

    let lastButtonState: boolean[] = [];
    const gamepadInterval = window.setInterval(() => {
      if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
      const pads = navigator.getGamepads();
      const pad = pads && pads[0];
      const st = useGameStore.getState();
      if (!pad) {
        st.setGamepadConnected(false);
        return;
      }
      st.setGamepadConnected(true);
      const btns = pad.buttons.map((b) => b.pressed);
      const justPressed = (idx: number) => Boolean(btns[idx] && !lastButtonState[idx]);

      if (justPressed(4)) cycleAircraft(-1);
      if (justPressed(5)) cycleAircraft(1);
      if (justPressed(0)) triggerPrimaryAction();
      if (justPressed(9)) st.togglePause();

      const ac = st.aircraft.find((a) => a.id === st.selectedAircraftId);
      if (ac) {
        if (justPressed(14)) {
          st.sendCommand({
            type: 'HDG',
            heading: normalizeHeading(Math.round(ac.targetHeading - 15)),
            turnDirection: 'LEFT',
          });
        }
        if (justPressed(15)) {
          st.sendCommand({
            type: 'HDG',
            heading: normalizeHeading(Math.round(ac.targetHeading + 15)),
            turnDirection: 'RIGHT',
          });
        }
        if (justPressed(12)) {
          st.sendCommand({
            type: 'ALT',
            altitude: Math.min(12000, Math.round((ac.targetAltitude + 1000) / 1000) * 1000),
          });
        }
        if (justPressed(13)) {
          st.sendCommand({
            type: 'ALT',
            altitude: Math.max(2000, Math.round((ac.targetAltitude - 1000) / 1000) * 1000),
          });
        }
      }
      lastButtonState = btns;
    }, 100);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.clearInterval(gamepadInterval);
    };
  }, []);

  return (
    <div
      className="atc-workstation"
      data-testid="atc-workstation"
      style={{ gridTemplateRows: `${uiLanguage === 'EN' ? 'auto' : '52px'} 1fr ${commLogHeightPx}px` }}
    >
      <TopStatusBar />
      <main className="atc-main-body">
        <RadarScopeCanvas />
        <aside className="atc-right-sidebar">
          <FlightStripBay />
          <CommandPanel />
        </aside>
      </main>
      <RadioCommLog />
      <GameModals />
    </div>
  );
};

export default App;
