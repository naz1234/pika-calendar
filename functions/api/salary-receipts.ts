import { isSalaryReceiptDraft, isWorkMonth } from "../../app/salary-receipts";
import { isExpectedVersion, readCalendar, writeCalendar, type D1Database } from "../lib/calendar-store";

type PagesContext = { request: Request; env: { DB?: D1Database } };
const ID_PREFIX = "pika-calendar-public-salary-";
const HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function database(context: PagesContext) {
  if (!context.env.DB) throw new Error("Salary sync is not configured. Add the D1 binding named DB and redeploy.");
  return context.env.DB;
}

export async function onRequestGet(context: PagesContext) {
  const month = new URL(context.request.url).searchParams.get("month");
  if (!isWorkMonth(month)) return json({ error: "A valid work month is required." }, 400);
  try {
    const record = await readCalendar(database(context), `${ID_PREFIX}${month}`);
    if (!record) return json({ error: "No received salary saved for this month." }, 404);
    const draft: unknown = JSON.parse(record.payload);
    if (!isSalaryReceiptDraft(draft)) throw new Error("The saved salary is invalid.");
    return json({ ...draft, version: record.version, updatedAt: record.updatedAt });
  } catch {
    return json({ error: "Salary sync is unavailable. Check the D1 binding named DB." }, 503);
  }
}

export async function onRequestPut(context: PagesContext) {
  const month = new URL(context.request.url).searchParams.get("month");
  if (!isWorkMonth(month)) return json({ error: "A valid work month is required." }, 400);
  if (!context.request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "Content-Type must be application/json." }, 415);
  }
  // Salary writes are tiny; bound the data before parsing it.
  if (Number(context.request.headers.get("content-length")) > 1024) {
    return json({ error: "Salary data is too large." }, 413);
  }
  const bodyText = await context.request.text();
  if (bodyText.length > 1024) return json({ error: "Salary data is too large." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return json({ error: "Invalid salary data." }, 400);
  }
  const expectedVersion = (body as { expectedVersion?: unknown } | null)?.expectedVersion;
  if (!isSalaryReceiptDraft(body) || !isExpectedVersion(expectedVersion)) {
    return json({ error: "Valid received salary, expected salary, and version are required." }, 400);
  }
  try {
    const draft = { receivedCents: body.receivedCents, expectedCents: body.expectedCents };
    const saved = await writeCalendar(database(context), `${ID_PREFIX}${month}`, JSON.stringify(draft), expectedVersion);
    if ("conflict" in saved) return json({ error: "Salary changed on another device. Review and save again." }, 409);
    return json({ ...draft, ...saved });
  } catch {
    return json({ error: "Salary sync is unavailable. Check the D1 binding named DB." }, 503);
  }
}
