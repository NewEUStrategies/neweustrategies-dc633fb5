// Skrypt inicjalizacji zgód (P1.3) - sprawdzany WYKONANIEM, nie porównaniem tekstu.
//
// CO TO DOWODZI (warunki zgody właściciela na powłokę banera, ORCHESTRATOR-NOTES):
//  1. ODWIEDZAJĄCY Z DECYZJĄ NIGDY NIE WIDZI POWŁOKI: skrypt ustawia
//     `html[data-consent-decided]` DOKŁADNIE wtedy, gdy `readLocal()` widzi
//     decyzję (`hasConsentDecision()`), także dla zepsutego JSON-u, złej wersji,
//     samego ciasteczka, uszkodzonego %-kodowania, zablokowanego magazynu
//     i starego klucza marketingowego.
//  2. REKORD Z POWŁOKI = REKORD Z BANERA bajt w bajt poza znacznikiem czasu:
//     ten sam napis JSON w `localStorage` (kolejność kluczy), ten sam surowy
//     zapis ciasteczka, te same kategorie. Referencją jest PRAWDZIWA droga
//     banera - wyrenderowany `ConsentBanner` z prawdziwym `useConsent`
//     i kliknięcie jego `[data-consent-action]` (`acceptAll`/`rejectAll` ->
//     `save` -> `setConsent`) - a nie funkcja tej pozycji. Przy GPC
//     referencją jest „Zapisz wybrane" banera ze szkicem zaklamrowanym;
//     różnica wobec `acceptAll` przy GPC (override z notą) jest przypięta
//     jawnie jako świadoma.
//  3. TEN SAM CONSENT MODE co `ga4ConsentUpdate` (pola, kolejność, wartości).
//  4. PO BOOCIE decyzję zapisuje aplikacja (zdarzenie anulowalne), skrypt nie
//     dubluje zapisu; intencja (`customize`) niczego nie zapisuje.
//  5. Decyzja sprzed bootu zostawia znacznik, który domyka
//     `finalizePendingShellDecision()` (profil i rejestr RODO zalogowanego).
//  6. Powłoka widoczna WYŁĄCZNIE z działającym skryptem (`data-consent-js`),
//     po domknięciu w parserze (`data-consent-parsed` ze skryptu odsłonięcia
//     za kartą, P1.3b), bez decyzji i bez GPC (`data-consent-gpc`, odczyt =
//     `readGpcSignal`).
//  7. Partner po boocie montuje baner we właściwym momencie: przy ukrytej
//     powłoce bez decyzji (GPC, brak skryptu, brak odsłonięcia) od razu, przy
//     decyzji - bez wpisu w pierwszym zadaniu po interakcji, przy zasiewie
//     ustawień - po refetchu.
//
// Skrypt URUCHAMIAMY przez `new Function` na dokumencie happy-dom, a decyzję
// banera liczy PRAWDZIWY `consent.ts` i PRAWDZIWY `ConsentBanner`. Atrapy
// wyłącznie na granicach: klient Supabase, most rejestru, ustawienia witryny
// (wartości domyślne), motyw i punkt ciszy P0.3 (rejestrator - punkt ciszy
// wymaga `load` + 5 s, a test sprawdza tylko klasę i skutek zapisu).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";

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

// Ustawienia witryny dla PRAWDZIWEGO banera: wartości domyślne (baner włączony,
// domyślne teksty), jak w `ConsentBanner.test.tsx`. Reszta modułu - prawdziwa
// (partner skryptu czyta klucz zapytania `site_settings`).
vi.mock("@/lib/useSiteSetting", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/useSiteSetting")>("@/lib/useSiteSetting");
  return {
    ...actual,
    useSiteSetting: <T extends object>(key: string, defaults: T): T =>
      key === "privacy" ? { ...defaults, cookie_banner: true } : defaults,
  };
});
vi.mock("@/components/ThemeProvider", () => ({ useTheme: () => ({ theme: "light" }) }));

// Punkt ciszy P0.3 jako rejestrator: klasa zapisu i ręczne „nadejście” ciszy.
const quiet = vi.hoisted(() => ({
  entries: [] as Array<{ task: () => unknown; priority: string; cancelled: boolean }>,
}));
vi.mock("@/lib/performance/whenQuiescent", () => ({
  onQuiescent: (task: () => unknown, options: { priority: string }) => {
    const entry = { task, priority: options.priority, cancelled: false };
    quiet.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  },
  __resetQuiescenceForTests: () => {
    quiet.entries.length = 0;
  },
}));

import {
  CONSENT_DECIDED_ATTR,
  CONSENT_GPC_ATTR,
  CONSENT_INIT_SCRIPT,
  CONSENT_INTENT_ATTR,
  CONSENT_JS_ATTR,
  CONSENT_PARSED_ATTR,
  CONSENT_SHELL_DECISION_EVENT,
  CONSENT_SHELL_INTENT_EVENT,
  CONSENT_SHELL_REVEAL_SCRIPT,
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
import { readGpcSignal } from "@/lib/consent/gpcClient";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import i18n from "@/lib/i18n";
import { ConsentBanner } from "@/components/ConsentBanner";
import { COOKIE_BANNER_DEFAULTS } from "@/lib/cookieBanner/config";

const PL = COOKIE_BANNER_DEFAULTS.copy.pl;

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

/**
 * Powłoka w DOM-ie z kontrolkami jak w `ConsentCompactCard`. Domyślnie parser
 * „mija gniazdo" - wykonuje skrypt odsłonięcia stojący za kartą (P1.3b);
 * `revealed: false` = skrypt odsłonięcia się nie wykonał.
 */
function mountShell({ revealed = true }: { revealed?: boolean } = {}): HTMLElement {
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
  if (revealed) new Function(CONSENT_SHELL_REVEAL_SCRIPT)();
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
  cleanup();
  for (const listener of scriptListeners.splice(0)) {
    document.removeEventListener("click", listener);
  }
  document.documentElement.removeAttribute(CONSENT_DECIDED_ATTR);
  document.documentElement.removeAttribute(CONSENT_INTENT_ATTR);
  document.documentElement.removeAttribute(CONSENT_GPC_ATTR);
  document.documentElement.removeAttribute(CONSENT_JS_ATTR);
  document.documentElement.removeAttribute(CONSENT_PARSED_ATTR);
  document.body.innerHTML = "";
  window.localStorage.clear();
  window.sessionStorage.clear();
  Reflect.deleteProperty(navigator, "globalPrivacyControl");
  Reflect.deleteProperty(window, "gtag");
  Reflect.deleteProperty(window, ANALYTICS_ANY_HOST_FLAG);
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
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

describe("widoczność powłoki: działający skrypt i sygnał GPC", () => {
  const html = () => document.documentElement;

  it("skrypt, który zadziałał, odsłania powłokę (`data-consent-js`); bez skryptu - brak atrybutu", () => {
    expect(html().hasAttribute(CONSENT_JS_ATTR)).toBe(false);
    runScript();
    expect(html().hasAttribute(CONSENT_JS_ATTR)).toBe(true);
  });

  it("wyjątek przed założeniem nasłuchu kliknięć zostawia powłokę ukrytą", () => {
    const spy = vi.spyOn(document, "addEventListener").mockImplementation(() => {
      throw new Error("brak nasłuchu");
    });
    try {
      expect(() => new Function(CONSENT_INIT_SCRIPT)()).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(html().hasAttribute(CONSENT_JS_ATTR)).toBe(false);
  });

  it("skrypt odsłonięcia (P1.3b) ustawia `data-consent-parsed` i nic poza tym", () => {
    expect(html().hasAttribute(CONSENT_PARSED_ATTR)).toBe(false);
    const before = [...html().attributes].map((a) => a.name);
    new Function(CONSENT_SHELL_REVEAL_SCRIPT)();
    expect(html().getAttribute(CONSENT_PARSED_ATTR)).toBe("");
    expect([...html().attributes].map((a) => a.name)).toEqual([...before, CONSENT_PARSED_ATTR]);
    // Drugie wykonanie (np. ten sam węzeł przepisany przez `innerHTML`) - bez wyjątku i zmian.
    expect(() => new Function(CONSENT_SHELL_REVEAL_SCRIPT)()).not.toThrow();
    expect(html().getAttribute(CONSENT_PARSED_ATTR)).toBe("");
  });

  it("skrypt odsłonięcia to statyczny literał bez znaków domykających `<script>` (bajty HTML-a każdej strony)", () => {
    expect(CONSENT_PARSED_ATTR).toBe("data-consent-parsed");
    expect(CONSENT_SHELL_REVEAL_SCRIPT).toBe(
      "document.documentElement.setAttribute('data-consent-parsed','')",
    );
    expect(CONSENT_SHELL_REVEAL_SCRIPT).not.toMatch(/[<>]/);
  });

  it("PARYTET z `readGpcSignal`: `data-consent-gpc` dokładnie przy aktywnym sygnale", () => {
    const corpus: Array<{ nav?: unknown; cookies?: Record<string, string> }> = [
      {},
      { nav: true },
      { nav: false },
      { nav: "1" },
      { nav: " 1 " },
      { nav: "0" },
      { nav: "true" },
      { nav: 1 },
      { cookies: { nes_gpc: "1" } },
      { cookies: { nes_gpc: "%31" } },
      { cookies: { nes_gpc: "%201%20" } },
      { cookies: { nes_gpc: "0" } },
      { cookies: { nes_gpc: "" } },
      { cookies: { x_nes_gpc: "1" } },
      { cookies: { other: "1", nes_gpc: "1" } },
      { nav: false, cookies: { nes_gpc: "1" } },
    ];
    for (const state of corpus) {
      resetDocument();
      installCookieSpy();
      if ("nav" in state) setGpcNavigator(state.nav);
      for (const [k, v] of Object.entries(state.cookies ?? {})) setCookie(k, v);
      runScript();
      expect(html().hasAttribute(CONSENT_GPC_ATTR), JSON.stringify(state)).toBe(
        readGpcSignal().active,
      );
    }
  });

  it("uszkodzone %-kodowanie ciasteczka GPC nie wywraca skryptu (brak sygnału z tej części)", () => {
    setCookie("nes_gpc", "%E0%A4%A");
    expect(() => runScript()).not.toThrow();
    expect(html().hasAttribute(CONSENT_GPC_ATTR)).toBe(false);
    expect(html().hasAttribute(CONSENT_JS_ATTR)).toBe(true);
  });
});

// ---------- 2. zapis z kliknięcia = zapis banera ----------

interface Written {
  /** Napis z `localStorage` ze znormalizowanym znacznikiem czasu - kolejność kluczy też się liczy. */
  raw: string | null;
  /** Ten sam rekord sparsowany (czytelny diff przy porażce). */
  ls: unknown;
  /** Surowy zapis `document.cookie` (z atrybutami), znacznik czasu znormalizowany. */
  cookie: string | undefined;
}

function written(): Written {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return {
    raw: raw === null ? null : raw.replace(/"ts":\d+/, '"ts":0'),
    ls: withoutTs(raw),
    cookie: consentCookieWrite(),
  };
}

/** Kontrolka wyrenderowanego banera o danej akcji (ta sama, którą powłoka ma pod tym atrybutem). */
function bannerControl(action: ConsentShellAction): HTMLElement {
  const control = document.querySelector<HTMLElement>(
    `[role="dialog"] [data-consent-action="${action}"]`,
  );
  if (!control) throw new Error(`brak kontrolki banera ${action}`);
  return control;
}

/**
 * Zapis PRAWDZIWEGO banera dla tej samej akcji: `ConsentBanner` z prawdziwym
 * `useConsent`, klik w jego kontrolkę (`onAccept`/`onReject`/`onClose` ->
 * `acceptAll()`/`rejectAll()` -> `save` -> `setConsent(…, "cmp_banner")`).
 * `arm` - przygotowanie świata (np. sygnał GPC) po wyczyszczeniu.
 */
function bannerRecord(action: ConsentShellDecision, arm: () => void = () => {}): Written {
  resetDocument();
  installCookieSpy();
  arm();
  render(createElement(ConsentBanner));
  fireEvent.click(bannerControl(action));
  const result = written();
  cleanup();
  return result;
}

/**
 * „Zapisz wybrane" PRAWDZIWEGO banera ze szkicem zaklamrowanym przez GPC: panel
 * „Dostosuj", włączona kategoria funkcjonalna, klamrowane zostają wyłączone
 * (tak je pokazuje baner przy honorowanym sygnale) - `save(draft)`.
 */
function bannerClampedSaveRecord(arm: () => void): Written {
  resetDocument();
  installCookieSpy();
  arm();
  render(createElement(ConsentBanner));
  fireEvent.click(bannerControl("customize"));
  expect(screen.getByRole("checkbox", { name: PL.categoryAnalytics })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  fireEvent.click(screen.getByRole("checkbox", { name: PL.categoryFunctional }));
  fireEvent.click(screen.getByRole("button", { name: PL.saveSelection }));
  const result = written();
  cleanup();
  return result;
}

/** Zapis powłoki przed bootem: nikt nie anuluje zdarzenia decyzji. */
function shellRecord(
  action: ConsentShellDecision,
  { inner = false, arm = () => {} }: { inner?: boolean; arm?: () => void } = {},
): Written {
  resetDocument();
  installCookieSpy();
  arm();
  const root = mountShell();
  runScript();
  clickAction(root, action, inner);
  return written();
}

/** Decyzja z powłoki PO boocie: partner skryptu woła `applyShellDecision`. */
function afterBootRecord(action: ConsentShellDecision, arm: () => void = () => {}): Written {
  resetDocument();
  installCookieSpy();
  arm();
  applyShellDecision(action);
  return written();
}

const GPC_ARMS: Array<[string, () => void]> = [
  ["navigator.globalPrivacyControl === true", () => setGpcNavigator(true)],
  ["navigator.globalPrivacyControl === ' 1 '", () => setGpcNavigator(" 1 ")],
  ["ciasteczko nes_gpc=1", () => setCookie("nes_gpc", "1")],
];

describe("klik w powłoce zapisuje rekord bajt w bajt jak PRAWDZIWY baner", () => {
  it.each<ConsentShellDecision>(["accept", "reject", "close"])("%s (przed bootem)", (action) => {
    const shell = shellRecord(action);
    const banner = bannerRecord(action);
    expect(shell.raw).not.toBeNull();
    expect(shell.ls).toEqual(banner.ls);
    // Porównanie NAPISÓW: ta sama kolejność kluczy JSON i ten sam zapis ciasteczka.
    expect(shell.raw).toBe(banner.raw);
    expect(shell.cookie).toBeDefined();
    expect(shell.cookie).toBe(banner.cookie);
  });

  it.each<ConsentShellDecision>(["accept", "reject", "close"])("%s (po boocie)", (action) => {
    const banner = bannerRecord(action);
    const afterBoot = afterBootRecord(action);
    expect(afterBoot.raw).toBe(banner.raw);
    expect(afterBoot.cookie).toBe(banner.cookie);
  });

  it("klik w ikonę wewnątrz przycisku (SVG) też jest decyzją", () => {
    expect(shellRecord("close", { inner: true }).raw).toBe(bannerRecord("close").raw);
  });

  it("kontrola negatywna: inna decyzja banera daje inny napis", () => {
    expect(shellRecord("accept").raw).not.toBe(bannerRecord("reject").raw);
  });

  it("akceptacja: wszystkie kategorie, `source: local`, bez `gpcOverrideAt`", () => {
    expect(shellRecord("accept").ls).toEqual({
      version: 2,
      ts: "<ts>",
      categories: { necessary: true, functional: true, analytics: true, marketing: true },
      source: "local",
    });
  });

  it.each(GPC_ARMS)(
    "GPC (%s): akceptacja = „Zapisz wybrane” banera ze szkicem zaklamrowanym",
    (_name, arm) => {
      const shell = shellRecord("accept", { arm });
      expect(shell.ls).toEqual({
        version: 2,
        ts: "<ts>",
        categories: { necessary: true, functional: true, analytics: false, marketing: false },
        source: "local",
      });
      const saved = bannerClampedSaveRecord(arm);
      expect(shell.raw).toBe(saved.raw);
      expect(shell.cookie).toBe(saved.cookie);
      // Ta sama decyzja drogą aplikacji po boocie (sygnał nadal aktywny).
      const afterBoot = afterBootRecord("accept", arm);
      expect(afterBoot.raw).toBe(saved.raw);
      expect(afterBoot.cookie).toBe(saved.cookie);
    },
  );

  it.each(GPC_ARMS)(
    "GPC (%s): ŚWIADOMA RÓŻNICA - `acceptAll` banera to override z notą, powłoka go nie robi",
    (_name, arm) => {
      const acceptAll = bannerRecord("accept", arm);
      expect(acceptAll.ls).toMatchObject({
        categories: { analytics: true, marketing: true },
        gpcOverrideAt: expect.any(Number),
      });
      const shell = shellRecord("accept", { arm });
      expect(shell.ls).not.toHaveProperty("gpcOverrideAt");
      expect(shell.raw).not.toBe(acceptAll.raw);
    },
  );

  it.each(GPC_ARMS)("GPC (%s): odmowa i „X” = `rejectAll` banera bajt w bajt", (_name, arm) => {
    for (const action of ["reject", "close"] as const) {
      const banner = bannerRecord(action, arm);
      const shell = shellRecord(action, { arm });
      expect(shell.raw, action).toBe(banner.raw);
      expect(shell.cookie, action).toBe(banner.cookie);
      expect(afterBootRecord(action, arm).raw, action).toBe(banner.raw);
    }
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

// ---------- 4b. tekst skryptu poza bundlem klienta ----------

describe("tekst skryptu powstaje w czystym wywołaniu (poza bundlem klienta)", () => {
  // W przeglądarce stałej nikt nie czyta (serwer bierze ją z gałęzi `.server()`
  // korzenia), ale szablon z interpolacjami importów Rollup traktuje jak
  // wyrażenie z efektami: bez czystego wywołania martwy szablon trzymał
  // fragmenty `consent.ts` w chunku wejściowym (dowód P1.3, §2.2). Pilnujemy
  // kształtu źródła, który pozwala Rollupowi go wyciąć.
  const source = readFileSync(resolve(__dirname, "../consentInitScript.ts"), "utf8");
  const builderStart = source.indexOf("function buildConsentInitScript(");
  const builderEnd = source.indexOf("\n}\n", builderStart);

  it("stała = wywołanie z adnotacją `@__PURE__`", () => {
    expect(builderStart).toBeGreaterThan(0);
    expect(source).toMatch(
      /export const CONSENT_INIT_SCRIPT = \/\* @__PURE__ \*\/ buildConsentInitScript\(\);/,
    );
  });

  it("fragmenty `consent.ts` czyta WYŁĄCZNIE funkcja budująca (poza importem)", () => {
    const outside =
      source.slice(0, builderStart).replace(/^import[\s\S]*?from "@\/lib\/ads\/consent";$/m, "") +
      source.slice(builderEnd);
    expect(outside).not.toMatch(/\$\{CONSENT_(?:READ|DECIDED|WRITE)_JS\}/);
    expect(source.slice(builderStart, builderEnd)).toMatch(/\$\{CONSENT_READ_JS\}/);
  });

  it("wynik wywołania jest stałym napisem (ten sam przy każdym imporcie)", () => {
    expect(typeof CONSENT_INIT_SCRIPT).toBe("string");
    expect(CONSENT_INIT_SCRIPT.startsWith("(function(){try{")).toBe(true);
    expect(CONSENT_INIT_SCRIPT.endsWith("}catch(e){}})();")).toBe(true);
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
  /** Kilka klatek kolejki P0.3 (rAF + zadanie) - dość, by wpis `immediate` się wykonał. */
  const frames = () => new Promise((resolve) => setTimeout(resolve, 80));
  /** Pełne dotknięcie: kolejka rusza na `pointerdown`, strażnik gestu puszcza po `click`. */
  const tap = (target: Element) => {
    fireEvent.pointerDown(target);
    fireEvent.pointerUp(target);
    fireEvent.click(target);
  };
  const quietPriorities = () => quiet.entries.filter((e) => !e.cancelled).map((e) => e.priority);

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
  it("brak decyzji, powłoka widoczna: montaż po pierwszej interakcji (klasa `shell`), cisza w klasie `shell`", async () => {
    const root = mountShell();
    runScript();
    stop = startConsentTakeover(host(root));
    expect(quietPriorities()).toEqual(["shell"]);
    await frames();
    expect(mounts).toEqual([]);
    tap(root);
    await vi.waitFor(() => expect(mounts).toHaveLength(1));
  });

  it("zapisana decyzja (D6): pierwsza interakcja NIE montuje banera; montaż w punkcie ciszy, klasa `overlays`", async () => {
    window.localStorage.setItem(STORAGE_KEY, VALID);
    const root = mountShell();
    runScript();
    stop = startConsentTakeover(host(root));
    expect(quietPriorities()).toEqual(["overlays"]);
    tap(document.body);
    await frames();
    expect(mounts).toEqual([]);
    await act(async () => {
      await quiet.entries[0].task();
    });
    expect(mounts).toHaveLength(1);
  });

  it("decyzja wycofana po starcie: powłoka wraca, a z nią wpis `shell` (montaż przy interakcji)", async () => {
    window.localStorage.setItem(STORAGE_KEY, VALID);
    const root = mountShell();
    runScript();
    stop = startConsentTakeover(host(root));
    tap(document.body);
    await frames();
    expect(mounts).toEqual([]);
    window.localStorage.clear();
    window.dispatchEvent(new Event("consent-change"));
    expect(decidedAttr()).toBe(false);
    // Przeglądarka z lepką aktywacją (`navigator.userActivation`) zwolniłaby
    // wpis od razu; happy-dom jej nie ma, więc zwalnia go kolejne dotknięcie.
    await frames();
    tap(root);
    await vi.waitFor(() => expect(mounts).toHaveLength(1));
  });

  it("GPC (D3): powłoka ukryta, baner z notą montuje się od razu po starcie, bez interakcji", async () => {
    setGpcNavigator(true);
    const root = mountShell();
    runScript();
    expect(document.documentElement.hasAttribute(CONSENT_GPC_ATTR)).toBe(true);
    stop = startConsentTakeover(host(root));
    await vi.waitFor(() => expect(mounts).toHaveLength(1));
  });

  it("GPC przy zapisanej decyzji: nic od razu (baner i tak nie ma czego pokazać)", async () => {
    setGpcNavigator(true);
    window.localStorage.setItem(STORAGE_KEY, VALID);
    runScript();
    stop = startConsentTakeover(host());
    await frames();
    expect(mounts).toEqual([]);
  });

  it("skrypt inline nie zadziałał (brak `data-consent-js`, powłoka ukryta): baner od razu", async () => {
    const root = mountShell();
    stop = startConsentTakeover(host(root));
    await vi.waitFor(() => expect(mounts).toHaveLength(1));
  });

  it("skrypt odsłonięcia się nie wykonał (brak `data-consent-parsed`, powłoka ukryta): baner od razu", async () => {
    const root = mountShell({ revealed: false });
    runScript();
    expect(document.documentElement.hasAttribute(CONSENT_JS_ATTR)).toBe(true);
    stop = startConsentTakeover(host(root));
    await vi.waitFor(() => expect(mounts).toHaveLength(1));
  });

  it("kontrola negatywna: ten sam stan PO odsłonięciu czeka na interakcję", async () => {
    const root = mountShell({ revealed: false });
    runScript();
    new Function(CONSENT_SHELL_REVEAL_SCRIPT)();
    stop = startConsentTakeover(host(root));
    await frames();
    expect(mounts).toEqual([]);
  });

  describe("powłoka z zasiewu ustawień (D5)", () => {
    const key = siteSettingsQueryOptions.queryKey;
    const seededClient = () => {
      const queryClient = new QueryClient();
      queryClient.setQueryData(key, {}, { updatedAt: 0 });
      return queryClient;
    };

    it("prawdziwe ustawienia po starcie: baner przejmuje widoczną powłokę od razu", async () => {
      const queryClient = seededClient();
      const root = mountShell();
      runScript();
      stop = startConsentTakeover({ ...host(root), settings: { queryClient, seeded: true } });
      await frames();
      expect(mounts).toEqual([]);
      queryClient.setQueryData(key, { privacy: { cookie_banner: false } });
      await vi.waitFor(() => expect(mounts).toHaveLength(1));
    });

    it("refetch skończony PRZED startem partnera też przekazuje powłokę", async () => {
      const queryClient = seededClient();
      queryClient.setQueryData(key, { privacy: { cookie_banner: false } });
      const root = mountShell();
      runScript();
      stop = startConsentTakeover({ ...host(root), settings: { queryClient, seeded: true } });
      await vi.waitFor(() => expect(mounts).toHaveLength(1));
    });

    it("bez zasiewu albo przy zapisanej decyzji refetch niczego nie montuje", async () => {
      const fresh = new QueryClient();
      fresh.setQueryData(key, {});
      const root = mountShell();
      runScript();
      stop = startConsentTakeover({
        ...host(root),
        settings: { queryClient: fresh, seeded: false },
      });
      fresh.setQueryData(key, { privacy: { cookie_banner: false } });
      await frames();
      expect(mounts).toEqual([]);
      stop();

      resetDocument();
      installCookieSpy();
      __resetPostInteractionQueueForTests();
      __resetFirstInteractionForTests();
      window.localStorage.setItem(STORAGE_KEY, VALID);
      const queryClient = seededClient();
      runScript();
      stop = startConsentTakeover({ ...host(), settings: { queryClient, seeded: true } });
      queryClient.setQueryData(key, { privacy: { cookie_banner: false } });
      await frames();
      expect(mounts).toEqual([]);
    });
  });
});
