import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const sourcePath = fileURLToPath(new URL("../app/calendar-sync.ts", import.meta.url));
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
  "calendar-sync.ts should transpile without errors",
);

const loadedModule = { exports: {} };
Function("module", "exports", compiled.outputText)(loadedModule, loadedModule.exports);

const {
  SHARED_SYNC_SECRET,
  decryptCalendarEvents,
  encryptCalendarEvents,
  mergeSharedCalendarEvents,
} = loadedModule.exports;

const sampleEvents = [{
  id: "event-1",
  calendar: "work",
  title: "Early",
  date: "2026-08-11",
  allDay: false,
  startTime: "07:00",
  endTime: "15:30",
  notes: "Imported from roster image",
  createdAt: "2026-08-10T10:00:00.000Z",
  updatedAt: "2026-08-10T10:00:00.000Z",
}];

test("uses one stable public sync secret in every browser", () => {
  assert.match(SHARED_SYNC_SECRET, /^[A-Za-z0-9_-]{32}$/);
});

test("round-trips shared events through browser encryption", async () => {
  const encrypted = await encryptCalendarEvents(SHARED_SYNC_SECRET, sampleEvents);
  assert.doesNotMatch(encrypted, /Early|2026-08-11/);
  assert.deepEqual(await decryptCalendarEvents(SHARED_SYNC_SECRET, encrypted), sampleEvents);
  await assert.rejects(() => decryptCalendarEvents("x".repeat(32), encrypted));
});

test("merges one-time local events without replacing newer shared copies", () => {
  const newerRemote = { ...sampleEvents[0], title: "Updated Early", updatedAt: "2026-08-10T12:00:00.000Z" };
  const localOnly = { ...sampleEvents[0], id: "event-2", title: "RD" };
  const merged = mergeSharedCalendarEvents([newerRemote], [sampleEvents[0], localOnly]);

  assert.deepEqual(merged, [newerRemote, localOnly]);
});
