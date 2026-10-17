import { localizeUi } from '../i18n/react';
import React from 'react';
import { useGameStore } from '../game/store';
import { formatUtcClock } from '../simulation/engine';
import { calculateRunwayWindComponents, getRunwayConfig } from '../aircraft/physics';
import { getActiveRunwaysForDirection } from '../airport/harborAirport';
import { GameDifficulty } from '../aircraft/types';

export const TopStatusBar: React.FC = () => {
  const store = useGameStore();
  const activeCount = store.aircraft.filter(
    (a) =>
      a.phase !== 'LANDED' &&
      a.phase !== 'HANDED_OFF' &&
      a.phase !== 'EXITED_AIRSPACE'
  ).length;

  const rwyOccupied = store.aircraft.some(
    (a) =>
      a.phase === 'TAKEOFF_ROLL' ||
      a.phase === 'LANDING_ROLL' ||
      a.phase === 'LINE_UP_WAIT'
  );

  const activeFlow = getActiveRunwaysForDirection(
    store.activeRunwayDir,
    store.settings.runwayCountMode,
    store.airport
  );
  const arrRwyCfg = getRunwayConfig(store.airport, activeFlow.arrivalRunway);
  const windComp = calculateRunwayWindComponents(
    arrRwyCfg.heading,
    store.weather.windDirectionDeg,
    store.weather.windSpeedKt
  );

  const windDirStr = String(Math.round(store.weather.windDirectionDeg)).padStart(3, '0');
  const windSpdStr = String(Math.round(store.weather.windSpeedKt)).padStart(2, '0');
  const isCalmWind = !store.settings.enableWind || store.weather.windSpeedKt <= 0;

  const oppositeFlowRwy =
    store.activeRunwayDir === '09'
      ? store.airport.reverseFlowRunways.arrival
      : store.airport.primaryFlowRunways.arrival;

  const isTutorialHighlight = store.tutorial.active && store.tutorial.step === 4;

  return localizeUi((
    <header
      className="atc-topbar"
      data-testid="top-status-bar"
      style={
        isTutorialHighlight
          ? { boxShadow: 'inset 0 0 0 2px #fbbf24', background: 'rgba(251, 191, 36, 0.12)' }
          : undefined
      }
    >
      <div className="topbar-brand">
        <div className="radar-pulse-dot" />
        <div>
          <div className="brand-title">
            ATC2.0 · {store.airport.icao}
          </div>
          <div className="brand-sub">
            {store.airport.nameCn.replace('国际机场', '')} ·{' '}
            {store.settings.altitudeUnit === 'METRIC' ? '中国空管米制(m)' : 'ICAO英制(ft)'}
          </div>
        </div>
      </div>

      <div className="topbar-metrics">
        <div className="metric-box">
          <span className="metric-label">UTC</span>
          <span className="metric-val mono" data-testid="sim-clock">
            {formatUtcClock(store.simTimeSec)}
          </span>
        </div>

        <div
          className={`metric-box ${windComp.exceedsTailwindLimit ? 'metric-alert-active' : ''}`}
          title="可在【设置】中自由开启或关闭地面风与 CB 雷雨云团"
        >
          <span className="metric-label">METAR WIND</span>
          <span
            className={`metric-val mono ${
              windComp.exceedsTailwindLimit ? 'accent-red' : 'accent-cyan'
            }`}
            data-testid="metar-wind"
          >
            {isCalmWind
              ? 'CALM (静风00KT)'
              : `${windDirStr}°/${windSpdStr}KT ${
                  windComp.tailwindKt > 0
                    ? `(顺${windComp.tailwindKt})`
                    : `(顶${windComp.headwindKt})`
                }`}
          </span>
        </div>

        <div className="metric-box">
          <span className="metric-label">ACTIVE RWY</span>
          <span className="metric-val mono accent-green" data-testid="active-runway-config">
            {activeFlow.allActive.join('/')} ({Math.round(arrRwyCfg.heading)}°)
            {rwyOccupied ? '·占' : ''}
          </span>
        </div>

        <div className="metric-box">
          <span className="metric-label">ARR</span>
          <span className="metric-val mono accent-green" data-testid="landed-counter">
            {store.landedCount}/{store.landedTarget}
          </span>
        </div>

        <div className="metric-box">
          <span className="metric-label">DEP</span>
          <span className="metric-val mono accent-amber" data-testid="departed-counter">
            {store.departedCount}/{store.departedTarget}
          </span>
        </div>

        <div
          className={`metric-box ${store.conflicts.length > 0 ? 'metric-alert-active' : ''}`}
        >
          <span className="metric-label">ALERTS</span>
          <span
            className={`metric-val mono ${
              store.conflicts.length > 0 ? 'accent-red' : 'accent-green'
            }`}
            data-testid="conflict-counter"
          >
            {store.conflicts.length > 0
              ? `⚠ ${store.conflicts.length}告警`
              : `${activeCount}架正常`}
          </span>
        </div>

        <div
          className="metric-box"
          title="连续安全着陆或移交可提升连击倍率（最高 2.5×），发生冲突或复飞重置为 1.0×"
        >
          <span className="metric-label">SCORE · STREAK</span>
          <span className="metric-val mono accent-cyan" data-testid="score-value">
            {store.score}{' '}
            <small className="accent-green" data-testid="streak-multiplier">
              ({store.streakMultiplier.toFixed(1)}×🔥)
            </small>
          </span>
        </div>
      </div>

      <div className="topbar-controls">
        {/* 当前机场锁定标识 + 跑道换端（执勤中不可直接更换机场地图，需回大厅选图） */}
        <div className="control-group" role="group" aria-label="当前扇区与换端">
          <span
            className="btn-chip active mono"
            data-testid="locked-airport-badge"
            title="执勤进行中地图已锁定；如需更换机场地图，请点击右侧【选图大厅】"
            style={{ cursor: 'default' }}
          >
            🔒 {store.airport.icao}·{store.airport.nameCn.replace('国际机场', '')}
          </span>
          <button
            type="button"
            className={`btn-chip ${windComp.exceedsTailwindLimit ? 'active-warn' : ''}`}
            data-testid="btn-switch-runway-dir"
            onClick={() => store.switchRunwayConfig()}
            title="一键切换当前机场的主/反向跑道运行流向"
          >
            ⇄ 换端{oppositeFlowRwy}
          </button>
        </div>

        {/* 局内可随时调整难度 */}
        <div className="control-group" role="group" aria-label="局内难度调节">
          {(
            [
              { id: 'EASY', label: '简单' },
              { id: 'NORMAL', label: '普通' },
              { id: 'HARD', label: '困难' },
            ] as Array<{ id: GameDifficulty; label: string }>
          ).map((d) => (
            <button
              key={d.id}
              type="button"
              className={`btn-chip ${store.difficulty === d.id ? 'active' : ''}`}
              data-testid={`topbar-diff-${d.id}`}
              onClick={() => store.setDifficulty(d.id)}
              title="执勤进行中可随时动态调整航班流量难度"
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* 局内可随时调整模拟速度 */}
        <div className="control-group" role="group" aria-label="模拟速度">
          <button
            type="button"
            className={`btn-chip ${store.isPaused ? 'active-warn' : ''}`}
            data-testid="btn-pause"
            onClick={() => store.togglePause()}
          >
            {store.isPaused ? '▶继续' : '⏸暂停'}
          </button>
          {([1, 2, 4] as const).map((spd) => (
            <button
              key={spd}
              type="button"
              className={`btn-chip ${!store.isPaused && store.gameSpeed === spd ? 'active' : ''}`}
              data-testid={`btn-speed-${spd}x`}
              onClick={() => store.setGameSpeed(spd)}
            >
              {spd}×
            </button>
          ))}
        </div>

        <div className="control-group">
          {/* 仅当玩家在岗前大厅选择了新手教学模式正在进行教学时，才显示教学状态按钮；平时正常游玩不显示 */}
          {store.tutorial.active && (
            <button
              type="button"
              className="btn-chip active-warn"
              data-testid="btn-tutorial-active-badge"
              onClick={() => store.exitTutorialMode()}
              title="当前处于海湾机场新手教学模式，点击可退出教学转为普通执勤"
            >
              🎓 教学中({store.tutorial.step}/8·退出)
            </button>
          )}
          <button
            type="button"
            className="btn-chip"
            data-testid="btn-open-lobby"
            onClick={() => store.openPreGameLobby()}
            title="结束当前执勤并返回岗前大厅重新选择机场地图、新手教学、难度与天气配置"
          >
            🏠 选图大厅
          </button>
          <button
            type="button"
            className="btn-chip active"
            data-testid="btn-settings"
            onClick={() => store.setShowSettingsModal(true)}
            title="打开游戏设置（开关CB雷雨/地面风/限制区、切换公英制、对讲机滋滋声、Game Over规则等）"
          >
            ⚙ 设置
          </button>
          <button
            type="button"
            className="btn-chip"
            data-testid="btn-career"
            onClick={() => store.setShowCareerModal(true)}
            title="查看生涯统计数据与 12 项空管成就勋章"
          >
            🏆 成就({store.career.unlockedAchievementIds.length})
          </button>
          <button
            type="button"
            className="btn-chip"
            data-testid="btn-help"
            onClick={() => store.setShowHelpModal(true)}
            title="查看空管指南"
          >
            ? 指南
          </button>
        </div>
      </div>
    </header>
  ), store.uiLanguage) as React.ReactElement;
};
