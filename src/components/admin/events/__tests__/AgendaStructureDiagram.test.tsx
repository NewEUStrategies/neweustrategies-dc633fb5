// Molekuła „STRUKTURA AGENDY" - rysunek, który tłumaczy różnicę między sesją
// a ścieżką, i JEDNOCZEŚNIE pokazuje stan programu.
//
// CO TEN PLIK DOWODZI.
//   1. RYSUJEMY PRAWDZIWE DANE, NIE ATRAPĘ. Kolumna to realne pasmo z jego
//      kolorem i licznikiem sesji - gdyby rysunek był ozdobą, ten sam obrazek
//      wyglądałby tak samo przy pustym i pełnym programie.
//   2. SESJE BEZ ŚCIEŻKI MAJĄ WŁASNĄ KOLUMNĘ, bo to normalny stan programu,
//      a nie błąd - ale kolumna pojawia się TYLKO wtedy, gdy takie sesje są.
//   3. PODŚWIETLENIE ZALEŻY OD EKRANU, NA KTÓRYM STOIMY. Legenda „sesja" jest
//      wyróżniona na liście sesji, „ścieżka" na liście ścieżek - to jedyna
//      rzecz, która wiąże rysunek z miejscem, w którym się go czyta.
//   4. KOLUMNA POKAZUJE NAJWYŻEJ TRZY KAFLE, RESZTĘ LICZY. Rysunek pasma
//      z czterdziestoma sesjami byłby ścianą kresek, a nie wyjaśnieniem.
//   5. PUSTE PASMO NADAL JEST KOLUMNĄ. Kolumna zapadnięta do kreski czyta się
//      jak awaria rysunku, a nie jak „tu jeszcze nic nie zaplanowano".
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Liczenia sesji na pasmo - molekuła dostaje
// gotowe wiersze od organizmu i niczego nie pyta. (2) Słownika - `t()` jest
// echem klucza, więc asercje stoją na KLUCZACH, a nie na polskim napisie.
//
// KAFLE I KOLORY SĄ CZYTANE PRZEZ DOM, nie przez rolę: to warstwa czysto
// wzrokowa (`aria-hidden`), więc drzewo dostępności jej nie widzi - i dobrze,
// bo czytnik ekranu dostaje te same liczby napisem obok.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AgendaDiagramTrack } from "@/components/admin/events/molecules/AgendaStructureDiagram";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const { AgendaStructureDiagram } =
  await import("@/components/admin/events/molecules/AgendaStructureDiagram");

const S = "adminEventAgenda.structure.";

function pasmo(overrides: Partial<AgendaDiagramTrack> = {}): AgendaDiagramTrack {
  return {
    id: "track-a",
    name: "Ścieżka Cyfrowa",
    accentColor: "#fa9346",
    sessionsCount: 2,
    ...overrides,
  };
}

function renderuj(
  props: {
    tracks?: readonly AgendaDiagramTrack[];
    unassignedCount?: number;
    highlight?: "sessions" | "tracks";
    className?: string;
  } = {},
) {
  return render(
    <AgendaStructureDiagram
      tracks={props.tracks ?? [pasmo()]}
      unassignedCount={props.unassignedCount ?? 0}
      highlight={props.highlight ?? "sessions"}
      className={props.className}
    />,
  );
}

/** Kolumna rysunku po widocznej nazwie pasma. */
function kolumna(nazwa: string): HTMLElement {
  const naglowek = screen.getByText(nazwa);
  const kolumna = naglowek.closest("div")?.parentElement;
  if (kolumna === null || kolumna === undefined) throw new Error(`brak kolumny „${nazwa}”`);
  return kolumna;
}

/** Kafle sesji w kolumnie - warstwa czysto wzrokowa. */
const kafle = (nazwa: string): HTMLElement[] =>
  Array.from(kolumna(nazwa).querySelectorAll<HTMLElement>("div.h-6"));

/** Ramka pozycji legendy - podświetlenie siedzi na niej, nie na tekście. */
function pozycjaLegendy(term: string): HTMLElement {
  const opis = screen.getByText(term).closest("div");
  if (opis === null) throw new Error(`brak pozycji legendy „${term}”`);
  return opis;
}

describe("AgendaStructureDiagram - legenda", () => {
  it("rysunek jest nazwany i tłumaczy trzy pojęcia naraz", () => {
    // Bez nazwy sekcji czytnik ekranu ogłasza „grupa" - rysunek, którego nie
    // widać, powinien dać się chociaż zapowiedzieć.
    renderuj();
    expect(screen.getByRole("region", { name: `${S}title` })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: `${S}title` })).toBeInTheDocument();
    expect(screen.getByText(`${S}lead`)).toBeInTheDocument();
    expect(screen.getByText(`${S}sessionTerm`)).toBeInTheDocument();
    expect(screen.getByText(`${S}trackTerm`)).toBeInTheDocument();
    expect(screen.getByText(`${S}roomTerm`)).toBeInTheDocument();
    expect(screen.getByText(`${S}sessionDetail`)).toBeInTheDocument();
  });

  it("na ekranie SESJI wyróżniona jest legenda sesji", () => {
    renderuj({ highlight: "sessions" });
    expect(pozycjaLegendy(`${S}sessionTerm`).className).toContain("border-primary/60");
    expect(pozycjaLegendy(`${S}trackTerm`).className).not.toContain("border-primary/60");
  });

  it("na ekranie ŚCIEŻEK wyróżnienie przenosi się na legendę ścieżki", () => {
    // Kontrapunkt do przypadku wyżej: gdyby wyróżnienie było przyklejone na
    // stałe, rysunek na jednym z dwóch ekranów wskazywałby nie to pojęcie.
    renderuj({ highlight: "tracks" });
    expect(pozycjaLegendy(`${S}trackTerm`).className).toContain("border-primary/60");
    expect(pozycjaLegendy(`${S}sessionTerm`).className).not.toContain("border-primary/60");
  });

  it("legenda SALI nie jest wyróżniona na żadnym z ekranów", () => {
    // Sala jest tu tylko dopowiedzeniem - nie ma ekranu, na którym rysunek
    // miałby ją wskazywać.
    renderuj({ highlight: "tracks" });
    expect(pozycjaLegendy(`${S}roomTerm`).className).not.toContain("border-primary/60");
  });
});

describe("AgendaStructureDiagram - kolumny", () => {
  it("każde pasmo jest kolumną z własnym kolorem i licznikiem sesji", () => {
    renderuj({
      tracks: [
        pasmo({ sessionsCount: 2 }),
        pasmo({ id: "track-b", name: "Ścieżka Zielona", accentColor: "#2f6f4f", sessionsCount: 1 }),
      ],
    });

    expect(screen.getByText("adminEventAgenda.tracks.sessionsCount(count=2)")).toBeInTheDocument();
    expect(screen.getByText("adminEventAgenda.tracks.sessionsCount(count=1)")).toBeInTheDocument();
    const znacznik = kolumna("Ścieżka Zielona").querySelector<HTMLElement>("span[aria-hidden]");
    expect(znacznik?.getAttribute("style")).toContain("background-color: #2f6f4f");
  });

  it("sesje BEZ ścieżki dostają własną kolumnę na końcu", () => {
    // To normalny stan programu, a nie błąd: nowa sesja rodzi się bez pasma.
    // Ukrycie jej sprawiłoby, że licznik na rysunku nie zgadza się z listą.
    renderuj({ tracks: [pasmo()], unassignedCount: 4 });
    expect(screen.getByText(`${S}noTrackColumn`)).toBeInTheDocument();
    expect(screen.getByText("adminEventAgenda.tracks.sessionsCount(count=4)")).toBeInTheDocument();
  });

  it("brak sesji bez ścieżki NIE dorysowuje pustej kolumny", () => {
    renderuj({ tracks: [pasmo()], unassignedCount: 0 });
    expect(screen.queryByText(`${S}noTrackColumn`)).not.toBeInTheDocument();
  });

  it("program bez ścieżek i bez sesji mówi, że nie ma czego rysować", () => {
    // Rysunek z zerem kolumn to pusty prostokąt - a pusty prostokąt czyta się
    // jak awaria, nie jak „zacznij od dodania ścieżki".
    renderuj({ tracks: [], unassignedCount: 0 });
    expect(screen.getByText(`${S}emptyDiagram`)).toBeInTheDocument();
    expect(screen.queryByText("Ścieżka Cyfrowa")).not.toBeInTheDocument();
  });

  it("same sesje bez ścieżki wystarczą, żeby rysunek miał co pokazać", () => {
    renderuj({ tracks: [], unassignedCount: 3 });
    expect(screen.queryByText(`${S}emptyDiagram`)).not.toBeInTheDocument();
    expect(screen.getByText(`${S}noTrackColumn`)).toBeInTheDocument();
  });

  it("dodatkowa klasa z zewnątrz dochodzi do sekcji, nie gubi się po drodze", () => {
    renderuj({ className: "mt-6" });
    expect(screen.getByRole("region", { name: `${S}title` }).className).toContain("mt-6");
  });
});

describe("AgendaStructureDiagram - kafle sesji", () => {
  it("kolumna rysuje najwyżej trzy kafle, a resztę LICZY", () => {
    renderuj({ tracks: [pasmo({ sessionsCount: 7 })] });
    expect(kafle("Ścieżka Cyfrowa")).toHaveLength(3);
    expect(screen.getByText(`${S}moreSessions(count=4)`)).toBeInTheDocument();
  });

  it("dokładnie trzy sesje nie dokładają napisu „+N”", () => {
    // Granica, nie „gdzieś w okolicy": przy trzech sesjach napis „i jeszcze 0"
    // byłby jawną nieprawdą.
    renderuj({ tracks: [pasmo({ sessionsCount: 3 })] });
    expect(kafle("Ścieżka Cyfrowa")).toHaveLength(3);
    expect(screen.queryByText(new RegExp(`${S}moreSessions`))).not.toBeInTheDocument();
  });

  it("puste pasmo rysuje JEDEN kafel-widmo, żeby kolumna się nie zapadła", () => {
    renderuj({ tracks: [pasmo({ sessionsCount: 0 })] });
    const widma = kafle("Ścieżka Cyfrowa");
    expect(widma).toHaveLength(1);
    // Kafel-widmo jest przygaszony - inaczej pasmo bez sesji wyglądałoby jak
    // pasmo z jedną sesją.
    expect(widma[0].className).toContain("opacity-40");
    expect(widma[0].className).not.toContain("bg-muted");
    expect(widma[0].getAttribute("style")).toBeNull();
  });

  it("kafel niesie kolor swojego pasma, kolumna „bez ścieżki” nie niesie żadnego", () => {
    // Kolor jest jedyną rzeczą, która wiąże kafel z nagłówkiem kolumny, gdy
    // kolumn jest więcej niż mieści się na ekranie. Kolumna zbiorcza koloru nie
    // ma i nie może udawać, że ma.
    renderuj({ tracks: [pasmo({ sessionsCount: 2 })], unassignedCount: 2 });

    const kolorowe = kafle("Ścieżka Cyfrowa");
    expect(kolorowe).toHaveLength(2);
    expect(kolorowe[0]).toHaveStyle({
      borderLeftWidth: "3px",
      borderLeftStyle: "solid",
      borderLeftColor: "#fa9346",
    });
    expect(kolorowe[0].className).toContain("bg-muted");

    const bezpanskie = kafle(`${S}noTrackColumn`);
    expect(bezpanskie).toHaveLength(2);
    expect(bezpanskie[0].getAttribute("style")).toBeNull();
  });
});
