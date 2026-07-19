const DIGIT_WORDS = ["zero", "one", "two", "tree", "four", "five", "six", "seven", "eight", "niner"];

const NATO_WORDS = {
  a: "alpha", b: "bravo", c: "charlie", d: "delta", e: "echo", f: "foxtrot",
  g: "golf", h: "hotel", i: "india", j: "juliett", k: "kilo", l: "lima",
  m: "mike", n: "november", o: "oscar", p: "papa", q: "quebec", r: "romeo",
  s: "sierra", t: "tango", u: "uniform", v: "victor", w: "whiskey",
  x: "xray", y: "yankee", z: "zulu",
};

const SPOKEN_WORDS = new Set([
  ...DIGIT_WORDS,
  ...Object.values(NATO_WORDS),
  "has", "reached", "direct", "complete", "completed", "exiting", "radar", "coverage",
  "cleared", "for", "takeoff", "runway", "to", "land", "turn", "left", "right", "heading",
  "proceed", "via", "go", "around", "climb", "descend", "maintain", "altitude",
  "collision", "alert", "contact", "lost", "ground", "delay", "timeout", "airspace", "violation",
]);

const PHRASES = [
  ["cleared for takeoff runway", "cleared_for_takeoff_runway"],
  ["cleared to land runway", "cleared_to_land_runway"],
  ["exiting radar coverage", "exiting_radar_coverage"],
  ["turn right heading", "turn_right_heading"],
  ["turn left heading", "turn_left_heading"],
  ["maintain altitude", "maintain_altitude"],
  ["descend altitude", "descend_altitude"],
  ["climb altitude", "climb_altitude"],
  ["collision alert", "collision_alert"],
  ["ground delay timeout", "ground_delay_timeout"],
  ["airspace violation", "airspace_violation"],
  ["radar contact lost", "radar_contact_lost"],
  ["proceed direct", "proceed_direct"],
  ["direct complete", "direct_complete"],
  ["cleared via", "cleared_via"],
  ["go around climb", "go_around_climb"],
  ["has reached", "has_reached"],
].map(([phrase, key]) => ({ words: phrase.split(" "), key }));

export const LOCAL_SPEECH_ASSET_KEYS = [
  ...new Set([...SPOKEN_WORDS, ...PHRASES.map(phrase => phrase.key)]),
];

function expandToken(token) {
  if (SPOKEN_WORDS.has(token)) return [token];
  if (/^\d+$/.test(token)) return [...token].map(digit => DIGIT_WORDS[Number(digit)]);

  const parts = token.match(/[a-z]+|\d+/g) || [];
  return parts.flatMap(part => {
    if (/^\d+$/.test(part)) return [...part].map(digit => DIGIT_WORDS[Number(digit)]);
    if (SPOKEN_WORDS.has(part)) return [part];
    return [...part].map(letter => NATO_WORDS[letter]).filter(Boolean);
  });
}

export function getLocalSpeechSegments(text = "") {
  const words = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const segments = [];
  for (let index = 0; index < words.length;) {
    const phrase = PHRASES.find(item =>
      item.words.every((word, offset) => words[index + offset] === word),
    );
    if (phrase) {
      segments.push(phrase.key);
      index += phrase.words.length;
      continue;
    }
    segments.push(...expandToken(words[index]));
    index += 1;
  }
  return segments;
}
