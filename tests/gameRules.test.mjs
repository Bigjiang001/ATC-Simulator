import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AIRPORTS } from "../src/data/airports.js";
import {
  getFinalApproachDistance,
  getLandingRollTargetDistance,
  getMovementDistance,
  getNextAltitude,
  getNextValue,
  getRequiredVerticalRate,
  isAircraftConflict,
  isPointInPolygon,
  shouldRemoveLandedAircraft,
  updateLandingRollProgress,
} from "../src/utils/gameRules.js";

assert.deepEqual(
  AIRPORTS.map(airport => airport.restrictedAreas.length),
  [0, 1, 2],
  "airport restricted areas should increase in difficulty from 0 to 1 to 2",
);

for (const airport of AIRPORTS) {
  for (const beacon of airport.navBeacons) {
    for (const area of airport.restrictedAreas) {
      assert.equal(
        isPointInPolygon(beacon.x, beacon.y, area.points),
        false,
        `${airport.name} beacon ${beacon.id} must not be inside ${area.id}`,
      );
    }
  }

  for (const runway of airport.runways) {
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
  true,
  "radar targets that visually overlap must collide regardless of altitude",
);
assert.equal(
  isAircraftConflict(40, 500, { hardCollisionDistance: 22, safetyDistance: 50, verticalSafetyDistance: 1000 }),
  true,
  "horizontal and vertical separation loss must collide",
);
assert.equal(
  isAircraftConflict(40, 2000, { hardCollisionDistance: 22, safetyDistance: 50, verticalSafetyDistance: 1000 }),
  false,
  "close targets with enough vertical separation should not collide unless visually overlapping",
);

const appSource = readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
assert.equal(
  /canTouchDown|touchdownAltitudeLimit|rejectUnstableTouchdown/.test(appSource),
  false,
  "runway-threshold touchdown must not be blocked by an altitude gate",
);
assert.equal(
  (appSource.match(/this\.beginLandingRoll\(/g) || []).length,
  2,
  "both touchdown paths must use the same landing transition",
);
assert.equal(
  /gameLoopId\s*=\s*setInterval|setTimeout\(\(\) => this\.updateFlights/.test(appSource),
  false,
  "the simulation must have only one update clock",
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
for (const label of ["0.5x", "1x", "1.5x", "2x"]) {
  assert.match(appSource, new RegExp(`>${label.replace(".", "\\.")}<`), `speed control must expose ${label}`);
}
assert.match(
  appSource,
  /plane\.state === "TAKEOFF" && \(plane\.indicatedSpeed \|\| 0\) < this\.takeoffRotationSpeed/,
  "takeoff aircraft must accelerate through a ground roll before climbing",
);
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
