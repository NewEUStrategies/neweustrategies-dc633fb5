// Egzekucja zgody na skrypty (RODO/ePrivacy) - `ConsentScriptInjector`.
//
// CO TU JEST PRZYPINANE I DLACZEGO. Ten komponent jest jedynym miejscem, w
// którym decyzja odwiedzającego zamienia się na REALNY brak (albo obecność)
// kodu analityki i marketingu w dokumencie. Błąd tutaj nie jest błędem
// wizualnym: to skrypt GA4/Meta/TikTok pobrany przed zgodą albo nieusunięty po
// jej cofnięciu, czyli przetwarzanie bez podstawy prawnej. Test pilnuje więc
// czterech kontraktów, po jednym `describe` na każdy:
//   1. brak zgody = ZERO węzłów `[data-consent-owner]`, mimo kompletnej
//      konfiguracji (osobno: przed montażem klienta, przy odmowie, przy zgodzie
//      tylko na jedną kategorię - kategorie są niezależne),
//   2. cofnięcie zgody i odmontowanie USUWA wszystko, co wstrzyknięto - każdy
//      rodzaj węzła: skrypt zewnętrzny, skrypt inline, kontener wklejki w head
//      i w body,
//   3. `injectCustomHtml` WYKONUJE skrypt z wklejki administratora, a kontener
//      dostaje znacznik właściciela (węzeł bez znacznika przeżyłby cofnięcie
//      zgody - dlatego oba brzegi są asercją, nie komentarzem),
//   4. zmiana konfiguracji PRZEŁADOWUJE skrypty: stary węzeł znika, nowy się
//      pojawia i nie ma dwóch naraz (zależnością efektu jest
//      `JSON.stringify(config)`).
// Do tego GA4 w trybie domyślnej odmowy (poza bramką): polecenia od razu w
// `dataLayer`, sam gtag.js na sygnał polityki P1.1 (pierwsza interakcja przez
// kolejkę P0.3, jawna decyzja, globalny punkt ciszy; polityka dojeżdża leniwym
// `import()`, poza zamknięciem bootu) oraz Google Ads WYŁĄCZNIE
// po zgodzie marketingowej (TP-2): `config AW` dokładnie raz, za `consent
// update`, nigdy przy GPC.
//
// SIEĆ. Produkcja wstawia do head prawdziwe adresy (googletagmanager.com,
// snap.licdn.com), a happy-dom POBIERA `<script src>` naprawdę, gdy tylko
// ewaluacja JS jest włączona (bramka `disableJavaScriptFileLoading ||
// !enableJavaScriptEvaluation`) - a kontrakt 3 ją włącza. Cały plik
// biegnie więc z `disableJavaScriptFileLoading = true` (+
// `handleDisabledFileLoadingAsSuccess = true`, żeby zablokowane pobranie nie
// sypało w log DOMException), a globalny `fetch` jest podmieniony na atrapę,
// która rzuca przy każdym wywołaniu; osobny test dowodzi, że po wstrzyknięciu
// WSZYSTKICH skryptów zewnętrznych nie padło ani jedno wywołanie. Wszystkie
// identyfikatory są atrapami, a każdy konfigurowalny adres wskazuje example.com.
//
// ZMIERZONE W TYM ŚRODOWISKU (happy-dom 20.9.0): inline `<script>` wstawiony do
// DOM NIE jest wykonywany domyślnie - ustawienia mają `enableJavaScriptEvaluation:
// false` (v20 odwróciło dawne `disableJavaScriptEvaluation`). Kontrakt 3 włącza
// więc ewaluację punktowo, tylko na czas swojego testu; reszta pliku biegnie z
// ewaluacją wyłączoną, dzięki czemu snippety GTM/Meta/TikTok nie dokładają
// własnych węzłów i liczenie węzłów jest deterministyczne.
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

// Stan sterujący atrapami. `vi.hoisted`, bo fabryki `vi.mock` są wynoszone nad
// importy i nie mogą domykać się na zwykłych zmiennych modułu.
const harness = vi.hoisted(() => ({
  categories: { necessary: true, functional: false, analytics: false, marketing: false },
  mounted: true,
  analytics: {} as object,
  marketing: {} as object,
  /** Czy decyzja zgody jest ZAPISANA (`hasConsentDecision`). */
  decided: false,
  /** Słuchacze `subscribeConsentChange` - test budzi ich przez `poDecyzjiZgody`. */
  consentListeners: new Set<() => void>(),
}));

// Atrapa czytnika site_settings: oddaje spadki komponentu nadpisane wartościami
// z testu. Konfiguracja NIE jest tu walidowana - przechodzi przez PRAWDZIWE
// schematy `@/lib/analytics/config` wewnątrz komponentu, bo to część kontraktu.
vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: (key: string, defaults: object): object => {
    if (key === "analytics") return { ...defaults, ...harness.analytics };
    if (key === "marketing") return { ...defaults, ...harness.marketing };
    return defaults;
  },
}));

// Atrapa zgód: hak `useEffectiveConsent` (prawdziwy dociąga klienta Supabase
// i localStorage - tu liczy się wyłącznie bramka) oraz para
// `subscribeConsentChange` + `hasConsentDecision`, z której polityka
// dociągania gtag.js (`scheduleGtagLoad`) czyta sygnał „jawna decyzja".
vi.mock("@/lib/ads/consent", () => ({
  useEffectiveConsent: () => ({
    categories: harness.categories,
    preview: false,
    mounted: harness.mounted,
    gpc: { active: false, source: "none" },
    gpcHonored: false,
  }),
  hasConsentDecision: () => harness.decided,
  subscribeConsentChange: (listener: () => void) => {
    harness.consentListeners.add(listener);
    return () => harness.consentListeners.delete(listener);
  },
}));

// PRAWDZIWA polityka dociągania gtag.js, tylko `scheduleGtagLoad` owinięty
// szpiegiem: komponent ładuje moduł LENIWIE (`import()` z efektu po
// hydratacji, żeby polityka i prymitywy P0.3 nie wchodziły do zamknięcia
// bootu), a blok „leniwy import polityki” przypina, KIEDY i czy w ogóle
// polityka zostaje założona. Statyczny import niżej rozgrzewa moduł, więc
// dynamiczny `import()` komponentu rozstrzyga się z rejestru vitest.
vi.mock("@/lib/analytics/gtagLoadPolicy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics/gtagLoadPolicy")>();
  return { ...actual, scheduleGtagLoad: vi.fn(actual.scheduleGtagLoad) };
});

import { ConsentScriptInjector } from "@/components/ConsentScriptInjector";
import type { AnalyticsConfig, MarketingConfig } from "@/lib/analytics/config";
import {
  GA4_MEASUREMENT_ID,
  ga4SsrSnippet,
  GOOGLE_ADS_ID,
  resetGa4BootstrapForTests,
} from "@/lib/analytics/ga4Client";
import { scheduleGtagLoad } from "@/lib/analytics/gtagLoadPolicy";
import { clampCategoriesForGpc } from "@/lib/consent/gpc";
import { __resetFirstInteractionForTests } from "@/lib/performance/firstInteraction";
import { __resetPostInteractionQueueForTests } from "@/lib/performance/postInteractionQueue";
import {
  QUIESCENCE_MIN_AFTER_LOAD_MS,
  __resetQuiescenceForTests,
} from "@/lib/performance/whenQuiescent";

// -------------------- atrapowe identyfikatory i adresy --------------------

const GA4_ID = "G-TEST000000";
const GTM_ID = "GTM-TEST000";
const PLAUSIBLE_URL = "https://example.com/plausible-test.js";
const PLAUSIBLE_DOMAIN = "consent-test.example.com";
const META_ID = "PIXEL-TEST-1";
const LINKEDIN_ID = "LI-PARTNER-TEST-1";
const TIKTOK_ID = "TT-PIXEL-TEST-1";

/**
 * Odczyt wpisów `dataLayer` - tak GA4 przyjmuje Consent Mode v2. Polecenia
 * gtag to obiekty `arguments` (nie tablice), więc czytamy je po indeksach.
 */
function isCommand(entry: unknown): entry is ArrayLike<unknown> {
  return typeof entry === "object" && entry !== null && "length" in entry;
}

function consentEntry(action: "default" | "update"): Record<string, unknown> | undefined {
  const layer: unknown = Reflect.get(window, "dataLayer");
  if (!Array.isArray(layer)) return undefined;
  const found = layer.find(
    (entry): entry is ArrayLike<unknown> =>
      isCommand(entry) && entry[0] === "consent" && entry[1] === action,
  );
  return found?.[2] as Record<string, unknown> | undefined;
}

const consentDefault = () => consentEntry("default");
const consentUpdate = () => consentEntry("update");

function configEntry(id: string): Record<string, unknown> | undefined {
  const layer: unknown = Reflect.get(window, "dataLayer");
  if (!Array.isArray(layer)) return undefined;
  const found = layer.find(
    (entry): entry is ArrayLike<unknown> =>
      isCommand(entry) && entry[0] === "config" && entry[1] === id,
  );
  return found?.[2] as Record<string, unknown> | undefined;
}

function configCount(id: string): number {
  const layer: unknown = Reflect.get(window, "dataLayer");
  if (!Array.isArray(layer)) return 0;
  return layer.filter((entry) => isCommand(entry) && entry[0] === "config" && entry[1] === id)
    .length;
}

/** Wpisy `dataLayer` po kolei - do asercji na KOLEJNOŚCI poleceń gtag. */
function layerCommands(): ArrayLike<unknown>[] {
  const layer: unknown = Reflect.get(window, "dataLayer");
  return Array.isArray(layer) ? layer.filter(isCommand) : [];
}

/** Indeks pierwszego `config` dla identyfikatora (-1, gdy brak). */
function configIndex(id: string): number {
  return layerCommands().findIndex((entry) => entry[0] === "config" && entry[1] === id);
}

/** Aktualizacje zgody w kolejności wypchnięcia. */
function consentUpdates(): Record<string, unknown>[] {
  return layerCommands()
    .filter((entry) => entry[0] === "consent" && entry[1] === "update")
    .map((entry) => entry[2] as Record<string, unknown>);
}

/** Indeks OSTATNIEJ aktualizacji zgody z `ad_storage: granted` (-1, gdy brak). */
function lastGrantedAdsUpdateIndex(): number {
  const commands = layerCommands();
  for (let i = commands.length - 1; i >= 0; i -= 1) {
    const entry = commands[i];
    if (
      entry[0] === "consent" &&
      entry[1] === "update" &&
      (entry[2] as Record<string, unknown>).ad_storage === "granted"
    ) {
      return i;
    }
  }
  return -1;
}

const MARK_ATTR = "data-consent-owner";
const ANALYTICS_OWNER = "consent-analytics";
const MARKETING_OWNER = "consent-marketing";

// Adresy zaszyte w produkcji - test ich nie zmienia, tylko sprawdza, że
// pobieranie plików JS jest wyłączone, więc nie wychodzą do sieci.
const GTAG_PREFIX = "https://www.googletagmanager.com/gtag/js?id=";
const LINKEDIN_SRC = "https://snap.licdn.com/li.lms-analytics/insight.min.js";

// -------------------- dostęp do ustawień happy-dom --------------------

const SETTING_KEYS = [
  "enableJavaScriptEvaluation",
  "disableJavaScriptFileLoading",
  "handleDisabledFileLoadingAsSuccess",
] as const;
type HappyDomSettingKey = (typeof SETTING_KEYS)[number];

/**
 * STRAŻNIK, nie rzutowanie (ta sama konwencja co `happyDomController` w
 * `RobotsTxtPreview.test.tsx`): kontroler happy-dom nie jest opisany w typach
 * `Window`, a bez niego ten plik NIE dowodzi izolacji od sieci - lepiej, żeby
 * padł głośno, niż „przeszedł" na runnerze bez happy-dom.
 */
function happyDomSettings(): object {
  const api: unknown = Reflect.get(window, "happyDOM");
  if (api === null || typeof api !== "object") throw new Error("brak kontrolera happy-dom");
  const settings: unknown = Reflect.get(api, "settings");
  if (settings === null || typeof settings !== "object") {
    throw new Error("brak `happyDOM.settings`");
  }
  return settings;
}

function readSetting(key: HappyDomSettingKey): boolean {
  const value: unknown = Reflect.get(happyDomSettings(), key);
  if (typeof value !== "boolean") throw new Error(`ustawienie happy-dom nieznane: ${key}`);
  return value;
}

function writeSetting(key: HappyDomSettingKey, value: boolean): void {
  Reflect.set(happyDomSettings(), key, value);
}

// -------------------- pomocniki testowe --------------------

function owned(owner: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${MARK_ATTR}="${owner}"]`));
}

function allOwned(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${MARK_ATTR}]`));
}

function ownedIn(root: ParentNode, owner: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${MARK_ATTR}="${owner}"]`));
}

/** Kontenery wklejek administratora (`injectCustomHtml` parkuje je w `<div>`). */
function containersIn(root: ParentNode, owner: string): HTMLElement[] {
  return ownedIn(root, owner).filter((el) => el.tagName === "DIV");
}

function externalScripts(owner: string): HTMLScriptElement[] {
  return Array.from(
    document.querySelectorAll<HTMLScriptElement>(`script[${MARK_ATTR}="${owner}"][src]`),
  );
}

function inlineScripts(owner: string): HTMLScriptElement[] {
  return Array.from(
    document.querySelectorAll<HTMLScriptElement>(`script[${MARK_ATTR}="${owner}"]:not([src])`),
  );
}

function inlineCode(owner: string): string {
  return inlineScripts(owner)
    .map((s) => s.textContent ?? "")
    .join("\n");
}

/**
 * Czy JAKIKOLWIEK skrypt w dokumencie wspomina dany identyfikator albo adres -
 * asercja mocniejsza niż liczenie węzłów po znaczniku właściciela: łapie też
 * kod, który trafiłby do dokumentu bez znacznika (a więc bez szansy na
 * posprzątanie po cofnięciu zgody).
 */
function documentMentions(needle: string): boolean {
  return Array.from(document.querySelectorAll("script")).some(
    (s) => (s.textContent ?? "").includes(needle) || (s.getAttribute("src") ?? "").includes(needle),
  );
}

function setAnalytics(cfg: Partial<AnalyticsConfig>): void {
  harness.analytics = { ...cfg };
}

function setMarketing(cfg: Partial<MarketingConfig>): void {
  harness.marketing = { ...cfg };
}

function grant(cats: { analytics?: boolean; marketing?: boolean }): void {
  harness.categories = {
    necessary: true,
    functional: false,
    analytics: !!cats.analytics,
    marketing: !!cats.marketing,
  };
}

function renderInjector() {
  return render(<ConsentScriptInjector />);
}

/**
 * Czeka, aż efekt komponentu dociągnie politykę gtag.js leniwym `import()` i
 * założy jej sygnały (`scheduleGtagLoad`). Do tej chwili w dokumencie są
 * wyłącznie polecenia w `dataLayer` - ani wpis kolejki, ani nasłuch decyzji,
 * ani zapis w punkcie ciszy. `vi.dynamicImportSettled()` czeka na bezpiecznych
 * (niepodmienionych) zegarach, więc działa też pod `vi.useFakeTimers()`.
 */
async function poZaladowaniuPolityki(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

/**
 * Przepuszcza sygnał polityki dociągania gtag.js - tu: PIERWSZĄ INTERAKCJĘ.
 *
 * DLACZEGO TO JEST POTRZEBNE (i dlaczego nie jest to test „z opóźnieniem").
 * Od 2026-09-20 `ConsentScriptInjector` rozdziela dwie rzeczy, które wcześniej
 * robił naraz: POLECENIA (`consent default/update`, `config`) idą do
 * `window.dataLayer` synchronicznie w efekcie, a SAM PLIK z googletagmanager.com
 * dociąga polityka `scheduleGtagLoad` (`@/lib/analytics/gtagLoadPolicy`) -
 * skrypt obcego originu nie ma konkurować z LCP, hydratacją ani pierwszą
 * interakcją. Od P1.1 (2026-10-04) sygnałem jest NAJWCZEŚNIEJSZY z: pierwszej
 * interakcji (wpis `analytics` w kolejce P0.3 - ostatni), jawnej decyzji o
 * zgodzie, globalnego punktu ciszy strony (≥ 5 s po load i 5 s ciszy, limit
 * 20 s; szczegóły i testy w `gtagLoadPolicy.test.ts`). Asercje na `dataLayer`
 * zostają więc synchroniczne; asercje na WĘZLE `<script data-ga4-tag>` muszą
 * przejść przez ten sygnał. Kolejka nie rusza w trakcie gestu (strażnik
 * gestu P0.3), więc pomocnik daje CAŁE kliknięcie: `pointerdown` ->
 * `pointerup` -> `click`; dociągnięcie schodzi po klatce i jednym makrozadaniu
 * (rAF -> setTimeout 0) - 80 ms to zapas na obie ścieżki happy-dom. Wcześniej
 * pomocnik czeka na leniwy import polityki (`poZaladowaniuPolityki`): happy-dom
 * nie ma lepkiej aktywacji, więc zdarzenie sprzed założenia nasłuchu nie
 * zostawiłoby śladu.
 */
async function poInterakcji(): Promise<void> {
  await poZaladowaniuPolityki();
  await act(async () => {
    for (const type of ["pointerdown", "pointerup", "click"]) {
      window.dispatchEvent(new Event(type));
    }
    await poKrokachKolejki();
  });
}

/** Zapisana decyzja odwiedzającego - sygnał (b) polityki, bez żadnej interakcji. */
async function poDecyzjiZgody(): Promise<void> {
  await poZaladowaniuPolityki();
  await act(async () => {
    harness.decided = true;
    for (const listener of harness.consentListeners) listener();
    await poKrokachKolejki();
  });
}

/**
 * Kroki kolejki P0.3 zamiast stałego zapasu czasu. Kolejka opróżnia się po
 * JEDNYM zadaniu na klatkę (`requestAnimationFrame` -> makrozadanie), a wpis
 * `analytics` jest w niej ostatni. Stałe 80 ms przegrywało z obciążonym
 * runnerem CI (2026-10-05: tag jeszcze nie wstawiony w chwili asercji). Każdy
 * krok tutaj to ta sama para co krok kolejki - klatka, potem makrozadanie -
 * zaplanowana PO kroku kolejki, więc odpala się po nim niezależnie od
 * obciążenia; przed każdym krokiem domykają się leniwe importy.
 */
async function poKrokachKolejki(steps = 8): Promise<void> {
  for (let i = 0; i < steps; i += 1) {
    await vi.dynamicImportSettled();
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
    });
  }
}

/**
 * Sam `load` dokumentu i chwila ciszy - od 2026-10-02 to już NIE jest sygnał;
 * punkt ciszy P0.3 zapada najwcześniej 5 s po `load`.
 */
async function poSamymLoad(): Promise<void> {
  await poZaladowaniuPolityki();
  await act(async () => {
    window.dispatchEvent(new Event("load"));
    await poKrokachKolejki();
  });
}

/** Stan prymitywów P0.3 (jedna pierwsza interakcja, kolejka, punkt ciszy) żyje w module. */
function resetPerformancePrimitives(): void {
  __resetQuiescenceForTests();
  __resetPostInteractionQueueForTests();
  __resetFirstInteractionForTests();
}

/** Atrapa sieci: każde wyjście na zewnątrz kończy się porażką testu. */
const fetchSpy = vi.fn(() => {
  throw new Error("test wyszedł do sieci");
});

// Ustawienia happy-dom są WSPÓLNE dla całego forka, a vitest uruchamia w nim
// kolejne pliki testowe. Plik zapamiętuje więc wartości ZASTANE i oddaje je w
// `afterAll` zamiast wpisywać na sztywno domyślne `false` - inaczej blokada
// pobierania plików JS (albo, gorzej, włączona ewaluacja) wyciekłaby do pliku,
// który akurat mierzy coś przeciwnego.
const originalSettings = new Map<HappyDomSettingKey, boolean>();

beforeAll(() => {
  for (const key of SETTING_KEYS) originalSettings.set(key, readSetting(key));
  writeSetting("disableJavaScriptFileLoading", true);
  writeSetting("handleDisabledFileLoadingAsSuccess", true);
});

afterAll(() => {
  for (const key of SETTING_KEYS) {
    const original = originalSettings.get(key);
    if (typeof original === "boolean") writeSetting(key, original);
  }
});

beforeEach(() => {
  harness.categories = { necessary: true, functional: false, analytics: false, marketing: false };
  harness.mounted = true;
  harness.analytics = {};
  harness.marketing = {};
  harness.decided = false;
  harness.consentListeners.clear();
  fetchSpy.mockClear();
  vi.mocked(scheduleGtagLoad).mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  Reflect.deleteProperty(window, "__consentTestMarker");
  resetPerformancePrimitives();
});

afterEach(() => {
  // Pierwsza interakcja jednego przypadku nie może zwolnić kolejki następnego.
  resetPerformancePrimitives();
  vi.unstubAllGlobals();
  // GA4 nie należy do tej bramki (tryb domyślnej odmowy Google), więc jego tag
  // trzeba sprzątnąć osobno - inaczej wyciekłby do kolejnego przypadku.
  document.head.querySelectorAll("script[data-ga4-tag]").forEach((el) => el.remove());
  // Tag ze snippetu SSR (bez znacznika klienckiego) też nie może wyciec.
  document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`).forEach((el) => el.remove());
  resetGa4BootstrapForTests();
  Reflect.deleteProperty(window, "dataLayer");
  // Gdyby jakiś przypadek zostawił węzeł (a właśnie tego pilnujemy), nie może
  // on wyciec do kolejnego testu i sfałszować liczenia.
  allOwned().forEach((el) => el.parentElement?.removeChild(el));
  Reflect.deleteProperty(window, "__consentTestMarker");
});

// Pełna, „bogata" konfiguracja obu kategorii - używana tam, gdzie test ma
// dowieść, że NIC się nie wstrzyknęło mimo kompletu identyfikatorów.
function configureEverything(): void {
  setAnalytics({
    ga4_measurement_id: GA4_ID,
    gtm_container_id: GTM_ID,
    plausible_domain: PLAUSIBLE_DOMAIN,
    plausible_script_url: PLAUSIBLE_URL,
    custom_head_html: '<meta name="consent-test-analytics-head" content="1" />',
    custom_body_html: '<span data-test="consent-analytics-body"></span>',
  });
  setMarketing({
    meta_pixel_id: META_ID,
    linkedin_partner_id: LINKEDIN_ID,
    tiktok_pixel_id: TIKTOK_ID,
    custom_head_html: '<meta name="consent-test-marketing-head" content="1" />',
    custom_body_html: '<span data-test="consent-marketing-body"></span>',
  });
}

// ==========================================================================
// KONTRAKT 1: brak zgody = brak skryptu
// ==========================================================================

describe("ConsentScriptInjector - kontrakt 1: bez zgody nie ma skryptu", () => {
  it("przed montażem klienta (mounted=false) nie wstrzykuje nic mimo pełnej konfiguracji", () => {
    configureEverything();
    grant({ analytics: true, marketing: true });
    harness.mounted = false;

    renderInjector();

    expect(allOwned()).toHaveLength(0);
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
    expect(documentMentions(GA4_ID)).toBe(false);
    expect(documentMentions(META_ID)).toBe(false);
  });

  it("przy odmowie obu kategorii nie wstrzykuje nic mimo skonfigurowanych identyfikatorów", async () => {
    configureEverything();
    grant({ analytics: false, marketing: false });

    renderInjector();

    expect(allOwned()).toHaveLength(0);
    for (const needle of [GTM_ID, PLAUSIBLE_URL, META_ID, LINKEDIN_ID, TIKTOK_ID]) {
      expect(documentMentions(needle)).toBe(false);
    }
    // GA4 jest wyjątkiem z rozmysłem: pracuje w trybie domyślnej odmowy Google,
    // więc jego tag wolno wczytać bez zgody - z KAŻDĄ kategorią `denied`.
    // Zgoda domyślna jest w warstwie OD RAZU, tag dociąga się po bezczynności.
    expect(consentDefault()).toMatchObject({
      analytics_storage: "denied",
      ad_storage: "denied",
    });
    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(0);
    await poInterakcji();
    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(1);
  });

  it("zgoda tylko na analitykę nie wstrzykuje marketingu", () => {
    configureEverything();
    grant({ analytics: true, marketing: false });

    renderInjector();

    expect(owned(ANALYTICS_OWNER).length).toBeGreaterThan(0);
    expect(owned(MARKETING_OWNER)).toHaveLength(0);
    // GA4 konfiguruje się jako dodatkowe miejsce docelowe tagu Google Ads -
    // nie ma osobnego skryptu z identyfikatorem GA4.
    expect(configEntry(GA4_ID)).toBeDefined();
    for (const needle of [META_ID, LINKEDIN_ID, TIKTOK_ID, LINKEDIN_SRC]) {
      expect(documentMentions(needle)).toBe(false);
    }
  });

  it("zgoda tylko na marketing nie wstrzykuje analityki", () => {
    configureEverything();
    grant({ analytics: false, marketing: true });

    renderInjector();

    expect(owned(MARKETING_OWNER).length).toBeGreaterThan(0);
    expect(owned(ANALYTICS_OWNER)).toHaveLength(0);
    expect(documentMentions(META_ID)).toBe(true);
    for (const needle of [GTM_ID, PLAUSIBLE_URL]) {
      expect(documentMentions(needle)).toBe(false);
    }
  });

  it("dopiero montaż klienta (mounted false -> true) uruchamia wstrzyknięcie", () => {
    setAnalytics({ plausible_domain: PLAUSIBLE_DOMAIN, plausible_script_url: PLAUSIBLE_URL });
    grant({ analytics: true });
    harness.mounted = false;

    const view = renderInjector();
    expect(allOwned()).toHaveLength(0);

    harness.mounted = true;
    view.rerender(<ConsentScriptInjector />);

    expect(owned(ANALYTICS_OWNER)).toHaveLength(1);
  });
});

// ==========================================================================
// Loadery: wszystkie gałęzie konfiguracji
// ==========================================================================

describe("ConsentScriptInjector - loadery analityki", () => {
  beforeEach(() => {
    grant({ analytics: true });
  });

  it("GA4 stoi poza bramką zgody: tag ładuje się z domyślną odmową wszystkich kategorii", async () => {
    setAnalytics({ ga4_measurement_id: GA4_ID });

    renderInjector();

    // Żaden węzeł GA4 nie należy do właściciela `consent-analytics` - GA4 nie
    // jest już usuwany przy cofnięciu zgody, bo bez zgody i tak nie zapisuje
    // cookies (Consent Mode v2), a trafienia zasilają wyłącznie modelowanie.
    expect(externalScripts(ANALYTICS_OWNER)).toHaveLength(0);
    expect(inlineScripts(ANALYTICS_OWNER)).toHaveLength(0);

    // Konfiguracja strumienia i zgoda domyślna - NATYCHMIAST (to tylko wpisy
    // w `dataLayer`, zero sieci).
    expect(configEntry(GA4_ID)).toBeDefined();
    expect(consentDefault()).toMatchObject({ analytics_storage: "denied" });

    await poInterakcji();
    const tag = document.head.querySelectorAll<HTMLScriptElement>("script[data-ga4-tag]");
    expect(tag).toHaveLength(1);
    expect(tag[0].getAttribute("src")).toBe(`${GTAG_PREFIX}${encodeURIComponent(GA4_ID)}`);
    expect(tag[0].async).toBe(true);
  });

  it("tag Google NIE jest dociągany w oknie hydratacji ani tuż po load - dopiero na sygnał polityki (F20)", async () => {
    setAnalytics({ ga4_measurement_id: GA4_ID });
    grant({ analytics: true });

    renderInjector();

    // Okno LCP: obcego originu nie ma w dokumencie ANI JEDNEGO...
    expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(0);
    // ...a mimo to pomiar jest już „gotowy": polecenia czekają w warstwie
    // danych, którą gtag.js przetworzy od początku, gdy dojedzie. Bez tego
    // pierwsza odsłona (router woła ją przy `onResolved`) przepadałaby.
    expect(configEntry(GA4_ID)).toBeDefined();
    expect(consentUpdate()).toMatchObject({ analytics_storage: "granted" });

    // Sam `load` już NIE wystarcza (do 2026-10-02 wystarczał: `afterPageLoad(…,
    // 2000)`): na mobile to okno wciąż trafiało w TBT/TTI. Bez interakcji
    // skrypt dojedzie dopiero w globalnym punkcie ciszy (≥ 5 s po load, limit
    // 20 s - osobny test niżej i `gtagLoadPolicy.test.ts`).
    await poSamymLoad();
    expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(0);

    await poInterakcji();
    expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(1);
  });

  it("bez interakcji i bez decyzji tag dojeżdża w globalnym punkcie ciszy (≥ 5 s po load), nie wcześniej", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    // Bez `PerformanceObserver` o punkcie decyduje samo minimum po `load`.
    vi.stubGlobal("PerformanceObserver", undefined);
    const readyState = vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
    try {
      setAnalytics({ ga4_measurement_id: GA4_ID });
      renderInjector();
      expect(configEntry(GA4_ID)).toBeDefined();
      // Polityka (z detektorem ciszy) dojeżdża leniwym `import()`; zegar
      // podmieniony stoi, więc minimum liczy się od tej samej chwili.
      await poZaladowaniuPolityki();

      act(() => {
        vi.advanceTimersByTime(QUIESCENCE_MIN_AFTER_LOAD_MS - 1);
      });
      expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(0);

      act(() => {
        vi.advanceTimersByTime(100);
      });
      const tag = document.head.querySelectorAll<HTMLScriptElement>("script[data-ga4-tag]");
      expect(tag).toHaveLength(1);
      expect(tag[0].getAttribute("src")).toBe(`${GTAG_PREFIX}${encodeURIComponent(GA4_ID)}`);
    } finally {
      readyState.mockRestore();
      vi.useRealTimers();
    }
  });

  it("jawna decyzja o zgodzie dociąga tag bez interakcji (decyzja z innej karty też liczy się jako sygnał)", async () => {
    setAnalytics({ ga4_measurement_id: GA4_ID });

    renderInjector();
    expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(0);

    await poDecyzjiZgody();
    const tag = document.head.querySelectorAll<HTMLScriptElement>("script[data-ga4-tag]");
    expect(tag).toHaveLength(1);
    expect(tag[0].getAttribute("src")).toBe(`${GTAG_PREFIX}${encodeURIComponent(GA4_ID)}`);
  });

  it("zmiana zgody BEZ zapisanej decyzji (podgląd, GPC) nie jest sygnałem dociągnięcia", async () => {
    setAnalytics({ ga4_measurement_id: GA4_ID });

    renderInjector();
    await act(async () => {
      // `subscribeConsentChange` budzi się, ale `hasConsentDecision()` zostaje false.
      for (const listener of harness.consentListeners) listener();
      await poKrokachKolejki();
    });
    expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(0);
  });

  it("odmontowanie odpina nasłuch decyzji o zgodzie (inaczej odpięty efekt dociągałby tag)", async () => {
    setAnalytics({ ga4_measurement_id: GA4_ID });

    const view = renderInjector();
    await poZaladowaniuPolityki();
    expect(harness.consentListeners.size).toBe(1);
    view.unmount();
    expect(harness.consentListeners.size).toBe(0);

    await poDecyzjiZgody();
    expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(0);
  });

  it("keeps consent commands synchronous while the document is still loading", async () => {
    const readyState = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    try {
      setAnalytics({ ga4_measurement_id: GA4_ID });
      grant({ analytics: true });
      renderInjector();
      await act(async () => {
        await poKrokachKolejki();
      });
      expect(consentUpdate()).toMatchObject({ analytics_storage: "granted" });
      expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(0);
      await poInterakcji();
      expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(1);
    } finally {
      readyState.mockRestore();
    }
  });

  it("zgoda odwiedzającego aktualizuje Consent Mode zamiast wstrzykiwać drugi tag", async () => {
    setAnalytics({ ga4_measurement_id: GA4_ID });

    const view = renderInjector();
    grant({ analytics: true });
    view.rerender(<ConsentScriptInjector />);
    await poInterakcji();

    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(1);
    expect(consentUpdate()).toMatchObject({
      analytics_storage: "granted",
      functionality_storage: "denied",
      ad_storage: "denied",
    });
  });

  it("nieprawidłowy wpis site_settings degraduje do domyślnych zamiast wywracać stronę", async () => {
    // Identyfikator dłuższy niż dopuszcza schemat (max 64) - dawniej `.parse`
    // rzucał w renderze i każda publiczna strona lądowała na ekranie błędu.
    setAnalytics({ ga4_measurement_id: "G-" + "X".repeat(70) });

    expect(() => renderInjector()).not.toThrow();
    await poInterakcji();

    // Domyślne = brak wpisu z panelu, więc bootstrap idzie ze stałą wdrożenia.
    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(1);
    expect(configEntry(GA4_MEASUREMENT_ID)).toBeDefined();
  });

  it("Odłącz GA4 w panelu (ga4_enabled: false) zatrzymuje bootstrap i aktualizacje zgody", () => {
    setAnalytics({ ga4_measurement_id: GA4_ID, ga4_enabled: false });
    grant({ analytics: true });

    renderInjector();

    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(0);
    expect(consentDefault()).toBeUndefined();
    expect(consentUpdate()).toBeUndefined();
  });

  it("dopina się do tagu ze snippetu SSR zamiast konfigurować drugi strumień", () => {
    // Snippet SSR z __root.tsx: `window.gtag`, zgoda domyślna i `config` GA4
    // wykonane w <head>, plus <script async src=gtag/js?id=…> BEZ znacznika
    // klienckiego. Panel ma tu INNY identyfikator - klient nie może z niego
    // zrobić drugiego strumienia (dual-tagging).
    const ssrId = "G-SSR0000001";
    new Function(ga4SsrSnippet(ssrId, GOOGLE_ADS_ID))();
    const ssrTag = document.createElement("script");
    ssrTag.async = true;
    ssrTag.src = `${GTAG_PREFIX}${encodeURIComponent(ssrId)}`;
    document.head.appendChild(ssrTag);
    setAnalytics({ ga4_measurement_id: GA4_ID });

    const view = renderInjector();
    grant({ analytics: true });
    view.rerender(<ConsentScriptInjector />);

    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(0);
    expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(1);
    expect(configEntry(GA4_ID)).toBeUndefined();
    expect(configCount(ssrId)).toBe(1);
    // TP-2: ani snippet, ani bootstrap nie konfigurują Google Ads - zgoda jest
    // tu wyłącznie analityczna.
    expect(configCount(GOOGLE_ADS_ID)).toBe(0);
    expect(consentUpdate()).toMatchObject({ analytics_storage: "granted" });
  });

  it("GTM dodaje inline snippet z identyfikatorem kontenera i własnym znacznikiem sprzątania", () => {
    setAnalytics({ gtm_container_id: GTM_ID });

    renderInjector();

    expect(externalScripts(ANALYTICS_OWNER)).toHaveLength(0);
    const inline = inlineScripts(ANALYTICS_OWNER);
    expect(inline).toHaveLength(1);
    expect(inline[0].textContent).toContain(JSON.stringify(GTM_ID));
    // Snippet sam znakuje węzeł, który utworzy w czasie wykonania - inaczej
    // skrypt GTM przeżyłby cofnięcie zgody.
    expect(inline[0].textContent).toContain(`setAttribute('${MARK_ATTR}','${ANALYTICS_OWNER}')`);
  });

  it("plausible dodaje skrypt zewnętrzny z defer i data-domain", () => {
    setAnalytics({ plausible_domain: PLAUSIBLE_DOMAIN, plausible_script_url: PLAUSIBLE_URL });

    renderInjector();

    const external = externalScripts(ANALYTICS_OWNER);
    expect(external).toHaveLength(1);
    expect(external[0].getAttribute("src")).toBe(PLAUSIBLE_URL);
    expect(external[0].defer).toBe(true);
    expect(external[0].getAttribute("data-domain")).toBe(PLAUSIBLE_DOMAIN);
  });

  it("plausible z domeną, ale bez adresu skryptu nie wstrzykuje nic", () => {
    setAnalytics({ plausible_domain: PLAUSIBLE_DOMAIN, plausible_script_url: "" });

    renderInjector();

    expect(owned(ANALYTICS_OWNER)).toHaveLength(0);
  });

  it("custom_head_html i custom_body_html trafiają do właściwych rodziców", () => {
    setAnalytics({
      custom_head_html: '<meta name="consent-test-analytics-head" content="1" />',
      custom_body_html: '<span data-test="consent-analytics-body"></span>',
    });

    renderInjector();

    expect(ownedIn(document.head, ANALYTICS_OWNER)).toHaveLength(1);
    expect(ownedIn(document.body, ANALYTICS_OWNER)).toHaveLength(1);
    expect(document.head.querySelector('meta[name="consent-test-analytics-head"]')).not.toBeNull();
    expect(document.body.querySelector('span[data-test="consent-analytics-body"]')).not.toBeNull();
    // Kontener jest ukryty, więc wklejka nie może zepsuć layoutu strony.
    expect(ownedIn(document.body, ANALYTICS_OWNER)[0].style.display).toBe("none");
  });

  it("puste identyfikatory analityki nie wstrzykują żadnego węzła", () => {
    setAnalytics({});

    renderInjector();

    expect(owned(ANALYTICS_OWNER)).toHaveLength(0);
  });

  it("wklejka złożona z samych białych znaków nie tworzy kontenera", () => {
    setAnalytics({ custom_head_html: "   \n  ", custom_body_html: "\t" });

    renderInjector();

    expect(owned(ANALYTICS_OWNER)).toHaveLength(0);
  });
});

describe("ConsentScriptInjector - loadery marketingu", () => {
  beforeEach(() => {
    grant({ marketing: true });
  });

  it("Meta Pixel dodaje inline z identyfikatorem i znacznikiem sprzątania", () => {
    setMarketing({ meta_pixel_id: META_ID });

    renderInjector();

    const inline = inlineScripts(MARKETING_OWNER);
    expect(inline).toHaveLength(1);
    expect(inline[0].textContent).toContain(JSON.stringify(META_ID));
    expect(inline[0].textContent).toContain(`setAttribute('${MARK_ATTR}','${MARKETING_OWNER}')`);
    expect(externalScripts(MARKETING_OWNER)).toHaveLength(0);
  });

  it("LinkedIn dodaje inline z partner id oraz oznaczony skrypt insight.min.js", () => {
    setMarketing({ linkedin_partner_id: LINKEDIN_ID });

    renderInjector();

    expect(inlineCode(MARKETING_OWNER)).toContain(JSON.stringify(LINKEDIN_ID));
    const external = externalScripts(MARKETING_OWNER);
    expect(external).toHaveLength(1);
    expect(external[0].getAttribute("src")).toBe(LINKEDIN_SRC);
  });

  it("TikTok dodaje inline z pixel id", () => {
    setMarketing({ tiktok_pixel_id: TIKTOK_ID });

    renderInjector();

    const inline = inlineScripts(MARKETING_OWNER);
    expect(inline).toHaveLength(1);
    expect(inline[0].textContent).toContain(`ttq.load(${JSON.stringify(TIKTOK_ID)})`);
  });

  it("marketingowy custom HTML trafia do head i do body", () => {
    setMarketing({
      custom_head_html: '<meta name="consent-test-marketing-head" content="1" />',
      custom_body_html: '<span data-test="consent-marketing-body"></span>',
    });

    renderInjector();

    expect(ownedIn(document.head, MARKETING_OWNER)).toHaveLength(1);
    expect(ownedIn(document.body, MARKETING_OWNER)).toHaveLength(1);
  });

  it("puste identyfikatory marketingu nie wstrzykują żadnego węzła", () => {
    setMarketing({});

    renderInjector();

    expect(owned(MARKETING_OWNER)).toHaveLength(0);
  });
});

// ==========================================================================
// Leniwy import polityki gtag.js (P1.1, poprawka po dowodzie A/B)
// ==========================================================================
//
// Statyczny import `gtagLoadPolicy.ts` wciągał politykę i prymitywy P0.3 do
// zamknięcia bootu (`__root.tsx` -> `ConsentScriptInjector`): +2,4 KB gzip w
// chunku `index`, a na mobile fixture ok. +155 ms LCP (próg rundy TCP w
// symulacji Lanterna). Komponent ładuje więc politykę `import()` z efektu po
// hydratacji. Przypinamy: brak krawędzi statycznej w źródle, moment założenia
// sygnałów, odmontowanie przed dojazdem chunku, kliknięcie sprzed dojazdu
// (lepka aktywacja) i awarię polityki (tag ładuje się od razu).

/**
 * Czy źródło ma STATYCZNY import albo reeksport (także wielolinijkowy,
 * `import type` i `import "…"`) z modułu o danym prefiksie. Klauzula nie
 * przechodzi przez `;` ani nawiasy, więc `import("…")` się nie liczy.
 */
function hasStaticImport(source: string, specifierPrefix: string): boolean {
  const prefix = specifierPrefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const fromClause = new RegExp(
    `(?:^|\\n)\\s*(?:import|export)\\s[^;()]*?\\sfrom\\s*["']${prefix}`,
  );
  const bareImport = new RegExp(`(?:^|\\n)\\s*import\\s*["']${prefix}`);
  return fromClause.test(source) || bareImport.test(source);
}

describe("ConsentScriptInjector - leniwy import polityki gtag.js (poza zamknięciem bootu)", () => {
  beforeEach(() => {
    grant({ analytics: true });
    setAnalytics({ ga4_measurement_id: GA4_ID });
  });

  it("źródło komponentu nie importuje statycznie polityki ani prymitywów P0.3 - wyłącznie `import()`", () => {
    const source = readFileSync("src/components/ConsentScriptInjector.tsx", "utf8");
    expect(hasStaticImport(source, "@/lib/analytics/gtagLoadPolicy")).toBe(false);
    expect(hasStaticImport(source, "@/lib/performance/")).toBe(false);
    expect(source).toContain('import("@/lib/analytics/gtagLoadPolicy")');
    // Strażnik samego strażnika: wielolinijkowy import z `ga4Client` jest
    // rozpoznawany, więc `false` wyżej nie wynika ze ślepej heurystyki.
    expect(hasStaticImport(source, "@/lib/analytics/ga4Client")).toBe(true);
  });

  it("polityka zostaje założona dopiero po rozstrzygnięciu `import()`, nie w renderze ani w samym efekcie", async () => {
    renderInjector();

    // Polecenia są w warstwie danych od razu (bootstrap synchroniczny)...
    expect(configEntry(GA4_ID)).toBeDefined();
    expect(consentUpdate()).toMatchObject({ analytics_storage: "granted" });
    // ...a polityki jeszcze nie ma: ani sygnałów, ani nasłuchu decyzji.
    expect(scheduleGtagLoad).not.toHaveBeenCalled();
    expect(harness.consentListeners.size).toBe(0);

    await poZaladowaniuPolityki();
    expect(scheduleGtagLoad).toHaveBeenCalledTimes(1);
    expect(scheduleGtagLoad).toHaveBeenCalledWith(expect.any(Function), {
      onDecision: expect.any(Function),
    });
    expect(harness.consentListeners.size).toBe(1);
    // Założenie sygnałów niczego nie ładuje - czeka na interakcję/decyzję/ciszę.
    expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(0);

    await poInterakcji();
    expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(1);
  });

  it("odmontowanie przed dojazdem chunku polityki nie zakłada żadnego sygnału", async () => {
    const view = renderInjector();
    view.unmount();

    await poZaladowaniuPolityki();
    expect(scheduleGtagLoad).not.toHaveBeenCalled();
    expect(harness.consentListeners.size).toBe(0);

    await poInterakcji();
    await poDecyzjiZgody();
    expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(0);
  });

  it("kliknięcie sprzed dojazdu polityki nie ginie: lepka aktywacja zwalnia kolejkę przy założeniu sygnałów", async () => {
    renderInjector();
    // Odwiedzający kliknął, zanim chunk dojechał: nasłuchu P0.3 jeszcze nie
    // było, ale przeglądarka pamięta lepką aktywację (happy-dom jej nie ma -
    // definiujemy ją na czas testu, jak w `firstInteraction.test.ts`).
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      get: () => ({ hasBeenActive: true, isActive: false }),
    });
    try {
      await poZaladowaniuPolityki();
      await act(async () => {
        await poKrokachKolejki();
      });
      expect(document.head.querySelectorAll("script[data-ga4-tag]")).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(navigator, "userActivation");
    }
  });

  it("awaria polityki (chunk nie dojechał albo `scheduleGtagLoad` rzuca): tag ładuje się od razu, bez duplikatu", async () => {
    // Ta sama gałąź `.catch` obsługuje odrzucony `import()` i wyjątek polityki.
    vi.mocked(scheduleGtagLoad).mockImplementationOnce(() => {
      throw new Error("chunk polityki niedostępny");
    });
    renderInjector();
    expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(0);

    await poZaladowaniuPolityki();
    expect(scheduleGtagLoad).toHaveBeenCalledTimes(1);
    const tag = document.head.querySelectorAll<HTMLScriptElement>("script[data-ga4-tag]");
    expect(tag).toHaveLength(1);
    expect(tag[0].getAttribute("src")).toBe(`${GTAG_PREFIX}${encodeURIComponent(GA4_ID)}`);

    await poInterakcji();
    expect(document.head.querySelectorAll(`script[src^="${GTAG_PREFIX}"]`)).toHaveLength(1);
  });
});

// ==========================================================================
// Google Ads dopiero po zgodzie marketingowej (P1.1, TP-2)
// ==========================================================================
//
// `config AW-…` w warstwie danych każe gtag.js dociągnąć DRUGI kontener (Google
// Ads, ~200 KB, ~185 ms CPU na telefonie). Snippet SSR i bootstrap go więc nie
// wysyłają; robi to `ga4ConfigureAds` w TYM SAMYM efekcie co `ga4ConsentUpdate`
// i PO nim (gtag.js przetwarza warstwę po kolei - odwrotna kolejność wysłałaby
// pierwsze trafienie Ads w stanie `denied`), wyłącznie przy
// `categories.marketing === true`.

describe("ConsentScriptInjector - Google Ads dopiero po zgodzie marketingowej (TP-2)", () => {
  function runSsrSnippet(): void {
    new Function(ga4SsrSnippet(GA4_MEASUREMENT_ID, GOOGLE_ADS_ID))();
  }

  it("bez zgody marketingowej w warstwie danych nie ma `config AW` (snippet SSR + bootstrap + zgoda analityczna)", () => {
    runSsrSnippet();
    grant({ analytics: true, marketing: false });

    renderInjector();

    expect(configCount(GA4_MEASUREMENT_ID)).toBe(1);
    expect(configCount(GOOGLE_ADS_ID)).toBe(0);
    expect(consentUpdate()).toMatchObject({ analytics_storage: "granted", ad_storage: "denied" });
  });

  it("powracający odwiedzający ze zgodą marketingową: dokładnie jeden `config AW`, PO `consent update` z ad_storage granted", () => {
    runSsrSnippet();
    grant({ analytics: true, marketing: true });

    renderInjector();

    expect(configCount(GOOGLE_ADS_ID)).toBe(1);
    const updateAt = lastGrantedAdsUpdateIndex();
    expect(updateAt).toBeGreaterThanOrEqual(0);
    expect(updateAt).toBeLessThan(configIndex(GOOGLE_ADS_ID));
  });

  it("zgoda marketingowa z banera po montażu: `config AW` dopiero za aktualizacją zgody; kolejne zmiany kategorii go nie dokładają", () => {
    runSsrSnippet();
    grant({ analytics: false, marketing: false });
    const view = renderInjector();
    expect(configCount(GOOGLE_ADS_ID)).toBe(0);

    grant({ analytics: true, marketing: true });
    view.rerender(<ConsentScriptInjector />);

    expect(configCount(GOOGLE_ADS_ID)).toBe(1);
    expect(lastGrantedAdsUpdateIndex()).toBeLessThan(configIndex(GOOGLE_ADS_ID));

    harness.categories = { ...harness.categories, functional: true };
    view.rerender(<ConsentScriptInjector />);
    expect(configCount(GOOGLE_ADS_ID)).toBe(1);
  });

  it("cofnięcie i ponowna zgoda marketingowa: aktualizacje zgody tak, drugi `config AW` nie", () => {
    grant({ analytics: true, marketing: true });
    const view = renderInjector();
    grant({ analytics: true, marketing: false });
    view.rerender(<ConsentScriptInjector />);
    grant({ analytics: true, marketing: true });
    view.rerender(<ConsentScriptInjector />);

    expect(consentUpdates().map((update) => update.ad_storage)).toEqual([
      "granted",
      "denied",
      "granted",
    ]);
    expect(configCount(GOOGLE_ADS_ID)).toBe(1);
  });

  it("GPC: klamra `clampCategoriesForGpc` zdejmuje marketing - brak `config AW` mimo zgody na wszystko", () => {
    harness.categories = clampCategoriesForGpc(
      { necessary: true, functional: true, analytics: true, marketing: true },
      true,
    );
    expect(harness.categories.marketing).toBe(false);

    renderInjector();

    expect(configCount(GOOGLE_ADS_ID)).toBe(0);
    expect(consentUpdate()).toMatchObject({ ad_storage: "denied", analytics_storage: "denied" });
  });

  it("dokument z cache brzegowego sprzed P1.1 (snippet z `config AW`) + zgoda marketingowa: nadal jeden `config AW`", () => {
    const configGa4 = `gtag('config',${JSON.stringify(GA4_MEASUREMENT_ID)}`;
    const legacy = ga4SsrSnippet(GA4_MEASUREMENT_ID, GOOGLE_ADS_ID).replace(
      configGa4,
      `gtag('config',${JSON.stringify(GOOGLE_ADS_ID)});${configGa4}`,
    );
    expect(legacy).toContain(GOOGLE_ADS_ID);
    new Function(legacy)();
    grant({ analytics: true, marketing: true });

    renderInjector();

    expect(configCount(GOOGLE_ADS_ID)).toBe(1);
    expect(configCount(GA4_MEASUREMENT_ID)).toBe(1);
  });

  it("„Odłącz GA4” (ga4_enabled: false): ani aktualizacji zgody, ani `config AW`, nawet ze zgodą marketingową", () => {
    setAnalytics({ ga4_enabled: false });
    grant({ analytics: true, marketing: true });

    renderInjector();

    expect(consentUpdate()).toBeUndefined();
    expect(configCount(GOOGLE_ADS_ID)).toBe(0);
  });

  it("przed montażem klienta (mounted=false) nie ma ani aktualizacji zgody, ani `config AW`", () => {
    grant({ analytics: true, marketing: true });
    harness.mounted = false;

    renderInjector();

    expect(consentUpdate()).toBeUndefined();
    expect(configCount(GOOGLE_ADS_ID)).toBe(0);
  });
});

// ==========================================================================
// KONTRAKT 2: cofnięcie zgody usuwa to, co wstrzyknięto
// ==========================================================================

describe("ConsentScriptInjector - kontrakt 2: cofnięcie zgody sprząta dokument", () => {
  it("cofnięcie zgody analitycznej usuwa skrypt zewnętrzny, inline i kontenery z head i body", () => {
    setAnalytics({
      plausible_domain: PLAUSIBLE_DOMAIN,
      plausible_script_url: PLAUSIBLE_URL,
      custom_head_html: '<meta name="consent-test-analytics-head" content="1" />',
      custom_body_html: '<span data-test="consent-analytics-body"></span>',
    });
    grant({ analytics: true });

    const view = renderInjector();

    // Każdy rodzaj węzła musi być na miejscu PRZED cofnięciem - inaczej test
    // „sprząta" coś, czego nigdy nie było.
    expect(externalScripts(ANALYTICS_OWNER)).toHaveLength(1);
    expect(containersIn(document.head, ANALYTICS_OWNER)).toHaveLength(1);
    expect(ownedIn(document.body, ANALYTICS_OWNER)).toHaveLength(1);
    expect(owned(ANALYTICS_OWNER)).toHaveLength(3);

    grant({ analytics: false });
    view.rerender(<ConsentScriptInjector />);

    expect(document.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(0);
    expect(document.head.querySelector('meta[name="consent-test-analytics-head"]')).toBeNull();
    expect(document.body.querySelector('span[data-test="consent-analytics-body"]')).toBeNull();
    // Po cofnięciu zgody adres nie może zostać nigdzie w dokumencie - także w
    // skrypcie, który zgubiłby znacznik właściciela.
    expect(documentMentions(PLAUSIBLE_URL)).toBe(false);
  });

  it("cofnięcie zgody marketingowej nie rusza węzłów analityki", () => {
    configureEverything();
    grant({ analytics: true, marketing: true });

    const view = renderInjector();
    expect(owned(ANALYTICS_OWNER).length).toBeGreaterThan(0);
    const marketingBefore = owned(MARKETING_OWNER).length;
    expect(marketingBefore).toBeGreaterThan(0);

    grant({ analytics: true, marketing: false });
    view.rerender(<ConsentScriptInjector />);

    expect(owned(MARKETING_OWNER)).toHaveLength(0);
    expect(owned(ANALYTICS_OWNER).length).toBeGreaterThan(0);
  });

  it("odmontowanie komponentu usuwa KAŻDY rodzaj węzła obu kategorii", () => {
    configureEverything();
    grant({ analytics: true, marketing: true });

    const view = renderInjector();

    // Inwentarz przed odmontowaniem, rodzaj po rodzaju - bez niego asercja
    // „po odmontowaniu jest pusto" byłaby prawdziwa także wtedy, gdyby
    // wstrzyknięcie w ogóle się nie odbyło albo pomijało któryś rodzaj węzła.
    expect(externalScripts(ANALYTICS_OWNER)).toHaveLength(1); // plausible
    expect(inlineScripts(ANALYTICS_OWNER)).toHaveLength(1); // GTM
    expect(containersIn(document.head, ANALYTICS_OWNER)).toHaveLength(1);
    expect(containersIn(document.body, ANALYTICS_OWNER)).toHaveLength(1);
    expect(externalScripts(MARKETING_OWNER)).toHaveLength(1); // insight LinkedIn
    expect(inlineScripts(MARKETING_OWNER)).toHaveLength(3); // Meta + LinkedIn + TikTok
    expect(containersIn(document.head, MARKETING_OWNER)).toHaveLength(1);
    expect(containersIn(document.body, MARKETING_OWNER)).toHaveLength(1);
    expect(allOwned()).toHaveLength(10);

    view.unmount();

    expect(document.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(0);
    // Zostaje wyłącznie tag GA4: nie należy do tej bramki, bo działa w trybie
    // domyślnej odmowy Google i po odmontowaniu nadal ma wszystko `denied`.
    expect(document.head.querySelectorAll("script:not([data-ga4-tag])")).toHaveLength(0);
    expect(document.head.querySelector('meta[name="consent-test-analytics-head"]')).toBeNull();
    expect(document.body.querySelector('span[data-test="consent-marketing-body"]')).toBeNull();
    for (const needle of [GTM_ID, PLAUSIBLE_URL, META_ID, LINKEDIN_ID, TIKTOK_ID]) {
      expect(documentMentions(needle)).toBe(false);
    }
  });

  it("odmowa zgody przy braku wcześniejszego wstrzyknięcia jest bezpiecznym no-opem", () => {
    configureEverything();
    grant({ analytics: false, marketing: false });

    const view = renderInjector();
    expect(allOwned()).toHaveLength(0);

    // Druga tura z tą samą odmową: gałąź „cofnij" biegnie z pustym uchwytem
    // sprzątania (`current === null`) i nie może rzucić.
    harness.analytics = { ...harness.analytics, ga4_measurement_id: "G-TEST999999" };
    view.rerender(<ConsentScriptInjector />);

    expect(allOwned()).toHaveLength(0);
  });
});

// ==========================================================================
// KONTRAKT 3: injectCustomHtml wykonuje wklejkę i znakuje kontener
// ==========================================================================

describe("ConsentScriptInjector - kontrakt 3: wklejka administratora", () => {
  it("WYKONUJE skrypt z wklejki i odtwarza go jako nowy <script> z zachowanymi atrybutami", () => {
    // Ewaluacja JS włączona wyłącznie na czas tego testu (patrz nagłówek
    // pliku): to jedyny sposób, by dowieść, że przepisanie węzłów `<script>` w
    // `injectCustomHtml` naprawdę powoduje wykonanie kodu - węzeł powstały z
    // `innerHTML` sam z siebie nigdy nie zostałby wykonany.
    writeSetting("enableJavaScriptEvaluation", true);
    try {
      setAnalytics({
        custom_head_html:
          '<script type="text/javascript" data-consent-test="wklejka">' +
          'window.__consentTestMarker = "wykonany";' +
          "</scr" +
          "ipt>",
      });
      grant({ analytics: true });

      renderInjector();

      expect(Reflect.get(window, "__consentTestMarker")).toBe("wykonany");

      const holder = ownedIn(document.head, ANALYTICS_OWNER);
      expect(holder).toHaveLength(1);
      const recreated = holder[0].querySelectorAll("script");
      expect(recreated).toHaveLength(1);
      expect(recreated[0].getAttribute("data-consent-test")).toBe("wklejka");
      expect(recreated[0].getAttribute("type")).toBe("text/javascript");
      expect(recreated[0].textContent).toContain("__consentTestMarker");
    } finally {
      writeSetting("enableJavaScriptEvaluation", false);
    }
  });

  it("kontener wklejki ma znacznik właściciela, więc cofnięcie zgody usuwa też jej skrypty", () => {
    setMarketing({
      custom_body_html:
        '<div id="wklejka-marketing"></div><script data-consent-test="wklejka-2"></scr' + "ipt>",
    });
    grant({ marketing: true });

    const view = renderInjector();

    const holder = ownedIn(document.body, MARKETING_OWNER);
    expect(holder).toHaveLength(1);
    // Brzeg drugi kontraktu: bez znacznika kontener przeżyłby cofnięcie zgody.
    expect(holder[0].getAttribute(MARK_ATTR)).toBe(MARKETING_OWNER);
    expect(document.getElementById("wklejka-marketing")).not.toBeNull();
    expect(document.querySelector('script[data-consent-test="wklejka-2"]')).not.toBeNull();

    grant({ marketing: false });
    view.rerender(<ConsentScriptInjector />);

    expect(document.getElementById("wklejka-marketing")).toBeNull();
    expect(document.querySelector('script[data-consent-test="wklejka-2"]')).toBeNull();
    expect(allOwned()).toHaveLength(0);
  });
});

// ==========================================================================
// KONTRAKT 4: zmiana konfiguracji przeładowuje skrypty
// ==========================================================================

describe("ConsentScriptInjector - kontrakt 4: zmiana konfiguracji przeładowuje skrypty", () => {
  it("zmiana plausible_domain podmienia węzeł, zamiast dokładać drugi", () => {
    setAnalytics({ plausible_domain: PLAUSIBLE_DOMAIN, plausible_script_url: PLAUSIBLE_URL });
    grant({ analytics: true });

    const view = renderInjector();
    expect(owned(ANALYTICS_OWNER)).toHaveLength(1);
    expect(externalScripts(ANALYTICS_OWNER)[0].getAttribute("data-domain")).toBe(PLAUSIBLE_DOMAIN);

    setAnalytics({
      plausible_domain: "inny-najemca.example.com",
      plausible_script_url: PLAUSIBLE_URL,
    });
    view.rerender(<ConsentScriptInjector />);

    const after = externalScripts(ANALYTICS_OWNER);
    expect(after).toHaveLength(1);
    expect(after[0].getAttribute("data-domain")).toBe("inny-najemca.example.com");
    expect(owned(ANALYTICS_OWNER)).toHaveLength(1);
  });

  it("zmiana ga4_measurement_id przeładowuje konfigurację strumienia poza bramką zgody", async () => {
    setAnalytics({ ga4_measurement_id: GA4_ID });
    grant({ analytics: true });

    const view = renderInjector();
    expect(owned(ANALYTICS_OWNER)).toHaveLength(0);
    expect(configEntry(GA4_ID)).toBeDefined();

    setAnalytics({ ga4_measurement_id: "G-TEST111111" });
    view.rerender(<ConsentScriptInjector />);
    await poInterakcji();

    // Skrypt gtag.js jest DOKŁADNIE JEDEN - zmiana strumienia to nowa
    // konfiguracja w `dataLayer`, nigdy drugi tag (drugi tag = drugi ping
    // Google Ads przy wejściu).
    const srcs = [...document.head.querySelectorAll("script[data-ga4-tag]")].map((s) =>
      s.getAttribute("src"),
    );
    expect(srcs).toHaveLength(1);
    expect(configEntry(GA4_ID)).toBeDefined();
    expect(configEntry("G-TEST111111")).toBeDefined();
    // ŁADUJE SIĘ IDENTYFIKATOREM AKTUALNYM W CHWILI POBRANIA, nie pierwszym
    // widzianym. Do 2026-09-20 tag szedł do sieci synchronicznie w pierwszym
    // efekcie, więc zawsze wygrywał identyfikator sprzed rozstrzygnięcia
    // `site_settings`; odroczenie do bezczynności (F20) przesuwa pobranie za
    // ten moment, a wtedy ładowanie PRZETERMINOWANEGO strumienia byłoby już
    // tylko pomyłką. W produkcji ta ścieżka i tak jest rzadka: `resolveBrowserGa4Id`
    // zaczyna od strumienia ze snippetu SSR, który się nie zmienia.
    expect(srcs[0]).toBe(`${GTAG_PREFIX}${encodeURIComponent("G-TEST111111")}`);
  });

  it("zmiana meta_pixel_id podmienia inline marketingu zamiast dokładać drugi", () => {
    setMarketing({ meta_pixel_id: META_ID });
    grant({ marketing: true });

    const view = renderInjector();
    expect(inlineScripts(MARKETING_OWNER)).toHaveLength(1);
    expect(inlineCode(MARKETING_OWNER)).toContain(META_ID);

    setMarketing({ meta_pixel_id: "PIXEL-TEST-2" });
    view.rerender(<ConsentScriptInjector />);

    expect(inlineScripts(MARKETING_OWNER)).toHaveLength(1);
    expect(inlineCode(MARKETING_OWNER)).toContain("PIXEL-TEST-2");
    expect(inlineCode(MARKETING_OWNER)).not.toContain(META_ID);
  });

  it("zmiana konfiguracji przy odmowie zgody nadal nic nie wstrzykuje", () => {
    setAnalytics({ ga4_measurement_id: GA4_ID });
    grant({ analytics: false });

    const view = renderInjector();
    setAnalytics({ ga4_measurement_id: "G-TEST222222" });
    view.rerender(<ConsentScriptInjector />);

    expect(allOwned()).toHaveLength(0);
  });
});

// ==========================================================================
// Rejestr defektów: adres skryptu plausible trafia do selektora CSS bez ucieczki
// ==========================================================================
//
// `loadAnalytics` odnajduje właśnie wstawiony skrypt plausible przez
// `document.querySelector(\`script[...][src="${cfg.plausible_script_url}"]\`)`,
// czyli wkleja WARTOŚĆ Z PANELU wprost w treść selektora. Schemat
// `AnalyticsConfigSchema` sprawdza tylko długość (500 znaków), więc do selektora
// trafia dowolny ciąg wpisany przez redakcję. Dwa skutki, oba ZMIERZONE niżej.
// Lekarstwem po stronie produkcji jest `CSS.escape()` albo trzymanie referencji
// do węzła zwróconej przez `injectExternalScript` - ale tego test nie zmienia.

describe("ConsentScriptInjector - defekty selektora adresu plausible", () => {
  it.fails(
    "DEFEKT: odwrotny ukośnik w adresie skryptu gubi data-domain (selektor bez CSS.escape)",
    () => {
      // W CSS `\\` rozpoczyna sekwencję ucieczki, więc selektor szuka innego
      // ciągu niż wartość atrybutu: `querySelector` zwraca null, gałąź `if (s)`
      // idzie bokiem i skrypt ląduje w head BEZ `data-domain`. Plausible
      // przypisze wtedy ruch do domeny odczytanej z adresu skryptu, a nie do
      // skonfigurowanej - cicha, niewidoczna w panelu utrata pomiaru.
      setAnalytics({
        plausible_domain: PLAUSIBLE_DOMAIN,
        plausible_script_url: "https://example.com/plausible\\test.js",
      });
      grant({ analytics: true });

      renderInjector();

      const external = externalScripts(ANALYTICS_OWNER);
      expect(external).toHaveLength(1);
      expect(external[0].getAttribute("data-domain")).toBe(PLAUSIBLE_DOMAIN);
    },
  );

  it.fails("DEFEKT: cudzysłów w adresie skryptu wywraca render publicznej strony", () => {
    // `[src="https://example.com/a".js"]` nie jest poprawnym selektorem -
    // `querySelector` rzuca SyntaxError WEWNĄTRZ efektu, więc literówka w
    // ustawieniu witryny przewraca całe drzewo Reacta u każdego odwiedzającego,
    // który zdążył wyrazić zgodę na analitykę.
    setAnalytics({
      plausible_domain: PLAUSIBLE_DOMAIN,
      plausible_script_url: 'https://example.com/a".js',
    });
    grant({ analytics: true });

    let thrown: unknown = null;
    try {
      renderInjector();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeNull();
  });
});

// ==========================================================================
// Izolacja od sieci - dowód, nie deklaracja
// ==========================================================================

describe("ConsentScriptInjector - izolacja od sieci", () => {
  it("po wstrzyknięciu wszystkich skryptów zewnętrznych nie poszło ani jedno żądanie", () => {
    // Sam fakt, że test przechodzi, nie dowodzi jeszcze niczego: dowodem jest
    // WŁĄCZONA blokada pobierania plików JS w happy-dom plus atrapa `fetch`,
    // która rzuca przy każdym wywołaniu i nie została wywołana.
    expect(readSetting("disableJavaScriptFileLoading")).toBe(true);
    // Druga połowa bramki happy-dom (`disableJavaScriptFileLoading ||
    // !enableJavaScriptEvaluation`) - a zarazem dowód, że kontrakt 3 ODDAŁ
    // ewaluację po sobie i nie zostawił jej włączonej na resztę pliku.
    expect(readSetting("enableJavaScriptEvaluation")).toBe(false);

    configureEverything();
    grant({ analytics: true, marketing: true });

    renderInjector();

    const srcs = [...externalScripts(ANALYTICS_OWNER), ...externalScripts(MARKETING_OWNER)].map(
      (s) => s.getAttribute("src"),
    );
    // Dwa adresy zewnętrzne pod bramką zgody: plausible (atrapowy) i insight
    // LinkedIn. GA4 ma własną ścieżkę (tryb domyślnej odmowy), stąd nie tutaj.
    expect(srcs).toHaveLength(2);
    expect(srcs).toContain(PLAUSIBLE_URL);
    expect(srcs).toContain(LINKEDIN_SRC);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
