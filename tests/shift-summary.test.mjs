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
const {
  calculateManualSalaryEstimate,
  calculateMonthlyExpectedSalary,
  countMonthlyWorkShifts,
} = loadedModule.exports;

function event(title, date = "2026-07-01", calendar = "work") {
  return { title, date, calendar };
}

test("counts all Night types while also counting extensions and RDOT", () => {
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
    night: 15,
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

test("forecasts salary with the Railog overtime formula", () => {
  const events = [
    { ...event("Night"), startTime: "23:00", endTime: "07:30", endsNextDay: true },
    { ...event("Early (EX)", "2026-07-05"), startTime: "03:00", endTime: "15:30" },
    { ...event("Late (EX)", "2026-07-12"), startTime: "15:00", endTime: "03:00", endsNextDay: true },
    { ...event("Night RDOT", "2026-07-19"), startTime: "23:00", endTime: "07:30", endsNextDay: true },
  ];

  assert.deepEqual(calculateMonthlyExpectedSalary(events, "2026-07"), {
    salaryWithLaundry: 15100,
    overtimeHours: 16,
    nightAllowance: 90,
    expectedOvertime: 1875,
    expectedSalary: 17065,
  });
});

test("matches the Railog July forecast and corrects the legacy imported Night extension", () => {
  const importedSource = { type: "roster-image" };
  const events = [
    ...Array.from({ length: 13 }, (_, index) => ({
      ...event("Night", `2026-07-${String(index + 1).padStart(2, "0")}`),
      startTime: "23:00",
      endTime: "07:30",
      endsNextDay: true,
      source: importedSource,
    })),
    {
      ...event("Night (EX)", "2026-07-17"),
      startTime: "19:00",
      endTime: "07:30",
      endsNextDay: true,
      source: importedSource,
    },
    { ...event("Late (EX)", "2026-07-25"), startTime: "15:00", endTime: "03:00", endsNextDay: true },
    { ...event("Late (EX)", "2026-07-26"), startTime: "15:00", endTime: "03:00", endsNextDay: true },
    { ...event("Night RDOT", "2026-07-23"), startTime: "23:00", endTime: "07:30", endsNextDay: true },
  ];

  assert.deepEqual(calculateMonthlyExpectedSalary(events, "2026-07"), {
    salaryWithLaundry: 15100,
    overtimeHours: 19,
    nightAllowance: 675,
    expectedOvertime: 2226.56,
    expectedSalary: 18001.56,
  });
});

test("salary forecasting ignores Personal and out-of-month overtime", () => {
  const events = [
    { ...event("Early RDOT", "2026-07-01", "personal"), startTime: "07:00", endTime: "15:30" },
    { ...event("Early RDOT", "2026-08-01"), startTime: "07:00", endTime: "15:30" },
  ];

  assert.deepEqual(calculateMonthlyExpectedSalary(events, "2026-07"), {
    salaryWithLaundry: 15100,
    overtimeHours: 0,
    nightAllowance: 0,
    expectedOvertime: 0,
    expectedSalary: 15100,
  });
});

test("uses a custom salary plus laundry amount in the forecast", () => {
  assert.deepEqual(calculateMonthlyExpectedSalary([], "2026-07", { salaryWithLaundry: 16850.75 }), {
    salaryWithLaundry: 16850.75,
    overtimeHours: 0,
    nightAllowance: 0,
    expectedOvertime: 0,
    expectedSalary: 16850.75,
  });
});

test("estimates salary from manually entered Night, Extension, and RDOT days", () => {
  assert.deepEqual(calculateManualSalaryEstimate({
    salaryWithLaundry: 15100,
    nightShiftDays: 4,
    extensionDays: 3,
    rdotDays: 1,
  }), {
    salaryWithLaundry: 15100,
    nightShiftDays: 4,
    extensionDays: 3,
    rdotDays: 1,
    basicSalary: 15000,
    extensionHours: 10.5,
    rdotHours: 8.5,
    overtimeHours: 19,
    nightAllowance: 180,
    expectedExtensionOvertime: 1230.47,
    expectedRdotOvertime: 996.09,
    expectedOvertime: 2226.56,
    expectedSalary: 17506.56,
  });
});

test("manual salary estimate accepts fractional days and sanitizes invalid values", () => {
  assert.deepEqual(calculateManualSalaryEstimate({
    salaryWithLaundry: Number.NaN,
    nightShiftDays: Number.NaN,
    extensionDays: 0.5,
    rdotDays: -2,
  }), {
    salaryWithLaundry: 0,
    nightShiftDays: 0,
    extensionDays: 0.5,
    rdotDays: 0,
    basicSalary: 0,
    extensionHours: 1.8,
    rdotHours: 0,
    overtimeHours: 1.8,
    nightAllowance: 0,
    expectedExtensionOvertime: 0,
    expectedRdotOvertime: 0,
    expectedOvertime: 0,
    expectedSalary: 0,
  });
});
