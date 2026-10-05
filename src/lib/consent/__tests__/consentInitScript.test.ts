// Skrypt inicjalizacji zgód (P1.3) - sprawdzany WYKONANIEM, nie porównaniem tekstu.
//
// CO TO DOWODZI (warunki zgody właściciela na powłokę banera, ORCHESTRATOR-NOTES):
//  1. ODWIEDZAJĄCY Z DECYZJĄ NIGDY NIE WIDZI POWŁOKI: skrypt ustawia
//     `html[data-consent-decided]` DOKŁADNIE wtedy, gdy `readLocal()` widzi
//     decyzję (`hasConsentDecision()`), także dla zepsutego JSON-u, złej wersji,
//     samego ciasteczka, uszkodzonego %-kodowania, zablokowanego magazynu
//     i starego klucza marketingowego.
//  2. REKORD Z POWŁOKI = REKORD Z BANERA bajt w bajt poza znacznikiem czasu:
//     ten sam JSON w `localStorage`, ten sam surowy zapis ciasteczka, te same
//     kategorie; GPC -> kategorie klamrowane wyłączone (bez `gpcOverrideAt`).
//  3. TEN SAM CONSENT MODE co `ga4ConsentUpdate` (pola, kolejność, wartości).
//  4. PO BOOCIE decyzję zapisuje aplikacja (zdarzenie anulowalne), skrypt nie
//     dubluje zapisu; intencja (`customize`) niczego nie zapisuje.
//  5. Decyzja sprzed bootu zostawia znacznik, który domyka
//     `finalizePendingShellDecision()` (profil i rejestr RODO zalogowanego).
//
// Skrypt URUCHAMIAMY przez `new Function` na dokumencie happy-dom, a decyzję
// banera liczy PRAWDZIWY `consent.ts` (`applyShellDecision` = `setConsent`
// banera). Atrapy wyłącznie na granicach: klient Supabase i most rejestru.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const sb = vi.hoisted(() => ({
  userId: null as string | null,
  sessions: 0,
  registry: [] as unknown[][],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => {
        sb.sessions++;
        return { data: sb.userId ? { session: { user: { id: sb.userId } } } : { session: null } };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: async () => ({ data: [{ prefs: {} }], error: null }),
    from: () => ({ update: () => ({ eq: async () => ({ data: null, error: null }) }) }),
  },
}));

vi.mock("@/lib/consent/registryBridge", () => ({
  syncCmpDecisionToRegistry: async (...args: unknown[]) => {
    sb.registry.push(args);
  },
}));

import {
  CONSENT_DECIDED_ATTR,
  CONSENT_INIT_SCRIPT,
  CONSENT_INTENT_ATTR,
  CONSENT_SHELL_DECISION_EVENT,
  CONSENT_SHELL_INTENT_EVENT,
  isShellDecision,
  parseShellAction,
  startConsentTakeover,
  type ConsentShellAction,
  type ConsentTakeover,
} from "../consentInitScript";
import { __resetPostInteractionQueueForTests } from "@/lib/performance/postInteractionQueue";
import { __resetFirstInteractionForTests } from "@/lib/performance/firstInteraction";
import { __resetQuiescenceForTests } from "@/lib/performance/whenQuiescent";
import { __resetOverlayCoordinator, requestOverlaySlot } from "@/lib/overlayCoordinator";
import {
  SHELL_PENDING_KEY,
  applyShellDecision,
  finalizePendingShellDecision,
  hasConsentDecision,
  readConsentOverlayReport,
  shellDecisionCategories,
  useGpcSignal,
  type ConsentShellDecision,
} from "@/lib/ads/consent";
import { ga4ConsentUpdate } from "@/lib/analytics/ga4Client";
import { ANALYTICS_ANY_HOST_FLAG } from "@/lib/analytics/tagIds";

const STORAGE_KEY = "consent:v2";
const COOKIE_NAME = "nes_cookie_consent";

// ---------- przyrządy ----------

/** Surowe zapisy `document.cookie` (atrybuty też) - porównanie bajt w bajt. */
const cookieWrites: string[] = [];
let cookieJar = new Map<string, string>();
const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");

function installCookieSpy(): void {
  cookieWrites.length = 0;
  cookieJar = new Map();
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => [...cookieJar].map(([k, v]) => `${k}=${v}`).join("; "),
    set: (raw: string) => {
      cookieWrites.push(raw);
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      if (/max-age=0(?:;|$)/.test(raw)) cookieJar.delete(name);
      else cookieJar.set(name, value);
    },
  });
}

function setCookie(name: string, value: string): void {
  cookieJar.set(name, value);
}

/** Usuwa wszystkie nasłuchy `click` założone przez kolejne uruchomienia skryptu. */
const scriptListeners: EventListener[] = [];
const realAdd = document.addEventListener.bind(document);

function runScript(): void {
  const spy = vi.spyOn(document, "addEventListener").mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === "click" && typeof listener === "function") scriptListeners.push(listener);
    realAdd(type, listener, options);
  }) as typeof document.addEventListener);
  try {
    new Function(CONSENT_INIT_SCRIPT)();
  } finally {
    spy.mockRestore();
  }
}

function decidedAttr(): boolean {
  return document.documentElement.hasAttribute(CONSENT_DECIDED_ATTR);
}

/** Powłoka w DOM-ie z kontrolkami jak w `ConsentCompactCard`. */
function mountShell(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-consent-shell", "");
  root.innerHTML = [
    '<button type="button" data-consent-action="close"><svg aria-hidden="true"><path d="M1 1"/></svg></button>',
    '<button type="button" data-consent-action="reject">Tylko niezbędne</button>',
    '<button type="button" data-consent-action="accept">Akceptuj wszystkie</button>',
    '<button type="button" data-consent-action="customize">Dostosuj</button>',
    '<button type="button" data-consent-action="lang-en">EN</button>',
  ].join("");
  document.body.append(root);
  return root;
}

function clickAction(root: HTMLElement, action: ConsentShellAction, inner = false): void {
  const button = root.querySelector<HTMLElement>(`[data-consent-action="${action}"]`);
  if (!button) throw new Error(`brak kontrolki ${action}`);
  const target = inner ? (button.querySelector("path") ?? button) : button;
  target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function setGpcNavigator(value: unknown): void {
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value });
}

/** Rekord bez znacznika czasu (jedyna dopuszczalna różnica). */
function withoutTs(raw: string | null): unknown {
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object") return parsed;
  return { ...parsed, ts: "<ts>" };
}

/** Surowy zapis ciasteczka zgody bez znacznika czasu w wartości. */
function consentCookieWrite(): string | undefined {
  const write = cookieWrites.find((raw) => raw.startsWith(`${COOKIE_NAME}=`));
  return write?.replace(/%22ts%22%3A\d+/, "%22ts%22%3A<ts>");
}

function resetDocument(): void {
  for (const listener of scriptListeners.splice(0)) {
    document.removeEventListener("click", listener);
  }
  document.documentElement.removeAttribute(CONSENT_DECIDED_ATTR);
  document.documentElement.removeAttribute(CONSENT_INTENT_ATTR);
  document.body.innerHTML = "";
  window.localStorage.clear();
  window.sessionStorage.clear();
  Reflect.deleteProperty(navigator, "globalPrivacyControl");
  Reflect.deleteProperty(window, "gtag");
  Reflect.deleteProperty(window, ANALYTICS_ANY_HOST_FLAG);
}

beforeEach(() => {
  resetDocument();
  installCookieSpy();
  sb.userId = null;
  sb.sessions = 0;
  sb.registry.length = 0;
});

afterEach(() => {
  resetDocument();
  if (cookieDescriptor) Reflect.deleteProperty(document, "cookie");
  vi.restoreAllMocks();
});

// ---------- 1. decyzja przed pierwszym malowaniem ----------

const VALID = JSON.stringify({
  version: 2,
  ts: 1,
  categories: { necessary: true, functional: true, analytics: false, marketing: false },
  source: "local",
});

describe("html[data-consent-decided] przed pierwszym malowaniem", () => {
  it("brak czegokolwiek w przeglądarce = powłoka widoczna", () => {
    runScript();
    expect(decidedAttr()).toBe(false);
  });

  it("ważny rekord w localStorage ukrywa powłokę", () => {
    window.localStorage.setItem(STORAGE_KEY, VALID);
    runScript();
    expect(decidedAttr()).toBe(true);
  });

  it("samo ciasteczko (wyczyszczony magazyn) też jest decyzją", () => {
    setCookie(COOKIE_NAME, encodeURIComponent(VALID));
    runScript();
    expect(decidedAttr()).toBe(true);
  });

  it.each([
    ["zły JSON", "{nie-json"],
    ["zła wersja", JSON.stringify({ version: 1, categories: {} })],
    ["wersja jako napis", JSON.stringify({ version: "2", categories: {} })],
    ["null", "null"],
    ["tablica", "[2]"],
    ["pusty napis", ""],
  ])("%s w localStorage NIE jest decyzją", (_name, raw) => {
    window.localStorage.setItem(STORAGE_KEY, raw);
    runScript();
    expect(decidedAttr()).toBe(false);
  });

  it("uszkodzone %-kodowanie ciasteczka NIE wywraca skryptu i nie jest decyzją", () => {
    setCookie(COOKIE_NAME, "%E0%A4%A");
    runScript();
    expect(decidedAttr()).toBe(false);
  });

  it("stary klucz marketingowy (granted/denied) jest decyzją - `readLocal` go migruje", () => {
    window.localStorage.setItem("consent:marketing", "denied");
    runScript();
    expect(decidedAttr()).toBe(true);
    resetDocument();
    installCookieSpy();
    window.localStorage.setItem("consent:marketing", "maybe");
    runScript();
    expect(decidedAttr()).toBe(false);
  });

  it("zablokowany localStorage (SecurityError) spada na ciasteczko, bez wyjątku", () => {
    setCookie(COOKIE_NAME, encodeURIComponent(VALID));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => runScript()).not.toThrow();
    expect(decidedAttr()).toBe(true);
  });

  it("PARYTET z `readLocal`: atrybut = `hasConsentDecision()` dla całego korpusu stanów", () => {
    const corpus: Array<{ ls?: Record<string, string>; cookie?: string }> = [
      {},
      { ls: { [STORAGE_KEY]: VALID } },
      { ls: { [STORAGE_KEY]: "{" } },
      { ls: { [STORAGE_KEY]: JSON.stringify({ version: 3 }) } },
      { ls: { [STORAGE_KEY]: JSON.stringify({ version: 2 }) } },
      { cookie: encodeURIComponent(VALID) },
      { cookie: encodeURIComponent(JSON.stringify({ version: 1 })) },
      { cookie: "%ZZ" },
      { ls: { [STORAGE_KEY]: "{" }, cookie: encodeURIComponent(VALID) },
      { ls: { "consent:marketing": "granted" } },
      { ls: { "consent:marketing": "" } },
    ];
    for (const state of corpus) {
      resetDocument();
      installCookieSpy();
      for (const [k, v] of Object.entries(state.ls ?? {})) window.localStorage.setItem(k, v);
      if (state.cookie !== undefined) setCookie(COOKIE_NAME, state.cookie);
      runScript();
      expect(decidedAttr(), JSON.stringify(state)).toBe(hasConsentDecision());
    }
  });
});

// ---------- 2. zapis z kliknięcia = zapis banera ----------

/** Zapis banera dla tej samej akcji: prawdziwy `setConsent` (przez `applyShellDecision`). */
function bannerRecord(action: ConsentShellDecision): { ls: unknown; cookie: string | undefined } {
  resetDocument();
  installCookieSpy();
  applyShellDecision(action);
  return { ls: withoutTs(window.localStorage.getItem(STORAGE_KEY)), cookie: consentCookieWrite() };
}

/** Zapis powłoki przed bootem: nikt nie anuluje zdarzenia decyzji. */
function shellRecord(
  action: ConsentShellDecision,
  inner = false,
): { ls: unknown; cookie: string | undefined } {
  resetDocument();
  installCookieSpy();
  const root = mountShell();
  runScript();
  clickAction(root, action, inner);
  return { ls: withoutTs(window.localStorage.getItem(STORAGE_KEY)), cookie: consentCookieWrite() };
}

describe("klik w powłoce przed bootem zapisuje rekord bajt w bajt jak baner", () => {
  it.each<ConsentShellDecision>(["accept", "reject", "close"])("%s", (action) => {
    const shell = shellRecord(action);
    const banner = bannerRecord(action);
    expect(shell.ls).not.toBeNull();
    expect(shell.ls).toEqual(banner.ls);
    expect(shell.cookie).toBeDefined();
    expect(shell.cookie).toBe(banner.cookie);
  });

  it("klik w ikonę wewnątrz przycisku (SVG) też jest decyzją", () => {
    expect(shellRecord("close", true).ls).toEqual(bannerRecord("close").ls);
  });

  it("kolejność kluczy JSON jest identyczna (porównanie napisów, nie obiektów)", () => {
    const root = mountShell();
    runScript();
    clickAction(root, "accept");
    const shellRaw = window.localStorage.getItem(STORAGE_KEY) ?? "";
    resetDocument();
    installCookieSpy();
    applyShellDecision("accept");
    const bannerRaw = window.localStorage.getItem(STORAGE_KEY) ?? "";
    expect(shellRaw.replace(/"ts":\d+/, '"ts":0')).toBe(bannerRaw.replace(/"ts":\d+/, '"ts":0'));
  });

  it("akceptacja: wszystkie kategorie, `source: local`, bez `gpcOverrideAt`", () => {
    expect(shellRecord("accept").ls).toEqual({
      version: 2,
      ts: "<ts>",
      categories: { necessary: true, functional: true, analytics: true, marketing: true },
      source: "local",
    });
  });

  it.each([
    ["navigator.globalPrivacyControl === true", () => setGpcNavigator(true)],
    ["navigator.globalPrivacyControl === '1'", () => setGpcNavigator(" 1 ")],
    ["ciasteczko nes_gpc=1", () => setCookie("nes_gpc", "1")],
  ])("GPC (%s): akceptacja NIE włącza kategorii klamrowanych - jak baner", (_name, arm) => {
    resetDocument();
    installCookieSpy();
    arm();
    const root = mountShell();
    runScript();
    clickAction(root, "accept");
    const shell = withoutTs(window.localStorage.getItem(STORAGE_KEY));
    const shellCookie = consentCookieWrite();
    expect(shell).toEqual({
      version: 2,
      ts: "<ts>",
      categories: { necessary: true, functional: true, analytics: false, marketing: false },
      source: "local",
    });
    // Ta sama decyzja drogą aplikacji (sygnał nadal aktywny).
    window.localStorage.clear();
    cookieWrites.length = 0;
    applyShellDecision("accept");
    expect(withoutTs(window.localStorage.getItem(STORAGE_KEY))).toEqual(shell);
    expect(consentCookieWrite()).toBe(shellCookie);
  });

  it("GPC: ciasteczko z inną wartością NIE jest sygnałem (kontrola negatywna)", () => {
    setCookie("nes_gpc", "0");
    setGpcNavigator(false);
    const root = mountShell();
    runScript();
    clickAction(root, "accept");
    expect(withoutTs(window.localStorage.getItem(STORAGE_KEY))).toMatchObject({
      categories: { analytics: true, marketing: true },
    });
  });

  it("`shellDecisionCategories` = klamra GPC na pełnej zgodzie, odmowa zawsze pusta", () => {
    expect(shellDecisionCategories("accept", false)).toEqual({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    });
    expect(shellDecisionCategories("accept", true)).toEqual({
      necessary: true,
      functional: true,
      analytics: false,
      marketing: false,
    });
    for (const action of ["reject", "close"] as const) {
      expect(shellDecisionCategories(action, false)).toEqual({
        necessary: true,
        functional: false,
        analytics: false,
        marketing: false,
      });
    }
  });

  it("decyzja ukrywa powłokę od razu, rozgłasza `consent-change` i zostawia znacznik domknięcia", () => {
    const root = mountShell();
    runScript();
    const changes = vi.fn();
    window.addEventListener("consent-change", changes);
    clickAction(root, "reject");
    window.removeEventListener("consent-change", changes);
    expect(decidedAttr()).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(SHELL_PENDING_KEY)).toBe("1");
  });

  it("nawigacja MPA przed bootem: kolejna strona z tym rekordem nie pokazuje powłoki", () => {
    const root = mountShell();
    runScript();
    clickAction(root, "accept");
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const cookie = cookieJar.get(COOKIE_NAME);
    // „Nowy dokument”: czysty `<html>`, te same magazyny przeglądarki.
    for (const listener of scriptListeners.splice(0)) {
      document.removeEventListener("click", listener);
    }
    document.documentElement.removeAttribute(CONSENT_DECIDED_ATTR);
    expect(stored).not.toBeNull();
    runScript();
    expect(decidedAttr()).toBe(true);
    // Także gdy przetrwało wyłącznie ciasteczko.
    document.documentElement.removeAttribute(CONSENT_DECIDED_ATTR);
    window.localStorage.clear();
    cookieJar.set(COOKIE_NAME, cookie ?? "");
    runScript();
    expect(decidedAttr()).toBe(true);
  });

  it("klik poza powłoką (ten sam atrybut akcji, np. w banerze) NIE zapisuje niczego", () => {
    runScript();
    const outside = document.createElement("button");
    outside.setAttribute("data-consent-action", "accept");
    document.body.append(outside);
    outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(decidedAttr()).toBe(false);
  });
});

// ---------- 3. Consent Mode ----------

describe("Consent Mode z powłoki = `ga4ConsentUpdate`", () => {
  it.each<[ConsentShellDecision, boolean]>([
    ["accept", false],
    ["accept", true],
    ["reject", false],
    ["close", true],
  ])("%s (GPC: %s)", (action, gpc) => {
    const shellCalls: unknown[][] = [];
    Reflect.set(window, "gtag", (...args: unknown[]) => shellCalls.push(args));
    if (gpc) setGpcNavigator(true);
    const root = mountShell();
    runScript();
    clickAction(root, action);

    const bannerCalls: unknown[][] = [];
    Reflect.set(window, "gtag", (...args: unknown[]) => bannerCalls.push(args));
    Reflect.set(window, ANALYTICS_ANY_HOST_FLAG, true);
    ga4ConsentUpdate(shellDecisionCategories(action, gpc));

    expect(shellCalls).toHaveLength(1);
    expect(JSON.stringify(shellCalls)).toBe(JSON.stringify(bannerCalls));
  });

  it("bez `window.gtag` (snippet nie przeszedł bramki hosta) nie pcha nic i nie rzuca", () => {
    const root = mountShell();
    runScript();
    expect(() => clickAction(root, "accept")).not.toThrow();
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});

// ---------- 4. po boocie i intencje ----------

describe("po boocie decyzję zapisuje aplikacja, intencja nic nie zapisuje", () => {
  it("anulowane zdarzenie decyzji = skrypt NIE zapisuje drugi raz", () => {
    const root = mountShell();
    runScript();
    const handled = vi.fn((event: Event) => {
      const action = event instanceof CustomEvent ? parseShellAction(String(event.detail)) : null;
      if (action && isShellDecision(action)) {
        applyShellDecision(action);
        event.preventDefault();
      }
    });
    window.addEventListener(CONSENT_SHELL_DECISION_EVENT, handled);
    clickAction(root, "accept");
    window.removeEventListener(CONSENT_SHELL_DECISION_EVENT, handled);
    expect(handled).toHaveBeenCalledTimes(1);
    expect(cookieWrites.filter((raw) => raw.startsWith(`${COOKIE_NAME}=`))).toHaveLength(1);
    // Ścieżka aplikacji nie zostawia znacznika domknięcia - skutki uboczne zrobił `setConsent`.
    expect(window.localStorage.getItem(SHELL_PENDING_KEY)).toBeNull();
    expect(decidedAttr()).toBe(true);
  });

  it("„Dostosuj” to intencja: atrybut + zdarzenie, bez rekordu i bez ukrycia powłoki", () => {
    const root = mountShell();
    runScript();
    const intents: unknown[] = [];
    const onIntent = (event: Event) => {
      if (event instanceof CustomEvent) intents.push(event.detail);
    };
    window.addEventListener(CONSENT_SHELL_INTENT_EVENT, onIntent);
    clickAction(root, "customize");
    clickAction(root, "lang-en");
    window.removeEventListener(CONSENT_SHELL_INTENT_EVENT, onIntent);
    expect(intents).toEqual(["customize", "lang-en"]);
    expect(document.documentElement.getAttribute(CONSENT_INTENT_ATTR)).toBe("lang-en");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(decidedAttr()).toBe(false);
  });

  it("`parseShellAction` zna wyłącznie akcje karty", () => {
    expect(parseShellAction("customize")).toBe("customize");
    expect(parseShellAction("lang-pl")).toBe("lang-pl");
    expect(parseShellAction("accept ")).toBeNull();
    expect(parseShellAction(null)).toBeNull();
    expect(isShellDecision("close")).toBe(true);
    expect(isShellDecision("customize")).toBe(false);
  });
});

// ---------- 5. domknięcie decyzji sprzed bootu ----------

describe("finalizePendingShellDecision", () => {
  it("bez znacznika - no-op (żadnego odczytu sesji ani rejestru)", async () => {
    finalizePendingShellDecision();
    await Promise.resolve();
    expect(sb.sessions).toBe(0);
    expect(sb.registry).toEqual([]);
  });

  it("ze znacznikiem: profil i rejestr RODO jak `setConsent` (poprzedni stan = null), znacznik zdjęty", async () => {
    sb.userId = "user-1";
    const root = mountShell();
    runScript();
    clickAction(root, "reject");
    expect(window.localStorage.getItem(SHELL_PENDING_KEY)).toBe("1");

    finalizePendingShellDecision();
    expect(window.localStorage.getItem(SHELL_PENDING_KEY)).toBeNull();
    await vi.waitFor(() => expect(sb.registry).toHaveLength(1));
    const [prev, next, source, gpcActive] = sb.registry[0];
    expect(prev).toBeNull();
    expect(next).toMatchObject({
      version: 2,
      categories: { necessary: true, functional: false, analytics: false, marketing: false },
      source: "local",
    });
    expect(source).toBe("cmp_banner");
    expect(gpcActive).toBe(false);
    expect(sb.sessions).toBeGreaterThan(0);

    // Drugi boot: znacznika już nie ma, nic się nie powtarza.
    finalizePendingShellDecision();
    await Promise.resolve();
    expect(sb.registry).toHaveLength(1);
  });
});

// ---------- 6. stan dla koordynatora i sygnał GPC przy przejęciu ----------

describe("readConsentOverlayReport i useGpcSignal(eager)", () => {
  it("brak decyzji = brama zamknięta (`decided: false`, marketing `null`)", () => {
    expect(readConsentOverlayReport()).toEqual({ decided: false, marketing: null });
  });

  it("decyzja z marketingiem, GPC nieaktywny = marketing `true`; przy GPC = `false`", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        ts: 1,
        categories: { necessary: true, functional: true, analytics: true, marketing: true },
      }),
    );
    expect(readConsentOverlayReport()).toEqual({ decided: true, marketing: true });
    setGpcNavigator(true);
    expect(readConsentOverlayReport()).toEqual({ decided: true, marketing: false });
  });

  it("bez `eager` pierwszy render nie zna sygnału (parytet SSR), z `eager` - zna od razu", () => {
    setGpcNavigator(true);
    const lazy: boolean[] = [];
    renderHook(() => {
      const signal = useGpcSignal();
      lazy.push(signal.active);
      return signal;
    });
    const eager: boolean[] = [];
    renderHook(() => {
      const signal = useGpcSignal(true);
      eager.push(signal.active);
      return signal;
    });
    expect(lazy[0]).toBe(false);
    expect(lazy.at(-1)).toBe(true);
    expect(eager[0]).toBe(true);
  });
});

// ---------- 7. partner skryptu po boocie ----------

describe("startConsentTakeover (partner skryptu po boocie)", () => {
  let stop: () => void = () => {};
  const mounts: ConsentTakeover[] = [];
  const host = (slot: Element | null = null) => ({
    slot,
    mount: async (takeover: ConsentTakeover) => {
      mounts.push(takeover);
    },
  });

  beforeEach(() => {
    mounts.length = 0;
    __resetPostInteractionQueueForTests();
    __resetFirstInteractionForTests();
    __resetQuiescenceForTests();
    __resetOverlayCoordinator();
  });
  afterEach(() => {
    stop();
    stop = () => {};
    __resetPostInteractionQueueForTests();
    __resetFirstInteractionForTests();
    __resetQuiescenceForTests();
    __resetOverlayCoordinator();
  });

  it("bez interakcji nie montuje banera; intencja z powłoki montuje go od razu, raz", async () => {
    const root = mountShell();
    runScript();
    stop = startConsentTakeover(host(root));
    await vi.waitFor(() => Promise.resolve());
    expect(mounts).toEqual([]);
    root.querySelector<HTMLElement>('[data-consent-action="customize"]')?.focus();
    clickAction(root, "customize");
    clickAction(root, "lang-en");
    await vi.waitFor(() => expect(mounts).toHaveLength(1));
    expect(mounts[0]).toEqual({ intent: "lang-en", focus: "customize" });
  });

  it("decyzja PO starcie: droga banera (bez znacznika domknięcia); po `stop` - znów skrypt", () => {
    const root = mountShell();
    runScript();
    stop = startConsentTakeover(host(root));
    clickAction(root, "reject");
    expect(window.localStorage.getItem(SHELL_PENDING_KEY)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    stop();
    stop = () => {};
    window.localStorage.clear();
    document.documentElement.removeAttribute(CONSENT_DECIDED_ATTR);
    clickAction(root, "accept");
    expect(window.localStorage.getItem(SHELL_PENDING_KEY)).toBe("1");
  });

  it("start domyka decyzję sprzed bootu i odtwarza intencję czekającą na `<html>`", async () => {
    window.localStorage.setItem(SHELL_PENDING_KEY, "1");
    window.localStorage.setItem(STORAGE_KEY, VALID);
    document.documentElement.setAttribute(CONSENT_INTENT_ATTR, "customize");
    stop = startConsentTakeover(host());
    expect(window.localStorage.getItem(SHELL_PENDING_KEY)).toBeNull();
    await vi.waitFor(() => expect(mounts).toHaveLength(1));
    expect(mounts[0].intent).toBe("customize");
    expect(document.documentElement.hasAttribute(CONSENT_INTENT_ATTR)).toBe(false);
  });

  it("zgłasza stan powłoki koordynatorowi: bez decyzji brama zamknięta, decyzja ją otwiera", async () => {
    const root = mountShell();
    runScript();
    stop = startConsentTakeover(host(root));
    const granted = vi.fn();
    void requestOverlaySlot("dialog", { marketing: false }).then(granted);
    await Promise.resolve();
    expect(granted).not.toHaveBeenCalled();
    clickAction(root, "accept");
    await vi.waitFor(() => expect(granted).toHaveBeenCalledTimes(1));
    expect(decidedAttr()).toBe(true);
  });
});
