// Wyszukiwarka nagłówka jako wyspa na intencję (P2.3): HTML serwera stoi, a
// hydratacja rusza dopiero na fokus/dotknięcie/najechanie. Natywne pole
// przyjmuje w tym czasie fokus i znaki, więc widget po hydratacji musi przejąć
// stan, który odwiedzający już ustawił:
//  1. fraza wpisana przed hydratacją zostaje w polu - pierwszy re-render po
//     hydratacji (np. efekt dyktowania) nie wraca do `q` sprzed wpisania;
//  2. fokus sprzed hydratacji otwiera panel ostatnich wyszukiwań, jak
//     `onFocus` po hydratacji.
// Do tego miejsce arkusza widgetu w HTML serwera (blok w miejscu, nie `<head>`).
// Bez routera (izolowany render): widget działa jak zwykłe pole.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { act } from "@testing-library/react";
import { SearchButtonWidget } from "../SearchButtonWidget";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: [], error: null }),
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
  },
}));
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  useRouter: () => undefined,
}));

const widget = (
  <SearchButtonWidget
    label="Szukaj"
    mode="dropdown"
    heading=""
    liveResults={false}
    limit={8}
    lang="pl"
    height={36}
    radius={6}
    fontSize={14}
  />
);

interface Mounted {
  readonly container: HTMLDivElement;
  readonly input: HTMLInputElement;
  readonly errors: unknown[];
  hydrate(): Promise<void>;
  unmount(): Promise<void>;
}

/** HTML serwera w dokumencie; hydratacja dopiero na żądanie (jak wyspa). */
function serverRendered(): Mounted {
  const container = document.createElement("div");
  container.innerHTML = renderToString(widget);
  document.body.append(container);
  const input = container.querySelector<HTMLInputElement>("input[data-mobile-search-input]");
  if (!input) throw new Error("brak pola wyszukiwarki w HTML serwera");
  const errors: unknown[] = [];
  let root: Root | null = null;
  return {
    container,
    input,
    errors,
    async hydrate() {
      await act(async () => {
        root = hydrateRoot(container, widget, { onRecoverableError: (e) => errors.push(e) });
      });
      // Efekty po hydratacji (sonda dyktowania: `setVoiceProbe`) dają re-render.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    async unmount() {
      await act(async () => root?.unmount());
      container.remove();
    },
  };
}

describe("SearchButtonWidget - stan sprzed hydratacji wyspy (P2.3)", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("fraza wpisana przed hydratacją zostaje w polu i w stanie widgetu", async () => {
    const page = serverRendered();
    const buttonsBefore = page.container.querySelectorAll("button").length;
    page.input.value = "unia";
    await page.hydrate();
    expect(page.errors).toEqual([]);
    expect(page.input.value).toBe("unia");
    // Stan widgetu ma frazę: przycisk czyszczenia renderuje się tylko przy
    // niepustym `q`.
    expect(page.container.querySelectorAll("button").length).toBe(buttonsBefore + 1);
    await page.unmount();
  });

  it("fokus sprzed hydratacji otwiera panel ostatnich wyszukiwań", async () => {
    localStorage.setItem("recent-searches:v1", JSON.stringify(["traktat lizboński"]));
    const page = serverRendered();
    page.input.focus();
    expect(document.activeElement).toBe(page.input);
    expect(page.container.textContent).not.toContain("traktat lizboński");
    await page.hydrate();
    expect(page.errors).toEqual([]);
    expect(page.container.textContent).toContain("traktat lizboński");
    expect(page.input.getAttribute("aria-expanded")).toBe("true");
    await page.unmount();
  });

  it("arkusz widgetu stoi w HTML przed polem, nie jako zasób <head>", () => {
    // Widget jest w pierwszej powłoce serwera; zasób `<style href precedence>`
    // trafiłby wtedy do `<head>` dokumentu (budżet `headRawBytes`). Blok w
    // miejscu, przed znacznikami pola, obowiązuje od pierwszej klatki.
    const box = document.createElement("div");
    box.innerHTML = renderToString(widget);
    const root = box.firstElementChild;
    expect(root?.classList.contains("builder-search-widget")).toBe(true);
    const sheet = root?.firstElementChild;
    expect(sheet?.tagName).toBe("STYLE");
    expect(sheet?.hasAttribute("data-search-sheet")).toBe(true);
    expect(sheet?.hasAttribute("data-precedence")).toBe(false);
    expect(sheet?.textContent).toContain(".builder-search-widget .input-group");
    expect(box.querySelectorAll("style")).toHaveLength(1);
  });

  it("bez wpisu i bez fokusu hydratacja niczego nie zmienia", async () => {
    localStorage.setItem("recent-searches:v1", JSON.stringify(["traktat lizboński"]));
    const page = serverRendered();
    await page.hydrate();
    expect(page.errors).toEqual([]);
    expect(page.input.value).toBe("");
    expect(page.container.textContent).not.toContain("traktat lizboński");
    expect(page.input.getAttribute("aria-expanded")).toBe("false");
    await page.unmount();
  });
});
