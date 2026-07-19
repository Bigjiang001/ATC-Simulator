import assert from "node:assert/strict";
import { selectFemaleSpeechVoice, selectOriginalYoungSpeechVoice, selectPreferredSpeechVoice } from "../src/utils/speechVoice.js";

const voices = [
  { name: "Alex", lang: "en-US" },
  { name: "Daniel", lang: "en-GB" },
  { name: "Samantha", lang: "en-US" },
  { name: "Google US English", lang: "en-US" },
  { name: "Microsoft Zira - English (United States)", lang: "en-US" },
];

assert.equal(selectFemaleSpeechVoice(voices)?.name, "Google US English", "the original young Google voice should be primary");
assert.equal(selectOriginalYoungSpeechVoice(voices)?.name, "Google US English", "the loader should wait for the original young voice");
assert.equal(selectPreferredSpeechVoice(voices)?.name, "Google US English", "male default voices must not outrank the young female voice");
assert.equal(
  selectPreferredSpeechVoice([{ name: "Fallback English", lang: "en-US" }])?.name,
  "Fallback English",
  "an English fallback should remain available when no named female voice is installed",
);
assert.equal(selectPreferredSpeechVoice([]), null, "an unloaded browser voice list should not select a default voice");

console.log("speechVoice: female voice priority and fallback rules passed");
