const FEMALE_VOICE_PREFERENCES = [
  "Google US English",
  "Samantha",
  "Microsoft Zira",
  "Ava",
  "Victoria",
  "Karen",
  "Moira",
  "Tessa",
  "Kathy",
  "Flo",
  "Sandy",
  "Shelley",
  "Fiona",
  "Susan",
  "Serena",
  "Veena",
];

const FEMALE_VOICE_NAME = /female|samantha|zira|ava|victoria|karen|moira|tessa|kathy|flo|sandy|shelley|fiona|susan|serena|veena/i;

export function selectOriginalYoungSpeechVoice(voices = []) {
  return Array.from(voices || []).find(voice => voice.name?.includes("Google US English")) || null;
}

export function selectFemaleSpeechVoice(voices = []) {
  const availableVoices = Array.from(voices || []);

  for (const preferredName of FEMALE_VOICE_PREFERENCES) {
    const voice = availableVoices.find(item => item.name?.includes(preferredName));
    if (voice) return voice;
  }

  const englishFemaleVoice = availableVoices.find(voice =>
    voice.lang?.toLowerCase().startsWith("en-") && FEMALE_VOICE_NAME.test(voice.name || ""),
  );
  if (englishFemaleVoice) return englishFemaleVoice;

  return null;
}

export function selectPreferredSpeechVoice(voices = []) {
  const availableVoices = Array.from(voices || []);
  const femaleVoice = selectFemaleSpeechVoice(availableVoices);
  if (femaleVoice) return femaleVoice;

  return availableVoices.find(voice => voice.lang?.toLowerCase().startsWith("en-us"))
    || availableVoices.find(voice => voice.lang?.toLowerCase().startsWith("en-"))
    || availableVoices[0]
    || null;
}
