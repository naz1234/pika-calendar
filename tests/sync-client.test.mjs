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
  calendarIdForSecret,
  decryptCalendarEvents,
  encryptCalendarEvents,
  generateSyncSecret,
  isSyncSecret,
  makeSyncLink,
  syncSecretFromHash,
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

test("generates unguessable URL-safe sync secrets and stable ids", async () => {
  const first = generateSyncSecret();
  const second = generateSyncSecret();
  assert.match(first, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(isSyncSecret(first), true);
  assert.notEqual(first, second);
  assert.match(await calendarIdForSecret(first), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await calendarIdForSecret(first), await calendarIdForSecret(first));
});

test("round-trips events through authenticated browser encryption", async () => {
  const secret = generateSyncSecret();
  const encrypted = await encryptCalendarEvents(secret, sampleEvents);
  assert.doesNotMatch(encrypted, /Early|2026-08-11/);
  assert.deepEqual(await decryptCalendarEvents(secret, encrypted), sampleEvents);
  await assert.rejects(() => decryptCalendarEvents(generateSyncSecret(), encrypted));
});

test("puts the secret in a URL fragment and reads it back", () => {
  const secret = generateSyncSecret();
  const link = makeSyncLink(secret, "https://calendar.example/?from=app");
  const url = new URL(link);
  assert.equal(url.search, "?from=app");
  assert.equal(syncSecretFromHash(url.hash), secret);
  assert.equal(syncSecretFromHash("#sync=too-short"), "");
});
