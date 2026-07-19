import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AIRPORTS } from "../src/data/airports.js";
import {
  buildSmoothApproachTrajectory,
  canRotateForTakeoff,
  getFinalApproachDistance,
  getAircraftStatusTag,
  getCoarsePointerHitRadius,
  getApproachPoseAtDistance,
  getLandingRollTargetDistance,
  getMovementDistance,
  getNextAltitude,
  getNextValue,
  getRequiredVerticalRate,
  getScaledCanvasPoint,
  getRunwayTravelProgress,
  getSmallestHeadingDifference,
  headingToVector,
  isAircraftConflict,
  isPointInPolygon,
  shouldRemoveLandedAircraft,
  updateLandingRollProgress,
  vectorToHeading,
} from "../src/utils/gameRules.js";

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a, b, c, d) {
  const epsilon = 0.0001;
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < -epsilon && cdA * cdB < -epsilon;
}

function segmentIntersectsPolygon(start, end, polygon) {
  if (isPointInPolygon(start.x, start.y, polygon) || isPointInPolygon(end.x, end.y, polygon)) {
    return true;
  }
  return polygon.some((point, index) =>
    segmentsIntersect(start, end, point, polygon[(index + 1) % polygon.length]),
  );
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
  ));
  return Math.hypot(
    point.x - (start.x + projection * dx),
    point.y - (start.y + projection * dy),
  );
}

function segmentDistance(firstStart, firstEnd, secondStart, secondEnd) {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return 0;
  return Math.min(
    pointToSegmentDistance(firstStart, secondStart, secondEnd),
    pointToSegmentDistance(firstEnd, secondStart, secondEnd),
    pointToSegmentDistance(secondStart, firstStart, firstEnd),
    pointToSegmentDistance(secondEnd, firstStart, firstEnd),
  );
}

assert.deepEqual(
  getScaledCanvasPoint(190, 140, { left: 10, top: 20, width: 360, height: 240 }, 1800, 1200),
  { x: 900, y: 600, scaleX: 5, scaleY: 5 },
  "touch coordinates must map from the responsive canvas back into radar coordinates",
);
assert.equal(getCoarsePointerHitRadius(1, 1), 40, "tablet targets must have a larger touch radius");
assert.equal(getCoarsePointerHitRadius(2, 2), 44, "touch radius must follow canvas scaling");
assert.equal(getCoarsePointerHitRadius(6, 6), 110, "phone touch radius must remain capped");

assert.deepEqual(getAircraftStatusTag({ state: "APPROACH" }), { text: "APP", color: "#7ee7ff" });
assert.deepEqual(
  getAircraftStatusTag({ state: "FINAL_APPROACH", landingRunway: "27" }),
  { text: "RWY27", color: "#ffd166" },
);
assert.deepEqual(
  getAircraftStatusTag({ state: "TAKEOFF", runway: "09" }),
  { text: "DEP09", color: "#7cff9b" },
);
assert.deepEqual(
  getAircraftStatusTag({ state: "LANDING", runway: "18R" }),
  { text: "LDG18R", color: "#ff9f43" },
);
assert.deepEqual(
  getAircraftStatusTag({ state: "READY_FOR_TAKEOFF", runway: "36L" }),
  { text: "HOLD36L", color: "#82aaff" },
);

assert.deepEqual(
  AIRPORTS.map(airport => airport.restrictedAreas.length),
  [0, 1, 2],
  "airport restricted areas should increase in difficulty from 0 to 1 to 2",
);
assert.deepEqual(
  AIRPORTS.map(airport => airport.navBeacons.length),
  [3, 3, 3],
  "each radar sector should expose exactly three handoff points",
);

for (const airport of AIRPORTS) {
  assert.match(airport.subtitle, /RWY/, `${airport.name} subtitle must identify its runway layout`);

  const beaconIds = new Set();
  for (const beacon of airport.navBeacons) {
    assert.match(beacon.id, /^[A-Z]{3}$/, `${airport.name} navigation identifiers must use three letters`);
    assert.equal(beaconIds.has(beacon.id), false, `${airport.name} navigation identifiers must be unique`);
    beaconIds.add(beacon.id);
    for (const area of airport.restrictedAreas) {
      assert.equal(
        isPointInPolygon(beacon.x, beacon.y, area.points),
        false,
        `${airport.name} beacon ${beacon.id} must not be inside ${area.id}`,
      );
    }
  }

  for (const procedure of airport.departureProcedures) {
    const exitBeacon = airport.navBeacons.find(beacon => beacon.id === procedure.via);
    assert.ok(exitBeacon, `${airport.name} ${procedure.id} must reference a displayed navigation fix`);
    const departureRunways = airport.runways.filter(runway => runway.id.startsWith(procedure.runwayPrefix));
    assert.equal(
      departureRunways.length,
      1,
      `${airport.name} ${procedure.id} must belong to one unambiguous runway direction`,
    );
    const departureRunway = departureRunways[0];
    const departureStrip = airport.physicalRunways.find(strip => strip.id === departureRunway.strip);
    const initialPoint = procedure.points[0];
    const runwayExtensionPoint = procedure.points[1];
    const runwayVector = headingToVector(departureRunway.heading);
    const initialLeg = {
      x: runwayExtensionPoint.x - initialPoint.x,
      y: runwayExtensionPoint.y - initialPoint.y,
    };
    const alongRunway = initialLeg.x * runwayVector.x + initialLeg.y * runwayVector.y;
    const acrossRunway = Math.abs(initialLeg.x * runwayVector.y - initialLeg.y * runwayVector.x);
    assert.deepEqual(
      initialPoint,
      { x: departureRunway.startX, y: departureRunway.startY },
      `${airport.name} ${procedure.id} must start at its runway threshold`,
    );
    assert.ok(
      alongRunway >= departureStrip.length + 80,
      `${airport.name} ${procedure.id} must continue beyond the departure end before turning`,
    );
    assert.ok(
      acrossRunway < 2,
      `${airport.name} ${procedure.id} initial leg must remain on runway heading`,
    );
    const lastPoint = procedure.points.at(-1);
    assert.deepEqual(
      lastPoint,
      { x: exitBeacon.x, y: exitBeacon.y },
      `${airport.name} ${procedure.id} must terminate at ${procedure.via}`,
    );

    for (let pointIndex = 1; pointIndex < procedure.points.length; pointIndex++) {
      for (const area of airport.restrictedAreas.filter(item => item.active)) {
        assert.equal(
          segmentIntersectsPolygon(procedure.points[pointIndex - 1], procedure.points[pointIndex], area.points),
          false,
          `${airport.name} ${procedure.id} must remain clear of ${area.id}`,
        );
      }
    }
  }

  for (let firstIndex = 0; firstIndex < airport.departureProcedures.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < airport.departureProcedures.length; secondIndex++) {
      const firstProcedure = airport.departureProcedures[firstIndex];
      const secondProcedure = airport.departureProcedures[secondIndex];
      for (let firstLeg = 2; firstLeg < firstProcedure.points.length; firstLeg++) {
        for (let secondLeg = 2; secondLeg < secondProcedure.points.length; secondLeg++) {
          const sharedExitConvergence = firstProcedure.via === secondProcedure.via
            && (
              firstLeg === firstProcedure.points.length - 1
              || secondLeg === secondProcedure.points.length - 1
            );
          assert.equal(
            segmentsIntersect(
              firstProcedure.points[firstLeg - 1],
              firstProcedure.points[firstLeg],
              secondProcedure.points[secondLeg - 1],
              secondProcedure.points[secondLeg],
            ),
            false,
            `${airport.name} ${firstProcedure.id} and ${secondProcedure.id} must not cross after runway departure`,
          );
          if (!sharedExitConvergence) assert.ok(
            segmentDistance(
              firstProcedure.points[firstLeg - 1],
              firstProcedure.points[firstLeg],
              secondProcedure.points[secondLeg - 1],
              secondProcedure.points[secondLeg],
            ) >= 100,
            `${airport.name} ${firstProcedure.id} and ${secondProcedure.id} must keep separated exit corridors`,
          );
        }
      }
    }
  }

  for (const runway of airport.runways) {
    const strip = airport.physicalRunways.find(item => item.id === runway.strip);
    const runwayVector = headingToVector(runway.heading);
    const stripVector = headingToVector(strip.heading);
    const thresholdOffset = {
      x: runway.startX - strip.x,
      y: runway.startY - strip.y,
    };
    const centerlineOffset = Math.abs(
      thresholdOffset.x * stripVector.y - thresholdOffset.y * stripVector.x,
    );
    assert.ok(
      centerlineOffset < 1,
      `${airport.name} runway ${runway.id} threshold must lie on the drawn runway centerline`,
    );
    const approachTrajectory = buildSmoothApproachTrajectory({
      startX: airport.center.x + 320,
      startY: airport.center.y - 260,
      startHeading: (runway.heading + 90) % 360,
      runwayX: runway.startX,
      runwayY: runway.startY,
      finalHeading: runway.heading,
      finalApproachDistance: 220,
    });
    const finalGateOffset = {
      x: approachTrajectory.finalApproachPoint.x - strip.x,
      y: approachTrajectory.finalApproachPoint.y - strip.y,
    };
    const trajectoryCenterlineOffset = Math.abs(
      finalGateOffset.x * stripVector.y - finalGateOffset.y * stripVector.x,
    );
    assert.ok(
      trajectoryCenterlineOffset < 1,
      `${airport.name} runway ${runway.id} predicted approach must align with the drawn runway`,
    );
    const pointAtProgress = progress => ({
      x: runway.startX + runwayVector.x * strip.length * progress,
      y: runway.startY + runwayVector.y * strip.length * progress,
    });

    assert.equal(getRunwayTravelProgress(pointAtProgress(0), runway, strip), 0);
    assert.ok(Math.abs(getRunwayTravelProgress(pointAtProgress(0.5), runway, strip) - 0.5) < 0.0001);
    assert.ok(Math.abs(getRunwayTravelProgress(pointAtProgress(1), runway, strip) - 1) < 0.0001);
    assert.equal(canRotateForTakeoff(140, 0.51), false, `${airport.name} ${runway.id} must roll past halfway`);
    assert.equal(canRotateForTakeoff(139, 0.52), false, `${airport.name} ${runway.id} must reach rotation speed`);
    assert.equal(canRotateForTakeoff(140, 0.52), true, `${airport.name} ${runway.id} can rotate after both gates`);

    for (const frameRate of [30, 60, 120]) {
      const plane = {
        id: `TEST-${airport.id}-${runway.id}-${frameRate}`,
        speed: 0.2,
        originalSpeed: 0.2,
        landingRollDistance: 0,
        landingRollTargetDistance: getLandingRollTargetDistance(),
      };

      let progress = 0;
      for (let frame = 0; frame < frameRate * 40 && !shouldRemoveLandedAircraft(progress); frame++) {
        const movement = getMovementDistance(plane.speed, 1 / frameRate);
        progress = updateLandingRollProgress(plane, movement);
        plane.speed = plane.originalSpeed * (1 - progress * progress);
      }

      assert.equal(
        shouldRemoveLandedAircraft(progress),
        true,
        `${airport.name} runway ${runway.id} should remove landed aircraft at ${frameRate}fps`,
      );
    }
  }

  for (const strip of airport.physicalRunways) {
    const stripRunways = airport.runways.filter(runway => runway.strip === strip.id);
    assert.equal(stripRunways.length, 2, `${airport.name} ${strip.id} must have two runway directions`);
    const stripAxis = headingToVector(strip.heading);
    const plusEnd = {
      x: strip.x + stripAxis.x * strip.length / 2,
      y: strip.y + stripAxis.y * strip.length / 2,
    };
    const minusEnd = {
      x: strip.x - stripAxis.x * strip.length / 2,
      y: strip.y - stripAxis.y * strip.length / 2,
    };
    const nearestRunwayId = point => stripRunways.reduce((nearest, runway) => {
      const distance = Math.hypot(runway.startX - point.x, runway.startY - point.y);
      return !nearest || distance < nearest.distance ? { id: runway.id, distance } : nearest;
    }, null).id;

    assert.equal(
      strip.labels.start,
      nearestRunwayId(plusEnd),
      `${airport.name} ${strip.id} plus-end label must match the takeoff and landing direction`,
    );
    assert.equal(
      strip.labels.end,
      nearestRunwayId(minusEnd),
      `${airport.name} ${strip.id} minus-end label must match the takeoff and landing direction`,
    );
  }
}

const approachScenarios = [
  { startX: 100, startY: 600, startHeading: 90, runwayX: 830, runwayY: 430, finalHeading: 180 },
  { startX: 830, startY: 200, startHeading: 0, runwayX: 830, runwayY: 430, finalHeading: 180 },
  { startX: 1200, startY: 900, startHeading: 310, runwayX: 761, runwayY: 469, finalHeading: 130 },
  { startX: 650, startY: 300, startHeading: 180, runwayX: 650, runwayY: 600, finalHeading: 90 },
];

for (const scenario of approachScenarios) {
  const trajectory = buildSmoothApproachTrajectory({ ...scenario, finalApproachDistance: 220 });
  const startPose = getApproachPoseAtDistance(trajectory, 0);
  const endPose = getApproachPoseAtDistance(trajectory, trajectory.curveLength);
  assert.ok(
    getSmallestHeadingDifference(vectorToHeading(startPose.tangent), scenario.startHeading) < 0.001,
    "approach must begin on the aircraft's current heading",
  );
  assert.ok(
    getSmallestHeadingDifference(vectorToHeading(endPose.tangent), scenario.finalHeading) < 0.001,
    "approach must intercept final on the runway heading",
  );
  assert.ok(
    Math.hypot(
      endPose.point.x - trajectory.finalApproachPoint.x,
      endPose.point.y - trajectory.finalApproachPoint.y,
    ) < 0.001,
    "approach path must end exactly at the stabilized final gate",
  );

  let previousHeading = scenario.startHeading;
  for (let distance = 0.2; distance <= trajectory.curveLength; distance += 0.2) {
    const pose = getApproachPoseAtDistance(trajectory, distance);
    const heading = vectorToHeading(pose.tangent);
    assert.ok(
      getSmallestHeadingDifference(previousHeading, heading) < 0.2,
      "approach heading must change continuously without a pivot turn",
    );
    previousHeading = heading;
  }
}

const distances = [30, 60, 120].map(frameRate => {
  let distance = 0;
  for (let frame = 0; frame < frameRate * 10; frame++) {
    distance += getMovementDistance(0.2, 1 / frameRate);
  }
  return distance;
});
assert.ok(Math.max(...distances) - Math.min(...distances) < 0.001, "movement must be frame-rate independent");

let climbAltitude = getNextAltitude(0, 3000, 1500, 1 / 60);
assert.ok(climbAltitude > 0 && climbAltitude < 3000, "takeoff and go-around climb must start gradually");
for (let frame = 1; frame < 60 * 40; frame++) {
  climbAltitude = getNextAltitude(climbAltitude, 3000, 1500, 1 / 60);
}
assert.equal(climbAltitude, 3000, "go-around must reach the missed-approach altitude");

let approachAltitude = 5000;
for (let frame = 0; frame < 60 * 65; frame++) {
  approachAltitude = getNextAltitude(approachAltitude, 1200, 1000, 1 / 60);
}
assert.equal(approachAltitude, 1200, "initial approach must descend to the final approach gate");
for (let frame = 0; frame < 60 * 25; frame++) {
  approachAltitude = getNextAltitude(approachAltitude, 50, 800, 1 / 60);
}
assert.equal(approachAltitude, 50, "final approach must reach threshold-crossing altitude without a jump");

const smoothedSpeeds = [30, 60, 120].map(frameRate => {
  let speed = 0.12;
  for (let frame = 0; frame < frameRate; frame++) {
    speed = getNextValue(speed, 0.2, 0.05, 1 / frameRate);
  }
  return speed;
});
assert.ok(
  Math.max(...smoothedSpeeds) - Math.min(...smoothedSpeeds) < 0.0001,
  "aircraft acceleration must be frame-rate independent",
);
assert.ok(smoothedSpeeds[0] > 0.12 && smoothedSpeeds[0] < 0.2, "aircraft speed must converge without a jump");

assert.equal(getFinalApproachDistance(3000), 220, "standard approaches should keep the baseline final length");
assert.equal(getFinalApproachDistance(9000), 420, "high approaches should receive a longer stabilized final");
const requiredFinalRate = getRequiredVerticalRate(1200, 50, 220, 0.2, 800);
assert.ok(requiredFinalRate > 800 && requiredFinalRate <= 1800, "final descent rate should adapt to runway distance");

assert.equal(
  isAircraftConflict(10, 5000, { hardCollisionDistance: 22, safetyDistance: 50, verticalSafetyDistance: 1000 }),
  false,
  "overlapping radar targets with ample vertical separation must remain safely separated",
);
assert.equal(
  isAircraftConflict(10, 100, { hardCollisionDistance: 22, safetyDistance: 50, verticalSafetyDistance: 1000 }),
  true,
  "overlapping radar targets at nearly the same altitude must collide",
);
assert.equal(
  isAircraftConflict(40, 500, { hardCollisionDistance: 22, safetyDistance: 50, verticalSafetyDistance: 1000 }),
  true,
  "horizontal and vertical separation loss must collide",
);
assert.equal(
  isAircraftConflict(40, 2000, { hardCollisionDistance: 22, safetyDistance: 50, verticalSafetyDistance: 1000 }),
  false,
  "close targets with enough vertical separation should not collide",
);

const appSource = readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
for (const pointerBinding of ["@pointerdown", "@pointermove", "@pointerup", "@pointercancel"]) {
  assert.match(appSource, new RegExp(pointerBinding), `radar canvas must expose ${pointerBinding}`);
}
assert.match(appSource, /@pointerdown="startTalkPointer"/, "mobile push-to-talk must accept touch input");
assert.match(appSource, /schedulePendingVoiceCommand\(this\.isTouchDevice \? 350 : 0\)/, "mobile ATC replies must wait for the microphone audio route to close");
assert.match(appSource, /touch-action:\s*none/, "touch dragging over the radar must not scroll the page");
assert.match(appSource, /aspect-ratio:\s*3\s*\/\s*2/, "responsive radar must preserve its map proportions");
assert.match(appSource, /@media \(max-width:\s*980px\)/, "tablet and phone controls must use a compact layout");
assert.match(appSource, /@media \(pointer:\s*coarse\)/, "touch devices must receive larger controls");
assert.match(appSource, /'touch-ui': isTouchDevice/, "iPad layouts must activate from touch capability, not width alone");
assert.match(appSource, /v-if="settingsOpen" class="settings-panel"/, "advanced controls must stay hidden inside the settings menu by default");
assert.match(appSource, /class="settings-toggle"/, "compact layouts must expose a settings button");
assert.match(appSource, /<span>Radar sector<\/span>/, "the map selector must identify radar sectors rather than airports");
assert.match(appSource, /case 'start': return 'Ready'/, "the initial radar status must display Ready rather than Unknown");
assert.equal(
  /\$\{procedure\.id\} VIA \$\{procedure\.via\}/.test(appSource),
  false,
  "departure labels must not repeat the same navigation identifier",
);
assert.match(
  appSource,
  /#app\.touch-ui \.game-controls[\s\S]*grid-template-columns/,
  "touch iPad controls must use a dedicated grid layout",
);
const gameHtmlSource = readFileSync(new URL("../game.html", import.meta.url), "utf8");
assert.match(gameHtmlSource, /viewport-fit=cover/, "mobile app webviews must respect device safe areas");
assert.equal(
  /canTouchDown|touchdownAltitudeLimit|rejectUnstableTouchdown/.test(appSource),
  false,
  "runway-threshold touchdown must not be blocked by an altitude gate",
);
assert.ok(
  (appSource.match(/this\.beginLandingRoll\(/g) || []).length >= 2,
  "both touchdown paths must use the same landing transition",
);
assert.equal(
  /gameLoopId\s*=\s*setInterval|setTimeout\(\(\) => this\.updateFlights/.test(appSource),
  false,
  "the simulation must have only one update clock",
);
assert.equal(
  /updateFlights执行时间过长[\s\S]*break;/.test(appSource),
  false,
  "slow frames must not starve aircraft later in the update list",
);
assert.equal(
  /const countdownInterval\s*=\s*setInterval/.test(appSource),
  false,
  "incoming countdowns must use the paused simulation clock",
);
assert.match(
  appSource,
  /this\.updateIncomingAircraft\(simulationDt\)/,
  "the render loop must advance incoming traffic only while running",
);
assert.match(
  appSource,
  /this\.advanceSimulationClock\(simulationDt\)/,
  "traffic progression must use the same simulation clock as aircraft movement",
);
assert.match(
  appSource,
  /this\.currentSpawnInterval \/ this\.speedLevel/,
  "traffic spawning must follow the selected simulation speed",
);
assert.match(
  appSource,
  /plane\.groundWaitElapsedMs[\s\S]*Number\(dt\)/,
  "ground delay limits must follow simulated time instead of wall-clock time",
);
assert.match(
  appSource,
  /this\.airplanes\.length \+ this\.incomingAircraft\.length >= this\.dynamicMaxAircraftCount/,
  "pending arrivals must count toward the traffic limit",
);
assert.match(appSource, /generateUniqueFlightId\(\)/, "active and pending flights must receive unique callsigns");
assert.match(appSource, /flightType:\s*["']ARRIVAL["']/, "arrival traffic should retain its operational type");
assert.match(appSource, /flightType:\s*["']DEPARTURE["']/, "departure traffic should retain its operational type");
assert.match(appSource, /plane\.flightType\s*!==\s*["']DEPARTURE["']/, "arrival traffic must not accept departure procedures");
assert.match(appSource, /handoff points are available to departure traffic only/, "arrival traffic must not be handed off at departure fixes");
assert.match(appSource, /plane\.flightType\s*===\s*["']DEPARTURE["']\s*&&\s*plane\.targetBeaconId/, "handoff scoring should be restricted to departures");
assert.match(
  appSource,
  /setupTakeoffTestScenario\(\)[\s\S]*this\.processTakeoffCommand\(plane\.id, `takeoff runway \$\{runway\.id\}`\)/,
  "the takeoff regression scenario must exercise the real command path",
);
const takeoffCommandStart = appSource.indexOf("processTakeoffCommand(planeId, command)");
const takeoffCommandEnd = appSource.indexOf("assignApproachPath(plane, runway, entrance)", takeoffCommandStart);
const takeoffCommandSource = appSource.slice(takeoffCommandStart, takeoffCommandEnd);
assert.match(
  takeoffCommandSource,
  /plane\.state !== "READY_FOR_TAKEOFF"/,
  "takeoff clearances must not teleport airborne aircraft to a runway",
);
assert.match(
  takeoffCommandSource,
  /this\.initializeTakeoffRoll\(plane, runway\.id\)/,
  "one complete takeoff clearance must begin the takeoff roll",
);
assert.match(
  takeoffCommandSource,
  /this\.getRunwayOccupyingAircraft\(runway\.id, plane\)/,
  "takeoff clearance must check runway occupancy",
);
assert.match(
  appSource,
  /this\.getRunwayOccupyingAircraft\(runwayInfo\.id, plane\)/,
  "touch takeoff clearance must also check runway occupancy",
);
assert.match(
  appSource,
  /go around, runway occupied by/,
  "an arrival must go around when the runway remains occupied at the threshold",
);
assert.match(
  appSource,
  /\["APPROACH", "FLYING", "FINAL_APPROACH"\]\.includes\(plane\.state\)/,
  "repeating a touch landing clearance on final must stay in the landing flow",
);
assert.match(
  appSource,
  /continueExistingApproach\(plane, runwayId\)[\s\S]*continue approach runway/,
  "repeated landing clearances must preserve an established approach",
);
assert.match(
  appSource,
  /plane\.landingDirection = this\.getRunwayHeading\(landingRunway\);\s*plane\.missedApproachActive = false;/,
  "touchdown must clear any stale missed-approach indication",
);
assert.match(
  appSource,
  /setupRunwayCollisionTestScenario\(\)[\s\S]*state: "TAKEOFF"[\s\S]*state: "LANDING"/,
  "runway takeoff and landing collisions must remain covered by regression testing",
);
assert.match(
  appSource,
  /doRunwaysConflict\(firstRunwayId, secondRunwayId\)/,
  "runway occupancy must cover reciprocal and crossing runway operations",
);
assert.match(
  appSource,
  /isApproachEntryPathClear\(candidate\)/,
  "new arrivals must receive a protected entry path clear of restricted areas",
);
assert.match(
  appSource,
  /plane\.heading = runway\.heading;\s*plane\.targetHeading = runway\.heading;/,
  "departures must retain runway heading after the initial climb",
);
assert.match(
  appSource,
  /plane\.targetAltitude = profileAltitude;/,
  "approach profile must support both climb and descent after a go-around",
);
assert.match(
  appSource,
  /ctx\.fillText\(plane\.id,[\s\S]*ctx\.fillText\(`A\$\{altitudeHundreds\}[\s\S]*S\$\{airspeed\}[\s\S]*H\$\{currentHdg/,
  "radar label must remain a two-row current altitude, speed, and heading display",
);
assert.match(appSource, /Math\.round\(plane\.indicatedSpeed \|\| 0\)/, "radar speed must use aircraft airspeed");
assert.equal(
  /const airspeed\s*=.*plane\.speed/.test(appSource),
  false,
  "simulation speed multiplier must not be displayed as aircraft speed",
);
assert.equal(
  /plane\.speed\s*=.*speedLevel|speed:\s*[^,\n]*speedLevel|speedLevel\(\)\s*\{/.test(appSource),
  false,
  "simulation speed must never overwrite aircraft physical speed",
);
assert.match(appSource, /setSpeedLevel\(level\)/, "simulation speed must use explicit fixed levels");
assert.match(appSource, /processSpeedCommand\(planeId, speed\)/, "controllers must be able to assign aircraft speed");
assert.match(appSource, /plane\.targetIndicatedSpeed = assignedSpeed/, "speed instructions must change airspeed gradually");
assert.match(appSource, /plane\.assignedSpeed[\s\S]*automaticFinalAirspeed/, "assigned approach speeds must integrate with final approach deceleration");
for (const label of ["0.5x", "1x", "1.5x", "2x"]) {
  assert.match(appSource, new RegExp(`>${label.replace(".", "\\.")}<`), `speed control must expose ${label}`);
}
assert.match(appSource, /canRotateForTakeoff\(/, "takeoff must use the shared speed and runway-distance gate");
assert.match(
  appSource,
  /takeoffMinimumRunwayProgress:\s*0\.52/,
  "takeoff aircraft must roll through roughly half the runway before climbing",
);
assert.match(appSource, /departureTurnAltitude:\s*400/, "departures must hold runway heading during initial climb");
assert.match(appSource, /getApproachPoseAtDistance\(/, "approach movement must follow the drawn trajectory by distance");
assert.equal(
  /path\.originalSpeed \|\| plane\.speed \|\| 0\.5/.test(appSource),
  false,
  "approach fallback movement must not use an excessive emergency speed",
);

const stopVoiceStart = appSource.indexOf("stopVoiceCommand() {");
const stopVoiceEnd = appSource.indexOf("processVoiceCommand(command)", stopVoiceStart);
const stopVoiceSource = appSource.slice(stopVoiceStart, stopVoiceEnd);
assert.ok(
  stopVoiceSource.indexOf("this.flushPendingVoiceCommand()") < stopVoiceSource.indexOf("this.recognition.stop()"),
  "releasing Shift must submit visible recognized text before stopping recognition",
);

console.log("gameRules: maps, flight dynamics, landing, collision, labels, and PTT rules passed");
