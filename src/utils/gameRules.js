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
  return distance < hardCollisionDistance || (distance < safetyDistance && verticalDistance < verticalSafetyDistance);
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
