import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { getLocalSpeechSegments, LOCAL_SPEECH_ASSET_KEYS } from "../src/utils/localSpeech.js";

assert.deepEqual(
  getLocalSpeechSegments("Bravo niner zero zero one turn right heading one eight zero"),
  ["bravo", "niner", "zero", "zero", "one", "turn_right_heading", "one", "eight", "zero"],
  "heading replies should use a natural phrase plus aviation digits",
);
assert.ok(LOCAL_SPEECH_ASSET_KEYS.length >= 70, "the bundled voice must cover ATC vocabulary and NATO spelling");
for (const key of LOCAL_SPEECH_ASSET_KEYS) {
  const assetUrl = new URL(`../public/speech/${key}.m4a`, import.meta.url);
  assert.equal(existsSync(assetUrl), true, `local speech asset ${key} must exist`);
  assert.ok(statSync(assetUrl).size > 1000, `local speech asset ${key} must contain audible data`);
}
assert.deepEqual(
  getLocalSpeechSegments("B1234 cleared to land runway one eight left"),
  ["bravo", "one", "two", "tree", "four", "cleared_to_land_runway", "one", "eight", "left"],
  "callsigns and landing clearances should be fully covered",
);
assert.deepEqual(
  getLocalSpeechSegments("B1234 proceed direct NAV1"),
  ["bravo", "one", "two", "tree", "four", "proceed_direct", "november", "alpha", "victor", "one"],
  "unknown beacon identifiers should be spoken with NATO spelling",
);
for (const message of [
  "B1234 cleared for takeoff runway three six right",
  "B1234 go around climb five zero zero zero",
  "B1234 descend altitude two zero zero zero",
  "Collision alert collision alert",
  "Ground delay timeout",
  "Airspace violation",
]) {
  assert.ok(getLocalSpeechSegments(message).length > 0, `${message} must produce local speech`);
}

console.log("localSpeech: ATC phrase and identifier segmentation passed");
