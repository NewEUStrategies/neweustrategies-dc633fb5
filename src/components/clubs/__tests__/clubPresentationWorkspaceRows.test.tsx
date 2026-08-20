// Trzy WIERSZE przestrzeni roboczej wątku: pytanie w kolejce Q&A, pozycja
// harmonogramu i pozycja biblioteki źródeł.
//
// CO TEN PLIK DOWODZI.
//  (1) PYTANIE BEZ ODPOWIEDZI WYGLĄDA INACZEJ NIŻ ODPOWIEDZIANE - to jest cały
//      sens panelu Q&A, więc jest asercją, a nie komentarzem. Głos na ważność
//      jest PRZEŁĄCZNIKIEM (`aria-pressed`), nie parą przycisków.
//  (2) ODPOWIADAJĄCY JEST JAWNY TAKŻE W TRYBIE POUFNYM: odpowiedź prowadzącego
//      jest aktem oficjalnym. Brak nazwiska degraduje do neutralnej etykiety,
//      a nie do pustego miejsca.
//  (3) FORMULARZ ODPOWIEDZI NIE PUBLIKUJE PUSTEGO: przycisk jest wyłączony przy
//      samych białych znakach, a to, co dojeżdża do handlera, jest OBCIĘTE.
//      Anulowanie zwija formularz i nie wysyła niczego.
//  (4) TERMIN CAŁODNIOWY I TERMIN Z GODZINĄ RYSUJĄ SIĘ RÓŻNIE - bez tego
//      deadline konsultacji dostawał przypadkową północ i wyglądał jak
//      spotkanie. Zakres o identycznych końcach nie dubluje daty.
//  (5) WYDARZENIE PLATFORMY DOSTAJE LINK DO SWOJEJ STRONY, a nie kopię opisu;
//      adres zewnętrzny otwiera się z `rel="noopener noreferrer"`, bo źródła
//      wskazują poza platformę.
//  (6) PRAWO EDYCJI JEST ILOCZYNEM: `can_edit` z RPC ORAZ podany handler. Sam
//      `can_edit` bez handlera nie ma prawa narysować przycisku, który nic nie
//      robi - i odwrotnie.
//  (7) ROZMIAR NIEZNANY NIE JEST „0 B”, a domena bez protokołu buduje zaufanie
//      tylko wtedy, gdy da się ją sparsować - adres nie-URL nie produkuje
//      śmieci w pasku metadanych.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  (a) TABEL PRZYPADKÓW CZYSTYCH FUNKCJI: `formatBytes` i `milestoneWhen` mają
//      własne testy jednostkowe w `workspaceFormatting.test.ts`, a
//      `toClubDocumentKind`/`toClubMilestoneKind`/`toClubMilestoneStatus`/
//      `toClubQuestionStatus` w zakresie `threadWorkspaceTypes`. Tutaj
//      dowodzimy SKUTKU na ekranie (godzina jest albo jej nie ma, rozmiar
//      pokazuje się albo nie) - nie liczymy jednostek po raz drugi.
//  (b) PANELI, które te wiersze składają (`ClubDocumentLibrary`, panel pytań,
//      harmonogram) - mają własne pliki i tam wiersze są atrapami.
//  (c) Atomów `ClubStatusPill`, `ClubDocumentIcon`, `ClubMilestoneIcon`,
//      `ClubAuthorAvatar` - mają własne pliki.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ClubQuestionCard } from "@/components/clubs/molecules/ClubQuestionCard";
import { ClubMilestoneRow } from "@/components/clubs/molecules/ClubMilestoneRow";
import { ClubDocumentRow } from "@/components/clubs/molecules/ClubDocumentRow";
import {
  threadDocumentRow,
  threadMilestoneRow,
  threadQuestionRow,
  WS_BASE_ISO,
  wsIsoOffset,
} from "@/test/clubs/threadWorkspaceFixtures";

/** Godzina w napisie terminu - `\d{2}:\d{2}` niezależnie od locale. */
const GODZINA = /\d{1,2}:\d{2}/;

// ---------------------------------------------------------------------------
// ClubQuestionCard
// ---------------------------------------------------------------------------

describe("ClubQuestionCard - pytanie w kolejce", () => {
  it("pytanie otwarte niesie treść, autora, datę, status i licznik głosów", () => {
    render(
      <ClubQuestionCard
        row={threadQuestionRow({ vote_count: 5 })}
        lang="pl"
        votePending={false}
        answerPending={false}
        onVote={() => undefined}
        onAnswer={() => undefined}
      />,
    );
    expect(screen.getByText("Jak liczycie koszt bilansowania?")).toBeInTheDocument();
    expect(screen.getByText("Anna Nowak")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.questionStatus.open")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText(GODZINA)).toBeInTheDocument();
  });

  it("głos jest przełącznikiem: oddany zdejmuje się, nieoddany dodaje", () => {
    const onVote = vi.fn();
    const { rerender } = render(
      <ClubQuestionCard
        row={threadQuestionRow({ my_vote: false })}
        lang="pl"
        votePending={false}
        answerPending={false}
        onVote={onVote}
        onAnswer={() => undefined}
      />,
    );
    const glos = screen.getByRole("button", { name: "club.workspace.questions.vote" });
    expect(glos).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(glos);
    expect(onVote).toHaveBeenLastCalledWith(true);

    rerender(
      <ClubQuestionCard
        row={threadQuestionRow({ my_vote: true })}
        lang="pl"
        votePending={false}
        answerPending={false}
        onVote={onVote}
        onAnswer={() => undefined}
      />,
    );
    const oddany = screen.getByRole("button", { name: "club.workspace.questions.vote" });
    expect(oddany).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(oddany);
    expect(onVote).toHaveBeenLastCalledWith(false);
  });

  it("zapis głosu w toku blokuje przycisk", () => {
    render(
      <ClubQuestionCard
        row={threadQuestionRow()}
        lang="pl"
        votePending
        answerPending={false}
        onVote={() => undefined}
        onAnswer={() => undefined}
      />,
    );
    expect(
      screen.getByRole("button", { name: "club.workspace.questions.vote" }),
    ).toBeDisabled();
  });

  it("pytanie z autorem anonimowym bierze alias, a bez aliasu - konto usunięte", () => {
    const { rerender } = render(
      <ClubQuestionCard
        row={threadQuestionRow({ author_name: null, author_alias: "Uczestnik 3" })}
        lang="pl"
        votePending={false}
        answerPending={false}
        onVote={() => undefined}
        onAnswer={() => undefined}
      />,
    );
    expect(screen.getByText("club.anonymousAuthor")).toBeInTheDocument();

    rerender(
      <ClubQuestionCard
        row={threadQuestionRow({ author_name: "", author_alias: "" })}
        lang="pl"
        votePending={false}
        answerPending={false}
        onVote={() => undefined}
        onAnswer={() => undefined}
      />,
    );
    expect(screen.getByText("club.deletedAuthor")).toBeInTheDocument();
  });

  it("odpowiedź z podpisem i datą stoi w wyróżnionym bloku", () => {
    render(
      <ClubQuestionCard
        row={threadQuestionRow({
          status: "answered",
          answer_body: "Koszt liczymy z rynku bilansującego.",
          answered_by_name: "Jan Lis",
          answered_at: wsIsoOffset(90),
          can_answer: false,
        })}
        lang="pl"
        votePending={false}
        answerPending={false}
        onVote={() => undefined}
        onAnswer={() => undefined}
      />,
    );
    expect(screen.getByText("Koszt liczymy z rynku bilansującego.")).toBeInTheDocument();
    expect(
      screen.getByText(/club\.workspace\.questions\.answeredBy\(name=Jan Lis\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("club.workspace.questionStatus.answered")).toBeInTheDocument();
    // Bez prawa odpowiadania nie ma ani przycisku, ani formularza.
    expect(screen.queryByRole("button", { name: /answerCta|editAnswer/ })).toBeNull();
  });

  it("odpowiedź bez podpisu i bez daty degraduje do neutralnej etykiety", () => {
    render(
      <ClubQuestionCard
        row={threadQuestionRow({
          status: "answered",
          answer_body: "Odpowiedź klubu.",
          answered_by_name: null,
          answered_at: null,
          can_answer: false,
        })}
        lang="en"
        votePending={false}
        answerPending={false}
        onVote={() => undefined}
        onAnswer={() => undefined}
      />,
    );
    expect(screen.getByText("club.workspace.questions.answer")).toBeInTheDocument();
    expect(screen.queryByText(/answeredBy/)).not.toBeInTheDocument();
  });

  it("formularz odpowiedzi: nie publikuje pustego, obcina i zwija się po anulowaniu", () => {
    const onAnswer = vi.fn();
    render(
      <ClubQuestionCard
        row={threadQuestionRow({ can_answer: true })}
        lang="pl"
        votePending={false}
        answerPending={false}
        onVote={() => undefined}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "club.workspace.questions.answerCta" }),
    );
    const pole = screen.getByLabelText("club.workspace.questions.answerLabel");
    const publikuj = screen.getByRole("button", {
      name: "club.workspace.questions.publishAnswer",
    });
    // Puste pole i same białe znaki to ten sam stan: nie ma czego publikować.
    expect(publikuj).toBeDisabled();
    fireEvent.change(pole, { target: { value: "   " } });
    expect(publikuj).toBeDisabled();

    fireEvent.change(pole, { target: { value: "  Odpowiadam wprost.  " } });
    expect(publikuj).toBeEnabled();
    fireEvent.click(publikuj);
    expect(onAnswer).toHaveBeenCalledWith("Odpowiadam wprost.");

    fireEvent.click(screen.getByRole("button", { name: "club.workspace.cancel" }));
    expect(
      screen.queryByLabelText("club.workspace.questions.answerLabel"),
    ).not.toBeInTheDocument();
  });

  it("odpowiedź już jest, więc przycisk mówi „popraw”, a pole startuje z jej treścią", () => {
    render(
      <ClubQuestionCard
        row={threadQuestionRow({
          status: "answered",
          answer_body: "Wersja pierwsza.",
          can_answer: true,
        })}
        lang="pl"
        votePending={false}
        answerPending
        onVote={() => undefined}
        onAnswer={() => undefined}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "club.workspace.questions.editAnswer" }),
    );
    expect(screen.getByLabelText("club.workspace.questions.answerLabel")).toHaveValue(
      "Wersja pierwsza.",
    );
    // Zapis w toku blokuje publikację, mimo niepustej treści.
    expect(
      screen.getByRole("button", { name: "club.workspace.questions.publishAnswer" }),
    ).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// ClubMilestoneRow
// ---------------------------------------------------------------------------

describe("ClubMilestoneRow - jedna pozycja harmonogramu", () => {
  it("termin punktowy pokazuje godzinę, całodniowy jej NIE pokazuje", () => {
    const { rerender } = render(
      <ClubMilestoneRow row={threadMilestoneRow({ all_day: false })} lang="pl" />,
    );
    expect(screen.getByRole("time")).toHaveTextContent(GODZINA);

    rerender(<ClubMilestoneRow row={threadMilestoneRow({ all_day: true })} lang="pl" />);
    expect(screen.getByRole("time")).not.toHaveTextContent(GODZINA);
  });

  it.each([
    ["zakres o identycznych końcach nie dubluje daty", WS_BASE_ISO, false],
    ["zakres o różnych końcach pokazuje oba", wsIsoOffset(60 * 24), true],
  ])("%s", (_nazwa, ends: string, oczekujeZakresu: boolean) => {
    render(<ClubMilestoneRow row={threadMilestoneRow({ ends_at: ends })} lang="pl" />);
    const napis = screen.getByRole("time").textContent ?? "";
    expect(napis.includes(" - ")).toBe(oczekujeZakresu);
  });

  it("zakres całodniowy o identycznych dniach też się nie dubluje", () => {
    render(
      <ClubMilestoneRow
        row={threadMilestoneRow({ all_day: true, ends_at: wsIsoOffset(60 * 3) })}
        lang="en"
      />,
    );
    expect(screen.getByRole("time").textContent).not.toContain(" - ");
  });

  it.each([
    ["zaplanowany", "planned", "bg-primary/10"],
    ["zrobiony", "done", "bg-emerald-500/10"],
    ["odwołany", "cancelled", "bg-muted"],
    ["status nieznany z nowszej migracji", "przelozony", "bg-primary/10"],
  ])("status „%s” maluje kafel ikony", (_nazwa, status: string, klasa: string) => {
    const { container } = render(
      <ClubMilestoneRow row={threadMilestoneRow({ status })} lang="pl" />,
    );
    const kafel = container.querySelector("li > span");
    expect(kafel?.className).toContain(klasa);
  });

  it("dane pełne: opis, miejsce, właściciel, link do wydarzenia i adres zewnętrzny", () => {
    render(
      <ClubMilestoneRow
        row={threadMilestoneRow({
          kind: "consultation",
          description: "Uwagi zbieramy do końca miesiąca.",
          location: "Bruksela, Rue de la Loi 200",
          owner_name: "Jan Lis",
          event_slug: "konsultacje-rynek-mocy",
          url: "https://example.test/konsultacje",
        })}
        lang="pl"
      />,
    );
    expect(screen.getByText("Uwagi zbieramy do końca miesiąca.")).toBeInTheDocument();
    expect(screen.getByText("Bruksela, Rue de la Loi 200")).toBeInTheDocument();
    expect(
      screen.getByText("club.workspace.schedule.owner(name=Jan Lis)"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "club.workspace.schedule.openEvent" }),
    ).toHaveAttribute("href", "/events/konsultacje-rynek-mocy");
    const zewnetrzny = screen.getByRole("link", { name: "club.workspace.openLink" });
    expect(zewnetrzny).toHaveAttribute("rel", "noopener noreferrer");
    expect(zewnetrzny).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/club\.workspace\.milestoneKind\.consultation/)).toBeInTheDocument();
  });

  it.each([
    ["pola opcjonalne puste (`null`)", threadMilestoneRow()],
    [
      "pola opcjonalne obecne, ale puste (napis zerowej długości)",
      threadMilestoneRow({ description: "", location: "", event_slug: "", url: "" }),
    ],
  ])("%s nie zostawia po sobie żadnego wiersza metadanych", (_nazwa, row) => {
    render(<ClubMilestoneRow row={row} lang="pl" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/club\.workspace\.schedule\.owner/)).toBeNull();
    expect(screen.queryByText(/club\.workspace\.openLink/)).toBeNull();
  });

  it.each([
    ["oba handlery", true, true, 2],
    ["tylko edycja", true, false, 1],
    ["tylko usunięcie", false, true, 1],
    ["bez handlerów - `can_edit` sam nic nie znaczy", false, false, 0],
  ])("%s daje %s przycisków akcji", (_nazwa, edycja: boolean, usuniecie: boolean, ile: number) => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    render(
      <ClubMilestoneRow
        row={threadMilestoneRow({ can_edit: true })}
        lang="pl"
        onEdit={edycja ? onEdit : undefined}
        onRemove={usuniecie ? onRemove : undefined}
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(ile);
    if (edycja) {
      fireEvent.click(screen.getByRole("button", { name: "club.editor.edit" }));
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "milestone-1" }));
    }
    if (usuniecie) {
      fireEvent.click(screen.getByRole("button", { name: "club.workspace.remove" }));
      expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: "milestone-1" }));
    }
  });

  it("bez prawa edycji z RPC handlery nie dostają przycisków", () => {
    render(
      <ClubMilestoneRow
        row={threadMilestoneRow({ can_edit: false })}
        lang="pl"
        onEdit={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ClubDocumentRow
// ---------------------------------------------------------------------------

describe("ClubDocumentRow - pozycja bibliograficzna, nie kafelek pliku", () => {
  it("dane pełne: tytuł jako link, wyróżnienie, cztery fakty w pasku i kto wniósł", () => {
    render(
      <ClubDocumentRow
        row={threadDocumentRow({
          kind: "dataset",
          is_primary: true,
          source_label: "Komisja Europejska",
          published_on: "2026-03-12",
          byte_size: 20480,
          url: "https://www.example.test/dane.csv",
          description: "Zbiór danych o mocach zainstalowanych.",
        })}
        lang="pl"
      />,
    );
    const link = screen.getByRole("link", { name: /Analiza rynku mocy/ });
    expect(link).toHaveAttribute("href", "https://www.example.test/dane.csv");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("club.workspace.documents.primary")).toBeInTheDocument();
    expect(screen.getByText("club.workspace.documentKind.dataset")).toBeInTheDocument();
    expect(screen.getByText("Komisja Europejska")).toBeInTheDocument();
    expect(screen.getByText("20 kB")).toBeInTheDocument();
    // Domena bez protokołu i bez `www.` - w tym pasku liczy się nazwa.
    expect(screen.getByText("example.test")).toBeInTheDocument();
    expect(screen.getByText("Zbiór danych o mocach zainstalowanych.")).toBeInTheDocument();
    expect(
      screen.getByText("club.workspace.documents.addedBy(name=Anna Nowak)"),
    ).toBeInTheDocument();
  });

  it("źródło bez adresu nie udaje linku i nie dokłada domeny", () => {
    const { container } = render(
      <ClubDocumentRow
        row={threadDocumentRow({
          kind: "note",
          url: null,
          byte_size: null,
          added_by_name: null,
          description: null,
          is_primary: false,
        })}
        lang="pl"
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Analiza rynku mocy")).toBeInTheDocument();
    expect(screen.queryByText("club.workspace.documents.primary")).not.toBeInTheDocument();
    expect(screen.queryByText(/addedBy/)).not.toBeInTheDocument();
    // Jedyny fakt, który zostaje, to rodzaj źródła.
    expect(container.querySelectorAll("ul > li")).toHaveLength(1);
  });

  it("adres pusty jest traktowany jak brak adresu", () => {
    render(<ClubDocumentRow row={threadDocumentRow({ url: "", description: "" })} lang="pl" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/example\.test/)).not.toBeInTheDocument();
  });

  it.each([
    ["adres nie-URL nie produkuje śmieci", "biblioteka-klubu", null],
    ["protokół inny niż http(s) nie jest domeną", "ftp://example.test/dane.csv", null],
    ["adres http oddaje samą nazwę", "http://analizy.example.test/a", "analizy.example.test"],
  ])("%s", (_nazwa, url: string, domena: string | null) => {
    render(<ClubDocumentRow row={threadDocumentRow({ url })} lang="pl" />);
    if (domena === null) {
      expect(screen.queryByText(/example\.test$/)).not.toBeInTheDocument();
    } else {
      expect(screen.getByText(domena)).toBeInTheDocument();
    }
    // Tytuł zostaje linkiem zawsze, gdy adres w ogóle jest - także wtedy, gdy
    // domeny nie da się z niego wyciągnąć.
    expect(screen.getByRole("link", { name: /Analiza rynku mocy/ })).toBeInTheDocument();
  });

  it.each([
    ["rozmiar nieznany", null, null],
    ["rozmiar zerowy nie jest „0 B”", 0, null],
    ["rozmiar spoza zakresu liczb", Number.NaN, null],
    ["bajty bez ułamka", 900, "900 B"],
    ["megabajty", 5 * 1024 * 1024, "5 MB"],
    ["gigabajty - jednostka nie rośnie dalej", 3 * 1024 * 1024 * 1024, "3 GB"],
  ])("%s", (_nazwa, byteSize: number | null, napis: string | null) => {
    render(<ClubDocumentRow row={threadDocumentRow({ byte_size: byteSize })} lang="pl" />);
    if (napis === null) {
      expect(screen.queryByText(/\b(B|kB|MB|GB)$/)).not.toBeInTheDocument();
    } else {
      expect(screen.getByText(napis)).toBeInTheDocument();
    }
  });

  it.each([
    ["oba handlery", true, true, 2],
    ["tylko edycja", true, false, 1],
    ["tylko usunięcie", false, true, 1],
    ["bez handlerów", false, false, 0],
  ])("%s daje %s przycisków akcji", (_nazwa, edycja: boolean, usuniecie: boolean, ile: number) => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    render(
      <ClubDocumentRow
        row={threadDocumentRow({ can_edit: true })}
        lang="pl"
        onEdit={edycja ? onEdit : undefined}
        onRemove={usuniecie ? onRemove : undefined}
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(ile);
    if (edycja) {
      fireEvent.click(screen.getByRole("button", { name: "club.editor.edit" }));
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "doc-1" }));
    }
    if (usuniecie) {
      fireEvent.click(screen.getByRole("button", { name: "club.workspace.remove" }));
      expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: "doc-1" }));
    }
  });

  it("bez prawa edycji z RPC nie ma akcji, nawet gdy handlery są podane", () => {
    const { container } = render(
      <ClubDocumentRow
        row={threadDocumentRow({ can_edit: false, published_on: null, source_label: null })}
        lang="en"
        onEdit={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(within(container).getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});
