import assert from "node:assert/strict";
import { extractAltitude, extractBeaconId, extractHeading, extractProcedureId, extractRunwayId, extractSpeed, normalizeVoiceCommand } from "../src/utils/voiceCommandParser.js";

const cases = [
  {
    input: "bravo six zero two seven turn left heading one eight zero",
    normalized: "b6027 turn left heading 180",
    heading: 180,
  },
  {
    input: "bravo four seven zero four cleared to land runway one three",
    normalized: "b4704 land runway 13",
    runway: "13",
  },
  {
    input: "bravo eight eight one three takeoff runway zero nine",
    normalized: "b8813 take off runway 09",
    runway: "09",
  },
  {
    input: "b9488 turn right heading two seven zero",
    normalized: "b9488 turn right heading 270",
    heading: 270,
  },
  {
    input: "bravo six zero two seven land runway three six left",
    normalized: "b6027 land runway 36L",
    runway: "36L",
  },
  {
    input: "bravo six zero two seven cleared for takeoff runway twenty seven",
    normalized: "b6027 take off runway 27",
    runway: "27",
  },
  {
    input: "bravo one two three four turn right heading zero nine zero",
    normalized: "b1234 turn right heading 090",
    heading: 90,
  },
  {
    input: "bee five six zero nine turn left head in one eight zero",
    normalized: "b5609 turn left heading 180",
    heading: 180,
  },
  {
    input: "be fifty six zero nine turn left one eight zero",
    normalized: "b5609 turn left 180",
    heading: 180,
  },
  {
    input: "bravo six zero two seven proceed direct charlie papa november",
    normalized: "b6027 proceed direct charlie papa november",
    beacon: "CPN",
    beacons: ["CPN", "CPE", "CPS"],
  },
  {
    input: "bravo six zero two seven direct mike november echo",
    normalized: "b6027 direct mike november echo",
    beacon: "MNE",
    beacons: ["MXW", "MNE", "MSD"],
  },
  {
    input: "bravo six zero two seven direct m n e",
    normalized: "b6027 direct m n e",
    beacon: "MNE",
    beacons: ["MXW", "MNE", "MSD"],
  },
  {
    input: "bravo six zero two seven cleared via 09-MNE",
    normalized: "b6027 cleared via 09-mne",
    procedure: "09-MNE",
    procedures: [{ id: "09-MNE", runwayPrefix: "09", via: "MNE" }],
  },
  {
    input: "bravo six zero two seven fly sid via mike november echo",
    normalized: "b6027 fly sid via mike november echo",
    procedure: "09-MNE",
    procedures: [
      { id: "09-MNE", runwayPrefix: "09", via: "MNE" },
      { id: "04-MXW", runwayPrefix: "04", via: "MXW" },
    ],
    runwayId: "09",
  },
  {
    input: "bravo six zero two seven fly sid via charlie papa november",
    normalized: "b6027 fly sid via charlie papa november",
    procedure: "36L-CPN",
    procedures: [
      { id: "36L-CPN", runwayPrefix: "36L", via: "CPN" },
      { id: "36R-CPE", runwayPrefix: "36R", via: "CPE" },
    ],
    runwayId: "36L",
  },
  {
    input: "bravo six zero two seven climb altitude five thousand",
    normalized: "b6027 climb altitude 5000",
    altitude: 5000,
  },
  {
    input: "bravo six zero two seven descend flight level zero nine zero",
    normalized: "b6027 descend flight level 090",
    altitude: 9000,
  },
  {
    input: "flight six nine zero one turn right heading one eighty",
    normalized: "b6901 turn right heading 180",
    heading: 180,
  },
  {
    input: "aircraft sixty nine zero two turn left heading two seventy",
    normalized: "b6902 turn left heading 270",
    heading: 270,
  },
  {
    input: "bravo six nine zero three descend to five thousand",
    normalized: "b6903 descend 5000",
    altitude: 5000,
  },
  {
    input: "bravo six nine zero four take of run way zero nine",
    normalized: "b6904 take off runway 09",
    runway: "09",
  },
  {
    input: "bravo six nine zero five turn heading one hundred eighty",
    normalized: "b6905 turn heading 180",
    heading: 180,
  },
  {
    input: "bravo six nine zero six reduce speed to one eight zero knots",
    normalized: "b6906 reduce speed 180 knots",
    speed: 180,
  },
  {
    input: "aircraft sixty nine zero seven maintain speed two hundred knots",
    normalized: "b6907 maintain speed 200 knots",
    speed: 200,
  },
];

for (const testCase of cases) {
  const normalized = normalizeVoiceCommand(testCase.input);
  assert.equal(normalized, testCase.normalized, testCase.input);

  if (testCase.runway) {
    assert.equal(extractRunwayId(normalized), testCase.runway, testCase.input);
  }

  if (testCase.heading !== undefined) {
    assert.equal(extractHeading(normalized), testCase.heading, testCase.input);
  }

  if (testCase.beacon) {
    assert.equal(extractBeaconId(normalized, testCase.beacons), testCase.beacon, testCase.input);
  }

  if (testCase.procedure) {
    assert.equal(extractProcedureId(normalized, testCase.procedures, testCase.runwayId), testCase.procedure, testCase.input);
  }

  if (testCase.altitude !== undefined) {
    assert.equal(extractAltitude(normalized), testCase.altitude, testCase.input);
  }

  if (testCase.speed !== undefined) {
    assert.equal(extractSpeed(normalized), testCase.speed, testCase.input);
  }
}

console.log(`voiceCommandParser: ${cases.length} cases passed`);
