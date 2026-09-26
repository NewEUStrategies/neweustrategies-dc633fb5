// GA4 w przeglądarce - jedno miejsce, w którym dotykamy `gtag`.
//
// TRYB DOMYŚLNEJ ODMOWY GOOGLE (Consent Mode v2). Strumień jest konfigurowany
// od razu (w SSR, inline), ale WSZYSTKIE kategorie startują jako `denied`: bez
// zgody GA4 nie zapisuje cookies i nie wysyła identyfikatorów, a zdarzenia
// trafiają do modelowania Google (cookieless pings). Po decyzji odwiedzającego
// wysyłamy `consent update`, więc pełny pomiar zaczyna się dokładnie w chwili
// zgody. Dzięki `wait_for_update` tag wstrzymuje wysyłkę na moment, żeby nie
// wyprzedzić decyzji zapisanej w localStorage.
//
// SAM SKRYPT gtag.js JEST ODROCZONY ZA BEZCZYNNOŚĆ (audyt CWV 2026-09-20, F20).
// `<head>` niesie wyłącznie inline'owy snippet (~1,3 kB): warstwa danych, zgoda
// domyślna i `config`. Plik z googletagmanager.com dociąga `ConsentScriptInjector`
// przez `whenIdle(…, 2000)` PO `markAppReady()`, bo ~90 KB parse+execute z obcego
// originu w oknie hydratacji konkurowało z LCP i pierwszą interakcją. Polecenia
// z tego okna czekają w `window.dataLayer` - to natywna kolejka gtag.js, nie nasz
// bufor: skrypt po załadowaniu przetwarza warstwę od początku, więc nic nie ginie.
//
// JEDEN TAG, DWA MIEJSCA DOCELOWE. gtag.js ładuje się RAZ, identyfikatorem
// strumienia GA4 (`?id=G-…`): po nim weryfikator Google rozpoznaje instalację
// i on decyduje, które ustawienia tagu Google się wczytają. Każde
// `gtag('config', ID)` rejestruje osobne miejsce docelowe (GA4, Google Ads);
// zdarzenia bez `send_to` trafiają do WSZYSTKICH skonfigurowanych.
//
// SNIPPET SSR I BOOTSTRAP KLIENCKI. `ga4SsrSnippet` (w `<head>` przez
// `__root.tsx`) wykonuje te same polecenia, zanim wystartuje React. Bootstrap
// kliencki ROZPOZNAJE ten stan (pieczątka `SSR_TAG_GLOBAL`, a w dokumentach
// sprzed odroczenia tagu - także `<script src=…gtag/js?id=…>` bez znacznika
// klienckiego) i przejmuje go, nie powtarzając poleceń - drugi `config` to
// drugi ping Google Ads przy wejściu.
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
import { redactTrackedPath } from "./redactTrackedUrl";
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

/**
 * Kiedy wolno dociągnąć gtag.js. Domyślnie natychmiast (wołający spoza ścieżki
 * bootowania nie musi o tym wiedzieć); `ConsentScriptInjector` podaje tu
 * `whenIdle`, żeby transfer obcego originu wypadł poza okno hydratacji.
 */
export interface Ga4BootstrapOptions {
  scheduleScript?: (load: () => void) => void;
}

function scheduleGtagScript(options: Ga4BootstrapOptions, primary: string): void {
  const schedule = options.scheduleScript ?? ((load: () => void) => load());
  schedule(() => injectGtagScript(primary));
}

/**
 * Konfiguruje strumień i ZAMAWIA dociągnięcie tagu Google. Idempotentne dla
 * pary (główny ID, GA4 ID), ale reaguje też na zmianę samego GA4 - wtedy tylko
 * wypycha nową konfigurację, bez ponownego ładowania skryptu.
 * Gdy snippet SSR skonfigurował już ten sam strumień, bootstrap przejmuje stan
 * i zamawia WYŁĄCZNIE skrypt (poleceń nie powtarza).
 * `send_page_view: false` - odsłony wysyła router (patrz `ga4PageView`), inaczej
 * pierwsza odsłona byłaby zdublowana przy nawigacji SPA.
 *
 * KIEDY dojedzie skrypt, decyduje wołający przez `options.scheduleScript` -
 * patrz `Ga4BootstrapOptions`. Polecenia idą do `dataLayer` niezależnie od tej
 * decyzji, więc odroczenie skryptu nie gubi ani zgody, ani odsłon.
 */
export function bootstrapGa4(
  measurementId: string,
  adsId: string = "",
  options: Ga4BootstrapOptions = {},
): void {
  const w = win();
  const ga4 = measurementId.trim();
  const ads = adsId.trim();
  const primary = ga4 || ads;
  if (!w || !primary) return;
  if (bootstrappedPrimary === primary && bootstrappedGa4 === ga4) {
    // Ponowny montaż tą samą parą identyfikatorów: polecenia są już w warstwie
    // danych, ale ZAPLANOWANE dociągnięcie skryptu mogło zostać anulowane razem
    // z poprzednim efektem (odmontowanie, podwójny efekt StrictMode w dev).
    // Bez tej gałęzi tag nigdy by nie dojechał, a dociąganie jest idempotentne.
    if (!gtagScript()) scheduleGtagScript(options, primary);
    return;
  }

  const primaryChanged = bootstrappedPrimary !== primary;
  bootstrappedPrimary = primary;
  bootstrappedGa4 = ga4;

  // Snippet SSR wykonał już zgodę domyślną, `js` i oba `config` dla tego tagu -
  // powtórzenie ich to drugi ping Google Ads przy wejściu i cofnięte okno
  // `wait_for_update`. Rozpoznajemy to po pieczątce `SSR_TAG_GLOBAL`, bo sam
  // `<script src>` zszedł z `<head>` za bezczynność (F20).
  const ssrConfigured = typeof w.gtag === "function" && ssrGtagId() === primary;

  if (primaryChanged && !ssrConfigured) {
    ensureWindowGtag(w);
    ga4ConsentDefault();
    gtag("js", new Date());
    if (ads) gtag("config", ads);
  }

  // Zmiana SAMEGO strumienia GA4 przy niezmienionym tagu głównym nadal
  // przechodzi - pomijamy wyłącznie konfigurację, którą zrobił już SSR.
  if (ga4 && !(primaryChanged && ssrConfigured)) gtag("config", ga4, { send_page_view: false });

  if (!primaryChanged) return;

  // Skrypt już jest (dokument sprzed zmiany albo wcześniejszy bootstrap innym
  // ID) - nie duplikujemy.
  if (gtagScript()) return;
  scheduleGtagScript(options, primary);
}

/** Wyłącznie dla testów - zeruje pamięć bootstrapu, globalną `gtag` i pieczątkę SSR. */
export function resetGa4BootstrapForTests(): void {
  bootstrappedPrimary = null;
  bootstrappedGa4 = null;
  const w = win();
  if (w) {
    delete w.gtag;
    delete w[SSR_TAG_GLOBAL];
  }
}

/**
 * Czy strumień jest już skonfigurowany: przez bootstrap kliencki albo przez
 * snippet SSR (pieczątka `SSR_TAG_GLOBAL`, a w dokumentach sprzed przeniesienia
 * tagu za bezczynność - także węzeł `<script src=…gtag/js?id=…>`). Bez tego
 * pierwsza odsłona - wołana przez router ZANIM zamontuje się
 * `ConsentScriptInjector` - ginęła.
 *
 * SKONFIGUROWANY NIE ZNACZY WCZYTANY i to jest tu świadome: od 2026-09-20
 * gtag.js dociąga się po bezczynności, więc zdarzenia z okna hydratacji trafią
 * do `window.dataLayer` i poczekają w niej na skrypt. Bramkowanie ich na
 * obecności skryptu kasowałoby dokładnie te odsłony, dla których ta kolejka
 * istnieje.
 */
export function isGa4Ready(): boolean {
  return bootstrappedPrimary !== null || ssrGtagId() !== "" || gtagScript() !== null;
}

export function ga4Event(name: string, params: Ga4Params = {}): void {
  if (!isGa4Ready()) return;
  gtag("event", name, params);
}

/**
 * `page_location` jest SKŁADANE od nowa: origin + ścieżka po
 * `redactTrackedPath` (bez fragmentu, z maską tokenów w ścieżce i parametrach).
 * Surowe `location.href` wysyłało do GA4 token przekazania biletu
 * (`/tickets/transfer/<token>`) i fragment linku gościa (`#t=<token>`).
 * Ta sama wartość idzie też przez `set`: gtag.js dokleja do KAŻDEGO kolejnego
 * zdarzenia (kliknięcie, konwersja) `page_location` - bez nadpisania byłby to
 * surowy `document.location` razem z tokenem.
 */
export function ga4PageView(path: string, title?: string, language?: string): void {
  if (!isGa4Ready()) return;
  const pageLocation =
    typeof location === "undefined"
      ? redactTrackedPath(path)
      : `${location.origin}${redactTrackedPath(`${location.pathname}${location.search}`)}`;
  gtag("set", { page_location: pageLocation });
  gtag("event", "page_view", {
    page_location: pageLocation,
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
