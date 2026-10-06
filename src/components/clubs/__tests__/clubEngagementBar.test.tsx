// Liczniki i akcje pod kartą wątku w strumieniu klubu.
//
// CO TEN TEST PILNUJE.
// (1) Domyślnie karta NIE zamienia się w ścianę sześciu przycisków reakcji:
//     jest jedna akcja „Zareaguj", a paleta otwiera się na żądanie (najazd
//     myszą po chwili, strzałka w górę z klawiatury).
// (2) Kliknięcie stawia reakcję domyślną, a kliknięcie postawionej - zdejmuje
//     ją; wybór z palety oddaje rodzaj i poprzedni stan, a paleta się zwija.
// (3) Licznik mówi KTO: nazwisko pierwszej osoby albo „Ty i N innych", a bez
//     nazwisk (tryb poufny) - samą liczbę.
// (4) Komentarz prowadzi do wątku z intencją odpowiedzi (`?reply`), a liczba
//     odpowiedzi jest linkiem do wątku.
// (5) Udostępnienie kopiuje adres wątku i potwierdza to komunikatem.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "pl" } }),
}));
vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    Link: ({ search, ...rest }: import("@/test/routerLinkStub").RouterLinkStubProps) => (
      <RouterLinkStub {...rest} data-search={JSON.stringify(search ?? null)} />
    ),
  };
});
vi.mock("sonner", () => ({ toast: h.toast }));

import { ClubEngagementBar } from "@/components/clubs/molecules/ClubEngagementBar";
import type { ClubReactionActor, ClubReactionTally } from "@/lib/clubs/types";

const EMPTY: readonly ClubReactionTally[] = [];

function actor(overrides: Partial<ClubReactionActor> = {}): ClubReactionActor {
  return {
    userId: "u1",
    name: "Anna Kowalska",
    headline: "Analityczka",
    avatarUrl: null,
    slug: "anna",
    isMe: false,
    kinds: ["insightful"],
    ...overrides,
  };
}

function renderBar(props: Partial<React.ComponentProps<typeof ClubEngagementBar>> = {}) {
  return render(
    <ClubEngagementBar
      clubSlug="transport"
      threadSlug="korytarz-baltyk-adriatyk"
      threadTitle="Korytarz Bałtyk-Adriatyk"
      tallies={EMPTY}
      replyCount={0}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  h.toast.success.mockReset();
  h.toast.error.mockReset();
});

describe("ClubEngagementBar - reakcja", () => {
  it("bez postawionych reakcji pokazuje jedną akcję, nie całą paletę", () => {
    renderBar({ onToggle: () => {} });
    expect(screen.getByTestId("club-add-reaction")).toBeInTheDocument();
    expect(screen.queryByTestId("club-reaction-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("club-add-reaction")).toHaveAttribute("aria-pressed", "false");
  });

  it("kliknięcie stawia reakcję domyślną bez otwierania palety", () => {
    const onToggle = vi.fn();
    renderBar({ onToggle });
    fireEvent.click(screen.getByTestId("club-add-reaction"));
    expect(onToggle).toHaveBeenCalledWith("insightful", false);
    expect(screen.queryByTestId("club-reaction-picker")).not.toBeInTheDocument();
  });

  it("postawiona reakcja stoi w akcji, a kliknięcie ją zdejmuje", () => {
    const onToggle = vi.fn();
    renderBar({ onToggle, tallies: [{ kind: "agree", total: 2, mine: true }] });
    const button = screen.getByTestId("club-add-reaction");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("data-reaction", "agree");
    expect(button).toHaveTextContent("club.reaction.agree");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith("agree", true);
  });

  it("strzałka w górę otwiera paletę, wybór oddaje rodzaj i paleta się zwija", () => {
    const onToggle = vi.fn();
    renderBar({ onToggle, tallies: [{ kind: "evidence", total: 1, mine: true }] });
    fireEvent.keyDown(screen.getByTestId("club-add-reaction"), { key: "ArrowUp" });

    const picker = screen.getByTestId("club-reaction-picker");
    expect(picker).toHaveAttribute("role", "toolbar");
    // Sześć reakcji w dwóch grupach; postawiona jest zaznaczona.
    expect(picker.querySelectorAll("button")).toHaveLength(6);
    expect(screen.getByTestId("club-reaction-option-evidence")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.activeElement).toBe(screen.getByTestId("club-reaction-option-insightful"));

    fireEvent.click(screen.getByTestId("club-reaction-option-disagree"));
    expect(onToggle).toHaveBeenCalledWith("disagree", false);
    expect(screen.queryByTestId("club-reaction-picker")).not.toBeInTheDocument();
  });

  it("Escape zamyka paletę i oddaje fokus akcji", () => {
    renderBar({ onToggle: () => {} });
    const trigger = screen.getByTestId("club-add-reaction");
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByTestId("club-reaction-picker"), { key: "Escape" });
    expect(screen.queryByTestId("club-reaction-picker")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("najazd myszą otwiera paletę po chwili, zjazd ją zamyka", () => {
    vi.useFakeTimers();
    renderBar({ onToggle: () => {} });
    const root = screen.getByTestId("club-add-reaction").parentElement as HTMLElement;

    fireEvent.pointerEnter(root, { pointerType: "mouse" });
    expect(screen.queryByTestId("club-reaction-picker")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByTestId("club-reaction-picker")).toBeInTheDocument();

    fireEvent.pointerLeave(root, { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByTestId("club-reaction-picker")).not.toBeInTheDocument();
  });

  it("bez prawa głosu w klubie nie proponuje reakcji", () => {
    renderBar({ canReact: false, onToggle: () => {} });
    expect(screen.queryByTestId("club-add-reaction")).not.toBeInTheDocument();
  });

  it("bez handlera reakcji karta nie udaje interaktywnej", () => {
    renderBar();
    expect(screen.queryByTestId("club-add-reaction")).not.toBeInTheDocument();
  });
});

describe("ClubEngagementBar - licznik", () => {
  it("pokazuje, kto zareagował", () => {
    renderBar({
      onToggle: () => {},
      tallies: [{ kind: "insightful", total: 1, mine: false }],
      actors: [actor()],
    });
    const summary = screen.getByTestId("club-reaction-summary");
    expect(summary).toHaveTextContent("Anna Kowalska");
    expect(summary.querySelector('[data-reaction-glyph="insightful"]')).not.toBeNull();
  });

  it("moja reakcja wśród innych to „Ty i N innych”, glify od najczęstszej", () => {
    renderBar({
      tallies: [
        { kind: "agree", total: 1, mine: true },
        { kind: "insightful", total: 3, mine: false },
      ],
      actors: [actor({ isMe: true, kinds: ["agree"] }), actor({ userId: "u2" })],
    });
    const summary = screen.getByTestId("club-reaction-summary");
    expect(summary).toHaveTextContent("club.hub.feed.reactors.youAndOthers");
    const glyphs = Array.from(summary.querySelectorAll("[data-reaction-glyph]")).map((node) =>
      node.getAttribute("data-reaction-glyph"),
    );
    expect(glyphs).toEqual(["insightful", "agree"]);
  });

  it("tryb poufny (bez nazwisk) pokazuje samą liczbę", () => {
    renderBar({
      tallies: [{ kind: "thanks", total: 4, mine: false }],
      actors: [actor({ userId: null, name: null, slug: null })],
    });
    expect(screen.getByTestId("club-reaction-summary")).toHaveTextContent("4");
  });

  it("bez reakcji i bez rozmowy pas liczników nie istnieje", () => {
    const { container } = renderBar({ onToggle: () => {} });
    expect(container.querySelector('[data-feed-zone="social"]')).toBeNull();
  });
});

describe("ClubEngagementBar - rozmowa i udostępnienie", () => {
  it("komentarz prowadzi do kompozytora odpowiedzi, liczba odpowiedzi - do wątku", () => {
    renderBar({ replyCount: 4, participantCount: 2 });
    const link = screen.getByTestId("club-comment-link");
    expect(link).toHaveAttribute("href", "/club/transport/t/korytarz-baltyk-adriatyk");
    expect(link).toHaveAttribute("data-search", '{"reply":true}');
    expect(link).toHaveAttribute("aria-label", "club.hub.feed.commentWithCount");

    const replies = screen.getByRole("link", { name: "club.repliesCount" });
    expect(replies).toHaveAttribute("href", "/club/transport/t/korytarz-baltyk-adriatyk");
    expect(screen.getByText("club.hub.feed.participantsCount")).toBeInTheDocument();
  });

  it("udostępnienie kopiuje adres wątku i potwierdza to komunikatem", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText }, share: undefined });
    renderBar();

    await act(async () => {
      fireEvent.click(screen.getByTestId("club-feed-share"));
    });

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/club/transport/t/korytarz-baltyk-adriatyk`,
    );
    expect(h.toast.success).toHaveBeenCalledWith("club.hub.feed.linkCopied");
  });

  it("odmowa schowka kończy się komunikatem błędu, nie ciszą", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText }, share: undefined });
    renderBar();

    await act(async () => {
      fireEvent.click(screen.getByTestId("club-feed-share"));
    });

    expect(h.toast.error).toHaveBeenCalledWith("club.hub.feed.linkCopyFailed");
  });
});
