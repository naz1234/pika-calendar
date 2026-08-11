import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../app/shift-summary.ts", import.meta.url));
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
  "shift-summary.ts should transpile without errors",
);

const loadedModule = { exports: {} };
Function("module", "exports", compiled.outputText)(loadedModule, loadedModule.exports);
const { countMonthlyWorkShifts } = loadedModule.exports;

function event(title, date = "2026-07-01", calendar = "work") {
  return { title, date, calendar };
}

test("counts regular Night, every extension, and every RDOT separately", () => {
  const events = [
    ...Array.from({ length: 13 }, (_, index) => event("Night", `2026-07-${String(index + 1).padStart(2, "0")}`)),
    event("Night (EX)", "2026-07-17"),
    event("Late (EX)", "2026-07-25"),
    event("Late (EX)", "2026-07-26"),
    event("Night RDOT", "2026-07-23"),
    event("Early"),
    event("RD"),
  ];

  assert.deepEqual(countMonthlyWorkShifts(events, "2026-07"), {
    night: 13,
    extensions: 3,
    rdot: 1,
  });
});

test("ignores Personal events, other months, and non-canonical titles", () => {
  const events = [
    event("Night", "2026-08-01", "personal"),
    event("Night", "2026-09-01"),
    event("Night meeting", "2026-08-02"),
    event("Extension", "2026-08-03"),
    event("RDOT", "2026-08-04"),
  ];

  assert.deepEqual(countMonthlyWorkShifts(events, "2026-08"), {
    night: 0,
    extensions: 0,
    rdot: 0,
  });
  assert.deepEqual(countMonthlyWorkShifts(events, "2026-13"), {
    night: 0,
    extensions: 0,
    rdot: 0,
  });
});
