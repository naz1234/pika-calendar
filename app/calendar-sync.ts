import type { CalendarEventRecord } from "./roster-merge";

export const SHARED_SYNC_SECRET = "pika-calendar-public-sync-000001";

const API_PATH = "/api/calendar";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type EncryptedEnvelope = {
  v: 1;
  iv: string;
  data: string;
};

export type RemoteCalendar = {
  version: number;
  payload: string;
  updatedAt: string;
};

export class SyncConflictError extends Error {
  currentVersion: number;

  constructor(currentVersion: number) {
    super("The calendar changed on another device.");
    this.name = "SyncConflictError";
    this.currentVersion = currentVersion;
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function encryptionKey(secret: string) {
  const keyBytes = await digest(`pika-calendar-encryption-v1:${secret}`);
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function mergeSharedCalendarEvents(
  remoteEvents: readonly CalendarEventRecord[],
  localEvents: readonly CalendarEventRecord[],
) {
  const merged = [...remoteEvents];
  const indexes = new Map(merged.map((event, index) => [event.id, index]));
  localEvents.forEach((localEvent) => {
    const index = indexes.get(localEvent.id);
    if (index === undefined) {
      indexes.set(localEvent.id, merged.length);
      merged.push(localEvent);
      return;
    }
    if (Date.parse(localEvent.updatedAt) > Date.parse(merged[index].updatedAt)) {
      merged[index] = localEvent;
    }
  });
  return merged;
}

export async function encryptCalendarEvents(secret: string, events: readonly CalendarEventRecord[]) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const plaintext = encoder.encode(JSON.stringify({ version: 1, events }));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return JSON.stringify({
    v: 1,
    iv: bytesToBase64Url(iv),
    data: bytesToBase64Url(new Uint8Array(encrypted)),
  } satisfies EncryptedEnvelope);
}

export async function decryptCalendarEvents(secret: string, payload: string): Promise<unknown> {
  const envelope = JSON.parse(payload) as Partial<EncryptedEnvelope>;
  if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.data !== "string") {
    throw new Error("The synced calendar has an unsupported format.");
  }
  const key = await encryptionKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(envelope.iv) },
    key,
    base64UrlToBytes(envelope.data),
  );
  const decoded = JSON.parse(decoder.decode(decrypted)) as { version?: unknown; events?: unknown };
  if (decoded.version !== 1 || !Array.isArray(decoded.events)) {
    throw new Error("The synced calendar has an unsupported format.");
  }
  return decoded.events;
}

async function parseError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: unknown; version?: unknown };
  return {
    message: typeof body.error === "string" ? body.error : `Calendar sync failed (${response.status})`,
    version: typeof body.version === "number" ? body.version : 0,
  };
}

export async function fetchRemoteCalendar(): Promise<RemoteCalendar | null> {
  const response = await fetch(API_PATH, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = await parseError(response);
    throw new Error(error.message);
  }
  return response.json() as Promise<RemoteCalendar>;
}

export async function saveRemoteCalendar(
  events: readonly CalendarEventRecord[],
  expectedVersion: number,
) {
  const payload = await encryptCalendarEvents(SHARED_SYNC_SECRET, events);
  const response = await fetch(API_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ payload, expectedVersion }),
  });
  if (response.status === 409) {
    const error = await parseError(response);
    throw new SyncConflictError(error.version);
  }
  if (!response.ok) {
    const error = await parseError(response);
    throw new Error(error.message);
  }
  return response.json() as Promise<{ version: number; updatedAt: string }>;
}
