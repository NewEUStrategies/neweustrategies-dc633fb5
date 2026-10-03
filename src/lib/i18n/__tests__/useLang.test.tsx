// `useLang` - język chrome'u renderowanego SSR (Header, Footer, AlertBar...).
// Kontrakt:
//   * pierwszy render = `currentLang()` (adres), nie `i18n.language` - SSR
//     i hydratacja muszą dać ten sam HTML;
//   * po montażu podąża za `languageChanged` (payload: "en-*" -> en, reszta ->
//     pl; pusty payload -> znów adres);
//   * ta sama wartość nie re-renderuje; odmontowanie odpina nasłuch.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  /** Prosty emiter zdarzeń w kształcie i18next (`on`/`off`). */
  makeI18n: () => {
    const listeners = new Map<string, Set<(lng?: string) => void>>();
    return {
      on: (event: string, fn: (lng?: string) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
      },
      off: (event: string, fn: (lng?: string) => void) => {
        listeners.get(event)?.delete(fn);
      },
      emit: (event: string, lng?: string) => {
        for (const fn of listeners.get(event) ?? []) fn(lng);
      },
      count: (event: string) => listeners.get(event)?.size ?? 0,
    };
  },
  i18n: undefined as unknown,
}));

vi.mock("../localeRuntime", () => ({ currentLang: () => h.lang }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: h.i18n }) }));

import { useLang } from "../useLang";

type FakeI18n = ReturnType<typeof h.makeI18n>;

let renders: string[] = [];
function Probe() {
  const lang = useLang();
  renders.push(lang);
  return <span data-testid="lang">{lang}</span>;
}

function mount() {
  const i18n = h.makeI18n();
  h.i18n = i18n;
  renders = [];
  const view = render(<Probe />);
  return { i18n: i18n as FakeI18n, renders, view };
}

afterEach(() => {
  cleanup();
  h.lang = "pl";
});

describe("useLang", () => {
  it("pierwszy render bierze język z adresu (currentLang), nie z i18next", () => {
    h.lang = "en";
    const { renders } = mount();
    expect(renders[0]).toBe("en");
  });

  it.each<[string, "pl" | "en"]>([
    ["en", "en"],
    ["en-GB", "en"],
    ["pl", "pl"],
    ["pl-PL", "pl"],
    ["de", "pl"],
  ])("languageChanged(%s) -> %s", (payload, expected) => {
    h.lang = expected === "en" ? "pl" : "en";
    const { i18n, view } = mount();
    act(() => i18n.emit("languageChanged", payload));
    expect(view.getByTestId("lang").textContent).toBe(expected);
  });

  it("pusty payload -> adres jest autorytetem (currentLang)", () => {
    const { i18n, view } = mount();
    h.lang = "en";
    act(() => i18n.emit("languageChanged", ""));
    expect(view.getByTestId("lang").textContent).toBe("en");
    h.lang = "pl";
    act(() => i18n.emit("languageChanged", undefined));
    expect(view.getByTestId("lang").textContent).toBe("pl");
  });

  it("ta sama wartość nie re-renderuje komponentu", () => {
    const { i18n, renders } = mount();
    const before = renders.length;
    act(() => i18n.emit("languageChanged", "pl"));
    act(() => i18n.emit("languageChanged", "pl-PL"));
    expect(renders.length).toBe(before);
    act(() => i18n.emit("languageChanged", "en"));
    expect(renders.length).toBe(before + 1);
  });

  it("odmontowanie odpina nasłuch - późne zdarzenie nie trafia w martwy komponent", () => {
    const { i18n, view } = mount();
    expect(i18n.count("languageChanged")).toBe(1);
    view.unmount();
    expect(i18n.count("languageChanged")).toBe(0);
    expect(() => i18n.emit("languageChanged", "en")).not.toThrow();
  });

  it("nowa instancja i18n -> przepięcie nasłuchu (stara odpięta)", () => {
    const { i18n: first, view } = mount();
    const second = h.makeI18n();
    h.i18n = second;
    view.rerender(<Probe />);
    expect(first.count("languageChanged")).toBe(0);
    expect(second.count("languageChanged")).toBe(1);
    act(() => second.emit("languageChanged", "en"));
    expect(view.getByTestId("lang").textContent).toBe("en");
  });
});
