const DATABASE_NAME = "daymark-roster-files-v1";
const DATABASE_VERSION = 1;
const FILE_STORE = "files";
const METADATA_STORE = "metadata";
const LATEST_FILE_KEY = "latest";
const MAX_ROSTER_FILE_BYTES = 15 * 1024 * 1024;

export type StoredRosterFileMetadata = {
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

export function createRosterFileMetadata(
  file: Pick<File, "name" | "type" | "size" | "lastModified">,
  savedAt = Date.now(),
): StoredRosterFileMetadata {
  const type = file.type || "application/octet-stream";
  return {
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

function validMetadata(value: unknown): value is StoredRosterFileMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<StoredRosterFileMetadata>;
  return (
    typeof metadata.name === "string" && metadata.name.length > 0 &&
    typeof metadata.type === "string" &&
    typeof metadata.size === "number" && Number.isFinite(metadata.size) && metadata.size >= 0 &&
    typeof metadata.lastModified === "number" && Number.isFinite(metadata.lastModified) &&
    typeof metadata.savedAt === "string" && Number.isFinite(Date.parse(metadata.savedAt))
  );
}

export async function saveLatestRosterFile(file: File) {
  if (file.size > MAX_ROSTER_FILE_BYTES) {
    throw new Error("That roster file is too large to save. Choose one smaller than 15 MB.");
  }

  const metadata = createRosterFileMetadata(file);
  const database = await openRosterFileDatabase();
  try {
    const transaction = database.transaction([FILE_STORE, METADATA_STORE], "readwrite");
    const finished = transactionFinished(transaction);
    transaction.objectStore(FILE_STORE).put(file.slice(0, file.size, metadata.type), LATEST_FILE_KEY);
    transaction.objectStore(METADATA_STORE).put(metadata, LATEST_FILE_KEY);
    await finished;
    return metadata;
  } finally {
    database.close();
  }
}

export async function loadLatestRosterFileMetadata() {
  const database = await openRosterFileDatabase();
  try {
    const transaction = database.transaction(METADATA_STORE, "readonly");
    const finished = transactionFinished(transaction);
    const value = await requestResult<unknown>(transaction.objectStore(METADATA_STORE).get(LATEST_FILE_KEY));
    await finished;
    return validMetadata(value) ? value : null;
  } finally {
    database.close();
  }
}

export async function loadLatestRosterFile(): Promise<StoredRosterFile | null> {
  const database = await openRosterFileDatabase();
  try {
    const transaction = database.transaction([FILE_STORE, METADATA_STORE], "readonly");
    const finished = transactionFinished(transaction);
    const [blob, metadata] = await Promise.all([
      requestResult<unknown>(transaction.objectStore(FILE_STORE).get(LATEST_FILE_KEY)),
      requestResult<unknown>(transaction.objectStore(METADATA_STORE).get(LATEST_FILE_KEY)),
    ]);
    await finished;
    if (!(blob instanceof Blob) || !validMetadata(metadata)) return null;
    return { blob, metadata };
  } finally {
    database.close();
  }
}
