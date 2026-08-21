// Molekuły prezentacyjne wpisu klubowego: fragment wyniku, twarze reakcji,
// pasek reakcji, pasek nowych odpowiedzi, mapa stanowisk, obserwowanie wątku,
// zgłoszenie i komunikat awarii.
//
// CO TEN PLIK DOWODZI.
//  (1) FRAGMENT WYNIKU NIE JEST HTML-EM. `ts_headline` przychodzi ze
//      znacznikami `<b>`, a trafienie ma wyjść jako `<mark>` - czyli jako
//      ZNACZENIE dla czytnika ekranu, nie jako kolor. Pusty fragment nie
//      renderuje pustego akapitu.
//  (2) TWARZE MÓWIĄ „KTO”, LICZNIK MÓWI „ILE” - i te dwie rzeczy nie mogą się
//      dublować. Tryb poufny oddaje `userId: null`, więc karta pokazuje
//      neutralny znacznik, a nie zgadnięte nazwisko; „+N” pojawia się WYŁĄCZNIE
//      wtedy, gdy licznik przewyższa liczbę pokazanych twarzy (granica
//      sprawdzona dokładnie na progu i po obu jego stronach).
//  (3) PASEK REAKCJI MA DWA TRYBY I ONE ZNACZĄ CO INNEGO: `full` pokazuje
//      komplet sześciu, `compact` tylko postawione. Separator jest treścią
//      (ocena wypowiedzi kontra deklaracja zdania), więc stoi tylko wtedy, gdy
//      są OBIE grupy. Każdy przycisk jest realnie klikany i oddaje stan, który
//      miał w chwili kliknięcia.
//  (4) LICZNIK ZERO NIE WCHODZI DO NAZWY DOSTĘPNEJ. Na telefonie etykieta
//      wypada z drzewa dostępności, więc licznik jest w `aria-label` - ale
//      „(0)” byłoby szumem, nie informacją.
//  (5) PASEK NOWYCH ODPOWIEDZI PRZY ZERZE NIE ISTNIEJE (a nie „pokazuje zero”).
//  (6) MAPA STANOWISK TO PRZEŁĄCZNIK, NIE ANKIETA: brakujące stanowisko dostaje
//      zero, pasek proporcji przy zerze głosów jest pusty, a podpowiedź pod
//      przyciskami zmienia się w zależności od tego, czy wolno głosować i czy
//      głos już padł.
//  (7) OBSERWOWANIE MA TRZY STANY, NIE DWA: brak wpisu (`null`) to „domyślny
//      poziom klubu” z podpowiedzią, a nie wyciszenie. Kliknięcie prowadzi
//      zawsze do stanu JAWNEGO.
//  (8) DIALOG ZGŁOSZENIA MONTUJE SIĘ DOPIERO PO KLIKNIĘCIU - to jest cała
//      racja bytu osobnego pliku przycisku (podział chunku po granicy modułu).
//  (9) AWARIA ODCZYTU MA WŁASNY KOMUNIKAT i przycisk ponowienia tylko wtedy,
//      gdy jest co ponawiać.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  (a) Czystych reguł z `src/lib/clubs`: `parseSnippet` (threadWorkspaceTypes),
//      `toStanceTallies` (stances), `groupReactionActors`/`groupReactions`
//      (types) mają własne tabele przypadków. Tutaj dowodzimy, że molekuła je
//      WOŁA i respektuje wynik na ekranie.
//  (b) Zachowania samego `ClubReportDialog` (formularz zgłoszenia, mutacja,
//      komunikaty) - ma własny plik `clubReportDialog.test.tsx`; tu jest
//      ATRAPĄ, bo przedmiotem dowodu jest granica leniwego montażu.
//  (c) Atomów `AvatarGroup`, `ClubHoverAction*`, `ClubStatusPill` - mają własne
//      pliki; asercje dotyczą tego, CO molekuła im podaje.
//  (d) Pasków `ClubEngagementBar` i `ClubThreadTopicBar` - mają własne pliki.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
// Dialog zgłoszenia jest wciągany przez `lazy()` - atrapa wystawia tożsamość
// celu i jedyne wyjście (`onOpenChange(false)`), bo dowodzimy GRANICY montażu,
// nie treści formularza.
vi.mock("@/components/clubs/molecules/ClubReportDialog", () => ({
  ClubReportDialog: ({
    targetType,
    targetId,
    open,
    onOpenChange,
  }: {
    targetType: ClubReactionTarget;
    targetId: string;
    open: boolean;
    onOpenChange: (next: boolean) => void;
  }) => (
    <div data-testid="atrapa-zgloszenia" data-open={String(open)}>
      <span>{`${targetType}:${targetId}`}</span>
      <button type="button" onClick={() => onOpenChange(false)}>
        zamknij
      </button>
    </div>
  ),
}));

import { ClubSnippet } from "@/components/clubs/molecules/ClubSnippet";
import { ClubReactionAvatars } from "@/components/clubs/molecules/ClubReactionAvatars";
import { ClubReactionBar } from "@/components/clubs/molecules/ClubReactionBar";
import { ClubNewRepliesBar } from "@/components/clubs/molecules/ClubNewRepliesBar";
import { ClubStanceBar } from "@/components/clubs/molecules/ClubStanceBar";
import { ClubFollowButton } from "@/components/clubs/molecules/ClubFollowButton";
import { ClubReportButton } from "@/components/clubs/molecules/ClubReportButton";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import type {
  ClubReactionActor,
  ClubReactionKind,
  ClubReactionTally,
  ClubReactionTarget,
  ClubStance,
  ClubStanceSummaryRow,
  ClubSubscriptionState,
} from "@/lib/clubs/types";

// --- fabryki kształtów ------------------------------------------------------

function actor(overrides: Partial<ClubReactionActor> = {}): ClubReactionActor {
  return {
    userId: "user-member",
    name: "Anna Nowak",
    headline: "Analityczka rynku energii",
    avatarUrl: null,
    slug: "anna-nowak",
    isMe: false,
    kinds: ["insightful"],
    ...overrides,
  };
}

function tally(kind: ClubReactionKind, total: number, mine = false): ClubReactionTally {
  return { kind, total, mine };
}

function stanceRow(stance: ClubStance, total: number, mine = false): ClubStanceSummaryRow {
  return { stance, total, mine };
}

// ---------------------------------------------------------------------------
// ClubSnippet
// ---------------------------------------------------------------------------

describe("ClubSnippet - trafienie jako znaczenie, nie jako kolor", () => {
  it("trafienie z `ts_headline` rysuje `<mark>`, a otoczenie zostaje tekstem", () => {
    const { container } = render(<ClubSnippet snippet="koszt <b>bilansowania</b> w modelu" />);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("bilansowania");
    // Znaczniki NIE mogą wejść do DOM-u jako HTML - tekst jest sklejony bez nich.
    expect(container.textContent).toBe("koszt bilansowania w modelu");
    expect(container.innerHTML).not.toContain("<b>");
  });

  it.each([
    ["brak fragmentu", null],
    ["fragment pusty", ""],
  ])("%s nie zostawia pustego akapitu", (_nazwa, snippet: string | null) => {
    const { container } = render(<ClubSnippet snippet={snippet} />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("bez klasy z zewnątrz akapit dostaje domyślny styl, z klasą - podaną", () => {
    const { container: domyslny } = render(<ClubSnippet snippet="zwykły tekst" />);
    expect(domyslny.querySelector("p")).toHaveClass("text-muted-foreground");

    const { container: wlasny } = render(
      <ClubSnippet snippet="zwykły tekst" className="moja-klasa" />,
    );
    expect(wlasny.querySelector("p")).toHaveClass("moja-klasa");
    expect(wlasny.querySelector("p")).not.toHaveClass("text-muted-foreground");
  });
});

// ---------------------------------------------------------------------------
// ClubReactionAvatars
// ---------------------------------------------------------------------------

describe("ClubReactionAvatars - kto zareagował", () => {
  it("bez twarzy nie renderuje nic (licznik nie potrzebuje pustego stosu)", () => {
    const { container } = render(<ClubReactionAvatars actors={[]} total={7} />);
    expect(container.firstChild).toBeNull();
  });

  it("osoba znana dostaje nazwę, stanowisko i rodzaj reakcji w jednej etykiecie", () => {
    render(<ClubReactionAvatars actors={[actor({ kinds: ["insightful", "thanks"] })]} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/people/anna-nowak");
    expect(link).toHaveAccessibleName(
      "Anna Nowak - Analityczka rynku energii – club.reaction.insightful · club.reaction.thanks",
    );
  });

  it("tryb poufny (brak `userId`) daje neutralny znacznik, nie zgadnięte nazwisko", () => {
    render(
      <ClubReactionAvatars
        actors={[actor({ userId: null, name: "Anna Nowak", slug: null, headline: null })]}
      />,
    );
    expect(screen.getByText("club.reactionActors.anonymous")).toBeInTheDocument();
    expect(screen.queryByText("Anna Nowak")).not.toBeInTheDocument();
    // Bez adresu profilu twarz nie jest linkiem.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("moja reakcja mówi „ty”, a konto bez nazwy degraduje do znacznika", () => {
    render(
      <ClubReactionAvatars
        actors={[
          actor({ userId: "user-me", isMe: true, slug: null }),
          actor({ userId: "user-x", name: null, slug: null, headline: null, kinds: [] }),
        ]}
      />,
    );
    expect(screen.getByText("club.reactionActors.you")).toBeInTheDocument();
    expect(screen.getByText("club.reactionActors.anonymous")).toBeInTheDocument();
  });

  it.each([
    ["licznik równy liczbie twarzy - bez „+N”", 2, false],
    ["licznik o jeden większy - „+N” wchodzi", 3, true],
  ])("%s", (_nazwa, total: number, oczekujeNadwyzki: boolean) => {
    render(
      <ClubReactionAvatars
        actors={[actor(), actor({ userId: "user-lead", name: "Jan Lis", slug: "jan-lis" })]}
        total={total}
        maxVisible={2}
      />,
    );
    const nadwyzka = screen.queryByText("club.reactionActors.more(count=1)");
    expect(nadwyzka !== null).toBe(oczekujeNadwyzki);
  });

  it("bez licznika z bazy nadwyżkę liczy sama liczba twarzy nad limitem", () => {
    render(
      <ClubReactionAvatars
        actors={[
          actor(),
          actor({ userId: "user-lead", name: "Jan Lis", slug: null }),
          actor({ userId: "user-third", name: "Ewa Mak", slug: null }),
        ]}
        maxVisible={2}
        size="sm"
        className="mt-2"
      />,
    );
    // Trzy osoby, dwa miejsca: nadwyżka jest jedna - i pada zarówno z etykiety
    // stosu awatarów, jak i z podpisu obok.
    expect(screen.getAllByText("club.reactionActors.more(count=1)").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ClubReactionBar
// ---------------------------------------------------------------------------

describe("ClubReactionBar - sześć reakcji w dwóch grupach", () => {
  it("tryb pełny pokazuje komplet i separator między oceną a stanowiskiem", () => {
    const { container } = render(
      <ClubReactionBar tallies={[]} onToggle={() => undefined} variant="full" />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(container.querySelectorAll("span[aria-hidden='true'].w-px")).toHaveLength(1);
  });

  it("licznik wchodzi do nazwy dostępnej tylko wtedy, gdy jest niezerowy", () => {
    render(<ClubReactionBar tallies={[tally("insightful", 3)]} onToggle={() => undefined} />);
    expect(
      screen.getByRole("button", { name: "club.reaction.insightful (3)" }),
    ).toBeInTheDocument();
    // Reakcja bez ani jednego głosu nie dostaje „(0)”.
    expect(screen.getByRole("button", { name: "club.reaction.evidence" })).toBeInTheDocument();
  });

  it("przycisk oddaje stan Z CHWILI KLIKNIĘCIA - postawiona reakcja zdejmuje się", () => {
    const onToggle = vi.fn();
    render(
      <ClubReactionBar
        tallies={[tally("insightful", 4, true), tally("agree", 1)]}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "club.reaction.insightful (4)" }));
    expect(onToggle).toHaveBeenCalledWith("insightful", true);

    fireEvent.click(screen.getByRole("button", { name: "club.reaction.agree (1)" }));
    expect(onToggle).toHaveBeenLastCalledWith("agree", false);
    expect(screen.getByRole("button", { name: "club.reaction.insightful (4)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("tryb zwinięty pokazuje TYLKO postawione i gubi separator, gdy grupa jest jedna", () => {
    const { container } = render(
      <ClubReactionBar
        tallies={[tally("evidence", 2), tally("agree", 0)]}
        variant="compact"
        onToggle={() => undefined}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "club.reaction.evidence (2)" })).toBeInTheDocument();
    expect(container.querySelectorAll("span[aria-hidden='true'].w-px")).toHaveLength(0);
  });

  it("tryb zwinięty bez ani jednej postawionej reakcji nie renderuje paska", () => {
    const { container } = render(
      <ClubReactionBar
        tallies={[tally("thanks", 0), tally("disagree", 0)]}
        variant="compact"
        onToggle={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("sama grupa stanowisk też stoi bez separatora", () => {
    const { container } = render(
      <ClubReactionBar
        tallies={[tally("disagree", 5, true)]}
        variant="compact"
        labels="always"
        onToggle={() => undefined}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(container.querySelectorAll("span[aria-hidden='true'].w-px")).toHaveLength(0);
  });

  it("bez prawa głosu wszystkie przyciski są wyłączone", () => {
    render(
      <ClubReactionBar
        tallies={[tally("insightful", 1)]}
        disabled
        labels="hover"
        onToggle={() => undefined}
      />,
    );
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// ClubNewRepliesBar
// ---------------------------------------------------------------------------

describe("ClubNewRepliesBar - informacja o nowej treści nad listą", () => {
  it.each([
    ["zero", 0],
    ["wartość ujemna z wyścigu liczników", -3],
  ])("przy liczbie „%s” pasek nie istnieje", (_nazwa, count: number) => {
    const { container } = render(<ClubNewRepliesBar count={count} onReveal={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("liczba idzie do komunikatu, a przycisk odsłania treść", () => {
    const onReveal = vi.fn();
    const { container } = render(
      <ClubNewRepliesBar count={4} onReveal={onReveal} className="moja-klasa" />,
    );
    expect(screen.getByText("club.newReplies(count=4)")).toBeInTheDocument();
    // Komunikat czyta się dopiero po skończonej frazie - `polite`, nie `assertive`.
    expect(container.firstElementChild).toHaveAttribute("aria-live", "polite");
    expect(container.firstElementChild).toHaveClass("moja-klasa");
    fireEvent.click(screen.getByRole("button", { name: "club.newRepliesShow" }));
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it("bez klasy z zewnątrz pasek nadal jest przyklejony do góry", () => {
    const { container } = render(<ClubNewRepliesBar count={1} onReveal={() => undefined} />);
    expect(container.firstElementChild).toHaveClass("sticky");
  });
});

// ---------------------------------------------------------------------------
// ClubStanceBar
// ---------------------------------------------------------------------------

describe("ClubStanceBar - mapa stanowisk, nie ankieta", () => {
  it("brak wiersza w RPC znaczy zero, a nie „stanowiska nie ma”", () => {
    const { container } = render(
      <ClubStanceBar rows={[]} disabled={false} pending={false} onSet={() => undefined} />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByText("club.stance.total(count=0)")).toBeInTheDocument();
    // Pasek proporcji przy zerze głosów jest pusty, a nie pełny w jednej trzeciej.
    const proporcja = screen.getByRole("img", { name: "club.stance.distribution" });
    expect(proporcja.children).toHaveLength(0);
    expect(container).toHaveTextContent("club.stance.hint");
  });

  it("dane pełne dzielą pasek proporcjonalnie i pomijają stanowisko bez głosów", () => {
    render(
      <ClubStanceBar
        rows={[stanceRow("support", 3, true), stanceRow("oppose", 1)]}
        disabled={false}
        pending={false}
        onSet={() => undefined}
      />,
    );
    const proporcja = screen.getByRole("img", { name: "club.stance.distribution" });
    // Dwa wypełnienia z trzech stanowisk - „wstrzymanie się” nie dostaje kreski.
    expect(proporcja.children).toHaveLength(2);
    expect(proporcja.children[0]).toHaveStyle({ width: "75%" });
    expect(screen.getByText("club.stance.total(count=4)")).toBeInTheDocument();
    // Głos już padł, więc podpowiedź mówi o ZMIANIE, nie o oddaniu głosu.
    expect(screen.getByText("club.stance.changeHint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /club\.stance\.support/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("każdy przycisk oddaje swoje stanowisko", () => {
    const onSet = vi.fn();
    render(
      <ClubStanceBar
        rows={[stanceRow("abstain", 2)]}
        disabled={false}
        pending={false}
        onSet={onSet}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /club\.stance\.support/ }));
    fireEvent.click(screen.getByRole("button", { name: /club\.stance\.oppose/ }));
    fireEvent.click(screen.getByRole("button", { name: /club\.stance\.abstain/ }));
    expect(onSet.mock.calls.map((call) => call[0])).toEqual(["support", "oppose", "abstain"]);
  });

  it.each([
    ["bez prawa głosu", true, false, "club.stance.readOnly"],
    ["w trakcie zapisu", false, true, "club.stance.hint"],
  ])(
    "%s przyciski są zablokowane",
    (_nazwa, disabled: boolean, pending: boolean, tekst: string) => {
      render(
        <ClubStanceBar
          rows={[stanceRow("support", 1)]}
          disabled={disabled}
          pending={pending}
          onSet={() => undefined}
        />,
      );
      for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
      expect(screen.getByText(tekst)).toBeInTheDocument();
    },
  );
});

// ---------------------------------------------------------------------------
// ClubFollowButton
// ---------------------------------------------------------------------------

/** Tabela stanów obserwowania - typowana JAWNIE, żeby kolumna „stan” nie
 *  rozjechała się do `string` i nie przestała pilnować słownika. */
const STANY_OBSERWOWANIA: readonly (readonly [
  string,
  ClubSubscriptionState | null,
  string,
  ClubSubscriptionState,
  string,
])[] = [
  ["brak wpisu", null, "club.subscription.follow", "subscribed", "false"],
  ["obserwuję", "subscribed", "club.subscription.subscribed", "muted", "true"],
  ["wyciszony", "muted", "club.subscription.muted", "subscribed", "false"],
];

describe("ClubFollowButton - trzy stany obserwowania", () => {
  it.each(STANY_OBSERWOWANIA)(
    "stan „%s” pokazuje własną etykietę i prowadzi do stanu jawnego",
    (
      _nazwa,
      state: ClubSubscriptionState | null,
      etykieta: string,
      nastepny: ClubSubscriptionState,
      wcisniety: string,
    ) => {
      const onChange = vi.fn();
      render(
        <ClubFollowButton state={state} pending={false} disabled={false} onChange={onChange} />,
      );
      const button = screen.getByRole("button");
      expect(button).toHaveTextContent(etykieta);
      expect(button).toHaveAttribute("aria-pressed", wcisniety);
      fireEvent.click(button);
      expect(onChange).toHaveBeenCalledWith(nastepny);
    },
  );

  it("stan domyślny niesie podpowiedź, stan jawny jej nie potrzebuje", () => {
    const { rerender } = render(
      <ClubFollowButton state={null} pending={false} disabled={false} onChange={() => undefined} />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("title", "club.subscription.defaultHint");

    rerender(
      <ClubFollowButton
        state="subscribed"
        pending={false}
        disabled={false}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("button")).not.toHaveAttribute("title");
  });

  it.each([
    ["zapis w toku", true, false],
    ["brak uprawnienia", false, true],
  ])("%s blokuje przycisk", (_nazwa, pending: boolean, disabled: boolean) => {
    render(
      <ClubFollowButton
        state="muted"
        pending={pending}
        disabled={disabled}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("wariant minimalistyczny niesie nazwę w `aria-label` i też klika", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ClubFollowButton
        state={null}
        pending={false}
        disabled={false}
        onChange={onChange}
        compact
      />,
    );
    const button = screen.getByRole("button", { name: "club.subscription.follow" });
    expect(button).toHaveAttribute("title", "club.subscription.defaultHint");
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith("subscribed");

    // Stan jawny w tym samym wariancie: podpowiedź ustępuje etykiecie, a zapis
    // w toku wyłącza przycisk.
    rerender(
      <ClubFollowButton state="subscribed" pending disabled={false} onChange={onChange} compact />,
    );
    const wciazTen = screen.getByRole("button", { name: "club.subscription.subscribed" });
    expect(wciazTen).toHaveAttribute("title", "club.subscription.subscribed");
    expect(wciazTen).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// ClubReportButton
// ---------------------------------------------------------------------------

describe("ClubReportButton - dialog dopiero po kliknięciu", () => {
  it("w spoczynku stoi sam przycisk, bez dialogu w drzewie", () => {
    render(<ClubReportButton targetType="reply" targetId="reply-1" className="moja-klasa" />);
    expect(screen.getByRole("button", { name: "club.report.title" })).toHaveClass("moja-klasa");
    expect(screen.queryByTestId("atrapa-zgloszenia")).not.toBeInTheDocument();
  });

  it("kliknięcie montuje dialog z tożsamością celu, a zamknięcie go zdejmuje", async () => {
    render(<ClubReportButton targetType="thread" targetId="thread-1" />);
    fireEvent.click(screen.getByRole("button", { name: "club.report.title" }));

    const dialog = await screen.findByTestId("atrapa-zgloszenia");
    expect(dialog).toHaveAttribute("data-open", "true");
    expect(within(dialog).getByText("thread:thread-1")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "zamknij" }));
    expect(screen.queryByTestId("atrapa-zgloszenia")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ClubErrorNotice
// ---------------------------------------------------------------------------

describe("ClubErrorNotice - awaria odczytu to nie pustka", () => {
  it("bez handlera ponowienia nie obiecuje przycisku", () => {
    render(<ClubErrorNotice />);
    expect(screen.getByRole("status")).toHaveTextContent("club.error.title");
    expect(screen.getByText("club.error.body")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("z handlerem ponowienie jest realnie wołane", () => {
    const onRetry = vi.fn();
    render(<ClubErrorNotice onRetry={onRetry} className="moja-klasa" />);
    fireEvent.click(screen.getByRole("button", { name: "club.error.retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveClass("moja-klasa");
  });

  it.each([
    ["wariant sekcji", true, "p-4"],
    ["wariant strony", false, "p-8"],
  ])("%s dostaje własne oddechy", (_nazwa, compact: boolean, klasa: string) => {
    render(<ClubErrorNotice compact={compact} />);
    expect(screen.getByRole("status")).toHaveClass(klasa);
  });
});
