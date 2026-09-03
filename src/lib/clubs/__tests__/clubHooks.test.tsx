// Hooki danych klubów - 70 hooków w sześciu modułach domenowych, do dziś
// 0/155 funkcji pokrycia (`useClubs.ts` był największym plikiem modułu).
//
// CO TU JEST WARTE TESTU, A CO NIE. Ciało hooka to zwykle trzy linie:
// klucz cache'u, wywołanie warstwy danych i `staleTime`. Testowanie, że
// `useQuery` działa, byłoby testowaniem react-query. Warte testu są cztery
// rzeczy, których react-query za nas nie sprawdzi:
//
//   1. KLUCZ CACHE'U. Zapytanie o klub A nie może trafić w wpis klubu B,
//      a zmiana rozmiaru strony ma dawać osobny wpis (bez tego „pokaż więcej"
//      trafiało w ten sam wpis i katalog zostawał na setce).
//   2. BRAMKA `enabled`. Hook wywołany bez identyfikatora NIE MOŻE odpytać
//      bazy - inaczej każdy render przed dojechaniem trasy to round-trip
//      po odpowiedź „nie ma takiego klubu".
//   3. ARGUMENTY DOJEŻDŻAJĄCE DO WARSTWY DANYCH - hook jest jedynym miejscem,
//      w którym parametry widoku zamieniają się w argumenty RPC.
//   4. SKUTEK MUTACJI: co zostaje unieważnione. Reguła mieszka
//      w `clubInvalidations.ts` i ma własne testy jednostkowe; tutaj
//      sprawdzamy, że hook sięga po WŁAŚCIWY skutek.
//
// Warstwa danych jest tu zamockowana w całości: jej kontrakt wobec bazy ma
// własne 300 testów (`api.test.ts` i pliki siostrzane), a powtarzanie ich
// przez hooki dałoby drugi zestaw asercji o tej samej rzeczy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/clubs/api", () => clubApiMock);
// Karta klubu zalezy od tozsamosci widza (patrz `clubKeys.bySlugViewer`),
// wiec hooki potrzebuja rozstrzygnietej sesji - inaczej zapytanie czeka.
const authState = { user: { id: "user-1" } as { id: string } | null, loading: false };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));
vi.mock("@/lib/clubs/clubSemantic.functions", () => ({
  CLUB_SEMANTIC_MIN_CHARS: 4,
  embedClubQuery: (...args: unknown[]) => clubApiMock.embedClubQuery(...args),
}));

import { clubApiMock, resetClubApiMock } from "@/test/clubs/apiMock";
import { clubKeys } from "@/lib/clubs/queryKeys";
import {
  clubCardKeys,
  clubMembershipKeys,
  clubOnlyKeys,
  clubReadKeys,
  clubSettingsKeys,
  clubTreeKeys,
  clubUpsertedKeys,
  replyEditedKeys,
  threadEditedKeys,
  threadReplyKeys,
  threadResolvedKeys,
  threadStanceKeys,
} from "@/lib/clubs/clubInvalidations";
import {
  useClubActivityFeed,
  useClubBySlug,
  useClubGroups,
  useClubList,
  useClubMembers,
  useMyClubMemberships,
} from "@/lib/clubs/useClubCatalog";
import {
  useAdminClub,
  useAdminClubGroups,
  useAdminClubStats,
  useAdminClubs,
  useClubCapabilitiesPreview,
  useClubSlugAvailable,
  useDeleteClubGroup,
  useRemoveClubMember,
  useReorderClubGroups,
  useSetClubMemberRole,
  useUpsertClub,
  useUpsertClubGroup,
  useUpsertClubMember,
} from "@/lib/clubs/useClubAdmin";
import {
  useAcceptClubRules,
  useClubInviteLinks,
  useClubInvitations,
  useCreateClubInviteLink,
  useInviteClubMember,
  useInviteClubMemberByEmail,
  useJoinClub,
  useLeaveClub,
  useMyClubInvitations,
  useRedeemClubInviteLink,
  useRespondClubInvitation,
  useRevokeClubInviteLink,
  useSetClubNotifyLevel,
} from "@/lib/clubs/useClubInvites";
import {
  useClubReplies,
  useClubThread,
  useClubThreads,
  useCreateClubThread,
  useEditClubReply,
  useEditClubThread,
  useReplyToThread,
  useResolveClubThread,
} from "@/lib/clubs/useClubThreadsData";
import {
  useClubReactionActors,
  useClubReactions,
  useClubStanceSummary,
  useMyThreadSubscription,
  useSetClubStance,
  useSetThreadSubscription,
  useToggleClubReaction,
} from "@/lib/clubs/useClubReactions";
import type { ClubReactionTally } from "@/lib/clubs/types";
import {
  useAdminClubReplies,
  useAdminClubThreads,
  useBanClubMember,
  useClubAnchorSuggestions,
  useClubModerationLog,
  useClubModerationQueue,
  useClubPendingCounts,
  useClubSearch,
  useMarkClubRead,
  useModerateClubTarget,
} from "@/lib/clubs/useClubModeration";

const CLUB = "club-1";
const THREAD = "thread-1";
const SLUG = "temat-pierwszy";

/**
 * Klient zapytań per test: bez ponowień (test nie ma czekać na backoff)
 * i ze szpiegiem na `invalidateQueries`, bo to JEDYNY obserwowalny skutek
 * większości mutacji tego modułu.
 */
function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated: unknown[] = [];
  const original = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = (filters?: { queryKey?: unknown }) => {
    invalidated.push(filters?.queryKey);
    return original(filters as Parameters<typeof original>[0]);
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidated };
}

/** Czy szpieg zobaczył DOKŁADNIE ten zestaw kluczy (w dowolnej kolejności). */
function sawKeys(invalidated: unknown[], expected: readonly unknown[]): boolean {
  const seen = invalidated.map((k) => JSON.stringify(k)).sort();
  const want = expected.map((k) => JSON.stringify(k)).sort();
  return JSON.stringify(seen) === JSON.stringify(want);
}

beforeEach(() => resetClubApiMock());

// ---------------------------------------------------------------------------
// Odczyt produktowy
// ---------------------------------------------------------------------------

describe("useClubList", () => {
  it("LIMIT jest częścią klucza - inaczej 'pokaż więcej' trafia w stary wpis", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubList.mockResolvedValue({ rows: [], total: 0 });

    const a = renderHook(() => useClubList(true, 100), { wrapper });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    const b = renderHook(() => useClubList(true, 200), { wrapper });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

    // Dwa różne rozmiary strony = dwa wywołania. Gdyby limit nie był w kluczu,
    // drugi hook czytałby z cache'u i katalog zostawałby na setce.
    expect(clubApiMock.fetchClubList).toHaveBeenCalledTimes(2);
    expect(clubApiMock.fetchClubList).toHaveBeenLastCalledWith({ limit: 200 });
  });

  it("enabled=false nie odpytuje bazy", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubList(false), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchClubList).not.toHaveBeenCalled();
  });
});

describe("useClubBySlug / useClubGroups", () => {
  it("bez sluga NIE odpytuje - render przed dojechaniem trasy nie kosztuje rundy", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubBySlug(undefined), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchClubBySlug).not.toHaveBeenCalled();
  });

  it("ze slugiem czyta kartę klubu", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubBySlug.mockResolvedValue(null);

    const { result } = renderHook(() => useClubBySlug("klub-x"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubBySlug).toHaveBeenCalledWith("klub-x");
  });

  it("działy: bez id klubu nie odpytuje, z id odpytuje raz", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubGroups.mockResolvedValue([]);

    renderHook(() => useClubGroups(undefined), { wrapper });
    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchClubGroups).not.toHaveBeenCalled();

    const { result } = renderHook(() => useClubGroups(CLUB), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubGroups).toHaveBeenCalledWith(CLUB);
  });
});

describe("useClubMembers", () => {
  it("przekazuje status, stronę i offset do warstwy danych", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubMembers.mockResolvedValue({ rows: [], total: 0 });

    const { result } = renderHook(
      () => useClubMembers({ clubId: CLUB, status: null, limit: 25, offset: 50 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Jawny `null` (droplista „Wszystkie") musi przejść przez hook nietknięty -
    // to ta sama regresja, którą pilnuje `api.test.ts` na poziomie RPC.
    expect(clubApiMock.fetchClubMembers).toHaveBeenCalledWith({
      clubId: CLUB,
      status: null,
      limit: 25,
      offset: 50,
    });
  });

  it("bez id klubu nie odpytuje", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubMembers({ clubId: undefined }), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchClubMembers).not.toHaveBeenCalled();
  });
});

describe("useClubActivityFeed / useMyClubMemberships", () => {
  it("strumień niesie sort i obszar do klucza ORAZ do zapytania", async () => {
    const { wrapper, queryClient } = harness();
    clubApiMock.fetchClubActivityFeed.mockResolvedValue([]);

    const { result } = renderHook(
      () => useClubActivityFeed({ sort: "new", policyArea: "energy", limit: 6 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubActivityFeed).toHaveBeenCalledWith({
      sort: "new",
      policyArea: "energy",
      limit: 6,
    });
    expect(queryClient.getQueryData(clubKeys.activity("new", "energy"))).toEqual([]);
  });

  it("członkostwa: enabled=false wycisza zapytanie (gość na stronie publicznej)", async () => {
    const { wrapper } = harness();

    renderHook(() => useMyClubMemberships(false), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchMyClubMemberships).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Panel administracyjny
// ---------------------------------------------------------------------------

describe("hooki panelu - bramki enabled", () => {
  it("wszystkie trzy odczyty panelu milczą bez id klubu", async () => {
    const { wrapper } = harness();

    renderHook(() => useAdminClub(undefined), { wrapper });
    renderHook(() => useAdminClubGroups(undefined), { wrapper });
    renderHook(() => useAdminClubStats(undefined), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchAdminClub).not.toHaveBeenCalled();
    expect(clubApiMock.fetchAdminClubGroups).not.toHaveBeenCalled();
    expect(clubApiMock.fetchAdminClubStats).not.toHaveBeenCalled();
  });

  it("lista panelu przekazuje filtry", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchAdminClubs.mockResolvedValue({ rows: [], total: 0 });

    const filters = { search: "energia", status: "draft" as const };
    const { result } = renderHook(() => useAdminClubs(filters), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchAdminClubs).toHaveBeenCalledWith(filters);
  });

  it("podgląd zdolności milczy bez wskazanej osoby", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubCapabilitiesPreview({ clubId: CLUB, userId: undefined }), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.previewClubCapabilities).not.toHaveBeenCalled();
  });
});

describe("useClubSlugAvailable", () => {
  it("krótki i pusty adres NIE idzie do bazy - każdy klawisz byłby round-tripem", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubSlugAvailable("", null), { wrapper });
    renderHook(() => useClubSlugAvailable("ab", null), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.checkClubSlugAvailable).not.toHaveBeenCalled();
  });

  it("adres o sensownej długości sprawdza dostępność z id klubu", async () => {
    const { wrapper } = harness();
    clubApiMock.checkClubSlugAvailable.mockResolvedValue(true);

    const { result } = renderHook(() => useClubSlugAvailable("klub-energetyczny", CLUB), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clubApiMock.checkClubSlugAvailable).toHaveBeenCalledWith({
      slug: "klub-energetyczny",
      clubId: CLUB,
    });
  });
});

describe("mutacje panelu - co unieważniają", () => {
  it("zapis klubu sięga po skutek `clubUpserted`", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.upsertClub.mockResolvedValue(CLUB);

    const { result } = renderHook(() => useUpsertClub(), { wrapper });
    await result.current.mutateAsync({ name_pl: "Nowa nazwa" });

    await waitFor(() => expect(sawKeys(invalidated, clubUpsertedKeys(CLUB))).toBe(true));
  });

  it("zapis działu sięga po skutek `clubSettings`", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.upsertClubGroup.mockResolvedValue("group-1");

    const { result } = renderHook(() => useUpsertClubGroup(CLUB), { wrapper });
    await result.current.mutateAsync({ name_pl: "Dział" });

    await waitFor(() => expect(sawKeys(invalidated, clubSettingsKeys(CLUB))).toBe(true));
  });

  it("zapis działu DOPEŁNIA brakujące id klubu z argumentu hooka", async () => {
    const { wrapper } = harness();
    clubApiMock.upsertClubGroup.mockResolvedValue("group-1");

    const { result } = renderHook(() => useUpsertClubGroup(CLUB), { wrapper });
    await result.current.mutateAsync({ name_pl: "Dział" });

    // Formularz działu nie zna id klubu - niesie je trasa. Bez tego dopełnienia
    // RPC dostawałby patch bez `club_id` i zakładał dział „donikąd".
    expect(clubApiMock.upsertClubGroup).toHaveBeenCalledWith({
      name_pl: "Dział",
      club_id: CLUB,
    });
  });

  it("zapis działu NIE nadpisuje jawnie podanego id klubu", async () => {
    const { wrapper } = harness();
    clubApiMock.upsertClubGroup.mockResolvedValue("group-1");

    const { result } = renderHook(() => useUpsertClubGroup(CLUB), { wrapper });
    await result.current.mutateAsync({ name_pl: "Dział", club_id: "club-2" });

    expect(clubApiMock.upsertClubGroup).toHaveBeenCalledWith({
      name_pl: "Dział",
      club_id: "club-2",
    });
  });

  it("kolejność działów unieważnia SAME działy", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.reorderClubGroups.mockResolvedValue(3);

    const { result } = renderHook(() => useReorderClubGroups(CLUB), { wrapper });
    await result.current.mutateAsync(["g1", "g2"]);

    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.groups(CLUB)));
    expect(clubApiMock.reorderClubGroups).toHaveBeenCalledWith(CLUB, ["g1", "g2"]);
  });

  it("kasowanie działu unieważnia ustawienia klubu (wątki zmieniają dział)", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.deleteClubGroup.mockResolvedValue(12);

    const { result } = renderHook(() => useDeleteClubGroup(CLUB), { wrapper });
    await result.current.mutateAsync({ groupId: "group-1" });

    await waitFor(() => expect(sawKeys(invalidated, clubSettingsKeys(CLUB))).toBe(true));
  });

  it("zmiana roli i usunięcie członka przekazują komplet argumentów", async () => {
    const { wrapper } = harness();
    clubApiMock.setClubMemberRole.mockResolvedValue(true);
    clubApiMock.removeClubMember.mockResolvedValue(true);
    clubApiMock.upsertClubMember.mockResolvedValue("m1");

    const role = renderHook(() => useSetClubMemberRole(CLUB), { wrapper });
    await role.result.current.mutateAsync({ userId: "u1", role: "moderator" });
    expect(clubApiMock.setClubMemberRole).toHaveBeenCalledWith({
      clubId: CLUB,
      userId: "u1",
      role: "moderator",
    });

    const remove = renderHook(() => useRemoveClubMember(CLUB), { wrapper });
    await remove.result.current.mutateAsync("u1");
    expect(clubApiMock.removeClubMember).toHaveBeenCalledWith(CLUB, "u1");

    const upsert = renderHook(() => useUpsertClubMember(CLUB), { wrapper });
    await upsert.result.current.mutateAsync({ userId: "u2", role: "member" });
    expect(clubApiMock.upsertClubMember).toHaveBeenCalledWith({
      clubId: CLUB,
      userId: "u2",
      role: "member",
    });
  });
});

// ---------------------------------------------------------------------------
// Zaproszenia i członkostwo
// ---------------------------------------------------------------------------

describe("zaproszenia", () => {
  it("listy zaproszeń i linków milczą bez id klubu", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubInvitations(undefined), { wrapper });
    renderHook(() => useClubInviteLinks(undefined), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchClubInvitations).not.toHaveBeenCalled();
    expect(clubApiMock.fetchClubInviteLinks).not.toHaveBeenCalled();
  });

  it("moje zaproszenia: enabled=false wycisza", async () => {
    const { wrapper } = harness();

    renderHook(() => useMyClubInvitations(false), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchMyClubInvitations).not.toHaveBeenCalled();
  });

  it("zaproszenie osoby dopełnia id klubu i unieważnia poddrzewo klubu", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.inviteClubMember.mockResolvedValue("inv-1");

    const { result } = renderHook(() => useInviteClubMember(CLUB), { wrapper });
    await result.current.mutateAsync({ userId: "u1", role: "member" });

    expect(clubApiMock.inviteClubMember).toHaveBeenCalledWith({
      userId: "u1",
      role: "member",
      clubId: CLUB,
    });
    await waitFor(() => expect(sawKeys(invalidated, clubOnlyKeys(CLUB))).toBe(true));
  });

  it("zaproszenie e-mailem unieważnia LISTĘ ZAPROSZEŃ, nie cały klub", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.inviteClubMemberByEmail.mockResolvedValue("inv-2");

    const { result } = renderHook(() => useInviteClubMemberByEmail(CLUB), { wrapper });
    await result.current.mutateAsync({ email: "a@b.pl" });

    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.invitations(CLUB)));
  });

  it("utworzenie i wycofanie linku unieważniają katalog linków", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.createClubInviteLink.mockResolvedValue({ id: "l1", token: "t" });
    clubApiMock.revokeClubInviteLink.mockResolvedValue(true);

    const create = renderHook(() => useCreateClubInviteLink(CLUB), { wrapper });
    await create.result.current.mutateAsync({ role: "member" });
    expect(clubApiMock.createClubInviteLink).toHaveBeenCalledWith({ role: "member", clubId: CLUB });

    const revoke = renderHook(() => useRevokeClubInviteLink(CLUB), { wrapper });
    await revoke.result.current.mutateAsync("l1");

    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.inviteLinks(CLUB)));
  });
});

describe("samoobsługa członkostwa", () => {
  it("dołączenie unieważnia kartę klubu I listę członkostw", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.joinClub.mockResolvedValue("active");

    const { result } = renderHook(() => useJoinClub(), { wrapper });
    await result.current.mutateAsync(CLUB);

    await waitFor(() => expect(sawKeys(invalidated, clubMembershipKeys(CLUB))).toBe(true));
  });

  it("wyjście z klubu ma ten sam skutek co dołączenie", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.leaveClub.mockResolvedValue(true);

    const { result } = renderHook(() => useLeaveClub(), { wrapper });
    await result.current.mutateAsync(CLUB);

    await waitFor(() => expect(sawKeys(invalidated, clubMembershipKeys(CLUB))).toBe(true));
  });

  it("odpowiedź na zaproszenie i realizacja linku idą od KORZENIA", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.respondClubInvitation.mockResolvedValue("active");

    const { result } = renderHook(() => useRespondClubInvitation(), { wrapper });
    await result.current.mutateAsync({ invitationId: "i1", accept: true });

    await waitFor(() => expect(sawKeys(invalidated, clubTreeKeys())).toBe(true));
  });

  it("realizacja linku również unieważnia korzeń", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.redeemClubInviteLink.mockResolvedValue({ clubSlug: "k", status: "active" });

    const { result } = renderHook(() => useRedeemClubInviteLink(), { wrapper });
    await result.current.mutateAsync("tok");

    await waitFor(() => expect(sawKeys(invalidated, clubTreeKeys())).toBe(true));
  });

  it("poziom powiadomień rusza SAME członkostwa", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.setClubNotifyLevel.mockResolvedValue(true);

    const { result } = renderHook(() => useSetClubNotifyLevel(CLUB), { wrapper });
    await result.current.mutateAsync("all");

    expect(clubApiMock.setClubNotifyLevel).toHaveBeenCalledWith({ clubId: CLUB, level: "all" });
    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.memberships()));
  });

  it("akceptacja zasad odświeża kartę klubu", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.acceptClubRules.mockResolvedValue(true);

    const { result } = renderHook(() => useAcceptClubRules(CLUB), { wrapper });
    await result.current.mutateAsync();

    await waitFor(() => expect(sawKeys(invalidated, clubCardKeys(CLUB))).toBe(true));
  });
});

// ---------------------------------------------------------------------------
// Wątki
// ---------------------------------------------------------------------------

describe("useClubThreads - paginacja kursorowa", () => {
  it("pierwsza strona startuje BEZ kursora", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubThreads.mockResolvedValue({ rows: [], nextCursor: null });

    const { result } = renderHook(() => useClubThreads({ clubId: CLUB }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubThreads).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: CLUB, cursor: null, sort: "hot" }),
    );
  });

  it("kolejna strona niesie kursor POPRZEDNIEJ - to definicja paginacji kursorowej", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubThreads
      .mockResolvedValueOnce({ rows: [], nextCursor: "c-1" })
      .mockResolvedValueOnce({ rows: [], nextCursor: null });

    const { result } = renderHook(() => useClubThreads({ clubId: CLUB }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();

    await waitFor(() =>
      expect(clubApiMock.fetchClubThreads).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: "c-1" }),
      ),
    );
  });

  it("brak kursora KOŃCZY paginację (bez tego lista doczytywałaby w nieskończoność)", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubThreads.mockResolvedValue({ rows: [], nextCursor: null });

    const { result } = renderHook(() => useClubThreads({ clubId: CLUB }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("bez id klubu nie odpytuje", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubThreads({ clubId: undefined }), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchClubThreads).not.toHaveBeenCalled();
  });

  it("filtry trafiają i do klucza, i do zapytania", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubThreads.mockResolvedValue({ rows: [], nextCursor: null });

    const { result } = renderHook(
      () => useClubThreads({ clubId: CLUB, sort: "new", topic: "energy", unreadOnly: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubThreads).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "new", topic: "energy", unreadOnly: true }),
    );
  });
});

describe("useClubThread / useClubReplies", () => {
  it("karta wątku wymaga OBU identyfikatorów", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubThread({ clubId: CLUB, slug: undefined }), { wrapper });
    renderHook(() => useClubThread({ clubId: undefined, slug: SLUG }), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchClubThread).not.toHaveBeenCalled();
  });

  it("odpowiedzi: rozmiar strony dojeżdża jako limit", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubReplies.mockResolvedValue({ rows: [], total: 0 });

    const { result } = renderHook(() => useClubReplies({ threadId: THREAD, pageSize: 50 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubReplies).toHaveBeenCalledWith({
      threadId: THREAD,
      sort: "chronological",
      limit: 50,
    });
  });
});

describe("mutacje wątku", () => {
  it("nowy wątek odświeża kartę klubu", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.createClubThread.mockResolvedValue({ id: "t", slug: "s", status: "published" });

    const { result } = renderHook(() => useCreateClubThread(CLUB), { wrapper });
    await result.current.mutateAsync({ groupId: "g1", title: "T", body: "B" });

    await waitFor(() => expect(sawKeys(invalidated, clubCardKeys(CLUB))).toBe(true));
  });

  it("odpowiedź unieważnia listę odpowiedzi TEGO wątku i poddrzewo klubu", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.replyToClubThread.mockResolvedValue({ id: "r1", queued: false });

    const { result } = renderHook(() => useReplyToThread(CLUB, SLUG), { wrapper });
    await result.current.mutateAsync({ threadId: THREAD, body: "B" });

    await waitFor(() =>
      expect(sawKeys(invalidated, threadReplyKeys(CLUB, SLUG, THREAD))).toBe(true),
    );
  });

  it("redakcja odpowiedzi rusza tylko prefiks odpowiedzi", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.editClubReply.mockResolvedValue(true);

    const { result } = renderHook(() => useEditClubReply(THREAD), { wrapper });
    await result.current.mutateAsync({ replyId: "r1", body: "B" });

    await waitFor(() => expect(sawKeys(invalidated, replyEditedKeys(THREAD))).toBe(true));
  });
});

// ---------------------------------------------------------------------------
// Reakcje, stanowiska, subskrypcje
// ---------------------------------------------------------------------------

describe("reakcje", () => {
  it("pusta partia celów nie odpytuje bazy", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubReactions({ targetType: "thread", targetIds: [] }), { wrapper });
    renderHook(() => useClubReactionActors({ targetType: "thread", targetIds: [] }), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchClubReactions).not.toHaveBeenCalled();
    expect(clubApiMock.fetchClubReactionActors).not.toHaveBeenCalled();
  });

  it("OPTYMISTYCZNIE dokłada reakcję do cache'u przed odpowiedzią bazy", async () => {
    const { wrapper, queryClient } = harness();
    const key = clubKeys.reactions("thread", [THREAD]);
    queryClient.setQueryData(key, new Map([[THREAD, []]]));
    let release: (v: boolean) => void = () => {};
    clubApiMock.reactToClubTarget.mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );

    const { result } = renderHook(
      () => useToggleClubReaction({ targetType: "thread", targetIds: [THREAD] }),
      { wrapper },
    );
    const pending = result.current.mutateAsync({
      targetId: THREAD,
      kind: "insightful",
      active: false,
    });

    // Pasek reakcji ma odpowiedzieć NATYCHMIAST - to jedyna mutacja modułu
    // z optymistycznym zapisem.
    await waitFor(() => {
      const cached = queryClient.getQueryData<Map<string, unknown[]>>(key);
      expect(cached?.get(THREAD)).toHaveLength(1);
    });

    release(true);
    await pending;
  });

  it("przy ODMOWIE bazy cofa optymistyczną zmianę do stanu sprzed kliku", async () => {
    const { wrapper, queryClient } = harness();
    const key = clubKeys.reactions("thread", [THREAD]);
    const before = new Map([[THREAD, []]]);
    queryClient.setQueryData(key, before);
    clubApiMock.reactToClubTarget.mockRejectedValue(new Error("denied"));

    const { result } = renderHook(
      () => useToggleClubReaction({ targetType: "thread", targetIds: [THREAD] }),
      { wrapper },
    );
    await expect(
      result.current.mutateAsync({ targetId: THREAD, kind: "insightful", active: false }),
    ).rejects.toThrow("denied");

    // Pasek pokazujący reakcję, której baza nie przyjęła, jest gorszy niż
    // chwilowe mignięcie.
    await waitFor(() => {
      expect(queryClient.getQueryData<Map<string, unknown[]>>(key)?.get(THREAD)).toEqual([]);
    });
  });

  it("aktywna reakcja WYCOFUJE ją, nie dokłada drugiej", async () => {
    const { wrapper } = harness();
    clubApiMock.unreactFromClubTarget.mockResolvedValue(true);

    const { result } = renderHook(
      () => useToggleClubReaction({ targetType: "thread", targetIds: [THREAD] }),
      { wrapper },
    );
    await result.current.mutateAsync({ targetId: THREAD, kind: "insightful", active: true });

    expect(clubApiMock.unreactFromClubTarget).toHaveBeenCalledWith({
      targetType: "thread",
      targetId: THREAD,
      kind: "insightful",
    });
    expect(clubApiMock.reactToClubTarget).not.toHaveBeenCalled();
  });

  it("po zakończeniu odświeża licznik I twarze", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.reactToClubTarget.mockResolvedValue(true);

    const { result } = renderHook(
      () => useToggleClubReaction({ targetType: "thread", targetIds: [THREAD] }),
      { wrapper },
    );
    await result.current.mutateAsync({ targetId: THREAD, kind: "insightful", active: false });

    await waitFor(() => {
      expect(invalidated).toContainEqual(clubKeys.reactions("thread", [THREAD]));
      expect(invalidated).toContainEqual(clubKeys.reactionActors("thread", [THREAD]));
    });
  });
});

describe("stanowiska i subskrypcje", () => {
  it("podsumowanie stanowisk milczy bez wątku", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubStanceSummary(undefined), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchClubStanceSummary).not.toHaveBeenCalled();
  });

  it("zapis stanowiska unieważnia podsumowanie", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.setClubStance.mockResolvedValue(true);

    const { result } = renderHook(() => useSetClubStance(THREAD), { wrapper });
    await result.current.mutateAsync({ stance: "support" });

    expect(clubApiMock.setClubStance).toHaveBeenCalledWith({ threadId: THREAD, stance: "support" });
    await waitFor(() => expect(sawKeys(invalidated, threadStanceKeys(THREAD))).toBe(true));
  });

  it("subskrypcja ZAPISUJE nowy stan w cache'u zamiast go unieważniać", async () => {
    const { wrapper, queryClient, invalidated } = harness();
    clubApiMock.setClubThreadSubscription.mockResolvedValue(true);

    const { result } = renderHook(() => useSetThreadSubscription(THREAD), { wrapper });
    await result.current.mutateAsync("muted");

    // Stan docelowy jest znany z góry, więc round-trip po jego potwierdzenie
    // byłby zbędny - przełącznik ma odpowiedzieć od razu.
    expect(queryClient.getQueryData(clubKeys.subscription(THREAD))).toBe("muted");
    expect(invalidated).toHaveLength(0);
  });

  it("odczyt subskrypcji milczy bez wątku", async () => {
    const { wrapper } = harness();

    renderHook(() => useMyThreadSubscription(undefined), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchMyThreadSubscription).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Moderacja i wyszukiwanie
// ---------------------------------------------------------------------------

describe("wyszukiwarka klubów", () => {
  it("fraza krótsza niż próg NIE odpytuje bazy", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubSearch({ query: "a" }), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.searchClubThreads).not.toHaveBeenCalled();
  });

  it("fraza powyżej progu semantycznego dokłada wektor do zapytania", async () => {
    const { wrapper } = harness();
    clubApiMock.searchClubThreads.mockResolvedValue([]);
    clubApiMock.embedClubQuery.mockResolvedValue([0.1, 0.2]);

    const { result } = renderHook(() => useClubSearch({ query: "energia jadrowa" }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clubApiMock.searchClubThreads).toHaveBeenCalledWith(
      expect.objectContaining({ query: "energia jadrowa" }),
    );
  });

  it("podpowiedzi kotwicy milczą przy krótkiej frazie", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubAnchorSuggestions({ query: "a" }), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchClubAnchorSuggestions).not.toHaveBeenCalled();
  });
});

describe("kolejka i dziennik moderacji", () => {
  it("kolejka, dziennik i wątki panelu milczą bez id klubu", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubModerationQueue(undefined), { wrapper });
    renderHook(() => useClubModerationLog(undefined), { wrapper });
    renderHook(() => useAdminClubThreads(undefined, {}), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchClubModerationQueue).not.toHaveBeenCalled();
    expect(clubApiMock.fetchClubModerationLog).not.toHaveBeenCalled();
    expect(clubApiMock.fetchAdminClubThreads).not.toHaveBeenCalled();
  });

  it("odpowiedzi panelu milczą bez wątku", async () => {
    const { wrapper } = harness();

    renderHook(() => useAdminClubReplies(undefined), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchAdminClubReplies).not.toHaveBeenCalled();
  });

  it("liczniki plakietki: enabled=false wycisza", async () => {
    const { wrapper } = harness();

    renderHook(() => useClubPendingCounts(false), { wrapper });

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchClubPendingCounts).not.toHaveBeenCalled();
  });
});

describe("operacje moderacyjne", () => {
  it("decyzja moderatora unieważnia poddrzewo klubu i korzeń modułu", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.moderateClubTarget.mockResolvedValue(true);

    const { result } = renderHook(() => useModerateClubTarget(CLUB), { wrapper });
    await result.current.mutateAsync({ targetType: "thread", targetId: THREAD, action: "hide" });

    await waitFor(() => expect(invalidated).toContainEqual(clubKeys.all));
  });

  it("blokada członka dojeżdża z kierunkiem i powodem", async () => {
    const { wrapper } = harness();
    clubApiMock.banClubMember.mockResolvedValue(true);

    const { result } = renderHook(() => useBanClubMember(CLUB), { wrapper });
    await result.current.mutateAsync({ userId: "u1", banned: true, reason: "spam" });

    expect(clubApiMock.banClubMember).toHaveBeenCalledWith({
      clubId: CLUB,
      userId: "u1",
      banned: true,
      reason: "spam",
    });
  });

  it("oznaczenie klubu przeczytanym odświeża plakietkę POZA drzewem klubów", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.markClubRead.mockResolvedValue(5);

    const { result } = renderHook(() => useMarkClubRead(), { wrapper });
    await result.current.mutateAsync(CLUB);

    await waitFor(() => expect(sawKeys(invalidated, clubReadKeys())).toBe(true));
  });
});

// ---------------------------------------------------------------------------
// REDAKCJA I ROZSTRZYGNIĘCIE WĄTKU
//
// Obie mutacje zmieniają treść, którą ktoś już przeczytał: redakcja podmienia
// zapis wypowiedzi, rozstrzygnięcie zamyka konsultację i wskazuje odpowiedź
// rozstrzygającą. Interesuje nas jedno pytanie: co widzi użytkownik, gdy baza
// ODMÓWI. Mutacja, która przy odmowie i tak unieważni cache, zostawia ekran
// w stanie „zrobione" (lista przeładowana, komunikat sukcesu), a zmiany nie ma.
// ---------------------------------------------------------------------------

describe("redakcja wątku", () => {
  it("przekazuje komplet argumentów i unieważnia poddrzewo klubu ORAZ wyszukiwarkę", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.editClubThread.mockResolvedValue(true);

    const { result } = renderHook(() => useEditClubThread(CLUB, SLUG), { wrapper });
    await result.current.mutateAsync({
      threadId: THREAD,
      title: "Tytuł po korekcie",
      body: "Treść po korekcie",
      reason: "literówka",
    });

    // `mutationFn` jest tu PRZEKAZANA WPROST, więc react-query dokłada drugi
    // argument (kontekst mutacji). Warunek stawiamy na PIERWSZYM - to on jest
    // ładunkiem, o który chodzi.
    expect(clubApiMock.editClubThread.mock.calls[0]?.[0]).toEqual({
      threadId: THREAD,
      title: "Tytuł po korekcie",
      body: "Treść po korekcie",
      reason: "literówka",
    });
    // Wyszukiwarka jest OSOBNYM poddrzewem: bez jej unieważnienia poprawiony
    // tytuł zostaje w wynikach w starej wersji.
    await waitFor(() => expect(sawKeys(invalidated, threadEditedKeys(CLUB, SLUG))).toBe(true));
  });

  it("ODMOWA bazy nie unieważnia niczego - ekran nie udaje, że zapisał", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.editClubThread.mockRejectedValue(new Error("thread_locked"));

    const { result } = renderHook(() => useEditClubThread(CLUB, SLUG), { wrapper });
    await expect(result.current.mutateAsync({ threadId: THREAD, body: "B" })).rejects.toThrow(
      "thread_locked",
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidated).toEqual([]);
    expect(result.current.isSuccess).toBe(false);
  });
});

describe("rozstrzygnięcie wątku", () => {
  it("unieważnia KARTĘ tego wątku i cały prefiks jego odpowiedzi", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.resolveClubThread.mockResolvedValue(true);

    const { result } = renderHook(() => useResolveClubThread(CLUB, SLUG), { wrapper });
    await result.current.mutateAsync({ threadId: THREAD, replyId: "r-7" });

    expect(clubApiMock.resolveClubThread.mock.calls[0]?.[0]).toEqual({
      threadId: THREAD,
      replyId: "r-7",
    });
    await waitFor(() =>
      expect(sawKeys(invalidated, threadResolvedKeys(CLUB, SLUG, THREAD))).toBe(true),
    );
  });

  it("COFNIĘCIE rozstrzygnięcia (replyId=null) ma ten sam skutek na cache'u", async () => {
    // Cofnięcie jest tą samą operacją z pustym wskazaniem - gdyby unieważniało
    // mniej, odznaka „rozstrzygnięty" zostawałaby na karcie po jej zdjęciu.
    const { wrapper, invalidated } = harness();
    clubApiMock.resolveClubThread.mockResolvedValue(true);

    const { result } = renderHook(() => useResolveClubThread(CLUB, SLUG), { wrapper });
    await result.current.mutateAsync({ threadId: THREAD, replyId: null });

    expect(clubApiMock.resolveClubThread.mock.calls[0]?.[0]).toEqual({
      threadId: THREAD,
      replyId: null,
    });
    await waitFor(() =>
      expect(sawKeys(invalidated, threadResolvedKeys(CLUB, SLUG, THREAD))).toBe(true),
    );
  });

  it("ODMOWA bazy zostawia cache nietknięty - lista nie przeładuje się „na sukces”", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.resolveClubThread.mockRejectedValue(new Error("forbidden"));

    const { result } = renderHook(() => useResolveClubThread(CLUB, SLUG), { wrapper });
    await expect(result.current.mutateAsync({ threadId: THREAD, replyId: "r-7" })).rejects.toThrow(
      "forbidden",
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidated).toEqual([]);
    expect(result.current.isSuccess).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ZAPAS `?? ""` W ZAPYTANIACH BEZ IDENTYFIKATORA
//
// Każdy odczyt tego modułu ma parę: bramkę `enabled` i zapas `?? ""` w ciele
// zapytania. Warunki wyżej dowodzą BRAMKI (render bez identyfikatora nie
// odpytuje). Bramka nie jest jednak jedyną drogą do `queryFn`: `refetch()`
// z react-query omija `enabled` i wywoła zapytanie MIMO braku identyfikatora -
// robi tak każdy przycisk „odśwież" wpięty w wynik hooka. Wtedy o tym, co
// zobaczy warstwa danych, decyduje wyłącznie zapas.
//
// PRZEDMIOT DOWODU: do warstwy danych jedzie PUSTY NAPIS, nigdy `undefined`.
// Różnica jest realna: `undefined` w argumencie RPC znika przy serializacji,
// więc funkcja bazy dostaje wywołanie BEZ parametru i odpowiada błędem
// o brakującym argumencie zamiast pustym wynikiem.
// ---------------------------------------------------------------------------

describe("odczyty wątku bez identyfikatora - wymuszony refetch", () => {
  it("karta wątku z kompletem identyfikatorów czyta po nich obu", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubThread.mockResolvedValue(null);

    const { result } = renderHook(() => useClubThread({ clubId: CLUB, slug: SLUG }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubThread).toHaveBeenCalledWith({ clubId: CLUB, slug: SLUG });
  });

  it("wymuszony refetch karty wątku bez identyfikatorów posyła DWA puste napisy", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubThread.mockResolvedValue(null);

    const { result } = renderHook(() => useClubThread({ clubId: undefined, slug: undefined }), {
      wrapper,
    });
    await result.current.refetch();

    expect(clubApiMock.fetchClubThread).toHaveBeenCalledWith({ clubId: "", slug: "" });
  });

  it("wymuszony refetch listy wątków bez klubu posyła pusty napis, nie `undefined`", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubThreads.mockResolvedValue({ rows: [], nextCursor: null });

    const { result } = renderHook(() => useClubThreads({ clubId: undefined }), { wrapper });
    await result.current.refetch();

    expect(clubApiMock.fetchClubThreads).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: "", cursor: null }),
    );
  });

  it("odpowiedzi bez wątku: pusty napis jest CZĘŚCIĄ KLUCZA, nie tylko argumentu", async () => {
    // Klucz z `undefined` w środku react-query odrzuca, więc zapas musi być
    // również w kluczu - inaczej hook wywala się przy pierwszym renderze
    // przed dojechaniem trasy.
    const { wrapper, queryClient } = harness();
    clubApiMock.fetchClubReplies.mockResolvedValue({ rows: [], total: 0 });

    const { result } = renderHook(() => useClubReplies({ threadId: undefined }), { wrapper });
    await result.current.refetch();

    expect(clubApiMock.fetchClubReplies).toHaveBeenCalledWith({
      threadId: "",
      sort: "chronological",
      limit: 200,
    });
    expect(
      queryClient.getQueryCache().find({ queryKey: clubKeys.replies("", "chronological") }),
    ).toBeDefined();
  });

  it("podsumowanie stanowisk i subskrypcja czytają po wątku, a bez niego - po pustym napisie", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubStanceSummary.mockResolvedValue([]);
    clubApiMock.fetchMyThreadSubscription.mockResolvedValue(null);

    const withThread = renderHook(() => useClubStanceSummary(THREAD), { wrapper });
    await waitFor(() => expect(withThread.result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubStanceSummary).toHaveBeenCalledWith(THREAD);

    const subscribed = renderHook(() => useMyThreadSubscription(THREAD), { wrapper });
    await waitFor(() => expect(subscribed.result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchMyThreadSubscription).toHaveBeenCalledWith(THREAD);

    const orphanStance = renderHook(() => useClubStanceSummary(undefined), { wrapper });
    await orphanStance.result.current.refetch();
    expect(clubApiMock.fetchClubStanceSummary).toHaveBeenLastCalledWith("");

    const orphanSub = renderHook(() => useMyThreadSubscription(undefined), { wrapper });
    await orphanSub.result.current.refetch();
    expect(clubApiMock.fetchMyThreadSubscription).toHaveBeenLastCalledWith("");
  });
});

describe("odczyty zaproszeń bez identyfikatora klubu", () => {
  it("lista zaproszeń i katalog linków czytają po id klubu", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubInvitations.mockResolvedValue([]);
    clubApiMock.fetchClubInviteLinks.mockResolvedValue([]);

    const invitations = renderHook(() => useClubInvitations(CLUB), { wrapper });
    await waitFor(() => expect(invitations.result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubInvitations).toHaveBeenCalledWith(CLUB);

    const links = renderHook(() => useClubInviteLinks(CLUB), { wrapper });
    await waitFor(() => expect(links.result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubInviteLinks).toHaveBeenCalledWith(CLUB);
  });

  it("wymuszony refetch bez klubu posyła pusty napis do OBU odczytów", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubInvitations.mockResolvedValue([]);
    clubApiMock.fetchClubInviteLinks.mockResolvedValue([]);

    const invitations = renderHook(() => useClubInvitations(undefined), { wrapper });
    await invitations.result.current.refetch();
    expect(clubApiMock.fetchClubInvitations).toHaveBeenCalledWith("");

    const links = renderHook(() => useClubInviteLinks(undefined), { wrapper });
    await links.result.current.refetch();
    expect(clubApiMock.fetchClubInviteLinks).toHaveBeenCalledWith("");
  });
});

// ---------------------------------------------------------------------------
// REAKCJE - PARTIA CELÓW I CACHE, KTÓREGO NIE MA
//
// `useToggleClubReaction` jest jedyną mutacją modułu z optymistycznym zapisem,
// więc ma DWA wejścia w cache: przed odpowiedzią bazy (onMutate) i po odmowie
// (onError). Warunki wyżej sprawdzają je przy WYPEŁNIONYM cache'u. Tutaj
// sprawdzamy dwa przypadki, które w interfejsie zdarzają się częściej, niż
// wygląda: kliknięcie w reakcję na karcie, dla której licznik jeszcze nie
// dojechał (brak wpisu w mapie), i kliknięcie zanim zapytanie o liczniki
// w ogóle wystartowało (brak mapy).
// ---------------------------------------------------------------------------

describe("reakcje - odczyt liczników i twarzy", () => {
  it("niepusta partia celów czyta liczniki JEDNYM zapytaniem", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubReactions.mockResolvedValue(new Map());

    const { result } = renderHook(
      () => useClubReactions({ targetType: "reply", targetIds: ["r-1", "r-2", "r-3"] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubReactions).toHaveBeenCalledTimes(1);
    expect(clubApiMock.fetchClubReactions).toHaveBeenCalledWith({
      targetType: "reply",
      targetIds: ["r-1", "r-2", "r-3"],
    });
  });

  it("twarze niosą limit i domyślnie są WŁĄCZONE przy niepustej partii", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchClubReactionActors.mockResolvedValue(new Map());

    const { result } = renderHook(
      () => useClubReactionActors({ targetType: "thread", targetIds: [THREAD], limit: 5 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clubApiMock.fetchClubReactionActors).toHaveBeenCalledWith({
      targetType: "thread",
      targetIds: [THREAD],
      limit: 5,
    });
  });

  it("`enabled: false` wycisza twarze MIMO niepustej partii - lista zwinięta nie kosztuje", async () => {
    // Twarze są cięższym zapytaniem niż liczniki i są potrzebne dopiero po
    // najechaniu na pasek. Bramka jest tu oszczędnością, nie zabezpieczeniem.
    const { wrapper } = harness();

    renderHook(
      () => useClubReactionActors({ targetType: "thread", targetIds: [THREAD], enabled: false }),
      { wrapper },
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(clubApiMock.fetchClubReactionActors).not.toHaveBeenCalled();
  });
});

describe("reakcje - optymistyczny zapis przy niekompletnym cache'u", () => {
  it("cel BEZ wpisu w mapie liczników dostaje wpis nowy, a nie wyjątek", async () => {
    const { wrapper, queryClient } = harness();
    const key = clubKeys.reactions("thread", [THREAD]);
    // Mapa istnieje (licznik dla SĄSIEDNIEGO wątku dojechał), ale ten cel
    // jeszcze jej nie ma - dokładnie tak wygląda świeżo doładowana strona.
    queryClient.setQueryData(key, new Map([["inny-watek", []]]));
    clubApiMock.reactToClubTarget.mockResolvedValue(true);

    const { result } = renderHook(
      () => useToggleClubReaction({ targetType: "thread", targetIds: [THREAD] }),
      { wrapper },
    );
    await result.current.mutateAsync({ targetId: THREAD, kind: "agree", active: false });

    const cached = queryClient.getQueryData<Map<string, ClubReactionTally[]>>(key);
    expect(cached?.get(THREAD)).toEqual([{ kind: "agree", total: 1, mine: true }]);
    // Sąsiedni wpis nie może zniknąć - to ta sama mapa, nie nowa.
    expect(cached?.get("inny-watek")).toEqual([]);
  });

  it("brak mapy w cache'u: odmowa bazy NIE tworzy wpisu z niczego", async () => {
    // Bez tego warunku `onError` mógłby zapisać `undefined` jako stan „sprzed
    // kliku" i pasek reakcji zostałby z pustą mapą zamiast poczekać na odczyt.
    const { wrapper, queryClient } = harness();
    const key = clubKeys.reactions("thread", [THREAD]);
    clubApiMock.reactToClubTarget.mockRejectedValue(new Error("denied"));

    const { result } = renderHook(
      () => useToggleClubReaction({ targetType: "thread", targetIds: [THREAD] }),
      { wrapper },
    );
    await expect(
      result.current.mutateAsync({ targetId: THREAD, kind: "agree", active: false }),
    ).rejects.toThrow("denied");

    expect(queryClient.getQueryData(key)).toBeUndefined();
  });
});
