import React, { useEffect, useRef } from 'react';
import { soundEngine } from '../audio/soundEngine';
import { uiText } from '../i18n/language';
import { useGameStore } from '../game/store';

export const RadioCommLog: React.FC = () => {
  const store = useGameStore();
  const recentLogs = [...store.radioLogs].slice(-35).reverse();
  const dragRef = useRef<{ active: boolean; startY: number; startH: number }>({
    active: false,
    startY: 0,
    startH: 136,
  });

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const deltaY = dragRef.current.startY - e.clientY;
      useGameStore.getState().setCommLogHeightPx(dragRef.current.startH + deltaY);
    };

    const onMouseUp = () => {
      dragRef.current.active = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      active: true,
      startY: e.clientY,
      startH: store.commLogHeightPx,
    };
  };

  const preferCn = store.settings.ttsLanguage === 'CN';
  const staticLevel = store.settings.vhfStaticLevel || 'MEDIUM';

  return (
    <footer className="radio-comm-panel" data-testid="radio-comm-log">
      {soundEngine.getAiEngineStatus().lastTtsError && <div role="status" className="accent-orange">{uiText(soundEngine.getAiEngineStatus().lastTtsError, store.uiLanguage)}</div>}
      {/* 可上下拖拽调整高度的分栏手柄 */}
      <div
        className="comm-resize-handle"
        data-testid="comm-resize-handle"
        onMouseDown={handleDragStart}
        title="按住鼠标上下拖动可自由拉高或降低陆空通话界面高度"
      >
        <span className="resize-grip-dots">══ 拖拽拉高/降低陆空通话面板 ({store.commLogHeightPx}px) ══</span>
      </div>

      <div className="comm-header">
        <span className="comm-title">
          📻 甚高频对讲机陆空通话 VHF 119.75 / 118.10 MHz · 语音：
          {preferCn ? '中文通话' : '英文 ICAO'} · 对讲机静噪：{staticLevel} (
          {store.settings.atcVoice.presetLabel} / {store.settings.pilotVoice.presetLabel})
        </span>
        <div className="comm-size-btns">
          <button
            type="button"
            className="btn-comm-size"
            data-testid="btn-comm-preview-static"
            onClick={() => store.previewWalkieTalkie()}
            title="试听甚高频对讲机 PTT 按键声与静电滋滋声"
          >
            📻 试听对讲机音
          </button>
          <button
            type="button"
            className="btn-comm-size"
            data-testid="btn-comm-height-small"
            onClick={() => store.setCommLogHeightPx(90)}
          >
            紧凑
          </button>
          <button
            type="button"
            className="btn-comm-size"
            data-testid="btn-comm-height-normal"
            onClick={() => store.setCommLogHeightPx(136)}
          >
            标准
          </button>
          <button
            type="button"
            className="btn-comm-size"
            data-testid="btn-comm-height-large"
            onClick={() => store.setCommLogHeightPx(250)}
          >
            拉高展开
          </button>
        </div>
      </div>

      <div className="comm-list" data-testid="comm-log-list">
        {recentLogs.map((entry) => (
          <div
            key={entry.id}
            className={`comm-row comm-${entry.sender.toLowerCase()}`}
            data-testid={`comm-entry-${entry.sender.toLowerCase()}`}
          >
            <span className="comm-time mono">[{entry.timeStr}]</span>
            <span className={`comm-badge badge-${entry.sender.toLowerCase()}`}>
              {entry.sender === 'ATC'
                ? '管制 ATC'
                : entry.sender === 'PILOT'
                ? '机组 PILOT'
                : entry.sender === 'ALERT'
                ? '告警 ALERT'
                : '系统 SYS'}
            </span>
            {preferCn ? (
              <>
                <span className="comm-text-en">{entry.messageCn}</span>
                <span className="comm-text-cn mono">{entry.messageEn}</span>
              </>
            ) : (
              <>
                <span className="comm-text-en mono">{entry.messageEn}</span>
                <span className="comm-text-cn">{entry.messageCn}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </footer>
  );
};
