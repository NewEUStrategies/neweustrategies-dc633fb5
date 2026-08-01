// Pure model + parsing for the "progress-carousel" widget (progressive slider).
// Trzymane poza komponentami, żeby renderer i edytor korzystały z jednego
// źródła prawdy i żeby logikę dało się testować bez DOM.
import type { WidgetContent } from "./types";

export type ProgressCarouselLang = "pl" | "en";

export interface ProgressCarouselItem {
  /** Stabilny klucz slajdu (unikalny w obrębie widgetu). */
  value: string;
  img: string;
  title: string;
  desc: string;
  href: string;
}

export interface ProgressCarouselRawItem {
  value?: unknown;
  img?: unknown;
  href?: unknown;
  title_pl?: unknown;
  title_en?: unknown;
  desc_pl?: unknown;
  desc_en?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Slug używany jako `value` slajdu, gdy autor go nie podał. */
export function slugifySlideValue(input: string, index: number): string {
  const base = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `slide-${index + 1}`;
}

/** Wymusza unikalność kluczy slajdów (duplikaty dostają sufiks -2, -3, ...). */
function uniqueValues(values: string[]): string[] {
  const seen = new Map<string, number>();
  return values.map((v) => {
    const n = (seen.get(v) ?? 0) + 1;
    seen.set(v, n);
    return n === 1 ? v : `${v}-${n}`;
  });
}

export function parseProgressCarouselItems(
  c: WidgetContent,
  lang: ProgressCarouselLang,
): ProgressCarouselItem[] {
  const raw = Array.isArray(c.items) ? (c.items as unknown[]) : [];
  const entries = raw.filter(
    (x): x is ProgressCarouselRawItem => typeof x === "object" && x !== null && !Array.isArray(x),
  );
  const titles = entries.map((it) => {
    const pl = str(it.title_pl);
    const en = str(it.title_en);
    return lang === "en" ? en || pl : pl || en;
  });
  const values = uniqueValues(
    entries.map((it, i) => str(it.value) || slugifySlideValue(titles[i] ?? "", i)),
  );
  return entries.map((it, i) => {
    const descPl = str(it.desc_pl);
    const descEn = str(it.desc_en);
    return {
      value: values[i],
      img: str(it.img),
      title: titles[i] ?? "",
      desc: lang === "en" ? descEn || descPl : descPl || descEn,
      href: str(it.href),
    };
  });
}

export const PROGRESS_CAROUSEL_MIN_DURATION = 1000;
export const PROGRESS_CAROUSEL_MAX_DURATION = 30000;

export function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return 5000;
  return Math.min(
    PROGRESS_CAROUSEL_MAX_DURATION,
    Math.max(PROGRESS_CAROUSEL_MIN_DURATION, Math.round(value)),
  );
}

/** Kolejny slajd w pętli. Zwraca ten sam indeks dla pustej listy. */
export function nextIndex(current: number, length: number): number {
  if (length <= 0) return 0;
  return (current + 1) % length;
}
