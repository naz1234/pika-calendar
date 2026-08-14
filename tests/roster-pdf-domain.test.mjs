import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../app/roster-pdf-domain.ts", import.meta.url));
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
  "roster-pdf-domain.ts should transpile without errors",
);

const loadedModule = { exports: {} };
Function("module", "exports", compiled.outputText)(loadedModule, loadedModule.exports);
const { parseIvuPlanTextItems } = loadedModule.exports;

const codes = new Map([
  [1, ["WR"]],
  [2, ["E3-DC", "07:00", "15:30"]],
  [3, ["E3-DC", "07:00", "15:30"]],
  [4, ["E3-DC", "07:00", "15:30"]],
  [5, ["E3-DC", "07:00", "15:30"]],
  [6, ["E3-DC", "07:00", "15:30"]],
  [7, ["E3-DC", "07:00", "15:30"]],
  [8, ["WR"]],
  [9, ["L3-DC", "15:00", "23:30"]],
  [10, ["L3-DC", "15:00", "23:30"]],
  [11, ["L3-DC", "15:00", "23:30"]],
  [12, ["WR"]],
  [13, ["WR"]],
  [14, ["L3-DC", "15:00", "23:30"]],
  [15, ["L3-DC", "15:00", "23:30"]],
  [16, ["N3-DC", "23:00", "07:30+"]],
  [17, ["N3-DC", "23:00", "07:30+"]],
  [18, ["N3-DC", "23:00", "07:30+"]],
  [19, ["N3-DC", "23:00", "07:30+"]],
  [20, ["WR"]],
  [21, ["WR"]],
  [22, ["N3-DC", "23:00", "07:30+"]],
  [23, ["N3-DC", "23:00", "07:30+"]],
  [24, ["N3-DC", "23:00", "07:30+"]],
  [25, ["N3-DC", "23:00", "07:30+"]],
  [26, ["N3-DC", "23:00", "07:30+"]],
  [27, ["N3-DC", "23:00", "07:30+"]],
  [28, ["WR"]],
  [29, ["WR"]],
  [30, ["L3-DC", "15:00", "23:30"]],
  [31, ["L3-DC", "15:00", "23:30"]],
]);

function textItem(str, x, y, width = Math.max(8, str.length * 5), height = 8) {
  return { str, x, y, width, height };
}

function augustFixture(overrides = new Map()) {
  const centers = Array.from({ length: 7 }, (_, index) => 70 + index * 100);
  const items = [
    textItem("Duty schedule for:", 20, 585),
    textItem("Aug 2026", 340, 585),
    ...["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((weekday, index) =>
      textItem(weekday, centers[index] - 10, 555, 20),
    ),
  ];

  for (let day = 1; day <= 31; day += 1) {
    const offset = 5 + day - 1;
    const column = offset % 7;
    const row = Math.floor(offset / 7);
    const dayY = 530 - row * 78;
    items.push(textItem(String(day), centers[column] - 42, dayY, 10));
    (overrides.get(day) ?? codes.get(day)).forEach((value, line) => {
      items.push(textItem(value, centers[column] - 24, dayY - 19 - line * 13));
    });
  }
  return items;
}

test("reads every day from an IVU.plan monthly PDF grid", () => {
  const observations = parseIvuPlanTextItems(augustFixture(), 2026, 7);

  assert.equal(observations.length, 31);
  assert.deepEqual(observations[0], {
    day: 1,
    rawCode: "WR",
    rawText: "WR",
    times: [],
    barKind: "green",
    confidence: 100,
  });
  assert.equal(observations[1].rawCode, "E3-DC");
  assert.deepEqual(observations[1].times, ["07:00", "15:30"]);
  assert.equal(observations[15].rawCode, "N3-DC");
  assert.deepEqual(observations[15].times, ["23:00", "07:30"]);
  assert.equal(observations[29].rawCode, "L3-DC");
  assert.deepEqual(observations[29].times, ["15:00", "23:30"]);
  assert.ok(observations.every((observation) => observation.confidence === 100));
});

test("recovers IVU's uniquely truncated 03:00 extension marker", () => {
  const observations = parseIvuPlanTextItems(
    augustFixture(new Map([
      [14, ["L EX", "15:00 L3P …", "03:0 … L3P …"]],
      [15, ["L EX", "15:00 L3P …", "04:0 … L3P …"]],
    ])),
    2026,
    7,
  );

  assert.equal(observations[13].rawCode, "L EX");
  assert.deepEqual(observations[13].times, ["15:00", "03:00"]);
  assert.deepEqual(observations[14].times, ["15:00"], "does not guess other incomplete times");
});

test("reads leave codes and prefers leave over a secondary planned duty", () => {
  const observations = parseIvuPlanTextItems(
    augustFixture(new Map([
      [13, ["AL", "WR"]],
      [14, ["SL"]],
    ])),
    2026,
    7,
  );

  assert.equal(observations[12].rawCode, "AL");
  assert.equal(observations[12].rawText, "AL WR");
  assert.equal(observations[13].rawCode, "SL");
});

test("rejects an incomplete IVU.plan calendar grid", () => {
  const incomplete = augustFixture().filter((item) => item.str !== "31");
  assert.throws(
    () => parseIvuPlanTextItems(incomplete, 2026, 7),
    /incomplete \(30 of 31 dates found\)/,
  );
});
