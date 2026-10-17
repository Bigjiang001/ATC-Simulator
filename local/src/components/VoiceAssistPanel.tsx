import React from 'react';
import { useGameStore } from '../game/store';
import { suggestedVoiceCommand } from '../atc/voiceGuidance';
import { localizeUi } from '../i18n/react';
export const VoiceAssistPanel: React.FC = () => {
  const store = useGameStore();
  if (store.settings.voiceAssistEnabled === false) return null;
  const ac = store.aircraft.find((item) => item.id === store.selectedAircraftId);
  const suggestion = ac ? suggestedVoiceCommand(ac, store.airport, store.settings.altitudeUnit, store.settings.requireLandingClearance) : null;
  const candidates = store.aircraft.filter((item) => store.voicePtt.candidateAircraftIds?.includes(item.id));
  return localizeUi((<div className="voice-assist-panel" data-testid="voice-assist-panel">
    <strong>🎙 中文指挥助手 {ac?.callsign}</strong>
    <small>先选航班，可只说“下六百”“可以盲降”“可以起飞”。数字不确定时请重说，不会随意指挥另一架飞机。</small>
    {store.voicePtt.correctionNote && <div className="accent-cyan" data-testid="voice-correction-note">{store.voicePtt.correctionNote}</div>}
    {candidates.length > 0 && <div className="btn-grid-row" data-testid="voice-flight-candidates">{candidates.map((candidate) =>
      <button type="button" className="btn-cmd" key={candidate.id}
        data-testid={`voice-select-${candidate.callsign}`} onClick={() => {
          store.selectAircraft(candidate.id);
          store.setVoicePttState({ candidateAircraftIds: [], correctionNote: '', lastSummaryCn: `已选中 ${candidate.callsign}，请重新说指令` });
        }}>{candidate.callsign} · {candidate.airlineCn}</button>)}</div>}
    {suggestion && <>
      <span>{suggestion.hint}</span>
      {suggestion.phrase && <button type="button" className="btn-cmd active" data-testid="voice-suggested-command"
        onClick={() => store.sendVoiceCommand(suggestion.phrase)}>试说 / 点击执行：{suggestion.phrase}</button>}
    </>}
    {store.voicePtt.statusType === 'WARN' && <div className="hint-warn" data-testid="voice-assist-warning">{store.voicePtt.lastSummaryCn}</div>}
  </div>), store.uiLanguage) as React.ReactElement;
};
