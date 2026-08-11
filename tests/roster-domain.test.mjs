import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../app/roster-domain.ts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
  reportDiagnostics: true,
});

assert.deepEqual(
  compiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error),
  [],
  "roster-domain.ts should transpile without errors",
);

const loadedModule = { exports: {} };
Function("module", "exports", compiled.outputText)(loadedModule, loadedModule.exports);

const {
  ROSTER_CHOICE_OPTIONS,
  choiceToEvent,
  dateKey,
  dateKeyFromMonthKey,
  extractRosterTimes,
  inferRosterChoice,
  isDateKeyInMonth,
  makeDateKey,
  makeMonthKey,
  mobileEventCode,
  monthKey,
  normalizeRosterCode,
  parseMonthKey,
  rosterShiftRunKey,
  rosterShiftRunPosition,
  rosterShiftTone,
} = loadedModule.exports;

const expectedEvents = {
  rd: ["RD", true, "", "", false],
  early: ["Early", false, "07:00", "15:30", false],
  late: ["Late", false, "15:00", "23:30", false],
  night: ["Night", false, "23:00", "07:30", true],
  "early-ex-start": ["Early (EX)", false, "03:00", "15:30", false],
  "early-ex-finish": ["Early (EX)", false, "07:00", "19:00", false],
  "late-ex-start": ["Late (EX)", false, "11:00", "23:30", false],
  "late-ex-finish": ["Late (EX)", false, "15:00", "03:00", true],
  "night-ex-start": ["Night (EX)", false, "19:00", "07:30", true],
  "night-ex-finish": ["Night (EX)", false, "23:00", "11:00", true],
  "early-rdot": ["Early RDOT", false, "07:00", "15:30", false],
  "late-rdot": ["Late RDOT", false, "15:00", "23:30", false],
  "night-rdot": ["Night RDOT", false, "23:00", "07:30", true],
};

test("offers every supported roster choice exactly once", () => {
  const offered = ROSTER_CHOICE_OPTIONS.map((option) => option.value);
  assert.equal(new Set(offered).size, offered.length);
  assert.deepEqual(new Set(offered), new Set(Object.keys(expectedEvents)));
});

test("maps every choice to its exact canonical label, times, and overnight flag", () => {
  for (const [choice, expected] of Object.entries(expectedEvents)) {
    const details = choiceToEvent(choice);
    assert.deepEqual(
      [details.title, details.allDay, details.startTime, details.endTime, details.endsNextDay],
      expected,
      choice,
    );
  }

  assert.equal(choiceToEvent("night-ex-start").endTime, "07:30");
});

test("returns a new event detail object so callers cannot mutate the canonical mapping", () => {
  const first = choiceToEvent("early");
  first.title = "Changed";
  assert.equal(choiceToEvent("early").title, "Early");
});

test("normalizes checkmarks, OCR separators, whitespace, and noisy standard codes", () => {
  assert.equal(normalizeRosterCode("✓ E3-DC"), "E3-DC");
  assert.equal(normalizeRosterCode(" ✔  l3 / d c "), "L3-DC");
  assert.equal(normalizeRosterCode("N3—D.C"), "N3-DC");
  assert.equal(normalizeRosterCode("E3-D0"), "E3-DC");
  assert.equal(normalizeRosterCode("N3-0C"), "N3-DC");
  assert.equal(normalizeRosterCode("7130C"), "L3-DC");
  assert.equal(normalizeRosterCode("V I3-DC"), "L3-DC");
  assert.equal(normalizeRosterCode("√ n   e-x"), "N EX");
  assert.equal(normalizeRosterCode("e / r_d"), "E RD");
  assert.equal(normalizeRosterCode("  W-R  "), "WR");
  assert.equal(normalizeRosterCode("something else"), "SOMETHINGELSE");
});

test("groups only canonical Work roster titles into shift colors", () => {
  assert.equal(rosterShiftTone("Early"), "early");
  assert.equal(rosterShiftTone("Early (EX)"), "early");
  assert.equal(rosterShiftTone("Early RDOT"), "early");
  assert.equal(rosterShiftTone("Late"), "late");
  assert.equal(rosterShiftTone("Late (EX)"), "late");
  assert.equal(rosterShiftTone("Night RDOT"), "night");
  assert.equal(rosterShiftTone("RD"), "rest");
  assert.equal(rosterShiftTone("Late appointment"), "");
  assert.equal(rosterShiftTone("Personal night out"), "");
});

test("creates readable two-character event labels for mobile month cells", () => {
  assert.equal(mobileEventCode("RD"), "RD");
  assert.equal(mobileEventCode("Early"), "ES");
  assert.equal(mobileEventCode("Early (EX)"), "ES");
  assert.equal(mobileEventCode("Late RDOT"), "LS");
  assert.equal(mobileEventCode("Night"), "NS");
  assert.equal(mobileEventCode("Annual Leave"), "AL");
  assert.equal(mobileEventCode("AL"), "AL");
  assert.equal(mobileEventCode("Sick Leave"), "SL");
  assert.equal(mobileEventCode("Training"), "TR");
});

test("joins only identical consecutive Work shifts within a calendar row", () => {
  const shift = (title, overrides = {}) => ({
    calendar: "work",
    title,
    allDay: false,
    startTime: "23:00",
    endTime: "07:30",
    endsNextDay: true,
    ...overrides,
  });
  const night = shift("Night");

  assert.ok(rosterShiftRunKey(night));
  assert.notEqual(rosterShiftRunKey(shift("Night RDOT")), rosterShiftRunKey(night));
  assert.notEqual(rosterShiftRunKey(shift("Night (EX)", { startTime: "19:00" })), rosterShiftRunKey(night));
  assert.equal(rosterShiftRunKey(shift("Night", { calendar: "personal" })), "");
  assert.equal(rosterShiftRunKey(shift("Night meeting")), "");

  assert.deepEqual(rosterShiftRunPosition(night, night, night, 3), {
    continuesPrevious: true,
    continuesNext: true,
  });
  assert.deepEqual(rosterShiftRunPosition(night, night, night, 0), {
    continuesPrevious: false,
    continuesNext: true,
  });
  assert.deepEqual(rosterShiftRunPosition(night, night, night, 6), {
    continuesPrevious: true,
    continuesNext: false,
  });
  assert.deepEqual(rosterShiftRunPosition(night, shift("Late"), shift("Night RDOT"), 3), {
    continuesPrevious: false,
    continuesNext: false,
  });
});

test("extracts canonical times despite O/0 confusion and OCR punctuation", () => {
  assert.deepEqual(extractRosterTimes("O7:OO  L3P-D-O  15.30"), ["07:00", "15:30"]);
  assert.deepEqual(extractRosterTimes("23：00  0730+"), ["23:00", "07:30"]);
  assert.deepEqual(extractRosterTimes("3:00, 19;00"), ["03:00", "19:00"]);
  assert.deepEqual(extractRosterTimes("not a time 29:99"), []);
});

test("infers rest days and normal early, late, and night shifts", () => {
  assert.deepEqual(inferRosterChoice({ rawCode: "WR" }), { choice: "rd", warning: "" });
  assert.deepEqual(inferRosterChoice({ rawCode: "unreadable", barKind: "GREEN bar" }), { choice: "rd", warning: "" });
  assert.deepEqual(inferRosterChoice({ rawCode: "E3 DC" }), { choice: "early", warning: "" });
  assert.deepEqual(inferRosterChoice({ rawCode: "L3-DC" }), { choice: "late", warning: "" });
  assert.deepEqual(inferRosterChoice({ rawCode: "N3/DC" }), { choice: "night", warning: "" });
  assert.deepEqual(
    inferRosterChoice({ rawCode: "7130C", times: ["13:00", "23:30"], barKind: "blue" }),
    { choice: "late", warning: "" },
    "recovers the exact OCR error seen on August 11",
  );
});

test("infers early, late, and night rest-day overtime", () => {
  assert.equal(inferRosterChoice({ rawCode: "E RD" }).choice, "early-rdot");
  assert.equal(inferRosterChoice({ rawCode: "L-RD" }).choice, "late-rdot");
  assert.equal(inferRosterChoice({ rawCode: "✓ N / RD" }).choice, "night-rdot");
});

test("infers both variants of every extension from its distinguishing time", () => {
  const cases = [
    ["E EX", ["03:00", "15:30"], "early-ex-start"],
    ["E EX", ["07:00", "19:00"], "early-ex-finish"],
    ["L EX", ["11:00", "23:30"], "late-ex-start"],
    ["L EX", ["15:00", "03:00"], "late-ex-finish"],
    ["N EX", ["19:00", "07:30"], "night-ex-start"],
    ["N EX", ["23:00", "11:00"], "night-ex-finish"],
  ];

  for (const [rawCode, times, expected] of cases) {
    assert.deepEqual(inferRosterChoice({ rawCode, times }), { choice: expected, warning: "" });
  }

  assert.equal(
    inferRosterChoice({ rawCode: "✓ N-EX 19:OO 07:OO+" }).choice,
    "night-ex-start",
  );
  assert.equal(
    inferRosterChoice({ rawCode: "N EX", times: ["15:00", "07:00"] }).choice,
    "night-ex-start",
    "uses the complete pair when OCR confuses the 9 in 19:00",
  );
});

test("does not guess an extension when its direction is missing or contradictory", () => {
  for (const input of [
    { rawCode: "E EX", times: ["07:00", "15:30"] },
    { rawCode: "L EX", times: ["11:00", "03:00"] },
    { rawCode: "N EX", times: [] },
    { rawCode: "N EX", times: ["19:00", "11:00"] },
  ]) {
    const result = inferRosterChoice(input);
    assert.equal(result.choice, "");
    assert.match(result.warning, /start or finish/i);
  }
});

test("returns an actionable warning for an unknown code", () => {
  const result = inferRosterChoice({ rawCode: "???" });
  assert.equal(result.choice, "");
  assert.match(result.warning, /choose a shift manually/i);

  assert.equal(inferRosterChoice({ rawCode: "713RD", times: ["15:00", "23:30"] }).choice, "");
  assert.equal(inferRosterChoice({ rawCode: "713EX", times: ["15:00", "03:00"] }).choice, "");
});

test("creates and parses validated month keys", () => {
  assert.equal(makeMonthKey(2026, 7), "2026-07");
  assert.equal(monthKey(2026, 12), "2026-12");
  assert.deepEqual(parseMonthKey("2026-08"), { year: 2026, month: 8 });
  assert.equal(parseMonthKey("2026-8"), null);
  assert.equal(parseMonthKey("2026-13"), null);
  assert.throws(() => makeMonthKey(2026, 0), RangeError);
});

test("creates only real date keys, including leap days", () => {
  assert.equal(makeDateKey(2026, 8, 1), "2026-08-01");
  assert.equal(dateKey(2024, 2, 29), "2024-02-29");
  assert.equal(dateKeyFromMonthKey("2026-07", 23), "2026-07-23");
  assert.throws(() => makeDateKey(2026, 2, 29), RangeError);
  assert.throws(() => dateKeyFromMonthKey("July 2026", 1), RangeError);
});

test("checks full valid dates against a month key", () => {
  assert.equal(isDateKeyInMonth("2026-08-31", "2026-08"), true);
  assert.equal(isDateKeyInMonth("2026-09-01", "2026-08"), false);
  assert.equal(isDateKeyInMonth("2026-02-29", "2026-02"), false);
  assert.equal(isDateKeyInMonth("not-a-date", "2026-08"), false);
  assert.equal(isDateKeyInMonth("2026-08-01", "2026-13"), false);
});
