const DIGIT_WORDS = {
  zero: "0",
  oh: "0",
  one: "1",
  won: "1",
  two: "2",
  too: "2",
  tree: "3",
  three: "3",
  four: "4",
  fower: "4",
  five: "5",
  fife: "5",
  six: "6",
  seven: "7",
  eight: "8",
  ate: "8",
  nine: "9",
  niner: "9",
};

const RUNWAY_NUMBER_WORDS = {
  four: "04",
  fower: "04",
  nine: "09",
  niner: "09",
  thirteen: "13",
  eighteen: "18",
  "twenty two": "22",
  "twenty seven": "27",
  "thirty one": "31",
  "thirty six": "36",
};

const NUMBER_WORDS = {
  one: 1,
  two: 2,
  tree: 3,
  three: 3,
  four: 4,
  fower: 4,
  five: 5,
  fife: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const RUNWAY_SUFFIX_WORDS = {
  left: "L",
  right: "R",
  center: "C",
  centre: "C",
};

const NATO_LETTERS = {
  alpha: "A",
  bravo: "B",
  charlie: "C",
  delta: "D",
  echo: "E",
  foxtrot: "F",
  golf: "G",
  hotel: "H",
  india: "I",
  juliett: "J",
  juliet: "J",
  kilo: "K",
  lima: "L",
  mike: "M",
  november: "N",
  oscar: "O",
  papa: "P",
  quebec: "Q",
  romeo: "R",
  sierra: "S",
  tango: "T",
  uniform: "U",
  victor: "V",
  whiskey: "W",
  whisky: "W",
  xray: "X",
  "x-ray": "X",
  yankee: "Y",
  zulu: "Z",
};

const digitAlternation = Object.keys(DIGIT_WORDS).join("|");
const digitTokenPattern = new RegExp(`^(?:\\d|${digitAlternation})$`, "i");

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function tokenToDigit(token) {
  return /^\d$/.test(token) ? token : DIGIT_WORDS[token.toLowerCase()];
}

function convertDigitTokens(tokens) {
  const digits = [];
  for (const token of tokens) {
    const digit = tokenToDigit(token);
    if (!digit) return null;
    digits.push(digit);
  }
  return digits.join("");
}

function wordsToNumber(tokens) {
  let total = 0;
  let current = 0;
  let found = false;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (/^\d+$/.test(lower)) {
      current += Number.parseInt(lower, 10);
      found = true;
      continue;
    }

    if (NUMBER_WORDS[lower]) {
      current += NUMBER_WORDS[lower];
      found = true;
      continue;
    }

    if (lower === "hundred") {
      current = (current || 1) * 100;
      found = true;
      continue;
    }

    if (lower === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
      found = true;
      continue;
    }

    return null;
  }

  return found ? total + current : null;
}

function tokenToBeaconCharacter(token) {
  if (/^[a-z]$/i.test(token)) return token.toUpperCase();
  if (/^\d$/.test(token)) return token;
  if (NATO_LETTERS[token.toLowerCase()]) return NATO_LETTERS[token.toLowerCase()];
  if (DIGIT_WORDS[token.toLowerCase()]) return DIGIT_WORDS[token.toLowerCase()];
  return "";
}

function convertNumberWordsInContext(command, keyword, minDigits, maxDigits) {
  const pattern = new RegExp(`\\b(${keyword})\\s+((?:(?:\\d|${digitAlternation})\\s*){${minDigits},${maxDigits}})\\b`, "gi");
  return command.replace(pattern, (match, prefix, numberPhrase) => {
    const tokens = normalizeWhitespace(numberPhrase).split(" ");
    const digits = convertDigitTokens(tokens);
    return digits ? `${prefix} ${digits}` : match;
  });
}

function callsignTokensToDigits(tokens) {
  const digits = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index].toLowerCase();
    const directDigit = tokenToDigit(token);
    if (directDigit) {
      digits.push(directDigit);
      continue;
    }

    const number = NUMBER_WORDS[token];
    if (!number) return null;

    if (number >= 10 && number < 20) {
      digits.push(...number.toString().padStart(2, "0"));
      continue;
    }

    if (number >= 20 && number <= 90 && number % 10 === 0) {
      const next = tokens[index + 1]?.toLowerCase();
      const nextNumber = NUMBER_WORDS[next];
      if (nextNumber > 0 && nextNumber < 10) {
        digits.push(...(number + nextNumber).toString());
        index += 1;
      } else {
        digits.push(...number.toString());
      }
      continue;
    }

    if (number > 0 && number < 10) {
      digits.push(number.toString());
      continue;
    }

    return null;
  }

  return digits.length === 4 ? digits.join("") : null;
}

function headingTokensToDigits(tokens) {
  const directDigits = convertDigitTokens(tokens);
  if (directDigits) return directDigits.padStart(3, "0");

  if (tokens.length === 2) {
    const firstDigit = tokenToDigit(tokens[0]);
    const secondNumber = NUMBER_WORDS[tokens[1].toLowerCase()];
    if (firstDigit !== undefined && secondNumber >= 10 && secondNumber < 100) {
      return `${firstDigit}${secondNumber.toString().padStart(2, "0")}`;
    }
  }

  const numericHeading = wordsToNumber(tokens);
  if (numericHeading === null || numericHeading < 0 || numericHeading > 360) return null;
  return numericHeading.toString().padStart(3, "0");
}

function convertHeadingWordsInContext(command, keyword) {
  const numberAlternation = Object.keys(NUMBER_WORDS).join("|");
  const pattern = new RegExp(`\\b(${keyword})\\s+((?:(?:\\d|${digitAlternation}|${numberAlternation}|hundred)\\s*){1,4})\\b`, "gi");
  return command.replace(pattern, (match, prefix, headingPhrase) => {
    const heading = headingTokensToDigits(normalizeWhitespace(headingPhrase).split(" "));
    return heading ? `${prefix} ${heading}` : match;
  });
}

function normalizeCallsignPhrase(callsignPhrase) {
  const tokens = normalizeWhitespace(callsignPhrase).split(" ");
  const digits = callsignTokensToDigits(tokens);
  return digits ? `b${digits}` : null;
}

function normalizeRunwayPhrase(runwayPhrase) {
  const phrase = normalizeWhitespace(runwayPhrase.toLowerCase());
  const tokens = phrase.split(" ");
  const suffixToken = tokens[tokens.length - 1];
  const suffix = RUNWAY_SUFFIX_WORDS[suffixToken] || "";
  const numberTokens = suffix ? tokens.slice(0, -1) : tokens;
  const numberPhrase = numberTokens.join(" ");

  if (/^\d{1,2}$/.test(numberPhrase)) {
    return numberPhrase.padStart(2, "0") + suffix;
  }

  if (RUNWAY_NUMBER_WORDS[numberPhrase]) {
    return RUNWAY_NUMBER_WORDS[numberPhrase] + suffix;
  }

  if (numberTokens.every(token => digitTokenPattern.test(token))) {
    return convertDigitTokens(numberTokens).padStart(2, "0") + suffix;
  }

  return null;
}

export function normalizeVoiceCommand(command) {
  if (!command) return "";

  let normalized = command
    .toLowerCase()
    .replace(/[.,?!;:/]/g, " ")
    .replace(/\b(?:bee|be)\s+(?=(?:\d|zero|oh|one|won|two|too|tree|three|four|fower|five|fife|six|seven|eight|ate|nine|niner|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b)/g, "b ")
    .replace(/\bbravo\b/g, "b")
    .replace(/\bhead\s+in\b/g, "heading")
    .replace(/\brun\s+way\b/g, "runway")
    .replace(/\btake\s+of\b/g, "take off")
    .replace(/\btakeoff\b/g, "take off")
    .replace(/\bcleared for take off\b/g, "take off")
    .replace(/\bcleared for takeoff\b/g, "take off")
    .replace(/\bclear(?:ed)? to land\b/g, "land")
    .replace(/\b(?:climb|descend)\s+(?:and maintain|to)\b/g, match => match.startsWith("climb") ? "climb" : "descend");

  normalized = normalizeWhitespace(normalized);

  normalized = normalized.replace(
    new RegExp(`\\bb\\s+((?:(?:\\d|${digitAlternation})\\s*){4})\\b`, "gi"),
    (match, numberPhrase) => {
      const digits = convertDigitTokens(normalizeWhitespace(numberPhrase).split(" "));
      return digits && digits.length === 4 ? `b${digits} ` : match;
    },
  );

  normalized = normalized.replace(
    new RegExp(`^(?:flight|aircraft)?\\s*((?:(?:\\d|${digitAlternation}|${Object.keys(NUMBER_WORDS).join("|")})\\s*){2,8})(?=\\s+(?:turn|heading|head|land|take|climb|descend|maintain|go|proceed|direct|fly|cleared))`, "i"),
    (match, callsignPhrase) => {
      const callsign = normalizeCallsignPhrase(callsignPhrase);
      return callsign ? `${callsign} ` : match;
    },
  );

  normalized = normalized.replace(
    new RegExp(`\\bb\\s+((?:(?:\\d|${digitAlternation}|${Object.keys(NUMBER_WORDS).join("|")})\\s*){2,8})\\b`, "gi"),
    (match, callsignPhrase) => {
      const callsign = normalizeCallsignPhrase(callsignPhrase);
      return callsign ? `${callsign} ` : match;
    },
  );

  normalized = normalized.replace(
    new RegExp(`\\bnav\\s+((?:\\d|${digitAlternation}))\\b`, "gi"),
    (match, digitPhrase) => {
      const digit = tokenToDigit(digitPhrase);
      return digit ? `nav${digit}` : match;
    },
  );

  normalized = convertHeadingWordsInContext(normalized, "heading|head");
  normalized = convertHeadingWordsInContext(normalized, "turn left|turn right|left|right");
  normalized = convertNumberWordsInContext(normalized, "heading|head", 1, 3);
  normalized = convertNumberWordsInContext(normalized, "turn left|turn right|left|right", 1, 3);
  normalized = convertNumberWordsInContext(normalized, "flight level|level", 2, 3);

  normalized = normalized.replace(
    new RegExp(`\\b(altitude|climb|descend|maintain)\\s+((?:(?:\\d+|${Object.keys(NUMBER_WORDS).join("|")}|hundred|thousand)\\s*){1,5})\\b`, "gi"),
    (match, prefix, altitudePhrase) => {
      const tokens = normalizeWhitespace(altitudePhrase).split(" ");
      const numericAltitude = wordsToNumber(tokens);
      return numericAltitude ? `${prefix} ${numericAltitude}` : match;
    },
  );

  normalized = normalized.replace(
    new RegExp(`\\brunway\\s+((?:(?:\\d{1,2}|${digitAlternation}|${Object.keys(RUNWAY_NUMBER_WORDS).join("|")}|left|right|center|centre)\\s*){1,4})`, "gi"),
    (match, runwayPhrase) => {
      const runway = normalizeRunwayPhrase(runwayPhrase);
      return runway ? `runway ${runway}` : match;
    },
  );

  return normalizeWhitespace(normalized);
}

export function extractRunwayId(command) {
  const runwayMatch = command.match(/\brunway\s+(\d{1,2})([LRC]?)/i);
  if (!runwayMatch) return null;
  return runwayMatch[1].padStart(2, "0") + (runwayMatch[2] ? runwayMatch[2].toUpperCase() : "");
}

export function extractHeading(command) {
  const headingMatch =
    command.match(/\b(?:heading|head)\s+(\d{1,3})\b/i) ||
    command.match(/\b(?:turn\s+left|turn\s+right|left|right)\s+(\d{1,3})\b/i) ||
    command.match(/\b(\d{3})\b/i);
  if (!headingMatch) return null;
  const heading = Number.parseInt(headingMatch[1], 10);
  if (!Number.isFinite(heading) || heading < 0 || heading > 360) return null;
  return Math.min(359, heading);
}

export function extractAltitude(command) {
  const flightLevelMatch = command.match(/\b(?:flight level|level)\s+(\d{2,3})\b/i);
  if (flightLevelMatch) {
    return Number.parseInt(flightLevelMatch[1], 10) * 100;
  }

  const altitudeMatch = command.match(/\b(?:altitude|climb|descend|maintain)\s+(\d{3,5})\b/i);
  if (!altitudeMatch) return null;

  const altitude = Number.parseInt(altitudeMatch[1], 10);
  if (!Number.isFinite(altitude) || altitude < 0 || altitude > 45000) return null;
  return Math.round(altitude / 100) * 100;
}

export function extractBeaconId(command, beaconIds = []) {
  if (!command || beaconIds.length === 0) return null;

  const commandCompact = command.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const beaconId of beaconIds) {
    const id = beaconId.toUpperCase();
    if (commandCompact.includes(id)) return id;
  }

  const tokens = normalizeWhitespace(command.toLowerCase()).split(" ");
  for (let start = 0; start < tokens.length; start++) {
    let candidate = "";
    for (let end = start; end < Math.min(tokens.length, start + 5); end++) {
      const char = tokenToBeaconCharacter(tokens[end]);
      if (!char) break;
      candidate += char;
      const match = beaconIds.find(id => id.toUpperCase() === candidate);
      if (match) return match.toUpperCase();
    }
  }

  return null;
}

export function extractProcedureId(command, procedures = [], runwayId = null) {
  if (!command || procedures.length === 0) return null;

  const commandCompact = command.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const procedure of procedures) {
    const procedureCompact = procedure.id.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (commandCompact.includes(procedureCompact)) return procedure.id;
  }

  const viaBeaconId = extractBeaconId(command, procedures.map(procedure => procedure.via));
  if (!viaBeaconId) return null;

  let candidates = procedures.filter(procedure => procedure.via.toUpperCase() === viaBeaconId.toUpperCase());
  if (runwayId) {
    const runwayCandidates = candidates.filter(procedure => runwayId.startsWith(procedure.runwayPrefix));
    if (runwayCandidates.length === 1) return runwayCandidates[0].id;
    if (runwayCandidates.length > 1) candidates = runwayCandidates;
  }

  return candidates.length === 1 ? candidates[0].id : null;
}
