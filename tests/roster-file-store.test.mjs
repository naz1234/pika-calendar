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
const { createRosterFileMetadata } = loadedModule.exports;

test("creates safe, stable metadata for a saved roster original", () => {
  assert.deepEqual(
    createRosterFileMetadata({
      name: "../July: roster?.pdf",
      type: "application/pdf",
      size: 2048,
      lastModified: 1_725_000_000_000,
    }, 1_725_100_000_000),
    {
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
    createRosterFileMetadata({ name: "...", type: "", size: 10, lastModified: 0 }, 0),
    {
      name: "roster-image",
      type: "application/octet-stream",
      size: 10,
      lastModified: 0,
      savedAt: new Date(0).toISOString(),
    },
  );
});

test("stores the blob and metadata atomically in IndexedDB", () => {
  assert.match(source, /indexedDB\.open\(DATABASE_NAME, DATABASE_VERSION\)/);
  assert.match(source, /database\.transaction\(\[FILE_STORE, METADATA_STORE\], "readwrite"\)/);
  assert.match(source, /objectStore\(FILE_STORE\)\.put\(file\.slice/);
  assert.match(source, /objectStore\(METADATA_STORE\)\.put\(metadata, LATEST_FILE_KEY\)/);
});
