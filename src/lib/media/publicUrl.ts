// Publiczne media są prezentowane pod domeną marki. Techniczny host magazynu
// pozostaje wyłącznie szczegółem transportowym i nie trafia do pól w panelu.
export const PUBLIC_MEDIA_ORIGIN = "https://neweuropeanstrategies.com";

const STORAGE_MARKER = "/storage/v1/object/public/media/";
const BRANDED_MARKER = "/media/";

function safeMediaPath(value: string): string | null {
  const path = value
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/")
    .replace(/^\/+/, "");

  if (!path || path.length > 1024 || path.includes("\\") || path.split("/").includes("..")) {
    return null;
  }
  return path;
}

export function mediaStoragePath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed, PUBLIC_MEDIA_ORIGIN);
    const marker = url.pathname.includes(STORAGE_MARKER)
      ? STORAGE_MARKER
      : url.origin === PUBLIC_MEDIA_ORIGIN && url.pathname.startsWith(BRANDED_MARKER)
        ? BRANDED_MARKER
        : null;
    if (!marker) return null;
    return safeMediaPath(url.pathname.slice(url.pathname.indexOf(marker) + marker.length));
  } catch {
    return null;
  }
}

export function brandedMediaUrl(value: string): string {
  const path = mediaStoragePath(value);
  if (!path) return value;
  return `${PUBLIC_MEDIA_ORIGIN}/media/${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}
