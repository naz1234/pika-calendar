export const MAX_ENCRYPTED_PAYLOAD_BYTES = 1_000_000;

export type D1Result = {
  meta?: { changes?: number };
};

export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<D1Result>;
};

export type D1Database = {
  prepare(query: string): D1PreparedStatement;
};

export type StoredCalendar = {
  version: number;
  payload: string;
  updatedAt: string;
};

const CREATE_CALENDARS_TABLE = `CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export function isCalendarId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function isEncryptedPayload(value: unknown): value is string {
  return typeof value === "string" && new TextEncoder().encode(value).byteLength <= MAX_ENCRYPTED_PAYLOAD_BYTES;
}

export function isExpectedVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

async function ensureSchema(db: D1Database) {
  await db.prepare(CREATE_CALENDARS_TABLE).run();
}

export async function readCalendar(db: D1Database, id: string): Promise<StoredCalendar | null> {
  await ensureSchema(db);
  return db
    .prepare("SELECT payload, version, updated_at AS updatedAt FROM calendars WHERE id = ?")
    .bind(id)
    .first<StoredCalendar>();
}

export async function writeCalendar(
  db: D1Database,
  id: string,
  payload: string,
  expectedVersion: number,
) {
  await ensureSchema(db);
  const updatedAt = new Date().toISOString();

  if (expectedVersion === 0) {
    const inserted = await db
      .prepare("INSERT OR IGNORE INTO calendars (id, payload, version, updated_at) VALUES (?, ?, 1, ?)")
      .bind(id, payload, updatedAt)
      .run();
    if ((inserted.meta?.changes ?? 0) > 0) return { version: 1, updatedAt };
  } else {
    const updated = await db
      .prepare("UPDATE calendars SET payload = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .bind(payload, updatedAt, id, expectedVersion)
      .run();
    if ((updated.meta?.changes ?? 0) > 0) return { version: expectedVersion + 1, updatedAt };
  }

  const current = await readCalendar(db, id);
  return { conflict: true as const, version: current?.version ?? 0 };
}
