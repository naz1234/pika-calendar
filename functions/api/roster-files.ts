const FILE_PREFIX = "shared-rosters/";
const MAX_ROSTER_FILE_BYTES = 15 * 1024 * 1024;
const MAX_LISTED_FILES = 250;
const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

type R2Object = {
  key: string;
  size: number;
  uploaded: Date;
  customMetadata?: Record<string, string>;
};

type R2ObjectBody = R2Object & {
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type R2Bucket = {
  delete(key: string): Promise<void>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
    },
  ): Promise<unknown>;
  list(options: {
    prefix: string;
    cursor?: string;
    limit: number;
    include: Array<"customMetadata">;
  }): Promise<{
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }>;
};

type Env = { BUCKET?: R2Bucket };
type PagesContext = { request: Request; env: Env };

export type SharedRosterFileMetadata = {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  savedAt: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function bucket(context: PagesContext) {
  if (!context.env.BUCKET) {
    throw new Error("Shared roster storage is not configured. Add the R2 binding named BUCKET and redeploy.");
  }
  return context.env.BUCKET;
}

function safeFileName(name: string, type: string) {
  const safe = name
    .trim()
    .replace(/[\\/:*?"<>|]/gu, "-")
    .replace(/\p{Cc}/gu, "-")
    .replace(/^\.+/u, "")
    .slice(0, 180);
  if (safe) return safe;
  return type === "application/pdf" ? "roster.pdf" : "roster-image";
}

function decodedFileName(value: string | null) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function rosterContentType(name: string, requestedType: string | null) {
  const normalized = requestedType?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(normalized)) {
    return normalized;
  }
  if (/\.pdf$/iu.test(name)) return "application/pdf";
  if (/\.png$/iu.test(name)) return "image/png";
  if (/\.jpe?g$/iu.test(name)) return "image/jpeg";
  if (/\.webp$/iu.test(name)) return "image/webp";
  return "";
}

function validRosterId(value: string | null): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/u.test(value);
}

function objectMetadata(object: R2Object): SharedRosterFileMetadata | null {
  if (!object.key.startsWith(FILE_PREFIX)) return null;
  if (object.customMetadata?.deleted === "true") return null;
  const id = object.key.slice(FILE_PREFIX.length);
  if (!validRosterId(id)) return null;
  const custom = object.customMetadata ?? {};
  const type = rosterContentType(decodedFileName(custom.name), custom.type) || "application/octet-stream";
  const name = safeFileName(decodedFileName(custom.name), type);
  const savedAt = Number.isFinite(Date.parse(custom.savedAt))
    ? custom.savedAt
    : object.uploaded.toISOString();
  const parsedLastModified = Number(custom.lastModified);
  return {
    id,
    name,
    type,
    size: object.size,
    lastModified: Number.isFinite(parsedLastModified) && parsedLastModified >= 0
      ? parsedLastModified
      : object.uploaded.getTime(),
    savedAt,
  };
}

function rosterFileSignature(metadata: Pick<SharedRosterFileMetadata, "name" | "size" | "lastModified">) {
  return `${metadata.name}\u0000${metadata.size}\u0000${metadata.lastModified}`;
}

function deletedObjectSignature(object: R2Object) {
  const custom = object.customMetadata ?? {};
  if (custom.deleted !== "true") return "";
  const type = rosterContentType(decodedFileName(custom.name), custom.type) || "application/octet-stream";
  const name = safeFileName(decodedFileName(custom.name), type);
  const size = Number(custom.originalSize);
  const lastModified = Number(custom.lastModified);
  if (!Number.isFinite(size) || size < 0 || !Number.isFinite(lastModified) || lastModified < 0) return "";
  return rosterFileSignature({ name, size, lastModified });
}

function storedCustomMetadata(metadata: SharedRosterFileMetadata) {
  return {
    name: encodeURIComponent(metadata.name),
    type: metadata.type,
    lastModified: String(metadata.lastModified),
    savedAt: metadata.savedAt,
  };
}

async function createDeletionTombstone(storage: R2Bucket, metadata: SharedRosterFileMetadata) {
  const tombstoneId = `tombstone-${crypto.randomUUID()}`;
  await storage.put(`${FILE_PREFIX}${tombstoneId}`, new ArrayBuffer(0), {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: {
      ...storedCustomMetadata(metadata),
      deleted: "true",
      originalSize: String(metadata.size),
    },
  });
}

function contentDisposition(name: string) {
  const asciiName = name.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "-");
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function onRequestGet(context: PagesContext) {
  try {
    const storage = bucket(context);
    const requestedId = new URL(context.request.url).searchParams.get("id");
    if (requestedId !== null) {
      if (!validRosterId(requestedId)) return json({ error: "Invalid roster file id." }, 400);
      const object = await storage.get(`${FILE_PREFIX}${requestedId}`);
      if (!object) return json({ error: "Roster file not found." }, 404);
      const metadata = objectMetadata(object);
      if (!metadata) return json({ error: "Roster file metadata is invalid." }, 500);
      return new Response(object.body, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": contentDisposition(metadata.name),
          "Content-Length": String(metadata.size),
          "Content-Type": metadata.type,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const objects: R2Object[] = [];
    let cursor: string | undefined;
    do {
      const page = await storage.list({
        prefix: FILE_PREFIX,
        cursor,
        limit: Math.min(1_000, MAX_LISTED_FILES - objects.length),
        include: ["customMetadata"],
      });
      objects.push(...page.objects);
      cursor = page.truncated && objects.length < MAX_LISTED_FILES ? page.cursor : undefined;
    } while (cursor && objects.length < MAX_LISTED_FILES);

    const files = objects
      .map(objectMetadata)
      .filter((metadata): metadata is SharedRosterFileMetadata => metadata !== null)
      .sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
    const deletedSignatures = [...new Set(objects.map(deletedObjectSignature).filter(Boolean))];
    return json({ files, deletedSignatures });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Shared roster storage failed." }, 503);
  }
}

export async function onRequestPost(context: PagesContext) {
  try {
    const storage = bucket(context);
    const declaredSize = Number(context.request.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_ROSTER_FILE_BYTES) {
      return json({ error: "That roster file is too large. Choose one smaller than 15 MB." }, 413);
    }

    const rawName = decodedFileName(context.request.headers.get("x-roster-file-name"));
    const type = rosterContentType(rawName, context.request.headers.get("content-type"));
    if (!type) return json({ error: "Upload a PDF, PNG, JPG, or WebP roster file." }, 415);
    const name = safeFileName(rawName, type);
    const data = await context.request.arrayBuffer();
    if (data.byteLength === 0) return json({ error: "The roster file is empty." }, 400);
    if (data.byteLength > MAX_ROSTER_FILE_BYTES) {
      return json({ error: "That roster file is too large. Choose one smaller than 15 MB." }, 413);
    }

    const id = crypto.randomUUID();
    const savedAt = new Date().toISOString();
    const requestedLastModified = Number(context.request.headers.get("x-roster-last-modified"));
    const lastModified = Number.isFinite(requestedLastModified) && requestedLastModified >= 0
      ? requestedLastModified
      : Date.now();
    const metadata: SharedRosterFileMetadata = {
      id,
      name,
      type,
      size: data.byteLength,
      lastModified,
      savedAt,
    };
    await storage.put(`${FILE_PREFIX}${id}`, data, {
      httpMetadata: { contentType: type },
      customMetadata: storedCustomMetadata(metadata),
    });
    return json(metadata, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The roster file could not be shared." }, 503);
  }
}

export async function onRequestPatch(context: PagesContext) {
  try {
    const storage = bucket(context);
    if (!context.request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "Content-Type must be application/json." }, 415);
    }
    const body = await context.request.json() as { id?: unknown; name?: unknown };
    const id = typeof body.id === "string" ? body.id : null;
    if (!validRosterId(id)) {
      return json({ error: "Invalid roster file id." }, 400);
    }
    if (typeof body.name !== "string" || !body.name.trim()) {
      return json({ error: "A file name is required." }, 400);
    }
    const key = `${FILE_PREFIX}${id}`;
    const object = await storage.get(key);
    if (!object) return json({ error: "Roster file not found." }, 404);
    const current = objectMetadata(object);
    if (!current) return json({ error: "Roster file metadata is invalid." }, 500);
    const name = safeFileName(body.name, current.type);
    if (name === current.name) return json(current);

    const renamed = { ...current, name };
    const data = await object.arrayBuffer();
    await storage.put(key, data, {
      httpMetadata: { contentType: renamed.type },
      customMetadata: storedCustomMetadata(renamed),
    });
    await createDeletionTombstone(storage, current);
    return json(renamed);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The roster file could not be renamed." }, 503);
  }
}

export async function onRequestDelete(context: PagesContext) {
  try {
    const storage = bucket(context);
    const requestedId = new URL(context.request.url).searchParams.get("id");
    if (!validRosterId(requestedId)) return json({ error: "Invalid roster file id." }, 400);
    const key = `${FILE_PREFIX}${requestedId}`;
    const object = await storage.get(key);
    if (!object) return json({ error: "Roster file not found." }, 404);
    const metadata = objectMetadata(object);
    if (!metadata) return json({ error: "Roster file metadata is invalid." }, 500);
    await storage.delete(key);
    await createDeletionTombstone(storage, metadata);
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The roster file could not be deleted." }, 503);
  }
}
