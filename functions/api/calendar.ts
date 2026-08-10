import {
  isEncryptedPayload,
  isExpectedVersion,
  readCalendar,
  writeCalendar,
  type D1Database,
} from "../lib/calendar-store";

type Env = { DB?: D1Database };
type PagesContext = { request: Request; env: Env };

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};
const SHARED_CALENDAR_ID = "pika-calendar-public-shared";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function database(context: PagesContext) {
  if (!context.env.DB) {
    throw new Error("Calendar sync is not configured. Add the D1 binding named DB and redeploy.");
  }
  return context.env.DB;
}

export async function onRequestGet(context: PagesContext) {
  try {
    const calendar = await readCalendar(database(context), SHARED_CALENDAR_ID);
    return calendar ? json(calendar) : json({ error: "Calendar not found." }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Calendar sync failed." }, 503);
  }
}

export async function onRequestPut(context: PagesContext) {
  try {
    if (!context.request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "Content-Type must be application/json." }, 415);
    }
    const body = await context.request.json() as {
      payload?: unknown;
      expectedVersion?: unknown;
    };
    if (!isEncryptedPayload(body.payload)) return json({ error: "The encrypted calendar is too large or invalid." }, 400);
    if (!isExpectedVersion(body.expectedVersion)) return json({ error: "A valid expectedVersion is required." }, 400);

    const result = await writeCalendar(database(context), SHARED_CALENDAR_ID, body.payload, body.expectedVersion);
    if ("conflict" in result) {
      return json({ error: "The calendar changed on another device.", version: result.version }, 409);
    }
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Calendar sync failed." }, 503);
  }
}
