const DATABASE_NAME = "daymark-roster-files-v1";
const DATABASE_VERSION = 1;
const FILE_STORE = "files";
const METADATA_STORE = "metadata";
const MAX_ROSTER_FILE_BYTES = 15 * 1024 * 1024;

export type StoredRosterFileMetadata = {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  savedAt: string;
};

export type StoredRosterFile = {
  metadata: StoredRosterFileMetadata;
  blob: Blob;
};

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

function createRosterFileId(savedAt: number) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `roster-${crypto.randomUUID()}`;
  }
  return `roster-${savedAt}-${Math.random().toString(36).slice(2)}`;
}

export function createRosterFileMetadata(
  file: Pick<File, "name" | "type" | "size" | "lastModified">,
  savedAt = Date.now(),
  id = createRosterFileId(savedAt),
): StoredRosterFileMetadata {
  const type = file.type || "application/octet-stream";
  return {
    id,
    name: safeFileName(file.name, type),
    type,
    size: file.size,
    lastModified: file.lastModified,
    savedAt: new Date(savedAt).toISOString(),
  };
}

function openRosterFileDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Persistent file storage is unavailable in this browser."));
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(FILE_STORE)) database.createObjectStore(FILE_STORE);
      if (!database.objectStoreNames.contains(METADATA_STORE)) database.createObjectStore(METADATA_STORE);
    };
    request.onerror = () => reject(request.error ?? new Error("The saved roster database could not be opened."));
    request.onblocked = () => reject(new Error("The saved roster database is busy. Close other calendar tabs and try again."));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionFinished(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("The roster file transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The roster file transaction was cancelled."));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The saved roster file could not be read."));
  });
}

export function normalizeStoredRosterFileMetadata(
  value: unknown,
  storageKey: IDBValidKey,
): StoredRosterFileMetadata | null {
  if (!value || typeof value !== "object") return null;
  const metadata = value as Partial<StoredRosterFileMetadata>;
  if (!(
    typeof metadata.name === "string" && metadata.name.length > 0 &&
    typeof metadata.type === "string" &&
    typeof metadata.size === "number" && Number.isFinite(metadata.size) && metadata.size >= 0 &&
    typeof metadata.lastModified === "number" && Number.isFinite(metadata.lastModified) &&
    typeof metadata.savedAt === "string" && Number.isFinite(Date.parse(metadata.savedAt))
  )) return null;

  const id = typeof storageKey === "string" && storageKey.length > 0
    ? storageKey
    : typeof metadata.id === "string" && metadata.id.length > 0
      ? metadata.id
      : "";
  if (!id) return null;
  return {
    id,
    name: metadata.name,
    type: metadata.type,
    size: metadata.size,
    lastModified: metadata.lastModified,
    savedAt: metadata.savedAt,
  };
}

export async function saveRosterFile(file: File) {
  if (file.size > MAX_ROSTER_FILE_BYTES) {
    throw new Error("That roster file is too large to save. Choose one smaller than 15 MB.");
  }

  const metadata = createRosterFileMetadata(file);
  const database = await openRosterFileDatabase();
  try {
    const transaction = database.transaction([FILE_STORE, METADATA_STORE], "readwrite");
    const finished = transactionFinished(transaction);
    transaction.objectStore(FILE_STORE).put(file.slice(0, file.size, metadata.type), metadata.id);
    transaction.objectStore(METADATA_STORE).put(metadata, metadata.id);
    await finished;
    return metadata;
  } finally {
    database.close();
  }
}

export async function listStoredRosterFileMetadata() {
  const database = await openRosterFileDatabase();
  try {
    const transaction = database.transaction(METADATA_STORE, "readonly");
    const finished = transactionFinished(transaction);
    const store = transaction.objectStore(METADATA_STORE);
    const [keys, values] = await Promise.all([
      requestResult<IDBValidKey[]>(store.getAllKeys()),
      requestResult<unknown[]>(store.getAll()),
    ]);
    await finished;
    return values
      .map((value, index) => normalizeStoredRosterFileMetadata(value, keys[index]))
      .filter((metadata): metadata is StoredRosterFileMetadata => metadata !== null)
      .sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
  } finally {
    database.close();
  }
}

export async function loadStoredRosterFile(id: string): Promise<StoredRosterFile | null> {
  if (!id) return null;
  const database = await openRosterFileDatabase();
  try {
    const transaction = database.transaction([FILE_STORE, METADATA_STORE], "readonly");
    const finished = transactionFinished(transaction);
    const [blob, metadata] = await Promise.all([
      requestResult<unknown>(transaction.objectStore(FILE_STORE).get(id)),
      requestResult<unknown>(transaction.objectStore(METADATA_STORE).get(id)),
    ]);
    await finished;
    const normalizedMetadata = normalizeStoredRosterFileMetadata(metadata, id);
    if (!(blob instanceof Blob) || !normalizedMetadata) return null;
    return { blob, metadata: normalizedMetadata };
  } finally {
    database.close();
  }
}

export async function renameStoredRosterFile(
  metadata: StoredRosterFileMetadata,
  name: string,
) {
  const renamed = { ...metadata, name: safeFileName(name, metadata.type) };
  const database = await openRosterFileDatabase();
  try {
    const transaction = database.transaction(METADATA_STORE, "readwrite");
    const finished = transactionFinished(transaction);
    transaction.objectStore(METADATA_STORE).put(renamed, metadata.id);
    await finished;
    return renamed;
  } finally {
    database.close();
  }
}

export async function deleteStoredRosterFile(id: string) {
  if (!id) return;
  const database = await openRosterFileDatabase();
  try {
    const transaction = database.transaction([FILE_STORE, METADATA_STORE], "readwrite");
    const finished = transactionFinished(transaction);
    transaction.objectStore(FILE_STORE).delete(id);
    transaction.objectStore(METADATA_STORE).delete(id);
    await finished;
  } finally {
    database.close();
  }
}
