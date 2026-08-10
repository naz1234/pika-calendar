import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../functions/api/calendar.ts", import.meta.url));
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
  "calendar API should transpile without errors",
);

const reads = [];
const writes = [];
const calendarStore = {
  isEncryptedPayload: (value) => typeof value === "string" && value.length <= 1_000_000,
  isExpectedVersion: (value) => Number.isSafeInteger(value) && value >= 0,
  readCalendar: async (database, id) => {
    reads.push({ database, id });
    return null;
  },
  writeCalendar: async (database, id, payload, expectedVersion) => {
    writes.push({ database, id, payload, expectedVersion });
    return { version: 1, updatedAt: "2026-08-10T12:00:00.000Z" };
  },
};
const loadedModule = { exports: {} };
Function("module", "exports", "require", compiled.outputText)(
  loadedModule,
  loadedModule.exports,
  (specifier) => {
    assert.equal(specifier, "../lib/calendar-store");
    return calendarStore;
  },
);
const { onRequestGet, onRequestPut } = loadedModule.exports;
const database = {};

test("always reads the one public shared calendar", async () => {
  const response = await onRequestGet({
    request: new Request("https://calendar.example/api/calendar?id=ignored"),
    env: { DB: database },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(reads, [{ database, id: "pika-calendar-public-shared" }]);
});

test("writes to the shared calendar without requiring a client id", async () => {
  const response = await onRequestPut({
    request: new Request("https://calendar.example/api/calendar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "encrypted payload", expectedVersion: 0 }),
    }),
    env: { DB: database },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(writes, [{
    database,
    id: "pika-calendar-public-shared",
    payload: "encrypted payload",
    expectedVersion: 0,
  }]);
});
