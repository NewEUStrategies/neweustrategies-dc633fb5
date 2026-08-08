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

  /** Strumien aktywnosci na stronie glownej klubow. Filtry sa czescia klucza,
   *  bo przelaczenie zakladki "gorace"/"najnowsze" albo obszaru to inna lista,
   *  a nie odswiezenie tej samej. */
  activity: (sort: string, policyArea: string | null) =>
    [...clubKeys.all, "activity", sort, policyArea ?? "all"] as const,

  /** Wszystko, co dotyczy jednego klubu. Prefiks dla grup, czlonkow, zdolnosci. */
  club: (clubId: string) => [...clubKeys.all, "club", clubId] as const,

  /** Karta klubu po slugu - osobna galaz, bo slug moze sie zmienic.
   *
   *  UWAGA DLA MUTACJI: ta galaz NIE jest potomkiem `club(clubId)`, wiec
   *  `invalidateQueries({ queryKey: clubKeys.club(id) })` jej nie dotyka.
   *  Kazda mutacja zmieniajaca karte klubu (dolaczenie, wyjscie, akceptacja
   *  zasad, nowy watek) musi uniewaznic ROWNIEZ ten klucz - inaczej naglowek
   *  klubu zostaje ze starym licznikiem i starym przyciskiem "Dolacz" mimo
   *  wykonanej akcji. Sluzy do tego `clubKeys.bySlugAll()`. */
  bySlug: (slug: string) => [...clubKeys.all, "bySlug", slug] as const,

  /** Prefiks WSZYSTKICH kart po slugu. Mutacja nie zna slugu (pracuje na id),
   *  a prefiks trafia w kazda z nich - w tym w te otwarta na ekranie. */
  bySlugAll: () => [...clubKeys.all, "bySlug"] as const,

  groups: (clubId: string) => [...clubKeys.club(clubId), "groups"] as const,

  members: (clubId: string, status: ClubMemberStatus | null, offset: number, limit: number) =>
    [...clubKeys.club(clubId), "members", status ?? "all", offset, limit] as const,

  stats: (clubId: string) => [...clubKeys.club(clubId), "stats"] as const,

  /** Zaproszenia klubu w panelu (obie sciezki w jednej liscie). */
  invitations: (clubId: string) => [...clubKeys.club(clubId), "invitations"] as const,

  /** Linki zapraszajace klubu. */
  inviteLinks: (clubId: string) => [...clubKeys.club(clubId), "inviteLinks"] as const,

  /** Zaproszenia skierowane do wolajacego - poza galezia konkretnego klubu,
   *  bo zasilaja licznik w nawigacji niezaleznie od otwartego klubu. */
  myInvitations: () => [...clubKeys.all, "myInvitations"] as const,

  /**
   * Lista watkow. KAZDY filtr jest czescia klucza - inaczej dwa rozne zestawy
   * wynikow lezalyby pod jednym wpisem, a przelaczenie filtra pokazywaloby
   * poprzednia strone kursorowa jako swoja.
   */
  threads: (
    clubId: string,
    groupId: string | null,
    sort: string,
    kind: string | null,
    status: string | null = null,
    anchored: boolean | null = null,
    unreadOnly = false,
    topic: string | null = null,
  ) =>
    [
      ...clubKeys.club(clubId),
      "threads",
      groupId ?? "all",
      sort,
      kind ?? "all",
      status ?? "all",
      anchored === null ? "any" : anchored ? "anchored" : "loose",
      unreadOnly ? "unread" : "all",
      topic ?? "all",
    ] as const,

  thread: (clubId: string, threadSlug: string) =>
    [...clubKeys.club(clubId), "thread", threadSlug] as const,

  replies: (threadId: string, sort: string) =>
    [...clubKeys.all, "replies", threadId, sort] as const,
  /** Prefiks bez sortowania - do uniewaznienia WSZYSTKICH wariantow sortu
   *  jednego watku. Zdarzenie realtime nie wie, ktory sort ma otwarty czytelnik. */
  repliesAll: (threadId: string) => [...clubKeys.all, "replies", threadId] as const,

  /** Reakcje partii celow. Klucz niesie CALA partie, bo zapytanie jest wsadowe
   *  - klucz per cel dalby N wpisow w cache dla jednego zapytania. */
  reactions: (targetType: string, targetIds: readonly string[]) =>
    [...clubKeys.all, "reactions", targetType, [...targetIds].sort().join(",")] as const,

  stances: (threadId: string) => [...clubKeys.all, "stances", threadId] as const,

  subscription: (threadId: string) => [...clubKeys.all, "subscription", threadId] as const,

  // -------------------------------------------------------------------------
  // Przestrzen robocza watku (A28)
  //
  // Wszystko wisi pod JEDNYM prefiksem `workspace(threadId)`, wiec mutacja
  // w dowolnym panelu ma do dyspozycji inwalidacje calej przestrzeni jednym
  // wywolaniem. To nie jest lenistwo: liczniki na belce zakladek (`summary`)
  // zmieniaja sie po KAZDYM zapisie w KAZDYM panelu, wiec punktowa inwalidacja
  // i tak musialaby trafiac w dwa klucze naraz - a wtedy trzeci zostanie
  // kiedys pominiety.
  // -------------------------------------------------------------------------
  workspace: (threadId: string) => [...clubKeys.all, "workspace", threadId] as const,

  /** Liczniki paneli - zasilaja belke zakladek. */
  workspaceSummary: (threadId: string) => [...clubKeys.workspace(threadId), "summary"] as const,

  participants: (threadId: string) => [...clubKeys.workspace(threadId), "participants"] as const,

  documents: (threadId: string, kind: string | null) =>
    [...clubKeys.workspace(threadId), "documents", kind ?? "all"] as const,

  /** Zakres dat jest czescia klucza: siatka wrzesnia i siatka pazdziernika to
   *  dwa rozne zbiory, a nie odswiezenie tego samego. */
  milestones: (threadId: string, from: string | null, to: string | null) =>
    [...clubKeys.workspace(threadId), "milestones", from ?? "any", to ?? "any"] as const,

  questions: (threadId: string, status: string | null, sort: string) =>
    [...clubKeys.workspace(threadId), "questions", status ?? "all", sort] as const,

  threadLinks: (threadId: string) => [...clubKeys.workspace(threadId), "links"] as const,

  threadPolls: (threadId: string) => [...clubKeys.workspace(threadId), "polls"] as const,

  insights: (threadId: string, buckets: number) =>
    [...clubKeys.workspace(threadId), "insights", buckets] as const,

  /** Szukanie WEWNATRZ watku - inna galaz niz `search()`, ktore jest globalne.
   *  Wspolny prefiks mieszalby wyniki po platformie z wynikami po watku. */
  workspaceSearch: (threadId: string, query: string) =>
    [...clubKeys.workspace(threadId), "search", query] as const,

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
  /** Prefiks wszystkich fraz - redakcja tytulu zmienia KAZDY wynik, ktory go
   *  cytuje, a mutacja nie wie, jakie frazy ma otwarte czytelnik. */
  searchAll: () => [...clubKeys.all, "search"] as const,
  anchor: (anchorType: string, anchorId: string) =>
    [...clubKeys.all, "anchor", anchorType, anchorId] as const,
  /** Podpowiedzi kotwicy w kompozytorze - fraza i opcjonalne zawezenie typu. */
  anchorSuggest: (query: string, anchorType: string | null) =>
    [...clubKeys.all, "anchorSuggest", query, anchorType ?? "all"] as const,
  pendingCounts: () => [...clubKeys.all, "pendingCounts"] as const,
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
      // Rozmiar strony jest czescia klucza tak samo jak przesuniecie: bez tego
      // zmiana "50 -> 200" przy offsecie 0 trafia w ten sam wpis cache i lista
      // zostaje na piecdziesieciu wierszach, mimo ze licznik mowi co innego.
      filters.limit ?? 50,
      filters.offset ?? 0,
    ] as const,
} as const;
