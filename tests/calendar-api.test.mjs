import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

async function loadApi(relativePath) {
  const sourcePath = fileURLToPath(new URL(relativePath, import.meta.url));
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
    `${relativePath} should transpile without errors`,
  );

  const reads = [];
  const writes = [];
  const calendarStore = {
    isCalendarId: (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value),
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
  return { ...loadedModule.exports, reads, writes };
}

const database = {};

test("shared endpoint always reads the isolated public calendar", async () => {
  const { onRequestGet, reads } = await loadApi("../functions/api/shared-calendar.ts");
  const response = await onRequestGet({
    request: new Request("https://calendar.example/api/shared-calendar?id=ignored"),
    env: { DB: database },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(reads, [{ database, id: "pika-calendar-public-shared-v2" }]);
});

test("shared endpoint writes without accepting a client calendar id", async () => {
  const { onRequestPut, writes } = await loadApi("../functions/api/shared-calendar.ts");
  const response = await onRequestPut({
    request: new Request("https://calendar.example/api/shared-calendar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "ignored", payload: "encrypted payload", expectedVersion: 0 }),
    }),
    env: { DB: database },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(writes, [{
    database,
    id: "pika-calendar-public-shared-v2",
    payload: "encrypted payload",
    expectedVersion: 0,
  }]);
});

test("legacy endpoint keeps old private-link calendars isolated by id", async () => {
  const { onRequestGet, onRequestPut, reads, writes } = await loadApi("../functions/api/calendar.ts");
  const id = "a".repeat(43);
  const getResponse = await onRequestGet({
    request: new Request(`https://calendar.example/api/calendar?id=${id}`),
    env: { DB: database },
  });
  const putResponse = await onRequestPut({
    request: new Request("https://calendar.example/api/calendar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, payload: "legacy encrypted payload", expectedVersion: 0 }),
    }),
    env: { DB: database },
  });

  assert.equal(getResponse.status, 404);
  assert.equal(putResponse.status, 200);
  assert.deepEqual(reads, [{ database, id }]);
  assert.deepEqual(writes, [{ database, id, payload: "legacy encrypted payload", expectedVersion: 0 }]);
});
