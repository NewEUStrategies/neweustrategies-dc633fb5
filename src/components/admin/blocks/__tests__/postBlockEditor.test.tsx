// GLOWNY EDYTOR WPISU (`PostBlockEditor`) - obudowa kanwy: historia undo/redo,
// dwie zakladki jezykowe, skroty klawiaturowe, sidebar i widok kodu.
//
// DLACZEGO TA WARSTWA DECYDUJE O TRESCI REDAKTORA
// `PostBlockEditor` jest JEDYNYM miejscem, w ktorym mieszka historia zmian
// dokumentu. Kanwa nie wie nic o cofaniu - wypycha `onChange`, a stos undo/redo
// zyje tutaj (przez `useLocalizedBlocksHistory`). Dlatego kazdy blad w tej
// obudowie zabiera redaktorowi nie „przycisk", a mozliwosc odzyskania tresci.
//
// CO MA TU DOWOD
//   * cofanie i ponawianie sa WYLACZONE, dopoki nie ma czego cofac, i wlaczaja
//     sie po realnej zmianie dokumentu,
//   * cofniecie wraca do POPRZEDNIEJ tresci, a ponowienie ja przywraca -
//     asercje ida na dokument oddany rodzicowi, nie na stan wewnetrzny,
//   * skroty Ctrl/Cmd+Z, Ctrl+Shift+Z i Ctrl+Y robia to samo, co przyciski,
//   * cofanie z WNETRZA tresci (contenteditable) jest oddane TipTapowi, a
//     ponawianie nie - to jest swiadomy podzial i milczaca zmiana tutaj
//     oznaczalaby, ze Ctrl+Z cofa naraz dwa poziomy w dwoch stosach,
//   * Alt+strzalka przestawia AKTYWNY blok, takze podczas pisania,
//   * przelaczenie jezyka zmienia dokument na wersje tego jezyka, gasi aktywny
//     blok i ZERUJE historie (stosy sa per jezyk - inaczej cofniecie w EN
//     wstawialoby tresc PL),
//   * ECHO AUTOSAVE'U: rodzic, ktory oddaje TEN SAM obiekt dokumentu, NIE psuje
//     historii (to jest naprawiony defekt „dead undo"); rodzic, ktory oddaje
//     NOWY obiekt o tej samej tresci, historie zeruje - i to jest defekt
//     zarejestrowany `it.fails` w `undoAfterBackgroundSave.test.ts`, tu opisany
//     asercja STANU FAKTYCZNEGO (bez dublowania tamtej porazki).
//
// CZEGO TU NIE MA
//   * atrap warstw wlasnych: renderuje sie prawdziwa kanwa, prawdziwy sidebar,
//     prawdziwy dyspozytor edytorow i prawdziwy hook historii. Mockowane sa
//     tylko granice: `sonner` (toasty) i przewodnik onboardingowy
//     (`CoachmarkTour` mierzy geometrie, ktorej happy-dom nie ma),
//   * asercji na zawartosc sidebara - to osobna powierzchnia.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { Block, BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Przewodnik onboardingowy mierzy pozycje kotwic `data-tour` przez
// `getBoundingClientRect` (happy-dom zwraca zera) i sam z siebie nic nie wnosi
// do dowodu o historii dokumentu. Granica UI - atrapa bez zachowania.
vi.mock("@/components/admin/onboarding/CoachmarkTour", () => ({
  CoachmarkTour: () => null,
}));

const { PostBlockEditor } = await import("../PostBlockEditor");

const t = realT("pl");

function akapit(id: string, tekst: string): Block {
  return { id, type: "paragraph", data: { html: `<p>${tekst}</p>` } } as Block;
}

function doc(blocks: Block[]): BlocksDoc {
  return { version: 1, blocks } as BlocksDoc;
}

function wartosc(pl: Block[], en: Block[] = []): LocalizedBlocks {
  return { pl: doc(pl), en: doc(en) };
}

/**
 * Montuje edytor z RODZICEM, ktory zachowuje sie jak formularz wpisu: trzyma
 * `value` w stanie i oddaje edytorowi ten sam obiekt, ktory od niego dostal.
 * Bez tego echa historia zerowalaby sie po kazdym uderzeniu w klawisz - i to
 * jest naprawiony defekt „dead undo", nie ustepstwo testu.
 */
function zamontuj(startowa: LocalizedBlocks = wartosc([akapit("p1", "pierwszy")])) {
  const zmiany: LocalizedBlocks[] = [];
  let ustawZewnetrznie: ((next: LocalizedBlocks) => void) | null = null;

  function Rodzic() {
    const [v, setV] = useState(startowa);
    ustawZewnetrznie = setV;
    return (
      <PostBlockEditor
        value={v}
        onChange={(next) => {
          zmiany.push(next);
          setV(next);
        }}
        documentPane={<div data-testid="panel-dokumentu" />}
      />
    );
  }

  render(<Rodzic />);
  return {
    zmiany,
    /** Podmiana `value` z ZEWNATRZ - jak wczytanie z serwera albo autosave. */
    zZewnatrz(next: LocalizedBlocks) {
      act(() => ustawZewnetrznie?.(next));
    },
    /**
     * Echo autosave'u: NOWY obiekt dokumentu o IDENTYCZNEJ tresci. Dokladnie
     * taki kształt produkuje `replaceFormImageUrls` po utrwaleniu wklejonego
     * obrazu `data:`.
     */
    echoKopii() {
      const ostatnia = zmiany.at(-1);
      if (!ostatnia) throw new Error("brak stanu do skopiowania");
      const kopia: BlocksDoc = {
        ...ostatnia.pl,
        blocks: ostatnia.pl.blocks.map((b) => ({ ...b })),
      };
      act(() => ustawZewnetrznie?.({ ...ostatnia, pl: kopia }));
    },
  };
}

function przycisk(nazwa: string | RegExp): HTMLElement {
  return screen.getByRole("button", { name: nazwa });
}

/**
 * Przycisk historii DOKUMENTU. Zawezenie do `[data-tour="blocks-history"]` jest
 * konieczne: aktywny akapit pokazuje wlasny pasek TipTapa, ktorego przyciski
 * cofania nosza ten sam napis - a to sa DWIE ROZNE historie (dokumentu vs.
 * tekstu w bloku) i test nie moze ich mieszac.
 */
function przyciskHistorii(nazwa: string): HTMLElement {
  const pasek = document.querySelector('[data-tour="blocks-history"]');
  if (!(pasek instanceof HTMLElement)) throw new Error("brak paska historii dokumentu");
  return within(pasek).getByRole("button", { name: nazwa });
}

/** Przelacznik jezyka `EditorLangSwitch` adresujemy nazwa jezyka ze slownika. */
function przelaczNaEn(): void {
  fireEvent.click(przycisk(t("common.lang.en")));
}

/** Ostatni dokument PL oddany rodzicowi. */
function ostatniPl(zmiany: LocalizedBlocks[]): BlocksDoc {
  const ostatnia = zmiany.at(-1);
  if (!ostatnia) throw new Error("edytor nie oddal zadnej zmiany");
  return ostatnia.pl;
}

function idy(d: BlocksDoc): string[] {
  return d.blocks.map((b) => b.id);
}

/** Klika wiersz bloku w kanwie - blok staje sie AKTYWNY (jak w panelu). */
function aktywuj(blockId: string): void {
  const wiersz = document.querySelector(`[data-block-canvas] [data-block-id="${blockId}"]`);
  if (!wiersz) throw new Error(`brak wiersza bloku ${blockId} w kanwie`);
  fireEvent.click(wiersz);
}

/**
 * Wymusza REALNA zmiane dokumentu przez UI kanwy: aktywacja bloku klikiem
 * + Ctrl+Shift+D (duplikat, jak w WP). Swiadomie NIE dotykamy stanu
 * bezposrednio - historia ma zapisac zmiane, ktora zrobil redaktor.
 */
function zmienDokument(blockId = "p1"): void {
  aktywuj(blockId);
  // Zdarzenia klawiatury lecą z `document.body`, a nie z `document`: w
  // przeglądarce celem keydown jest ZAWSZE element (fokus na `<body>`, gdy
  // nic innego go nie ma), a `PostBlockEditor` czyta `target.closest(...)`.
  fireEvent.keyDown(document.body, { key: "d", ctrlKey: true, shiftKey: true });
}

describe("PostBlockEditor - montowanie", () => {
  it("renderuje kanwę, panel dokumentu i przełącznik języka", () => {
    zamontuj();
    expect(document.querySelector("[data-block-canvas]")).not.toBeNull();
    expect(screen.getByTestId("panel-dokumentu")).toBeInTheDocument();
    // Tresc bloku widac dwa razy: w kanwie i w List View sidebara.
    expect(screen.getAllByText("pierwszy").length).toBeGreaterThan(0);
  });

  it("brak wartości z rodzica daje pusty dokument, a nie wyjątek", () => {
    render(<PostBlockEditor value={null} onChange={() => {}} documentPane={null} />);
    expect(document.querySelector("[data-block-canvas]")).not.toBeNull();
  });

  it("obudowa kanwy (canvasWrap) dostaje kanwę i AKTYWNY język", () => {
    const jezyki: string[] = [];
    render(
      <PostBlockEditor
        value={wartosc([akapit("p1", "pierwszy")])}
        onChange={() => {}}
        documentPane={null}
        canvasWrap={(canvas, lang) => {
          jezyki.push(lang);
          return <div data-testid="obudowa">{canvas}</div>;
        }}
      />,
    );
    expect(screen.getByTestId("obudowa")).toBeInTheDocument();
    expect(jezyki[0]).toBe("pl");
  });

  it("link podglądu pojawia się tylko z podanym adresem", () => {
    const { unmount } = render(
      <PostBlockEditor value={null} onChange={() => {}} documentPane={null} />,
    );
    expect(screen.queryByRole("link", { name: t("blocks.actions.preview") })).toBeNull();
    unmount();
    render(
      <PostBlockEditor
        value={null}
        onChange={() => {}}
        documentPane={null}
        previewHref="/pl/wpis/traktat?preview=1"
      />,
    );
    const link = screen.getByRole("link", { name: t("blocks.actions.preview") });
    expect(link).toHaveAttribute("href", "/pl/wpis/traktat?preview=1");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});

describe("PostBlockEditor - historia undo/redo", () => {
  it("oba przyciski są WYŁĄCZONE, dopóki nie ma czego cofać", () => {
    zamontuj();
    expect(przyciskHistorii(t("blocks.actions.undo"))).toBeDisabled();
    expect(przyciskHistorii(t("blocks.actions.redo"))).toBeDisabled();
  });

  it("po realnej zmianie cofanie się włącza", () => {
    zamontuj();
    zmienDokument();
    expect(przyciskHistorii(t("blocks.actions.undo"))).toBeEnabled();
  });

  it("cofnięcie wraca do POPRZEDNIEJ treści dokumentu", () => {
    const { zmiany } = zamontuj();
    zmienDokument();
    expect(idy(ostatniPl(zmiany))).toHaveLength(2);
    fireEvent.click(przyciskHistorii(t("blocks.actions.undo")));
    expect(idy(ostatniPl(zmiany))).toEqual(["p1"]);
  });

  it("ponowienie przywraca cofniętą zmianę", () => {
    const { zmiany } = zamontuj();
    zmienDokument();
    fireEvent.click(przyciskHistorii(t("blocks.actions.undo")));
    expect(przyciskHistorii(t("blocks.actions.redo"))).toBeEnabled();
    fireEvent.click(przyciskHistorii(t("blocks.actions.redo")));
    expect(idy(ostatniPl(zmiany))).toHaveLength(2);
  });

  it("Ctrl+Z cofa POZA treścią bloku", () => {
    const { zmiany } = zamontuj();
    zmienDokument();
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(idy(ostatniPl(zmiany))).toEqual(["p1"]);
  });

  it("Cmd+Z cofa (parytet na macOS)", () => {
    const { zmiany } = zamontuj();
    zmienDokument();
    fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    expect(idy(ostatniPl(zmiany))).toEqual(["p1"]);
  });

  it("Ctrl+Shift+Z ponawia", () => {
    const { zmiany } = zamontuj();
    zmienDokument();
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(idy(ostatniPl(zmiany))).toHaveLength(2);
  });

  it("Ctrl+Y ponawia (parytet z Windows)", () => {
    const { zmiany } = zamontuj();
    zmienDokument();
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    expect(idy(ostatniPl(zmiany))).toHaveLength(2);
  });

  it("Ctrl+Z W TREŚCI bloku jest oddany edytorowi inline (TipTap ma własny stos)", () => {
    const { zmiany } = zamontuj();
    zmienDokument();
    const przed = idy(ostatniPl(zmiany));
    const pole = document.querySelector('[contenteditable="true"]');
    expect(pole).not.toBeNull();
    fireEvent.keyDown(pole as Element, { key: "z", ctrlKey: true });
    // Historia dokumentu nietknięta - cofanie tekstu należy do TipTapa.
    expect(idy(ostatniPl(zmiany))).toEqual(przed);
  });

  it("Ctrl+Shift+Z W TREŚCI bloku ponawia dokument (ponowienia TipTap nie przejmuje)", () => {
    const { zmiany } = zamontuj();
    zmienDokument();
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    const pole = document.querySelector('[contenteditable="true"]');
    fireEvent.keyDown(pole as Element, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(idy(ostatniPl(zmiany))).toHaveLength(2);
  });
});

describe("PostBlockEditor - Alt+strzalka przestawia aktywny blok", () => {
  function zDwomaAktywnym() {
    const wynik = zamontuj(wartosc([akapit("p1", "pierwszy"), akapit("p2", "drugi")]));
    aktywuj("p2");
    return wynik;
  }

  it("Alt+strzałka w górę przenosi aktywny blok wyżej", () => {
    const { zmiany } = zDwomaAktywnym();
    fireEvent.keyDown(document.body, { key: "ArrowUp", altKey: true });
    expect(idy(ostatniPl(zmiany))).toEqual(["p2", "p1"]);
  });

  it("Alt+strzałka w dół na OSTATNIM bloku nic nie zmienia", () => {
    const { zmiany } = zDwomaAktywnym();
    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true });
    expect(zmiany).toHaveLength(0);
  });

  it("Alt+strzałka bez aktywnego bloku nic nie zmienia", () => {
    const { zmiany } = zamontuj(wartosc([akapit("p1", "pierwszy"), akapit("p2", "drugi")]));
    fireEvent.keyDown(document.body, { key: "ArrowUp", altKey: true });
    expect(zmiany).toHaveLength(0);
  });
});

describe("PostBlockEditor - zakladki jezykowe", () => {
  const dwujezyczny = () =>
    wartosc([akapit("pl1", "wersja polska")], [akapit("en1", "english version")]);

  it("start pokazuje wersję polską", () => {
    zamontuj(dwujezyczny());
    expect(screen.getAllByText("wersja polska").length).toBeGreaterThan(0);
    expect(screen.queryByText("english version")).toBeNull();
  });

  it("przełączenie na EN pokazuje dokument angielski", () => {
    zamontuj(dwujezyczny());
    przelaczNaEn();
    expect(screen.getAllByText("english version").length).toBeGreaterThan(0);
    expect(screen.queryByText("wersja polska")).toBeNull();
  });

  it("przełączenie języka ZERUJE historię - stosy są per język", () => {
    // Inaczej cofnięcie w EN wstawiłoby treść z PL.
    zamontuj(dwujezyczny());
    zmienDokument("pl1");
    expect(przyciskHistorii(t("blocks.actions.undo"))).toBeEnabled();
    przelaczNaEn();
    expect(przyciskHistorii(t("blocks.actions.undo"))).toBeDisabled();
    expect(przyciskHistorii(t("blocks.actions.redo"))).toBeDisabled();
  });

  it("zmiana w EN nie rusza dokumentu PL", () => {
    const { zmiany } = zamontuj(dwujezyczny());
    przelaczNaEn();
    zmienDokument("en1");
    const ostatnia = zmiany.at(-1);
    expect(ostatnia).toBeDefined();
    expect(idy(ostatnia!.pl)).toEqual(["pl1"]);
    expect(idy(ostatnia!.en)).toHaveLength(2);
  });
});

describe("PostBlockEditor - echo autosave'u i historia", () => {
  it("echo rodzica z TYM SAMYM obiektem dokumentu NIE psuje historii", () => {
    // To jest naprawiony defekt „dead undo": każde uderzenie w klawisz szło
    // przez rodzica i nowa tożsamość obiektu zerowała stos.
    const { zmiany } = zamontuj();
    zmienDokument();
    expect(przyciskHistorii(t("blocks.actions.undo"))).toBeEnabled();
    // Rodzic w helperze oddaje dokładnie ten obiekt, który dostał - historia żyje.
    expect(zmiany.length).toBeGreaterThan(0);
    fireEvent.click(przyciskHistorii(t("blocks.actions.undo")));
    expect(idy(ostatniPl(zmiany))).toEqual(["p1"]);
  });

  it("podmiana `value` NOWYM obiektem o tej samej treści ZERUJE historię (stan faktyczny)", () => {
    // Tak zachowuje się autosave, który utrwalił wklejony obraz `data:`
    // i nałożył mapowanie URL-i na bieżący formularz. Defekt jest opisany
    // i zarejestrowany `it.fails` w `undoAfterBackgroundSave.test.ts`;
    // tutaj jest kontrola stanu na poziomie komponentu, żeby zmiana
    // zachowania (w którąkolwiek stronę) była widoczna także tutaj.
    const { echoKopii } = zamontuj();
    zmienDokument();
    expect(przyciskHistorii(t("blocks.actions.undo"))).toBeEnabled();
    // NOWY obiekt, IDENTYCZNA treść - dokładnie to robi `replaceFormImageUrls`.
    echoKopii();
    expect(przyciskHistorii(t("blocks.actions.undo"))).toBeDisabled();
  });

  it("wczytanie INNEJ treści z zewnątrz też zeruje historię (i to jest poprawne)", () => {
    const { zZewnatrz } = zamontuj();
    zmienDokument();
    zZewnatrz(wartosc([akapit("x1", "przywrócona rewizja")]));
    expect(przyciskHistorii(t("blocks.actions.undo"))).toBeDisabled();
    expect(screen.getAllByText("przywrócona rewizja").length).toBeGreaterThan(0);
  });
});

describe("PostBlockEditor - sidebar", () => {
  it("sidebar zwija się i rozwija", () => {
    zamontuj();
    fireEvent.click(przycisk(t("blocks.sidebar.collapse")));
    expect(przycisk(t("blocks.sidebar.expand"))).toBeInTheDocument();
    fireEvent.click(przycisk(t("blocks.sidebar.expand")));
    expect(przycisk(t("blocks.sidebar.collapse"))).toBeInTheDocument();
  });

  it("ZWINIĘTY sidebar daje skróty do obu zakładek, a rozwinięcie je wraca", () => {
    zamontuj();
    fireEvent.click(przycisk(t("blocks.sidebar.collapse")));
    // Skrót „Blok" jest wyłączony, dopóki nie ma aktywnego bloku.
    expect(przycisk(t("blocks.sidebar.block"))).toBeDisabled();
    fireEvent.click(przycisk(t("blocks.sidebar.document")));
    expect(screen.getByTestId("panel-dokumentu")).toBeInTheDocument();
  });

  it("zwinięty sidebar nie gubi kanwy ani historii", () => {
    zamontuj();
    zmienDokument();
    fireEvent.click(przycisk(t("blocks.sidebar.collapse")));
    expect(document.querySelector("[data-block-canvas]")).not.toBeNull();
    expect(przyciskHistorii(t("blocks.actions.undo"))).toBeEnabled();
  });
});

describe("PostBlockEditor - widok kodu", () => {
  it("przycisk widoku kodu otwiera podglad zrodla dokumentu", () => {
    zamontuj();
    fireEvent.click(przycisk(new RegExp(t("blocks.codeView.button"))));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
