/**
 * Pure formatting helpers for media metadata (size, extension).
 * Locale-neutral by design: the UI layer supplies translated labels.
 */

/** Human-readable byte size, e.g. 0 B, 512 B, 1.5 KB, 12 MB. */
export function formatBytes(n: number | null | undefined): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v = v / 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Uppercased file extension without the dot, or "" when there is none. */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toUpperCase() : "";
}
