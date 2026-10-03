// Edytor bloku `cover`: placeholder pola tytułu kontra nagłówek edytora.
//
// CO BYŁO ŹLE. `Cover.tsx` brał placeholder pola tytułu z klucza
// `blocks.editors.cover.title`, a ten klucz należy do rdzenia i zgodnie z umową
// `editors.<blok>.title` niesie NAGŁÓWEK edytora („Tło / okładka" / „Cover").
// Nakładka `i18n-admin-blocks` wpisywała pod TEN SAM klucz właściwy
// placeholder („Wpisz tytuł…" / „Enter a title…"), ale z overwrite=false - więc
// wygrywała tylko wtedy, gdy rdzeń danego języka dociągnął się PÓŹNIEJ niż
// nakładka (leniwy drugi język na kliencie). Redaktor na stronie PL widział
// w pustym polu tytułu napis „Tło / okładka", a po przełączeniu na EN -
// zależnie od historii karty - „Cover" albo „Enter a title…".
//
// Teraz placeholder ma własny klucz (`blocks.editors.cover.titlePh`), którego
// rdzeń nie zna, więc kolejność ładowania niczego nie rozstrzyga.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import { realT } from "@/test/i18nReal";
import type { Block } from "@/lib/blocks/types";

// Zdjęcie rdzenia ZANIM `Cover.tsx` wciągnie nakładkę (import dynamiczny niżej):
// i18next scala nakładki w miejscu, w obiekt przekazany do `init`; eksport rdzenia
// chroni przed tym kopia `storeCopy` w `i18n.ts` - zdjęcie to bezpiecznik.
const CORE = structuredClone({ pl: corePl, en: coreEn });
const { CoverBlock } = await import("../Cover");

const IMAGE_URL = "https://example.com/tlo.jpg";

function cover(data: Block["data"]): Block {
  return { id: "b-cover", type: "cover", data };
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("CoverBlock - placeholder tytułu ma własny klucz", () => {
  it.each([
    ["pl", "Wpisz tytuł…", "Tło / okładka"],
    ["en", "Enter a title…", "Cover"],
  ] as const)(
    "%s: pole tytułu podpowiada wpisanie tytułu, nie nagłówek edytora",
    async (lang, placeholder, heading) => {
      await i18n.changeLanguage(lang);
      render(<CoverBlock block={cover({ url: IMAGE_URL })} onChange={() => undefined} />);

      const input = screen.getByRole("textbox");
      expect(input).toHaveAttribute("placeholder", placeholder);
      expect(input).not.toHaveAttribute("placeholder", heading);
    },
  );

  it.each([
    ["pl", "Tło / okładka"],
    ["en", "Cover"],
  ] as const)(
    "%s: nagłówek edytora `blocks.editors.cover.title` zostaje zdaniem rdzenia",
    (lang, heading) => {
      // Nakładka nie może przepisać klucza rdzenia - ani wartości w magazynie,
      // ani tego, co zwraca `t`.
      expect(realT(lang)("blocks.editors.cover.title")).toBe(heading);
      expect(CORE[lang].blocks.editors.cover.title).toBe(heading);
    },
  );

  it("placeholder istnieje wyłącznie w nakładce - rdzeń go nie zna", () => {
    for (const lang of ["pl", "en"] as const) {
      expect(Object.keys(CORE[lang].blocks.editors.cover)).not.toContain("titlePh");
      expect(realT(lang)("blocks.editors.cover.titlePh")).not.toBe("blocks.editors.cover.titlePh");
    }
  });

  it("wpisanie tytułu oddaje blok z nowym tytułem i resztą danych bez zmian", () => {
    const onChange = vi.fn();
    render(<CoverBlock block={cover({ url: IMAGE_URL, overlay: 30 })} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Nowy tytuł" } });
    expect(onChange).toHaveBeenCalledWith(
      cover({ url: IMAGE_URL, overlay: 30, title: "Nowy tytuł" }),
    );
  });

  it("bez obrazu pokazuje pole adresu tła, a wpisany adres trafia do bloku", () => {
    const onChange = vi.fn();
    render(<CoverBlock block={cover({})} onChange={onChange} />);
    const input = screen.getByPlaceholderText(realT("pl")("blocks.editors.cover.bgUrl"));
    fireEvent.change(input, { target: { value: IMAGE_URL } });
    expect(onChange).toHaveBeenCalledWith(cover({ url: IMAGE_URL }));
  });
});
