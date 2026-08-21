import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../app/roster-file-store.ts", import.meta.url));
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
  "roster-file-store.ts should transpile without errors",
);

const loadedModule = { exports: {} };
Function("module", "exports", compiled.outputText)(loadedModule, loadedModule.exports);
const { createRosterFileMetadata, normalizeStoredRosterFileMetadata } = loadedModule.exports;

test("creates safe, stable metadata for a saved roster original", () => {
  assert.deepEqual(
    createRosterFileMetadata({
      name: "../July: roster?.pdf",
      type: "application/pdf",
      size: 2048,
      lastModified: 1_725_000_000_000,
    }, 1_725_100_000_000, "roster-july"),
    {
      id: "roster-july",
      name: "-July- roster-.pdf",
      type: "application/pdf",
      size: 2048,
      lastModified: 1_725_000_000_000,
      savedAt: new Date(1_725_100_000_000).toISOString(),
    },
  );
});

test("uses a useful fallback name and MIME type", () => {
  assert.deepEqual(
    createRosterFileMetadata({ name: "...", type: "", size: 10, lastModified: 0 }, 0, "roster-fallback"),
    {
      id: "roster-fallback",
      name: "roster-image",
      type: "application/octet-stream",
      size: 10,
      lastModified: 0,
      savedAt: new Date(0).toISOString(),
    },
  );
});

test("keeps the roster saved by the previous single-file version", () => {
  assert.deepEqual(
    normalizeStoredRosterFileMetadata({
      name: "July roster.pdf",
      type: "application/pdf",
      size: 2048,
      lastModified: 1_725_000_000_000,
      savedAt: new Date(1_725_100_000_000).toISOString(),
    }, "latest"),
    {
      id: "latest",
      name: "July roster.pdf",
      type: "application/pdf",
      size: 2048,
      lastModified: 1_725_000_000_000,
      savedAt: new Date(1_725_100_000_000).toISOString(),
    },
  );
});

test("stores every blob and metadata record under its own id", () => {
  assert.match(source, /indexedDB\.open\(DATABASE_NAME, DATABASE_VERSION\)/);
  assert.match(source, /database\.transaction\(\[FILE_STORE, METADATA_STORE\], "readwrite"\)/);
  assert.match(source, /objectStore\(FILE_STORE\)\.put\(file\.slice[\s\S]*?metadata\.id\)/);
  assert.match(source, /objectStore\(METADATA_STORE\)\.put\(metadata, metadata\.id\)/);
  assert.doesNotMatch(source, /LATEST_FILE_KEY/);
});

test("lists all saved metadata newest first", () => {
  assert.match(source, /store\.getAllKeys\(\)/);
  assert.match(source, /store\.getAll\(\)/);
  assert.match(source, /Date\.parse\(right\.savedAt\) - Date\.parse\(left\.savedAt\)/);
});
