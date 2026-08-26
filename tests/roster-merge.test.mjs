import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

async function loadTypeScriptModule(relativePath, requireModule = () => {
  throw new Error("Unexpected require");
}) {
  const sourcePath = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = await readFile(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
    reportDiagnostics: true,
  });
  assert.deepEqual(
    compiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error),
    [],
  );
  const loadedModule = { exports: {} };
  Function("module", "exports", "require", compiled.outputText)(loadedModule, loadedModule.exports, requireModule);
  return loadedModule.exports;
}

const domain = await loadTypeScriptModule("../app/roster-domain.ts");
const mergeModule = await loadTypeScriptModule(
  "../app/roster-merge.ts",
  (specifier) => specifier === "./roster-domain" ? domain : (() => { throw new Error(`Unexpected require: ${specifier}`); })(),
);
const { choiceToEvent } = domain;
const { eventDisplayRemark, eventEndDate, eventOccursOnDate, mergeRosterMonthEvents } = mergeModule;

const firstTimestamp = "2026-07-01T00:00:00.000Z";
const secondTimestamp = "2026-07-02T00:00:00.000Z";

function event(overrides) {
  return {
    id: "manual-1",
    calendar: "work",
    title: "Meeting",
    date: "2026-07-01",
    allDay: false,
    startTime: "12:00",
    endTime: "13:00",
    endsNextDay: false,
    notes: "",
    createdAt: firstTimestamp,
    updatedAt: firstTimestamp,
    ...overrides,
  };
}

function prepared(date, choice, rawCode) {
  return {
    details: choiceToEvent(choice),
    date,
    key: `roster:${date}`,
    rawCode,
  };
}

test("treats a missing end date as one day and includes both ends of a range", () => {
  const oneDay = event({ date: "2026-07-02" });
  const range = event({ date: "2026-07-02", endDate: "2026-07-04" });

  assert.equal(eventEndDate(oneDay), "2026-07-02");
  assert.equal(eventOccursOnDate(range, "2026-07-01"), false);
  assert.equal(eventOccursOnDate(range, "2026-07-02"), true);
  assert.equal(eventOccursOnDate(range, "2026-07-03"), true);
  assert.equal(eventOccursOnDate(range, "2026-07-04"), true);
  assert.equal(eventOccursOnDate(range, "2026-07-05"), false);
});

test("shows user remarks but hides untouched roster import metadata", () => {
  const source = { type: "roster-image", rosterMonth: "2026-07", key: "roster:2026-07-01", rawCode: "E3-DC" };
  assert.equal(eventDisplayRemark(event({ notes: "" })), "");
  assert.equal(eventDisplayRemark(event({ notes: "  Bring passport  " })), "Bring passport");
  assert.equal(eventDisplayRemark(event({ notes: "Imported from roster image · E3-DC", source })), "");
  assert.equal(eventDisplayRemark(event({ notes: "Changed flight", source })), "Changed flight");
});

test("imports only into Work and preserves Personal, manual Work, and other roster months", () => {
  const current = [
    event({ id: "personal", calendar: "personal", title: "Birthday" }),
    event({ id: "manual-different" }),
    event({
      id: "other-month",
      title: "Night",
      date: "2026-08-01",
      startTime: "23:00",
      endTime: "07:30",
      endsNextDay: true,
      source: { type: "roster-image", rosterMonth: "2026-08", key: "roster:2026-08-01", rawCode: "N3-DC" },
    }),
  ];
  const result = mergeRosterMonthEvents(
    current,
    [prepared("2026-07-01", "early", "E3-DC"), prepared("2026-07-02", "night", "N3-DC")],
    "2026-07",
    secondTimestamp,
  );

  assert.equal(result.importedCount, 2);
  assert.equal(result.events.filter((item) => item.source?.rosterMonth === "2026-07").length, 2);
  assert.ok(result.events.some((item) => item.id === "personal"));
  assert.ok(result.events.some((item) => item.id === "manual-different"));
  assert.ok(result.events.some((item) => item.id === "other-month"));
  assert.ok(result.events.find((item) => item.date === "2026-07-02")?.endsNextDay);
});

test("skips an exact manual duplicate instead of adding a second copy", () => {
  const early = choiceToEvent("early");
  const exactManual = event({
    id: "manual-early",
    title: early.title,
    allDay: early.allDay,
    startTime: early.startTime,
    endTime: early.endTime,
  });
  const result = mergeRosterMonthEvents(
    [exactManual],
    [prepared("2026-07-01", "early", "E3-DC")],
    "2026-07",
    secondTimestamp,
  );

  assert.equal(result.importedCount, 0);
  assert.equal(result.skippedManualDuplicates, 1);
  assert.deepEqual(result.events, [exactManual]);
});

test("re-importing a month is idempotent and retains the original id and created time", () => {
  const entries = [
    prepared("2026-07-01", "early", "E3-DC"),
    prepared("2026-07-02", "night", "N3-DC"),
  ];
  const first = mergeRosterMonthEvents([], entries, "2026-07", firstTimestamp);
  const second = mergeRosterMonthEvents(first.events, entries, "2026-07", secondTimestamp);

  assert.equal(first.events.length, 2);
  assert.equal(second.events.length, 2);
  assert.deepEqual(second.events.map((item) => item.id), first.events.map((item) => item.id));
  assert.ok(second.events.every((item) => item.createdAt === firstTimestamp));
  assert.ok(second.events.every((item) => item.updatedAt === secondTimestamp));
});

test("a complete re-import removes only older image-derived days from that month", () => {
  const original = mergeRosterMonthEvents(
    [],
    [prepared("2026-07-01", "early", "E3-DC"), prepared("2026-07-02", "night", "N3-DC")],
    "2026-07",
    firstTimestamp,
  );
  const manual = event({ id: "manual-july", date: "2026-07-03" });
  const result = mergeRosterMonthEvents(
    [...original.events, manual],
    [prepared("2026-07-02", "late", "L3-DC")],
    "2026-07",
    secondTimestamp,
  );

  assert.equal(result.events.some((item) => item.source && item.date === "2026-07-01"), false);
  assert.equal(result.events.find((item) => item.source)?.title, "Late");
  assert.ok(result.events.some((item) => item.id === "manual-july"));
});
