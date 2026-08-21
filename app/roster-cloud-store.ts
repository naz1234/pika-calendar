import type { StoredRosterFileMetadata, StoredRosterFile } from "./roster-file-store";

const API_PATH = "/api/roster-files";

function validMetadata(value: unknown): value is StoredRosterFileMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<StoredRosterFileMetadata>;
  return (
    typeof metadata.id === "string" && /^[A-Za-z0-9_-]{1,100}$/u.test(metadata.id) &&
    typeof metadata.name === "string" && metadata.name.length > 0 &&
    typeof metadata.type === "string" &&
    typeof metadata.size === "number" && Number.isFinite(metadata.size) && metadata.size >= 0 &&
    typeof metadata.lastModified === "number" && Number.isFinite(metadata.lastModified) &&
    typeof metadata.savedAt === "string" && Number.isFinite(Date.parse(metadata.savedAt))
  );
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  return new Error(typeof body.error === "string" ? body.error : `Shared roster storage failed (${response.status}).`);
}

function uploadContentType(file: File) {
  if (file.type) return file.type;
  if (/\.pdf$/iu.test(file.name)) return "application/pdf";
  if (/\.png$/iu.test(file.name)) return "image/png";
  if (/\.jpe?g$/iu.test(file.name)) return "image/jpeg";
  if (/\.webp$/iu.test(file.name)) return "image/webp";
  return "application/octet-stream";
}

export async function listSharedRosterFiles() {
  const response = await fetch(API_PATH, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
  const body = await response.json() as { files?: unknown; deletedSignatures?: unknown };
  if (!Array.isArray(body.files)) throw new Error("The shared roster list has an invalid format.");
  const deletedSignatures = Array.isArray(body.deletedSignatures)
    ? body.deletedSignatures.filter((value): value is string => typeof value === "string" && value.length <= 500)
    : [];
  return { files: body.files.filter(validMetadata), deletedSignatures };
}

export async function uploadSharedRosterFile(file: File) {
  const response = await fetch(API_PATH, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": uploadContentType(file),
      "X-Roster-File-Name": encodeURIComponent(file.name.slice(0, 180)),
      "X-Roster-Last-Modified": String(file.lastModified),
    },
    body: file,
  });
  if (!response.ok) throw await responseError(response);
  const metadata: unknown = await response.json();
  if (!validMetadata(metadata)) throw new Error("The shared roster response has an invalid format.");
  return metadata;
}

export async function loadSharedRosterFile(id: string): Promise<StoredRosterFile | null> {
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(id)) return null;
  const response = await fetch(`${API_PATH}?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
    headers: { Accept: "application/pdf,image/png,image/jpeg,image/webp,application/octet-stream" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await responseError(response);
  const contentDisposition = response.headers.get("content-disposition") ?? "";
  const encodedName = contentDisposition.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
  const name = encodedName ? decodeURIComponent(encodedName) : "roster-file";
  const blob = await response.blob();
  return {
    blob,
    metadata: {
      id,
      name,
      type: blob.type || "application/octet-stream",
      size: blob.size,
      lastModified: 0,
      savedAt: new Date(0).toISOString(),
    },
  };
}

export async function renameSharedRosterFile(id: string, name: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(id)) throw new Error("Invalid shared roster file id.");
  const response = await fetch(API_PATH, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ id, name }),
  });
  if (!response.ok) throw await responseError(response);
  const metadata: unknown = await response.json();
  if (!validMetadata(metadata)) throw new Error("The renamed roster response has an invalid format.");
  return metadata;
}

export async function deleteSharedRosterFile(id: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(id)) throw new Error("Invalid shared roster file id.");
  const response = await fetch(`${API_PATH}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
}
