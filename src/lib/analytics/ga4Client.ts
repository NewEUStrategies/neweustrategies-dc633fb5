// GA4 w przeglądarce - jedno miejsce, w którym dotykamy `gtag`.
//
// TRYB DOMYŚLNEJ ODMOWY GOOGLE (Consent Mode v2). Strumień jest konfigurowany
// od razu (w SSR, inline), ale WSZYSTKIE kategorie startują jako `denied`: bez
// zgody GA4 nie zapisuje cookies i nie wysyła identyfikatorów, a zdarzenia
// trafiają do modelowania Google (cookieless pings). Po decyzji odwiedzającego
// wysyłamy `consent update`, więc pełny pomiar zaczyna się dokładnie w chwili
// zgody. Dzięki `wait_for_update` tag wstrzymuje wysyłkę na moment, żeby nie
// wyprzedzić decyzji zapisanej w localStorage. Pingi bez cookies NIE są puste:
// niosą nazwę, parametry zdarzenia i adres strony - dlatego ich treść jest
// redagowana (`ga4EventMap.ts` dla kopii z `track()`, `ga4PageView` tutaj).
//
// SAM SKRYPT gtag.js JEST ODROCZONY (audyt CWV 2026-09-20, F20; polityka
// 2026-10-02, punkt ciszy P1.1 2026-10-04). `<head>` niesie wyłącznie
// inline'owy snippet (~0,6 kB): warstwa danych, zgoda domyślna i `config`
// GA4. Plik z googletagmanager.com dociąga `ConsentScriptInjector` przez
// `scheduleGtagLoad` (`gtagLoadPolicy.ts`): po pierwszej interakcji (ostatni
// w kolejce po interakcji), po jawnej decyzji o zgodzie albo w globalnym
// punkcie ciszy strony (P0.3, ~load + 10 s) - bo ~90 KB parse+execute z obcego
// originu w oknie hydratacji konkurowało z LCP i pierwszą interakcją, a każde
// zadanie gtag w śladzie Lighthouse'a liczy się do TBT. Polecenia z tego okna
// czekają w `window.dataLayer` - to natywna kolejka gtag.js, nie nasz bufor:
// skrypt po załadowaniu przetwarza warstwę od początku, więc nic nie ginie.
//
// JEDEN TAG, GOOGLE ADS DOPIERO PO ZGODZIE MARKETINGOWEJ (P1.1, TP-2).
// gtag.js ładuje się RAZ, identyfikatorem strumienia GA4 (`?id=G-…`): po nim
// weryfikator Google rozpoznaje instalację i on decyduje, które ustawienia
// tagu Google się wczytają. Każde `gtag('config', ID)` rejestruje osobne
// miejsce docelowe; zdarzenia bez `send_to` trafiają do WSZYSTKICH
// skonfigurowanych. `config AW-…` w warstwie danych każe gtag.js dociągnąć
// DRUGI kontener (Google Ads, ~200 KB transferu, ~185 ms CPU na telefonie), więc
// ani snippet SSR, ani bootstrap go nie wysyłają: robi to wyłącznie
// `ga4ConfigureAds` po `consent update` z `categories.marketing === true`
// (`ConsentScriptInjector`). Bez zgody marketingowej Google Ads działa w trybie
// podstawowym Consent Mode (bez modelowania z pingów bez cookies) - kompromis
// zatwierdzony przez właściciela (faza1/ORCHESTRATOR-NOTES.md, „Owner decision").
//
// SNIPPET SSR I BOOTSTRAP KLIENCKI. `ga4SsrSnippet` (w `<head>` przez
// `__root.tsx`) wykonuje te same polecenia, zanim wystartuje React. Bootstrap
// kliencki ROZPOZNAJE ten stan (pieczątka `SSR_TAG_GLOBAL`, a w dokumentach
// sprzed odroczenia tagu - także `<script src=…gtag/js?id=…>` bez znacznika
// klienckiego) i przejmuje go, nie powtarzając poleceń - drugi `config` to
// drugi ping przy wejściu. Dokument z cache brzegowego sprzed P1.1 może jeszcze
// nieść `config AW-…` w snippecie - `ga4ConfigureAds` skanuje więc warstwę danych
// i nie powtarza polecenia, które już w niej jest.
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
import { redactQueryPii } from "@/lib/observability/redact";
import { redactTrackedPath } from "./redactTrackedUrl";
import {
  ANALYTICS_ANY_HOST_FLAG,
  ANALYTICS_HOST_PATTERN,
  GA4_MEASUREMENT_ID,
  analyticsAllowedHere,
  asGa4MeasurementId,
} from "./tagIds";

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
 * `<head>` wykonał już zgodę domyślną, `js` i `config` GA4.
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
let bootstrappedGa4: string | null = null;
/** Miejsca docelowe Google Ads skonfigurowane w tym dokumencie (`ga4ConfigureAds`). */
const configuredAds = new Set<string>();

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
  if (!w || !analyticsAllowedHere()) return;
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
 * domyślnej odmowy i konfiguracja strumienia GA4 - wszystko wysłane PRZED
 * jakąkolwiek zgodą i bez ANI JEDNEGO żądania sieciowego (~0,6 kB inline).
 * Polecenia są tożsame z bootstrapperem klienckim (`bootstrapGa4`) - zmiany
 * trzymać w parze. `send_page_view: false` - odsłony wysyła router
 * (`ga4PageView`), inaczej pierwsza odsłona byłaby zdublowana przy nawigacji SPA.
 *
 * BEZ `config AW-…` (P1.1, TP-2). Google Ads konfiguruje wyłącznie
 * `ga4ConfigureAds` po zgodzie marketingowej - `config AW` w warstwie danych
 * kazałby gtag.js dociągnąć kontener Ads (~200 KB, ~185 ms CPU) każdemu
 * odwiedzającemu, także bez zgody. `adsId` zostaje w sygnaturze (wołający w
 * `__root.tsx` go podaje), ale snippet go nie używa; sam identyfikator Ads, bez
 * strumienia GA4, nie daje już żadnego snippetu - przed zgodą nie ma czego
 * konfigurować. Zgoda domyślna (`wait_for_update: 500`) zostaje bajt w bajt.
 *
 * SAM gtag.js NIE JEST ładowany z `<head>`: dociąga go bootstrap kliencki na
 * sygnał polityki `gtagLoadPolicy.ts` (F20, P1.1). Do tego czasu polecenia
 * czekają w `window.dataLayer` - to natywna kolejka gtag.js, a nie nasz bufor:
 * skrypt po załadowaniu przetwarza całą warstwę od początku, więc zgoda i
 * odsłony z okna hydratacji docierają w oryginalnej kolejności.
 */
export function ga4SsrSnippet(measurementId: string, _adsId: string = ""): string {
  const ga4 = measurementId.trim();
  if (!ga4) return "";

  // Bramka hosta W SAMYM snippecie: dokument z cache brzegowego jest ten sam
  // dla każdego hosta, więc decyzja musi zapaść w przeglądarce.
  const hostGate = `if(window.${ANALYTICS_ANY_HOST_FLAG}===true||${ANALYTICS_HOST_PATTERN.toString()}.test(location.hostname)){`;
  return [
    hostGate,
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){window.dataLayer.push(arguments);}window.gtag=gtag;",
    "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'granted',wait_for_update:500});",
    "gtag('set','url_passthrough',true);",
    "gtag('set','ads_data_redaction',true);",
    "gtag('js',new Date());",
    `gtag('config',${JSON.stringify(ga4)},{send_page_view:false});`,
    // Pieczątka dla bootstrapu klienckiego - MUSI stać po `config`, żeby
    // rzut w którymkolwiek poleceniu nie zostawił fałszywej informacji
    // „SSR skonfigurował strumień".
    `window.${SSR_TAG_GLOBAL}=${JSON.stringify(ga4)};`,
    "}",
  ].join("");
}

/**
 * Dociąga gtag.js dla strumienia GA4. Bez duplikatu - patrz `gtagScript()`.
 * Zwraca promise rozstrzygany na `load` albo `error` skryptu (KONTRAKT ZADANIA
 * kolejki P0.3: ewaluacja gtag.js kończy się przed jego `load`, więc kolejka
 * nie puści następnego kroku na tę pracę). Skrypt, który już jest, nie trzyma
 * nikogo - promise rozstrzygnięty od razu.
 */
function injectGtagScript(ga4: string): Promise<void> {
  if (typeof document === "undefined" || gtagScript()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = `${GTAG_SRC_PREFIX}?id=${encodeURIComponent(ga4)}`;
    script.setAttribute(SCRIPT_ATTR, ga4);
    const settle = () => resolve();
    script.addEventListener("load", settle, { once: true });
    script.addEventListener("error", settle, { once: true });
    document.head.appendChild(script);
  });
}

/** Wstrzyknięcie gtag.js - promise rozstrzygany na `load`/`error` skryptu. */
export type Ga4ScriptLoad = () => Promise<void>;

/**
 * Kiedy wolno dociągnąć gtag.js. Domyślnie natychmiast (wołający spoza ścieżki
 * bootowania nie musi o tym wiedzieć); `ConsentScriptInjector` podaje tu
 * politykę `scheduleGtagLoad` (interakcja / decyzja o zgodzie / punkt ciszy),
 * żeby transfer obcego originu wypadł poza okno hydratacji i poza ślad.
 */
export interface Ga4BootstrapOptions {
  scheduleScript?: (load: Ga4ScriptLoad) => void;
}

function scheduleGtagScript(options: Ga4BootstrapOptions, ga4: string): void {
  const load: Ga4ScriptLoad = () => injectGtagScript(ga4);
  if (options.scheduleScript) options.scheduleScript(load);
  else void load();
}

/**
 * Konfiguruje strumień GA4 i ZAMAWIA dociągnięcie tagu Google. Idempotentne
 * dla identyfikatora; zmiana strumienia wypycha nową konfigurację, ale skryptu
 * drugi raz nie ładuje. Gdy snippet SSR skonfigurował już ten sam strumień,
 * bootstrap przejmuje stan i zamawia WYŁĄCZNIE skrypt (poleceń nie powtarza).
 * `send_page_view: false` - odsłony wysyła router (patrz `ga4PageView`), inaczej
 * pierwsza odsłona byłaby zdublowana przy nawigacji SPA.
 *
 * Google Ads NIE jest tu konfigurowany (P1.1, TP-2) - patrz `ga4ConfigureAds`.
 *
 * KIEDY dojedzie skrypt, decyduje wołający przez `options.scheduleScript` -
 * patrz `Ga4BootstrapOptions`. Polecenia idą do `dataLayer` niezależnie od tej
 * decyzji, więc odroczenie skryptu nie gubi ani zgody, ani odsłon.
 */
export function bootstrapGa4(measurementId: string, options: Ga4BootstrapOptions = {}): void {
  const w = win();
  const ga4 = measurementId.trim();
  // Podgląd i hosty spoza produkcji: ani poleceń, ani gtag.js.
  if (!w || !ga4 || !analyticsAllowedHere()) return;
  if (bootstrappedGa4 === ga4) {
    // Ponowny montaż tym samym strumieniem: polecenia są już w warstwie
    // danych, ale ZAPLANOWANE dociągnięcie skryptu mogło zostać anulowane razem
    // z poprzednim efektem (odmontowanie, podwójny efekt StrictMode w dev).
    // Bez tej gałęzi tag nigdy by nie dojechał, a dociąganie jest idempotentne.
    if (!gtagScript()) scheduleGtagScript(options, ga4);
    return;
  }
  bootstrappedGa4 = ga4;

  // Snippet SSR wykonał już zgodę domyślną, `js` i `config` dla tego strumienia -
  // powtórzenie ich to drugi ping przy wejściu i cofnięte okno
  // `wait_for_update`. Rozpoznajemy to po pieczątce `SSR_TAG_GLOBAL`, bo sam
  // `<script src>` zszedł z `<head>` za bezczynność (F20).
  if (!(typeof w.gtag === "function" && ssrGtagId() === ga4)) {
    ensureWindowGtag(w);
    ga4ConsentDefault();
    gtag("js", new Date());
    gtag("config", ga4, { send_page_view: false });
  }

  // Skrypt już jest (dokument sprzed zmiany albo wcześniejszy bootstrap innym
  // ID) - nie duplikujemy.
  if (gtagScript()) return;
  scheduleGtagScript(options, ga4);
}

/**
 * Czy wpis warstwy danych to POLECENIE `gtag('config', id, …)`. Wyłącznie
 * obiekt `arguments` (patrz POLECENIA JAKO `arguments` w nagłówku): tablica
 * `['config', id]` nie konfiguruje w gtag.js niczego, więc nie może też
 * zablokować prawdziwej konfiguracji.
 */
function isConfigCommand(entry: unknown, id: string): boolean {
  return (
    Object.prototype.toString.call(entry) === "[object Arguments]" &&
    typeof entry === "object" &&
    entry !== null &&
    Reflect.get(entry, 0) === "config" &&
    Reflect.get(entry, 1) === id
  );
}

/**
 * Rejestruje Google Ads jako drugie miejsce docelowe tagu - WYŁĄCZNIE po
 * zgodzie marketingowej (P1.1, TP-2). Wołający (`ConsentScriptInjector`)
 * robi to w TYM SAMYM efekcie co `ga4ConsentUpdate` i PO nim: gtag.js
 * przetwarza warstwę danych po kolei, więc `config AW` przed aktualizacją zgody
 * wysłałby pierwsze trafienie Ads w stanie `denied`. GPC zdejmuje marketing już w
 * `useEffectiveConsent`, więc tu nie trafia.
 *
 * IDEMPOTENTNE na dwa sposoby: flaga modułu (kolejne zmiany kategorii z
 * marketingiem, ponowny montaż) ORAZ skan `window.dataLayer` na istniejące
 * `['config', adsId]` - dokument z cache brzegowego sprzed P1.1 niesie ten
 * `config` w snippecie SSR, a drugi `config` to drugi ping Ads przy wejściu.
 * Cofnięcie zgody nie „odkonfigurowuje" miejsca docelowego: `consent update`
 * ustawia wtedy `ad_*` na `denied`, a ponowna zgoda nie dokłada drugiego `config`.
 *
 * Gdy gtag.js już działa, `config` dociąga kontener Ads w tej chwili; gdy
 * jeszcze nie, polecenie czeka w warstwie danych za aktualizacją zgody.
 */
export function ga4ConfigureAds(adsId: string): void {
  const w = win();
  const ads = adsId.trim();
  if (!w || !ads || !analyticsAllowedHere() || configuredAds.has(ads)) return;
  configuredAds.add(ads);
  if (layerOf(w).some((entry) => isConfigCommand(entry, ads))) return;
  gtag("config", ads);
}

/** Wyłącznie dla testów - zeruje pamięć bootstrapu i Ads, globalną `gtag` i pieczątkę SSR. */
export function resetGa4BootstrapForTests(): void {
  bootstrappedGa4 = null;
  configuredAds.clear();
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
 * gtag.js dociąga się odroczony (`gtagLoadPolicy.ts`), więc zdarzenia z okna hydratacji trafią
 * do `window.dataLayer` i poczekają w niej na skrypt. Bramkowanie ich na
 * obecności skryptu kasowałoby dokładnie te odsłony, dla których ta kolejka
 * istnieje.
 */
export function isGa4Ready(): boolean {
  return bootstrappedGa4 !== null || ssrGtagId() !== "" || gtagScript() !== null;
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
 *
 * TREŚĆ W ADRESIE (`redactQueryPii`). `redactTrackedPath` maskuje poświadczenia,
 * nie tekst odwiedzającego: fraza z `/search?q=` i e-mail z linku zaproszenia
 * (`/auth?email=`) szły do GA4 w `page_location`, a przez `set` - w każdym
 * zdarzeniu na tej stronie. Parametry kampanii (`utm_*`, `gclid`, `gad_*`)
 * zostają co do bajtu, bo GA4 liczy z nich atrybucję.
 */
export function ga4PageView(path: string, title?: string, language?: string): void {
  if (!isGa4Ready()) return;
  const pageLocation = redactQueryPii(
    typeof location === "undefined"
      ? redactTrackedPath(path)
      : `${location.origin}${redactTrackedPath(`${location.pathname}${location.search}`)}`,
  );
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
