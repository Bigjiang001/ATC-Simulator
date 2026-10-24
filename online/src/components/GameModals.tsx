import { localizeUi } from '../i18n/react';
import React, { useEffect, useState } from 'react';
import { useGameStore } from '../game/store';
import { formatUtcClock } from '../simulation/engine';
import {
  AirportId,
  AltitudeUnit,
  GameDifficulty,
  GameOverRuleMode,
  RunwayCountMode,
  TtsLanguage,
  VhfStaticLevel,
  WakeStandard,
} from '../aircraft/types';
import {
  AIRPORTS_DATABASE,
  CAREER_ACHIEVEMENTS_CATALOG,
} from '../airport/harborAirport';
import { soundEngine } from '../audio/soundEngine';
import { recommendedSpeechRate } from '../audio/voiceCatalog';

export const GameModals: React.FC = () => {
  const store = useGameStore();
  const [reviewSettlement, setReviewSettlement] = useState(false);
  useEffect(() => {
    if (store.status !== 'VICTORY' && store.status !== 'GAMEOVER') setReviewSettlement(false);
  }, [store.status]);
  const s = store.settings;
  const vp = store.viewport;
  // 系统声音可能异步出现，通过 voiceschanged 更新选项。
  const [, setVoicesTick] = useState(0);
  useEffect(() => {
    void soundEngine.checkLocalAiEngineHealth().then(() => setVoicesTick((n) => n + 1));
    const update = () => setVoicesTick(n => n + 1);
    window.speechSynthesis?.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', update);
  }, [store.showSettingsModal]);
  const curatedVoices = soundEngine.getAvailableVoices(s.ttsLanguage);
  const aiStatus = soundEngine.getAiEngineStatus();

  // 岗前执勤准备界面本地选择状态
  const [lobbyMode, setLobbyMode] = useState<'STANDARD' | 'TUTORIAL'>('STANDARD');
  const [lobbyDiff, setLobbyDiff] = useState<GameDifficulty>(s.difficulty);
  const [lobbySpeed, setLobbySpeed] = useState<1 | 2 | 4>(store.gameSpeed);
  const [lobbyAirportId, setLobbyAirportId] = useState<AirportId>(s.airportId);
  const [lobbyRunwayMode, setLobbyRunwayMode] = useState<RunwayCountMode>(s.runwayCountMode);
  const [lobbyAltUnit, setLobbyAltUnit] = useState<AltitudeUnit>(s.altitudeUnit || 'METRIC');
  const [lobbyWeatherCb, setLobbyWeatherCb] = useState<boolean>(Boolean(s.enableWeatherCb));
  const [lobbyWind, setLobbyWind] = useState<boolean>(Boolean(s.enableWind));
  const [lobbyRestricted, setLobbyRestricted] = useState<boolean>(
    Boolean(s.enableRestrictedZones)
  );
  const [lobbyVoiceControl, setLobbyVoiceControl] = useState<boolean>(
    s.enableVoiceControl !== false
  );
  const [lobbyGameOverRule] = useState<GameOverRuleMode>(
    s.gameOverRuleMode || 'REALISTIC'
  );

  const getGrade = (score: number, conflicts: number): { grade: string; title: string } => {
    if (score >= 1200 && conflicts === 0) return { grade: 'S', title: '首席雷达管制教员' };
    if (score >= 950 && conflicts <= 1) return { grade: 'A', title: '资深终端区进近管制员' };
    if (score >= 650) return { grade: 'B', title: '合格一线空管员' };
    return { grade: 'C', title: '见习空管员' };
  };

  const airportsList = Object.values(AIRPORTS_DATABASE);
  const selectedLobbyAirport = AIRPORTS_DATABASE[lobbyAirportId] || AIRPORTS_DATABASE.ZSHB;

  const languagePicker = (location: 'lobby' | 'settings') => (
    <div className="settings-card" data-testid={`ui-language-${location}`}>
      <h3>🌐 界面语言</h3>
      <div className="btn-grid-row" role="group" aria-label="界面语言">
        <button type="button" className={`btn-cmd ${store.uiLanguage === 'CN' ? 'active' : ''}`}
          data-testid={`ui-language-cn-${location}`} aria-pressed={store.uiLanguage === 'CN'}
          onClick={() => store.setUiLanguage('CN')}>简体中文</button>
        <button type="button" className={`btn-cmd ${store.uiLanguage === 'EN' ? 'active' : ''}`}
          data-testid={`ui-language-en-${location}`} aria-pressed={store.uiLanguage === 'EN'}
          onClick={() => store.setUiLanguage('EN')}>English</button>
      </div>
      <div className="ils-status-hint">仅切换界面文字，陆空通话记录与语音语言保持不变。</div>
    </div>
  );

  const voiceRoleSettings = (role: 'ATC' | 'PILOT') => {
    const key = role === 'ATC' ? 'atcVoice' : 'pilotVoice';
    const slug = role === 'ATC' ? 'atc' : 'pilot';
    const profile = s[key];
    const enabled = role === 'ATC' ? s.atcTtsEnabled !== false : s.pilotTtsEnabled !== false;
    const update = (partial: Partial<typeof profile>) => store.updateSettings({[key]: {...profile, ...partial}});
    const available = curatedVoices.some(v => v.voiceURI === profile.voiceURI);
    return <div className="voice-role-box" data-testid={`${slug}-voice-box`}>
      <div className="voice-role-header">
        <strong>{role === 'ATC' ? '🎧 管制员语音 (ATC)' : '👨‍✈️ 飞行员语音 (PILOT)'}</strong>
        <button type="button" className={`btn-cmd ${enabled ? 'active' : ''}`} data-testid={`toggle-${slug}-tts`}
          onClick={() => store.updateSettings(role === 'ATC' ? {atcTtsEnabled: !enabled} : {pilotTtsEnabled: !enabled})}>
          {enabled ? '🔊 开启语音' : '🔇 仅文字'}</button>
      </div>
      <label htmlFor={`${slug}-voice-select`}>浏览器音色</label>
      <select id={`${slug}-voice-select`} value={profile.voiceURI} data-testid={`select-${slug}-voice-uri`}
        onChange={e => update({voiceURI:e.target.value})} className="voice-dropdown">
        {!available && <option value={profile.voiceURI}>已保存音色暂不可用</option>}
        {curatedVoices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} — {v.description}</option>)}
      </select>
      {role === 'PILOT' && !curatedVoices.some(v => !v.voiceURI.startsWith('browser:') && v.gender === 'MALE') && (
        <div className="voice-description" role="status" data-testid="missing-male-voice">
          {store.uiLanguage === 'EN'
            ? 'Safari has not provided a male voice for this language. In iPad Settings → Accessibility → Read & Speak (or Spoken Content) → Voices, download a male voice, then return and refresh the voices. Availability depends on Safari.'
            : 'Safari 尚未提供当前语言的男声。可在 iPad 设置 → 辅助功能 → 朗读与语音（或朗读内容）→ 声音，下载男声后返回刷新音色；实际可用音色以 Safari 提供的列表为准。'}
        </div>
      )}
      <div className="voice-description">{role === 'ATC' ? '默认优先匹配女声' : '默认优先匹配男声'} · 可试听后自行选择</div>
      <div className="voice-rate-header"><label htmlFor={`${slug}-voice-rate`}>播报语速</label>
        <output data-testid={`${slug}-voice-rate-value`}>{profile.rate.toFixed(2)}×</output>
        <button type="button" className="btn-voice-preview" onClick={()=>update({rate:recommendedSpeechRate(s.ttsLanguage)})}>恢复推荐</button>
      </div>
      <input id={`${slug}-voice-rate`} type="range" min="0.9" max="1.5" step="0.01" value={profile.rate}
        aria-label={role==='ATC'?'管制员播报语速':'飞行员播报语速'} data-testid={`${slug}-voice-rate`}
        onChange={e=>update({rate:Number(e.target.value)})} className="voice-rate-slider" />
      <button type="button" className="btn-voice-preview" data-testid={`btn-preview-${slug}-voice`} onClick={()=>store.previewVoice(role)}>试听</button>
    </div>;
  };

  return localizeUi((
    <>
      {/* ==================== 0. 游戏开始前：岗前执勤配置大厅 (按钮文字精炼不溢出) ==================== */}
      {store.showPreGameLobby && (
        <div className="modal-backdrop" data-testid="pregame-lobby-modal">
          <div className="modal-card modal-xl">
            <div className="modal-banner banner-info">
              <div className="modal-kicker">
                ATC2.0 · BROWSER EDITION · PRE-SHIFT DISPATCH LOBBY
              </div>
              <h2 className="modal-heading">
                🛫 空中交通管制模拟 · 岗前执勤大厅
              </h2>
            </div>

            <div className="settings-scroll-body">
              {languagePicker('lobby')}
              <div className="settings-card" data-testid="online-browser-notice">
                <strong>🎙️ 浏览器语音与麦克风</strong>
                <div className="ils-status-hint">推荐使用最新版 Chrome；其他浏览器以实际支持情况为准。</div>
                <div className="ils-status-hint">语音识别可能由浏览器厂商联网处理，音频可能发送至其服务；按住 Shift 即开始识别。</div>
                {!soundEngine.getBrowserSpeechCapabilities().recognition && <div className="hint-warn">当前浏览器不支持语音识别，请使用文字输入或按钮</div>}
              </div>
              {/* 第一步：选择执勤模式与难度 (4列整齐网格，按钮简短不溢出) */}
              <div className="settings-card">
                <h3>第一步：选择模式与难度</h3>
                <div
                  className="btn-grid-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: '6px',
                  }}
                >
                  <button
                    type="button"
                    className={`btn-cmd ${lobbyMode === 'TUTORIAL' ? 'active-warn' : ''}`}
                    data-testid="lobby-mode-tutorial"
                    onClick={() => {
                      setLobbyMode('TUTORIAL');
                      setLobbyAirportId('ZSHB');
                      setLobbyDiff('EASY');
                      setLobbyWeatherCb(false);
                      setLobbyWind(false);
                      setLobbyRestricted(false);
                    }}
                  >
                    🎓 新手教学 (考证)
                  </button>
                  {(
                    [
                      { id: 'EASY', label: '简单 EASY' },
                      { id: 'NORMAL', label: '普通 NORMAL' },
                      { id: 'HARD', label: '困难 HARD' },
                    ] as Array<{ id: GameDifficulty; label: string }>
                  ).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`btn-cmd ${
                        lobbyMode === 'STANDARD' && lobbyDiff === d.id ? 'active' : ''
                      }`}
                      data-testid={`lobby-diff-${d.id.toLowerCase()}`}
                      onClick={() => {
                        setLobbyMode('STANDARD');
                        setLobbyDiff(d.id);
                        if (d.id === 'HARD') {
                          setLobbyWeatherCb(true);
                          setLobbyWind(true);
                          setLobbyRestricted(true);
                        } else {
                          setLobbyWeatherCb(false);
                          setLobbyWind(false);
                          setLobbyRestricted(false);
                        }
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 第二步：模拟倍速、高度制式、天气/限制区与语音指挥 */}
              <div className="settings-card">
                <h3>第二步：模拟倍速、高度制式、气象环境与语音指挥</h3>
                <div className="setting-two-col">
                  <div className="setting-row-block">
                    <span className="setting-label">1. 初始倍速：</span>
                    <div
                      className="btn-grid-row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                        gap: '5px',
                      }}
                    >
                      {(
                        [
                          { spd: 1, label: '1× 常速' },
                          { spd: 2, label: '2× 二倍速' },
                          { spd: 4, label: '4× 四倍速' },
                        ] as Array<{ spd: 1 | 2 | 4; label: string }>
                      ).map((item) => (
                        <button
                          key={item.spd}
                          type="button"
                          className={`btn-cmd ${lobbySpeed === item.spd ? 'active' : ''}`}
                          data-testid={`lobby-speed-${item.spd}x`}
                          onClick={() => setLobbySpeed(item.spd)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="setting-row-block">
                    <span className="setting-label">2. 高度计量制式：</span>
                    <div
                      className="btn-grid-row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: '5px',
                      }}
                    >
                      <button
                        type="button"
                        className={`btn-cmd ${lobbyAltUnit === 'METRIC' ? 'active' : ''}`}
                        data-testid="lobby-alt-metric"
                        onClick={() => setLobbyAltUnit('METRIC')}
                      >
                        🇨🇳 公制 (米 / m)
                      </button>
                      <button
                        type="button"
                        className={`btn-cmd ${lobbyAltUnit === 'IMPERIAL' ? 'active' : ''}`}
                        data-testid="lobby-alt-imperial"
                        onClick={() => setLobbyAltUnit('IMPERIAL')}
                      >
                        🌐 英制 (英尺 / ft)
                      </button>
                    </div>
                  </div>
                </div>

                <div className="setting-row-block" style={{ marginTop: '2px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span className="setting-label">
                      3. 天气、限制区与 Shift 语音指挥开关：
                    </span>
                    <button
                      type="button"
                      className="btn-voice-preview"
                      data-testid="lobby-btn-cavok-clear"
                      onClick={() => {
                        setLobbyWeatherCb(false);
                        setLobbyWind(false);
                        setLobbyRestricted(false);
                      }}
                    >
                      ☀ 一键设为好天气无限制区
                    </button>
                  </div>
                  <div
                    className="btn-grid-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                      gap: '5px',
                    }}
                  >
                    <button
                      type="button"
                      className={`btn-cmd ${lobbyWeatherCb ? 'active-warn' : 'active'}`}
                      data-testid="lobby-toggle-cb"
                      onClick={() => setLobbyWeatherCb(!lobbyWeatherCb)}
                    >
                      {lobbyWeatherCb ? '⚡ 雷雨CB：开' : '☀ 雷雨CB：关'}
                    </button>
                    <button
                      type="button"
                      className={`btn-cmd ${lobbyWind ? 'active-warn' : 'active'}`}
                      data-testid="lobby-toggle-wind"
                      onClick={() => setLobbyWind(!lobbyWind)}
                    >
                      {lobbyWind ? '💨 地面风：开' : '🍃 地面风：关'}
                    </button>
                    <button
                      type="button"
                      className={`btn-cmd ${lobbyRestricted ? 'active-warn' : 'active'}`}
                      data-testid="lobby-toggle-restricted"
                      onClick={() => setLobbyRestricted(!lobbyRestricted)}
                    >
                      {lobbyRestricted ? '⛔ 限制区：有活动' : '🟢 限制区：无活动'}
                    </button>
                    <button
                      type="button"
                      className={`btn-cmd ${lobbyVoiceControl ? 'active' : ''}`}
                      data-testid="lobby-toggle-voice-control"
                      onClick={() => setLobbyVoiceControl(!lobbyVoiceControl)}
                    >
                      {lobbyVoiceControl ? '🎙️ Shift语音指挥：开' : '🎙️ Shift语音指挥：关'}
                    </button>
                  </div>
                </div>
              </div>

              {/* 第三步：选择机场扇区地图 (卡片精炼不溢出) */}
              <div className="settings-card">
                <h3>第三步：选择执勤机场地图</h3>
                <div className="airport-cards-grid">
                  {airportsList.map((ap) => {
                    const isSelected = lobbyAirportId === ap.id;
                    const disabledByTutorial = lobbyMode === 'TUTORIAL' && ap.id !== 'ZSHB';
                    return (
                      <button
                        key={ap.id}
                        type="button"
                        disabled={disabledByTutorial}
                        className={`airport-select-card ${isSelected ? 'active' : ''}`}
                        data-testid={`select-airport-${ap.id}`}
                        title={`${ap.nameCn} · ${ap.layoutBadgeCn}`}
                        style={{ opacity: disabledByTutorial ? 0.45 : 1 }}
                        onClick={() => setLobbyAirportId(ap.id)}
                      >
                        <div className="ap-code">
                          {ap.icao} · {ap.iata}
                        </div>
                        <div className="ap-name">{ap.nameCn}</div>
                        <div className="ap-sub">
                          跑道：{ap.primaryFlowRunways.arrival} / {ap.primaryFlowRunways.departure}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="setting-two-col" style={{ marginTop: '4px' }}>
                  <div className="ils-status-hint">
                    <span className="hint-ok">
                      📍 【{selectedLobbyAirport.nameCn} ({selectedLobbyAirport.icao})】：
                      {selectedLobbyAirport.layoutBadgeCn}
                    </span>
                  </div>
                  <div className="setting-row-block">
                    <div
                      className="btn-grid-row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: '5px',
                      }}
                    >
                      <button
                        type="button"
                        className={`btn-cmd ${lobbyRunwayMode === 'DUAL' ? 'active' : ''}`}
                        onClick={() => setLobbyRunwayMode('DUAL')}
                      >
                        双跑道 ({selectedLobbyAirport.primaryFlowRunways.arrival}/
                        {selectedLobbyAirport.primaryFlowRunways.departure})
                      </button>
                      <button
                        type="button"
                        className={`btn-cmd ${lobbyRunwayMode === 'SINGLE' ? 'active' : ''}`}
                        onClick={() => setLobbyRunwayMode('SINGLE')}
                      >
                        单跑道 ({selectedLobbyAirport.primaryFlowRunways.arrival})
                      </button>
                    </div>
                  </div>
                </div>
              </div>


            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                data-testid="btn-lobby-start-tutorial"
                onClick={() => store.startRookieTutorial()}
              >
                🎓 进入海湾机场新手教学
              </button>
              <button
                type="button"
                className="btn-primary"
                data-testid="btn-start-playing"
                onClick={() =>
                  store.applyLobbyConfigAndStart(
                    {
                      airportId: lobbyAirportId,
                      difficulty: lobbyDiff,
                      runwayCountMode: lobbyRunwayMode,
                      altitudeUnit: lobbyAltUnit,
                      enableWeatherCb: lobbyWeatherCb,
                      enableWind: lobbyWind,
                      enableRestrictedZones: lobbyRestricted,
                      enableVoiceControl: lobbyVoiceControl,
                      gameOverRuleMode: lobbyGameOverRule,
                    },
                    lobbySpeed,
                    lobbyMode === 'TUTORIAL'
                  )
                }
              >
                {lobbyMode === 'TUTORIAL'
                  ? '🎓 开始新手教学与执照考试'
                  : `▶ 开始执勤 (${selectedLobbyAirport.icao} · ${lobbyDiff} · ${lobbySpeed}×)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 1. 局内设置弹窗 (In-Game Settings Modal) ==================== */}
      {store.showSettingsModal && (
        <div className="modal-backdrop" data-testid="settings-modal">
          <div className="modal-card modal-xl">
            <div className="modal-banner banner-info">
              <div className="modal-kicker">
                ATC2.0 · IN-SHIFT SYSTEM CONFIGURATION
              </div>
              <h2 className="modal-heading">
                ⚙ 系统设置（Shift 语音指挥 / 管制与机长独立语音开关 / 音色与语速 / 气象与限制区）
              </h2>
            </div>

            <div className="settings-scroll-body">
              {languagePicker('settings')}
              <div className="settings-card">
                <h3>进近与着陆许可</h3>
                <button type="button" data-testid="toggle-landing-clearance" className={`btn-cmd ${s.requireLandingClearance ? 'active' : ''}`}
                  onClick={() => store.updateSettings({ requireLandingClearance: !s.requireLandingClearance })}>
                  {s.requireLandingClearance ? '程序训练：单独发布着陆许可' : '新手简化：进近后自动着陆'}
                </button>
                <small>程序训练中，ILS 许可仅允许进近；还需说“可以着陆”。未获着陆许可时，机组会在短五边自动复飞。可在此切换。</small>
              </div>
              <div className="settings-card">
                <h3>🎙 中文新手语音辅助</h3>
                <button type="button" data-testid="toggle-voice-assist" className={`btn-cmd ${s.voiceAssistEnabled !== false ? 'active' : ''}`}
                  onClick={() => store.updateSettings({ voiceAssistEnabled: s.voiceAssistEnabled === false })}>
                  {s.voiceAssistEnabled !== false ? '新手辅助：开启' : '新手辅助：关闭'}
                </button>
                <small>根据已选航班、当前进离港状态纠正常见同音字和呼号；有歧义时先选航班再重说。不会跳过跑道与尾流安全检查。</small>
              </div>
              {/* 区块 1：V8.0 按住 Shift 话筒语音指挥 & 管制员/飞行员独立语音播报开关与精选音色 */}
              <div className="settings-card">
                <h3>🎙️ 浏览器语音与麦克风</h3>
                <div className="ils-status-hint" data-testid="browser-speech-status">
                  <div>推荐使用最新版 Chrome；其他浏览器以实际支持情况为准。</div>
                  <div>{soundEngine.getBrowserSpeechCapabilities().recognition ? '当前浏览器提供语音识别接口' : '当前浏览器不支持语音识别，请使用文字输入或按钮'}</div>
                  <div>语音识别可能由浏览器厂商联网处理，音频可能发送至其服务；按住 Shift 即开始识别。</div>
                  <div>没有匹配的男声或女声时使用当前语言可用音色；可在下方手动选择。</div>
                  {aiStatus.lastTtsError && <div role="status">{aiStatus.lastTtsError}</div>}
                </div>
                <div className="setting-two-col">
                  <div className="setting-row-block">
                    <span className="setting-label">
                      1. 🎙️ 按住 Shift 键麦克风语音指挥模式（开启后按住 Shift 说话识别，仅播报飞行员复诵）：
                    </span>
                    <div className="btn-grid-row">
                      <button
                        type="button"
                        className={`btn-cmd ${s.enableVoiceControl !== false ? 'active' : ''}`}
                        data-testid="toggle-voice-control"
                        onClick={() =>
                          store.updateSettings({
                            enableVoiceControl: s.enableVoiceControl === false,
                          })
                        }
                      >
                        {s.enableVoiceControl !== false
                          ? '🎙️ 按住 Shift 语音指挥：已开启'
                          : '🎙️ 按住 Shift 语音指挥：已关闭'}
                      </button>
                      <button
                        type="button"
                        className={`btn-cmd ${!store.isMuted ? 'active' : ''}`}
                        data-testid="toggle-audio-mute"
                        onClick={() => store.toggleMute()}
                      >
                        {store.isMuted ? '🔇 全局静音中' : '🔊 全局音效：开启'}
                      </button>
                    </div>
                  </div>

                  <div className="setting-row-block">
                    <span className="setting-label">
                      2. 语音识别与陆空通话语言 (支持中英文模糊口语识别)：
                    </span>
                    <div className="btn-grid-row">
                      {(
                        [
                          { id: 'CN', label: '🇨🇳 中文普通话 (通话+识别)' },
                          { id: 'EN', label: '🌐 英文 ICAO (通话+识别)' },
                        ] as Array<{ id: TtsLanguage; label: string }>
                      ).map((lang) => (
                        <button
                          key={lang.id}
                          type="button"
                          className={`btn-cmd ${s.ttsLanguage === lang.id ? 'active' : ''}`}
                          data-testid={`select-tts-lang-${lang.id.toLowerCase()}`}
                          onClick={() => store.updateSettings({ ttsLanguage: lang.id })}
                        >
                          {lang.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="setting-two-col">
                  {voiceRoleSettings('ATC')}
                  {voiceRoleSettings('PILOT')}
                </div>
                <button type="button" className="btn-voice-preview" data-testid="btn-refresh-voices"
                  onClick={() => setVoicesTick(n => n + 1)}>{store.uiLanguage === 'EN' ? 'Refresh voices' : '刷新系统音色'}</button>
                <div className="voice-catalog-note">
                  声音由当前浏览器和系统提供，无需下载游戏模型。性别根据音色名称推测，以试听为准。
                  音色和语速按中英文分别保存。浏览器播报无法应用游戏的电台滤波，仍保留通话提示音与可调底噪。
                </div>

                {/* 对讲机甚高频静电滋滋声强度 */}
                <div className="setting-row-block">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span className="setting-label">
                      3. 📻 甚高频对讲机滋滋声与 PTT 按键尾音强度：
                    </span>
                    <button
                      type="button"
                      className="btn-voice-preview"
                      data-testid="btn-preview-vhf-static"
                      onClick={() => store.previewWalkieTalkie()}
                    >
                      📻 试听对讲机滋滋声
                    </button>
                  </div>
                  <div
                    className="btn-grid-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                      gap: '5px',
                    }}
                  >
                    {(
                      [
                        { id: 'OFF', label: '关闭底噪 (OFF)' },
                        { id: 'LOW', label: '轻微静噪 (LOW)' },
                        { id: 'MEDIUM', label: '标准对讲机 (MEDIUM)' },
                        { id: 'HIGH', label: '强静电感 (HIGH)' },
                      ] as Array<{ id: VhfStaticLevel; label: string }>
                    ).map((lv) => (
                      <button
                        key={lv.id}
                        type="button"
                        className={`btn-cmd ${
                          (s.vhfStaticLevel || 'MEDIUM') === lv.id ? 'active' : ''
                        }`}
                        data-testid={`select-vhf-static-${lv.id.toLowerCase()}`}
                        onClick={() => {
                          store.updateSettings({ vhfStaticLevel: lv.id });
                          if (lv.id !== 'OFF') {
                            soundEngine.previewWalkieTalkieSquelch({
                              ...s,
                              vhfStaticLevel: lv.id,
                            });
                          }
                        }}
                      >
                        {lv.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 区块 2：气象环境 (CB雷雨/地面风)、空域限制区活动与 Game Over 规则 */}
              <div className="settings-card">
                <h3>二、天气环境（CB雷雨/地面风）、限制区活动与 Game Over 规则</h3>
                <div
                  className="btn-grid-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: '6px',
                  }}
                >
                  <button
                    type="button"
                    className={`btn-cmd ${s.enableWeatherCb ? 'active-warn' : 'active'}`}
                    data-testid="toggle-weather-cb"
                    onClick={() =>
                      store.updateSettings({ enableWeatherCb: !s.enableWeatherCb })
                    }
                  >
                    {s.enableWeatherCb ? '⚡ 雷雨云团(CB)：开启' : '☀ 雷雨云团(CB)：关闭'}
                  </button>
                  <button
                    type="button"
                    className={`btn-cmd ${s.enableWind ? 'active-warn' : 'active'}`}
                    data-testid="toggle-wind"
                    onClick={() => store.updateSettings({ enableWind: !s.enableWind })}
                  >
                    {s.enableWind ? '💨 地面风切变：开启' : '🍃 地面风：关闭(静风)'}
                  </button>
                  <button
                    type="button"
                    className={`btn-cmd ${s.enableRestrictedZones ? 'active-warn' : 'active'}`}
                    data-testid="toggle-restricted-activity"
                    onClick={() =>
                      store.updateSettings({
                        enableRestrictedZones: !s.enableRestrictedZones,
                      })
                    }
                  >
                    {s.enableRestrictedZones ? '⛔ 限制区活动：开启' : '🟢 限制区：无活动'}
                  </button>
                </div>

                <div
                  className="btn-grid-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: '6px',
                  }}
                >
                  <button
                    type="button"
                    className={`btn-cmd ${
                      (s.gameOverRuleMode || 'REALISTIC') === 'REALISTIC' ? 'active' : ''
                    }`}
                    data-testid="select-gameover-realistic"
                    onClick={() => store.updateSettings({ gameOverRuleMode: 'REALISTIC' })}
                  >
                    🟢 民航宽容模式 (仅危险接近/相撞 Game Over)
                  </button>
                  <button
                    type="button"
                    className={`btn-cmd ${
                      s.gameOverRuleMode === 'STRICT_ALL' ? 'active-warn' : ''
                    }`}
                    data-testid="select-gameover-strict"
                    onClick={() => store.updateSettings({ gameOverRuleMode: 'STRICT_ALL' })}
                  >
                    🔥 硬核零容忍模式 (碰撞/闯禁区/飞出界均 Game Over)
                  </button>
                </div>
              </div>

              {/* 区块 3：高度计量制式、局内难度与倍速调节 */}
              <div className="settings-card">
                <h3>三、高度层计量制式 &amp; 局内难度 / 倍速调节</h3>
                <div className="setting-two-col">
                  <div className="setting-row-block">
                    <span className="setting-label">1. 高度计量制式：</span>
                    <div className="btn-grid-row">
                      <button
                        type="button"
                        className={`btn-cmd ${s.altitudeUnit === 'METRIC' ? 'active' : ''}`}
                        data-testid="select-alt-unit-metric"
                        onClick={() => store.updateSettings({ altitudeUnit: 'METRIC' })}
                      >
                        🇨🇳 公制 (米 / 300m一层)
                      </button>
                      <button
                        type="button"
                        className={`btn-cmd ${s.altitudeUnit === 'IMPERIAL' ? 'active' : ''}`}
                        data-testid="select-alt-unit-imperial"
                        onClick={() => store.updateSettings({ altitudeUnit: 'IMPERIAL' })}
                      >
                        🌐 英制 (英尺 / 1000ft一层)
                      </button>
                    </div>
                  </div>

                  <div className="setting-row-block">
                    <span className="setting-label">2. 尾流标准：</span>
                    <div className="btn-grid-row">
                      {(
                        [
                          { id: 'ICAO', label: 'ICAO (4级: J/H/M/L)' },
                          { id: 'RECAT_EU', label: 'RECAT-EU (6级: A-F)' },
                        ] as Array<{ id: WakeStandard; label: string }>
                      ).map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          className={`btn-cmd ${s.wakeStandard === w.id ? 'active' : ''}`}
                          data-testid={`select-wake-${w.id.toLowerCase()}`}
                          onClick={() => store.updateSettings({ wakeStandard: w.id })}
                        >
                          {w.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="setting-two-col">
                  <div className="setting-row-block">
                    <span className="setting-label">3. 辅助与特情开关：</span>
                    <div className="btn-grid-row">
                      <button
                        type="button"
                        className={`btn-cmd ${s.showAmanTimeline ? 'active' : ''}`}
                        data-testid="toggle-aman"
                        onClick={() =>
                          store.updateSettings({ showAmanTimeline: !s.showAmanTimeline })
                        }
                      >
                        {s.showAmanTimeline ? '⏱ 进港排序：显示' : '⏱ 进港排序：隐藏'}
                      </button>
                      <button
                        type="button"
                        className={`btn-cmd ${s.enableEmergencies ? 'active' : ''}`}
                        data-testid="toggle-emergencies"
                        onClick={() =>
                          store.updateSettings({ enableEmergencies: !s.enableEmergencies })
                        }
                      >
                        {s.enableEmergencies ? '🚨 特情生成：开' : '🚨 特情生成：关'}
                      </button>
                      <button
                        type="button"
                        className={`btn-cmd ${s.enableTcasRa ? 'active' : ''}`}
                        data-testid="toggle-tcas-ra"
                        onClick={() => store.updateSettings({ enableTcasRa: !s.enableTcasRa })}
                      >
                        {s.enableTcasRa ? '🛡 TCAS防撞：开' : '🛡 TCAS防撞：关'}
                      </button>
                    </div>
                  </div>

                  <div className="setting-row-block">
                    <span className="setting-label">4. 特情即时演练：</span>
                    <div className="btn-grid-row">
                      <button
                        type="button"
                        className="btn-cmd active-warn"
                        data-testid="btn-spawn-7700"
                        onClick={() => store.triggerEmergencyScenario('SQUAWK_7700_FUEL')}
                      >
                        🚨 生成 7700 特情机
                      </button>
                      <button
                        type="button"
                        className="btn-cmd active-warn"
                        data-testid="btn-spawn-7600"
                        onClick={() => store.triggerEmergencyScenario('SQUAWK_7600_NORDO')}
                      >
                        📻 生成 7600 失联机
                      </button>
                    </div>
                  </div>
                </div>

                <div className="ils-status-hint" data-testid="in-game-map-lock-notice">
                  <span className="hint-warn">
                    🔒 当前执勤地图已锁定为【{store.airport.nameCn} ({store.airport.icao})】。如需切换机场地图，请点击下方【返回岗前大厅重新选图】。
                  </span>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                data-testid="btn-settings-to-lobby"
                onClick={() => store.openPreGameLobby()}
              >
                🏠 返回岗前大厅重新选图
              </button>
              <button
                type="button"
                className="btn-primary"
                data-testid="btn-close-settings"
                onClick={() => store.setShowSettingsModal(false)}
              >
                ✓ 保存设置并返回执勤
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 2. 海湾机场终端管制执照考试通过弹窗 ==================== */}
      {store.tutorial.licensePassed && (
        <div className="modal-backdrop" data-testid="license-passed-modal">
          <div className="modal-card">
            <div className="modal-banner banner-victory">
              <div className="modal-kicker">
                ATC2.0 SIMULATION TRAINING CERTIFICATE · 游戏训练证书
              </div>
              <h2 className="modal-heading" data-testid="license-passed-title">
                🎖️ 恭喜！终端区雷达管制模拟考核通过！
              </h2>
            </div>

            <p className="modal-desc">
              您已在【海湾国际机场 (ZSHB)】圆满完成新手教学全部课程与实操带飞考核，熟练掌握了雷达标牌判读、进程单管理、鼠标拖拽航向引导、Shift 语音指挥以及盲降/起飞/移交全套管制流程！
            </p>

            <div className="score-summary-box">
              <div className="grade-badge">
                <span>执照等级</span>
                <strong style={{ fontSize: '28px' }}>TRACON</strong>
                <small>终端雷达管制签注</small>
              </div>
              <div className="score-details">
                <div className="score-line">
                  <span>执照编号 License No.</span>
                  <strong className="mono accent-green">{store.tutorial.licenseCertNo}</strong>
                </div>
                <div className="score-line">
                  <span>考核基地 Airport Sector</span>
                  <strong className="mono">海湾国际机场 (ZSHB · 09L/09R)</strong>
                </div>
                <div className="score-line">
                  <span>实操考核得分 Exam Score</span>
                  <strong className="mono accent-cyan">{store.score} 分 (合格通过)</strong>
                </div>
                <div className="score-line">
                  <span>高度计量制式 Standard</span>
                  <strong className="mono">中国民航公制标准 (300米/层)</strong>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                data-testid="btn-license-to-lobby"
                onClick={() => {
                  store.exitTutorialMode();
                  store.openPreGameLobby();
                }}
              >
                🏠 返回岗前大厅挑战四大枢纽机场
              </button>
              <button
                type="button"
                className="btn-primary"
                data-testid="btn-license-continue"
                onClick={() => store.exitTutorialMode()}
              >
                ▶ 继续在海湾机场执勤
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 3. 管制员生涯档案与 12 项成就大厅 ==================== */}
      {store.showCareerModal && (
        <div className="modal-backdrop" data-testid="career-modal">
          <div className="modal-card modal-xl">
            <div className="modal-banner banner-victory">
              <div className="modal-kicker">
                CAREER &amp; ACHIEVEMENTS · 管制员生涯履历与奖章馆
              </div>
              <h2 className="modal-heading">
                🏆 管制员生涯履历与成就奖章馆 ({store.career.unlockedAchievementIds.length} / 12 已解锁)
              </h2>
            </div>

            <div className="settings-scroll-body">
              <div className="settings-card">
                <h3>一、全球四大枢纽机场执勤记录与最高评级</h3>
                <div className="airport-cards-grid">
                  {airportsList.map((ap) => (
                    <div key={ap.id} className="airport-select-card">
                      <div className="ap-code">
                        {ap.icao} · 最高评级：{store.career.bestGradeByAirport[ap.id] || '-'}
                      </div>
                      <div className="ap-name">{ap.nameCn}</div>
                      <div className="ap-sub">
                        最高得分：{store.career.highScoreByAirport[ap.id] || 0} 分
                      </div>
                    </div>
                  ))}
                </div>
                <div className="ils-status-hint" style={{ marginTop: '8px' }}>
                  <span className="hint-ok">
                    📊 生涯累计安全着陆：{store.career.totalLanded} 架次 ｜ 累计离场移交：
                    {store.career.totalDeparted} 架次 ｜ 圆满完成班次：
                    {store.career.totalShiftsCompleted} 场
                  </span>
                </div>
              </div>

              <div className="settings-card">
                <h3>二、全平台 12 项空管专业成就</h3>
                <div className="airport-cards-grid">
                  {CAREER_ACHIEVEMENTS_CATALOG.map((ach) => {
                    const unlocked = store.career.unlockedAchievementIds.includes(ach.id);
                    return (
                      <div
                        key={ach.id}
                        className={`airport-select-card ${unlocked ? 'active' : ''}`}
                        data-testid={`achievement-card-${ach.id}`}
                        style={{ opacity: unlocked ? 1 : 0.58 }}
                      >
                        <div className="ap-code">
                          {ach.icon} {unlocked ? '✓ 已解锁' : '🔒 未解锁'}
                        </div>
                        <div className="ap-name">{ach.titleCn}</div>
                        <div className="ap-sub">{ach.descCn}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-primary"
                data-testid="btn-close-career"
                onClick={() => store.setShowCareerModal(false)}
              >
                返回雷达工作站
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 4. 胜利 / Game Over 自动重开结算弹窗 ==================== */}
      {(store.status === 'VICTORY' || store.status === 'GAMEOVER') && reviewSettlement && (
        <div className="settlement-review-bar" style={{ bottom: store.commLogHeightPx + 14 }} data-testid="settlement-review-bar">
          <span>复盘中：场面已暂停，可查看雷达和通话记录。</span>
          <button className="btn-secondary" data-testid="btn-return-settlement" onClick={() => setReviewSettlement(false)}>返回结算</button>
        </div>
      )}
      {(store.status === 'VICTORY' || store.status === 'GAMEOVER') && !reviewSettlement && (
        <div className="modal-backdrop" data-testid="settlement-modal">
          <div className="modal-card">
            <div
              className={`modal-banner ${
                store.status === 'VICTORY' ? 'banner-victory' : 'banner-gameover'
              }`}
            >
              <div className="modal-kicker">
                {store.status === 'VICTORY'
                  ? 'MISSION ACCOMPLISHED · 班次任务圆满达成'
                  : 'GAME SAFETY THRESHOLD · 严重管制差错判定 & 本局已暂停，可复盘后重试'}
              </div>
              <h2 className="modal-heading" data-testid="settlement-title">
                {store.status === 'VICTORY'
                  ? `管制员考核通过 (${store.airport.nameCn} ${store.airport.icao})！`
                  : '🚨 发生严重管制差错 — 游戏结束 & 复盘后重试'}
              </h2>
            </div>

            <p className="modal-desc">{store.endReasonCn}</p>

            {(() => {
              const { grade, title } = getGrade(store.score, store.conflictCount);
              return (
                <div className="score-summary-box">
                  <div className="grade-badge">
                    <span>{store.status === 'VICTORY' ? '评级' : '差错定性'}</span>
                    <strong style={{ color: store.status === 'GAMEOVER' ? '#ef4444' : undefined }}>
                      {store.status === 'VICTORY' ? grade : '严重'}
                    </strong>
                    <small>
                      {store.status === 'VICTORY' ? title : '危险接近 (<2.8km/150m)'}
                    </small>
                  </div>
                  <div className="score-details">
                    <div className="score-line">
                      <span>刚才取得的最终分数 Final Score Achieved</span>
                      <strong className="mono accent-cyan" data-testid="final-score">
                        {store.score} 分
                      </strong>
                    </div>
                    <div className="score-line">
                      <span>本局安全着陆航班 Arrivals Landed</span>
                      <strong className="mono accent-green">
                        {store.landedCount} / {store.landedTarget} 架
                      </strong>
                    </div>
                    <div className="score-line">
                      <span>本局成功离场移交 Departures Handed Off</span>
                      <strong className="mono accent-amber">
                        {store.departedCount} / {store.departedTarget} 架
                      </strong>
                    </div>
                    <div className="score-line">
                      <span>班次执勤时长 Shift Duration</span>
                      <strong className="mono">{formatUtcClock(store.simTimeSec)}</strong>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" data-testid="btn-review-settlement"
                onClick={() => setReviewSettlement(true)}>查看本局复盘</button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => store.openPreGameLobby()}
              >
                🏠 返回选图大厅
              </button>
              <button
                type="button"
                className="btn-primary"
                data-testid="btn-modal-restart"
                onClick={() => store.restartGame(store.difficulty, true)}
              >
                {store.status === 'GAMEOVER'
                  ? '▶ 确认分数并立即开始新一局'
                  : '↺ 重新开始新班次'}
              </button>
              {store.status === 'VICTORY' && (
                <button
                  type="button"
                  className="btn-secondary"
                  data-testid="btn-modal-freeplay"
                  onClick={() => store.enableFreePlay()}
                >
                  ▶ 继续自由模式
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 5. 空管操作指南弹窗 ==================== */}
      {store.showHelpModal && (
        <div className="modal-backdrop" data-testid="help-modal">
          <div className="modal-card modal-wide">
            <div className="modal-banner banner-info">
              <div className="modal-kicker">
                ATC2.0 SOP · 语音指挥与民航管制规范
              </div>
              <h2 className="modal-heading">
                空中交通管制操作手册与 Shift 语音指挥指南
              </h2>
            </div>

            <div className="help-grid">
              <div className="help-section">
                <h3>1. 🎙️ 按住 Shift 话筒模糊语音指挥 (ATC2.0 核心)</h3>
                <ul>
                  <li>
                    <strong>一键按住说话</strong>：按住键盘 <code>Shift</code> 键（或按住右侧话筒按钮）对着麦克风说出指令，松开后自动识别执行，且语音里<strong>只播放飞行员的复诵声音</strong>。
                  </li>
                  <li>
                    <strong>支持模糊口语识别</strong>：无需背诵标准术语，直接说 <code>“下600”</code>、<code>“降到900米”</code>、<code>“可以盲降”</code>、<code>“引导五边”</code>、<code>“左转090”</code>、<code>“减速180”</code>、<code>“起飞”</code>、<code>“移交”</code> 或 <code>“东航5213下600盲降”</code> 即可执行！
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h3>2. 🎧 管制员与飞行员独立语音开关与精选音色</h3>
                <ul>
                  <li>
                    <strong>精准控制听谁的声音</strong>：在【设置】的管制员和飞行员区域各有一个独立的 <code>🔊 开启语音 / 🔇 仅文字</code> 开关；若只开管制员，则飞行员通话仅显示在下方记录中不发声；若只开飞行员，则只听机长复诵。
                  </li>
                  <li>
                    <strong>精选高音质声源</strong>：默认管制员优先女声、飞行员优先男声；实际声音取决于浏览器和系统，支持手动选择与试听。
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h3>3. 全向智能一键切五边与标准 STAR/SID</h3>
                <ul>
                  <li>
                    <strong>一键引导五边 (VTF)</strong>：无论进港飞机在何处，点击 <code>🎯 一键引导五边</code> 或语音说 <code>“引导五边”</code> 即可自动引向 10.5NM 五边门并平滑对正航向道、建立 ILS 盲降。
                  </li>
                  <li>
                    <strong>标准进离场程序 (STAR/SID)</strong>：点击 <code>STAR</code> 后飞完 FAF 定位点自动转入 ILS 盲降；地面飞机也可提前预置 <code>SID</code>。
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h3>4. 两种 Game Over 模式（防劝退 vs 硬核零容忍）</h3>
                <ul>
                  <li>
                    <strong>民航宽容模式（默认）</strong>：仅当两机发生危险接近/相撞（<strong>水平 &lt; 2.8km/1.5NM 且垂直 &lt; 150m</strong>）时判定 Game Over；闯入限制区或飞出边界仅告警扣分。
                  </li>
                  <li>
                    <strong>硬核零容忍模式（可在设置切换）</strong>：碰撞、闯入限制区或飞出边界任一发生立即 Game Over。
                  </li>
                </ul>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-primary"
                data-testid="btn-close-help"
                onClick={() => store.setShowHelpModal(false)}
              >
                返回雷达工作站
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  ), store.uiLanguage) as React.ReactElement;
};
