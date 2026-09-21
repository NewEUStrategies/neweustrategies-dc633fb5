/**
 * `AdminLangBar` - pływający przełącznik PL/EN pokazywany WYŁĄCZNIE tam, gdzie
 * sidebar panelu jest schowany (pełnoekranowe edytory). To jedyna droga
 * redaktora do zmiany języka panelu na tych ekranach, więc dowód dotyczy
 * trzech rzeczy naraz:
 *   1. KTÓRY język jest zaznaczony (`aria-pressed`) - pasek czyta `i18n.language`
 *      po prefiksie, więc "en-GB" ma zapalać EN, a brak języka spadać na PL;
 *   2. że klik w język JUŻ AKTYWNY nie woła `changeLanguage` (zbędne
 *      przeładowanie zasobów i zapis preferencji przy każdym trafieniu myszą);
 *   3. że etykieta grupy przycisków jest TŁUMACZONA - `t` w atrapie to
 *      prawdziwy `getFixedT` z `@/test/i18nReal`, więc asercja mierzy słownik,
 *      a nie kopię napisu wpisaną w teście, i wariant EN jest osobnym
 *      przypadkiem z własną asercją.
 *
 * `changeLanguage` jest SPY: pasek ma zgłosić zamiar zmiany, a nie mutować
 * globalnej instancji i18next współdzieloną przez cały plik testowy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";

const h = vi.hoisted(() => ({
  /** Prawdziwy `getFixedT(lang)`; wstrzykiwany niżej (fabryka nic nie importuje). */
  t: null as null | ((lang: "pl" | "en") => unknown),
  /** Wartość `i18n.language` - także spoza pary "pl"/"en" (np. "en-GB"). */
  language: "pl" as string | undefined,
  changes: [] as string[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.t?.(h.language?.startsWith("en") ? "en" : "pl"),
    i18n: {
      get language() {
        return h.language;
      },
      changeLanguage: (next: string) => {
        h.changes.push(next);
      },
    },
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

import { AdminLangBar } from "@/components/admin/AdminLangBar";
import { realT } from "@/test/i18nReal";

h.t = (lang) => realT(lang);

/** Słownik jako źródło asercji - test nie powtarza napisów z komponentu. */
const dict = (lang: "pl" | "en"): TFunction => realT(lang);

beforeEach(() => {
  h.language = "pl";
  h.changes.length = 0;
});

afterEach(cleanup);

describe("AdminLangBar - zaznaczenie bieżącego języka", () => {
  it.each([
    ["polski", "pl", "PL"],
    ["angielski", "en", "EN"],
    ["wariant regionalny angielskiego", "en-GB", "EN"],
    ["polski regionalny", "pl-PL", "PL"],
  ])("dla języka %s zaznacza %s", (_opis, language, pressed) => {
    h.language = language;
    render(<AdminLangBar />);

    expect(screen.getByRole("button", { name: pressed })).toHaveAttribute("aria-pressed", "true");
    const other = pressed === "PL" ? "EN" : "PL";
    expect(screen.getByRole("button", { name: other })).toHaveAttribute("aria-pressed", "false");
  });

  it("bez ustawionego języka pasek spada na polski", () => {
    h.language = undefined;
    render(<AdminLangBar />);

    expect(screen.getByRole("button", { name: "PL" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("AdminLangBar - zmiana języka", () => {
  it("klik w drugi język zgłasza zmianę", () => {
    render(<AdminLangBar />);

    fireEvent.click(screen.getByRole("button", { name: "EN" }));

    expect(h.changes).toEqual(["en"]);
  });

  it("z angielskiego wraca na polski", () => {
    h.language = "en";
    render(<AdminLangBar />);

    fireEvent.click(screen.getByRole("button", { name: "PL" }));

    expect(h.changes).toEqual(["pl"]);
  });

  it.each([
    ["polskiego", "pl", "PL"],
    ["angielskiego", "en", "EN"],
  ])("klik w język już aktywny (%s) niczego nie przełącza", (_opis, language, label) => {
    h.language = language;
    render(<AdminLangBar />);

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(h.changes).toEqual([]);
  });
});

describe("AdminLangBar - opis dla technologii asystujących", () => {
  it.each([
    ["polskim", "pl" as const],
    ["angielskim", "en" as const],
  ])("w wariancie %s grupa przycisków ma etykietę ze słownika", (_opis, lang) => {
    h.language = lang;
    render(<AdminLangBar />);

    expect(screen.getByRole("group", { name: dict(lang)("admin.language") })).toBeInTheDocument();
  });
});
