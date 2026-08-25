(() => {
  'use strict';

  const APP_VERSION = '1.17.0'; // JSON backup/restore via share sheet, shot-log CSV, remembered putts default, verdict & shot-capture haptic vocabulary
  const ACCURACY_WARN_YD = 25;
  // Range-recalculation throttle (perf): GPS ticks only trigger the full
  // plays-like solve when the player has genuinely moved. Sub-yard drift in
  // the smoothed position can't change a golf number.
  const RANGE_RECALC_MOVE_YD = 3; // movement (yd) required before a GPS-triggered recalculation runs
  const USABLE_ACC_M = 30;
  const APPROX_ACC_M = 500;
  const WEATHER_TTL = 10 * 60 * 1000;
  const ELEV_TTL = 30 * 24 * 60 * 60 * 1000;
  const ONBOARD_KEY = 'caddy:onboarded';
  const COURSE_PROFILES_KEY = 'caddy:courseProfiles:v1';
  const LAST_ROUND_SETUP_KEY = 'caddy:lastRoundSetup:v1';
  const NEARBY_COURSES_CACHE_KEY = 'caddy:nearbyCourses:v3';
  const NEARBY_COURSES_TTL = 6 * 60 * 60 * 1000;
  // Course name search (round setup): Photon geocoder FIRST (sub-second,
  // built for free-text place lookup), Overpass regex lookup as automatic
  // fallback. Radius-bounded on purpose — unbounded name queries reliably
  // time out on public Overpass mirrors.
  const COURSE_SEARCH_RADIUS_M = 100000;
  const COURSE_SEARCH_MIN_CHARS = 3;
  const COURSE_SEARCH_DEBOUNCE_MS = 500;
  const COURSE_SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
  const COURSE_SEARCH_FETCH_LIMIT = 60;   // fetched, sorted by distance, then trimmed…
  const COURSE_SEARCH_MAX_RESULTS = 12;   // …to this many displayed
  const PHOTON_GEOCODER_URL = 'https://photon.komoot.io/api/';
  const LAST_PUTTS_KEY = 'caddy:lastPutts';
  const NEARBY_COURSE_RADIUS_M = 12000;
  const MAX_GPS_SPEED_MPS = 18;
  const MAX_CONSECUTIVE_REJECTS = 3;
  const REBASE_AFTER_MS = 20000;
  const reduceMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const DEFAULT_CLUBS = [
    ['Driver', 275],
    ['3 Wood', 250],
    ['2 Hybrid', 230],
    ['5 Iron', 200],
    ['6 Iron', 190],
    ['7 Iron', 180],
    ['8 Iron', 165],
    ['9 Iron', 150],
    ['PW', 135],
    ['GW', 120],
    ['50°', 110],
    ['54°', 95],
  ].map(([name, yards]) => ({ id: cryptoId(), name, yards }));

  const $ = (id) => document.getElementById(id);

  const els = {
    manifestLink: $('manifestLink'),
    proToggleSheet: $('proToggleSheet'),
    settingsBtn: $('settingsBtn'),
    recenterBtn: $('recenterBtn'),
    settingsSheet: $('settingsSheet'),
    settingsScrim: $('settingsScrim'),
    settingsDoneBtn: $('settingsDoneBtn'),
    replayOnboardBtn: $('replayOnboardBtn'),
    resetShotDataBtn: $('resetShotDataBtn'),
    shotDataDesc: $('shotDataDesc'),
    onboard: $('onboard'),
    obStartBtn: $('obStartBtn'),
    obNextBtn: $('obNextBtn'),
    obSkipBtn: $('obSkipBtn'),
    obStdBagBtn: $('obStdBagBtn'),
    obLaterBtn: $('obLaterBtn'),
    obDots: $('obDots'),
    findNearbyCoursesBtn: $('findNearbyCoursesBtn'),
    nearbyCourseStatus: $('nearbyCourseStatus'),
    nearbyCourseList: $('nearbyCourseList'),
    roundMapScoreBtn: $('roundMapScoreBtn'),
    roundScoreScrim: $('roundScoreScrim'),
    roundScoreSheet: $('roundScoreSheet'),
    roundScoreCloseBtn: $('roundScoreCloseBtn'),
    roundScoreTitle: $('roundScoreTitle'),
    roundScoreMeta: $('roundScoreMeta'),
    roundScoreValue: $('roundScoreValue'),
    roundScoreMinusBtn: $('roundScoreMinusBtn'),
    roundScorePlusBtn: $('roundScorePlusBtn'),
    roundPuttsOptions: $('roundPuttsOptions'),
    roundFirOptions: $('roundFirOptions'),
    roundGirOptions: $('roundGirOptions'),
    roundScoreSaveBtn: $('roundScoreSaveBtn'),
    roundScoreSaveNextBtn: $('roundScoreSaveNextBtn'),
    roundMapHud: $('roundMapHud'),
    roundMapCourse: $('roundMapCourse'),
    roundMapHole: $('roundMapHole'),
    roundMapScore: $('roundMapScore'),
    roundMapStatus: $('roundMapStatus'),
    roundMapPrevBtn: $('roundMapPrevBtn'),
    roundMapNextBtn: $('roundMapNextBtn'),
    roundSetupScrim: $('roundSetupScrim'),
    roundSetupSheet: $('roundSetupSheet'),
    roundSetupCloseBtn: $('roundSetupCloseBtn'),
    roundSetupCourseSelect: $('roundSetupCourseSelect'),
    roundSetupCourseName: $('roundSetupCourseName'),
    roundSetupTeeName: $('roundSetupTeeName'),
    roundSetupStartHole: $('roundSetupStartHole'),
    roundSetupPars: $('roundSetupPars'),
    roundSetupSaveCourse: $('roundSetupSaveCourse'),
    roundSetupStartBtn: $('roundSetupStartBtn'),
    roundCourseName: $('roundCourseName'),
    roundHoleNumber: $('roundHoleNumber'),
    roundHoleMeta: $('roundHoleMeta'),
    roundScoreSummary: $('roundScoreSummary'),
    roundHoleStrip: $('roundHoleStrip'),
    roundPrevHoleBtn: $('roundPrevHoleBtn'),
    gpsChip: $('gpsChip'),
    gpsDot: $('gpsDot'),
    gpsText: $('gpsText'),
    roundFabWrap: $('roundFabWrap'),
    roundFab: $('roundFab'),
    roundFabIc: $('roundFabIc'),
    roundFabText: $('roundFabText'),
    roundFabClub: $('roundFabClub'),
    roundFabClubName: $('roundFabClubName'),
    roundClubPop: $('roundClubPop'),
    roundLive: $('roundLive'),
    roundLiveV: $('roundLiveV'),
    roundLiveL: $('roundLiveL'),
    advicePill: $('advicePill'),
    advicePillIc: $('advicePillIc'),
    advicePillCount: $('advicePillCount'),
    advicePop: $('advicePop'),
    advicePopScrim: $('advicePopScrim'),
    advicePopClose: $('advicePopClose'),
    advicePopBody: $('advicePopBody'),
    advicePopTitle: $('advicePopTitle'),
    rawYards: $('rawYards'),
    rawLabel: $('rawLabel'),
    aimChip: $('aimChip'),
    bearingChip: $('bearingChip'),
    bearingChipArrow: $('bearingChipArrow'),
    bearingChipText: $('bearingChipText'),
    windPill: $('windPill'),
    windPillText: $('windPillText'),
    windPop: $('windPop'),
    windPopScrim: $('windPopScrim'),
    windPopClose: $('windPopClose'),
    windPopSpeed: $('windPopSpeed'),
    windPopDir: $('windPopDir'),
    windPopShot: $('windPopShot'),
    windPopMeta: $('windPopMeta'),
    roundResetStart: $('roundResetStart'),
    playsLikeYards: $('playsLikeYards'),
    rangeNotice: $('rangeNotice'),
    weatherStatus: $('weatherStatus'),
    windMetric: $('windMetric'),
    windCompass: $('windCompass'),
    windSubMetric: $('windSubMetric'),
    tempMetric: $('tempMetric'),
    elevMetric: $('elevMetric'),
    clubChips: $('clubChips'),
    caddyTips: $('caddyTips'),
    proBreakdownWrap: $('proBreakdownWrap'),
    rangeBreakdown: $('rangeBreakdown'),
    rangeStamp: $('rangeStamp'),
    clubRecommendation: $('clubRecommendation'),
    clubRecommendationSub: $('clubRecommendationSub'),
    shotAction: $('shotAction'),
    shotPlanChips: $('shotPlanChips'),
    shotDetailsBtn: $('shotDetailsBtn'),
    shotDetailsLabel: $('shotDetailsLabel'),
    inlineAdvice: $('inlineAdvice'),
    clubsList: $('clubsList'),
    resetClubsBtn: $('resetClubsBtn'),
    newClubName: $('newClubName'),
    newClubYards: $('newClubYards'),
    addClubBtn: $('addClubBtn'),
    manualYards: $('manualYards'),
    manualClub: $('manualClub'),
    manualBearing: $('manualBearing'),
    manualElevDiff: $('manualElevDiff'),
    manualAltitude: $('manualAltitude'),
    manualTemp: $('manualTemp'),
    manualRh: $('manualRh'),
    manualWindSpeed: $('manualWindSpeed'),
    manualWindDir: $('manualWindDir'),
    manualCalcBtn: $('manualCalcBtn'),
    prefillBtn: $('prefillBtn'),
    manualRec: $('manualRec'),
    manualRecSub: $('manualRecSub'),
    manualBreakdown: $('manualBreakdown'),
    roundRows: $('roundRows'),
    clearRoundBtn: $('clearRoundBtn'),
    roundStatusChip: $('roundStatusChip'),
    roundShotHint: $('roundShotHint'),
    roundMiniSheet: $('roundMiniSheet'),
    roundMiniTitle: $('roundMiniTitle'),
    roundMiniMeta: $('roundMiniMeta'),
    roundMiniValue: $('roundMiniValue'),
    roundMiniMinusBtn: $('roundMiniMinusBtn'),
    roundMiniPlusBtn: $('roundMiniPlusBtn'),
    roundShotReadout: $('roundShotReadout'),
    roundActionBtn: $('roundActionBtn'),
    courseMappingPill: $('courseMappingPill'),
    courseMappingSpinner: $('courseMappingSpinner'),
    courseMappingText: $('courseMappingText'),
    courseMappingSub: $('courseMappingSub'),
    courseMappingRetryBtn: $('courseMappingRetry'),
    appToast: $('appToast'),
    roundSubActions: $('roundSubActions'),
    roundDiscardBtn: $('roundDiscardBtn'),
    roundNextHoleBtn: $('roundNextHoleBtn'),
    roundEndBtn: $('roundEndBtn'),
    roundShotList: $('roundShotList'),
    statScore: $('statScore'),
    statPutts: $('statPutts'),
    statFir: $('statFir'),
    statGir: $('statGir'),
    statsBreakdown: $('statsBreakdown'),
    saveRoundBtn: $('saveRoundBtn'),
    themeColorMeta: $('themeColorMeta'),
    pwaStatus: $('pwaStatus'),
    rangeWrap: $('rangeWrap'),
    layerSeg: $('layerSeg'),
    segThumb: $('segThumb'),
    sheet: $('sheet'),
    sheetDrag: $('sheetDrag'),
    fcbFront: $('fcbFront'),
    fcbCenter: $('fcbCenter'),
    fcbBack: $('fcbBack'),
    setFrontBtn: $('setFrontBtn'),
    setCenterBtn: $('setCenterBtn'),
    setBackBtn: $('setBackBtn'),
    setTeeBtn: $('setTeeBtn'),
    restoreGreenBtn: $('restoreGreenBtn'),
    clearFbBtn: $('clearFbBtn'),
    modeToggle: $('modeToggle'),
    holeAdvanceChip: $('holeAdvanceChip'),
    holeAdvanceText: $('holeAdvanceText'),
    roundPenOptions: $('roundPenOptions'),
    roundSummarySheet: $('roundSummarySheet'),
    roundSummaryScrim: $('roundSummaryScrim'),
    roundSummaryCloseBtn: $('roundSummaryCloseBtn'),
    roundSummaryMeta: $('roundSummaryMeta'),
    roundSummaryScore: $('roundSummaryScore'),
    roundSummaryBody: $('roundSummaryBody'),
    roundSummarySaveBtn: $('roundSummarySaveBtn'),
    roundSummaryFinishBtn: $('roundSummaryFinishBtn'),
    backupBtn: $('backupBtn'),
    restoreBtn: $('restoreBtn'),
    restoreInput: $('restoreInput'),
    exportCsvBtn: $('exportCsvBtn'),
    // Hole planner
    planCourseSelect: $('planCourseSelect'),
    planCourseChip: $('planCourseChip'),
    planCourseCard: $('planCourseCard'),
    planCourseName: $('planCourseName'),
    planCourseMeta: $('planCourseMeta'),
    planHoleList: $('planHoleList'),
    planDetailCard: $('planDetailCard'),
    planDetailTitle: $('planDetailTitle'),
    planDetailBody: $('planDetailBody'),
    // Planner course search (ephemeral prep course)
    planCourseSearch: $('planCourseSearch'),
    planCourseSearchResults: $('planCourseSearchResults'),
    planSaveBar: $('planSaveBar'),
    planSaveCourseBtn: $('planSaveCourseBtn'),
    // Course name search (round setup)
    courseSearchInput: $('courseSearchInput'),
    // Group scoring
    groupCountChip: $('groupCountChip'),
    groupEditorList: $('groupEditorList'),
    addPartnerBtn: $('addPartnerBtn'),
    groupTableWrap: $('groupTableWrap'),
    roundScoreChips: $('roundScoreChips'),
  };

  const savedLoc = (() => {
    const v = load('caddy:lastLocation', null);
    if (
      v &&
      typeof v === 'object' &&
      Number.isFinite(Number(v.lat)) &&
      Number.isFinite(Number(v.lng)) &&
      Math.abs(v.lat) <= 90 &&
      Math.abs(v.lng) <= 180
    ) {
      return v;
    }
    return null;
  })();

  const state = {
    prefs: load('caddy:prefs', {
      theme: 'dark',
      pro: false,
      selectedClubId: '',
      activeTab: 'range',
      mapLayer: '',
      gpsEnabled: false,
      mode: 'golf',
      dispersionZone: true,
    }),
    nearbyCourses: [],
    courseSearchActive: false,
    courseSearchLoading: false,
    courseSearchResults: [],
    courseSearchError: null,
    _courseSearchSeq: 0,
    nearbyCourseLoading: false,
    nearbyCourseLoadingScorecard: false,
    // 'idle' | 'mapping' | 'failed' — hard-blocks Start round while a
    // course scorecard is being fetched/built from OpenStreetMap.
    courseMappingState: 'idle',
    courseMappingName: '',
    courseMappingRetry: null,
    nearbySearchRequested: false,
    nearbySearchError: null,
    selectedNearbyCourse: null,
    selectedCourseTemplate: null,
    setupHolesCount: 18,
    courseProfiles: loadArr(COURSE_PROFILES_KEY, [], (c) => c && typeof c === 'object'),
    clubs: loadArr('caddy:clubs', DEFAULT_CLUBS, (c) => c && typeof c === 'object'),
    round: loadArr('caddy:round', emptyRound()),
    history: loadArr('caddy:history', [], (h) => h && typeof h === 'object'),
    loc: savedLoc,
    locStale: !!savedLoc,
    watchId: null,
    gpsDenied: false,
    gpsRunning: false,
    gpsStartedAt: 0,
    preciseHintShown: false,
    fixSamples: [],
    smoothed: null,
    lastRawFix: null,
    lastAcceptedFix: null,
    consecutiveRejects: 0,
    currentAccuracy: null,
    target: null,
    greenCenter: null, // {lat,lng} — persistent green center for the hole
    frontPt: null,
    backPt: null,
    teePt: null,
    twoTapA: null,
    twoTapComplete: false,
    placeMode: null,
    context: {
      weather: null,
      elevation: null,
      offlineWeather: false,
      offlineElevation: false,
      weatherTs: 0,
      elevTs: 0,
    },
    contextSeq: 0,
    lastCalc: null,
    lastCalcLoc: null, // position the last range calculation ran against (throttle reference)
    lastCalcAt: 0,     // timestamp of the last range calculation
    lastRecClubId: null,
    roundSession: load('caddy:roundSession', null),
    roundScoreDraft: null,
    map: null,
    layers: {},
    markers: {},
    mapReady: false,
    pannedOnce: false,
    followUser: false,
    contextTimer: null,
    sheet: null,
  };
  const FollowMode = { IDLE: 'idle', LOCKED: 'locked' };
  state.followMode = FollowMode.IDLE;
  state.lockOffset = null; // {x, y} screen-pixel offset from map center, captured at lock
  function emptyRound() {
    return Array.from({ length: 18 }, (_, i) => ({
      hole: i + 1,
      score: '',
      putts: '',
      fir: '',
      gir: '',
      penalties: '',
      notes: '',
    }));
  }

  function defaultHole(number) {
    return {
      number,
      par: 4,
      handicap: '',
      yards: '',

      tee: null,
      greenCenter: null,
      front: null,
      back: null,

      teePoint: null,
      pin: null,
      fairwayCenter: null,

      hazards: [],
      source: 'manual',
    };
  }
  function defaultCourseHoles() {
    return Array.from({ length: 18 }, (_, i) => defaultHole(i + 1));
  }

  function makeCasualCourse() {
    return {
      id: 'casual',
      name: 'Casual Round',
      holesCount: 18,
      teeName: 'Regular tees',
      source: 'manual',
      updatedAt: Date.now(),

      rating: '',
      slope: '',
      totalYards: '',
      location: null,

      holes: defaultCourseHoles(),
    };
  }

  function normalizeCourse(course) {
    const fallback = makeCasualCourse();
    const raw = course && typeof course === 'object' ? course : {};

    const location =
      raw.location &&
        Number.isFinite(Number(raw.location.lat)) &&
        Number.isFinite(Number(raw.location.lng)) &&
        Math.abs(Number(raw.location.lat)) <= 90 &&
        Math.abs(Number(raw.location.lng)) <= 180
        ? {
          lat: Number(raw.location.lat),
          lng: Number(raw.location.lng),
        }
        : null;

    const rawHoles = Array.isArray(raw.holes) ? raw.holes : [];
    // Only 9- and 18-hole layouts are supported; anything else → 18.
    const holesCount = Number(raw.holesCount) === 9 ? 9 : 18;

    return {
      // Preserve importer-added keys (teeSets, activeTeeSet, importReport,
      // osmType, osmId). The explicit keys below still override these.
      ...raw,

      holesCount,

      id:
        typeof raw.id === 'string' && raw.id.trim()
          ? raw.id
          : `local:${cryptoId()}`,

      name:
        typeof raw.name === 'string' && raw.name.trim()
          ? raw.name.trim()
          : fallback.name,

      teeName:
        typeof raw.teeName === 'string' && raw.teeName.trim()
          ? raw.teeName.trim()
          : fallback.teeName,

      source:
        typeof raw.source === 'string' && raw.source
          ? raw.source
          : 'manual',

      updatedAt: Number(raw.updatedAt) || Date.now(),

      rating:
        raw.rating === '' || raw.rating == null
          ? ''
          : num(raw.rating, ''),

      slope:
        raw.slope === '' || raw.slope == null
          ? ''
          : Math.max(1, Math.round(num(raw.slope, 0))),

      totalYards:
        raw.totalYards === '' || raw.totalYards == null
          ? ''
          : Math.max(1, Math.round(num(raw.totalYards, 0))),

      location,

      holes: Array.from({ length: holesCount }, (_, index) => {
        const sourceHole =
          rawHoles[index] && typeof rawHoles[index] === 'object'
            ? rawHoles[index]
            : {};

        return {
          ...defaultHole(index + 1),
          ...sourceHole,

          number: index + 1,

          par: clamp(
            Math.round(num(sourceHole.par, 4)),
            3,
            6
          ),

          yards:
            sourceHole.yards === '' || sourceHole.yards == null
              ? ''
              : Math.max(1, Math.round(num(sourceHole.yards, 0))),
        };
      }),
    };
  }

  function cloneCourse(course) {
    return JSON.parse(JSON.stringify(normalizeCourse(course)));
  }

  function saveCourseProfiles() {
    save(COURSE_PROFILES_KEY, state.courseProfiles);
  }

  function scorecardForCourse(course) {
    const n = course && Number(course.holesCount) === 9 ? 9 : 18;
    return Array.from({ length: n }, (_, i) => ({
      hole: i + 1,
      score: '',
      putts: '',
      fir: '',
      gir: '',
      penalties: '',
      notes: '',
    }));
  }

  function getCurrentHoleNumber() {
    const rs = state.roundSession;
    return clamp(
      Math.round(num(rs?.hole || rs?.currentHole, 1)),
      1,
      18
    );
  }

  function getCurrentCourse() {
    return state.roundSession?.course
      ? normalizeCourse(state.roundSession.course)
      : null;
  }

  function getCurrentHoleData() {
    const course = getCurrentCourse();
    const holeNumber = getCurrentHoleNumber();

    if (!course?.holes?.length) return defaultHole(holeNumber);

    return course.holes[holeNumber - 1] || defaultHole(holeNumber);
  }

  function getScorecardRows() {
    if (
      state.roundSession &&
      Array.isArray(state.roundSession.scorecard)
    ) {
      return state.roundSession.scorecard;
    }

    return state.round;
  }

  function syncRoundScorecard() {
    if (!state.roundSession) return;

    state.roundSession.scorecard = state.round;
    state.roundSession.currentHole = state.roundSession.hole;

    save('caddy:round', state.round);
    saveRoundSession();
  }

  function roundScoreToPar() {
    const course = getCurrentCourse();
    const rows = getScorecardRows();

    let strokes = 0;
    let par = 0;
    let holesPlayed = 0;

    rows.forEach((row, index) => {
      const score = Number(row.score);

      if (!Number.isFinite(score) || score <= 0) return;

      const holePar = clamp(
        Math.round(num(course?.holes?.[index]?.par, 4)),
        3,
        6
      );

      strokes += score;
      par += holePar;
      holesPlayed += 1;
    });

    return {
      strokes,
      par,
      holesPlayed,
      toPar: strokes - par,
    };
  }

  function formatToPar(value) {
    if (!Number.isFinite(value) || value === 0) return 'E';
    return value > 0 ? `+${value}` : String(value);
  }

  // Round session = the live tracking lifecycle.
  // status: "idle" | "active" | "pending"
  //   active  → between shots, ready to start the next one
  //   pending → a shot is in flight (start captured, awaiting finish)
  function emptyRoundSession(course = null, startHole = 1) {
    const selectedCourse = normalizeCourse(course || makeCasualCourse());

    return {
      status: 'active',
      hole: clamp(Math.round(num(startHole, 1)), 1, 18),
      currentHole: clamp(Math.round(num(startHole, 1)), 1, 18),

      startedAt: Date.now(),

      course: selectedCourse,
      scorecard: scorecardForCourse(selectedCourse),

      pending: null,
      chosenClubId: null,
      shots: [],

      // Group scoring. Lives ONLY on the session — it never merges into
      // state.round, so personal stats/history stay untouched by design.
      // Starts EMPTY: partners are added per round, not carried over —
      // your group shouldn't follow you around uninvited.
      groupPlayers: [],
      groupScores: {},
    };
  }
  function saveRoundSession() {
    save('caddy:roundSession', state.roundSession);
  }
  function roundStatus() {
    return state.roundSession ? state.roundSession.status : 'idle';
  }
  // Active round's layout (9 or 18); defaults to 18 outside a round.
  function getCourseHoleCount() {
    const c = getCurrentCourse();
    return c && Number(c.holesCount) === 9 ? 9 : 18;
  }
  // Club the next shot will log against: explicit override wins,
  // otherwise follow the live recommendation, otherwise longest club.
  function roundActiveClubId() {
    const rs = state.roundSession;
    if (rs && rs.chosenClubId) {
      // Drop a stale override if that club was deleted.
      if (state.clubs.some((c) => c.id === rs.chosenClubId))
        return rs.chosenClubId;
    }
    if (state.lastRecClubId) return state.lastRecClubId;
    const d = sortedClubsDesc()[0];
    return d ? d.id : null;
  }

  function cryptoId() {
    try {
      if (crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch { }
    try {
      if (crypto && crypto.getRandomValues) {
        const b = new Uint8Array(16);
        crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
        return (
          h.slice(0, 4).join('') +
          '-' +
          h.slice(4, 6).join('') +
          '-' +
          h.slice(6, 8).join('') +
          '-' +
          h.slice(8, 10).join('') +
          '-' +
          h.slice(10, 16).join('')
        );
      }
    } catch { }
    return (
      'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    );
  }
  function load(k, f) {
    try {
      const r = localStorage.getItem(k);
      return r ? JSON.parse(r) : f;
    } catch {
      return f;
    }
  }
  function save(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch { }
  }
  // QA-004: corruption isn't always a JSON syntax error — a partial or
  // legacy write can leave VALID json of the WRONG shape (an object where
  // an array belongs, null entries). Guard at hydration so a bad value
  // falls back to the default instead of crashing the first render.
  function loadArr(k, f, filterEntry) {
    const v = load(k, f);
    if (!Array.isArray(v)) return f;
    return filterEntry ? v.filter(filterEntry) : v;
  }
  function clamp(n, mn, mx) {
    return Math.min(mx, Math.max(mn, n));
  }
  function num(v, f = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : f;
  }
  function fmt(n, d = 0) {
    return Number.isFinite(n) ? n.toFixed(d) : '—';
  }
  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      }[c])
    );
  }
  function haptic(ms) {
    try {
      if (navigator.vibrate && !reduceMotion) navigator.vibrate(ms);
    } catch { }
    // iOS: no Vibration API, but Safari 17.4+ fires a native Taptic tick
    // when a <input type="checkbox" switch> toggles — so we click a
    // hidden one (technique from the ios-haptics/web-haptics libs).
    if (!navigator.vibrate) iosHaptics.feedback(ms >= 20);
  }

  // Named vibration vocabulary so state changes are FEELABLE without
  // looking: verdicts pulse differently, shot start/finish are distinct.
  const HAPTIC_PATTERNS = {
    go: [14],                    // single short tick — committed
    manage: [32],                // single medium — caution
    bail: [38, 70, 38],          // triple pulse — think twice
    shotStart: [12, 60, 22],     // rising double — capture began
    shotFinish: [16],            // firm single — logged
  };
  function hapticPattern(name) {
    const p = HAPTIC_PATTERNS[name];
    if (p == null) return;
    try {
      if (navigator.vibrate && !reduceMotion) navigator.vibrate(p);
    } catch { }
    const gaps = {
      go: [], manage: [110], bail: [110, 110],
      shotStart: [60, 40], shotFinish: [],
    }[name];
    if (!navigator.vibrate) iosHaptics.pattern(gaps);
  }

  // Real haptics on iOS via Safari's switch-control tick. A hidden
  // <label for>+<input type=checkbox switch> pair is created once;
  // clicking the label toggles the switch and iOS pulses the Taptic
  // Engine. Repeated clicks are rate-limited (iOS ignores faster than
  // ~16ms); multi-tick patterns space clicks to read as distinct pulses.
  const iosHaptics = (() => {
    let label = null;
    let lastAt = 0;

    function ensure() {
      if (label) return label;
      if (typeof document === 'undefined' || !document.body) return null;
      try {
        const id = 'caddy-haptic-switch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('switch', '');
        input.id = id;
        input.style.all = 'initial';
        input.style.appearance = 'auto';
        input.style.display = 'none';
        label = document.createElement('label');
        label.setAttribute('for', id);
        label.style.display = 'none';
        label.appendChild(input);
        document.body.appendChild(label);
      } catch {
        label = null;
      }
      return label;
    }

    function tick() {
      if (reduceMotion) return;
      const now = performance.now();
      if (now - lastAt < 16) return; // iOS drops faster clicks anyway
      const l = ensure();
      if (!l) return;
      lastAt = now;
      try { l.click(); } catch { /* garnish, never load-bearing */ }
    }

    function feedback(strong) {
      if (strong) pattern([110]);
      else tick();
    }

    function pattern(gaps) {
      tick();
      let at = 0;
      (gaps || []).forEach((g) => {
        at += g;
        setTimeout(tick, at);
      });
    }

    return { feedback, pattern };
  })();

  const d2r = (d) => (d * Math.PI) / 180,
    r2d = (r) => (r * 180) / Math.PI,
    norm = (d) => ((d % 360) + 360) % 360;

  // ===== Onboarding =====
  let lastFocusBeforeOnboard = null;
  let obStep = 1;
  function shouldShowOnboard() {
    try {
      return localStorage.getItem(ONBOARD_KEY) !== '1';
    } catch {
      return true;
    }
  }
  function showObStep(n) {
    obStep = Math.min(3, Math.max(1, n));
    els.onboard.querySelectorAll('.ob-step').forEach((s) => {
      s.hidden = Number(s.dataset.step) !== obStep;
    });
    els.obDots.querySelectorAll('i').forEach((d, i) => {
      d.classList.toggle('on', i < obStep);
    });
    els.obNextBtn.hidden = obStep === 3;
    els.obStartBtn.hidden = obStep !== 3;
    const focusTarget =
      obStep === 3
        ? els.obStartBtn
        : obStep === 2
          ? els.obStdBagBtn
          : els.obNextBtn;
    requestAnimationFrame(() => {
      try {
        focusTarget.focus();
      } catch { }
    });
  }
  function showOnboard() {
    lastFocusBeforeOnboard = document.activeElement;
    els.onboard.hidden = false;
    els.onboard.classList.remove('hide');
    document.body.style.overflow = 'hidden';
    showObStep(1);
  }
  function dismissOnboard() {
    // Set the flag FIRST so a re-render can never flash the gate again.
    try {
      localStorage.setItem(ONBOARD_KEY, '1');
    } catch { }
    els.onboard.classList.add('hide');
    haptic(10);
    const done = () => {
      els.onboard.hidden = true;
      document.body.style.overflow = '';
      if (lastFocusBeforeOnboard instanceof HTMLElement) {
        try {
          lastFocusBeforeOnboard.focus();
        } catch { }
      }
      if (state.map) state.map.invalidateSize();
      if (state.sheet) state.sheet.measure();
      // Automatically start GPS so the user lands straight on the map
      // with their location — no extra tap on the GPS pill needed.
      if (!state.gpsRunning) startGPS();
    };
    if (reduceMotion) done();
    else setTimeout(done, 520);
  }
  function trapOnboardFocus(e) {
    if (e.key !== 'Tab' || els.onboard.hidden) return;
    const focusables = [
      ...els.onboard.querySelectorAll(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      ),
    ].filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0],
      last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  function initOnboard() {
    els.obNextBtn.addEventListener('click', () => showObStep(obStep + 1));
    els.obStdBagBtn.addEventListener('click', () => {
      state.clubs = DEFAULT_CLUBS.map((c) => ({ ...c, id: cryptoId() }));
      state.prefs.selectedClubId = '';
      save('caddy:clubs', state.clubs);
      save('caddy:prefs', state.prefs);
      renderClubs();
      haptic(10);
      showObStep(3);
    });
    // "Later" just moves on — the Bag tab is always there.
    els.obLaterBtn.addEventListener('click', () => showObStep(3));
    els.obStartBtn.addEventListener('click', dismissOnboard);
    els.obSkipBtn.addEventListener('click', dismissOnboard);
    document.addEventListener('keydown', trapOnboardFocus);
    if (shouldShowOnboard()) showOnboard();
    else els.onboard.hidden = true;
  }

  function setManifest() {
    const icon =
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0f7a43"/><circle cx="256" cy="204" r="102" fill="#ffffff"/><circle cx="216" cy="170" r="18" fill="#0f7a43" fill-opacity=".38"/><circle cx="296" cy="170" r="18" fill="#0f7a43" fill-opacity=".38"/><circle cx="256" cy="242" r="18" fill="#0f7a43" fill-opacity=".38"/><path d="M222 332h68c-3.4 27-13.2 50-26.5 63.5-6.6 6.8-11.7 6.8-18.3 0C231.8 382 225.4 359 222 332Z" fill="#ffffff"/></svg>`
      );
    const manifest = {
      name: 'Caddy',
      short_name: 'Caddy',
      description: 'Free personal-use golf caddy PWA.',
      start_url: '.',
      scope: '.',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#f5f7f4',
      theme_color: '#0f7a43',
      icons: [
        {
          src: icon,
          sizes: '192x192',
          type: 'image/svg+xml',
          purpose: 'any maskable',
        },
        {
          src: icon,
          sizes: '512x512',
          type: 'image/svg+xml',
          purpose: 'any maskable',
        },
      ],
    };
    els.manifestLink.href =
      'data:application/manifest+json,' +
      encodeURIComponent(JSON.stringify(manifest));
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      els.pwaStatus.textContent = 'Service workers not supported here.';
      return;
    }
    if (!/^https?:$/.test(location.protocol)) {
      els.pwaStatus.textContent =
        'Offline worker skipped on file:// — host over http(s).';
      return;
    }
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
      els.pwaStatus.textContent =
        'Offline support active. Previously-viewed map areas work offline.';
    } catch {
      els.pwaStatus.textContent =
        'Service worker registration failed; app still runs online.';
    }
  }

  // ---- Theme: light / dark / auto (follows the OS) ----------------------
  const THEME_MEDIA = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
  let systemDark = !!(THEME_MEDIA && THEME_MEDIA.matches);

  function resolvedDark() {
    if (!THEME_MEDIA) return true; // matchMedia unavailable → stay dark
    const t =
      state.prefs.theme === 'auto'
        ? 'auto'
        : state.prefs.theme === 'light'
          ? 'light'
          : 'dark';
    return t === 'auto' ? systemDark : t === 'dark';
  }

  function applyPrefs() {
    const dark = resolvedDark();
    document.body.classList.toggle('dark', dark);
    document.documentElement.style.backgroundColor = dark
      ? '#07100b'
      : '#f5f7f4';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    els.proToggleSheet.checked = !!state.prefs.pro;
    syncThemeSeg();
    const dispersionToggle = $('dispersionToggle');
    if (dispersionToggle) {
      dispersionToggle.checked = state.prefs.dispersionZone !== false;
    }
    els.proBreakdownWrap.style.display = state.prefs.pro ? 'block' : 'none';
    els.themeColorMeta.setAttribute(
      'content',
      dark ? '#07100b' : '#0f7a43'
    );
    save('caddy:prefs', state.prefs);
    if (state.sheet) requestAnimationFrame(() => state.sheet.measure());
  }
  function setPro(on) {
    state.prefs.pro = on;
    applyPrefs();
    if (state.lastCalc) renderBreakdown(state.lastCalc, els.rangeBreakdown);
  }
  function setTheme(theme) {
    const t = ['light', 'dark', 'auto'].includes(theme) ? theme : 'dark';
    state.prefs.theme = t;
    applyPrefs();
    haptic(5);
  }
  function syncThemeSeg() {
    document.querySelectorAll('#themeSeg .seg-opt').forEach((b) => {
      const on = b.dataset.theme === state.prefs.theme;
      b.classList.toggle('active', on);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
    });
  }
  function applyMode() {
    const m = state.prefs.mode || 'golf';
    document.body.setAttribute('data-mode', m);

    if (
      m === 'range' &&
      (state.prefs.activeTab === 'round' || state.prefs.activeTab === 'stats')
    ) {
      state.prefs.activeTab = 'range';
      showTab('range');
    }

    // Toggle buttons
    const opts = els.modeToggle?.querySelectorAll('.mode-opt');
    if (opts) {
      opts.forEach(b => {
        b.classList.toggle('active', b.dataset.mode === m);
        b.setAttribute('aria-checked', String(b.dataset.mode === m));
      });
    }



    // Practice card → only in Range
    const pc = document.getElementById('practiceCard');
    if (pc) {
      pc.style.display = m === 'range' ? '' : 'none';
      if (m === 'range') renderPracticeSection();
    }

    // Update coach/caddy pill label
    if (els.advicePillIc) {
      els.advicePillIc.textContent = m === 'range' ? '📋' : '💡';
    }
    if (els.advicePopTitle) {
      els.advicePopTitle.textContent =
        m === 'range' ? 'Practice notes' : 'Why this shot';
    }

    // Close any open pop when switching
    closeAdvice();

    // Recalc if we have a target
    if (state.target && state.loc) calculateRange();

    save('caddy:prefs', state.prefs);
    haptic(5);
  }


  function initModeToggle() {
    if (!els.modeToggle) return;
    els.modeToggle.querySelectorAll('.mode-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        state.prefs.mode = btn.dataset.mode;
        applyMode();
      });
    });
  }
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.prefs.activeTab = btn.dataset.tab;
        save('caddy:prefs', state.prefs);
        showTab(btn.dataset.tab);
        haptic(4);
      });
    });
    showTab(state.prefs.activeTab || 'range');
  }
  function showTab(tab) {
    const map = {
      range: 'rangeScreen',
      clubs: 'clubsScreen',
      shot: 'shotScreen',
      round: 'roundScreen',
      stats: 'statsScreen',
    };
    document.body.setAttribute('data-tab', tab);
    document
      .querySelectorAll('.screen')
      .forEach((s) => s.classList.remove('active'));
    document
      .querySelectorAll('.tab-btn')
      .forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $(map[tab] || 'rangeScreen').classList.add('active');
    const titles = {
      range: 'Play',
      round: 'Round',
      clubs: 'Bag',
      shot: 'Prep',
      stats: 'Stats',
    };
    const activeSection = $(map[tab] || 'rangeScreen');
    const bigTitle =
      activeSection && activeSection.querySelector('.large-title');
    if (bigTitle) bigTitle.textContent = titles[tab] || '';
    if (tab === 'range') {
      initMap();
      closeWindPop();
      renderPendingShot();
      // Keep the mapping pill honest after returning to the Play map
      // (mapping/failed state intentionally persists across tab switches).
      renderCourseMappingPill();
      setTimeout(() => {
        if (state.map) {
          state.map.invalidateSize();
          if (state.sheet) state.sheet.measure();
        }
      }, 80);
      setTimeout(() => {
        if (state.sheet) state.sheet.measure();
      }, 400);
      if (state.prefs.gpsEnabled && !state.gpsRunning) startGPS(true);
    } else if (tab !== 'round') {
      stopGPS();
    } else if (state.prefs.gpsEnabled && !state.gpsRunning) {
      // Keep GPS active in Round so nearby course recognition and
      // shot tracking have a fresh location.
      startGPS(true);
    }
    if (tab === 'stats') renderStats();
  }

  function migrateLayer(name) {
    // Only "satellite" and "osmstd" (labeled "Course") remain.
    // Everything legacy funnels to the OSM flat map.
    if (name === 'satellite') return 'satellite';
    return 'osmstd';
  }

  function initMap() {
    if (state.mapReady) return;
    if (!window.L) {
      $('map').innerHTML =
        "<div class='empty'>Leaflet failed to load. Check your connection.</div>";
      return;
    }
    const start = state.loc ? [state.loc.lat, state.loc.lng] : [39.5, -98.35];
    const zoom = state.loc ? 17 : 5;
    state.map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      tap: true,
      maxZoom: 21,
      minZoom: 5,
    }).setView(start, zoom);
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);
    setTimeout(() => {
      if (state.sheet) state.sheet.measure();
    }, 60);

    const esriImageryAttr =
      'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, GIS User Community';
    const imageryTiles =
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

    state.layers.satellite = L.layerGroup([
      L.tileLayer(imageryTiles, {
        attribution: esriImageryAttr,
        maxZoom: 21,
        maxNativeZoom: 19,
        updateWhenIdle: true,
        keepBuffer: 2,
      }),
    ]);

    state.map.on('click', (e) =>
      handleMapTap({ lat: e.latlng.lat, lng: e.latlng.lng })
    );
    state.map.on('dragstart', () => {
      if (state.followMode !== FollowMode.IDLE) {
        state.followMode = FollowMode.IDLE;
        syncFollowFab();
      }
    });
    state.mapReady = true;
    // --- shot-line pane: above tiles/overlay, below markers (600) ---
    if (!state.map.getPane('shotLinePane')) {
      state.map.createPane('shotLinePane');
      const p = state.map.getPane('shotLinePane');
      p.style.zIndex = 410;
      p.style.pointerEvents = 'none'; // never intercept map taps
    }
    // --- course pane: where the dispersion zone lands, below markers ---
    // Required by renderDispersionZone(): a layer targeting a pane that was
    // never created throws "Cannot read properties of undefined" when it
    // is first added to the map.
    if (!state.map.getPane('coursePane')) {
      state.map.createPane('coursePane');
      const p = state.map.getPane('coursePane');
      p.style.zIndex = 390;
      p.style.pointerEvents = 'none';
    }
    const topUI = document.querySelector('.range-top-ui');
    if (topUI && window.L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(topUI);
      L.DomEvent.disableScrollPropagation(topUI);
    }
    if (window.L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(els.gpsChip);
    }
    if (window.L && L.DomEvent && els.roundMapHud) {
      L.DomEvent.disableClickPropagation(els.roundMapHud);
      L.DomEvent.disableScrollPropagation(els.roundMapHud);
    }

    const initial = migrateLayer(state.prefs.mapLayer || 'satellite');
    setMapLayer(initial, true);
    if (state.loc) updateUserMarker();
  }

  function setMapLayer(name, silent) {
    if (!state.mapReady) return;
    name = migrateLayer(name);
    // Only "satellite" is handled here; "osmstd" is intercepted by the
    // OSM patch wrapper before reaching this function.
    const all = [state.layers.satellite, state.layers.osmstd];
    all.forEach((l) => {
      if (l && state.map.hasLayer(l)) state.map.removeLayer(l);
    });
    state.layers.satellite.addTo(state.map);
    els.rangeWrap.classList.add('is-sat');
    state.prefs.mapLayer = 'satellite';
    save('caddy:prefs', state.prefs);
    updateAimColor();
    restyleShotLines();
    if (state.loc && state.target) {
      renderDispersionZone(
        initialBearingDeg(state.loc, state.target),
        state.clubs.find((c) => c.id === state.lastRecClubId) || null
      );
    }
  }
  function updateAimColor() {
    const imagery = state.prefs.mapLayer === 'satellite';
    document.documentElement.style.setProperty(
      '--aim',
      imagery ? '#ffffff' : '#1677ff'
    );
  }

  const userIcon = () =>
    L.divIcon({
      className: '',
      html: "<div class='user-pulse'></div>",
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  const targetIcon = () =>
    L.divIcon({
      className: '',
      html: "<div class='target-pin'></div>",
      iconSize: [26, 26],
      iconAnchor: [13, 25],
    });
  const tapIcon = () =>
    L.divIcon({
      className: '',
      html: "<div class='two-tap-pin'></div>",
      iconSize: [19, 19],
      iconAnchor: [9, 9],
    });
  const greenCenterIcon = () =>
    L.divIcon({
      className: '',
      html: "<div class='green-center-dot'></div>",
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  const fbIcon = (kind) =>
    L.divIcon({
      className: '',
      html: `<div class='fb-dot ${kind}'></div>`,
      iconSize: [15, 15],
      iconAnchor: [7.5, 7.5],
    });
  const teeIcon = () =>
    L.divIcon({
      className: '',
      html: "<div class='tee-marker'></div>",
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });



  function startGPS(silentResume) {
    if (!navigator.geolocation) {
      state.gpsDenied = true;
      setNotice(
        'This browser does not support geolocation. Tap two map points to measure.',
        'danger'
      );
      updateGpsUI();
      return;
    }
    initMap();
    stopGPS();
    state.prefs.gpsEnabled = true;
    save('caddy:prefs', state.prefs);
    state.gpsRunning = true;
    state.gpsStartedAt = Date.now();
    state.fixSamples = [];
    state.lastAcceptedFix = null;
    state.consecutiveRejects = 0;
    kalman.reset();
    updateGpsUI('searching');
    if (!silentResume)
      setNotice(
        'Locating… On iPhone, allow Precise Location for the best yardages.',
        'greenish'
      );
    try {
      state.watchId = navigator.geolocation.watchPosition(
        onPosition,
        onPositionError,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
      );
    } catch {
      state.gpsRunning = false;
      setNotice(
        'GPS could not start. Tap two map points to measure.',
        'danger'
      );
    }
  }
  function stopGPS() {
    if (state.watchId !== null) {
      try {
        navigator.geolocation.clearWatch(state.watchId);
      } catch { }
      state.watchId = null;
    }
    state.gpsRunning = false;
    state.followMode = FollowMode.IDLE;
    syncFollowFab();
    if (state.loc) state.locStale = true;
    updateGpsUI();
  }

  function onPositionError(err) {
    state.gpsDenied = err && err.code === 1;
    updateGpsUI();
    const msg =
      err && err.code === 1
        ? 'GPS denied. Enable Location Services for your browser, allow Precise Location, then tap the GPS pill again. Last-known location is used if available; otherwise tap two map points to measure.'
        : 'GPS unavailable right now. Move outdoors with a clear sky, or tap two map points to measure.';
    setNotice(msg, 'danger');
    if (state.loc) {
      state.locStale = true;
      updateUserMarker();
      if (state.target) calculateRange();
    }
  }

  function updateUserMarker() {
    if (!state.mapReady || !state.loc) return;
    const ll = [state.loc.lat, state.loc.lng];
    if (!state.markers.user)
      state.markers.user = L.marker(ll, {
        icon: userIcon(),
        zIndexOffset: 900,
      }).addTo(state.map);
    else state.markers.user.setLatLng(ll);
    const radius = Math.max(1, state.loc.accuracy || 0);
    const col = state.locStale ? '#d38713' : '#1677ff';
    if (!state.markers.accuracy)
      state.markers.accuracy = L.circle(ll, {
        radius,
        color: col,
        weight: 1,
        fillColor: col,
        fillOpacity: 0.11,
        interactive: false,
      }).addTo(state.map);
    else {
      state.markers.accuracy.setLatLng(ll).setRadius(radius);
      state.markers.accuracy.setStyle({ color: col, fillColor: col });
    }
    updateLine();
  }

  let ignoreNextClick = false;

  function handleMapTap(latlng) {
    initMap();
    closeWindPop();
    if (ignoreNextClick) {
      ignoreNextClick = false;
      return;
    }
    if (state.placeMode && state.loc) {
      if (state.placeMode === 'front') {
        state.frontPt = latlng;
      } else if (state.placeMode === 'back') {
        state.backPt = latlng;
      } else if (state.placeMode === 'center') {
        state.greenCenter = latlng;
        if (!state.markers.greenCenter)
          state.markers.greenCenter = L.marker([latlng.lat, latlng.lng], {
            icon: greenCenterIcon(),
            interactive: false,
            zIndexOffset: 840,
          }).addTo(state.map);
        else state.markers.greenCenter.setLatLng([latlng.lat, latlng.lng]);
      } else if (state.placeMode === 'tee') {
        if (
          state.teePt &&
          haversineMeters(state.teePt, latlng) * M_TO_YD < 10
        ) {
          // Tapping on the existing tee removes it.
          state.teePt = null;
          setHoleTeePoint(null);
          setNotice('Tee removed for this hole.', 'greenish');
        } else {
          state.teePt = { lat: latlng.lat, lng: latlng.lng };
          setHoleTeePoint(state.teePt);
          setNotice('Tee saved for this hole. Tap Set tee, then the tee again, to remove it.', 'greenish');
        }
        renderTeeMarker();
        renderTeeRow();
      }
      disarmPlaceMode();
      renderFcb();
      updateLine();

      // FCB changes the green context, so refresh the recommendation,
      // smart-shot verdict, and caddy advice immediately.
      if (state.target) {
        calculateRange();
        scheduleContextUpdate();
      }

      haptic(10);
      return;
    }
    if (state.loc) {
      // Tapping moves ONLY the aim point. Green F/C/B is never touched.
      state.target = latlng;
      state.twoTapA = null;
      state.twoTapComplete = false;
      clearTwoTapMarkers();
      if (!state.markers.target)
        state.markers.target = L.marker([latlng.lat, latlng.lng], {
          icon: targetIcon(),
          zIndexOffset: 850,
        }).addTo(state.map);
      else state.markers.target.setLatLng([latlng.lat, latlng.lng]);
      save('caddy:lastTarget', state.target);
      rememberPinIfOnGreen();
      updateLine();
      calculateRange();
      scheduleContextUpdate();
      haptic(8);
      return;
    }
    if (state.twoTapComplete || !state.twoTapA) {
      state.twoTapComplete = false;
      state.twoTapA = latlng;
      clearTwoTapMarkers();
      state.markers.tapA = L.marker([latlng.lat, latlng.lng], {
        icon: tapIcon(),
      }).addTo(state.map);
      els.rawYards.textContent = '—';
      els.rawLabel.textContent = 'Tap second point';
      els.playsLikeYards.textContent = '—';
      if (els.aimChip) els.aimChip.hidden = true;
      if (els.bearingChip) els.bearingChip.hidden = true;
      return;
    }
    const a = state.twoTapA,
      b = latlng;
    clearTwoTapMarkers(true);
    state.markers.tapB = L.marker([b.lat, b.lng], {
      icon: tapIcon(),
    }).addTo(state.map);
    state.markers.twoTapLine = L.polyline(
      [
        [a.lat, a.lng],
        [b.lat, b.lng],
      ],
      { color: '#18a45b', weight: 4, opacity: 0.85 }
    ).addTo(state.map);
    const yd = haversineMeters(a, b) * M_TO_YD;
    els.rawYards.textContent = fmt(yd);
    els.rawLabel.textContent = 'yards between taps';
    els.playsLikeYards.textContent = fmt(yd);
    if (els.aimChip) els.aimChip.hidden = true;
    if (els.bearingChip) els.bearingChip.hidden = true;
    const rec = recommendClub(yd);
    els.clubRecommendation.textContent = rec.main;
    els.clubRecommendationSub.textContent =
      'Two-tap uses raw distance. Enable GPS for full plays-like.';
    renderCaddyTips([]);
    updateAdvice([], 'neutral');
    state.twoTapComplete = true;
  }
  // One source of truth for the green segmented control's two states:
  // data-place moves the sliding thumb to whichever point is being placed
  // right now, and each button's set-dot + aria-pressed reflect whether its
  // point exists on the map.
  function syncFcbSeg() {
    const seg = document.querySelector('.fcb-seg');
    if (seg) {
      if (state.placeMode) seg.setAttribute('data-place', state.placeMode);
      else seg.removeAttribute('data-place');
    }
    els.setFrontBtn.setAttribute('aria-pressed', String(!!state.frontPt));
    els.setCenterBtn.setAttribute('aria-pressed', String(!!state.greenCenter));
    els.setBackBtn.setAttribute('aria-pressed', String(!!state.backPt));
    const dots = [
      [els.setFrontBtn.querySelector('.fcb-set-dot'), !!state.frontPt],
      [els.setCenterBtn.querySelector('.fcb-set-dot'), !!state.greenCenter],
      [els.setBackBtn.querySelector('.fcb-set-dot'), !!state.backPt],
    ];
    dots.forEach(([dot, on]) => {
      if (dot) dot.hidden = !on;
    });
  }

  function armPlaceMode(mode) {
    if (!state.loc) {
      setNotice(
        'Get a GPS fix first, then tap Set Front / Center / Back.',
        'greenish'
      );
      return;
    }
    state.placeMode = state.placeMode === mode ? null : mode;
    syncFcbSeg();
    renderTeeRow();
    if (state.sheet) state.sheet.half();
    haptic(6);
  }
  function disarmPlaceMode() {
    state.placeMode = null;
    syncFcbSeg();
    renderTeeRow();
  }

  // Dedicated tee-box row: rendered only while a round is live, so the
  // green-edge segmented control stays a clean Front/Middle/Back trio
  // outside of play. Central updater for visibility, status copy, and the
  // armed/lit states of the Set-tee button.
  function renderTeeRow() {
    const row = document.getElementById('teeRow');
    const status = document.getElementById('teeRowStatus');
    if (!row) return;

    const inRound = !!state.roundSession;
    row.hidden = !inRound;
    if (!inRound || !status) return;

    if (state.placeMode === 'tee') {
      status.textContent = state.teePt
        ? 'Tap the tee on the map again to remove it'
        : 'Tap your tee box on the map';
    } else if (state.teePt) {
      status.textContent = 'Set for this hole';
    } else {
      status.textContent = 'Not set for this hole';
    }

    if (els.setTeeBtn) {
      els.setTeeBtn.classList.toggle('armed', state.placeMode === 'tee');
      els.setTeeBtn.classList.toggle(
        'lit',
        !!state.teePt && state.placeMode !== 'tee'
      );
      els.setTeeBtn.textContent =
        state.placeMode === 'tee'
          ? 'Cancel'
          : state.teePt
            ? 'Edit tee'
            : 'Set tee';
    }
  }

  function clearTwoTapMarkers(keepA) {
    ['tapB', 'twoTapLine'].forEach((k) => {
      if (state.markers[k]) {
        try {
          state.map.removeLayer(state.markers[k]);
        } catch { }
        state.markers[k] = null;
      }
    });
    if (!keepA && state.markers.tapA) {
      try {
        state.map.removeLayer(state.markers.tapA);
      } catch { }
      state.markers.tapA = null;
    }
  }
  function clearFbMarkers() {
    ['frontMarker', 'backMarker', 'leg2', 'greenCenter'].forEach((k) => {
      if (state.markers[k]) {
        try {
          state.map.removeLayer(state.markers[k]);
        } catch { }
        state.markers[k] = null;
      }
    });
    els.fcbFront.textContent = '—';
    els.fcbBack.textContent = '—';
  }
  function isImagery() {
    return state.prefs.mapLayer === 'satellite';
  }

  function updateLine() {
    if (!state.mapReady || !state.loc || !state.target) return;
    const pts = [
      [state.loc.lat, state.loc.lng],
      [state.target.lat, state.target.lng],
    ];
    if (!state.markers.lineCasing)
      state.markers.lineCasing = L.polyline(pts, {
        color: '#0c1410',
        weight: 9,
        opacity: 0.32,
        lineCap: 'round',
        interactive: false,
      }).addTo(state.map);
    else state.markers.lineCasing.setLatLngs(pts);
    if (!state.markers.lineHalo)
      state.markers.lineHalo = L.polyline(pts, {
        color: '#ffffff',
        weight: 7,
        opacity: 0.55,
        lineCap: 'round',
        interactive: false,
      }).addTo(state.map);
    else state.markers.lineHalo.setLatLngs(pts);
    if (!state.markers.line)
      state.markers.line = L.polyline(pts, {
        color: '#1677ff',
        weight: 3.5,
        opacity: 1,
        lineCap: 'round',
        className: 'aim-core',
        interactive: false,
      }).addTo(state.map);
    else state.markers.line.setLatLngs(pts);
    restyleShotLines();
    updateTargetGreenConnector();
  }
  // Dashed connector linking the aim target to the green middle, so the two
  // concepts are visually distinct. Hidden when they overlap or are missing.
  function updateTargetGreenConnector() {
    if (!state.mapReady) return;
    const gap =
      state.target && state.greenCenter
        ? haversineMeters(state.target, state.greenCenter) * M_TO_YD
        : 0;
    if (!gap || gap < 4) {
      if (state.markers.greenConnector && state.map) {
        state.map.removeLayer(state.markers.greenConnector);
        state.markers.greenConnector = null;
      }
      return;
    }
    const pts = [
      [state.target.lat, state.target.lng],
      [state.greenCenter.lat, state.greenCenter.lng],
    ];
    if (!state.markers.greenConnector)
      state.markers.greenConnector = L.polyline(pts, {
        color: '#34d399',
        weight: 2,
        opacity: 0.9,
        dashArray: '5 7',
        lineCap: 'round',
        interactive: false,
      }).addTo(state.map);
    else state.markers.greenConnector.setLatLngs(pts);
  }

  // ── Target-pin verdict tint + recommended-club dispersion zone ──
  function tintTargetPin(verdict) {
    const m = state.markers.target;
    if (!m) return;
    const el = m.getElement ? m.getElement() : m._icon;
    const pin = el && el.querySelector('.target-pin');
    if (!pin) return;
    pin.classList.remove('v-go', 'v-manage', 'v-bail');
    if (verdict === 'go' || verdict === 'manage' || verdict === 'bail') {
      pin.classList.add('v-' + verdict);
    }
  }

  // Verdict colors tint the ring EDGE only. The fill/base stay style-neutral
  // (white on satellite, soft blue on the course map) so the map never
  // drowns in green.
  function dispersionZoneColor(verdict) {
    if (verdict === 'go') return '#34d399';
    if (verdict === 'manage') return '#f5b14a';
    if (verdict === 'bail') return '#ff6b6b';
    return null; // caller falls back to the style-appropriate base color
  }

  // A 1σ landing ellipse: semi-major = distance sigma along the shot line,
  // semi-minor = lateral sigma across it.
  function ellipsePoints(center, bearingDeg, majorYd, minorYd, steps = 48) {
    const fr = enuFrame(center);
    const sinB = Math.sin(d2r(bearingDeg));
    const cosB = Math.cos(d2r(bearingDeg));
    const majorM = majorYd * YD_TO_M;
    const minorM = minorYd * YD_TO_M;
    const pts = [];
    for (let i = 0; i < steps; i++) {
      const t = (2 * Math.PI * i) / steps;
      const a = Math.cos(t) * majorM;
      const b = Math.sin(t) * minorM;
      const e = a * sinB - b * cosB;
      const n = a * cosB + b * sinB;
      const ll = fromENU(fr, e, n);
      pts.push([ll.lat, ll.lng]);
    }
    return pts;
  }

  // Exact landing distance, in yards, of a club's STOCK carry under the
  // current conditions — anchors the dispersion zone when the tapped target
  // is out of reach so the ring shows where the ball can actually land.
  function clubLandingYd(club, bearingDeg) {
    if (!club || !(club.yards > 0)) return 0;
    const w = getWeatherOrNeutral();
    const e = getElevationOrNeutral();
    const env = buildEnv({
      bearingDeg: norm(num(bearingDeg, 0)),
      elevDiffFt: e.targetFt - e.userFt,
      courseAltitudeFt: (e.targetFt + e.userFt) / 2,
      tempF: w.tempF,
      rh: w.rh,
      windMph: w.windMph,
      windFromDeg: w.windFromDeg,
      pressureHpa: w.pressureHpa,
      shearAlpha: w.shearAlpha,
      latDeg: state.loc ? state.loc.lat : STD_LAT,
    });
    return Math.max(1, carryUnder(club.yards, env));
  }

  function renderDispersionZone(bearingDeg, club) {
    if (
      !state.mapReady ||
      !state.map ||
      !state.loc ||
      !state.target ||
      !club
    ) {
      clearDispersionZone();
      return;
    }

    if (state.prefs.dispersionZone === false) {
      clearDispersionZone();
      return;
    }

    const sigD = clubSigmaDistYd(club);
    const sigL = clubSigmaLatYd(club);
    if (!(sigD > 1)) {
      clearDispersionZone();
      return;
    }

    // Out of reach? Draw the club's REAL landing zone along the shot line
    // instead of a hollow circle around a target it can never cover. The
    // same 1.08× reach threshold as the "Lay up" recommendation keeps the
    // ring and the advice consistent.
    let center = state.target;
    let outOfRange = false;
    const calc = state.lastCalc;
    if (
      calc &&
      Number.isFinite(calc.horizontalYd) &&
      Number.isFinite(calc.playsLikeYd) &&
      calc.playsLikeYd > club.yards * 1.08
    ) {
      const landingYd = clubLandingYd(club, bearingDeg);
      center = geodesicDirect(state.loc, bearingDeg, landingYd * YD_TO_M);
      outOfRange = true;
    }

    // Edge may tint with the verdict; the body stays style-neutral.
    const verdictColor = dispersionZoneColor(state.adviceVerdict || 'neutral');
    const img = isImagery();
    const base = img ? '#ffffff' : '#1677ff';
    const stroke = verdictColor && !outOfRange ? verdictColor : base;

    const pts = ellipsePoints(center, bearingDeg, sigD, sigL);
    const opts = {
      pane: 'coursePane',
      className: 'dispersion-zone',
      color: stroke,
      weight: 1.5,
      opacity: outOfRange ? 0.5 : 0.85,
      dashArray: outOfRange ? '3 6' : '6 7',
      fillColor: img ? '#ffffff' : '#1677ff',
      fillOpacity: outOfRange ? 0.07 : 0.12,
      interactive: false,
    };

    if (state.layers.dispersion) {
      state.layers.dispersion.setLatLngs(pts).setStyle(opts);
    } else {
      state.layers.dispersion = L.polygon(pts, opts).addTo(state.map);
    }
  }

  function clearDispersionZone() {
    if (state.layers.dispersion && state.map) {
      try {
        state.map.removeLayer(state.layers.dispersion);
      } catch { }
    }
    state.layers.dispersion = null;
  }

  function restyleShotLines() {
    const img = isImagery();
    if (state.markers.line) {
      state.markers.line.setStyle({
        color: img ? '#ffffff' : '#1677ff',
        weight: 3.5,
        opacity: 1,
      });
      if (state.markers.lineHalo)
        state.markers.lineHalo.setStyle({
          color: img ? '#0c1410' : '#ffffff',
          opacity: img ? 0.4 : 0.6,
          weight: 7,
        });
      if (state.markers.lineCasing)
        state.markers.lineCasing.setStyle({ opacity: 0.32, weight: 9 });
    }
    // --- Also restyle leg2 (leftover) line ---
    if (state.markers.leg2 && state.map && state.map.hasLayer(state.markers.leg2)) {
      const lo = state.greenCenter && state.target
        ? leftoverToGreen(state.loc, state.target, state.greenCenter)
        : null;
      const col =
        lo && lo.state === 'over' ? '#ff5252' : img ? '#ffffff' : '#1677ff';
      state.markers.leg2.setStyle({ color: col });
    }
  }
  function setNotice(text, kind = 'greenish') {
    if (!els.rangeNotice) return;
    els.rangeNotice.className = 'notice ' + kind;
    els.rangeNotice.textContent = text;
  }
  function setVerdict(v) {
    // Tint the rec card edge by trouble level.
    const card = $('recCard');
    if (!card) return;
    card.classList.remove('v-go', 'v-manage', 'v-bail');
    if (v === 'go') card.classList.add('v-go');
    else if (v === 'manage') card.classList.add('v-manage');
    else if (v === 'bail') card.classList.add('v-bail');

    // Haptic vocabulary fires ONLY when the verdict actually flips — GPS
    // recalcs at an unchanged target stay silent.
    if (v !== state.lastVerdict) {
      state.lastVerdict = v;
      if (v === 'go' || v === 'manage' || v === 'bail') hapticPattern(v);
    }
  }

  function scheduleContextUpdate() {
    clearTimeout(state.contextTimer);
    state.contextTimer = setTimeout(updateContext, 900);
  }
  async function cachedJSON(key, url, ttlMs) {
    const fullKey = 'caddy:api:' + key,
      cached = load(fullKey, null),
      now = Date.now();
    if (cached && now - cached.ts < ttlMs)
      return { data: cached.data, offline: false, ts: cached.ts };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8500);
      const res = await fetch(url, {
        signal: ctrl.signal,
        cache: 'no-store',
      });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      save(fullKey, { ts: now, data });
      return { data, offline: false, ts: now };
    } catch (e) {
      if (cached) return { data: cached.data, offline: true, ts: cached.ts };
      throw e;
    }
  }


  function sortedClubsDesc() {
    return [...state.clubs]
      .map((c) => ({ ...c, yards: num(c.yards, 0) }))
      .filter((c) => c.name && c.yards > 0)
      .sort((a, b) => b.yards - a.yards);
  }
  function sortedClubsAsc() {
    return sortedClubsDesc().reverse();
  }

  function renderCaddyTips(tips) {
    if (!els.caddyTips) return;
    els.caddyTips.innerHTML = (tips || [])
      .map((t) => `<div class="tip">${escapeHtml(t)}</div>`)
      .join('');
  }
  function renderShotPlan({
    calc,
    wind,
    elevation,
    accuracyYd,
    smart,
    verdict,
  }) {
    if (!els.shotAction || !els.shotPlanChips) return;

    const chips = [];
    const along = num(wind?.along, 0);
    const cross = num(wind?.cross, 0);

    let action = 'Aim center green and make a committed swing.';

    // One primary instruction only.
    if (Math.abs(calc.aimYd) >= 2) {
      action = `Aim ${Math.abs(calc.aimYd)} yd ${calc.aimYd > 0 ? 'right' : 'left'
        } of the target and let the wind move it back.`;
    } else if (along > 5) {
      action = 'Land it short of the flag — helping wind means more release.';
    } else if (along < -5) {
      action = 'Take enough club and make a full swing into the wind.';
    } else if (calc.elevAdjYd >= 3) {
      action = 'Commit to the uphill number — do not leave this one short.';
    } else if (calc.elevAdjYd <= -3) {
      action = 'Take less club and allow for extra release downhill.';
    } else if (verdict === 'bail') {
      action = 'Play to the safest part of the green or choose a layup target.';
    }

    if (smart && Number.isFinite(smart.pGreen)) {
      chips.push({
        label: `${Math.round(smart.pGreen * 100)}% green`,
        tone: verdict || 'neutral',
      });
    }

    if (Math.abs(along) >= 3) {
      chips.push({
        label: `${Math.round(Math.abs(along))} mph ${along > 0 ? 'helping' : 'into'
          }`,
        tone: 'wind',
      });
    } else if (Math.abs(cross) >= 3) {
      chips.push({
        label: `${Math.round(Math.abs(cross))} mph crosswind`,
        tone: 'wind',
      });
    }

    if (Math.abs(calc.elevAdjYd) >= 2) {
      chips.push({
        label: `${calc.elevAdjYd >= 0 ? '+' : ''}${Math.round(
          calc.elevAdjYd
        )} yd ${calc.elevAdjYd >= 0 ? 'uphill' : 'downhill'}`,
        tone: 'elevation',
      });
    }

    if (accuracyYd > ACCURACY_WARN_YD) {
      chips.push({
        label: `GPS ±${Math.round(accuracyYd)} yd`,
        tone: 'warning',
      });
    }

    els.shotAction.textContent = action;

    els.shotPlanChips.innerHTML = chips
      .slice(0, 3)
      .map(
        (chip) =>
          `<span class="rec-chip rec-chip--${escapeHtml(chip.tone)}">${escapeHtml(
            chip.label
          )}</span>`
      )
      .join('');
  }
  // ===== Advice on the map: a pill that opens a popover =====
  // Keeps the bottom sheet short by moving the tip list onto the map.
  state.adviceTips = [];
  let adviceCloseTimer = null;
  function updateAdvice(tips, verdict, rec) {
    state.adviceTips = Array.isArray(tips) ? tips.filter(Boolean) : [];
    state.adviceRec = rec || null;
    state.adviceVerdict = verdict || 'neutral';
    if (!els.advicePill) return;

    // The pill shows whenever there's a recommendation OR tips.
    const hasContent = !!state.adviceRec || state.adviceTips.length > 0;
    if (!hasContent) {
      els.advicePill.hidden = true;
      closeAdvice();
      return;
    }
    els.advicePill.hidden = false;
    positionBottomPills();
    const n = state.adviceTips.length;

    // Always a lightbulb; the badge carries the dynamic tip count.
    els.advicePillIc.textContent = (state.prefs.mode === 'range') ? '📋' : '💡';
    if (n > 0) {
      els.advicePillCount.hidden = false;
      els.advicePillCount.textContent = String(n);
    } else {
      els.advicePillCount.hidden = true;
    }
    els.advicePill.setAttribute(
      'aria-label',
      `Shot details — ${n} note${n === 1 ? '' : 's'}`
    );

    els.advicePill.classList.remove('v-go', 'v-manage', 'v-bail');
    if (verdict === 'go') els.advicePill.classList.add('v-go');
    else if (verdict === 'manage') els.advicePill.classList.add('v-manage');
    else if (verdict === 'bail') els.advicePill.classList.add('v-bail');

    // Keep whichever advice surface is open synchronized with new calculations.
    if (els.advicePop && !els.advicePop.hidden) {
      renderAdvicePop();
    }

    if (els.inlineAdvice && !els.inlineAdvice.hidden) {
      renderInlineAdvice();
    }
  }
  function renderAdvicePop() {
    if (!els.advicePopBody) return;
    const rec = state.adviceRec;
    let html = '';

    // Pinned headline: the club recommendation + plays-like number,
    // matching what the full sheet shows.
    if (rec) {
      html += `<div class="advice-pop-rec">
                <div class="advice-pop-rec-main">${escapeHtml(rec.main)}</div>
                ${Number.isFinite(rec.plays)
          ? `<div class="advice-pop-rec-plays">${fmt(
            rec.plays
          )} yd plays-like</div>`
          : ''
        }
                ${rec.sub
          ? `<div class="advice-pop-rec-sub">${escapeHtml(
            rec.sub
          )}</div>`
          : ''
        }
              </div>`;
    }

    if (state.adviceTips.length) {
      html += state.adviceTips
        .map(
          (t) =>
            `<div class="advice-pop-tip">${escapeHtml(
              t.replace(/^[🟢🟡🔴]\s*/u, '')
            )}</div>`
        )
        .join('');
    } else if (!rec) {
      html = `<div class="advice-pop-empty">No advice for this shot — make your normal swing.</div>`;
    }

    els.advicePopBody.innerHTML = html;
  }
  function renderInlineAdvice() {
    if (!els.inlineAdvice) return;

    const rec = state.adviceRec;
    const tips = Array.isArray(state.adviceTips)
      ? state.adviceTips.filter(Boolean)
      : [];

    const parts = [];

    if (rec && rec.sub) {
      parts.push(
        `<div class="inline-advice-headline">${escapeHtml(rec.sub)}</div>`
      );
    }

    if (tips.length) {
      parts.push(
        tips
          .map((tip) => {
            const cleanTip = String(tip).replace(/^[🟢🟡🔴]\s*/u, '');
            return `<div class="inline-advice-tip">${escapeHtml(cleanTip)}</div>`;
          })
          .join('')
      );
    }

    if (!parts.length) {
      parts.push(
        `<div class="inline-advice-tip">No extra shot notes are available for this target.</div>`
      );
    }

    els.inlineAdvice.innerHTML = parts.join('');
  }

  function openInlineAdvice() {
    if (!els.inlineAdvice || !els.shotDetailsBtn) return;

    renderInlineAdvice();
    els.inlineAdvice.hidden = false;
    els.shotDetailsBtn.setAttribute('aria-expanded', 'true');

    if (els.shotDetailsLabel) {
      els.shotDetailsLabel.textContent = 'Hide shot details';
    }

    haptic(5);
  }

  function closeInlineAdvice() {
    if (!els.inlineAdvice || !els.shotDetailsBtn) return;

    els.inlineAdvice.hidden = true;
    els.shotDetailsBtn.setAttribute('aria-expanded', 'false');

    if (els.shotDetailsLabel) {
      els.shotDetailsLabel.textContent = 'Why this shot?';
    }
  }

  function toggleInlineAdvice() {
    if (!els.inlineAdvice) return;

    if (els.inlineAdvice.hidden) openInlineAdvice();
    else closeInlineAdvice();
  }
  function openAdvice() {
    if (!els.advicePop || !state.adviceRec) return;

    if (adviceCloseTimer !== null) {
      clearTimeout(adviceCloseTimer);
      adviceCloseTimer = null;
    }

    renderAdvicePop();

    els.advicePopScrim.hidden = false;
    els.advicePop.hidden = false;

    void els.advicePop.offsetHeight;

    els.advicePopScrim.classList.add('open');
    els.advicePop.classList.add('open');

    haptic(6);
  }

  function closeAdvice() {
    if (!els.advicePop) return;

    if (adviceCloseTimer !== null) {
      clearTimeout(adviceCloseTimer);
      adviceCloseTimer = null;
    }

    els.advicePopScrim.classList.remove('open');
    els.advicePop.classList.remove('open');

    const done = () => {
      adviceCloseTimer = null;

      if (!els.advicePop.classList.contains('open')) {
        els.advicePop.hidden = true;
        els.advicePopScrim.hidden = true;
      }
    };

    if (reduceMotion) {
      done();
    } else {
      adviceCloseTimer = window.setTimeout(done, 260);
    }
  }
  function initAdvice() {
    if (els.shotDetailsBtn) {
      els.shotDetailsBtn.addEventListener('click', () => {
        const sheetIsExpanded =
          document.body.getAttribute('data-detent') === 'full';

        // In the full sheet, explanation belongs in the recommendation card.
        if (sheetIsExpanded) {
          toggleInlineAdvice();
          return;
        }

        // In collapsed/half mode, use the map popover because the card is hidden.
        if (els.advicePop && els.advicePop.hidden) openAdvice();
        else closeAdvice();
      });
    }

    if (els.advicePill) {
      els.advicePill.addEventListener('click', () => {
        closeWindPop();
        if (els.advicePop.hidden) openAdvice();
        else closeAdvice();
      });
    }

    if (els.advicePopClose) {
      els.advicePopClose.addEventListener('click', closeAdvice);
    }

    if (els.advicePopScrim) {
      els.advicePopScrim.addEventListener('click', closeAdvice);
    }

    if (window.L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(els.advicePill);
      L.DomEvent.disableClickPropagation(els.advicePop);
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (els.advicePop && !els.advicePop.hidden) closeAdvice();
        closeInlineAdvice();
      }
    });
  }
  function renderFcb() {
    // Persistent "set" state now lives in the set-dots + aria-pressed
    // (see syncFcbSeg). The tee has its own dedicated row and is managed
    // entirely by renderTeeRow().
    syncFcbSeg();
    renderTeeRow();

    // Tiles become tappable when their green reference exists; tapping
    // snaps the aim target there. The currently-aimed-at tile gets a ring.
    const markTile = (el, pt) => {
      const clickable = !!pt;
      el.classList.toggle('clickable', clickable);
      const isAim =
        clickable &&
        !!state.target &&
        haversineMeters(state.target, pt) * M_TO_YD < 1.5;
      el.classList.toggle('is-aim', isAim);
      el.onclick = clickable ? () => aimAtGreenRef(pt) : null;
    };

    if (!state.loc) {
      els.fcbFront.innerHTML = '—';
      els.fcbCenter.innerHTML = '—';
      els.fcbBack.innerHTML = '—';
      markTile(els.fcbFront, null);
      markTile(els.fcbCenter, null);
      markTile(els.fcbBack, null);
      return;
    }

    // Plays-like sub-label under each edge number when conditions move it
    // by 2+ yd — the raw yardage always stays the primary readout.
    const playsSub = (pt, raw) => {
      if (!pt || !(raw > 0)) return '';
      const pl = playsLikeFor(raw, initialBearingDeg(state.loc, pt));
      if (Math.abs(pl - raw) >= 2)
        return `<span class="fcb-pl">plays ${pl}</span>`;
      return '';
    };

    // Middle = the marked green middle ONLY. Never fall back to the aim target —
    // mixing the two concepts is what made "Center" confusing.
    const centerRef = state.greenCenter;
    const centerRaw = centerRef
      ? Math.round(haversineMeters(state.loc, centerRef) * M_TO_YD)
      : null;
    els.fcbCenter.innerHTML =
      centerRaw === null
        ? '—'
        : `${centerRaw}${playsSub(centerRef, centerRaw)}`;
    markTile(els.fcbCenter, centerRef);

    if (state.frontPt) {
      const fy = Math.round(
        haversineMeters(state.loc, state.frontPt) * M_TO_YD
      );
      els.fcbFront.innerHTML = `${fy}${playsSub(state.frontPt, fy)}`;
      if (!state.markers.frontMarker)
        state.markers.frontMarker = L.marker(
          [state.frontPt.lat, state.frontPt.lng],
          {
            icon: fbIcon('front'),
            interactive: false,
            zIndexOffset: 820,
          }
        ).addTo(state.map);
      else
        state.markers.frontMarker.setLatLng([
          state.frontPt.lat,
          state.frontPt.lng,
        ]);
    } else {
      els.fcbFront.innerHTML = '—';
      if (state.markers.frontMarker) {
        try {
          state.map.removeLayer(state.markers.frontMarker);
        } catch { }
        state.markers.frontMarker = null;
      }
    }
    markTile(els.fcbFront, state.frontPt);

    if (state.backPt) {
      const by = Math.round(haversineMeters(state.loc, state.backPt) * M_TO_YD);
      els.fcbBack.innerHTML = `${by}${playsSub(state.backPt, by)}`;
      if (!state.markers.backMarker)
        state.markers.backMarker = L.marker(
          [state.backPt.lat, state.backPt.lng],
          { icon: fbIcon('back'), interactive: false, zIndexOffset: 820 }
        ).addTo(state.map);
      else
        state.markers.backMarker.setLatLng([
          state.backPt.lat,
          state.backPt.lng,
        ]);
    } else {
      els.fcbBack.innerHTML = '—';
      if (state.markers.backMarker) {
        try {
          state.map.removeLayer(state.markers.backMarker);
        } catch { }
        state.markers.backMarker = null;
      }
    }
    markTile(els.fcbBack, state.backPt);
  }

  // Snap the aim target onto a marked green reference (Front/Middle/Back).
  function aimAtGreenRef(pt) {
    if (!pt || !state.mapReady) return;
    state.target = { lat: pt.lat, lng: pt.lng };
    state.twoTapA = null;
    state.twoTapComplete = false;
    clearTwoTapMarkers();
    if (!state.markers.target)
      state.markers.target = L.marker([pt.lat, pt.lng], {
        icon: targetIcon(),
        zIndexOffset: 850,
      }).addTo(state.map);
    else state.markers.target.setLatLng([pt.lat, pt.lng]);
    save('caddy:lastTarget', state.target);
    updateLine();
    calculateRange();
    scheduleContextUpdate();
    haptic(8);
  }


  // One-line explanation of what the aim target actually IS relative to the
  // marked green middle: Middle / Pin / Layup / past-middle.
  // Reads the SAME greenCenterOffset() the big label uses, so "yards to
  // middle" can never differ between the label and the chip.
  // The "Aim:" prefix is gone — the chip color and position carry the meaning,
  // which keeps it scannable from a cart or a glance.
  function setAimChip() {
    if (!els.aimChip) return;
    if (!state.target) {
      els.aimChip.hidden = true;
      return;
    }

    const off = greenCenterOffset();

    if (!off) {
      // No marked green middle: the tap is simply the pin target.
      els.aimChip.className = 'aim-chip pin';
      els.aimChip.innerHTML = '<b>Pin</b><span>no middle marked</span>';
      els.aimChip.hidden = false;
      return;
    }

    const lateralAbs = Number.isFinite(off.lateralYd)
      ? Math.abs(off.lateralYd)
      : 0;

    let cls;
    let head;
    let caption;

    if (off.state === 'on') {
      if (lateralAbs >= 8) {
        cls = 'pin';
        head = 'Pin';
        caption = `${Math.round(lateralAbs)} yd ${off.lateralYd > 0 ? 'right' : 'left'} of mid`;
      } else {
        cls = 'middle';
        head = 'Middle';
        caption = 'on your line';
      }
    } else if (off.state === 'short') {
      cls = 'layup';
      head = 'Layup';
      caption = `${Math.round(off.yards)} yd to middle`;
    } else {
      cls = 'over';
      head = 'Past middle';
      caption = `${Math.round(off.yards)} yd`;
    }

    els.aimChip.className = 'aim-chip ' + cls;
    els.aimChip.innerHTML = `<b>${head}</b><span>${caption}</span>`;
    els.aimChip.hidden = false;
  }
  function renderClubChips(playsYd) {
    const desc = sortedClubsDesc();
    els.clubChips.innerHTML =
      `<button class="club-chip${state.prefs.selectedClubId === '' ? ' active' : ''
      }" data-id="">Auto</button>` +
      desc
        .map(
          (c) =>
            `<button class="club-chip${state.prefs.selectedClubId === c.id ? ' active' : ''
            }${state.lastRecClubId === c.id && state.prefs.selectedClubId !== c.id
              ? ' recommended'
              : ''
            }" data-id="${escapeHtml(c.id)}">${escapeHtml(c.name)}<i>${fmt(
              c.yards
            )} yd</i></button>`
        )
        .join('');
    els.clubChips.querySelectorAll('.club-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        setSelectedClubId(chip.dataset.id, playsYd);
      });
    });
  }
  function setSelectedClubId(id, playsYdForChips) {
    state.prefs.selectedClubId = id || '';
    save('caddy:prefs', state.prefs);
    renderManualClubSelect();
    haptic(4);
    if (state.target) calculateRange();
    else renderClubChips(playsYdForChips || 0);
  }

  function renderClubs() {
    const clubs = sortedClubsDesc();
    els.clubsList.innerHTML = clubs
      .map((c) => {
        const st = clubStats(c.id);
        const stock = num(c.yards, 0);
        // Data contradicts the typed number beyond its own confidence
        // interval? Offer the measured carry as a one-tap fix.
        const contradicted =
          st &&
          Number.isFinite(st.ciLo) &&
          Number.isFinite(st.ciHi) &&
          (st.nEff || 0) >= SHOT_MIN_TRUST_N &&
          stock > 0 &&
          (stock < st.ciLo || stock > st.ciHi);
        const measured = st ? Math.round(st.meanPost) : stock;
        return `
        <div class="club-row" data-id="${escapeHtml(c.id)}">
          <input class="club-name-input" value="${escapeHtml(
          c.name
        )}" aria-label="${escapeHtml(c.name)} name" />
          <input class="club-yard-input" type="number" inputmode="numeric" value="${escapeHtml(
          c.yards
        )}" aria-label="${escapeHtml(c.name)} yards" />
          <div style="display:flex;flex-direction:column;gap:4px">
            <button class="small-btn delete-club" title="Delete">Delete</button>
            ${contradicted
            ? `<button class="small-btn sync-club" data-measured="${measured}" title="Adopt measured carry">→ ${measured} yd</button>`
            : ''
          }
          </div>
        </div>`;
      })
      .join('');
    els.clubsList.querySelectorAll('.club-row').forEach((row) => {
      const id = row.dataset.id;
      const nameInput = row.querySelector('.club-name-input');
      const yardInput = row.querySelector('.club-yard-input');
      nameInput.addEventListener('change', () =>
        updateClub(id, { name: nameInput.value.trim() || 'Club' })
      );
      yardInput.addEventListener('change', () =>
        updateClub(id, {
          yards: Math.max(1, Math.round(num(yardInput.value, 1))),
        })
      );
      row.querySelector('.delete-club').addEventListener('click', () => {
        state.clubs = state.clubs.filter((c) => c.id !== id);
        save('caddy:clubs', state.clubs);
        renderClubs();
        renderManualClubSelect();
        if (state.target) calculateRange();
      });
      const syncBtn = row.querySelector('.sync-club');
      if (syncBtn) {
        syncBtn.addEventListener('click', () => {
          updateClub(id, {
            yards: clamp(
              Math.round(num(syncBtn.dataset.measured, 0)),
              1,
              400
            ),
          });
          renderClubs();
          haptic(8);
        });
      }
    });
    renderManualClubSelect();
    if (typeof renderRoundShotUI === 'function') renderRoundShotUI();
  }
  function updateClub(id, patch) {
    state.clubs = state.clubs.map((c) =>
      c.id === id ? { ...c, ...patch } : c
    );
    save('caddy:clubs', state.clubs);
    renderManualClubSelect();
    if (state.target) calculateRange();
  }
  function renderManualClubSelect() {
    const sel = state.prefs.selectedClubId || '';
    els.manualClub.innerHTML =
      `<option value="">Auto recommend</option>` +
      sortedClubsDesc()
        .map(
          (c) =>
            `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} · ${fmt(
              c.yards
            )} yd</option>`
        )
        .join('');
    els.manualClub.value = sel;
  }
  function initClubsEvents() {
    els.resetClubsBtn.addEventListener('click', () => {
      if (!confirm('Reset clubs to Caddy defaults?')) return;
      state.clubs = DEFAULT_CLUBS.map((c) => ({ ...c, id: cryptoId() }));
      state.prefs.selectedClubId = '';
      save('caddy:clubs', state.clubs);
      save('caddy:prefs', state.prefs);
      renderClubs();
      if (state.target) calculateRange();
    });
    els.addClubBtn.addEventListener('click', () => {
      const name = els.newClubName.value.trim();
      const yards = Math.round(num(els.newClubYards.value, 0));
      if (!name || yards <= 0) {
        alert('Enter a club name and a positive carry yardage.');
        return;
      }
      state.clubs.push({ id: cryptoId(), name, yards });
      save('caddy:clubs', state.clubs);
      els.newClubName.value = '';
      els.newClubYards.value = '';
      renderClubs();
    });
    els.manualClub.addEventListener('change', () => {
      setSelectedClubId(els.manualClub.value);
    });
  }

  // Birdie red / bogey blue — the same convention every premium golf app uses.
  function scoreToneClass(score, par) {
    const s = Number(score);
    const p = clamp(Math.round(num(par, 4)), 3, 6);
    if (!Number.isFinite(s) || s <= 0) return '';
    if (s < p) return ' under';
    if (s > p) return ' over';
    return '';
  }

  // Two-state tab: no round → hero + CTA only; live round → full tools.
  // Called from BOTH renderRound and renderRoundShotUI so ending/starting
  // a round through either path re-flips the layout immediately.
  function syncRoundTabState() {
    const roundLive = !!state.roundSession;
    // The session card stays visible in BOTH states: with no round it's
    // just the hero + Start button; hiding it orphaned the CTA.
    const scorecardCard = document.getElementById('scorecardCard');
    const groupCard = document.getElementById('groupCard');
    const hero = document.getElementById('roundHero');
    if (scorecardCard && groupCard && hero) {
      scorecardCard.hidden = !roundLive;
      groupCard.hidden = !roundLive;
      hero.hidden = roundLive;
    }

    // "Last time out" chip: the most recent saved round, if any.
    const last = document.getElementById('heroLastRound');
    if (last && !roundLive) {
      const h = Array.isArray(state.history) ? state.history : [];
      const prev = h[h.length - 1];
      if (prev && prev.played) {
        const toPar = Number(prev.toPar);
        const vsPar =
          Number.isFinite(toPar) && toPar !== 0
            ? ` · ${toPar > 0 ? '+' : '−'}${Math.abs(toPar)}`
            : ' · E';
        const d = prev.date ? new Date(prev.date) : null;
        const when = d && !Number.isNaN(d.getTime())
          ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          : '';
        last.textContent = `Last time out · ${prev.totalScore} (${vsPar.trim()})${
          when ? ` · ${when}` : ''
        }`;
        last.hidden = false;
      } else {
        last.hidden = true;
      }
    }

    renderQuickStart();
  }

  function renderRound() {
    const course = getCurrentCourse();
    const scoreRows = getScorecardRows();
    renderGroupUI();

    syncRoundTabState();

    // Scorecard, Apple-style: OUT/IN nine structure with per-nine vs-par,
    // live total row, current-hole highlight, tap-to-cycle chips instead of
    // raw number inputs and native selects.
    const n = scoreRows.length;
    const front = scoreRows.slice(0, 9);
    const back = n > 9 ? scoreRows.slice(9, 18) : [];
    const nineSum = (rows) =>
      rows.reduce(
        (s, r) => s + (r.score !== '' && Number.isFinite(Number(r.score)) ? Number(r.score) : 0),
        0
      );
    const ninePlayed = (rows) =>
      rows.filter((r) => r.score !== '' && Number.isFinite(Number(r.score))).length;
    const curHole = getCurrentHoleNumber();
    const roundLive = !!state.roundSession;

    const cell = (r, i) => {
      const par = course?.holes?.[i]?.par || 4;
      const tone = scoreToneClass(r.score, par);
      const isCur = roundLive && i + 1 === curHole;
      const fir = r.fir === 'Y' ? ' fir-y' : r.fir === 'N' ? ' fir-n' : '';
      const gir = r.gir === 'Y' ? ' gir-y' : r.gir === 'N' ? ' gir-n' : '';
      return `
        <div class="round-row${isCur ? ' current' : ''}" data-i="${i}">
          <div class="round-cell hole"><b>${i + 1}</b><span>${par}</span></div>
          <button class="round-cell score-chip${tone}" data-act="score"
            aria-label="Hole ${i + 1} score, tap to change">${escapeHtml(r.score) || '·'}</button>
          <button class="round-cell putts-chip" data-act="putts"
            aria-label="Hole ${i + 1} putts, tap to change">${escapeHtml(r.putts) || '·'}</button>
          <button class="round-cell mark-chip${fir}" data-act="fir"
            aria-label="Hole ${i + 1} fairway">${r.fir === 'Y' ? '●' : r.fir === 'N' ? '○' : '·'}</button>
          <button class="round-cell mark-chip${gir}" data-act="gir"
            aria-label="Hole ${i + 1} green">${r.gir === 'Y' ? '●' : r.gir === 'N' ? '○' : '·'}</button>
        </div>`;
    };

    const nineBlock = (rows, offset, title) => {
      if (!rows.length) return '';
      const sum = nineSum(rows);
      const played = ninePlayed(rows);
      // vs-par over whichever holes in this nine actually carry scores
      // (order-independent — a skipped hole can't skew the number).
      const parPlayed = rows.reduce(
        (s, r, k) =>
          s + (r.score !== '' && Number.isFinite(Number(r.score))
            ? course?.holes?.[offset + k]?.par || 4
            : 0),
        0
      );
      const vsPar = played ? sum - parPlayed : null;
      return `
        <div class="round-nine">
          <div class="round-nine-head">
            <span>${title}</span>
            <b>${played ? sum : '·'}${vsPar != null ? `<i>${vsPar > 0 ? '+' + vsPar : vsPar}</i>` : ''}</b>
          </div>
          ${rows.map((r, k) => cell(r, offset + k)).join('')}
        </div>`;
    };

    const totalPlayed = ninePlayed(scoreRows);
    const totalScore = nineSum(scoreRows);
    const toPar = totalPlayed
      ? totalScore - scoreParPlayed(course, scoreRows)
      : null;

    // Quiet Clear: only meaningful once something is on the card.
    const hasEntries = scoreRows.some(
      (r) =>
        (r.score !== '' && r.score != null) ||
        (r.putts !== '' && r.putts != null) ||
        r.fir !== '' ||
        r.gir !== ''
    );
    els.clearRoundBtn.classList.toggle('disabled', !hasEntries);
    els.clearRoundBtn.setAttribute('aria-disabled', String(!hasEntries));

    els.roundRows.innerHTML = `
      <div class="round-row round-head-row">
        <div class="round-cell hole">Hole</div>
        <div class="round-cell">Score</div>
        <div class="round-cell">Putts</div>
        <div class="round-cell">FIR</div>
        <div class="round-cell">GIR</div>
      </div>
      ${nineBlock(front, 0, 'Front 9')}
      ${back.length ? nineBlock(back, 9, 'Back 9') : ''}
      <div class="round-total-row">
        <span>Total${totalPlayed ? ` · ${totalPlayed} played` : ''}</span>
        <b>${totalPlayed ? `${totalScore} (${toPar > 0 ? '+' + toPar : toPar})` : '—'}</b>
      </div>`;

    // Tap behavior: score & putts ALWAYS open the compact quick-fix sheet
    // (steppers + putts — the thing a mis-tap needs). The full sheet with
    // FIR/GIR/penalties stays one tap away inside it, and on the map's
    // Score button.
    els.roundRows.querySelectorAll('.round-row[data-i]').forEach((row) => {
      const i = Number(row.dataset.i);
      row.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        if (btn.dataset.act === 'score' || btn.dataset.act === 'putts') {
          openRoundMiniSheet(i + 1);
          haptic(6);
        } else {
          cycleRoundCell(i, btn.dataset.act);
        }
      });
    });
  }

  // Sum of par for only the holes actually played — the honest vs-par basis
  // mid-round (a +2 through 5 holes shouldn't read against full-card par).
  function scoreParPlayed(course, rows) {
    return rows.reduce(
      (s, r, i) =>
        s + (r.score !== '' && Number.isFinite(Number(r.score))
          ? course?.holes?.[i]?.par || 4
          : 0),
      0
    );
  }

  // One tap = one step through the natural cycle for each scorecard cell.
  // Score: +1 up to 15 then clear; Putts: 0→5 then clear;
  // FIR: Y→N→NA→clear (par-3 holes skip the meaningless Y step);
  // GIR: Y→N→clear.
  function cycleRoundCell(i, act) {
    const rows = getScorecardRows();
    const r = { ...(rows[i] || {}) };
    const course = getCurrentCourse();
    if (act === 'score') {
      const cur = r.score === '' ? null : Number(r.score);
      r.score = cur === null ? 1 : cur >= 15 ? '' : cur + 1;
    } else if (act === 'putts') {
      const cur = r.putts === '' ? null : Number(r.putts);
      r.putts = cur === null ? 0 : cur >= 5 ? '' : cur + 1;
    } else if (act === 'fir') {
      const par = course?.holes?.[i]?.par || 4;
      const seq = par === 3 ? ['N', 'NA', ''] : ['Y', 'N', 'NA', ''];
      const cur = seq.indexOf(r.fir === undefined ? '' : r.fir);
      r.fir = seq[(cur + 1) % seq.length];
    } else if (act === 'gir') {
      const seq = ['Y', 'N', ''];
      const cur = seq.indexOf(r.gir === undefined ? '' : r.gir);
      r.gir = seq[(cur + 1) % seq.length];
    }
    state.round[i] = {
      ...(state.round[i] || {}),
      hole: i + 1,
      score: r.score ?? '',
      putts: r.putts ?? '',
      fir: r.fir ?? '',
      gir: r.gir ?? '',
    };
    save('caddy:round', state.round);
    if (state.roundSession) {
      state.roundSession.scorecard = state.round;
      saveRoundSession();
    }
    haptic(4);
    syncRoundScorecard();
    renderRound();
    renderStats();
    renderRoundHoleHeader();
    renderRoundMapHud();
    renderGroupTable();
    // Hole just scored? Offer the next one (v1.0.67).
    maybePromptNextHole(i + 1, state.round[i].score);
    syncHoleAdvancePrompt();
  }
  function sanitizeInt(v) {
    if (v === '' || v == null) return '';
    const n = Math.max(0, Math.round(num(v, 0)));
    return String(n);
  }
  function initRoundEvents() {
    els.clearRoundBtn.addEventListener('click', () => {
      // Disabled until something is actually on the card.
      if (els.clearRoundBtn.classList.contains('disabled')) return;
      if (!confirm('Clear all scorecard entries for this round?')) return;

      state.round = emptyRound();

      if (state.roundSession) {
        state.roundSession.scorecard = state.round;
        saveRoundSession();
      }

      save('caddy:round', state.round);

      renderRound();
      renderRoundShotUI();
      renderStats();
    });
  }
  // ===== Round mode (minimal): GPS-measured shot tracking =====
  const ROUND_MIN_SHOT_YD = 8; // below this it's a putt/tap — ignore
  const ROUND_GPS_OK_M = 15; // need a fix at least this good to capture

  // ---- Screen Wake Lock -------------------------------------------------
  // Keeps the display on while a shot is in flight so the Finish button is
  // right there when you reach your ball. Silently no-ops where unsupported.
  let wakeLockSentinel = null;
  async function requestWakeLock() {
    try {
      if (navigator.wakeLock && !wakeLockSentinel) {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
        });
      }
    } catch { /* unsupported or denied — non-fatal */ }
  }
  function releaseWakeLock() {
    try {
      if (wakeLockSentinel) {
        wakeLockSentinel.release();
        wakeLockSentinel = null;
      }
    } catch { }
  }
  document.addEventListener('visibilitychange', () => {
    // Re-acquire after returning to the foreground if a shot is still live.
    if (!document.hidden && roundStatus() === 'pending') requestWakeLock();
  });


  /* ---- Course mapping state: pill UI + Start-round hard block ---- */

  function courseMappingBlocked() {
    return state.courseMappingState === 'mapping' || state.courseMappingState === 'failed';
  }

  function setCourseMapping(kind, opts = {}) {
    state.courseMappingState = kind;
    if (opts.name !== undefined) state.courseMappingName = opts.name;
    if (opts.retry !== undefined) state.courseMappingRetry = opts.retry;
    renderCourseMappingPill();
    syncStartRoundGate();
  }

  function clearCourseMapping() {
    if (state.courseMappingState === 'idle') return;
    setCourseMapping('idle', { name: '', retry: null });
  }

  /* ===== Premium mapping loader (v1.0.70) ============================
     Animated glass card with a flag-on-pole scan motif and staged copy,
     shared by scorecard mapping (map pill) AND the nearby-course list
     while a scorecard loads. Styles live in mapload.css; honors
     prefers-reduced-motion. ================================================== */

  const MAPLOAD_PHASES = [
    { title: 'Finding course…', sub: 'Matching your selection…' },
    { title: 'Contacting map data…', sub: 'Querying OpenStreetMap mirrors…' },
    { title: 'Drawing greens…', sub: 'Tracing holes, greens & water…' },
  ];
  const MAPLOAD_PHASE_MS = 1700;

  function maploadCardHtml(phaseIdx, variant = '') {
    const p = MAPLOAD_PHASES[Math.max(0, Math.min(phaseIdx, MAPLOAD_PHASES.length - 1))];
    return `
      <div class="mapload-card ${variant}">
        <svg class="mapload-flag" viewBox="0 0 48 48" aria-hidden="true">
          <line class="mapload-pole" x1="14" y1="6" x2="14" y2="42"></line>
          <path class="mapload-banner" d="M14 8 L34 13 L14 18 Z"></path>
          <ellipse class="mapload-scan" cx="24" cy="42" rx="5" ry="1.8"></ellipse>
        </svg>
        <div class="mapload-copy">
          <span class="mapload-title">${escapeHtml(p.title)}</span>
          <span class="mapload-sub">${escapeHtml(p.sub)}</span>
        </div>
        <div class="mapload-bar"><i></i></div>
      </div>`;
  }

  // Per-mount phase timers so the map pill and the nearby list can animate
  // independently without clobbering each other.
  const _maploadTimers = {};
  let _maploadFadeTimer = null;

  function maploadStopPhases(key) {
    if (_maploadTimers[key]) {
      clearTimeout(_maploadTimers[key]);
      delete _maploadTimers[key];
    }
  }

  function maploadStartPhases(key, onPhase, root) {
    maploadStopPhases(key);
    onPhase(0);
    let idx = 0;
    const tick = () => {
      idx = Math.min(idx + 1, MAPLOAD_PHASES.length - 1);
      onPhase(idx);
      if (idx < MAPLOAD_PHASES.length - 1) {
        _maploadTimers[key] = setTimeout(tick, MAPLOAD_PHASE_MS);
      }
    };
    if (MAPLOAD_PHASES.length > 1) {
      _maploadTimers[key] = setTimeout(tick, MAPLOAD_PHASE_MS);
    }
  }

  function renderCourseMappingPill(successHint = null) {
    const pill = els.courseMappingPill;
    if (!pill) return;
    const kind = state.courseMappingState;
    maploadStopPhases('pill');
    clearTimeout(_maploadFadeTimer);

    if (kind === 'idle') {
      pill.hidden = true;
      pill.innerHTML = '';
      return;
    }

    pill.hidden = false;

    if (kind === 'mapping') {
      pill.classList.remove('is-error', 'mapload-done');
      pill.innerHTML = maploadCardHtml(0, 'mapload-loading');
      maploadStartPhases('pill', (idx) => {
        const card = pill.querySelector('.mapload-card');
        if (!card) return;
        const p = MAPLOAD_PHASES[idx];
        const t = card.querySelector('.mapload-title');
        const s = card.querySelector('.mapload-sub');
        if (t) t.textContent = p.title;
        if (s) s.textContent = p.sub;
      }, pill);
    } else if (kind === 'failed') {
      pill.classList.add('is-error');
      const name = escapeHtml(state.courseMappingName || 'course');
      pill.innerHTML = `
        <div class="mapload-card mapload-error">
          <div class="mapload-copy">
            <span class="mapload-title">Couldn't map ${name}</span>
            <span class="mapload-sub">Map data didn't respond — round start is blocked.</span>
          </div>
          <button class="mapload-retry" type="button">Retry</button>
        </div>`;
      const btn = pill.querySelector('.mapload-retry');
      if (btn) {
        btn.addEventListener('click', () => {
          if (typeof state.courseMappingRetry === 'function') {
            haptic(8);
            state.courseMappingRetry();
          }
        });
      }
    } else if (kind === 'success') {
      pill.classList.remove('is-error');
      pill.classList.add('mapload-done');
      const hint = String(successHint || 'mapped').replace(/\s*✓\s*$/, '');
      pill.innerHTML = `
        <div class="mapload-card mapload-success">
          <div class="mapload-copy">
            <span class="mapload-title">✓ ${escapeHtml(hint)}</span>
          </div>
        </div>`;
      _maploadFadeTimer = setTimeout(() => {
        const card = pill.querySelector('.mapload-card');
        if (card) card.classList.add('mapload-fadeout');
      }, 1000);
    }
  }

  // Embed the same loader in the nearby-course status line while a picked
  // course's scorecard is downloading (shared phases, separate timer key).
  function renderNearbyScorecardLoader(statusEl) {
    if (!statusEl || !state.nearbyCourseLoadingScorecard) {
      maploadStopPhases('nearby');
      return false;
    }
    if (statusEl.querySelector('.mapload-card')) return true;
    statusEl.innerHTML = maploadCardHtml(0, 'mapload-loading mapload-inline');
    maploadStartPhases('nearby', (idx) => {
      const card = statusEl.querySelector('.mapload-card');
      if (!card) return;
      const p = MAPLOAD_PHASES[idx];
      const t = card.querySelector('.mapload-title');
      const s = card.querySelector('.mapload-sub');
      if (t) t.textContent = p.title;
      if (s) s.textContent = p.sub;
    }, statusEl);
    return true;
  }

  let _mappingFadeTimer = null;
  function flashMappingSuccess(hint) {
    setCourseMapping('success', { name: state.courseMappingName, retry: null });
    renderCourseMappingPill(hint);
    clearTimeout(_mappingFadeTimer);
    _mappingFadeTimer = setTimeout(() => {
      if (state.courseMappingState === 'success') clearCourseMapping();
    }, 1600);
  }

  let _toastTimer = null;
  function showAppToast(text) {
    const toast = els.appToast;
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2600);
  }

  // Disables the Start-round entry points while a mapping request is in
  // flight or has failed. Casual play (no course selected / idle) passes.
  function syncStartRoundGate() {
    const btn = els.roundActionBtn;
    if (!btn) return;
    const blocked =
      roundStatus() === 'idle' && courseMappingBlocked();
    // Keep the button clickable so a tap can explain WHY it's blocked
    // (startRound() hard-rejects while mapping); visual state only here.
    btn.classList.toggle('mapping-blocked', blocked);
    if (blocked) btn.textContent = 'Still mapping…';
  }

  function startRound() {
    // HARD BLOCK: a course scorecard is still being mapped (or its lookup
    // failed without a successful retry). Casual play (no pending course)
    // is unaffected.
    if (courseMappingBlocked()) {
      showAppToast(
        state.courseMappingState === 'failed'
          ? 'Course mapping failed — tap Retry on the map (or clear the course) before starting.'
          : `Still mapping ${state.courseMappingName || 'the course'} — hang on a second.`
      );
      haptic(20);
      return;
    }

    // Course setup is available.
    if (
      els.roundSetupSheet &&
      els.roundSetupScrim &&
      typeof openRoundSetup === 'function'
    ) {
      openRoundSetup();
      return;
    }

    // Safety fallback if setup UI is unavailable.
    beginRound(makeCasualCourse(), 1);
  }
  /* ============================================================
     ROUND FLOW UPGRADES — pin memory, auto hole-change prompt,
     shot trails, and the round-end summary sheet.
  ============================================================ */

  const PIN_MEMORY_KEY = 'caddy:pinMemory:v1';
  const HOLE_ADVANCE_RADIUS_YD = 35;   // show the prompt inside this radius of the next tee
  const HOLE_ADVANCE_EXIT_YD = 55;     // past this, a dismissed prompt re-arms
  let _holeAdvanceDismissedFor = null; // hole number whose prompt was swatted away

  function pinMemoryCourseKey(course) {
    return course ? String(course.id || course.name || 'course') : null;
  }
  function rememberedPin(key, holeNumber) {
    if (!key) return null;
    const mem = load(PIN_MEMORY_KEY, {});
    const p = mem?.[key]?.[String(holeNumber)];
    return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p : null;
  }
  // Called whenever the user taps an aim target: if it sits on/near the
  // marked green of a SAVED course, remember it as this hole's pin.
  function rememberPinIfOnGreen() {
    const course = getCurrentCourse();
    if (!course || course.id === 'casual' || !state.roundSession) return;
    if (!state.target || !state.greenCenter) return;
    const geo = greenGeometry();
    const depthYd = Math.max(12, num(geo?.depthStraight, 24));
    const radiusYd = clamp(depthYd * 0.8, 14, 42);
    const dYd = haversineMeters(state.target, state.greenCenter) * M_TO_YD;
    if (dYd > radiusYd) return;

    const key = pinMemoryCourseKey(course);
    const mem = load(PIN_MEMORY_KEY, {});
    mem[key] = mem[key] || {};
    mem[key][String(getCurrentHoleNumber())] = {
      lat: state.target.lat,
      lng: state.target.lng,
      ts: Date.now(),
    };
    save(PIN_MEMORY_KEY, mem);
  }

  /* ---------- Auto hole-change prompt ---------- */
  function hideHoleAdvanceChip() {
    if (els.holeAdvanceChip) els.holeAdvanceChip.hidden = true;
  }
  function checkHoleAdvancePrompt() {
    if (!els.holeAdvanceChip) return;
    const rs = state.roundSession;
    if (!rs || roundStatus() !== 'active' || !state.loc) {
      hideHoleAdvanceChip();
      return;
    }
    const total = getCourseHoleCount();
    if (rs.hole >= total) {
      hideHoleAdvanceChip();
      return;
    }
    // Index rs.hole == next hole's data (holes[] is 0-based).
    const teePt = getCurrentCourse()?.holes?.[rs.hole]?.teePoint;
    if (!teePt) {
      hideHoleAdvanceChip();
      return;
    }
    const yd = haversineMeters(state.loc, teePt) * M_TO_YD;
    if (yd <= HOLE_ADVANCE_RADIUS_YD) {
      if (_holeAdvanceDismissedFor !== rs.hole) {
        els.holeAdvanceChip.hidden = false;
        if (els.holeAdvanceText)
          els.holeAdvanceText.textContent = `Near Hole ${rs.hole + 1} tee`;
      }
    } else {
      if (yd > HOLE_ADVANCE_EXIT_YD) _holeAdvanceDismissedFor = null;
      hideHoleAdvanceChip();
    }
  }
  function advanceToNextHoleFromTee() {
    const rs = state.roundSession;
    if (!rs || roundStatus() !== 'active') return;
    if (rs.hole >= getCourseHoleCount()) return;
    rs.hole += 1;
    rs.currentHole = rs.hole;
    _holeAdvanceDismissedFor = null;
    saveRoundSession();
    hideHoleAdvanceChip();
    renderRound();
    renderRoundShotUI();
    haptic(10);
    setNotice(`Advanced to Hole ${rs.hole}.`, 'greenish');
  }

  /* ---------- Shot trail (this round's counted shots) ---------- */
  function renderShotTrail() {
    clearShotTrail();
    const rs = state.roundSession;
    if (!rs || !state.mapReady || !Array.isArray(rs.shots)) return;
    const done = rs.shots.filter((s) => s.counted && s.startPt && s.endPt);
    if (!done.length) return;
    const img = isImagery();
    const group = L.layerGroup();
    for (const s of done) {
      group.addLayer(
        L.polyline(
          [
            [s.startPt.lat, s.startPt.lng],
            [s.endPt.lat, s.endPt.lng],
          ],
          {
            pane: 'shotLinePane',
            color: img ? '#ffffff' : '#1677ff',
            weight: 2,
            opacity: 0.4,
            dashArray: '2 6',
            interactive: false,
          }
        )
      );
      const mid = midpointGeodesic(s.startPt, s.endPt);
      group.addLayer(
        L.marker([mid.lat, mid.lng], {
          icon: L.divIcon({
            className: '',
            html: `<div class="shot-trail-label">${s.distanceYd} yd</div>`,
            iconSize: [48, 16],
            iconAnchor: [24, 8],
          }),
          interactive: false,
          zIndexOffset: 700,
        })
      );
    }
    group.addTo(state.map);
    state.layers.shotTrail = group;
  }
  function clearShotTrail() {
    if (state.layers.shotTrail && state.map) {
      try {
        state.map.removeLayer(state.layers.shotTrail);
      } catch { }
    }
    state.layers.shotTrail = null;
  }

  /* ---------- Round-end summary sheet ---------- */
  function buildRoundSummary() {
    const course = getCurrentCourse();
    const s = summarizeRound(state.round);
    const tp = roundScoreToPar();
    const countedShots = (
      (state.roundSession && state.roundSession.shots) || []
    ).filter((x) => x.counted && Number.isFinite(x.distanceYd));
    const longest = countedShots.reduce(
      (best, x) => (!best || x.distanceYd > best.distanceYd ? x : best),
      null
    );
    const longestClub = longest
      ? state.clubs.find((c) => c.id === longest.clubId)?.name || 'Shot'
      : null;
    let best = null;
    state.round.forEach((r, i) => {
      const sc = Number(r.score);
      if (!Number.isFinite(sc) || sc <= 0) return;
      const par = clamp(Math.round(num(course?.holes?.[i]?.par, 4)), 3, 6);
      const d = sc - par;
      if (!best || d < best.d) best = { hole: i + 1, d };
    });
    const totalPen = state.round.reduce(
      (a, r) => a + (Number(r.penalties) || 0),
      0
    );
    return { course, s, tp, countedShots, longest, longestClub, best, totalPen };
  }
  function openRoundSummary() {
    if (!els.roundSummarySheet || !els.roundSummaryScrim) {
      teardownRoundSession(false); // markup missing — degrade gracefully
      return;
    }
    const sum = buildRoundSummary();
    els.roundSummaryMeta.textContent = [
      sum.course?.name || 'Casual Round',
      sum.course?.teeName,
      new Date().toLocaleDateString(),
    ]
      .filter(Boolean)
      .join(' · ');

    const played = !!sum.s.played;
    els.roundSummaryScore.textContent = played ? String(sum.s.totalScore) : '—';
    els.roundSummaryScore.classList.toggle('under', played && sum.tp.toPar < 0);
    els.roundSummaryScore.classList.toggle('over', played && sum.tp.toPar > 0);

    const rows = [];
    if (played) {
      rows.push([
        'Score',
        `${sum.s.totalScore} (${formatToPar(sum.tp.toPar)}) thru ${sum.tp.holesPlayed}`,
      ]);
    }
    rows.push([
      'Putts',
      sum.s.puttRows
        ? `${sum.s.totalPutts} · ${fmt(sum.s.totalPutts / Math.max(1, sum.s.puttRows), 2)} / hole`
        : '—',
    ]);
    rows.push([
      'Fairways',
      sum.s.firRows
        ? `${sum.s.firMade}/${sum.s.firRows} (${Math.round(sum.s.firCI.p * 100)}%)`
        : '—',
    ]);
    rows.push([
      'Greens',
      sum.s.girRows
        ? `${sum.s.girMade}/${sum.s.girRows} (${Math.round(sum.s.girCI.p * 100)}%)`
        : '—',
    ]);
    rows.push(['Shots logged', String(sum.countedShots.length)]);
    if (sum.longest)
      rows.push(['Longest drive', `${sum.longest.distanceYd} yd · ${sum.longestClub}`]);
    if (sum.best)
      rows.push([
        'Best hole',
        `#${sum.best.hole} (${sum.best.d >= 0 ? '+' : ''}${sum.best.d})`,
      ]);
    rows.push(['Penalties', String(sum.totalPen)]);

    // Side-by-side group card. Session-only data — shown here for the
    // post-round compare, never written into your history.
    const gt = groupTotals().filter((g) => g.thru > 0);
    if (gt.length) {
      rows.push(['— Group —', '']);
      gt.forEach((g) =>
        rows.push([g.name, `${g.total} · thru ${g.thru}`])
      );
    }

    els.roundSummaryBody.innerHTML = rows
      .map(
        ([k, v]) =>
          `<div class="break-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`
      )
      .join('');

    state._summaryTeardownPending = true;
    els.roundSummaryScrim.classList.add('open');
    els.roundSummarySheet.classList.add('open');
    els.roundSummarySheet.setAttribute('aria-hidden', 'false');
    haptic(6);
  }
  function closeRoundSummary(saveToHistory) {
    if (!els.roundSummarySheet || !els.roundSummaryScrim) return;
    els.roundSummarySheet.classList.remove('open');
    els.roundSummaryScrim.classList.remove('open');
    els.roundSummarySheet.setAttribute('aria-hidden', 'true');
    if (state._summaryTeardownPending) {
      state._summaryTeardownPending = false;
      teardownRoundSession(!!saveToHistory);
    }
  }
  function teardownRoundSession(saveToHistory) {
    const s = summarizeRound(state.round);
    if (saveToHistory && s.played) {
      state.history.push({ date: new Date().toISOString(), ...s });
      save('caddy:history', state.history);
    }
    // Keep this round's partners for next time (and for pre-round editing).
    if (state.roundSession)
      mergePartnersIntoRoster(state.roundSession.groupPlayers);
    state.roundSession = null;
    state.holeGeoKey = null;
    // The tee editor only exists inside a live round — drop any on-map tee
    // state with it so nothing leaks into the next session.
    state.teePt = null;
    renderTeeMarker();
    renderTeeRow();
    saveRoundSession();
    clearShotTrail();
    hideHoleAdvanceChip();
    renderRoundShotUI();
    renderStats();
    releaseWakeLock();
    haptic(10);
    setNotice(
      saveToHistory && s.played
        ? 'Round ended and saved to history.'
        : 'Round ended. The scorecard remains on the Stats tab.',
      'greenish'
    );
  }
  function endRound() {
    const rs = state.roundSession;
    if (!rs) return;
    if (rs.status === 'pending') {
      setNotice(
        'Finish or discard the current shot before ending the round.',
        'danger'
      );
      haptic(12);
      return;
    }
    openRoundSummary();
  }

  /* ---- End-round confirm (v1.0.69) --------------------------------------
     'End round' is destructive and was one accidental tap away from
     destroying a round. Every entry point now opens this glass action
     sheet first; only its explicit 'End round' button calls endRound(). */
  function requestEndRound() {
    const rs = state.roundSession;
    if (!rs) return;
    if (rs.status === 'pending') {
      setNotice(
        'Finish or discard the current shot before ending the round.',
        'danger'
      );
      haptic(12);
      return;
    }
    const hasScores =
      Array.isArray(rs.scorecard) &&
      rs.scorecard.some((h) => Number(h && h.score) > 0);
    const sub = document.getElementById('endRoundSub');
    if (sub) {
      sub.textContent = hasScores
        ? 'Your scorecard for this round will be saved.'
        : 'This round has no scores yet — nothing will be saved.';
    }
    const sheet = document.getElementById('endRoundSheet');
    if (!sheet || !els.roundScoreScrim) {
      endRound(); // markup unavailable (shouldn't happen) — legacy path
      return;
    }
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    els.roundScoreScrim.classList.add('open');
    haptic(8);
  }

  function closeEndRoundConfirm() {
    const sheet = document.getElementById('endRoundSheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    // Only drop the scrim if no other sheet is open behind this one.
    const anyOpen = [
      els.roundMiniSheet,
      els.roundScoreSheet,
      document.getElementById('roundOptionsSheet'),
      document.getElementById('quickStartSheet'),
    ].some((s) => s && s.classList.contains('open'));
    if (!anyOpen && els.roundScoreScrim) {
      els.roundScoreScrim.classList.remove('open');
    }
  }

  // Capture the start of a shot: snapshot position + recommended club +
  // intended bearing (to the current aim, if any) for future lateral calc.
  function startShot() {
    const rs = state.roundSession;
    if (!rs) return;
    if (!fixIsUsable()) {
      setNotice(
        `Need a GPS fix better than ±${Math.round(
          ROUND_GPS_OK_M
        )} m to start a shot. Wait for a green dot.`,
        'danger'
      );
      haptic(12);
      return;
    }
    const clubId = roundActiveClubId();
    const intendedBearing =
      state.target && state.loc
        ? initialBearingDeg(state.loc, state.target)
        : null;
    rs.pending = {
      clubId,
      startPt: { lat: state.loc.lat, lng: state.loc.lng },
      origStartPt: { lat: state.loc.lat, lng: state.loc.lng },
      startAcc: gpsAccMeters(),
      intendedBearing,
      ts: Date.now(),
    };
    rs.status = 'pending';
    saveRoundSession();
    renderRoundShotUI();
    requestWakeLock();
    setNotice(
      'Shot started. Drag the flag pin to fine-tune your start spot, then walk to your ball and tap Finish shot.',
      'greenish'
    );
    hapticPattern('shotStart');
  }



  function nextHole() {
    const rs = state.roundSession;

    if (!rs) return;

    if (rs.status === 'pending') {
      setNotice(
        'Finish or discard the current shot before changing holes.',
        'danger'
      );
      haptic(12);
      return;
    }

    const totalHoles = getCourseHoleCount();
    if (rs.hole >= totalHoles) {
      setNotice(
        `You are already on Hole ${totalHoles}. End the round when you are finished.`,
        'greenish'
      );
      return;
    }

    rs.hole += 1;
    rs.currentHole = rs.hole;

    saveRoundSession();
    renderRoundShotUI();
    renderRound();

    haptic(8);
  }

  function previousHole() {
    const rs = state.roundSession;

    if (!rs) return;

    if (rs.status === 'pending') {
      setNotice(
        'Finish or discard the current shot before changing holes.',
        'danger'
      );
      haptic(12);
      return;
    }

    if (rs.hole <= 1) {
      setNotice('You are already on Hole 1.', 'greenish');
      return;
    }

    rs.hole -= 1;
    rs.currentHole = rs.hole;

    saveRoundSession();
    renderRoundShotUI();
    renderRound();

    haptic(6);
  }

  /* ---- Hole-advance prompt (v1.0.67) ----
     After the current hole is scored, offer "Next hole?" as a glass card
     on the Play map. Auto-shows once per holed hole per round (tracked in
     localStorage); [Later] just dismisses — never nags. */

  let holePromptEl = null;
  let holePromptHole = 0;
  const HOLE_ADV_KEY = 'caddy:holeAdvPrompt';

  function hideHoleAdvancePrompt() {
    holePromptHole = 0;
    if (holePromptEl) holePromptEl.classList.remove('show');
  }

  // Safety: if the round moved on by any path, take the card down.
  function syncHoleAdvancePrompt() {
    const rs = state.roundSession;
    if (
      holePromptEl &&
      (!rs || holePromptHole !== rs.hole || rs.status === 'pending')
    ) {
      hideHoleAdvancePrompt();
    }
  }

  function maybePromptNextHole(holeNumber, score) {
    const rs = state.roundSession;
    const sc = Number(score);
    if (!rs || rs.status === 'pending') return;
    if (!Number.isFinite(sc) || sc < 1) return;
    if (holeNumber !== rs.hole) return; // only the hole you're playing
    const total = getCourseHoleCount();
    if (!(rs.hole < total)) return; // last hole: round-end flow owns it

    let done = null;
    try {
      done = JSON.parse(localStorage.getItem(HOLE_ADV_KEY) || 'null');
    } catch {}
    if (done && done.round === rs.startedAt && done.hole >= holeNumber)
      return; // already offered for this hole this round
    try {
      localStorage.setItem(
        HOLE_ADV_KEY,
        JSON.stringify({ round: rs.startedAt, hole: holeNumber })
      );
    } catch {}

    const course = getCurrentCourse();
    const par =
      (course &&
        course.holes &&
        Number(course.holes[holeNumber - 1] && course.holes[holeNumber - 1].par)) ||
      4;

    const wrap = document.getElementById('rangeWrap');
    if (!wrap) return;
    if (!holePromptEl) {
      holePromptEl = document.createElement('div');
      holePromptEl.className = 'rx-hole-prompt glass';
      holePromptEl.setAttribute('role', 'alertdialog');
      holePromptEl.setAttribute('aria-label', 'Hole complete');
      holePromptEl.innerHTML =
        '<div class="hp-text"></div>' +
        '<div class="hp-actions">' +
        '<button type="button" class="hp-btn hp-next">Next hole</button>' +
        '<button type="button" class="hp-btn hp-later">Later</button>' +
        '</div>';
      wrap.appendChild(holePromptEl);
      holePromptEl.querySelector('.hp-next').addEventListener('click', () => {
        hideHoleAdvancePrompt();
        nextHole(); // existing advance logic (blocks while a shot is pending)
      });
      holePromptEl.querySelector('.hp-later').addEventListener('click', () => {
        haptic(6);
        hideHoleAdvancePrompt();
      });
    }
    holePromptEl.querySelector('.hp-text').textContent =
      `Hole ${holeNumber} done — ${Math.round(sc)} · par ${par}. Next hole?`;
    holePromptHole = holeNumber;
    requestAnimationFrame(() => holePromptEl.classList.add('show'));
    haptic(10);
  }

  // Mid-round tee-box chips: re-apply an imported tee set onto the LIVE
  // round course (per-hole yardages, tee points, per-tee pars), then
  // refresh everything that displays them. Shown whenever the course
  // carries at least one imported tee set.
  function renderRoundTeePicker() {
    const wrap = document.getElementById('roundTeePickerWrap');
    const row = document.getElementById('roundTeePicker');
    if (!wrap || !row) return;
    const course = getCurrentCourse();
    const sets =
      course && Array.isArray(course.teeSets) ? course.teeSets : [];
    if (!state.roundSession || !sets.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const solo = sets.length === 1;
    row.innerHTML = sets
      .map((t) => {
        const on = t.name === course.activeTeeSet;
        return `<button type="button" class="tee-chip${on ? ' active' : ''}${
          solo ? ' static' : ''
        }"
          data-tee="${escapeHtml(t.name)}" aria-pressed="${on}">${escapeHtml(
          teeDisplayName(t.name)
        )}</button>`;
      })
      .join('');
    row.querySelectorAll('.tee-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        if (chip.dataset.tee === course.activeTeeSet) return;
        const updated = applyTeeSet(course, chip.dataset.tee);
        state.roundSession.course = updated;
        saveRoundSession();
        rememberCourseTees(updated);
        state.holeGeoKey = null; // force this hole's geometry to re-apply
        renderRoundShotUI();
        renderRound();
        setNotice(`Playing from ${updated.teeName}.`, 'greenish');
        haptic(6);
      });
    });
  }
  // Tee names: OSM courses without tagged tee colors import as 'default'.
  // Display that as "Regular tees" everywhere; stored keys stay 'default'
  // so tee memory and set matching keep working.
  function teeDisplayName(name) {
    const n = String(name || '').trim();
    if (!n || n.toLowerCase() === 'default') return 'Regular tees';
    return n;
  }

  function renderRoundHoleHeader() {
    if (!els.roundHoleStrip) return;

    const rs = state.roundSession;

    if (!rs) {
      els.roundHoleStrip.hidden = true;
      return;
    }

    const course = getCurrentCourse();
    const hole = getCurrentHoleData();
    const score = roundScoreToPar();

    els.roundHoleStrip.hidden = false;

    els.roundCourseName.textContent =
      course?.name || 'Casual Round';

    els.roundHoleNumber.textContent =
      `Hole ${getCurrentHoleNumber()}`;

    const holeMeta = [
      `Par ${hole.par || 4}`,
      hole.yards ? `${hole.yards} yd` : null,
      course?.teeName ? teeDisplayName(course.teeName) : null,
    ]
      .filter(Boolean)
      .join(' · ');

    els.roundHoleMeta.textContent = holeMeta;

    if (!score.holesPlayed) {
      els.roundScoreSummary.textContent = 'E through 0';
    } else {
      els.roundScoreSummary.textContent =
        `${formatToPar(score.toPar)} through ${score.holesPlayed}`;
    }
  }
  // Persist a manual tee for the current hole into the live round course.
  // Returns true when the edit could be stored (i.e., a round is active);
  // otherwise the marker is map-only for the session.
  function setHoleTeePoint(pt) {
    const course = getCurrentCourse();
    if (!course || !state.roundSession) return false;
    const idx = getCurrentHoleNumber() - 1;
    if (!course.holes[idx]) return false;
    course.holes[idx].teePoint = pt
      ? { lat: pt.lat, lng: pt.lng }
      : null;
    course.holes[idx].teeSource = pt ? 'manual' : undefined;
    state.roundSession.course = course;
    saveRoundSession();
    // Keep the setup template in sync so saving this course later
    // retains the manual tee.
    if (
      state.selectedCourseTemplate &&
      state.selectedCourseTemplate.id === course.id
    ) {
      state.selectedCourseTemplate = course;
    }
    return true;
  }

  function renderTeeMarker() {
    if (!state.mapReady) return;
    if (!state.teePt) {
      if (state.markers.teeMarker) {
        try { state.map.removeLayer(state.markers.teeMarker); } catch { }
        state.markers.teeMarker = null;
      }
      return;
    }
    const ll = [state.teePt.lat, state.teePt.lng];
    if (!state.markers.teeMarker)
      state.markers.teeMarker = L.marker(ll, {
        icon: teeIcon(),
        interactive: false,
        zIndexOffset: 830,
      }).addTo(state.map);
    else state.markers.teeMarker.setLatLng(ll);
  }

  // Push the current hole's imported geometry onto the map: green centre,
  // front/back edges, and an initial aim target. Keyed so it runs once per
  // hole change, not on every GPS tick.
  function applyHoleGeometryToMap({ resetAim = true } = {}) {
    const hole = getCurrentHoleData();
    if (!hole) return;

    const pt = (p) =>
      p &&
        Number.isFinite(Number(p.lat)) &&
        Number.isFinite(Number(p.lng))
        ? { lat: Number(p.lat), lng: Number(p.lng) }
        : null;

    const center = pt(hole.greenCenter);
    const front = pt(hole.front);
    const back = pt(hole.back);
    const tee = pt(hole.teePoint);

    if (!center && !front && !back && !tee) return;

    state.teePt = tee;

    disarmPlaceMode();
    clearFbMarkers();

    state.greenCenter = center;
    state.frontPt = front;
    state.backPt = back;

    if (center && state.mapReady) {
      state.markers.greenCenter = L.marker([center.lat, center.lng], {
        icon: greenCenterIcon(),
        interactive: false,
        zIndexOffset: 840,
      }).addTo(state.map);
    }

    // Default the aim point for the new hole. A remembered pin — where the
    // flag actually was last time this SAVED course/hole was played — beats
    // the green middle as the starting aim.
    if (resetAim && center && state.mapReady) {
      const mem = getCurrentCourse()
        ? rememberedPin(
          pinMemoryCourseKey(getCurrentCourse()),
          getCurrentHoleNumber()
        )
        : null;
      const aimPt = mem ? { lat: mem.lat, lng: mem.lng } : { ...center };
      state.target = aimPt;
      save('caddy:lastTarget', state.target);

      if (!state.markers.target) {
        state.markers.target = L.marker([aimPt.lat, aimPt.lng], {
          icon: targetIcon(),
          zIndexOffset: 850,
        }).addTo(state.map);
      } else {
        state.markers.target.setLatLng([aimPt.lat, aimPt.lng]);
      }
    }

    renderTeeMarker();
    renderTeeRow();
    renderFcb();
    updateLine();
    updateRestoreGreenBtn();

    if (state.target && state.loc) {
      calculateRange();
      scheduleContextUpdate();
    }
  }

  // Enable "Restore Green" only when the current round hole actually carries
  // imported front/middle/back geometry worth re-applying.
  function updateRestoreGreenBtn() {
    if (!els.restoreGreenBtn) return;
    const hole = getCurrentHoleData();
    const hasGeo =
      !!state.roundSession &&
      !!hole &&
      !!(hole.greenCenter || hole.front || hole.back);
    els.restoreGreenBtn.disabled = !hasGeo;
    els.restoreGreenBtn.style.opacity = hasGeo ? '1' : '0.45';
  }

  function syncHoleGeometry() {
    if (!state.roundSession || !state.mapReady) return;

    const key = `${state.roundSession.course?.id || ''}:${getCurrentHoleNumber()}`;
    if (key === state.holeGeoKey) return;

    state.holeGeoKey = key;
    updateRestoreGreenBtn();
    applyHoleGeometryToMap();
  }

  function renderRoundShotUI() {
    if (!els.roundActionBtn) return;
    const rs = state.roundSession;
    const status = roundStatus();
    syncRoundTabState();
    syncHoleAdvancePrompt();
    renderRoundHoleHeader();
    syncHoleGeometry();
    renderRoundTeePicker();

    // Status chip was retired with the top bar; keep a safe guard in case
    // any theme re-adds it.
    if (els.roundStatusChip) {
      els.roundStatusChip.textContent =
        status === 'idle'
          ? 'Not started'
          : status === 'pending'
            ? `Hole ${rs.hole} · shot in flight`
            : `Hole ${rs.hole} · ready`;
    }

    // Primary morphing button
    if (status === 'idle') {
      els.roundActionBtn.textContent = 'Start round';
      els.roundActionBtn.className = 'primary-btn';
    } else if (status === 'active') {
      els.roundActionBtn.textContent = 'Start shot';
      els.roundActionBtn.className = 'primary-btn';
    } else {
      els.roundActionBtn.textContent = 'Finish shot';
      els.roundActionBtn.className = 'primary-btn';
    }
    // Re-apply the mapping gate (it can override the idle label).
    syncStartRoundGate();

    // Sub-actions + end button visibility
    const inRound = status !== 'idle';
    els.roundSubActions.style.display = inRound ? 'grid' : 'none';
    els.roundEndBtn.style.display = inRound ? 'block' : 'none';
    els.roundDiscardBtn.style.display = status === 'pending' ? 'block' : 'none';
    els.roundNextHoleBtn.disabled = status === 'pending';
    els.roundNextHoleBtn.style.opacity = status === 'pending' ? '0.5' : '1';

    // Live readout while a shot is pending
    if (status === 'pending' && rs.pending) {
      const club = state.clubs.find((c) => c.id === rs.pending.clubId);
      let live = '—';
      if (fixIsUsable()) {
        const d =
          haversineMeters(rs.pending.startPt, {
            lat: state.loc.lat,
            lng: state.loc.lng,
          }) * M_TO_YD;
        live = `${Math.round(d)} yd`;
      }
      els.roundShotReadout.style.display = 'block';
      els.roundShotReadout.innerHTML = `<div class="v">${live}</div><div class="l">from start${club ? ` · ${escapeHtml(club.name)}` : ''
        } · walk to your ball</div>`;
    } else {
      els.roundShotReadout.style.display = 'none';
    }

    // Hint
    if (status === 'idle')
      els.roundShotHint.textContent =
        "Start a round to track your shots. Caddy measures each shot's distance from GPS and learns how far you really hit each club.";
    else if (status === 'active')
      els.roundShotHint.textContent =
        'Stand at your ball, pick your club on the Range tab, then tap Start shot.';
    else
      els.roundShotHint.textContent =
        'Shot in flight. Walk up to your ball and tap Finish shot — Caddy measures how far it actually went.';

    renderRoundShotList();
    renderRoundFab();
    renderRoundMapHud();
    renderPendingShot();
    renderShotTrail();
    checkHoleAdvancePrompt();
  }
  let _roundHudResizeBound = false;
  // Cap the live-round HUD so it can never cover the wind pill / recenter
  // cluster in the top-right corner, on any screen size.
  function constrainRoundHud() {
    const hud = els.roundMapHud;
    if (!hud) return;
    const rightCol = document.querySelector('.top-right-col');
    const rightW = rightCol ? rightCol.offsetWidth : 0;
    const available = window.innerWidth - rightW - 12 - 8 - 12;
    hud.style.maxWidth = `${Math.max(176, Math.round(available))}px`;
    if (!_roundHudResizeBound) {
      _roundHudResizeBound = true;
      window.addEventListener('resize', constrainRoundHud);
    }
  }

  function renderRoundMapHud() {
    if (!els.roundMapHud) return;

    const rs = state.roundSession;

    if (!rs || roundStatus() === 'idle') {
      els.roundMapHud.hidden = true;
      return;
    }

    const course = getCurrentCourse();
    const hole = getCurrentHoleData();
    const score = roundScoreToPar();
    const pending = roundStatus() === 'pending';

    els.roundMapHud.hidden = false;

    els.roundMapCourse.textContent = course?.name || 'Casual Round';

    els.roundMapHole.textContent = [
      `H${getCurrentHoleNumber()}`,
      `Par ${hole.par || 4}`,
      hole.yards ? `${hole.yards} yd` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    els.roundMapScore.textContent =
      score.holesPlayed
        ? `${formatToPar(score.toPar)}`
        : 'E';

    // Birdie-red / bogey-blue on the live to-par readout, matching the
    // scorecard convention.
    els.roundMapScore.classList.remove('to-par-under', 'to-par-over');
    if (score.holesPlayed && score.toPar < 0)
      els.roundMapScore.classList.add('to-par-under');
    else if (score.holesPlayed && score.toPar > 0)
      els.roundMapScore.classList.add('to-par-over');

    // Status line doubles as a last-shot recall: the most recent logged
    // distance rides along so you can sanity-check club choice mid-hole.
    const lastShot = Array.isArray(rs.shots)
      ? [...rs.shots].reverse().find((s) => s.counted)
      : null;
    els.roundMapStatus.textContent = pending
      ? 'Shot in flight'
      : [
        score.holesPlayed ? `Thru ${score.holesPlayed}` : 'Ready',
        lastShot ? `last ${lastShot.distanceYd} yd` : null,
      ]
        .filter(Boolean)
        .join(' · ');

    if (els.roundMapPrevBtn) {
      els.roundMapPrevBtn.disabled = pending || rs.hole <= 1;
    }

    if (els.roundMapNextBtn) {
      els.roundMapNextBtn.disabled = pending || rs.hole >= getCourseHoleCount();
    }

    if (els.roundMapScoreBtn) {
      els.roundMapScoreBtn.disabled = pending;
      els.roundMapScoreBtn.style.opacity = pending ? '0.5' : '1';
    }

    constrainRoundHud();
  }

  // The on-map round action FAB. Mirrors the Round-tab state machine so
  // the live shot loop never requires leaving the Range view.
  function renderRoundFab() {
    if (!els.roundFabWrap) return;
    const status = roundStatus();

    // Hidden entirely outside an active round.
    if (status === 'idle') {
      els.roundFabWrap.hidden = true;
      els.roundLive.hidden = true;
      return;
    }
    els.roundFabWrap.hidden = false;

    const usable = fixIsUsable();

    if (status === 'active') {
      els.roundFab.classList.remove('pending');
      els.roundFabText.textContent = usable ? 'Start shot' : 'GPS…';
      els.roundFab.classList.toggle('waiting', !usable);
      els.roundLive.hidden = true;
      // Show which club this shot will log against.
      const club = state.clubs.find((c) => c.id === roundActiveClubId());
      if (club && els.roundFabClub) {
        els.roundFabClub.hidden = false;
        els.roundFabClubName.textContent = club.name;
      } else if (els.roundFabClub) {
        els.roundFabClub.hidden = true;
      }
      return;
    }

    // status === "pending" — no club editing mid-flight.
    if (els.roundFabClub) els.roundFabClub.hidden = true;
    closeClubPop();
    els.roundFab.classList.add('pending');
    els.roundFab.classList.toggle('waiting', !usable);
    els.roundFabText.textContent = usable ? 'Finish shot' : 'GPS…';

    const rs = state.roundSession;
    if (rs && rs.pending && usable) {
      const d =
        haversineMeters(rs.pending.startPt, {
          lat: state.loc.lat,
          lng: state.loc.lng,
        }) * M_TO_YD;
      els.roundLiveV.textContent = Math.round(d);
      els.roundLiveL.textContent = 'yd from start';
      els.roundLive.hidden = false;
    } else {
      els.roundLive.hidden = true;
    }
  }

  function renderClubPop() {
    if (!els.roundClubPop) return;
    const activeId = roundActiveClubId();
    els.roundClubPop.innerHTML = sortedClubsDesc()
      .map(
        (c) =>
          `<button class="round-club-opt${c.id === activeId ? ' active' : ''
          }" data-id="${escapeHtml(c.id)}" type="button">${escapeHtml(
            c.name
          )}<span class="yd">${fmt(c.yards)}</span></button>`
      )
      .join('');
    els.roundClubPop.querySelectorAll('.round-club-opt').forEach((b) => {
      b.addEventListener('click', () => {
        if (state.roundSession) {
          state.roundSession.chosenClubId = b.dataset.id;
          saveRoundSession();
        }
        closeClubPop();
        renderRoundFab();
        haptic(6);
      });
    });
  }
  function openClubPop() {
    if (!els.roundClubPop) return;
    renderClubPop();
    els.roundClubPop.hidden = false;
  }
  function closeClubPop() {
    if (els.roundClubPop) els.roundClubPop.hidden = true;
  }
  function toggleClubPop() {
    if (!els.roundClubPop) return;
    if (els.roundClubPop.hidden) openClubPop();
    else closeClubPop();
  }

  function renderRoundShotList() {
    const rs = state.roundSession;
    // The shot list lives in a collapsed <details>; hide it entirely when
    // there's nothing to show.
    const wrap = document.getElementById('roundShotListWrap');
    // Legacy sessions (saved before shot tracking shipped) may have no
    // `shots` array at all — guard before touching .length.
    if (!rs || !Array.isArray(rs.shots) || !rs.shots.length) {
      els.roundShotList.innerHTML = '';
      if (wrap) wrap.hidden = true;
      return;
    }
    if (wrap) wrap.hidden = false;
    const rows = [...rs.shots]
      .slice(-12)
      .reverse()
      .map((sh) => {
        const club = state.clubs.find((c) => c.id === sh.clubId);
        const name = club ? club.name : 'Shot';
        let tag = sh.counted
          ? 'logged'
          : sh.discarded
            ? 'discarded'
            : 'uncounted';
        return `<div class="shot-item${sh.discarded ? ' discarded' : ''}">
                <span>H${sh.hole} · ${escapeHtml(name)}</span>
                <span><b>${sh.distanceYd
          } yd</b> <span class="tag">${tag}</span></span>
              </div>`;
      })
      .join('');
    const counted = rs.shots.filter((s) => s.counted).length;
    els.roundShotList.innerHTML =
      `<div class="hint" style="margin:4px 0 6px;font-weight:800">Shots this round · ${rs.shots.length} (${counted} logged)</div>` +
      rows;
  }
  // Reflect a template/course's hole layout (9 or 18) onto the setup UI.
  function applyTemplateHoleCount(course) {
    state.setupHolesCount =
      course && Number(course.holesCount) === 9 ? 9 : 18;
    syncHolesCountUI();
    renderRoundSetupStartHoleOptions();
  }

  function syncHolesCountUI() {
    const nine = state.setupHolesCount === 9;
    const nb = document.getElementById('setupNineBtn');
    const eb = document.getElementById('setupEighteenBtn');
    if (!nb || !eb) return;
    nb.classList.toggle('active', nine);
    eb.classList.toggle('active', !nine);
    nb.setAttribute('aria-pressed', String(nine));
    eb.setAttribute('aria-pressed', String(!nine));
  }

  function openRoundSetup() {
    state.selectedNearbyCourse = null;
    state.selectedCourseTemplate = null;
    state.nearbySearchError = null;

    if (!els.roundSetupSheet || !els.roundSetupScrim) return;

    const savedSetup = load(LAST_ROUND_SETUP_KEY, {
      courseName: 'Casual Round',
      teeName: 'Regular tees',
      startHole: 1,
      holes: defaultCourseHoles(),
    });

    state.setupHolesCount =
      Number(savedSetup.holesCount) === 9 ? 9 : 18;
    syncHolesCountUI();

    renderRoundSetupCourseSelect();
    renderRoundSetupStartHoleOptions();
    renderSavedCourseList();

    // Fresh sheet: nothing pre-selected. Course finding is the primary
    // path; saved courses and manual entry live below it.
    state.selectedCourseTemplate = null;
    els.roundSetupCourseName.value = '';
    els.roundSetupTeeName.value = 'Regular tees';

    const manual = document.getElementById('manualRoundWrap');
    if (manual) manual.open = false;

    els.roundSetupStartHole.value = String(
      clamp(Math.round(num(savedSetup.startHole, 1)), 1, 18)
    );

    els.roundSetupSaveCourse.checked = true;

    renderTeeSetPicker(null);
    renderRoundSetupHoles(defaultCourseHoles());

    renderNearbyCourses();

    if (!state.loc || state.locStale) {
      if (!state.gpsRunning) startGPS(true);
    } else if (!state.nearbyCourses.length) {
      findNearbyCourses();
    }

    els.roundSetupSheet.classList.add('open');
    els.roundSetupScrim.classList.add('open');
    els.roundSetupSheet.setAttribute('aria-hidden', 'false');

    haptic(6);
  }

  function closeRoundSetup() {
    if (!els.roundSetupSheet || !els.roundSetupScrim) return;

    els.roundSetupSheet.classList.remove('open');
    els.roundSetupScrim.classList.remove('open');
    els.roundSetupSheet.setAttribute('aria-hidden', 'true');
  }

  function renderRoundSetupStartHoleOptions() {
    if (!els.roundSetupStartHole) return;

    const n = state.setupHolesCount === 9 ? 9 : 18;
    els.roundSetupStartHole.innerHTML = Array.from(
      { length: n },
      (_, i) =>
        `<option value="${i + 1}">Hole ${i + 1}</option>`
    ).join('');
  }

  function renderRoundSetupCourseSelect() {
    if (!els.roundSetupCourseSelect) return;

    const profiles = Array.isArray(state.courseProfiles)
      ? state.courseProfiles
      : [];

    els.roundSetupCourseSelect.innerHTML =
      `<option value="">New casual round</option>` +
      profiles
        .map(
          (course) =>
            `<option value="${escapeHtml(course.id)}">${escapeHtml(
              course.name
            )} · ${escapeHtml(teeDisplayName(course.teeName))}</option>`
        )
        .join('');
  }

  // Saved-course cards for the New-round sheet — the primary way to start.
  // One card per course (tees are a property of the course, not a second
  // profile); tapping loads name, tees and scorecard in one go.
  function renderSavedCourseList() {
    const list = document.getElementById('savedCourseList');
    if (!list) return;

    const profiles = Array.isArray(state.courseProfiles)
      ? state.courseProfiles
      : [];

    // The saved-courses section only exists when there's something in it.
    const wrap = document.getElementById('savedCoursesWrap');
    const count = document.getElementById('savedCourseCount');
    if (count) count.textContent = profiles.length ? String(profiles.length) : '';
    if (wrap) wrap.hidden = !profiles.length;

    if (!profiles.length) {
      list.innerHTML = '';
      return;
    }

    const sorted = [...profiles].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    );
    const sel = state.selectedCourseTemplate;

    list.innerHTML = sorted
      .map((course) => {
        const selected = !!sel && sel.id === course.id;
        const holes = Number(course.holesCount) === 9 ? '9 holes' : '18 holes';
        return `
          <button class="saved-course-card${selected ? ' selected' : ''}"
            type="button" data-id="${escapeHtml(course.id)}">
            <span class="sc-name">${escapeHtml(course.name)}</span>
            <span class="sc-meta">${escapeHtml(
              teeDisplayName(course.teeName)
            )} · ${holes}</span>
          </button>`;
      })
      .join('');

    list.querySelectorAll('.saved-course-card').forEach((card) => {
      card.addEventListener('click', () => {
        const found = profiles.find((c) => c.id === card.dataset.id);
        if (found) selectSavedCourse(found);
      });
    });
  }

  // Quick-start cards on the no-round screen: recent courses, one tap to
  // tee off with the remembered tee set. Fills the dead space below the
  // Start button with the action players actually want.
  function renderQuickStart() {
    const wrap = document.getElementById('quickStartWrap');
    const list = document.getElementById('quickStartList');
    if (!wrap || !list) return;

    const profiles = Array.isArray(state.courseProfiles)
      ? state.courseProfiles
      : [];

    if (state.roundSession || !profiles.length) {
      wrap.hidden = true;
      list.innerHTML = '';
      return;
    }

    // Most recently played first (saveCourseProfile bumps updatedAt).
    const recent = profiles
      .slice()
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, 3);

    wrap.hidden = false;
    list.innerHTML = recent
      .map((course) => {
        const holes =
          Number(course.holesCount) === 9 ? '9 holes' : '18 holes';
        return `
          <button class="saved-course-card" type="button"
            data-id="${escapeHtml(course.id)}">
            <span class="sc-name">${escapeHtml(course.name)}</span>
            <span class="sc-meta">${escapeHtml(
              teeDisplayName(course.teeName)
            )} · ${holes}</span>
          </button>`;
      })
      .join('');

    list.querySelectorAll('.saved-course-card').forEach((card) => {
      card.addEventListener('click', () => {
        const found = profiles.find((c) => c.id === card.dataset.id);
        if (!found) return;
        // Two-tap start: confirm card first (tees, holes, group shown),
        // then go — or escalate to the full form from there.
        openQuickStartSheet(found);
      });
    });
  }

  // ---- Quick-start confirm sheet ---------------------------------------
  function openQuickStartSheet(found) {
    const course = normalizeCourse({ ...found });

    // Apply the remembered tee set so the summary reflects reality.
    let preferredTee = course.activeTeeSet || null;
    try {
      const mem = load('caddy:courseTees', {})[
        String(course.name).trim().toLowerCase()
      ];
      if (mem && mem.activeTeeSet) preferredTee = mem.activeTeeSet;
    } catch {
      /* best-effort */
    }
    if (
      Array.isArray(course.teeSets) &&
      course.teeSets.length &&
      preferredTee
    ) {
      applyTeeSet(course, preferredTee);
    }

    state.quickStartCourse = course;
    state.quickStartSource = found;

    const sheet = document.getElementById('quickStartSheet');
    const scrim = els.roundScoreScrim;
    if (!sheet || !scrim) {
      // No sheet available (shouldn't happen) — start directly.
      rememberCourseTees(course);
      beginRound(course, 1);
      return;
    }

    const title = document.getElementById('quickStartTitle');
    const meta = document.getElementById('quickStartMeta');
    if (title) title.textContent = course.name || 'Casual Round';
    if (meta) {
      const holes = Number(course.holesCount) === 9 ? '9 holes' : '18 holes';
      meta.textContent = [
        teeDisplayName(course.teeName),
        holes,
        'Hole 1',
        'Solo',
      ].join(' · ');
    }

    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    scrim.classList.add('open');
    haptic(8);
  }

  function closeQuickStartSheet() {
    const sheet = document.getElementById('quickStartSheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    state.quickStartCourse = null;
    state.quickStartSource = null;
    // Only drop the scrim if no other sheet is open behind it.
    const miniOpen = els.roundMiniSheet?.classList.contains('open');
    const fullOpen = els.roundScoreSheet?.classList.contains('open');
    const optsOpen = document
      .getElementById('roundOptionsSheet')
      ?.classList.contains('open');
    if (!miniOpen && !fullOpen && !optsOpen) {
      els.roundScoreScrim.classList.remove('open');
    }
  }

  // ---- Round options sheet (tees / start hole / group) -----------------
  function openRoundOptionsSheet(course, fromQuickStart = true) {
    if (!course) return;
    state.optionsCourse = course;
    state.optionsGroupPlayers = []; // groups are chosen per round, never assumed
    state.optionsFromQuickStart = fromQuickStart;

    const sheet = document.getElementById('roundOptionsSheet');
    if (!sheet) return;

    const title = document.getElementById('roundOptionsTitle');
    const meta = document.getElementById('roundOptionsMeta');
    if (title) title.textContent = course.name || 'Casual Round';
    if (meta) {
      meta.textContent = [
        teeDisplayName(course.teeName),
        Number(course.holesCount) === 9 ? '9 holes' : '18 holes',
      ].join(' · ');
    }

    renderOptionsTeePicker(course);
    renderOptionsStartHole(course);
    renderRoundOptionsGroup();

    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    els.roundScoreScrim?.classList.add('open');
    haptic(8);
  }

  function closeRoundOptionsSheet() {
    const sheet = document.getElementById('roundOptionsSheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    state.optionsCourse = null;
    state.optionsGroupPlayers = null;

    const wasFromQuickStart = state.optionsFromQuickStart;
    state.optionsFromQuickStart = false;

    // Back to the confirm card when we came from there — "back", not
    // "abandon everything".
    if (
      wasFromQuickStart &&
      state.quickStartSource &&
      !els.roundMiniSheet?.classList.contains('open') &&
      !els.roundScoreSheet?.classList.contains('open')
    ) {
      openQuickStartSheet(state.quickStartSource);
      return;
    }

    const miniOpen = els.roundMiniSheet?.classList.contains('open');
    const fullOpen = els.roundScoreSheet?.classList.contains('open');
    if (!miniOpen && !fullOpen) {
      els.roundScoreScrim.classList.remove('open');
    }
  }

  function renderOptionsTeePicker(course) {
    const row = document.getElementById('optionsTeePicker');
    if (!row) return;
    const sets = Array.isArray(course.teeSets) ? course.teeSets : [];
    if (!sets.length) {
      row.innerHTML = `<span class="hint">${escapeHtml(
        teeDisplayName(course.teeName)
      )}</span>`;
      return;
    }
    const solo = sets.length === 1;
    row.innerHTML = sets
      .map((t) => {
        const on = t.name === course.activeTeeSet;
        return `<button type="button" class="tee-chip${on ? ' active' : ''}${
          solo ? ' static' : ''
        }" data-tee="${escapeHtml(t.name)}"
          aria-pressed="${on}">${escapeHtml(teeDisplayName(t.name))}</button>`;
      })
      .join('');

    row.querySelectorAll('.tee-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const updated = applyTeeSet(
          state.optionsCourse,
          chip.dataset.tee
        );
        state.optionsCourse = updated;
        renderOptionsTeePicker(updated);
        const meta = document.getElementById('roundOptionsMeta');
        if (meta) {
          meta.textContent = [
            teeDisplayName(updated.teeName),
            Number(updated.holesCount) === 9 ? '9 holes' : '18 holes',
          ].join(' · ');
        }
        haptic(6);
      });
    });
  }

  function renderOptionsStartHole(course) {
    const sel = document.getElementById('optionsStartHole');
    if (!sel) return;
    const n = clamp(Number(course.holesCount) || 18, 1, 18);
    sel.innerHTML = Array.from({ length: n }, (_, i) => {
      const h = i + 1;
      return `<option value="${h}" ${h === 1 ? 'selected' : ''}>Hole ${h}${
        h === 1 ? ' (front)' : h === 10 ? ' (back)' : ''
      }</option>`;
    }).join('');
  }

  function renderRoundOptionsGroup() {
    const list = document.getElementById('optionsGroupList');
    if (!list) return;
    const players = state.optionsGroupPlayers || [];
    if (!players.length) {
      list.innerHTML =
        '<div class="hint" style="margin:0">Playing solo — add partners below.</div>';
      return;
    }
    list.innerHTML = players
      .map(
        (p) => `
        <div class="group-editor-row" data-id="${escapeHtml(p.id)}">
          <input type="text" maxlength="24" value="${escapeHtml(p.name)}"
            aria-label="Partner name" />
          <button class="group-editor-remove" type="button"
            aria-label="Remove ${escapeHtml(p.name)}">✕</button>
        </div>`
      )
      .join('');

    list.querySelectorAll('.group-editor-row').forEach((row) => {
      const id = row.dataset.id;
      const input = row.querySelector('input');
      input.addEventListener('change', () => {
        // QA-003: same duplicate rule as the partner sheet.
        const name = input.value.trim() || 'Player';
        if (partnerNameTaken(name, id)) {
          setNotice(`"${name}" is already in the group.`, 'danger');
          haptic(12);
          input.value =
            (state.optionsGroupPlayers || []).find((x) => x.id === id)?.name ||
            name;
          return;
        }
        const p = (state.optionsGroupPlayers || []).find(
          (x) => x.id === id
        );
        if (p) p.name = name;
      });
      row.querySelector('.group-editor-remove').addEventListener(
        'click',
        () => {
          state.optionsGroupPlayers = (state.optionsGroupPlayers || []).filter(
            (x) => x.id !== id
          );
          renderRoundOptionsGroup();
          haptic(6);
        }
      );
    });
  }

  // ---- Add/rename partner sheet (replaces browser prompt) --------------
  function openPartnerSheet(editId = null) {
    const sheet = document.getElementById('partnerSheet');
    const input = document.getElementById('partnerNameInput');
    if (!sheet || !input) return;

    state.partnerSheetEditId = editId;
    const editing = editId ? findPartnerAnywhere(editId) : null;

    const title = document.getElementById('partnerSheetTitle');
    if (title) title.textContent = editing ? 'Partner' : 'Add partner';
    const save = document.getElementById('partnerSaveBtn');
    if (save) save.textContent = editing ? 'Save' : 'Add';
    input.value = editing ? editing.name : '';

    // Remove only makes sense for an existing partner.
    const removeBtn = document.getElementById('partnerRemoveBtn');
    if (removeBtn) removeBtn.hidden = !editing;

    renderPartnerSuggestions();
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    els.roundScoreScrim?.classList.add('open');

    setTimeout(() => input.focus(), reduceMotion ? 0 : 320);
    haptic(8);
  }

  function findPartnerAnywhere(id) {
    const inOptions = (state.optionsGroupPlayers || []).find(
      (p) => p.id === id
    );
    if (inOptions) return inOptions;
    const rs = state.roundSession;
    if (rs && Array.isArray(rs.groupPlayers)) {
      return rs.groupPlayers.find((p) => p.id === id) || null;
    }
    return null;
  }

  function closePartnerSheet() {
    const sheet = document.getElementById('partnerSheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    state.partnerSheetEditId = null;
    const input = document.getElementById('partnerNameInput');
    if (input) input.blur();

    // Drop the scrim only if the options sheet isn't open behind us.
    const optsOpen = document
      .getElementById('roundOptionsSheet')
      ?.classList.contains('open');
    if (!optsOpen) els.roundScoreScrim?.classList.remove('open');
  }

  // QA-003: case-insensitive duplicate guard shared by the partner sheet
  // and the group editor. Checks the places a partner can currently live:
  // the round-options group, a live session's groupPlayers, and the saved
  // roster (used when no round is open). `exceptId` lets a rename keep
  // its own name.
  function partnerNameTaken(name, exceptId) {
    const needle = String(name || '').trim().toLowerCase();
    if (!needle) return false;
    const pools = [
      state.optionsGroupPlayers || [],
      (state.roundSession && Array.isArray(state.roundSession.groupPlayers)
        ? state.roundSession.groupPlayers
        : []) || [],
      state.roundSession ? [] : loadGroupRoster(),
    ];
    return pools.some((pool) =>
      (Array.isArray(pool) ? pool : []).some(
        (p) =>
          p &&
          p.id !== exceptId &&
          String(p.name || '').trim().toLowerCase() === needle
      )
    );
  }

  function commitPartnerSheet() {
    const input = document.getElementById('partnerNameInput');
    const name = (input?.value || '').trim().slice(0, 24);
    if (!name) {
      closePartnerSheet();
      return;
    }
    // QA-003: reject duplicates instead of silently creating two partners
    // with the same name (the suggestion list already filtered them — the
    // manual path must agree with it).
    if (partnerNameTaken(name, state.partnerSheetEditId)) {
      setNotice(`"${name}" is already in the group.`, 'danger');
      haptic(12);
      input.focus();
      return;
    }

    const editId = state.partnerSheetEditId;
    if (editId) {
      const p = findPartnerAnywhere(editId);
      if (p) p.name = name;
      const rs = state.roundSession;
      if (rs) saveRoundSession();
    } else if (state.optionsCourse) {
      state.optionsGroupPlayers = state.optionsGroupPlayers || [];
      state.optionsGroupPlayers.push({ id: cryptoId(), name });
      // Remember them for next time's suggestions.
      mergePartnersIntoRoster([{ id: cryptoId(), name }]);
    } else if (state.roundSession) {
      // Adding mid-round.
      if (
        (state.roundSession.groupPlayers || []).length >= GROUP_MAX_PARTNERS
      ) {
        setNotice(`Maximum ${GROUP_MAX_PARTNERS} partners.`, 'danger');
        return;
      }
      state.roundSession.groupPlayers = state.roundSession.groupPlayers || [];
      const p = { id: cryptoId(), name };
      state.roundSession.groupPlayers.push(p);
      mergePartnersIntoRoster([p]);
      saveRoundSession();
    }

    closePartnerSheet();
    renderRoundOptionsGroup();
    renderGroupUI();
    haptic(10);
  }

  function removePartnerFromSheet() {
    const editId = state.partnerSheetEditId;
    if (!editId) return;

    const rs = state.roundSession;
    if (state.optionsCourse) {
      state.optionsGroupPlayers = (state.optionsGroupPlayers || []).filter(
        (x) => x.id !== editId
      );
      renderRoundOptionsGroup();
    } else if (rs && Array.isArray(rs.groupPlayers)) {
      rs.groupPlayers = rs.groupPlayers.filter((x) => x.id !== editId);
      if (rs.groupScores) delete rs.groupScores[editId];
      saveRoundSession();
      renderGroupUI();
    }

    closePartnerSheet();
    haptic(10);
  }

  function renderPartnerSuggestions() {
    const wrap = document.getElementById('partnerSuggestions');
    if (!wrap) return;
    const existing = new Set(
      (state.optionsGroupPlayers || []).map((p) =>
        p.name.trim().toLowerCase()
      )
    );
    const suggestions = loadGroupRoster()
      .filter(
        (p) =>
          !existing.has(p.name.trim().toLowerCase())
      )
      .slice(0, 4);

    if (!suggestions.length) {
      wrap.hidden = true;
      wrap.innerHTML = '';
      return;
    }

    wrap.hidden = false;
    wrap.innerHTML = suggestions
      .map(
        (p) =>
          `<button type="button" class="club-chip" data-name="${escapeHtml(
            p.name
          )}">${escapeHtml(p.name)}</button>`
      )
      .join('');

    wrap.querySelectorAll('.club-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const input = document.getElementById('partnerNameInput');
        if (input) input.value = chip.dataset.name;
        commitPartnerSheet();
      });
    });
  }

  // Tee boxes the player used before, keyed by course name — so returning
  // to a course auto-sets the same tees everywhere (map geometry,
  // yardages, scorecard).
  function rememberCourseTees(course) {
    if (!course || !String(course.name || '').trim()) return;
    try {
      const mem = load('caddy:courseTees', {});
      mem[String(course.name).trim().toLowerCase()] = {
        teeName: course.teeName || '',
        activeTeeSet: course.activeTeeSet || null,
        at: Date.now(),
      };
      save('caddy:courseTees', mem);
    } catch {
      /* best-effort */
    }
  }

  function selectSavedCourse(saved) {
    if (!saved) return;
    const course = normalizeCourse({ ...saved });

    state.selectedNearbyCourse = null;
    state.selectedCourseTemplate = course;
    // A saved course loads locally — any pending/failed mapping is moot.
    clearCourseMapping();
    applyTemplateHoleCount(course);

    // Auto-apply tees: what this player used last time here, else the
    // course's own active set. With ≥1 imported set this restores real
    // tee points and yardages — not just the label.
    let preferredTee = course.activeTeeSet || null;
    try {
      const mem = load('caddy:courseTees', {})[
        String(course.name).trim().toLowerCase()
      ];
      if (mem && mem.activeTeeSet) preferredTee = mem.activeTeeSet;
    } catch {
      /* best-effort */
    }
    if (Array.isArray(course.teeSets) && course.teeSets.length && preferredTee) {
      applyTeeSet(course, preferredTee);
    }

    els.roundSetupCourseSelect.value = course.id;
    els.roundSetupCourseName.value = course.name;
    els.roundSetupSaveCourse.checked = true;

    // Reveal the details section that carries the tee chips + start hole
    // so the selection is visible, not hidden inside a collapsed drawer.
    const manual = document.getElementById('manualRoundWrap');
    if (manual) manual.open = true;
    // Pars & yardages open with the course — that's the thing worth
    // reviewing before teeing off.
    const editor = document.getElementById('scorecardEditor');
    if (editor) editor.open = true;

    renderRoundSetupHoles(course.holes);
    renderTeeSetPicker(course);
    renderSavedCourseList();

    if (els.nearbyCourseStatus) {
      els.nearbyCourseStatus.textContent = `${course.name} · ${
        teeDisplayName(course.teeName)
      }`;
    }
    haptic(8);
  }

  function renderRoundSetupHoles(holes) {
    if (!els.roundSetupPars) return;

    const normalized = normalizeCourse({
      name: 'Temporary',
      teeName: 'Temporary',
      holes,
    }).holes.slice(0, state.setupHolesCount === 9 ? 9 : 18);

    els.roundSetupPars.innerHTML = normalized
      .map((hole) => {
        const badges =
          (hole.source === 'openstreetmap'
            ? `<span class="hole-badge osm">OSM</span>`
            : `<span class="hole-badge manual">—</span>`) +
          (hole.parInferred ? `<span class="hole-badge est">est</span>` : '') +
          (hole.greenDepthYds
            ? `<span class="hole-badge fcb">${Math.round(
              hole.greenDepthYds
            )}yd</span>`
            : '');

        return `
        <div class="round-setup-hole" data-hole="${hole.number}">
          <div class="round-setup-hole-number">
            ${hole.number}${badges}
          </div>
          <input
            class="setup-hole-par"
            type="number"
            inputmode="numeric"
            min="3"
            max="6"
            value="${escapeHtml(hole.par)}"
            aria-label="Hole ${hole.number} par" />
          <input
            class="setup-hole-yards"
            type="number"
            inputmode="numeric"
            placeholder="yd"
            value="${escapeHtml(hole.yards)}"
            aria-label="Hole ${hole.number} yards" />
        </div>`;
      })
      .join('');
  }

  // Read the currently displayed setup rows back into hole objects so
  // switching 9↔18 (or re-rendering) never wipes typed pars/yardages.
  function readCurrentSetupHoles() {
    const template = state.selectedCourseTemplate;
    const templateHoles = Array.isArray(template?.holes)
      ? template.holes
      : [];

    return [
      ...els.roundSetupPars.querySelectorAll('.round-setup-hole'),
    ].map((row, index) => {
      const base =
        templateHoles[index] && typeof templateHoles[index] === 'object'
          ? templateHoles[index]
          : {};

      const parInput = row.querySelector('.setup-hole-par');
      const yardsInput = row.querySelector('.setup-hole-yards');

      return {
        ...base,
        number: index + 1,
        par: clamp(
          Math.round(num(parInput.value, num(base.par, 4))),
          3,
          6
        ),
        yards:
          yardsInput.value.trim() === ''
            ? ''
            : Math.max(1, Math.round(num(yardsInput.value, 0))),
      };
    });
  }

  function readRoundSetupCourse() {
    const template = state.selectedCourseTemplate;
    const nearby = state.selectedNearbyCourse;

    const templateHoles = Array.isArray(template?.holes)
      ? template.holes
      : [];

    const holes = readCurrentSetupHoles();

    const location =
      template?.location ||
      (nearby &&
        Number.isFinite(nearby.lat) &&
        Number.isFinite(nearby.lng)
        ? {
          lat: nearby.lat,
          lng: nearby.lng,
        }
        : null);

    return normalizeCourse({
      ...(template || {}),

      holesCount: state.setupHolesCount === 9 ? 9 : 18,

      id: template?.id || `local:${cryptoId()}`,

      name:
        els.roundSetupCourseName.value.trim() ||
        template?.name ||
        'Casual Round',

      teeName:
        els.roundSetupTeeName.value.trim() ||
        template?.teeName ||
        'Regular tees',

      source: template?.source || nearby?.source || 'manual',

      location,

      updatedAt: Date.now(),

      holes,
    });
  }

  function saveCourseProfile(course) {
    const normalized = normalizeCourse(course);

    // One profile per COURSE — tees are a property of the course (the
    // active tee set), never part of its identity. Deduping on name+tee
    // used to fork duplicate profiles per tee box, and name-only lookups
    // then restored whichever copy came first: wrong yardages, wrong
    // tee points.
    const existingIndex = state.courseProfiles.findIndex(
      (item) =>
        item.name.toLowerCase() === normalized.name.toLowerCase()
    );

    if (existingIndex >= 0) {
      normalized.id = state.courseProfiles[existingIndex].id;
      state.courseProfiles[existingIndex] = normalized;
    } else {
      state.courseProfiles.push(normalized);
    }

    saveCourseProfiles();
    // A freshly saved course becomes plannable immediately.
    renderPlanner();
  }

  function beginRound(course, startHole) {
    // SINGLE CHOKE POINT (v1.0.69): no round may start while a course
    // scorecard is still being mapped (or failed without a successful
    // retry). This covers EVERY entry path — roundActionBtn/startRound,
    // the round-setup sheet's own Start button, quick-start confirm, the
    // round-options sheet, and any future caller.
    if (courseMappingBlocked()) {
      showAppToast(
        state.courseMappingState === 'failed'
          ? 'Course mapping failed — tap Retry on the map (or clear the course) before starting.'
          : `Still mapping ${state.courseMappingName || 'the course'} — hang on a second.`
      );
      haptic(20);
      return null;
    }

    const normalizedCourse = normalizeCourse(course);

    state.roundSession = emptyRoundSession(normalizedCourse, startHole);

    // A group chosen in the round-options sheet rides along into the
    // fresh session (then clears — it's a one-shot handoff).
    if (Array.isArray(state._pendingGroupPlayers)) {
      state.roundSession.groupPlayers = state._pendingGroupPlayers;
      state._pendingGroupPlayers = null;
    }

    // Force hole geometry to re-apply even if the new round starts on the
    // same course/hole as the previous one.
    state.holeGeoKey = null;

    // Keep legacy scorecard consumers working while course-aware round data
    // remains stored inside the active round session.
    state.round = state.roundSession.scorecard;

    save('caddy:round', state.round);
    saveRoundSession();

    if (!state.gpsRunning) {
      startGPS();
    }

    renderRound();
    renderRoundShotUI();
    renderRoundHoleHeader();

    // Move the map to the selected course if it came from nearby-course search
    // or a saved course profile with a stored location.
    if (
      normalizedCourse.location &&
      Number.isFinite(normalizedCourse.location.lat) &&
      Number.isFinite(normalizedCourse.location.lng)
    ) {
      initMap();

      const courseLatLng = [
        normalizedCourse.location.lat,
        normalizedCourse.location.lng,
      ];

      state.map.setView(courseLatLng, 16, {
        animate: !reduceMotion,
      });

      // A course-selected map location should not be immediately replaced
      // by the first incoming GPS fix.
      state.pannedOnce = true;
    }

    haptic(10);
  }
  function nearbyCourseDistanceYd(course) {
    if (!state.loc || !course) return null;

    return haversineMeters(state.loc, course) * M_TO_YD;
  }

  function formatNearbyCourseDistance(course) {
    const yd = nearbyCourseDistanceYd(course);

    if (!Number.isFinite(yd)) return '';

    if (yd < 1760) return `${Math.round(yd)} yd away`;

    return `${fmt(yd / 1760, 1)} mi away`;
  }

  function getSavedCourseMatch(name) {
    const needle = String(name || '')
      .trim()
      .toLowerCase();

    if (!needle) return null;

    return state.courseProfiles.find((course) => {
      const candidate = String(course.name || '')
        .trim()
        .toLowerCase();

      return candidate === needle;
    });
  }

  // Tee-box chips: shown whenever a course carries ANY imported tee set
  // (not just 2+). Replaces both the old dropdown and the free-text tee
  // field when active — one control, same choice everywhere.
  function renderTeeSetPicker(course) {
    const wrap = document.getElementById('teeSetPickerWrap');
    const row = document.getElementById('teeSetPicker');
    if (!wrap || !row) return;

    const sets =
      course && Array.isArray(course.teeSets) ? course.teeSets : [];
    if (!sets.length) {
      wrap.hidden = true;
      syncTeeNameFieldVisibility();
      return;
    }

    wrap.hidden = false;
    const solo = sets.length === 1;
    row.innerHTML = sets
      .map((t) => {
        const on = t.name === course.activeTeeSet;
        return `<button type="button" class="tee-chip${on ? ' active' : ''}${
          solo ? ' static' : ''
        }"
          data-tee="${escapeHtml(t.name)}" aria-pressed="${on}">${escapeHtml(
          teeDisplayName(t.name)
        )}</button>`;
      })
      .join('');

    row.querySelectorAll('.tee-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const updated = applyTeeSet(
          state.selectedCourseTemplate,
          chip.dataset.tee
        );
        state.selectedCourseTemplate = updated;
        els.roundSetupTeeName.value = updated.teeName;
        renderRoundSetupHoles(updated.holes);
        renderTeeSetPicker(updated);
        rememberCourseTees(updated);
        haptic(6);
      });
    });

    syncTeeNameFieldVisibility();
  }

  // When chip pickers are visible they own the tee choice — the legacy
  // free-text input steps aside instead of contradicting them.
  function syncTeeNameFieldVisibility() {
    const chipsVisible = !document.getElementById('teeSetPickerWrap')?.hidden;
    const nameField = document.getElementById('teeNameField');
    if (nameField) nameField.hidden = !!chipsVisible;
  }

  // Shared option-button markup for BOTH the geo-nearby list and the
  // name-search list, so saved/selected styling stays identical everywhere.
  function courseButtonHtml(course, index) {
    const saved = getSavedCourseMatch(course.name);
    const distance = formatNearbyCourseDistance(course);

    const selected =
      state.selectedNearbyCourse &&
      state.selectedNearbyCourse.id === course.id;

    const label = saved
      ? 'Saved scorecard'
      : selected
        ? 'Selected'
        : 'Tap to select';

    return `
          <button
            class="nearby-course-option${selected ? ' selected' : ''}"
            type="button"
            data-index="${index}"
            aria-pressed="${selected ? 'true' : 'false'}"
          >
            <span class="nearby-course-name">
              ${escapeHtml(course.name)}
            </span>
  
            <span class="nearby-course-meta">
              ${escapeHtml(distance)}
              ${distance ? ' · ' : ''}
              ${escapeHtml(label)}
            </span>
          </button>
        `;
  }

  // Click handlers must resolve indices against whichever list is on screen.
  function courseListForIndex(index) {
    return state.courseSearchActive
      ? state.courseSearchResults[index]
      : state.nearbyCourses[index];
  }

  function renderNearbyCourses() {
    if (!els.nearbyCourseList || !els.nearbyCourseStatus) return;

    // While a name search is active, the list shows search results instead.
    if (state.courseSearchActive) return renderCourseSearchResults();

    const courses = Array.isArray(state.nearbyCourses)
      ? state.nearbyCourses
      : [];

    if (state.nearbyCourseLoading) {
      els.nearbyCourseStatus.textContent = 'Searching around your location…';
      els.nearbyCourseList.innerHTML =
        `<div class="hint">Looking for nearby golf courses…</div>`;
      return;
    }

    if (!state.loc) {
      els.nearbyCourseStatus.textContent = 'Enable GPS first to find nearby courses.';
      els.nearbyCourseList.innerHTML = '';
      return;
    }

    if (!courses.length) {
      // Surface the real failure reason (timeout/offline) instead of the
      // misleading "nothing found" copy when a search errored out.
      els.nearbyCourseStatus.textContent =
        state.nearbySearchError ||
        'No mapped courses found nearby. You can still create one manually.';
      els.nearbyCourseList.innerHTML = '';
      return;
    }

    if (state.nearbyCourseLoadingScorecard) {
      // v1.0.70 premium loader card (shared with the map pill).
      if (!renderNearbyScorecardLoader(els.nearbyCourseStatus)) {
        els.nearbyCourseStatus.textContent =
          'Course selected — loading mapped scorecard data…';
      }
    } else {
      maploadStopPhases('nearby');
      if (!state.selectedNearbyCourse) {
        els.nearbyCourseStatus.textContent =
          `${courses.length} nearby course${courses.length === 1 ? '' : 's'} found.`;
      }
    }
    // fall through to render the list either way

    els.nearbyCourseList.innerHTML = courses.map(courseButtonHtml).join('');

    els.nearbyCourseList
      .querySelectorAll('.nearby-course-option')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const course = courseListForIndex(Number(button.dataset.index));

          if (course) {
            selectNearbyCourse(course);
          }
        });
      });
  }


  /* ================= OSM tag parsing (priority-ordered) ================= */

  function parseOsmHoleNumber(tags) {
    if (!tags) return null;
    const tries = [];

    // 1. ref, strict integer only.
    if (tags.ref != null) tries.push(String(tags.ref).trim().match(/^(\d{1,2})$/));

    // 2/3. name, anchored patterns only — never a bare mid-string digit.
    if (tags.name) {
      tries.push(String(tags.name).match(/\bhole\s*#?\s*(\d{1,2})\b/i));
      tries.push(String(tags.name).trim().match(/^(\d{1,2})(?:st|nd|rd|th)?\b/i));
    }

    // 4. Alternate keys.
    for (const k of ['hole', 'number', 'golf_hole']) {
      if (tags[k] != null) tries.push(String(tags[k]).trim().match(/^(\d{1,2})$/));
    }

    for (const m of tries) {
      if (m) {
        const n = Number(m[1]);
        if (n >= 1 && n <= 27) return n; // 27-hole facilities exist
      }
    }
    return null;
  }

  function parseOsmPar(tags) {
    const n = Number(tags && tags.par);
    return Number.isInteger(n) && n >= 3 && n <= 6 ? n : null;
  }

  // 'par' -> { red: 4, blue: 5 } from par:red / par:blue subkeys.
  function parseOsmSubkeyNumbers(tags, prefix) {
    const out = {};
    if (!tags) return out;
    for (const k of Object.keys(tags)) {
      if (k.startsWith(prefix + ':')) {
        const n = Number(tags[k]);
        if (Number.isFinite(n) && n > 0) {
          out[k.slice(prefix.length + 1).toLowerCase()] = n;
        }
      }
    }
    return out;
  }

  // Returns an array — one physical tee box can serve several sets (tee=gold;white).
  function parseOsmTeeSetNames(tags) {
    if (!tags) return [];
    const raw =
      tags.tee ||
      tags['tee:colour'] ||
      tags['tee:color'] ||
      tags.colour ||
      tags.color ||
      '';
    let names = String(raw)
      .split(/[;,]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!names.length && tags.name) {
      const stripped = String(tags.name)
        .replace(/hole|tee|tees|\d+/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (stripped && stripped.length <= 20) names = [stripped];
    }
    return names;
  }

  function inferParFromYards(yds) {
    if (!Number.isFinite(yds)) return null;
    return yds < 260 ? 3 : yds < 475 ? 4 : 5;
  }

  /* ============ buildAutoCourse: geometry-first assembly ============ */

  function buildAutoCourse(candidate, elements) {
    const holeWays = [];
    const teeEls = [];
    const greens = [];
    const pins = [];
    const hazardEls = [];

    for (const el of elements) {
      const t = el.tags || {};
      if (t.golf === 'hole') {
        const p = osmPathLatLng(el);
        if (p) holeWays.push({ el, path: p });
      } else if (t.golf === 'tee') {
        teeEls.push(el);
      } else if (t.golf === 'green') {
        const ring = osmRing(el);
        if (ring) greens.push({ ring, centroid: osmFeaturePoint(el) });
      } else if (t.golf === 'pin') {
        const p = osmFeaturePoint(el);
        if (p) pins.push(p);
      } else if (
        t.golf === 'bunker' ||
        t.golf === 'water_hazard' ||
        t.golf === 'lateral_water_hazard' ||
        t.natural === 'water'
      ) {
        const pt = osmFeaturePoint(el);
        if (pt) hazardEls.push({ pt, kind: t.golf === 'bunker' ? 'bunker' : 'water' });
      }
    }

    // ---- Pass 1: per-hole records: orientation, length, green, FCB ----
    const teePts = teeEls.map(osmFeaturePoint).filter(Boolean);
    const recs = [];

    for (const { el, path } of holeWays) {
      const tags = el.tags || {};

      // Orient tee-side-first. Trust OSM node order unless a tee clearly disagrees.
      if (teePts.length) {
        const nearest = (pt) => Math.min(...teePts.map((t) => osmDistM(pt, t)));
        if (nearest(path[0]) > nearest(path[path.length - 1]) + 20) path.reverse();
      }

      const lengthYds = Math.round(osmPathLengthYds(path));
      const endPt = path[path.length - 1];

      // Green association: end point inside the ring, else centroid within 90 yd.
      const green =
        greens.find((g) => osmPointInRing(endPt, g.ring)) ||
        greens.find((g) => g.centroid && osmDistYds(g.centroid, endPt) <= 90) ||
        null;

      const pin = pins.reduce(
        (best, p) =>
          osmDistYds(p, endPt) <= 60 &&
            (!best || osmDistYds(p, endPt) < osmDistYds(best, endPt))
            ? p
            : best,
        null
      );

      let front = null;
      let back = null;
      let depthYds = null;
      let greenCenter = pin || (green && green.centroid) || endPt;

      if (green) {
        // Approach bearing: walk BACK along the path ~45 yd. Handles doglegs;
        // a straight tee->green line would flip front/back on a bent hole.
        let backAlong = path[0];
        let acc = 0;
        for (let i = path.length - 1; i > 0 && acc < 45; i--) {
          acc += osmDistYds(path[i], path[i - 1]);
          backAlong = path[i - 1];
        }

        const c = green.centroid || endPt;
        const refLat = c.lat;
        const cXY = osmXY(c.lat, c.lng, refLat);
        const aXY = osmXY(backAlong.lat, backAlong.lng, refLat);
        const L = Math.hypot(cXY.x - aXY.x, cXY.y - aXY.y) || 1e-9;
        const u = { x: (cXY.x - aXY.x) / L, y: (cXY.y - aXY.y) / L };

        let sMin = Infinity;
        let sMax = -Infinity;
        let vMin = null;
        let vMax = null;
        for (const v of green.ring) {
          const p = osmXY(v.lat, v.lng, refLat);
          const s = (p.x - cXY.x) * u.x + (p.y - cXY.y) * u.y;
          if (s < sMin) { sMin = s; vMin = v; }
          if (s > sMax) { sMax = s; vMax = v; }
        }
        front = vMin;
        back = vMax;
        depthYds = Math.round((sMax - sMin) * OSM_YD_PER_M);
        if (!pin) greenCenter = c;
      }

      const hcp = Number(tags.handicap);

      recs.push({
        num: parseOsmHoleNumber(tags),
        path,
        lengthYds,
        endPt,
        par: parseOsmPar(tags),
        parBySet: parseOsmSubkeyNumbers(tags, 'par'),
        strokeIndex: Number.isInteger(hcp) && hcp >= 1 && hcp <= 18 ? hcp : null,
        greenCenter,
        front,
        back,
        depthYds,
        hasGreenPolygon: !!green,
        hazards: [],
      });
    }

    // Dedupe by hole number (27-hole facilities, double-mapped holes).
    const byNum = new Map();
    let dupes = 0;
    for (const r of recs) {
      if (r.num == null) continue;
      const ex = byNum.get(r.num);
      if (!ex) { byNum.set(r.num, r); continue; }
      dupes++;
      const better = (!ex.par && r.par) || (ex.par === r.par && r.lengthYds > ex.lengthYds);
      if (better) byNum.set(r.num, r);
    }

    // ---- Pass 2: ALL tee sets ----
    const teeSets = {}; // name -> { name, holes: { num: {lat,lng,yards} } }
    for (const el of teeEls) {
      const tags = el.tags || {};
      const pt = osmFeaturePoint(el);
      if (!pt) continue;

      const num = parseOsmHoleNumber(tags);
      let rec = num != null ? byNum.get(num) : null;
      if (!rec) {
        // No usable ref on the tee: associate by proximity to a path start.
        rec = [...byNum.values()].reduce(
          (best, r) =>
            osmDistYds(pt, r.path[0]) <= 120 &&
              (!best || osmDistYds(pt, r.path[0]) < osmDistYds(pt, best.path[0]))
              ? r
              : best,
          null
        );
      }
      if (!rec) continue;

      // Yardage FROM this tee: snap to nearest path vertex, then walk the
      // remaining path to the green end. Playing length, not a straight line.
      let bi = 0;
      let bd = Infinity;
      rec.path.forEach((p, i) => {
        const d = osmDistM(pt, p);
        if (d < bd) { bd = d; bi = i; }
      });
      let m = 0;
      for (let i = bi + 1; i < rec.path.length; i++) {
        m += osmDistM(rec.path[i - 1], rec.path[i]);
      }
      const yards = Math.round(m * OSM_YD_PER_M);

      const names = parseOsmTeeSetNames(tags);
      for (const nm of names.length ? names : ['default']) {
        if (!teeSets[nm]) teeSets[nm] = { name: nm, holes: {} };
        teeSets[nm].holes[rec.num] = { lat: pt.lat, lng: pt.lng, yards };
      }
    }

    const teeSetList = Object.values(teeSets).sort(
      (a, b) =>
        Object.keys(b.holes).length - Object.keys(a.holes).length ||
        (a.name === 'default' ? 1 : b.name === 'default' ? -1 : 0)
    );
    const bestSet = teeSetList[0] || null;

    // ---- Pass 3: hazards within 45 yd of a hole path ----
    // This filter is load-bearing: natural=water inside a course area otherwise
    // yields lakes/rivers that are nowhere near play.
    for (const h of hazardEls) {
      for (const r of byNum.values()) {
        if (osmDistPointToPathM(h.pt, r.path) * OSM_YD_PER_M <= 45) {
          r.hazards.push({ type: h.kind, lat: h.pt.lat, lng: h.pt.lng });
        }
      }
    }

    // ---- Pass 4: build the 18 holes. NEVER emit a key without a real value. ----
    const report = {
      holesMapped: 0,
      parsImported: 0,
      parsInferred: 0,
      yardsImported: 0,
      greensFound: 0,
      fcbFound: 0,
      duplicateHoleNumbers: dupes,
      teeSets: teeSetList.map((t) => t.name),
      activeTeeSet: bestSet ? bestSet.name : null,
      cached: !!(elements.meta && elements.meta.cached),
      endpoint: elements.meta ? elements.meta.endpoint : null,
    };

    const holes = [];
    for (let i = 1; i <= 18; i++) {
      const r = byNum.get(i);
      const h = { number: i, source: r ? 'openstreetmap' : 'manual' };

      if (r) {
        report.holesMapped++;
        const setEntry = bestSet && bestSet.holes[i];
        const yards = (setEntry && setEntry.yards) || r.lengthYds;

        if (r.par) {
          h.par = r.par;
          h.importedPar = r.par;
          report.parsImported++;
        } else {
          const ip = inferParFromYards(yards);
          if (ip) {
            h.par = ip;
            h.parInferred = true;
            report.parsInferred++;
          }
        }

        if (Number.isFinite(yards) && yards >= 40 && yards <= 900) {
          h.yards = yards;
          h.importedYards = yards;
          h.yardageSource = setEntry ? 'tee:' + bestSet.name : 'geometry';
          report.yardsImported++;
        }

        if (setEntry) h.teePoint = { lat: setEntry.lat, lng: setEntry.lng };
        else h.teePoint = { lat: r.path[0].lat, lng: r.path[0].lng };

        if (r.greenCenter) h.greenCenter = r.greenCenter;
        if (r.front) h.front = r.front;
        if (r.back) h.back = r.back;
        if (r.front && r.back) report.fcbFound++;
        if (r.depthYds) h.greenDepthYds = r.depthYds;
        if (r.hasGreenPolygon) report.greensFound++;
        if (r.strokeIndex) h.strokeIndex = r.strokeIndex;
        if (Object.keys(r.parBySet).length) h.parByTee = r.parBySet;

        const ty = {};
        for (const ts of teeSetList) if (ts.holes[i]) ty[ts.name] = ts.holes[i].yards;
        if (Object.keys(ty).length) h.teeYards = ty;

        if (r.hazards.length) h.hazards = r.hazards.slice(0, 12);
      }

      holes.push(h);
    }

    // Auto-detect a 9-hole layout: every mapped hole lives in 1–9 and
    // nothing is mapped past 9.
    const mappedNums = [...byNum.keys()];
    const isNine =
      mappedNums.length > 0 &&
      mappedNums.every((n) => n >= 1 && n <= 9);
    const finalHoles = isNine ? holes.slice(0, 9) : holes;

    const candPt = osmFeaturePoint(candidate);

    return normalizeCourse({
      id: `local:${cryptoId()}`,
      name: candidate.name || (candidate.tags && candidate.tags.name) || 'Imported course',
      teeName: bestSet ? bestSet.name : 'Regular tees',
      source: 'openstreetmap',
      location: candPt
        ? { lat: candPt.lat, lng: candPt.lng }
        : Number.isFinite(candidate.lat)
          ? { lat: Number(candidate.lat), lng: Number(candidate.lng) }
          : null,
      updatedAt: Date.now(),
      osmType: candidate.osmType || candidate.type || null,
      osmId: candidate.osmId != null ? candidate.osmId : null,
      teeSets: teeSetList,
      activeTeeSet: bestSet ? bestSet.name : null,
      importReport: report,
      holesCount: isNine ? 9 : 18,
      holes: finalHoles,
    });
  }

  /* ============ Scorecard fetch: area-scoped, radius fallback, cached ============ */

  async function fetchAutoCourseScorecard(candidate) {
    const cLat = Number(
      candidate.lat != null ? candidate.lat : candidate.center && candidate.center.lat
    );
    const cLngRaw =
      candidate.lng != null
        ? candidate.lng
        : candidate.lon != null
          ? candidate.lon
          : candidate.center && (candidate.center.lon ?? candidate.center.lng);
    const cLng = Number(cLngRaw);

    const osmType = candidate.osmType || candidate.type || null;
    const osmId = Number(candidate.osmId != null ? candidate.osmId : candidate.numericId);

    const cacheKey =
      OSM_CACHE_PREFIX + 'scorecard:' + (osmType || 'pt') + ':' + (osmId || `${cLat},${cLng}`);

    // Strategy 1: server-side scope to the course area.
    // Area ids: way -> 2400000000 + id, relation -> 3600000000 + id.
    if ((osmType === 'way' || osmType === 'relation') && Number.isFinite(osmId)) {
      const areaId = (osmType === 'way' ? 2400000000 : 3600000000) + osmId;
      const qArea = `[out:json][timeout:40];
area(${areaId})->.a;
(
  nwr["golf"](area.a);
  nwr["natural"="water"](area.a);
);
out geom;`;
      try {
        const els = await overpassFetch(qArea, { cacheKey, timeoutMs: 45000 });
        // Fall through on EMPTY, not just on error: not every way/relation has an
        // area counterpart, and Overpass area extraction lags the main DB.
        if (els.some((e) => e.tags && e.tags.golf === 'hole')) return els;
      } catch { /* fall through */ }
    }

    // Strategy 2: radius (node-tagged courses, or missing area).
    if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) {
      throw new Error('Selected course has no usable coordinates.');
    }
    const qRadius = `[out:json][timeout:40];
(
  nwr["golf"](around:2800,${cLat},${cLng});
  nwr["natural"="water"](around:2800,${cLat},${cLng});
);
out geom;`;
    return overpassFetch(qRadius, { cacheKey, timeoutMs: 45000 });
  }

  /* ================= Import reporting ================= */

  function describeImport(course) {
    const r = course && course.importReport;
    if (!r) return 'No mapped scorecard was found; add pars and yardages manually.';

    const parts = [`${r.holesMapped}/18 holes mapped`];

    if (r.parsImported || r.parsInferred) {
      const bits = [];
      if (r.parsImported) bits.push(`${r.parsImported} par${r.parsImported === 1 ? '' : 's'}`);
      if (r.parsInferred) bits.push(`${r.parsInferred} estimated`);
      parts.push(bits.join(' + '));
    }
    if (r.yardsImported) parts.push(`${r.yardsImported} yardages`);
    if (r.greensFound) parts.push(`${r.greensFound} greens`);
    if (r.fcbFound) parts.push(`${r.fcbFound} front/back`);
    if (r.teeSets.length) parts.push(`tees: ${r.teeSets.join(', ')}`);
    if (r.duplicateHoleNumbers) parts.push('multiple nines detected — using 1–18');
    if (r.cached) parts.push('cached');

    return parts.join(' · ');
  }

  // Apply a chosen tee set's yardages back onto the hole array.
  function applyTeeSet(course, teeSetName) {
    if (!course || !Array.isArray(course.teeSets)) return course;
    const set = course.teeSets.find((t) => t.name === teeSetName);
    if (!set) return course;

    course.activeTeeSet = set.name;
    course.teeName = set.name;

    course.holes.forEach((h) => {
      const entry = set.holes[h.number];
      if (!entry) return;
      if (Number.isFinite(entry.yards) && entry.yards >= 40 && entry.yards <= 900) {
        h.yards = entry.yards;
        h.importedYards = entry.yards;
        h.yardageSource = 'tee:' + set.name;
      }
      h.teePoint = { lat: entry.lat, lng: entry.lng };
      if (h.parByTee && h.parByTee[set.name]) {
        h.par = clamp(Math.round(h.parByTee[set.name]), 3, 6);
      }
    });

    return normalizeCourse(course);
  }

  async function selectNearbyCourse(candidate) {
    if (!candidate) return;

    state.selectedNearbyCourse = {
      id: candidate.id || '',
      osmType: candidate.osmType || candidate.type || null,
      osmId: candidate.osmId != null ? candidate.osmId : null,
      name: candidate.name,
      lat: Number(candidate.lat),
      lng: Number(candidate.lng),
      source: candidate.source || 'openstreetmap',
    };

    state.selectedCourseTemplate = null;

    const saved = getSavedCourseMatch(candidate.name);

    if (saved) {
      // Same path as tapping a saved-course card: tees auto-apply from
      // memory, scorecard renders, chips show.
      selectSavedCourse({
        ...saved,
        location: saved.location || {
          lat: state.selectedNearbyCourse.lat,
          lng: state.selectedNearbyCourse.lng,
        },
      });
      els.nearbyCourseStatus.textContent = `Selected ${state.selectedCourseTemplate.name}. Saved scorecard loaded.`;
      renderNearbyCourses();
      return;
    }

    els.roundSetupCourseSelect.value = '';
    els.roundSetupCourseName.value = candidate.name;
    els.roundSetupTeeName.value = 'Regular tees';
    els.roundSetupSaveCourse.checked = true;

    // Show the tee chips / start hole as soon as a course is chosen.
    const manual = document.getElementById('manualRoundWrap');
    if (manual) manual.open = true;
    // Pars & yardages open too — verifying them against the physical
    // scorecard is exactly what this moment is for.
    const editor = document.getElementById('scorecardEditor');
    if (editor) editor.open = true;

    state.nearbyCourseLoadingScorecard = true;
    renderNearbyCourses();

    // Visible mapping state on the Play map + hard block on Start round.
    setCourseMapping('mapping', {
      name: candidate.name,
      retry: () => selectNearbyCourse(candidate),
    });

    try {
      const elements = await fetchAutoCourseScorecard(candidate);
      const course = buildAutoCourse(candidate, elements);

      state.selectedCourseTemplate = course;
      applyTemplateHoleCount(course);

      els.roundSetupCourseName.value = course.name;
      els.roundSetupTeeName.value = course.teeName;

      renderRoundSetupHoles(course.holes);
      renderTeeSetPicker(course);

      // The scorecard just arrived — open the editor now so verifying
      // pars/yardages against the physical card is the next natural step.
      const editor = document.getElementById('scorecardEditor');
      if (editor) editor.open = true;

      const r = course.importReport;
      els.nearbyCourseStatus.textContent = r && r.holesMapped
        ? `Selected ${course.name}. ${describeImport(course)}. Review flagged holes before starting.`
        : `Selected ${course.name}. No mapped scorecard was found; add pars and yardages manually.`;

      flashMappingSuccess(
        r && r.holesMapped
          ? `${(course.holes || []).length} holes mapped ✓`
          : 'No OSM scorecard found — manual entry'
      );
    } catch (error) {
      console.warn('Auto scorecard lookup failed:', error);

      // Mapping failed: Start stays blocked until a successful retry or
      // the user explicitly clears the course selection.
      setCourseMapping('failed', {
        name: candidate.name,
        retry: () => selectNearbyCourse(candidate),
      });

      state.selectedCourseTemplate = normalizeCourse({
        id: `local:${cryptoId()}`,
        name: candidate.name,
        teeName: 'Regular tees',
        source: 'openstreetmap',
        location: { lat: candidate.lat, lng: candidate.lng },
        holes: defaultCourseHoles(),
      });

      renderRoundSetupHoles(state.selectedCourseTemplate.holes);

      els.nearbyCourseStatus.textContent =
        `Selected ${candidate.name}. Scorecard lookup was unavailable; add pars and yardages manually.`;
    } finally {
      state.nearbyCourseLoadingScorecard = false;
      renderNearbyCourses();
      haptic(8);
    }
  }

  async function findNearbyCourses() {
    state.nearbySearchRequested = true;

    if (!state.loc || state.locStale) {
      setNotice(
        'Getting a fresh GPS fix before searching for nearby courses.',
        'greenish'
      );

      if (!state.gpsRunning) {
        startGPS();
      }

      if (els.nearbyCourseStatus) {
        els.nearbyCourseStatus.textContent =
          'Waiting for a fresh GPS location…';
      }

      return;
    }

    const cache = load(NEARBY_COURSES_CACHE_KEY, null);
    const now = Date.now();

    const cacheIsNearby =
      cache &&
      Number.isFinite(Number(cache.lat)) &&
      Number.isFinite(Number(cache.lng)) &&
      haversineMeters(
        state.loc,
        {
          lat: Number(cache.lat),
          lng: Number(cache.lng),
        }
      ) <= NEARBY_COURSE_RADIUS_M;

    if (
      cacheIsNearby &&
      Array.isArray(cache.courses) &&
      Number.isFinite(cache.ts) &&
      now - cache.ts < NEARBY_COURSES_TTL
    ) {
      state.nearbyCourses = cache.courses;
      state.nearbySearchError = null;
      state.nearbySearchRequested = false;
      renderNearbyCourses();
      return;
    }

    state.nearbyCourseLoading = true;
    renderNearbyCourses();

    const { lat, lng } = state.loc;

    const query = `
    [out:json][timeout:15];
    (
      nwr["leisure"="golf_course"](around:${NEARBY_COURSE_RADIUS_M},${lat},${lng});
      nwr["golf"="course"](around:${NEARBY_COURSE_RADIUS_M},${lat},${lng});
    );
    out center tags;
  `;

    try {
      // Route through the mirror-failover transport instead of one raw
      // request against the most rate-limited endpoint.
      const data = await overpassFetch(query, { timeoutMs: 15000 });
      const seen = new Set();

      const courses = (Array.isArray(data) ? data : [])
        .map((item) => {
          const name = String(item.tags?.name || '').trim();
          const point = item.center || item;

          if (
            !name ||
            !Number.isFinite(Number(point.lat)) ||
            !Number.isFinite(Number(point.lon))
          ) {
            return null;
          }

          return {
            id: `osm:${item.type}:${item.id}`,
            osmType: item.type,      // needed for area-scoped scorecard query
            osmId: Number(item.id),  // needed for area-scoped scorecard query
            name,
            lat: Number(point.lat),
            lng: Number(point.lon),
            source: 'openstreetmap',
          };
        })
        .filter(Boolean)
        .filter((course) => {
          const key = `${course.name.toLowerCase()}|${course.lat.toFixed(
            4
          )}|${course.lng.toFixed(4)}`;

          if (seen.has(key)) return false;

          seen.add(key);
          return true;
        })
        .sort(
          (a, b) =>
            haversineMeters(state.loc, a) -
            haversineMeters(state.loc, b)
        )
        .slice(0, 8);

      state.nearbyCourses = courses;
      state.nearbySearchError = null;

      save(NEARBY_COURSES_CACHE_KEY, {
        ts: now,
        lat,
        lng,
        courses,
      });
    } catch (error) {
      console.warn('Nearby course recognition failed:', error);

      state.nearbyCourses = [];
      state.nearbySearchError =
        error.name === 'AbortError'
          ? 'Nearby course search timed out. Try again.'
          : 'Nearby course search is unavailable right now. Enter the course manually.';

      if (els.nearbyCourseStatus) {
        els.nearbyCourseStatus.textContent = state.nearbySearchError;
      }
    } finally {
      state.nearbyCourseLoading = false;
      state.nearbySearchRequested = false;

      renderNearbyCourses();
    }
  }
  function initRoundSetup() {
    if (
      !els.roundSetupSheet ||
      !els.roundSetupScrim ||
      !els.roundSetupStartBtn ||
      !els.roundSetupCourseSelect ||
      !els.roundSetupCourseName ||
      !els.roundSetupTeeName ||
      !els.roundSetupStartHole ||
      !els.roundSetupPars ||
      !els.roundSetupSaveCourse
    ) {
      console.warn(
        'Round setup was not initialized: one or more setup HTML elements are missing.'
      );
      return;
    }

    if (els.roundSetupCloseBtn) {
      els.roundSetupCloseBtn.addEventListener('click', closeRoundSetup);
    }

    els.roundSetupScrim.addEventListener('click', closeRoundSetup);

    if (els.findNearbyCoursesBtn) {
      els.findNearbyCoursesBtn.addEventListener('click', () => {
        // A manual nearby refresh exits any active name-search filter so
        // the two lists never fight over the same viewport.
        state.courseSearchActive = false;
        state.courseSearchResults = [];
        state.courseSearchError = null;
        if (els.courseSearchInput) els.courseSearchInput.value = '';
        findNearbyCourses();
      });
    }

    if (els.courseSearchInput) {
      let searchTimer = null;
      els.courseSearchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(
          runCourseSearch,
          COURSE_SEARCH_DEBOUNCE_MS
        );
      });
    }

    const nineBtn = document.getElementById('setupNineBtn');
    const eighteenBtn = document.getElementById('setupEighteenBtn');
    if (nineBtn && eighteenBtn) {
      const setCount = (n) => {
        state.setupHolesCount = n;
        syncHolesCountUI();
        renderRoundSetupStartHoleOptions();
        // Re-render visible rows from live input values so typed
        // pars/yardages survive the flip.
        renderRoundSetupHoles(readCurrentSetupHoles());
        haptic(6);
      };
      nineBtn.addEventListener('click', () => setCount(9));
      eighteenBtn.addEventListener('click', () => setCount(18));
    }

    els.roundSetupCourseSelect.addEventListener('change', () => {
      const selectedId = els.roundSetupCourseSelect.value;

      state.selectedNearbyCourse = null;
      state.selectedCourseTemplate = null;
      // User explicitly cleared/re-picked the course: drop any stale
      // mapping-failed block. (An in-flight mapping is never cleared here —
      // it only resolves via its own success/failure.)
      if (state.courseMappingState === 'failed') clearCourseMapping();

      if (!selectedId) {
        els.roundSetupCourseName.value = '';
        els.roundSetupTeeName.value = 'Regular tees';
        els.roundSetupSaveCourse.checked = true;

        state.setupHolesCount = 18;
        syncHolesCountUI();
        renderRoundSetupStartHoleOptions();

        renderRoundSetupHoles(defaultCourseHoles());
        renderTeeSetPicker(null);
        renderSavedCourseList();
        renderNearbyCourses();
        return;
      }

      const selected = state.courseProfiles.find(
        (course) => course.id === selectedId
      );

      if (!selected) return;

      selectSavedCourse(selected);
      renderNearbyCourses();
    });

    els.roundSetupStartBtn.addEventListener('click', () => {
      const course = readRoundSetupCourse();
      const startHole = clamp(
        Math.round(num(els.roundSetupStartHole.value, 1)),
        1,
        18
      );

      save(LAST_ROUND_SETUP_KEY, {
        courseName: course.name,
        teeName: course.teeName,
        startHole,
        holesCount: course.holesCount,
        holes: course.holes,
      });

      if (
        els.roundSetupSaveCourse.checked &&
        course.name.trim() !== '' &&
        course.name !== 'Casual Round'
      ) {
        saveCourseProfile(course);
        rememberCourseTees(course);
      }

      closeRoundSetup();
      beginRound(course, startHole);
    });

    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        els.roundSetupSheet.classList.contains('open')
      ) {
        closeRoundSetup();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        els.roundScoreSheet?.classList.contains('open')
      ) {
        closeRoundScoreSheet();
      }
      if (
        event.key === 'Escape' &&
        els.roundMiniSheet?.classList.contains('open')
      ) {
        closeRoundMiniSheet();
      }
      if (
        event.key === 'Escape' &&
        document
          .getElementById('roundOptionsSheet')
          ?.classList.contains('open')
      ) {
        closeRoundOptionsSheet();
      }
      if (
        event.key === 'Escape' &&
        document
          .getElementById('quickStartSheet')
          ?.classList.contains('open')
      ) {
        closeQuickStartSheet();
      }
      if (
        event.key === 'Escape' &&
        document.getElementById('partnerSheet')?.classList.contains('open')
      ) {
        closePartnerSheet();
      }
    });
  }
  function getRoundScoreDraftForHole(holeNumber) {
    const course = getCurrentCourse();
    const hole =
      course?.holes?.[holeNumber - 1] || defaultHole(holeNumber);
    const fallbackScore = Math.max(1, Number(hole.par) || 4);

    // Partner draft: score only — putts/FIR/GIR are yours alone.
    const pid = state._scorePartnerId || '';
    if (pid) {
      const arr = partnerScoreArray(pid);
      const cur = Number(arr[holeNumber - 1]);
      return {
        hole: holeNumber,
        score:
          Number.isFinite(cur) && cur > 0 ? Math.round(cur) : fallbackScore,
        partnerId: pid,
      };
    }

    const row = getScorecardRows()[holeNumber - 1] || {};

    return {
      hole: holeNumber,
      score:
        row.score !== '' && Number.isFinite(Number(row.score))
          ? Math.max(1, Math.round(Number(row.score)))
          : fallbackScore,

      putts:
        row.putts !== '' && Number.isFinite(Number(row.putts))
          ? Math.max(0, Math.round(Number(row.putts)))
          // Most holes are two-putts: pre-fill with whatever the LAST saved
          // hole took (defaults to 2) so the common case costs zero taps.
          : clamp(Math.round(num(load(LAST_PUTTS_KEY, 2), 2)), 0, 9),

      fir: row.fir || (Number(hole.par) === 3 ? 'NA' : ''),
      gir: row.gir || '',
      penalties: Math.max(0, Math.round(Number(row.penalties) || 0)),
    };
  }

  function getRoundScoreDraft() {
    return getRoundScoreDraftForHole(getCurrentHoleNumber());
  }

  function renderRoundScoreSheet() {
    if (!els.roundScoreSheet || !state.roundScoreDraft) return;

    const draft = state.roundScoreDraft;
    // Meta reflects the hole being EDITED (may differ from the current
    // hole when the player taps an earlier row on the scorecard).
    const course = getCurrentCourse();
    const hole =
      course?.holes?.[draft.hole - 1] || defaultHole(draft.hole);

    const partnerName = scoreDraftPartnerName();
    els.roundScoreTitle.textContent = partnerName
      ? `${partnerName} · Hole ${draft.hole}`
      : `Score Hole ${draft.hole}`;

    els.roundScoreMeta.textContent = [
      course?.name || 'Casual Round',
      `Par ${hole.par || 4}`,
      hole.yards ? `${hole.yards} yd` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    els.roundScoreValue.textContent = String(draft.score);

    // Live vs-par tint (birdie red / bogey blue) while stepping the number.
    const parNow = clamp(Math.round(num(hole.par, 4)), 3, 6);
    els.roundScoreValue.classList.toggle(
      'under',
      draft.score < parNow
    );
    els.roundScoreValue.classList.toggle(
      'over',
      draft.score > parNow
    );

    if (els.roundPuttsOptions) {
      els.roundPuttsOptions.querySelectorAll('button').forEach((button) => {
        const value = Number(button.dataset.putts);

        const active =
          draft.putts !== '' &&
          (value === 4
            ? Number(draft.putts) >= 4
            : Number(draft.putts) === value);

        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }

    if (els.roundFirOptions) {
      els.roundFirOptions.querySelectorAll('button').forEach((button) => {
        const active = draft.fir === button.dataset.fir;

        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }

    if (els.roundGirOptions) {
      els.roundGirOptions.querySelectorAll('button').forEach((button) => {
        const active = draft.gir === button.dataset.gir;

        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }

    if (els.roundPenOptions) {
      const penVal = Math.max(0, Math.round(draft.penalties || 0));
      els.roundPenOptions.querySelectorAll('button').forEach((button) => {
        const active = (Number(button.dataset.pen) || 0) === penVal;

        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }

    // Partner mode: putts / FIR / GIR / penalties are yours-only, so the
    // whole sheet collapses to the score stepper for a partner.
    const draftingPartner = !!draft.partnerId;
    [
      'roundPuttsOptions',
      'roundFirOptions',
      'roundGirOptions',
      'roundPenOptions',
    ].forEach((key) => {
      const el = els[key];
      if (!el) return;
      const section = el.closest('.round-score-section');
      if (section) section.style.display = draftingPartner ? 'none' : '';
    });

    const totalHoles = getCourseHoleCount();
    // "Save & Next" only makes sense when editing the hole you're on.
    const editingCurrentHole =
      (state._scoreSheetHole || draft.hole) === getCurrentHoleNumber();
    const canAdvance =
      editingCurrentHole &&
      getCurrentHoleNumber() < totalHoles &&
      roundStatus() !== 'pending';

    if (els.roundScoreSaveNextBtn) {
      els.roundScoreSaveNextBtn.disabled = !canAdvance;
      els.roundScoreSaveNextBtn.style.opacity = canAdvance ? '1' : '0.5';
      els.roundScoreSaveNextBtn.style.display = editingCurrentHole
        ? ''
        : 'none';
      els.roundScoreSaveNextBtn.textContent =
        getCurrentHoleNumber() >= totalHoles
          ? `Save Hole ${totalHoles}`
          : 'Save & Next';
    }
  }

  function openRoundScoreSheet(holeNumber = null) {
    if (
      !els.roundScoreSheet ||
      !els.roundScoreScrim ||
      roundStatus() === 'idle'
    ) {
      return;
    }

    if (roundStatus() === 'pending') {
      setNotice(
        'Finish or discard the current shot before scoring this hole.',
        'danger'
      );
      haptic(12);
      return;
    }

    state._scorePartnerId = ''; // every open starts on your own card
    state.roundScoreDraft = getRoundScoreDraftForHole(
      holeNumber || getCurrentHoleNumber()
    );
    state._scoreSheetHole = state.roundScoreDraft.hole;

    renderScoreSheetChips();
    renderRoundScoreSheet();

    els.roundScoreScrim.classList.add('open');
    els.roundScoreSheet.classList.add('open');
    els.roundScoreSheet.setAttribute('aria-hidden', 'false');

    haptic(6);
  }

  function closeRoundScoreSheet() {
    if (!els.roundScoreSheet || !els.roundScoreScrim) return;

    els.roundScoreSheet.classList.remove('open');
    els.roundScoreScrim.classList.remove('open');
    els.roundScoreSheet.setAttribute('aria-hidden', 'true');

    state.roundScoreDraft = null;
  }

  // ---- Quick-fix mini-sheet (older holes: score + putts only) ----------
  function openRoundMiniSheet(holeNumber) {
    if (!els.roundMiniSheet || !els.roundScoreScrim) return;
    if (roundStatus() === 'idle') return;
    if (roundStatus() === 'pending') {
      setNotice(
        'Finish or discard the current shot before editing scores.',
        'danger'
      );
      haptic(12);
      return;
    }

    state.roundMiniDraft = getRoundScoreDraftForHole(holeNumber);
    renderRoundMiniSheet();

    els.roundMiniSheet.classList.add('open');
    els.roundMiniSheet.setAttribute('aria-hidden', 'false');
    els.roundScoreScrim.classList.add('open');
    haptic(8);
  }

  function closeRoundMiniSheet() {
    if (!els.roundMiniSheet) return;
    els.roundMiniSheet.classList.remove('open');
    els.roundMiniSheet.setAttribute('aria-hidden', 'true');
    state.roundMiniDraft = null;
    // Only drop the scrim if the full score sheet isn't open behind it.
    if (els.roundScoreSheet && !els.roundScoreSheet.classList.contains('open')) {
      els.roundScoreScrim.classList.remove('open');
    }
  }

  function renderRoundMiniSheet() {
    const draft = state.roundMiniDraft;
    if (!draft || !els.roundMiniValue) return;

    const course = getCurrentCourse();
    const hole = course?.holes?.[draft.hole - 1] || defaultHole(draft.hole);

    els.roundMiniTitle.textContent = `Edit Hole ${draft.hole}`;
    els.roundMiniMeta.textContent = [
      `Par ${hole.par || 4}`,
      hole.yards ? `${hole.yards} yd` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    els.roundMiniValue.textContent = String(draft.score);

    // Live vs-par tint, same convention as the main sheet.
    const parNow = clamp(Math.round(num(hole.par, 4)), 3, 6);
    els.roundMiniValue.classList.toggle('under', draft.score < parNow);
    els.roundMiniValue.classList.toggle('over', draft.score > parNow);

    document
      .querySelectorAll('#roundMiniPuttsOptions button')
      .forEach((button) => {
        const value = Number(button.dataset.putts);
        const active =
          draft.putts !== '' &&
          (value === 4
            ? Number(draft.putts) >= 4
            : Number(draft.putts) === value);
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
  }

  function saveRoundMiniDraft() {
    const draft = state.roundMiniDraft;
    if (!draft || !state.roundSession) return;

    const holeIndex = draft.hole - 1;
    const existing = state.round[holeIndex] || {};

    state.round[holeIndex] = {
      ...existing,
      hole: draft.hole,
      score: String(Math.max(1, Math.round(draft.score))),
      // Mini-sheet never touches FIR/GIR/penalties — preserve them.
      putts:
        draft.putts === ''
          ? ''
          : String(Math.max(0, Math.round(draft.putts))),
    };

    syncRoundScorecard();
    if (draft.putts !== '')
      save(LAST_PUTTS_KEY, Math.max(0, Math.round(draft.putts)));

    closeRoundMiniSheet();

    renderRound();
    renderRoundShotUI();
    renderRoundHoleHeader();
    renderRoundMapHud();
    renderStats();

    setNotice(`Hole ${draft.hole} updated.`, 'greenish');
    haptic(10);
    // Hole just scored? Offer the next one (v1.0.67).
    maybePromptNextHole(draft.hole, state.round[holeIndex].score);
    syncHoleAdvancePrompt();
  }

  function saveRoundScoreDraft(andNext = false) {
    const draft = state.roundScoreDraft;
    const rs = state.roundSession;

    if (!draft || !rs) return;

    const holeIndex = draft.hole - 1;

    if (draft.partnerId) {
      // Partner write: isolated lane, session-only storage.
      const arr = partnerScoreArray(draft.partnerId);
      arr[holeIndex] = String(Math.max(1, Math.round(draft.score)));
      saveRoundSession();
    } else {
      state.round[holeIndex] = {
        ...state.round[holeIndex],
        hole: draft.hole,
        score: String(Math.max(1, Math.round(draft.score))),
        putts:
          draft.putts === ''
            ? ''
            : String(Math.max(0, Math.round(draft.putts))),
        fir: draft.fir || '',
        gir: draft.gir || '',
        penalties: Math.max(0, Math.round(draft.penalties || 0)),
      };

      syncRoundScorecard();

      // Remember for the next hole's pre-fill.
      if (draft.putts !== '')
        save(LAST_PUTTS_KEY, Math.max(0, Math.round(draft.putts)));
    }

    const shouldAdvance =
      andNext &&
      draft.hole === rs.hole &&
      rs.hole < getCourseHoleCount() &&
      rs.status !== 'pending';

    if (shouldAdvance) {
      rs.hole += 1;
      rs.currentHole = rs.hole;
      saveRoundSession();
    }

    closeRoundScoreSheet();

    renderRound();
    renderRoundShotUI();
    renderRoundHoleHeader();
    renderRoundMapHud();
    renderStats();

    const who = draft.partnerId
      ? scoreDraftPartnerName() || 'Partner'
      : `Hole ${draft.hole}`;
    if (shouldAdvance) {
      setNotice(
        `${who} saved${draft.partnerId ? ` for hole ${draft.hole}` : ''
        }. Now playing Hole ${rs.hole}.`,
        'greenish'
      );
    } else {
      setNotice(`${who} saved.`, 'greenish');
    }

    haptic(10);
    // Hole just scored (and we didn't already auto-advance)? Offer the
    // next one (v1.0.67).
    if (!draft.partnerId && !shouldAdvance) {
      maybePromptNextHole(draft.hole, state.round[holeIndex].score);
    }
    syncHoleAdvancePrompt();
  }
  function initRoundMode() {
    if (els.roundMapScoreBtn) {
      // QA-001: must not pass the click event through as `holeNumber` —
      // the PointerEvent is truthy, so the sheet bound to hole NaN and
      // saving wrote to a non-index slot (score silently lost).
      els.roundMapScoreBtn.addEventListener('click', () =>
        openRoundScoreSheet()
      );
    }

    if (els.roundScoreCloseBtn) {
      els.roundScoreCloseBtn.addEventListener('click', closeRoundScoreSheet);
    }

    // Quick-fix mini-sheet wiring.
    const miniClose = $('roundMiniCloseBtn');
    if (miniClose) miniClose.addEventListener('click', closeRoundMiniSheet);
    if (els.roundMiniMinusBtn) {
      els.roundMiniMinusBtn.addEventListener('click', () => {
        if (!state.roundMiniDraft) return;
        state.roundMiniDraft.score = Math.max(
          1,
          state.roundMiniDraft.score - 1
        );
        renderRoundMiniSheet();
        haptic(4);
      });
    }
    if (els.roundMiniPlusBtn) {
      els.roundMiniPlusBtn.addEventListener('click', () => {
        if (!state.roundMiniDraft) return;
        state.roundMiniDraft.score = Math.min(
          15,
          state.roundMiniDraft.score + 1
        );
        renderRoundMiniSheet();
        haptic(4);
      });
    }
    const miniPutts = $('roundMiniPuttsOptions');
    if (miniPutts) {
      miniPutts.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          if (!state.roundMiniDraft) return;
          const value = Number(button.dataset.putts);
          state.roundMiniDraft.putts =
            state.roundMiniDraft.putts !== '' &&
            Number(state.roundMiniDraft.putts) === value
              ? ''
              : value;
          renderRoundMiniSheet();
          haptic(4);
        });
      });
    }
    const miniSave = $('roundMiniSaveBtn');
    if (miniSave) miniSave.addEventListener('click', saveRoundMiniDraft);

    // Escape hatch: jump from the quick-fix to the full sheet, same hole.
    const miniFull = $('roundMiniFullBtn');
    if (miniFull) {
      miniFull.addEventListener('click', () => {
        const draft = state.roundMiniDraft;
        if (!draft) return;
        const hole = draft.hole;
        closeRoundMiniSheet();
        openRoundScoreSheet(hole);
      });
    }

    // Quick-start confirm sheet wiring.
    const qsClose = $('quickStartCloseBtn');
    if (qsClose) qsClose.addEventListener('click', closeQuickStartSheet);
    const qsGo = $('quickStartGoBtn');
    if (qsGo) {
      qsGo.addEventListener('click', () => {
        const course = state.quickStartCourse;
        closeQuickStartSheet();
        if (!course) return;
        rememberCourseTees(course);
        beginRound(course, 1);
      });
    }
    const qsDetails = $('quickStartDetailsBtn');
    if (qsDetails) {
      qsDetails.addEventListener('click', () => {
        const course = state.quickStartCourse;
        if (!course) return;
        // Focused options sheet — not the full form. The course is
        // already chosen; only tees, start hole, and group matter here.
        openRoundOptionsSheet(course);
      });
    }

    // Round-options sheet wiring.
    const roClose = $('roundOptionsCloseBtn');
    if (roClose) roClose.addEventListener('click', closeRoundOptionsSheet);
    const roStart = $('optionsStartBtn');
    if (roStart) {
      roStart.addEventListener('click', () => {
        const course = state.optionsCourse;
        const startHole = clamp(
          Math.round(num($('optionsStartHole')?.value, 1)),
          1,
          18
        );
        // QA-002: snapshot the group BEFORE closing — closeRoundOptionsSheet
        // nulls optionsGroupPlayers, which used to leave the round Solo no
        // matter what partners the player added in this sheet.
        const group = (state.optionsGroupPlayers || []).map((p) => ({
          ...p,
        }));
        closeRoundOptionsSheet();
        if (!course) return;
        // Adopt the options-sheet group into the new session.
        state._pendingGroupPlayers = group;
        rememberCourseTees(course);
        beginRound(course, startHole);
      });
    }
    const roAdd = $('optionsAddPartner');
    if (roAdd) {
      roAdd.addEventListener('click', () => {
        if ((state.optionsGroupPlayers || []).length >= GROUP_MAX_PARTNERS) {
          setNotice(`Maximum ${GROUP_MAX_PARTNERS} partners.`, 'danger');
          return;
        }
        openPartnerSheet();
      });
    }

    // Add/rename partner sheet wiring.
    const pClose = $('partnerSheetCloseBtn');
    if (pClose) pClose.addEventListener('click', closePartnerSheet);
    const pCancel = $('partnerCancelBtn');
    if (pCancel) pCancel.addEventListener('click', closePartnerSheet);
    const pSave = $('partnerSaveBtn');
    if (pSave) pSave.addEventListener('click', commitPartnerSheet);
    const pRemove = $('partnerRemoveBtn');
    if (pRemove) {
      pRemove.addEventListener('click', removePartnerFromSheet);
    }
    const pInput = $('partnerNameInput');
    if (pInput) {
      pInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitPartnerSheet();
        }
      });
    }

    if (els.roundScoreScrim) {
      els.roundScoreScrim.addEventListener('click', () => {
        const partnerOpen = document
          .getElementById('partnerSheet')
          ?.classList.contains('open');
        if (partnerOpen) {
          closePartnerSheet();
          return;
        }
        const optsOpen = document
          .getElementById('roundOptionsSheet')
          ?.classList.contains('open');
        if (optsOpen) {
          closeRoundOptionsSheet();
        } else if (state.quickStartCourse) {
          closeQuickStartSheet();
        } else if (state.roundMiniDraft) {
          closeRoundMiniSheet();
        } else {
          closeRoundScoreSheet();
        }
      });
    }

    if (els.roundScoreMinusBtn) {
      els.roundScoreMinusBtn.addEventListener('click', () => {
        if (!state.roundScoreDraft) return;

        state.roundScoreDraft.score = Math.max(
          1,
          state.roundScoreDraft.score - 1
        );

        renderRoundScoreSheet();
        haptic(4);
      });
    }

    if (els.roundScorePlusBtn) {
      els.roundScorePlusBtn.addEventListener('click', () => {
        if (!state.roundScoreDraft) return;

        state.roundScoreDraft.score = Math.min(
          15,
          state.roundScoreDraft.score + 1
        );

        renderRoundScoreSheet();
        haptic(4);
      });
    }

    if (els.roundPuttsOptions) {
      els.roundPuttsOptions.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          if (!state.roundScoreDraft) return;

          const value = Number(button.dataset.putts);

          // Toggle: tapping the active putts count clears it, matching the
          // FIR / GIR buttons.
          state.roundScoreDraft.putts =
            state.roundScoreDraft.putts !== '' &&
              Number(state.roundScoreDraft.putts) === value
              ? ''
              : value;

          renderRoundScoreSheet();
          haptic(4);
        });
      });
    }

    if (els.roundFirOptions) {
      els.roundFirOptions.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          if (!state.roundScoreDraft) return;

          const value = button.dataset.fir;

          state.roundScoreDraft.fir =
            state.roundScoreDraft.fir === value ? '' : value;

          renderRoundScoreSheet();
          haptic(4);
        });
      });
    }

    if (els.roundGirOptions) {
      els.roundGirOptions.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          if (!state.roundScoreDraft) return;

          const value = button.dataset.gir;

          state.roundScoreDraft.gir =
            state.roundScoreDraft.gir === value ? '' : value;

          renderRoundScoreSheet();
          haptic(4);
        });
      });
    }

    renderScoreSheetChips();

    if (els.roundPenOptions) {
      els.roundPenOptions.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          if (!state.roundScoreDraft) return;

          const value = Number(button.dataset.pen) || 0;

          // Toggle: tapping the active count returns it to zero.
          state.roundScoreDraft.penalties =
            (state.roundScoreDraft.penalties || 0) === value && value !== 0
              ? 0
              : value;

          renderRoundScoreSheet();
          haptic(4);
        });
      });
    }

    if (els.roundScoreSaveBtn) {
      els.roundScoreSaveBtn.addEventListener('click', () => {
        saveRoundScoreDraft(false);
      });
    }

    if (els.roundScoreSaveNextBtn) {
      els.roundScoreSaveNextBtn.addEventListener('click', () => {
        saveRoundScoreDraft(true);
      });
    }
    if (els.roundMapPrevBtn) {
      els.roundMapPrevBtn.addEventListener('click', previousHole);
    }

    if (els.roundMapNextBtn) {
      els.roundMapNextBtn.addEventListener('click', nextHole);
    }
    if (els.roundActionBtn) {
      els.roundActionBtn.addEventListener('click', () => {
        const status = roundStatus();

        if (status === 'idle') {
          startRound();
        } else if (status === 'active') {
          startShot();
        } else {
          finishShot(false);
        }
      });
    }

    // Course-mapping pill retry: re-run the failed scorecard lookup.
    if (els.courseMappingRetryBtn) {
      els.courseMappingRetryBtn.addEventListener('click', () => {
        const retry = state.courseMappingRetry;
        if (typeof retry === 'function') {
          haptic(6);
          retry();
        } else {
          clearCourseMapping();
        }
      });
    }

    if (els.roundDiscardBtn) {
      els.roundDiscardBtn.addEventListener('click', () => finishShot(true));
    }

    if (els.roundPrevHoleBtn) {
      els.roundPrevHoleBtn.addEventListener('click', previousHole);
    }

    if (els.roundNextHoleBtn) {
      els.roundNextHoleBtn.addEventListener('click', nextHole);
    }

    if (els.roundEndBtn) {
      // v1.0.69: confirm before destroying a round — never end directly.
      els.roundEndBtn.addEventListener('click', requestEndRound);
    }

    const erConfirm = document.getElementById('endRoundConfirmBtn');
    if (erConfirm) {
      erConfirm.addEventListener('click', () => {
        haptic(12);
        closeEndRoundConfirm();
        endRound();
      });
    }
    const erCancel = document.getElementById('endRoundCancelBtn');
    if (erCancel) {
      erCancel.addEventListener('click', () => {
        haptic(6);
        closeEndRoundConfirm();
      });
    }

    if (els.roundFab) {
      els.roundFab.addEventListener('click', () => {
        const status = roundStatus();

        if (status === 'active') {
          startShot();
        } else if (status === 'pending') {
          finishShot(false);
        }
      });
    }

    if (els.roundFabClub) {
      els.roundFabClub.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleClubPop();
        haptic(5);
      });
    }

    if (window.L && L.DomEvent && els.roundFabWrap) {
      L.DomEvent.disableClickPropagation(els.roundFabWrap);
    }

    // Auto hole-change prompt chip: ✕ dismisses, tapping the body advances.
    if (els.holeAdvanceChip) {
      els.holeAdvanceChip.addEventListener('click', (e) => {
        if (e.target.closest('.hole-advance-x')) {
          _holeAdvanceDismissedFor = state.roundSession
            ? state.roundSession.hole
            : null;
          hideHoleAdvanceChip();
          haptic(5);
          return;
        }
        advanceToNextHoleFromTee();
      });
    }

    // Round-end summary: scrim / ✕ / Finish all end the round without a
    // history entry; Save to history records it first.
    if (els.roundSummaryCloseBtn)
      els.roundSummaryCloseBtn.addEventListener('click', () =>
        closeRoundSummary(false)
      );
    if (els.roundSummaryScrim)
      els.roundSummaryScrim.addEventListener('click', () =>
        closeRoundSummary(false)
      );
    if (els.roundSummaryFinishBtn)
      els.roundSummaryFinishBtn.addEventListener('click', () =>
        closeRoundSummary(false)
      );
    if (els.roundSummarySaveBtn)
      els.roundSummarySaveBtn.addEventListener('click', () =>
        closeRoundSummary(true)
      );
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        els.roundSummarySheet?.classList.contains('open')
      ) {
        closeRoundSummary(false);
      }
    });

    initGroupEvents();
    renderRoundShotUI();
  }

  function initStatsEvents() {
    els.saveRoundBtn.addEventListener('click', () => {
      const s = summarizeRound(state.round);
      if (!s.played) {
        alert('Enter at least one hole score before saving.');
        return;
      }
      state.history.push({ date: new Date().toISOString(), ...s });
      save('caddy:history', state.history);
      if (confirm('Round saved to history. Start a fresh scorecard?')) {
        state.round = emptyRound();
        save('caddy:round', state.round);
        renderRound();
      }
      renderStats();
    });
  }

  function initLayerSeg() {
    const seg = els.layerSeg,
      thumb = els.segThumb,
      opts = [...seg.querySelectorAll('.seg-opt')];
    function moveThumb(btn) {
      if (!btn) return;
      thumb.style.width = btn.offsetWidth + 'px';
      thumb.style.transform = `translateX(${btn.offsetLeft - 3}px)`;
    }
    function select(btn) {
      opts.forEach((o) => {
        o.classList.remove('active');
        o.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-checked', 'true');
      moveThumb(btn);
      initMap();
      setMapLayer(btn.dataset.layer);
      haptic(6);
    }
    opts.forEach((o) => o.addEventListener('click', () => select(o)));
    const saved = migrateLayer(state.prefs.mapLayer || 'satellite');
    const target = opts.find((o) => o.dataset.layer === saved) || opts[0];
    requestAnimationFrame(() => {
      opts.forEach((o) => {
        o.classList.remove('active');
        o.setAttribute('aria-checked', 'false');
      });
      target.classList.add('active');
      target.setAttribute('aria-checked', 'true');
      moveThumb(target);
    });
    window.addEventListener('resize', () =>
      moveThumb(seg.querySelector('.active') || opts[0])
    );
  }

  function initSettingsSheet() {
    const refreshShotDataDesc = () => {
      if (!els.shotDataDesc) return;
      const { total, clubs } = shotDataSummary();
      els.shotDataDesc.textContent = total
        ? `${total} shot${total === 1 ? '' : 's'} logged across ${clubs} club${clubs === 1 ? '' : 's'
        }. Resets dispersion to the formula default.`
        : 'No shots logged yet. Track shots in Round mode to teach Caddy your distances.';
    };
    const open = () => {
      refreshShotDataDesc();
      els.settingsSheet.classList.add('open');
      els.settingsScrim.classList.add('open');
      els.settingsSheet.setAttribute('aria-hidden', 'false');
      haptic(6);
    };
    const close = () => {
      els.settingsSheet.classList.remove('open');
      els.settingsScrim.classList.remove('open');
      els.settingsSheet.setAttribute('aria-hidden', 'true');
    };
    els.settingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      open();
    });
    els.settingsScrim.addEventListener('click', close);
    els.settingsDoneBtn.addEventListener('click', close);
    els.proToggleSheet.addEventListener('change', () =>
      setPro(els.proToggleSheet.checked)
    );
    document.querySelectorAll('#themeSeg .seg-opt').forEach((b) => {
      b.addEventListener('click', () => setTheme(b.dataset.theme));
    });
    const dispersionToggle = $('dispersionToggle');
    if (dispersionToggle) {
      dispersionToggle.addEventListener('change', () => {
        state.prefs.dispersionZone = dispersionToggle.checked;
        save('caddy:prefs', state.prefs);
        if (state.target && state.loc) calculateRange();
        else clearDispersionZone();
        haptic(5);
      });
    }
    if (els.replayOnboardBtn) {
      els.replayOnboardBtn.addEventListener('click', () => {
        close();
        try {
          localStorage.removeItem(ONBOARD_KEY);
        } catch { }
        showOnboard();
      });
    }
    if (els.resetShotDataBtn) {
      els.resetShotDataBtn.addEventListener('click', () => {
        const { total } = shotDataSummary();
        if (!total) {
          refreshShotDataDesc();
          return;
        }
        if (
          !confirm(
            `Delete all ${total} logged shot distance${total === 1 ? '' : 's'
            }? Recommendations will fall back to the formula. This can't be undone.`
          )
        )
          return;
        clearShotData();
        refreshShotDataDesc();
        haptic(12);
        // Recompute with formula-only dispersion.
        if (state.target && state.loc) calculateRange();
      });
    }
    // ---- Backup / restore / CSV export ----
    if (els.backupBtn) {
      els.backupBtn.addEventListener('click', () => {
        const payload = JSON.stringify(buildBackupObject());
        exportTextFile(
          `caddy-backup-${new Date().toISOString().slice(0, 10)}.json`,
          payload,
          'application/json'
        );
        haptic(8);
      });
    }
    if (els.restoreBtn && els.restoreInput) {
      els.restoreBtn.addEventListener('click', () => {
        els.restoreInput.click();
      });
      els.restoreInput.addEventListener('change', () => {
        const f =
          els.restoreInput.files && els.restoreInput.files[0];
        els.restoreInput.value = ''; // allow re-selecting the same file later
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          let obj = null;
          try {
            obj = JSON.parse(String(reader.result));
          } catch {
            alert('That file is not valid JSON.');
            return;
          }
          let summary;
          try {
            summary = describeBackup(obj);
          } catch (err) {
            alert(err && err.message ? err.message : 'Not a Caddy backup file.');
            return;
          }
          if (
            !confirm(
              `${summary}\n\nRestoring replaces the current local data. Continue?`
            )
          )
            return;
          try {
            applyBackupObject(obj);
            reloadStateFromStorage();
            haptic(12);
            alert('Backup restored.');
          } catch (err) {
            alert(err && err.message ? err.message : 'Restore failed.');
          }
        };
        reader.onerror = () => alert('Could not read that file.');
        reader.readAsText(f);
      });
    }
    if (els.exportCsvBtn) {
      els.exportCsvBtn.addEventListener('click', () => {
        const csv = buildShotLogCsv();
        if (!csv.includes('\n')) {
          alert('No shots logged yet — track some in Round mode first.');
          return;
        }
        exportTextFile(
          `caddy-shots-${new Date().toISOString().slice(0, 10)}.csv`,
          csv,
          'text/csv'
        );
        haptic(8);
      });
    }

    els.settingsSheet
      .querySelector('.sheet-handle')
      ?.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.settingsSheet.classList.contains('open'))
        close();
    });
  }

  /* ============================================================
     DATA SAFETY — full JSON backup/restore + shot-log CSV export.
     Everything Caddy knows lives in localStorage; one bad wipe loses
     it. Export goes through the iOS share sheet when available and
     falls back to a classic file download everywhere else.
  ============================================================ */

  const BACKUP_KEYS = [
    ['prefs', 'caddy:prefs'],
    ['clubs', 'caddy:clubs'],
    ['bagClubs', 'caddy.bag.clubs.v1'],   // premium Bag tab: category/loft/shaft/notes (bag.js)
    ['bagUi', 'caddy.bag.ui.v1'],         // premium Bag tab: collapsed groups
    ['courseProfiles', COURSE_PROFILES_KEY],
    ['shotLog', 'caddy:shotLog:v1'],    // literal on purpose: SHOTLOG_KEY is declared later in the file (Block 0), and reading it here would throw a TDZ ReferenceError at startup
    ['roundSession', 'caddy:roundSession'],
    ['round', 'caddy:round'],
    ['history', 'caddy:history'],
    ['pinMemory', PIN_MEMORY_KEY],
    ['lastRoundSetup', LAST_ROUND_SETUP_KEY],
  ];

  function buildBackupObject() {
    const data = {};
    for (const [name, key] of BACKUP_KEYS) {
      const v = load(key, null);
      if (v != null) data[name] = v;
    }
    return {
      app: 'caddy',
      schema: 1,
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      data,
    };
  }

  function describeBackup(obj) {
    if (!obj || obj.app !== 'caddy' || !obj.data)
      throw new Error('Not a Caddy backup file.');
    const d = obj.data;
    let shots = 0;
    if (d.shotLog && typeof d.shotLog === 'object') {
      for (const k of Object.keys(d.shotLog)) {
        shots += (d.shotLog[k] || []).map(normalizeShotEntry).filter(Boolean)
          .length;
      }
    }
    const courses = Array.isArray(d.courseProfiles)
      ? d.courseProfiles.length
      : 0;
    const histRounds = Array.isArray(d.history) ? d.history.length : 0;
    const when = obj.exportedAt
      ? new Date(obj.exportedAt).toLocaleDateString()
      : 'unknown date';
    return (
      `Caddy backup (${when}) — ${shots} tracked shots · ${courses} saved ` +
      `courses · ${histRounds} rounds of history.`
    );
  }

  function applyBackupObject(obj) {
    const d = describeBackup(obj) && obj.data; // validates shape first
    if (d.clubs && !Array.isArray(d.clubs))
      throw new Error('Backup contains malformed club data.');
    for (const [name, key] of BACKUP_KEYS) {
      if (name === 'shotLog') continue; // handled below via saveShotLog
      if (d[name] != null) save(key, d[name]);
    }
    if (d.shotLog != null) saveShotLog(d.shotLog);
  }

  // Re-hydrate every in-memory structure from storage after a restore.
  function reloadStateFromStorage() {
    state.prefs = load('caddy:prefs', state.prefs);
    state.clubs = loadArr('caddy:clubs', DEFAULT_CLUBS, (c) => c && typeof c === 'object');
    state.courseProfiles = loadArr(COURSE_PROFILES_KEY, [], (c) => c && typeof c === 'object');
    state.round = loadArr('caddy:round', emptyRound());
    state.history = loadArr('caddy:history', [], (h) => h && typeof h === 'object');
    state.roundSession = load('caddy:roundSession', null);

    // Invalidate every derived-data cache.
    _shotLogCache = null;
    _clubStatsCache.clear();
    _carryMemo.clear();
    _plCache.clear();

    migrateRoundSession();
    applyPrefs();
    renderClubs();
    renderClubChips(state.lastCalc ? state.lastCalc.playsLikeYd : 0);
    renderRound();
    renderStats();
    renderRoundShotUI();
    renderPlanner();
    if (state.prefs.mode === 'range') renderPracticeSection();
  }

  // Share-sheet-first file handoff with a download-anchor fallback.
  async function exportTextFile(filename, text, mime) {
    try {
      const file = new File([text], filename, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user closed the share sheet
    }
    try {
      const url = URL.createObjectURL(new Blob([text], { type: mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { }
  }

  function csvCell(v) {
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildShotLogCsv() {
    const log = loadShotLog();
    const rows = [
      ['club', 'date', 'total_yd', 'carry_yd', 'lateral_yd', 'gps_acc_m'],
    ];
    for (const c of sortedClubsDesc()) {
      const entries = (log[c.id] || [])
        .map(normalizeShotEntry)
        .filter(Boolean);
      for (const e of entries) {
        rows.push([
          c.name,
          e.t ? new Date(e.t).toISOString() : '',
          e.d != null ? e.d : '',
          e.c != null ? e.c : '',
          e.l != null ? e.l : '',
          e.a != null ? e.a : '',
        ]);
      }
    }
    return rows.map((r) => r.map(csvCell).join(',')).join('\n');
  }

  function initSheet() {
    const sheet = els.sheet,
      drag = els.sheetDrag,
      wrap = els.rangeWrap;
    const fcbBlock = sheet.querySelector('.fcb-block');
    const scrollArea = sheet.querySelector('.sheet-scroll');
    let H = 0,
      maxY = 0,
      curY = 0,
      startY = 0,
      startT = 0,
      dragging = false,
      lastY = 0,
      lastT = 0,
      vel = 0,
      moved = 0,
      followRafPending = false;
    const clmp = (v, a, b) => Math.min(b, Math.max(a, v));
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const invLerp = (a, b, v) => (a === b ? 1 : (v - a) / (b - a));

    function headerH() {
      return drag.offsetHeight || 130;
    }
    // Collapsed band (v1.0.69): handle + the peek summary row ONLY —
    // NOT the full number band, which sits below the fold at collapsed.
    // This kills the old dead dark slab above the fold.
    let cachedCollapsedBand = 72;
    const peekEl = sheet.querySelector('.sheet-peek');
    function measureCollapsedBand() {
      const dragH = drag.offsetHeight || 130;
      const peekH = peekEl ? peekEl.offsetHeight : 0;
      cachedCollapsedBand = clmp(dragH - peekH, 56, 120) || 72;
      return cachedCollapsedBand;
    }
    function tabTotalPx() {
      const tabs = document.querySelector('.bottom-tabs');
      return tabs ? tabs.getBoundingClientRect().height : 78;
    }

    let cachedFcbH = 150;
    function measureFcbHeight() {
      if (!fcbBlock) return 150;
      const prevMax = fcbBlock.style.maxHeight;
      const prevOpacity = fcbBlock.style.opacity;
      fcbBlock.style.maxHeight = 'none';
      fcbBlock.style.opacity = '1';
      const h = fcbBlock.scrollHeight;
      fcbBlock.style.maxHeight = prevMax;
      fcbBlock.style.opacity = prevOpacity;
      cachedFcbH = h || 150;
      return cachedFcbH;
    }

    function detents() {
      const dragH = headerH();
      const fcbH = cachedFcbH;
      const collapsed = clmp(H - measureCollapsedBand(), 0, maxY);
      const half = clmp(H - (dragH + fcbH + 10), 0, maxY);
      const full = 0;
      return { collapsed, half, full };
    }
    function nearestName(y) {
      const d = detents();
      const arr = [
        ['collapsed', d.collapsed],
        ['half', d.half],
        ['full', d.full],
      ];
      arr.sort((a, b) => Math.abs(a[1] - y) - Math.abs(b[1] - y));
      return arr[0][0];
    }
    function applyDetentAttr(name) {
      document.body.setAttribute('data-detent', name);
    }

    function setReveal(y) {
      const d = detents();
      const fcbR = clamp01(invLerp(d.collapsed, d.half, y));
      const detailR = clamp01(invLerp(d.half, d.full, y));
      sheet.style.setProperty('--fcb-reveal', fcbR.toFixed(3));
      sheet.style.setProperty('--detail-reveal', detailR.toFixed(3));
      // Mirror onto the wrap so the floating pills (siblings of the sheet)
      // can fade live during the drag.
      wrap.style.setProperty('--detail-reveal', detailR.toFixed(3));
      // Continuous hero-capsule fade: 1 when sheet collapsed → 0 as it rises
      // past half. Driven every frame, so no reliance on detent snapping.
      wrap.style.setProperty('--rx-hero-fade', (1 - fcbR).toFixed(3));
    }
    function followFrameDuringDrag() {
      if (!state.followUser || !state.loc || !state.map || followRafPending)
        return;
      followRafPending = true;
      requestAnimationFrame(() => {
        followRafPending = false;
        if (!state.followUser || !state.loc || !state.map) return;
        // Only LOCKED exists now.
        holdLockedView({ lat: state.loc.lat, lng: state.loc.lng }, false);
      });
    }
    function revealForDetent(name) {
      if (name === 'collapsed') return { fcb: 0, detail: 0 };
      if (name === 'half') return { fcb: 1, detail: 0 };
      return { fcb: 1, detail: 1 };
    }

    // FIX: drive a single shared --ui-lift on .range-wrap so the GPS pill
    // AND the Leaflet zoom control both ride the sheet on the compositor,
    // frame-locked during drag and the spring snap.
    function setY(y, animate) {
      curY = clmp(y, 0, maxY);
      sheet.classList.toggle('animate', !!animate && !reduceMotion);
      sheet.style.setProperty('--sheet-y', curY + 'px');
      const lift = H - curY + tabTotalPx() + 12;
      wrap.style.setProperty('--ui-lift', lift + 'px');
      drag.setAttribute('aria-expanded', String(curY < maxY * 0.5));
    }
    function snapTo(name, haptics) {
      const previous = document.body.getAttribute('data-detent') || 'collapsed';
      const d = detents();
      const wasDragging = document.body.getAttribute('data-dragging') === '1';

      setY(d[name], !wasDragging);
      applyDetentAttr(name);

      // Remember the chosen detent so the sheet reopens where you left it.
      state.prefs.sheetDetent = name;
      save('caddy:prefs', state.prefs);

      if (wasDragging) {
        const r = revealForDetent(name);
        sheet.style.setProperty('--fcb-reveal', String(r.fcb));
        sheet.style.setProperty('--detail-reveal', String(r.detail));
        wrap.style.setProperty('--detail-reveal', String(r.detail));
        // Hero fade mirrors the detent: visible only when fully collapsed.
        wrap.style.setProperty('--rx-hero-fade', name === 'collapsed' ? '1' : '0');
        void sheet.offsetHeight;
        requestAnimationFrame(() => {
          document.body.removeAttribute('data-dragging');
          sheet.style.removeProperty('--fcb-reveal');
          sheet.style.removeProperty('--detail-reveal');
          wrap.style.removeProperty('--detail-reveal');
          wrap.style.removeProperty('--rx-hero-fade');
          sheet.classList.add('animate');
        });
      } else {
        sheet.style.removeProperty('--fcb-reveal');
        sheet.style.removeProperty('--detail-reveal');
        wrap.style.removeProperty('--detail-reveal');
        wrap.style.removeProperty('--rx-hero-fade');
      }

      if (
        previous === 'full' &&
        (name === 'half' || name === 'collapsed') &&
        scrollArea
      ) {
        scrollArea.scrollTop = 0;
      }
      // At full-sheet size, advice is shown inline in the shot card instead
      // of as a floating map popover.
      if (name === 'full' && typeof closeAdvice === 'function') {
        closeAdvice();
      }

      // Do not leave an expanded inline panel around when the card disappears.
      if (name !== 'full' && typeof closeInlineAdvice === 'function') {
        closeInlineAdvice();
      }
      // If actively following the user, re-frame for the new detent so
      // the dot stays in the clear area (handles collapse-while-tracking).
      if (
        state.followUser &&
        state.loc &&
        state.map &&
        state.followMode === FollowMode.LOCKED
      ) {
        holdLockedView({ lat: state.loc.lat, lng: state.loc.lng }, false);
      }
      if (haptics) haptic(8);
    }
    let measureRetries = 0;
    function measure() {
      const h = sheet.offsetHeight;
      // The sheet lives in the Range screen; on other tabs it collapses to
      // 0px. Retry a bounded number of times (for layout settling) instead
      // of spinning rAF forever while hidden.
      if ((!h || !drag.offsetHeight) && measureRetries < 30) {
        measureRetries++;
        requestAnimationFrame(measure);
        return;
      }
      measureRetries = 0;
      if (!h || !drag.offsetHeight) return;
      H = h;
      maxY = Math.max(0, H - headerH());
      measureFcbHeight();
      document.documentElement.style.setProperty(
        '--sheet-peek',
        measureCollapsedBand() + 'px'
      );
      const cur = document.body.getAttribute('data-detent') || 'collapsed';
      const d = detents();
      setY(d[cur] ?? d.collapsed, false);
      applyDetentAttr(cur);
    }
    function cycleUp() {
      const cur = document.body.getAttribute('data-detent') || 'collapsed';
      snapTo(
        cur === 'collapsed' ? 'half' : cur === 'half' ? 'full' : 'collapsed',
        true
      );
    }

    drag.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = 0;
      startY = e.clientY;
      startT = curY;
      lastY = e.clientY;
      lastT = performance.now();
      sheet.classList.remove('animate');
      document.body.setAttribute('data-dragging', '1');
      measureFcbHeight();
      setReveal(curY);
      try {
        drag.setPointerCapture(e.pointerId);
      } catch { }
    });
    drag.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      moved = Math.max(moved, Math.abs(dy));
      const now = performance.now();
      vel = (e.clientY - lastY) / Math.max(1, now - lastT);
      lastY = e.clientY;
      lastT = now;
      setY(startT + dy, false);
      setReveal(curY);
      // When auto-centering, pan the dot live so it tracks the sheet the
      // same way the pills fade — no end-of-drag jump.
      followFrameDuringDrag();
    });
    function end(e) {
      if (!dragging) return;
      dragging = false;
      try {
        drag.releasePointerCapture(e.pointerId);
      } catch { }
      if (moved < 5) {
        document.body.removeAttribute('data-dragging');
        sheet.style.removeProperty('--fcb-reveal');
        sheet.style.removeProperty('--detail-reveal');
        wrap.style.removeProperty('--detail-reveal');
        wrap.style.removeProperty('--rx-hero-fade');
        cycleUp();
        return;
      }
      const projected = clmp(curY + vel * 160, 0, maxY);
      snapTo(nearestName(projected), true);
    }
    drag.addEventListener('pointerup', end);
    drag.addEventListener('pointercancel', end);
    drag.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        cycleUp();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const cur = document.body.getAttribute('data-detent') || 'collapsed';
        snapTo(cur === 'collapsed' ? 'half' : 'full', true);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = document.body.getAttribute('data-detent') || 'collapsed';
        snapTo(cur === 'full' ? 'half' : 'collapsed', true);
      }
    });
    window.addEventListener('resize', () => requestAnimationFrame(measure));
    window.addEventListener('orientationchange', () =>
      setTimeout(measure, 250)
    );
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () =>
        requestAnimationFrame(measure)
      );
    }

    state.sheet = {
      measure,
      expand: () => snapTo('full', true),
      half: () => snapTo('half', true),
      collapse: () => snapTo('collapsed', true),
    };
    // Reopen at the detent last used (premium apps remember your state).
    applyDetentAttr(
      ['collapsed', 'half', 'full'].includes(state.prefs.sheetDetent)
        ? state.prefs.sheetDetent
        : 'collapsed'
    );
    requestAnimationFrame(() => requestAnimationFrame(measure));
  }

  // Measure ONLY the sheet's actual covered band, from its visual (transformed) top.
  function bottomObstructionPx() {
    const mapEl = state.map && state.map.getContainer();
    const sheetEl = els.sheet;
    if (!mapEl || !sheetEl) return 0;
    const mapR = mapEl.getBoundingClientRect();
    const shR = sheetEl.getBoundingClientRect();
    const covered = mapR.bottom - shR.top;
    return clamp(covered, 0, Math.max(0, mapR.height - 120));
  }
  // Keep the user pinned at the screen pixel captured when locking.
  function holdLockedView(latlng, animate) {
    if (!state.map || !state.lockOffset) return;
    const z = state.map.getZoom();
    const size = state.map.getSize();
    // Desired screen point for the user = center + saved offset.
    const desiredPt = L.point(
      size.x / 2 + state.lockOffset.x,
      size.y / 2 + state.lockOffset.y
    );
    const userPt = state.map.project([latlng.lat, latlng.lng], z);
    // Map center must shift so the user lands on desiredPt.
    const centerPt = userPt.subtract(
      desiredPt.subtract(L.point(size.x / 2, size.y / 2))
    );
    state.map.setView(state.map.unproject(centerPt, z), z, { animate });
  }
  // Center `latlng` in the middle of the visible (un-obstructed) band.
  function centerMapOn(latlng, zoom, animate) {
    if (!state.map) return;
    const z = zoom != null ? zoom : state.map.getZoom();
    const dy = bottomObstructionPx() / 2;
    const pt = state.map.project([latlng.lat, latlng.lng], z);
    const shifted = L.point(pt.x, pt.y + dy);
    state.map.setView(state.map.unproject(shifted, z), z, { animate });
  }
  function attachPressGesture(
    el,
    { onTap, onLongPress, delay = 550, moveTol = 10 }
  ) {
    let id = null,
      sx = 0,
      sy = 0,
      timer = null,
      moved = false,
      longFired = false;
    let suppressUntil = 0;
    const clear = () => {
      clearTimeout(timer);
      timer = null;
    };

    el.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      id = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
      moved = false;
      longFired = false;
      try {
        el.setPointerCapture(id);
      } catch { }
      timer = setTimeout(() => {
        if (moved) return;
        longFired = true;
        suppressUntil = Date.now() + 700;
        haptic(30);
        onLongPress && onLongPress();
      }, delay);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id || moved) return;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > moveTol) {
        moved = true;
        clear();
      }
    });
    const finish = (e, fireTap) => {
      if (e.pointerId !== id) return;
      clear();
      try {
        el.releasePointerCapture(id);
      } catch { }
      if (fireTap && !longFired && !moved) {
        suppressUntil = Date.now() + 400;
        onTap && onTap();
      }
      id = null;
    };
    el.addEventListener('pointerup', (e) => finish(e, true));
    el.addEventListener('pointercancel', (e) => finish(e, false));
    el.addEventListener(
      'click',
      (e) => {
        if (Date.now() < suppressUntil) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true
    );
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  // Reflect the follow mode onto the recenter FAB. Called by stopGPS(),
  // initMap(), recenterOnUser() and lockOnUser() — this definition is
  // required, otherwise every GPS start/stop crashes with
  // "syncFollowFab is not defined".
  function syncFollowFab() {
    const b = els.recenterBtn,
      m = state.followMode;
    if (!b) return;
    b.classList.toggle('locked', m === FollowMode.LOCKED);
    state.followUser = m !== FollowMode.IDLE;
    b.setAttribute('aria-pressed', String(m !== FollowMode.IDLE));
    b.setAttribute(
      'aria-label',
      m === FollowMode.IDLE
        ? 'Center on my location — hold to lock'
        : 'Locked to your position — tap or pan to release'
    );
  }

  // The GPS pill is centred and its width changes with the accuracy text
  // ("GPS ±8 yd · settled" vs "Last GPS · ±999 yd"). The advice pill used a
  // fixed `right: calc(50% + 84px)` that the wider states overlapped. Anchor
  // it to the *measured* edge of the GPS pill instead so the two can never
  // touch, at any text length or zoom level.
  function positionBottomPills() {
    const chip = els.gpsChip,
      pill = els.advicePill;
    if (!chip || !pill) return;
    if (pill.hidden || chip.hidden) return;

    const half = chip.offsetWidth / 2;
    const gap = 10;
    const pillWidth = pill.offsetWidth || 44;
    const vw = window.innerWidth;

    // Room for the pill to the right of the chip, inside the viewport?
    const rightRoom = vw / 2 - half - gap - pillWidth - 12;
    if (rightRoom >= 4) {
      pill.style.left = `calc(50% + ${Math.ceil(half) + gap}px)`;
      pill.style.right = 'auto';
    } else {
      // Very narrow screens: dock it against the right edge instead.
      pill.style.left = 'auto';
      pill.style.right = '12px';
    }
  }

  let _bottomPillsObserver = null;
  function watchBottomPills() {
    if (_bottomPillsObserver || !window.ResizeObserver) return;
    _bottomPillsObserver = new ResizeObserver(() => positionBottomPills());
    _bottomPillsObserver.observe(els.gpsChip);
  }

  // Tap: idle <-> follow. (No re-zoom when turning OFF.)
  function recenterOnUser() {
    initMap();
    if (!state.map) return;
    if (!state.loc) {
      setNotice(
        'No location yet. Tap the GPS pill to start locating.',
        'greenish'
      );
      haptic(5);
      return;
    }
    // If locked, just release it — no re-center.
    if (state.followMode === FollowMode.LOCKED) {
      state.followMode = FollowMode.IDLE;
      syncFollowFab();
      setNotice('Lock released.', 'greenish');
      haptic(5);
      return;
    }
    // One-shot center AND zoom: bring the view to at least zoom 17
    // so you can see the hole detail. Never zooms *out* on you —
    // if you're already at 19 looking at a green it stays there.
    const targetZoom = Math.max(state.map.getZoom(), 16);
    centerMapOn(
      { lat: state.loc.lat, lng: state.loc.lng },
      targetZoom,
      !reduceMotion
    );
    syncFollowFab();
    setNotice('Centered on you — hold to lock.', 'greenish');
    haptic(5);
  }

  // Long-press: lock the user at their CURRENT screen position and hold it there.
  function lockOnUser() {
    initMap();
    if (!state.map || !state.loc) {
      setNotice(
        'No location yet. Tap the GPS pill to start locating.',
        'greenish'
      );
      return;
    }
    // Where is the user on screen right now, relative to the map center?
    const size = state.map.getSize();
    const userPt = state.map.latLngToContainerPoint([
      state.loc.lat,
      state.loc.lng,
    ]);
    state.lockOffset = {
      x: userPt.x - size.x / 2,
      y: userPt.y - size.y / 2,
    };
    state.followMode = FollowMode.LOCKED;
    syncFollowFab();
    els.recenterBtn.classList.add('just-locked');
    setTimeout(() => els.recenterBtn.classList.remove('just-locked'), 600);
    setNotice(
      'Locked to your current screen position. Pan the map to release.',
      'greenish'
    );
  }

  function initGlobalEvents() {
    els.gpsChip.addEventListener('click', () => {
      haptic(8);
      if (!state.gpsRunning) {
        startGPS();
      }
      // If already running, do nothing — no pause, no silent stop.
    });
    if (els.recenterBtn) {
      attachPressGesture(els.recenterBtn, {
        onTap: recenterOnUser,
        onLongPress: lockOnUser,
      });
    }
    els.setFrontBtn.addEventListener('click', () => armPlaceMode('front'));
    els.setCenterBtn.addEventListener('click', () => armPlaceMode('center'));
    els.setBackBtn.addEventListener('click', () => armPlaceMode('back'));
    if (els.setTeeBtn)
      els.setTeeBtn.addEventListener('click', () => armPlaceMode('tee'));
    els.clearFbBtn.addEventListener('click', () => {
      state.frontPt = null;
      state.backPt = null;
      state.greenCenter = null;

      disarmPlaceMode();
      clearFbMarkers();
      renderFcb();
      updateLine();
      updateRestoreGreenBtn();

      // Return immediately to target-only recommendation behavior.
      if (state.target) {
        calculateRange();
        scheduleContextUpdate();
      }

      haptic(6);
      setNotice('Green cleared. Recommendations now use your selected target only.', 'greenish');
    });
    if (els.restoreGreenBtn) {
      els.restoreGreenBtn.addEventListener('click', () => {
        const hole = getCurrentHoleData();
        if (
          !state.roundSession ||
          !hole ||
          !(hole.greenCenter || hole.front || hole.back)
        ) {
          setNotice('This hole has no imported green geometry to restore.', 'greenish');
          haptic(8);
          return;
        }
        applyHoleGeometryToMap({ resetAim: false });
        haptic(8);
        setNotice(
          'Imported green restored without changing your selected target.',
          'greenish'
        );
      });
    }
    // Practice reset button (in sheet)
    const prb = document.getElementById('practiceResetBtn');
    if (prb) {
      prb.addEventListener('click', () => {
        if (!confirm('Reset all practice shot data? This clears your dispersion model.')) return;
        clearShotData();
        renderPracticeSection();
        if (state.target && state.loc) calculateRange();
        haptic(12);
      });
    }
    window.addEventListener('online', () => {
      if (state.loc || state.target) scheduleContextUpdate();
    });
    window.addEventListener('offline', () => {
      els.weatherStatus.textContent = 'Offline';
      setNotice(
        'Offline. Caddy uses cached weather/elevation if available, otherwise neutral defaults.',
        'greenish'
      );
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopGPS();
        return;
      }

      const needsGps =
        state.prefs.activeTab === 'range' ||
        state.prefs.activeTab === 'round' ||
        roundStatus() !== 'idle';

      if (state.prefs.gpsEnabled && needsGps && !state.gpsRunning) {
        kalman.reset();
        state.fixSamples = [];
        state.lastAcceptedFix = null;
        state.consecutiveRejects = 0;
        startGPS(true);
      }
    });
    const persistSession = () => {
      if (state.roundSession) saveRoundSession();
    };
    window.addEventListener('pagehide', () => {
      persistSession();
      stopGPS();
    });
    window.addEventListener('beforeunload', () => {
      persistSession();
      stopGPS();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) persistSession();
    });
  }

  function migrateRoundSession() {
    if (!state.roundSession) return;

    if (!state.roundSession.course) {
      state.roundSession.course = makeCasualCourse();
    }

    state.roundSession.course = normalizeCourse(
      state.roundSession.course
    );

    if (!Array.isArray(state.roundSession.scorecard)) {
      state.roundSession.scorecard = Array.isArray(state.round)
        ? state.round
        : emptyRound();
    }

    if (!Array.isArray(state.roundSession.shots)) {
      state.roundSession.shots = [];
    }

    // Trim a legacy 18-row scorecard down to a 9-hole course layout.
    const hcN =
      Number(state.roundSession.course.holesCount) === 9 ? 9 : 18;
    if (
      Array.isArray(state.roundSession.scorecard) &&
      state.roundSession.scorecard.length > hcN
    ) {
      state.roundSession.scorecard =
        state.roundSession.scorecard.slice(0, hcN);
    }

    state.roundSession.hole = clamp(
      Math.round(
        num(
          state.roundSession.hole ||
          state.roundSession.currentHole,
          1
        )
      ),
      1,
      18
    );

    state.roundSession.currentHole = state.roundSession.hole;

    // Sessions saved before group scoring existed get the fields here, so
    // every downstream reader can assume they exist.
    if (!Array.isArray(state.roundSession.groupPlayers)) {
      state.roundSession.groupPlayers = [];
    }
    if (
      !state.roundSession.groupScores ||
      typeof state.roundSession.groupScores !== 'object'
    ) {
      state.roundSession.groupScores = {};
    }
    // Adopt any existing session partners into the persistent roster so
    // upgrading doesn't orphan your current group.
    mergePartnersIntoRoster(state.roundSession.groupPlayers);

    state.round = state.roundSession.scorecard;

    save('caddy:round', state.round);
    saveRoundSession();
  }

  function bootstrap() {
    // iOS sometimes ignores user-scalable=no — cancel synthetic
    // double-tap-zoom on app chrome (never the map).
    let _lastTouch = 0;
    document.addEventListener(
      'touchend',
      (e) => {
        if (e.target.closest && e.target.closest('#map')) return;
        // Never swallow taps on controls: preventing touchend cancels the
        // synthetic click, so rapid +/− taps on the score stepper were
        // being silently dropped.
        if (
          e.target.closest &&
          e.target.closest(
            'button, input, select, textarea, label, a, summary, [role="button"]'
          )
        )
          return;
        const now = Date.now();
        if (now - _lastTouch <= 320) e.preventDefault();
        _lastTouch = now;
      },
      { passive: false }
    );
    setManifest();
    registerServiceWorker();
    const lt = load('caddy:lastTarget', null);
    if (lt && Number.isFinite(lt.lat)) state.target = lt;
    applyPrefs();
    initOnboard();
    initGlobalEvents();
    initSettingsSheet();
    initClubsEvents();
    initManualCalc();
    initRoundEvents();
    initStatsEvents();

    initTabs();
    initLayerSeg();
    initSheet();

    initRoundSetup();
    initRoundMode();

    initAdvice();
    initModeToggle();
    initPlanner();

    applyMode();
    renderClubs();

    // Keep the advice pill clear of the variable-width GPS pill.
    watchBottomPills();
    positionBottomPills();
    window.addEventListener('resize', () => positionBottomPills());

    migrateRoundSession();

    renderRound();
    renderStats();
    updateGpsUI();
    updateWeatherUI();
    renderClubChips(state.lastCalc ? state.lastCalc.playsLikeYd : 0);
    if (state.loc) {
      updateGpsUI();
      setNotice(
        'Loaded last-known location. Tap the GPS pill for a fresh high-accuracy fix, or tap the map to measure.',
        'greenish'
      );
      if (state.target) {
        initMap();
        updateUserMarker();
        if (!state.markers.target && state.mapReady)
          state.markers.target = L.marker(
            [state.target.lat, state.target.lng],
            { icon: targetIcon(), zIndexOffset: 850 }
          ).addTo(state.map);
        updateLine();
        calculateRange();
        scheduleContextUpdate();
      }
    }
    if (
      (window.matchMedia &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone
    ) {
      // Standalone PWA — nothing to relabel now that the top bar is gone.
    }
    const aboutEl = $('aboutVersion');
    if (aboutEl) {
      aboutEl.textContent =
        'Caddy ' +
        APP_VERSION +
        ' · every calculation runs on-device; nothing leaves your phone but weather & elevation.';
    }

    // Pre-warm the trajectory model. referenceLaunchFamily() integrates the
    // entire baseline launch table on first use (hundreds of RK4 solves),
    // which previously landed on the first calculation after boot and
    // surfaced as multi-second lag on the first hole change. Building it
    // during idle time moves that burst somewhere invisible.
    setTimeout(() => {
      try {
        referenceLaunchFamily();
      } catch { /* non-fatal: the lazy build path still works */ }
    }, 600);
  }

  // ============================================================
  //  BLOCK 0 — PRESERVED CONSTANTS (survived Cut 2)
  // ============================================================

  const SHOTLOG_KEY = 'caddy:shotLog:v1';   // localStorage key for the tracked-shot log — MUST NOT CHANGE (user data)
  const COMPASS_16 = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];                                        // 16-point compass, 22.5° bins — Bowditch, American Practical Navigator

  // ============================================================
  //  BLOCK 1 — EXACT CONSTANTS + NUMERICAL / STATISTICAL CORE
  // ============================================================

  // --- Reference ellipsoid & Earth model ---
  const WGS84_A = 6378137.0;                    // WGS-84 semi-major axis, m — NIMA TR8350.2 3rd ed. (2000)
  const WGS84_F = 1 / 298.257223563;            // WGS-84 flattening — NIMA TR8350.2 3rd ed. (2000)
  const WGS84_B = WGS84_A * (1 - WGS84_F);      // derived semi-minor axis, m
  const WGS84_E2 = WGS84_F * (2 - WGS84_F);     // first eccentricity squared, derived
  const OMEGA_EARTH = 7.292115e-5;              // Earth angular rate, rad/s — WGS-84 / IERS Conventions 2010
  const GRAV_EQ = 9.7803253359;                 // Somigliana normal gravity at equator, m/s² — NIMA TR8350.2
  const GRAV_K = 0.00193185265241;              // Somigliana coefficient k — NIMA TR8350.2
  const GRAV_M = 0.00344978650684;              // Somigliana m = ω²a²b/GM — NIMA TR8350.2
  const R = 6371008.7714;                       // IUGG mean Earth radius, m — legacy fallback paths only

  // --- Exact conversions (defined, not measured) ---
  const YD_TO_M = 0.9144;                       // international yard, exact — 1959 Intl. Yard & Pound Agreement / NIST SP 811
  const FT_TO_M = 0.3048;                       // international foot, exact — NIST SP 811
  const MPH_TO_MPS = 0.44704;                   // statute mph, exact — NIST SP 811
  const M_TO_YD = 1 / YD_TO_M;                  // 1.0936132983377078 (removes the 3e-8 error in the old literal)
  const M_TO_FT = 1 / FT_TO_M;                  // 3.2808398950131235
  const MPS_TO_MPH = 1 / MPH_TO_MPS;
  const RPM_TO_RADS = Math.PI / 30;             // exact: 2π/60
  const KELVIN_0C = 273.15;                     // ice point, exact by definition of °C — BIPM SI Brochure 9th ed.
  const EPS = 1e-12;

  const smoothstep = (a, b, x) => {
    if (b === a) return x < a ? 0 : 1;
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const hypot2 = (a, b) => Math.sqrt(a * a + b * b);

  // ---------- Special functions ----------
  const LANCZOS_G = 7;                          // Lanczos g parameter, n=9 — Press et al., Numerical Recipes 3rd ed. §6.1
  const LANCZOS_C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  function logGamma(z) {
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    z -= 1;
    let x = LANCZOS_C[0];
    for (let i = 1; i < LANCZOS_G + 2; i++) x += LANCZOS_C[i] / (z + i);
    const t = z + LANCZOS_G + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function gammaP(a, x) {                        // regularized P(a,x) — Numerical Recipes 3rd ed. §6.2
    if (x <= 0 || a <= 0) return 0;
    if (x < a + 1) {
      let ap = a, sum = 1 / a, del = sum;
      for (let n = 1; n < 400; n++) {
        ap += 1; del *= x / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
      }
      return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
    }
    const FPMIN = 1e-300;
    let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (let i = 1; i < 400; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  }
  const erf = (x) => (x < 0 ? -gammaP(0.5, x * x) : gammaP(0.5, x * x));
  const erfc = (x) => 1 - erf(x);
  const normCdf = (z) => 0.5 * erfc(-z / Math.SQRT2);
  const normPdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

  const AK_A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239]; // Acklam inverse-normal a[] — P. J. Acklam (2003)
  const AK_B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];                     // Acklam b[] — P. J. Acklam (2003)
  const AK_C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
  -2.549732539343734, 4.374664141464968, 2.938163982698783];      // Acklam c[] (tails) — P. J. Acklam (2003)
  const AK_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];                                             // Acklam d[] (tails) — P. J. Acklam (2003)
  function invNorm(p) {
    if (!(p > 0) || !(p < 1)) return p <= 0 ? -Infinity : Infinity;
    const pLow = 0.02425, pHigh = 1 - pLow;
    let x;
    if (p < pLow) {
      const q = Math.sqrt(-2 * Math.log(p));
      x = (((((AK_C[0] * q + AK_C[1]) * q + AK_C[2]) * q + AK_C[3]) * q + AK_C[4]) * q + AK_C[5]) /
        ((((AK_D[0] * q + AK_D[1]) * q + AK_D[2]) * q + AK_D[3]) * q + 1);
    } else if (p <= pHigh) {
      const q = p - 0.5, r = q * q;
      x = (((((AK_A[0] * r + AK_A[1]) * r + AK_A[2]) * r + AK_A[3]) * r + AK_A[4]) * r + AK_A[5]) * q /
        (((((AK_B[0] * r + AK_B[1]) * r + AK_B[2]) * r + AK_B[3]) * r + AK_B[4]) * r + 1);
    } else {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((AK_C[0] * q + AK_C[1]) * q + AK_C[2]) * q + AK_C[3]) * q + AK_C[4]) * q + AK_C[5]) /
        ((((AK_D[0] * q + AK_D[1]) * q + AK_D[2]) * q + AK_D[3]) * q + 1);
    }
    const e = normCdf(x) - p, u = e / normPdf(x);  // one Halley refinement — Numerical Recipes 3rd ed. §9.4
    return x - u / (1 + (x * u) / 2);
  }
  function betacf(a, b, x) {                      // incomplete-beta continued fraction — NR 3rd ed. §6.4
    const FPMIN = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - (qab * x) / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 400; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return h;
  }
  function ibeta(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lb = logGamma(a + b) - logGamma(a) - logGamma(b) +
      a * Math.log(x) + b * Math.log(1 - x);
    return x < (a + 1) / (a + b + 2)
      ? (Math.exp(lb) * betacf(a, b, x)) / a
      : 1 - (Math.exp(lb) * betacf(b, a, 1 - x)) / b;
  }
  function tCdf(t, nu) {                          // Student-t CDF via incomplete beta — Abramowitz & Stegun 26.5.27
    if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
    if (nu > 1e7) return normCdf(t);
    const p = 0.5 * ibeta(nu / 2, 0.5, nu / (nu + t * t));
    return t > 0 ? 1 - p : p;
  }
  function tQuantile(p, nu) {
    if (!(nu > 0) || nu > 1e7) return invNorm(p);
    let lo = -80, hi = 80;
    const seed = invNorm(p);
    if (tCdf(seed, nu) > p) hi = seed; else lo = seed;
    for (let i = 0; i < 90; i++) {
      const mid = 0.5 * (lo + hi);
      if (tCdf(mid, nu) < p) lo = mid; else hi = mid;
      if (hi - lo < 1e-11) break;
    }
    return 0.5 * (lo + hi);
  }
  function chi2Inv(p, df) {
    if (df === 2) return -2 * Math.log(1 - p);    // exact: χ²₂ CDF = 1 - exp(-x/2)
    let lo = 0, hi = Math.max(30, 4 * df + 60);
    for (let i = 0; i < 220; i++) {
      const mid = 0.5 * (lo + hi);
      if (gammaP(df / 2, mid / 2) < p) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  // ---------- Robust & descriptive statistics ----------
  const MAD_TO_SIGMA = 1.4826;                    // MAD→σ consistency factor for a normal — Rousseeuw & Croux, JASA 88 (1993) 1273
  const RAYLEIGH_95 = 2.4477468306;               // 95th percentile of the Rayleigh dist = sqrt(-2 ln 0.05) — standard CEP↔R95 conversion
  function quantileSorted(sorted, p) {
    const n = sorted.length;
    if (!n) return NaN;
    if (n === 1) return sorted[0];
    const h = (n - 1) * clamp(p, 0, 1);
    const lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]); // type-7 quantile — Hyndman & Fan, Am. Stat. 50 (1996) 361
  }
  const median = (arr) => quantileSorted([...arr].sort((a, b) => a - b), 0.5);
  function madSigma(arr) {
    if (arr.length < 2) return NaN;
    const m = median(arr);
    return MAD_TO_SIGMA * median(arr.map((x) => Math.abs(x - m)));
  }
  function c4(n) {                                // unbiasing factor for the sample SD of a normal — Kenney & Keeping, Math. of Statistics Pt.1 3rd ed.
    if (n < 2) return NaN;
    if (n > 400) return 1 - 0.75 / n;
    return Math.sqrt(2 / (n - 1)) * Math.exp(logGamma(n / 2) - logGamma((n - 1) / 2));
  }
  function weightedMoments(values, weights) {      // weighted Welford — Welford, Technometrics 4 (1962) 419; West, CACM 22 (1979) 532
    let W = 0, W2 = 0, mean = 0, S = 0;
    for (let i = 0; i < values.length; i++) {
      const w = weights[i];
      if (!(w > 0)) continue;
      W += w; W2 += w * w;
      const d = values[i] - mean;
      mean += (w / W) * d;
      S += w * d * (values[i] - mean);
    }
    const nEff = W2 > 0 ? (W * W) / W2 : 0;        // Kish effective sample size — Kish, Survey Sampling (1965) §8.2
    const variance = W > 0 && nEff > 1 ? (S / W) * (nEff / (nEff - 1)) : NaN;
    return { W, mean, variance, nEff };
  }
  function theilSen(xs, ys) {                      // median-of-slopes regression — Theil (1950); Sen, JASA 63 (1968) 1379
    const n = Math.min(xs.length, ys.length);
    if (n < 3) return null;
    const slopes = [];
    for (let i = 0; i < n - 1; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = xs[j] - xs[i];
        if (Math.abs(dx) > EPS) slopes.push((ys[j] - ys[i]) / dx);
      }
    if (!slopes.length) return null;
    const slope = median(slopes);
    return { slope, intercept: median(ys.map((y, i) => y - slope * xs[i])), n };
  }
  function wilsonInterval(k, n, conf = 0.95) {     // score interval for a proportion — Wilson, JASA 22 (1927) 209
    if (!n) return { p: NaN, lo: NaN, hi: NaN, n: 0 };
    const z = invNorm(1 - (1 - conf) / 2), p = k / n, z2 = z * z, d = 1 + z2 / n;
    const c = p + z2 / (2 * n);
    const h = (z / d) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
    return { p, lo: clamp(c / d - h, 0, 1), hi: clamp(c / d + h, 0, 1), n };
  }

  // ---------- Shape-preserving interpolation ----------
  function pchip(xs, ys) {                         // monotone cubic — Fritsch & Carlson, SIAM J. Numer. Anal. 17 (1980) 238
    const n = xs.length;
    const h = new Array(n - 1), delta = new Array(n - 1), m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) {
      h[i] = xs[i + 1] - xs[i];
      delta[i] = (ys[i + 1] - ys[i]) / h[i];
    }
    m[0] = delta[0]; m[n - 1] = delta[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (delta[i - 1] * delta[i] <= 0) { m[i] = 0; continue; }
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
    return function evalAt(x) {
      if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
      if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] > x) hi = mid; else lo = mid; }
      const t = (x - xs[lo]) / h[lo], t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h[lo] * m[lo] +
        (-2 * t3 + 3 * t2) * ys[lo + 1] + (t3 - t2) * h[lo] * m[lo + 1];
    };
  }

  // ---------- Quadrature over a normal factor (9-node truncated Gauss–Legendre) ----------
  const GL9_X = [-0.9681602395076261, -0.8360311073266358, -0.6133714327005904,
  -0.3242534234038089, 0, 0.3242534234038089, 0.6133714327005904,
    0.8360311073266358, 0.9681602395076261];   // 9-pt Gauss–Legendre abscissae — Abramowitz & Stegun Table 25.4
  const GL9_W = [0.0812743883615744, 0.1806481606948574, 0.2606106964029354,
    0.3123470770400029, 0.3302393550012598, 0.3123470770400029,
    0.2606106964029354, 0.1806481606948574, 0.0812743883615744]; // matching weights — A&S Table 25.4
  const NORMAL_TRUNC_SIGMA = 3.5;                  // ±3.5σ captures 99.954% of a normal; tails are club-choice-irrelevant
  function normalNodes(nSigma = NORMAL_TRUNC_SIGMA) {
    const zs = GL9_X.map((x) => x * nSigma);
    const raw = zs.map((z, i) => GL9_W[i] * normPdf(z) * nSigma);
    const tot = raw.reduce((a, b) => a + b, 0);
    return { zs, ws: raw.map((w) => w / tot) };
  }
  const NORM_NODES = normalNodes();

  function makeLRU(limit) {
    const map = new Map();
    return {
      get(k) { if (!map.has(k)) return undefined; const v = map.get(k); map.delete(k); map.set(k, v); return v; },
      set(k, v) { if (map.has(k)) map.delete(k); map.set(k, v); if (map.size > limit) map.delete(map.keys().next().value); },
      clear() { map.clear(); },
    };
  }
  // ============================================================
  //  BLOCK 2 — GEODESY (replaces haversineMeters, initialBearingDeg, angleDiff)
  // ============================================================

  function angleDiff(a, b) {
    let d = (a - b) % 360;
    if (d > 180) d -= 360;
    if (d <= -180) d += 360;
    return d;
  }

  const VINCENTY_TOL = 1e-13;      // ~0.06 mm in λ at Earth scale — T. Vincenty, Survey Review XXIII/176 (1975) 88
  const VINCENTY_MAXIT = 60;       // converges in 3–5 iterations for s < 10 km

  function geodesicInverse(p1, p2) {
    const a = WGS84_A, b = WGS84_B, f = WGS84_F;
    const L = d2r(p2.lng - p1.lng);
    const U1 = Math.atan((1 - f) * Math.tan(d2r(p1.lat)));
    const U2 = Math.atan((1 - f) * Math.tan(d2r(p2.lat)));
    const sU1 = Math.sin(U1), cU1 = Math.cos(U1);
    const sU2 = Math.sin(U2), cU2 = Math.cos(U2);
    let lam = L, lamPrev, it = 0;
    let sLam = 0, cLam = 1, sSig = 0, cSig = 1, sig = 0, c2Alpha = 1, cos2SigM = 1;
    do {
      sLam = Math.sin(lam); cLam = Math.cos(lam);
      sSig = hypot2(cU2 * sLam, cU1 * sU2 - sU1 * cU2 * cLam);
      if (sSig < EPS) return { s: 0, az1: 0, az2: 0, converged: true };
      cSig = sU1 * sU2 + cU1 * cU2 * cLam;
      sig = Math.atan2(sSig, cSig);
      const sAlpha = (cU1 * cU2 * sLam) / sSig;
      c2Alpha = Math.max(0, 1 - sAlpha * sAlpha);
      cos2SigM = c2Alpha < EPS ? 0 : cSig - (2 * sU1 * sU2) / c2Alpha;
      const C = (f / 16) * c2Alpha * (4 + f * (4 - 3 * c2Alpha));
      lamPrev = lam;
      lam = L + (1 - C) * f * sAlpha *
        (sig + C * sSig * (cos2SigM + C * cSig * (-1 + 2 * cos2SigM * cos2SigM)));
    } while (Math.abs(lam - lamPrev) > VINCENTY_TOL && ++it < VINCENTY_MAXIT);

    if (it >= VINCENTY_MAXIT) {
      const dp = d2r(p2.lat - p1.lat), dl = d2r(p2.lng - p1.lng);
      const hs = Math.sin(dp / 2) ** 2 +
        Math.cos(d2r(p1.lat)) * Math.cos(d2r(p2.lat)) * Math.sin(dl / 2) ** 2;
      const s = 2 * R * Math.atan2(Math.sqrt(hs), Math.sqrt(1 - hs));
      const y = Math.sin(dl) * Math.cos(d2r(p2.lat));
      const x = Math.cos(d2r(p1.lat)) * Math.sin(d2r(p2.lat)) -
        Math.sin(d2r(p1.lat)) * Math.cos(d2r(p2.lat)) * Math.cos(dl);
      const az = norm(r2d(Math.atan2(y, x)));
      return { s, az1: az, az2: az, converged: false };
    }
    const uSq = (c2Alpha * (a * a - b * b)) / (b * b);
    const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    const dSig = B * sSig * (cos2SigM + (B / 4) * (
      cSig * (-1 + 2 * cos2SigM * cos2SigM) -
      (B / 6) * cos2SigM * (-3 + 4 * sSig * sSig) * (-3 + 4 * cos2SigM * cos2SigM)));
    return {
      s: b * A * (sig - dSig),
      az1: norm(r2d(Math.atan2(cU2 * sLam, cU1 * sU2 - sU1 * cU2 * cLam))),
      az2: norm(r2d(Math.atan2(cU1 * sLam, -sU1 * cU2 + cU1 * sU2 * cLam))),
      converged: true,
    };
  }

  function geodesicDirect(p, azDeg, sMeters) {
    const a = WGS84_A, b = WGS84_B, f = WGS84_F;
    const alpha1 = d2r(norm(azDeg));
    const sA1 = Math.sin(alpha1), cA1 = Math.cos(alpha1);
    const tanU1 = (1 - f) * Math.tan(d2r(p.lat));
    const cU1 = 1 / Math.sqrt(1 + tanU1 * tanU1), sU1 = tanU1 * cU1;
    const sigma1 = Math.atan2(tanU1, cA1);
    const sAlpha = cU1 * sA1, c2Alpha = 1 - sAlpha * sAlpha;
    const uSq = (c2Alpha * (a * a - b * b)) / (b * b);
    const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    let sigma = sMeters / (b * A), sigmaPrev, it = 0, sSig = 0, cSig = 1, cos2SigM = 1;
    do {
      cos2SigM = Math.cos(2 * sigma1 + sigma);
      sSig = Math.sin(sigma); cSig = Math.cos(sigma);
      const dSig = B * sSig * (cos2SigM + (B / 4) * (
        cSig * (-1 + 2 * cos2SigM * cos2SigM) -
        (B / 6) * cos2SigM * (-3 + 4 * sSig * sSig) * (-3 + 4 * cos2SigM * cos2SigM)));
      sigmaPrev = sigma;
      sigma = sMeters / (b * A) + dSig;
    } while (Math.abs(sigma - sigmaPrev) > VINCENTY_TOL && ++it < VINCENTY_MAXIT);
    const tmp = sU1 * sSig - cU1 * cSig * cA1;
    const lat2 = Math.atan2(sU1 * cSig + cU1 * sSig * cA1,
      (1 - f) * Math.sqrt(sAlpha * sAlpha + tmp * tmp));
    const lambda = Math.atan2(sSig * sA1, cU1 * cSig - sU1 * sSig * cA1);
    const C = (f / 16) * c2Alpha * (4 + f * (4 - 3 * c2Alpha));
    const Lo = lambda - (1 - C) * f * sAlpha *
      (sigma + C * sSig * (cos2SigM + C * cSig * (-1 + 2 * cos2SigM * cos2SigM)));
    return { lat: r2d(lat2), lng: p.lng + r2d(Lo) };
  }

  // PUBLIC NAME PRESERVED — now the exact WGS-84 geodesic, not the spherical haversine.
  // The geodesic between two lat/lngs is already the horizontal projection, so no slope
  // correction is needed. Optional meanHeightM scales the arc to flight altitude.
  function haversineMeters(a, b, meanHeightM) {
    const g = geodesicInverse(a, b);
    if (!Number.isFinite(meanHeightM) || meanHeightM === 0) return g.s;
    const phi = d2r((a.lat + b.lat) / 2);
    const s = Math.sin(phi), W2 = 1 - WGS84_E2 * s * s;
    const N = WGS84_A / Math.sqrt(W2);                              // prime-vertical radius of curvature
    const M = (WGS84_A * (1 - WGS84_E2)) / (W2 * Math.sqrt(W2));    // meridional radius of curvature
    const az = d2r(g.az1);
    const Ralpha = 1 / (Math.cos(az) ** 2 / M + Math.sin(az) ** 2 / N); // Euler's radius in azimuth
    return g.s * (1 + meanHeightM / Ralpha);
  }

  // PUBLIC NAME PRESERVED — geodesic forward azimuth.
  function initialBearingDeg(a, b) {
    return geodesicInverse(a, b).az1;
  }

  // Local ENU tangent frame; error < 1 cm inside 2 km.
  function enuFrame(origin) {
    const phi = d2r(origin.lat);
    const s = Math.sin(phi), W2 = 1 - WGS84_E2 * s * s;
    const N = WGS84_A / Math.sqrt(W2);
    const M = (WGS84_A * (1 - WGS84_E2)) / (W2 * Math.sqrt(W2));
    return {
      lat0: origin.lat, lng0: origin.lng,
      mPerDegLat: (M * Math.PI) / 180,
      mPerDegLng: (N * Math.cos(phi) * Math.PI) / 180,
    };
  }
  const toENU = (fr, p) => ({
    e: (p.lng - fr.lng0) * fr.mPerDegLng,
    n: (p.lat - fr.lat0) * fr.mPerDegLat,
  });
  const fromENU = (fr, e, n) => ({
    lat: fr.lat0 + n / fr.mPerDegLat,
    lng: fr.lng0 + e / fr.mPerDegLng,
  });
  function crossTrackYd(A, B, p) {                 // signed perpendicular offset; + = right of A→B
    const fr = enuFrame(A), b = toENU(fr, B), q = toENU(fr, p);
    const len = hypot2(b.e, b.n);
    if (len < EPS) return 0;
    return ((q.e * (b.n / len) - q.n * (b.e / len)) * M_TO_YD);
  }
  function alongTrackYd(A, B, p) {
    const fr = enuFrame(A), b = toENU(fr, B), q = toENU(fr, p);
    const len = hypot2(b.e, b.n);
    if (len < EPS) return 0;
    return ((q.e * b.e + q.n * b.n) / len) * M_TO_YD;
  }
  const midpointGeodesic = (A, B) => {
    const g = geodesicInverse(A, B);
    return geodesicDirect(A, g.az1, g.s / 2);
  };
  function gravityAt(latDeg, heightM) {             // Somigliana + 2nd-order free-air — NIMA TR8350.2 §4; Heiskanen & Moritz (1967) eq. 2-124
    const s2 = Math.sin(d2r(num(latDeg, 40))) ** 2;
    const g0 = (GRAV_EQ * (1 + GRAV_K * s2)) / Math.sqrt(1 - WGS84_E2 * s2);
    const h = num(heightM, 0);
    return g0 * (1 - (2 / WGS84_A) * (1 + WGS84_F + GRAV_M - 2 * WGS84_F * s2) * h +
      (3 / (WGS84_A * WGS84_A)) * h * h);
  }
  // ============================================================
  //  BLOCK 3 — ATMOSPHERE
  // ============================================================

  // CIPM-2007 moist-air density — Picard, Davis, Gläser & Fujii, Metrologia 45 (2008) 149. Rel. unc. 2.2e-5.
  const CIPM_MA = 28.96546e-3;   // molar mass of dry air, kg/mol — CIPM-2007 Table 1
  const CIPM_MV = 18.01528e-3;   // molar mass of water vapour, kg/mol — CIPM-2007 Table 1
  const CIPM_R = 8.314472;      // molar gas constant adopted by CIPM-2007, J/(mol·K)
  const SVP_A = 1.2378847e-5;   // saturation vapour pressure coeff. A, K⁻² — CIPM-2007 eq. A1.1
  const SVP_B = -1.9121316e-2;   // saturation vapour pressure coeff. B, K⁻¹ — CIPM-2007 eq. A1.1
  const SVP_C = 33.93711047;    // saturation vapour pressure coeff. C — CIPM-2007 eq. A1.1
  const SVP_D = -6.3431645e3;    // saturation vapour pressure coeff. D, K — CIPM-2007 eq. A1.1
  const ENH_A = 1.00062;         // enhancement factor α — CIPM-2007 eq. A1.2
  const ENH_B = 3.14e-8;         // enhancement factor β, Pa⁻¹ — CIPM-2007 eq. A1.2
  const ENH_G = 5.6e-7;          // enhancement factor γ, °C⁻² — CIPM-2007 eq. A1.2
  const Z_A0 = 1.58123e-6;       // compressibility a₀, K/Pa — CIPM-2007 eq. A1.3
  const Z_A1 = -2.9331e-8;       // compressibility a₁, Pa⁻¹ — CIPM-2007 eq. A1.3
  const Z_A2 = 1.1043e-10;       // compressibility a₂, (K·Pa)⁻¹ — CIPM-2007 eq. A1.3
  const Z_B0 = 5.707e-6;         // compressibility b₀, K/Pa — CIPM-2007 eq. A1.3
  const Z_B1 = -2.051e-8;        // compressibility b₁, Pa⁻¹ — CIPM-2007 eq. A1.3
  const Z_C0 = 1.9898e-4;        // compressibility c₀, K/Pa — CIPM-2007 eq. A1.3
  const Z_C1 = -2.376e-6;        // compressibility c₁, Pa⁻¹ — CIPM-2007 eq. A1.3
  const Z_D = 1.83e-11;         // compressibility d, K²/Pa² — CIPM-2007 eq. A1.3
  const Z_E = -0.765e-8;        // compressibility e, K²/Pa² — CIPM-2007 eq. A1.3

  function saturationVaporPressure(tempC) {
    const T = tempC + KELVIN_0C;
    return Math.exp(SVP_A * T * T + SVP_B * T + SVP_C + SVP_D / T);
  }
  function airDensityCIPM(tempC, pressurePa, rhPercent) {
    const T = tempC + KELVIN_0C;
    const p = Math.max(1000, pressurePa);
    const h = clamp(num(rhPercent, 50), 0, 100) / 100;
    const f = ENH_A + ENH_B * p + ENH_G * tempC * tempC;
    const xv = (h * f * saturationVaporPressure(tempC)) / p;
    const Z = 1 -
      (p / T) * (Z_A0 + Z_A1 * tempC + Z_A2 * tempC * tempC +
        (Z_B0 + Z_B1 * tempC) * xv + (Z_C0 + Z_C1 * tempC) * xv * xv) +
      ((p * p) / (T * T)) * (Z_D + Z_E * xv * xv);
    return ((p * CIPM_MA) / (Z * CIPM_R * T)) * (1 - xv * (1 - CIPM_MV / CIPM_MA));
  }

  const ISA_P0 = 101325;         // sea-level standard pressure, Pa — U.S. Standard Atmosphere 1976 (NOAA-S/T 76-1562)
  const ISA_T0 = 288.15;         // sea-level standard temperature, K — USSA 1976
  const ISA_L = 0.0065;         // tropospheric lapse rate, K/m — USSA 1976
  const ISA_EXP = 5.2558797;     // g₀M/(R*L) for the troposphere — USSA 1976 eq. 33a
  const DRY_AIR_R = 287.052874;  // specific gas constant of dry air, J/(kg·K) — ISO 2533 / CODATA 2018
  const pressureFromISA = (altitudeM) =>
    ISA_P0 * Math.pow(1 - (ISA_L * clamp(num(altitudeM, 0), -500, 11000)) / ISA_T0, ISA_EXP);
  function stationPressureFromMSL(pMslPa, altitudeM, tempC) {  // hypsometric reduction — WMO-No. 8 Part I Ch. 3
    const Tv = tempC + KELVIN_0C + 0.5 * ISA_L * Math.max(0, altitudeM);
    return pMslPa * Math.exp((-gravityAt(40, 0) * altitudeM) / (DRY_AIR_R * Tv));
  }

  const STD_TEMP_F = 70;         // industry reference temperature for quoted carry numbers — TrackMan/USGA test conditions
  const STD_RH = 50;            // industry reference relative humidity, % — TrackMan/USGA test conditions
  const STD_ALT_FT = 0;         // sea level reference — quoted carry numbers assume it
  const STD_LAT = 40;           // reference latitude for normal gravity, deg — mid-latitude US courses

  function airDensity({ tempF, rh, altitudeFt, pressureHpa } = {}) {
    const tempC = (num(tempF, STD_TEMP_F) - 32) / 1.8;
    const altM = num(altitudeFt, 0) * FT_TO_M;
    const p = Number.isFinite(pressureHpa) && pressureHpa > 500
      ? pressureHpa * 100                        // Open-Meteo surface_pressure is already station level
      : pressureFromISA(altM);
    return airDensityCIPM(tempC, p, num(rh, STD_RH));
  }
  const RHO_STD = airDensity({ tempF: STD_TEMP_F, rh: STD_RH, altitudeFt: STD_ALT_FT }); // ≈1.1943 kg/m³

  const SUTH_MU0 = 1.716e-5;     // dynamic viscosity of air at 273.15 K, Pa·s — White, Viscous Fluid Flow 3rd ed. Table 1-2
  const SUTH_S = 110.4;          // Sutherland constant for air, K — White (2006) Table 1-2
  function kinematicViscosity(tempC, rho) {
    const T = tempC + KELVIN_0C;
    const mu = SUTH_MU0 * Math.pow(T / KELVIN_0C, 1.5) * ((KELVIN_0C + SUTH_S) / (T + SUTH_S));
    return mu / Math.max(0.4, rho);
  }

  // --- Surface-layer wind profile ---
  // The single largest wind-modelling error in consumer golf apps is using the 10 m model wind
  // as if it were the wind the ball flies through. At 1 m it is ~60% of that; at 30 m, ~119%.
  const WIND_Z0_FAIRWAY = 0.03;      // roughness length for short grass / open terrain, m — Wieringa, Bound.-Layer Meteorol. 63 (1993) 323 (Davenport class 3)
  const WIND_Z_REF = 10;             // WMO standard anemometer height, m — WMO-No. 8 Part I Ch. 5
  const WIND_Z_MIN = 0.35;           // lower clamp ≈ ball radius + turf roughness sublayer, m
  const WIND_SHEAR_ALPHA_DEF = 0.143; // 1/7 power-law exponent, neutral open terrain — Justus et al., J. Appl. Meteorol. 17 (1978) 350
  const WIND_ALPHA_MIN = 0.02;       // lower bound on a fitted shear exponent (near-neutral, very smooth)
  const WIND_ALPHA_MAX = 0.45;       // upper bound on a fitted shear exponent (strongly stable nocturnal)
  const WIND_VEER_DEG_PER_M = 0.035; // Ekman veer in the lower surface layer, deg/m — Peña et al., Bound.-Layer Meteorol. 136 (2010) 383
  const WIND_VEER_MAX_DEG = 6;       // veer saturates below trajectory apex heights

  function windProfileFactor(zMeters, z0 = WIND_Z0_FAIRWAY) {
    const z = Math.max(WIND_Z_MIN, zMeters);
    return Math.log(z / z0) / Math.log(WIND_Z_REF / z0);
  }
  function windPowerFactor(zMeters, alpha) {
    const a = clamp(num(alpha, WIND_SHEAR_ALPHA_DEF), WIND_ALPHA_MIN, WIND_ALPHA_MAX);
    return Math.pow(Math.max(WIND_Z_MIN, zMeters) / WIND_Z_REF, a);
  }
  // Fit the local shear exponent from two model levels when both are available.
  function fitShearAlpha(u10, u80) {
    if (!(u10 > 0.5) || !(u80 > 0.5)) return null;
    return clamp(Math.log(u80 / u10) / Math.log(80 / 10), WIND_ALPHA_MIN, WIND_ALPHA_MAX);
  }
  function windVeerDeg(zMeters, latDeg) {
    const sgn = num(latDeg, 40) >= 0 ? 1 : -1;   // veers clockwise with height in the NH, counter-clockwise in the SH
    return sgn * clamp((Math.max(0, zMeters) - WIND_Z_REF) * WIND_VEER_DEG_PER_M,
      -WIND_VEER_MAX_DEG, WIND_VEER_MAX_DEG);
  }
  // ============================================================
  //  BLOCK 4 — 3-DOF BALL FLIGHT
  //  Frame: x = downrange along the aim bearing, y = up, z = right of the aim line.
  // ============================================================

  const BALL = Object.freeze({
    massKg: 0.04593,      // USGA/R&A maximum ball mass 1.620 oz — Rules of Golf, Equipment Rules Pt.3 §1a
    radiusM: 0.021335,    // USGA/R&A minimum diameter 1.680 in, halved — Equipment Rules Pt.3 §1b
    areaM2: Math.PI * 0.021335 * 0.021335,
    spinDecayTauS: 25,    // measured exponential spin decay ω=ω₀e^(−t/τ) — Smits & Smith, Science and Golf II (1994)
  });

  // Smits–Smith spin-ratio fits, as reproduced in A. R. Penner, "The physics of golf",
  // Rep. Prog. Phys. 66 (2003) 131, eqs. (12)–(13). Valid for 0.02 ≤ S ≤ 0.6.
  const AERO_S_MIN = 0.02;   // lower validity bound of the Smits–Smith fit — Penner (2003) §3.2
  const AERO_S_MAX = 0.60;   // upper validity bound of the Smits–Smith fit — Penner (2003) §3.2
  const CL_C0 = -0.05;       // lift-fit offset — Smits & Smith (1994)
  const CL_C1 = 0.0025;      // lift-fit radicand constant — Smits & Smith (1994)
  const CL_C2 = 0.36;        // lift-fit radicand slope in S — Smits & Smith (1994)
  const CD_C0 = 0.24;        // zero-spin drag of a dimpled ball in the supercritical regime — Bearman & Harvey, Aeronaut. Q. 27 (1976) 112
  const CD_C1 = 0.18;        // drag rise per unit spin ratio — Smits & Smith (1994)
  function aeroCoefficients(spinRatio) {
    const S = clamp(spinRatio, AERO_S_MIN, AERO_S_MAX);
    return { cl: CL_C0 + Math.sqrt(CL_C1 + CL_C2 * S), cd: CD_C0 + CD_C1 * S };
  }

  const TRAJ_DT = 0.01;                 // RK4 step, s. Global error is O(dt⁴) ⇒ ≈1 cm over a 7 s flight — five orders of magnitude below GPS resolution.
  const TRAJ_MAX_FLIGHT_S = 20;         // hard flight-time cap, s; the longest real golf shot flies ≈8 s
  const TRAJ_MAX_STEPS = Math.ceil(TRAJ_MAX_FLIGHT_S / TRAJ_DT); // DERIVED — the cap lives in TIME, so changing dt can never silently truncate a trajectory again
  const TRAJ_REFINE = 14;     // bisection halvings on the terminal step ⇒ ~1e-6 s landing resolution

  /**
   * launch : { speedMps, launchDeg, spinRadS, aimOffsetDeg }
   * env    : { rho, gravity, windAt(z)->{wx,wz}, coriolis:{ox,oy,oz}, targetDropM }
   * Returns the state at the moment the ball first descends through targetDropM.
   */
  function integrateTrajectory(launch, env) {
    const m = BALL.massKg, A = BALL.areaM2, r = BALL.radiusM;
    const halfRhoA = 0.5 * env.rho * A;
    const g = env.gravity;
    const drop = num(env.targetDropM, 0);
    const w = env.coriolis || { ox: 0, oy: 0, oz: 0 };
    const th = d2r(launch.launchDeg), az = d2r(num(launch.aimOffsetDeg, 0));
    let S = [0, 0, 0,
      launch.speedMps * Math.cos(th) * Math.cos(az),
      launch.speedMps * Math.sin(th),
      launch.speedMps * Math.cos(th) * Math.sin(az)];
    // Spin axis fixed in the inertial frame (standard 3-DOF closure). This is what produces
    // genuine weathercocking in a crosswind rather than naive pure advection.
    const axis = { x: -Math.sin(az), y: 0, z: Math.cos(az) };
    const spin0 = launch.spinRadS;
    let apex = 0, t = 0, steps = 0;

    const deriv = (s, tt) => {
      const wind = env.windAt(Math.max(0, s[1]));
      const vrx = s[3] - wind.wx, vry = s[4], vrz = s[5] - wind.wz;
      const v = Math.sqrt(vrx * vrx + vry * vry + vrz * vrz) || EPS;
      const spin = spin0 * Math.exp(-tt / BALL.spinDecayTauS);
      const { cl, cd } = aeroCoefficients((spin * r) / v);
      const q = (halfRhoA * v) / m;
      let lx = axis.y * vrz - axis.z * vry;
      let ly = axis.z * vrx - axis.x * vrz;
      let lz = axis.x * vry - axis.y * vrx;
      const ln = Math.sqrt(lx * lx + ly * ly + lz * lz) || EPS;
      lx /= ln; ly /= ln; lz /= ln;
      const L = q * cl * v;
      const cx = -2 * (w.oy * s[5] - w.oz * s[4]);   // Coriolis a = −2Ω×v; ≈5 in of drift on a driver
      const cy = -2 * (w.oz * s[3] - w.ox * s[5]);
      const cz = -2 * (w.ox * s[4] - w.oy * s[3]);
      return [s[3], s[4], s[5],
      -q * cd * vrx + L * lx + cx,
      -q * cd * vry + L * ly - g + cy,
      -q * cd * vrz + L * lz + cz];
    };
    const step = (s, tt, h) => {
      const k1 = deriv(s, tt);
      const s2 = s.map((v, i) => v + (h / 2) * k1[i]);
      const k2 = deriv(s2, tt + h / 2);
      const s3 = s.map((v, i) => v + (h / 2) * k2[i]);
      const k3 = deriv(s3, tt + h / 2);
      const s4 = s.map((v, i) => v + h * k3[i]);
      const k4 = deriv(s4, tt + h);
      return s.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    };

    while (steps++ < TRAJ_MAX_STEPS) {
      const next = step(S, t, TRAJ_DT);
      if (next[1] > apex) apex = next[1];
      const descending = next[4] < 0;
      if (descending && next[1] <= drop && S[1] > drop) {
        // Refine the landing instant by bisection on the sub-step.
        let lo = 0, hi = TRAJ_DT;
        for (let i = 0; i < TRAJ_REFINE; i++) {
          const mid = 0.5 * (lo + hi);
          const sm = step(S, t, mid);
          if (sm[1] > drop) lo = mid; else hi = mid;
        }
        const land = step(S, t, 0.5 * (lo + hi));
        const vh = hypot2(land[3], land[5]);
        return {
          carryM: land[0], lateralM: land[2], apexM: apex,
          timeS: t + 0.5 * (lo + hi),
          landSpeedMps: Math.sqrt(land[3] ** 2 + land[4] ** 2 + land[5] ** 2),
          descentDeg: r2d(Math.atan2(-land[4], Math.max(EPS, vh))),
          reached: true,
        };
      }
      S = next;
      t += TRAJ_DT;
      if (S[1] < drop - 200) break;    // ran off a cliff far below the target; bail
    }
    // Never reached the target plane (target above the apex, or step budget exhausted).
    const vh = hypot2(S[3], S[5]);
    return {
      carryM: S[0], lateralM: S[2], apexM: apex, timeS: t,
      landSpeedMps: Math.sqrt(S[3] ** 2 + S[4] ** 2 + S[5] ** 2),
      descentDeg: r2d(Math.atan2(-S[4], Math.max(EPS, vh))),
      reached: false,
    };
  }

  // Bounce-and-roll. Energy model: the first bounce retains a descent-angle-dependent
  // fraction of horizontal speed, then the ball decelerates against an effective turf
  // friction. Structure per Penner (2003) §5; μ and eₕ calibrated so the model reproduces
  // published TrackMan carry-vs-total gaps (driver ≈ +18 yd, 7-iron ≈ +4 yd on medium turf).
  const ROLL_MU = Object.freeze({ firm: 0.40, medium: 0.55, soft: 0.80 }); // effective turf deceleration coefficient — calibrated per above
  const ROLL_EH_A = 0.80;      // horizontal restitution at 0° descent — calibrated to TrackMan carry/total gaps
  const ROLL_EH_B = 0.0065;    // loss of horizontal restitution per degree of descent — calibrated as above
  const ROLL_EH_MIN = 0.28;    // floor on horizontal restitution for steep wedge landings
  function rolloutYd(landSpeedMps, descentDeg, firmness = 'medium', gravity = 9.80665) {
    if (!(landSpeedMps > 0)) return 0;
    const mu = ROLL_MU[firmness] || ROLL_MU.medium;
    const eh = clamp(ROLL_EH_A - ROLL_EH_B * Math.abs(descentDeg), ROLL_EH_MIN, ROLL_EH_A);
    const vh = eh * landSpeedMps * Math.cos(d2r(clamp(Math.abs(descentDeg), 0, 89)));
    return ((vh * vh) / (2 * mu * gravity)) * M_TO_YD;
  }

  // TrackMan PGA Tour launch-condition averages (men). Indexed later by *integrated*
  // standard carry so any constant bias in the aero model cancels in the inverse mapping.
  // Source: TrackMan Golf, "PGA Tour averages" launch-monitor dataset (ball speed / launch angle / spin rate).
  const LAUNCH_TABLE = Object.freeze([
    { ballMph: 167, launchDeg: 10.9, spinRpm: 2686 },  // Driver — TrackMan PGA Tour averages
    { ballMph: 158, launchDeg: 9.2, spinRpm: 3655 },  // 3-wood — TrackMan PGA Tour averages
    { ballMph: 152, launchDeg: 9.4, spinRpm: 4350 },  // 5-wood — TrackMan PGA Tour averages
    { ballMph: 146, launchDeg: 10.2, spinRpm: 4437 },  // Hybrid — TrackMan PGA Tour averages
    { ballMph: 142, launchDeg: 10.4, spinRpm: 4630 },  // 3-iron — TrackMan PGA Tour averages
    { ballMph: 137, launchDeg: 11.0, spinRpm: 4836 },  // 4-iron — TrackMan PGA Tour averages
    { ballMph: 132, launchDeg: 12.1, spinRpm: 5361 },  // 5-iron — TrackMan PGA Tour averages
    { ballMph: 127, launchDeg: 14.1, spinRpm: 6231 },  // 6-iron — TrackMan PGA Tour averages
    { ballMph: 120, launchDeg: 16.3, spinRpm: 7097 },  // 7-iron — TrackMan PGA Tour averages
    { ballMph: 115, launchDeg: 18.1, spinRpm: 7998 },  // 8-iron — TrackMan PGA Tour averages
    { ballMph: 109, launchDeg: 20.4, spinRpm: 8647 },  // 9-iron — TrackMan PGA Tour averages
    { ballMph: 102, launchDeg: 24.2, spinRpm: 9304 },  // PW — TrackMan PGA Tour averages
    { ballMph: 88, launchDeg: 26.5, spinRpm: 9600 },  // partial-wedge extension, extrapolated on the table's own trend
    { ballMph: 72, launchDeg: 28.0, spinRpm: 9200 },  // short-wedge extension, extrapolated on the table's own trend
  ]);

  const STILL_AIR_ENV = Object.freeze({
    rho: RHO_STD,
    gravity: gravityAt(STD_LAT, 0),
    windAt: () => ({ wx: 0, wz: 0 }),
    coriolis: { ox: 0, oy: 0, oz: 0 },
    targetDropM: 0,
  });

  let _launchFamily = null;
  // Build the standard-condition family once: integrate each table row in still standard
  // air, then interpolate launch conditions as monotone functions of the resulting carry.
  function referenceLaunchFamily() {
    if (_launchFamily) return _launchFamily;
    const rows = LAUNCH_TABLE.map((L) => {
      const launch = {
        speedMps: L.ballMph * MPH_TO_MPS,
        launchDeg: L.launchDeg,
        spinRadS: L.spinRpm * RPM_TO_RADS,
        aimOffsetDeg: 0,
      };
      const t = integrateTrajectory(launch, STILL_AIR_ENV);
      return { carryYd: t.carryM * M_TO_YD, ...launch, apexM: t.apexM };
    }).sort((a, b) => a.carryYd - b.carryYd);
    // Extend beyond PGA-Tour carry with self-consistent long-drive anchors so the
    // solver stays monotone for far tee-to-green measurement taps (par-5 layup
    // planning). Launch ≈11°, spin ≈1800 rpm (long-drive optimized); ball speed is
    // solved so the integrator reproduces each anchor carry exactly.
    const EXT_ANCHORS = [
      { carryYd: 350, seedMps: 88 },
      { carryYd: 460, seedMps: 104 },
      { carryYd: 560, seedMps: 118 },
      { carryYd: 650, seedMps: 132 },
      { carryYd: 780, seedMps: 147 },
      { carryYd: 950, seedMps: 164 },
    ];
    for (const { carryYd: targetYd, seedMps } of EXT_ANCHORS) {
      let speed = seedMps;
      for (let i = 0; i < 30; i++) {
        const t0 = integrateTrajectory({
          speedMps: speed, launchDeg: 11,
          spinRadS: 1800 * RPM_TO_RADS, aimOffsetDeg: 0,
        }, STILL_AIR_ENV);
        const f = t0.carryM * M_TO_YD - targetYd;
        if (Math.abs(f) < 0.05) break;
        const h = Math.max(1, 0.02 * speed);
        const tP = integrateTrajectory({
          speedMps: speed + h, launchDeg: 11,
          spinRadS: 1800 * RPM_TO_RADS, aimOffsetDeg: 0,
        }, STILL_AIR_ENV);
        const fp = ((tP.carryM * M_TO_YD) - (t0.carryM * M_TO_YD)) / h;
        speed = fp > 1e-3 ? speed - f / fp : speed + (f > 0 ? 0.5 : -0.5);
        if (speed < 20) speed = 20;
      }
      const t = integrateTrajectory({
        speedMps: speed, launchDeg: 11,
        spinRadS: 1800 * RPM_TO_RADS, aimOffsetDeg: 0,
      }, STILL_AIR_ENV);
      rows.push({
        carryYd: t.carryM * M_TO_YD,
        speedMps: speed,
        launchDeg: 11,
        spinRadS: 1800 * RPM_TO_RADS,
        apexM: t.apexM,
        extended: true,
      });
    }
    rows.sort((a, b) => a.carryYd - b.carryYd);
    const tourMaxCarry = Math.max(...rows.filter((r) => !r.extended).map((r) => r.carryYd));
    // Enforce strict monotonicity so the interpolators are invertible.
    for (let i = 1; i < rows.length; i++)
      if (rows[i].carryYd <= rows[i - 1].carryYd) rows[i].carryYd = rows[i - 1].carryYd + 0.5;
    const cs = rows.map((r) => r.carryYd);
    _launchFamily = {
      minCarry: cs[0], maxCarry: cs[cs.length - 1], tourMaxCarry,
      speed: pchip(cs, rows.map((r) => r.speedMps)),
      launch: pchip(cs, rows.map((r) => r.launchDeg)),
      spin: pchip(cs, rows.map((r) => r.spinRadS)),
      apex: pchip(cs, rows.map((r) => r.apexM)),
      rows,
    };
    return _launchFamily;
  }
  // Launch conditions for a player whose standard-condition carry is `carryYd`.
  function launchForStandardCarry(carryYd) {
    const F = referenceLaunchFamily();
    // Track the family's calibrated ceiling instead of a hard-coded 650 yd
    // cap, so plays-like keeps scaling with the real tapped distance no
    // matter how far the target sits.
    const c = clamp(num(carryYd, 100), 8, Math.max(650, Math.round(F.maxCarry)));
    return {
      speedMps: Math.max(8, F.speed(c)),
      launchDeg: clamp(F.launch(c), 4, 42),
      spinRadS: Math.max(500 * RPM_TO_RADS, F.spin(c)),
      aimOffsetDeg: 0,
      apexM: Math.max(1, F.apex(c)),
      extended: c > F.tourMaxCarry,
    };
  }
  // ============================================================
  //  BLOCK 5 — PLAYS-LIKE (inverse trajectory solve)
  //  Replaces: windComponents, PHYSICS, playsLike, playsLikeFor
  // ============================================================

  /**
   * Wind decomposition. SINGLE SOURCE OF TRUTH for wind signs app-wide.
   *   headwindMph  > 0 => into the player;  < 0 => tailwind
   *   crosswindMph > 0 => FROM the right => pushes ball LEFT => aim RIGHT
   */
  function windComponents({ windMph, windFromDeg, bearingDeg } = {}) {
    const speed = Math.max(0, num(windMph, 0));
    const theta = d2r(norm(num(windFromDeg, 0)) - norm(num(bearingDeg, 0)));
    return { headwindMph: speed * Math.cos(theta), crosswindMph: speed * Math.sin(theta) };
  }

  const PHYSICS = Object.freeze({
    // Baselines defining "standard conditions" — the reference the plays-like number is quoted against.
    TEMP_BASELINE_F: STD_TEMP_F,          // reference temperature for quoted carry, °F — TrackMan/USGA test conditions
    HUMIDITY_BASELINE_RH: STD_RH,         // reference relative humidity, % — TrackMan/USGA test conditions
    ALTITUDE_BASELINE_FT: STD_ALT_FT,     // reference altitude, ft — quoted carry numbers assume sea level
    MIN_CROSSWIND_MPH: 1.0,               // below this the aim correction is inside GPS/aim noise; report "minimal"
    SOLVER_TOL_YD: 0.25,                 // inverse-solve tolerance, yd — GPS error is ±10–30 yd; tighter tolerances burn iterations for nothing
    SOLVER_MAX_ITER: 14,                  // Newton + bisection safeguard iteration cap
    // Legacy linear coefficients, retained ONLY so any external reader of PHYSICS.* keeps working.
    // The solver no longer uses them; they are superseded by the trajectory model.
    FT_PER_ELEV_YARD: 3,                  // legacy rule of thumb, superseded — 1 yd per 3 ft of elevation
    HEADWIND_PCT_PER_MPH: 0.01,           // legacy rule of thumb, superseded — 1%/mph into the wind
    TAILWIND_PCT_PER_MPH: 0.005,          // legacy rule of thumb, superseded — 0.5%/mph downwind
    TEMP_PCT_PER_10F: 0.0075,             // legacy rule of thumb, superseded — 0.75% per 10°F
    ALTITUDE_PCT_PER_1000FT: 0.0116,      // legacy rule of thumb, superseded — 1.16% per 1000 ft
    HUMIDITY_PCT_PER_RH_POINT: -0.0002,   // legacy rule of thumb, superseded
    HUMIDITY_MAX_ABS_PCT: 0.01,           // legacy clamp, superseded
    CROSSWIND_AIM_PCT_PER_MPH: 0.01,      // legacy rule of thumb, superseded by integrated lateral deflection
  });

  // Build the integration environment for a set of on-course conditions.
  function buildEnv(cond) {
    const tempF = num(cond.tempF, STD_TEMP_F);
    const altFt = num(cond.courseAltitudeFt, 0);
    const rho = airDensity({ tempF, rh: cond.rh, altitudeFt: altFt, pressureHpa: cond.pressureHpa });
    const bearing = norm(num(cond.bearingDeg, 0));
    const lat = num(cond.latDeg, STD_LAT);
    const alpha = Number.isFinite(cond.shearAlpha) ? cond.shearAlpha : null;
    const speed10 = Math.max(0, num(cond.windMph, 0)) * MPH_TO_MPS;
    const fromDeg = norm(num(cond.windFromDeg, 0));
    const phi = d2r(lat);
    return {
      rho,
      gravity: gravityAt(lat, altFt * FT_TO_M),
      targetDropM: num(cond.elevDiffFt, 0) * FT_TO_M,
      // Earth rotation resolved into the shot frame (x̂ at bearing β, ŷ up, ẑ right of x̂).
      coriolis: {
        ox: OMEGA_EARTH * Math.cos(phi) * Math.cos(d2r(bearing)),
        oy: OMEGA_EARTH * Math.sin(phi),
        oz: -OMEGA_EARTH * Math.cos(phi) * Math.sin(d2r(bearing)),
      },
      windAt(z) {
        if (speed10 <= 0) return { wx: 0, wz: 0 };
        const f = alpha != null ? windPowerFactor(z, alpha) : windProfileFactor(z);
        const spd = speed10 * f;
        const dir = fromDeg + windVeerDeg(z, lat);
        const rel = d2r(dir - bearing);
        // wx = −head, wz = −cross with the windComponents sign convention.
        return { wx: -spd * Math.cos(rel), wz: -spd * Math.sin(rel) };
      },
    };
  }

  const _plCache = makeLRU(400);
  const _plKey = (D, c) =>
    [Math.round(D * 2), Math.round(num(c.elevDiffFt, 0)), Math.round(num(c.courseAltitudeFt, 0) / 25),
    Math.round(num(c.tempF, 70)), Math.round(num(c.rh, 50) / 5), Math.round(num(c.windMph, 0) * 2),
    Math.round(norm(num(c.windFromDeg, 0)) / 3), Math.round(norm(num(c.bearingDeg, 0)) / 3),
    Math.round(num(c.pressureHpa, 0)), Math.round(num(c.shearAlpha, 0.143) * 100),
    Math.round(num(c.latDeg, 40))].join('|');

  // Carry actually achieved, in yards, by a player whose standard carry is P, under `env`.
  function carryUnder(P, env) {
    const L = launchForStandardCarry(P);
    const t = integrateTrajectory(L, env);
    return t.reached ? t.carryM * M_TO_YD : Math.max(0, t.carryM * M_TO_YD);
  }

  /**
   * Core inverse solve: the standard-condition carry number P such that a shot launched
   * with P's launch conditions exactly covers `targetYd` under `cond`. Newton on a smooth
   * monotone function with a bisection safeguard; ~6–9 integrations.
   */
  function solvePlaysLikeYd(targetYd, cond) {
    const D = Math.max(0, num(targetYd, 0));
    if (D < 1) return { playsLikeYd: D, launch: null, traj: null, dCarrydP: 1, env: null };
    const key = _plKey(D, cond);
    const hit = _plCache.get(key);
    if (hit) return hit;

    const env = buildEnv(cond);
    const famMax = Math.max(650, Math.round(referenceLaunchFamily().maxCarry));
    let lo = 5, hi = famMax;
    let P = clamp(D - num(cond.elevDiffFt, 0) / 3, 8, famMax); // legacy linear rule used ONLY as the Newton seed
    let f = carryUnder(P, env) - D;
    for (let i = 0; i < PHYSICS.SOLVER_MAX_ITER; i++) {
      if (Math.abs(f) < PHYSICS.SOLVER_TOL_YD) break;
      if (f > 0) hi = Math.min(hi, P); else lo = Math.max(lo, P);
      const h = Math.max(1, 0.02 * P);
      const fp = (carryUnder(P + h, env) - carryUnder(P - h, env)) / (2 * h);
      let next = fp > 1e-3 ? P - f / fp : 0.5 * (lo + hi);
      if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
      P = next;
      f = carryUnder(P, env) - D;
    }
    const L = launchForStandardCarry(P);
    const traj = integrateTrajectory(L, env);
    const h = Math.max(1, 0.02 * P);
    const dCarrydP = Math.max(0.2, (carryUnder(P + h, env) - carryUnder(P - h, env)) / (2 * h));
    const out = { playsLikeYd: P, launch: L, traj, dCarrydP, env };
    _plCache.set(key, out);
    return out;
  }

  /**
   * PUBLIC SIGNATURE PRESERVED. Same input keys, same output keys, plus extras.
   * Every *AdjYd is "yards added to horizontalYd"; positive => plays longer.
   * Attributions are first-order sensitivities from the solved state, renormalized so
   * the parts sum exactly to the whole (they are not independent in the real physics).
   */
  function playsLike(input = {}) {
    const horizontalYd = Math.max(0, num(input.horizontalYd, 0));
    const bearingDeg = norm(num(input.bearingDeg, 0));
    const elevDiffFt = num(input.elevDiffFt, 0);
    const courseAltitudeFt = num(input.courseAltitudeFt, 0);
    const tempF = num(input.tempF, STD_TEMP_F);
    const rh = clamp(num(input.rh, STD_RH), 0, 100);
    const windMph = Math.max(0, num(input.windMph, 0));
    const windFromDeg = norm(num(input.windFromDeg, 0));
    const lieYd = num(input.lieYd, 0);
    const pressureHpa = num(input.pressureHpa, NaN);
    const shearAlpha = num(input.shearAlpha, NaN);
    const latDeg = num(input.latDeg, STD_LAT);
    const gustMph = num(input.gustMph, NaN);
    const firmness = input.firmness || 'medium';

    const { headwindMph, crosswindMph } = windComponents({ windMph, windFromDeg, bearingDeg });

    const cond = {
      bearingDeg, elevDiffFt, courseAltitudeFt, tempF, rh, windMph, windFromDeg,
      pressureHpa, shearAlpha, latDeg
    };
    const sol = solvePlaysLikeYd(horizontalYd, cond);
    const P = sol.playsLikeYd;
    const g = Math.max(0.2, sol.dCarrydP);

    // First-order attribution: switch one factor to its baseline, re-evaluate carry at the
    // solved launch, and convert the carry change into required-yardage change via dC/dP.
    // carryOn is independent of the override — hoisting it drops 4 of the 10
    // attribution integrations (~30% of playsLike's total cost).
    const carryOn = horizontalYd >= 1 && sol.env ? carryUnder(P, sol.env) : 0;
    const attribution = (override) => {
      if (horizontalYd < 1 || !sol.env) return 0;
      return (carryUnder(P, buildEnv({ ...cond, ...override })) - carryOn) / g;
    };
    let elevAdjYd = elevDiffFt !== 0 ? attribution({ elevDiffFt: 0 }) : 0;
    let windAdjYd = windMph > 0 ? attribution({ windMph: 0 }) : 0;
    let tempAdjYd = tempF !== STD_TEMP_F ? attribution({ tempF: STD_TEMP_F }) : 0;
    let altitudeAdjYd = courseAltitudeFt !== 0 ? attribution({ courseAltitudeFt: 0 }) : 0;
    let humidityAdjYd = rh !== STD_RH ? attribution({ rh: STD_RH }) : 0;

    // Renormalize so Σ parts == P − D exactly.
    const parts = [elevAdjYd, windAdjYd, tempAdjYd, altitudeAdjYd, humidityAdjYd];
    const sumParts = parts.reduce((a, b) => a + b, 0);
    const residual = (P - horizontalYd) - sumParts;
    const absTot = parts.reduce((a, b) => a + Math.abs(b), 0);
    if (absTot > 1e-6) {
      const k = residual / absTot;
      elevAdjYd += k * Math.abs(elevAdjYd);
      windAdjYd += k * Math.abs(windAdjYd);
      tempAdjYd += k * Math.abs(tempAdjYd);
      altitudeAdjYd += k * Math.abs(altitudeAdjYd);
      humidityAdjYd += k * Math.abs(humidityAdjYd);
    }

    const playsLikeYd = Math.max(0, Math.round(P + lieYd));

    // Crosswind aim from the integrated lateral deflection — not a percent-per-mph rule.
    let crossFrom, aimYd, aimDeg = 0, lateralDriftYd = 0;
    if (sol.traj) lateralDriftYd = sol.traj.lateralM * M_TO_YD;
    if (Math.abs(crosswindMph) < PHYSICS.MIN_CROSSWIND_MPH || horizontalYd < 15) {
      crossFrom = 'minimal';
      aimYd = 0;
    } else {
      // Solve the aim offset that cancels the deflection: one secant step on aimOffsetDeg.
      const trial = (aDeg) => {
        const L = { ...sol.launch, aimOffsetDeg: aDeg };
        const t = integrateTrajectory(L, sol.env);
        return t.lateralM * M_TO_YD;
      };
      const z0 = lateralDriftYd;
      const probe = Math.sign(-z0) * 1.5 || 1.5;
      const z1 = trial(probe);
      const slope = (z1 - z0) / probe;
      aimDeg = Math.abs(slope) > 1e-6 ? clamp(-z0 / slope, -25, 25) : 0;
      aimYd = Math.round(-z0);   // signed: + = aim right, matching crosswind > 0
      crossFrom = crosswindMph > 0
        ? 'wind pushes left — aim right'
        : 'wind pushes right — aim left';
    }

    // Gust exposure: half the head/cross gust delta, expressed in yards of uncertainty.
    let gustYd = 0;
    if (Number.isFinite(gustMph) && gustMph > windMph + 1) {
      const cg = { ...cond, windMph: gustMph };
      gustYd = Math.abs(solvePlaysLikeYd(horizontalYd, cg).playsLikeYd - P);
    }

    const rho = sol.env ? sol.env.rho : RHO_STD;
    const roll = sol.traj
      ? rolloutYd(sol.traj.landSpeedMps, sol.traj.descentDeg, firmness,
        sol.env ? sol.env.gravity : 9.80665)
      : 0;

    return {
      // --- original keys, unchanged names/meanings ---
      horizontalYd, playsLikeYd,
      windAdjYd, tempAdjYd, altitudeAdjYd, humidityAdjYd, elevAdjYd, lieYd,
      headwindMph, crosswindMph, crossFrom, aimYd,
      bearingDeg, elevDiffFt, courseAltitudeFt, tempF, rh, windMph, windFromDeg,
      windPct: horizontalYd > 0 ? windAdjYd / horizontalYd : 0,
      tempPct: horizontalYd > 0 ? tempAdjYd / horizontalYd : 0,
      altitudePct: horizontalYd > 0 ? altitudeAdjYd / horizontalYd : 0,
      humidityPct: horizontalYd > 0 ? humidityAdjYd / horizontalYd : 0,
      // --- new, additive ---
      aimDeg, lateralDriftYd, gustYd,
      rhoKgM3: rho,
      densityRatio: rho / RHO_STD,
      apexFt: sol.traj ? sol.traj.apexM * M_TO_FT : null,
      flightTimeS: sol.traj ? sol.traj.timeS : null,
      descentDeg: sol.traj ? sol.traj.descentDeg : null,
      landSpeedMph: sol.traj ? sol.traj.landSpeedMps * MPS_TO_MPH : null,
      rolloutYd: roll,
      solvedCarryYd: P,
      solverReached: sol.traj ? sol.traj.reached : true,
      extended: sol.launch ? !!sol.launch.extended : false,
    };
  }

  // PUBLIC SIGNATURE PRESERVED. Light path — plays-like number only, no attributions.
  function playsLikeFor(rawYd, bearing) {
    const w = getWeatherOrNeutral(), e = getElevationOrNeutral();
    const d = Math.max(0, num(rawYd, 0));
    if (d < 1) return Math.round(d);
    return Math.round(solvePlaysLikeYd(d, {
      bearingDeg: bearing,
      elevDiffFt: e.targetFt - e.userFt,
      courseAltitudeFt: (e.targetFt + e.userFt) / 2,
      tempF: w.tempF, rh: w.rh,
      windMph: w.windMph, windFromDeg: w.windFromDeg,
      pressureHpa: w.pressureHpa, shearAlpha: w.shearAlpha,
      latDeg: state.loc ? state.loc.lat : STD_LAT,
    }).playsLikeYd);
  }
  // ============================================================
  //  PATCH B — ZERO-ALLOCATION 3-DOF INTEGRATOR
  //  Overrides: integrateTrajectory, buildEnv
  //  Identical physics and identical return shape to Block 4; the RK4 inner
  //  loop is rewritten in flat scalars because the array-based version
  //  allocated ~8 six-element arrays per step (~288k objects/sec at 1 Hz).
  // ============================================================

  function buildEnv(cond) {
    const tempF = num(cond.tempF, STD_TEMP_F);
    const altFt = num(cond.courseAltitudeFt, 0);
    const rho = airDensity({ tempF, rh: cond.rh, altitudeFt: altFt, pressureHpa: cond.pressureHpa });
    const bearing = norm(num(cond.bearingDeg, 0));
    const lat = num(cond.latDeg, STD_LAT);
    const alpha = Number.isFinite(cond.shearAlpha) ? cond.shearAlpha : null;
    const speed10 = Math.max(0, num(cond.windMph, 0)) * MPH_TO_MPS;
    const fromDeg = norm(num(cond.windFromDeg, 0));
    const phi = d2r(lat);
    // Reused wind object: the consumer reads it immediately and never retains it,
    // so mutating one instance removes 4 allocations per integration step.
    const windOut = { wx: 0, wz: 0 };
    return {
      rho,
      gravity: gravityAt(lat, altFt * FT_TO_M),
      targetDropM: num(cond.elevDiffFt, 0) * FT_TO_M,
      coriolis: {
        ox: OMEGA_EARTH * Math.cos(phi) * Math.cos(d2r(bearing)),
        oy: OMEGA_EARTH * Math.sin(phi),
        oz: -OMEGA_EARTH * Math.cos(phi) * Math.sin(d2r(bearing)),
      },
      windAt(z) {
        if (speed10 <= 0) { windOut.wx = 0; windOut.wz = 0; return windOut; }
        const f = alpha != null ? windPowerFactor(z, alpha) : windProfileFactor(z);
        const spd = speed10 * f;
        const rel = d2r(fromDeg + windVeerDeg(z, lat) - bearing);
        windOut.wx = -spd * Math.cos(rel);
        windOut.wz = -spd * Math.sin(rel);
        return windOut;
      },
    };
  }

  function integrateTrajectory(launch, env) {
    const r = BALL.radiusM;
    const invM = 1 / BALL.massKg;
    const halfRhoA = 0.5 * env.rho * BALL.areaM2;
    const grav = env.gravity;
    const drop = num(env.targetDropM, 0);
    const co = env.coriolis || { ox: 0, oy: 0, oz: 0 };
    const c2x = 2 * co.ox, c2y = 2 * co.oy, c2z = 2 * co.oz;
    const windAt = env.windAt;
    const th = d2r(launch.launchDeg), az = d2r(num(launch.aimOffsetDeg, 0));
    const axX = -Math.sin(az), axZ = Math.cos(az);   // spin axis; axY = 0
    const spin0 = launch.spinRadS;
    const invTau = 1 / BALL.spinDecayTauS;
    const dt = TRAJ_DT;

    let aX = 0, aY = 0, aZ = 0;          // accel scratch
    let sX = 0, sY = 0, sZ = 0, sVX = 0, sVY = 0, sVZ = 0;   // step scratch

    function accel(py, pvx, pvy, pvz, tt) {
      const wind = windAt(py > 0 ? py : 0);
      const vrx = pvx - wind.wx, vry = pvy, vrz = pvz - wind.wz;
      let v = Math.sqrt(vrx * vrx + vry * vry + vrz * vrz);
      if (!(v > EPS)) v = EPS;
      let S = (spin0 * Math.exp(-tt * invTau) * r) / v;
      if (S < AERO_S_MIN) S = AERO_S_MIN; else if (S > AERO_S_MAX) S = AERO_S_MAX;
      const cl = CL_C0 + Math.sqrt(CL_C1 + CL_C2 * S);
      const cd = CD_C0 + CD_C1 * S;
      const q = halfRhoA * v * invM;
      // lift direction = normalize(axis × vRel), axis = (axX, 0, axZ)
      const lx = -axZ * vry, ly = axZ * vrx - axX * vrz, lz = axX * vry;
      let ln = Math.sqrt(lx * lx + ly * ly + lz * lz);
      if (!(ln > EPS)) ln = EPS;
      const Lq = (q * cl * v) / ln;
      aX = -q * cd * vrx + Lq * lx - (c2y * pvz - c2z * pvy);
      aY = -q * cd * vry + Lq * ly - grav - (c2z * pvx - c2x * pvz);
      aZ = -q * cd * vrz + Lq * lz - (c2x * pvy - c2y * pvx);
    }

    function stepTo(x0, y0, z0, vx0, vy0, vz0, t0, h) {
      const h2 = 0.5 * h, h6 = h / 6;
      accel(y0, vx0, vy0, vz0, t0);
      const k1px = vx0, k1py = vy0, k1pz = vz0, k1vx = aX, k1vy = aY, k1vz = aZ;
      let vX = vx0 + h2 * k1vx, vY = vy0 + h2 * k1vy, vZ = vz0 + h2 * k1vz;
      accel(y0 + h2 * k1py, vX, vY, vZ, t0 + h2);
      const k2px = vX, k2py = vY, k2pz = vZ, k2vx = aX, k2vy = aY, k2vz = aZ;
      vX = vx0 + h2 * k2vx; vY = vy0 + h2 * k2vy; vZ = vz0 + h2 * k2vz;
      accel(y0 + h2 * k2py, vX, vY, vZ, t0 + h2);
      const k3px = vX, k3py = vY, k3pz = vZ, k3vx = aX, k3vy = aY, k3vz = aZ;
      vX = vx0 + h * k3vx; vY = vy0 + h * k3vy; vZ = vz0 + h * k3vz;
      accel(y0 + h * k3py, vX, vY, vZ, t0 + h);
      sX = x0 + h6 * (k1px + 2 * k2px + 2 * k3px + vX);
      sY = y0 + h6 * (k1py + 2 * k2py + 2 * k3py + vY);
      sZ = z0 + h6 * (k1pz + 2 * k2pz + 2 * k3pz + vZ);
      sVX = vx0 + h6 * (k1vx + 2 * k2vx + 2 * k3vx + aX);
      sVY = vy0 + h6 * (k1vy + 2 * k2vy + 2 * k3vy + aY);
      sVZ = vz0 + h6 * (k1vz + 2 * k2vz + 2 * k3vz + aZ);
    }

    let x = 0, y = 0, z = 0;
    const cth = Math.cos(th);
    let vx = launch.speedMps * cth * Math.cos(az);
    let vy = launch.speedMps * Math.sin(th);
    let vz = launch.speedMps * cth * Math.sin(az);
    let apex = 0, t = 0, steps = 0;

    while (steps++ < TRAJ_MAX_STEPS) {
      stepTo(x, y, z, vx, vy, vz, t, dt);
      if (sY > apex) apex = sY;
      if (sVY < 0 && sY <= drop && y > drop) {
        let lo = 0, hi = dt;
        for (let i = 0; i < TRAJ_REFINE; i++) {
          const mid = 0.5 * (lo + hi);
          stepTo(x, y, z, vx, vy, vz, t, mid);
          if (sY > drop) lo = mid; else hi = mid;
        }
        const hFin = 0.5 * (lo + hi);
        stepTo(x, y, z, vx, vy, vz, t, hFin);
        const vh = hypot2(sVX, sVZ);
        return {
          carryM: sX, lateralM: sZ, apexM: apex, timeS: t + hFin,
          landSpeedMps: Math.sqrt(sVX * sVX + sVY * sVY + sVZ * sVZ),
          descentDeg: r2d(Math.atan2(-sVY, Math.max(EPS, vh))),
          reached: true,
        };
      }
      x = sX; y = sY; z = sZ; vx = sVX; vy = sVY; vz = sVZ;
      t += dt;
      if (y < drop - 200) break;
    }
    const vh = hypot2(vx, vz);
    return {
      carryM: x, lateralM: z, apexM: apex, timeS: t,
      landSpeedMps: Math.sqrt(vx * vx + vy * vy + vz * vz),
      descentDeg: r2d(Math.atan2(-vy, Math.max(EPS, vh))),
      reached: false,
    };
  }
  // ============================================================
  //  BLOCK 6 — GPS ESTIMATION
  //  Replaces: kalman, weightedAverage, impliedSpeedReject, onPosition, updateGpsUI
  // ============================================================

  // The W3C Geolocation API defines `accuracy` as a 95%-confidence horizontal radius,
  // so the per-axis 1σ is R95 / (Rayleigh 95th percentile), NOT R95 itself.
  // Ref: W3C Geolocation API Level 2, GeolocationCoordinates.accuracy.
  const GPS_ACC_TO_SIGMA = 1 / RAYLEIGH_95;
  const KF_SIGMA_A = 0.45;          // pedestrian acceleration spectral density, m/s² — CWNA model, Bar-Shalom et al., Estimation with Applications to Tracking and Navigation (2001) §6.2
  const KF_SIGMA_A_MIN = 0.10;      // lower bound when adaptation says the target is nearly static
  const KF_SIGMA_A_MAX = 2.50;      // upper bound; above this the filter is effectively pass-through
  const KF_GATE_P = 0.995;          // χ²₂ innovation gate probability — standard 2-D track gating, Bar-Shalom §2.3
  const KF_NIS_WINDOW = 12;         // sliding window for normalized-innovation-squared adaptation — Mehra, IEEE TAC 17 (1972) 693
  const KF_NIS_TARGET = 2;          // E[NIS] equals the measurement dimension when the model is consistent
  const KF_ZUPT_SPEED_MPS = 0.35;   // below this the player is standing over the ball — zero-velocity update threshold
  const KF_ZUPT_R = 0.01;           // pseudo-measurement variance for the ZUPT, (m/s)² — tight by design
  const GPS_CORRELATED_FRAC = 0.45; // fraction of the reported error that is bias-like (multipath/iono) and cannot be averaged away — Misra & Enge, Global Positioning System 2nd ed. §5
  const GPS_MAX_FUSE_N = 6;         // cap on effective sample count in the fuser, reflecting the above correlation
  const KF_MAX_DT_S = 12;           // beyond this gap the velocity estimate is worthless — reset velocity
  const KF_REBASE_M = 3000;         // re-origin the ENU frame past this distance to keep the tangent-plane error negligible

  const kalman = (() => {
    let fr = null;                          // ENU frame
    let x = null;                           // [e, n, ve, vn]
    let P = null;                           // 4x4 covariance
    let lastT = 0;
    let sigmaA = KF_SIGMA_A;
    let nisBuf = [];
    let rejects = 0;
    let speedBuf = [];
    const GATE = chi2Inv(KF_GATE_P, 2);

    const mat4 = () => [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    function predict(dt) {
      // x = F x
      x[0] += x[2] * dt; x[1] += x[3] * dt;
      // P = F P Fᵀ + Q, with the exact continuous-white-noise-acceleration Q.
      const q = sigmaA * sigmaA;
      const q11 = (q * dt * dt * dt) / 3, q12 = (q * dt * dt) / 2, q22 = q * dt;
      const F = [[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]];
      const FP = mat4();
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        let s = 0; for (let k = 0; k < 4; k++) s += F[i][k] * P[k][j];
        FP[i][j] = s;
      }
      const NP = mat4();
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        let s = 0; for (let k = 0; k < 4; k++) s += FP[i][k] * F[j][k];
        NP[i][j] = s;
      }
      NP[0][0] += q11; NP[1][1] += q11; NP[2][2] += q22; NP[3][3] += q22;
      NP[0][2] += q12; NP[2][0] += q12; NP[1][3] += q12; NP[3][1] += q12;
      P = NP;
    }
    function symmetrize() {
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        const m = 0.5 * (P[i][j] + P[j][i]); P[i][j] = m; P[j][i] = m;
      }
    }
    function zupt() {
      // Pseudo-measurement v = 0 on both velocity components.
      for (const idx of [2, 3]) {
        const S = P[idx][idx] + KF_ZUPT_R;
        if (!(S > 0)) continue;
        const K = [P[0][idx] / S, P[1][idx] / S, P[2][idx] / S, P[3][idx] / S];
        const nu = -x[idx];
        for (let i = 0; i < 4; i++) x[i] += K[i] * nu;
        const row = [P[idx][0], P[idx][1], P[idx][2], P[idx][3]];
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) P[i][j] -= K[i] * row[j];
        symmetrize();
      }
    }
    return {
      // SIGNATURE PRESERVED: returns { lat, lng } (plus extras).
      process(newLat, newLng, accuracyM, tsMs) {
        const sig = Math.max(0.8, num(accuracyM, 30) * GPS_ACC_TO_SIGMA);
        const Rm = sig * sig;
        if (!fr || !x) {
          fr = enuFrame({ lat: newLat, lng: newLng });
          x = [0, 0, 0, 0];
          P = [[Rm, 0, 0, 0], [0, Rm, 0, 0], [0, 0, 25, 0], [0, 0, 0, 25]];  // initial velocity σ = 5 m/s (unknown gait)
          lastT = tsMs; nisBuf = []; speedBuf = []; rejects = 0;
          return { lat: newLat, lng: newLng, accuracy95: accuracyM, speedMps: 0, gated: false };
        }
        let dt = (tsMs - lastT) / 1000;
        if (!(dt > 0)) dt = 0.05;
        if (dt > KF_MAX_DT_S) { x[2] = 0; x[3] = 0; P[2][2] = 25; P[3][3] = 25; }
        lastT = tsMs;
        predict(Math.min(dt, KF_MAX_DT_S));

        const z = toENU(fr, { lat: newLat, lng: newLng });
        const nu = [z.e - x[0], z.n - x[1]];
        const S11 = P[0][0] + Rm, S22 = P[1][1] + Rm, S12 = P[0][1];
        const det = S11 * S22 - S12 * S12;
        let d2 = 0, gated = false;
        if (det > 0) {
          d2 = (nu[0] * (S22 * nu[0] - S12 * nu[1]) + nu[1] * (S11 * nu[1] - S12 * nu[0])) / det;
        }
        if (d2 > GATE) {
          rejects++;
          if (rejects < MAX_CONSECUTIVE_REJECTS) {
            gated = true;                     // reject the outlier, keep the prediction
          } else {
            // Persistent disagreement means the filter, not the fix, is wrong: re-initialize.
            fr = enuFrame({ lat: newLat, lng: newLng });
            x = [0, 0, 0, 0];
            P = [[Rm, 0, 0, 0], [0, Rm, 0, 0], [0, 0, 25, 0], [0, 0, 0, 25]];
            rejects = 0; nisBuf = []; speedBuf = [];
            return { lat: newLat, lng: newLng, accuracy95: accuracyM, speedMps: 0, gated: false, reinit: true };
          }
        } else {
          rejects = 0;
        }

        if (!gated) {
          nisBuf.push(d2);
          if (nisBuf.length > KF_NIS_WINDOW) nisBuf.shift();
          // K = P Hᵀ S⁻¹ with H = [I 0]
          const iS = [[S22 / det, -S12 / det], [-S12 / det, S11 / det]];
          const K = [[0, 0], [0, 0], [0, 0], [0, 0]];
          for (let i = 0; i < 4; i++) {
            const p0 = P[i][0], p1 = P[i][1];
            K[i][0] = p0 * iS[0][0] + p1 * iS[1][0];
            K[i][1] = p0 * iS[0][1] + p1 * iS[1][1];
          }
          for (let i = 0; i < 4; i++) x[i] += K[i][0] * nu[0] + K[i][1] * nu[1];
          const H0 = [P[0][0], P[0][1], P[0][2], P[0][3]];
          const H1 = [P[1][0], P[1][1], P[1][2], P[1][3]];
          for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
            P[i][j] -= K[i][0] * H0[j] + K[i][1] * H1[j];
          symmetrize();

          // Mehra-style adaptation: drive mean NIS toward the measurement dimension.
          if (nisBuf.length >= 6) {
            const meanNis = nisBuf.reduce((a, b) => a + b, 0) / nisBuf.length;
            const ratio = clamp(Math.sqrt(meanNis / KF_NIS_TARGET), 0.85, 1.18);
            sigmaA = clamp(sigmaA * ratio, KF_SIGMA_A_MIN, KF_SIGMA_A_MAX);
          }
        }

        const spd = hypot2(x[2], x[3]);
        speedBuf.push(spd);
        if (speedBuf.length > 5) speedBuf.shift();
        if (median(speedBuf) < KF_ZUPT_SPEED_MPS) zupt();

        // Re-origin the tangent frame if we have wandered a long way.
        if (Math.abs(x[0]) > KF_REBASE_M || Math.abs(x[1]) > KF_REBASE_M) {
          const here = fromENU(fr, x[0], x[1]);
          fr = enuFrame(here); x[0] = 0; x[1] = 0;
        }
        const ll = fromENU(fr, x[0], x[1]);
        return {
          lat: ll.lat, lng: ll.lng,
          accuracy95: this.accuracy95(accuracyM),
          speedMps: hypot2(x[2], x[3]),
          gated,
        };
      },
      // Honest 95% radius: circularized filter covariance, floored by the irreducible
      // correlated (bias-like) component of the raw device error.
      accuracy95(rawAccM) {
        if (!P) return num(rawAccM, 30);
        const varAvg = 0.5 * (P[0][0] + P[1][1]);
        const filt = RAYLEIGH_95 * Math.sqrt(Math.max(0, varAvg));
        const floor = GPS_CORRELATED_FRAC * num(rawAccM, 30);
        return Math.max(filt, floor);
      },
      speedMps() { return x ? hypot2(x[2], x[3]) : 0; },
      headingDeg() { return x && hypot2(x[2], x[3]) > 0.3 ? norm(r2d(Math.atan2(x[2], x[3]))) : null; },
      sigmaA() { return sigmaA; },
      reset() { fr = null; x = null; P = null; lastT = 0; sigmaA = KF_SIGMA_A; nisBuf = []; speedBuf = []; rejects = 0; },
    };
  })();

  /**
   * SIGNATURE PRESERVED: weightedAverage(fixes) -> { lat, lng, accuracy }.
   * Now a robust inverse-variance fusion with Huber down-weighting of outliers and a
   * CORRECT fused accuracy. The old version returned min(accuracy), which claimed the
   * precision of the single best fix for an average of ten — badly overconfident.
   */
  const HUBER_K = 1.345;   // Huber tuning constant giving 95% Gaussian efficiency — Huber, Ann. Math. Stat. 35 (1964) 73
  function weightedAverage(fixes) {
    const list = (fixes || []).filter((f) => f && Number.isFinite(f.lat) && Number.isFinite(f.lng));
    if (!list.length) return { lat: 0, lng: 0, accuracy: 9999 };
    const last = list[list.length - 1];
    if (list.length === 1) return { lat: last.lat, lng: last.lng, accuracy: num(last.accuracy, 30) };

    const fr = enuFrame(last);
    const pts = list.map((f) => ({ ...toENU(fr, f), sig: Math.max(0.8, num(f.accuracy, 30) * GPS_ACC_TO_SIGMA) }));
    // Robust centre: start at the coordinate-wise median, then 3 Huber IRLS passes.
    let ce = median(pts.map((p) => p.e)), cn = median(pts.map((p) => p.n));
    const scale = Math.max(1, madSigma(pts.map((p) => hypot2(p.e - ce, p.n - cn))) || 1);
    let sw = 0;
    for (let it = 0; it < 3; it++) {
      let se = 0, sn = 0; sw = 0;
      for (const p of pts) {
        const r = hypot2(p.e - ce, p.n - cn) / scale;
        const hub = r <= HUBER_K ? 1 : HUBER_K / Math.max(EPS, r);
        const w = hub / (p.sig * p.sig);
        se += p.e * w; sn += p.n * w; sw += w;
      }
      if (sw <= 0) break;
      ce = se / sw; cn = sn / sw;
    }
    // Fused σ, then inflate for temporally correlated GPS error: averaging n correlated
    // fixes buys at most GPS_MAX_FUSE_N-fold variance reduction, and never beats the
    // bias-like floor of the best single fix.
    const sigIdeal = sw > 0 ? Math.sqrt(1 / sw) : num(last.accuracy, 30) * GPS_ACC_TO_SIGMA;
    const nEff = Math.min(list.length, GPS_MAX_FUSE_N);
    const sigCorr = sigIdeal * Math.sqrt(Math.max(1, list.length / nEff));
    const bestRaw = Math.min(...list.map((f) => num(f.accuracy, 30)));
    const acc95 = Math.max(sigCorr * RAYLEIGH_95, GPS_CORRELATED_FRAC * bestRaw);
    const ll = fromENU(fr, ce, cn);
    return { lat: ll.lat, lng: ll.lng, accuracy: acc95 };
  }

  /**
   * SIGNATURE PRESERVED: impliedSpeedReject(prev, next) -> boolean.
   * Statistical test instead of a fixed slack constant: reject only when the implied
   * displacement is inconsistent with a walking player at the stated uncertainties.
   */
  const WALK_SPEED_SIGMA_MPS = 0.9;   // between-fix speed spread for a walking/riding golfer, m/s — pedestrian gait variability
  const SPEED_REJECT_Z = 4.0;         // 4σ one-sided ⇒ ~3e-5 false-reject rate per fix
  function impliedSpeedReject(prev, next) {
    if (!prev || !next) return false;
    const dt = Math.max(0.25, (next.ts - prev.ts) / 1000);
    const dist = haversineMeters(prev, next);
    const sp = num(prev.accuracy, 30) * GPS_ACC_TO_SIGMA;
    const sn = num(next.accuracy, 30) * GPS_ACC_TO_SIGMA;
    const sigDist = Math.sqrt(sp * sp + sn * sn);                       // σ of the measured separation
    const sigTot = Math.sqrt(sigDist * sigDist + (WALK_SPEED_SIGMA_MPS * dt) ** 2);
    const expected = MAX_GPS_SPEED_MPS * dt;
    return dist - SPEED_REJECT_Z * sigTot > expected;
  }

  // SIGNATURE PRESERVED.
  function onPosition(pos) {
    const c = pos.coords;
    const raw = {
      lat: c.latitude, lng: c.longitude, accuracy: c.accuracy,
      altitude: Number.isFinite(c.altitude) ? c.altitude : null,
      altitudeAccuracy: Number.isFinite(c.altitudeAccuracy) ? c.altitudeAccuracy : null,
      ts: pos.timestamp || Date.now(),
    };
    state.lastRawFix = raw;

    if (raw.accuracy > APPROX_ACC_M && !state.preciseHintShown &&
      Date.now() - state.gpsStartedAt > 9000) {
      state.preciseHintShown = true;
      setNotice('Location looks approximate (±' + Math.round(raw.accuracy) +
        ' m). For real yardages, turn on Precise Location for Safari/this app in iPhone Settings — tap the gear for the path.', 'danger');
    }

    const anchor = state.lastAcceptedFix;
    const tooMany = state.consecutiveRejects >= MAX_CONSECUTIVE_REJECTS;
    const tooOld = anchor && raw.ts - anchor.ts > REBASE_AFTER_MS;
    if (anchor && !tooMany && !tooOld && impliedSpeedReject(anchor, raw)) {
      state.consecutiveRejects++;
      return;
    }
    state.consecutiveRejects = 0;
    state.lastAcceptedFix = raw;

    state.fixSamples.push(raw);
    if (state.fixSamples.length > 10) state.fixSamples.shift();
    const wAvg = weightedAverage(state.fixSamples);
    const sm = kalman.process(wAvg.lat, wAvg.lng, wAvg.accuracy, raw.ts);
    state.smoothed = sm;
    // Report the filter's own 95% radius, never better than the correlated-error floor.
    const acc = Number.isFinite(sm.accuracy95)
      ? sm.accuracy95
      : num(wAvg.accuracy, raw.accuracy);
    state.currentAccuracy = acc;
    state.loc = {
      lat: sm.lat, lng: sm.lng, accuracy: acc,
      altitude: raw.altitude, ts: raw.ts,
    };
    state.locStale = false;
    state.gpsDenied = false;
    save('caddy:lastLocation', state.loc);
    updateGpsUI();
    updateUserMarker();
    if (state.map && !state.pannedOnce) {
      state.map.setView([state.loc.lat, state.loc.lng], 17, { animate: !reduceMotion });
      state.pannedOnce = true;
    } else if (state.map && state.followMode === FollowMode.LOCKED) {
      holdLockedView({ lat: state.loc.lat, lng: state.loc.lng }, !reduceMotion);
    }
    if (state.target) {
      // GPS ticks fire ~once per second and each fix nudges the smoothed
      // position slightly, which used to run the FULL inverse-trajectory
      // solve every time. Recalculate only when you've actually moved far
      // enough for the number to change. Taps, aim changes, green marks
      // and weather/elevation refreshes all call calculateRange()
      // themselves and are never delayed by this gate.
      const movedYd = state.lastCalcLoc
        ? haversineMeters(state.lastCalcLoc, state.loc) * M_TO_YD
        : Infinity;
      if (movedYd >= RANGE_RECALC_MOVE_YD) calculateRange();
    }

    if (roundStatus() !== 'idle') {
      renderRoundShotUI();
    }

    const roundSetupIsOpen =
      els.roundSetupSheet?.classList.contains('open');

    if (
      roundSetupIsOpen &&
      state.nearbySearchRequested &&
      !state.nearbyCourseLoading
    ) {
      findNearbyCourses();
    }

    scheduleContextUpdate();
  }

  // SIGNATURE PRESERVED. Now also surfaces convergence progress and motion state.
  function updateGpsUI(forceState) {
    const dot = els.gpsDot;
    dot.className = 'gps-dot';
    if (!state.gpsRunning && !state.loc) {
      if (state.gpsDenied) { dot.classList.add('bad'); els.gpsText.textContent = 'GPS denied'; }
      else els.gpsText.textContent = 'Enable GPS';
      return;
    }
    if ((forceState === 'searching' && !state.loc) || !state.loc) {
      dot.classList.add('searching');
      els.gpsText.textContent = 'Locating…';
      return;
    }
    const accYd = (state.loc.accuracy || 0) * M_TO_YD;
    const moving = kalman.speedMps() > KF_ZUPT_SPEED_MPS;
    const suffix = moving ? '' : ' · settled';
    if (state.locStale || !state.gpsRunning) {
      dot.classList.add('warn');
      els.gpsText.textContent = `Last GPS · ±${fmt(accYd)} yd`;
    } else if (state.loc.accuracy > USABLE_ACC_M) {
      dot.classList.add('warn');
      els.gpsText.textContent = `GPS ±${fmt(accYd)} yd`;
    } else {
      dot.classList.add('good');
      els.gpsText.textContent = `GPS ±${fmt(accYd)} yd${suffix}`;
    }
    // The pill width changed — keep the advice pill clear of it.
    positionBottomPills();
  }
  // ============================================================
  //  BLOCK 7 — SHOT LOG + BAYESIAN DISPERSION MODEL
  //  Replaces: logShot, shotDataSummary, clubStats,
  //            formulaDispersionYd, clubDispersionYd + their constants
  //  Schema: caddy:shotLog:v1 entries are EITHER a legacy number (total yd)
  //          OR { d: totalYd, c: carryYd, l: lateralYd|null, t: ms, a: gpsAccM }.
  // ============================================================

  const SHOT_FULL_TRUST_N = 5;      // legacy name kept; the posterior now blends continuously, this only gates UI copy
  const SHOT_MIN_TRUST_N = 2;       // legacy name kept; minimum n before tracked data influences the posterior mean
  const SHOT_MAX_PER_CLUB = 200;    // ring-buffer cap; recency weighting makes a longer history harmless
  const DISPERSION_SIGMAS = 1.5;    // legacy name kept; superseded by DISPERSION_COVERAGE below

  // Prior on relative distance dispersion. Tour distance-control σ is ≈4% of carry for
  // short irons rising to ≈6% for the driver; amateurs run ~1.5–2× that.
  // Ref: Broadie, Every Shot Counts (2014) ch.4 & Interfaces 42 (2012) 146 (shot-pattern analysis);
  //      TrackMan/Arccos aggregate dispersion studies for the amateur multiplier.
  const DISP_REL_SHORT = 0.045;     // prior relative σ at short-iron distances — Broadie (2012/2014) shot patterns
  const DISP_REL_LONG = 0.062;      // prior relative σ at driver distances — Broadie (2012/2014) shot patterns
  const DISP_REL_KNEE_LO = 110;     // carry, yd, at which the short-iron relative σ applies
  const DISP_REL_KNEE_HI = 270;     // carry, yd, at which the driver relative σ applies
  const DISP_AMATEUR_MULT = 1.55;   // prior inflation for a non-tour player — Arccos/Shot Scope amateur dispersion aggregates
  const DISP_FLOOR_YD = 3;          // no club is tighter than this in practice; also guards tiny samples
  const DISP_PRIOR_STRENGTH = 6;    // ν₀: prior worth ~6 observations, so ~6 shots move σ halfway to measured
  const DISP_HALFLIFE_DAYS = 240;   // recency half-life; a season-old shot carries half the weight of today's
  const DISPERSION_COVERAGE = 0.87; // two-sided predictive coverage of the reported ± band (≈±1.5σ for large n)
  const LATERAL_REL_PRIOR = 0.065;  // prior relative σ of lateral dispersion (offline as a fraction of carry) — Broadie (2014) ch.4
  const SHOT_SANITY_LO = 0.40;      // hard reject below 40% of stock: topped/chunked, not a distance sample
  const SHOT_SANITY_HI = 1.60;      // hard reject above 160% of stock: mis-tagged club or GPS blowup
  const MISS_BIAS_MIN_N = 5;        // tracked shots with lateral data before miss-direction coaching activates

  // QA-004: every value must be an array of shots — a string/number value
  // here used to crash missDirectionSummary and the CSV export.
  function sanitizeShotLog(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out = {};
    for (const k of Object.keys(v)) if (Array.isArray(v[k])) out[k] = v[k];
    return out;
  }

  function loadShotLog() {
    const v = load(SHOTLOG_KEY, {});
    return sanitizeShotLog(v);
  }
  function saveShotLog(log) { save(SHOTLOG_KEY, log); }

  // Normalize either schema to { d, c, l, t, a }.
  function normalizeShotEntry(e) {
    if (Number.isFinite(e)) return { d: e, c: null, l: null, t: null, a: null };
    if (!e || typeof e !== 'object') return null;
    const d = Number(e.d);
    if (!Number.isFinite(d) || d <= 0) return null;
    return {
      d,
      c: Number.isFinite(e.c) ? Number(e.c) : null,
      l: Number.isFinite(e.l) ? Number(e.l) : null,
      t: Number.isFinite(e.t) ? Number(e.t) : null,
      a: Number.isFinite(e.a) ? Number(e.a) : null,
    };
  }

  // Estimate the carry component of a measured TOTAL distance by modelling the rollout
  // for that club's launch conditions in the CURRENT conditions. This fixes a real
  // inconsistency: the log measured total, but club.yards is a carry number.
  function estimateCarryFromTotal(totalYd, firmness = 'medium') {
    const D = Math.max(0, num(totalYd, 0));
    if (D < 15) return D;
    let carry = D * 0.94;                                  // seed
    for (let i = 0; i < 6; i++) {
      const L = launchForStandardCarry(carry);
      const t = integrateTrajectory(L, STILL_AIR_ENV);
      const roll = rolloutYd(t.landSpeedMps, t.descentDeg, firmness, STILL_AIR_ENV.gravity);
      const next = clamp(D - roll, 0.55 * D, D);
      if (Math.abs(next - carry) < 0.05) { carry = next; break; }
      carry = next;
    }
    return carry;
  }

  /**
   * SIGNATURE PRESERVED: logShot(clubId, distanceYd, baselineYd) -> boolean.
   * Extra optional args are additive and safe to omit.
   */
  function logShot(clubId, distanceYd, baselineYd, lateralYd, gpsAccM) {
    const dist = Number(distanceYd);
    if (!clubId || !Number.isFinite(dist) || dist <= 0 || dist > 400) return false;
    const base = num(baselineYd, 0);
    if (base > 0 && (dist < base * SHOT_SANITY_LO || dist > base * SHOT_SANITY_HI)) return false;
    const log = loadShotLog();
    const arr = log[clubId] || (log[clubId] = []);
    arr.push({
      d: Math.round(dist * 10) / 10,
      c: Math.round(estimateCarryFromTotal(dist) * 10) / 10,
      l: Number.isFinite(lateralYd) ? Math.round(lateralYd * 10) / 10 : null,
      t: Date.now(),
      a: Number.isFinite(gpsAccM) ? Math.round(gpsAccM * 10) / 10 : null,
    });
    if (arr.length > SHOT_MAX_PER_CLUB) log[clubId] = arr.slice(-SHOT_MAX_PER_CLUB);
    saveShotLog(log);
    return true;
  }

  // SIGNATURE PRESERVED.
  function shotDataSummary() {
    const log = loadShotLog();
    let total = 0, clubs = 0;
    for (const k of Object.keys(log)) {
      const n = (log[k] || []).map(normalizeShotEntry).filter(Boolean).length;
      if (n > 0) { total += n; clubs += 1; }
    }
    return { total, clubs };
  }
  function clearShotData() { try { localStorage.removeItem(SHOTLOG_KEY); } catch { } }

  function priorRelSigma(carryYd) {
    const t = smoothstep(DISP_REL_KNEE_LO, DISP_REL_KNEE_HI, num(carryYd, 150));
    return (DISP_REL_SHORT + t * (DISP_REL_LONG - DISP_REL_SHORT)) * DISP_AMATEUR_MULT;
  }

  // SIGNATURE PRESERVED. formulaDispersionYd(carry) -> prior ±band in yards.
  function formulaDispersionYd(carry) {
    const c = num(carry, 0);
    if (c <= 0) return 0;
    const z = invNorm(0.5 + DISPERSION_COVERAGE / 2);
    return Math.max(DISP_FLOOR_YD, Math.round(z * priorRelSigma(c) * c));
  }

  /**
   * SIGNATURE PRESERVED: clubStats(clubId) -> { mean, stdev, n } (+ many extras).
   * Now a Normal–Inverse-Gamma posterior over (carry mean, carry σ) with exponential
   * recency weighting and robust pre-screening. mean/stdev keep their old meaning
   * (null when insufficient data) so existing callers are unaffected.
   * Conjugate NIG update: Gelman et al., Bayesian Data Analysis 3rd ed. §3.3.
   */
  function clubStatsUncached(clubId, opts = {}) {
    const log = loadShotLog();
    const raw = (log[clubId] || []).map(normalizeShotEntry).filter(Boolean);
    const club = state.clubs.find((c) => c.id === clubId);
    const stock = club ? num(club.yards, 0) : 0;
    const empty = {
      mean: null, stdev: null, n: 0, nEff: 0, sigmaPrior: null, sigmaPost: null,
      meanTotal: null, lateralSigma: null, ciLo: null, ciHi: null, trend: null, source: 'none'
    };
    if (!raw.length) {
      if (stock > 0) {
        empty.sigmaPrior = priorRelSigma(stock) * stock;
        empty.sigmaPost = empty.sigmaPrior;
        empty.source = 'prior';
      }
      return empty;
    }
    const now = Date.now();
    const HL = DISP_HALFLIFE_DAYS * 86400000;
    // Carry values (fall back to a modelled carry for legacy total-only entries).
    const vals = raw.map((e) => (Number.isFinite(e.c) ? e.c : estimateCarryFromTotal(e.d)));
    // Robust pre-screen at 3× MAD around the median; keeps a single shank from wrecking σ.
    const med = median(vals);
    const mad = madSigma(vals) || Math.max(DISP_FLOOR_YD, 0.05 * (stock || med));
    const keep = vals.map((v) => Math.abs(v - med) <= 3 * mad);
    const wts = raw.map((e, i) => {
      if (!keep[i]) return 0;
      const age = Number.isFinite(e.t) ? Math.max(0, now - e.t) : HL;   // undated legacy shots get one half-life of age
      let w = Math.pow(0.5, age / HL);
      if (Number.isFinite(e.a) && e.a > 0) w *= 1 / (1 + (e.a / ROUND_GPS_OK_M) ** 2); // down-weight sloppy fixes
      return w;
    });
    const mom = weightedMoments(vals, wts);
    const n = vals.filter((_, i) => keep[i]).length;
    const nEff = mom.nEff;

    // NIG prior: μ₀ = stock number, σ₀ from the skill model, ν₀ = DISP_PRIOR_STRENGTH.
    const mu0 = stock > 0 ? stock : mom.mean;
    const sigPrior = priorRelSigma(mu0) * mu0;
    const nu0 = DISP_PRIOR_STRENGTH;
    const kappa0 = 2;                                     // weak prior on the mean: worth 2 observations
    const sampleVar = Number.isFinite(mom.variance) ? mom.variance : sigPrior * sigPrior;
    // Posterior scale for σ (mode of the inverse-gamma marginal).
    const nuN = nu0 + nEff;
    const ss = nu0 * sigPrior * sigPrior + Math.max(0, nEff - 1) * sampleVar +
      (kappa0 * nEff / (kappa0 + nEff)) * (mom.mean - mu0) ** 2;
    const sigmaPost = Math.sqrt(Math.max(DISP_FLOOR_YD * DISP_FLOOR_YD / 4, ss / Math.max(1, nuN)));
    const meanPost = (kappa0 * mu0 + nEff * mom.mean) / (kappa0 + nEff);

    // Posterior predictive interval for the MEAN (what to set club.yards to).
    const seMean = sigmaPost / Math.sqrt(kappa0 + nEff);
    const tq = tQuantile(0.975, Math.max(1, nuN));
    // Lateral dispersion.
    const lats = raw.map((e) => e.l).filter((x) => Number.isFinite(x));
    const latSig = lats.length >= 3
      ? Math.max(madSigma(lats) || 0, Math.sqrt(weightedMoments(lats, lats.map(() => 1)).variance || 0))
      : LATERAL_REL_PRIOR * (mu0 || 150);
    // Distance trend over time (yd per 30 days) — is the player gaining or losing speed?
    // Cap the Theil-Sen input: it is O(n²) and 60 recent shots already resolve a trend.
    const dated = raw.map((e, i) => ({ e, v: vals[i] }))
      .filter((o) => Number.isFinite(o.e.t)).slice(-TREND_MAX_SHOTS);
    const trend = dated.length >= 5
      ? (theilSen(dated.map((o) => o.e.t / 86400000), dated.map((o) => o.v)) || {}).slope
      : null;

    // Legacy-compatible fields: only expose mean/stdev once there is real data.
    const legacyMean = n >= 1 ? mom.mean : null;
    const legacyStd = n >= 2 && Number.isFinite(sampleVar)
      ? Math.sqrt(sampleVar) / c4(Math.max(2, Math.round(nEff)))   // bias-corrected sample SD
      : null;

    return {
      mean: legacyMean, stdev: legacyStd, n,
      nEff, meanPost, sigmaPost, sigmaPrior: sigPrior,
      meanTotal: raw.length ? weightedMoments(raw.map((e) => e.d), wts).mean : null,
      lateralSigma: latSig,
      ciLo: meanPost - tq * seMean, ciHi: meanPost + tq * seMean,
      trendYdPer30d: Number.isFinite(trend) ? trend * 30 : null,
      source: n >= SHOT_MIN_TRUST_N ? 'posterior' : 'prior-dominated',
    };
  }

  /**
   * SIGNATURE PRESERVED: clubDispersionYd(club) -> ± band in yards.
   * Now the posterior-predictive half-width at DISPERSION_COVERAGE, which shrinks
   * smoothly and automatically as evidence accumulates. No hand-tuned blend.
   */
  function clubDispersionYd(club) {
    if (!club) return 0;
    const carry = num(club.yards, 0);
    if (carry <= 0) return 0;
    const st = clubStats(club.id);
    const sig = Number.isFinite(st.sigmaPost) ? st.sigmaPost : priorRelSigma(carry) * carry;
    const nu = DISP_PRIOR_STRENGTH + (st.nEff || 0);
    // Predictive spread includes uncertainty in the mean itself.
    const predSig = sig * Math.sqrt(1 + 1 / (2 + (st.nEff || 0)));
    const q = tQuantile(0.5 + DISPERSION_COVERAGE / 2, Math.max(1, nu));
    return Math.max(DISP_FLOOR_YD, Math.round(q * predSig));
  }
  // Raw σ accessors used by the strategy engine.
  function clubSigmaDistYd(club) {
    if (!club) return 0;
    const st = clubStats(club.id);
    return Number.isFinite(st.sigmaPost) ? st.sigmaPost : priorRelSigma(num(club.yards, 150)) * num(club.yards, 150);
  }
  function clubSigmaLatYd(club) {
    if (!club) return 0;
    const st = clubStats(club.id);
    return Number.isFinite(st.lateralSigma) ? st.lateralSigma : LATERAL_REL_PRIOR * num(club.yards, 150);
  }

  // Signed lateral bias (yd, + = right of intended line) for a club with
  // enough samples to trust. Robust: median of recorded offsets.
  function clubLateralBiasYd(clubId) {
    const log = loadShotLog();
    const vals = (log[clubId] || [])
      .map(normalizeShotEntry)
      .filter((e) => e && Number.isFinite(e.l))
      .map((e) => e.l);
    if (vals.length < MISS_BIAS_MIN_N) return null;
    return median(vals);
  }

  // ============================================================
  //  PATCH A — MEMOIZATION LAYER FOR THE SHOT MODEL
  //  Overrides: loadShotLog, saveShotLog, clearShotData,
  //             estimateCarryFromTotal.  Adds: clubStats wrapper.
  //  clubStats is on the hot path ~216x per recalculation; without this
  //  every call re-parses localStorage and re-runs an O(n²) regression.
  // ============================================================

  const TREND_MAX_SHOTS = 60;       // cap on Theil-Sen input; O(n²) cost vs negligible extra trend resolution
  const CARRY_MEMO_BINS = 2;        // memo bins per yard for the total→carry inversion (0.5 yd resolution)
  const CARRY_MEMO_MAX = 512;       // bounded memo; shot distances span at most ~400 yd

  let _shotLogCache = null;
  let _shotLogVersion = 0;
  const _clubStatsCache = new Map();
  const _carryMemo = new Map();

  function loadShotLog() {
    if (_shotLogCache) return _shotLogCache;
    const v = load(SHOTLOG_KEY, {});
    _shotLogCache = sanitizeShotLog(v);
    return _shotLogCache;
  }
  function saveShotLog(log) {
    save(SHOTLOG_KEY, log);
    _shotLogCache = log;
    _shotLogVersion++;
    _clubStatsCache.clear();
  }
  function clearShotData() {
    try { localStorage.removeItem(SHOTLOG_KEY); } catch { }
    _shotLogCache = null;
    _shotLogVersion++;
    _clubStatsCache.clear();
  }

  // Memoized: the inversion runs up to 6 trajectory integrations per distinct distance.
  function estimateCarryFromTotal(totalYd, firmness = 'medium') {
    const D = Math.max(0, num(totalYd, 0));
    if (D < 15) return D;
    const key = firmness + '|' + Math.round(D * CARRY_MEMO_BINS);
    const hit = _carryMemo.get(key);
    if (hit !== undefined) return hit;
    let carry = D * 0.94;
    for (let i = 0; i < 6; i++) {
      const L = launchForStandardCarry(carry);
      const t = integrateTrajectory(L, STILL_AIR_ENV);
      const roll = rolloutYd(t.landSpeedMps, t.descentDeg, firmness, STILL_AIR_ENV.gravity);
      const next = clamp(D - roll, 0.55 * D, D);
      if (Math.abs(next - carry) < 0.05) { carry = next; break; }
      carry = next;
    }
    if (_carryMemo.size > CARRY_MEMO_MAX) _carryMemo.clear();
    _carryMemo.set(key, carry);
    return carry;
  }

  // SIGNATURE PRESERVED. Cache key folds in the club's stock yardage because the
  // NIG prior is centred on it — editing a club invalidates its entry automatically.
  function clubStats(clubId, opts) {
    if (opts && Object.keys(opts).length) return clubStatsUncached(clubId, opts);
    const club = state.clubs.find((c) => c.id === clubId);
    const key = clubId + '|' + _shotLogVersion + '|' + (club ? num(club.yards, 0) : 0);
    const hit = _clubStatsCache.get(key);
    if (hit) return hit;
    const out = clubStatsUncached(clubId, opts);
    _clubStatsCache.set(key, out);
    return out;
  }
  // ============================================================
  //  BLOCK 8 — EXPECTED STROKES + DECISION THEORY
  //  Replaces: recommendClub, recommendSmart, selectedClubGuidance
  // ============================================================

  // PGA Tour expected-strokes baselines. Distances in yards except putting (feet).
  // Source: M. Broadie, Every Shot Counts (2014), Tour baseline tables; and
  // M. Broadie, "Assessing Golfer Performance on the PGA TOUR", Interfaces 42 (2012) 146.
  const ES_X_FAIRWAY = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300];
  const ES_Y_FAIRWAY = [2.18, 2.40, 2.52, 2.60, 2.66, 2.70, 2.72, 2.75, 2.77, 2.80, 2.85, 2.91, 2.98, 3.08, 3.19, 3.32, 3.45, 3.58, 3.70, 3.82]; // fairway baseline — Broadie (2014)
  const ES_Y_ROUGH = [2.34, 2.59, 2.70, 2.78, 2.84, 2.88, 2.91, 2.93, 2.96, 2.98, 3.04, 3.10, 3.17, 3.26, 3.36, 3.47, 3.58, 3.68, 3.78, 3.88]; // rough baseline — Broadie (2014)
  const ES_Y_SAND = [2.43, 2.53, 2.66, 2.82, 2.92, 2.99, 3.03, 3.05, 3.07, 3.10, 3.14, 3.19, 3.25, 3.32, 3.42, 3.53, 3.64, 3.74, 3.84, 3.94]; // sand baseline — Broadie (2014)
  const ES_Y_RECOV = [2.95, 3.05, 3.10, 3.15, 3.20, 3.25, 3.30, 3.35, 3.40, 3.45, 3.51, 3.57, 3.63, 3.69, 3.76, 3.83, 3.90, 3.97, 4.04, 4.11]; // recovery baseline — Broadie (2014)
  const ES_X_GREEN_FT = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100];
  const ES_Y_GREEN = [1.001, 1.009, 1.053, 1.147, 1.256, 1.357, 1.443, 1.515, 1.575, 1.626, 1.702, 1.784,
    1.874, 1.936, 1.985, 2.026, 2.064, 2.098, 2.127, 2.182, 2.231, 2.267, 2.298, 2.324];   // putting baseline — Broadie (2014)
  const ES_PENALTY_STROKES = 1.0;   // one-stroke penalty for a water/OB drop — Rules of Golf 17.1d / 18.2
  // Amateur scaling. Broadie's baselines are Tour; a mid handicap is worse everywhere, but
  // decisions depend on DIFFERENCES, which scale roughly with the player's relative dispersion.
  const ES_AMATEUR_PENALTY_MULT = 1.25; // inflation of off-green penalties for a non-tour short game — Broadie (2014) ch.6 amateur comparisons

  const _esFair = pchip(ES_X_FAIRWAY, ES_Y_FAIRWAY);
  const _esRough = pchip(ES_X_FAIRWAY, ES_Y_ROUGH);
  const _esSand = pchip(ES_X_FAIRWAY, ES_Y_SAND);
  const _esRecov = pchip(ES_X_FAIRWAY, ES_Y_RECOV);
  const _esGreen = pchip(ES_X_GREEN_FT, ES_Y_GREEN);

  function expectedStrokes(lie, distYd) {
    const d = Math.max(0, num(distYd, 0));
    if (lie === 'green') return clamp(_esGreen(clamp(d * 3, 0.5, 110)), 1, 3.2);
    if (d < 1) return 1.0;
    const f = (fn, floor) => clamp(fn(clamp(d, 5, 320)), floor, 5.2);
    switch (lie) {
      case 'rough': return f(_esRough, 2.1);
      case 'sand': return f(_esSand, 2.2);
      case 'recovery': return f(_esRecov, 2.6);
      case 'penalty': return f(_esFair, 2.0) + ES_PENALTY_STROKES * ES_AMATEUR_PENALTY_MULT;
      default: return f(_esFair, 2.0);
    }
  }
  // Distance in yards from a landing point back to the hole, given the pin is at pinAlong
  // along the shot line, and the shot finished at (along, lateral) relative to the ball.
  const distToPin = (along, lateral, pinAlong) => hypot2(pinAlong - along, lateral);

  /**
   * Classify a finish point into a lie, using whatever green geometry we actually have.
   * geo: { front, center, back, depth, widthYd, axisBearing } — see Block 9.
   * All distances measured along/across the shot line, in yards from the player.
   */
  const GREEN_FRINGE_YD = 3;        // apron/fringe collar depth around a green, yd — typical USGA maintenance practice
  const GREEN_WIDTH_TO_DEPTH = 1.15; // median green is slightly wider than deep — USGA Green Section green-sizing guidance (median ≈6,000 ft²)
  const GREEN_MIN_HALF_WIDTH_YD = 8; // floor on the modelled half-width when depth is unknown
  function classifyLie(along, lateral, geo, opts = {}) {
    const surround = opts.surround || 'rough';
    if (!geo || geo.front == null || geo.back == null) {
      // No green model: treat "close to the aim point" as green, else the surround.
      const tgt = num(opts.targetAlong, NaN);
      if (Number.isFinite(tgt) && hypot2(along - tgt, lateral) < 12) return 'green';
      return surround;
    }
    const halfW = Math.max(GREEN_MIN_HALF_WIDTH_YD,
      0.5 * (Number.isFinite(geo.widthYd) ? geo.widthYd : GREEN_WIDTH_TO_DEPTH * geo.depth));
    const inDepth = along >= geo.front && along <= geo.back;
    const inWidth = Math.abs(lateral - num(geo.centerLateral, 0)) <= halfW;
    if (inDepth && inWidth) return 'green';
    const nearDepth = along >= geo.front - GREEN_FRINGE_YD && along <= geo.back + GREEN_FRINGE_YD;
    const nearWidth = Math.abs(lateral - num(geo.centerLateral, 0)) <= halfW + GREEN_FRINGE_YD;
    if (nearDepth && nearWidth) return 'green';    // fringe putts as green in the baselines
    return surround;
  }

  /**
   * Expected strokes for playing `club` at a shot whose plays-like requirement is
   * playsTarget, with the pin at pinPlays plays-like yards. Integrates the 2-D outcome
   * distribution on a 9x9 Gauss-Legendre product rule over the normal factors.
   */
  function clubExpectedStrokes(club, playsTarget, pinPlays, geo, opts = {}) {
    if (!club) return { es: Infinity, pGreen: 0, pShort: 0, pLong: 0, pTrouble: 0 };
    const mu = num(club.yards, 0);
    if (mu <= 0) return { es: Infinity, pGreen: 0, pShort: 0, pLong: 0, pTrouble: 0 };
    const effort = num(opts.effort, 1);                 // 1 = stock; <1 = smooth; >1 = firm
    const muEff = mu * effort;
    // Taking speed off tightens distance a little but costs strike quality; firming up
    // widens both. Empirically σ scales sub-linearly with effort.
    const sigD = clubSigmaDistYd(club) * (0.82 + 0.18 * effort) * Math.max(0.85, effort);
    const sigL = clubSigmaLatYd(club) * Math.max(0.85, effort) * (mu > 0 ? muEff / mu : 1);
    // Convert plays-like requirement back into the along-line frame: the club's plays-like
    // capability is muEff, and the pin sits pinPlays away in the same units.
    const nodes = NORM_NODES;
    let es = 0, pGreen = 0, pShort = 0, pLong = 0, pTrouble = 0;
    for (let i = 0; i < nodes.zs.length; i++) {
      const along = muEff + nodes.zs[i] * sigD;
      for (let j = 0; j < nodes.zs.length; j++) {
        const lateral = nodes.zs[j] * sigL + num(opts.aimLateral, 0);
        const w = nodes.ws[i] * nodes.ws[j];
        const lie = classifyLie(along, lateral, geo, { surround: opts.surround, targetAlong: playsTarget });
        const dPin = distToPin(along, lateral, pinPlays);
        es += w * expectedStrokes(lie, dPin);
        if (lie === 'green') pGreen += w;
        else {
          pTrouble += w;
          if (geo && geo.front != null && along < geo.front) pShort += w;
          else if (geo && geo.back != null && along > geo.back) pLong += w;
        }
      }
    }
    return { es, pGreen, pShort, pLong, pTrouble, muEff, sigD, sigL };
  }

  /**
   * SIGNATURE PRESERVED: recommendClub(playsYd) -> { main, sub }.
   * Geometry-free path. Now chooses by minimizing expected strokes against a generic
   * green centred on the target, with the player's own dispersion, and reports the
   * effort level that minimizes it rather than a fixed "take the longer club" heuristic.
   */
  const GENERIC_GREEN_DEPTH_YD = 30;  // median depth of a modern green, yd — USGA Green Section green-sizing guidance
  const EFFORT_LEVELS = [0.88, 0.94, 1.0, 1.06];  // smooth / easy / stock / firm — the four swings most players actually own
  const EFFORT_NAMES = ['smooth', 'easy', 'stock', 'firm'];
  const ES_TIE_THRESHOLD = 0.008;     // strokes; below this two options are indistinguishable given model error

  function recommendClub(playsYd) {
    playsYd = Math.max(0, num(playsYd, 0));
    const asc = sortedClubsAsc(), desc = sortedClubsDesc();
    if (!asc.length)
      return { main: 'Add clubs', sub: 'Go to Clubs and add your stock carry distances.' };
    const shortest = asc[0], longest = desc[0];

    if (playsYd <= 3) return { main: 'No full shot needed', sub: 'Tap-in or tiny chip — 0–3 yards.' };
    if (playsYd < 20) return { main: 'Putt / chip', sub: 'Very close. Use feel; no full swing.' };

    // Generic green centred on the target so short/long misses are penalized symmetrically.
    const geo = {
      front: playsYd - GENERIC_GREEN_DEPTH_YD / 2,
      back: playsYd + GENERIC_GREEN_DEPTH_YD / 2,
      depth: GENERIC_GREEN_DEPTH_YD,
      widthYd: GENERIC_GREEN_DEPTH_YD * GREEN_WIDTH_TO_DEPTH,
      centerLateral: 0,
    };
    let best = null;
    for (const c of desc) {
      for (let k = 0; k < EFFORT_LEVELS.length; k++) {
        const eff = EFFORT_LEVELS[k];
        const r = clubExpectedStrokes(c, playsYd, playsYd, geo, { effort: eff, surround: 'rough' });
        // Penalize efforts outside the stock swing slightly: they are harder to repeat
        // than the dispersion model alone implies.
        const penalty = Math.abs(eff - 1) * 0.02;
        const score = r.es + penalty;
        if (!best || score < best.score - 1e-9)
          best = { club: c, eff, effName: EFFORT_NAMES[k], score, ...r };
      }
    }
    if (!best) return { main: 'Add clubs', sub: 'Go to Clubs and add your stock carry distances.' };

    // Genuinely out of range?
    if (playsYd > longest.yards * 1.08) {
      const gap = Math.round(playsYd - longest.yards);
      return {
        main: 'Lay up',
        sub: `${gap} yd beyond your ${longest.yards} yd ${longest.name}. Lay up to a full-wedge number (${Math.max(
          40, Math.round(playsYd - shortest.yards))} yd carry leaves ${shortest.name}).`,
      };
    }
    if (playsYd < shortest.yards * 0.55) {
      const pct = clamp(Math.round((playsYd / shortest.yards) * 100), 30, 95);
      return {
        main: `${shortest.name} · ${pct}%`,
        sub: `Partial wedge — control it with swing length, not deceleration. Stock ${shortest.name} is ${shortest.yards} yd.`,
      };
    }

    const c = best.club;
    const delta = Math.round(c.yards * best.eff - playsYd);
    const label = best.eff === 1 ? `${c.name} stock` : `${c.name} ${best.effName}`;
    // Runner-up margin tells the player how much the choice actually matters.
    let runner = null;
    for (const o of desc) {
      if (o.id === c.id) continue;
      const r = clubExpectedStrokes(o, playsYd, playsYd, geo, { effort: 1, surround: 'rough' });
      if (!runner || r.es < runner.es) runner = { club: o, es: r.es };
    }
    const margin = runner ? runner.es - best.es : 0;
    const bits = [];
    bits.push(`Stock ${c.name} ${c.yards} yd vs ${fmt(playsYd)} yd plays-like (${delta >= 0 ? '+' : ''}${delta}).`);
    bits.push(`${Math.round(best.pGreen * 100)}% green, E[strokes] ${fmt(best.es, 2)}.`);
    if (runner && margin < ES_TIE_THRESHOLD)
      bits.push(`${runner.club.name} is statistically identical — take the one you trust.`);
    else if (runner)
      bits.push(`Next best ${runner.club.name} costs ${fmt(margin, 2)} strokes.`);
    return { main: label, sub: bits.join(' ') };
  }

  /**
   * SIGNATURE PRESERVED: recommendSmart(playsTarget, geo, bearing, accYd)
   *   -> { main, sub, verdict, tips }
   * Full geometry-aware optimizer. Verdict now comes from the expected-strokes surface
   * and the probability of trouble, not from a ±2 yd edge comparison.
   */
  const VERDICT_GO_PGREEN = 0.55;      // ≥55% green with the best club => commit
  const VERDICT_BAIL_PGREEN = 0.22;    // <22% green with the best club => the target itself is wrong
  const VERDICT_BAIL_ES = 3.35;        // expected strokes above which the shot is not worth attempting as aimed
  /* ---- Hazard cost model (strokes) ---- */
  const HAZ_WATER_PENALTY = 1.8;   // ≈ stroke-and-dropped: penalty + replay distance
  const HAZ_BUNKER_PENALTY = 0.55; // typical bunker recovery vs adjacent grass
  const HAZ_HALF_WIDTH_YD = 7;     // modeled half-width of a mapped hazard
  const HAZ_CLEAR_MARGIN_YD = 4;   // carry margin demanded over water before "clear"

  // Expected stroke cost of the hazard field for one sampled landing point.
  // Landed SHORT of the hazard = failed carry → full penalty if on its line.
  // Landed AT the hazard = in it (full) or graded proximity beside it.
  // Landed WELL PAST = cleanly carried → free.
  function hazardCostStrokes(along, lateral, hazards) {
    let cost = 0;
    for (const h of hazards) {
      const pen = h.type === 'water' ? HAZ_WATER_PENALTY : HAZ_BUNKER_PENALTY;
      const dCross = Math.abs(lateral - h.crossYd);
      const dAlong = along - h.alongYd; // + = past the hazard
      if (dAlong < -HAZ_CLEAR_MARGIN_YD) {
        // Short of the hazard: it had to be carried, and wasn't.
        if (dCross < HAZ_HALF_WIDTH_YD) cost += pen;
      } else if (Math.abs(dAlong) <= HAZ_HALF_WIDTH_YD + 6) {
        // At the hazard: in it, or close enough to cost recovery strokes.
        const edge = dCross - HAZ_HALF_WIDTH_YD;
        if (edge < 0) cost += pen;
        else if (edge < 10) cost += pen * (1 - edge / 10) * 0.5;
      }
      // else: cleanly carried — no cost.
    }
    return cost;
  }

  function recommendSmart(playsTarget, geo, bearing, accYd, opts = {}) {
    const asc = sortedClubsAsc();
    const desc = sortedClubsDesc();
    const strokeIndex = Number(opts.strokeIndex) || null;

    if (!asc.length) {
      return {
        main: 'Add clubs',
        sub: 'Add your carry distances in the Clubs tab.',
        verdict: 'neutral',
        tips: [],
      };
    }

    /*
     * Important:
     * The selected map target is always the shot target.
     *
     * FCB describes the green around that target. It must never silently
     * replace the selected target with green center.
     */
    const pinPlays = playsTarget;

    // Convert FCB's actual along-line distances into the same approximate
    // plays-like scale used for club selection.
    const rawTargetYd = Math.max(
      1,
      state.lastCalc && Number.isFinite(state.lastCalc.horizontalYd)
        ? state.lastCalc.horizontalYd
        : haversineMeters(state.loc, state.target) * M_TO_YD
    );

    const playsScale = playsTarget / rawTargetYd;

    const frontRaw =
      geo && Number.isFinite(geo.frontAlong)
        ? geo.frontAlong
        : geo && Number.isFinite(geo.front)
          ? geo.front
          : null;

    const backRaw =
      geo && Number.isFinite(geo.backAlong)
        ? geo.backAlong
        : geo && Number.isFinite(geo.back)
          ? geo.back
          : null;

    // Green model remains aligned to the selected target line.
    // Sorting prevents accidental Front/Back placement order from breaking it.
    const model =
      Number.isFinite(frontRaw) && Number.isFinite(backRaw)
        ? {
          front: Math.min(frontRaw, backRaw) * playsScale,
          back: Math.max(frontRaw, backRaw) * playsScale,
          depth:
            Math.abs(backRaw - frontRaw) * playsScale || 4,
          widthYd: Number.isFinite(geo.widthYd)
            ? geo.widthYd
            : GREEN_WIDTH_TO_DEPTH *
            Math.max(4, Math.abs(backRaw - frontRaw) * playsScale),
          centerLateral: num(geo.centerLateral, 0),
        }
        : null;

    /* ---- Hazard-aware optimization ----
       Imported water/bunkers projected onto THIS line now price directly
       into the club decision: every candidate is re-scored over the same
       Gauss–Hermite landing samples with the expected hazard cost added,
       and the optimizer also scans lateral aim shifts to find the line
       that plays cheapest against the trouble. */
    const haz = Array.isArray(opts.hazards) ? opts.hazards : hazardsOnLine();
    const scan = haz.length ? [-12, -6, 0, 6, 12] : [0];

    let best = null, alternatives = [];
    for (const c of desc) {
      for (let k = 0; k < EFFORT_LEVELS.length; k++) {
        const eff = EFFORT_LEVELS[k];
        for (const aim of scan) {
          const r = clubExpectedStrokes(c, playsTarget, pinPlays, model, {
            effort: eff, surround: 'rough', aimLateral: aim,
          });
          // Re-sample the same quadrature nodes with hazard cost folded in,
          // so the expectation stays exact rather than bolted on after.
          let hz = 0;
          if (haz.length && Number.isFinite(r.muEff)) {
            const nodes = NORM_NODES;
            for (let i = 0; i < nodes.zs.length; i++) {
              const along = r.muEff + nodes.zs[i] * r.sigD;
              for (let j = 0; j < nodes.zs.length; j++) {
                const lateral = nodes.zs[j] * r.sigL + aim;
                hz += nodes.ws[i] * nodes.ws[j] * hazardCostStrokes(along, lateral, haz);
              }
            }
          }
          const score = r.es + hz + Math.abs(eff - 1) * 0.02 + Math.abs(aim) * 0.0015;
          const cand = { club: c, eff, effName: EFFORT_NAMES[k], score, aimLateral: aim, hz, ...r };
          alternatives.push(cand);
          if (!best || score < best.score - 1e-9) best = cand;
        }
      }
    }
    alternatives.sort((a, b) => a.score - b.score);
    const tips = [];
    let verdict = 'neutral';
    if (!best) {
      return {
        main: 'No recommendation',
        sub: 'Add carry distances in the Clubs tab.',
        verdict,
        tips,
      };
    }

    const c = best.club;
    const main = best.eff === 1 ? `${c.name} stock` : `${c.name} ${best.effName}`;
    const pG = best.pGreen;

    if (pG >= VERDICT_GO_PGREEN) {
      verdict = 'go';
      tips.push(`🟢 Green light — ${c.name} holds this green ${Math.round(pG * 100)}% of the time from your pattern. Commit and fire.`);
    } else if (pG < VERDICT_BAIL_PGREEN || best.es > VERDICT_BAIL_ES) {
      verdict = 'bail';
      tips.push(`🔴 Low-percentage shot — only ~${Math.round(pG * 100)}% of your pattern finds this green (E[strokes] ${fmt(best.es, 2)}). Play to the fat part or lay back.`);
    } else {
      verdict = 'manage';
      tips.push(`🟡 Manageable but not free — ~${Math.round(pG * 100)}% green with ${c.name}. Smooth swing, favour the miss you can live with.`);
    }

    // Hardest-third stroke index: keep the commitment but soften the target line.
    if (best && haz.length && Math.abs(best.aimLateral || 0) >= 3) {
      const side = best.aimLateral > 0 ? 'right' : 'left';
      const kind = haz.some((h) => h.type === 'water') ? 'the water' : 'the trouble';
      tips.unshift(
        `Aim ${Math.abs(Math.round(best.aimLateral))} yd ${side} of your target — against ${kind}, that line saves about ${fmt(best.hz, 2)} strokes.`
      );
    }
    if (strokeIndex && strokeIndex <= 6) {
      tips.push(
        `#${strokeIndex} handicap hole — the numbers say commit, but favour the fat side of the green over any corner pin.`
      );
    }

    // Which miss is actually costly? Compare conditional expected strokes short vs long.
    if (model) {
      if (best.pLong > best.pShort * 1.6 && best.pLong > 0.12)
        tips.push(`Your bad miss here is long (${Math.round(best.pLong * 100)}% vs ${Math.round(best.pShort * 100)}% short). Take the club that can't fly the back.`);
      else if (best.pShort > best.pLong * 1.6 && best.pShort > 0.12)
        tips.push(`Your bad miss here is short (${Math.round(best.pShort * 100)}% vs ${Math.round(best.pLong * 100)}% long) — most amateurs under-club; add one.`);
      const depth = Math.round(model.depth);
      if (depth >= 26) tips.push(`Deep green (~${depth} yd playing depth) — plenty of room, be aggressive at the number.`);
      else if (depth <= 14) tips.push(`Shallow green (~${depth} yd playing depth) — distance control decides this shot, not line.`);
    }

    // Is a different club materially better, or is this a coin flip?
    const distinct = alternatives.filter((a, i) =>
      alternatives.findIndex((b) => b.club.id === a.club.id) === i).slice(0, 3);
    if (distinct.length > 1) {
      const m = distinct[1].score - distinct[0].score;
      if (m < ES_TIE_THRESHOLD)
        tips.push(`${distinct[0].club.name} and ${distinct[1].club.name} are statistically tied — pick the one you'd rather hit.`);
      else if (m > 0.06)
        tips.push(`${c.name} is clearly right here — ${distinct[1].club.name} costs about ${fmt(m, 2)} strokes.`);
    }

    // Where the target sits relative to the green.
    if (model && playsTarget < model.front - 4) {
      tips.push(
        `Your selected target is about ${Math.round(
          model.front - playsTarget
        )} yd short of the green front. This is treated as an intentional layup target.`
      );
    }

    if (model && playsTarget > model.back + 4) {
      tips.push(
        `Your selected target is about ${Math.round(
          playsTarget - model.back
        )} yd beyond the green back. Move the target onto the green unless that is intentional.`
      );
    }

    // GPS uncertainty folded into the decision, not just warned about.
    if (accYd > ACCURACY_WARN_YD) {
      const sigTot = Math.hypot(clubSigmaDistYd(c), accYd / RAYLEIGH_95);
      tips.push(`GPS is ±${fmt(accYd)} yd — that inflates your effective distance spread to ±${fmt(sigTot * 1.5)} yd. Favour the middle.`);
    }

    const sub =
      best.eff === 1
        ? `${Math.round(pG * 100)}% green chance.`
        : `${Math.round(pG * 100)}% green chance with a ${best.effName} swing.`;

    return {
      main,
      sub,
      verdict,
      tips,

      pGreen: pG,
      expectedStrokes: best.es,
      club: c,
      effort: best.eff,
      effortName: best.effName,
    };          // <-- this closes the object literal
  }           // <-- ADD THIS: closes recommendSmart()
  /**
     * SIGNATURE PRESERVED: selectedClubGuidance(playsYd) -> string.
     ...
     */
  function selectedClubGuidance(playsYd) {
    const club = state.clubs.find((c) => c.id === state.prefs.selectedClubId);
    if (!club || !Number.isFinite(playsYd)) return '';
    const mu = num(club.yards, 0);
    if (mu <= 0) return '';
    const sig = Math.max(1, clubSigmaDistYd(club));
    const pCover = 1 - normCdf((playsYd - mu) / sig);   // P(carry >= required)
    const d = mu - playsYd;
    const effort = playsYd / mu;
    const pct = Math.round(pCover * 100);

    let head;
    if (Math.abs(d) <= 0.35 * sig) head = `${club.name}: stock`;
    else if (d > 0 && effort >= 0.90) head = `${club.name}: easy (${Math.round(effort * 100)}%)`;
    else if (d > 0) head = `${club.name}: too much — ${fmt(d)} yd long`;
    else if (effort <= 1.06) head = `${club.name}: firm (${Math.round(effort * 100)}%)`;
    else head = `${club.name}: not enough — ${fmt(-d)} yd short`;

    return `${head} · ${pct}% chance of covering ${fmt(playsYd)} yd`;
  }

  // ============================================================
  //  BLOCK 9 — GREEN GEOMETRY
  //  Replaces: LEFTOVER_HIDE_YD, OVERSHOOT_TOL_YD,
  //            leftoverToGreen, formatLeftover, greenGeometry
  // ============================================================

  const LEFTOVER_HIDE_YD = 3;        // below this, leg 2 is degenerate — hide it
  const OVERSHOOT_TOL_YD = 3;        // legacy name kept; superseded by the statistical test below
  const GREEN_AXIS_MIN_YD = 6;       // front/back closer than this cannot define a reliable axis
  const GREEN_ASPECT_DEFAULT = 1.15; // median green is slightly wider than deep — USGA Green Section green-sizing guidance
  const GREEN_WIDTH_MIN_YD = 16;     // floor on modelled green width, yd — smallest common championship green
  const GREEN_WIDTH_MAX_YD = 55;     // ceiling on modelled green width, yd — very large double green

  /**
   * SIGNATURE PRESERVED: leftoverToGreen(user, aim, green)
   * -> { yards, state, lateralYd }
   *
   * `yards` is the ALONG-TRACK offset between the aim point and the green
   * middle (projected onto your shot line) — NOT the straight-line separation.
   *
   * The old version used the crow-flies distance while the aim chip used the
   * along-line projection, so the label ("52 yd past middle") and the chip
   * ("Aim: 50 yd past middle") disagreed whenever the middle sat even slightly
   * beside your aim line. Every surface now reads this one function and can
   * never disagree again.
   */
  function leftoverToGreen(user, aim, green) {
    if (!user || !aim || !green) return null;

    const aimToGreenYd = haversineMeters(aim, green) * M_TO_YD;
    if (aimToGreenYd < LEFTOVER_HIDE_YD)
      return { yards: 0, lateralYd: 0, state: 'on' };

    const userToAimYd = haversineMeters(user, aim) * M_TO_YD;
    const alongGreen = alongTrackYd(user, aim, green); // yd along the shot line
    const lateralGreen = crossTrackYd(user, aim, green); // + = right of the line
    const beyondYd = alongGreen - userToAimYd; // + = aim is SHORT of the middle

    // Threshold = 1σ of the differential GPS error, floored at the legacy tolerance.
    const sigYd =
      state.loc && Number.isFinite(state.loc.accuracy)
        ? state.loc.accuracy * GPS_ACC_TO_SIGMA * M_TO_YD
        : OVERSHOOT_TOL_YD;
    const tol = Math.max(OVERSHOOT_TOL_YD, sigYd);

    const stateName =
      beyondYd > tol ? 'short' : beyondYd < -tol ? 'over' : 'on';

    return {
      yards: Math.abs(beyondYd),
      lateralYd: lateralGreen,
      state: stateName,
    };
  }

  // Canonical "aim target vs green middle" readout. Every surface that prints
  // a "yd past/to middle" number must go through this so they always agree.
  function greenCenterOffset() {
    if (!state.loc || !state.target || !state.greenCenter) return null;
    return leftoverToGreen(state.loc, state.target, state.greenCenter);
  }

  function formatLeftover(lo) {
    if (!lo) return 'at middle';

    if (lo.state === 'on') {
      // "On" along the line but beside it: say the lateral offset, since a
      // bare "at middle" would be misleading.
      if (Number.isFinite(lo.lateralYd) && Math.abs(lo.lateralYd) >= 8) {
        return `middle ${Math.round(Math.abs(lo.lateralYd))} yd ${lo.lateralYd > 0 ? 'right' : 'left'
          }`;
      }
      return 'at middle';
    }

    const y = Math.round(lo.yards);
    let text =
      lo.state === 'over' ? `${y} yd past middle` : `${y} yd to middle`;

    // If the middle is meaningfully beside the line, say so — otherwise the
    // along-line number implies the middle sits right on your line.
    if (Number.isFinite(lo.lateralYd) && Math.abs(lo.lateralYd) >= 8) {
      text += ` (middle ${Math.round(Math.abs(lo.lateralYd))} yd ${lo.lateralYd > 0 ? 'right' : 'left'
        })`;
    }
    return text;
  }

  /**
   * SIGNATURE PRESERVED: greenGeometry() -> { front, center, back, depth } (+ extras).
   * front/center/back remain straight-line yardages from the player, so all existing
   * readouts are unchanged. depth is now the TRUE PLAYING DEPTH along the shot line.
   */
  function greenGeometry() {
    if (!state.loc) return null;
    const yd = (p) => (p ? haversineMeters(state.loc, p) * M_TO_YD : null);
    const front = yd(state.frontPt);
    const center = yd(state.greenCenter);
    const back = yd(state.backPt);

    const aim = state.target || state.greenCenter || state.backPt || state.frontPt;
    let depth = front != null && back != null ? Math.max(0, back - front) : null;
    let axisBearing = null, obliquityDeg = null, widthYd = null, centerLateral = 0;
    let frontAlong = null, backAlong = null, centerAlong = null;

    if (aim && state.frontPt && state.backPt) {
      const axisLen = haversineMeters(state.frontPt, state.backPt) * M_TO_YD;
      if (axisLen >= GREEN_AXIS_MIN_YD) {
        axisBearing = initialBearingDeg(state.frontPt, state.backPt);
        const shotBearing = initialBearingDeg(state.loc, aim);
        obliquityDeg = Math.abs(angleDiff(axisBearing, shotBearing));
        // Playing depth = the green axis projected onto the shot line.
        frontAlong = alongTrackYd(state.loc, aim, state.frontPt);
        backAlong = alongTrackYd(state.loc, aim, state.backPt);
        depth = Math.max(0, backAlong - frontAlong);
        // Width perpendicular to the AXIS, estimated from the aspect ratio of the axis
        // length, then re-projected onto the shot line's cross direction. An oblique
        // green presents more width and less depth — both handled here.
        const axisWidth = clamp(axisLen * GREEN_ASPECT_DEFAULT, GREEN_WIDTH_MIN_YD, GREEN_WIDTH_MAX_YD);
        const ob = d2r(obliquityDeg);
        widthYd = clamp(
          Math.abs(axisWidth * Math.cos(ob)) + Math.abs(axisLen * Math.sin(ob)),
          GREEN_WIDTH_MIN_YD, GREEN_WIDTH_MAX_YD * 1.4
        );
      }
    }
    if (aim && state.greenCenter) {
      centerAlong = alongTrackYd(state.loc, aim, state.greenCenter);
      centerLateral = crossTrackYd(state.loc, aim, state.greenCenter);
    }
    if (widthYd == null && depth != null && depth > 0)
      widthYd = clamp(depth * GREEN_ASPECT_DEFAULT, GREEN_WIDTH_MIN_YD, GREEN_WIDTH_MAX_YD);

    return {
      front, center, back, depth,
      widthYd, axisBearing, obliquityDeg, centerLateral,
      frontAlong, backAlong, centerAlong,
      // Straight-line depth, kept separately so the UI can show both if you want.
      depthStraight: front != null && back != null ? Math.max(0, back - front) : null,
    };
  }

  // FCB is green reference data, not an instruction to replace the user's map target.
  // Only engage the green-aware optimizer when the selected target is actually
  // on or very near the marked green center.
  function targetIsOnMarkedGreen(geo) {
    if (!state.loc || !state.target || !geo || !state.greenCenter) return false;

    const targetToCenterYd =
      haversineMeters(state.target, state.greenCenter) * M_TO_YD;

    // Green depth provides a reasonable tolerance. The clamp prevents very
    // small or very large FCB spacing from making this too strict or too loose.
    const toleranceYd = clamp(
      (Number.isFinite(geo.depthStraight) ? geo.depthStraight : 24) * 0.8,
      18,
      35
    );

    return targetToCenterYd <= toleranceYd;
  }

  function targetToGreenTip() {
    // Reads the SAME value the big label prints (greenCenterOffset), so the
    // "yd past/to middle" figures can never differ between surfaces again.
    const off = greenCenterOffset();
    if (!off || off.state === 'on') return null;

    const lateralText =
      Number.isFinite(off.lateralYd) && Math.abs(off.lateralYd) >= 8
        ? ` Green center is also about ${Math.round(
          Math.abs(off.lateralYd)
        )} yd ${off.lateralYd > 0 ? 'right' : 'left'} of your target line.`
        : '';

    if (off.state === 'short') {
      return (
        `This is a layup target: it leaves about ${Math.round(
          off.yards
        )} yd to green center.` +
        ` Club choice is based on the selected target, not the green center.` +
        lateralText
      );
    }

    return (
      `Your selected target is about ${Math.round(
        off.yards
      )} yd beyond green center.` +
      ` Move the target back onto the green unless that is intentional.` +
      lateralText
    );
  }

  /* ============================================================
     BLOCK 9b — HAZARDS, HOLE BRIEF & SMART LAYUP (advice inputs)
     Spends the OSM-imported hazard coordinates and per-hole metadata
     that were previously stored but never read.
  ============================================================ */

  const HAZARD_GREENSIDE_ALONG_YD = 28;  // "greenside" along-line window around the target, yd
  const HAZARD_GREENSIDE_CROSS_YD = 32;  // "greenside" lateral window, yd
  const HAZARD_CARRY_BUFFER_YD = 12;     // water this far short of the target counts as a carry threat
  const TEE_SHOT_RADIUS_YD = 40;         // how close to the tee the hole brief appears

  function holeHazards() {
    const hole = getCurrentHoleData();
    return hole && Array.isArray(hole.hazards) ? hole.hazards : [];
  }

  // Project imported hazards onto the CURRENT shot line: along = downrange,
  // cross = + right of the line.
  function hazardsOnLine() {
    const list = holeHazards();
    if (!list.length || !state.loc || !state.target) return [];
    return list
      .map((h) => {
        if (!h || !Number.isFinite(h.lat) || !Number.isFinite(h.lng))
          return null;
        return {
          type: h.type === 'water' ? 'water' : 'bunker',
          alongYd: alongTrackYd(state.loc, state.target, h),
          crossYd: crossTrackYd(state.loc, state.target, h),
        };
      })
      .filter(Boolean);
  }

  // Up to two human tips for hazards that genuinely threaten THIS target.
  function hazardTips(targetYd) {
    const out = [];
    const hs = hazardsOnLine();
    if (!hs.length) return out;

    const side = (x) => (x >= 0 ? 'right' : 'left');

    // Greenside threats: beside or around the target.
    const greenside = hs.filter(
      (h) =>
        Math.abs(h.alongYd - targetYd) <= HAZARD_GREENSIDE_ALONG_YD &&
        Math.abs(h.crossYd) <= HAZARD_GREENSIDE_CROSS_YD
    );
    if (greenside.length) {
      const g =
        greenside.find((h) => h.type === 'water') || greenside[0];
      const kind = g.type === 'water' ? 'Water' : 'Bunker';
      const whereTxt =
        Math.abs(g.crossYd) >= 8
          ? `${Math.round(Math.abs(g.crossYd))} yd ${side(g.crossYd)}`
          : '';
      const depthTxt =
        Math.abs(g.alongYd - targetYd) <= 10
          ? 'at the target'
          : g.alongYd < targetYd
            ? 'short'
            : 'long';
      out.push(
        `${kind} ${depthTxt}${whereTxt ? ' ' + whereTxt : ''} of this target — favour the open side and take enough club to clear it.`
      );
    }

    // Carry threats: water sitting ON the line between ball and target.
    const carry = hs.filter(
      (h) =>
        h.type === 'water' &&
        h.alongYd > 5 &&
        h.alongYd < targetYd - HAZARD_CARRY_BUFFER_YD &&
        Math.abs(h.crossYd) <= 18
    );
    if (carry.length) {
      const c = carry.reduce((a, b) => (b.alongYd > a.alongYd ? b : a));
      out.push(
        `The line crosses water around ${Math.round(c.alongYd)} yd — your club must clear it with margin, not just reach.`
      );
    }
    return out.slice(0, 2);
  }

  // Opening plan while standing on/near this hole's tee of a fresh hole.
  function holeBrief() {
    if (!state.roundSession || !state.loc) return null;
    const hole = getCurrentHoleData();
    if (!hole || !hole.teePoint) return null;
    const toTeeYd = haversineMeters(state.loc, hole.teePoint) * M_TO_YD;
    if (toTeeYd > TEE_SHOT_RADIUS_YD) return null;
    // Fresh hole only: no counted shots logged here yet.
    const played = (state.roundSession.shots || []).some(
      (s) => s.hole === hole.number && s.counted
    );
    if (played) return null;

    const course = getCurrentCourse();
    const totalYd = Number(hole.yards) || null;
    const par = hole.par || 4;

    // Greedy full-swing plan from the long end of the bag.
    const plan = [];
    let remain = totalYd;
    if (remain) {
      for (const c of sortedClubsDesc()) {
        if (remain <= c.yards * 1.08) break;
        if (plan.length >= 3) break;
        plan.push(c.name);
        remain -= c.yards;
      }
    }

    const bodyBits = [];
    if (plan.length)
      bodyBits.push(
        `Plan: ${plan.join(' → ')}${remain > 0 ? `, then ~${Math.round(remain)} yd in` : ''
        }`
      );
    if (course?.teeName) bodyBits.push(`from the ${course.teeName}`);
    if (hole.strokeIndex) bodyBits.push(`stroke index ${hole.strokeIndex}`);

    return {
      kicker: 'Hole brief',
      main: `Par ${par}${totalYd ? ` · ${totalYd} yd` : ''}`,
      sub: bodyBits.join(' · ') || 'No mapped plan — play your normal tee club.',
    };
  }

  // Named-club layup coaching for targets beyond the bag: names the club
  // you're leaving yourself and, with green geometry, the exact finish yardage.
  function smartLayupTip(geo) {
    const desc = sortedClubsDesc();
    const asc = sortedClubsAsc();
    if (!asc.length || !desc.length) return null;
    const calc = state.lastCalc;
    if (!calc) return null;
    const approach = asc[0]; // most lofted full swing
    if (!(approach.yards > 0)) return null;

    if (geo && Number.isFinite(geo.frontAlong)) {
      const finishAt = Math.round(geo.frontAlong - approach.yards);
      if (finishAt > 10) {
        return `Smart layup: land it near ${finishAt} yd out — a full ${approach.name} (${approach.yards} yd) then covers the front edge.`;
      }
    }
    return `Smart layup: club down short of your target so a full ${approach.name} (${approach.yards} yd) remains into the green.`;
  }
  // ============================================================
  //  BLOCK 10 — WEATHER / ELEVATION CONTEXT
  //  Replaces: updateContext, getWeatherOrNeutral,
  //            getElevationOrNeutral, updateWeatherUI, stampText
  // ============================================================

  const ELEV_PROFILE_N = 9;          // sample count along the shot line; 9 resolves a ridge to ~1/8 of the shot
  const BLIND_CLEARANCE_FT = 8;      // terrain rising this far above the sight line makes the shot blind
  const GEOID_TYPICAL_CONUS_M = -30; // mean EGM96 geoid undulation over the CONUS, m — NGA EGM96 model summary (used only to sanity-check GPS altitude)

  function getWeatherOrNeutral() {
    return state.context.weather || {
      tempF: STD_TEMP_F, rh: STD_RH, windMph: 0, windFromDeg: 0,
      pressureHpa: NaN, gustMph: NaN, shearAlpha: NaN,
    };
  }
  function getElevationOrNeutral() {
    if (state.context.elevation) return state.context.elevation;
    // GPS-only fallback: differential is zero, absolute altitude is ellipsoidal so it is
    // only used for density (a 30 m error costs ~0.3% density, ~0.5 yd on a 200 yd shot).
    const hasGpsAlt = state.loc && Number.isFinite(state.loc.altitude);
    const gpsFt = hasGpsAlt ? state.loc.altitude * M_TO_FT : 0;
    return { userFt: gpsFt, targetFt: gpsFt, usedGpsFallback: hasGpsAlt, profileFt: null, blindFt: 0 };
  }

  async function updateContext() {
    const user = state.loc, target = state.target;
    if (!user && !target) { updateWeatherUI(); return; }
    const seq = ++state.contextSeq;
    const isCurrent = () => seq === state.contextSeq;

    const p = target
      ? (user ? midpointGeodesic(user, target) : { lat: target.lat, lng: target.lng })
      : { lat: user.lat, lng: user.lng };

    // --- Weather: add pressure, gusts, and a second wind level for shear fitting ---
    const wKey = `weather:${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
    const wUrl = 'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${p.lat.toFixed(5)}&longitude=${p.lng.toFixed(5)}` +
      '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,' +
      'wind_gusts_10m,surface_pressure,pressure_msl,wind_speed_80m,wind_direction_80m,sunset' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto';
    try {
      const w = await cachedJSON(wKey, wUrl, WEATHER_TTL);
      if (!isCurrent()) return;
      const cur = w.data.current || {};
      const u10 = num(cur.wind_speed_10m, 0);
      const u80 = num(cur.wind_speed_80m, NaN);
      const alpha = Number.isFinite(u80) ? fitShearAlpha(u10, u80) : null;
      // Prefer station-level surface_pressure; otherwise reduce MSL to station level.
      let pHpa = num(cur.surface_pressure, NaN);
      if (!Number.isFinite(pHpa)) {
        const msl = num(cur.pressure_msl, NaN);
        const e0 = state.context.elevation;
        if (Number.isFinite(msl) && e0)
          pHpa = stationPressureFromMSL(msl * 100, e0.userFt * FT_TO_M,
            (num(cur.temperature_2m, 70) - 32) / 1.8) / 100;
      }
      const sunsetMs = cur.sunset ? Date.parse(cur.sunset) : NaN;
      state.context.weather = {
        tempF: num(cur.temperature_2m, STD_TEMP_F),
        rh: num(cur.relative_humidity_2m, STD_RH),
        windMph: u10,
        windFromDeg: norm(num(cur.wind_direction_10m, 0)),
        gustMph: num(cur.wind_gusts_10m, NaN),
        pressureHpa: Number.isFinite(pHpa) ? pHpa : NaN,
        shearAlpha: Number.isFinite(alpha) ? alpha : NaN,
        wind80Mph: Number.isFinite(u80) ? u80 : NaN,
        sunsetMs: Number.isFinite(sunsetMs) ? sunsetMs : NaN,
      };
      state.context.offlineWeather = !!w.offline;
      state.context.weatherTs = w.ts;
    } catch {
      if (!isCurrent()) return;
      state.context.weather = null;
      state.context.offlineWeather = true;
    }

    // --- Elevation: 9-point profile along the shot line ---
    if (user && target) {
      // Key rounded to ~110 m (toFixed(3)) instead of ~11 m: terrain deltas
      // at that scale are a few feet, irrelevant next to shot dispersion,
      // and the coarse grid lets adjacent holes share cached profiles
      // instead of triggering a fresh fetch on every hole change.
      const eKey = `elev:${user.lat.toFixed(3)},${user.lng.toFixed(3)}:` +
        `${target.lat.toFixed(3)},${target.lng.toFixed(3)}`;
      const g = geodesicInverse(user, target);
      const pts = [];
      for (let i = 0; i < ELEV_PROFILE_N; i++)
        pts.push(geodesicDirect(user, g.az1, (g.s * i) / (ELEV_PROFILE_N - 1)));
      const eUrl = 'https://api.open-meteo.com/v1/elevation' +
        `?latitude=${pts.map((q) => q.lat.toFixed(5)).join(',')}` +
        `&longitude=${pts.map((q) => q.lng.toFixed(5)).join(',')}`;
      try {
        const e = await cachedJSON(eKey, eUrl, ELEV_TTL);
        if (!isCurrent()) return;
        const arr = Array.isArray(e.data.elevation) ? e.data.elevation : [];
        const gpsAltM = state.loc && Number.isFinite(state.loc.altitude) ? state.loc.altitude : null;
        const userM = Number.isFinite(arr[0]) ? arr[0] : gpsAltM;
        const lastIdx = arr.length - 1;
        const targetM = Number.isFinite(arr[lastIdx]) ? arr[lastIdx] : userM;
        const profileFt = arr.filter(Number.isFinite).map((m) => m * M_TO_FT);
        // Blind-shot detection: max terrain height above the straight sight line.
        let blindFt = 0;
        if (profileFt.length >= 3) {
          const u = profileFt[0], t = profileFt[profileFt.length - 1], n = profileFt.length - 1;
          for (let i = 1; i < n; i++) {
            const sight = u + ((t - u) * i) / n;
            blindFt = Math.max(blindFt, profileFt[i] - sight);
          }
        }
        state.context.elevation = {
          userFt: Number.isFinite(userM) ? userM * M_TO_FT : 0,
          targetFt: Number.isFinite(targetM) ? targetM * M_TO_FT
            : Number.isFinite(userM) ? userM * M_TO_FT : 0,
          usedGpsFallback: !Number.isFinite(arr[0]) && gpsAltM !== null,
          profileFt: profileFt.length ? profileFt : null,
          blindFt: Math.max(0, blindFt),
        };
        state.context.offlineElevation = !!e.offline;
        state.context.elevTs = e.ts;
      } catch {
        if (!isCurrent()) return;
        const gpsFt = state.loc && Number.isFinite(state.loc.altitude)
          ? state.loc.altitude * M_TO_FT : 0;
        state.context.elevation = {
          userFt: gpsFt, targetFt: gpsFt,
          usedGpsFallback: state.loc && Number.isFinite(state.loc.altitude),
          profileFt: null, blindFt: 0,
        };
        state.context.offlineElevation = true;
      }
    }
    if (!isCurrent()) return;
    updateWeatherUI();
    if (state.target) calculateRange();
  }

  function updateWeatherUI() {
    const w = getWeatherOrNeutral(), e = getElevationOrNeutral();
    const windArrow = $('windArrow');
    const windCompass = $('windCompass');
    if (state.context.weather && w.windMph >= 1) {
      const gust = Number.isFinite(w.gustMph) && w.gustMph > w.windMph + 2
        ? `–${Math.round(w.gustMph)}` : '';
      // Arrow points where the wind is blowing TOWARD.
      const towardDeg = (w.windFromDeg + 180) % 360;
      els.windMetric.textContent = `${fmt(w.windMph)}${gust} mph`;
      els.windSubMetric.textContent = `from ${bearingToCompass(w.windFromDeg)}`;
      if (windCompass) {
        windCompass.hidden = false;
        const sheetNeedle = $('windNeedle');
        if (sheetNeedle) {
          sheetNeedle.style.transform = `rotate(${towardDeg}deg)`;
        }
      }
      // Map wind pill: same arrow + speed/direction, visible without opening
      // the sheet. Same rotation math as the sheet arrow so the two can
      // never disagree.
      if (els.windPill) {
        const pillNeedle = $('windPillNeedle');
        if (pillNeedle) {
          pillNeedle.style.transform = `rotate(${towardDeg}deg)`;
        }
        if (els.windPillText) {
          els.windPillText.textContent =
            `${Math.round(w.windMph)}${gust} mph · from ${bearingToCompass(w.windFromDeg)}`;
        }
        els.windPill.hidden = false;
      }
    } else {
      els.windMetric.textContent = state.context.weather ? `${fmt(w.windMph)} mph` : 'Neutral';
      els.windSubMetric.textContent = '';
      if (windCompass) windCompass.hidden = true;
      if (els.windPill) els.windPill.hidden = true;
    }
    els.tempMetric.textContent = state.context.weather
      ? `${fmt(w.tempF)}° / ${fmt(w.rh)}%` : `${STD_TEMP_F}° / ${STD_RH}%`;
    if (state.context.elevation) {
      const diff = e.targetFt - e.userFt;
      els.elevMetric.textContent = `${diff >= 0 ? '+' : ''}${fmt(diff)} ft`;
    } else els.elevMetric.textContent = '0 ft';

    const bits = [];
    if (!state.context.weather) bits.push('Neutral');
    if (state.context.offlineWeather) bits.push('Cached wx');
    if (state.context.offlineElevation) bits.push('Cached elev');
    // Daylight budget: quiet clock when there's time, a warning inside 45
    // minutes of a live round.
    if (Number.isFinite(w.sunsetMs)) {
      const minsLeft = Math.round((w.sunsetMs - Date.now()) / 60000);
      if (minsLeft > 0 && minsLeft <= 180) {
        if (minsLeft <= 45 && roundStatus() !== 'idle') {
          bits.push(`⚠ ${minsLeft} min light`);
        } else {
          const t = new Date(w.sunsetMs).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          });
          bits.push(`sunset ${t}`);
        }
      }
    }
    // Density ratio is the single most informative status number for a golfer.
    const rho = airDensity({
      tempF: w.tempF, rh: w.rh,
      altitudeFt: (e.targetFt + e.userFt) / 2,
      pressureHpa: w.pressureHpa,
    });
    bits.push(`ρ ${fmt(rho / RHO_STD * 100)}%`);
    if (Number.isFinite(w.pressureHpa)) bits.push('baro');
    if (!state.context.offlineWeather && !state.context.offlineElevation &&
      state.context.weather) bits.push('Live');
    els.weatherStatus.textContent = bits.join(' · ');

    // Keep the wind detail popover live while it is open.
    if (windPopIsOpen()) renderWindPop();
  }

  function stampText() {
    const wt = state.context.weatherTs ? new Date(state.context.weatherTs).toLocaleTimeString() : '—';
    const et = state.context.elevTs ? new Date(state.context.elevTs).toLocaleTimeString() : '—';
    const c = state.lastCalc;
    const model = c && Number.isFinite(c.rhoKgM3)
      ? ` · ρ=${fmt(c.rhoKgM3, 4)} kg/m³ (${fmt(c.densityRatio * 100, 1)}% of std)` : '';
    const solver = c && c.solverReached === false ? ' · target above apex (extrapolated)' : '';
    return `Weather as of ${wt}${state.context.offlineWeather ? ' (offline)' : ''}` +
      ` · Elevation as of ${et}${state.context.offlineElevation ? ' (offline)' : ''}` +
      `${model}${solver} · 3-DOF RK4 trajectory solve, lie assumed neutral (0 yd).`;
  }
  // ============================================================
  //  BLOCK 11 — WIND LABELING + TIP SCORING
  //  Replaces: bearingToCompass, windRelative, caddyTips, coachTips
  // ============================================================

  const COMPASS_32 = ['N', 'NbE', 'NNE', 'NEbN', 'NE', 'NEbE', 'ENE', 'EbN', 'E', 'EbS', 'ESE', 'SEbE',
    'SE', 'SEbS', 'SSE', 'SbE', 'S', 'SbW', 'SSW', 'SWbS', 'SW', 'SWbW', 'WSW', 'WbS',
    'W', 'WbN', 'WNW', 'NWbW', 'NW', 'NWbN', 'NNW', 'NbW'];  // 32-point mariner's compass — Bowditch, American Practical Navigator, Table of Compass Points
  // SIGNATURE PRESERVED; optional second arg selects 32-point resolution (11.25° bins).
  function bearingToCompass(bearing, points) {
    const b = norm(num(bearing, 0));
    if (points === 32) return COMPASS_32[Math.round(b / 11.25) % 32];
    return COMPASS_16[Math.round(b / 22.5) % 16];
  }

  /**
   * SIGNATURE PRESERVED: windRelative(windFromDeg, shotBearing, speedMph)
   *   -> { along, cross, primary, fromLabel }
   * BUG FIX: the old implementation computed `cross` from the wind's TOWARD vector, giving
   * it the OPPOSITE sign to windComponents().crosswindMph. Both now use one convention:
   *   along > 0 => tailwind   (unchanged)
   *   cross > 0 => wind FROM the right => ball pushed LEFT => aim RIGHT  (was inverted)
   */
  const WIND_CALM_MPH = 1.5;         // below this the wind is inside model and gauge noise — WMO-No. 8 anemometer starting threshold
  function windRelative(windFromDeg, shotBearing, speedMph) {
    const { headwindMph, crosswindMph } = windComponents({
      windMph: speedMph, windFromDeg, bearingDeg: shotBearing,
    });
    const along = -headwindMph;          // + = tail, matching the original meaning
    const cross = crosswindMph;          // + = from the right => aim right
    const a = Math.abs(along), c = Math.abs(cross);
    let primary;
    if (num(speedMph, 0) < WIND_CALM_MPH) primary = 'calm';
    else if (a >= c) primary = along > 0 ? 'tail' : 'head';
    else primary = cross > 0 ? 'cross→' : 'cross←';
    return { along, cross, primary, fromLabel: bearingToCompass(windFromDeg) };
  }

  /**
   * SIGNATURE PRESERVED: caddyTips(ctx, max = 2) -> string[]
   * ctx keys used by the existing caller are unchanged (plays, along, cross, elevFt, gap,
   * longerName, beyondLongest, accYd). New optional keys are additive.
   *
   * Scoring is now an estimated stroke cost, so ranking is meaningful rather than ordinal.
   */
  const TIP_STROKE_PER_YD_ERROR = 0.011;  // marginal strokes per yard of proximity error near a green — differentiated from Broadie (2014) proximity-to-strokes curves
  const TIP_MIN_SCORE = 0.012;            // suppress tips worth less than ~0.012 strokes; below this it is noise
  function caddyTips(ctx, max = 2) {
    const plays = num(ctx.plays, 0);
    const along = num(ctx.along, 0), cross = num(ctx.cross, 0);
    const elevFt = num(ctx.elevFt, 0), accYd = num(ctx.accYd, 0);
    const gap = ctx.gap == null ? null : num(ctx.gap, 0);
    const aimYd = num(ctx.aimYd, 0), gustYd = num(ctx.gustYd, 0);
    const densityRatio = num(ctx.densityRatio, 1);
    const apexFt = num(ctx.apexFt, NaN), descentDeg = num(ctx.descentDeg, NaN);
    const blindFt = num(ctx.blindFt, 0);
    const S = TIP_STROKE_PER_YD_ERROR;

    const TIPS = [
      {
        id: 'headwind', cat: 'wind',
        score: () => (along < -3 ? Math.abs(num(ctx.windAdjYd, along * -1.5)) * S : 0),
        text: () => `~${Math.abs(Math.round(along))} mph into you — that is worth about ${Math.abs(Math.round(num(ctx.windAdjYd, 0)))} yd of club. Swing ~80%: forcing it adds spin and balloons the ball short.`
      },
      {
        id: 'tailwind', cat: 'wind',
        score: () => (along > 5 ? Math.abs(num(ctx.windAdjYd, 0)) * S * 1.2 : 0),
        text: () => `Helping wind takes ~${Math.abs(Math.round(num(ctx.windAdjYd, 0)))} yd off and kills spin — the ball will not stop. Land it short of the flag and plan for release.`
      },
      {
        id: 'cross', cat: 'wind',
        score: () => (Math.abs(aimYd) >= 2 ? Math.abs(aimYd) * S * 0.8 : 0),
        text: () => {
          const lr = cross > 0 ? 'right-to-left across you' : 'left-to-right across you';
          const side = aimYd > 0 ? 'right' : 'left';
          return `~${Math.abs(Math.round(cross))} mph ${lr} — start it ~${Math.abs(aimYd)} yd ${side} of the pin (${fmt(Math.abs(num(ctx.aimDeg, 0)), 1)}°) and let it ride back. Do not fight it.`;
        }
      },
      {
        id: 'gust', cat: 'wind',
        score: () => (gustYd >= 4 ? gustYd * S * 0.9 : 0),
        text: () => `Gusting — the same swing is worth ±${Math.round(gustYd)} yd depending on when you pull the trigger. Wait for a lull or take the extra club and swing easy.`
      },
      {
        id: 'uphill', cat: 'elev',
        score: () => (elevFt > 6 ? Math.abs(num(ctx.elevAdjYd, elevFt / 3)) * S : 0),
        text: () => `Plays ~${Math.abs(Math.round(num(ctx.elevAdjYd, elevFt / 3)))} yd uphill — already in your number. Take enough club; uphill shots land steeper and stop faster.`
      },
      {
        id: 'downhill', cat: 'elev',
        score: () => (elevFt < -6 ? Math.abs(num(ctx.elevAdjYd, elevFt / 3)) * S : 0),
        text: () => `Plays ~${Math.abs(Math.round(num(ctx.elevAdjYd, elevFt / 3)))} yd downhill — club down, and expect a shallower landing angle and more roll.`
      },
      {
        id: 'blind', cat: 'elev',
        score: () => (blindFt > BLIND_CLEARANCE_FT ? 0.05 : 0),
        text: () => `Terrain rises ~${Math.round(blindFt)} ft above your sight line — this is a blind shot. Pick an aim point on the horizon before you address the ball.`
      },
      {
        id: 'density', cat: 'air',
        score: () => (Math.abs(densityRatio - 1) > 0.03
          ? Math.abs(num(ctx.altitudeAdjYd, 0) + num(ctx.tempAdjYd, 0)) * S : 0),
        text: () => densityRatio < 1
          ? `Thin air (${fmt(densityRatio * 100)}% of standard density) — the ball is carrying ~${Math.abs(Math.round(num(ctx.altitudeAdjYd, 0) + num(ctx.tempAdjYd, 0)))} yd farther than your stock numbers.`
          : `Heavy air (${fmt(densityRatio * 100)}% of standard density) — costs ~${Math.abs(Math.round(num(ctx.altitudeAdjYd, 0) + num(ctx.tempAdjYd, 0)))} yd. Take the extra club.`
      },
      {
        id: 'between', cat: 'club',
        score: () => (gap !== null && gap > 3 && gap <= 16 ? 0.04 : 0),
        text: () => `Between clubs — take the ${ctx.longerName} and smooth it. Most amateur approach misses are short, and pin-high is rarely a bad result.`
      },
      {
        id: 'stock', cat: 'club',
        score: () => (gap !== null && Math.abs(gap) <= 3 ? 0.018 : 0),
        text: () => `Stock ${ctx.longerName} number — commit and make your normal swing.`
      },
      {
        id: 'wedge', cat: 'club',
        score: () => (plays > 20 && plays < 60 ? 0.045 : 0),
        text: () => `Partial wedge — control distance with swing length, never by decelerating. Pick a stock 3/4 or 1/2 carry you have actually practiced.`
      },
      {
        id: 'steep', cat: 'flight',
        score: () => (Number.isFinite(descentDeg) && descentDeg > 48 && plays > 60 ? 0.02 : 0),
        text: () => `Steep ${fmt(descentDeg)}° descent — this one will stop quickly. You can fly it at the flag.`
      },
      {
        id: 'shallow', cat: 'flight',
        score: () => (Number.isFinite(descentDeg) && descentDeg < 35 && plays > 120 ? 0.03 : 0),
        text: () => `Shallow ${fmt(descentDeg)}° descent — the ball will run out. Land it short and use the ground.`
      },
      {
        id: 'layup', cat: 'strategy',
        score: () => (ctx.beyondLongest ? 0.10 : 0),
        text: () => `Beyond your longest club — lay up to a full-wedge number rather than forcing a hero shot. Expected strokes favour the layup here.`
      },
      {
        id: 'accuracy', cat: 'strategy',
        score: () => (accYd > ACCURACY_WARN_YD ? accYd * S * 0.6 : 0),
        text: () => `GPS is only ±${fmt(accYd)} yd — that is real distance uncertainty on top of your swing. Favour the centre of the green.`
      },
      {
        id: 'missbias', cat: 'pattern',
        score: () => (ctx.lateralBiasYd != null && Math.abs(ctx.lateralBiasYd) >= 6 ? 0.06 : 0),
        text: () => {
          const b = ctx.lateralBiasYd;
          const dir = b > 0 ? 'right' : 'left';
          return `Your tracked pattern: misses with ${ctx.biasClubName} average ${Math.abs(Math.round(b))} yd ${dir}. Start this one at the ${b > 0 ? 'left' : 'right'} edge and let the bias work back to centre.`;
        }
      },
    ];
    const seen = new Set();
    return TIPS.map((t) => {
      let s = 0;
      try { s = t.score(); } catch { s = 0; }
      return { ...t, s: Number.isFinite(s) ? s : 0 };
    })
      .filter((t) => t.s > TIP_MIN_SCORE)
      .sort((a, b) => b.s - a.s)
      .filter((t) => (seen.has(t.cat) ? false : seen.add(t.cat)))
      .slice(0, max)
      .map((t) => { try { return t.text(); } catch { return null; } })
      .filter(Boolean);
  }

  /**
   * SIGNATURE PRESERVED: coachTips(ctx) -> string[]
   * Now driven by the posterior model: reports which clubs have enough data to trust,
   * which are still prior-dominated, and where the bag has gaps or overlaps.
   */
  const COACH_TRUST_N = 8;           // shots per club before the posterior clearly dominates the prior at ν₀=6
  const GAP_IDEAL_YD = 12;           // target spacing between adjacent clubs, yd — standard fitting practice for a full bag
  const GAP_OVERLAP_FRAC = 0.55;     // adjacent clubs whose gap is under this fraction of their combined σ are redundant
  function coachTips(ctx) {
    const tips = [];
    const { total, clubs: clubCount } = shotDataSummary();
    const desc = sortedClubsDesc();

    if (!total) {
      tips.push(
        'No tracked shots yet. Start Round mode, choose a club, tap Start shot, walk to your ball, then tap Finish shot. Each accepted shot improves your distance and dispersion model.'
      );
      tips.push(`Until then Caddy uses a skill prior of about ${fmt(priorRelSigma(150) * 100, 1)}% relative dispersion. Real data typically beats that within 10 shots per club.`);
      return tips;
    }
    tips.push(`${total} shot${total === 1 ? '' : 's'} logged across ${clubCount} club${clubCount === 1 ? '' : 's'}. Posterior dispersion is now driving your club choices.`);

    // Which clubs need data most? Rank by prior weight still remaining.
    const thin = desc.map((c) => ({ c, st: clubStats(c.id) }))
      .filter((o) => (o.st.nEff || 0) < COACH_TRUST_N)
      .sort((a, b) => (a.st.nEff || 0) - (b.st.nEff || 0));
    if (thin.length) {
      const names = thin.slice(0, 3).map((o) => o.c.name).join(', ');
      tips.push(`Thinnest data: ${names}. About ${COACH_TRUST_N} tracked shots each and the model stops guessing for them.`);
    }

    // Is any club's stock number contradicted by the data?
    for (const c of desc) {
      const st = clubStats(c.id);
      if ((st.nEff || 0) < SHOT_MIN_TRUST_N || !Number.isFinite(st.ciLo)) continue;
      const stock = num(c.yards, 0);
      if (stock > 0 && (stock < st.ciLo || stock > st.ciHi)) {
        tips.push(`${c.name} is set to ${stock} yd but your tracked carry is ${fmt(st.meanPost)} yd (95% CI ${fmt(st.ciLo)}–${fmt(st.ciHi)}). Update it in the Clubs tab.`);
        break;
      }
    }
    // Trend detection.
    for (const c of desc) {
      const st = clubStats(c.id);
      if (Number.isFinite(st.trendYdPer30d) && Math.abs(st.trendYdPer30d) >= 3) {
        tips.push(st.trendYdPer30d > 0
          ? `${c.name} is trending ~${fmt(st.trendYdPer30d, 1)} yd longer per month — you are gaining speed.`
          : `${c.name} is trending ~${fmt(-st.trendYdPer30d, 1)} yd shorter per month — worth checking strike or equipment.`);
        break;
      }
    }
    // Gapping.
    const gaps = gapAnalysis();
    const bad = gaps.find((g) => g.verdict !== 'ok');
    if (bad) tips.push(bad.note);
    return tips;
  }
  // ============================================================
  //  BLOCK 12 — SHOT CAPTURE & REJECTION
  //  Replaces: gpsAccMeters, fixIsUsable, finishShot
  // ============================================================

  const SHOT_SNR_MIN = 4.0;          // require the measured displacement to exceed 4σ of its own uncertainty
  const SHOT_LATERAL_MAX_DEG = 45;   // beyond this off-line the "shot" is a re-tee or a walk, not a swing
  const SHOT_DWELL_MS = 1500;        // require the fix to have settled this long before trusting a capture

  function gpsAccMeters() {
    return state.loc && Number.isFinite(state.loc.accuracy) ? state.loc.accuracy : Infinity;
  }
  function fixIsUsable() {
    if (!state.loc || state.locStale) return false;
    if (gpsAccMeters() > ROUND_GPS_OK_M) return false;
    // Also require the player to be roughly still: a fix captured mid-stride carries a
    // velocity-lag bias of (speed x filter lag), several yards at walking pace.
    return kalman.speedMps() < 1.4;
  }
  // 1σ uncertainty, in yards, of a distance measured between two independent fixes.
  function shotDistanceSigmaYd(accAm, accBm) {
    const sa = num(accAm, ROUND_GPS_OK_M) * GPS_ACC_TO_SIGMA;
    const sb = num(accBm, ROUND_GPS_OK_M) * GPS_ACC_TO_SIGMA;
    return Math.sqrt(sa * sa + sb * sb) * M_TO_YD;
  }

  // SIGNATURE PRESERVED: finishShot(discard)
  function finishShot(discard) {
    const rs = state.roundSession;
    if (!rs || !rs.pending) return;
    if (!discard && !fixIsUsable()) {
      setNotice('Need a good, settled GPS fix to measure the shot. Stand still for a moment, or discard.', 'danger');
      haptic(12);
      return;
    }
    const p = rs.pending;
    const endPt = { lat: state.loc.lat, lng: state.loc.lng };
    const distanceYd = haversineMeters(p.startPt, endPt) * M_TO_YD;
    const bearingDeg = initialBearingDeg(p.startPt, endPt);

    // Signed lateral offset from the intended line via the exact cross-track projection.
    let lateralYd = null;
    if (p.intendedBearing != null && distanceYd > 0) {
      const aimPt = geodesicDirect(p.startPt, p.intendedBearing, distanceYd * YD_TO_M);
      lateralYd = Math.round(-crossTrackYd(p.startPt, aimPt, endPt));
    }

    const club = state.clubs.find((c) => c.id === p.clubId);
    const baseline = club ? num(club.yards, 0) : 0;

    // Statistical rejection instead of a fixed 8 yd floor.
    const sigYd = shotDistanceSigmaYd(p.startAcc, gpsAccMeters());
    const belowNoise = distanceYd < Math.max(ROUND_MIN_SHOT_YD, SHOT_SNR_MIN * sigYd);
    const wayOffLine = p.intendedBearing != null &&
      Math.abs(angleDiff(bearingDeg, p.intendedBearing)) > SHOT_LATERAL_MAX_DEG;
    const doDiscard = !!discard || belowNoise;

    let counted = false;
    if (!doDiscard && p.clubId && !wayOffLine)
      counted = logShot(p.clubId, distanceYd, baseline, lateralYd, gpsAccMeters());

    if (!Array.isArray(rs.shots)) rs.shots = [];
    rs.shots.push({
      clubId: p.clubId, startPt: p.startPt, endPt,
      distanceYd: Math.round(distanceYd),
      bearingDeg: Math.round(bearingDeg),
      intendedBearing: p.intendedBearing == null ? null : Math.round(p.intendedBearing),
      lateralYd, hole: rs.hole, ts: Date.now(),
      discarded: doDiscard, counted,
    });
    rs.pending = null;
    rs.status = 'active';
    saveRoundSession();
    renderRoundShotUI();
    releaseWakeLock();

    if (belowNoise && !discard)
      setNotice(`Only ${Math.round(distanceYd)} yd — inside GPS noise (±${fmt(sigYd)} yd). Logged as non-counting.`, 'greenish');
    else if (doDiscard)
      setNotice('Shot discarded — kept in history, excluded from your model.', 'greenish');
    else if (wayOffLine)
      setNotice(`${Math.round(distanceYd)} yd but ${Math.round(Math.abs(angleDiff(bearingDeg, p.intendedBearing)))}° off line — recorded, excluded from distance stats.`, 'greenish');
    else if (counted) {
      const st = clubStats(p.clubId);
      setNotice(`${club ? club.name : 'Shot'}: ${Math.round(distanceYd)} yd (±${fmt(sigYd)} yd GPS). ` +
        `Carry model now ${fmt(st.meanPost)} ± ${fmt(st.sigmaPost)} yd from ${st.n} shot${st.n === 1 ? '' : 's'}.`, 'greenish');
    } else
      setNotice(`${Math.round(distanceYd)} yd recorded (outside normal range — excluded from club stats).`, 'greenish');

    renderPendingShot();
    hapticPattern('shotFinish');
    if (state.target && state.loc) calculateRange();
  }
  // ============================================================
  //  BLOCK 13 — PRACTICE ANALYTICS + GAPPING
  //  Replaces: renderPracticeSection.  Adds: gapAnalysis.
  // ============================================================

  /**
   * Gapping analysis. A gap is "bad" not at a fixed yardage but relative to the
   * dispersion of the two clubs bracketing it: if the gap exceeds the combined
   * predictive spread you have a distance you cannot cover; if it is far smaller,
   * the two clubs are statistically indistinguishable and one is wasted.
   */
  function gapAnalysis() {
    const desc = sortedClubsDesc();
    const out = [];
    for (let i = 0; i < desc.length - 1; i++) {
      const hi = desc[i], lo = desc[i + 1];
      const gap = hi.yards - lo.yards;
      const sHi = clubSigmaDistYd(hi), sLo = clubSigmaDistYd(lo);
      const sComb = Math.sqrt(sHi * sHi + sLo * sLo);
      // Probability that a shot aimed at the midpoint misses both clubs' comfortable range.
      const mid = (hi.yards + lo.yards) / 2;
      const pMid = Math.max(
        1 - normCdf((mid - lo.yards) / Math.max(EPS, sLo)),
        normCdf((mid - hi.yards) / Math.max(EPS, sHi))
      );
      let verdict = 'ok', note = '';
      if (gap > 1.9 * sComb && gap > GAP_IDEAL_YD * 1.6) {
        verdict = 'gap';
        note = `${gap} yd between ${hi.name} and ${lo.name} is wider than your dispersion (±${fmt(sComb)} yd) can bridge — around ${Math.round(mid)} yd you have no comfortable club.`;
      } else if (gap < GAP_OVERLAP_FRAC * sComb) {
        verdict = 'overlap';
        note = `${hi.name} and ${lo.name} are only ${gap} yd apart versus ±${fmt(sComb)} yd of spread — statistically the same club. One slot is wasted.`;
      }
      out.push({ hi, lo, gap, sComb, pMid, verdict, note });
    }
    return out;
  }

  // SIGNATURE PRESERVED: renderPracticeSection()
  function renderPracticeSection() {
    const { total, clubs: clubCount } = shotDataSummary();
    const pc = document.getElementById('practiceShots');
    const pcl = document.getElementById('practiceClubs');
    const pb = document.getElementById('practiceBreakdown');
    const chip = document.getElementById('practiceSessionChip');

    if (pc) pc.textContent = String(total);
    if (pcl) pcl.textContent = String(clubCount);
    if (chip) chip.textContent = total ? 'Active' : 'No session';
    if (!pb) return;

    const desc = sortedClubsDesc();
    if (!total || !desc.length) {
      pb.innerHTML = '<div class="hint">Track shots to see per-club posterior carry, dispersion and gapping here.</div>';
      return;
    }
    const rows = [];
    for (const c of desc) {
      const st = clubStats(c.id);
      if (!st.n) continue;
      const disp = clubDispersionYd(c);
      const rel = st.meanPost > 0 ? (st.sigmaPost / st.meanPost) * 100 : NaN;
      const ci = Number.isFinite(st.ciLo) ? `${fmt(st.ciLo)}–${fmt(st.ciHi)}` : '—';
      const flag = num(c.yards, 0) > 0 && Number.isFinite(st.ciLo) &&
        (c.yards < st.ciLo || c.yards > st.ciHi) ? ' ⚠︎' : '';
      rows.push(
        `<div class="break-row"><span>${escapeHtml(c.name)}${flag}</span>` +
        `<b>${fmt(st.meanPost)} ±${fmt(st.sigmaPost, 1)} yd · ${fmt(rel, 1)}% · ` +
        `n=${st.n} (n<sub>eff</sub> ${fmt(st.nEff, 1)}) · CI ${ci} · band ±${disp}</b></div>`
      );
      if (Number.isFinite(st.lateralSigma))
        rows.push(`<div class="break-row"><span style="opacity:.6">↳ lateral σ</span>` +
          `<b style="opacity:.75">±${fmt(st.lateralSigma, 1)} yd (${fmt((st.lateralSigma / Math.max(1, st.meanPost)) * 100, 1)}%)</b></div>`);
      if (Number.isFinite(st.trendYdPer30d) && Math.abs(st.trendYdPer30d) >= 1.5)
        rows.push(`<div class="break-row"><span style="opacity:.6">↳ trend</span>` +
          `<b style="opacity:.75">${st.trendYdPer30d > 0 ? '+' : ''}${fmt(st.trendYdPer30d, 1)} yd / 30 d</b></div>`);
    }
    const gaps = gapAnalysis().filter((g) => g.verdict !== 'ok');
    if (gaps.length) {
      rows.push('<div class="break-row" style="margin-top:6px"><span><b>— Gapping —</b></span><b></b></div>');

      // Visual band chart: every club's coverage band drawn to scale across
      // the bag's yardage range, so overlaps and dead zones are SEEN.
      const descAll = sortedClubsDesc();
      const scaleMax = Math.max(...descAll.map((x) => x.yards)) * 1.08 || 300;
      const chart = descAll
        .filter((c) => c.yards > 0)
        .map((c) => {
          const st = clubStats(c.id);
          const meanC =
            Number.isFinite(st.meanPost) && st.n >= SHOT_MIN_TRUST_N
              ? st.meanPost
              : c.yards;
          const bandYd = clubDispersionYd(c);
          const lo = Math.max(0, meanC - bandYd);
          const hi = meanC + bandYd;
          const lft = clamp((lo / scaleMax) * 100, 0, 97);
          const wdt = clamp(
            ((hi - lo) / scaleMax) * 100,
            3,
            100 - lft
          );
          const flagged = gaps.some(
            (g) => g.hi.id === c.id || g.lo.id === c.id
          );
          return (
            `<div class="gap-chart-row${flagged ? ' flag' : ''}" title="${escapeHtml(
              c.name
            )}: covers ~${Math.round(lo)}–${Math.round(hi)} yd">` +
            `<span class="gap-chart-name">${escapeHtml(c.name)}</span>` +
            `<span class="gap-track"><span class="gap-band" style="left:${lft.toFixed(
              1
            )}%;width:${wdt.toFixed(1)}%"></span></span>` +
            `<b class="gap-chart-yd">${Math.round(meanC)}</b></div>`
          );
        })
        .join('');
      rows.push(`<div class="gap-chart">${chart}</div>`);

      for (const g of gaps)
        rows.push(`<div class="break-row"><span>${escapeHtml(g.hi.name)} → ${escapeHtml(g.lo.name)}</span>` +
          `<b>${g.gap} yd · ${g.verdict === 'gap' ? 'too wide' : 'redundant'}</b></div>`);
    }
    pb.innerHTML = rows.length ? rows.join('')
      : '<div class="hint">No shots tracked yet.</div>';
  }
  // ============================================================
  //  BLOCK 14 — ROUND STATISTICS
  //  Replaces: summarizeRound, renderStats
  // ============================================================

  const STATS_CONF = 0.90;             // reporting confidence for rate intervals; 90% is the right call at ~14 samples
  const HISTORY_HALFLIFE_ROUNDS = 8;   // exponential recency half-life for history averages, rounds
  const PUTTS_PAR_BASELINE = 1.75;     // Tour putts per green hit in regulation — Broadie, Every Shot Counts (2014) ch.5

  /**
   * SIGNATURE PRESERVED: summarizeRound(round) -> all original keys, plus extras.
   * Original keys: played, totalScore, puttRows, totalPutts, firRows, firMade, girRows, girMade.
   */
  function summarizeRound(round) {
    const rows = Array.isArray(round) ? round : [];
    const played = rows.filter((r) => r.score !== '' && Number.isFinite(Number(r.score)));
    const totalScore = played.reduce((s, r) => s + num(r.score, 0), 0);
    const puttRows = rows.filter((r) => r.putts !== '' && Number.isFinite(Number(r.putts)));
    const totalPutts = puttRows.reduce((s, r) => s + num(r.putts, 0), 0);
    const firRows = rows.filter((r) => r.fir === 'Y' || r.fir === 'N');
    const firMade = firRows.filter((r) => r.fir === 'Y').length;
    const girRows = rows.filter((r) => r.gir === 'Y' || r.gir === 'N');
    const girMade = girRows.filter((r) => r.gir === 'Y').length;

    // Putts split by whether the green was hit — the single most diagnostic split available
    // from this scorecard, because putts on missed greens conflate chipping with putting.
    const girHoles = rows.filter((r) => r.gir === 'Y' && r.putts !== '' && Number.isFinite(Number(r.putts)));
    const nonGirHoles = rows.filter((r) => r.gir === 'N' && r.putts !== '' && Number.isFinite(Number(r.putts)));
    const puttsOnGir = girHoles.length ? girHoles.reduce((s, r) => s + num(r.putts, 0), 0) / girHoles.length : null;
    const puttsOffGir = nonGirHoles.length ? nonGirHoles.reduce((s, r) => s + num(r.putts, 0), 0) / nonGirHoles.length : null;
    const scores = played.map((r) => num(r.score, 0));
    const scoreSd = scores.length >= 2
      ? Math.sqrt(scores.reduce((a, b) => a + (b - totalScore / scores.length) ** 2, 0) / (scores.length - 1)) : null;
    // Unbiased full-round projection (over the course's hole count) with SE.
    const roundLen = getCourseHoleCount();
    const proj = played.length ? (totalScore / played.length) * roundLen : null;
    const projSe = played.length >= 2 && scoreSd != null
      ? roundLen * (scoreSd / Math.sqrt(played.length)) *
      Math.sqrt(Math.max(0, (roundLen - played.length) / Math.max(1, roundLen - 1)))
      : null;

    // Scoring averages by par. Outside a live session the course lookup
    // falls back to par 4 — legacy scorecards get approximate splits.
    const courseNow = getCurrentCourse();
    const parSplits = {};
    rows.forEach((r, i) => {
      const sc = Number(r.score);
      if (!Number.isFinite(sc) || sc <= 0) return;
      const par = clamp(
        Math.round(num(courseNow?.holes?.[i]?.par, 4)),
        3,
        6
      );
      if (par > 5) return;
      parSplits[par] = parSplits[par] || { n: 0, total: 0 };
      parSplits[par].n += 1;
      parSplits[par].total += sc;
    });

    return {
      played: played.length, totalScore,
      puttRows: puttRows.length, totalPutts,
      firRows: firRows.length, firMade,
      girRows: girRows.length, girMade,
      // extras
      firCI: wilsonInterval(firMade, firRows.length, STATS_CONF),
      girCI: wilsonInterval(girMade, girRows.length, STATS_CONF),
      puttsOnGir, puttsOffGir, scoreSd,
      projected18: proj, projected18Se: projSe,
      threePutts: puttRows.filter((r) => num(r.putts, 0) >= 3).length,
      onePutts: puttRows.filter((r) => num(r.putts, 0) === 1).length,
      totalPen: rows.reduce((a, r) => a + (Number(r.penalties) || 0), 0),
      parSplits,
    };
  }

  // Direction of your misses across ALL tracked shots with lateral data:
  // the share finishing right of the intended line (+ = right).
  function missDirectionSummary() {
    const log = loadShotLog();
    const vals = [];
    for (const k of Object.keys(log)) {
      for (const e of (log[k] || []).map(normalizeShotEntry)) {
        if (e && Number.isFinite(e.l)) vals.push(e.l);
      }
    }
    if (!vals.length) return null;
    const right = vals.filter((v) => v > 0).length;
    return {
      n: vals.length,
      right,
      rightPct: Math.round((right / vals.length) * 100),
    };
  }

  // SIGNATURE PRESERVED: renderStats()
  function renderStats() {
    const s = summarizeRound(state.round);
    els.statScore.textContent = s.played ? `${s.totalScore}` : '—';
    els.statPutts.textContent = s.puttRows ? `${s.totalPutts}` : '—';
    els.statFir.textContent = s.firRows ? `${Math.round(s.firCI.p * 100)}%` : '—';
    els.statGir.textContent = s.girRows ? `${Math.round(s.girCI.p * 100)}%` : '—';

    const avgScore = s.played ? s.totalScore / s.played : null;
    const avgPutts = s.puttRows ? s.totalPutts / s.puttRows : null;
    const pctCI = (ci) => ci && ci.n
      ? `${ci.n ? `${Math.round(ci.p * 100)}%` : '—'} (${Math.round(ci.lo * 100)}–${Math.round(ci.hi * 100)}%, n=${ci.n})`
      : '—';

    // Hole count for labels/projections — matches the active course layout.
    const roundLen = getCourseHoleCount();

    const rows = [
      ['Holes entered', `${s.played} / 18`],
      ['Avg score / hole', avgScore === null ? '—' : fmt(avgScore, 2)],
      ['Score SD / hole', s.scoreSd === null ? '—' : fmt(s.scoreSd, 2)],
      [`Projected ${roundLen}`, s.projected18 === null ? '—'
        : `${fmt(s.projected18, 1)}${s.projected18Se ? ` ± ${fmt(s.projected18Se, 1)}` : ''}`],
      ['Avg putts / hole', avgPutts === null ? '—' : fmt(avgPutts, 2)],
      ['Putts when GIR', s.puttsOnGir === null ? '—'
        : `${fmt(s.puttsOnGir, 2)} (Tour ${PUTTS_PAR_BASELINE})`],
      ['Putts when missed', s.puttsOffGir === null ? '—' : fmt(s.puttsOffGir, 2)],
      ['1-putts / 3-putts', s.puttRows ? `${s.onePutts} / ${s.threePutts}` : '—'],
      ['Penalty strokes', String(s.totalPen || 0)],
      ...([3, 4, 5]
        .filter((p) => s.parSplits && s.parSplits[p] && s.parSplits[p].n)
        .map((p) => [
          `Avg score · Par ${p}`,
          `${fmt(s.parSplits[p].total / s.parSplits[p].n, 2)} over ${s.parSplits[p].n
          } hole${s.parSplits[p].n === 1 ? '' : 's'}`,
        ])),
      [`Fairways (${Math.round(STATS_CONF * 100)}% CI)`, pctCI(s.firCI)],
      [`Greens (${Math.round(STATS_CONF * 100)}% CI)`, pctCI(s.girCI)],
      [
        'Offline tendency',
        (() => {
          const m = missDirectionSummary();
          return m
            ? `${m.rightPct}% right of line · ${m.n} tracked shot${m.n === 1 ? '' : 's'}`
            : '—';
        })(),
      ],
    ];

    const hist = state.history || [];
    if (hist.length) {
      // Recency-weighted history: an eight-round half-life keeps averages responsive.
      const w = hist.map((_, i) => Math.pow(0.5, (hist.length - 1 - i) / HISTORY_HALFLIFE_ROUNDS));
      const wAvg = (vals) => {
        const pairs = vals.map((v, i) => [v, w[i]]).filter(([v]) => Number.isFinite(v));
        if (!pairs.length) return null;
        const sw = pairs.reduce((a, [, ww]) => a + ww, 0);
        return pairs.reduce((a, [v, ww]) => a + v * ww, 0) / sw;
      };
      const scores = hist.map((h) => h.totalScore);
      const putts = hist.map((h) => h.totalPutts);
      const firPct = hist.map((h) => (h.firRows ? (100 * h.firMade) / h.firRows : NaN));
      const girPct = hist.map((h) => (h.girRows ? (100 * h.girMade) / h.girRows : NaN));
      const valid = scores.filter(Number.isFinite);
      // Robust trend in score over rounds.
      const idx = scores.map((_, i) => i).filter((i) => Number.isFinite(scores[i]));
      const ts = idx.length >= 4 ? theilSen(idx, idx.map((i) => scores[i])) : null;

      rows.push(['— History —', `${hist.length} round${hist.length > 1 ? 's' : ''}`]);
      rows.push(['Best score', valid.length ? Math.min(...valid) : '—']);
      rows.push(['Recent avg score', wAvg(scores) === null ? '—' : fmt(wAvg(scores), 1)]);
      rows.push(['Recent avg putts', wAvg(putts) === null ? '—' : fmt(wAvg(putts), 1)]);
      rows.push(['Recent avg FIR', wAvg(firPct) === null ? '—' : `${fmt(wAvg(firPct))}%`]);
      rows.push(['Recent avg GIR', wAvg(girPct) === null ? '—' : `${fmt(wAvg(girPct))}%`]);
      if (ts) rows.push(['Trend', `${ts.slope >= 0 ? '+' : ''}${fmt(ts.slope, 2)} strokes / round`]);
      const spark = sparklineRow(scores.slice(-15));
      if (spark) rows.push(['Recent scores', spark]);
    }
    els.statsBreakdown.innerHTML = rows
      .map(([k, v]) =>
        v && v.__raw
          ? `<div class="break-row"><span>${escapeHtml(k)}</span><b>${v.html}</b></div>`
          : `<div class="break-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`
      )
      .join('');
  }

  // Inline SVG trend line for recent scores. Lower-is-better golf scoring is
  // inverted so an improving player watches the line CLIMB. Returns a raw-
  // flagged object because it carries trusted, self-generated markup.
  function sparklineRow(values, width = 116, height = 26) {
    const pts = (values || []).filter(Number.isFinite);
    if (pts.length < 2) return null;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    const stepX = width / (pts.length - 1);
    const yFor = (v) => height - 3 - ((max - v) / span) * (height - 6);
    const coords = pts
      .map((v, i) => `${(i * stepX).toFixed(1)},${yFor(v).toFixed(1)}`)
      .join(' ');
    const parts = coords.split(' ');
    const last = parts[parts.length - 1].split(',');
    const html =
      `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
      `style="vertical-align:-7px;margin-right:7px;color:var(--green)">` +
      `<polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="2" ` +
      `stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle cx="${last[0]}" cy="${last[1]}" r="2.8" fill="currentColor"/></svg>` +
      `${min}–${max}`;
    return { __raw: true, html };
  }
  // ============================================================
  //  BLOCK 15 — RANGE PIPELINE
  //  Replaces: calculateRange, renderBreakdown
  // ============================================================

  // Sanity bound: a real golf target is never farther than this from the
  // player. Anything beyond is a stale/fallback point (e.g. a caddy:lastTarget
  // restored from a previous venue, or a geocoded course centroid when
  // scorecard mapping failed) — never compute yardage against it.
  const MAX_SANE_TARGET_YD = 1200;

  function calculateRange() {
    const staleTargetYd =
      state.loc && state.target
        ? haversineMeters(state.loc, state.target) * M_TO_YD
        : null;
    const targetInvalid =
      !state.loc ||
      !state.target ||
      (staleTargetYd != null &&
        (staleTargetYd <= 0 || staleTargetYd > MAX_SANE_TARGET_YD));
    if (targetInvalid) {
      if (state.target) {
        // Drop the bogus target so it can't leak into GPS ticks or persist.
        state.target = null;
        try { localStorage.removeItem('caddy:lastTarget'); } catch { }
      }
      els.rawYards.textContent = '—';
      els.rawLabel.textContent = 'Map a target';
      if (els.aimChip) els.aimChip.hidden = true;
      if (els.bearingChip) els.bearingChip.hidden = true;
      els.playsLikeYards.textContent = '—';
      els.playsLikeYards.classList.remove('pl-long', 'pl-short');
      els.clubRecommendation.textContent = 'No valid target';
      els.clubRecommendationSub.textContent =
        'Course map unavailable — tap the green on the map for distances.';
      renderCaddyTips([]);
      updateAdvice([], 'neutral');
      renderFcb();
      clearDispersionZone();
      tintTargetPin('neutral');
      renderElevProfile({}, els.rangeBreakdown);
      return;
    }
    const w = getWeatherOrNeutral(), e = getElevationOrNeutral();
    const meanAltM = ((e.targetFt + e.userFt) / 2) * FT_TO_M;
    const horizontalYd = haversineMeters(state.loc, state.target, meanAltM) * M_TO_YD;
    const bearing = initialBearingDeg(state.loc, state.target);

    const calc = playsLike({
      horizontalYd, bearingDeg: bearing,
      elevDiffFt: e.targetFt - e.userFt,
      courseAltitudeFt: (e.targetFt + e.userFt) / 2,
      tempF: w.tempF, rh: w.rh,
      windMph: w.windMph, windFromDeg: w.windFromDeg,
      pressureHpa: w.pressureHpa, gustMph: w.gustMph, shearAlpha: w.shearAlpha,
      latDeg: state.loc.lat, lieYd: 0,
    });
    state.lastCalc = calc;
    // Stamp the throttle reference so GPS ticks know this position is
    // already covered (see the gate in onPosition).
    state.lastCalcLoc = { lat: state.loc.lat, lng: state.loc.lng };
    state.lastCalcAt = Date.now();

    els.rawYards.textContent = fmt(horizontalYd);
    // Short, static label — the aim and bearing chips carry the detail so
    // the big number stays scannable at a glance.
    els.rawLabel.textContent = 'actual yds';
    if (els.bearingChip) {
      if (els.bearingChipArrow) {
        els.bearingChipArrow.style.transform = `rotate(${Math.round(bearing)}deg)`;
      }
      if (els.bearingChipText) {
        els.bearingChipText.textContent = `${bearingToCompass(bearing)} · ${Math.round(bearing)}°`;
      }
      els.bearingChip.hidden = false;
    }
    setAimChip();
    els.playsLikeYards.textContent = fmt(calc.playsLikeYd);

    // Condition tint on the plays-like tile: amber when the environment
    // stretches the shot past the raw number, blue when it shortens it —
    // readable at cart-distance without parsing either number.
    if (horizontalYd >= 25) {
      const plDeltaPct = (calc.playsLikeYd - horizontalYd) / horizontalYd;
      els.playsLikeYards.classList.toggle('pl-long', plDeltaPct >= 0.03);
      els.playsLikeYards.classList.toggle('pl-short', plDeltaPct <= -0.03);
    } else {
      els.playsLikeYards.classList.remove('pl-long', 'pl-short');
    }

    els.playsLikeYards.title = calc.extended
      ? 'Approximate yardage beyond the calibrated carry range'
      : '';

    els.playsLikeYards.setAttribute(
      'aria-label',
      calc.extended
        ? `${fmt(calc.playsLikeYd)} yards, approximate`
        : `${fmt(calc.playsLikeYd)} yards`
    );
    updateLine();
    renderFcb();

    const accYd = state.loc.accuracy ? state.loc.accuracy * M_TO_YD : 999;

    if (horizontalYd <= 3) setNotice('Very close target — no full shot needed.', 'greenish');
    else if (horizontalYd < 20) setNotice('Very close — chip or putt; no full swing.', 'greenish');
    else if (state.locStale)
      setNotice('Using last-known location (stale). Tap the GPS pill for a fresh fix.', 'danger');
    else if (accYd > ACCURACY_WARN_YD)
      setNotice(`GPS accuracy is ±${fmt(accYd)} yd (worse than ${ACCURACY_WARN_YD} yd). Yardage may be unreliable.`, 'danger');
    else if (calc.solverReached === false)
      setNotice('Target sits above the ball flight apex for this distance — the number is extrapolated. Treat it as a minimum.', 'danger');
    else if (e.blindFt > BLIND_CLEARANCE_FT)
      setNotice(`Blind shot — terrain rises ~${Math.round(e.blindFt)} ft above your sight line. Pick a horizon aim point.`, 'greenish');
    else if (state.context.offlineWeather || state.context.offlineElevation)
      setNotice('Using cached/offline weather or elevation where available. Neutral defaults fill any gaps.', 'greenish');
    else
      setNotice('Tap another point to move the target. Long-press the green (or Set Front/Back) for edge yardages.', 'greenish');

    const geo = greenGeometry();
    const hasGreen =
      geo && (geo.front != null || geo.back != null || geo.center != null);

    // FCB should influence strategy only when the selected pin is on the green.
    // A target short of the green is a layup target and must retain its own yardage.
    const useGreenStrategy = hasGreen && targetIsOnMarkedGreen(geo);

    let rec;
    let smart = null;
    let smartTips = [];
    let verdict = 'neutral';

    if (useGreenStrategy) {
      smart = recommendSmart(calc.playsLikeYd, geo, bearing, accYd, {
        strokeIndex: getCurrentHoleData()?.strokeIndex || null,
      });

      rec = {
        main: smart.main,
        sub: smart.sub,
      };

      smartTips = smart.tips;
      verdict = smart.verdict;
    } else {
      // Target-only recommendation: selected pin always wins.
      rec = recommendClub(calc.playsLikeYd);

      // Still explain the green relationship in advice, without changing club.
      const greenContextTip = hasGreen ? targetToGreenTip() : null;
      if (greenContextTip) smartTips.push(greenContextTip);
    }

    // Hazard awareness: imported bunkers/water projected onto THIS line.
    hazardTips(calc.horizontalYd).forEach((t) => smartTips.push(t));

    // Named-club layup coaching when the target is beyond the bag.
    const longestClub = sortedClubsDesc()[0];
    if (longestClub && calc.playsLikeYd > longestClub.yards * 1.08) {
      const lay = smartLayupTip(geo);
      if (lay) smartTips.push(lay);
    }
    // Use the optimizer's actual winning club when green strategy is active.
    // Otherwise use the selected-target recommendation.
    const recClub =
      smart && smart.club
        ? smart.club
        : sortedClubsAsc().find((c) => c.yards >= calc.playsLikeYd) ||
        sortedClubsDesc()[0];

    state.lastRecClubId = recClub
      ? recClub.id
      : state.lastRecClubId;

    // Standing on a fresh tee? Lead with the hole brief and tuck the club
    // recommendation underneath it.
    const brief = holeBrief();
    const kickerEl = $('recKicker');
    if (brief) {
      rec = {
        main: brief.main,
        sub: rec.main
          ? `${brief.sub} · Suggested opener: ${rec.main}`
          : brief.sub,
      };
      if (kickerEl) kickerEl.textContent = brief.kicker;
      verdict = 'neutral';
    } else if (kickerEl) {
      kickerEl.textContent = 'Recommended shot';
    }

    els.clubRecommendation.textContent = rec.main;
    let sub = rec.sub;
    if (calc.extended)
      sub = 'Beyond calibrated carry — estimate for layup planning. ' + sub;
    const g = selectedClubGuidance(calc.playsLikeYd);
    if (g) sub += ' · ' + g;

    // Gust-aware club range: when gusts materially exceed the sustained
    // number, the honest recommendation is a RANGE, not one club.
    let gustRangeTxt = '';
    if (
      Number.isFinite(w.gustMph) &&
      w.windMph >= 5 &&
      w.gustMph > w.windMph + 4 &&
      calc.gustYd >= 4
    ) {
      const ascAll = sortedClubsAsc();
      const pick = (yd) => {
        const hit = ascAll.find((c) => c.yards >= yd);
        return hit ? hit.name : null;
      };
      const loName = pick(Math.max(20, calc.playsLikeYd - calc.gustYd));
      const hiName = pick(calc.playsLikeYd + calc.gustYd);
      if (loName && hiName && loName !== hiName)
        gustRangeTxt = ` Gusts to ${Math.round(
          w.gustMph
        )} mph: anywhere from ${loName} to ${hiName} depending on timing.`;
      else if (loName)
        gustRangeTxt = ` Gusts to ${Math.round(
          w.gustMph
        )} mph — take the ${loName} and swing easy; timing is worth ±${Math.round(
          calc.gustYd
        )} yd.`;
    }

    els.clubRecommendationSub.textContent = sub + gustRangeTxt;
    setVerdict(verdict);
    renderShotPlan({
      calc,
      wind: windRelative(w.windFromDeg, bearing, w.windMph),
      elevation: e,
      accuracyYd: accYd,
      smart,
      verdict,
    });

    // Front / Middle / Back club trio — deep greens solved at a glance.
    // Yardages are converted to the plays-like scale before picking clubs so
    // the trio agrees with the headline recommendation in the same wind.
    if (
      els.shotPlanChips &&
      geo &&
      Number.isFinite(geo.front) &&
      Number.isFinite(geo.center) &&
      Number.isFinite(geo.back)
    ) {
      const scale =
        horizontalYd > 0 ? calc.playsLikeYd / horizontalYd : 1;
      const clubFor = (yd) => {
        const hit = sortedClubsAsc().find((c) => c.yards >= yd * scale);
        return hit ? hit.name : null;
      };
      const trio = [
        ['F', clubFor(geo.front)],
        ['M', clubFor(geo.center)],
        ['B', clubFor(geo.back)],
      ];
      if (trio.every(([, n]) => n)) {
        els.shotPlanChips.insertAdjacentHTML(
          'beforeend',
          trio
            .map(
              ([k, n]) =>
                `<span class="rec-chip">${k}&nbsp;<b style="font-weight:900">${escapeHtml(
                  n
                )}</b></span>`
            )
            .join('')
        );
      }
    }
    const ascC = sortedClubsAsc();
    const longerC = ascC.find((c) => c.yards >= calc.playsLikeYd);
    const longestC = sortedClubsDesc()[0];
    const wr = windRelative(w.windFromDeg, bearing, w.windMph);
    const baseTips = caddyTips({
      plays: calc.playsLikeYd,
      along: wr.along, cross: wr.cross,
      elevFt: calc.elevDiffFt,
      gap: longerC ? longerC.yards - calc.playsLikeYd : null,
      longerName: longerC ? longerC.name : '',
      beyondLongest: longestC && calc.playsLikeYd > longestC.yards * 1.08,
      accYd,
      // new context consumed by the upgraded tip engine
      aimYd: calc.aimYd, aimDeg: calc.aimDeg, gustYd: calc.gustYd,
      windAdjYd: calc.windAdjYd, elevAdjYd: calc.elevAdjYd,
      tempAdjYd: calc.tempAdjYd, altitudeAdjYd: calc.altitudeAdjYd,
      densityRatio: calc.densityRatio, apexFt: calc.apexFt,
      descentDeg: calc.descentDeg, blindFt: e.blindFt,
      lateralBiasYd: recClub ? clubLateralBiasYd(recClub.id) : null,
      biasClubName: recClub ? recClub.name : '',
    }, 3);

    if (state.prefs.mode === 'range') {
      const cTips = coachTips({ clubCount: Object.keys(loadShotLog()).length });
      renderCaddyTips([]);
      updateAdvice(cTips, 'neutral', { main: rec.main, sub: rec.sub, plays: calc.playsLikeYd });
    } else {
      // `smartTips` contains either true green-strategy advice or the
      // selected-target-versus-green explanation for an intentional layup.
      const tips = [...smartTips, ...baseTips]
        .filter(Boolean)
        .slice(0, 4);

      // Tips live in the map popover.
      renderCaddyTips([]);

      updateAdvice(tips, verdict, {
        main: rec.main,
        sub: els.shotAction?.textContent || rec.sub,
        plays: calc.playsLikeYd,
      });
    }

    renderBreakdown(calc, els.rangeBreakdown);
    renderElevProfile(e, els.rangeBreakdown);
    els.rangeStamp.textContent = stampText();
    renderClubChips(calc.playsLikeYd);

    // Pin tint + landing spread for the recommended club (verdict-aware).
    tintTargetPin(useGreenStrategy ? verdict : 'neutral');
    renderDispersionZone(bearing, recClub);
  }

  // SIGNATURE PRESERVED: renderBreakdown(calc, el)
  function renderBreakdown(calc, el) {
    if (!calc || !el) return;
    const sgn = (v, d = 1) => `${v >= 0 ? '+' : ''}${fmt(v, d)}`;
    const windKind = calc.headwindMph >= 0 ? 'head' : 'tail';
    const rows = [
      ['Horizontal (WGS-84 geodesic)', `${fmt(calc.horizontalYd, 1)} yd`],
      ['Bearing', `${bearingToCompass(calc.bearingDeg, 32)} (${fmt(calc.bearingDeg, 1)}°)`],
      ['Elevation', `${sgn(calc.elevAdjYd)} yd (${sgn(calc.elevDiffFt, 0)} ft)`],
      [`Wind (${windKind})`,
      `${sgn(calc.windAdjYd)} yd (${fmt(Math.abs(calc.headwindMph), 1)} mph ${windKind}, from ${bearingToCompass(calc.windFromDeg)})`],
      ['Crosswind aim',
        Math.abs(calc.crosswindMph) < PHYSICS.MIN_CROSSWIND_MPH
          ? 'minimal'
          : `${fmt(Math.abs(calc.crosswindMph), 1)} mph — ${calc.crossFrom} ${Math.abs(calc.aimYd)} yd (${fmt(Math.abs(calc.aimDeg), 1)}°)`],
      ['Temperature', `${sgn(calc.tempAdjYd)} yd (${fmt(calc.tempF)}°F)`],
      ['Altitude', `${sgn(calc.altitudeAdjYd)} yd (${fmt(calc.courseAltitudeFt)} ft)`],
      ['Humidity', `${sgn(calc.humidityAdjYd, 2)} yd (${fmt(calc.rh)}% RH)`],
      ['Air density', `${fmt(calc.rhoKgM3, 4)} kg/m³ · ${fmt(calc.densityRatio * 100, 1)}% of standard`],
      ['Lie', `${sgn(calc.lieYd)} yd (neutral)`],
      ['Plays-like', `${fmt(calc.playsLikeYd)} yd`],
    ];
    if (Number.isFinite(calc.apexFt))
      rows.push(['Apex / flight', `${fmt(calc.apexFt)} ft · ${fmt(calc.flightTimeS, 2)} s`]);
    if (Number.isFinite(calc.descentDeg))
      rows.push(['Descent / landing', `${fmt(calc.descentDeg, 1)}° at ${fmt(calc.landSpeedMph)} mph`]);
    if (calc.rolloutYd > 0)
      rows.push(['Est. rollout', `${fmt(calc.rolloutYd, 1)} yd (medium turf)`]);
    if (calc.gustYd > 0)
      rows.push(['Gust exposure', `±${fmt(calc.gustYd, 1)} yd`]);
    if (calc.extended)
      rows.push(['Carry range', 'beyond calibrated — estimate only']);
    el.innerHTML = rows
      .map(([k, v]) => `<div class="break-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`)
      .join('');
  }

  // Mini terrain profile along the CURRENT shot line (Pro Mode breakdown).
  // Consumes the 9-point open-meteo profile that was fetched but never shown.
  function renderElevProfile(e, el) {
    if (!el) return;
    const old = document.getElementById('elevProfileChart');
    if (old) old.remove();
    const prof = Array.isArray(e.profileFt) ? e.profileFt : null;
    if (!prof || prof.length < 3) return;

    const W = 240, H = 46;
    const min = Math.min(...prof);
    const max = Math.max(...prof);
    const span = max - min || 1;
    const stepX = W / (prof.length - 1);
    const coords = prof
      .map(
        (v, i) =>
          `${(i * stepX).toFixed(1)},${(
            H - 4 -
            ((v - min) / span) * (H - 10)
          ).toFixed(1)}`
      )
      .join(' ');
    const diff = prof[prof.length - 1] - prof[0];
    const blindTxt =
      Number.isFinite(e.blindFt) && e.blindFt > BLIND_CLEARANCE_FT
        ? ` · blind +${Math.round(e.blindFt)} ft`
        : '';

    const wrap = document.createElement('div');
    wrap.id = 'elevProfileChart';
    wrap.innerHTML =
      `<div class="break-row" style="border-bottom:0"><span>Terrain profile</span>` +
      `<b>${diff >= 0 ? '+' : ''}${Math.round(diff)} ft${blindTxt}</b></div>` +
      `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" ` +
      `style="color:var(--green);background:rgba(15,122,67,.06);border-radius:10px;display:block">` +
      `<polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="2" ` +
      `stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
    el.appendChild(wrap);
  }
  // ============================================================
  //  BLOCK 16 — MANUAL CALCULATOR
  //  Replaces: initManualCalc (entire function)
  // ============================================================

  function initManualCalc() {
    els.prefillBtn.addEventListener('click', () => {
      const w = getWeatherOrNeutral(),
        e = getElevationOrNeutral();
      if (state.loc && state.target) {
        els.manualYards.value = Math.round(
          haversineMeters(state.loc, state.target) * M_TO_YD
        );
        els.manualBearing.value = Math.round(
          initialBearingDeg(state.loc, state.target)
        );
        els.manualElevDiff.value = Math.round(e.targetFt - e.userFt);
        els.manualAltitude.value = Math.round((e.targetFt + e.userFt) / 2);
      }
      if (state.context.weather) {
        els.manualTemp.value = Math.round(w.tempF);
        els.manualRh.value = Math.round(w.rh);
        els.manualWindSpeed.value = Math.round(w.windMph);
        els.manualWindDir.value = Math.round(w.windFromDeg);
      }
    });

    els.manualCalcBtn.addEventListener('click', () => {
      const horizontalYd = num(els.manualYards.value, NaN);
      if (!Number.isFinite(horizontalYd) || horizontalYd < 0) {
        alert('Enter horizontal yards.');
        return;
      }
      // Pull live barometer / wind-shear / latitude when available. These are not
      // exposed as manual inputs, but passing them keeps the manual calculator on
      // the same physics as the map. All three degrade safely to NaN defaults.
      const w = getWeatherOrNeutral();
      const calc = playsLike({
        horizontalYd,
        bearingDeg: num(els.manualBearing.value, 0),
        elevDiffFt: num(els.manualElevDiff.value, 0),
        courseAltitudeFt: num(els.manualAltitude.value, 0),
        tempF: num(els.manualTemp.value, STD_TEMP_F),
        rh: num(els.manualRh.value, STD_RH),
        windMph: num(els.manualWindSpeed.value, 0),
        windFromDeg: num(els.manualWindDir.value, 0),
        pressureHpa: w.pressureHpa,
        shearAlpha: w.shearAlpha,
        latDeg: state.loc ? state.loc.lat : STD_LAT,
        lieYd: 0,
      });
      const rec = recommendClub(calc.playsLikeYd);
      els.manualRec.textContent = `${fmt(calc.playsLikeYd)} yd · ${rec.main}`;
      let sub = rec.sub;
      const g = selectedClubGuidance(calc.playsLikeYd);
      if (g) sub += ' · ' + g;
      // aimYd is SIGNED (+ = aim right). The old `calc.aimYd > 0` test silently
      // dropped this line for every right-to-left crosswind.
      if (Math.abs(calc.aimYd) > 0)
        sub += ` · Crosswind ${fmt(Math.abs(calc.crosswindMph), 1)} mph — aim ${Math.abs(calc.aimYd)
          } yd ${calc.aimYd > 0 ? 'right' : 'left'} (${fmt(
            Math.abs(calc.aimDeg),
            1
          )}°).`;
      els.manualRecSub.textContent = sub;
      renderBreakdown(calc, els.manualBreakdown);
    });
  }
  // ============================================================
  //  BLOCK 16a — COURSE NAME SEARCH (round setup)
  //  Case-insensitive substring match on golf-course names within a fixed
  //  radius of the last known location. Feeds the SAME select-and-import
  //  pipeline as the nearby list, so scorecard fetching is identical.
  // ============================================================

  // Escape a user string for safe embedding in an Overpass QL regex
  // literal: QL string-quoting first (backslash, quote), then regex
  // metacharacters. Prevents both query breakage and regex injection.
  function osmEscapeQueryString(s) {
    return String(s)
      .replace(/\\\\/g, '\\\\\\\\')
      .replace(/"/g, '\\"')
      .replace(/([.*+?^${}()\[\]])/g, '\\$1');
  }

  // Free-text course lookup via Photon (komoot's OSM geocoder). Returns the
  // same {id, osmType, osmId, name, lat, lng, source} shape the Overpass
  // path produces, so both feed the shared select-and-import pipeline.
  // Bias toward the player's location, but don't hard-reject distant
  // matches — a typed name is intent.
  async function photonCourseSearch(term, loc) {
    const params = new URLSearchParams({
      q: term,
      limit: String(COURSE_SEARCH_MAX_RESULTS * 2),
      lang: 'en',
      // Ask Photon to pre-filter to golf courses; the client-side kind
      // check below stays as a safety net.
      osm_tag: 'leisure:golf_course',
    });
    if (loc) {
      params.set('lat', loc.lat.toFixed(5));
      params.set('lon', loc.lng.toFixed(5));
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${PHOTON_GEOCODER_URL}?${params}`, {
        signal: ctrl.signal,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const features = Array.isArray(json.features) ? json.features : [];
      const seen = new Set();
      return features
        .map((f) => {
          const p = f.properties || {};
          const c = f.geometry && f.geometry.coordinates;
          const name = String(p.name || '').trim();
          const kind = `${p.osm_key}:${p.osm_value}`;
          if (
            !name ||
            !Array.isArray(c) ||
            !Number.isFinite(Number(c[0])) ||
            !Number.isFinite(Number(c[1])) ||
            !/golf|sport|^leisure:(pitch|track)$/.test(kind)
          ) {
            return null;
          }
          return {
            id: `osm:${p.osm_type || 'n'}:${p.osm_id}`,
            osmType: p.osm_type || null,
            osmId: Number(p.osm_id),
            name,
            lat: Number(c[1]),
            lng: Number(c[0]),
            source: 'openstreetmap',
          };
        })
        .filter(Boolean)
        .filter((course) => {
          const key = `${course.name.toLowerCase()}|${course.lat.toFixed(4)}|${course.lng.toFixed(4)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort(
          (a, b) =>
            haversineMeters(loc || { lat: 0, lng: 0 }, a) -
            haversineMeters(loc || { lat: 0, lng: 0 }, b)
        )
        .slice(0, COURSE_SEARCH_MAX_RESULTS);
    } finally {
      clearTimeout(timer);
    }
  }

  function renderCourseSearchResults() {
    if (!els.nearbyCourseList || !els.nearbyCourseStatus) return;

    if (state.courseSearchLoading) {
      const q = els.courseSearchInput
        ? els.courseSearchInput.value.trim()
        : '';
      els.nearbyCourseStatus.textContent = `Searching courses named “${q}”…`;
      els.nearbyCourseList.innerHTML = '';
      return;
    }

    const results = Array.isArray(state.courseSearchResults)
      ? state.courseSearchResults
      : [];

    if (!results.length) {
      els.nearbyCourseStatus.textContent =
        state.courseSearchError ||
        `No matches within ${Math.round(COURSE_SEARCH_RADIUS_M / 1000)} km.`;
      els.nearbyCourseList.innerHTML = state.courseSearchError
        ? '<button class="ghost-btn" id="courseSearchRetryBtn" type="button">Try again</button>'
        : '';
      const retryBtn = document.getElementById('courseSearchRetryBtn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          state.courseSearchError = null;
          runCourseSearch();
        });
      }
      return;
    }

    const sel = state.selectedNearbyCourse;
    if (
      sel &&
      results.some((c) => c.id === sel.id) &&
      state.nearbyCourseLoadingScorecard
    ) {
      // v1.0.70 premium loader card (shared with the map pill).
      if (!renderNearbyScorecardLoader(els.nearbyCourseStatus)) {
        els.nearbyCourseStatus.textContent =
          'Course selected — loading mapped scorecard data…';
      }
    } else {
      maploadStopPhases('nearby');
      els.nearbyCourseStatus.textContent = `${results.length} match${results.length === 1 ? '' : 'es'
        } — tap one to load its scorecard.`;
    }

    els.nearbyCourseList.innerHTML = results
      .map((course, index) => courseButtonHtml(course, index))
      .join('');

    els.nearbyCourseList
      .querySelectorAll('.nearby-course-option')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const course =
            state.courseSearchResults[Number(button.dataset.index)];
          if (course) selectNearbyCourse(course);
        });
      });
  }

  // Shared free-text course lookup: Photon geocoder first (sub-second),
  // Overpass regex lookup as automatic fallback when Photon comes back
  // empty or fails. Used by BOTH the round-setup nearby list and the Prep
  // course picker, so there is exactly one network code path.
  async function courseNameSearch(term, loc) {
    const { lat, lng } = loc;
    const cacheKey =
      OSM_CACHE_PREFIX +
      `search:${COURSE_SEARCH_RADIUS_M}:${lat.toFixed(2)},${lng.toFixed(
        2
      )}:${term.toLowerCase()}`;
    const pat = osmEscapeQueryString(term);
    const query = `
    [out:json][timeout:20];
    (
      nwr["leisure"="golf_course"]["name"~"${pat}",i](around:${COURSE_SEARCH_RADIUS_M},${lat},${lng});
      nwr["golf"="course"]["name"~"${pat}",i](around:${COURSE_SEARCH_RADIUS_M},${lat},${lng});
    );
    out center tags ${COURSE_SEARCH_FETCH_LIMIT};
  `;

    let results = [];
    try {
      results = await photonCourseSearch(term, loc);
    } catch (photonError) {
      console.warn('Photon search failed, falling back to Overpass:', photonError);
    }

    if (!results.length) {
      const data = await overpassFetch(query, {
        timeoutMs: 12000,
        cacheKey,
        cacheTtlMs: COURSE_SEARCH_TTL_MS,
      });

      const seen = new Set();
      results = (Array.isArray(data) ? data : [])
        .map((item) => {
          const name = String(item.tags?.name || '').trim();
          const point = item.center || item;

          if (
            !name ||
            !Number.isFinite(Number(point.lat)) ||
            !Number.isFinite(Number(point.lon))
          ) {
            return null;
          }

          return {
            id: `osm:${item.type}:${item.id}`,
            osmType: item.type,
            osmId: Number(item.id),
            name,
            lat: Number(point.lat),
            lng: Number(point.lon),
            source: 'openstreetmap',
          };
        })
        .filter(Boolean)
        .filter((course) => {
          const key = `${course.name.toLowerCase()}|${course.lat.toFixed(
            4
          )}|${course.lng.toFixed(4)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort(
          (a, b) =>
            haversineMeters(loc, a) - haversineMeters(loc, b)
        )
        .slice(0, COURSE_SEARCH_MAX_RESULTS);
    }

    return results;
  }

  async function runCourseSearch() {
    if (!els.courseSearchInput) return;
    const term = els.courseSearchInput.value.trim();

    // Below minimum length: exit search mode and restore the nearby view.
    if (term.length < COURSE_SEARCH_MIN_CHARS) {
      state.courseSearchActive = false;
      state.courseSearchLoading = false;
      state.courseSearchError = null;
      state.courseSearchResults = [];
      state._courseSearchSeq++;
      renderNearbyCourses();
      return;
    }

    state.courseSearchActive = true;
    const mySeq = ++state._courseSearchSeq;

    if (!state.loc) {
      state.courseSearchLoading = false;
      state.courseSearchError = null;
      state.courseSearchResults = [];
      renderCourseSearchResults(); // prints the needs-location message
      return;
    }

    state.courseSearchLoading = true;
    state.courseSearchError = null;
    renderCourseSearchResults();

    try {
      const results = await courseNameSearch(term, state.loc);

      // Drop the answer if the query it belongs to is no longer current.
      if (mySeq !== state._courseSearchSeq) return;
      state.courseSearchResults = results;
      state.courseSearchError = null;
    } catch (error) {
      console.warn('Course name search failed:', error);
      if (mySeq !== state._courseSearchSeq) return;
      state.courseSearchResults = [];
      state.courseSearchError =
        error && error.name === 'AbortError'
          ? 'Search is taking too long right now.'
          : 'Name search is unavailable right now.';
    } finally {
      if (mySeq === state._courseSearchSeq) {
        state.courseSearchLoading = false;
        if (state.courseSearchActive) renderCourseSearchResults();
      }
    }
  }
  // ============================================================
  //  BLOCK 16b — HOLE PLANNER (prep mode)
  //  Study any saved course offline: hole list + a written plan per hole.
  //  Reads ONLY stored course geometry — no network, no GPS required, so
  //  it works the night before at home.
  // ============================================================

  const PLAN_MAX_SEQ_CLUBS = 4;

  // Ephemeral prep course: a course found via name search that is mapped
  // for planning but NOT saved. Lives only for this session — the save
  // bar promotes it into state.courseProfiles via saveCourseProfile.
  let prepEphemeralCourse = null;
  const PREP_EPHEMERAL_ID = '@prep-search';

  // Courses available to the planner: an ephemeral searched course first,
  // then the active round's course, then every saved profile.
  function planCourseOptions() {
    const opts = [];
    if (prepEphemeralCourse) {
      opts.push({
        id: PREP_EPHEMERAL_ID,
        name: `${prepEphemeralCourse.name} · not saved`,
        course: prepEphemeralCourse,
      });
    }
    const active = state.roundSession ? getCurrentCourse() : null;
    if (active) {
      opts.push({
        id: '@active',
        name: `${active.name} · active round`,
        course: active,
      });
    }
    for (const c of state.courseProfiles || []) {
      opts.push({
        id: c.id,
        name: `${c.name} · ${teeDisplayName(c.teeName)}`,
        course: normalizeCourse(c),
      });
    }
    return opts;
  }

  function getPlannerCourse() {
    const id = state.planCourseId;
    if (!id) return null;
    const hit = planCourseOptions().find((o) => o.id === id);
    return hit ? hit.course : null;
  }

  // Yardage resolution: imported tee-set number wins; otherwise compute
  // tee→green-center geometry. Returns a rounded number or null.
  function planHoleYardage(hole) {
    const typed = Number(hole.yards);
    if (Number.isFinite(typed) && typed > 0) return Math.round(typed);
    if (hole.teePoint && hole.greenCenter) {
      const yd = haversineMeters(hole.teePoint, hole.greenCenter) * M_TO_YD;
      if (yd > 40 && yd < 900) return Math.round(yd);
    }
    return null;
  }

  function renderPlanner() {
    if (!els.planCourseSelect) return;
    const opts = planCourseOptions();
    const prev = state.planCourseId || '';
    els.planCourseSelect.innerHTML =
      `<option value="">Choose a course…</option>` +
      opts
        .map(
          (o) =>
            `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`
        )
        .join('');
    if (prev && opts.some((o) => o.id === prev)) {
      els.planCourseSelect.value = prev;
      renderPlannerCourse();
    } else {
      state.planCourseId = '';
      if (els.planCourseCard) els.planCourseCard.hidden = true;
    }
  }

  function renderPlannerCourse() {
    const course = getPlannerCourse();
    // The "not saved" bar only ever shows for an ephemeral searched course.
    const ephemeralActive =
      state.planCourseId === PREP_EPHEMERAL_ID && !!prepEphemeralCourse;
    if (els.planSaveBar) els.planSaveBar.hidden = !ephemeralActive;
    if (!course || !els.planCourseCard) {
      if (els.planCourseCard) els.planCourseCard.hidden = true;
      return;
    }
    els.planCourseCard.hidden = false;

    const n = Number(course.holesCount) === 9 ? 9 : 18;
    const mapped = (course.holes || []).filter(
      (h) => h.source === 'openstreetmap'
    ).length;

    if (els.planCourseChip)
      els.planCourseChip.textContent = `${n} holes`;
    els.planCourseName.textContent = course.name || 'Course';
    els.planCourseMeta.textContent = [
      course.teeName || null,
      mapped ? `${mapped}/${n} mapped` : 'manual',
    ]
      .filter(Boolean)
      .join(' · ');

    els.planHoleList.innerHTML = (course.holes || [])
      .slice(0, n)
      .map((h) => {
        const yd = planHoleYardage(h);
        const par = h.par || inferParFromYards(yd);
        const haz = Array.isArray(h.hazards) ? h.hazards.length : 0;
        const line = [
          par ? `Par ${par}` : 'Par —',
          yd ? `${Math.round(yd)} yd` : null,
          h.strokeIndex ? `SI ${h.strokeIndex}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return `
          <button class="plan-hole-row" type="button" data-hole="${h.number}">
            <span class="plan-hole-num">${h.number}</span>
            <span class="plan-hole-info">
              <span class="plan-hole-line">${escapeHtml(line)}</span>
              ${haz
            ? `<span class="plan-hole-sub">${haz} hazard${haz === 1 ? '' : 's'
            } marked</span>`
            : ''
          }
            </span>
            <span class="plan-hole-go">›</span>
          </button>`;
      })
      .join('');

    els.planHoleList
      .querySelectorAll('.plan-hole-row')
      .forEach((btn) => {
        btn.addEventListener('click', () =>
          openHolePlan(Number(btn.dataset.hole))
        );
      });

    // A stale detail card from a previous course selection is misleading —
    // collapse it whenever the course changes underneath.
    if (els.planDetailCard) els.planDetailCard.hidden = true;
  }

  // Greedy club sequence from the long end of the bag, mirroring the
  // on-course hole-brief logic, with an explicit finishing club.
  function planClubSequence(totalYd) {
    const yd = num(totalYd, 0);
    if (!(yd > 0)) return null;
    const desc = sortedClubsDesc();
    const asc = sortedClubsAsc();
    if (!desc.length) return null;

    const seq = [];
    let remain = yd;
    for (const c of desc) {
      if (remain <= c.yards * 1.08) break;
      if (seq.length >= PLAN_MAX_SEQ_CLUBS) break;
      seq.push(c.name);
      remain -= c.yards;
      if (remain <= 30) break;
    }

    // Shorter than the bag: express as a percentage of the shortest club.
    if (!seq.length) {
      const s = asc[0];
      if (s && s.yards > 0 && yd < s.yards * 0.95) {
        const pct = clamp(Math.round((yd / s.yards) * 100), 20, 95);
        return { seq: [], finisherName: `${s.name} · ${pct}% swing` };
      }
    }

    const finisher = sortedClubsAsc().find(
      (c) => c.yards >= Math.max(20, remain)
    );
    const finisherName = finisher
      ? finisher.name
      : `${Math.round(Math.max(0, remain))} yd partial`;
    return { seq, finisherName };
  }

  // Project stored hazards onto THIS hole's tee→green line so the plan can
  // say "water right, ~180 yd out" instead of raw coordinates.
  function planHazardsFor(hole) {
    const list = Array.isArray(hole.hazards) ? hole.hazards : [];
    const tee = hole.teePoint;
    const green = hole.greenCenter;
    return list.map((h) => {
      const kind =
        h.type === 'water'
          ? 'Water'
          : h.type === 'bunker'
            ? 'Bunker'
            : 'Hazard';
      let sub = '';
      if (
        tee &&
        green &&
        h &&
        Number.isFinite(h.lat) &&
        Number.isFinite(h.lng)
      ) {
        const along = alongTrackYd(tee, green, h);
        const cross = crossTrackYd(tee, green, h);
        const side =
          Math.abs(cross) < 8
            ? 'on the line'
            : cross > 0
              ? 'right'
              : 'left';
        sub = `${side}, ~${Math.max(0, Math.round(along))} yd off the tee`;
      }
      return { type: h.type, label: kind, sub };
    });
  }

  function planGreenInfo(hole) {
    const tee = hole.teePoint;
    if (!tee) return null;
    const dist = (p) =>
      p && Number.isFinite(p.lat)
        ? Math.round(haversineMeters(tee, p) * M_TO_YD)
        : null;
    const front = dist(hole.front);
    const center = dist(hole.greenCenter);
    const back = dist(hole.back);
    const depth =
      front != null && back != null ? Math.abs(back - front) : null;
    return { front, center, back, depth };
  }

  function planStrategy(depth, par, yd) {
    const bits = [];
    if (depth != null) {
      if (depth >= 26)
        bits.push(
          `Deep green (~${Math.round(depth)} yd of room) — space to be aggressive; fire at the number.`
        );
      else if (depth <= 14)
        bits.push(
          `Shallow green (~${Math.round(depth)} yd) — distance control decides this hole, not line. Favour the middle.`
        );
      else
        bits.push(
          `Green depth ~${Math.round(depth)} yd — a standard target.`
        );
    } else {
      bits.push('Green edges are not mapped — play to the middle.');
    }
    if (par === 5 && yd)
      bits.push(
        'Three-shotter at most bags — decide your layup number NOW, not off the second shot.'
      );
    if (par === 3) bits.push('One clean strike — commit fully to the yardage.');
    return bits.join(' ');
  }

  function renderPlanDetail(course, hole) {
    const yd = planHoleYardage(hole);
    const par = hole.par || inferParFromYards(yd);
    const metaBits = [];
    if (par) metaBits.push(`Par ${par}`);
    if (yd) metaBits.push(`${Math.round(yd)} yd`);
    if (hole.strokeIndex) metaBits.push(`stroke index ${hole.strokeIndex}`);
    if (yd && !(Number(hole.yards) > 0))
      metaBits.push('estimated from geometry');

    const seq = planClubSequence(yd);
    const hazards = planHazardsFor(hole);
    const green = planGreenInfo(hole);

    let html = '';
    html += `<div class="plan-meta">${metaBits.length
        ? metaBits.map(escapeHtml).join(' · ')
        : 'Unmapped hole — add par/yards in round setup.'
      }</div>`;

    if (yd) {
      if (seq) {
        html +=
          `<div class="plan-section">` +
          `<div class="plan-section-title">Suggested sequence</div>` +
          `<div class="plan-seq">${seq.seq.length
            ? escapeHtml(seq.seq.join(' → ')) + ' → '
            : ''
          }<b>${escapeHtml(seq.finisherName)}</b></div>` +
          `</div>`;
      } else {
        html +=
          `<div class="plan-section">` +
          `<div class="plan-section-title">Suggested sequence</div>` +
          `<div class="plan-seq plan-dim">Add carry distances in the Clubs tab to get a sequence.</div>` +
          `</div>`;
      }
    }

    if (hazards.length) {
      html +=
        `<div class="plan-section">` +
        `<div class="plan-section-title">Hazards</div>` +
        hazards
          .map(
            (hz) =>
              `<div class="plan-hazard${hz.type === 'water' ? ' water' : ''
              }">` +
              `<span class="plan-hazard-dot"></span>` +
              `<span>${escapeHtml(hz.label)}</span>` +
              (hz.sub
                ? `<span class="plan-hazard-sub">${escapeHtml(hz.sub)}</span>`
                : '') +
              `</div>`
          )
          .join('') +
        `</div>`;
    } else {
      html +=
        `<div class="plan-section">` +
        `<div class="plan-section-title">Hazards</div>` +
        `<div class="plan-hazard plan-dim">None marked for this hole.</div>` +
        `</div>`;
    }

    if (green && (green.front != null || green.center != null || green.back != null)) {
      const tile = (k, v) =>
        `<div class="plan-green-tile"><i>${k}</i>${v != null ? v + ' yd' : '—'
        }</div>`;
      html +=
        `<div class="plan-section">` +
        `<div class="plan-section-title">Green · measured from the tee</div>` +
        `<div class="plan-green-grid">` +
        tile('Front', green.front) +
        tile('Middle', green.center) +
        tile('Back', green.back) +
        `</div></div>`;
    }

    html += `<div class="plan-strategy">${escapeHtml(
      planStrategy(green ? green.depth : null, par, yd)
    )}</div>`;

    return html;
  }

  function openHolePlan(number) {
    const course = getPlannerCourse();
    if (!course || !els.planDetailCard) return;
    const hole = (course.holes || [])[number - 1];
    if (!hole) return;

    els.planDetailTitle.textContent = `Hole ${number}`;
    els.planDetailBody.innerHTML = renderPlanDetail(course, hole);
    els.planDetailCard.hidden = false;
    try {
      els.planDetailCard.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'nearest',
      });
    } catch { }
    haptic(6);
  }

  /* ---------- Planner course search (ephemeral until saved) ----------
     Reuses the round-setup search pipeline (courseNameSearch → Photon
     with Overpass fallback) and the scorecard import pipeline
     (fetchAutoCourseScorecard + buildAutoCourse). A picked course is
     mapped and bound to the planner as EPHEMERAL — it is never written
     to state.courseProfiles unless the user taps Save. */
  let planSearchResults = [];
  let planSearchSeq = 0;
  let planSearchTimer = null;

  function planSearchStatus(html) {
    if (!els.planCourseSearchResults) return;
    els.planCourseSearchResults.hidden = false;
    els.planCourseSearchResults.innerHTML =
      `<div class="prep-search-status">${html}</div>`;
  }

  function clearPlannerSearch() {
    if (els.planCourseSearch) els.planCourseSearch.value = '';
    if (els.planCourseSearchResults) {
      els.planCourseSearchResults.hidden = true;
      els.planCourseSearchResults.innerHTML = '';
    }
    planSearchResults = [];
    planSearchSeq++;
  }

  async function runPlannerCourseSearch() {
    if (!els.planCourseSearch || !els.planCourseSearchResults) return;
    const term = els.planCourseSearch.value.trim();

    if (term.length < COURSE_SEARCH_MIN_CHARS) {
      clearPlannerSearch();
      return;
    }
    const mySeq = ++planSearchSeq;

    if (!state.loc) {
      planSearchStatus('Turn on location to search courses near you.');
      planSearchResults = [];
      return;
    }

    planSearchStatus(`Searching courses named “${escapeHtml(term)}”…`);
    try {
      const results = await courseNameSearch(term, state.loc);
      if (mySeq !== planSearchSeq) return;
      planSearchResults = results;
      if (!results.length) {
        planSearchStatus('No courses matched that name.');
        return;
      }
      els.planCourseSearchResults.innerHTML = results
        .map((c, i) => {
          const km = haversineMeters(state.loc, c) / 1000;
          const dist = km >= 1 ? `${Math.round(km)} km` : `${Math.round(km * 1000)} m`;
          return `
            <button type="button" class="prep-search-row" data-idx="${i}">
              <b>${escapeHtml(c.name)}</b>
              <span>${dist} away · not saved</span>
            </button>`;
        })
        .join('');
    } catch (error) {
      console.warn('Planner course search failed:', error);
      if (mySeq !== planSearchSeq) return;
      planSearchResults = [];
      const msg =
        error && error.name === 'AbortError'
          ? 'Search is taking too long right now.'
          : 'Name search is unavailable right now.';
      planSearchStatus(
        `${escapeHtml(msg)} <button type="button" class="ghost-btn" id="planSearchRetryBtn">Try again</button>`
      );
      const retry = document.getElementById('planSearchRetryBtn');
      if (retry) retry.addEventListener('click', runPlannerCourseSearch);
    }
  }

  function bindEphemeralCourse(course) {
    prepEphemeralCourse = course;
    state.planCourseId = PREP_EPHEMERAL_ID;
    clearPlannerSearch();
    renderPlanner();
    renderPlannerCourse();
    haptic(10);
  }

  async function pickPlannerSearchedCourse(candidate) {
    if (!candidate) return;

    // Already saved under this exact name? Just select the profile.
    const saved = getSavedCourseMatch(candidate.name);
    if (saved) {
      prepEphemeralCourse = null;
      state.planCourseId = saved.id;
      clearPlannerSearch();
      renderPlanner();
      renderPlannerCourse();
      haptic(8);
      return;
    }

    planSearchStatus(`Mapping ${escapeHtml(candidate.name)}…`);
    try {
      const elements = await fetchAutoCourseScorecard(candidate);
      const course = normalizeCourse(buildAutoCourse(candidate, elements));
      bindEphemeralCourse(course);
    } catch (error) {
      console.warn('Planner course mapping failed:', error);
      planSearchStatus(
        `Couldn’t map ${escapeHtml(candidate.name)} right now. <button type="button" class="ghost-btn" id="planSearchRetryBtn">Try again</button>`
      );
      const retry = document.getElementById('planSearchRetryBtn');
      if (retry)
        retry.addEventListener('click', () =>
          pickPlannerSearchedCourse(candidate)
        );
    }
  }

  function savePlannerEphemeralCourse() {
    if (!prepEphemeralCourse) return;
    const name = prepEphemeralCourse.name;
    const course = prepEphemeralCourse;
    prepEphemeralCourse = null;
    saveCourseProfile(course); // existing save path; re-renders planner
    const savedProfile = getSavedCourseMatch(name);
    state.planCourseId = savedProfile ? savedProfile.id : '';
    clearPlannerSearch();
    renderPlanner();
    renderPlannerCourse();
    haptic(12);
  }

  function wirePlannerCourseSearch() {
    if (!els.planCourseSearch) return;

    els.planCourseSearch.addEventListener('input', () => {
      clearTimeout(planSearchTimer);
      planSearchTimer = setTimeout(runPlannerCourseSearch, 400); // debounce
    });

    els.planCourseSearchResults?.addEventListener('click', (e) => {
      const btn = e.target.closest('.prep-search-row');
      if (!btn) return;
      pickPlannerSearchedCourse(planSearchResults[Number(btn.dataset.idx)]);
    });

    els.planSaveCourseBtn?.addEventListener('click', savePlannerEphemeralCourse);
  }

  function initPlanner() {
    if (!els.planCourseSelect) return;
    els.planCourseSelect.addEventListener('change', () => {
      state.planCourseId = els.planCourseSelect.value || '';
      renderPlannerCourse();
      haptic(5);
    });
    wirePlannerCourseSearch();
    renderPlanner();
  }
  // ============================================================
  //  BLOCK 16c — GROUP SCORING
  //  Partners + their scores ride on roundSession (groupPlayers /
  //  groupScores). Player 1 is ALWAYS the user and is implicit — only
  //  partners are stored. Nothing here ever writes to state.round, which
  //  is what keeps the personal stats pipeline clean.
  // ============================================================

  const GROUP_MAX_PARTNERS = 3; // 3 partners + you = a standard foursome

  // Persisted playing-partner roster. Lives OUTSIDE any round so partners
  // can be managed before starting and survive between rounds.
  const GROUP_ROSTER_KEY = 'caddy:groupRoster:v1';

  function loadGroupRoster() {
    const v = load(GROUP_ROSTER_KEY, []);
    return Array.isArray(v)
      ? v.filter(
          (p) =>
            p &&
            typeof p.id === 'string' &&
            typeof p.name === 'string'
        )
      : [];
  }

  function saveGroupRoster(list) {
    save(
      GROUP_ROSTER_KEY,
      Array.isArray(list) ? list.slice(0, GROUP_MAX_PARTNERS) : []
    );
  }

  // Pull a current/finished session's partners into the roster so the next
  // round — and pre-round editing — keeps the same group.
  function mergePartnersIntoRoster(players) {
    if (!Array.isArray(players) || !players.length) return;
    const roster = loadGroupRoster();
    const seen = new Set(roster.map((p) => p.id));
    for (const p of players) {
      if (!p || typeof p.id !== 'string' || seen.has(p.id)) continue;
      if (roster.length >= GROUP_MAX_PARTNERS) break;
      roster.push({
        id: p.id,
        name: String(p.name || 'Player').slice(0, 24),
      });
      seen.add(p.id);
    }
    saveGroupRoster(roster);
  }

  function groupPartners() {
    const rs = state.roundSession;
    if (rs && Array.isArray(rs.groupPlayers)) return rs.groupPlayers;
    // No live round: fall back to the saved roster so partners can be
    // added/removed/renamed before starting and aren't lost between rounds.
    return loadGroupRoster();
  }

  // Lazily create (and size to the course) a partner's score array.
  function partnerScoreArray(partnerId) {
    const rs = state.roundSession;
    if (!rs) return [];
    if (
      !rs.groupScores ||
      typeof rs.groupScores !== 'object'
    ) {
      rs.groupScores = {};
    }
    const n = getCourseHoleCount();
    let arr = rs.groupScores[partnerId];
    if (!Array.isArray(arr)) arr = [];
    while (arr.length < n) arr.push('');
    rs.groupScores[partnerId] = arr;
    return arr;
  }

  function scoreDraftPartnerName() {
    const pid = state._scorePartnerId || '';
    if (!pid) return '';
    const p = groupPartners().find((x) => x.id === pid);
    return p ? p.name : '';
  }

  function groupTotals() {
    const out = [];
    for (const p of groupPartners()) {
      const arr = partnerScoreArray(p.id);
      let total = 0;
      let thru = 0;
      arr.forEach((v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          total += n;
          thru += 1;
        }
      });
      out.push({ id: p.id, name: p.name, total: thru ? total : null, thru });
    }
    return out;
  }

  function renderGroupUI() {
    if (!els.groupTableWrap) return;
    const partners = groupPartners();
    if (els.groupCountChip) {
      els.groupCountChip.textContent = partners.length
        ? `${1 + partners.length} players`
        : 'Solo';
    }
    renderGroupTable();
  }

  function renderGroupEditor() {
    if (!els.groupEditorList) return;
    const partners = groupPartners();
    els.groupEditorList.innerHTML = partners
      .map(
        (p) => `
        <div class="group-editor-row" data-id="${escapeHtml(p.id)}">
          <input type="text" maxlength="24" value="${escapeHtml(p.name)}"
            aria-label="Partner name" />
          <button class="group-editor-remove" type="button"
            aria-label="Remove ${escapeHtml(p.name)}">✕</button>
        </div>`
      )
      .join('');

    els.groupEditorList
      .querySelectorAll('.group-editor-row')
      .forEach((row) => {
        const id = row.dataset.id;
        const input = row.querySelector('input');
        input.addEventListener('change', () => {
          const name = input.value.trim() || 'Player';
          // QA-003: renames must not collide with another partner either.
          if (partnerNameTaken(name, id)) {
            setNotice(`"${name}" is already in the group.`, 'danger');
            haptic(12);
            input.value =
              groupPartners().find((x) => x.id === id)?.name || name;
            return;
          }
          const rs = state.roundSession;
          const inSession =
            rs && Array.isArray(rs.groupPlayers)
              ? rs.groupPlayers.find((x) => x.id === id)
              : null;
          if (inSession) {
            inSession.name = name;
            saveRoundSession();
          }
          const roster = loadGroupRoster();
          const inRoster = roster.find((x) => x.id === id);
          if (inRoster) {
            inRoster.name = name;
            saveGroupRoster(roster);
          }
          renderGroupUI();
        });
        row
          .querySelector('.group-editor-remove')
          .addEventListener('click', () => {
            const p = groupPartners().find((x) => x.id === id);
            if (
              !p ||
              !confirm(
                `Remove ${p.name}${
                  state.roundSession ? ' and their scores from this round' : ''
                }?`
              )
            ) {
              return;
            }
            if (
              state.roundSession &&
              Array.isArray(state.roundSession.groupPlayers)
            ) {
              state.roundSession.groupPlayers =
                state.roundSession.groupPlayers.filter((x) => x.id !== id);
              delete state.roundSession.groupScores[id];
              if (state._scorePartnerId === id) state._scorePartnerId = '';
              saveRoundSession();
            }
            saveGroupRoster(loadGroupRoster().filter((x) => x.id !== id));
            renderGroupUI();
            renderRound();
            haptic(8);
          });
      });
  }

  function renderGroupTable() {
    if (!els.groupTableWrap) return;
    const partners = groupPartners();
    const n = getCourseHoleCount();
    const mine = getScorecardRows();

    if (!partners.length) {
      els.groupTableWrap.innerHTML =
        '<div class="hint">No partners yet — add them above and their scores will appear beside yours.</div>';
      return;
    }

    const inRound = !!state.roundSession;
    const totalsById = {};
    if (inRound)
      groupTotals().forEach((g) => (totalsById[g.id] = g));

    const holeHeads = Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('');

    const sumRow = (cells, cls) =>
      `<tr>${cells}</tr>`.replace('<tr>', `<tr${cls ? ` class="${cls}"` : ''}>`);

    // Your row: read-only mirror of the main scorecard.
    const yourCells = [
      '<td>You</td>',
      ...Array.from({ length: n }, (_, i) => {
        const v = mine[i] ? mine[i].score : '';
        return `<td>${v === '' ? '·' : escapeHtml(v)}</td>`;
      }),
    ].join('');
    const yourTotal = summarizeRound(mine).totalScore;

    const partnerRows = partners
      .map((p) => {
        const arr = inRound ? partnerScoreArray(p.id) : [];
        const tot = totalsById[p.id];
        // Every row needs the trailing Tot cell or the columns misalign
        // against the header and your row.
        const totalCell =
          inRound && tot && tot.thru
            ? `<td class="group-total">${tot.total}</td>`
            : '<td>·</td>';
        const scoreCells = Array.from({ length: n }, (_, i) => {
          if (!inRound) return '<td>·</td>';
          const v = arr[i];
          return `<td><input type="number" inputmode="numeric" min="1" max="15"
                value="${escapeHtml(v)}" data-pid="${escapeHtml(p.id)}"
                data-i="${i}" aria-label="${escapeHtml(p.name)} hole ${i + 1}" /></td>`;
        }).join('');
        return `<tr class="group-partner-row" data-pid="${escapeHtml(
          p.id
        )}"><td class="group-name-cell">${escapeHtml(p.name)}</td>${scoreCells}${totalCell}</tr>`;
      })
      .join('');

    const yourTotalCells =
      yourCells + `<td class="group-total">${yourTotal || '·'}</td>`;

    els.groupTableWrap.innerHTML = `
      <div class="group-table-scroll">
        <table class="group-table">
          <thead><tr><th>Hole</th>${holeHeads}<th>Tot</th></tr></thead>
          <tbody>
            ${sumRow(yourTotalCells)}
            ${partnerRows}
          </tbody>
        </table>
      </div>
      ${
        inRound
          ? ''
          : '<div class="hint" style="margin-top:6px">Start a round to enter partner scores.</div>'
      }`;

    els.groupTableWrap.querySelectorAll('input[data-pid]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const arr = partnerScoreArray(inp.dataset.pid);
        arr[Number(inp.dataset.i)] = sanitizeInt(inp.value);
        saveRoundSession();
        renderGroupTable();
      });
    });

    // Tap a partner's name → rename (or long-press-style second option:
    // remove) via the partner sheet — no separate editor list needed.
    els.groupTableWrap
      .querySelectorAll('.group-partner-row .group-name-cell')
      .forEach((cell) => {
        cell.addEventListener('click', () => {
          const pid = cell.closest('.group-partner-row')?.dataset.pid;
          if (pid) openPartnerSheet(pid);
        });
      });
  }

  function renderScoreSheetChips() {
    if (!els.roundScoreChips) return;
    const partners = groupPartners();
    if (!partners.length) {
      els.roundScoreChips.hidden = true;
      els.roundScoreChips.innerHTML = '';
      return;
    }
    els.roundScoreChips.hidden = false;
    const cur = state._scorePartnerId || '';
    const chip = (label, pid) =>
      `<button class="club-chip${cur === pid ? ' active' : ''}"
        data-pid="${escapeHtml(pid)}" type="button">${escapeHtml(label)}</button>`;
    els.roundScoreChips.innerHTML =
      chip('You', '') + partners.map((p) => chip(p.name, p.id)).join('');

    els.roundScoreChips
      .querySelectorAll('.club-chip')
      .forEach((b) => {
        b.addEventListener('click', () => {
          state._scorePartnerId = b.dataset.pid || '';
          // Stay on the hole being edited, not the current hole.
          state.roundScoreDraft = getRoundScoreDraftForHole(
            state._scoreSheetHole || getCurrentHoleNumber()
          );
          // Repaint the chips so the tapped name gets the green .active
          // state — the sheet re-render alone never touched these buttons.
          renderScoreSheetChips();
          renderRoundScoreSheet();
          haptic(5);
        });
      });
  }

  function initGroupEvents() {
    if (!els.addPartnerBtn) return;
    // Premium path: the partner sheet (same one the options sheet uses),
    // not the browser prompt. Adding mid-round goes straight to the
    // session; the roster merge happens inside the sheet's commit.
    els.addPartnerBtn.addEventListener('click', () => {
      if (groupPartners().length >= GROUP_MAX_PARTNERS) {
        setNotice(
          `Maximum ${GROUP_MAX_PARTNERS} partners (foursome).`,
          'danger'
        );
        return;
      }
      openPartnerSheet();
    });
  }
  // ============================================================
  //  BLOCK 17 — SELF-CHECK (dev only; safe to ship, costs nothing until called)
  // ============================================================
  window.__caddySelfTest = function () {
    const out = [];
    const ok = (name, pass, detail) => out.push(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);

    // 0. Onboarding gate: first-run shows, set-flag stays quiet.
    try {
      const obPrev = localStorage.getItem(ONBOARD_KEY);
      localStorage.removeItem(ONBOARD_KEY);
      const showsFirstRun = shouldShowOnboard();
      localStorage.setItem(ONBOARD_KEY, '1');
      const quietAfterSet = !shouldShowOnboard();
      if (obPrev === null) localStorage.removeItem(ONBOARD_KEY);
      else localStorage.setItem(ONBOARD_KEY, obPrev);
      ok('Onboarding gate: shows when key absent, quiet once set',
        showsFirstRun && quietAfterSet,
        `absent→show=${showsFirstRun}, set→hide=${quietAfterSet}`);
    } catch { /* storage unavailable in host */ }

    // 1. Geodesy: meridian arc, lat 40->41 on WGS-84.
    // Simpson's rule on M(φ)=a(1-e²)/(1-e²sin²φ)^1.5 over 40°..41° gives 111046.6 m;
    // cross-checks against the standard table value of 111.048 km per degree at 40.5°.
    const g = geodesicInverse({ lat: 40, lng: -105 }, { lat: 41, lng: -105 });
    ok('Vincenty meridian arc 40°→41°', Math.abs(g.s - 111046.6) < 5, `${g.s.toFixed(1)} m (expect ≈111047 m)`);

    // 2. Direct/inverse round trip.
    const p2 = geodesicDirect({ lat: 33.5, lng: -84.4 }, 73.2, 4211.7);
    const back = geodesicInverse({ lat: 33.5, lng: -84.4 }, p2);
    ok('Geodesic direct/inverse round trip', Math.abs(back.s - 4211.7) < 1e-3 && Math.abs(angleDiff(back.az1, 73.2)) < 1e-6,
      `Δs=${(back.s - 4211.7).toExponential(2)} m`);

    // 3. Air density at CIPM reference: 20 °C, 101325 Pa, 50% RH -> 1.1992 kg/m³.
    const rho = airDensityCIPM(20, 101325, 50);
    ok('CIPM-2007 density @20°C/101325Pa/50%RH', Math.abs(rho - 1.1992) < 0.0005, `${rho.toFixed(5)} kg/m³`);

    // 4. Standard atmosphere: ISA at 5000 ft -> 843.1 hPa.
    const pIsa = pressureFromISA(5000 * FT_TO_M) / 100;
    ok('ISA pressure @5000 ft', Math.abs(pIsa - 843.1) < 1.0, `${pIsa.toFixed(1)} hPa`);

    // 5. Special functions.
    ok('erf(1)', Math.abs(erf(1) - 0.8427007929) < 1e-9, erf(1).toFixed(10));
    ok('invNorm(0.975)', Math.abs(invNorm(0.975) - 1.959963985) < 1e-8, invNorm(0.975).toFixed(9));
    ok('tQuantile(0.975, 10)', Math.abs(tQuantile(0.975, 10) - 2.228138852) < 1e-6, tQuantile(0.975, 10).toFixed(9));
    ok('chi2Inv(0.995, 2)', Math.abs(chi2Inv(0.995, 2) - 10.5966347) < 1e-5, chi2Inv(0.995, 2).toFixed(7));

    // 6. Trajectory family monotone and physically plausible.
    const F = referenceLaunchFamily();
    let mono = true;
    for (let i = 1; i < F.rows.length; i++) if (F.rows[i].carryYd <= F.rows[i - 1].carryYd) mono = false;
    ok('Launch family monotone in carry', mono, `${fmt(F.minCarry)}–${fmt(F.maxCarry)} yd`);
    const drv = [...F.rows].reverse().find((r) => !r.extended);
    ok('Driver carry plausible (230–320 yd)', drv.carryYd > 230 && drv.carryYd < 320, `${drv.carryYd.toFixed(1)} yd`);

    // 6b. Truncation guard. TRAJ_DT and the step budget are coupled: if dt shrinks
    // without the cap rising, long trajectories end mid-flight and the entire
    // plays-like scale compresses — while the identity test below still passes.
    const drvTraj = integrateTrajectory(
      { speedMps: 167 * MPH_TO_MPS, launchDeg: 10.9, spinRadS: 2686 * RPM_TO_RADS, aimOffsetDeg: 0 },
      STILL_AIR_ENV
    );
    ok('Driver trajectory reaches the ground (not step-capped)', drvTraj.reached === true,
      `t=${drvTraj.timeS.toFixed(2)} s of ${(TRAJ_MAX_STEPS * TRAJ_DT).toFixed(1)} s budget`);
    ok('Driver descent angle plausible (32–48°)',
      drvTraj.descentDeg > 32 && drvTraj.descentDeg < 48, `${drvTraj.descentDeg.toFixed(1)}°`);

    // 7. Inverse solver identity: standard conditions must be a fixed point.
    const idn = playsLike({
      horizontalYd: 165, bearingDeg: 0, elevDiffFt: 0,
      courseAltitudeFt: 0, tempF: STD_TEMP_F, rh: STD_RH, windMph: 0, windFromDeg: 0, latDeg: STD_LAT
    });
    ok('Plays-like identity in standard conditions', Math.abs(idn.playsLikeYd - 165) <= 1, `${idn.playsLikeYd} yd`);

    // 8. Monotonicity and direction of each physical effect at 165 yd.
    const base = (o) => playsLike(Object.assign({
      horizontalYd: 165, bearingDeg: 0, elevDiffFt: 0,
      courseAltitudeFt: 0, tempF: STD_TEMP_F, rh: STD_RH, windMph: 0, windFromDeg: 0, latDeg: STD_LAT
    }, o)).playsLikeYd;
    ok('Headwind plays longer', base({ windMph: 15, windFromDeg: 0 }) > 165 + 6, `${base({ windMph: 15, windFromDeg: 0 })} yd`);
    ok('Tailwind plays shorter', base({ windMph: 15, windFromDeg: 180 }) < 165 - 3, `${base({ windMph: 15, windFromDeg: 180 })} yd`);
    ok('Headwind costs more than tail gains (asymmetry)',
      (base({ windMph: 15, windFromDeg: 0 }) - 165) > (165 - base({ windMph: 15, windFromDeg: 180 })));
    ok('Uphill plays longer', base({ elevDiffFt: 30 }) > 165 + 6, `${base({ elevDiffFt: 30 })} yd`);
    ok('Altitude plays shorter', base({ courseAltitudeFt: 5280 }) < 165 - 6, `${base({ courseAltitudeFt: 5280 })} yd`);
    ok('Cold plays longer', base({ tempF: 40 }) > 165, `${base({ tempF: 40 })} yd`);
    ok('Humid plays marginally longer (shorter required)', base({ rh: 95 }) <= base({ rh: 5 }));

    // 9. Wind sign convention consistency (the bug that was fixed).
    const wc = windComponents({ windMph: 10, windFromDeg: 90, bearingDeg: 0 });
    const wr = windRelative(90, 0, 10);
    ok('windComponents/windRelative crosswind signs agree', Math.sign(wc.crosswindMph) === Math.sign(wr.cross),
      `${wc.crosswindMph.toFixed(2)} vs ${wr.cross.toFixed(2)}`);
    ok('Wind from the east on a north shot is from the right', wc.crosswindMph > 0);

    // 10. Expected-strokes baselines sane and monotone.
    ok('E[strokes] fairway monotone 100→200 yd', expectedStrokes('fairway', 200) > expectedStrokes('fairway', 100));
    ok('Rough costs more than fairway', expectedStrokes('rough', 150) > expectedStrokes('fairway', 150));
    ok('E[strokes] 8 ft putt ≈ 1.5', Math.abs(expectedStrokes('green', 8 / 3) - 1.515) < 0.05);

    // 11. Dispersion posterior shrinks with data.
    const prior = formulaDispersionYd(165);
    ok('Prior dispersion plausible at 165 yd', prior >= 8 && prior <= 22, `±${prior} yd`);

    // 12. GPS fuser is not overconfident.
    const fx = Array.from({ length: 10 }, () => ({ lat: 33.5, lng: -84.4, accuracy: 10, ts: Date.now() }));
    const fused = weightedAverage(fx);
    ok('Fused accuracy respects correlated-error floor', fused.accuracy >= GPS_CORRELATED_FRAC * 10,
      `±${fused.accuracy.toFixed(2)} m from ten ±10 m fixes`);

    // 13. Hazard cost model: carry pricing, off-line falloff.
    const hzLine = [{ type: 'water', alongYd: 130, crossYd: 0 }];
    ok('Hazard cost is positive over water', hazardCostStrokes(135, 0, hzLine) > 0);
    ok('Hazard cost is zero once carried', hazardCostStrokes(160, 0, hzLine) === 0);
    ok('Hazard cost fades off-line',
      hazardCostStrokes(135, 0, hzLine) > hazardCostStrokes(135, 25, hzLine));

    // 14. End-to-end: water guarding a 150 yd target at 130 yd must change
    // the plan (different club, effort, aim, or advice) vs dry ground.
    {
      const sClubs = state.clubs, sTarget = state.target, sLoc = state.loc, sCalc = state.lastCalc;
      state.clubs = [
        { id: 't1', name: '8-iron', yards: 145 },
        { id: 't2', name: '7-iron', yards: 160 },
      ];
      state.target = { lat: 33.5, lng: -84.4 };
      state.loc = { lat: 33.49782, lng: -84.4 }; // ≈150 yd south of target
      state.lastCalc = null;
      const dry = recommendSmart(150, null, 0, 0, {});
      const wet = recommendSmart(150, null, 0, 0, { hazards: hzLine });
      ok('Water changes the plan vs dry ground',
        wet.main !== dry.main ||
        wet.eff !== dry.eff ||
        (wet.aimLateral || 0) !== (dry.aimLateral || 0) ||
        JSON.stringify(wet.tips) !== JSON.stringify(dry.tips),
        `dry=${dry.main} / wet=${wet.main}`);
      state.clubs = sClubs; state.target = sTarget; state.loc = sLoc; state.lastCalc = sCalc;
    }

    // 15. Scorecard tap-cycle logic: score steps, FIR skips Y on par 3,
    // played-par basis is honest mid-round.
    {
      const sRound = state.round, sSession = state.roundSession;
      state.round = [
        { hole: 1, score: '', putts: '', fir: '', gir: '' },
        { hole: 2, score: '', putts: '', fir: '', gir: '' },
        { hole: 3, score: '', putts: '', fir: '', gir: '' },
      ];
      state.roundSession = {
        course: { id: 't', name: 'T', holesCount: 3, holes: [
          { number: 1, par: 4 }, { number: 2, par: 4 }, { number: 3, par: 3 },
        ] },
        hole: 1, currentHole: 1, status: 'active', scorecard: state.round,
      };
      cycleRoundCell(0, 'score'); // '' → 1
      cycleRoundCell(0, 'score'); // 1 → 2
      ok('Score cycle steps upward', Number(state.round[0].score) === 2,
        `score=${state.round[0].score}`);
      cycleRoundCell(0, 'putts');
      ok('Putts cycle starts at 0', Number(state.round[0].putts) === 0);
      cycleRoundCell(1, 'fir'); // par-4: '' → Y
      ok('FIR cycle on par 4 starts at Y', state.round[1].fir === 'Y');
      // Par-3 hole must skip the meaningless Y step.
      cycleRoundCell(2, 'fir');
      ok('FIR cycle on par 3 skips Y', state.round[2].fir === 'N',
        `fir=${state.round[2].fir}`);
      // Score the second hole, then played-par must count holes 1+2 only.
      cycleRoundCell(1, 'score'); // '' → 1
      const played = scoreParPlayed(state.roundSession.course, state.round);
      ok('Played-par basis counts only scored holes', played === 8,
        `parPlayed=${played}`);
      state.round = sRound; state.roundSession = sSession;
    }

    // 16. Tee system: applyTeeSet rewrites yardages/tee points/pars,
    // saveCourseProfile keeps ONE profile per course name across tees,
    // and tee memory round-trips per course.
    {
      const sProfiles = state.courseProfiles;
      try { localStorage.removeItem('caddy:courseTees'); } catch {}

      const course = {
        id: 'tee-test', name: 'Tee Test CC', teeName: 'Blue',
        activeTeeSet: 'Blue', holesCount: 9,
        holes: Array.from({ length: 9 }, (_, i) => ({
          number: i + 1, par: 4, yards: 300,
        })),
        teeSets: [
          { name: 'Blue', holes: { 1: { lat: 33.0, lng: -84.0, yards: 400 } } },
          { name: 'White', holes: { 1: { lat: 33.001, lng: -84.0, yards: 360 } } },
        ],
      };
      course.holes[0].parByTee = { White: 5 };

      const applied = applyTeeSet(normalizeCourse(course), 'White');
      const h1 = applied.holes[0];
      ok('applyTeeSet swaps yardage + tee point',
        h1.yards === 360 && h1.teePoint && h1.teePoint.lat === 33.001,
        `yards=${h1.yards} tee=${h1.teePoint && h1.teePoint.lat}`);
      ok('applyTeeSet applies per-tee par', h1.par === 5, `par=${h1.par}`);

      // Saving the same course from two different tees must NOT fork
      // duplicate profiles — one card per course.
      state.courseProfiles = [];
      saveCourseProfile(normalizeCourse({ ...course, teeName: 'Blue' }));
      saveCourseProfile(normalizeCourse({ ...course, teeName: 'White' }));
      ok('saveCourseProfile dedupes by course name',
        state.courseProfiles.length === 1 &&
        state.courseProfiles[0].teeName === 'White',
        `profiles=${state.courseProfiles.length}`);

      rememberCourseTees(applied);
      const mem = load('caddy:courseTees', {})['tee test cc'];
      ok('Tee memory persists per course',
        !!mem && mem.activeTeeSet === 'White',
        mem ? `set=${mem.activeTeeSet}` : 'missing');

      state.courseProfiles = sProfiles;
    }

    // 17. Planner course search: ephemeral binding + save promotion.
    {
      const sProfiles = state.courseProfiles;
      const sPlanId = state.planCourseId;
      const sEphem = prepEphemeralCourse;
      try {
        state.courseProfiles = [];

        const mkCourse = (id, name) => normalizeCourse({
          id, name, teeName: 'Regular tees', holesCount: 9,
          holes: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, yards: 320 })),
        });

        // Ephemeral course shows up as '@prep-search · not saved'.
        prepEphemeralCourse = mkCourse('eph-test', 'Search Test GC');
        state.planCourseId = PREP_EPHEMERAL_ID;
        const opts = planCourseOptions();
        ok('ephemeral searched course appears in planner options',
          opts.some((o) => o.id === PREP_EPHEMERAL_ID && /not saved/.test(o.name)),
          opts.map((o) => o.id).join(','));

        // holeInfo resolves through the ephemeral course too.
        const info = window.CaddyPrep.holeInfo(1);
        ok('holeInfo binds via ephemeral course',
          !!info && info.number === 1,
          info ? `course=${info.courseName}` : 'null');

        // Saving promotes it into courseProfiles and re-points the picker.
        state.planCourseId = PREP_EPHEMERAL_ID;
        savePlannerEphemeralCourse();
        ok('save promotes ephemeral course into profiles',
          state.courseProfiles.length === 1 &&
            state.planCourseId === state.courseProfiles[0].id &&
            prepEphemeralCourse === null,
          `profiles=${state.courseProfiles.length} planId=${state.planCourseId}`);

        // Picking a name that matches a saved profile selects it — no dup.
        pickPlannerSearchedCourse({ name: 'search test gc', lat: 33, lng: -84 });
        ok('picking a saved course name selects the profile (no dup)',
          state.courseProfiles.length === 1 &&
            state.planCourseId === state.courseProfiles[0].id,
          `profiles=${state.courseProfiles.length} planId=${state.planCourseId}`);
      } finally {
        state.courseProfiles = sProfiles;
        state.planCourseId = sPlanId;
        prepEphemeralCourse = sEphem;
      }
    }

    // 17b. Start-round gate (v1.0.69): beginRound is the single choke
    // point — while courseMappingState is 'mapping'/'failed' it must
    // refuse and leave any existing session untouched.
    {
      const sSession = state.roundSession;
      const sMap = state.courseMappingState;
      try {
        state.roundSession = null;
        state.courseMappingState = 'mapping';
        state.courseMappingName = 'Gate Test GC';
        const refused = beginRound(makeCasualCourse(), 1);
        ok('beginRound refuses while scorecard mapping is in flight',
          refused === null && state.roundSession === null,
          `returned=${JSON.stringify(refused)} session=${state.roundSession}`);

        state.courseMappingState = 'idle';
        beginRound(makeCasualCourse(), 1);
        const allowed = state.roundSession !== null;
        state.roundSession = null;
        ok('beginRound proceeds once mapping is idle', allowed,
          `session created=${allowed}`);
      } finally {
        state.roundSession = sSession;
        state.courseMappingState = sMap;
      }
    }

    // 17c. Collapsed detent band math (v1.0.69): the collapsed peek is a
    // slim ~72px summary, not the old 150px header — the sheet's collapsed
    // offset must use the compact band so no dead slab shows.
    {
      const dragEl = els.sheetDrag;
      const peekNode = els.sheet ? els.sheet.querySelector('.sheet-peek') : null;
      const dragH = dragEl ? Number(dragEl.offsetHeight) || 130 : 130;
      const peekH = peekNode ? Number(peekNode.offsetHeight) || 0 : 0;
      const band = Math.min(120, Math.max(56, dragH - peekH)) || 72;
      ok('Collapsed detent band stays slim (≤120px, ≥56px)',
        band >= 56 && band <= 120,
        `drag=${dragH}px peek=${peekH}px band=${band}px`);
    }

    console.log(out.join('\n'));
    return out;
  };

  /* ================= Overpass transport: mirrors + timeout + cache ================= */

  // kumi.systems is gone (its redirect can turn a POST into a GET landing
  // page) and api.de rate-limits browsers hard, so friendlier mirrors lead.
  const OVERPASS_ENDPOINTS = [
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.osm.jp/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];
  // Fire the next mirror if the current one hasn't answered within this
  // window and let whichever finishes first win.
  const OVERPASS_HEDGE_MS = 1800;
  const OSM_CACHE_PREFIX = 'osm:v2:';                  // v2 == invalidates the old buggy data
  const OSM_CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
  const OSM_CACHE_MAX_ENTRIES = 20;
  // v1.0.70: after the hedged mirror round comes back empty or fully failed,
  // wait this long and re-query the primary once before concluding 'not found'.
  const OVERPASS_RETRY_BACKOFF_MS = 1500;

  function osmSleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function osmCacheGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const rec = JSON.parse(raw);
      if (!rec || Date.now() - rec.t > rec.ttl) return null;
      return rec.v;
    } catch {
      return null;
    }
  }

  function osmCacheSet(key, value, ttl) {
    const write = () =>
      localStorage.setItem(key, JSON.stringify({ t: Date.now(), ttl, v: value }));
    try {
      write();
    } catch {
      // Quota: evict oldest osm: entries, retry once.
      try {
        const entries = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(OSM_CACHE_PREFIX)) {
            try {
              entries.push({ k, t: JSON.parse(localStorage.getItem(k)).t || 0 });
            } catch { }
          }
        }
        entries
          .sort((a, b) => a.t - b.t)
          .slice(0, Math.max(1, entries.length - OSM_CACHE_MAX_ENTRIES))
          .forEach((e) => localStorage.removeItem(e.k));
        write();
      } catch { }
    }
  }

  /**
   * Hedged mirror failover. Mirrors start sequentially; the next launches
   * after OVERPASS_HEDGE_MS even if the current one is still working, and
   * whichever answers first wins. GET with `data=` is accepted by all
   * mirrors and avoids the redirect problems of the old POST form.
   * Returns an Array of elements with a non-enumerable `.meta` on it.
   */
  function overpassOnce(endpoint, encodedQuery, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const separator = endpoint.includes('?') ? '&' : '?';

    return fetch(`${endpoint}${separator}data=${encodedQuery}`, {
      method: 'GET',
      mode: 'cors',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (response.status === 429 || response.status === 504) {
          throw new Error(`Overpass is busy (${response.status}).`);
        }
        if (!response.ok) {
          throw new Error(`Overpass HTTP ${response.status}.`);
        }
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch {
          throw new Error(
            'Overpass returned an invalid response. Please try again.'
          );
        }
      })
      .finally(() => clearTimeout(timer));
  }

  /**
   * v1.0.70 retry ladder: mirrors sometimes answer with a transiently EMPTY
   * result (or fail outright) while an immediate retry succeeds. Run the
   * hedged mirror round once; if it yields nothing, back off briefly and
   * re-query the primary before letting the caller conclude 'not found'.
   * - attemptAll()  -> Promise<elements[]> (hedged mirrors; may resolve empty)
   * - queryPrimary()-> Promise<elements[]> (single primary re-query)
   * Resolves empty ONLY when every attempt agreed there is nothing there.
   */
  async function overpassRetryLadder({
    attemptAll,
    queryPrimary,
    backoffMs = OVERPASS_RETRY_BACKOFF_MS,
    sleep = osmSleep,
  }) {
    let firstError = null;
    try {
      const els = await attemptAll();
      if (els.length) return els;
    } catch (err) {
      firstError = err;
    }
    console.warn(
      'Overpass: ' +
        (firstError
          ? `all mirrors failed (${firstError.message})`
          : 'all mirrors returned an empty result') +
        ` — retrying primary once after ${backoffMs}ms`
    );
    await sleep(backoffMs);
    try {
      const els = await queryPrimary();
      if (els.length) {
        els.meta = Object.assign({}, els.meta || {}, { retried: true });
      }
      return els; // authoritative empty is a valid "not found"
    } catch (retryError) {
      throw firstError || retryError;
    }
  }

  async function overpassFetch(query, opts = {}) {
    const {
      timeoutMs = 45000,
      cacheKey = null,
      cacheTtlMs = OSM_CACHE_TTL_MS,
    } = opts;

    if (cacheKey) {
      const hit = osmCacheGet(cacheKey);
      if (hit && Array.isArray(hit)) {
        hit.meta = { cached: true, endpoint: 'cache' };
        return hit;
      }
    }

    const encodedQuery = encodeURIComponent(query.trim());

    // Hedged mirror round (unchanged behavior), wrapped so the retry
    // ladder can re-query the primary if the round comes back empty.
    const attemptMirrors = () =>
      new Promise((resolve, reject) => {
      const total = OVERPASS_ENDPOINTS.length;
      let nextIndex = 0;
      let failures = 0;
      let settled = false;
      let hedgeTimer = null;
      let lastError = null;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(hedgeTimer);
        fn(value);
      };

      const launchNext = () => {
        if (settled || nextIndex >= total) return;
        const endpoint = OVERPASS_ENDPOINTS[nextIndex++];

        clearTimeout(hedgeTimer);
        if (nextIndex < total) {
          hedgeTimer = setTimeout(launchNext, OVERPASS_HEDGE_MS);
        }

        overpassOnce(endpoint, encodedQuery, timeoutMs).then(
          (json) => {
            const elements = Array.isArray(json.elements)
              ? json.elements
              : [];
            elements.meta = {
              endpoint,
              cached: false,
              remark: json.remark || null,
            };
            if (cacheKey && elements.length) {
              osmCacheSet(cacheKey, elements, cacheTtlMs);
            }
            finish(resolve, elements);
          },
          (error) => {
            lastError = error;
            failures += 1;
            console.warn(`Overpass failed at ${endpoint}`, error);
            if (nextIndex < total) launchNext();
            else if (failures >= total) {
              finish(
                reject,
                lastError || new Error('All Overpass endpoints failed')
              );
            }
          }
        );
      };

      launchNext();
      });

    const queryPrimary = async () => {
      const endpoint = OVERPASS_ENDPOINTS[0];
      const json = await overpassOnce(endpoint, encodedQuery, timeoutMs);
      const elements = Array.isArray(json.elements) ? json.elements : [];
      elements.meta = {
        endpoint,
        cached: false,
        remark: json.remark || null,
        retried: true,
      };
      if (cacheKey && elements.length) {
        osmCacheSet(cacheKey, elements, cacheTtlMs);
      }
      return elements;
    };

    return overpassRetryLadder({
      attemptAll: attemptMirrors,
      queryPrimary,
      backoffMs: OVERPASS_RETRY_BACKOFF_MS,
    });
  }

  /* ================= OSM geometry helpers (planar, lng convention) ================= */

  const OSM_M_PER_DEG = 111320;
  const OSM_YD_PER_M = 1.0936133;

  function osmXY(lat, lng, refLat) {
    return {
      x: lng * OSM_M_PER_DEG * Math.cos((refLat * Math.PI) / 180),
      y: lat * OSM_M_PER_DEG,
    };
  }

  function osmDistM(a, b) {
    const refLat = (a.lat + b.lat) / 2;
    const pa = osmXY(a.lat, a.lng, refLat);
    const pb = osmXY(b.lat, b.lng, refLat);
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
  }

  const osmDistYds = (a, b) => osmDistM(a, b) * OSM_YD_PER_M;

  // Overpass geometry nodes are {lat, lon}. Normalize to {lat, lng}.
  function osmGeomLatLng(g) {
    return { lat: g.lat, lng: g.lon != null ? g.lon : g.lng };
  }

  function osmPathLatLng(el) {
    if (!el || !Array.isArray(el.geometry) || el.geometry.length < 2) return null;
    return el.geometry.map(osmGeomLatLng);
  }

  function osmPathLengthYds(path) {
    let m = 0;
    for (let i = 1; i < path.length; i++) m += osmDistM(path[i - 1], path[i]);
    return m * OSM_YD_PER_M;
  }

  // Closed-ring vertex list for areas (way, or first outer member of a relation).
  function osmRing(el) {
    if (!el) return null;
    if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 3) {
      const pts = el.geometry.map(osmGeomLatLng);
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9) pts.pop();
      return pts;
    }
    if (el.type === 'relation' && Array.isArray(el.members)) {
      const outer = el.members.find(
        (m) => m.role === 'outer' && Array.isArray(m.geometry)
      );
      if (outer) return osmRing({ type: 'way', geometry: outer.geometry });
    }
    return null;
  }

  // Replaces the old osmFeaturePoint. Node -> its coords; area -> ring centroid;
  // last resort -> element.center (only for nearby-course candidates).
  function osmFeaturePoint(element) {
    if (!element) return null;
    const eLng = element.lon != null ? element.lon : element.lng;
    if (Number.isFinite(element.lat) && Number.isFinite(eLng)) {
      return { lat: Number(element.lat), lng: Number(eLng) };
    }
    const ring = osmRing(element);
    if (ring && ring.length) {
      let la = 0;
      let ln = 0;
      ring.forEach((p) => {
        la += p.lat;
        ln += p.lng;
      });
      return { lat: la / ring.length, lng: ln / ring.length };
    }
    if (element.center && Number.isFinite(element.center.lat)) {
      const cLng =
        element.center.lon != null ? element.center.lon : element.center.lng;
      return { lat: Number(element.center.lat), lng: Number(cLng) };
    }
    return null;
  }

  function osmPointInRing(pt, ring) {
    const refLat = pt.lat;
    const p = osmXY(pt.lat, pt.lng, refLat);
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = osmXY(ring[i].lat, ring[i].lng, refLat);
      const b = osmXY(ring[j].lat, ring[j].lng, refLat);
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      ) {
        inside = !inside;
      }
    }
    return inside;
  }

  // Min distance from a point to a polyline, meters. Used to filter hazards.
  function osmDistPointToPathM(pt, path) {
    const refLat = pt.lat;
    const p = osmXY(pt.lat, pt.lng, refLat);
    let best = Infinity;
    for (let i = 1; i < path.length; i++) {
      const a = osmXY(path[i - 1].lat, path[i - 1].lng, refLat);
      const b = osmXY(path[i].lat, path[i].lng, refLat);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1e-9;
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(
        best,
        Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
      );
    }
    return best;
  }

  // ============================================================
  //  OSM STANDARD BASEMAP (Option A) — worldwide, no key, no account
  //  Themed-vector (Option C) will later swap this base layer.
  // ============================================================
  (() => {
    function buildOsmStd() {
      return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 21,
        maxNativeZoom: 19,
        crossOrigin: true,
        updateWhenIdle: true,
        keepBuffer: 2,
        className: 'osm-std-tiles',
      });
    }
    function ensureLayer() {
      if (!state.mapReady || !state.layers || state.layers.osmstd) return;
      state.layers.osmstd = buildOsmStd();
    }

    // Reassign LOCAL bindings (all one closure — no window.* needed).
    const _initMap = initMap;
    initMap = function () {
      _initMap();
      ensureLayer();
    };

    const _setMapLayer = setMapLayer;
    setMapLayer = function (name, silent) {
      if (name !== 'osmstd') return _setMapLayer(name, silent);
      ensureLayer();
      if (!state.mapReady) return;
      const all = [state.layers.satellite, state.layers.osmstd];
      all.forEach((l) => {
        if (l && state.map.hasLayer(l)) state.map.removeLayer(l);
      });
      state.layers.osmstd.addTo(state.map);
      els.rangeWrap.classList.remove('is-sat');
      state.prefs.mapLayer = 'osmstd';
      save('caddy:prefs', state.prefs);
      updateAimColor();
      restyleShotLines();
      if (state.loc && state.target) {
        renderDispersionZone(
          initialBearingDeg(state.loc, state.target),
          state.clubs.find((c) => c.id === state.lastRecClubId) || null
        );
      }
      ['lineCasing', 'lineHalo', 'line', 'target', 'user'].forEach((k) => {
        if (state.markers[k] && state.markers[k].bringToFront)
          state.markers[k].bringToFront();
      });
    };

    const _updateAimColor = updateAimColor;
    updateAimColor = function () {
      if (state.prefs.mapLayer === 'osmstd') {
        document.documentElement.style.setProperty('--aim', '#1677ff');
        return;
      }
      _updateAimColor();
    };

    const _isImagery = isImagery;
    isImagery = function () {
      if (state.prefs.mapLayer === 'osmstd') return false;
      return _isImagery();
    };
  })();
  /* ============================================================
     PREMIUM MAP UI — wind detail popover, distance rings, live
     shot line, and the draggable shot-start flag.
  ============================================================ */

  /* ---------- Wind detail popover ---------- */
  function windPopIsOpen() {
    return !!els.windPop && !els.windPop.hidden;
  }
  function renderWindPop() {
    if (!els.windPop || !els.windPopSpeed) return;
    const w = getWeatherOrNeutral();
    const hasLive = !!state.context.weather;
    const towardDeg = (w.windFromDeg + 180) % 360;
    const needle = $('windPopNeedle');
    if (needle) needle.style.transform = `rotate(${towardDeg}deg)`;
    els.windPopSpeed.textContent = hasLive ? `${fmt(w.windMph)} mph` : '—';
    els.windPopDir.textContent = hasLive
      ? `from ${bearingToCompass(w.windFromDeg)}`
      : 'no live wind';

    let shot;
    if (hasLive && w.windMph >= 1 && state.lastCalc) {
      const c = state.lastCalc;
      const h = c.headwindMph;
      const x = c.crosswindMph;
      if (Math.abs(h) >= Math.abs(x)) {
        const amt = Math.round(Math.abs(c.windAdjYd));
        shot = h >= 0
          ? `~${amt} yd into you on this line.`
          : `~${amt} yd helping on this line.`;
      } else if (Math.abs(c.aimYd) > 0) {
        shot = `~${Math.round(Math.abs(x))} mph across from the ${x > 0 ? 'right' : 'left'} — start it ${Math.abs(c.aimYd)} yd ${c.aimYd > 0 ? 'right' : 'left'}.`;
      } else {
        shot = `~${Math.round(Math.abs(x))} mph across — aim correction is minimal.`;
      }
    } else if (!hasLive) {
      shot = 'No live wind — using standard conditions.';
    } else {
      shot = 'Calm conditions — play the number.';
    }
    els.windPopShot.textContent = hasLive || state.lastCalc
      ? `This shot: ${shot}`
      : 'Select a target to see what the wind does to this shot.';

    const bits = [];
    if (hasLive && Number.isFinite(w.gustMph) && w.gustMph > w.windMph + 2)
      bits.push(`gusts to ${Math.round(w.gustMph)} mph`);
    if (state.context.weatherTs)
      bits.push(`as of ${new Date(state.context.weatherTs).toLocaleTimeString()}`);
    else
      bits.push('standard conditions');
    if (state.context.offlineWeather) bits.push('cached');
    els.windPopMeta.textContent = bits.join(' · ');
  }
  function openWindPop() {
    if (!els.windPop) return;
    renderWindPop();
    els.windPopScrim.hidden = false;
    els.windPop.hidden = false;
    requestAnimationFrame(() => {
      els.windPopScrim.classList.add('open');
      els.windPop.classList.add('open');
    });
    closeAdvice();
    haptic(6);
  }
  function closeWindPop() {
    if (!els.windPop || els.windPop.hidden) return;
    els.windPopScrim.classList.remove('open');
    els.windPop.classList.remove('open');
    setTimeout(() => {
      if (!els.windPop.classList.contains('open')) {
        els.windPop.hidden = true;
        els.windPopScrim.hidden = true;
      }
    }, reduceMotion ? 0 : 240);
  }
  function initWindPop() {
    if (!els.windPill) return;
    els.windPill.addEventListener('click', () => {
      if (windPopIsOpen()) closeWindPop();
      else openWindPop();
    });
    els.windPill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (windPopIsOpen()) closeWindPop();
        else openWindPop();
      }
    });
    if (els.windPopClose) els.windPopClose.addEventListener('click', closeWindPop);
    if (els.windPopScrim) els.windPopScrim.addEventListener('click', closeWindPop);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && windPopIsOpen()) closeWindPop();
    });
  }

  /* ---------- Live shot line + draggable start flag ---------- */
  const START_DRAG_MIN_YD = 2;
  function startFlagIcon() {
    return L.divIcon({
      className: '',
      html: `<div class="start-flag"><svg viewBox="0 0 24 24" fill="none"><path d="M12 21V4.5" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/><path d="M12 4.5h8.5l-3 3.2 3 3.2H12z" fill="#f5a623" stroke="#ffffff" stroke-width="1.1" stroke-linejoin="round"/></svg></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 22],
    });
  }
  function pendingStartMovedYd() {
    const p = state.roundSession && state.roundSession.pending;
    if (!p || !p.origStartPt) return 0;
    return haversineMeters(p.origStartPt, p.startPt) * M_TO_YD;
  }
  function syncResetStartChip() {
    if (!els.roundResetStart) return;
    els.roundResetStart.hidden = pendingStartMovedYd() < START_DRAG_MIN_YD;
  }
  function pendingLineLabelIcon(text) {
    return L.divIcon({
      className: '',
      html: `<div class="pending-line-label">${text}</div>`,
      iconSize: [56, 26],
      iconAnchor: [28, 13],
    });
  }
  function updatePendingLine() {
    const p = state.roundSession && state.roundSession.pending;
    const ok = !!(p && state.mapReady && state.map && state.loc);
    if (!ok) {
      ['pendingLine', 'pendingLabel'].forEach((k) => {
        if (state.markers[k] && state.map) {
          try { state.map.removeLayer(state.markers[k]); } catch { }
        }
        state.markers[k] = null;
      });
      return;
    }
    const pts = [
      [p.startPt.lat, p.startPt.lng],
      [state.loc.lat, state.loc.lng],
    ];
    if (!state.markers.pendingLine)
      state.markers.pendingLine = L.polyline(pts, {
        pane: 'shotLinePane',
        color: '#f5a623',
        weight: 4,
        opacity: 0.9,
        lineCap: 'round',
        interactive: false,
      }).addTo(state.map);
    else state.markers.pendingLine.setLatLngs(pts);

    const d = haversineMeters(p.startPt, state.loc) * M_TO_YD;
    const mid = midpointGeodesic(p.startPt, state.loc);
    const icon = pendingLineLabelIcon(`${Math.round(d)} yd`);
    if (!state.markers.pendingLabel)
      state.markers.pendingLabel = L.marker([mid.lat, mid.lng], {
        icon,
        interactive: false,
        zIndexOffset: 880,
      }).addTo(state.map);
    else {
      state.markers.pendingLabel.setLatLng([mid.lat, mid.lng]);
      state.markers.pendingLabel.setIcon(icon);
    }
    if (els.roundLiveV && !els.roundLive.hidden)
      els.roundLiveV.textContent = Math.round(d);
  }
  function renderPendingShot() {
    const p = state.roundSession && state.roundSession.pending;
    if (!p || !state.mapReady || !state.map) {
      clearPendingShot();
      return;
    }
    if (!p.origStartPt)
      p.origStartPt = { lat: p.startPt.lat, lng: p.startPt.lng };

    if (!state.markers.startFlag) {
      state.markers.startFlag = L.marker([p.startPt.lat, p.startPt.lng], {
        icon: startFlagIcon(),
        draggable: true,
        zIndexOffset: 860,
      }).addTo(state.map);
      state.markers.startFlag.on('drag', () => {
        const ll = state.markers.startFlag.getLatLng();
        p.startPt = { lat: ll.lat, lng: ll.lng };
        updatePendingLine();
      });
      state.markers.startFlag.on('dragend', () => {
        const ll = state.markers.startFlag.getLatLng();
        p.startPt = { lat: ll.lat, lng: ll.lng };
        saveRoundSession();
        updatePendingLine();
        syncResetStartChip();
        haptic(6);
      });
    } else {
      state.markers.startFlag.setLatLng([p.startPt.lat, p.startPt.lng]);
    }
    updatePendingLine();
    syncResetStartChip();
  }
  function clearPendingShot() {
    ['pendingLine', 'pendingLabel', 'startFlag'].forEach((k) => {
      if (state.markers[k] && state.map) {
        try { state.map.removeLayer(state.markers[k]); } catch { }
      }
      state.markers[k] = null;
    });
    if (els.roundResetStart) els.roundResetStart.hidden = true;
  }
  function resetPendingStart() {
    const p = state.roundSession && state.roundSession.pending;
    if (!p || !p.origStartPt) return;
    p.startPt = { lat: p.origStartPt.lat, lng: p.origStartPt.lng };
    saveRoundSession();
    renderPendingShot();
    haptic(8);
  }

  /* ---------- Wire everything up ---------- */
  initWindPop();
  if (els.roundResetStart)
    els.roundResetStart.addEventListener('click', resetPendingStart);

  // Theme: 'dark' is the house default; Auto follows the OS. Persisted so
  // the app opens the way the player left it.
  if (!['light', 'dark', 'auto'].includes(state.prefs.theme)) {
    state.prefs.theme = 'dark';
  }
  save('caddy:prefs', state.prefs);

  // React when the system flips under an Auto setting.
  if (THEME_MEDIA && THEME_MEDIA.addEventListener) {
    THEME_MEDIA.addEventListener('change', (e) => {
      systemDark = e.matches;
      applyPrefs();
    });
  }

  // ============================================================
  //  BLOCK 18 — PREP ADD-ON BRIDGE (read-only API for prep.js)
  //  The premium Prep studio lives in prep.js and reuses THIS closure's
  //  physics + planner data so every number matches the rest of the app.
  //  Strictly additive: nothing here mutates app state, and deleting this
  //  block restores the exact pre-bridge behavior.
  // ============================================================
  window.CaddyPrep = {
    v: 1,
    playsLike,
    recommendClub,
    clubsDesc: () => sortedClubsDesc(),
    weather: () => getWeatherOrNeutral(),
    elevation: () => getElevationOrNeutral(),
    locLat: () =>
      state.loc && Number.isFinite(state.loc.lat) ? state.loc.lat : STD_LAT,
    holeInfo(number) {
      const course = getPlannerCourse();
      if (!course) return null;
      const hole = (course.holes || [])[number - 1];
      if (!hole) return null;
      const yd = planHoleYardage(hole);
      return {
        number,
        courseName: course.name || 'Course',
        par: hole.par || inferParFromYards(yd),
        yards: yd,
        strokeIndex: hole.strokeIndex || null,
        hazards: planHazardsFor(hole),
        green: planGreenInfo(hole),
        bearing:
          hole.teePoint && hole.greenCenter
            ? initialBearingDeg(hole.teePoint, hole.greenCenter)
            : null,
      };
    },
    haptic,
  };

  bootstrap();
})();
