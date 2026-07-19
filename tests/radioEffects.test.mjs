import assert from "node:assert/strict";
import {
  getLocalSpeechSegmentAdvance,
  radioEffects,
} from "../src/sounds/radio_effects.js";

let cancelCalls = 0;
let spokenUtterance = null;
let noiseCalls = 0;

class MockUtterance {
  constructor(text) {
    this.text = text;
  }
}

globalThis.SpeechSynthesisUtterance = MockUtterance;
globalThis.window = {
  speechSynthesis: {
    speaking: false,
    pending: false,
    paused: false,
    cancel() {
      cancelCalls += 1;
    },
    resume() {},
    speak(utterance) {
      spokenUtterance = utterance;
      utterance.onstart?.();
      utterance.onend?.();
    },
  },
};

radioEffects.initialized = true;
radioEffects.audioContext = { state: "running" };
radioEffects.addRadioNoise = () => {
  noiseCalls += 1;
  return null;
};

const playback = radioEffects.applyRadioEffectToSpeech("Cleared to land", {
  lang: "en-US",
  immediate: true,
});

assert.equal(spokenUtterance?.text, "Cleared to land", "mobile speech must start synchronously");
assert.equal(spokenUtterance?.lang, "en-US", "mobile speech must request an English voice");
assert.equal(spokenUtterance?.volume, 1, "mobile speech must use audible volume");
assert.equal(cancelCalls, 0, "the first idle mobile utterance must not be cancelled");
assert.equal(noiseCalls, 0, "mobile speech must not compete with WebAudio radio noise");
await playback;

window.speechSynthesis.speaking = true;
await radioEffects.applyRadioEffectToSpeech("Continue approach", { immediate: true });
assert.equal(cancelCalls, 0, "mobile speech must not cancel an active system voice queue");

const localSourceStartTimes = [];
const localRadioStartTimes = [];
globalThis.document = { baseURI: "http://localhost/ATC-Simulator/" };
globalThis.fetch = async () => ({
  ok: true,
  async arrayBuffer() {
    return new ArrayBuffer(8);
  },
});
radioEffects.localSpeechCache.clear();
radioEffects.activeSpeechSources = [];
radioEffects.audioContext = {
  state: "running",
  currentTime: 1,
  sampleRate: 1000,
  destination: {},
  decodeAudioData(data, resolve) {
    resolve({ duration: 0.5, kind: "speech" });
  },
  createBuffer(channels, frameCount, sampleRate) {
    return {
      duration: frameCount / sampleRate,
      kind: "radio",
      getChannelData() {
        return new Float32Array(frameCount);
      },
    };
  },
  createGain() {
    return {
      connect() {},
      gain: {
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
    };
  },
  createBiquadFilter() {
    return {
      type: "",
      frequency: { value: 0 },
      Q: { value: 0 },
      connect() {},
    };
  },
  createBufferSource() {
    const source = {
      connect() {},
      start(startTime) {
        if (source.buffer?.kind === "radio") localRadioStartTimes.push(startTime);
        if (source.buffer?.kind === "speech") localSourceStartTimes.push(startTime);
        queueMicrotask(() => source.onended?.());
      },
      stop() {},
    };
    return source;
  },
};
await radioEffects.playLocalSpeech("Bravo one turn right heading one eight zero");
assert.ok(localSourceStartTimes.length >= 6, "bundled mobile speech must schedule every ATC phrase segment");
assert.ok(
  Math.abs(getLocalSpeechSegmentAdvance(0.5) - 0.345) < 0.0001,
  "bundled speech must remove the generated trailing silence between clips",
);
assert.ok(
  Math.abs(localSourceStartTimes[1] - localSourceStartTimes[0] - 0.345) < 0.0001,
  "mobile ATC clips must be scheduled as one continuous transmission",
);
assert.equal(localRadioStartTimes.length, 2, "mobile ATC speech must include opening and closing radio static");
assert.ok(
  localRadioStartTimes[0] < localSourceStartTimes[0] && localRadioStartTimes[1] > localSourceStartTimes.at(-1),
  "radio static must frame the speech instead of masking it",
);
assert.equal(noiseCalls, 0, "mobile speech must not use the legacy noise processor over the voice");

console.log("radioEffects: immediate mobile speech playback passed");
