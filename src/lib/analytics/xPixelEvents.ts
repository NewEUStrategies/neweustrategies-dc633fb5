// Piksel X Ads (uwt.js) - odsłony przejść SPA.
//
// ŁADOWANIE. Kod bazowy wstawia wyłącznie `ConsentScriptInjector` po zgodzie
// marketingowej; `twq('config', id)` w tym kodzie liczy odsłonę strony wejścia.
//
// ODSŁONY W SPA. uwt.js nie śledzi `history.pushState` (sprawdzone w
// przeglądarce 2026-11-21), więc przejścia routera zgłaszamy sami ponownym
// `twq('config', id)` - przez `trackXPageView`, wołane z tej samej odsłony co
// GA4. Pierwsza strona po starcie jest pomijana (liczy ją kod bazowy), a ta
// sama ścieżka nie liczy się dwa razy z rzędu.
//
// ZGODA. Bez zgody marketingowej i przed `configureXPixel` nic nie wychodzi;
// wycofanie zgody (`resetXPixel`) zatrzymuje wysyłkę od razu i pozwala, by
// ponowna zgoda znów policzyła bieżącą odsłonę. Bez danych osobowych.
import { hasCategoryConsent } from "@/lib/ads/consent";
import { extractXPixelId, X_PIXEL_MARKER } from "./xPixelId";

export { extractXPixelId, X_PIXEL_MARKER };

type TwqFn = (...args: unknown[]) => void;

let pixelId: string | null = null;
let lastPagePath: string | null = null;

function normalizePath(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? "";
  return clean.length > 1 ? clean.replace(/\/+$/, "") : clean || "/";
}

function readTwq(): TwqFn | null {
  if (typeof window === "undefined") return null;
  const candidate: unknown = (window as Window & { twq?: unknown }).twq;
  return typeof candidate === "function" ? (candidate as TwqFn) : null;
}

/** Kod bazowy stoi: zapamiętuje piksel i bieżącą ścieżkę (już policzoną). */
export function configureXPixel(raw: string): void {
  if (typeof window === "undefined") return;
  const id = extractXPixelId(raw);
  pixelId = id || null;
  lastPagePath = id ? normalizePath(window.location.pathname) : null;
}

/** Wycofanie zgody / brak piksela: zapomina konfigurację. */
export function resetXPixel(): void {
  pixelId = null;
  lastPagePath = null;
  if (typeof window !== "undefined") {
    delete (window as Window & { [X_PIXEL_MARKER]?: unknown })[X_PIXEL_MARKER];
  }
}

/**
 * Odsłona po przejściu routera. Zwraca `true`, gdy poszła do piksela; bez
 * zgody, przed startem piksela albo dla tej samej ścieżki - nic.
 */
export function trackXPageView(path?: string): boolean {
  if (typeof window === "undefined" || pixelId === null) return false;
  if (!hasCategoryConsent("marketing")) return false;
  const twq = readTwq();
  if (!twq) return false;
  const next = normalizePath(path ?? window.location.pathname);
  if (next === lastPagePath) return false;
  lastPagePath = next;
  try {
    twq("config", pixelId);
  } catch {
    return false;
  }
  return true;
}
