// Czysty model widgetu "circular-carousel" (karuzela okrężna).
// Poza komponentami, żeby renderer i edytor miały jedno źródło prawdy
// i żeby parsowanie dało się testować bez DOM.
import type { WidgetContent } from "./types";

export type CircularCarouselLang = "pl" | "en";

export interface CircularCarouselModelItem {
  id: string;
  title: string;
  description: string;
  tag: string;
  href: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Stabilny klucz karty, gdy autor go nie podał. */
export function slugifyCardId(input: string, index: number): string {
  const base = input
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `card-${index + 1}`;
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((v) => {
    const n = (seen.get(v) ?? 0) + 1;
    seen.set(v, n);
    return n === 1 ? v : `${v}-${n}`;
  });
}

const pickLang = (pl: string, en: string, lang: CircularCarouselLang): string =>
  lang === "en" ? en || pl : pl || en;

export function parseCircularCarouselItems(
  c: WidgetContent,
  lang: CircularCarouselLang,
): CircularCarouselModelItem[] {
  const raw = Array.isArray(c.items) ? (c.items as unknown[]) : [];
  const entries = raw.filter(
    (x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x),
  );
  const titles = entries.map((it) => pickLang(str(it.title_pl), str(it.title_en), lang));
  const ids = uniqueIds(entries.map((it, i) => str(it.id) || slugifyCardId(titles[i] ?? "", i)));
  return entries.map((it, i) => ({
    id: ids[i],
    title: titles[i] ?? "",
    description: pickLang(str(it.desc_pl), str(it.desc_en), lang),
    tag: pickLang(str(it.tag_pl), str(it.tag_en), lang),
    href: str(it.href),
  }));
}

export const CIRCULAR_CAROUSEL_MIN_INTERVAL = 1000;
export const CIRCULAR_CAROUSEL_MAX_INTERVAL = 30000;

export function clampInterval(value: number): number {
  if (!Number.isFinite(value)) return 4000;
  return Math.min(
    CIRCULAR_CAROUSEL_MAX_INTERVAL,
    Math.max(CIRCULAR_CAROUSEL_MIN_INTERVAL, Math.round(value)),
  );
}

/** Liczba widocznych kart: nieparzysta, 3..7. */
export function clampVisibleCount(value: number): number {
  if (!Number.isFinite(value)) return 5;
  const clamped = Math.min(7, Math.max(3, Math.round(value)));
  return clamped % 2 === 0 ? clamped - 1 : clamped;
}

export function clampRadius(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(600, Math.max(40, Math.round(value)));
}
