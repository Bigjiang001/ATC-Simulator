export const LANDING_ROLL_TARGET_DISTANCE = 200;
export const BASE_SIMULATION_FRAME_RATE = 60;
export const ALTITUDE_TIME_SCALE = 4;

export function normalizeDeltaSeconds(dt) {
  if (!Number.isFinite(dt) || dt <= 0) return 1 / BASE_SIMULATION_FRAME_RATE;
  return Math.min(dt, 0.1);
}

export function getFrameScale(dt) {
  return normalizeDeltaSeconds(dt) * BASE_SIMULATION_FRAME_RATE;
}

export function getMovementDistance(speed, dt) {
  return Math.max(0, Number(speed) || 0) * getFrameScale(dt);
}

export function getScaledCanvasPoint(clientX, clientY, rect, canvasWidth, canvasHeight) {
  const displayWidth = Math.max(1, Number(rect?.width) || 0);
  const displayHeight = Math.max(1, Number(rect?.height) || 0);
  const scaleX = Math.max(0, Number(canvasWidth) || 0) / displayWidth;
  const scaleY = Math.max(0, Number(canvasHeight) || 0) / displayHeight;
  return {
    x: ((Number(clientX) || 0) - (Number(rect?.left) || 0)) * scaleX,
    y: ((Number(clientY) || 0) - (Number(rect?.top) || 0)) * scaleY,
    scaleX,
    scaleY,
  };
}

export function getCoarsePointerHitRadius(scaleX, scaleY) {
  const displayScale = Math.max(1, Number(scaleX) || 1, Number(scaleY) || 1);
  return Math.min(110, Math.max(40, displayScale * 22));
}

export function getTurnStep(turnRatePerFrame, dt) {
  return Math.max(0, Number(turnRatePerFrame) || 0) * getFrameScale(dt);
}

export function getNextValue(currentValue, targetValue, changePerSecond, dt) {
  const current = Number(currentValue) || 0;
  const target = Number(targetValue) || 0;
  const difference = target - current;
  if (Math.abs(difference) < 0.0001) return target;

  const maximumChange = Math.max(0, Number(changePerSecond) || 0) * normalizeDeltaSeconds(dt);
  return current + Math.sign(difference) * Math.min(Math.abs(difference), maximumChange);
}

export function headingToVector(heading) {
  const radians = ((Number(heading) || 0) * Math.PI) / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
}

export function vectorToHeading(vector) {
  if (!vector || (Math.abs(vector.x) < 0.0001 && Math.abs(vector.y) < 0.0001)) return 0;
  return (Math.atan2(vector.x, -vector.y) * 180 / Math.PI + 360) % 360;
}

export function getSmallestHeadingDifference(firstHeading, secondHeading) {
  const difference = Math.abs(((Number(firstHeading) || 0) - (Number(secondHeading) || 0)) % 360);
  return Math.min(difference, 360 - difference);
}

export function evaluateCubicBezier(t, points) {
  const progress = Math.max(0, Math.min(1, Number(t) || 0));
  const inverse = 1 - progress;
  const { start, cp1, cp2, end } = points;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * progress * cp1.x +
      3 * inverse * progress ** 2 * cp2.x + progress ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * progress * cp1.y +
      3 * inverse * progress ** 2 * cp2.y + progress ** 3 * end.y,
  };
}

export function evaluateCubicBezierTangent(t, points) {
  const progress = Math.max(0, Math.min(1, Number(t) || 0));
  const inverse = 1 - progress;
  const { start, cp1, cp2, end } = points;
  const x = 3 * inverse ** 2 * (cp1.x - start.x) +
    6 * inverse * progress * (cp2.x - cp1.x) +
    3 * progress ** 2 * (end.x - cp2.x);
  const y = 3 * inverse ** 2 * (cp1.y - start.y) +
    6 * inverse * progress * (cp2.y - cp1.y) +
    3 * progress ** 2 * (end.y - cp2.y);
  const length = Math.hypot(x, y);
  return length > 0.0001 ? { x: x / length, y: y / length } : { x: 0, y: -1 };
}

function buildBezierArcLengthTable(points, segments = 100) {
  const table = [{ t: 0, length: 0 }];
  let length = 0;
  let previousPoint = points.start;

  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments;
    const point = evaluateCubicBezier(t, points);
    length += Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
    table.push({ t, length });
    previousPoint = point;
  }

  return table;
}

export function getBezierTAtDistance(arcLengthTable, distance) {
  if (!arcLengthTable?.length) return 0;
  const targetDistance = Math.max(0, Number(distance) || 0);
  const finalEntry = arcLengthTable[arcLengthTable.length - 1];
  if (targetDistance >= finalEntry.length) return 1;

  let lowerIndex = 0;
  let upperIndex = arcLengthTable.length - 1;
  while (upperIndex - lowerIndex > 1) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (arcLengthTable[middleIndex].length < targetDistance) lowerIndex = middleIndex;
    else upperIndex = middleIndex;
  }

  const lower = arcLengthTable[lowerIndex];
  const upper = arcLengthTable[upperIndex];
  const segmentLength = Math.max(0.0001, upper.length - lower.length);
  const segmentProgress = (targetDistance - lower.length) / segmentLength;
  return lower.t + (upper.t - lower.t) * segmentProgress;
}

export function buildSmoothApproachTrajectory({
  startX,
  startY,
  startHeading,
  runwayX,
  runwayY,
  finalHeading,
  finalApproachDistance,
  minimumTurnRadius = 70,
}) {
  const start = { x: Number(startX) || 0, y: Number(startY) || 0 };
  const runway = { x: Number(runwayX) || 0, y: Number(runwayY) || 0 };
  const finalVector = headingToVector(finalHeading);
  const requestedFinalDistance = Math.max(180, Number(finalApproachDistance) || 220);
  const turnDemand = getSmallestHeadingDifference(startHeading, finalHeading);
  const stabilizedFinalDistance = Math.min(480, Math.max(requestedFinalDistance, 220));
  const end = {
    x: runway.x - finalVector.x * stabilizedFinalDistance,
    y: runway.y - finalVector.y * stabilizedFinalDistance,
  };
  const radius = Math.max(45, Number(minimumTurnRadius) || 70);
  const path = getShortestDubinsPath(start, startHeading, end, finalHeading, radius);
  const segments = [];
  let pose = { x: start.x, y: start.y, heading: normalizeHeading(startHeading) };
  let cumulativeLength = 0;

  for (const pathSegment of path.segments) {
    const length = pathSegment.parameter * radius;
    const segment = {
      type: pathSegment.type,
      length,
      radius,
      startDistance: cumulativeLength,
      startPose: { ...pose },
    };
    segments.push(segment);
    pose = advanceDubinsPose(pose, pathSegment.type, length, radius);
    cumulativeLength += length;
  }

  return {
    segments,
    curveLength: cumulativeLength,
    finalApproachDistance: stabilizedFinalDistance,
    finalApproachPoint: end,
    turnDemand,
    minimumTurnRadius: radius,
    pathType: path.type,
  };
}

export function getApproachPoseAtDistance(trajectory, distance) {
  if (!trajectory?.segments?.length) return null;
  const targetDistance = Math.max(0, Math.min(trajectory.curveLength, Number(distance) || 0));
  const segment = trajectory.segments.find(item => targetDistance <= item.startDistance + item.length)
    || trajectory.segments[trajectory.segments.length - 1];
  const localDistance = targetDistance - segment.startDistance;
  const pose = advanceDubinsPose(segment.startPose, segment.type, localDistance, segment.radius);
  return {
    point: { x: pose.x, y: pose.y },
    tangent: headingToVector(pose.heading),
    heading: pose.heading,
    progress: trajectory.curveLength > 0 ? targetDistance / trajectory.curveLength : 1,
  };
}

function normalizeHeading(heading) {
  return ((Number(heading) || 0) % 360 + 360) % 360;
}

function mod2pi(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function advanceDubinsPose(startPose, type, distance, radius) {
  const heading = normalizeHeading(startPose.heading);
  if (type === "S") {
    const vector = headingToVector(heading);
    return {
      x: startPose.x + vector.x * distance,
      y: startPose.y + vector.y * distance,
      heading,
    };
  }

  const turnSign = type === "R" ? 1 : -1;
  const startRadians = heading * Math.PI / 180;
  const endRadians = startRadians + turnSign * distance / radius;
  return {
    x: startPose.x + turnSign * radius * (Math.cos(startRadians) - Math.cos(endRadians)),
    y: startPose.y + turnSign * radius * (Math.sin(startRadians) - Math.sin(endRadians)),
    heading: normalizeHeading(endRadians * 180 / Math.PI),
  };
}

function getShortestDubinsPath(start, startHeading, end, finalHeading, radius) {
  const dx = end.x - start.x;
  const dyCartesian = -(end.y - start.y);
  const distance = Math.hypot(dx, dyCartesian);
  const direction = Math.atan2(dyCartesian, dx);
  const startAngle = Math.PI / 2 - normalizeHeading(startHeading) * Math.PI / 180;
  const finalAngle = Math.PI / 2 - normalizeHeading(finalHeading) * Math.PI / 180;
  const alpha = mod2pi(startAngle - direction);
  const beta = mod2pi(finalAngle - direction);
  const normalizedDistance = distance / radius;
  const candidates = [
    dubinsLSL(alpha, beta, normalizedDistance),
    dubinsRSR(alpha, beta, normalizedDistance),
    dubinsLSR(alpha, beta, normalizedDistance),
    dubinsRSL(alpha, beta, normalizedDistance),
    dubinsRLR(alpha, beta, normalizedDistance),
    dubinsLRL(alpha, beta, normalizedDistance),
  ].filter(Boolean);

  if (!candidates.length) {
    return { type: "S", segments: [{ type: "S", parameter: normalizedDistance }] };
  }
  return candidates.reduce((best, candidate) =>
    candidate.total < best.total ? candidate : best);
}

function createDubinsCandidate(type, first, second, third) {
  const parameters = [first, second, third];
  return {
    type,
    total: parameters.reduce((sum, value) => sum + value, 0),
    segments: type.split("").map((segmentType, index) => ({
      type: segmentType,
      parameter: parameters[index],
    })),
  };
}

function dubinsLSL(alpha, beta, distance) {
  const value = 2 + distance ** 2 - 2 * Math.cos(alpha - beta) +
    2 * distance * (Math.sin(alpha) - Math.sin(beta));
  if (value < 0) return null;
  const temporary = Math.atan2(
    Math.cos(beta) - Math.cos(alpha),
    distance + Math.sin(alpha) - Math.sin(beta),
  );
  return createDubinsCandidate(
    "LSL",
    mod2pi(-alpha + temporary),
    Math.sqrt(value),
    mod2pi(beta - temporary),
  );
}

function dubinsRSR(alpha, beta, distance) {
  const value = 2 + distance ** 2 - 2 * Math.cos(alpha - beta) +
    2 * distance * (Math.sin(beta) - Math.sin(alpha));
  if (value < 0) return null;
  const temporary = Math.atan2(
    Math.cos(alpha) - Math.cos(beta),
    distance - Math.sin(alpha) + Math.sin(beta),
  );
  return createDubinsCandidate(
    "RSR",
    mod2pi(alpha - temporary),
    Math.sqrt(value),
    mod2pi(-beta + temporary),
  );
}

function dubinsLSR(alpha, beta, distance) {
  const value = -2 + distance ** 2 + 2 * Math.cos(alpha - beta) +
    2 * distance * (Math.sin(alpha) + Math.sin(beta));
  if (value < 0) return null;
  const middle = Math.sqrt(value);
  const temporary = Math.atan2(
    -Math.cos(alpha) - Math.cos(beta),
    distance + Math.sin(alpha) + Math.sin(beta),
  ) - Math.atan2(-2, middle);
  return createDubinsCandidate("LSR", mod2pi(-alpha + temporary), middle, mod2pi(-beta + temporary));
}

function dubinsRSL(alpha, beta, distance) {
  const value = distance ** 2 - 2 + 2 * Math.cos(alpha - beta) -
    2 * distance * (Math.sin(alpha) + Math.sin(beta));
  if (value < 0) return null;
  const middle = Math.sqrt(value);
  const temporary = Math.atan2(
    Math.cos(alpha) + Math.cos(beta),
    distance - Math.sin(alpha) - Math.sin(beta),
  ) - Math.atan2(2, middle);
  return createDubinsCandidate("RSL", mod2pi(alpha - temporary), middle, mod2pi(beta - temporary));
}

function dubinsRLR(alpha, beta, distance) {
  const temporary = (6 - distance ** 2 + 2 * Math.cos(alpha - beta) +
    2 * distance * (Math.sin(alpha) - Math.sin(beta))) / 8;
  if (Math.abs(temporary) > 1) return null;
  const middle = mod2pi(Math.PI * 2 - Math.acos(temporary));
  const first = mod2pi(
    alpha - Math.atan2(
      Math.cos(alpha) - Math.cos(beta),
      distance - Math.sin(alpha) + Math.sin(beta),
    ) + middle / 2,
  );
  return createDubinsCandidate("RLR", first, middle, mod2pi(alpha - beta - first + middle));
}

function dubinsLRL(alpha, beta, distance) {
  const temporary = (6 - distance ** 2 + 2 * Math.cos(alpha - beta) +
    2 * distance * (-Math.sin(alpha) + Math.sin(beta))) / 8;
  if (Math.abs(temporary) > 1) return null;
  const middle = mod2pi(Math.PI * 2 - Math.acos(temporary));
  const first = mod2pi(
    -alpha - Math.atan2(
      Math.cos(alpha) - Math.cos(beta),
      distance + Math.sin(alpha) - Math.sin(beta),
    ) + middle / 2,
  );
  return createDubinsCandidate("LRL", first, middle, mod2pi(beta - alpha - first + middle));
}

export function getRunwayTravelProgress(plane, runway, strip) {
  if (!plane || !runway || !strip) return 0;
  const axis = headingToVector(runway.heading);
  const startProjection = (runway.startX - strip.x) * axis.x + (runway.startY - strip.y) * axis.y;
  const planeProjection = (plane.x - strip.x) * axis.x + (plane.y - strip.y) * axis.y;
  const traveled = Math.max(0, planeProjection - startProjection);
  return Math.max(0, Math.min(1, traveled / Math.max(1, strip.length)));
}

export function canRotateForTakeoff(
  indicatedSpeed,
  runwayProgress,
  rotationSpeed = 140,
  minimumRunwayProgress = 0.52,
) {
  return (Number(indicatedSpeed) || 0) >= rotationSpeed &&
    (Number(runwayProgress) || 0) >= minimumRunwayProgress;
}

export function getAircraftStatusTag(plane) {
  if (!plane) return null;
  const runway = plane.runway || plane.landingRunway || "";

  if (plane.missedApproachActive) {
    return { text: runway ? `GA${runway}` : "GA", color: "#ff7ad9" };
  }

  switch (plane.state) {
    case "APPROACH":
      return plane.landingRunway
        ? { text: `RWY${plane.landingRunway}`, color: "#ffd166" }
        : { text: "APP", color: "#7ee7ff" };
    case "FINAL_APPROACH":
      return { text: runway ? `RWY${runway}` : "APP", color: "#ffd166" };
    case "LANDING":
      return { text: runway ? `LDG${runway}` : "LDG", color: "#ff9f43" };
    case "READY_FOR_TAKEOFF":
      return { text: runway ? `HOLD${runway}` : "HOLD", color: "#82aaff" };
    case "TAKEOFF":
      return { text: runway ? `DEP${runway}` : "DEP", color: "#7cff9b" };
    default:
      return null;
  }
}

export function getFinalApproachDistance(altitude) {
  const startAltitude = Math.max(0, Number(altitude) || 0);
  return Math.round(Math.min(420, 220 + Math.max(0, startAltitude - 3000) * 0.04));
}

export function getRequiredVerticalRate(
  currentAltitude,
  targetAltitude,
  distanceToTarget,
  movementSpeed,
  baseRate,
  maximumRate = 1800,
  timeScale = ALTITUDE_TIME_SCALE,
) {
  const current = Math.max(0, Number(currentAltitude) || 0);
  const target = Math.max(0, Number(targetAltitude) || 0);
  const minimumRate = Math.max(0, Number(baseRate) || 0);
  if (target >= current) return minimumRate;

  const pixelsPerSecond = Math.max(1, (Number(movementSpeed) || 0) * BASE_SIMULATION_FRAME_RATE);
  const secondsRemaining = Math.max(3, (Number(distanceToTarget) || 0) / pixelsPerSecond);
  const requiredRate = ((current - target) / secondsRemaining) * 60 / Math.max(1, Number(timeScale) || 1);
  const rateLimit = Math.max(minimumRate, Number(maximumRate) || minimumRate);
  return Math.min(rateLimit, Math.max(minimumRate, requiredRate));
}

export function getNextAltitude(currentAltitude, targetAltitude, rateFeetPerMinute, dt, timeScale = ALTITUDE_TIME_SCALE) {
  const current = Math.max(0, Number(currentAltitude) || 0);
  const target = Math.max(0, Number(targetAltitude) || 0);
  const difference = target - current;
  if (Math.abs(difference) < 1) return target;

  const rate = Math.max(0, Number(rateFeetPerMinute) || 0);
  const change = (rate / 60) * normalizeDeltaSeconds(dt) * Math.max(1, Number(timeScale) || 1);
  return Math.max(0, current + Math.sign(difference) * Math.min(Math.abs(difference), change));
}

export function getLandingRollTargetDistance() {
  return LANDING_ROLL_TARGET_DISTANCE;
}

export function updateLandingRollProgress(plane, movementDistance) {
  if (!plane) return 0;
  const targetDistance = plane.landingRollTargetDistance || getLandingRollTargetDistance();
  plane.landingRollTargetDistance = targetDistance;
  plane.landingRollDistance = (plane.landingRollDistance || 0) + Math.max(0, movementDistance || 0);
  return Math.max(0, Math.min(1, plane.landingRollDistance / targetDistance));
}

export function shouldRemoveLandedAircraft(runwayProgress) {
  return runwayProgress >= 2 / 3;
}

export function isAircraftConflict(distance, verticalDistance, rules) {
  const hardCollisionDistance = rules?.hardCollisionDistance ?? 22;
  const safetyDistance = rules?.safetyDistance ?? 50;
  const verticalSafetyDistance = rules?.verticalSafetyDistance ?? 1000;
  const hardCollisionVerticalDistance = rules?.hardCollisionVerticalDistance ?? 200;
  return (distance < hardCollisionDistance && verticalDistance < hardCollisionVerticalDistance) ||
    (distance < safetyDistance && verticalDistance < verticalSafetyDistance);
}

export function isPointInPolygon(x, y, points = []) {
  if (points.length < 3) return false;

  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const currentPoint = points[index];
    const previousPoint = points[previous];
    const intersects = ((currentPoint.y > y) !== (previousPoint.y > y)) &&
      (x < (previousPoint.x - currentPoint.x) * (y - currentPoint.y) /
        ((previousPoint.y - currentPoint.y) || 1) + currentPoint.x);
    if (intersects) inside = !inside;
  }

  return inside;
}
