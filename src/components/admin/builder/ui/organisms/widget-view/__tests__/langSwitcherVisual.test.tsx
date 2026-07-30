// Wizualne testy regresji przełącznika języka.
// Cel: zabezpieczyć klasy odpowiedzialne za wygląd pill/thumb w trybie
// dark/light oraz `motion-reduce`, tak żeby przypadkowa zmiana Tailwind
// utilities (rounding, kolor, transition) była wychwycona snapshotem.
import "@/lib/i18n-chat";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import i18n from "@/lib/i18n";

import { LangSwitcherDropdown } from "../chromeWidgets";
import { ThemeProvider } from "@/components/ThemeProvider";

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouter: () => ({
      navigate: vi.fn(),
      preloadRoute: () => Promise.resolve(),
      state: { location: { pathname: "/", search: {} } },
    }),
  };
});

function normalize(html: string): string {
  // Ucinamy React-owe atrybuty debug (data-reactroot itp.) i whitespace.
  return html.replace(/\s+/g, " ").trim();
}

function setPrefersReducedMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

async function setLang(lang: "pl" | "en") {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
}

describe("LangSwitcherDropdown — visual regression", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    setPrefersReducedMotion(false);
  });

  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("dark");
  });

  it("light + PL aktywne: pill 6px, thumb translateX(0)", async () => {
    await setLang("pl");
    const { container } = render(
      <ThemeProvider>
        <LangSwitcherDropdown label="Język" />
      </ThemeProvider>,
    );
    const group = container.querySelector('[role="group"]') as HTMLElement;
    const thumb = container.querySelector(".lang__thumb") as HTMLElement;
    expect(group.className).toMatch(/rounded-\[6px\]/);
    expect(group.className).toMatch(/bg-\[#f4f4f2\]/);
    expect(thumb.className).toMatch(/rounded-\[6px\]/);
    expect(thumb.style.transform).toBe("translateX(0)");
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it("light + EN aktywne: thumb translateX(32px), aria-pressed na EN", async () => {
    await setLang("en");
    const { container } = render(
      <ThemeProvider>
        <LangSwitcherDropdown label="Language" />
      </ThemeProvider>,
    );
    const thumb = container.querySelector(".lang__thumb") as HTMLElement;
    const [plBtn, enBtn] = Array.from(container.querySelectorAll("button"));
    // Nieaktywna połowa zwija się do w-8, więc przesunięcie kciuka to 32px.
    expect(thumb.style.transform).toBe("translateX(32px)");
    expect(plBtn.getAttribute("aria-pressed")).toBe("false");
    expect(enBtn.getAttribute("aria-pressed")).toBe("true");
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it("dark mode: zachowuje warianty dark: (bg, border, text)", async () => {
    await setLang("pl");
    document.documentElement.classList.add("dark");
    const { container } = render(
      <ThemeProvider>
        <LangSwitcherDropdown label="Język" />
      </ThemeProvider>,
    );
    const group = container.querySelector('[role="group"]') as HTMLElement;
    const thumb = container.querySelector(".lang__thumb") as HTMLElement;
    // Klasy dark: muszą pozostać w markupie (Tailwind aktywuje je przez .dark na <html>).
    expect(group.className).toMatch(/dark:bg-\[#27272a\]/);
    expect(group.className).toMatch(/dark:border-white\/10/);
    expect(thumb.className).toMatch(/dark:bg-\[#18181b\]/);
    expect(thumb.className).toMatch(/dark:border-white\/\[0\.08\]/);
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it("prefers-reduced-motion: klasy motion-reduce:duration-[1ms] pozostają na przyciskach", async () => {
    setPrefersReducedMotion(true);
    await setLang("pl");
    const { container } = render(
      <ThemeProvider>
        <LangSwitcherDropdown label="Język" />
      </ThemeProvider>,
    );
    const buttons = Array.from(container.querySelectorAll("button.lang__opt"));
    expect(buttons.length).toBe(2);
    for (const btn of buttons) {
      expect(btn.className).toMatch(/motion-reduce:duration-\[1ms\]/);
      // Kolor/typografia muszą pozostać niezmienne przy reduced motion.
      expect(btn.className).toMatch(/text-\[11px\]/);
      expect(btn.className).toMatch(/font-medium/);
    }
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });
});
