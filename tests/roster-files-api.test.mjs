import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePath = fileURLToPath(new URL("../functions/api/roster-files.ts", import.meta.url));
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
  "roster-files.ts should transpile without errors",
);

const loadedModule = { exports: {} };
Function("module", "exports", compiled.outputText)(loadedModule, loadedModule.exports);
const { onRequestDelete, onRequestGet, onRequestPatch, onRequestPost } = loadedModule.exports;

function memoryBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options) {
      objects.set(key, {
        bytes: new Uint8Array(value),
        customMetadata: options.customMetadata,
        uploaded: new Date("2026-08-21T12:00:00.000Z"),
      });
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        key,
        size: object.bytes.byteLength,
        uploaded: object.uploaded,
        customMetadata: object.customMetadata,
        body: new Blob([object.bytes]).stream(),
        arrayBuffer: async () => object.bytes.slice().buffer,
      };
    },
    async delete(key) {
      objects.delete(key);
    },
    async list() {
      return {
        objects: [...objects.entries()].map(([key, object]) => ({
          key,
          size: object.bytes.byteLength,
          uploaded: object.uploaded,
          customMetadata: object.customMetadata,
        })),
        truncated: false,
      };
    },
  };
}

test("uploads, lists, renames, downloads, and deletes a roster through shared R2 storage", async () => {
  const bucket = memoryBucket();
  const uploadResponse = await onRequestPost({
    request: new Request("https://calendar.example/api/roster-files", {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "X-Roster-File-Name": "July%20roster.pdf",
        "X-Roster-Last-Modified": "1725000000000",
      },
      body: "pdf",
    }),
    env: { BUCKET: bucket },
  });
  assert.equal(uploadResponse.status, 201);
  const uploaded = await uploadResponse.json();
  assert.match(uploaded.id, /^[\da-f-]{36}$/u);
  assert.equal(uploaded.name, "July roster.pdf");
  assert.equal(uploaded.size, 3);

  const listResponse = await onRequestGet({
    request: new Request("https://calendar.example/api/roster-files"),
    env: { BUCKET: bucket },
  });
  assert.equal(listResponse.status, 200);
  assert.deepEqual(await listResponse.json(), { files: [uploaded], deletedSignatures: [] });

  const renameResponse = await onRequestPatch({
    request: new Request("https://calendar.example/api/roster-files", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: uploaded.id, name: "August roster.pdf" }),
    }),
    env: { BUCKET: bucket },
  });
  assert.equal(renameResponse.status, 200);
  const renamed = await renameResponse.json();
  assert.deepEqual(renamed, { ...uploaded, name: "August roster.pdf" });

  const downloadResponse = await onRequestGet({
    request: new Request(`https://calendar.example/api/roster-files?id=${uploaded.id}`),
    env: { BUCKET: bucket },
  });
  assert.equal(downloadResponse.status, 200);
  assert.equal(downloadResponse.headers.get("content-type"), "application/pdf");
  assert.match(downloadResponse.headers.get("content-disposition"), /August%20roster\.pdf/u);
  assert.equal(await downloadResponse.text(), "pdf");

  const deleteResponse = await onRequestDelete({
    request: new Request(`https://calendar.example/api/roster-files?id=${uploaded.id}`, { method: "DELETE" }),
    env: { BUCKET: bucket },
  });
  assert.equal(deleteResponse.status, 204);

  const missingResponse = await onRequestGet({
    request: new Request(`https://calendar.example/api/roster-files?id=${uploaded.id}`),
    env: { BUCKET: bucket },
  });
  assert.equal(missingResponse.status, 404);

  const finalListResponse = await onRequestGet({
    request: new Request("https://calendar.example/api/roster-files"),
    env: { BUCKET: bucket },
  });
  const finalList = await finalListResponse.json();
  assert.deepEqual(finalList.files, []);
  assert.deepEqual(finalList.deletedSignatures.sort(), [
    "August roster.pdf\u00003\u00001725000000000",
    "July roster.pdf\u00003\u00001725000000000",
  ]);
});

test("rejects oversized uploads before reading their body", async () => {
  let bodyRead = false;
  const response = await onRequestPost({
    request: {
      headers: new Headers({
        "Content-Length": String(15 * 1024 * 1024 + 1),
        "Content-Type": "application/pdf",
        "X-Roster-File-Name": "large.pdf",
      }),
      arrayBuffer: async () => {
        bodyRead = true;
        return new ArrayBuffer(0);
      },
    },
    env: { BUCKET: memoryBucket() },
  });
  assert.equal(response.status, 413);
  assert.equal(bodyRead, false);
});

test("reports when the shared R2 binding is missing", async () => {
  const response = await onRequestGet({
    request: new Request("https://calendar.example/api/roster-files"),
    env: {},
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /R2 binding named BUCKET/u);
});
