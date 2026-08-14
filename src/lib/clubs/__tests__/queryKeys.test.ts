// Drzewo kluczy React Query modułu klubów - 347 linii, zero testów do dziś.
//
// DLACZEGO TO NIE JEST TEST KOSMETYCZNY. Ten plik jest UMOWĄ O UNIEWAŻNIANIU,
// a nie zbiorem stałych. Cała doktryna modułu brzmi: "każdy poziom jest
// prefiksem następnego, więc `invalidateQueries({ queryKey: clubKeys.club(id) })`
// czyści także grupy, członków i zdolności tego klubu". Kiedy ta umowa pęknie,
// nie pada żaden test i nie zapala się żadna bramka - po prostu po zmianie roli
// albo po wyrzuceniu z klubu ekran zostaje ze STARYMI uprawnieniami do
// najbliższego pełnego przeładowania. W module, w którym zdolności decydują
// o dostępie do dokumentów innych członków, to nie jest usterka odświeżania.
//
// Trzy rzeczy, które ten test pilnuje, a których nie widzi ani `tsc`, ani
// bramka i18n, ani przegląd:
//
//   1. PREFIKSOWOŚĆ. Klucz-potomek musi zaczynać się kluczem-rodzicem. Wystarczy,
//      że ktoś złoży nową gałąź z `clubKeys.all` zamiast z `clubKeys.club(id)`,
//      i unieważnienie klubu przestaje ją dotykać - a kod nadal się kompiluje.
//   2. UDOKUMENTOWANE WYJĄTKI. `bySlug` NIE jest potomkiem `club(id)` i to jest
//      celowe (slug jest zmienny). Komentarz w źródle ostrzega, że każda mutacja
//      musi unieważnić RÓWNIEŻ `bySlugAll()`. Test zamienia to ostrzeżenie
//      w warunek: gdyby ktoś "naprawił" hierarchię, dowiaduje się tutaj.
//   3. ROZŁĄCZNOŚĆ. Dwa różne zestawy argumentów nie mogą dawać jednego klucza.
//      Historia modułu ma dwa takie defekty pod rząd (rozmiar strony poza
//      kluczem w `board` i w `eventAttendees`, opisane w źródle) - oba objawiały
//      się gubieniem wierszy na ekranie, który istnieje wyłącznie po to, żeby je
//      pokazać.
import { describe, expect, it } from "vitest";
import { adminClubKeys, clubKeys } from "../queryKeys";
import type { AdminClubListFilters } from "../types";

const CLUB = "club-energy-cee";
const OTHER_CLUB = "club-defence-cee";
const THREAD = "thread-market-design";
const OTHER_THREAD = "thread-capacity-market";

/** Czy `child` zaczyna się dokładnie sekwencją `parent`. */
function startsWith(child: readonly unknown[], parent: readonly unknown[]): boolean {
  if (child.length < parent.length) return false;
  return parent.every((segment, index) => child[index] === segment);
}

/**
 * Wszystkie gałęzie `clubKeys` zbudowane na jednym klubie i jednym wątku.
 *
 * Budowane REFLEKSYJNIE z obiektu, nie z listy przepisanej ręcznie: nowa gałąź
 * dopisana do `queryKeys.ts` wchodzi do tego zestawu sama i od razu podlega
 * wszystkim niżej opisanym warunkom. Lista przepisana do testu starzeje się
 * cicho, a wtedy właśnie NOWA gałąź - ta, której nikt jeszcze nie sprawdził -
 * jest tą jedyną, której test nie widzi.
 */
function allBranches(): ReadonlyArray<{ name: string; key: readonly unknown[] }> {
  const out: Array<{ name: string; key: readonly unknown[] }> = [];
  for (const [name, value] of Object.entries(clubKeys)) {
    // `all` to sam KORZEŃ, nie gałąź - sprawdzany osobno. Wpuszczony do tego
    // zestawu oblewałby warunki, które z definicji dotyczą potomków (własny
    // literał rozpoznawczy, długość powyżej korzenia).
    if (name === "all") continue;
    if (Array.isArray(value)) {
      out.push({ name, key: value });
      continue;
    }
    if (typeof value !== "function") continue;
    out.push({ name, key: callBranch(name, value) });
  }
  return out;
}

/**
 * Woła gałąź argumentami pasującymi do jej sygnatury.
 *
 * Rozpoznanie po `length` (liczbie parametrów bez domyślnych) i po nazwie -
 * wystarczające, bo argumenty w tym module są tylko czterech rodzajów:
 * identyfikator klubu, identyfikator wątku, tekst filtra i liczba. Pierwszy
 * argument rozstrzyga `firstArgument()`, reszta dostaje wypełniacz - warunki
 * niżej patrzą na PREFIKSY i na rozłączność, nie na treść członów filtra.
 */
function callBranch(
  name: string,
  fn: (...args: never[]) => readonly unknown[],
): readonly unknown[] {
  // `reactions` / `reactionActors` biorą typ celu i TABLICĘ identyfikatorów.
  if (name === "reactions" || name === "reactionActors") {
    return fn(...(["reply", ["b", "a"]] as never[]));
  }
  const args: unknown[] = [];
  for (let index = 0; index < fn.length; index += 1) {
    args.push(index === 0 ? firstArgument(name) : "x");
  }
  return fn(...(args as never[]));
}

/** Pierwszy argument gałęzi: identyfikator wątku dla gałęzi wątkowych, klubu dla reszty. */
function firstArgument(name: string): string {
  const THREAD_FIRST = new Set([
    "replies",
    "repliesAll",
    "stances",
    "subscription",
    "workspace",
    "workspaceSummary",
    "participants",
    "documents",
    "milestones",
    "questions",
    "threadLinks",
    "threadPolls",
    "insights",
    "workspaceSearch",
    "adminReplies",
    "threadExperts",
  ]);
  return THREAD_FIRST.has(name) ? THREAD : CLUB;
}

describe("korzeń drzewa", () => {
  it("wszystko wisi pod jednym korzeniem `clubs`", () => {
    expect(clubKeys.all).toEqual(["clubs"]);
    const strays = allBranches().filter(({ key }) => key[0] !== "clubs");
    expect(strays.map((b) => b.name)).toEqual([]);
  });

  it("panel ma WŁASNY korzeń, rozłączny z produktowym", () => {
    // Rozłączność jest celowa: czyszczenie cache produktu nie może wywalać
    // otwartej listy w panelu (i odwrotnie), bo to dwa różne zapytania o dwóch
    // różnych zakresach uprawnień.
    expect(adminClubKeys.all).toEqual(["admin", "clubs"]);
    expect(startsWith(adminClubKeys.all, clubKeys.all)).toBe(false);
    expect(startsWith(clubKeys.all, adminClubKeys.all)).toBe(false);
  });

  it("skan refleksyjny widzi całe drzewo (kanarek zasięgu)", () => {
    // Bez tego kanarka awaria `callBranch` zamieniłaby wszystkie warunki niżej
    // w puste, zielone pętle.
    const branches = allBranches();
    expect(branches.length).toBeGreaterThan(50);
    for (const { name, key } of branches) {
      expect(Array.isArray(key), `${name} nie zwróciła tablicy`).toBe(true);
      expect(key.length, `${name} zwróciła sam korzeń`).toBeGreaterThan(1);
    }
  });
});

describe("prefiksowość: unieważnienie klubu musi dosięgnąć jego gałęzi", () => {
  // Zestaw dobrany po tym, CO WIDZI CZŁONEK: skład, grupy, uprawnienia,
  // biblioteka, kalendarz, ściana, tablica. Każda z tych gałęzi po zmianie roli
  // albo po wyrzuceniu z klubu musi zostać odświeżona jednym wywołaniem.
  const UNDER_CLUB: ReadonlyArray<[string, readonly unknown[]]> = [
    ["groups", clubKeys.groups(CLUB)],
    ["members", clubKeys.members(CLUB, null, 0, 50)],
    ["stats", clubKeys.stats(CLUB)],
    ["invitations", clubKeys.invitations(CLUB)],
    ["inviteLinks", clubKeys.inviteLinks(CLUB)],
    ["threads", clubKeys.threads(CLUB, null, "hot", null)],
    ["thread", clubKeys.thread(CLUB, "slug")],
    ["adminThreads", clubKeys.adminThreads(CLUB, null, null, null, "", 0)],
    ["moderationQueue", clubKeys.moderationQueue(CLUB)],
    ["moderationLog", clubKeys.moderationLog(CLUB)],
    ["capabilitiesPreview", clubKeys.capabilitiesPreview(CLUB, "user-1")],
    ["libraryDocuments", clubKeys.libraryDocuments(CLUB, null, null, "", 0)],
    ["documentsAll", clubKeys.documentsAll(CLUB)],
    ["posts", clubKeys.posts(CLUB, null, null)],
    ["postsAll", clubKeys.postsAll(CLUB)],
    ["events", clubKeys.events(CLUB, null, null, null)],
    ["eventsAll", clubKeys.eventsAll(CLUB)],
    ["event", clubKeys.event(CLUB, "slug")],
    ["eventAttendees", clubKeys.eventAttendees(CLUB, "event-1", 12)],
    ["clubMilestones", clubKeys.clubMilestones(CLUB)],
    ["activitySeries", clubKeys.activitySeries(CLUB, 30)],
    ["workspaceStats", clubKeys.workspaceStats(CLUB, 30)],
    ["board", clubKeys.board(CLUB, null, null)],
    ["boardAll", clubKeys.boardAll(CLUB)],
    ["myExpertise", clubKeys.myExpertise(CLUB)],
    ["rosterSignal", clubKeys.rosterSignal(CLUB, 8)],
    ["spotlight", clubKeys.spotlight(CLUB)],
    ["spotlightHistory", clubKeys.spotlightHistory(CLUB)],
    ["experts", clubKeys.experts(CLUB, null, "", 0)],
    ["expertiseAreas", clubKeys.expertiseAreas(CLUB)],
  ];

  it.each(UNDER_CLUB)("gałąź %s jest potomkiem club(clubId)", (_name, key) => {
    expect(startsWith(key, clubKeys.club(CLUB))).toBe(true);
  });

  it("żadna z tych gałęzi nie przecieka na INNY klub", () => {
    for (const [name, key] of UNDER_CLUB) {
      expect(startsWith(key, clubKeys.club(OTHER_CLUB)), `${name} trafia w obcy klub`).toBe(false);
    }
  });

  it("prefiks klubu nie jest prefiksem gałęzi innego klubu (izolacja par)", () => {
    // To jest ten sam warunek, co wyżej, ale postawiony od strony klucza
    // NADRZĘDNEGO: `invalidateQueries(club(A))` nie może dotknąć niczego z B.
    expect(startsWith(clubKeys.groups(OTHER_CLUB), clubKeys.club(CLUB))).toBe(false);
    expect(startsWith(clubKeys.posts(OTHER_CLUB, null, null), clubKeys.club(CLUB))).toBe(false);
  });
});

describe("prefiksowość: przestrzeń robocza wątku", () => {
  // Doktryna z komentarza w źródle: WSZYSTKO w przestrzeni roboczej wisi pod
  // jednym `workspace(threadId)`, bo liczniki na belce zakładek zmieniają się po
  // KAŻDYM zapisie w KAŻDYM panelu. Punktowe unieważnienie i tak musiałoby
  // trafiać w dwa klucze, a wtedy trzeci zostanie kiedyś pominięty.
  const UNDER_WORKSPACE: ReadonlyArray<[string, readonly unknown[]]> = [
    ["workspaceSummary", clubKeys.workspaceSummary(THREAD)],
    ["participants", clubKeys.participants(THREAD)],
    ["documents", clubKeys.documents(THREAD, null)],
    ["milestones", clubKeys.milestones(THREAD, null, null)],
    ["questions", clubKeys.questions(THREAD, null, "new")],
    ["threadLinks", clubKeys.threadLinks(THREAD)],
    ["threadPolls", clubKeys.threadPolls(THREAD)],
    ["insights", clubKeys.insights(THREAD, 12)],
    ["workspaceSearch", clubKeys.workspaceSearch(THREAD, "gaz")],
    ["threadExperts", clubKeys.threadExperts(THREAD)],
  ];

  it.each(UNDER_WORKSPACE)("panel %s jest potomkiem workspace(threadId)", (_name, key) => {
    expect(startsWith(key, clubKeys.workspace(THREAD))).toBe(true);
  });

  it("przestrzeń jednego wątku nie dotyka przestrzeni drugiego", () => {
    for (const [name, key] of UNDER_WORKSPACE) {
      expect(startsWith(key, clubKeys.workspace(OTHER_THREAD)), name).toBe(false);
    }
  });

  it("eksperci należą do WĄTKU, nie do klubu", () => {
    // Udokumentowana decyzja: lista zmienia się z otwartym wątkiem, a prośba
    // o zdanie ma unieważnić wyłącznie ten wątek, a nie każdy panel klubu
    // na ekranie.
    expect(startsWith(clubKeys.threadExperts(THREAD), clubKeys.workspace(THREAD))).toBe(true);
    expect(startsWith(clubKeys.threadExperts(THREAD), clubKeys.club(CLUB))).toBe(false);
  });

  it("biblioteka KLUBU i dokumenty WĄTKU to dwa rozłączne zbiory", () => {
    // Obie gałęzie nazywają się w kluczu "documents" - rozłączność daje im
    // dopiero rodzic. Gdyby któraś przeszła pod drugiego rodzica, unieważnienie
    // biblioteki klubu czyściłoby panele wszystkich otwartych wątków.
    const library = clubKeys.libraryDocuments(CLUB, null, null, "", 0);
    const threadDocs = clubKeys.documents(THREAD, null);
    expect(startsWith(library, clubKeys.club(CLUB))).toBe(true);
    expect(startsWith(threadDocs, clubKeys.workspace(THREAD))).toBe(true);
    expect(startsWith(threadDocs, clubKeys.club(CLUB))).toBe(false);
    expect(startsWith(library, clubKeys.workspace(THREAD))).toBe(false);
  });
});

describe("udokumentowane wyjątki od hierarchii", () => {
  it("bySlug NIE jest potomkiem club(clubId) - i to jest celowe", () => {
    // Komentarz w źródle (`queryKeys.ts:28-35`) ostrzega wprost: slug jest
    // zmienny, więc karta po slugu stoi w osobnej gałęzi, a KAŻDA mutacja
    // zmieniająca kartę musi unieważnić również `bySlugAll()`. Ten warunek
    // pilnuje, żeby ostrzeżenie nie zostało "naprawione" w tę drugą stronę:
    // gdyby ktoś podpiął `bySlug` pod klub, komentarz zaczyna kłamać, a druga
    // inwalidacja w mutacjach staje się martwym kodem.
    expect(startsWith(clubKeys.bySlug("energia-cee"), clubKeys.club(CLUB))).toBe(false);
    expect(startsWith(clubKeys.bySlug("energia-cee"), clubKeys.bySlugAll())).toBe(true);
  });

  it("bySlugAll trafia w KAŻDĄ otwartą kartę, bo mutacja nie zna slugu", () => {
    for (const slug of ["energia-cee", "obronnosc-cee", "finanse"]) {
      expect(startsWith(clubKeys.bySlug(slug), clubKeys.bySlugAll()), slug).toBe(true);
    }
  });

  it("wyszukiwanie jest GLOBALNE - nie wisi pod klubem", () => {
    // Gdyby wisiało, czyszczenie cache jednego klubu kasowałoby wyniki
    // wyszukiwania po całej platformie.
    expect(startsWith(clubKeys.search("gaz", CLUB), clubKeys.club(CLUB))).toBe(false);
    expect(startsWith(clubKeys.search("gaz", CLUB), clubKeys.searchAll())).toBe(true);
    expect(startsWith(clubKeys.search("gaz", null), clubKeys.searchAll())).toBe(true);
  });

  it("searchAll trafia w każdą frazę, bo redakcja tytułu zmienia każdy cytat", () => {
    for (const query of ["gaz", "rynek mocy", ""]) {
      expect(startsWith(clubKeys.search(query, null), clubKeys.searchAll()), query).toBe(true);
    }
  });

  it("odpowiedzi wątku mają własny prefiks bez sortowania", () => {
    // Zdarzenie realtime nie wie, który sort ma otwarty czytelnik, więc musi
    // istnieć prefiks trafiający we wszystkie warianty.
    for (const sort of ["new", "old", "top", "stance"]) {
      expect(startsWith(clubKeys.replies(THREAD, sort), clubKeys.repliesAll(THREAD)), sort).toBe(
        true,
      );
    }
    expect(startsWith(clubKeys.replies(THREAD, "new"), clubKeys.repliesAll(OTHER_THREAD))).toBe(
      false,
    );
  });
});

describe("rozłączność: filtr jest częścią klucza", () => {
  // Regresja historyczna, opisana w źródle w dwóch miejscach: rozmiar strony
  // POZA kluczem. Szyna prosiła o osiem ogłoszeń, pełna tablica o dwadzieścia
  // cztery - oba widoki czytały JEDEN wpis cache, więc paginacja liczyła strony
  // po 24 z `total`, oddając 8 wierszy. Ten sam defekt drugi raz przy obecności
  // na spotkaniu: 12 twarzy kontra 50 na ekranie, który istnieje po to, żeby
  // pokazać potwierdzone obecności.
  it("rozmiar strony tablicy ogłoszeń jest częścią klucza", () => {
    expect(clubKeys.board(CLUB, null, null, "open", 0, 8)).not.toEqual(
      clubKeys.board(CLUB, null, null, "open", 0, 24),
    );
  });

  it("rozmiar strony listy obecności jest częścią klucza", () => {
    expect(clubKeys.eventAttendees(CLUB, "event-1", 12)).not.toEqual(
      clubKeys.eventAttendees(CLUB, "event-1", 50),
    );
  });

  it("rozmiar strony biblioteki jest częścią klucza", () => {
    expect(clubKeys.libraryDocuments(CLUB, null, null, "", 0, "all")).not.toEqual(
      clubKeys.libraryDocuments(CLUB, null, null, "", 0, "products"),
    );
  });

  it("rozmiar strony w panelu jest częścią klucza", () => {
    const base: AdminClubListFilters = { search: "", status: null, visibility: null, offset: 0 };
    expect(adminClubKeys.list({ ...base, limit: 50 })).not.toEqual(
      adminClubKeys.list({ ...base, limit: 200 }),
    );
  });

  it("każdy filtr listy wątków rozróżnia klucz", () => {
    // Osiem osi filtrowania. Bez pełnego zestawu w kluczu dwa różne wyniki
    // leżałyby pod jednym wpisem, a przełączenie filtra pokazywałoby poprzednią
    // stronę kursorową jako swoją.
    const base = clubKeys.threads(CLUB, null, "hot", null, null, null, false, null);
    const variants: ReadonlyArray<[string, readonly unknown[]]> = [
      ["groupId", clubKeys.threads(CLUB, "group-1", "hot", null, null, null, false, null)],
      ["sort", clubKeys.threads(CLUB, null, "new", null, null, null, false, null)],
      ["kind", clubKeys.threads(CLUB, null, "hot", "question", null, null, false, null)],
      ["status", clubKeys.threads(CLUB, null, "hot", null, "open", null, false, null)],
      ["anchored", clubKeys.threads(CLUB, null, "hot", null, null, true, false, null)],
      ["unreadOnly", clubKeys.threads(CLUB, null, "hot", null, null, null, true, null)],
      ["topic", clubKeys.threads(CLUB, null, "hot", null, null, null, false, "energia")],
    ];
    for (const [axis, key] of variants) {
      expect(key, `oś ${axis} nie zmienia klucza`).not.toEqual(base);
    }
  });

  it("`anchored` rozróżnia TRZY stany, nie dwa", () => {
    // `null` (bez zawężenia), `true` (zakotwiczone), `false` (luźne). Zapisanie
    // tego przez samą wartość logiczną scaliłoby "bez zawężenia" z "luźne".
    const any = clubKeys.threads(CLUB, null, "hot", null, null, null);
    const anchored = clubKeys.threads(CLUB, null, "hot", null, null, true);
    const loose = clubKeys.threads(CLUB, null, "hot", null, null, false);
    expect(
      new Set([JSON.stringify(any), JSON.stringify(anchored), JSON.stringify(loose)]).size,
    ).toBe(3);
  });

  it("brak zawężenia i wartość `all` nie mogą się zlewać w gałęziach z domyślnym `all`", () => {
    // `groupId ?? "all"` jest świadome: `null` znaczy "wszystkie działy" i ma
    // trafiać w ten sam wpis co brak filtra. Zapisane wprost, żeby przyszła
    // zmiana na `?? ""` (albo pominięcie członu) była widoczna.
    expect(clubKeys.posts(CLUB, null, null)).toEqual(clubKeys.posts(CLUB, null, null));
    expect(clubKeys.posts(CLUB, "all", null)).toEqual(clubKeys.posts(CLUB, null, null));
  });
});

describe("klucze wsadowe: kolejność partii nie może tworzyć nowego wpisu", () => {
  // `reactions` i `reactionActors` niosą CAŁĄ partię celów, bo zapytanie jest
  // wsadowe. Gdyby klucz zależał od kolejności, ta sama partia w innej
  // kolejności (a kolejność bierze się z kolejności renderowania odpowiedzi)
  // dawała by drugi wpis cache i drugie zapytanie po sieci - przy każdym
  // przewinięciu listy.
  it("reactions: partia posortowana i nieposortowana daje ten sam klucz", () => {
    expect(clubKeys.reactions("reply", ["b", "a", "c"])).toEqual(
      clubKeys.reactions("reply", ["a", "b", "c"]),
    );
  });

  it("reactionActors: to samo", () => {
    expect(clubKeys.reactionActors("thread", ["z", "y"])).toEqual(
      clubKeys.reactionActors("thread", ["y", "z"]),
    );
  });

  it("sortowanie NIE mutuje tablicy wołającego", () => {
    // `[...targetIds].sort()` zamiast `targetIds.sort()`. Mutacja w miejscu
    // przestawiłaby kolejność listy renderowanej przez wołającego - defekt,
    // który objawia się skakaniem wierszy, a nie błędem cache.
    const ids = ["c", "a", "b"];
    clubKeys.reactions("reply", ids);
    expect(ids).toEqual(["c", "a", "b"]);
  });

  it("różne partie dają różne klucze", () => {
    expect(clubKeys.reactions("reply", ["a", "b"])).not.toEqual(
      clubKeys.reactions("reply", ["a", "b", "c"]),
    );
  });

  it("ten sam zestaw identyfikatorów pod różnym typem celu to różne klucze", () => {
    expect(clubKeys.reactions("reply", ["a"])).not.toEqual(clubKeys.reactions("thread", ["a"]));
  });
});

describe("brak kolizji między gałęziami", () => {
  it("żadne dwie gałęzie nie dają identycznego klucza", () => {
    // Kolizja znaczy, że dwa różne zapytania dzielą jeden wpis cache - jedno
    // nadpisuje odpowiedź drugiego. Przy gałęziach o tej samej arności
    // (`stats`, `moderationQueue`, `spotlight`...) różni je wyłącznie literał
    // nazwy, więc literówka w kopiowanym wierszu jest realnym scenariuszem.
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const { name, key } of allBranches()) {
      const serialized = JSON.stringify(key);
      const previous = seen.get(serialized);
      if (previous !== undefined && previous !== name) {
        collisions.push(`${previous} == ${name} -> ${serialized}`);
        continue;
      }
      seen.set(serialized, name);
    }
    expect(collisions).toEqual([]);
  });

  it("każda gałąź niesie własny literał rozpoznawczy", () => {
    // Klucz zbudowany z samych argumentów (bez nazwy gałęzi) zderzy się
    // z pierwszą nową gałęzią o tej samej arności.
    const nameless: string[] = [];
    for (const { name, key } of allBranches()) {
      const literals = key.filter(
        (segment): segment is string =>
          typeof segment === "string" &&
          segment !== CLUB &&
          segment !== THREAD &&
          segment !== "clubs",
      );
      if (literals.length === 0) nameless.push(name);
    }
    // `list`, `memberships`, `myInvitations`, `pendingCounts` i `bySlugAll` są
    // same swoim literałem - reszta musi mieć własny.
    expect(nameless).toEqual([]);
  });
});

describe("stabilność kluczy", () => {
  it("dwukrotne wołanie tej samej gałęzi daje równe klucze", () => {
    // React Query porównuje klucze STRUKTURALNIE, ale niestabilny klucz (np.
    // z datą w środku) tworzy nowy wpis przy każdym renderze i nigdy nie trafia
    // w cache. Gałąź `spotlight` jest tu wprost udokumentowana: rotacja liczy
    // się w bazie, więc klucz NIE niesie daty.
    for (const { name, key } of allBranches()) {
      expect(JSON.stringify(key), `${name} niestabilna`).toBe(
        JSON.stringify(callBranchByName(name)),
      );
    }
  });

  it("klucze nie zawierają `undefined` - React Query traktuje je jako pominięcie", () => {
    const offenders: string[] = [];
    for (const { name, key } of allBranches()) {
      if (key.some((segment) => segment === undefined)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});

/** Ponowne wywołanie gałęzi po nazwie - do sprawdzenia stabilności. */
function callBranchByName(name: string): readonly unknown[] {
  const value = (clubKeys as Record<string, unknown>)[name];
  if (Array.isArray(value)) return value;
  if (typeof value !== "function") return [];
  return callBranch(name, value as (...args: never[]) => readonly unknown[]);
}
