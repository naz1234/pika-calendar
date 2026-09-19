import { isChecklistMonth, isChecklistTasks } from "../../app/personal-checklist";
import { isExpectedVersion, readCalendar, writeCalendar, type D1Database } from "../lib/calendar-store";

type Context = { request: Request; env: { DB?: D1Database } };
const PREFIX = "pika-calendar-public-checklist-";
const MAX_BYTES = 500_000;
const HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function onRequestGet({ request, env }: Context) {
  const month = new URL(request.url).searchParams.get("month");
  if (!isChecklistMonth(month)) return json({ error: "A valid month is required." }, 400);
  try {
    if (!env.DB) throw new Error("Missing DB");
    const record = await readCalendar(env.DB, `${PREFIX}${month}`);
    if (!record) return json({ tasks: [], version: 0 });
    const tasks: unknown = JSON.parse(record.payload);
    if (!isChecklistTasks(tasks)) throw new Error("Invalid checklist");
    return json({ tasks, version: record.version });
  } catch {
    return json({ error: "Checklist sync is unavailable." }, 503);
  }
}

export async function onRequestPut({ request, env }: Context) {
  const month = new URL(request.url).searchParams.get("month");
  if (!isChecklistMonth(month)) return json({ error: "A valid month is required." }, 400);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "Content-Type must be application/json." }, 415);
  }
  if (Number(request.headers.get("content-length")) > MAX_BYTES) return json({ error: "Checklist is too large." }, 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return json({ error: "Checklist is too large." }, 413);
  let body: { tasks?: unknown; expectedVersion?: unknown } | null;
  try { body = JSON.parse(text); } catch { return json({ error: "Invalid checklist data." }, 400); }
  if (!isChecklistTasks(body?.tasks) || !isExpectedVersion(body?.expectedVersion)) {
    return json({ error: "Valid checklist tasks and version are required." }, 400);
  }
  try {
    if (!env.DB) throw new Error("Missing DB");
    const saved = await writeCalendar(env.DB, `${PREFIX}${month}`, JSON.stringify(body.tasks), body.expectedVersion);
    if ("conflict" in saved) return json({ error: "Checklist changed on another device." }, 409);
    return json({ version: saved.version });
  } catch {
    return json({ error: "Checklist sync is unavailable." }, 503);
  }
}
