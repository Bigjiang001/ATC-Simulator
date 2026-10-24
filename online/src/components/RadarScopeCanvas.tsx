import { localizeUi } from '../i18n/react';
import React, { useEffect, useRef } from 'react';
import { useGameStore } from '../game/store';
import {
  DragVectorOverlay,
  renderRadarScope,
  ScreenRect,
  screenToWorld,
} from '../radar/renderer';
import {
  bearingTo,
  checkIlsConditions,
  distanceNM,
  formatAltitudeValue,
  getRunwayConfig,
} from '../aircraft/physics';
import { getActiveRunwaysForDirection } from '../airport/harborAirport';
import { RunwayId } from '../aircraft/types';

export const RadarScopeCanvas: React.FC = () => {
  const store = useGameStore();
  const altUnit = store.settings.altitudeUnit || 'METRIC';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitRectsRef = useRef<ScreenRect[]>([]);
  const dragVectorRef = useRef<DragVectorOverlay | null>(null);
  const dragStateRef = useRef<{
    mode: 'NONE' | 'PAN' | 'VECTOR_AIRCRAFT';
    moved: boolean;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    vectorAircraftId: string | null;
  }>({
    mode: 'NONE',
    moved: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
    vectorAircraftId: null,
  });

  useEffect(() => {
    let animId = 0;
    let lastTime = performance.now();
    let sweepDeg = 0;

    const renderLoop = (now: number) => {
      const dt = Math.max(0, (now - lastTime) / 1000);
      lastTime = now;

      const currentStore = useGameStore.getState();
      if (!currentStore.isPaused && currentStore.status === 'RUNNING') {
        sweepDeg = (sweepDeg + dt * 48 * currentStore.gameSpeed) % 360;
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const parent = canvas.parentElement;
        if (parent) {
          const rect = parent.getBoundingClientRect();
          const targetW = Math.max(360, Math.floor(rect.width));
          const targetH = Math.max(260, Math.floor(rect.height));
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          hitRectsRef.current = renderRadarScope(
            ctx,
            canvas.width,
            canvas.height,
            currentStore.airport,
            currentStore.aircraft,
            currentStore.selectedAircraftId,
            currentStore.conflicts,
            { ...currentStore.viewport, uiLanguage: currentStore.uiLanguage },
            sweepDeg,
            currentStore.activeRunwayDir,
            currentStore.weather,
            currentStore.settings,
            dragVectorRef.current
          );
        }
      }

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, []);

  const beginPointerInteraction = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;
    const state = useGameStore.getState();

    const hits = hitRectsRef.current;
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      const distToTarget = Math.hypot(clickX - h.targetScreenX, clickY - h.targetScreenY);
      if (distToTarget <= 16) {
        const ac = state.aircraft.find((a) => a.id === h.aircraftId);
        if (
          ac &&
          ac.phase !== 'HOLDING_GROUND' &&
          ac.phase !== 'LINE_UP_WAIT' &&
          ac.phase !== 'HOLD_CROSSING'
        ) {
          state.selectAircraft(ac.id);
          dragStateRef.current = {
            mode: 'VECTOR_AIRCRAFT',
            moved: false,
            startX: clientX,
            startY: clientY,
            startPanX: state.viewport.panX,
            startPanY: state.viewport.panY,
            vectorAircraftId: ac.id,
          };
          return;
        }
      }
    }

    dragStateRef.current = {
      mode: 'PAN',
      moved: false,
      startX: clientX,
      startY: clientY,
      startPanX: state.viewport.panX,
      startPanY: state.viewport.panY,
      vectorAircraftId: null,
    };
  };

  const updatePointerInteraction = (clientX: number, clientY: number) => {
    const drag = dragStateRef.current;
    if (drag.mode === 'NONE') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dxPx = clientX - drag.startX;
    const dyPx = clientY - drag.startY;
    if (Math.hypot(dxPx, dyPx) > 6) {
      drag.moved = true;
    }

    const state = useGameStore.getState();

    if (drag.mode === 'VECTOR_AIRCRAFT' && drag.vectorAircraftId && drag.moved) {
      const ac = state.aircraft.find((a) => a.id === drag.vectorAircraftId);
      if (!ac) return;
      const rect = canvas.getBoundingClientRect();
      const worldPt = screenToWorld(
        clientX - rect.left,
        clientY - rect.top,
        canvas.width,
        canvas.height,
        state.viewport
      );

      const nearWp = state.airport.waypoints.find(
        (w) => distanceNM(w.position, worldPt) <= 1.6
      );

      let snapRunwayId: RunwayId | null = null;
      if (!nearWp && ac.category === 'ARRIVAL') {
        const { allActive } = getActiveRunwaysForDirection(
          state.activeRunwayDir,
          state.settings.runwayCountMode,
          state.airport
        );
        for (const rwyId of allActive) {
          const rwyCfg = getRunwayConfig(state.airport, rwyId);
          if (distanceNM(rwyCfg.threshold, worldPt) <= 2.2) {
            snapRunwayId = rwyId;
            break;
          }
        }
      }

      const hdg = bearingTo(ac.position, worldPt);
      dragVectorRef.current = {
        aircraftId: ac.id,
        fromWorld: { ...ac.position },
        toWorld: nearWp
          ? { ...nearWp.position }
          : snapRunwayId
          ? { ...getRunwayConfig(state.airport, snapRunwayId).threshold }
          : worldPt,
        headingDeg: Math.round(hdg),
        snapWaypointId: nearWp ? nearWp.id : null,
        snapRunwayId,
      };
      return;
    }

    if (drag.mode === 'PAN' && drag.moved) {
      const minDim = Math.min(canvas.width, canvas.height);
      const pxPerNM = (minDim / 60) * state.viewport.zoom;
      state.updateViewport({
        panX: drag.startPanX + dxPx / pxPerNM,
        panY: drag.startPanY - dyPx / pxPerNM,
      });
    }
  };

  const endPointerInteraction = (clientX: number, clientY: number, shiftKey: boolean = false) => {
    const drag = dragStateRef.current;
    const activeOverlay = dragVectorRef.current;
    dragVectorRef.current = null;
    drag.mode = 'NONE';

    const state = useGameStore.getState();

    if (drag.moved && activeOverlay) {
      state.selectAircraft(activeOverlay.aircraftId);
      if (activeOverlay.snapWaypointId) {
        state.sendCommand({ type: 'DCT', waypointId: activeOverlay.snapWaypointId }, true);
      } else if (activeOverlay.snapRunwayId) {
        state.sendCommand({ type: 'CLEARED_ILS', runwayId: activeOverlay.snapRunwayId }, true);
      } else {
        state.sendCommand({ type: 'HDG', heading: activeOverlay.headingDeg }, true);
      }
      return;
    }

    if (drag.moved) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;

    const hits = hitRectsRef.current;
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      const distToTarget = Math.hypot(clickX - h.targetScreenX, clickY - h.targetScreenY);
      const inBox =
        clickX >= h.x &&
        clickX <= h.x + h.w &&
        clickY >= h.y &&
        clickY <= h.y + h.h;
      if (distToTarget <= 14 || inBox) {
        state.selectAircraft(h.aircraftId);
        return;
      }
    }

    if (shiftKey && state.selectedAircraftId) {
      const worldPt = screenToWorld(
        clickX,
        clickY,
        canvas.width,
        canvas.height,
        state.viewport
      );
      const nearWp = state.airport.waypoints.find(
        (w) => distanceNM(w.position, worldPt) <= 1.6
      );
      if (nearWp) {
        state.sendCommand({ type: 'DCT', waypointId: nearWp.id }, true);
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    beginPointerInteraction(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    updatePointerInteraction(e.clientX, e.clientY);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    endPointerInteraction(e.clientX, e.clientY, e.shiftKey);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let pinching = false;
    let pinch: { distance: number; zoom: number; world: { x: number; y: number } } | null = null;
    const cancelDrag = () => {
      dragStateRef.current.mode = 'NONE';
      dragVectorRef.current = null;
    };
    const point = (x: number, y: number) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (x - rect.left) * canvas.width / rect.width,
        y: (y - rect.top) * canvas.height / rect.height };
    };
    const start = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      if (e.touches.length >= 2) {
        cancelDrag();
        pinching = true;
        const [a, b] = [e.touches[0], e.touches[1]];
        const mid = point((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        const vp = useGameStore.getState().viewport;
        pinch = { distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
          zoom: vp.zoom, world: screenToWorld(mid.x, mid.y, canvas.width, canvas.height, vp) };
      } else if (!pinching && e.touches.length === 1) {
        beginPointerInteraction(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const move = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      if (pinch && e.touches.length >= 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const mid = point((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        const zoom = Math.max(0.55, Math.min(2.8, pinch.zoom *
          Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.distance));
        const scale = Math.min(canvas.width, canvas.height) / 60 * zoom;
        useGameStore.getState().updateViewport({ zoom,
          panX: (mid.x - canvas.width / 2) / scale - pinch.world.x,
          panY: (canvas.height / 2 - mid.y) / scale - pinch.world.y });
      } else if (!pinching && e.touches.length === 1) {
        updatePointerInteraction(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const end = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      if (!pinching && e.changedTouches[0]) {
        endPointerInteraction(e.changedTouches[0].clientX, e.changedTouches[0].clientY, false);
      }
      // After a pinch, require all fingers to lift before allowing aircraft commands.
      if (pinching) cancelDrag();
      pinch = null;
      if (pinching && e.touches.length >= 2) start(e);
      if (!e.touches.length) pinching = false;
    };
    const cancel = () => { cancelDrag(); pinch = null; pinching = false; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const state = useGameStore.getState();
      state.updateViewport({ zoom: Math.max(0.55, Math.min(2.8,
        state.viewport.zoom * (e.deltaY < 0 ? 1.12 : 0.89))) });
    };
    const gesture = (e: Event) => { if (e.cancelable) e.preventDefault(); };
    // Native non-passive listeners let Safari reserve gestures for this canvas only.
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end, { passive: false });
    canvas.addEventListener('touchcancel', cancel);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('gesturestart', gesture, { passive: false });
    canvas.addEventListener('gesturechange', gesture, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', start);
      canvas.removeEventListener('touchmove', move);
      canvas.removeEventListener('touchend', end);
      canvas.removeEventListener('touchcancel', cancel);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('gesturestart', gesture);
      canvas.removeEventListener('gesturechange', gesture);
    };
  }, []);

  const vp = store.viewport;
  const selectedAc = store.aircraft.find((a) => a.id === store.selectedAircraftId);
  const wakeTag =
    store.settings.wakeStandard === 'RECAT_EU'
      ? selectedAc?.recatCode
      : selectedAc?.wakeCode;

  const restrictedIntruders = store.settings.enableRestrictedZones
    ? store.aircraft.filter(
        (a) =>
          a.inRestrictedZone &&
          a.phase !== 'LANDED' &&
          a.phase !== 'HANDED_OFF' &&
          a.phase !== 'EXITED_AIRSPACE'
      )
    : [];
  const weatherIntruders = store.settings.enableWeatherCb
    ? store.aircraft.filter(
        (a) =>
          a.inWeatherHazard &&
          a.phase !== 'LANDED' &&
          a.phase !== 'HANDED_OFF' &&
          a.phase !== 'EXITED_AIRSPACE'
      )
    : [];

  const getRookieCoachTip = (): string => {
    if (!selectedAc) {
      return '🎓 实时教练：点击右侧进程单或雷达上的飞机即可选中；按住 Shift 键可通过话筒语音下达指令。';
    }
    if (selectedAc.inRestrictedZone) {
      return `🚨 紧急提示（${selectedAc.callsign} 闯入限制区）：请立即拖拽航向偏离红色禁航区，或点击高度层爬升至限高以上！`;
    }
    if (selectedAc.phase === 'HOLDING_GROUND' || selectedAc.phase === 'LINE_UP_WAIT') {
      return `🎓 实时教练（${selectedAc.callsign} 地面等待）：可按住 Shift 说“可以起飞”，或直接点击【CLEARED TAKEOFF ${selectedAc.assignedRunway}】放行起飞。`;
    }
    if (selectedAc.category === 'DEPARTURE') {
      if (selectedAc.canHandoff) {
        return `🎓 实时教练（${selectedAc.callsign} 达到移交条件）：按住 Shift 说“移交”或点击右下角【★ HANDOFF 移交】完成离场移交！`;
      }
      return `🎓 实时教练（${selectedAc.callsign} 离场爬升中）：过 360m 后将自动切入 ${selectedAc.assignedExitId || 'SID'} 离场航线并爬升至 ${formatAltitudeValue(6000, altUnit)} 移交层。`;
    }
    if (selectedAc.phase === 'FINAL_APPROACH') {
      return `🎓 实时教练（${selectedAc.callsign} 已建立 ${selectedAc.assignedRunway} 盲降）：飞机正自动沿 3° 下滑道对准跑道接地，请保持跑道畅通。`;
    }
    if (selectedAc.phase === 'INTERCEPTING' && selectedAc.clearedApproach) {
      return `🎓 实时教练（${selectedAc.callsign} 正在切入 ${selectedAc.assignedRunway} 五边）：自动驾驶正平滑对正航向道并下降截获下滑道。`;
    }
    const ils = checkIlsConditions(selectedAc, store.airport, selectedAc.assignedRunway, altUnit);
    if (ils.canAcceptClearance) {
      return `🎓 实时教练（${selectedAc.callsign} 已满足 ${selectedAc.assignedRunway} 切入条件）：按住 Shift 说“可以盲降”或点击右下角【CLEARED ILS ${selectedAc.assignedRunway}】建立盲降！`;
    }
    return `🎓 实时教练（${selectedAc.callsign} 进港引导）：按住 Shift 说“引导五边”或点击右下角【🎯 引导五边】即可自动对正 ${selectedAc.assignedRunway} 建立盲降！`;
  };

  // 海湾国际机场 (ZSHB) 8 步新手教学面板内容
  const getTutorialStepContent = (): {
    title: string;
    body: string;
    actionHint: string;
    isInteractiveStep: boolean;
  } => {
    const step = store.tutorial.step;
    if (step === 1) {
      return {
        title: '🎓 新手教学 (1/8) · 认识中央主雷达显示屏 (Radar Scope)',
        body: '欢迎来到【海湾国际机场 (ZSHB)】终端区管制中心！屏幕正中央是您的主雷达屏：中心两条水平白线是平行跑道 09L（北跑道·主降落）和 09R（南跑道·主起飞）；蓝色扇形漏斗是 09L 的 3° 盲降引导走廊；三角形图标是航路点（如西五边的 BAYVW 900m、HARBR 600m）。每架飞机旁边的三行标牌依次显示：呼号与机型、当前高度→目标高度(米)与地速、当前航向与状态。',
        actionHint: '了解雷达屏幕构成后，请点击下方【下一步】认识右侧的电子进程单。',
        isInteractiveStep: false,
      };
    }
    if (step === 2) {
      return {
        title: '🎓 新手教学 (2/8) · 认识右上角：电子进程单 (Flight Strips)',
        body: '请看右上角黄色高亮区域：这是空管员的【电子进程单】。绿色左边框代表【进港航班 (ARR)】（如东方航空 CES5213、中国国航 CCA1802），需要您引导它们对准跑道降落；琥珀色左边框代表【离港航班 (DEP)】（如海南航空 CHH7601），需要您放行起飞并爬升移交。航司名称右侧带有各航司专属航徽标志，点击任意进程单即可选中该飞机。',
        actionHint: '请点击下方【下一步】了解如何对选中的飞机下达管制指令。',
        isInteractiveStep: false,
      };
    }
    if (step === 3) {
      return {
        title: '🎓 新手教学 (3/8) · 认识右下角：管制指令台与 Shift 语音指挥',
        body: '请看右下角黄色高亮区域【管制指令台】：① 支持按住键盘【Shift 键】对着麦克风说出模糊口语指令（如“下600”、“可以盲降”、“引导五边”、“起飞”），松开后只播放机长复诵声音；② 也可以直接在雷达屏上【按住飞机图标向目标方向拖动】拉出航向线，或点击【🎯 引导五边】自动切入盲降；③ 高度层默认采用中国空管标准公制米（每 300 米一层：600m 至 2700m）。',
        actionHint: '请点击下方【下一步】认识顶部状态栏与底部对讲机陆空通话。',
        isInteractiveStep: false,
      };
    }
    if (step === 4) {
      return {
        title: '🎓 新手教学 (4/8) · 认识顶部气象状态栏与底部对讲机陆空通话',
        body: '顶部状态栏显示当前地面风向风速（METAR WIND）、着陆/离港考核进度、安全连击倍率以及【局内难度与倍速调节】。底部面板实时记录您发出的每一条管制指令与机长复诵，并伴有真实的甚高频对讲机按键音与静电滋滋声。注意：两机水平距离 < 2.8公里(1.5NM) 且垂直高度差 < 150米 将构成【危险接近严重差错】直接导致游戏结束！',
        actionHint: '界面导览已完成！点击【开始实操带飞训练】进入海湾机场实操指挥！',
        isInteractiveStep: false,
      };
    }
    if (step === 5) {
      return {
        title: '🛫 实操带飞 (5/8) · 第一步：放行地面离港航班 CHH7601 起飞',
        body: '现在雷达已开始运转！我已经为您选中了正在 09R 跑道外等待起飞的【海南航空 CHH7601 (A333 重型机)】。请看右下角指令台顶部，点击亮黄色的【CLEARED TAKEOFF 09R】按钮（或按住 Shift 说“起飞”），准许其进入 09R 跑道起飞滑跑！',
        actionHint: '👉 操作任务：选中 CHH7601，点击右下角【CLEARED TAKEOFF 09R】按钮（或按回车键 Enter）。',
        isInteractiveStep: true,
      };
    }
    if (step === 6) {
      return {
        title: '🛬 实操带飞 (6/8) · 第二步：指挥进港航班 CES5213 建立 09L 盲降',
        body: '干得漂亮！CHH7601 正在滑跑起飞。现在请看西五边的【东方航空 CES5213】（已在 900m 标准切入高度对准 09L 跑道五边漏斗）。请点击选中 CES5213，然后点击右下角绿色高亮的【CLEARED ILS 09L】或【🎯 引导五边】按钮，准许其建立盲降着陆！',
        actionHint: '👉 操作任务：选中 CES5213，点击右下角绿色【CLEARED ILS 09L】按钮建立盲降。',
        isInteractiveStep: true,
      };
    }
    if (step === 7) {
      return {
        title: '🧭 实操带飞 (7/8) · 第三步：分配标准进离场程序 (STAR/SID) 与高度层',
        body: 'CES5213 已锁定 09L 下滑道自动下降着陆！接下来请练习调配另外两架飞机：① 选中刚离地的【CHH7601】，点击【SID OCEAN-1D】或高度【1800m】让其加速爬升前往 OCEAN 移交点；② 选中西南方进港的【中国国航 CCA1802】，点击【STAR SOUTH-1A】或【🎯 引导五边】。',
        actionHint: '👉 操作任务：对任意航班下达一条程序 (STAR/SID)、高度 (ALT) 或引导五边指令。',
        isInteractiveStep: true,
      };
    }
    return {
      title: `🎖️ 终端管制执照实操考核 (8/8) · 当前进度：着陆 ${store.landedCount}/2 架 ｜ 移交 ${store.departedCount}/1 架`,
      body: '您已掌握全部核心空管技能！现在请继续指挥场上航班（可开启顶部 2× 或 4× 倍速加快飞行进程）：① 当 CHH7601 爬升至 ≥1500m 亮起【★ HANDOFF 移交】时点击移交；② 当 CCA1802 飞抵五边漏斗自动截获盲降安全落地；③ 亦可放行地面第二架离港机 CXA8190 起飞。达成 2 架安全着陆 + 1 架离场移交即刻颁发管制执照！',
      actionHint: '💡 提示：可点击顶部【2×】或【4×】加速飞行；达成 2 降落 + 1 移交后自动颁发执照（完成目标后可点击右侧按钮领取执照）。',
      isInteractiveStep: true,
    };
  };

  const tutContent = store.tutorial.active ? getTutorialStepContent() : null;

  return localizeUi((
    <section
      className="radar-Workspace"
      data-testid="radar-workspace"
      style={
        store.tutorial.active && store.tutorial.step === 1
          ? { boxShadow: 'inset 0 0 0 2px #fbbf24' }
          : undefined
      }
    >
      <canvas
        ref={canvasRef}
        className="radar-canvas"
        data-testid="radar-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />

      {/* 左上角缩放与 J-Ring 安全间隔环按钮 */}
      <div className="radar-overlay-Controls">
        <button
          type="button"
          className="overlay-btn"
          data-testid="btn-zoom-in"
          onClick={() =>
            store.updateViewport({ zoom: Math.min(2.8, Number((vp.zoom + 0.2).toFixed(2))) })
          }
        >
          ＋ 放大
        </button>
        <button
          type="button"
          className="overlay-btn"
          data-testid="btn-zoom-out"
          onClick={() =>
            store.updateViewport({ zoom: Math.max(0.55, Number((vp.zoom - 0.2).toFixed(2))) })
          }
        >
          － 缩小
        </button>
        <button
          type="button"
          className="overlay-btn"
          data-testid="btn-zoom-reset"
          onClick={() => store.resetViewport()}
        >
          ⌖ 居中 ({Math.round(vp.zoom * 100)}%)
        </button>
        <button
          type="button"
          className={`overlay-btn ${vp.showSeparationRings ? 'active' : ''}`}
          data-testid="btn-toggle-jring"
          onClick={() =>
            store.updateViewport({ showSeparationRings: !vp.showSeparationRings })
          }
          title="开启或关闭全机队 5.6km(3.0NM) 标准间隔环与 2.8km(1.5NM) 危险接近红线环 (J-Ring)"
        >
          ◎ 间隔环 {vp.showSeparationRings ? 'ON' : 'OFF'}
        </button>
      </div>


      {/* 海湾机场交互式新手教学与终端管制执照考核引导卡片 */}
      {store.tutorial.active && !store.tutorial.licensePassed && tutContent && (
        <div
          data-testid="tutorial-guide-panel"
          style={{
            position: 'absolute',
            top: '50px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(680px, 92%)',
            background: 'rgba(8, 22, 36, 0.96)',
            border: '1.5px solid #fbbf24',
            borderRadius: '8px',
            padding: '10px 14px',
            zIndex: 25,
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.75)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '5px',
            }}
          >
            <strong style={{ color: '#fbbf24', fontSize: '13px' }}>{tutContent.title}</strong>
            <span className="mono" style={{ fontSize: '11px', color: '#38bdf8' }}>
              着陆 {store.landedCount}/2 · 移交 {store.departedCount}/1
            </span>
          </div>
          <p style={{ color: '#e2e8f0', fontSize: '11.5px', lineHeight: 1.48, marginBottom: '6px' }}>
            {tutContent.body}
          </p>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
              borderTop: '1px solid rgba(251, 191, 36, 0.25)',
              paddingTop: '6px',
            }}
          >
            <span style={{ color: '#00e5a3', fontSize: '11px', fontWeight: 600 }}>
              {tutContent.actionHint}
            </span>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              {store.tutorial.step < 8 && (
                <button
                  type="button"
                  className="btn-primary"
                  data-testid="btn-tutorial-next"
                  style={{ padding: '4px 12px', fontSize: '11.5px' }}
                  onClick={() => store.advanceTutorialStep()}
                >
                  {store.tutorial.step === 4 ? '▶ 开始实操带飞训练' : '下一步 ▶'}
                </button>
              )}
              {store.tutorial.step >= 5 && (
                <button
                  type="button"
                  className="btn-secondary"
                  data-testid="btn-tutorial-pass-exam"
                  disabled={store.landedCount < 2 || store.departedCount < 1}
                  style={{ padding: '4px 10px', fontSize: '11px' }}
                  onClick={() => store.completeTutorialLicenseExam()}
                  title="完成考核并申领终端管制员执照"
                >
                  🎖️ 完成考核领证
                </button>
              )}
              <button
                type="button"
                className="btn-chip"
                data-testid="btn-tutorial-exit"
                onClick={() => store.exitTutorialMode()}
              >
                退出教学
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 左侧中部 AMAN 进港排序时间轴 */}
      {store.settings.showAmanTimeline && store.amanSequence.length > 0 && (
        <div className="aman-timeline-card" data-testid="aman-timeline">
          <div className="aman-header">
            <span>⏱ AMAN 进港排序序列</span>
            <small>{store.airport.icao}</small>
          </div>
          <div className="aman-list">
            {store.amanSequence.slice(0, 5).map((item, idx) => (
              <div
                key={item.aircraftId}
                className={`aman-item ${
                  item.aircraftId === store.selectedAircraftId ? 'aman-selected' : ''
                } ${item.isEmergency ? 'aman-emergency' : ''}`}
                onClick={() => store.selectAircraft(item.aircraftId)}
              >
                <div className="aman-row-top">
                  <span className="aman-rank">#{idx + 1}</span>
                  <strong className="mono">{item.callsign}</strong>
                  <span className="aman-rwy">{item.assignedRunway}</span>
                  <span className="aman-eta mono">ETA {item.etaSec}s</span>
                </div>
                <div className="aman-row-sub">
                  {item.distToThresholdNM}NM · {item.recommendedActionCn}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 右上角冲突告警、禁航限制区侵入告警、雷雨绕飞告警与选中航班 HUD */}
      <div className="radar-overlay-right">
        {store.conflicts.length > 0 && (
          <div className="stca-banner" data-testid="stca-alert-banner">
            <div className="stca-title">
              ⚠ {store.settings.wakeStandard} STCA / WAKE / RWY ALERT ({store.conflicts.length})
            </div>
            {store.conflicts.map((c) => (
              <div key={c.id} className="stca-item">
                {c.callsigns[0]} ↔ {c.callsigns[1]} · {c.horizontalDistNM.toFixed(1)} NM (需≥
                {c.requiredHorizontalNM}NM) / {formatAltitudeValue(c.verticalDistFt, altUnit)}
              </div>
            ))}
          </div>
        )}

        {(restrictedIntruders.length > 0 || weatherIntruders.length > 0) && (
          <div className="stca-banner" data-testid="airspace-hazard-banner">
            <div className="stca-title">
              🚨 空域限制区 / 雷雨天气侵入告警 ({restrictedIntruders.length + weatherIntruders.length})
            </div>
            {restrictedIntruders.map((ac) => {
              const zone = store.airport.restrictedZones?.[0];
              return (
                <div key={`rz-${ac.id}`} className="stca-item">
                  ⛔ <strong>{ac.callsign}</strong> 闯入【{zone?.nameCn || '禁航限制区'}】！请立即转向脱离或爬升至{' '}
                  {formatAltitudeValue(zone?.maxAltitudeFt || 4000, altUnit)} 以上！
                </div>
              );
            })}
            {weatherIntruders.map((ac) => (
              <div key={`wx-${ac.id}`} className="stca-item">
                ⚡ <strong>{ac.callsign}</strong> 误入强雷雨积雨云 (CB) 遭遇颠簸！请立即引导绕飞！
              </div>
            ))}
          </div>
        )}

        {selectedAc && (
          <div className="selected-hud-card" data-testid="selected-aircraft-hud">
            <div className="hud-header">
              <span className="hud-callsign">{selectedAc.callsign}</span>
              <span className="hud-badge">
                {selectedAc.model}/{wakeTag} · SQK {selectedAc.squawkCode}
              </span>
              <span
                className={`hud-cat ${
                  selectedAc.category === 'ARRIVAL' ? 'cat-arr' : 'cat-dep'
                }`}
              >
                {selectedAc.assignedRunway}
              </span>
            </div>
            <div className="hud-grid">
              <div>
                <small>HDG 航向</small>
                <strong>
                  {String(Math.round(selectedAc.heading)).padStart(3, '0')}° →{' '}
                  {String(Math.round(selectedAc.targetHeading)).padStart(3, '0')}°
                </strong>
              </div>
              <div>
                <small>ALT 高度</small>
                <strong>
                  {formatAltitudeValue(selectedAc.altitude, altUnit)} →{' '}
                  {formatAltitudeValue(selectedAc.targetAltitude, altUnit)}
                </strong>
              </div>
              <div>
                <small>IAS / GS 速度</small>
                <strong>
                  {Math.round(selectedAc.speed)} / GS {Math.round(selectedAc.groundSpeed)} kt
                </strong>
              </div>
              <div>
                <small>STATUS 状态</small>
                <strong>
                  {selectedAc.inRestrictedZone
                    ? '⛔ 闯入限制区!'
                    : selectedAc.inWeatherHazard
                    ? '⚡ 雷雨颠簸!'
                    : selectedAc.tcasRaActive
                    ? `TCAS RA ${selectedAc.tcasRaDirection}`
                    : selectedAc.emergencyType !== 'NONE'
                    ? selectedAc.emergencyType.replace('SQUAWK_', '')
                    : selectedAc.activeProcedureId || selectedAc.phase}
                </strong>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* V8.0 按住 Shift 话筒语音对讲实时浮窗 */}
      {store.voicePtt.isListening && (
        <div
          className="voice-ptt-banner listening"
          data-testid="voice-ptt-listening-banner"
        >
          <div style={{ fontWeight: 800, color: '#fecaca', marginBottom: '2px' }}>
            🎙️ VHF PTT 话筒发射中 (按住 Shift 说话，松开自动识别执行 · 仅播报机长复诵)
          </div>
          <div className="mono" style={{ color: '#ffffff' }}>
            {store.voicePtt.interimTranscript || '正在聆听管制指令...'}
          </div>
        </div>
      )}

      {/* 成就解锁弹窗横幅 */}
      {store.achievementToast && (
        <div
          className="achievement-toast"
          data-testid="achievement-toast"
          onClick={() => store.dismissAchievementToast()}
        >
          <span className="ach-icon">{store.achievementToast.icon}</span>
          <div>
            <div className="ach-kicker">ACHIEVEMENT UNLOCKED · 生涯成就解锁</div>
            <div className="ach-title">{store.achievementToast.titleCn}</div>
            <div className="ach-desc">{store.achievementToast.descCn}</div>
          </div>
        </div>
      )}

      {/* 底部实时新手教练提示条 */}
      {store.settings.enableRookieCoach && (
        <div className="rookie-coach-banner" data-testid="rookie-coach-banner">
          <span>{getRookieCoachTip()}</span>
        </div>
      )}
    </section>
  ), store.uiLanguage) as React.ReactElement;
};
