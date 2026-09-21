// WIDOK KODU DOKUMENTU (`CodeViewDialog`) - okno „Edytora kodu" z panelu
// wpisu, w ktorym redaktor oglada i kopiuje markup Gutenberga calego wpisu.
//
// DLACZEGO TA POWIERZCHNIA MA WLASNY DOWOD
// To jedyna droga, ktora WYNOSI tresc z naszego CMS-a na zewnatrz: markup
// stad wkleja sie do WordPressa albo z powrotem do kanwy. Jesli kopiowanie
// zawiedzie po cichu, redaktor wklei do obcego edytora STARA zawartosc
// schowka i dowie sie o tym dopiero po publikacji. Dlatego dowod idzie na
// GALEZIE ODMOWY, nie na wyglad okna.
//
// CO MA TU DOWOD
//   * zamkniete okno NIE serializuje dokumentu (memo na `open`) - serializacja
//     calego wpisu przy kazdym renderze panelu byla by kosztem placonym za
//     okno, ktorego nikt nie otworzyl,
//   * otwarte okno pokazuje markup Gutenberga TEGO dokumentu, tylko do odczytu,
//   * ODMOWA SCHOWKA (brak zgody przegladarki, kontekst bez HTTPS) konczy sie
//     komunikatem o porazce, a NIE potwierdzeniem sukcesu ani wywrotka,
//   * potwierdzenie kopiowania jest CHWILOWE - po 1,5 s znika, wiec drugi klik
//     znowu widac,
//   * pusty dokument (zero blokow) daje puste okno zamiast bledu,
//   * jezyk dokumentu trafia do opisu WIELKIMI literami - to jedyne miejsce,
//     w ktorym redaktor widzi, ktora wersje jezykowa wlasnie kopiuje.
//
// CZEGO TU NIE MA - swiadomie
//   * atrapy `blocksToGutenberg`. Serializator jest prawdziwy, wiec asercja
//     idzie na markup, ktory naprawde wyladuje w schowku,
//   * atrapy tlumaczen - napisy pochodza z prawdziwego slownika (`realT`).
//     Jedyna atrapa to `sonner` (toasty), bo to granica UI.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import { CodeViewDialog } from "../CodeViewDialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const t = realT("pl");
const tEn = realT("en");

const sukces = vi.mocked(toast.success);
const blad = vi.mocked(toast.error);

const KOPIUJ = t("blocks.codeView.copy");
const TYTUL = t("blocks.codeView.title");

/** Zapamietane wywolania `navigator.clipboard.writeText`. */
let wlozoneDoSchowka: string[] = [];

function podstawSchowek(odmowa = false): void {
  wlozoneDoSchowka = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (tekst: string) => {
        if (odmowa) throw new Error("test: przegladarka odmowila dostepu do schowka");
        wlozoneDoSchowka.push(tekst);
      },
    },
  });
}

beforeEach(() => {
  sukces.mockClear();
  blad.mockClear();
  podstawSchowek();
});

afterEach(() => {
  vi.useRealTimers();
});

function akapit(id: string, tekst: string): Block {
  return { id, type: "paragraph", data: { html: `<p>${tekst}</p>` } } as Block;
}

function naglowek(id: string, tekst: string): Block {
  return { id, type: "heading", data: { level: 2, text: tekst } } as Block;
}

function dokument(blocks: Block[]): BlocksDoc {
  return { version: 1, blocks } as BlocksDoc;
}

function zamontuj(
  blocks: Block[] = [akapit("p1", "Traktat lizbonski")],
  { open = true, lang = "pl" as "pl" | "en" } = {},
) {
  const onOpenChange = vi.fn<(next: boolean) => void>();
  const view = render(
    <CodeViewDialog doc={dokument(blocks)} lang={lang} open={open} onOpenChange={onOpenChange} />,
  );
  return { onOpenChange, view };
}

/** Pole podgladu markupu - jedyny `textbox` w oknie. */
function poleMarkupu(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: TYTUL }) as HTMLTextAreaElement;
}

function przyciskKopiowania(): HTMLElement {
  return screen.getByRole("button", { name: KOPIUJ });
}

/**
 * Czy przycisk pokazuje ikone potwierdzenia. Ikona jest jedynym nosnikiem
 * stanu `copied` - napis na przycisku sie NIE zmienia, wiec asercja musi isc
 * na glif. Lucide znakuje kazdy glif klasa `lucide-<nazwa>`.
 */
function pokazujePotwierdzenie(): boolean {
  const glif = przyciskKopiowania().querySelector("svg");
  return (glif?.getAttribute("class") ?? "").toLowerCase().includes("check");
}

describe("CodeViewDialog - okno zamkniete", () => {
  it("zamkniete okno nie renderuje ani markupu, ani przycisku kopiowania", () => {
    zamontuj([akapit("p1", "Traktat")], { open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: KOPIUJ })).toBeNull();
  });
});

describe("CodeViewDialog - tresc podgladu", () => {
  it("otwarte okno pokazuje markup Gutenberga TEGO dokumentu", () => {
    zamontuj([akapit("p1", "Traktat lizbonski")]);
    const markup = poleMarkupu().value;
    expect(markup).toContain("wp:paragraph");
    expect(markup).toContain("Traktat lizbonski");
  });

  it("markup jest TYLKO DO ODCZYTU - to podglad, nie druga kanwa edycji", () => {
    // Gdyby pole bylo edytowalne, redaktor poprawialby markup, ktory i tak
    // nie wraca do dokumentu - czyli traci prace bez ostrzezenia.
    zamontuj();
    expect(poleMarkupu()).toHaveAttribute("readonly");
  });

  it("kazdy blok dokumentu ma swoj znacznik w markupie", () => {
    zamontuj([naglowek("h1", "Rozdzial"), akapit("p1", "Tresc")]);
    const markup = poleMarkupu().value;
    expect(markup).toContain("wp:heading");
    expect(markup).toContain("wp:paragraph");
  });

  it("PUSTY dokument daje puste okno zamiast wywrotki", () => {
    // Nowy wpis ma zero blokow - okno musi sie otworzyc i pokazac pustke.
    zamontuj([]);
    expect(poleMarkupu().value.trim()).toBe("");
    expect(przyciskKopiowania()).toBeInTheDocument();
  });

  it("liczba blokow w stopce zgadza sie z dokumentem", () => {
    zamontuj([akapit("p1", "Raz"), akapit("p2", "Dwa"), akapit("p3", "Trzy")]);
    expect(screen.getByText(t("blocks.codeView.blockCount", { count: 3 }))).toBeInTheDocument();
  });

  it("jezyk dokumentu trafia do opisu WIELKIMI literami", () => {
    // Redaktor kopiuje jedna z dwoch wersji jezykowych - opis jest jedynym
    // miejscem, w ktorym widzi ktora.
    //
    // ROZDZIELENIE DWOCH JEZYKOW, ktore sie tu spotykaja: napis opisu idzie
    // z jezyka INTERFEJSU (`useTranslation`, w tescie polski), a prop `lang`
    // wchodzi WYLACZNIE jako interpolacja `{{lang}}`. Asercja idzie wiec na
    // polskie zdanie niosace znacznik „EN" - porownanie z angielskim
    // slownikiem mierzylo by przelaczenie jezyka panelu, ktorego ten komponent
    // nie robi (i nie ma robic).
    zamontuj([akapit("p1", "Treaty")], { lang: "en" });
    expect(
      screen.getByText(t("blocks.codeView.desc", { lang: "EN", count: 1 })),
    ).toBeInTheDocument();
    expect(screen.getByText(/\bEN\b/)).toBeInTheDocument();
  });

  it("dokument polski opisuje sie znacznikiem PL - te same dwie wersje, dwa opisy", () => {
    zamontuj([akapit("p1", "Traktat")], { lang: "pl" });
    expect(
      screen.getByText(t("blocks.codeView.desc", { lang: "PL", count: 1 })),
    ).toBeInTheDocument();
  });
});

describe("CodeViewDialog - kopiowanie do schowka", () => {
  it("kopiowanie wklada CALY markup do schowka i potwierdza toastem", async () => {
    zamontuj([akapit("p1", "Traktat lizbonski")]);
    const markup = poleMarkupu().value;
    await act(async () => {
      fireEvent.click(przyciskKopiowania());
    });
    expect(wlozoneDoSchowka).toEqual([markup]);
    expect(sukces).toHaveBeenCalledWith(t("blocks.codeView.copied"));
    expect(blad).not.toHaveBeenCalled();
  });

  it("po udanym kopiowaniu przycisk pokazuje potwierdzenie", async () => {
    zamontuj();
    expect(pokazujePotwierdzenie()).toBe(false);
    await act(async () => {
      fireEvent.click(przyciskKopiowania());
    });
    await waitFor(() => expect(pokazujePotwierdzenie()).toBe(true));
  });

  it("potwierdzenie GASNIE po 1,5 s, wiec drugi klik znowu widac", async () => {
    // Zegar atrapowy MUSI stac PRZED klikiem: `setTimeout` zaplanowany na
    // prawdziwym zegarze nie przechodzi pod kontrole atrapy zalozonej pozniej,
    // wiec przewijanie czasu nie ruszyloby go wcale, a asercja mierzylaby
    // wylacznie to, ze 1,5 s jeszcze nie minelo.
    // `shouldAdvanceTime` zostawia mikrozadania Reacta w ruchu, dzieki czemu
    // `await act(...)` i `waitFor` dalej dobiegaja do konca.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    zamontuj();
    await act(async () => {
      fireEvent.click(przyciskKopiowania());
    });
    await waitFor(() => expect(pokazujePotwierdzenie()).toBe(true));

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(pokazujePotwierdzenie()).toBe(false);
  });

  it("po zgasnieciu potwierdzenia DRUGI klik znowu wklada markup do schowka", async () => {
    // Kolejny raz, bo redaktor kopiuje ten sam markup do kilku miejsc naraz -
    // przycisk nie ma prawa zostac „zuzyty" po pierwszym uzyciu.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    zamontuj([akapit("p1", "Traktat lizbonski")]);
    const markup = poleMarkupu().value;
    await act(async () => {
      fireEvent.click(przyciskKopiowania());
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {
      fireEvent.click(przyciskKopiowania());
    });
    expect(wlozoneDoSchowka).toEqual([markup, markup]);
    expect(pokazujePotwierdzenie()).toBe(true);
  });

  it("ODMOWA schowka mowi o porazce i NIE udaje sukcesu", async () => {
    // Przegladarka odmawia dostepu do schowka poza HTTPS i bez gestu
    // uzytkownika. Cicha porazka konczylaby sie wklejeniem STAREJ zawartosci
    // schowka do obcego edytora.
    podstawSchowek(true);
    zamontuj();
    await act(async () => {
      fireEvent.click(przyciskKopiowania());
    });
    expect(blad).toHaveBeenCalledWith(t("blocks.codeView.copyFailed"));
    expect(sukces).not.toHaveBeenCalled();
  });

  it("po ODMOWIE przycisk NIE pokazuje potwierdzenia", async () => {
    podstawSchowek(true);
    zamontuj();
    await act(async () => {
      fireEvent.click(przyciskKopiowania());
    });
    expect(pokazujePotwierdzenie()).toBe(false);
  });

  it("BRAK API schowka w ogole nie wywraca okna", async () => {
    // Starsze przegladarki i konteksty niezaufane nie maja `navigator.clipboard`.
    // `await navigator.clipboard.writeText(...)` rzuca wtedy TypeError - i to
    // tez ma zlapac `catch`, a nie polecieć do konsoli.
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    zamontuj();
    await act(async () => {
      fireEvent.click(przyciskKopiowania());
    });
    expect(blad).toHaveBeenCalledWith(t("blocks.codeView.copyFailed"));
    expect(sukces).not.toHaveBeenCalled();
  });
});

describe("CodeViewDialog - i18n PL/EN", () => {
  it("napisy okna istnieja w OBU slownikach i sie roznia", () => {
    const klucze = [
      "blocks.codeView.title",
      "blocks.codeView.copy",
      "blocks.codeView.copied",
      "blocks.codeView.copyFailed",
    ];
    for (const klucz of klucze) {
      expect(t(klucz)).not.toBe(klucz);
      expect(tEn(klucz)).not.toBe(klucz);
      expect(t(klucz)).not.toBe(tEn(klucz));
    }
  });
});
