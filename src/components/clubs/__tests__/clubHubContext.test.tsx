// Prawa szyna huba - panele kontekstu (`ClubHubContext.tsx`).
//
// CO TEN PLIK DOWODZI.
//  1. ZASADA „PANEL ZNIKA, GDY NIE MA TREŚCI” jest tu regułą produktu, nie
//     kosmetyką: panel „Etap” z napisem „brak” zajmuje tyle samo pionu co
//     panel z terminem i nie niesie nic. Oba panele mają więc stan PUSTY
//     dowiedziony osobno, bo to on decyduje o wysokości szyny.
//  2. WYBÓR BIEŻĄCEGO ETAPU: pierwszy `active`, a gdy takiego nie ma -
//     pierwszy `planned`. Etap zamknięty NIE jest kontekstem dla nowej
//     rozmowy, więc harmonogram złożony z samych `done`/`cancelled` milczy.
//  3. TERMIN: po terminie panel mówi „przeterminowany”, a nie datę - data
//     w kolorze ostrzeżenia wygląda jak termin, którego jeszcze można
//     dopilnować. Etap bez terminu nie rysuje tej linii wcale.
//  4. PASEK POSTĘPU zgłasza czytnikowi ekranu wartość SUROWĄ, a przycina
//     wyłącznie szerokość - wiersz z bazy z 140% nie może wysypać layoutu.
//  5. ŚWIEŻE MATERIAŁY: najwyżej trzy pozycje, a każda pozycja rozstrzyga
//     „plik albo link albo nic” - dokument bez żadnego źródła nie ma prawa
//     być linkiem, bo klik w niego kończy się pustym adresem.
//  6. Tytuły jadą w JĘZYKU INTERFEJSU (bliźniacze kolumny `_pl`/`_en`).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - REGUŁ `workspaceTypes`: `isMilestoneOverdue`, `documentHref`,
//    `toMilestoneState` i `toDocumentKind` mają własne testy na czystych
//    funkcjach (`clubWorkspace.test.ts`). Tutaj dowodzimy, że panel je WOŁA
//    i RESPEKTUJE wynik - nie przepisujemy tabeli przypadków.
//  - LOKALIZACJI: polityka `pickLocalized` (język żądany -> drugi -> "") ma
//    własny zakres; tutaj sprawdzamy tylko, że panel podaje język interfejsu.
//  - FORMATU DATY: asercja porównuje się z `formatDate()` wywołanym wprost,
//    a nie z wymyślonym napisem - inaczej test pilnowałby Intl, nie panelu.
//  - SZYNY jako całości: kolejność paneli w hubie należy do `ClubHub`
//    (`clubHubOrganisms.test.tsx`), a nie do tego pliku.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ lang: "pl" as string }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { ...actual, Link: RouterLinkStub };
});

import { ClubFreshDocsPanel, ClubStagePanel } from "@/components/clubs/molecules/ClubHubContext";
import { translateKey } from "@/test/i18nStub";
import { formatDate } from "@/lib/i18n/format";
import { CLUB_BASE_DAY, clubDocumentRow, clubMilestoneRow } from "@/test/clubs/hubFixtures";

const SLUG = "klub-energetyczny";

/** Dzień przesunięty względem `CLUB_BASE_DAY` - bez `new Date()` bez argumentu. */
function dayOffset(days: number): string {
  const base = new Date(`${CLUB_BASE_DAY}T00:00:00.000Z`);
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

afterEach(() => {
  cleanup();
  h.lang = "pl";
});

describe("ClubStagePanel - bieżący etap prac", () => {
  it("milczy w całości, gdy harmonogram jest pusty", () => {
    const { container } = render(
      <ClubStagePanel clubSlug={SLUG} milestones={[]} today={CLUB_BASE_DAY} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("milczy, gdy żaden etap nie jest ani aktywny, ani zaplanowany", () => {
    const { container } = render(
      <ClubStagePanel
        clubSlug={SLUG}
        milestones={[
          clubMilestoneRow({ id: "m-done", state: "done" }),
          clubMilestoneRow({ id: "m-cancelled", state: "cancelled" }),
        ]}
        today={CLUB_BASE_DAY}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("pokazuje pierwszy AKTYWNY etap, nawet gdy zaplanowany stoi wyżej na liście", () => {
    render(
      <ClubStagePanel
        clubSlug={SLUG}
        milestones={[
          clubMilestoneRow({ id: "m-planned", state: "planned", title_pl: "Zaplanowany" }),
          clubMilestoneRow({ id: "m-active", state: "active", title_pl: "Aktywny" }),
        ]}
        today={CLUB_BASE_DAY}
      />,
    );
    expect(screen.getByText("Aktywny")).toBeInTheDocument();
    expect(screen.queryByText("Zaplanowany")).toBeNull();
  });

  it("spada na pierwszy ZAPLANOWANY etap, gdy nic nie jest aktywne", () => {
    render(
      <ClubStagePanel
        clubSlug={SLUG}
        milestones={[
          clubMilestoneRow({ id: "m-done", state: "done", title_pl: "Zamknięty" }),
          clubMilestoneRow({ id: "m-planned", state: "planned", title_pl: "Zaplanowany" }),
        ]}
        today={CLUB_BASE_DAY}
      />,
    );
    expect(screen.getByText("Zaplanowany")).toBeInTheDocument();
  });

  it("etap po terminie mówi „przeterminowany”, a nie datę", () => {
    render(
      <ClubStagePanel
        clubSlug={SLUG}
        milestones={[clubMilestoneRow({ state: "active", due_on: dayOffset(-3) })]}
        today={CLUB_BASE_DAY}
      />,
    );
    const overdue = screen.getByText("club.schedule.overdue");
    expect(overdue).toBeInTheDocument();
    expect(overdue.className).toContain("text-destructive");
  });

  it("etap w terminie pokazuje datę w języku interfejsu", () => {
    const due = dayOffset(5);
    h.lang = "en";
    render(
      <ClubStagePanel
        clubSlug={SLUG}
        milestones={[clubMilestoneRow({ state: "active", due_on: due })]}
        today={CLUB_BASE_DAY}
      />,
    );
    const expected = translateKey("club.hub.stage.due", {
      date: formatDate(due, "en", { day: "numeric", month: "short" }),
    });
    const line = screen.getByText(expected);
    expect(line).toBeInTheDocument();
    expect(line.className).toContain("text-muted-foreground");
  });

  it("etap bez terminu nie rysuje linii z datą", () => {
    render(
      <ClubStagePanel
        clubSlug={SLUG}
        milestones={[clubMilestoneRow({ state: "active", due_on: null })]}
        today={CLUB_BASE_DAY}
      />,
    );
    expect(screen.queryByText("club.schedule.overdue")).toBeNull();
    expect(screen.queryByText(/^club\.hub\.stage\.due/)).toBeNull();
  });

  it("pasek postępu zgłasza wartość SUROWĄ, a przycina wyłącznie szerokość", () => {
    render(
      <ClubStagePanel
        clubSlug={SLUG}
        milestones={[clubMilestoneRow({ state: "active", progress: 140 })]}
        today={CLUB_BASE_DAY}
      />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "140");
    expect(bar.firstElementChild).toHaveStyle({ width: "100%" });
  });

  it("ujemny postęp z bazy nie wychodzi paskiem poza panel", () => {
    render(
      <ClubStagePanel
        clubSlug={SLUG}
        milestones={[clubMilestoneRow({ state: "active", progress: -20 })]}
        today={CLUB_BASE_DAY}
      />,
    );
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ width: "0%" });
  });

  it("licznik zamkniętych etapów liczy TYLKO stan „done”", () => {
    render(
      <ClubStagePanel
        clubSlug={SLUG}
        milestones={[
          clubMilestoneRow({ id: "m1", state: "active" }),
          clubMilestoneRow({ id: "m2", state: "done" }),
          clubMilestoneRow({ id: "m3", state: "cancelled" }),
        ]}
        today={CLUB_BASE_DAY}
      />,
    );
    expect(
      screen.getByText(translateKey("club.hub.stage.doneOf", { done: 1, total: 3 })),
    ).toBeInTheDocument();
  });

  it("skrót w rogu prowadzi do harmonogramu TEGO klubu", () => {
    render(
      <ClubStagePanel
        clubSlug={SLUG}
        milestones={[clubMilestoneRow({ state: "active" })]}
        today={CLUB_BASE_DAY}
      />,
    );
    expect(screen.getByRole("link", { name: "club.hub.more" })).toHaveAttribute(
      "href",
      `/club/${SLUG}/schedule`,
    );
  });
});

describe("ClubFreshDocsPanel - świeże materiały", () => {
  it("milczy w całości, gdy klub nie ma materiałów", () => {
    const { container } = render(<ClubFreshDocsPanel clubSlug={SLUG} documents={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("pokazuje najwyżej trzy pozycje, reszta zostaje w bibliotece", () => {
    render(
      <ClubFreshDocsPanel
        clubSlug={SLUG}
        documents={[1, 2, 3, 4].map((n) =>
          clubDocumentRow({ id: `doc-${n}`, title_pl: `Materiał ${n}` }),
        )}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText("Materiał 4")).toBeNull();
  });

  it("materiał z plikiem otwiera plik w nowej karcie", () => {
    render(
      <ClubFreshDocsPanel
        clubSlug={SLUG}
        documents={[
          clubDocumentRow({
            file_url: "https://pliki.example/raport.pdf",
            external_url: "https://zewnetrzny.example/strona",
          }),
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: "Raport energetyczny" });
    expect(link).toHaveAttribute("href", "https://pliki.example/raport.pdf");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("materiał bez pliku spada na adres zewnętrzny", () => {
    render(
      <ClubFreshDocsPanel
        clubSlug={SLUG}
        documents={[
          clubDocumentRow({
            file_url: null,
            external_url: "https://zewnetrzny.example/strona",
          }),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Raport energetyczny" })).toHaveAttribute(
      "href",
      "https://zewnetrzny.example/strona",
    );
  });

  it("materiał BEZ żadnego źródła nie jest linkiem, ale nadal jest widoczny", () => {
    render(
      <ClubFreshDocsPanel
        clubSlug={SLUG}
        documents={[clubDocumentRow({ file_url: null, external_url: null })]}
      />,
    );
    const item = screen.getByRole("listitem");
    expect(within(item).queryByRole("link")).toBeNull();
    expect(within(item).getByText("Raport energetyczny")).toBeInTheDocument();
  });

  it("tytuł materiału jedzie w języku interfejsu", () => {
    h.lang = "en-GB";
    render(
      <ClubFreshDocsPanel clubSlug={SLUG} documents={[clubDocumentRow()]} />,
    );
    expect(screen.getByText("Energy report")).toBeInTheDocument();
  });

  it("skrót w rogu prowadzi do biblioteki TEGO klubu", () => {
    render(<ClubFreshDocsPanel clubSlug={SLUG} documents={[clubDocumentRow()]} />);
    expect(screen.getByRole("link", { name: "club.hub.more" })).toHaveAttribute(
      "href",
      `/club/${SLUG}/documents`,
    );
  });
});
