export const DEFAULT_AIRPORT = {
  id: "ZBAA-SIM",
  name: "Capital Radar Sector",
  subtitle: "APP Radar / Parallel RWY 18-36",
  center: { x: 900, y: 600 },
  canvas: { width: 1800, height: 1200 },
  departureQueue: { x: 900, y: 600, spacingX: 0, spacingY: 50 },
  physicalRunways: [
    {
      id: "west-parallel",
      x: 830,
      y: 600,
      width: 60,
      length: 300,
      heading: 0,
      labels: { start: "36L", end: "18R" },
    },
    {
      id: "east-parallel",
      x: 970,
      y: 600,
      width: 60,
      length: 300,
      heading: 0,
      labels: { start: "36R", end: "18L" },
    },
  ],
  runways: [
    { id: "18R", strip: "west-parallel", startX: 830, startY: 430, heading: 180, opposite: "36L" },
    { id: "36L", strip: "west-parallel", startX: 830, startY: 770, heading: 0, opposite: "18R" },
    { id: "18L", strip: "east-parallel", startX: 970, startY: 430, heading: 180, opposite: "36R" },
    { id: "36R", strip: "east-parallel", startX: 970, startY: 770, heading: 0, opposite: "18L" },
  ],
  navBeacons: [
    { x: 100, y: 200, id: "NAV1", type: "VOR/DME", freq: "112.30" },
    { x: 1700, y: 100, id: "NAV2", type: "VOR/DME", freq: "114.70" },
    { x: 100, y: 1100, id: "NAV3", type: "NDB", freq: "385" },
  ],
  restrictedAreas: [],
  departureProcedures: [
    {
      id: "36-NAV1",
      runwayPrefix: "36",
      via: "NAV1",
      points: [
        { x: 900, y: 770 },
        { x: 760, y: 520 },
        { x: 100, y: 200 },
      ],
    },
    {
      id: "18-NAV3",
      runwayPrefix: "18",
      via: "NAV3",
      points: [
        { x: 900, y: 430 },
        { x: 690, y: 760 },
        { x: 100, y: 1100 },
      ],
    },
  ],
};

export const CROSSING_RUNWAY_AIRPORT = {
  id: "CROSS-SIM",
  name: "Metro Crossing Sector",
  subtitle: "APP Radar / Crossing RWY 09-27 and 04-22",
  center: { x: 900, y: 600 },
  canvas: { width: 1800, height: 1200 },
  departureQueue: { x: 760, y: 690, spacingX: -38, spacingY: 38 },
  physicalRunways: [
    {
      id: "east-west",
      x: 900,
      y: 600,
      width: 58,
      length: 500,
      heading: 90,
      labels: { start: "09", end: "27" },
    },
    {
      id: "northeast-southwest",
      x: 920,
      y: 585,
      width: 52,
      length: 420,
      heading: 40,
      labels: { start: "04", end: "22" },
    },
  ],
  runways: [
    { id: "09", strip: "east-west", startX: 650, startY: 600, heading: 90, opposite: "27" },
    { id: "27", strip: "east-west", startX: 1150, startY: 600, heading: 270, opposite: "09" },
    { id: "04", strip: "northeast-southwest", startX: 785, startY: 746, heading: 40, opposite: "22" },
    { id: "22", strip: "northeast-southwest", startX: 1055, startY: 424, heading: 220, opposite: "04" },
  ],
  navBeacons: [
    { x: 260, y: 230, id: "MXW", type: "VOR/DME", freq: "113.90" },
    { x: 1550, y: 310, id: "MNE", type: "VOR/DME", freq: "116.20" },
    { x: 1610, y: 1070, id: "MSD", type: "NDB", freq: "405" },
    { x: 260, y: 980, id: "MWS", type: "FIX", freq: "RNAV" },
  ],
  restrictedAreas: [
    {
      id: "R-12",
      label: "MILITARY",
      active: true,
      points: [
        { x: 1130, y: 735 },
        { x: 1510, y: 760 },
        { x: 1500, y: 1030 },
        { x: 1160, y: 990 },
      ],
    },
  ],
  departureProcedures: [
    {
      id: "09-MNE",
      runwayPrefix: "09",
      via: "MNE",
      points: [
        { x: 650, y: 600 },
        { x: 1030, y: 510 },
        { x: 1550, y: 310 },
      ],
    },
    {
      id: "04-MXW",
      runwayPrefix: "04",
      via: "MXW",
      points: [
        { x: 785, y: 746 },
        { x: 585, y: 515 },
        { x: 260, y: 230 },
      ],
    },
    {
      id: "27-MWS",
      runwayPrefix: "27",
      via: "MWS",
      points: [
        { x: 1150, y: 600 },
        { x: 760, y: 820 },
        { x: 260, y: 980 },
      ],
    },
  ],
};

export const MOUNTAIN_VALLEY_AIRPORT = {
  id: "VALLEY-SIM",
  name: "Mountain Valley Approach",
  subtitle: "APP Radar / Offset RWY 13-31 Terrain Corridor",
  center: { x: 900, y: 600 },
  canvas: { width: 1800, height: 1200 },
  departureQueue: { x: 1080, y: 730, spacingX: 42, spacingY: 28 },
  physicalRunways: [
    {
      id: "valley-main",
      x: 930,
      y: 610,
      width: 62,
      length: 440,
      heading: 130,
      labels: { start: "13", end: "31" },
    },
  ],
  runways: [
    { id: "13", strip: "valley-main", startX: 789, startY: 441, heading: 130, opposite: "31" },
    { id: "31", strip: "valley-main", startX: 1071, startY: 779, heading: 310, opposite: "13" },
  ],
  navBeacons: [
    { x: 240, y: 260, id: "VLN", type: "VOR/DME", freq: "115.60" },
    { x: 1570, y: 880, id: "VLE", type: "RNAV", freq: "RNP" },
    { x: 760, y: 1020, id: "VLY", type: "NDB", freq: "332" },
  ],
  restrictedAreas: [
    {
      id: "T-31",
      label: "TERRAIN",
      active: true,
      points: [
        { x: 1040, y: 120 },
        { x: 1680, y: 165 },
        { x: 1540, y: 560 },
        { x: 1190, y: 460 },
      ],
    },
    {
      id: "T-13",
      label: "TERRAIN",
      active: true,
      points: [
        { x: 120, y: 675 },
        { x: 560, y: 735 },
        { x: 620, y: 1115 },
        { x: 210, y: 1060 },
      ],
    },
  ],
  departureProcedures: [
    {
      id: "13-VLE",
      runwayPrefix: "13",
      via: "VLE",
      points: [
        { x: 789, y: 441 },
        { x: 1110, y: 565 },
        { x: 1570, y: 880 },
      ],
    },
    {
      id: "31-VLN",
      runwayPrefix: "31",
      via: "VLN",
      points: [
        { x: 1071, y: 779 },
        { x: 760, y: 545 },
        { x: 240, y: 260 },
      ],
    },
  ],
};

export const AIRPORTS = [
  DEFAULT_AIRPORT,
  CROSSING_RUNWAY_AIRPORT,
  MOUNTAIN_VALLEY_AIRPORT,
];
