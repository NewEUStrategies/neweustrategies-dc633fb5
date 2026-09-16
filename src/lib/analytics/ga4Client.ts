// GA4 w przeglądarce - jedno miejsce, w którym dotykamy `gtag`.
//
// TRYB DOMYŚLNEJ ODMOWY GOOGLE (Consent Mode v2). Skrypt tagu ładuje się od
// razu, ale WSZYSTKIE kategorie startują jako `denied`: bez zgody GA4 nie
// zapisuje cookies i nie wysyła identyfikatorów, a zdarzenia trafiają do
// modelowania Google (cookieless pings). Po decyzji odwiedzającego wysyłamy
// `consent update`, więc pełny pomiar zaczyna się dokładnie w chwili zgody.
// Dzięki `wait_for_update` tag wstrzymuje wysyłkę na moment, żeby nie wyprzedzić
// decyzji zapisanej w localStorage.
//
// GPC i podgląd zgód są respektowane, bo mapę kategorii dostajemy z
// `@/lib/ads/consent` (klamra GPC jest tam, nie tutaj).
//
// SSR: każda funkcja no-op-uje bez `window`.

import type { ConsentCategory } from "@/lib/ads/consent";

/** Parametry zdarzenia GA4 - wyłącznie wartości serializowalne. */
export type Ga4Params = Record<string, string | number | boolean | undefined | Ga4ItemList>;

/** Pozycja e-commerce w kształcie oczekiwanym przez GA4. */
export interface Ga4Item {
  item_id: string;
  item_name: string;
  item_category?: string;
  item_variant?: string;
  price?: number;
  quantity?: number;
  currency?: string;
}

export type Ga4ItemList = Ga4Item[];

interface GtagWindow extends Window {
  dataLayer?: unknown[];
  // Tag Google jest zewnętrzny - trzymamy tylko sygnaturę wywołania.
  gtag?: (...args: unknown[]) => void;
}

/** Stan modułu: żeby dwukrotny montaż nie wstawił tagu dwa razy. */
let bootstrappedId: string | null = null;

const SCRIPT_ATTR = "data-ga4-tag";

function win(): GtagWindow | null {
  return typeof window === "undefined" ? null : (window as GtagWindow);
}

/** Kolejka `dataLayer` działa też przed wczytaniem tagu - stąd push, nie fetch. */
export function gtag(...args: unknown[]): void {
  const w = win();
  if (!w) return;
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push(args);
}

/** Domyślne odmowy - wysyłane ZAWSZE przed konfiguracją strumienia. */
export function ga4ConsentDefault(): void {
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    functionality_storage: "denied",
    personalization_storage: "denied",
    security_storage: "granted",
    wait_for_update: 500,
  });
  gtag("set", "url_passthrough", true);
  gtag("set", "ads_data_redaction", true);
}

/** Aktualizacja po decyzji odwiedzającego (baner, panel preferencji, GPC). */
export function ga4ConsentUpdate(categories: Record<ConsentCategory, boolean>): void {
  const grant = (value: boolean) => (value ? "granted" : "denied");
  gtag("consent", "update", {
    ad_storage: grant(categories.marketing),
    ad_user_data: grant(categories.marketing),
    ad_personalization: grant(categories.marketing),
    analytics_storage: grant(categories.analytics),
    functionality_storage: grant(categories.functional),
    personalization_storage: grant(categories.functional),
    security_storage: "granted",
  });
}

/**
 * Identyfikator konwersji Google Ads przypięty do tego samego tagu Google co
 * GA4 (jeden skrypt gtag.js, dwa miejsca docelowe). Publiczny identyfikator
 * witryny - bezpieczny do wplatania w bundel; zmiana konta Ads = zmiana tu.
 */
export const GOOGLE_ADS_ID = "AW-17612160320";

/**
 * Snippet SSR wklejany do `<head>` (patrz `__root.tsx`): natywny tag Google
 * wykrywalny przez weryfikator Google już w pierwszym bajcie HTML, z trybem
 * domyślnej odmowy wysyłanym PRZED konfiguracją strumienia. Tekst jest
 * tożsamy z bootstrapperem klienckim - zmiany trzymać w parze.
 * `adsId` jest głównym identyfikatorem tagu Google (Google Ads); `measurementId`
 * (GA4) konfiguruje się jako dodatkowe miejsce docelowe tego samego tagu.
 */
export function ga4SsrSnippet(measurementId: string, adsId: string = ""): string {
  const ga4 = measurementId.trim();
  const ads = adsId.trim();
  const primary = ads || ga4;
  if (!primary) return "";

  const primaryId = JSON.stringify(primary);
  const ga4Id = ga4 ? JSON.stringify(ga4) : null;

  const configs: string[] = [];
  if (ads) {
    configs.push(`gtag('config',${JSON.stringify(ads)});`);
  }
  if (ga4Id) {
    configs.push(`gtag('config',${ga4Id},{anonymize_ip:true,send_page_view:false});`);
  }

  return [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){dataLayer.push(arguments);}window.gtag=gtag;",
    "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'granted',wait_for_update:500});",
    "gtag('set','url_passthrough',true);",
    "gtag('set','ads_data_redaction',true);",
    "gtag('js',new Date());",
    ...configs,
  ].join("");
}

/**
 * Wstawia tag Google i konfiguruje strumień. Idempotentne dla głównego ID.
 * `send_page_view: false` - odsłony wysyła router (patrz `ga4PageView`), inaczej
 * pierwsza odsłona byłaby zdublowana przy nawigacji SPA.
 */
export function bootstrapGa4(measurementId: string, adsId: string = ""): void {
  const w = win();
  const ga4 = measurementId.trim();
  const ads = adsId.trim();
  const primary = ads || ga4;
  if (!w || !primary) return;
  if (bootstrappedId === primary) return;
  bootstrappedId = primary;

  ga4ConsentDefault();
  gtag("js", new Date());

  // Google Ads jako główne miejsce docelowe tagu (zgodnie z instrukcją Google).
  if (ads) gtag("config", ads);
  // GA4 jako dodatkowe miejsce docelowe tego samego tagu; odsłony wysyła
  // osobno router, więc wyłączamy domyślną odsłonę konfiguracji.
  if (ga4) {
    gtag("config", ga4, {
      anonymize_ip: true,
      send_page_view: false,
    });
  }

  // SSR (`ga4SsrSnippet` w `__root.tsx`) już wstawia ten sam tag - nie
  // duplikujemy skryptu, niezależnie od tego, kto był pierwszy.
  if (document.querySelector(`script[${SCRIPT_ATTR}="${primary}"]`)) return;
  if (document.querySelector('script[src^="https://www.googletagmanager.com/gtag/js"]')) {
    return;
  }
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(primary)}`;
  script.setAttribute(SCRIPT_ATTR, primary);
  document.head.appendChild(script);
}

/** Wyłącznie dla testów - zeruje pamięć bootstrapu. */
export function resetGa4BootstrapForTests(): void {
  bootstrappedId = null;
}

/** Czy strumień jest już skonfigurowany (używane przez mostek zdarzeń). */
export function isGa4Ready(): boolean {
  return bootstrappedId !== null;
}

export function ga4Event(name: string, params: Ga4Params = {}): void {
  if (!isGa4Ready()) return;
  gtag("event", name, params);
}

export function ga4PageView(path: string, title?: string, language?: string): void {
  if (!isGa4Ready()) return;
  gtag("event", "page_view", {
    page_path: path,
    page_location: typeof location === "undefined" ? undefined : location.href,
    page_title: title || (typeof document === "undefined" ? undefined : document.title),
    language: language || undefined,
  });
}

/**
 * Identyfikator klienta GA4 z cookie `_ga` (format `GA1.1.<id>.<ts>`).
 * Potrzebny do zszycia zdarzeń serwerowych (Measurement Protocol) z sesją
 * przeglądarki. Bez zgody na analitykę cookie nie istnieje - zwracamy null i
 * serwer użyje własnego identyfikatora zamówienia.
 */
export function ga4ClientId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)_ga=GA\d\.\d\.(\d+\.\d+)/);
  return match?.[1] ?? null;
}
