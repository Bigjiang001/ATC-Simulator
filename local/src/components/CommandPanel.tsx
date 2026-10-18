import { VoiceAssistPanel } from './VoiceAssistPanel';
import { localizeUi } from '../i18n/react';
import React, { useState } from 'react';
import { useGameStore } from '../game/store';
import {
  checkIlsConditions,
  formatAltitudeValue,
  formatHeading,
  getIcaoDirectionalLevelsFt,
  getProcedureRecommendedAltitude,
  getRunwayConfig,
} from '../aircraft/physics';
import { checkDepartureWakeTimer } from '../atc/commands';
import {
  getActiveRunwaysForDirection,
  ICAO_STANDARD_ALTITUDE_LEVELS,
} from '../airport/harborAirport';

const SPEED_PRESETS = [160, 180, 200, 220, 240, 250];

export const CommandPanel: React.FC = () => {
  const store = useGameStore();
  const selectedAc = store.aircraft.find((a) => a.id === store.selectedAircraftId);
  const altUnit = store.settings.altitudeUnit || 'METRIC';
  const isMetric = altUnit === 'METRIC';
  const isTutorialHighlight =
    store.tutorial.active &&
    (store.tutorial.step === 3 ||
      store.tutorial.step === 5 ||
      store.tutorial.step === 6 ||
      store.tutorial.step === 7);

  const [customAlt, setCustomAlt] = useState<string>('900');
  const [customSpd, setCustomSpd] = useState<string>('180');
  const [cliText, setCliText] = useState<string>('');
  const [cliFeedback, setCliFeedback] = useState<string>('');

  if (!selectedAc) {
    return localizeUi((
      <div className="command-panel" data-testid="command-panel">
        <div className="panel-header">
          <span className="panel-title">管制指令台 ATC CONTROL CONSOLE</span>
        </div>
        <VoiceAssistPanel />
        <div className="cmd-empty">请在雷达屏幕或上方进程单中点击选择一架航班以下达指令</div>
      </div>
    ), store.uiLanguage) as React.ReactElement;
  }

  const isGround =
    selectedAc.phase === 'HOLDING_GROUND' || selectedAc.phase === 'LINE_UP_WAIT';
  const isLineUpWait = selectedAc.phase === 'LINE_UP_WAIT';
  const isHoldCrossing = selectedAc.phase === 'HOLD_CROSSING';
  const ilsCheck = checkIlsConditions(
    selectedAc,
    store.airport,
    selectedAc.assignedRunway,
    altUnit
  );
  const wakeCheck = checkDepartureWakeTimer(
    selectedAc,
    selectedAc.assignedRunway,
    store.simTimeSec,
    store.runwayWakeMap,
    store.airport
  );
  const { allActive: activeRunwayPair } = getActiveRunwaysForDirection(
    store.activeRunwayDir,
    store.settings.runwayCountMode,
    store.airport
  );
  const assignedRwyCfg = getRunwayConfig(store.airport, selectedAc.assignedRunway);

  const availableStars = store.airport.procedures.filter(
    (p) => p.type === 'STAR' && p.runwayConfig === store.activeRunwayDir
  );
  const availableSids = store.airport.procedures.filter((p) => p.type === 'SID');

  const primaryHoldWp =
    store.airport.waypoints.find((w) => w.role === 'HOLD_STACK')?.id ||
    store.airport.waypoints.find((w) => w.role === 'FAF')?.id ||
    store.airport.waypoints[0]?.id ||
    'HARBR';

  const dirRuleInfo = getIcaoDirectionalLevelsFt(selectedAc.heading, altUnit);
  const procRecAlt = getProcedureRecommendedAltitude(selectedAc, store.airport, altUnit);
  const curAltText = formatAltitudeValue(selectedAc.altitude, altUnit);
  const tgtAltText = formatAltitudeValue(selectedAc.targetAltitude, altUnit);

  const handleCustomAltSubmit = () => {
    const val = Number(customAlt);
    if (!Number.isNaN(val)) {
      if (isMetric) {
        const clampedMeters = Math.max(600, Math.min(3600, Math.round(val / 300) * 300));
        const targetFt = Math.round(clampedMeters / 300) * 1000;
        store.sendCommand({ type: 'ALT', altitude: targetFt });
      } else {
        const targetFt = Math.max(2000, Math.min(12000, Math.round(val / 1000) * 1000));
        store.sendCommand({ type: 'ALT', altitude: targetFt });
      }
    }
  };

  const handleCustomSpdSubmit = () => {
    const val = Number(customSpd);
    if (!Number.isNaN(val)) {
      store.sendCommand({ type: 'SPD', speed: val });
    }
  };

  const handleCliSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cliText.trim()) return;
    const ok = store.sendTextCommand(cliText);
    if (ok) {
      setCliFeedback(`✓ 已执行: ${cliText}`);
      setCliText('');
    } else {
      setCliFeedback(`未识别指令，可说/输入如: "下600盲降" / "左转090" / "起飞"`);
    }
  };

  const handlePttMouseDown = () => {
    const fn = (window as unknown as { __ATC_PTT_START__?: () => void }).__ATC_PTT_START__;
    if (fn) fn();
  };

  const handlePttMouseUp = () => {
    const fn = (window as unknown as { __ATC_PTT_STOP__?: () => void }).__ATC_PTT_STOP__;
    if (fn) fn();
  };

  const wakeBadge =
    store.settings.wakeStandard === 'RECAT_EU'
      ? `RECAT-${selectedAc.recatCode}`
      : `${selectedAc.wakeCategory}[${selectedAc.wakeCode}]`;

  return localizeUi((
    <div
      className="command-panel"
      data-testid="command-panel"
      style={
        isTutorialHighlight
          ? { boxShadow: 'inset 0 0 0 2px #fbbf24' }
          : undefined
      }
    >
      <div className="panel-header">
        <span className="panel-title">
          <strong>{selectedAc.callsign}</strong> ({selectedAc.model} · {wakeBadge} · SQK{' '}
          {selectedAc.squawkCode})
        </span>
        <span className="cmd-target-status mono">
          RWY {selectedAc.assignedRunway} | {formatHeading(selectedAc.heading)}° | {curAltText}
        </span>
      </div>

      <div className="cmd-sections">
        <VoiceAssistPanel />
        {/* 1. 跑道分配与关键许可 (分行网格排版，按钮精炼不溢出) */}
        <div className="cmd-block highlight-block">
          <div className="cmd-block-label">
            {store.airport.icao} 跑道分配与关键许可 ({activeRunwayPair.join(' / ')})
          </div>

          {/* 第一排：跑道分配 + 二次雷达识别 / 地面进跑道等待 */}
          <div
            className="btn-grid-row"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${activeRunwayPair.length + 1}, minmax(0, 1fr))`,
              gap: '4px',
            }}
          >
            {activeRunwayPair.map((rwyId) => {
              const rCfg = getRunwayConfig(store.airport, rwyId);
              return (
                <button
                  key={rwyId}
                  type="button"
                  className={`btn-cmd ${selectedAc.assignedRunway === rwyId ? 'active' : ''}`}
                  data-testid={`btn-assign-rwy-${rwyId}`}
                  onClick={() => store.sendCommand({ type: 'ASSIGN_RUNWAY', runwayId: rwyId })}
                  title={`分配跑道 ${rwyId} (航向 ${formatHeading(rCfg.heading)}°)`}
                >
                  跑道 {rwyId}
                </button>
              );
            })}
            {selectedAc.category === 'DEPARTURE' && isGround ? (
              <button
                type="button"
                className={`btn-cmd ${isLineUpWait ? 'active-warn' : ''}`}
                data-testid="btn-line-up-wait"
                disabled={isLineUpWait}
                onClick={() =>
                  store.sendCommand({
                    type: 'LINE_UP_WAIT',
                    runwayId: selectedAc.assignedRunway,
                  })
                }
                title="准许进入跑道入口对正跑道等待起飞指令 (LINE UP AND WAIT)"
              >
                {isLineUpWait ? `✓ 已对正 ${selectedAc.assignedRunway}` : '🛫 进跑道等待'}
              </button>
            ) : (
              <button
                type="button"
                className="btn-cmd"
                data-testid="btn-squawk-ident"
                onClick={() => store.sendCommand({ type: 'SQUAWK_IDENT' })}
                title="二次雷达应答机识别闪烁 (SQUAWK IDENT)"
              >
                📡 雷达识别
              </button>
            )}
          </div>

          {/* 第二排（仅进港飞机显示）：一键引导五边 + 紧急脱离 */}
          {selectedAc.category === 'ARRIVAL' && !isHoldCrossing && (
            <div
              className="btn-grid-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '1.35fr 1fr',
                gap: '4px',
              }}
            >
              <button
                type="button"
                className="btn-cmd active"
                data-testid="btn-vector-to-final"
                onClick={() =>
                  store.sendCommand({
                    type: 'VECTOR_TO_FINAL',
                    runwayId: selectedAc.assignedRunway,
                  })
                }
                title="全向智能引导切入五边并建立 ILS 盲降"
              >
                🎯 一键引导五边
              </button>
              <button
                type="button"
                className="btn-cmd active-warn"
                data-testid="btn-break-out"
                onClick={() => store.sendCommand({ type: 'BREAK_OUT' })}
                title={`五边冲突紧急转向爬升至 ${formatAltitudeValue(4000, altUnit)} 脱离`}
              >
                ⚡ 紧急脱离
              </button>
            </div>
          )}

          {/* 第三排：盲降进近 / 复飞 / 起飞 / 移交 主动作按钮 */}
          <div className="clearance-actions">
            {selectedAc.category === 'ARRIVAL' && !isHoldCrossing && (
              <>
                <button
                  type="button"
                  className={`btn-action btn-ils ${
                    selectedAc.clearedApproach
                      ? 'btn-ils-active'
                      : ilsCheck.canAcceptClearance
                      ? 'btn-ils-ready'
                      : ''
                  }`}
                  data-testid="btn-cleared-ils"
                  onClick={() =>
                    store.sendCommand({
                      type: 'CLEARED_ILS',
                      runwayId: selectedAc.assignedRunway,
                    })
                  }
                >
                  {selectedAc.phase === 'FINAL_APPROACH'
                    ? `✓ 已锁盲降 ${selectedAc.assignedRunway}`
                    : selectedAc.clearedApproach
                    ? `✓ 切入盲降 ${selectedAc.assignedRunway}`
                    : `CLEARED ILS ${selectedAc.assignedRunway}`}
                </button>
                {store.settings.requireLandingClearance && <button type="button"
                  className={`btn-action btn-ils ${selectedAc.clearedToLand ? 'btn-ils-active' : ''}`}
                  data-testid="btn-cleared-land" disabled={!selectedAc.clearedApproach || Boolean(selectedAc.clearedToLand)}
                  onClick={() => store.sendCommand({ type: 'CLEARED_LAND', runwayId: selectedAc.assignedRunway })}>
                  {selectedAc.clearedToLand ? '✓ 已获着陆许可' : '可以着陆'} {selectedAc.assignedRunway}
                </button>}
                <button
                  type="button"
                  className="btn-action btn-warn"
                  data-testid="btn-go-around"
                  onClick={() => store.sendCommand({ type: 'GO_AROUND' })}
                >
                  GO AROUND 复飞
                </button>
              </>
            )}

            {isHoldCrossing && (
              <button
                type="button"
                className="btn-action btn-takeoff-ready"
                style={{ gridColumn: '1 / -1' }}
                data-testid="btn-cross-runway"
                onClick={() => store.sendCommand({ type: 'CROSS_RUNWAY' })}
              >
                ✓ 准许穿越跑道 {selectedAc.crossingRunwayId || store.airport.primaryFlowRunways.departure}
              </button>
            )}

            {selectedAc.category === 'DEPARTURE' && (
              <>
                <button
                  type="button"
                  className={`btn-action btn-takeoff ${
                    isGround && !wakeCheck.blocked ? 'btn-takeoff-ready' : ''
                  }`}
                  data-testid="btn-cleared-takeoff"
                  disabled={!isGround}
                  onClick={() =>
                    store.sendCommand({
                      type: 'CLEARED_TAKEOFF',
                      runwayId: selectedAc.assignedRunway,
                    })
                  }
                >
                  {isGround
                    ? `CLEARED TAKEOFF ${selectedAc.assignedRunway}`
                    : '✓ 已离地升空'}
                </button>
                <button
                  type="button"
                  className={`btn-action ${
                    selectedAc.canHandoff ? 'btn-handoff-ready' : ''
                  }`}
                  data-testid="btn-handoff"
                  disabled={isGround}
                  onClick={() => store.sendCommand({ type: 'HANDOFF' })}
                >
                  {selectedAc.canHandoff
                    ? '★ HANDOFF 移交!'
                    : `HANDOFF (≥${formatAltitudeValue(5000, altUnit)})`}
                </button>
              </>
            )}
          </div>

          {selectedAc.inRestrictedZone && (
            <div className="ils-status-hint" data-testid="restricted-zone-warning">
              <span className="hint-warn">
                🚨 空域禁入告警：该机正处于禁航限制区内！请立即转向脱离或爬升至限高以上！
              </span>
            </div>
          )}

          {selectedAc.tcasRaActive && (
            <div className="ils-status-hint" data-testid="tcas-ra-banner">
              <span className="hint-warn">
                🚨 TCAS RA 自主避撞激活中 ({selectedAc.tcasRaDirection})：高度指令已暂时锁定！
              </span>
            </div>
          )}

          {selectedAc.category === 'ARRIVAL' && !selectedAc.tcasRaActive && (
            <div className="ils-status-hint" data-testid="ils-condition-status">
              {selectedAc.phase === 'FINAL_APPROACH' ? (
                <span className="hint-ok">
                  ✓ 已建立 {selectedAc.assignedRunway} ({formatHeading(assignedRwyCfg.heading)}°) 航向道与 3° 下滑道 (距入口{' '}
                  {ilsCheck.distToThresholdNM.toFixed(1)} NM)
                </span>
              ) : selectedAc.phase === 'INTERCEPTING' && selectedAc.clearedApproach ? (
                <span className="hint-ok">
                  ✓ 已预位 {selectedAc.assignedRunway} 盲降，正自动切入五边中心线并下降截获下滑道
                </span>
              ) : ilsCheck.canAcceptClearance ? (
                <span className="hint-ok">
                  ✓ 满足 {selectedAc.assignedRunway} 盲降切入条件（距入口{' '}
                  {ilsCheck.distToThresholdNM.toFixed(1)} NM）
                </span>
              ) : (
                <span className="hint-warn">{ilsCheck.reasonCn}</span>
              )}
            </div>
          )}

          {selectedAc.category === 'DEPARTURE' && isGround && wakeCheck.blocked && (
            <div className="ils-status-hint" data-testid="wake-timer-warning">
              <span className="hint-warn">
                ⚠ 尾流间隔限制：前机 {wakeCheck.leaderCallsign} ({wakeCheck.leaderWake}) 刚起飞，还需等待{' '}
                {wakeCheck.remainingSec}s
              </span>
            </div>
          )}
        </div>

        {/* 2. STAR / SID 标准程序与航路点导航 */}
        <div className="cmd-block">
          <div className="cmd-block-label">
            {store.airport.icao} 标准程序 (STAR / SID) 与 航路点 (DCT / HOLD)
          </div>
          <div className="btn-grid-row">
            {selectedAc.category === 'ARRIVAL'
              ? availableStars.map((star) => (
                  <button
                    key={star.id}
                    type="button"
                    className={`btn-cmd ${
                      selectedAc.activeProcedureId === star.id ? 'active' : ''
                    }`}
                    data-testid={`btn-star-${star.id}`}
                    onClick={() => store.sendCommand({ type: 'STAR', procedureId: star.id })}
                    title={star.description}
                  >
                    STAR {star.id}
                  </button>
                ))
              : availableSids.map((sid) => (
                  <button
                    key={sid.id}
                    type="button"
                    className={`btn-cmd ${
                      selectedAc.activeProcedureId === sid.id ? 'active' : ''
                    }`}
                    data-testid={`btn-sid-${sid.id}`}
                    onClick={() => store.sendCommand({ type: 'SID', procedureId: sid.id })}
                    title={sid.description}
                  >
                    SID {sid.id}
                  </button>
                ))}
            <button
              type="button"
              className={`btn-cmd ${
                selectedAc.phase === 'HOLDING_AIR' ? 'active-warn' : ''
              }`}
              data-testid="btn-hold-harbr"
              onClick={() =>
                store.sendCommand({
                  type: 'HOLD',
                  waypointId: primaryHoldWp,
                })
              }
            >
              HOLD {primaryHoldWp}
            </button>
          </div>
          <div
            className="btn-grid-row"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '4px' }}
          >
            {store.airport.waypoints.map((wp) => (
              <button
                key={wp.id}
                type="button"
                className={`btn-cmd ${
                  selectedAc.directWaypointId === wp.id ? 'active' : ''
                }`}
                data-testid={`btn-dct-${wp.id}`}
                onClick={() => store.sendCommand({ type: 'DCT', waypointId: wp.id })}
                title={wp.description}
              >
                {wp.id}
              </button>
            ))}
          </div>
        </div>

        {/* 3. 航向显示区 (仅显示当前与目标航向数字) */}
        <div className="cmd-block" data-testid="heading-readout-block">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '2px 2px',
            }}
          >
            <span className="cmd-block-label" style={{ marginBottom: 0 }}>
              航向 HEADING
            </span>
            <div
              className="mono"
              data-testid="heading-numeric-display"
              style={{ fontSize: '15px', fontWeight: 800, color: '#00e5a3' }}
            >
              当前 {formatHeading(selectedAc.heading)}° → 目标{' '}
              {formatHeading(selectedAc.targetHeading)}°
            </div>
          </div>
        </div>

        {/* 4. 标准高度层配备 & 速度控制 */}
        <div className="cmd-block">
          <div className="cmd-block-label">
            标准高度层 ({curAltText} → {tgtAltText}) &amp; 速度 ({Math.round(selectedAc.speed)}→
            {Math.round(selectedAc.targetSpeed)}kt)
          </div>
          <div
            className="ils-status-hint"
            data-testid="icao-altitude-advisor"
            style={{ marginBottom: '4px' }}
          >
            <span className="hint-ok">
              📐 {procRecAlt.reasonCn}
            </span>
          </div>
          <div
            className="btn-grid-row"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '4px' }}
          >
            {ICAO_STANDARD_ALTITUDE_LEVELS.map((lvl) => {
              const isTarget = Math.round(selectedAc.targetAltitude) === lvl.feet;
              const isRecommended = procRecAlt.altitudeFt === lvl.feet;
              const btnLabel = isMetric ? `${lvl.meters}m` : `${lvl.feet}ft`;
              return (
                <button
                  key={lvl.feet}
                  type="button"
                  className={`btn-cmd ${
                    isTarget ? 'active' : isRecommended ? 'active-warn' : ''
                  }`}
                  data-testid={`btn-alt-${lvl.feet}`}
                  title={lvl.procedureUsageCn}
                  onClick={() => store.sendCommand({ type: 'ALT', altitude: lvl.feet })}
                >
                  {isRecommended ? '★ ' : ''}
                  {btnLabel}
                </button>
              );
            })}
          </div>
          <div className="btn-grid-row">
            {SPEED_PRESETS.map((spd) => (
              <button
                key={spd}
                type="button"
                className={`btn-cmd ${
                  Math.round(selectedAc.targetSpeed) === spd ? 'active' : ''
                }`}
                data-testid={`btn-spd-${spd}`}
                onClick={() => store.sendCommand({ type: 'SPD', speed: spd })}
              >
                {spd}kt
              </button>
            ))}
          </div>
          <div className="custom-input-row">
            <input
              type="number"
              min={isMetric ? 600 : 2000}
              max={isMetric ? 3600 : 12000}
              step={isMetric ? 300 : 1000}
              value={customAlt}
              data-testid="input-custom-alt"
              onChange={(e) => setCustomAlt(e.target.value)}
              className="cmd-num-input"
            />
            <button
              type="button"
              className="btn-cmd"
              data-testid="btn-apply-alt"
              onClick={handleCustomAltSubmit}
            >
              {isMetric ? 'ALT(m)' : 'ALT(ft)'}
            </button>
            <input
              type="number"
              min={130}
              max={250}
              step={10}
              value={customSpd}
              data-testid="input-custom-spd"
              onChange={(e) => setCustomSpd(e.target.value)}
              className="cmd-num-input"
            />
            <button
              type="button"
              className="btn-cmd"
              data-testid="btn-apply-spd"
              onClick={handleCustomSpdSubmit}
            >
              SPD(kt)
            </button>
          </div>
        </div>

        {/* 语音操作区：只展示玩家需要的操作与反馈。 */}
        {store.settings.enableVoiceControl && (
          <div className="cmd-block highlight-block" data-testid="voice-ptt-panel">
            <div className="cmd-block-label">🎙️ 语音指挥</div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px',
              }}
            >
              <button
                type="button"
                className={`btn-cmd ${store.voicePtt.isListening ? 'active-warn' : 'active'}`}
                data-testid="btn-ptt-hold"
                onMouseDown={handlePttMouseDown}
                onMouseUp={handlePttMouseUp}
                onMouseLeave={handlePttMouseUp}
                title="按住通话键 或话筒说话，松开发送指令"
              >
                {store.voicePtt.isListening
                  ? '🎙️ 正在收音，松开发送…'
                  : '🎙️ 按住通话键或按住此处话筒语音指挥'}
              </button>
            </div>
            {/* 快捷模糊口语规范化演练按钮 */}
            <div className="btn-grid-row" style={{ marginTop: '4px', marginBottom: '2px' }}>
              <button
                type="button"
                className="btn-cmd"
                data-testid="btn-demo-voice-1"
                style={{ fontSize: '9.5px', padding: '2px 5px' }}
                onClick={() => store.sendVoiceCommand(`${selectedAc.callsign.slice(3)}下600盲降`)}
                title="测试玩家说模糊口语，系统自动规范化为专业标准陆空通话并显示在下方记录中"
              >
                🗣️ 试说:“{selectedAc.callsign.slice(3)}下600盲降”
              </button>
              <button
                type="button"
                className="btn-cmd"
                data-testid="btn-demo-voice-2"
                style={{ fontSize: '9.5px', padding: '2px 5px' }}
                onClick={() => store.sendVoiceCommand(`${selectedAc.callsign.slice(3)}左转090减速180`)}
              >
                🗣️ 试说:“左转090减速180”
              </button>
              <button
                type="button"
                className="btn-cmd"
                data-testid="btn-demo-voice-3"
                style={{ fontSize: '9.5px', padding: '2px 5px' }}
                onClick={() =>
                  store.sendVoiceCommand(
                    selectedAc.category === 'DEPARTURE'
                      ? `${selectedAc.callsign.slice(3)}可以起飞上18`
                      : `${selectedAc.callsign.slice(3)}引导五边`
                  )
                }
              >
                🗣️ 试说:“{selectedAc.category === 'DEPARTURE' ? '可以起飞上18' : '引导五边'}”
              </button>
            </div>
            <div
              className="ils-status-hint"
              data-testid="voice-ptt-status"
              style={{ marginTop: '3px' }}
            >
              <span
                className={
                  store.voicePtt.statusType === 'WARN' ? 'hint-warn' : 'hint-ok'
                }
              >
                {store.voicePtt.isListening
                  ? `🎤 ${store.voicePtt.interimTranscript}`
                  : store.voicePtt.lastSummaryCn}
              </span>

            </div>
          </div>
        )}

        {/* 6. 快捷命令行 / 口语指令输入 CLI */}
        <form className="cmd-cli-bar" onSubmit={handleCliSubmit}>
          <input
            type="text"
            value={cliText}
            data-testid="cli-command-input"
            onChange={(e) => setCliText(e.target.value)}
            placeholder={`支持口语/简令: 下600盲降 / 左转090 / 起飞 / VTF`}
            className="cli-input"
          />
          <button type="submit" className="btn-cli-send" data-testid="btn-cli-send">
            发送
          </button>
        </form>
        {cliFeedback && <div className="cli-feedback">{cliFeedback}</div>}
      </div>
    </div>
  ), store.uiLanguage) as React.ReactElement;
};
