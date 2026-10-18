import React from 'react';
import { useGameStore } from '../game/store';
import { MISSIONS, isMissionUnlocked } from '../game/missions';
import { localizeUi } from '../i18n/react';

export const MissionPicker: React.FC = () => {
  const store = useGameStore();
  return localizeUi((<div className="settings-card mission-picker" data-testid="mission-picker">
    <h3>🎯 过关挑战：从一架飞机开始</h3>
    <p>先完成首降，再解锁进出港、双跑道与繁忙枢纽。通关一星，安全两星，安全且高效三星。</p>
    <div className="mission-grid">{MISSIONS.map((mission, index) => {
      const unlocked = isMissionUnlocked(mission.id, store.missionProgress);
      const record = store.missionProgress[mission.id];
      return <button type="button" className={`mission-card ${index === 0 && !record ? 'recommended' : ''}`}
        key={mission.id} data-testid={`mission-start-${mission.id}`} disabled={!unlocked}
        onClick={() => store.startMission(mission.id)}>
        <strong>{unlocked ? '🎯' : '🔒'} {store.uiLanguage === 'EN' ? mission.titleEn : mission.titleCn}</strong>
        <span>{store.uiLanguage === 'EN' ? mission.descriptionEn : mission.descriptionCn}</span>
        <small>{mission.airportId} · 着陆 {mission.arrivals} / 移交 {mission.departures} · 最多 {mission.trafficCap} 架</small>
        <span className="accent-amber">{record ? '★'.repeat(record.stars) + '☆'.repeat(3 - record.stars) : unlocked ? '开始挑战' : '先通过上一关'}</span>
      </button>;
    })}</div>
  </div>), store.uiLanguage) as React.ReactElement;
};

export const MissionStatus: React.FC = () => {
  const store = useGameStore(), mission = MISSIONS.find((item) => item.id === store.missionRun?.id);
  if (!mission || store.showPreGameLobby) return null;
  return localizeUi((<div className="mission-status" data-testid="mission-status">
    <div><strong>{store.uiLanguage === 'EN' ? mission.titleEn : mission.titleCn}</strong>
      <span>着陆 {store.landedCount}/{mission.arrivals} · 移交 {store.departedCount}/{mission.departures}</span></div>
    <small>先选航班，再按住通话键 说话；也可点击右侧建议口令。</small>
    <small>三星目标：无冲突、无越界，{Math.floor(mission.parTimeSec / 60)} 分钟内完成；可用 2×/4× 倍速。</small>
    <button type="button" className="overlay-btn" onClick={() => store.restartGame()} data-testid="mission-retry">↻ 重试本关</button>
  </div>), store.uiLanguage) as React.ReactElement;
};

export const MissionDebrief: React.FC = () => {
  const store = useGameStore(), index = MISSIONS.findIndex((item) => item.id === store.missionRun?.id);
  if (index < 0) return null;
  const mission = MISSIONS[index], stars = store.missionRun?.stars || 0;
  return localizeUi((<div className="settings-card mission-debrief" data-testid="mission-debrief">
    <h3>{store.uiLanguage === 'EN' ? mission.titleEn : mission.titleCn}</h3>
    {store.status === 'VICTORY' ? <>
      <strong className="accent-amber">{'★'.repeat(stars)}{'☆'.repeat(3 - stars)} · 关卡完成，进度已保存</strong>
      <p>一星：完成目标。两星：无冲突、无越界。三星：同时在目标时间内完成。</p>
      {MISSIONS[index + 1] && <button className="btn-primary" data-testid="mission-next"
        onClick={() => store.startMission(MISSIONS[index + 1].id)}>下一关 ▶</button>}
    </> : <p>场面已保留。查看告警原因，调整排序后重试；已获得的关卡星级不会丢失。</p>}
  </div>), store.uiLanguage) as React.ReactElement;
};
