import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../app/roster-reader.ts", import.meta.url));
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
  "roster-reader.ts should transpile without errors",
);

const loadedModule = { exports: {} };
Function("module", "exports", compiled.outputText)(loadedModule, loadedModule.exports);
const { parseRosterMonthHeader } = loadedModule.exports;

test("reads the month and year from roster title text", () => {
  assert.deepEqual(parseRosterMonthHeader("Jul 2026"), { year: 2026, monthIndex: 6 });
  assert.deepEqual(parseRosterMonthHeader("Aug 2026"), { year: 2026, monthIndex: 7 });
  assert.deepEqual(parseRosterMonthHeader("September 2034"), { year: 2034, monthIndex: 8 });
});

test("tolerates a noisy month token without damaging years that contain 1", () => {
  assert.deepEqual(parseRosterMonthHeader("JuI 2021"), { year: 2021, monthIndex: 6 });
  assert.deepEqual(parseRosterMonthHeader("AUG! 2031"), { year: 2031, monthIndex: 7 });
});

test("does not invent a month or year when the title is incomplete", () => {
  assert.equal(parseRosterMonthHeader("July"), null);
  assert.equal(parseRosterMonthHeader("2026"), null);
  assert.equal(parseRosterMonthHeader("unknown roster"), null);
});
