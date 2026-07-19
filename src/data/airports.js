export const DEFAULT_AIRPORT = {
  id: "ZBAA-SIM",
  name: "Capital Radar Sector",
  subtitle: "APP Radar / Parallel RWYs 18L/R - 36L/R",
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
      labels: { start: "18R", end: "36L" },
    },
    {
      id: "east-parallel",
      x: 970,
      y: 600,
      width: 60,
      length: 300,
      heading: 0,
      labels: { start: "18L", end: "36R" },
    },
  ],
  runways: [
    { id: "18R", strip: "west-parallel", startX: 830, startY: 430, heading: 180, opposite: "36L" },
    { id: "36L", strip: "west-parallel", startX: 830, startY: 770, heading: 0, opposite: "18R" },
    { id: "18L", strip: "east-parallel", startX: 970, startY: 430, heading: 180, opposite: "36R" },
    { id: "36R", strip: "east-parallel", startX: 970, startY: 770, heading: 0, opposite: "18L" },
  ],
  navBeacons: [
    { x: 100, y: 200, id: "CPN", type: "VOR/DME", freq: "112.30" },
    { x: 1700, y: 100, id: "CPE", type: "VOR/DME", freq: "114.70" },
    { x: 100, y: 1100, id: "CPS", type: "NDB", freq: "385" },
  ],
  restrictedAreas: [],
  departureProcedures: [
    {
      id: "36L-CPN",
      runwayPrefix: "36L",
      via: "CPN",
      points: [
        { x: 830, y: 770 },
        { x: 830, y: 330 },
        { x: 620, y: 220 },
        { x: 100, y: 200 },
      ],
    },
    {
      id: "36R-CPE",
      runwayPrefix: "36R",
      via: "CPE",
      points: [
        { x: 970, y: 770 },
        { x: 970, y: 330 },
        { x: 1250, y: 220 },
        { x: 1700, y: 100 },
      ],
    },
    {
      id: "18R-CPS",
      runwayPrefix: "18R",
      via: "CPS",
      chartLabel: "18L/R-CPS SID",
      points: [
        { x: 830, y: 430 },
        { x: 830, y: 870 },
        { x: 590, y: 980 },
        { x: 350, y: 1070 },
        { x: 100, y: 1100 },
      ],
    },
    {
      id: "18L-CPS",
      runwayPrefix: "18L",
      via: "CPS",
      chartLabel: false,
      points: [
        { x: 970, y: 430 },
        { x: 970, y: 870 },
        { x: 1100, y: 980 },
        { x: 900, y: 1130 },
        { x: 500, y: 1180 },
        { x: 100, y: 1100 },
      ],
    },
  ],
};

export const CROSSING_RUNWAY_AIRPORT = {
  id: "CROSS-SIM",
  name: "Metro Crossing Sector",
  subtitle: "APP Radar / Crossing RWYs 09/27 & 04/22",
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
      labels: { start: "27", end: "09" },
    },
    {
      id: "northeast-southwest",
      x: 920,
      y: 585,
      width: 52,
      length: 420,
      heading: 40,
      labels: { start: "22", end: "04" },
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
    { x: 260, y: 980, id: "MWS", type: "RNAV FIX", freq: "" },
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
        { x: 1300, y: 600 },
        { x: 1450, y: 480 },
        { x: 1550, y: 310 },
      ],
    },
    {
      id: "04-MXW",
      runwayPrefix: "04",
      via: "MXW",
      points: [
        { x: 785, y: 746 },
        { x: 1180, y: 275 },
        { x: 850, y: 180 },
        { x: 260, y: 230 },
      ],
    },
    {
      id: "27-MWS",
      runwayPrefix: "27",
      via: "MWS",
      chartLabel: "RWY 27/22-MWS SID",
      points: [
        { x: 1150, y: 600 },
        { x: 500, y: 600 },
        { x: 400, y: 780 },
        { x: 260, y: 980 },
      ],
    },
    {
      id: "22-MWS",
      runwayPrefix: "22",
      via: "MWS",
      chartLabel: false,
      points: [
        { x: 1055, y: 424 },
        { x: 650, y: 907 },
        { x: 600, y: 1120 },
        { x: 350, y: 1160 },
        { x: 260, y: 980 },
      ],
    },
  ],
};

export const MOUNTAIN_VALLEY_AIRPORT = {
  id: "VALLEY-SIM",
  name: "Mountain Valley Approach",
  subtitle: "APP Radar / RWY 13/31 Terrain Corridor",
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
      labels: { start: "31", end: "13" },
    },
  ],
  runways: [
    { id: "13", strip: "valley-main", startX: 761, startY: 469, heading: 130, opposite: "31" },
    { id: "31", strip: "valley-main", startX: 1099, startY: 751, heading: 310, opposite: "13" },
  ],
  navBeacons: [
    { x: 240, y: 260, id: "VLN", type: "VOR/DME", freq: "115.60" },
    { x: 1570, y: 880, id: "VLE", type: "RNAV FIX", freq: "" },
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
        { x: 761, y: 469 },
        { x: 1210, y: 846 },
        { x: 1400, y: 900 },
        { x: 1570, y: 880 },
      ],
    },
    {
      id: "31-VLN",
      runwayPrefix: "31",
      via: "VLN",
      points: [
        { x: 1099, y: 751 },
        { x: 650, y: 374 },
        { x: 430, y: 300 },
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
