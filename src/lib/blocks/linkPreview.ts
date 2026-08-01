// Logika bloku "Podgląd linku" (link preview) - czysta, bez Reacta.
// Podgląd to funkcjonalność OPCJONALNA: gdy `preview` = false, blok renderuje
// zwykłe linki (bez hover-card i bez zewnętrznego zapytania o zrzut ekranu).

import type { Block, Json } from "./types";

export type LinkPreviewLang = "pl" | "en";
export type LinkPreviewLayout = "inline" | "list";

export interface LinkPreviewItem {
  /** Etykieta PL (fallback dla EN). */
  labelPl: string;
  /** Etykieta EN (fallback: PL). */
  labelEn: string;
  /** Docelowy adres (http/https). */
  url: string;
  /** Statyczny obrazek podglądu; pusty => zrzut ekranu z Microlink. */
  imageSrc: string;
}

export interface LinkPreviewData {
  introPl: string;
  introEn: string;
  items: LinkPreviewItem[];
  /** Opcjonalna funkcjonalność: hover-podgląd on/off. */
  preview: boolean;
  layout: LinkPreviewLayout;
  width: number;
  height: number;
}

export const LINK_PREVIEW_DEFAULT_WIDTH = 200;
export const LINK_PREVIEW_DEFAULT_HEIGHT = 125;
const MIN_SIDE = 120;
const MAX_SIDE = 480;

const str = (v: Json | undefined): string => (typeof v === "string" ? v : "");

export function clampPreviewSide(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(n)));
}

/** Tylko http(s) - blokuje javascript:, data:, itp. */
export function isSafeHttpUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Dokleja https:// gdy użytkownik wpisał "example.com". */
export function normalizeUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return isSafeHttpUrl(value) ? value : "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return ""; // inny protokół -> odrzucamy
  const candidate = `https://${value}`;
  return isSafeHttpUrl(candidate) ? candidate : "";
}

export function pickLabel(item: LinkPreviewItem, lang: LinkPreviewLang): string {
  const primary = lang === "en" ? item.labelEn : item.labelPl;
  const fallback = lang === "en" ? item.labelPl : item.labelEn;
  return primary.trim() || fallback.trim() || item.url;
}

export function pickIntro(data: LinkPreviewData, lang: LinkPreviewLang): string {
  const primary = lang === "en" ? data.introEn : data.introPl;
  const fallback = lang === "en" ? data.introPl : data.introEn;
  return primary.trim() || fallback.trim();
}

/** Odpowiednik `qss.encode` - stabilna kolejność, poprawne kodowanie. */
export function encodeQuery(params: Record<string, string | number | boolean>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export interface ScreenshotOptions {
  url: string;
  width: number;
  height: number;
  colorScheme?: "light" | "dark";
}

/** URL zrzutu ekranu strony (Microlink) - używany gdy brak statycznego obrazka. */
export function microlinkScreenshotUrl(opts: ScreenshotOptions): string {
  const params = encodeQuery({
    url: opts.url,
    screenshot: true,
    meta: false,
    embed: "screenshot.url",
    colorScheme: opts.colorScheme ?? "light",
    "viewport.isMobile": true,
    "viewport.deviceScaleFactor": 1,
    "viewport.width": Math.round(opts.width * 3),
    "viewport.height": Math.round(opts.height * 3),
  });
  return `https://api.microlink.io/?${params}`;
}

export function previewImageUrl(
  item: LinkPreviewItem,
  data: Pick<LinkPreviewData, "width" | "height">,
  colorScheme: "light" | "dark" = "light",
): string {
  const staticSrc = item.imageSrc.trim();
  if (staticSrc) return staticSrc;
  return microlinkScreenshotUrl({
    url: item.url,
    width: data.width,
    height: data.height,
    colorScheme,
  });
}

export function normalizeLinkPreviewItem(raw: unknown): LinkPreviewItem | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, Json>;
  const url = normalizeUrl(str(rec.url));
  if (!url) return null;
  return {
    labelPl: str(rec.labelPl),
    labelEn: str(rec.labelEn),
    url,
    imageSrc: normalizeImageSrc(str(rec.imageSrc)),
  };
}

/** Bezpieczne odczytanie danych bloku (public renderer + edytor). */
export function normalizeLinkPreviewData(data: Record<string, Json>): LinkPreviewData {
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items: LinkPreviewItem[] = [];
  for (const raw of rawItems) {
    const item = normalizeLinkPreviewItem(raw);
    if (item) items.push(item);
  }
  const layout: LinkPreviewLayout = data.layout === "list" ? "list" : "inline";
  return {
    introPl: str(data.introPl),
    introEn: str(data.introEn),
    items,
    preview: data.preview !== false,
    layout,
    width: clampPreviewSide(data.width, LINK_PREVIEW_DEFAULT_WIDTH),
    height: clampPreviewSide(data.height, LINK_PREVIEW_DEFAULT_HEIGHT),
  };
}

/** Blok jest pusty (nic do wyrenderowania publicznie). */
export function isEmptyLinkPreview(block: Block): boolean {
  return normalizeLinkPreviewData(block.data).items.length === 0;
}
