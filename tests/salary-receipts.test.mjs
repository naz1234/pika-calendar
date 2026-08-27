import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

async function load(relativePath, dependencies = {}) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: relativePath,
    reportDiagnostics: true,
  });
  assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
  const loadedModule = { exports: {} };
  Function("module", "exports", "require", compiled.outputText)(loadedModule, loadedModule.exports, (name) => {
    assert.ok(dependencies[name], `Unexpected import: ${name}`);
    return dependencies[name];
  });
  return loadedModule.exports;
}

const domain = await load("../app/salary-receipts.ts");
const store = await load("../functions/lib/calendar-store.ts");
const api = await load("../functions/api/salary-receipts.ts", {
  "../../app/salary-receipts": domain,
  "../lib/calendar-store": store,
});
const { SalaryReceiptSync } = await load("../app/salary-receipts-sync.ts", { "./salary-receipts": domain });
const { SalaryReceivedPanel } = await load("../app/salary-received-panel.tsx", {
  react: React, "react/jsx-runtime": jsxRuntime, "./salary-receipts": domain,
});

function database() {
  const sqlite = new DatabaseSync(":memory:");
  return {
    close: () => sqlite.close(),
    prepare(query) {
      const statement = sqlite.prepare(query);
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return statement.get(...values) ?? null; },
        async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
      };
    },
  };
}

function storage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function transport(db) {
  return (url, options) => {
    const request = new Request(new URL(url, "https://calendar.example"), options);
    return (request.method === "PUT" ? api.onRequestPut : api.onRequestGet)({ request, env: { DB: db } });
  };
}

function client(request, deviceStorage = storage()) {
  let entries = {};
  const sync = new SalaryReceiptSync(deviceStorage, (next) => { entries = next; }, request);
  return { sync, storage: deviceStorage, entry: (month = "2026-07") => entries[month] };
}

const draft = { receivedCents: 1_700_000, expectedCents: 1_706_500 };

test("received salary uses the following pay month, including year rollover", () => {
  assert.equal(domain.salaryPayMonth("2026-07"), "2026-08");
  assert.equal(domain.salaryPayMonth("2026-12"), "2027-01");
  assert.throws(() => domain.salaryPayMonth("2026-13"));
});

test("parses cents exactly and rejects blank, negative, non-finite and over-precision inputs", () => {
  assert.equal(domain.parseSalaryCents(" 17065.01 "), 1706501);
  assert.equal(domain.parseSalaryCents("0"), 0);
  assert.equal(domain.parseSalaryCents("1.1"), 110);
  for (const input of ["", " ", "-1", "NaN", "Infinity", "1.001", "1e6", "999999999999", "abc"]) {
    assert.equal(domain.parseSalaryCents(input), null, input);
  }
  assert.deepEqual(domain.compareSalary(1706500, 1706501), { status: "Short", differenceCents: -1 });
  assert.deepEqual(domain.compareSalary(1706501, 1706501), { status: "Match", differenceCents: 0 });
  assert.deepEqual(domain.compareSalary(1706502, 1706501), { status: "Exceed", differenceCents: 1 });
});

test("salary API persists isolated months in D1 and rejects stale writes", async (t) => {
  const db = database();
  t.after(() => db.close());
  const request = transport(db);
  const save = (month, data) => request(`/api/salary-receipts?month=${month}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  assert.equal((await request("/api/salary-receipts?month=2026-07")).status, 404);
  assert.equal((await save("2026-07", { ...draft, expectedVersion: 0 })).status, 200);
  assert.equal((await save("2026-08", { ...draft, receivedCents: 0, expectedVersion: 0 })).status, 200);
  const july = await request("/api/salary-receipts?month=2026-07");
  assert.equal(july.headers.get("Cache-Control"), "no-store");
  assert.equal((await july.json()).receivedCents, draft.receivedCents);
  assert.equal((await (await request("/api/salary-receipts?month=2026-08")).json()).receivedCents, 0);
  assert.equal((await save("2026-07", { ...draft, receivedCents: 999, expectedVersion: 0 })).status, 409);
  assert.equal((await save("2026-07", { ...draft, expectedVersion: 1 })).status, 200);
  assert.equal((await store.readCalendar(db, "pika-calendar-public-salary-2026-07")).version, 2);
  assert.equal(await store.readCalendar(db, "pika-calendar-public-shared-v2"), null);
});

test("salary API validates requests and reports missing shared storage", async () => {
  const context = (body, month = "2026-07", type = "application/json") => ({
    env: {}, request: new Request(`https://calendar.example/api/salary-receipts?month=${month}`, {
      method: "PUT", headers: { "Content-Type": type }, body,
    }),
  });
  assert.equal((await api.onRequestPut(context("{}", "2026-13"))).status, 400);
  assert.equal((await api.onRequestPut(context("{}", "2026-07", "text/plain"))).status, 415);
  for (const body of ["null", "{", "[]", "{}", JSON.stringify({ ...draft, receivedCents: -1, expectedVersion: 0 }),
    JSON.stringify({ ...draft, receivedCents: 0.5, expectedVersion: 0 }), JSON.stringify({ ...draft, expectedVersion: -1 })]) {
    assert.equal((await api.onRequestPut(context(body))).status, 400);
  }
  assert.equal((await api.onRequestPut(context(" ".repeat(1025)))).status, 413);
  assert.equal((await api.onRequestPut(context(JSON.stringify({ ...draft, expectedVersion: 0 })))).status, 503);
  assert.equal((await api.onRequestGet({ env: {}, request: new Request("https://calendar.example/api/salary-receipts?month=2026-07") })).status, 503);
});

test("a received salary saved on one device loads and can be updated on another", async (t) => {
  const db = database();
  t.after(() => db.close());
  const first = client(transport(db));
  const second = client(transport(db));
  await first.sync.save("2026-07", draft);
  assert.equal(first.entry().status, "synced");
  await second.sync.refresh("2026-07");
  assert.deepEqual(second.entry().receipt, first.entry().receipt);
  await second.sync.save("2026-07", { ...draft, receivedCents: draft.expectedCents });
  await first.sync.refresh("2026-07");
  assert.equal(first.entry().receipt.receivedCents, draft.expectedCents);
  assert.equal(first.entry().receipt.version, 2);
});

test("offline saves survive reload and sync even when another month is open", async (t) => {
  const db = database();
  t.after(() => db.close());
  const offline = client(async () => { throw new Error("offline"); });
  await offline.sync.save("2026-07", draft);
  assert.equal(offline.entry().status, "offline");
  assert.equal(offline.entry().locallySaved, true);
  const reopened = client(transport(db), offline.storage);
  await reopened.sync.refresh("2026-08");
  assert.equal(reopened.entry().status, "synced");
  assert.equal(reopened.entry().pending, null);
  const otherDevice = client(transport(db));
  await otherDevice.sync.refresh("2026-07");
  assert.deepEqual(otherDevice.entry().receipt, reopened.entry().receipt);
});

test("concurrent same-month edits require review instead of overwriting another device", async (t) => {
  const db = database();
  t.after(() => db.close());
  const first = client(transport(db));
  const second = client(transport(db));
  await first.sync.save("2026-07", draft);
  await second.sync.refresh("2026-07");
  await first.sync.save("2026-07", { ...draft, receivedCents: 1 });
  await second.sync.save("2026-07", { ...draft, receivedCents: 2 });
  assert.equal(second.entry().status, "conflict");
  assert.equal(second.entry().pending.receivedCents, 2);
  assert.equal(second.entry().receipt.receivedCents, 1);
  const reopened = client(transport(db), second.storage);
  await reopened.sync.refresh("2026-07");
  assert.equal(reopened.entry().status, "conflict");
  await reopened.sync.save("2026-07", { ...draft, receivedCents: 2 });
  assert.equal(reopened.entry().status, "synced");
  assert.equal(reopened.entry().receipt.version, 3);
});

test("an interrupted response retries without losing an already accepted save", async (t) => {
  const db = database();
  t.after(() => db.close());
  const request = transport(db);
  let loseResponse = true;
  const first = client(async (url, options) => {
    const response = await request(url, options);
    if (options?.method === "PUT" && loseResponse) {
      loseResponse = false;
      throw new Error("connection closed after write");
    }
    return response;
  });
  await first.sync.save("2026-07", draft);
  assert.equal(first.entry().status, "offline");
  await first.sync.refresh("2026-07");
  assert.equal(first.entry().status, "synced");
  assert.equal(first.entry().receipt.version, 1);
});

test("an edit made while a save is in flight is not lost", async (t) => {
  const db = database();
  t.after(() => db.close());
  const request = transport(db);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let blocked = false;
  const first = client(async (url, options) => {
    if (options?.method === "PUT" && !blocked) { blocked = true; await gate; }
    return request(url, options);
  });
  const saving = first.sync.save("2026-07", draft);
  first.sync.save("2026-07", { ...draft, receivedCents: 123 });
  release();
  await saving;
  assert.equal(first.entry().status, "synced");
  assert.equal(first.entry().receipt.receivedCents, 123);
  assert.equal(first.entry().receipt.version, 2);
});

test("blocked local storage never claims an offline salary is saved", async () => {
  const blocked = { get length() { throw new Error("blocked"); }, getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const first = client(async () => { throw new Error("offline"); }, blocked);
  await first.sync.save("2026-07", draft);
  assert.equal(first.entry().status, "offline");
  assert.equal(first.entry().locallySaved, false);
  assert.deepEqual(first.entry().pending.receivedCents, draft.receivedCents);
});

const panelProps = {
  className: "summary-mobile", workMonth: "2026-07", monthLabel: "July 2026", payMonthLabel: "August 2026",
  expectedSalary: 17065, visible: true, onSave() {}, onRetry() {}, onToggleVisibility() {},
};

test("salary panel renders the pay month, decimal input, save control, and sharing notice", () => {
  const html = renderToStaticMarkup(React.createElement(SalaryReceivedPanel, panelProps));
  assert.match(html, /Add received salary for August 2026/);
  assert.match(html, /For your July 2026 work calendar/);
  assert.match(html, /inputMode="decimal"/);
  assert.match(html, /Save salary/);
  assert.match(html, /anyone with this site link can view saved salaries/);
  assert.doesNotMatch(html, /salary-comparison-short|salary-comparison-match|salary-comparison-exceed/);
});

test("salary panel renders Short, Match, Exceed and masks all saved amounts", () => {
  const entry = { receipt: { ...draft, version: 1, updatedAt: "2026-08-27T12:00:00.000Z" }, pending: null, status: "synced", locallySaved: true };
  for (const [receivedCents, label, detail] of [[1700000, "Short", "below expected"], [1706500, "Match", "Matches expected salary"], [1707000, "Exceed", "above expected"]]) {
    const html = renderToStaticMarkup(React.createElement(SalaryReceivedPanel, { ...panelProps, entry: { ...entry, receipt: { ...entry.receipt, receivedCents } } }));
    assert.match(html, new RegExp(`<strong>${label}</strong>`));
    assert.ok(html.includes(detail));
    assert.match(html, /Saved online · available on other devices/);
  }
  const hidden = renderToStaticMarkup(React.createElement(SalaryReceivedPanel, { ...panelProps, entry, visible: false }));
  assert.doesNotMatch(hidden, /17,000|17,065|SAR 65/);
  assert.match(hidden, /••••••/);
});

test("salary panel distinguishes pending, failed, and conflicting saves", () => {
  const entry = { receipt: null, pending: { ...draft, id: "pending", expectedVersion: 0 }, status: "offline", locallySaved: true };
  const render = (next) => renderToStaticMarkup(React.createElement(SalaryReceivedPanel, { ...panelProps, entry: next }));
  assert.match(render(entry), /Saved on this device · waiting to sync online/);
  assert.doesNotMatch(render(entry), /Saved online/);
  assert.match(render({ ...entry, locallySaved: false }), /Not saved yet/);
  assert.match(render({ ...entry, status: "conflict" }), /Changed on another device/);
});
