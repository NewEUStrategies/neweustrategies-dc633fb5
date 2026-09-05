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

  /** Karta klubu W KONTEKSCIE WIDZA. Loader trasy dziala na SSR/prerenderze,
   *  czyli BEZ sesji - `club_view` zwraca wtedy odpowiedz dla anonima
   *  (`can_read = false` w klubie `members`). Gdyby zalogowany czytal ten sam
   *  wpis cache, czlonek klubu zobaczylby bramke "Popros o dostep" mimo
   *  aktywnego czlonkostwa. Tozsamosc widza jest wiec czescia klucza. */
  bySlugViewer: (slug: string, viewerId: string | null) =>
    [...clubKeys.bySlug(slug), "viewer", viewerId ?? "anon"] as const,

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

  /** Kluby ZGLOSZONE przeze mnie wraz ze statusem rozpatrzenia. Poza galezia
   *  konkretnego klubu, bo szkic nie ma jeszcze zadnego widoku klubu. */
  myProposals: () => [...clubKeys.all, "myProposals"] as const,

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

  /** Twarze reakcji - ta sama zasada wsadowa co `reactions`. */
  reactionActors: (targetType: string, targetIds: readonly string[]) =>
    [...clubKeys.all, "reaction-actors", targetType, [...targetIds].sort().join(",")] as const,

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

  // --- przestrzen robocza (A28) ---
  //
  // Wszystkie galezie wisza pod `club(clubId)`, wiec jedna inwalidacja po
  // mutacji kuratorskiej czysci biblioteke, kalendarz, harmonogram I pomiar.
  // To jest celowe: dopiecie dokumentu do watku zmienia rowniez licznik
  // w przekroju, a dwie osobne inwalidacje rozjechalyby sie przy pierwszej
  // nowej mutacji.

  /** Biblioteka KLUBU. Nazwa `library*` odroznia ja od `documents(threadId)`
   *  z warstwy watku - to dwa rozne zbiory pod dwoma roznymi korzeniami. */
  libraryDocuments: (
    clubId: string,
    groupId: string | null,
    kind: string | null,
    search: string,
    offset: number,
    /** Zakres rodzajow (A29): produkty vs materialy. Musi byc CZESCIA klucza -
     *  bez tego "Dorobek" i "Materialy" czytalyby ten sam wpis cache. */
    scope: string = "all",
  ) =>
    [
      ...clubKeys.club(clubId),
      "documents",
      groupId ?? "all",
      kind ?? "all",
      search,
      offset,
      scope,
    ] as const,
  /** Prefiks wszystkich wariantow biblioteki - mutacja nie zna filtrow,
   *  ktore czytelnik ma otwarte. */
  documentsAll: (clubId: string) => [...clubKeys.club(clubId), "documents"] as const,

  /** Wpisy klubowe (A31). Zawezenie dzialu i watku jest CZESCIA klucza:
   *  sciana klubu i sciana jednego watku to dwa rozne zbiory. */
  posts: (clubId: string, groupId: string | null, threadId: string | null) =>
    [...clubKeys.club(clubId), "posts", groupId ?? "all", threadId ?? "all"] as const,
  /** Prefiks wszystkich wariantow sciany - mutacja nie zna otwartych filtrow. */
  postsAll: (clubId: string) => [...clubKeys.club(clubId), "posts"] as const,

  /** Podpisane adresy plikow wpisow. Poza galezia klubu, bo ten sam plik moze
   *  byc czytany z kilku ekranow, a podpis jest wspolny. */
  media: (pathsKey: string) => [...clubKeys.all, "media", pathsKey] as const,

  /** Kalendarz. Zakres jest czescia klucza, bo przejscie na kolejny miesiac
   *  to INNE zapytanie, a nie odswiezenie tego samego. */
  events: (clubId: string, from: string | null, to: string | null, kind: string | null) =>
    [...clubKeys.club(clubId), "events", from ?? "any", to ?? "any", kind ?? "all"] as const,
  eventsAll: (clubId: string) => [...clubKeys.club(clubId), "events"] as const,

  clubMilestones: (clubId: string) => [...clubKeys.club(clubId), "milestones"] as const,

  /** Pomiar. Okno jest czescia klucza - 30 i 90 dni to dwa rozne wykresy. */
  activitySeries: (clubId: string, days: number) =>
    [...clubKeys.club(clubId), "activitySeries", days] as const,
  workspaceStats: (clubId: string, days: number) =>
    [...clubKeys.club(clubId), "workspaceStats", days] as const,

  // --- warstwa sieciujaca (A32) ---
  //
  // Wszystko wisi pod `club(clubId)`, wiec mutacja kuratorska czysci rowniez
  // te galezie. Wyjatkiem sa EKSPERCI, ktorzy nalezą do WATKU, nie do klubu -
  // patrz nizej.

  /** Tablica ogloszen. Zawezenia sa czescia klucza: "szukam" i "oferuje" to
   *  dwie rozne listy, a nie odswiezenie tej samej. Zakres ("otwarte" /
   *  "moje" / "archiwum") tak samo - szyna i pelna strona czytaja ten sam
   *  RPC z roznymi argumentami i nie moga dzielic wpisu cache. */
  board: (
    clubId: string,
    kind: string | null,
    topic: string | null,
    scope: string = "open",
    offset = 0,
    /** ROZMIAR STRONY JEST CZESCIA KLUCZA. Szyna prosi o osiem ogloszen, pelna
     *  tablica o dwadziescia cztery - z tymi samymi pozostalymi argumentami.
     *  Bez tego czlonu oba widoki czytaja JEDEN wpis cache: przejscie z huba
     *  na tablice w oknie swiezosci oddaje osiem wierszy, a paginacja liczy
     *  strony po dwadziescia cztery z `total` - czyli gubi po szesnascie
     *  pozycji na stronie. Ten sam blad, co przy `libraryDocuments`, gdzie
     *  rozmiar strony jest w kluczu od poczatku. */
    limit = 8,
  ) =>
    [
      ...clubKeys.club(clubId),
      "board",
      kind ?? "all",
      topic ?? "all",
      scope,
      offset,
      limit,
    ] as const,
  /** Prefiks wszystkich wariantow tablicy - mutacja nie zna otwartych filtrow. */
  boardAll: (clubId: string) => [...clubKeys.club(clubId), "board"] as const,

  /** Moje deklaracje kompetencji w tym klubie. */
  myExpertise: (clubId: string) => [...clubKeys.club(clubId), "myExpertise"] as const,

  /** Sklad z sygnalem obecnosci. Limit twarzy jest czescia klucza - szyna
   *  prosi o pule do rotacji, ekran skladu o pelna strone. */
  rosterSignal: (clubId: string, limit: number) =>
    [...clubKeys.club(clubId), "rosterSignal", limit] as const,

  /** Czlonek tygodnia. Rotacja liczy sie w bazie, wiec klucz nie niesie daty -
   *  o zmianie tygodnia decyduje `staleTime`, a nie klucz, ktory musialby
   *  wtedy tworzyc nowy wpis cache co siedem dni i nigdy nie sprzatac starych. */
  spotlight: (clubId: string) => [...clubKeys.club(clubId), "spotlight"] as const,

  /** Katalog ekspertow KLUBU - inne pytanie niz `threadExperts`. */
  experts: (clubId: string, topic: string | null, search: string, offset: number) =>
    [...clubKeys.club(clubId), "experts", topic ?? "all", search, offset] as const,

  /** Obszary z licznikiem osob - chipy filtra katalogu. */
  expertiseAreas: (clubId: string) => [...clubKeys.club(clubId), "expertiseAreas"] as const,

  /** Archiwum przedstawien (wylacznie przypiecia redakcyjne). */
  spotlightHistory: (clubId: string) => [...clubKeys.club(clubId), "spotlightHistory"] as const,

  /** Pojedyncze spotkanie po slugu. Slug moze sie zmienic, wiec galaz jest
   *  osobna od `events()` - ale nadal pod klubem, zeby RSVP uniewaznilo
   *  jednym wywolaniem takze kalendarz obok. */
  event: (clubId: string, slug: string) => [...clubKeys.club(clubId), "event", slug] as const,

  /** Obecnosc na spotkaniu. Pod galezia KLUBU, bo wydarzenie do niego nalezy,
   *  a zmiana RSVP ma odswiezyc rowniez kalendarz obok. */
  /** Limit w kluczu z tego samego powodu, co przy tablicy: panel spotkania
   *  prosi o dwanascie twarzy, pelna strona o piecdziesiat. Wspolny wpis cache
   *  gubil trzydziesci osiem potwierdzonych obecnosci na ekranie, ktory
   *  istnieje wylacznie po to, zeby je pokazac. */
  eventAttendees: (clubId: string, eventId: string, limit: number) =>
    [...clubKeys.club(clubId), "eventAttendees", eventId, limit] as const,

  /** Eksperci WATKU - pod galezia przestrzeni roboczej watku, nie klubu:
   *  lista zmienia sie z otwartym watkiem, a prosba o zdanie ma uniewaznic
   *  wylacznie ten watek, a nie kazdy panel klubu na ekranie. */
  threadExperts: (threadId: string) => [...clubKeys.workspace(threadId), "experts"] as const,
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
