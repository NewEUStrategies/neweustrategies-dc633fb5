// Panel „Pytania” z PRAWDZIWĄ kartą pytania: gość nie woła
// `club_thread_question_vote`.
//
// CO TEN PLIK DOWODZI. `club_thread_question_vote` nie ma EXECUTE dla `anon`
// (i sam sprawdza `auth.uid()`), a gość czyta pytania wątku klubu publicznego
// (`club_thread_questions_list` ma EXECUTE dla `anon`). Do tej pory karta
// pytania rysowała gościowi CZYNNY przycisk głosu, a kliknięcie kończyło się
// 42501 i ogólnym toastem błędu.
//
// `clubThreadPanels.test.tsx` trzyma kartę jako atrapę (dowodzi, CO panel jej
// podaje), `clubPresentationWorkspaceRows.test.tsx` - kartę bez panelu. Tutaj
// oba są prawdziwe, a atrapą jest dopiero warstwa danych, więc asercja „RPC
// nie poszło” stoi na poziomie, na którym produkcja wysyła żądanie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  toasts: [] as { level: "success" | "error"; key: string }[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({
  toast: {
    success: (key: string) => h.toasts.push({ level: "success", key }),
    error: (key: string) => h.toasts.push({ level: "error", key }),
  },
}));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/lib/clubs/threadWorkspaceApi", () => threadApiMock);

import { resetThreadApiMock, threadApiMock } from "@/test/clubs/workspaceApiMock";
import { threadQuestionRow } from "@/test/clubs/threadWorkspaceFixtures";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ClubThreadQuestionsPanel } from "@/components/clubs/organisms/ClubThreadQuestionsPanel";

const THREAD = "thread-1";

function renderPanel(canVote: boolean) {
  return renderWithQueryClient(
    <ClubThreadQuestionsPanel
      threadId={THREAD}
      lang="pl"
      canContribute={false}
      canGoAnonymous={false}
      canVote={canVote}
    />,
  );
}

beforeEach(() => {
  resetThreadApiMock();
  h.toasts = [];
  threadApiMock.fetchClubThreadQuestions.mockResolvedValue([
    // `can_answer` jak z bazy dla czytającego, nie prowadzącego.
    threadQuestionRow({ my_vote: false, vote_count: 4, can_answer: false }),
  ]);
  threadApiMock.voteClubThreadQuestion.mockResolvedValue(5);
});

afterEach(() => {
  cleanup();
});

describe("Pytania - głos gościa nie idzie do bazy", () => {
  it("gość widzi pytanie i licznik, ale głos jest wygaszony i nie woła RPC", async () => {
    renderPanel(false);

    const glos = await screen.findByRole("button", { name: "club.workspace.questions.vote" });
    expect(screen.getByText("Jak liczycie koszt bilansowania?")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(glos).toBeDisabled();

    fireEvent.click(glos);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(threadApiMock.voteClubThreadQuestion).not.toHaveBeenCalled();
    expect(h.toasts).toEqual([]);
  });

  it("zalogowany czytelnik BEZ prawa zapisu nadal głosuje - jak dotąd", async () => {
    renderPanel(true);

    const glos = await screen.findByRole("button", { name: "club.workspace.questions.vote" });
    expect(glos).toBeEnabled();
    fireEvent.click(glos);

    await waitFor(() => expect(threadApiMock.voteClubThreadQuestion).toHaveBeenCalled());
    expect(threadApiMock.voteClubThreadQuestion.mock.calls[0]?.[0]).toEqual({
      questionId: "question-1",
      on: true,
    });
    expect(h.toasts).toEqual([]);
  });
});
