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
// JEDEN TAG, DWA MIEJSCA DOCELOWE. gtag.js ładuje się RAZ, identyfikatorem
// strumienia GA4 (`?id=G-…`): po nim weryfikator Google rozpoznaje instalację
// i on decyduje, które ustawienia tagu Google się wczytają. Każde
// `gtag('config', ID)` rejestruje osobne miejsce docelowe (GA4, Google Ads);
// zdarzenia bez `send_to` trafiają do WSZYSTKICH skonfigurowanych.
//
// SNIPPET SSR I BOOTSTRAP KLIENCKI. `ga4SsrSnippet` (w `<head>` przez
// `__root.tsx`) wykonuje te same polecenia, zanim wystartuje React. Bootstrap
// kliencki ROZPOZNAJE ten stan (`window.gtag` + `<script src=…gtag/js?id=…>`
// bez znacznika klienckiego) i przejmuje go, nie powtarzając poleceń - drugi
// `config` to drugi ping Google Ads przy wejściu.
//
// POLECENIA JAKO `arguments`, NIE TABLICE. gtag.js rozpoznaje polecenie po
// obiekcie `arguments` wypchniętym do `dataLayer` - tak robi oficjalny snippet
// `function gtag(){dataLayer.push(arguments);}`. Zwykła tablica `['event', …]`
// jest dla niego zwykłym wpisem warstwy danych: zgoda, odsłony i zdarzenia
// pchane tablicą nigdy nie dojechałyby do GA4.
//
// GPC i podgląd zgód są respektowane, bo mapę kategorii dostajemy z
// `@/lib/ads/consent` (klamra GPC jest tam, nie tutaj).
//
// SSR: każda funkcja no-op-uje bez `window`.

import type { ConsentCategory } from "@/lib/ads/consent";
import { GA4_MEASUREMENT_ID, asGa4MeasurementId } from "./tagIds";

export { GA4_MEASUREMENT_ID, GOOGLE_ADS_ID, asGa4MeasurementId, asGoogleAdsId } from "./tagIds";

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

type GtagFn = (...args: unknown[]) => void;

interface GtagWindow extends Window {
  dataLayer?: unknown[];
  // Tag Google jest zewnętrzny; `unknown`, bo na `window.gtag` potrafi
  // wylądować cokolwiek (pomyłka wdrożeniowa, atrapa w teście).
  gtag?: unknown;
  /** Identyfikator strumienia, który skonfigurował snippet SSR - patrz `SSR_TAG_GLOBAL`. */
  [SSR_TAG_GLOBAL]?: unknown;
}

/** Stan modułu: żeby dwukrotny montaż nie wstawił tagu dwa razy. */
let bootstrappedPrimary: string | null = null;
let bootstrappedGa4: string | null = null;

/** Znacznik skryptu wstawionego przez bootstrap KLIENCKI (SSR go nie ma). */
const SCRIPT_ATTR = "data-ga4-tag";
const GTAG_SRC_PREFIX = "https://www.googletagmanager.com/gtag/js";

/**
 * Globalna „pieczątka" snippetu SSR: identyfikator strumienia, dla którego
 * `<head>` wykonał już zgodę domyślną, `js` i oba `config`.
 *
 * PO CO W OGÓLE ISTNIEJE. Do 2026-09-20 tę rolę pełnił SAM `<script src=
 * …gtag/js?id=…>` w `<head>`: obecność węzła mówiła klientowi „SSR już tu
 * był". Ten węzeł zszedł z `<head>` (audyt CWV, F20 / plan 3.3 - obcy origin
 * i ~90 KB w oknie hydratacji, przed `markAppReady()`), a bez niego klient
 * nie miał ŻADNEGO sygnału i wypchnąłby drugi komplet poleceń: drugi
 * `config` to drugi ping Google Ads przy wejściu, a drugi `consent default`
 * cofałby okno `wait_for_update`. Pieczątka niesie dokładnie tę wiedzę, którą
 * niósł węzeł - i nic więcej. Kolejka `dataLayer` działa bez skryptu, więc
 * odsłony i zdarzenia z tego okna czekają w niej i schodzą, gdy tag dojedzie.
 */
const SSR_TAG_GLOBAL = "__nesGa4SsrTag";

function win(): GtagWindow | null {
  return typeof window === "undefined" ? null : (window as GtagWindow);
}

function layerOf(w: GtagWindow): unknown[] {
  if (!Array.isArray(w.dataLayer)) w.dataLayer = [];
  return w.dataLayer;
}

/** Wypycha polecenie jako obiekt `arguments` - jedyny kształt komendy dla gtag.js. */
function pushCommand(layer: unknown[], args: unknown[]): void {
  const push = function () {
    // eslint-disable-next-line prefer-rest-params
    layer.push(arguments);
  };
  Reflect.apply(push, null, args);
}

/** Definicja tożsama ze snippetem SSR - dokładana tylko, gdy nikt jej jeszcze nie dał. */
function ensureWindowGtag(w: GtagWindow): void {
  if (w.gtag !== undefined) return;
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    layerOf(w).push(arguments);
  };
}

function gtagScript(): HTMLScriptElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLScriptElement>(`script[src^="${GTAG_SRC_PREFIX}"]`);
}

function tagIdOf(script: HTMLScriptElement | null): string {
  if (!script) return "";
  try {
    const url = new URL(script.getAttribute("src") ?? "", GTAG_SRC_PREFIX);
    return url.searchParams.get("id")?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Pieczątka snippetu SSR (patrz `SSR_TAG_GLOBAL`) - "" gdy snippet nie biegł. */
function ssrTagMark(): string {
  const w = win();
  const value: unknown = w ? w[SSR_TAG_GLOBAL] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Identyfikator, którym snippet SSR (`__root.tsx`) skonfigurował strumień -
 * "" gdy snippet w tym dokumencie nie biegł. Czytamy najpierw pieczątkę
 * (`SSR_TAG_GLOBAL`), a dopiero potem węzeł `<script src>` - dokumenty
 * sprzed przeniesienia tagu za bezczynność (wpisy utrwalone na brzegu) mają
 * jeszcze tamten węzeł i muszą być rozpoznawane tak samo.
 *
 * Skrypt wstawiony przez bootstrap kliencki (ze znacznikiem `data-ga4-tag`)
 * się NIE liczy: klient ma się dopiąć do tagu z SSR, ale własną konfigurację
 * może zmieniać (test zmiany strumienia).
 */
export function ssrGtagId(): string {
  const marked = ssrTagMark();
  if (marked) return marked;
  if (typeof document === "undefined") return "";
  return tagIdOf(
    document.querySelector<HTMLScriptElement>(
      `script[src^="${GTAG_SRC_PREFIX}"]:not([${SCRIPT_ATTR}])`,
    ),
  );
}

/**
 * Identyfikator GA4 dla bootstrapu klienckiego. Kolejność:
 *  1. tag już wczytany przez snippet SSR - klient dopina się do TEGO strumienia,
 *     zamiast konfigurować drugi (dual-tagging po zmianie wpisu w panelu);
 *  2. wpis z panelu (`site_settings.analytics.ga4_measurement_id`), o ile ma
 *     kształt identyfikatora pomiaru;
 *  3. zmienna konektora Google Analytics (build-time), również tylko o kształcie
 *     identyfikatora - klucz API nie może trafić do `gtag('config', …)`;
 *  4. stała wdrożenia.
 */
export function resolveBrowserGa4Id(input: {
  settingsId?: string | null;
  connectorId?: unknown;
}): string {
  return (
    asGa4MeasurementId(ssrGtagId()) ||
    asGa4MeasurementId(input.settingsId) ||
    asGa4MeasurementId(input.connectorId) ||
    GA4_MEASUREMENT_ID
  );
}

/**
 * Kolejka `dataLayer` działa też przed wczytaniem tagu - stąd push, nie fetch.
 * Gdy snippet (SSR albo kliencki) zdefiniował już `window.gtag`, wołamy go -
 * to dokładnie ta sama kolejka i ten sam kształt `arguments`.
 */
export function gtag(...args: unknown[]): void {
  const w = win();
  if (!w) return;
  const layer = layerOf(w);
  if (typeof w.gtag === "function") {
    (w.gtag as GtagFn)(...args);
    return;
  }
  pushCommand(layer, args);
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
 * Snippet SSR wklejany do `<head>` (patrz `__root.tsx`): warstwa danych, tryb
 * domyślnej odmowy i konfiguracja strumienia - wszystko wysłane PRZED
 * jakąkolwiek zgodą i bez ANI JEDNEGO żądania sieciowego (~1,3 kB inline).
 * Polecenia są tożsame z bootstrapperem klienckim (`bootstrapGa4`) - zmiany
 * trzymać w parze. `send_page_view: false` - odsłony wysyła router
 * (`ga4PageView`), inaczej pierwsza odsłona byłaby zdublowana przy nawigacji SPA.
 *
 * SAM gtag.js NIE JEST już ładowany z `<head>`: dociąga go bootstrap kliencki
 * po bezczynności (F20). Do tego czasu polecenia czekają w `window.dataLayer` -
 * to natywna kolejka gtag.js, a nie nasz bufor: skrypt po załadowaniu
 * przetwarza całą warstwę od początku, więc zgoda i odsłony z okna hydratacji
 * docierają w oryginalnej kolejności.
 */
export function ga4SsrSnippet(measurementId: string, adsId: string = ""): string {
  const ga4 = measurementId.trim();
  const ads = adsId.trim();
  if (!ga4 && !ads) return "";

  const configs: string[] = [];
  if (ads) {
    configs.push(`gtag('config',${JSON.stringify(ads)});`);
  }
  if (ga4) {
    configs.push(`gtag('config',${JSON.stringify(ga4)},{send_page_view:false});`);
  }

  return [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){window.dataLayer.push(arguments);}window.gtag=gtag;",
    "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'granted',wait_for_update:500});",
    "gtag('set','url_passthrough',true);",
    "gtag('set','ads_data_redaction',true);",
    "gtag('js',new Date());",
    ...configs,
    // Pieczątka dla bootstrapu klienckiego - MUSI stać po `config`, żeby
    // rzut w którymkolwiek poleceniu nie zostawił fałszywej informacji
    // „SSR skonfigurował strumień".
    `window.${SSR_TAG_GLOBAL}=${JSON.stringify(ga4 || ads)};`,
  ].join("");
}

/** Dociąga gtag.js dla danego identyfikatora. Bez duplikatu - patrz `gtagScript()`. */
function injectGtagScript(primary: string): void {
  if (typeof document === "undefined" || gtagScript()) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `${GTAG_SRC_PREFIX}?id=${encodeURIComponent(primary)}`;
  script.setAttribute(SCRIPT_ATTR, primary);
  document.head.appendChild(script);
}

/** Kiedy wolno dociągnąć gtag.js. Domyślnie natychmiast; `__root` odkłada to za bezczynność. */
export interface Ga4BootstrapOptions {
  scheduleScript?: (load: () => void) => void;
}

/**
 * Wstawia tag Google i konfiguruje strumień. Idempotentne dla pary
 * (główny ID, GA4 ID), ale reaguje też na zmianę samego GA4 - wtedy tylko
 * wypycha nową konfigurację, bez ponownego ładowania skryptu.
 * Gdy snippet SSR wczytał już ten sam tag, bootstrap jedynie przejmuje stan.
 * `send_page_view: false` - odsłony wysyła router (patrz `ga4PageView`), inaczej
 * pierwsza odsłona byłaby zdublowana przy nawigacji SPA.
 */
export function bootstrapGa4(measurementId: string, adsId: string = ""): void {
  const w = win();
  const ga4 = measurementId.trim();
  const ads = adsId.trim();
  const primary = ga4 || ads;
  if (!w || !primary) return;
  if (bootstrappedPrimary === primary && bootstrappedGa4 === ga4) return;

  const primaryChanged = bootstrappedPrimary !== primary;
  bootstrappedPrimary = primary;
  bootstrappedGa4 = ga4;

  if (primaryChanged) {
    // Snippet SSR wykonał już zgodę domyślną, `js` i oba `config` dla tego tagu.
    if (typeof w.gtag === "function" && ssrGtagId() === primary) return;

    ensureWindowGtag(w);
    ga4ConsentDefault();
    gtag("js", new Date());
    if (ads) gtag("config", ads);
  }

  if (ga4) gtag("config", ga4, { send_page_view: false });

  if (!primaryChanged) return;

  // Skrypt już jest (SSR albo wcześniejszy bootstrap innym ID) - nie duplikujemy.
  if (gtagScript()) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `${GTAG_SRC_PREFIX}?id=${encodeURIComponent(primary)}`;
  script.setAttribute(SCRIPT_ATTR, primary);
  document.head.appendChild(script);
}

/** Wyłącznie dla testów - zeruje pamięć bootstrapu i zdjętą przez nas globalną `gtag`. */
export function resetGa4BootstrapForTests(): void {
  bootstrappedPrimary = null;
  bootstrappedGa4 = null;
  const w = win();
  if (w) delete w.gtag;
}

/**
 * Czy strumień jest już skonfigurowany: przez bootstrap kliencki albo przez
 * snippet SSR (wtedy w dokumencie jest już `<script src=…gtag/js?id=…>`, a
 * konfiguracja poprzedza go w `dataLayer`). Bez tego pierwsza odsłona - wołana
 * przez router ZANIM zamontuje się `ConsentScriptInjector` - ginęła.
 */
export function isGa4Ready(): boolean {
  return bootstrappedPrimary !== null || gtagScript() !== null;
}

export function ga4Event(name: string, params: Ga4Params = {}): void {
  if (!isGa4Ready()) return;
  gtag("event", name, params);
}

export function ga4PageView(path: string, title?: string, language?: string): void {
  if (!isGa4Ready()) return;
  gtag("event", "page_view", {
    page_location: typeof location === "undefined" ? path : location.href,
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
