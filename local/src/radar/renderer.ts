import { UiLanguage, uiText } from '../i18n/language';
import {
  Aircraft,
  AirportConfig,
  AltitudeUnit,
  ConflictAlert,
  GameSettings,
  Point2D,
  RunwayDirectionConfig,
  RunwayId,
  WeatherState,
} from '../aircraft/types';
import {
  formatAltitudeValue,
  formatHeading,
  getAltitudeNumber,
  getRunwayConfig,
} from '../aircraft/physics';
import { getActiveRunwaysForDirection } from '../airport/harborAirport';

export interface RadarViewport {
  uiLanguage?: UiLanguage;
  zoom: number;
  panX: number;
  panY: number;
  showRangeRings: boolean;
  showWaypoints: boolean;
  showVectors: boolean;
  showTrails: boolean;
  showApproachCone: boolean;
  showWeatherRadar: boolean;
  showSeparationRings?: boolean;
  vectorMinutes: 1 | 2;
}

export interface ScreenRect {
  aircraftId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  targetScreenX: number;
  targetScreenY: number;
}

export interface DragVectorOverlay {
  aircraftId: string;
  fromWorld: Point2D;
  toWorld: Point2D;
  headingDeg: number;
  snapWaypointId: string | null;
  snapRunwayId: RunwayId | null;
}

export function worldToScreen(
  pt: Point2D,
  canvasWidth: number,
  canvasHeight: number,
  viewport: RadarViewport
): { x: number; y: number; pxPerNM: number } {
  const minDim = Math.min(canvasWidth, canvasHeight);
  const basePxPerNM = minDim / 60;
  const pxPerNM = basePxPerNM * viewport.zoom;
  const centerX = canvasWidth / 2 + viewport.panX * pxPerNM;
  const centerY = canvasHeight / 2 - viewport.panY * pxPerNM;
  return {
    x: centerX + pt.x * pxPerNM,
    y: centerY - pt.y * pxPerNM,
    pxPerNM,
  };
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  canvasWidth: number,
  canvasHeight: number,
  viewport: RadarViewport
): Point2D {
  const minDim = Math.min(canvasWidth, canvasHeight);
  const basePxPerNM = minDim / 60;
  const pxPerNM = basePxPerNM * viewport.zoom;
  const centerX = canvasWidth / 2 + viewport.panX * pxPerNM;
  const centerY = canvasHeight / 2 - viewport.panY * pxPerNM;
  return {
    x: (screenX - centerX) / pxPerNM,
    y: (centerY - screenY) / pxPerNM,
  };
}

const LABEL_DIRECTIONS: Array<{ dx: number; dy: number }> = [
  { dx: 18, dy: -46 },
  { dx: 22, dy: 14 },
  { dx: -142, dy: -46 },
  { dx: -142, dy: 14 },
  { dx: 26, dy: -18 },
  { dx: -146, dy: -18 },
  { dx: -58, dy: -58 },
  { dx: -58, dy: 24 },
];

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  const pad = 4;
  return !(
    a.x + a.w + pad < b.x ||
    b.x + b.w + pad < a.x ||
    a.y + a.h + pad < b.y ||
    b.y + b.h + pad < a.y
  );
}

/**
 * 主雷达画面绘制器 (HTML5 Canvas 2D)
 */
export function renderRadarScope(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  airport: AirportConfig,
  aircraftList: Aircraft[],
  selectedAircraftId: string | null,
  conflicts: ConflictAlert[],
  viewport: RadarViewport,
  sweepAngleDeg: number,
  activeRunwayDir: RunwayDirectionConfig = '09',
  weather?: WeatherState,
  settings?: GameSettings,
  dragVector?: DragVectorOverlay | null
): ScreenRect[] {
  const altUnit: AltitudeUnit = settings?.altitudeUnit || 'METRIC';

  ctx.save();
  ctx.fillStyle = '#050b10';
  ctx.fillRect(0, 0, width, height);

  const origin = worldToScreen({ x: 0, y: 0 }, width, height, viewport);

  const bgGrad = ctx.createRadialGradient(
    origin.x,
    origin.y,
    10,
    origin.x,
    origin.y,
    airport.airspaceRadiusNM * origin.pxPerNM * 1.15
  );
  bgGrad.addColorStop(0, 'rgba(0, 56, 48, 0.20)');
  bgGrad.addColorStop(0.7, 'rgba(3, 25, 28, 0.12)');
  bgGrad.addColorStop(1, 'rgba(5, 11, 16, 0)');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  const hasRestrictedIntrusion = aircraftList.some((a) => Boolean(a.inRestrictedZone));
  drawTerrainAndRestrictedZones(
    ctx,
    width,
    height,
    airport,
    viewport,
    altUnit,
    settings?.showRestrictedZones !== false,
    Boolean(settings?.enableRestrictedZones),
    hasRestrictedIntrusion
  );

  if (
    settings?.enableWeatherCb !== false &&
    viewport.showWeatherRadar !== false &&
    weather &&
    weather.cells.length > 0
  ) {
    drawWeatherCells(ctx, width, height, weather, viewport);
  }

  if (viewport.showRangeRings) {
    drawRangeRingsAndCompass(ctx, width, height, airport, origin);
  } else {
    drawSectorBoundaryOnly(ctx, origin, airport.airspaceRadiusNM * origin.pxPerNM);
  }

  drawRadarSweep(ctx, origin, airport.airspaceRadiusNM * origin.pxPerNM, sweepAngleDeg);

  const runwayCountMode = settings?.runwayCountMode || 'DUAL';
  if (viewport.showApproachCone) {
    drawIlsCorridorsAndNtz(
      ctx,
      width,
      height,
      airport,
      viewport,
      activeRunwayDir,
      runwayCountMode,
      Boolean(settings?.enableNtzMonitoring && runwayCountMode === 'DUAL')
    );
  }

  if (viewport.showWaypoints) {
    drawWaypointsAndGates(ctx, width, height, airport, viewport, altUnit);
  }

  const selectedAc = aircraftList.find((a) => a.id === selectedAircraftId);
  if (selectedAc && (selectedAc.procedureLegs.length > 0 || selectedAc.directWaypointId)) {
    drawSelectedProcedureRoute(ctx, width, height, selectedAc, airport, viewport);
  }

  drawRunways(ctx, width, height, airport, viewport, activeRunwayDir, runwayCountMode);

  drawConflictLinks(ctx, width, height, aircraftList, conflicts, viewport, altUnit);

  const visibleAircraft = aircraftList.filter(
    (a) =>
      a.phase !== 'LANDED' &&
      a.phase !== 'HANDED_OFF' &&
      a.phase !== 'EXITED_AIRSPACE'
  );

  const placedRects: ScreenRect[] = [];
  for (const ac of visibleAircraft) {
    const isSelected = ac.id === selectedAircraftId;
    const hitRect = drawAircraftAndDataBlock(
      ctx,
      width,
      height,
      ac,
      isSelected,
      viewport,
      placedRects,
      settings,
      altUnit
    );
    placedRects.push(hitRect);
  }

  if (dragVector) {
    drawDragVectorOverlay(ctx, width, height, dragVector, viewport);
  }

  drawScaleAndWindIndicator(
    ctx,
    width,
    height,
    origin.pxPerNM,
    weather,
    activeRunwayDir,
    airport,
    runwayCountMode
  );

  ctx.restore();
  return placedRects;
}

function drawTerrainAndRestrictedZones(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  airport: AirportConfig,
  viewport: RadarViewport,
  altUnit: AltitudeUnit,
  showTerrain: boolean,
  enableRestrictedZones: boolean,
  hasIntrusion: boolean
): void {
  ctx.save();

  if (showTerrain && airport.terrainPolygons) {
    for (const poly of airport.terrainPolygons) {
      if (poly.points.length < 2) continue;
      ctx.beginPath();
      poly.points.forEach((pt, idx) => {
        const s = worldToScreen(pt, width, height, viewport);
        if (idx === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      if (poly.closed) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(15, 118, 110, 0.08)';
        ctx.fill();
      }
      ctx.strokeStyle =
        poly.kind === 'RIVER'
          ? 'rgba(56, 189, 248, 0.22)'
          : 'rgba(20, 184, 166, 0.22)';
      ctx.lineWidth = poly.kind === 'RIVER' ? 3.2 : 1.3;
      ctx.setLineDash(poly.kind === 'COASTLINE' ? [6, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      if (poly.label) {
        const midPt = poly.points[Math.floor(poly.points.length / 2)];
        const sm = worldToScreen(midPt, width, height, viewport);
        ctx.font = '8.5px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(45, 212, 191, 0.36)';
        ctx.fillText(uiText(poly.label, viewport.uiLanguage), sm.x + 6, sm.y - 4);
      }
    }
  }

  // 仅当限制区空方活动开启 (enableRestrictedZones === true) 时绘制禁航限制区
  if (enableRestrictedZones && airport.restrictedZones) {
    for (const zone of airport.restrictedZones) {
      const s = worldToScreen(zone.center, width, height, viewport);
      const rPx = zone.radiusNM * s.pxPerNM;
      ctx.fillStyle = hasIntrusion
        ? 'rgba(239, 68, 68, 0.22)'
        : 'rgba(244, 63, 94, 0.09)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, rPx, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = hasIntrusion
        ? '#ef4444'
        : 'rgba(244, 63, 94, 0.58)';
      ctx.lineWidth = hasIntrusion ? 2.4 : 1.4;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, rPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.fillStyle = hasIntrusion ? '#fecaca' : 'rgba(251, 113, 133, 0.88)';
      ctx.textAlign = 'center';
      ctx.fillText(
        uiText(hasIntrusion ? `🚨 警告：闯入 ${zone.nameCn}!` : `⛔ ${zone.nameCn}`, viewport.uiLanguage),
        s.x,
        s.y - 2
      );
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillText(
        uiText(`ALT < ${formatAltitudeValue(zone.maxAltitudeFt, altUnit)} 禁入`, viewport.uiLanguage),
        s.x,
        s.y + 9
      );
    }
  }

  ctx.restore();
}

function drawDragVectorOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  drag: DragVectorOverlay,
  viewport: RadarViewport
): void {
  ctx.save();
  const fromS = worldToScreen(drag.fromWorld, width, height, viewport);
  const toS = worldToScreen(drag.toWorld, width, height, viewport);

  const isSnap = Boolean(drag.snapWaypointId || drag.snapRunwayId);
  ctx.strokeStyle = isSnap ? '#00e5a3' : '#38bdf8';
  ctx.lineWidth = 2.2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(fromS.x, fromS.y);
  ctx.lineTo(toS.x, toS.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = isSnap ? '#00e5a3' : '#38bdf8';
  ctx.beginPath();
  ctx.arc(toS.x, toS.y, 6, 0, Math.PI * 2);
  ctx.fill();

  const label = uiText(drag.snapWaypointId
    ? `🎯 松开直飞 DCT ${drag.snapWaypointId}`
    : drag.snapRunwayId
    ? `🛬 松开建立盲降 ILS ${drag.snapRunwayId}`
    : `🧭 松开转向 HDG ${formatHeading(drag.headingDeg)}°`, viewport.uiLanguage);

  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  const tw = ctx.measureText(label).width + 14;
  ctx.fillStyle = 'rgba(6, 22, 34, 0.94)';
  ctx.strokeStyle = isSnap ? '#00e5a3' : '#38bdf8';
  ctx.lineWidth = 1.4;
  ctx.fillRect(toS.x + 10, toS.y - 24, tw, 22);
  ctx.strokeRect(toS.x + 10, toS.y - 24, tw, 22);

  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, toS.x + 17, toS.y - 13);
  ctx.restore();
}

function drawWeatherCells(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  weather: WeatherState,
  viewport: RadarViewport
): void {
  ctx.save();
  for (const cell of weather.cells) {
    const s = worldToScreen(cell.position, width, height, viewport);
    const outerR = cell.radiusNM * s.pxPerNM;
    const coreR = cell.coreRadiusNM * s.pxPerNM;

    const grad = ctx.createRadialGradient(s.x, s.y, coreR * 0.2, s.x, s.y, outerR);
    if (cell.intensity === 'SEVERE') {
      grad.addColorStop(0, 'rgba(239, 68, 68, 0.34)');
      grad.addColorStop(0.5, 'rgba(245, 158, 11, 0.22)');
      grad.addColorStop(0.85, 'rgba(34, 197, 94, 0.12)');
      grad.addColorStop(1, 'rgba(34, 197, 94, 0)');
    } else {
      grad.addColorStop(0, 'rgba(245, 158, 11, 0.28)');
      grad.addColorStop(0.6, 'rgba(34, 197, 94, 0.16)');
      grad.addColorStop(1, 'rgba(34, 197, 94, 0)');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(s.x, s.y, outerR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle =
      cell.intensity === 'SEVERE' ? 'rgba(239, 68, 68, 0.55)' : 'rgba(245, 158, 11, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, outerR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.fillStyle = cell.intensity === 'SEVERE' ? '#fca5a5' : '#fde68a';
    ctx.textAlign = 'center';
    ctx.fillText(uiText(`⚡ ${cell.name} (CB)`, viewport.uiLanguage), s.x, s.y - 3);
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillText(uiText('AVOID / 绕飞', viewport.uiLanguage), s.x, s.y + 8);
  }
  ctx.restore();
}

function drawSectorBoundaryOnly(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number; pxPerNM: number },
  radiusPx: number
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 229, 163, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, radiusPx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawRangeRingsAndCompass(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  airport: AirportConfig,
  origin: { x: number; y: number; pxPerNM: number }
): void {
  ctx.save();

  ctx.strokeStyle = 'rgba(0, 229, 163, 0.11)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, height);
  ctx.moveTo(0, origin.y);
  ctx.lineTo(width, origin.y);
  ctx.stroke();

  const rings = [5, 10, 15, 20, 25];
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = 'rgba(0, 229, 163, 0.38)';

  for (const nm of rings) {
    const r = nm * origin.pxPerNM;
    ctx.strokeStyle = nm % 10 === 0 ? 'rgba(0, 229, 163, 0.18)' : 'rgba(0, 229, 163, 0.09)';
    ctx.lineWidth = 1;
    ctx.setLineDash(nm % 10 === 0 ? [] : [4, 6]);
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillText(`${nm}NM`, origin.x + 4, origin.y - r + 11);
  }

  const maxR = airport.airspaceRadiusNM * origin.pxPerNM;
  ctx.strokeStyle = 'rgba(0, 229, 163, 0.45)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([10, 5]);
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, maxR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(0, 229, 163, 0.32)';
  ctx.fillStyle = 'rgba(0, 229, 163, 0.58)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let deg = 0; deg < 360; deg += 10) {
    const rad = (deg * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const inner = deg % 30 === 0 ? maxR - 8 : maxR - 4;
    ctx.beginPath();
    ctx.moveTo(origin.x + inner * sin, origin.y - inner * cos);
    ctx.lineTo(origin.x + maxR * sin, origin.y - maxR * cos);
    ctx.stroke();

    if (deg % 30 === 0) {
      const labelR = maxR + 14;
      const hdgLabel = deg === 0 ? '360°' : `${String(deg).padStart(3, '0')}°`;
      ctx.fillText(hdgLabel, origin.x + labelR * sin, origin.y - labelR * cos);
    }
  }

  ctx.restore();
}

function drawRadarSweep(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number; pxPerNM: number },
  radiusPx: number,
  sweepAngleDeg: number
): void {
  ctx.save();
  const canvasAngle = ((sweepAngleDeg - 90) * Math.PI) / 180;
  ctx.strokeStyle = 'rgba(0, 229, 163, 0.22)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.lineTo(
    origin.x + Math.cos(canvasAngle) * radiusPx,
    origin.y + Math.sin(canvasAngle) * radiusPx
  );
  ctx.stroke();
  ctx.restore();
}

function drawIlsCorridorsAndNtz(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  airport: AirportConfig,
  viewport: RadarViewport,
  activeDir: RunwayDirectionConfig,
  runwayCountMode: 'SINGLE' | 'DUAL',
  showNtz: boolean
): void {
  ctx.save();
  const { allActive, arrivalRunway } = getActiveRunwaysForDirection(
    activeDir,
    runwayCountMode,
    airport
  );

  for (const rwyId of allActive) {
    const rwy = getRunwayConfig(airport, rwyId);
    const isPrimaryArr = rwy.id === arrivalRunway;
    const rad = (rwy.heading * Math.PI) / 180;
    const ux = Math.sin(rad);
    const uy = Math.cos(rad);
    const nx = Math.cos(rad);
    const ny = -Math.sin(rad);

    const thresh = worldToScreen(rwy.threshold, width, height, viewport);
    const endCenterWorld = {
      x: rwy.threshold.x - rwy.ilsRangeNM * ux,
      y: rwy.threshold.y - rwy.ilsRangeNM * uy,
    };
    const locEnd = worldToScreen(endCenterWorld, width, height, viewport);
    const coneLeft = worldToScreen(
      {
        x: endCenterWorld.x - 0.95 * nx,
        y: endCenterWorld.y - 0.95 * ny,
      },
      width,
      height,
      viewport
    );
    const coneRight = worldToScreen(
      {
        x: endCenterWorld.x + 0.95 * nx,
        y: endCenterWorld.y + 0.95 * ny,
      },
      width,
      height,
      viewport
    );

    ctx.fillStyle = isPrimaryArr ? 'rgba(56, 189, 248, 0.07)' : 'rgba(251, 191, 36, 0.04)';
    ctx.beginPath();
    ctx.moveTo(thresh.x, thresh.y);
    ctx.lineTo(coneLeft.x, coneLeft.y);
    ctx.lineTo(coneRight.x, coneRight.y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = isPrimaryArr ? 'rgba(56, 189, 248, 0.68)' : 'rgba(251, 191, 36, 0.42)';
    ctx.lineWidth = isPrimaryArr ? 1.4 : 1.1;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(thresh.x, thresh.y);
    ctx.lineTo(locEnd.x, locEnd.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = isPrimaryArr ? 'rgba(56, 189, 248, 0.45)' : 'rgba(251, 191, 36, 0.30)';
    for (let d = 2; d <= rwy.ilsRangeNM; d += 2) {
      const tickSpanNM = d % 4 === 0 ? 0.28 : 0.14;
      const p1 = worldToScreen(
        {
          x: rwy.threshold.x - d * ux - tickSpanNM * nx,
          y: rwy.threshold.y - d * uy - tickSpanNM * ny,
        },
        width,
        height,
        viewport
      );
      const p2 = worldToScreen(
        {
          x: rwy.threshold.x - d * ux + tickSpanNM * nx,
          y: rwy.threshold.y - d * uy + tickSpanNM * ny,
        },
        width,
        height,
        viewport
      );
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = isPrimaryArr ? 'rgba(56, 189, 248, 0.92)' : 'rgba(251, 191, 36, 0.85)';
    ctx.textAlign = 'center';
    ctx.fillText(`ILS ${rwy.id} (${formatHeading(rwy.heading)}°)`, locEnd.x, locEnd.y - 8);
  }

  if (showNtz && runwayCountMode === 'DUAL' && allActive.length >= 2) {
    if (airport.layoutType === 'INTERSECTING' && airport.intersectionPoint) {
      const ix = worldToScreen(airport.intersectionPoint, width, height, viewport);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
      ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(ix.x, ix.y, 1.1 * ix.pxPerNM, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#fca5a5';
      ctx.textAlign = 'center';
      ctx.fillText('⚠ RWY INTERSECTION', ix.x, ix.y - 1.2 * ix.pxPerNM - 4);
    } else {
      const rwyA = getRunwayConfig(airport, allActive[0]);
      const rwyB = getRunwayConfig(airport, allActive[1]);
      const midStart = {
        x: (rwyA.threshold.x + rwyB.threshold.x) * 0.5,
        y: (rwyA.threshold.y + rwyB.threshold.y) * 0.5,
      };
      const rad = (rwyA.heading * Math.PI) / 180;
      const ux = Math.sin(rad);
      const uy = Math.cos(rad);
      const nx = Math.cos(rad);
      const ny = -Math.sin(rad);
      const len = 15.5;
      const halfW = 0.18;

      const c1 = worldToScreen({ x: midStart.x - halfW * nx, y: midStart.y - halfW * ny }, width, height, viewport);
      const c2 = worldToScreen({ x: midStart.x + halfW * nx, y: midStart.y + halfW * ny }, width, height, viewport);
      const c3 = worldToScreen({ x: midStart.x - len * ux + halfW * nx, y: midStart.y - len * uy + halfW * ny }, width, height, viewport);
      const c4 = worldToScreen({ x: midStart.x - len * ux - halfW * nx, y: midStart.y - len * uy - halfW * ny }, width, height, viewport);

      ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.lineTo(c3.x, c3.y);
      ctx.lineTo(c4.x, c4.y);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c4.x, c4.y);
      ctx.moveTo(c2.x, c2.y);
      ctx.lineTo(c3.x, c3.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.restore();
}

function drawSelectedProcedureRoute(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  ac: Aircraft,
  airport: AirportConfig,
  viewport: RadarViewport
): void {
  ctx.save();
  const points: Point2D[] = [ac.position];
  if (ac.procedureLegs.length > 0) {
    for (const leg of ac.procedureLegs) {
      const wp = airport.waypoints.find((w) => w.id === leg.waypointId);
      if (wp) points.push(wp.position);
    }
  } else if (ac.directWaypointId) {
    const wp = airport.waypoints.find((w) => w.id === ac.directWaypointId);
    if (wp) points.push(wp.position);
  }

  if (points.length >= 2) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    points.forEach((pt, idx) => {
      const s = worldToScreen(pt, width, height, viewport);
      if (idx === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawWaypointsAndGates(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  airport: AirportConfig,
  viewport: RadarViewport,
  altUnit: AltitudeUnit
): void {
  ctx.save();
  ctx.font = 'bold 10.5px "JetBrains Mono", monospace';

  for (const wp of airport.waypoints) {
    const s = worldToScreen(wp.position, width, height, viewport);
    const isExit = wp.role === 'EXIT';
    const isHoldStack = wp.role === 'HOLD_STACK';
    const isApproachFix = wp.role === 'IF' || wp.role === 'FAF';
    const color = isExit
      ? '#f59e0b'
      : isHoldStack
      ? '#c084fc'
      : isApproachFix
      ? '#38bdf8'
      : '#00e5a3';

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;

    if (isHoldStack) {
      ctx.save();
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 18, 9, Math.PI / 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const r = 5.5;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - r);
    ctx.lineTo(s.x + r, s.y + r * 0.85);
    ctx.lineTo(s.x - r, s.y + r * 0.85);
    ctx.closePath();
    ctx.stroke();

    ctx.fillText(wp.id, s.x + 8, s.y + 3);
    if (wp.recommendedAltitude) {
      ctx.save();
      ctx.font = '8.5px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(203, 213, 225, 0.68)';
      ctx.fillText(
        `${wp.role === 'EXIT' ? '≥' : isHoldStack ? 'HOLD ' : ''}${formatAltitudeValue(wp.recommendedAltitude, altUnit)}`,
        s.x + 8,
        s.y + 13
      );
      ctx.restore();
    }
  }

  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.fillStyle = 'rgba(0, 229, 163, 0.48)';
  for (const gate of airport.arrivalGates) {
    const s = worldToScreen(gate.position, width, height, viewport);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(`▶ ${gate.id}`, s.x + 6, s.y + 3);
  }

  ctx.restore();
}

function drawRunways(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  airport: AirportConfig,
  viewport: RadarViewport,
  activeDir: RunwayDirectionConfig,
  runwayCountMode: 'SINGLE' | 'DUAL'
): void {
  ctx.save();
  const { allActive } = getActiveRunwaysForDirection(activeDir, runwayCountMode, airport);

  for (let idx = 0; idx < allActive.length; idx++) {
    const rwyId = allActive[idx];
    const rwy = getRunwayConfig(airport, rwyId);
    const pStart = worldToScreen(rwy.threshold, width, height, viewport);
    const pEnd = worldToScreen(rwy.end, width, height, viewport);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.lineWidth = 6.5;
    ctx.beginPath();
    ctx.moveTo(pStart.x, pStart.y);
    ctx.lineTo(pEnd.x, pEnd.y);
    ctx.stroke();

    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(pStart.x, pStart.y);
    ctx.lineTo(pEnd.x, pEnd.y);
    ctx.stroke();

    ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.textAlign = 'center';

    const dx = pEnd.x - pStart.x;
    const dy = pEnd.y - pStart.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    ctx.fillText(rwy.id, pStart.x - ux * 16, pStart.y - uy * 16);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
    ctx.fillText(rwy.oppositeId, pEnd.x + ux * 16, pEnd.y + uy * 16);
  }

  const center = worldToScreen({ x: 0, y: 0 }, width, height, viewport);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.78)';
  ctx.textAlign = 'center';
  ctx.font = '9.5px "JetBrains Mono", monospace';
  ctx.fillText(uiText(`${airport.icao} · ${airport.nameCn} (${airport.layoutBadgeCn})`, viewport.uiLanguage), center.x, center.y + 28);

  ctx.restore();
}

function drawConflictLinks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  aircraftList: Aircraft[],
  conflicts: ConflictAlert[],
  viewport: RadarViewport,
  altUnit: AltitudeUnit
): void {
  if (conflicts.length === 0) return;
  ctx.save();

  for (const alert of conflicts) {
    const a = aircraftList.find((ac) => ac.id === alert.aircraftIds[0]);
    const b = aircraftList.find((ac) => ac.id === alert.aircraftIds[1]);
    if (!a || !b) continue;

    const sa = worldToScreen(a.position, width, height, viewport);
    const sb = worldToScreen(b.position, width, height, viewport);

    const isCritical =
      alert.severity === 'CRITICAL' ||
      alert.severity === 'ACCIDENT' ||
      alert.severity === 'RUNWAY' ||
      alert.severity === 'NTZ';
    ctx.strokeStyle = isCritical ? '#ef4444' : '#f97316';
    ctx.lineWidth = isCritical ? 2.4 : 1.8;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const midX = (sa.x + sb.x) / 2;
    const midY = (sa.y + sb.y) / 2;
    const tag =
      alert.severity === 'NTZ'
        ? `NTZ BREACH ${alert.horizontalDistNM.toFixed(1)}NM`
        : alert.severity === 'RUNWAY'
        ? `RWY CONFLICT ${alert.horizontalDistNM.toFixed(1)}NM`
        : alert.isWakeTurbulence
        ? `WAKE ${alert.horizontalDistNM.toFixed(1)}<${alert.requiredHorizontalNM}NM`
        : `${alert.horizontalDistNM.toFixed(1)}NM / ${formatAltitudeValue(alert.verticalDistFt, altUnit)}`;
    ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
    const tw = ctx.measureText(tag).width + 10;
    ctx.fillStyle = 'rgba(127, 29, 29, 0.92)';
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1;
    ctx.fillRect(midX - tw / 2, midY - 9, tw, 18);
    ctx.strokeRect(midX - tw / 2, midY - 9, tw, 18);

    ctx.fillStyle = '#fecaca';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, midX, midY);
  }

  ctx.restore();
}

function drawAircraftAndDataBlock(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  ac: Aircraft,
  isSelected: boolean,
  viewport: RadarViewport,
  placedRects: ScreenRect[],
  settings?: GameSettings,
  altUnit: AltitudeUnit = 'METRIC'
): ScreenRect {
  ctx.save();
  const s = worldToScreen(ac.position, width, height, viewport);

  let primaryColor = ac.category === 'ARRIVAL' ? '#00e5a3' : '#fbbf24';
  if (ac.phase === 'FINAL_APPROACH') {
    primaryColor = '#38bdf8';
  }
  if (ac.emergencyType !== 'NONE') {
    primaryColor = '#f43f5e';
  }
  if (ac.conflictLevel === 'WARNING' || ac.inWeatherHazard) {
    primaryColor = '#f97316';
  }
  if (
    ac.conflictLevel === 'CRITICAL' ||
    ac.conflictLevel === 'ACCIDENT' ||
    ac.tcasRaActive ||
    ac.inRestrictedZone
  ) {
    primaryColor = '#ef4444';
  }

  // J-Ring 雷达安全间隔环 (3.0 NM / 5.6km 标准间隔环 + 1.5 NM / 2.8km 危险接近红线环)
  const isAirborne =
    ac.phase !== 'HOLDING_GROUND' &&
    ac.phase !== 'LINE_UP_WAIT' &&
    ac.phase !== 'HOLD_CROSSING' &&
    ac.phase !== 'TAKEOFF_ROLL' &&
    ac.phase !== 'LANDING_ROLL';

  if (isAirborne && (viewport.showSeparationRings || isSelected)) {
    const stdRingPx = 3.0 * s.pxPerNM;
    const airproxRingPx = 1.5 * s.pxPerNM;

    ctx.save();
    ctx.strokeStyle = isSelected ? 'rgba(56, 189, 248, 0.36)' : 'rgba(56, 189, 248, 0.18)';
    ctx.lineWidth = isSelected ? 1.2 : 0.9;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, stdRingPx, 0, Math.PI * 2);
    ctx.stroke();

    if (viewport.showSeparationRings || ac.conflictLevel !== 'NONE') {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.34)';
      ctx.lineWidth = 1.0;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, airproxRingPx, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (viewport.showTrails && ac.trail.length > 0) {
    for (let i = 0; i < ac.trail.length; i++) {
      const tp = worldToScreen(ac.trail[i], width, height, viewport);
      const alpha = ((i + 1) / (ac.trail.length + 1)) * 0.55;
      ctx.fillStyle =
        ac.conflictLevel !== 'NONE' || ac.emergencyType !== 'NONE' || ac.inRestrictedZone
          ? `rgba(239, 68, 68, ${alpha})`
          : ac.category === 'ARRIVAL'
          ? `rgba(0, 229, 163, ${alpha})`
          : `rgba(251, 191, 36, ${alpha})`;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (viewport.showVectors && ac.speed > 20) {
    const vectorDistNM = ac.groundSpeed * (viewport.vectorMinutes / 60);
    const hdgRad = (ac.heading * Math.PI) / 180;
    const futureWorld = {
      x: ac.position.x + vectorDistNM * Math.sin(hdgRad),
      y: ac.position.y + vectorDistNM * Math.cos(hdgRad),
    };
    const futureScreen = worldToScreen(futureWorld, width, height, viewport);

    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = isSelected ? 1.8 : 1.3;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(futureScreen.x, futureScreen.y);
    ctx.stroke();

    if (
      Math.abs(ac.targetHeading - ac.heading) > 2 &&
      ac.phase !== 'HOLDING_GROUND' &&
      ac.phase !== 'LINE_UP_WAIT'
    ) {
      const targetRad = (ac.targetHeading * Math.PI) / 180;
      const targetWorld = {
        x: ac.position.x + vectorDistNM * Math.sin(targetRad),
        y: ac.position.y + vectorDistNM * Math.cos(targetRad),
      };
      const targetScreen = worldToScreen(targetWorld, width, height, viewport);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(targetScreen.x, targetScreen.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (
    ac.conflictLevel !== 'NONE' ||
    ac.emergencyType !== 'NONE' ||
    ac.inRestrictedZone ||
    ac.inWeatherHazard
  ) {
    const ringRadius = 2.5 * s.pxPerNM;
    ctx.strokeStyle =
      ac.emergencyType !== 'NONE' || ac.inRestrictedZone
        ? 'rgba(239, 68, 68, 0.92)'
        : ac.conflictLevel === 'WARNING' || ac.inWeatherHazard
        ? 'rgba(249, 115, 22, 0.78)'
        : 'rgba(239, 68, 68, 0.92)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(16, ringRadius), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (ac.identFlashTimerSec > 0) {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (isSelected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = primaryColor;
  ctx.fillStyle = isSelected ? primaryColor : '#050b10';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y - 5.5);
  ctx.lineTo(s.x + 5.5, s.y);
  ctx.lineTo(s.x, s.y + 5.5);
  ctx.lineTo(s.x - 5.5, s.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const boxW = 136;
  const boxH = 40;
  let chosenOffset = LABEL_DIRECTIONS[ac.labelOffsetIndex % LABEL_DIRECTIONS.length];
  for (let attempt = 0; attempt < LABEL_DIRECTIONS.length; attempt++) {
    const candidate =
      LABEL_DIRECTIONS[(ac.labelOffsetIndex + attempt) % LABEL_DIRECTIONS.length];
    const candidateRect = {
      x: s.x + candidate.dx,
      y: s.y + candidate.dy,
      w: boxW,
      h: boxH,
    };
    const collides = placedRects.some((r) => rectsOverlap(candidateRect, r));
    if (!collides) {
      chosenOffset = candidate;
      break;
    }
  }

  const boxX = s.x + chosenOffset.dx;
  const boxY = s.y + chosenOffset.dy;

  const anchorX = boxX + (chosenOffset.dx >= 0 ? 0 : boxW);
  const anchorY = boxY + boxH / 2;
  ctx.strokeStyle = isSelected ? '#ffffff' : primaryColor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(anchorX, anchorY);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = isSelected
    ? 'rgba(15, 32, 46, 0.94)'
    : ac.conflictLevel !== 'NONE' ||
      ac.emergencyType !== 'NONE' ||
      ac.inRestrictedZone ||
      ac.inWeatherHazard
    ? 'rgba(69, 10, 10, 0.92)'
    : 'rgba(6, 15, 23, 0.86)';
  ctx.strokeStyle = isSelected
    ? '#ffffff'
    : ac.conflictLevel !== 'NONE' ||
      ac.emergencyType !== 'NONE' ||
      ac.inRestrictedZone ||
      ac.inWeatherHazard
    ? '#ef4444'
    : 'rgba(0, 229, 163, 0.35)';
  ctx.lineWidth = isSelected ? 1.5 : 1;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  const curAltNum = getAltitudeNumber(ac.altitude, altUnit);
  const tgtAltNum = getAltitudeNumber(ac.targetAltitude, altUnit);
  const unitSuffix = altUnit === 'IMPERIAL' ? 'ft' : 'm';
  const vsArrow =
    Math.abs(ac.targetAltitude - ac.altitude) < 40
      ? '='
      : ac.targetAltitude > ac.altitude
      ? '↑'
      : '↓';
  const spdStr = `${Math.round(ac.groundSpeed)}KT`;
  const hdgStr = formatHeading(ac.heading);
  const wakeBadge = settings?.wakeStandard === 'RECAT_EU' ? ac.recatCode : ac.wakeCode;

  let modeTag = `H${formatHeading(ac.targetHeading)}`;
  if (ac.inRestrictedZone) modeTag = '⛔ 闯入限制区!';
  else if (ac.inWeatherHazard) modeTag = '⚡ 雷雨颠簸!';
  else if (ac.tcasRaActive) modeTag = `TCAS RA ${ac.tcasRaDirection}!`;
  else if (ac.emergencyType !== 'NONE') modeTag = `SQK ${ac.squawkCode} EMG`;
  else if (ac.phase === 'HOLD_CROSSING') modeTag = `X-RWY ${ac.crossingRunwayId}`;
  else if (ac.phase === 'LINE_UP_WAIT') modeTag = `LUAW ${ac.assignedRunway}`;
  else if (ac.phase === 'HOLDING_GROUND') modeTag = `WAIT ${ac.assignedRunway}`;
  else if (ac.phase === 'TAKEOFF_ROLL') modeTag = `TKOF ${ac.assignedRunway}`;
  else if (ac.phase === 'FINAL_APPROACH') modeTag = `ILS ${ac.assignedRunway}`;
  else if (ac.phase === 'INTERCEPTING') modeTag = `LOC ${ac.assignedRunway}`;
  else if (ac.phase === 'HOLDING_AIR') modeTag = `HOLD ${ac.holdState?.waypointId || ''}`;
  else if (ac.activeProcedureId) modeTag = `${ac.activeProcedureId}`;
  else if (ac.directWaypointId) modeTag = `DCT ${ac.directWaypointId}`;
  else if (ac.canHandoff) modeTag = 'RDY HANDOFF';

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
  ctx.fillStyle = isSelected ? '#ffffff' : primaryColor;
  ctx.fillText(
    `${ac.callsign} ${ac.model}/${wakeBadge}${ac.emergencyType !== 'NONE' || ac.inRestrictedZone ? '!' : ''}`,
    boxX + 5,
    boxY + 3
  );

  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(`${curAltNum}${vsArrow}${tgtAltNum}${unitSuffix} ${spdStr}`, boxX + 5, boxY + 15);

  ctx.fillStyle =
    ac.tcasRaActive || ac.emergencyType !== 'NONE' || ac.inRestrictedZone || ac.inWeatherHazard
      ? '#fca5a5'
      : ac.canHandoff
      ? '#38bdf8'
      : 'rgba(148, 163, 184, 0.95)';
  ctx.fillText(`${hdgStr}° · ${modeTag}`, boxX + 5, boxY + 27);

  ctx.restore();
  return {
    aircraftId: ac.id,
    x: boxX,
    y: boxY,
    w: boxW,
    h: boxH,
    targetScreenX: s.x,
    targetScreenY: s.y,
  };
}

function drawScaleAndWindIndicator(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pxPerNM: number,
  weather: WeatherState | undefined,
  activeDir: RunwayDirectionConfig,
  airport: AirportConfig,
  runwayCountMode: 'SINGLE' | 'DUAL'
): void {
  ctx.save();
  const barNM = 5;
  const barPx = barNM * pxPerNM;
  const x0 = 18;
  const y0 = height - 18;

  ctx.strokeStyle = 'rgba(0, 229, 163, 0.7)';
  ctx.fillStyle = 'rgba(0, 229, 163, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - 5);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + barPx, y0);
  ctx.lineTo(x0 + barPx, y0 - 5);
  ctx.stroke();

  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillText(`${barNM} NM · ${airport.icao}`, x0, y0 - 15);

  if (weather) {
    const wxX = width - 195;
    const wxY = height - 26;
    ctx.fillStyle = 'rgba(8, 17, 26, 0.88)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1;
    ctx.fillRect(wxX, wxY - 18, 180, 34);
    ctx.strokeRect(wxX, wxY - 18, 180, 34);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    const windStr =
      weather.windSpeedKt <= 0
        ? 'WIND CALM (00KT)'
        : `WIND ${String(Math.round(weather.windDirectionDeg)).padStart(3, '0')}°/${weather.windSpeedKt}KT`;
    ctx.fillText(windStr, wxX + 8, wxY - 6);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9.2px "JetBrains Mono", monospace';
    const flow = getActiveRunwaysForDirection(activeDir, runwayCountMode, airport);
    ctx.fillText(`RWY ${flow.allActive.join(' / ')}`, wxX + 8, wxY + 8);
  }

  ctx.restore();
}
