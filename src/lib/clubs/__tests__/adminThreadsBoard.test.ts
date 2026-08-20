// Lista tematów w panelu - REGUŁY wyprowadzone z organizmu `ClubThreadsTab`.
//
// CO TO DOWODZI. Sześć rzeczy, które przed wyprowadzeniem dały się sprawdzić
// wyłącznie przez zamontowanie zakładki z ośmioma atrapami hooków, trzema
// dialogami i dwoma układami tej samej listy:
//
//   1. ZAZNACZENIE JEST PRZECIĘTE Z WIDOCZNYMI WIERSZAMI. Identyfikator, który
//      wypadł z listy (zmiana filtra albo cudze skasowanie wątku między
//      refetchami), NIE MOŻE wejść do partii - inaczej „usuń 12” kasuje wpis,
//      którego administrator nie ma na ekranie.
//   2. KIERUNEK KAŻDEJ AKCJI WIERSZA. „Odepnij” tylko na przypiętym, „otwórz”
//      tylko na zamkniętym, „przywróć” tylko na zdjętym z klubu - a pustka
//      znacznika czasu ma DWIE postacie (`null` z bazy i pusty napis
//      z kontraktu typów), więc obie muszą znaczyć „nieprzypięty”.
//   3. WALIDACJA I ŁADUNEK NOWEGO TEMATU SĄ JEDNĄ FUNKCJĄ. Progi (5 znaków
//      tytułu, 10 treści) liczą się po PRZYCIĘCIU, a pusty wybór osoby jedzie
//      jako `null`, nie jako `""` - `""` w `p_author_id` to nieistniejący
//      identyfikator, a nie „publikuję pod własnym nazwiskiem”.
//   4. ODPOWIEDŹ BEZ TREŚCI NIE WYCHODZI Z PRZEGLĄDARKI, a wątek bez
//      identyfikatora nie daje ładunku wcale.
//   5. DZIAŁ EFEKTYWNY KOMPOZYTORA to wybór jawny albo PIERWSZY z listy; klub
//      bez działów oddaje pustkę, którą łapie walidacja.
//   6. PRZENIESIENIE NIE OFERUJE DZIAŁU OBECNEGO - to byłby wpis w dzienniku
//      moderacji bez żadnej zmiany.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie sprawdza, czy RPC przyjmie ładunek
// (`admin_club_thread_create`, `admin_club_moderate` - pgTAP), ani czy
// moderator ma prawo akcji (SECURITY DEFINER). Nie powtarza reguł kolejki
// premoderacji (`moderationRules.test.ts`), dynamiki wątku
// (`threadDynamics.test.ts`) ani liczników obszarów (`threadTopics.test.ts`).
// Nie testuje renderu - to `ClubThreadsTab.test.tsx` i molekuły.
import { describe, expect, it } from "vitest";
import {
  ADMIN_THREAD_MIN_BODY,
  ADMIN_THREAD_MIN_TITLE,
  THREAD_FILTER_ANY,
  adminReplyVars,
  adminThreadCreateVars,
  allThreadIds,
  areAllThreadsSelected,
  canPostAdminReply,
  composerGroupId,
  isRemovedStatus,
  isRepliesPageTruncated,
  isThreadIdentityProtected,
  isThreadMarkSet,
  onBehalfLabel,
  replyIndentPx,
  threadFilterSelectValue,
  threadFilterValue,
  threadMoveTargets,
  threadRowActions,
  toggleThreadSelection,
  visibleThreadIds,
  visibleThreadSelection,
  type AdminThreadDraft,
} from "@/lib/clubs/adminThreadsBoard";
import { adminThreadRow } from "@/test/clubs/adminThreadFixtures";
import { CLUB_IDS } from "@/test/clubs/fixtures";

describe("filtry listy tematów", () => {
  it("wartość „wszystkie” znaczy BRAK zawężenia, nie wartość do zapytania", () => {
    expect(threadFilterValue(THREAD_FILTER_ANY)).toBeNull();
    expect(threadFilterValue("")).toBeNull();
  });

  it("realna wartość jedzie do zapytania bez zmian", () => {
    expect(threadFilterValue("locked")).toBe("locked");
  });

  it("droga powrotna pokazuje „wszystkie” dla braku zawężenia", () => {
    expect(threadFilterSelectValue(null)).toBe(THREAD_FILTER_ANY);
    expect(threadFilterSelectValue("question")).toBe("question");
  });
});

describe("zaznaczenie względem WIDOCZNYCH wierszy", () => {
  const rows = [adminThreadRow({ id: "t1" }), adminThreadRow({ id: "t2" })];

  it("identyfikatory widocznych wierszy to dokładnie to, co na ekranie", () => {
    expect([...visibleThreadIds(rows)]).toEqual(["t1", "t2"]);
  });

  it("zaznaczenie odsiewa wpisy, których NIE MA na liście", () => {
    // Sedno reguły: „t9” zniknął po zmianie filtra, więc nie może wejść
    // do partii - a bez przecięcia wchodził.
    const selected = new Set(["t1", "t9"]);
    expect(visibleThreadSelection(selected, visibleThreadIds(rows))).toEqual(["t1"]);
  });

  it("pusta lista wierszy zeruje zaznaczenie bez rzucania", () => {
    expect(visibleThreadSelection(new Set(["t1"]), visibleThreadIds([]))).toEqual([]);
  });

  it("przełączanie dodaje i odejmuje, zwracając NOWY zbiór", () => {
    const first = toggleThreadSelection(new Set<string>(), "t1");
    expect([...first]).toEqual(["t1"]);
    const second = toggleThreadSelection(first, "t1");
    expect([...second]).toEqual([]);
    expect([...first]).toEqual(["t1"]);
  });

  it("„zaznacz wszystkie” jest zaznaczone tylko przy KOMPLECIE widocznych", () => {
    expect(areAllThreadsSelected(rows, 2)).toBe(true);
    expect(areAllThreadsSelected(rows, 1)).toBe(false);
  });

  it("pusta lista NIE zapala „zaznacz wszystkie” - zero to nie komplet", () => {
    expect(areAllThreadsSelected([], 0)).toBe(false);
  });

  it("ładunek „zaznacz wszystkie” bierze wyłącznie widoczną stronę", () => {
    expect([...allThreadIds(rows)]).toEqual(["t1", "t2"]);
  });
});

describe("kierunek akcji wiersza", () => {
  it("wpis nieprzypięty i otwarty daje „przypnij” oraz „zamknij”", () => {
    const actions = threadRowActions(adminThreadRow({ pinned_at: "", locked_at: "" }));

    expect(actions.pinned).toBe(false);
    expect(actions.pin).toEqual({ action: "pin", label: "pin", undo: false });
    expect(actions.lock.action).toBe("lock");
    expect(actions.lock.label).toBe("lock");
  });

  it("wpis przypięty i zamknięty daje „odepnij” oraz „otwórz”", () => {
    const actions = threadRowActions(
      adminThreadRow({ pinned_at: "2026-08-18T10:00:00.000Z", locked_at: "2026-08-18T11:00:00Z" }),
    );

    expect(actions.pin.action).toBe("unpin");
    expect(actions.pin.label).toBe("unpin");
    expect(actions.pin.undo).toBe(true);
    expect(actions.lock.action).toBe("unlock");
    expect(actions.lock.label).toBe("unlock");
    expect(actions.locked).toBe(true);
  });

  it("wpis żywy daje „usuń”, wpis zdjęty z klubu - „przywróć”", () => {
    expect(threadRowActions(adminThreadRow({ status: "open" })).removal).toEqual({
      action: "delete",
      label: "delete",
      undo: false,
    });
    expect(threadRowActions(adminThreadRow({ status: "deleted" })).removal.action).toBe("restore");
    expect(threadRowActions(adminThreadRow({ status: "hidden" })).removal.action).toBe("restore");
    expect(threadRowActions(adminThreadRow({ status: "hidden" })).removed).toBe(true);
  });

  it("znacznik czasu jest USTAWIONY tylko wtedy, gdy niesie datę", () => {
    // Dwie postacie pustki: `null` (tak oddaje RPC) i pusty napis (tak każe
    // kontrakt typów `RETURNS TABLE`). Obie znaczą „nieprzypięty”.
    expect(isThreadMarkSet(null)).toBe(false);
    expect(isThreadMarkSet("")).toBe(false);
    expect(isThreadMarkSet("   ")).toBe(false);
    expect(isThreadMarkSet("2026-08-18T10:00:00.000Z")).toBe(true);
  });

  it("statusy zdjęcia z klubu to DOKŁADNIE dwa", () => {
    expect(isRemovedStatus("deleted")).toBe(true);
    expect(isRemovedStatus("hidden")).toBe(true);
    expect(isRemovedStatus("locked")).toBe(false);
    expect(isRemovedStatus("open")).toBe(false);
  });
});

describe("ochrona tożsamości autora", () => {
  it("wpis anonimowy chroni tożsamość", () => {
    expect(isThreadIdentityProtected(adminThreadRow({ is_anonymous: true }))).toBe(true);
  });

  it("tryb Chatham House chroni tożsamość TAKŻE przy wpisie podpisanym", () => {
    expect(
      isThreadIdentityProtected(
        adminThreadRow({ is_anonymous: false, attribution_mode: "chatham" }),
      ),
    ).toBe(true);
  });

  it("wpis podpisany w trybie jawnym pokazuje autora", () => {
    expect(
      isThreadIdentityProtected(adminThreadRow({ is_anonymous: false, attribution_mode: "named" })),
    ).toBe(false);
  });
});

describe("kompozytor nowego tematu", () => {
  const groups = [{ id: CLUB_IDS.group }, { id: CLUB_IDS.otherGroup }];

  function draft(overrides: Partial<AdminThreadDraft> = {}): AdminThreadDraft {
    return {
      groupId: "",
      title: "Tytuł dostatecznie długi",
      body: "Treść dostatecznie długa, żeby przejść próg.",
      kind: "discussion",
      authorId: "",
      topic: null,
      ...overrides,
    };
  }

  it("dział wybrany jawnie wygrywa z pierwszym z listy", () => {
    expect(composerGroupId(CLUB_IDS.otherGroup, groups)).toBe(CLUB_IDS.otherGroup);
  });

  it("bez wyboru bierze PIERWSZY dział - kompozytor nie startuje pusty", () => {
    expect(composerGroupId("", groups)).toBe(CLUB_IDS.group);
  });

  it("klub bez działów oddaje pustkę, a nie wywala się na indeksie", () => {
    expect(composerGroupId("", [])).toBe("");
  });

  it("ładunek jedzie PRZYCIĘTY, a pusty wybór osoby jako null", () => {
    const vars = adminThreadCreateVars(
      draft({ title: "   Tytuł tematu   ", body: "   Treść tematu z zapasem   " }),
      CLUB_IDS.group,
    );

    expect(vars).toEqual({
      groupId: CLUB_IDS.group,
      title: "Tytuł tematu",
      body: "Treść tematu z zapasem",
      kind: "discussion",
      authorId: null,
      topic: null,
    });
  });

  it("publikacja w imieniu przenosi identyfikator osoby do ładunku", () => {
    const vars = adminThreadCreateVars(
      draft({ authorId: CLUB_IDS.member, kind: "question", topic: "energy" }),
      CLUB_IDS.group,
    );

    expect(vars?.authorId).toBe(CLUB_IDS.member);
    expect(vars?.kind).toBe("question");
    expect(vars?.topic).toBe("energy");
  });

  it("brak działu blokuje ładunek", () => {
    expect(adminThreadCreateVars(draft(), "")).toBeNull();
  });

  it("tytuł na granicy progu: o znak krócej blokuje, próg przechodzi", () => {
    const short = "a".repeat(ADMIN_THREAD_MIN_TITLE - 1);
    const exact = "a".repeat(ADMIN_THREAD_MIN_TITLE);

    expect(adminThreadCreateVars(draft({ title: short }), CLUB_IDS.group)).toBeNull();
    expect(adminThreadCreateVars(draft({ title: exact }), CLUB_IDS.group)?.title).toBe(exact);
  });

  it("treść na granicy progu liczy się PO przycięciu, nie przed", () => {
    const padded = `   ${"b".repeat(ADMIN_THREAD_MIN_BODY - 1)}   `;

    // Napis surowy ma ponad dziesięć znaków - liczy się treść, nie odstępy.
    expect(padded.length).toBeGreaterThan(ADMIN_THREAD_MIN_BODY);
    expect(adminThreadCreateVars(draft({ body: padded }), CLUB_IDS.group)).toBeNull();
  });

  it("ostrzeżenie pod wyborem osoby zmienia się na wersję o publikacji w imieniu", () => {
    expect(onBehalfLabel("")).toBe("onBehalfHint");
    expect(onBehalfLabel(CLUB_IDS.member)).toBe("onBehalfWarning");
  });
});

describe("odpowiedź z panelu", () => {
  it("ładunek przycina treść i zamienia pusty wybór osoby na null", () => {
    expect(adminReplyVars(CLUB_IDS.thread, "  odpowiedź  ", "")).toEqual({
      threadId: CLUB_IDS.thread,
      body: "odpowiedź",
      authorId: null,
    });
  });

  it("publikacja w imieniu członka przenosi identyfikator", () => {
    expect(adminReplyVars(CLUB_IDS.thread, "odpowiedź", CLUB_IDS.member)?.authorId).toBe(
      CLUB_IDS.member,
    );
  });

  it("pusta treść nie daje ładunku - żądanie nie wychodzi z przeglądarki", () => {
    expect(adminReplyVars(CLUB_IDS.thread, "   ", "")).toBeNull();
    expect(canPostAdminReply("   ")).toBe(false);
    expect(canPostAdminReply("x")).toBe(true);
  });

  it("brak wątku nie daje ładunku wcale", () => {
    expect(adminReplyVars(null, "odpowiedź", "")).toBeNull();
    expect(adminReplyVars("", "odpowiedź", "")).toBeNull();
  });
});

describe("przeniesienie i strona odpowiedzi", () => {
  it("działy docelowe pomijają dział OBECNY", () => {
    const groups = [{ id: "g1" }, { id: "g2" }];
    expect(threadMoveTargets(groups, "g1")).toEqual([{ id: "g2" }]);
  });

  it("wątek bez działu nie odsiewa niczego", () => {
    const groups = [{ id: "g1" }];
    expect(threadMoveTargets(groups, undefined)).toEqual(groups);
    expect(threadMoveTargets(groups, null)).toEqual(groups);
  });

  it("strona odpowiedzi jest ucięta, gdy suma z RPC przewyższa widoczne", () => {
    expect(isRepliesPageTruncated(300, 50)).toBe(true);
    expect(isRepliesPageTruncated(50, 50)).toBe(false);
    expect(isRepliesPageTruncated(0, 0)).toBe(false);
  });

  it("wcięcie odpowiedzi rośnie z poziomem, a ujemny poziom nie wychodzi w lewo", () => {
    expect(replyIndentPx(0)).toBe(0);
    expect(replyIndentPx(3)).toBe(36);
    expect(replyIndentPx(-2)).toBe(0);
  });
});
