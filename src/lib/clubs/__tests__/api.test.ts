// `src/lib/clubs/api.ts` - 1 265 linii, 70 funkcji, ZERO wywołań w suicie do
// dziś. To jest lej, przez który przechodzi każdy ekran klubu: katalog, karta,
// działy, członkowie, zaproszenia, wątki, reakcje, moderacja i panel.
//
// CZEGO TU NIE MA SENSU TESTOWAĆ, I DLACZEGO. Cała autoryzacja modułu żyje
// w funkcjach SECURITY DEFINER. W `src/lib/clubs/**` nie ma ANI JEDNEGO
// zapytania `supabase.from(<tabela>)` - tabele nie mają grantów dla klienta,
// więc `from("clubs")` oddałby pusty zbiór nawet adminowi. Nie istnieje więc
// klientowy filtr po tenancie, który dałoby się tu sprawdzić; izolację
// tenanta i RLS dowodzi 19 plików pgTAP (`discussion_clubs_a1..a6`,
// `club_topics_tenant_isolation`).
//
// CO WOBEC TEGO JEST TESTOWALNE, I CO REALNIE PSUJE SIĘ W TEJ WARSTWIE.
// Zostają trzy rzeczy, wszystkie po stronie klienta:
//
//   1. KONTRAKT ARGUMENTÓW. Skoro serwer zakresuje po tym, co dostanie, to
//      zgubiony albo przemianowany argument jest równoważny utracie
//      zawężenia. `p_club_id`, które przestaje dojeżdżać, nie wywala
//      niczego - RPC dostaje `undefined` i sam decyduje, co to znaczy. Ten
//      rodzaj błędu przechodzi przez `tsc` (obiekt argumentów jest luźny),
//      przez przegląd (literówka wśród dwudziestu podobnych wierszy) i przez
//      interfejs (lista i tak coś pokazuje). Dlatego każdy argument jest tu
//      sprawdzony PO NAZWIE.
//
//   2. ROZRÓŻNIENIE `null` OD `undefined`. To nie jest czystość typów, tylko
//      realne zachowanie filtrów: pominięcie klucza daje SERWEROWY DEFAULT,
//      a jawny `null` znaczy "bez zawężenia". Kod nosi ślady dwóch defektów
//      tej klasy (`p_status` członków, `p_anchored` wątków) - oba mają tu
//      test oznaczony REGRESJA.
//
//   3. TRANSFORMACJA ZWROTKI. `total_count` z window function, kursor
//      następnej strony, `RETURNS TABLE` jako tablica jednowierszowa,
//      wartości domyślne przy pustej odpowiedzi. To jedyna logika, jaką ta
//      warstwa ma - i jedyne miejsce, w którym może skłamać widokowi.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@/integrations/supabase/client",
  async () => (await import("@/test/clubs/fixtures")).clubSupabaseMock,
);

import {
  CLUB_BASE_ISO,
  CLUB_IDS,
  adminClubRow,
  clubGroupRow,
  clubListRow,
  clubMemberRow,
  clubRpc,
  clubThreadListRow,
  moderationItem,
  resetClubRpc,
} from "@/test/clubs/fixtures";
import {
  acceptClubRules,
  adminCreateClubReply,
  adminCreateClubThread,
  banClubMember,
  bulkModerateClubTargets,
  bulkSetClubMemberRole,
  checkClubSlugAvailable,
  createClubInviteLink,
  createClubThread,
  deleteClubGroup,
  editClubReply,
  editClubThread,
  fetchAdminClub,
  fetchAdminClubGroups,
  fetchAdminClubReplies,
  fetchAdminClubStats,
  fetchAdminClubThreads,
  fetchAdminClubs,
  fetchClubActivityFeed,
  fetchClubAnchorSuggestions,
  fetchClubGroups,
  fetchClubInvitations,
  fetchClubInviteLinks,
  fetchClubList,
  fetchClubMembers,
  fetchClubModerationLog,
  fetchClubModerationQueue,
  fetchClubPendingCounts,
  fetchClubReactionActors,
  fetchClubReactions,
  fetchClubReplies,
  fetchClubStanceSummary,
  fetchClubThread,
  fetchClubThreads,
  fetchClubThreadsForAnchor,
  fetchMyClubInvitations,
  fetchMyClubMemberships,
  fetchMyThreadSubscription,
  inviteClubMember,
  inviteClubMemberByEmail,
  inviteClubSegment,
  joinClub,
  leaveClub,
  markClubRead,
  moderateClubTarget,
  moveClubThread,
  previewClubCapabilities,
  previewClubSegment,
  reactToClubTarget,
  redeemClubInviteLink,
  removeClubMember,
  reorderClubGroups,
  replyToClubThread,
  reportClubContent,
  resolveClubThread,
  respondClubInvitation,
  revealClubAuthor,
  revokeClubInviteLink,
  searchClubThreads,
  setClubMemberRole,
  setClubNotifyLevel,
  setClubStance,
  setClubThreadSubscription,
  unreactFromClubTarget,
  upsertClub,
  upsertClubGroup,
  upsertClubMember,
} from "@/lib/clubs/api";

beforeEach(() => resetClubRpc());

// ---------------------------------------------------------------------------
// Odczyt produktowy
// ---------------------------------------------------------------------------

describe("fetchClubList", () => {
  it("woła club_list z limitem i offsetem, sumę bierze z pierwszego wiersza", async () => {
    clubRpc.setData("club_list", [clubListRow({ total_count: 37 }), clubListRow({ id: "club-9" })]);

    const page = await fetchClubList({ limit: 24, offset: 48 });

    const call = clubRpc.lastCall("club_list");
    expect(call?.arg("p_limit")).toBe(24);
    expect(call?.arg("p_offset")).toBe(48);
    expect(page.rows).toHaveLength(2);
    // Suma pochodzi z window function w wierszu, nie z długości strony -
    // inaczej katalog pokazywałby "2" przy trzydziestu siedmiu klubach.
    expect(page.total).toBe(37);
  });

  it("bez argumentów bierze domyślne 100/0", async () => {
    clubRpc.setData("club_list", []);

    await fetchClubList();

    expect(clubRpc.lastCall("club_list")?.args).toEqual({ p_limit: 100, p_offset: 0 });
  });

  it("pusta odpowiedź daje sumę zero, a nie NaN z niedostępnego wiersza", async () => {
    clubRpc.setData("club_list", []);
    expect(await fetchClubList()).toEqual({ rows: [], total: 0 });
  });

  it("brak danych (null) czyta się jak pustą listę", async () => {
    clubRpc.setData("club_list", null);
    expect(await fetchClubList()).toEqual({ rows: [], total: 0 });
  });

  it("odmowa bazy leci wyżej jako wyjątek", async () => {
    clubRpc.setError("club_list", "permission denied", "42501");
    await expect(fetchClubList()).rejects.toThrow("permission denied");
  });
});

describe("fetchClubGroups", () => {
  it("przekazuje p_club_id i oddaje wiersze", async () => {
    clubRpc.setData("club_groups_list", [clubGroupRow()]);

    const rows = await fetchClubGroups(CLUB_IDS.club);

    expect(clubRpc.lastCall("club_groups_list")?.arg("p_club_id")).toBe(CLUB_IDS.club);
    expect(rows).toHaveLength(1);
  });

  it("null z bazy zamienia na pustą listę", async () => {
    clubRpc.setData("club_groups_list", null);
    expect(await fetchClubGroups(CLUB_IDS.club)).toEqual([]);
  });

  it("rzuca przy błędzie", async () => {
    clubRpc.setError("club_groups_list", "boom");
    await expect(fetchClubGroups(CLUB_IDS.club)).rejects.toThrow("boom");
  });
});

describe("fetchMyClubMemberships", () => {
  it("woła club_my_memberships BEZ argumentów - zakres bierze się z sesji", async () => {
    clubRpc.setData("club_my_memberships", []);

    await fetchMyClubMemberships();

    // Brak argumentów jest tu kontraktem, nie przeoczeniem: gdyby klient
    // podawał własne `p_user_id`, każdy mógłby przeczytać cudze członkostwa.
    expect(clubRpc.lastCall("club_my_memberships")?.args).toBeUndefined();
  });

  it("rzuca przy błędzie (brak sesji to odmowa RPC, nie pusta lista)", async () => {
    clubRpc.setError("club_my_memberships", "JWT expired", "PGRST301");
    await expect(fetchMyClubMemberships()).rejects.toThrow("JWT expired");
  });
});

describe("fetchClubMembers", () => {
  it("REGRESJA: jawny null w statusie znaczy WSZYSTKIE i musi dojechać jako null", async () => {
    clubRpc.setData("club_members_list", []);

    await fetchClubMembers({ clubId: CLUB_IDS.club, status: null });

    // `?? "active"` zamieniało jawny null na "active", więc droplista
    // "Wszystkie" - stan początkowy zakładki członków - cicho pokazywała
    // wyłącznie aktywnych, a wiersze 'invited'/'pending' były z panelu
    // nieosiągalne.
    expect(clubRpc.lastCall("club_members_list")?.arg("p_status")).toBeNull();
  });

  it("brak preferencji (undefined) daje 'active', nie null", async () => {
    clubRpc.setData("club_members_list", []);

    await fetchClubMembers({ clubId: CLUB_IDS.club });

    expect(clubRpc.lastCall("club_members_list")?.arg("p_status")).toBe("active");
  });

  it("konkretny status jedzie bez zmian", async () => {
    clubRpc.setData("club_members_list", []);

    await fetchClubMembers({ clubId: CLUB_IDS.club, status: "pending" });

    expect(clubRpc.lastCall("club_members_list")?.arg("p_status")).toBe("pending");
  });

  it("paginacja: domyślne 50/0 i suma z wiersza", async () => {
    clubRpc.setData("club_members_list", [clubMemberRow({ total_count: 128 })]);

    const page = await fetchClubMembers({ clubId: CLUB_IDS.club });

    const call = clubRpc.lastCall("club_members_list");
    expect(call?.arg("p_limit")).toBe(50);
    expect(call?.arg("p_offset")).toBe(0);
    expect(page.total).toBe(128);
  });

  it("paginacja: przekazane limit/offset wygrywają", async () => {
    clubRpc.setData("club_members_list", []);

    await fetchClubMembers({ clubId: CLUB_IDS.club, limit: 25, offset: 75 });

    const call = clubRpc.lastCall("club_members_list");
    expect(call?.arg("p_limit")).toBe(25);
    expect(call?.arg("p_offset")).toBe(75);
  });

  it("total_count przychodzi jako tekst i jest liczbą po stronie klienta", async () => {
    // PostgREST potrafi oddać bigint jako string; `Number(...)` w warstwie
    // danych jest jedynym miejscem, w którym to się prostuje.
    clubRpc.setResponse("club_members_list", () => ({
      data: [{ ...clubMemberRow(), total_count: "300" }],
      error: null,
    }));

    expect((await fetchClubMembers({ clubId: CLUB_IDS.club })).total).toBe(300);
  });

  it("rzuca przy błędzie", async () => {
    clubRpc.setError("club_members_list", "denied");
    await expect(fetchClubMembers({ clubId: CLUB_IDS.club })).rejects.toThrow("denied");
  });
});

// ---------------------------------------------------------------------------
// Panel administracyjny
// ---------------------------------------------------------------------------

describe("fetchAdminClubs", () => {
  it("puste i białe wyszukiwanie NIE jedzie jako filtr", async () => {
    clubRpc.setData("admin_club_list", []);

    await fetchAdminClubs({ search: "   " });

    // Pusty filtr przekazany jako "" zawęziłby wynik do klubów o pustej
    // nazwie, czyli do zera - lista wyglądałaby na uszkodzoną.
    expect(clubRpc.lastCall("admin_club_list")?.arg("p_search")).toBeUndefined();
  });

  it("wyszukiwanie jest przycinane z białych znaków", async () => {
    clubRpc.setData("admin_club_list", []);

    await fetchAdminClubs({ search: "  energia  " });

    expect(clubRpc.lastCall("admin_club_list")?.arg("p_search")).toBe("energia");
  });

  it("filtry statusu i widoczności jadą pod swoimi nazwami", async () => {
    clubRpc.setData("admin_club_list", [adminClubRow({ total_count: 5 })]);

    const page = await fetchAdminClubs({ status: "draft", visibility: "secret", limit: 10 });

    const call = clubRpc.lastCall("admin_club_list");
    expect(call?.arg("p_status")).toBe("draft");
    expect(call?.arg("p_visibility")).toBe("secret");
    expect(call?.arg("p_limit")).toBe(10);
    expect(page.total).toBe(5);
  });

  it("rzuca przy błędzie", async () => {
    clubRpc.setError("admin_club_list", "denied");
    await expect(fetchAdminClubs({})).rejects.toThrow("denied");
  });
});

describe("upsertClub / upsertClubGroup - kształt ładunku", () => {
  it("upsertClub przepuszcza patch przez JSON i zwraca id", async () => {
    clubRpc.setData("admin_club_upsert", CLUB_IDS.club);

    const id = await upsertClub({ id: CLUB_IDS.club, name_pl: "Nowa nazwa" });

    expect(id).toBe(CLUB_IDS.club);
    expect(clubRpc.lastCall("admin_club_upsert")?.arg("p_payload")).toEqual({
      id: CLUB_IDS.club,
      name_pl: "Nowa nazwa",
    });
  });

  it("toJsonPayload ODSIEWA undefined - brak klucza znaczy 'nie ruszaj pola'", async () => {
    clubRpc.setData("admin_club_upsert", CLUB_IDS.club);

    await upsertClub({ id: CLUB_IDS.club, name_pl: "X", tagline_pl: undefined });

    const payload = clubRpc.lastCall("admin_club_upsert")?.arg("p_payload");
    expect(payload).toEqual({ id: CLUB_IDS.club, name_pl: "X" });
    expect(Object.keys(payload as object)).not.toContain("tagline_pl");
  });

  it("toJsonPayload ZACHOWUJE null - null znaczy 'wyczyść pole'", async () => {
    clubRpc.setData("admin_club_upsert", CLUB_IDS.club);

    await upsertClub({ id: CLUB_IDS.club, cover_image_url: null });

    expect(clubRpc.lastCall("admin_club_upsert")?.arg("p_payload")).toEqual({
      id: CLUB_IDS.club,
      cover_image_url: null,
    });
  });

  it("upsertClubGroup jedzie tym samym trybem pod admin_club_group_upsert", async () => {
    clubRpc.setData("admin_club_group_upsert", CLUB_IDS.group);

    const id = await upsertClubGroup({ club_id: CLUB_IDS.club, name_pl: "Dział" });

    expect(id).toBe(CLUB_IDS.group);
    expect(clubRpc.lastCall("admin_club_group_upsert")?.arg("p_payload")).toEqual({
      club_id: CLUB_IDS.club,
      name_pl: "Dział",
    });
  });

  it("obie funkcje rzucają przy odmowie", async () => {
    clubRpc.setError("admin_club_upsert", "not admin", "42501");
    clubRpc.setError("admin_club_group_upsert", "not admin", "42501");
    await expect(upsertClub({ name_pl: "X" })).rejects.toThrow("not admin");
    await expect(upsertClubGroup({ club_id: CLUB_IDS.club, name_pl: "X" })).rejects.toThrow(
      "not admin",
    );
  });
});

describe("checkClubSlugAvailable - kolizja adresów", () => {
  it("wolny adres: true", async () => {
    clubRpc.setData("admin_club_slug_available", true);
    expect(await checkClubSlugAvailable({ slug: "nowy-klub" })).toBe(true);
  });

  it("zajęty adres: false", async () => {
    clubRpc.setData("admin_club_slug_available", false);
    expect(await checkClubSlugAvailable({ slug: "zajety" })).toBe(false);
  });

  it("przy EDYCJI podaje clubId, żeby własny slug nie liczył się jako zajęty", async () => {
    clubRpc.setData("admin_club_slug_available", true);

    await checkClubSlugAvailable({ slug: "moj-klub", clubId: CLUB_IDS.club });

    expect(clubRpc.lastCall("admin_club_slug_available")?.arg("p_club_id")).toBe(CLUB_IDS.club);
  });

  it("przy TWORZENIU nie podaje clubId (null schodzi na undefined)", async () => {
    clubRpc.setData("admin_club_slug_available", true);

    await checkClubSlugAvailable({ slug: "nowy", clubId: null });

    expect(clubRpc.lastCall("admin_club_slug_available")?.arg("p_club_id")).toBeUndefined();
  });

  it("odpowiedź inna niż dokładnie true traktuje adres jako ZAJĘTY", async () => {
    // Bezpieczniejsze domyślne: niejasna zwrotka nie może otworzyć drogi do
    // zapisu, który baza i tak odrzuci unikatem.
    clubRpc.setData("admin_club_slug_available", null);
    expect(await checkClubSlugAvailable({ slug: "x" })).toBe(false);
  });

  it("rzuca przy błędzie", async () => {
    clubRpc.setError("admin_club_slug_available", "denied");
    await expect(checkClubSlugAvailable({ slug: "x" })).rejects.toThrow("denied");
  });
});

describe("reorderClubGroups", () => {
  it("kolejność jedzie JEDNYM wywołaniem, nie N zapytaniami", async () => {
    clubRpc.setData("admin_club_group_reorder", 3);

    const moved = await reorderClubGroups(CLUB_IDS.club, ["g1", "g2", "g3"]);

    expect(clubRpc.callsFor("admin_club_group_reorder")).toHaveLength(1);
    expect(clubRpc.lastCall("admin_club_group_reorder")?.arg("p_group_ids")).toEqual([
      "g1",
      "g2",
      "g3",
    ]);
    expect(moved).toBe(3);
  });

  it("nieliczbowa zwrotka schodzi na zero, nie na NaN w interfejsie", async () => {
    clubRpc.setData("admin_club_group_reorder", null);
    expect(await reorderClubGroups(CLUB_IDS.club, [])).toBe(0);
  });
});

describe("setClubMemberRole", () => {
  it("przekazuje klub, osobę, rolę i kadencję", async () => {
    clubRpc.setData("club_set_role", true);

    const ok = await setClubMemberRole({
      clubId: CLUB_IDS.club,
      userId: CLUB_IDS.member,
      role: "moderator",
      expiresAt: CLUB_BASE_ISO,
    });

    expect(ok).toBe(true);
    expect(clubRpc.lastCall("club_set_role")?.args).toEqual({
      p_club_id: CLUB_IDS.club,
      p_user_id: CLUB_IDS.member,
      p_role: "moderator",
      p_expires_at: CLUB_BASE_ISO,
    });
  });

  it("brak kadencji = rola bezterminowa (undefined, nie null)", async () => {
    clubRpc.setData("club_set_role", true);

    await setClubMemberRole({ clubId: CLUB_IDS.club, userId: CLUB_IDS.member, role: "member" });

    expect(clubRpc.lastCall("club_set_role")?.arg("p_expires_at")).toBeUndefined();
  });

  it("odmowa RPC nie udaje sukcesu", async () => {
    clubRpc.setData("club_set_role", false);
    expect(
      await setClubMemberRole({ clubId: CLUB_IDS.club, userId: CLUB_IDS.member, role: "lead" }),
    ).toBe(false);
  });
});

describe("previewClubSegment / inviteClubSegment", () => {
  it("podgląd zwraca cztery liczby, które MUSZĄ się sumować", async () => {
    clubRpc.setData("admin_club_segment_preview", [
      { matched: 100, already_member: 20, blocked: 5, will_send: 75 },
    ]);

    const preview = await previewClubSegment({
      clubId: CLUB_IDS.club,
      rule: { kind: "badge", badge: "expert" },
    });

    expect(preview).toEqual({ matched: 100, already_member: 20, blocked: 5, will_send: 75 });
    expect(preview.already_member + preview.blocked + preview.will_send).toBe(preview.matched);
  });

  it("pusta zwrotka podglądu daje zera, nie undefined w interfejsie", async () => {
    clubRpc.setData("admin_club_segment_preview", []);

    expect(await previewClubSegment({ clubId: CLUB_IDS.club, rule: { kind: "badge" } })).toEqual({
      matched: 0,
      already_member: 0,
      blocked: 0,
      will_send: 0,
    });
  });

  it("wysyłka domyślnie ZAPISUJE regułę i zwraca liczbę realnych zaproszeń", async () => {
    clubRpc.setData("admin_club_invite_segment", [{ invited: 42 }]);

    const invited = await inviteClubSegment({
      clubId: CLUB_IDS.club,
      rule: { kind: "badge", badge: "expert" },
      role: "member",
    });

    expect(invited).toBe(42);
    const call = clubRpc.lastCall("admin_club_invite_segment");
    expect(call?.arg("p_save_rule")).toBe(true);
    expect(call?.arg("p_message")).toBeUndefined();
  });

  it("jawne saveRule=false przeżywa (nie jest zjadane przez ??)", async () => {
    clubRpc.setData("admin_club_invite_segment", [{ invited: 0 }]);

    await inviteClubSegment({
      clubId: CLUB_IDS.club,
      rule: { kind: "badge" },
      role: "member",
      saveRule: false,
    });

    expect(clubRpc.lastCall("admin_club_invite_segment")?.arg("p_save_rule")).toBe(false);
  });

  it("pusta zwrotka wysyłki to zero zaproszeń", async () => {
    clubRpc.setData("admin_club_invite_segment", []);
    expect(
      await inviteClubSegment({ clubId: CLUB_IDS.club, rule: { kind: "badge" }, role: "member" }),
    ).toBe(0);
  });
});

describe("upsertClubMember / removeClubMember / deleteClubGroup", () => {
  it("upsert członka ma domyślne rolę 'member' i status 'active'", async () => {
    clubRpc.setData("admin_club_member_upsert", "membership-1");

    await upsertClubMember({ clubId: CLUB_IDS.club, userId: CLUB_IDS.member });

    const call = clubRpc.lastCall("admin_club_member_upsert");
    expect(call?.arg("p_role")).toBe("member");
    expect(call?.arg("p_status")).toBe("active");
    expect(call?.arg("p_clear_role_expiry")).toBe(false);
  });

  it("czyszczenie kadencji jest JAWNE, nie wywnioskowane z braku daty", async () => {
    clubRpc.setData("admin_club_member_upsert", "membership-1");

    await upsertClubMember({
      clubId: CLUB_IDS.club,
      userId: CLUB_IDS.member,
      clearRoleExpiry: true,
    });

    expect(clubRpc.lastCall("admin_club_member_upsert")?.arg("p_clear_role_expiry")).toBe(true);
  });

  it("usunięcie członka zwraca boolean, a nie 'coś prawdziwego'", async () => {
    clubRpc.setData("admin_club_member_remove", "yes");
    expect(await removeClubMember(CLUB_IDS.club, CLUB_IDS.member)).toBe(false);
  });

  it("kasowanie działu zwraca liczbę PRZENIESIONYCH wątków", async () => {
    clubRpc.setData("admin_club_group_delete", 12);

    const moved = await deleteClubGroup({
      groupId: CLUB_IDS.group,
      moveToGroupId: CLUB_IDS.otherGroup,
    });

    expect(moved).toBe(12);
    expect(clubRpc.lastCall("admin_club_group_delete")?.arg("p_move_to_group_id")).toBe(
      CLUB_IDS.otherGroup,
    );
  });

  it("kasowanie działu bez celu przenosin nie wysyła p_move_to_group_id", async () => {
    clubRpc.setData("admin_club_group_delete", 0);

    await deleteClubGroup({ groupId: CLUB_IDS.group });

    expect(clubRpc.lastCall("admin_club_group_delete")?.arg("p_move_to_group_id")).toBeUndefined();
  });
});

describe("odczyt panelu: pojedynczy wiersz albo null", () => {
  it("fetchAdminClub oddaje pierwszy wiersz", async () => {
    clubRpc.setData("admin_club_get", [{ id: CLUB_IDS.club }]);
    expect(await fetchAdminClub(CLUB_IDS.club)).toEqual({ id: CLUB_IDS.club });
  });

  it("fetchAdminClub przy pustej tablicy oddaje null (404, nie pusty formularz)", async () => {
    clubRpc.setData("admin_club_get", []);
    expect(await fetchAdminClub(CLUB_IDS.club)).toBeNull();
  });

  it("fetchAdminClubStats przy pustej tablicy oddaje null", async () => {
    clubRpc.setData("admin_club_stats", []);
    expect(await fetchAdminClubStats(CLUB_IDS.club)).toBeNull();
  });

  it("fetchAdminClubGroups przy null oddaje pustą listę", async () => {
    clubRpc.setData("admin_club_groups", null);
    expect(await fetchAdminClubGroups(CLUB_IDS.club)).toEqual([]);
  });

  it("wszystkie trzy przekazują p_club_id", async () => {
    clubRpc.setData("admin_club_get", []);
    clubRpc.setData("admin_club_groups", []);
    clubRpc.setData("admin_club_stats", []);

    await fetchAdminClub(CLUB_IDS.club);
    await fetchAdminClubGroups(CLUB_IDS.club);
    await fetchAdminClubStats(CLUB_IDS.club);

    for (const name of ["admin_club_get", "admin_club_groups", "admin_club_stats"]) {
      expect(clubRpc.lastCall(name)?.arg("p_club_id")).toBe(CLUB_IDS.club);
    }
  });
});

describe("previewClubCapabilities", () => {
  it("używa prefiksu _ (nie p_) - to inna rodzina RPC", async () => {
    clubRpc.setData("admin_club_capabilities_preview", [{ can_read: true }]);

    await previewClubCapabilities({ clubId: CLUB_IDS.club, userId: CLUB_IDS.member });

    const call = clubRpc.lastCall("admin_club_capabilities_preview");
    expect(call?.keys()).toEqual(["_club_id", "_user_id", "_group_id"]);
    expect(call?.arg("_club_id")).toBe(CLUB_IDS.club);
    expect(call?.arg("_user_id")).toBe(CLUB_IDS.member);
  });

  it("pusta zwrotka normalizuje się do zdolnosci zamkniętych", async () => {
    clubRpc.setData("admin_club_capabilities_preview", []);

    const caps = await previewClubCapabilities({
      clubId: CLUB_IDS.club,
      userId: CLUB_IDS.member,
    });

    expect(caps.canRead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Zaproszenia i samoobsługa członkostwa
// ---------------------------------------------------------------------------

describe("zaproszenia", () => {
  it("inviteClubMember domyślnie zaprasza jako 'member'", async () => {
    clubRpc.setData("club_invite", CLUB_IDS.invitation);

    await inviteClubMember({ clubId: CLUB_IDS.club, userId: CLUB_IDS.member });

    expect(clubRpc.lastCall("club_invite")?.arg("p_role")).toBe("member");
  });

  it("inviteClubMemberByEmail przekazuje adres i dział", async () => {
    clubRpc.setData("club_invite_by_email", CLUB_IDS.invitation);

    await inviteClubMemberByEmail({
      clubId: CLUB_IDS.club,
      email: "kandydat@example.org",
      groupId: CLUB_IDS.group,
    });

    const call = clubRpc.lastCall("club_invite_by_email");
    expect(call?.arg("p_email")).toBe("kandydat@example.org");
    expect(call?.arg("p_group_id")).toBe(CLUB_IDS.group);
  });

  it("createClubInviteLink oddaje token TYLKO z niepustej zwrotki", async () => {
    clubRpc.setData("admin_club_invite_link_create", [{ id: CLUB_IDS.link, token: "tok-123" }]);

    expect(await createClubInviteLink({ clubId: CLUB_IDS.club })).toEqual({
      id: CLUB_IDS.link,
      token: "tok-123",
    });
  });

  it("createClubInviteLink rzuca przy pustej zwrotce zamiast oddać link bez tokenu", async () => {
    clubRpc.setData("admin_club_invite_link_create", []);
    await expect(createClubInviteLink({ clubId: CLUB_IDS.club })).rejects.toThrow(
      "clubs: link not created",
    );
  });

  it("createClubInviteLink: domyślnie bez zatwierdzania i jako 'member'", async () => {
    clubRpc.setData("admin_club_invite_link_create", [{ id: CLUB_IDS.link, token: "t" }]);

    await createClubInviteLink({ clubId: CLUB_IDS.club });

    const call = clubRpc.lastCall("admin_club_invite_link_create");
    expect(call?.arg("p_requires_approval")).toBe(false);
    expect(call?.arg("p_role")).toBe("member");
    expect(call?.arg("p_max_uses")).toBeUndefined();
  });

  it("revokeClubInviteLink zwraca boolean po p_link_id", async () => {
    clubRpc.setData("admin_club_invite_link_revoke", true);

    expect(await revokeClubInviteLink(CLUB_IDS.link)).toBe(true);
    expect(clubRpc.lastCall("admin_club_invite_link_revoke")?.arg("p_link_id")).toBe(CLUB_IDS.link);
  });

  it("listy zaproszeń i linków oddają [] przy null", async () => {
    clubRpc.setData("admin_club_invite_links", null);
    clubRpc.setData("admin_club_invitations", null);
    clubRpc.setData("club_my_invitations", null);

    expect(await fetchClubInviteLinks(CLUB_IDS.club)).toEqual([]);
    expect(await fetchClubInvitations(CLUB_IDS.club)).toEqual([]);
    expect(await fetchMyClubInvitations()).toEqual([]);
  });
});

describe("samoobsługa członkostwa", () => {
  it("joinClub oddaje status z bazy ('active' dla klubu otwartego)", async () => {
    clubRpc.setData("club_join", "active");
    expect(await joinClub(CLUB_IDS.club)).toBe("active");
  });

  it("joinClub przy nieoczekiwanej zwrotce zakłada 'pending' (bezpieczniejsze)", async () => {
    // Udawanie natychmiastowego członkostwa pokazałoby zawartość klubu
    // komuś, kto czeka na decyzję prowadzącego.
    clubRpc.setData("club_join", null);
    expect(await joinClub(CLUB_IDS.club)).toBe("pending");
  });

  it("leaveClub zwraca boolean", async () => {
    clubRpc.setData("club_leave", true);
    expect(await leaveClub(CLUB_IDS.club)).toBe(true);
  });

  it("respondClubInvitation przekazuje decyzję i oddaje status", async () => {
    clubRpc.setData("club_respond_invitation", "active");

    expect(await respondClubInvitation({ invitationId: CLUB_IDS.invitation, accept: true })).toBe(
      "active",
    );
    expect(clubRpc.lastCall("club_respond_invitation")?.arg("p_accept")).toBe(true);
  });

  it("respondClubInvitation przy nieoczekiwanej zwrotce zakłada 'declined'", async () => {
    clubRpc.setData("club_respond_invitation", 7);
    expect(await respondClubInvitation({ invitationId: CLUB_IDS.invitation, accept: false })).toBe(
      "declined",
    );
  });

  it("redeemClubInviteLink oddaje slug klubu i status", async () => {
    clubRpc.setData("club_redeem_invite_link", [{ club_slug: "klub-x", status: "active" }]);

    expect(await redeemClubInviteLink("tok")).toEqual({ clubSlug: "klub-x", status: "active" });
  });

  it("redeemClubInviteLink rzuca na pustej zwrotce (link nieważny)", async () => {
    clubRpc.setData("club_redeem_invite_link", []);
    await expect(redeemClubInviteLink("zly-token")).rejects.toThrow("clubs: invalid link");
  });

  it("setClubNotifyLevel i acceptClubRules zwracają boolean", async () => {
    clubRpc.setData("club_set_notify_level", true);
    clubRpc.setData("club_accept_rules", true);

    expect(await setClubNotifyLevel({ clubId: CLUB_IDS.club, level: "all" })).toBe(true);
    expect(await acceptClubRules(CLUB_IDS.club)).toBe(true);
    expect(clubRpc.lastCall("club_set_notify_level")?.arg("p_level")).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// Wątki i odpowiedzi
// ---------------------------------------------------------------------------

describe("fetchClubThreads - kursor i filtry", () => {
  it("pełna strona oddaje kursor OSTATNIEGO wiersza", async () => {
    clubRpc.setData("club_threads_list", [
      clubThreadListRow({ cursor_value: "c1" }),
      clubThreadListRow({ id: "t2", cursor_value: "c2" }),
    ]);

    const page = await fetchClubThreads({ clubId: CLUB_IDS.club, limit: 2 });

    expect(page.nextCursor).toBe("c2");
  });

  it("krótsza strona niż limit znaczy KONIEC - bez dodatkowego zapytania", async () => {
    clubRpc.setData("club_threads_list", [clubThreadListRow({ cursor_value: "c1" })]);

    const page = await fetchClubThreads({ clubId: CLUB_IDS.club, limit: 20 });

    expect(page.nextCursor).toBeNull();
    expect(clubRpc.callsFor("club_threads_list")).toHaveLength(1);
  });

  it("REGRESJA: anchored=false znaczy 'tylko BEZ kotwicy' i musi dojechać jako false", async () => {
    clubRpc.setData("club_threads_list", []);

    await fetchClubThreads({ clubId: CLUB_IDS.club, anchored: false });

    // `?? undefined` zamieniałoby jawne `false` na brak filtra, czyli na
    // "wszystkie wątki" - filtr wyglądałby na zepsuty, nie na nieobecny.
    expect(clubRpc.lastCall("club_threads_list")?.arg("p_anchored")).toBe(false);
  });

  it("anchored=null znaczy 'wszystkie' i schodzi na undefined", async () => {
    clubRpc.setData("club_threads_list", []);

    await fetchClubThreads({ clubId: CLUB_IDS.club, anchored: null });

    expect(clubRpc.lastCall("club_threads_list")?.arg("p_anchored")).toBeUndefined();
  });

  it("domyślny sort to 'hot', a nie brak sortowania", async () => {
    clubRpc.setData("club_threads_list", []);

    await fetchClubThreads({ clubId: CLUB_IDS.club });

    expect(clubRpc.lastCall("club_threads_list")?.arg("p_sort")).toBe("hot");
  });

  it("KAŻDY sort jedzie do RPC bez zamiany na 'hot'", async () => {
    clubRpc.setData("club_threads_list", []);

    for (const sort of ["new", "top", "unanswered", "subscribed"] as const) {
      await fetchClubThreads({ clubId: CLUB_IDS.club, sort });
      expect(clubRpc.lastCall("club_threads_list")?.arg("p_sort")).toBe(sort);
    }
  });

  it("unreadOnly domyślnie false (jawnie, nie przez pominięcie klucza)", async () => {
    clubRpc.setData("club_threads_list", []);

    await fetchClubThreads({ clubId: CLUB_IDS.club });

    expect(clubRpc.lastCall("club_threads_list")?.arg("p_unread_only")).toBe(false);
  });

  it("komplet argumentów jedzie pod umówionymi nazwami", async () => {
    clubRpc.setData("club_threads_list", []);

    await fetchClubThreads({
      clubId: CLUB_IDS.club,
      groupId: CLUB_IDS.group,
      sort: "new",
      kind: "question",
      status: "open",
      anchored: true,
      unreadOnly: true,
      topic: "energy",
      cursor: "c-9",
      limit: 5,
    });

    expect(clubRpc.lastCall("club_threads_list")?.args).toEqual({
      p_club_id: CLUB_IDS.club,
      p_group_id: CLUB_IDS.group,
      p_sort: "new",
      p_kind: "question",
      p_status: "open",
      p_anchored: true,
      p_unread_only: true,
      p_topic: "energy",
      p_cursor: "c-9",
      p_limit: 5,
    });
  });
});

describe("fetchClubThread / fetchClubReplies", () => {
  it("karta wątku oddaje pierwszy wiersz albo null", async () => {
    clubRpc.setData("club_thread_view", [{ id: CLUB_IDS.thread }]);
    expect(await fetchClubThread({ clubId: CLUB_IDS.club, slug: "t" })).toEqual({
      id: CLUB_IDS.thread,
    });

    clubRpc.setData("club_thread_view", []);
    expect(await fetchClubThread({ clubId: CLUB_IDS.club, slug: "t" })).toBeNull();
  });

  it("odpowiedzi: strona I suma jadą razem", async () => {
    clubRpc.setData("club_replies_list", [{ id: CLUB_IDS.reply, total_count: 340 }]);

    const page = await fetchClubReplies({ threadId: CLUB_IDS.thread });

    // Bez sumy wątek powyżej dwustu odpowiedzi urywał się bez śladu, a
    // nagłówek pokazywał pełną liczbę z licznika denormalizowanego.
    expect(page.total).toBe(340);
    expect(clubRpc.lastCall("club_replies_list")?.arg("p_limit")).toBe(200);
    expect(clubRpc.lastCall("club_replies_list")?.arg("p_sort")).toBe("chronological");
  });

  it("odpowiedzi: pusta strona to suma zero", async () => {
    clubRpc.setData("club_replies_list", []);
    expect(await fetchClubReplies({ threadId: CLUB_IDS.thread })).toEqual({ rows: [], total: 0 });
  });
});

describe("createClubThread", () => {
  it("zakłada wątek i oddaje id, slug oraz STATUS (pending = premoderacja)", async () => {
    clubRpc.setData("club_create_thread", [
      { id: CLUB_IDS.thread, slug: "temat", status: "pending" },
    ]);

    const created = await createClubThread({
      groupId: CLUB_IDS.group,
      title: "Temat",
      body: "Treść",
    });

    // Status musi wyjść na wierzch: 'pending' znaczy, że autor NIE zobaczy
    // swojego wątku, dopóki prowadzenie go nie zatwierdzi.
    expect(created).toEqual({ id: CLUB_IDS.thread, slug: "temat", status: "pending" });
  });

  it("domyślne: rodzaj 'discussion', jawnie nieanonimowo, odpowiedzi otwarte", async () => {
    clubRpc.setData("club_create_thread", [{ id: "t", slug: "s", status: "published" }]);

    await createClubThread({ groupId: CLUB_IDS.group, title: "T", body: "B" });

    const call = clubRpc.lastCall("club_create_thread");
    expect(call?.arg("p_kind")).toBe("discussion");
    expect(call?.arg("p_anonymous")).toBe(false);
    expect(call?.arg("p_lock_replies")).toBe(false);
  });

  it("klucz idempotencji dojeżdża - bez niego podwójny klik zakłada dwa wątki", async () => {
    clubRpc.setData("club_create_thread", [{ id: "t", slug: "s", status: "published" }]);

    await createClubThread({
      groupId: CLUB_IDS.group,
      title: "T",
      body: "B",
      idempotencyKey: "akcja-1",
    });

    expect(clubRpc.lastCall("club_create_thread")?.arg("p_idempotency_key")).toBe("akcja-1");
  });

  it("rzuca przy pustej zwrotce zamiast udawać utworzony wątek", async () => {
    clubRpc.setData("club_create_thread", []);
    await expect(
      createClubThread({ groupId: CLUB_IDS.group, title: "T", body: "B" }),
    ).rejects.toThrow("clubs: thread not created");
  });
});

describe("replyToClubThread", () => {
  it("status 'pending' z bazy znaczy queued=true", async () => {
    clubRpc.setData("club_reply", [{ reply_id: CLUB_IDS.reply, reply_status: "pending" }]);

    expect(await replyToClubThread({ threadId: CLUB_IDS.thread, body: "B" })).toEqual({
      id: CLUB_IDS.reply,
      queued: true,
    });
  });

  it("status 'published' znaczy queued=false", async () => {
    clubRpc.setData("club_reply", [{ reply_id: CLUB_IDS.reply, reply_status: "published" }]);

    expect((await replyToClubThread({ threadId: CLUB_IDS.thread, body: "B" })).queued).toBe(false);
  });

  it("rzuca przy pustej zwrotce - brak wpisu jest bezpieczniejszy niż udana publikacja", async () => {
    clubRpc.setData("club_reply", []);
    await expect(replyToClubThread({ threadId: CLUB_IDS.thread, body: "B" })).rejects.toThrow(
      "club_reply: brak wiersza wyniku",
    );
  });

  it("odpowiedź na odpowiedź przekazuje rodzica", async () => {
    clubRpc.setData("club_reply", [{ reply_id: "r2", reply_status: "published" }]);

    await replyToClubThread({
      threadId: CLUB_IDS.thread,
      body: "B",
      parentId: CLUB_IDS.reply,
      anonymous: true,
    });

    const call = clubRpc.lastCall("club_reply");
    expect(call?.arg("p_parent_id")).toBe(CLUB_IDS.reply);
    expect(call?.arg("p_anonymous")).toBe(true);
  });
});

describe("edycja i rozstrzyganie wątku", () => {
  it("editClubThread pozwala na redakcję CZĘŚCIOWĄ (sam tytuł)", async () => {
    clubRpc.setData("club_edit_thread", true);

    await editClubThread({ threadId: CLUB_IDS.thread, title: "Nowy tytuł" });

    const call = clubRpc.lastCall("club_edit_thread");
    expect(call?.arg("p_title")).toBe("Nowy tytuł");
    // PUSTY STRING, nie undefined - i to jest poprawne. `club_edit_thread`
    // składa UPDATE jako `COALESCE(NULLIF(btrim(p_body), ''), body)`, więc to
    // pusty string jest po stronie SQL-a sygnałem "nie ruszaj pola". Gdyby
    // klient wysyłał tu `undefined`, argument bez DEFAULT-u w sygnaturze
    // funkcji wywróciłby wywołanie zamiast zostawić treść w spokoju.
    expect(call?.arg("p_body")).toBe("");
  });

  it("powód redakcji moderatorskiej dojeżdża do dziennika", async () => {
    clubRpc.setData("club_edit_reply", true);

    await editClubReply({ replyId: CLUB_IDS.reply, body: "B", reason: "dane osobowe" });

    expect(clubRpc.lastCall("club_edit_reply")?.arg("p_reason")).toBe("dane osobowe");
  });

  it("resolveClubThread ze wskazaniem odpowiedzi i bez niego", async () => {
    clubRpc.setData("club_resolve_thread", true);

    await resolveClubThread({ threadId: CLUB_IDS.thread, replyId: CLUB_IDS.reply });
    expect(clubRpc.lastCall("club_resolve_thread")?.arg("p_reply_id")).toBe(CLUB_IDS.reply);

    // NULL jest tu POPRAWNĄ wartością (cofnięcie oznaczenia), więc jedzie
    // wprost - zamiana na `undefined` znaczyłaby serwerowy DEFAULT, czyli
    // cofnięcie przestałoby działać.
    await resolveClubThread({ threadId: CLUB_IDS.thread, replyId: null });
    expect(clubRpc.lastCall("club_resolve_thread")?.arg("p_reply_id")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reakcje, stanowiska, subskrypcje
// ---------------------------------------------------------------------------

describe("reakcje - odczyt wsadowy", () => {
  it("pusta lista celów NIE woła bazy (nigdy N+1, ale też nigdy 0+1)", async () => {
    const map = await fetchClubReactions({ targetType: "thread", targetIds: [] });

    expect(map.size).toBe(0);
    expect(clubRpc.callsFor("club_reactions_for")).toHaveLength(0);
  });

  it("jedno wywołanie dla CAŁEJ widocznej partii", async () => {
    clubRpc.setData("club_reactions_for", []);

    await fetchClubReactions({ targetType: "reply", targetIds: ["a", "b", "c"] });

    expect(clubRpc.callsFor("club_reactions_for")).toHaveLength(1);
    expect(clubRpc.lastCall("club_reactions_for")?.arg("p_target_ids")).toEqual(["a", "b", "c"]);
  });

  it("twarze reagujących: pusta lista celów też nie woła bazy", async () => {
    const map = await fetchClubReactionActors({ targetType: "thread", targetIds: [] });

    expect(map.size).toBe(0);
    expect(clubRpc.callsFor("club_reaction_actors")).toHaveLength(0);
  });

  it("twarze reagujących: domyślny limit 6 na cel", async () => {
    clubRpc.setData("club_reaction_actors", []);

    await fetchClubReactionActors({ targetType: "thread", targetIds: ["a"] });

    expect(clubRpc.lastCall("club_reaction_actors")?.arg("p_limit")).toBe(6);
  });

  it("react/unreact zwracają boolean i przekazują rodzaj reakcji", async () => {
    clubRpc.setData("club_react", true);
    clubRpc.setData("club_unreact", true);

    expect(
      await reactToClubTarget({
        targetType: "thread",
        targetId: CLUB_IDS.thread,
        kind: "insightful",
      }),
    ).toBe(true);
    expect(clubRpc.lastCall("club_react")?.arg("p_kind")).toBe("insightful");

    expect(
      await unreactFromClubTarget({
        targetType: "thread",
        targetId: CLUB_IDS.thread,
        kind: "insightful",
      }),
    ).toBe(true);
  });
});

describe("stanowiska i subskrypcje", () => {
  it("fetchClubStanceSummary oddaje [] przy null", async () => {
    clubRpc.setData("club_stance_summary", null);
    expect(await fetchClubStanceSummary(CLUB_IDS.thread)).toEqual([]);
  });

  it("setClubStance bez uzasadnienia nie wysyła pustego p_rationale", async () => {
    clubRpc.setData("club_set_stance", true);

    await setClubStance({ threadId: CLUB_IDS.thread, stance: "support" });

    expect(clubRpc.lastCall("club_set_stance")?.arg("p_rationale")).toBeUndefined();
  });

  it("subskrypcja: rozpoznaje wyłącznie 'subscribed' i 'muted'", async () => {
    clubRpc.setData("club_my_subscription", "subscribed");
    expect(await fetchMyThreadSubscription(CLUB_IDS.thread)).toBe("subscribed");

    clubRpc.setData("club_my_subscription", "muted");
    expect(await fetchMyThreadSubscription(CLUB_IDS.thread)).toBe("muted");
  });

  it("subskrypcja: brak wpisu daje null, czyli DOMYŚLNY poziom klubu", async () => {
    clubRpc.setData("club_my_subscription", null);
    expect(await fetchMyThreadSubscription(CLUB_IDS.thread)).toBeNull();

    // Nieznana wartość z nowszej migracji też schodzi na domyślny poziom,
    // zamiast wywracać widok.
    clubRpc.setData("club_my_subscription", "digest");
    expect(await fetchMyThreadSubscription(CLUB_IDS.thread)).toBeNull();
  });

  it("setClubThreadSubscription przekazuje stan", async () => {
    clubRpc.setData("club_subscribe_thread", true);

    await setClubThreadSubscription({ threadId: CLUB_IDS.thread, state: "muted" });

    expect(clubRpc.lastCall("club_subscribe_thread")?.arg("p_state")).toBe("muted");
  });
});

// ---------------------------------------------------------------------------
// Koordynacja w panelu i moderacja
// ---------------------------------------------------------------------------

describe("listy panelu", () => {
  it("admin_club_threads: puste wyszukiwanie nie jedzie jako filtr", async () => {
    clubRpc.setData("admin_club_threads", []);

    await fetchAdminClubThreads({ clubId: CLUB_IDS.club, search: "  " });

    expect(clubRpc.lastCall("admin_club_threads")?.arg("p_search")).toBeUndefined();
  });

  it("admin_club_threads: suma z wiersza, domyślne 50/0", async () => {
    clubRpc.setData("admin_club_threads", [{ id: "t", total_count: 91 }]);

    const page = await fetchAdminClubThreads({ clubId: CLUB_IDS.club });

    expect(page.total).toBe(91);
    expect(clubRpc.lastCall("admin_club_threads")?.arg("p_limit")).toBe(50);
  });

  it("admin_club_replies: suma jedzie ze stroną (decyzja na pełnym materiale)", async () => {
    clubRpc.setData("admin_club_replies", [{ id: "r", total_count: 180 }]);

    const page = await fetchAdminClubReplies({ threadId: CLUB_IDS.thread });

    expect(page.total).toBe(180);
    expect(clubRpc.lastCall("admin_club_replies")?.arg("p_limit")).toBe(100);
  });

  it("kolejka moderacji: suma z wiersza i domyślne 50/0", async () => {
    clubRpc.setData("admin_club_moderation_queue", [moderationItem({ total_count: 300 })]);

    const page = await fetchClubModerationQueue({ clubId: CLUB_IDS.club });

    expect(page.total).toBe(300);
    expect(page.rows).toHaveLength(1);
  });

  it("dziennik moderacji: domyślny limit 100", async () => {
    clubRpc.setData("admin_club_moderation_log", []);

    await fetchClubModerationLog({ clubId: CLUB_IDS.club });

    expect(clubRpc.lastCall("admin_club_moderation_log")?.arg("p_limit")).toBe(100);
  });

  it("liczniki plakietki: pusta zwrotka daje zera", async () => {
    clubRpc.setData("admin_club_pending_counts", []);

    expect(await fetchClubPendingCounts()).toEqual({ moderationPending: 0, joinRequests: 0 });
  });

  it("liczniki plakietki: dwie OSOBNE kolejki, nie jedna suma", async () => {
    clubRpc.setData("admin_club_pending_counts", [{ moderation_pending: 7, join_requests: 2 }]);

    expect(await fetchClubPendingCounts()).toEqual({ moderationPending: 7, joinRequests: 2 });
  });
});

describe("publikacja w imieniu (panel)", () => {
  it("adminCreateClubThread bez autora publikuje pod nazwiskiem admina", async () => {
    clubRpc.setData("admin_club_thread_create", [{ thread_id: "t", thread_slug: "s" }]);

    await adminCreateClubThread({ groupId: CLUB_IDS.group, title: "T", body: "B" });

    expect(clubRpc.lastCall("admin_club_thread_create")?.arg("p_author_id")).toBeUndefined();
  });

  it("adminCreateClubThread ze wskazanym autorem przekazuje jego id", async () => {
    clubRpc.setData("admin_club_thread_create", [{ thread_id: "t", thread_slug: "s" }]);

    const created = await adminCreateClubThread({
      groupId: CLUB_IDS.group,
      title: "T",
      body: "B",
      authorId: CLUB_IDS.member,
      pinned: true,
    });

    expect(created).toEqual({ threadId: "t", threadSlug: "s" });
    const call = clubRpc.lastCall("admin_club_thread_create");
    expect(call?.arg("p_author_id")).toBe(CLUB_IDS.member);
    expect(call?.arg("p_pinned")).toBe(true);
  });

  it("adminCreateClubThread rzuca na pustej zwrotce", async () => {
    clubRpc.setData("admin_club_thread_create", []);
    await expect(
      adminCreateClubThread({ groupId: CLUB_IDS.group, title: "T", body: "B" }),
    ).rejects.toThrow("clubs: thread not created");
  });

  it("adminCreateClubReply oddaje id odpowiedzi", async () => {
    clubRpc.setData("admin_club_reply_create", CLUB_IDS.reply);

    expect(await adminCreateClubReply({ threadId: CLUB_IDS.thread, body: "B" })).toBe(
      CLUB_IDS.reply,
    );
  });
});

describe("moderateClubTarget - dwa RPC pod jedną funkcją", () => {
  it("'restore' idzie OSOBNYM RPC (musi wiedzieć, do jakiego statusu wrócić)", async () => {
    clubRpc.setData("admin_club_restore", true);

    const ok = await moderateClubTarget({
      targetType: "thread",
      targetId: CLUB_IDS.thread,
      action: "restore",
    });

    expect(ok).toBe(true);
    expect(clubRpc.names()).toEqual(["admin_club_restore"]);
    // Kluczowe: przywrócenie NIE może pójść przez club_moderate, bo tamto
    // ustawia status z akcji, a przywracany wpis wraca do stanu sprzed ukrycia.
    expect(clubRpc.callsFor("club_moderate")).toHaveLength(0);
  });

  it("pozostałe akcje idą przez club_moderate z p_action", async () => {
    clubRpc.setData("club_moderate", true);

    for (const action of ["approve", "hide", "delete"] as const) {
      await moderateClubTarget({ targetType: "reply", targetId: CLUB_IDS.reply, action });
      expect(clubRpc.lastCall("club_moderate")?.arg("p_action")).toBe(action);
    }
    expect(clubRpc.callsFor("admin_club_restore")).toHaveLength(0);
  });

  it("powód jedzie obiema ścieżkami", async () => {
    clubRpc.setData("admin_club_restore", true);
    clubRpc.setData("club_moderate", true);

    await moderateClubTarget({
      targetType: "thread",
      targetId: CLUB_IDS.thread,
      action: "restore",
      reason: "pomyłka",
    });
    expect(clubRpc.lastCall("admin_club_restore")?.arg("p_reason")).toBe("pomyłka");

    await moderateClubTarget({
      targetType: "thread",
      targetId: CLUB_IDS.thread,
      action: "hide",
      reason: "spam",
    });
    expect(clubRpc.lastCall("club_moderate")?.arg("p_reason")).toBe("spam");
  });

  it("obie ścieżki rzucają przy odmowie", async () => {
    clubRpc.setError("admin_club_restore", "not moderator", "42501");
    clubRpc.setError("club_moderate", "not moderator", "42501");

    await expect(
      moderateClubTarget({ targetType: "thread", targetId: "t", action: "restore" }),
    ).rejects.toThrow("not moderator");
    await expect(
      moderateClubTarget({ targetType: "thread", targetId: "t", action: "hide" }),
    ).rejects.toThrow("not moderator");
  });
});

describe("operacje wsadowe", () => {
  it("bulkModerate zwraca liczbę wpisów, które FAKTYCZNIE przeszły", async () => {
    clubRpc.setData("admin_club_bulk_moderate", 47);

    const done = await bulkModerateClubTargets({
      targetType: "thread",
      targetIds: Array.from({ length: 50 }, (_, i) => `t${i}`),
      action: "approve",
    });

    // UI mówi "47 z 50" - część pozycji mogła w międzyczasie zmienić stan.
    expect(done).toBe(47);
    expect(clubRpc.lastCall("admin_club_bulk_moderate")?.arg("p_target_ids")).toHaveLength(50);
  });

  it("bulkModerate: nieliczbowa zwrotka schodzi na zero", async () => {
    clubRpc.setData("admin_club_bulk_moderate", null);
    expect(
      await bulkModerateClubTargets({ targetType: "reply", targetIds: ["r"], action: "delete" }),
    ).toBe(0);
  });

  it("bulkSetClubMemberRole przekazuje listę osób i rolę", async () => {
    clubRpc.setData("admin_club_bulk_member_role", 3);

    expect(
      await bulkSetClubMemberRole({
        clubId: CLUB_IDS.club,
        userIds: ["a", "b", "c"],
        role: "moderator",
      }),
    ).toBe(3);
    expect(clubRpc.lastCall("admin_club_bulk_member_role")?.arg("p_role")).toBe("moderator");
  });

  it("moveClubThread przenosi wątek do wskazanego działu", async () => {
    clubRpc.setData("admin_club_thread_move", true);

    expect(await moveClubThread({ threadId: CLUB_IDS.thread, groupId: CLUB_IDS.otherGroup })).toBe(
      true,
    );
    expect(clubRpc.lastCall("admin_club_thread_move")?.arg("p_group_id")).toBe(CLUB_IDS.otherGroup);
  });
});

// ---------------------------------------------------------------------------
// Wyszukiwanie
// ---------------------------------------------------------------------------

describe("searchClubThreads", () => {
  it("fraza krótsza niż 2 znaki NIE woła bazy w ogóle", async () => {
    expect(await searchClubThreads({ query: "a" })).toEqual([]);
    expect(await searchClubThreads({ query: "   " })).toEqual([]);
    expect(clubRpc.calls).toHaveLength(0);
  });

  it("bez wektora leci WYŁĄCZNIE warstwa pełnotekstowa", async () => {
    clubRpc.setData("club_search", []);

    await searchClubThreads({ query: "energia" });

    expect(clubRpc.names()).toEqual(["club_search"]);
  });

  it("pusty wektor też nie uruchamia warstwy semantycznej", async () => {
    clubRpc.setData("club_search", []);

    await searchClubThreads({ query: "energia", embedding: [] });

    expect(clubRpc.callsFor("club_semantic_search")).toHaveLength(0);
  });

  it("z wektorem obie warstwy jadą RÓWNOLEGLE i wynik jest scalony", async () => {
    clubRpc.setData("club_search", [
      { thread_id: "t1", club_slug: "k", thread_slug: "a", title: "A", rank: 0.9 },
    ]);
    clubRpc.setData("club_semantic_search", [
      { thread_id: "t2", club_slug: "k", thread_slug: "b", title: "B", similarity: 0.8 },
    ]);

    const hits = await searchClubThreads({ query: "energia", embedding: [0.1, 0.2] });

    expect(clubRpc.names()).toContain("club_search");
    expect(clubRpc.names()).toContain("club_semantic_search");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("AWARIA warstwy semantycznej nie zabiera wyników pełnotekstowych", async () => {
    clubRpc.setData("club_search", [
      { thread_id: "t1", club_slug: "k", thread_slug: "a", title: "A", rank: 0.9 },
    ]);
    clubRpc.setError("club_semantic_search", "vector index missing", "42704");

    // Semantyka jest DODATKIEM, nie warunkiem działania wyszukiwarki.
    const hits = await searchClubThreads({ query: "energia", embedding: [0.1] });

    expect(hits).toHaveLength(1);
  });

  it("ODRZUCONA obietnica semantyki (awaria transportu) też nie zabiera FTS", async () => {
    clubRpc.setData("club_search", [
      { thread_id: "t1", club_slug: "k", thread_slug: "a", title: "A", rank: 0.9 },
    ]);
    // To INNY tryb awarii niż zwrotka `{ error }`: supabase-js oddaje błąd
    // SQL-a w polu `error`, ale zerwane połączenie ODRZUCA obietnicę. Bez
    // `.catch()` przy równoległym `Promise.all` odrzucenie dodatku wywróciłoby
    // całe wyszukiwanie, mimo że warstwa pełnotekstowa odpowiedziała komplet.
    clubRpc.setResponse("club_semantic_search", () => {
      throw new Error("network down");
    });

    const hits = await searchClubThreads({ query: "energia", embedding: [0.1] });

    expect(hits).toHaveLength(1);
  });

  it("awaria warstwy PEŁNOTEKSTOWEJ jest już błędem wyszukiwarki", async () => {
    clubRpc.setError("club_search", "fts down");
    clubRpc.setData("club_semantic_search", []);

    await expect(searchClubThreads({ query: "energia", embedding: [0.1] })).rejects.toThrow(
      "fts down",
    );
  });

  it("limit dojeżdża do OBU warstw - inaczej scalanie dostaje różne zbiory", async () => {
    clubRpc.setData("club_search", []);
    clubRpc.setData("club_semantic_search", []);

    await searchClubThreads({ query: "energia", embedding: [0.1], limit: 7 });

    expect(clubRpc.lastCall("club_search")?.arg("p_limit")).toBe(7);
    expect(clubRpc.lastCall("club_semantic_search")?.arg("p_limit")).toBe(7);
  });

  it("fraza jest przycinana przed wysłaniem", async () => {
    clubRpc.setData("club_search", []);

    await searchClubThreads({ query: "  energia  " });

    expect(clubRpc.lastCall("club_search")?.arg("p_query")).toBe("energia");
  });
});

describe("fetchClubAnchorSuggestions", () => {
  it("fraza krótsza niż 2 znaki nie woła bazy", async () => {
    expect(await fetchClubAnchorSuggestions({ query: "a" })).toEqual([]);
    expect(clubRpc.calls).toHaveLength(0);
  });

  it("domyślny limit 8, fraza przycięta", async () => {
    clubRpc.setData("club_anchor_suggest", []);

    await fetchClubAnchorSuggestions({ query: "  dyrektywa " });

    const call = clubRpc.lastCall("club_anchor_suggest");
    expect(call?.arg("p_query")).toBe("dyrektywa");
    expect(call?.arg("p_limit")).toBe(8);
  });

  it("zawężenie po typie kotwicy jedzie pod p_anchor_type", async () => {
    clubRpc.setData("club_anchor_suggest", []);

    await fetchClubAnchorSuggestions({ query: "akt", anchorType: "eu_policy_item" });

    expect(clubRpc.lastCall("club_anchor_suggest")?.arg("p_anchor_type")).toBe("eu_policy_item");
  });
});

// ---------------------------------------------------------------------------
// Strumień, kotwice, blokady, zgłoszenia, ujawnienie autora
// ---------------------------------------------------------------------------

describe("strumień aktywności i kotwice", () => {
  it("strumień: domyślnie 12 wpisów po 3 na klub", async () => {
    clubRpc.setData("club_activity_feed", []);

    await fetchClubActivityFeed({ sort: "hot", policyArea: null });

    const call = clubRpc.lastCall("club_activity_feed");
    expect(call?.arg("p_limit")).toBe(12);
    expect(call?.arg("p_per_club")).toBe(3);
    expect(call?.arg("p_policy_area")).toBeUndefined();
  });

  it("strumień: obszar polityki zawęża wynik", async () => {
    clubRpc.setData("club_activity_feed", []);

    await fetchClubActivityFeed({ sort: "new", policyArea: "energy" });

    expect(clubRpc.lastCall("club_activity_feed")?.arg("p_policy_area")).toBe("energy");
  });

  it("wątki dla kotwicy: domyślny limit 5", async () => {
    clubRpc.setData("club_threads_for_anchor", []);

    await fetchClubThreadsForAnchor({ anchorType: "eu_policy_item", anchorId: "act-1" });

    expect(clubRpc.lastCall("club_threads_for_anchor")?.arg("p_limit")).toBe(5);
  });
});

describe("blokady, zgłoszenia i ujawnienie autora", () => {
  it("banClubMember przekazuje kierunek blokady JAWNIE", async () => {
    clubRpc.setData("club_ban_member", true);

    await banClubMember({ clubId: CLUB_IDS.club, userId: CLUB_IDS.member, banned: false });

    // `banned: false` to ZDJĘCIE blokady - gdyby zniknęło w `??`, zdjęcie
    // blokady zamieniłoby się w jej nałożenie.
    expect(clubRpc.lastCall("club_ban_member")?.arg("p_banned")).toBe(false);
  });

  it("reportClubContent wskazuje TREŚĆ, nie osobę", async () => {
    clubRpc.setData("club_report_content", "report-1");

    const id = await reportClubContent({
      targetType: "reply",
      targetId: CLUB_IDS.reply,
      reason: "harassment",
    });

    expect(id).toBe("report-1");
    // Pod regułą Chatham House klient nie zna autora i znać go nie może -
    // autora rozwiązuje RPC. Brak `p_user_id` jest tu kontraktem.
    expect(clubRpc.lastCall("club_report_content")?.keys()).toEqual([
      "p_target_type",
      "p_target_id",
      "p_reason",
      "p_details",
    ]);
  });

  it("reportClubContent przy nietekstowej zwrotce oddaje null", async () => {
    clubRpc.setData("club_report_content", 7);
    expect(
      await reportClubContent({ targetType: "thread", targetId: "t", reason: "spam" }),
    ).toBeNull();
  });

  it("revealClubAuthor oddaje tożsamość albo null", async () => {
    clubRpc.setData("club_moderator_reveal_author", [
      { author_id: CLUB_IDS.member, display_name: "Anna Nowak", profile_slug: "anna-nowak" },
    ]);

    expect(
      await revealClubAuthor({
        targetType: "thread",
        targetId: CLUB_IDS.thread,
        reason: "podejrzenie podszycia",
      }),
    ).toEqual({
      authorId: CLUB_IDS.member,
      displayName: "Anna Nowak",
      profileSlug: "anna-nowak",
    });

    clubRpc.setData("club_moderator_reveal_author", []);
    expect(
      await revealClubAuthor({ targetType: "thread", targetId: "t", reason: "powod" }),
    ).toBeNull();
  });

  it("revealClubAuthor ZAWSZE wysyła powód - to jedyna akcja łamiąca Chatham House", async () => {
    clubRpc.setData("club_moderator_reveal_author", []);

    await revealClubAuthor({ targetType: "reply", targetId: CLUB_IDS.reply, reason: "powod" });

    expect(clubRpc.lastCall("club_moderator_reveal_author")?.arg("p_reason")).toBe("powod");
  });

  it("markClubRead zwraca liczbę wpisów, które były nieprzeczytane", async () => {
    clubRpc.setData("club_mark_read", 5);
    expect(await markClubRead(CLUB_IDS.club)).toBe(5);

    clubRpc.setData("club_mark_read", null);
    expect(await markClubRead(CLUB_IDS.club)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Obrona przed pustą zwrotką
// ---------------------------------------------------------------------------

describe("null z bazy nie wycieka do widoku", () => {
  // PostgREST oddaje `data: null` przy zwrotce `RETURNS TABLE` bez wierszy
  // w części ścieżek (i zawsze przy `RETURNS void`). Każde `?? []` w tej
  // warstwie jest zaporą przed `.map of null` w komponencie - zaporą, którą
  // widać dopiero wtedy, gdy przestanie działać. Ten blok trzyma OBA ramiona
  // każdego takiego wyrażenia pod testem.
  const listCases: ReadonlyArray<readonly [string, string, () => Promise<unknown>]> = [
    ["fetchMyClubMemberships", "club_my_memberships", () => fetchMyClubMemberships()],
    ["fetchClubReplies", "club_replies_list", () => fetchClubReplies({ threadId: "t" })],
    ["fetchClubStanceSummary", "club_stance_summary", () => fetchClubStanceSummary("t")],
    [
      "fetchClubActivityFeed",
      "club_activity_feed",
      () => fetchClubActivityFeed({ sort: "hot", policyArea: null }),
    ],
    [
      "fetchClubThreadsForAnchor",
      "club_threads_for_anchor",
      () => fetchClubThreadsForAnchor({ anchorType: "a", anchorId: "i" }),
    ],
    [
      "fetchClubModerationLog",
      "admin_club_moderation_log",
      () => fetchClubModerationLog({ clubId: "c" }),
    ],
    [
      "fetchClubAnchorSuggestions",
      "club_anchor_suggest",
      () => fetchClubAnchorSuggestions({ query: "abc" }),
    ],
  ];

  it.each(listCases)("%s: null z %s czyta się jak pustą listę", async (_l, rpcName, run) => {
    clubRpc.setData(rpcName, null);
    const result = await run();
    // Strony z paginacją oddają obiekt `{ rows, total }`, listy - gołą tablicę.
    expect(Array.isArray(result) ? result : (result as { rows: unknown[] }).rows).toEqual([]);
  });

  const pageCases: ReadonlyArray<readonly [string, string, () => Promise<{ total: number }>]> = [
    ["fetchClubMembers", "club_members_list", () => fetchClubMembers({ clubId: "c" })],
    ["fetchAdminClubs", "admin_club_list", () => fetchAdminClubs({})],
    ["fetchAdminClubThreads", "admin_club_threads", () => fetchAdminClubThreads({ clubId: "c" })],
    ["fetchAdminClubReplies", "admin_club_replies", () => fetchAdminClubReplies({ threadId: "t" })],
    [
      "fetchClubModerationQueue",
      "admin_club_moderation_queue",
      () => fetchClubModerationQueue({ clubId: "c" }),
    ],
  ];

  it.each(pageCases)("%s: null z %s daje sumę zero", async (_l, rpcName, run) => {
    clubRpc.setData(rpcName, null);
    expect((await run()).total).toBe(0);
  });

  it("fetchClubThreads: null daje pustą stronę bez kursora", async () => {
    clubRpc.setData("club_threads_list", null);
    expect(await fetchClubThreads({ clubId: "c" })).toEqual({ rows: [], nextCursor: null });
  });

  it("reakcje: null daje pustą mapę, nie wyjątek w grupowaniu", async () => {
    clubRpc.setData("club_reactions_for", null);
    clubRpc.setData("club_reaction_actors", null);

    expect((await fetchClubReactions({ targetType: "thread", targetIds: ["a"] })).size).toBe(0);
    expect((await fetchClubReactionActors({ targetType: "thread", targetIds: ["a"] })).size).toBe(
      0,
    );
  });

  it("replyToClubThread: null (nie tylko []) też kończy się wyjątkiem", async () => {
    clubRpc.setData("club_reply", null);
    await expect(replyToClubThread({ threadId: "t", body: "B" })).rejects.toThrow(
      "club_reply: brak wiersza wyniku",
    );
  });

  it("wyszukiwarka: null w OBU warstwach daje pustą listę trafień", async () => {
    clubRpc.setData("club_search", null);
    clubRpc.setResponse("club_semantic_search", () => ({ data: null, error: null }));

    expect(await searchClubThreads({ query: "energia", embedding: [0.1] })).toEqual([]);
  });

  it("liczniki operacji wsadowych: nieliczbowa zwrotka schodzi na zero", async () => {
    clubRpc.setData("admin_club_group_delete", "12");
    clubRpc.setData("admin_club_bulk_member_role", null);

    expect(await deleteClubGroup({ groupId: "g" })).toBe(0);
    expect(await bulkSetClubMemberRole({ clubId: "c", userIds: [], role: "member" })).toBe(0);
  });

  it("editClubThread bez tytułu wysyła pusty string w OBU polach", async () => {
    clubRpc.setData("club_edit_thread", true);

    await editClubThread({ threadId: "t" });

    const call = clubRpc.lastCall("club_edit_thread");
    expect(call?.arg("p_title")).toBe("");
    expect(call?.arg("p_body")).toBe("");
  });

  it("fetchAdminClubThreads: NIEpuste wyszukiwanie jedzie jako filtr", async () => {
    clubRpc.setData("admin_club_threads", []);

    await fetchAdminClubThreads({ clubId: "c", search: "dyrektywa" });

    expect(clubRpc.lastCall("admin_club_threads")?.arg("p_search")).toBe("dyrektywa");
  });
});

// ---------------------------------------------------------------------------
// Kontrakt całego modułu
// ---------------------------------------------------------------------------

describe("spójność kontraktu błędu w całym module", () => {
  // Rozjazd kontraktu błędu jest w warstwie danych typowym miejscem awarii:
  // część funkcji rzuca, część oddaje pustą listę, a widok obsługuje jedno
  // z dwóch. Ten test przypina, że KAŻDA funkcja tej warstwy rzuca - żadna
  // nie połyka odmowy bazy i nie udaje pustego wyniku.
  const cases: ReadonlyArray<readonly [string, string, () => Promise<unknown>]> = [
    ["fetchClubList", "club_list", () => fetchClubList()],
    ["fetchClubGroups", "club_groups_list", () => fetchClubGroups(CLUB_IDS.club)],
    ["fetchMyClubMemberships", "club_my_memberships", () => fetchMyClubMemberships()],
    ["fetchClubMembers", "club_members_list", () => fetchClubMembers({ clubId: CLUB_IDS.club })],
    ["fetchAdminClubs", "admin_club_list", () => fetchAdminClubs({})],
    ["upsertClub", "admin_club_upsert", () => upsertClub({ name_pl: "X" })],
    [
      "checkClubSlugAvailable",
      "admin_club_slug_available",
      () => checkClubSlugAvailable({ slug: "x" }),
    ],
    [
      "upsertClubGroup",
      "admin_club_group_upsert",
      () => upsertClubGroup({ club_id: "c", name_pl: "X" }),
    ],
    ["reorderClubGroups", "admin_club_group_reorder", () => reorderClubGroups("c", [])],
    [
      "setClubMemberRole",
      "club_set_role",
      () => setClubMemberRole({ clubId: "c", userId: "u", role: "member" }),
    ],
    [
      "previewClubSegment",
      "admin_club_segment_preview",
      () => previewClubSegment({ clubId: "c", rule: { kind: "badge" } }),
    ],
    [
      "inviteClubSegment",
      "admin_club_invite_segment",
      () => inviteClubSegment({ clubId: "c", rule: { kind: "badge" }, role: "member" }),
    ],
    [
      "upsertClubMember",
      "admin_club_member_upsert",
      () => upsertClubMember({ clubId: "c", userId: "u" }),
    ],
    ["deleteClubGroup", "admin_club_group_delete", () => deleteClubGroup({ groupId: "g" })],
    ["removeClubMember", "admin_club_member_remove", () => removeClubMember("c", "u")],
    ["fetchAdminClub", "admin_club_get", () => fetchAdminClub("c")],
    ["fetchAdminClubGroups", "admin_club_groups", () => fetchAdminClubGroups("c")],
    ["fetchAdminClubStats", "admin_club_stats", () => fetchAdminClubStats("c")],
    [
      "previewClubCapabilities",
      "admin_club_capabilities_preview",
      () => previewClubCapabilities({ clubId: "c", userId: "u" }),
    ],
    ["inviteClubMember", "club_invite", () => inviteClubMember({ clubId: "c", userId: "u" })],
    [
      "inviteClubMemberByEmail",
      "club_invite_by_email",
      () => inviteClubMemberByEmail({ clubId: "c", email: "a@b.pl" }),
    ],
    [
      "createClubInviteLink",
      "admin_club_invite_link_create",
      () => createClubInviteLink({ clubId: "c" }),
    ],
    ["revokeClubInviteLink", "admin_club_invite_link_revoke", () => revokeClubInviteLink("l")],
    ["fetchClubInviteLinks", "admin_club_invite_links", () => fetchClubInviteLinks("c")],
    ["fetchClubInvitations", "admin_club_invitations", () => fetchClubInvitations("c")],
    ["fetchMyClubInvitations", "club_my_invitations", () => fetchMyClubInvitations()],
    ["joinClub", "club_join", () => joinClub("c")],
    ["leaveClub", "club_leave", () => leaveClub("c")],
    [
      "respondClubInvitation",
      "club_respond_invitation",
      () => respondClubInvitation({ invitationId: "i", accept: true }),
    ],
    ["redeemClubInviteLink", "club_redeem_invite_link", () => redeemClubInviteLink("t")],
    [
      "setClubNotifyLevel",
      "club_set_notify_level",
      () => setClubNotifyLevel({ clubId: "c", level: "all" }),
    ],
    ["acceptClubRules", "club_accept_rules", () => acceptClubRules("c")],
    ["fetchClubThreads", "club_threads_list", () => fetchClubThreads({ clubId: "c" })],
    ["fetchClubThread", "club_thread_view", () => fetchClubThread({ clubId: "c", slug: "s" })],
    ["fetchClubReplies", "club_replies_list", () => fetchClubReplies({ threadId: "t" })],
    [
      "createClubThread",
      "club_create_thread",
      () => createClubThread({ groupId: "g", title: "T", body: "B" }),
    ],
    ["replyToClubThread", "club_reply", () => replyToClubThread({ threadId: "t", body: "B" })],
    ["editClubThread", "club_edit_thread", () => editClubThread({ threadId: "t", title: "T" })],
    ["editClubReply", "club_edit_reply", () => editClubReply({ replyId: "r", body: "B" })],
    [
      "resolveClubThread",
      "club_resolve_thread",
      () => resolveClubThread({ threadId: "t", replyId: null }),
    ],
    [
      "fetchClubReactions",
      "club_reactions_for",
      () => fetchClubReactions({ targetType: "thread", targetIds: ["a"] }),
    ],
    [
      "fetchClubReactionActors",
      "club_reaction_actors",
      () => fetchClubReactionActors({ targetType: "thread", targetIds: ["a"] }),
    ],
    [
      "reactToClubTarget",
      "club_react",
      () => reactToClubTarget({ targetType: "thread", targetId: "t", kind: "insightful" }),
    ],
    [
      "unreactFromClubTarget",
      "club_unreact",
      () => unreactFromClubTarget({ targetType: "thread", targetId: "t", kind: "insightful" }),
    ],
    ["fetchClubStanceSummary", "club_stance_summary", () => fetchClubStanceSummary("t")],
    ["setClubStance", "club_set_stance", () => setClubStance({ threadId: "t", stance: "support" })],
    [
      "setClubThreadSubscription",
      "club_subscribe_thread",
      () => setClubThreadSubscription({ threadId: "t", state: "muted" }),
    ],
    ["fetchMyThreadSubscription", "club_my_subscription", () => fetchMyThreadSubscription("t")],
    ["fetchAdminClubThreads", "admin_club_threads", () => fetchAdminClubThreads({ clubId: "c" })],
    ["fetchAdminClubReplies", "admin_club_replies", () => fetchAdminClubReplies({ threadId: "t" })],
    [
      "adminCreateClubThread",
      "admin_club_thread_create",
      () => adminCreateClubThread({ groupId: "g", title: "T", body: "B" }),
    ],
    [
      "adminCreateClubReply",
      "admin_club_reply_create",
      () => adminCreateClubReply({ threadId: "t", body: "B" }),
    ],
    [
      "bulkModerateClubTargets",
      "admin_club_bulk_moderate",
      () => bulkModerateClubTargets({ targetType: "thread", targetIds: ["t"], action: "approve" }),
    ],
    [
      "bulkSetClubMemberRole",
      "admin_club_bulk_member_role",
      () => bulkSetClubMemberRole({ clubId: "c", userIds: ["u"], role: "member" }),
    ],
    [
      "moveClubThread",
      "admin_club_thread_move",
      () => moveClubThread({ threadId: "t", groupId: "g" }),
    ],
    [
      "moderateClubTarget",
      "club_moderate",
      () => moderateClubTarget({ targetType: "thread", targetId: "t", action: "hide" }),
    ],
    ["searchClubThreads", "club_search", () => searchClubThreads({ query: "energia" })],
    [
      "fetchClubActivityFeed",
      "club_activity_feed",
      () => fetchClubActivityFeed({ sort: "hot", policyArea: null }),
    ],
    [
      "fetchClubThreadsForAnchor",
      "club_threads_for_anchor",
      () => fetchClubThreadsForAnchor({ anchorType: "a", anchorId: "i" }),
    ],
    ["fetchClubPendingCounts", "admin_club_pending_counts", () => fetchClubPendingCounts()],
    [
      "fetchClubModerationQueue",
      "admin_club_moderation_queue",
      () => fetchClubModerationQueue({ clubId: "c" }),
    ],
    [
      "fetchClubModerationLog",
      "admin_club_moderation_log",
      () => fetchClubModerationLog({ clubId: "c" }),
    ],
    [
      "banClubMember",
      "club_ban_member",
      () => banClubMember({ clubId: "c", userId: "u", banned: true }),
    ],
    [
      "reportClubContent",
      "club_report_content",
      () => reportClubContent({ targetType: "thread", targetId: "t", reason: "spam" }),
    ],
    [
      "fetchClubAnchorSuggestions",
      "club_anchor_suggest",
      () => fetchClubAnchorSuggestions({ query: "abc" }),
    ],
    ["markClubRead", "club_mark_read", () => markClubRead("c")],
    [
      "revealClubAuthor",
      "club_moderator_reveal_author",
      () => revealClubAuthor({ targetType: "thread", targetId: "t", reason: "r" }),
    ],
  ];

  it.each(cases)("%s rzuca, gdy %s odmawia", async (_label, rpcName, run) => {
    clubRpc.setError(rpcName, "odmowa bazy", "42501");
    await expect(run()).rejects.toThrow("odmowa bazy");
  });

  it("lista przypadków pokrywa KAŻDĄ funkcję eksportowaną z api.ts", async () => {
    const api = await import("@/lib/clubs/api");
    const exported = Object.entries(api)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort();
    const covered = new Set(cases.map(([label]) => label));
    // `fetchClubBySlug` jest re-eksportem z ./publicClub i ma własny test.
    const expected = exported.filter((name) => name !== "fetchClubBySlug");

    expect(expected.filter((name) => !covered.has(name))).toEqual([]);
  });
});
