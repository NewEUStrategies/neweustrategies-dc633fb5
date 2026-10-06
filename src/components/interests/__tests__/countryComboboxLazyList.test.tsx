// Lista krajów liczona LENIWIE - przy pierwszym otwarciu, nie przy montażu
// pola (P2.4, hydration:H10 f; księga P0.5, K14).
//
// CO TEN PLIK DOWODZI:
//  1. Zamontowane pole (formularz „Dołącz do nas", newsletter) nie buduje ani
//     nie sortuje katalogu krajów - nawet z wpisaną wartością (flaga idzie
//     przez `getAlpha2Code`, nie przez listę).
//  2. Pierwsze otwarcie buduje listę raz, kolejne otwarcia i drugie pole w
//     tym samym języku korzystają z gotowej.
//  3. Kolejność jest ta sama co dawne `localeCompare(b, lang)`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const getNamesCalls: string[] = [];
vi.mock("@/lib/countries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/countries")>();
  return {
    ...actual,
    getNames: (lang: "pl" | "en") => {
      getNamesCalls.push(lang);
      return actual.getNames(lang);
    },
  };
});

import { CountryCombobox } from "../CountryCombobox";
import { getNames } from "@/lib/countries";

afterEach(() => cleanup());

const field = (value = "") => (
  <CountryCombobox value={value} onChange={() => {}} lang="pl" label="Kraj" />
);

describe("CountryCombobox - leniwa lista krajów", () => {
  it("montaż (także z wartością) nie buduje katalogu; pierwsze otwarcie - raz", async () => {
    render(field("Polska"));
    expect(getNamesCalls).toEqual([]);
    fireEvent.focus(screen.getByRole("combobox"));
    await waitFor(() => expect(screen.queryAllByRole("option").length).toBeGreaterThan(0));
    expect(getNamesCalls).toEqual(["pl"]);
    cleanup();
    render(field());
    fireEvent.focus(screen.getByRole("combobox"));
    await waitFor(() => expect(screen.queryAllByRole("option").length).toBeGreaterThan(0));
    // Drugie pole w tym samym języku - gotowa lista z pamięci modułu.
    expect(getNamesCalls).toEqual(["pl"]);
  });

  it("kolejność jak `localeCompare(b, lang)`", async () => {
    render(field());
    fireEvent.focus(screen.getByRole("combobox"));
    await waitFor(() => expect(screen.queryAllByRole("option").length).toBeGreaterThan(0));
    const shown = screen.queryAllByRole("option").map((o) => o.textContent);
    const expected = Object.values(getNames("pl"))
      .sort((a, b) => a.localeCompare(b, "pl"))
      .slice(0, 200);
    expect(shown).toEqual(expected);
  });
});
