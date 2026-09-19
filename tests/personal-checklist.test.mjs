import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path });
  const mod = { exports: {} };
  Function("module", "exports", "require", compiled.outputText)(mod, mod.exports, (name) => {
    assert.ok(dependencies[name], `Unexpected import: ${name}`);
    return dependencies[name];
  });
  return mod.exports;
}
const domain = await load("../app/personal-checklist.ts");
const store = await load("../functions/lib/calendar-store.ts");
const api = await load("../functions/api/personal-checklist.ts", {
  "../../app/personal-checklist": domain, "../lib/calendar-store": store,
});
const { PersonalChecklistSync } = await load("../app/personal-checklist-sync.ts", { "./personal-checklist": domain });

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  return { prepare(query) {
    const stmt = sqlite.prepare(query);
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { return stmt.get(...values) ?? null; },
      async run() { return { meta: { changes: Number(stmt.run(...values).changes) } }; },
    };
  } };
}
function storage() {
  const values = new Map();
  return {
    get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
  };
}
function transport(db) {
  return (url, options) => {
    const request = new Request(new URL(url, "https://calendar.example"), options);
    return (request.method === "PUT" ? api.onRequestPut : api.onRequestGet)({ request, env: { DB: db } });
  };
}
function client(request, saved = storage()) {
  let entries = {};
  const sync = new PersonalChecklistSync(saved, (next) => { entries = next; }, request);
  return { sync, storage: saved, entry: (month = "2026-09") => entries[month] };
}
function task(id, overrides = {}) {
  return { id, title: "Bawak phone holder kayu", notes: "untuk support cooling", category: "house", done: false, deleted: false, createdAt: "2026-09-19T10:00:00.000Z", ...overrides };
}
const create = (item) => ({ id: crypto.randomUUID(), task: item });
const edit = (id, changes) => ({ id: crypto.randomUUID(), taskId: id, changes });
function deferred() { let resolve; const promise = new Promise((next) => { resolve = next; }); return { promise, resolve }; }

test("rejects malformed tasks, unsupported categories, duplicates, and invalid month keys", () => {
  assert.ok(domain.isChecklistTasks([task("a")]));
  for (const value of [null, {}, [task("a", { title: " " })], [task("a", { category: "work" })], [task("a", { done: "yes" })], [task("a", { notes: "x".repeat(2001) })], [task("a"), task("a")]]) {
    assert.equal(domain.isChecklistTasks(value), false);
  }
  for (const value of ["2026-00", "2026-13", "../../events", null]) assert.equal(domain.isChecklistMonth(value), false);
});

test("monthly API validates requests and keeps events and salary rows separate", async (t) => {
  const db = database(t);
  const request = transport(db);
  await store.writeCalendar(db, "pika-calendar-public-shared", "events", 0);
  await store.writeCalendar(db, "pika-calendar-public-salary-2026-09", "salary", 0);
  assert.deepEqual(await (await request("/api/personal-checklist?month=2026-09")).json(), { tasks: [], version: 0 });
  const body = { tasks: [task("a")], expectedVersion: 0 };
  const put = (data, month = "2026-09", headers = { "Content-Type": "application/json" }) => request(`/api/personal-checklist?month=${month}`, { method: "PUT", headers, body: typeof data === "string" ? data : JSON.stringify(data) });
  assert.equal((await put(body)).status, 200);
  assert.equal((await put(body)).status, 409);
  assert.equal((await put("{")).status, 400);
  assert.equal((await put(null)).status, 400);
  assert.equal((await put({ ...body, expectedVersion: -1 })).status, 400);
  assert.equal((await put({ ...body, tasks: [task("a", { category: "bad" })] })).status, 400);
  assert.equal((await put(body, "2026-13")).status, 400);
  assert.equal((await put(body, "2026-09", {})).status, 415);
  assert.equal((await put("x".repeat(500001))).status, 413);
  assert.deepEqual(await (await request("/api/personal-checklist?month=2026-10")).json(), { tasks: [], version: 0 });
  assert.equal((await store.readCalendar(db, "pika-calendar-public-shared")).payload, "events");
  assert.equal((await store.readCalendar(db, "pika-calendar-public-salary-2026-09")).payload, "salary");
});

test("add, edit, complete, delete, and undo propagate to another device", async (t) => {
  const request = transport(database(t));
  const a = client(request), b = client(request);
  await a.sync.change("2026-09", create(task("a")));
  await b.sync.refresh("2026-09");
  assert.equal(b.entry().tasks[0].notes, "untuk support cooling");
  await b.sync.change("2026-09", edit("a", { title: "Bring phone holder", category: "personal", done: true }));
  await a.sync.refresh("2026-09");
  assert.equal(a.entry().tasks[0].category, "personal");
  assert.equal(a.entry().tasks[0].done, true);
  await a.sync.change("2026-09", edit("a", { deleted: true }));
  await b.sync.refresh("2026-09");
  assert.equal(b.entry().tasks[0].deleted, true);
  await a.sync.change("2026-09", edit("a", { deleted: false }));
  await b.sync.refresh("2026-09");
  assert.equal(b.entry().tasks[0].deleted, false);
  assert.equal(b.entry().tasks[0].title, "Bring phone holder");
  assert.equal(a.entry().status, "synced");
});

test("offline changes survive reopening, including a different selected month", async (t) => {
  const request = transport(database(t));
  const a = client(async () => { throw new Error("offline"); });
  await a.sync.change("2026-09", create(task("a")));
  assert.equal(a.entry().status, "offline");
  assert.equal(a.entry().locallySaved, true);
  const reopened = client(request, a.storage);
  await reopened.sync.refresh("2026-10");
  assert.equal(reopened.entry().status, "synced");
  assert.equal(reopened.entry().pending.length, 0);
  assert.equal(reopened.entry("2026-10").tasks.length, 0);
  const b = client(request);
  await b.sync.refresh("2026-09");
  assert.equal(b.entry().tasks[0].id, "a");
});

test("concurrent devices retain additions and merge independent field edits after a version conflict", async (t) => {
  const request = transport(database(t));
  const a = client(request), b = client(request);
  await Promise.all([a.sync.change("2026-09", create(task("a"))), b.sync.change("2026-09", create(task("b")))]);
  await Promise.all([a.sync.change("2026-09", edit("a", { title: "New title" })), b.sync.change("2026-09", edit("a", { done: true }))]);
  await a.sync.refresh("2026-09");
  assert.equal(a.entry().tasks.length, 2);
  assert.equal(a.entry().tasks.find((item) => item.id === "a").title, "New title");
  assert.equal(a.entry().tasks.find((item) => item.id === "a").done, true);
});

test("stale offline edits and repeated creations cannot resurrect a deleted task", async (t) => {
  const request = transport(database(t));
  const a = client(request);
  await a.sync.change("2026-09", create(task("a")));
  let offline = false;
  const b = client((...args) => { if (offline) throw new Error("offline"); return request(...args); });
  await b.sync.refresh("2026-09");
  offline = true;
  await b.sync.change("2026-09", edit("a", { title: "Offline edit", done: true }));
  await a.sync.change("2026-09", edit("a", { deleted: true }));
  offline = false;
  await b.sync.refresh("2026-09");
  await b.sync.change("2026-09", create(task("a")));
  assert.equal(b.entry().tasks[0].deleted, true);
  assert.equal(b.entry().tasks[0].title, "Offline edit");
});

test("changes during an in-flight write are saved before reporting Saved online", async (t) => {
  const request = transport(database(t));
  const started = deferred(), release = deferred();
  let pause = true;
  const a = client(async (url, options) => {
    if (options?.method === "PUT" && pause) { pause = false; started.resolve(); await release.promise; }
    return request(url, options);
  });
  const saving = a.sync.change("2026-09", create(task("a")));
  await started.promise;
  void a.sync.change("2026-09", edit("a", { done: true }));
  release.resolve();
  await saving;
  const b = client(request);
  await b.sync.refresh("2026-09");
  assert.equal(b.entry().tasks[0].done, true);
  assert.equal(a.entry().pending.length, 0);
  assert.equal(a.entry().status, "synced");
});

test("lost save responses retry idempotently and keep edits made on another device", async (t) => {
  const request = transport(database(t));
  let loseResponse = true;
  const a = client(async (url, options) => {
    const response = await request(url, options);
    if (loseResponse && options?.method === "PUT") { loseResponse = false; throw new Error("response lost"); }
    return response;
  });
  await a.sync.change("2026-09", create(task("a")));
  const b = client(request);
  await b.sync.change("2026-09", edit("a", { notes: "Changed elsewhere" }));
  await a.sync.refresh("2026-09");
  assert.equal(a.entry().tasks.length, 1);
  assert.equal(a.entry().tasks[0].notes, "Changed elsewhere");
  assert.equal(a.entry().pending.length, 0);
});

test("storage failures and failed server reads do not falsely report saving", async (t) => {
  const a = client(async () => new Response("unavailable", { status: 503 }), { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
  await a.sync.change("2026-09", create(task("a")));
  assert.equal(a.entry().status, "offline");
  assert.equal(a.entry().locallySaved, false);
  assert.equal(a.entry().pending.length, 1);
  const b = client(transport(database(t)), a.storage);
  await b.sync.refresh("2026-09");
  assert.equal(b.entry().status, "synced");
});

test("default transport calls browser fetch without binding it to the sync client", async (t) => {
  const request = transport(database(t));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = function (...args) {
    assert.equal(this, undefined, "Browser fetch rejects a class instance as its receiver");
    return request(...args);
  };
  try {
    let entry;
    const sync = new PersonalChecklistSync(storage(), (entries) => { entry = entries["2026-09"]; });
    await sync.change("2026-09", create(task("a")));
    assert.equal(entry.status, "synced");
    assert.equal(entry.pending.length, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
