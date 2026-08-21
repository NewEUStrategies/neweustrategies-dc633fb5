// Dwie trasy „wejściowe” do jednego klubu: hub `/club/$clubSlug` i kuratorskie
// `/club/$clubSlug/minisite`.
//
// CO TEN PLIK DOWODZI. Obie trasy rozstrzygają DOSTĘP, zanim cokolwiek
// narysują, i obie robią to inaczej - więc obie mają własny zestaw pomyłek:
//
//   1. HUB rozdziela CZTERY stany karty klubu, a rozdział jest regułą
//      bezpieczeństwa, nie kosmetyką: awaria RPC to NIE 404 (użytkownik
//      z poprawnym linkiem ma się dowiedzieć, że problem jest po naszej
//      stronie), zero wierszy to 404 a nie 403 (klub `secret` bez dostępu nie
//      ma prawa zdradzić, że istnieje), a `can_read = false` pokazuje bramkę
//      z wartością klubu, nie pustą listę. Sklejenie dwóch pierwszych stanów
//      jest najczęstszą regresją i wygląda niewinnie na ekranie.
//   2. `?tag=` jest KONTRAKTEM ADRESU: widok zawężony tagiem ma być linkowalny
//      i wracalny przyciskiem „wstecz”. `validateSearch` obcina tag do 50
//      znaków - to jedyna obrona przed adresem, w którym ktoś przesyła
//      kilobajt tekstu jako filtr.
//   3. MINISITE liczy poziom dostępu z CZTERECH niezależnych źródeł (personel,
//      `can_read`, status członkostwa, zaproszenie, ranga warstwy) i wsuwa
//      wynik do organizmu. Trasa nie może tego liczyć sama - i tego pilnujemy:
//      argumenty jadą do `resolveClubMinisiteAccess` w niezmienionej postaci.
//   4. MINISITE bierze wątki w porządku `hot` i UCINA je do siedmiu. Porządek
//      jest decyzją redakcyjną („o czym ten klub jest”, a nie „co wpadło
//      ostatnie”), a limit chroni stronę kuratorską od zamienienia się w listę.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ DOSTĘPU: `resolveClubMinisiteAccess` i `gateView` mają własne testy
//   na czystych funkcjach w `src/lib/clubs/__tests__/`. Tutaj dowodzimy, że
//   trasa je WOŁA z właściwymi argumentami i respektuje wynik.
// - NAGŁÓWKA: `clubHead.ts` ma własny zakres, a asercje idą przeciw
//   `buildClubHead` wywołanemu wprost - nie przeciw wymyślonym napisom.
// - ORGANIZMÓW `ClubHub`, `ClubMinisite`, `ClubAccessGate` i molekuły
//   `ClubErrorNotice`: to atrapy-markery, bo ich zachowanie należy do etapu
//   organizmów. Tutaj liczy się WYBÓR, który z nich trasa pokazuje.
// - AUTORYTETU: `can_read`, `my_status`, `visibility` pochodzą z SECURITY
//   DEFINER RPC i mają pgTAP. Trasa je czyta, nie liczy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { ClubThreadListRow, ClubViewRow } from "@/lib/clubs/types";

const h = vi.hoisted(() => ({
  club: null as unknown,
  clubPending: false,
  clubError: false,
  refetch: vi.fn(),
  session: null as { user: { id: string } } | null,
  isStaff: false,
  tierRank: null as number | null,
  invitations: [] as { club_id: string }[] | undefined,
  threadPages: [] as { rows: unknown[] }[] | undefined,
  threadsPending: false,
  /** Argumenty, z jakimi trasa zawołała `useClubThreads`. */
  threadArgs: null as Record<string, unknown> | null,
  /** Wejście przekazane do `resolveClubMinisiteAccess`. */
  accessInput: null as Record<string, unknown> | null,
  /** Wynik zwracany przez atrapę reguły dostępu. */
  accessResult: "member" as string,
  /** Propsy zapisane przez atrapy organizmów. */
  organism: {} as Record<string, Record<string, unknown>>,
  loaded: null as unknown,
  loaderFails: false,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.session,
    user: h.session?.user ?? null,
    isStaff: h.isStaff,
    loading: false,
  }),
}));
vi.mock("@/lib/billing/tiers", () => ({
  useCurrentTier: () => ({ data: h.tierRank === null ? null : { rank: h.tierRank } }),
}));
vi.mock("@/lib/clubs/publicClub", () => ({
  fetchClubBySlug: () => {
    if (h.loaderFails) return Promise.reject(new Error("club_view padło"));
    return Promise.resolve(h.loaded);
  },
}));
vi.mock("@/lib/clubs/useClubs", () => ({
  useClubBySlug: () => ({
    data: h.club,
    isPending: h.clubPending,
    isError: h.clubError,
    refetch: h.refetch,
  }),
  useClubThreads: (args: Record<string, unknown>) => {
    h.threadArgs = args;
    // `threadPages === undefined` odwzorowuje zapytanie W LOCIE: `data` jeszcze
    // nie istnieje, więc trasa musi wytrzymać `data?.pages ?? []`.
    return {
      data: h.threadPages === undefined ? undefined : { pages: h.threadPages },
      isPending: h.threadsPending,
    };
  },
  useMyClubInvitations: () => ({ data: h.invitations }),
}));
vi.mock("@/lib/clubs/minisiteAccess", () => ({
  resolveClubMinisiteAccess: (input: Record<string, unknown>) => {
    h.accessInput = input;
    return h.accessResult;
  },
}));

/** Atrapa organizmu: marker + zapis propsów. */
function organismStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.organism[name] = props;
    return <div data-testid={name} />;
  };
}

vi.mock("@/components/clubs/organisms/ClubHub", () => ({ ClubHub: organismStub("ClubHub") }));
vi.mock("@/components/clubs/organisms/ClubMinisite", () => ({
  ClubMinisite: organismStub("ClubMinisite"),
}));
vi.mock("@/components/clubs/organisms/ClubAccessGate", () => ({
  ClubAccessGate: organismStub("ClubAccessGate"),
}));
vi.mock("@/components/clubs/molecules/ClubErrorNotice", () => ({
  ClubErrorNotice: organismStub("ClubErrorNotice"),
}));
vi.mock("@/components/clubs/atoms/ClubSkeletons", () => ({
  ClubDetailSkeleton: () => <div data-testid="ClubDetailSkeleton" />,
}));

import { renderRoute, routeSearchValidator, type RouteMetaEntry } from "@/test/routeHarness";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { CLUB_IDS, clubThreadListRow, clubViewRow } from "@/test/clubs/fixtures";
import { Route as HubRoute } from "@/routes/club.$clubSlug.index";
import { Route as MinisiteRoute } from "@/routes/club.$clubSlug.minisite";

const SLUG = "klub-energetyczny";
const HUB_PATH = "/club/$clubSlug/";
const MINISITE_PATH = "/club/$clubSlug/minisite";

function robotsOf(meta: readonly RouteMetaEntry[]): string | null {
  const entry = meta.find((item) => item.name === "robots");
  return typeof entry?.content === "string" ? entry.content : null;
}

async function mountHub(entry: string = `/club/${SLUG}`) {
  return renderRoute({ route: HubRoute, path: HUB_PATH, initialEntry: entry });
}

async function mountMinisite() {
  return renderRoute({
    route: MinisiteRoute,
    path: MINISITE_PATH,
    initialEntry: `/club/${SLUG}/minisite`,
  });
}

function threadRows(count: number): ClubThreadListRow[] {
  return Array.from({ length: count }, (_unused, index) =>
    clubThreadListRow({ id: `thread-${index}`, slug: `temat-${index}`, title: `Temat ${index}` }),
  );
}

beforeEach(() => {
  cleanup();
  h.club = clubViewRow();
  h.clubPending = false;
  h.clubError = false;
  h.refetch.mockReset();
  h.session = { user: { id: CLUB_IDS.me } };
  h.isStaff = false;
  h.tierRank = 20;
  h.invitations = [];
  h.threadPages = [];
  h.threadsPending = false;
  h.threadArgs = null;
  h.accessInput = null;
  h.accessResult = "member";
  h.organism = {};
  h.loaded = clubViewRow();
  h.loaderFails = false;
});

// --- hub: kontrakt adresu --------------------------------------------------

describe("hub klubu - `?tag=` jako kontrakt linkowalnego widoku", () => {
  const validate = routeSearchValidator(HubRoute);

  it("przepuszcza tag i zachowuje go w adresie", async () => {
    const rendered = await mountHub(`/club/${SLUG}?tag=korytarz`);
    expect(rendered.search()).toEqual({ tag: "korytarz" });
  });

  it("brak tagu daje PUSTY obiekt, a nie `{ tag: undefined }`", () => {
    // `{ tag: undefined }` w adresie serializuje się jako `?tag=`, czyli
    // zawężenie do pustej frazy - a to nie to samo, co brak zawężenia.
    expect(validate({})).toEqual({});
  });

  it("PUSTY tag jest odrzucany - zawężenie do niczego to nie zawężenie", () => {
    expect(validate({ tag: "" })).toEqual({});
  });

  it.each([
    ["liczba", { tag: 42 }],
    ["tablica", { tag: ["a"] }],
    ["null", { tag: null }],
    ["obiekt", { tag: { value: "x" } }],
  ])("tag o złym typie (%s) jest odrzucany", (_label, raw) => {
    expect(validate(raw)).toEqual({});
  });

  it("tag jest OBCINANY do 50 znaków - adres nie jest kanałem na kilobajt tekstu", () => {
    const long = "a".repeat(120);
    const result = validate({ tag: long });
    expect(result).toEqual({ tag: "a".repeat(50) });
  });

  it("tag o DOKŁADNIE 50 znakach przechodzi bez obcięcia - granica należy do przepuszczonych", () => {
    const exact = "b".repeat(50);
    expect(validate({ tag: exact })).toEqual({ tag: exact });
  });

  it("parametry nadmiarowe są odcinane", () => {
    expect(validate({ tag: "korytarz", utm_source: "linkedin" })).toEqual({ tag: "korytarz" });
  });
});

// --- hub: loader i nagłówek ------------------------------------------------

describe("hub klubu - loader i indeksowalność", () => {
  it("loader dogrzewa cache pod `clubKeys.bySlug`", async () => {
    const { queryClient } = await mountHub();
    expect(queryClient.getQueryData(clubKeys.bySlug(SLUG))).not.toBeUndefined();
  });

  it("nagłówek zgadza się z `buildClubHead` na danych z loadera", async () => {
    const row = clubViewRow({ visibility: "public" });
    h.loaded = row;
    const rendered = await mountHub();
    const expected = buildClubHead({
      fallbackPath: `/club/${SLUG}`,
      club: toClubHeadSource(row),
    });
    expect(rendered.meta()).toEqual(expected.meta);
  });

  it("klub `public` JEST indeksowalny - to jedyna powierzchnia modułu z lejkiem", async () => {
    h.loaded = clubViewRow({ visibility: "public" });
    const rendered = await mountHub();
    expect(robotsOf(rendered.meta())).toBe("index, follow");
  });

  it.each(["members", "private", "secret"])(
    "klub `%s` nigdy nie jest indeksowalny",
    async (visibility) => {
      h.loaded = clubViewRow({ visibility });
      const rendered = await mountHub();
      expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
    },
  );

  it("awaria loadera schodzi na `noindex` i NIE wywala trasy", async () => {
    h.loaderFails = true;
    const rendered = await mountHub();
    expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
    expect(rendered.currentPath()).toBe(`/club/${SLUG}`);
  });
});

// --- hub: cztery stany karty klubu -----------------------------------------

describe("hub klubu - cztery stany karty klubu są ROZŁĄCZNE", () => {
  it("oczekiwanie rysuje szkielet o kształcie huba", async () => {
    h.clubPending = true;
    h.club = null;
    await mountHub();
    expect(screen.getByTestId("ClubDetailSkeleton")).toBeTruthy();
    expect(screen.queryByTestId("ClubHub")).toBeNull();
  });

  it("awaria RPC to NIE 404 - użytkownik dowiaduje się, że problem jest u nas", async () => {
    h.clubError = true;
    h.club = null;
    await mountHub();
    expect(screen.getByTestId("ClubErrorNotice")).toBeTruthy();
    expect(screen.queryByText("club.reason.not_found")).toBeNull();
  });

  it("komunikat awarii oferuje PONOWIENIE, a nie tylko informację", async () => {
    h.clubError = true;
    h.club = null;
    await mountHub();
    const onRetry = h.organism.ClubErrorNotice.onRetry;
    expect(typeof onRetry).toBe("function");
    if (typeof onRetry === "function") onRetry();
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("zero wierszy to 404 - klub `secret` bez dostępu nie zdradza, że istnieje", async () => {
    h.club = null;
    await mountHub();
    expect(screen.getByText("club.reason.not_found")).toBeTruthy();
    expect(screen.queryByTestId("ClubErrorNotice")).toBeNull();
    expect(screen.queryByTestId("ClubAccessGate")).toBeNull();
    // Droga powrotna do katalogu musi być, inaczej 404 jest ślepym zaułkiem.
    expect(screen.getByRole("link", { name: "club.title" }).getAttribute("href")).toBe("/club");
  });

  it("`can_read = false` pokazuje BRAMKĘ z wartością klubu, nie pustą listę", async () => {
    const club = clubViewRow({ can_read: false });
    h.club = club;
    await mountHub();
    expect(screen.getByTestId("ClubAccessGate")).toBeTruthy();
    expect(h.organism.ClubAccessGate.club).toBe(club);
    expect(screen.queryByTestId("ClubHub")).toBeNull();
  });

  it("`can_read = true` oddaje stronę hubowi i przekazuje mu KARTĘ klubu", async () => {
    const club = clubViewRow({ can_read: true });
    h.club = club;
    await mountHub();
    expect(screen.getByTestId("ClubHub")).toBeTruthy();
    expect(h.organism.ClubHub.club).toBe(club);
    expect(screen.queryByTestId("ClubAccessGate")).toBeNull();
  });

  it("oczekiwanie WYPRZEDZA awarię - kolejność warunków w trasie ma znaczenie", async () => {
    // Gdyby awaria była sprawdzana pierwsza, każde odświeżenie w tle mrugałoby
    // komunikatem błędu na ekranie, który już ma dane.
    h.clubPending = true;
    h.clubError = true;
    h.club = null;
    await mountHub();
    expect(screen.getByTestId("ClubDetailSkeleton")).toBeTruthy();
    expect(screen.queryByTestId("ClubErrorNotice")).toBeNull();
  });
});

// --- minisite --------------------------------------------------------------

describe("minisite - poziom dostępu liczony z czterech źródeł", () => {
  it("nagłówek WYMUSZA `noindex` także w klubie `public`", async () => {
    // Minisite pokazuje FRAGMENTY wypowiedzi, a nie katalog tytułów. W klubie
    // z regułą Chatham House to jest dokładnie ta treść, której nie wolno
    // wystawić robotowi.
    h.loaded = clubViewRow({ visibility: "public" });
    const rendered = await mountMinisite();
    expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
  });

  it("nagłówek zgadza się z `buildClubHead` z `forceNoindex`", async () => {
    const row = clubViewRow({ visibility: "public" });
    h.loaded = row;
    const rendered = await mountMinisite();
    const expected = buildClubHead({
      fallbackPath: `/club/${SLUG}/minisite`,
      club: toClubHeadSource(row),
      forceNoindex: true,
    });
    expect(rendered.meta()).toEqual(expected.meta);
  });

  it("gość dostaje ekran „tylko dla członków” i NIE dochodzi do reguły dostępu", async () => {
    h.session = null;
    await mountMinisite();
    expect(screen.getByText("club.membersOnlyTitle")).toBeTruthy();
    expect(screen.getByText("club.membersOnlyBody")).toBeTruthy();
    expect(h.accessInput).toBeNull();
    expect(screen.queryByTestId("ClubMinisite")).toBeNull();
  });

  it("oczekiwanie na kartę klubu rysuje szkielet o proporcjach okładki", async () => {
    h.clubPending = true;
    h.club = null;
    const { container } = await mountMinisite();
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByTestId("ClubMinisite")).toBeNull();
  });

  it("brak klubu daje 404 z drogą powrotną do katalogu", async () => {
    h.club = null;
    await mountMinisite();
    expect(screen.getByText("club.notFoundTitle")).toBeTruthy();
    expect(screen.getByRole("link", { name: "club.backToHub" }).getAttribute("href")).toBe("/club");
  });

  it("przekazuje regule dostępu WSZYSTKIE pięć wejść w niezmienionej postaci", async () => {
    const club = clubViewRow({ can_read: true, my_status: "pending" });
    h.club = club;
    h.isStaff = true;
    h.tierRank = 40;
    h.invitations = [{ club_id: CLUB_IDS.club }];
    await mountMinisite();
    expect(h.accessInput).toEqual({
      canRead: true,
      myStatus: "pending",
      hasInvitation: true,
      tierRank: 40,
      isStaff: true,
    });
  });

  it("zaproszenie do INNEGO klubu nie liczy się jako zaproszenie do tego", async () => {
    // Najczęstsza pomyłka w tym miejscu: `invitations.length > 0` zamiast
    // dopasowania po `club_id`. Skutek jest gorszy niż wygląda - jedno
    // zaproszenie otwierałoby minisite'y wszystkich klubów.
    h.invitations = [{ club_id: CLUB_IDS.otherClub }];
    await mountMinisite();
    expect(h.accessInput?.hasInvitation).toBe(false);
  });

  it("brak danych warstwy jedzie do reguły jako `null`, nie jako `0`", async () => {
    // `0` znaczy „warstwa darmowa”, a `null` - „nie wiem”. Zamiana pierwszego
    // na drugie dawałaby odmowę zamiast oczekiwania na odpowiedź.
    h.tierRank = null;
    await mountMinisite();
    expect(h.accessInput?.tierRank).toBeNull();
  });

  it("wynik reguły jedzie do organizmu BEZ przeróbki", async () => {
    h.accessResult = "locked";
    await mountMinisite();
    expect(h.organism.ClubMinisite.access).toBe("locked");
  });

  it("bierze wątki w porządku `hot` dla ID TEGO klubu", async () => {
    // Porządek jest decyzją redakcyjną: minisite ma pokazać, o czym ten klub
    // JEST, a nie co wpadło ostatnie.
    await mountMinisite();
    expect(h.threadArgs).toEqual({ clubId: CLUB_IDS.club, sort: "hot" });
  });

  it("bez karty klubu nie prosi o wątki nieistniejącego identyfikatora", async () => {
    h.club = null;
    await mountMinisite();
    expect(h.threadArgs).toEqual({ clubId: undefined, sort: "hot" });
  });

  it("UCINA strumień do siedmiu wątków, choćby stron było wiele", async () => {
    h.threadPages = [{ rows: threadRows(5) }, { rows: threadRows(5) }];
    await mountMinisite();
    const threads = h.organism.ClubMinisite.threads;
    expect(Array.isArray(threads)).toBe(true);
    expect(Array.isArray(threads) ? threads.length : -1).toBe(7);
  });

  it("mniej niż siedem wątków przechodzi w całości", async () => {
    h.threadPages = [{ rows: threadRows(3) }];
    await mountMinisite();
    const threads = h.organism.ClubMinisite.threads;
    expect(Array.isArray(threads) ? threads.length : -1).toBe(3);
  });

  it("brak stron wątków daje pustą listę, a nie wyjątek", async () => {
    h.threadPages = [];
    await mountMinisite();
    expect(h.organism.ClubMinisite.threads).toEqual([]);
  });

  it("zapytanie o wątki JESZCZE W LOCIE daje pustą listę, a nie wyjątek", async () => {
    // `data` nie istnieje przy pierwszym renderze; bez `?? []` strona wywalałaby
    // się na `.flatMap` zanim ktokolwiek zobaczy okładkę.
    h.threadPages = undefined;
    await mountMinisite();
    expect(h.organism.ClubMinisite.threads).toEqual([]);
  });

  it("zapytanie o zaproszenia JESZCZE W LOCIE nie liczy się jako zaproszenie", async () => {
    h.invitations = undefined;
    await mountMinisite();
    expect(h.accessInput?.hasInvitation).toBe(false);
  });

  it("awaria loadera minisite NIE wywala trasy i daje nagłówek bez nazwy klubu", async () => {
    h.loaderFails = true;
    const rendered = await mountMinisite();
    expect(rendered.currentPath()).toBe(`/club/${SLUG}/minisite`);
    expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
  });

  it("brak wiersza `club_view` w loaderze daje nagłówek zastępczy", async () => {
    h.loaded = null;
    const rendered = await mountMinisite();
    const expected = buildClubHead({
      fallbackPath: `/club/${SLUG}/minisite`,
      club: null,
      forceNoindex: true,
    });
    expect(rendered.meta()).toEqual(expected.meta);
  });

  it("stan oczekiwania na wątki jedzie do organizmu jako `loading`", async () => {
    h.threadsPending = true;
    await mountMinisite();
    expect(h.organism.ClubMinisite.loading).toBe(true);
  });

  it("karta klubu jedzie do organizmu w niezmienionej postaci", async () => {
    const club: ClubViewRow = clubViewRow({ can_read: true });
    h.club = club;
    await mountMinisite();
    expect(h.organism.ClubMinisite.club).toBe(club);
  });
});
