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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// Stan sterujący atrapami. `vi.hoisted`, bo fabryki `vi.mock` są wynoszone nad
// importy i nie mogą domykać się na zwykłych zmiennych modułu.
const harness = vi.hoisted(() => ({
  categories: { necessary: true, functional: false, analytics: false, marketing: false },
  mounted: true,
  analytics: {} as object,
  marketing: {} as object,
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

// Atrapa zgód: sam hak `useEffectiveConsent` (prawdziwy dociąga klienta
// Supabase i localStorage - tu liczy się wyłącznie bramka).
vi.mock("@/lib/ads/consent", () => ({
  useEffectiveConsent: () => ({
    categories: harness.categories,
    preview: false,
    mounted: harness.mounted,
    gpc: { active: false, source: "none" },
    gpcHonored: false,
  }),
}));

import { ConsentScriptInjector } from "@/components/ConsentScriptInjector";
import type { AnalyticsConfig, MarketingConfig } from "@/lib/analytics/config";

// -------------------- atrapowe identyfikatory i adresy --------------------

const GA4_ID = "G-TEST000000";
const GTM_ID = "GTM-TEST000";
const PLAUSIBLE_URL = "https://example.com/plausible-test.js";
const PLAUSIBLE_DOMAIN = "consent-test.example.com";
const META_ID = "PIXEL-TEST-1";
const LINKEDIN_ID = "LI-PARTNER-TEST-1";
const TIKTOK_ID = "TT-PIXEL-TEST-1";

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
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  Reflect.deleteProperty(window, "__consentTestMarker");
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("przy odmowie obu kategorii nie wstrzykuje nic mimo skonfigurowanych identyfikatorów", () => {
    configureEverything();
    grant({ analytics: false, marketing: false });

    renderInjector();

    expect(allOwned()).toHaveLength(0);
    for (const needle of [GA4_ID, GTM_ID, PLAUSIBLE_URL, META_ID, LINKEDIN_ID, TIKTOK_ID]) {
      expect(documentMentions(needle)).toBe(false);
    }
  });

  it("zgoda tylko na analitykę nie wstrzykuje marketingu", () => {
    configureEverything();
    grant({ analytics: true, marketing: false });

    renderInjector();

    expect(owned(ANALYTICS_OWNER).length).toBeGreaterThan(0);
    expect(owned(MARKETING_OWNER)).toHaveLength(0);
    expect(documentMentions(GA4_ID)).toBe(true);
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
    for (const needle of [GA4_ID, GTM_ID, PLAUSIBLE_URL, GTAG_PREFIX]) {
      expect(documentMentions(needle)).toBe(false);
    }
  });

  it("dopiero montaż klienta (mounted false -> true) uruchamia wstrzyknięcie", () => {
    setAnalytics({ ga4_measurement_id: GA4_ID });
    grant({ analytics: true });
    harness.mounted = false;

    const view = renderInjector();
    expect(allOwned()).toHaveLength(0);

    harness.mounted = true;
    view.rerender(<ConsentScriptInjector />);

    expect(owned(ANALYTICS_OWNER)).toHaveLength(2);
  });
});

// ==========================================================================
// Loadery: wszystkie gałęzie konfiguracji
// ==========================================================================

describe("ConsentScriptInjector - loadery analityki", () => {
  beforeEach(() => {
    grant({ analytics: true });
  });

  it("GA4 dodaje oznaczony skrypt zewnętrzny gtag oraz inline z identyfikatorem", () => {
    setAnalytics({ ga4_measurement_id: GA4_ID });

    renderInjector();

    const external = externalScripts(ANALYTICS_OWNER);
    expect(external).toHaveLength(1);
    expect(external[0].getAttribute("src")).toBe(`${GTAG_PREFIX}${encodeURIComponent(GA4_ID)}`);
    expect(external[0].async).toBe(true);
    expect(external[0].parentElement).toBe(document.head);

    const inline = inlineScripts(ANALYTICS_OWNER);
    expect(inline).toHaveLength(1);
    expect(inline[0].textContent).toContain(JSON.stringify(GA4_ID));
    expect(inline[0].textContent).toContain("anonymize_ip");
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
// KONTRAKT 2: cofnięcie zgody usuwa to, co wstrzyknięto
// ==========================================================================

describe("ConsentScriptInjector - kontrakt 2: cofnięcie zgody sprząta dokument", () => {
  it("cofnięcie zgody analitycznej usuwa skrypt zewnętrzny, inline i kontenery z head i body", () => {
    setAnalytics({
      ga4_measurement_id: GA4_ID,
      plausible_domain: PLAUSIBLE_DOMAIN,
      plausible_script_url: PLAUSIBLE_URL,
      custom_head_html: '<meta name="consent-test-analytics-head" content="1" />',
      custom_body_html: '<span data-test="consent-analytics-body"></span>',
    });
    grant({ analytics: true });

    const view = renderInjector();

    // Każdy rodzaj węzła musi być na miejscu PRZED cofnięciem - inaczej test
    // „sprząta" coś, czego nigdy nie było.
    expect(externalScripts(ANALYTICS_OWNER)).toHaveLength(2);
    expect(inlineScripts(ANALYTICS_OWNER)).toHaveLength(1);
    expect(containersIn(document.head, ANALYTICS_OWNER)).toHaveLength(1);
    expect(ownedIn(document.body, ANALYTICS_OWNER)).toHaveLength(1);
    expect(owned(ANALYTICS_OWNER)).toHaveLength(5);

    grant({ analytics: false });
    view.rerender(<ConsentScriptInjector />);

    expect(document.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(0);
    expect(document.head.querySelector('meta[name="consent-test-analytics-head"]')).toBeNull();
    expect(document.body.querySelector('span[data-test="consent-analytics-body"]')).toBeNull();
    // Po cofnięciu zgody identyfikator nie może zostać nigdzie w dokumencie -
    // także w skrypcie, który zgubiłby znacznik właściciela.
    expect(documentMentions(GA4_ID)).toBe(false);
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
    expect(externalScripts(ANALYTICS_OWNER)).toHaveLength(2); // gtag + plausible
    expect(inlineScripts(ANALYTICS_OWNER)).toHaveLength(2); // GA4 + GTM
    expect(containersIn(document.head, ANALYTICS_OWNER)).toHaveLength(1);
    expect(containersIn(document.body, ANALYTICS_OWNER)).toHaveLength(1);
    expect(externalScripts(MARKETING_OWNER)).toHaveLength(1); // insight LinkedIn
    expect(inlineScripts(MARKETING_OWNER)).toHaveLength(3); // Meta + LinkedIn + TikTok
    expect(containersIn(document.head, MARKETING_OWNER)).toHaveLength(1);
    expect(containersIn(document.body, MARKETING_OWNER)).toHaveLength(1);
    expect(allOwned()).toHaveLength(12);

    view.unmount();

    expect(document.querySelectorAll(`[${MARK_ATTR}]`)).toHaveLength(0);
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
    expect(document.head.querySelector('meta[name="consent-test-analytics-head"]')).toBeNull();
    expect(document.body.querySelector('span[data-test="consent-marketing-body"]')).toBeNull();
    for (const needle of [GA4_ID, GTM_ID, PLAUSIBLE_URL, META_ID, LINKEDIN_ID, TIKTOK_ID]) {
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

  it("zmiana ga4_measurement_id wymienia oba węzły GA4 na nowe, bez duplikatów", () => {
    setAnalytics({ ga4_measurement_id: GA4_ID });
    grant({ analytics: true });

    const view = renderInjector();
    expect(owned(ANALYTICS_OWNER)).toHaveLength(2);

    setAnalytics({ ga4_measurement_id: "G-TEST111111" });
    view.rerender(<ConsentScriptInjector />);

    expect(owned(ANALYTICS_OWNER)).toHaveLength(2);
    expect(externalScripts(ANALYTICS_OWNER)[0].getAttribute("src")).toBe(
      `${GTAG_PREFIX}G-TEST111111`,
    );
    expect(inlineCode(ANALYTICS_OWNER)).toContain("G-TEST111111");
    expect(inlineCode(ANALYTICS_OWNER)).not.toContain(GA4_ID);
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
    // Trzy adresy zewnętrzne: gtag, plausible (atrapowy) i insight LinkedIn.
    expect(srcs).toHaveLength(3);
    expect(srcs).toContain(`${GTAG_PREFIX}${encodeURIComponent(GA4_ID)}`);
    expect(srcs).toContain(PLAUSIBLE_URL);
    expect(srcs).toContain(LINKEDIN_SRC);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
