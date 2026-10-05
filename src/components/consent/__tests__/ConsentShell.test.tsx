// Powłoka banera zgód z SSR (P1.3) - parytet z interaktywnym banerem i dostępność.
//
// CO TO DOWODZI:
//  1. PARYTET: powłoka i karta banera w chwili przejęcia to TEN SAM markup -
//     ten sam HTML co do bajtu po zdjęciu trzech atrybutów wyłącznie powłoki
//     (`data-consent-shell`, `data-nosnippet`, klasa ukrywania). Podmiana
//     powłoki na baner nie zmienia więc ani piksela, ani drzewa dostępności
//     (te same role, etykiety, kolejność kontrolek).
//  2. WIDOCZNOŚĆ: korzeń powłoki niesie wariant `[html[data-consent-decided]_&]:hidden`
//     (ukrywanie przed pierwszym malowaniem przez skrypt inline, bez `:has()`)
//     i `data-nosnippet`; powłoka nie powstaje, gdy baner jest wyłączony.
//  3. POKAZANIE BEZ ANIMACJI (P0.5, F8): żadnego `animate-in` w karcie.
//  4. BEZ LUCIDE: ikony są inline SVG, `aria-hidden`, a moduł nie importuje
//     `lucide-react` (powłoka nie może ciągnąć `vendor-lucide`).
//  5. DOSTĘPNOŚĆ: axe bez naruszeń; `aria-controls` wskazuje istniejący panel.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  logo: { mobile: "https://cdn.example.com/mark.svg", mobile_dark: "" },
}));

vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: <T,>(key: string, defaults: T): T => {
    if (key === "theme_options") {
      return {
        logo: {
          main: "",
          main_dark: "",
          mobile: h.logo.mobile,
          mobile_dark: h.logo.mobile_dark,
          transparent: "",
          transparent_dark: "",
          sidebar_expanded: "",
          sidebar_expanded_dark: "",
        },
      } as T;
    }
    if (key in h.settings) return { ...defaults, ...(h.settings[key] as object) } as T;
    return defaults;
  },
}));

vi.mock("@/lib/ads/consent", () => ({
  OPEN_PREFS_EVENT: "consent-open-preferences",
  consumeOpenPrefsRequest: () => false,
  useConsent: () => ({
    state: null,
    decided: false,
    mounted: false,
    save: vi.fn(),
    acceptAll: vi.fn(),
    rejectAll: vi.fn(),
    clear: vi.fn(),
  }),
  useGpcSignal: () => ({ active: false, source: "none" as const }),
}));
vi.mock("@/components/ThemeProvider", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("@/lib/overlayCoordinator", () => ({
  setConsentOverlayVisible: vi.fn(),
  setMarketingConsent: vi.fn(),
  reportConsentSurface: vi.fn(),
}));

import i18n from "@/lib/i18n";
import { ConsentShell } from "@/components/consent/ConsentShell";
import { ConsentBanner } from "@/components/ConsentBanner";
import { COOKIE_BANNER_DEFAULTS } from "@/lib/cookieBanner/config";
import { axeViolations, summarize } from "@/test/axe";

const PL = COOKIE_BANNER_DEFAULTS.copy.pl;
const EN = COOKIE_BANNER_DEFAULTS.copy.en;
const SHELL_ONLY = [
  / data-consent-shell=""/,
  / data-nosnippet=""/,
  / \[html\[data-consent-decided\]_&amp;\]:hidden/,
];

function shellHtml(): string {
  return renderToStaticMarkup(<ConsentShell />);
}

/**
 * Karta banera w chwili przejęcia powłoki (pierwszy render po podmianie). Ten
 * sam serializator co powłoka (`renderToStaticMarkup`), żeby porównanie nie
 * zależało od formatowania `style` przez DOM.
 */
function bannerCardHtml(): string {
  return renderToStaticMarkup(<ConsentBanner takeover={{ intent: null, focus: null }} />);
}

function stripShellOnly(html: string): string {
  return SHELL_ONLY.reduce((acc, pattern) => acc.replace(pattern, ""), html);
}

beforeEach(async () => {
  h.settings = {};
  h.logo = { mobile: "https://cdn.example.com/mark.svg", mobile_dark: "" };
  await i18n.changeLanguage("pl");
});

afterEach(() => {
  cleanup();
});

describe("parytet powłoki SSR z kartą banera", () => {
  it("ten sam HTML co do bajtu poza atrybutami wyłącznie powłoki (PL)", () => {
    const shell = shellHtml();
    expect(shell).toContain('data-consent-shell=""');
    expect(stripShellOnly(shell)).toBe(bannerCardHtml());
  });

  it("ten sam HTML po angielsku, z odnośnikami z panelu i stroną polityki", async () => {
    await i18n.changeLanguage("en");
    h.settings = {
      privacy: { privacy_page_slug: "/privacy-policy", cookie_banner: true },
      cookie_banner_config: {
        links: [
          { id: "a", url: "/cookies", label_pl: "Pliki cookie", label_en: "Cookie policy" },
          { id: "b", url: "javascript:alert(1)", label_pl: "Zły", label_en: "Bad" },
        ],
      },
    };
    const shell = shellHtml();
    expect(shell).toContain(EN.title);
    expect(shell).toContain('href="/en/cookies"');
    expect(shell).not.toContain("javascript:");
    expect(stripShellOnly(shell)).toBe(bannerCardHtml());
  });

  it("bez logo obie karty pokazują to samo zapasowe ciasteczko", () => {
    h.logo = { mobile: "", mobile_dark: "" };
    const shell = shellHtml();
    expect(shell).not.toContain("<img");
    expect(stripShellOnly(shell)).toBe(bannerCardHtml());
  });

  it("kontrola negatywna: zmiana klasy w powłoce wywraca porównanie", () => {
    const shell = shellHtml().replace("sm:w-[380px]", "sm:w-[381px]");
    expect(stripShellOnly(shell)).not.toBe(bannerCardHtml());
  });
});

describe("powłoka: widoczność, SEO i pokazanie bez animacji", () => {
  it("korzeń ma rolę i etykietę banera, `data-nosnippet` i wariant ukrywania przed malowaniem", () => {
    const { container } = render(<ConsentShell />);
    const root = container.querySelector<HTMLElement>("[data-consent-shell]");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("role")).toBe("dialog");
    expect(root?.getAttribute("aria-modal")).toBe("false");
    expect(root?.getAttribute("aria-label")).toBe(PL.title);
    expect(root?.hasAttribute("data-nosnippet")).toBe(true);
    expect(root?.className).toContain("[html[data-consent-decided]_&]:hidden");
    expect(root?.className).not.toMatch(/:has\(/);
  });

  it("każda kontrolka niesie akcję dla delegowanego `click` i przeniesienia fokusu", () => {
    const { container } = render(<ConsentShell />);
    const actions = [...container.querySelectorAll("[data-consent-action]")].map((el) =>
      el.getAttribute("data-consent-action"),
    );
    expect(actions).toEqual(["close", "reject", "accept", "customize", "lang-pl", "lang-en"]);
    for (const button of container.querySelectorAll("button")) {
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("karta pokazuje się BEZ `animate-in` (F8) - ani w powłoce, ani w banerze", () => {
    expect(shellHtml()).not.toMatch(/animate-in|fade-in|slide-in-from/);
    expect(bannerCardHtml()).not.toMatch(/animate-in|fade-in|slide-in-from/);
  });

  it.each([
    ["wyłączony baner w ustawieniach prywatności", { privacy: { cookie_banner: false } }],
    ["wyłączony baner w konfiguracji", { cookie_banner_config: { enabled: false } }],
  ])("%s - powłoki nie ma w HTML", (_name, settings) => {
    h.settings = settings;
    expect(shellHtml()).toBe("");
  });

  it("różne logo jasne i ciemne: oba w kaflu, przełącza CSS (`dark:`), ukryty jest leniwy", () => {
    h.logo = {
      mobile: "https://cdn.example.com/light.svg",
      mobile_dark: "https://cdn.example.com/dark.svg",
    };
    const { container } = render(<ConsentShell />);
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.map((img) => img.getAttribute("src"))).toEqual([
      "https://cdn.example.com/light.svg",
      "https://cdn.example.com/dark.svg",
    ]);
    expect(imgs[0].className).toContain("dark:hidden");
    expect(imgs[1].className).toContain("hidden dark:block");
    for (const img of imgs) expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("ikony są inline SVG ukryte przed czytnikiem, a moduł nie importuje lucide", () => {
    const { container } = render(<ConsentShell />);
    const svgs = [...container.querySelectorAll("svg")];
    expect(svgs.length).toBeGreaterThanOrEqual(3);
    for (const svg of svgs) expect(svg.getAttribute("aria-hidden")).toBe("true");
    const source = readFileSync(resolve(__dirname, "../ConsentShell.tsx"), "utf8");
    expect(source).not.toMatch(/from\s+["'](?:lucide-react|@\/lib\/lucide-shim)["']/);
    const banner = readFileSync(resolve(__dirname, "../../ConsentBanner.tsx"), "utf8");
    expect(banner).not.toMatch(/from\s+["'](?:lucide-react|@\/lib\/lucide-shim)["']/);
  });
});

describe("dostępność powłoki", () => {
  it("axe: brak naruszeń (PL i EN)", async () => {
    const pl = render(<ConsentShell />);
    const plViolations = await axeViolations(pl.container);
    expect(plViolations, summarize(plViolations)).toEqual([]);
    cleanup();
    await i18n.changeLanguage("en");
    const en = render(<ConsentShell />);
    const enViolations = await axeViolations(en.container);
    expect(enViolations, summarize(enViolations)).toEqual([]);
  });

  it("„X” ma etykietę odmowy różną od przycisku odrzucenia, a panel z `aria-controls` istnieje", () => {
    const { container, getByRole } = render(<ConsentShell />);
    expect(getByRole("button", { name: `Zamknij (${PL.rejectAll})` })).toBeTruthy();
    expect(getByRole("button", { name: PL.rejectAll })).toBeTruthy();
    const customize = getByRole("button", { name: PL.customize });
    expect(customize.getAttribute("aria-expanded")).toBe("false");
    const panelId = customize.getAttribute("aria-controls");
    expect(panelId).toBe("cookie-preferences-inline");
    expect(container.querySelector(`#${panelId}`)).not.toBeNull();
  });
});
