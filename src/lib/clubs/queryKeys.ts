// Discussion Club - hierarchia kluczy React Query.
//
// Jedno drzewo z korzeniem ["clubs"], zeby inwalidacja po mutacji byla jednym
// wywolaniem, a nie lista kluczy do zapamietania. Kazdy poziom jest prefiksem
// nastepnego - to jest cala umowa, ktora sprawia, ze `invalidateQueries({
// queryKey: clubKeys.club(id) })` czysci takze grupy i czlonkow tego klubu.
import type { AdminClubListFilters, ClubMemberStatus } from "./types";

export const clubKeys = {
  all: ["clubs"] as const,

  /** Lista klubow widocznych dla wolajacego (produkt). */
  list: () => [...clubKeys.all, "list"] as const,

  /** Moje czlonkostwa - zasila nawigacje. */
  memberships: () => [...clubKeys.all, "memberships"] as const,

  /** Wszystko, co dotyczy jednego klubu. Prefiks dla grup, czlonkow, zdolnosci. */
  club: (clubId: string) => [...clubKeys.all, "club", clubId] as const,

  /** Karta klubu po slugu - osobna galaz, bo slug moze sie zmienic. */
  bySlug: (slug: string) => [...clubKeys.all, "bySlug", slug] as const,

  groups: (clubId: string) => [...clubKeys.club(clubId), "groups"] as const,

  members: (clubId: string, status: ClubMemberStatus | null, offset: number) =>
    [...clubKeys.club(clubId), "members", status ?? "all", offset] as const,

  capabilities: (clubId: string, groupId?: string | null) =>
    [...clubKeys.club(clubId), "capabilities", groupId ?? "club"] as const,

  stats: (clubId: string) => [...clubKeys.club(clubId), "stats"] as const,

  /** Zaproszenia klubu w panelu (obie sciezki w jednej liscie). */
  invitations: (clubId: string) => [...clubKeys.club(clubId), "invitations"] as const,

  /** Linki zapraszajace klubu. */
  inviteLinks: (clubId: string) => [...clubKeys.club(clubId), "inviteLinks"] as const,

  /** Zaproszenia skierowane do wolajacego - poza galezia konkretnego klubu,
   *  bo zasilaja licznik w nawigacji niezaleznie od otwartego klubu. */
  myInvitations: () => [...clubKeys.all, "myInvitations"] as const,

  /** Lista tematow. Filtry sa czescia klucza, wiec przelaczenie grupy albo
   *  sortu to nowy cache, a nie refetch tego samego wpisu. */
  threads: (clubId: string, groupId: string | null, sort: string, kind: string | null) =>
    [...clubKeys.club(clubId), "threads", groupId ?? "all", sort, kind ?? "all"] as const,

  thread: (clubId: string, threadSlug: string) =>
    [...clubKeys.club(clubId), "thread", threadSlug] as const,

  replies: (threadId: string, sort: string) =>
    [...clubKeys.all, "replies", threadId, sort] as const,

  /** Reakcje partii celow. Klucz niesie CALA partie, bo zapytanie jest wsadowe
   *  - klucz per cel dalby N wpisow w cache dla jednego zapytania. */
  reactions: (targetType: string, targetIds: readonly string[]) =>
    [...clubKeys.all, "reactions", targetType, [...targetIds].sort().join(",")] as const,

  stances: (threadId: string) => [...clubKeys.all, "stances", threadId] as const,

  subscription: (threadId: string) => [...clubKeys.all, "subscription", threadId] as const,

  /** Panel: lista tematow z filtrami. */
  adminThreads: (
    clubId: string,
    groupId: string | null,
    status: string | null,
    kind: string | null,
    search: string,
    offset: number,
  ) =>
    [
      ...clubKeys.club(clubId),
      "adminThreads",
      groupId ?? "all",
      status ?? "any",
      kind ?? "any",
      search,
      offset,
    ] as const,

  adminReplies: (threadId: string) => [...clubKeys.all, "adminReplies", threadId] as const,

  /** Wyszukiwanie jest GLOBALNE (klub opcjonalny), wiec klucz nie wisi pod
   *  konkretnym klubem - inaczej czyszczenie cache jednego klubu kasowaloby
   *  wyniki wyszukiwania po calej platformie. */
  search: (query: string, clubId: string | null) =>
    [...clubKeys.all, "search", query, clubId ?? "all"] as const,
  anchor: (anchorType: string, anchorId: string) =>
    [...clubKeys.all, "anchor", anchorType, anchorId] as const,
  moderationQueue: (clubId: string) => [...clubKeys.club(clubId), "moderationQueue"] as const,
  moderationLog: (clubId: string) => [...clubKeys.club(clubId), "moderationLog"] as const,

  capabilitiesPreview: (clubId: string, userId: string, groupId?: string | null) =>
    [...clubKeys.club(clubId), "capabilitiesPreview", userId, groupId ?? "club"] as const,
} as const;

export const adminClubKeys = {
  all: ["admin", "clubs"] as const,

  /**
   * Lista w panelu. Filtry sa czescia klucza, wiec zmiana droplisty to nowy
   * cache, a nie refetch tego samego wpisu - dzieki temu powrot do poprzedniego
   * filtra jest natychmiastowy.
   */
  list: (filters: AdminClubListFilters) =>
    [
      ...adminClubKeys.all,
      "list",
      filters.search?.trim() ?? "",
      filters.status ?? "any",
      filters.visibility ?? "any",
      filters.offset ?? 0,
    ] as const,
} as const;
