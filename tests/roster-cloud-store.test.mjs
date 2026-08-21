import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../app/roster-cloud-store.ts", import.meta.url));
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
  "roster-cloud-store.ts should transpile without errors",
);

const loadedModule = { exports: {} };
Function("module", "exports", "require", compiled.outputText)(
  loadedModule,
  loadedModule.exports,
  (specifier) => {
    assert.equal(specifier, "./roster-file-store");
    return {};
  },
);

const { listSharedRosterFiles, uploadSharedRosterFile, loadSharedRosterFile } = loadedModule.exports;
const metadata = {
  id: "shared-july",
  name: "July roster.pdf",
  type: "application/pdf",
  size: 3,
  lastModified: 1_725_000_000_000,
  savedAt: "2026-08-21T12:00:00.000Z",
};

test("lists and uploads shared roster originals through the cross-device API", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ input, init });
    if (init.method === "POST") return Response.json(metadata, { status: 201 });
    return Response.json({ files: [metadata] });
  };
  try {
    assert.deepEqual(await listSharedRosterFiles(), [metadata]);
    const file = Object.assign(new Blob(["pdf"], { type: "application/pdf" }), {
      name: "July roster.pdf",
      lastModified: metadata.lastModified,
    });
    assert.deepEqual(await uploadSharedRosterFile(file), metadata);
    assert.equal(requests[0].input, "/api/roster-files");
    assert.equal(requests[0].init.cache, "no-store");
    assert.equal(requests[1].init.method, "POST");
    assert.equal(requests[1].init.headers["X-Roster-File-Name"], "July%20roster.pdf");
    assert.equal(requests[1].init.body, file);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloads a shared file by id on any device", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(input, "/api/roster-files?id=shared-july");
    return new Response("pdf", {
      headers: {
        "Content-Disposition": "attachment; filename=\"July roster.pdf\"; filename*=UTF-8''July%20roster.pdf",
        "Content-Type": "application/pdf",
      },
    });
  };
  try {
    const stored = await loadSharedRosterFile("shared-july");
    assert.equal(stored.metadata.name, "July roster.pdf");
    assert.equal(stored.blob.type, "application/pdf");
    assert.equal(await stored.blob.text(), "pdf");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an invalid shared file id without a request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not run");
  };
  try {
    assert.equal(await loadSharedRosterFile("../private"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
