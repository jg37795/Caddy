// r5fix_probe.js — probe the three reported bugs from the OUTSIDE:
// 1. Search clearing: is the input debounced 400ms with min 3 chars?
//    (typing fast = each keystroke resets the timer — that's fine. But if
//    bindEphemeralCourse / clearPlannerSearch fires on selection, input
//    value is cleared — expected ON SELECTION, not while typing.)
//    The real culprit candidate: syncPrepChrome hiding prepSearchPane
//    when hasCourse flips — if the planner select has a value at load,
//    the search pane hides immediately, mid-typing.
// 2. km units: line ~12968 hardcodes km/m.
// 3. "Couldn't map" — pickPlannerSearchedCourse throws when Overpass
//    area query AND radius query both fail/empty → the catch shows
//    "Couldn't map X right now". Also possible: buildAutoCourse returns
//    a course with 0 mapped holes (all manual) — no throw, but the
//    scorecard shows nothing. James's message: "it told me it couldn't
//    map a golf course" = the catch path (network/timeout) OR empty.
console.log('static analysis done — fixes applied in next step');
