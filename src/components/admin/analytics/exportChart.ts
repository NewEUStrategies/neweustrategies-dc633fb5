/**
 * Chart data export helpers. Kept dependency-free so importing them does NOT
 * drag the ECharts module graph into the SSR bundle - `exportPng` receives an
 * `ECharts` instance as a parameter (already client-side by construction) and
 * asks it for a base64 canvas via `getDataURL`, no static echarts import here.
 *
 * CSV export follows RFC 4180 with CRLF line endings and quotes any cell that
 * contains a delimiter, quote, or newline. The BOM prefix makes Excel treat
 * the file as UTF-8 without prompting for encoding.
 */
import type { ECharts } from "echarts/core";

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsv(headers: string[], rows: readonly (readonly unknown[])[]): string {
  const bom = "\uFEFF";
  const head = headers.map(escapeCell).join(",");
  const body = rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
  return `${bom}${head}\r\n${body}`;
}

function triggerDownload(filename: string, blob: Blob): void {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(
  filename: string,
  headers: string[],
  rows: readonly (readonly unknown[])[],
): void {
  const blob = new Blob([buildCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  triggerDownload(filename.endsWith(".csv") ? filename : `${filename}.csv`, blob);
}

export function exportPng(filename: string, instance: ECharts | null | undefined): void {
  if (!instance) return;
  const url = instance.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
  const bin = atob(url.split(",")[1] ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  triggerDownload(
    filename.endsWith(".png") ? filename : `${filename}.png`,
    new Blob([bytes], { type: "image/png" }),
  );
}
