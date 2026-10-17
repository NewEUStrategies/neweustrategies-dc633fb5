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
//
// „Rdzeń" to tu RDZEŃ BLOKÓW (`blocksCorePl`/`blocksCoreEn`): od 2026-10-17
// `blocks.*` nie jedzie już w `locale/*.ts`, tylko w tym samym pliku nakładki,
// rejestrowany PRZED uzupełnieniami z overwrite=false. Umowa się nie zmienia:
// nagłówek należy do rdzenia bloków, placeholder - wyłącznie do uzupełnień.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { blocksCoreEn, blocksCorePl } from "@/lib/i18n-admin-blocks";
import { realT } from "@/test/i18nReal";
import type { Block } from "@/lib/blocks/types";

// Zdjęcie rdzenia bloków ZANIM `Cover.tsx` wciągnie resztę edytora (import
// dynamiczny niżej) - bezpiecznik na wypadek scalania w miejscu (i18next kopiuje
// zasoby przed `deepExtend`, więc eksport powinien zostać nietknięty).
const CORE = structuredClone({ pl: blocksCorePl, en: blocksCoreEn });
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
