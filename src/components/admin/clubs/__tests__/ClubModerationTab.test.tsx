// Zakładka „Moderacja" - RENDER operacji NIEODWRACALNYCH.
//
// Reguły (rozbicie wsadu na typy celu, próg powodu ujawnienia, które akcje
// wymagają potwierdzenia) testuje `lib/clubs/__tests__/moderationRules.test.ts`
// na czystych funkcjach. Tutaj sprawdzamy to, czego czysta funkcja nie
// obejmuje, a co decyduje o tym, czy moderator skasuje właściwy wątek:
//
//   1. USUNIĘCIE PRZECHODZI PRZEZ DIALOG, zatwierdzenie i ukrycie NIE.
//   2. WSAD woła RPC OSOBNO dla wątków i odpowiedzi (kolejka je miesza).
//   3. UJAWNIENIE AUTORA jest zablokowane, dopóki powód jest za krótki.
//   4. Anonimowy wpis nie pokazuje nazwiska, a przycisk ujawnienia jest
//      WYŁĄCZNIE przy nim.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  queue: { rows: [] as unknown[], total: 0 },
  moderate: vi.fn(),
  bulk: vi.fn(),
  reveal: vi.fn(),
  ban: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}|${JSON.stringify(options)}`,
    i18n: { language: "pl" },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("@/components/admin/community/MemberPicker", () => ({
  MemberPicker: () => <div data-testid="member-picker" />,
}));
vi.mock("@/lib/clubs/useClubs", () => ({
  useClubModerationQueue: () => ({ data: h.queue, isPending: false, isError: false }),
  useClubModerationLog: () => ({ data: [], isPending: false, isError: false }),
  useClubMembers: () => ({ data: { rows: [], total: 0 }, isPending: false, isError: false }),
  useModerateClubTarget: () => ({ mutate: h.moderate, isPending: false }),
  useBulkModerateClub: () => ({ mutateAsync: h.bulk, isPending: false }),
  useRevealClubAuthor: () => ({ mutate: h.reveal, isPending: false }),
  useBanClubMember: () => ({ mutate: h.ban, isPending: false }),
  useModeratorEditThread: () => ({ mutate: vi.fn(), isPending: false }),
  useModeratorEditReply: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ClubModerationTab } from "@/components/admin/clubs/organisms/ClubModerationTab";
import { moderationItem } from "@/test/clubs/fixtures";

const CLUB = "club-1";

function queueOf(...items: ReturnType<typeof moderationItem>[]) {
  h.queue = { rows: items, total: items.length };
}

function panel() {
  return render(<ClubModerationTab clubId={CLUB} />);
}

/** Przycisk o etykiecie zaczynającej się danym kluczem i18n. */
function buttons(key: string): HTMLElement[] {
  return screen.queryAllByRole("button").filter((b) => (b.textContent ?? "").includes(key));
}

beforeEach(() => {
  h.queue = { rows: [], total: 0 };
  h.moderate.mockReset();
  h.bulk.mockReset().mockResolvedValue(1);
  h.reveal.mockReset();
  h.ban.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("kolejka premoderacji", () => {
  it("pusta kolejka mówi to wprost, bez zaznaczania i bez akcji", () => {
    panel();

    expect(screen.queryAllByText((t) => t.includes("moderation.queueEmpty")).length).toBe(1);
    expect(buttons("moderation.approve")).toHaveLength(0);
  });

  it("licznik przy tytule bierze się z TOTAL, nie z długości strony", () => {
    // Kolejka jest stronicowana po stronie RPC - moderator widzący „50" przy
    // kolejce liczącej trzysta pozycji planuje pracę na złych danych.
    h.queue = { rows: [moderationItem()], total: 300 };
    panel();

    expect(screen.getByText("300")).toBeTruthy();
  });

  it("ZATWIERDZENIE idzie od razu, bez dialogu potwierdzenia", () => {
    queueOf(moderationItem({ target_id: "t1", target_type: "thread" }));
    panel();

    fireEvent.click(buttons("moderation.approve")[0]!);

    // Akcja odwracalna (`restore`), więc dialog tylko uczyłby klikania „tak".
    expect(h.moderate).toHaveBeenCalledWith(
      { targetType: "thread", targetId: "t1", action: "approve" },
      expect.anything(),
    );
  });

  it("UKRYCIE też idzie od razu", () => {
    queueOf(moderationItem({ target_id: "r1", target_type: "reply" }));
    panel();

    fireEvent.click(buttons("moderation.hide")[0]!);

    expect(h.moderate).toHaveBeenCalledWith(
      { targetType: "reply", targetId: "r1", action: "hide" },
      expect.anything(),
    );
  });

  it("USUNIĘCIE NIE wywołuje RPC przed potwierdzeniem", () => {
    queueOf(moderationItem({ target_id: "t1" }));
    panel();

    fireEvent.click(buttons("moderation.delete")[0]!);

    // Operacja nieodwracalna: klik otwiera dialog, nie kasuje wątku.
    expect(h.moderate).not.toHaveBeenCalled();
    expect(screen.queryAllByText((t) => t.includes("moderation.deleteTitle")).length).toBe(1);
  });

  it("USUNIĘCIE wykonuje się dopiero po potwierdzeniu w dialogu", async () => {
    queueOf(moderationItem({ target_id: "t1", target_type: "thread" }));
    panel();
    fireEvent.click(buttons("moderation.delete")[0]!);

    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog)
      .getAllByRole("button")
      .find((b) => !(b.textContent ?? "").includes("cancel"));
    fireEvent.click(confirm!);

    await waitFor(() =>
      expect(h.moderate).toHaveBeenCalledWith(
        { targetType: "thread", targetId: "t1", action: "delete" },
        expect.anything(),
      ),
    );
  });

  it("nieznany typ celu jest traktowany jak WĄTEK, nie przekazywany surowo", () => {
    queueOf(moderationItem({ target_id: "x1", target_type: "post" }));
    panel();

    fireEvent.click(buttons("moderation.approve")[0]!);

    expect(h.moderate).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: "thread" }),
      expect.anything(),
    );
  });
});

describe("wpis anonimowy", () => {
  it("NIE pokazuje nazwiska autora, pokazuje plakietkę anonimowości", () => {
    queueOf(moderationItem({ is_anonymous: true, author_name: "Anna Nowak" }));
    panel();

    // Reguła Chatham House: kolejka nie zdradza autora, nawet moderatorowi -
    // od tego jest osobna, logowana akcja.
    expect(screen.queryByText("Anna Nowak")).toBeNull();
    expect(screen.queryAllByText((t) => t.includes("moderation.anonymous")).length).toBe(1);
  });

  it("przycisk ujawnienia jest WYŁĄCZNIE przy wpisie anonimowym", () => {
    queueOf(moderationItem({ is_anonymous: false, author_name: "Anna Nowak" }));
    panel();

    expect(buttons("moderation.reveal")).toHaveLength(0);
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
  });
});

describe("ujawnienie autora - próg powodu", () => {
  function openReveal() {
    queueOf(moderationItem({ is_anonymous: true, target_id: "t1", target_type: "thread" }));
    panel();
    fireEvent.click(buttons("moderation.reveal")[0]!);
  }

  it("przy pustym powodzie przycisk potwierdzenia jest WYŁĄCZONY", () => {
    openReveal();

    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog)
      .getAllByRole("button")
      .find((b) => (b.textContent ?? "").includes("moderation.revealConfirm"));
    expect(confirm?.hasAttribute("disabled")).toBe(true);
  });

  it("powód za krótki nadal blokuje - RPC odrzuciłoby to błędem 22023", () => {
    openReveal();
    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByRole("textbox");

    fireEvent.change(textarea, { target: { value: "krótko" } });

    const confirm = within(dialog)
      .getAllByRole("button")
      .find((b) => (b.textContent ?? "").includes("moderation.revealConfirm"));
    expect(confirm?.hasAttribute("disabled")).toBe(true);
    expect(h.reveal).not.toHaveBeenCalled();
  });

  it("powód powyżej progu odblokowuje i wysyła PRZYCIĘTY tekst", () => {
    openReveal();
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "   podejrzenie podszycia pod inną osobę   " },
    });

    const confirm = within(dialog)
      .getAllByRole("button")
      .find((b) => (b.textContent ?? "").includes("moderation.revealConfirm"));
    expect(confirm?.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirm!);

    expect(h.reveal).toHaveBeenCalledWith(
      {
        targetType: "thread",
        targetId: "t1",
        reason: "podejrzenie podszycia pod inną osobę",
      },
      expect.anything(),
    );
  });
});

describe("wsad", () => {
  it("pasek wsadu pojawia się DOPIERO po zaznaczeniu", () => {
    queueOf(moderationItem({ target_id: "t1" }));
    panel();

    expect(screen.queryAllByText((t) => t.includes("moderation.selected")).length).toBe(0);

    const checkbox = screen.getAllByRole("checkbox")[0]!;
    fireEvent.click(checkbox);

    expect(screen.queryAllByText((t) => t.includes("moderation.selected")).length).toBe(1);
  });

  it("wsad woła RPC OSOBNO dla wątków i dla odpowiedzi", async () => {
    queueOf(
      moderationItem({ target_id: "t1", target_type: "thread" }),
      moderationItem({ target_id: "r1", target_type: "reply" }),
    );
    panel();

    // „Zaznacz wszystko" w nagłówku karty.
    const all = screen.getAllByRole("checkbox")[0]!;
    fireEvent.click(all);

    const approve = buttons("moderation.approve").find((b) => b.textContent?.includes("approve"));
    fireEvent.click(approve!);

    await waitFor(() => expect(h.bulk).toHaveBeenCalledTimes(2));
    // `admin_club_bulk_moderate` przyjmuje JEDEN typ celu na wywołanie.
    expect(h.bulk).toHaveBeenCalledWith({
      targetType: "thread",
      targetIds: ["t1"],
      action: "approve",
    });
    expect(h.bulk).toHaveBeenCalledWith({
      targetType: "reply",
      targetIds: ["r1"],
      action: "approve",
    });
  });

  it("zaznaczenie SAMYCH wątków woła RPC RAZ, bez pustej partii odpowiedzi", async () => {
    queueOf(
      moderationItem({ target_id: "t1", target_type: "thread" }),
      moderationItem({ target_id: "t2", target_type: "thread" }),
    );
    panel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    fireEvent.click(buttons("moderation.approve").find((b) => b.textContent?.includes("approve"))!);

    await waitFor(() => expect(h.bulk).toHaveBeenCalledTimes(1));
  });

  it("wsadowe USUNIĘCIE przechodzi przez dialog i mówi ILE z ILU", async () => {
    queueOf(moderationItem({ target_id: "t1", target_type: "thread" }));
    h.bulk.mockResolvedValue(1);
    panel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    const bulkDelete = buttons("moderation.delete").find((b) =>
      b.textContent?.includes("moderation.delete"),
    );
    fireEvent.click(bulkDelete!);
    expect(h.bulk).not.toHaveBeenCalled();

    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(
      within(dialog)
        .getAllByRole("button")
        .find((b) => !(b.textContent ?? "").includes("cancel"))!,
    );

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(expect.stringContaining("moderation.bulkDone")),
    );
    // Komunikat niesie parę „ile z ilu" - część pozycji mogła zmienić stan.
    expect(h.toastSuccess.mock.calls[0]?.[0]).toContain('"done":1');
    expect(h.toastSuccess.mock.calls[0]?.[0]).toContain('"total":1');
  });

  it("awaria wsadu pokazuje komunikat błędu, nie fałszywy sukces", async () => {
    queueOf(moderationItem({ target_id: "t1", target_type: "thread" }));
    h.bulk.mockRejectedValue(new Error("denied"));
    panel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    fireEvent.click(buttons("moderation.approve").find((b) => b.textContent?.includes("approve"))!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("'wyczyść zaznaczenie' zwija pasek wsadu", () => {
    queueOf(moderationItem({ target_id: "t1" }));
    panel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    fireEvent.click(buttons("moderation.clearSelection")[0]!);

    expect(screen.queryAllByText((t) => t.includes("moderation.selected")).length).toBe(0);
  });
});
