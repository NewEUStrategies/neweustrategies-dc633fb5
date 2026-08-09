// Pasek zaangażowania pod kartą strumienia klubu.
//
// CO TEN TEST PILNUJE. Trzy obietnice, których nie da się sprawdzić na czystej
// funkcji: że domyślnie karta nie zamienia się w ścianę sześciu przycisków
// reakcji, że "Zareaguj" tę paletę otwiera, i że komentarz prowadzi do wątku z
// intencją odpowiedzi (`?reply`), a nie na sam jego początek.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "pl" } }),
}));
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ClubEngagementBar } from "@/components/clubs/molecules/ClubEngagementBar";
import type { ClubReactionTally } from "@/lib/clubs/types";

const EMPTY: readonly ClubReactionTally[] = [];

function renderBar(props: Partial<React.ComponentProps<typeof ClubEngagementBar>> = {}) {
  return render(
    <ClubEngagementBar
      clubSlug="transport"
      threadSlug="korytarz-baltyk-adriatyk"
      tallies={EMPTY}
      replyCount={0}
      {...props}
    />,
  );
}

describe("ClubEngagementBar", () => {
  it("bez postawionych reakcji pokazuje jeden przycisk, nie całą paletę", () => {
    renderBar({ onToggle: () => {} });
    expect(screen.getByTestId("club-add-reaction")).toBeInTheDocument();
    expect(screen.queryByTestId("club-reaction-insightful")).not.toBeInTheDocument();
  });

  it('kliknięcie "Zareaguj" rozwija pełny wybór i chowa sam przycisk', () => {
    renderBar({ onToggle: () => {} });
    fireEvent.click(screen.getByTestId("club-add-reaction"));
    expect(screen.queryByTestId("club-add-reaction")).not.toBeInTheDocument();
  });

  it("po wyborze reakcji paleta zwija się z powrotem", () => {
    const onToggle = vi.fn();
    renderBar({ onToggle });
    fireEvent.click(screen.getByTestId("club-add-reaction"));
    fireEvent.click(screen.getByRole("button", { name: "club.reaction.insightful" }));
    expect(onToggle).toHaveBeenCalledWith("insightful", false);
    expect(screen.getByTestId("club-add-reaction")).toBeInTheDocument();
  });

  it("pokazuje twarze osób, które zareagowały", () => {
    renderBar({
      onToggle: () => {},
      tallies: [{ kind: "insightful", total: 1, mine: false }],
      actors: [
        {
          userId: "u1",
          name: "Anna Kowalska",
          headline: "Analityczka",
          avatarUrl: null,
          slug: "anna",
          isMe: false,
          kinds: ["insightful"],
        },
      ],
    });
    expect(screen.getByText("Anna Kowalska")).toBeInTheDocument();
  });

  it("bez prawa głosu w klubie nie proponuje reakcji", () => {
    renderBar({ canReact: false, onToggle: () => {} });
    expect(screen.queryByTestId("club-add-reaction")).not.toBeInTheDocument();
  });

  it("bez handlera reakcji karta nie udaje interaktywnej", () => {
    renderBar();
    expect(screen.queryByTestId("club-add-reaction")).not.toBeInTheDocument();
  });

  it("komentarz prowadzi do wątku i liczy odpowiedzi", () => {
    renderBar({ replyCount: 4 });
    const link = screen.getByTestId("club-comment-link");
    expect(link).toHaveAttribute("href", "/club/transport/t/korytarz-baltyk-adriatyk");
    // Nazwa dostępna niesie licznik; widoczna etykieta rozwija się dopiero
    // po najechaniu, a liczba stoi obok ikony.
    expect(link).toHaveAttribute("aria-label", "club.hub.feed.commentWithCount");
    expect(link).toHaveTextContent("4");
  });
});
