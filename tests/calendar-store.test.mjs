import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../functions/lib/calendar-store.ts", import.meta.url));
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
  "calendar-store.ts should transpile without errors",
);

const loadedModule = { exports: {} };
Function("module", "exports", compiled.outputText)(loadedModule, loadedModule.exports);
const { isCalendarId, isEncryptedPayload, isExpectedVersion, MAX_ENCRYPTED_PAYLOAD_BYTES } = loadedModule.exports;

test("accepts only opaque calendar ids and bounded encrypted payloads", () => {
  assert.equal(isCalendarId("a".repeat(43)), true);
  assert.equal(isCalendarId("a".repeat(42)), false);
  assert.equal(isCalendarId("../calendar-secret"), false);
  assert.equal(isEncryptedPayload("encrypted payload"), true);
  assert.equal(isEncryptedPayload("x".repeat(MAX_ENCRYPTED_PAYLOAD_BYTES + 1)), false);
});

test("accepts only non-negative safe integer versions", () => {
  assert.equal(isExpectedVersion(0), true);
  assert.equal(isExpectedVersion(12), true);
  assert.equal(isExpectedVersion(-1), false);
  assert.equal(isExpectedVersion(1.5), false);
  assert.equal(isExpectedVersion("1"), false);
});
