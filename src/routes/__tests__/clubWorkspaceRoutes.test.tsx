// Osiem powierzchni roboczych klubu (`/club/$clubSlug/...`) ZAMONTOWANYCH.
//
// CO TEN PLIK DOWODZI. Te trasy są celowo bliźniacze: każda robi dokładnie
// trzy rzeczy - dogrzewa cache karty klubu w loaderze, liczy z niej nagłówek
// SEO i wsuwa jeden organizm do wspólnej powłoki. Wartość testu leży więc nie
// w renderze (organizmy mają własne testy), a w SKLEJENIU, którego czysta
// funkcja nie dosięga:
//
//   1. LOADER dogrzewa cache pod DOKŁADNIE tym kluczem, z którego czyta
//      komponent (`clubKeys.bySlug`). Rozjazd = drugi odczyt RPC przy hydracji
//      i mrugnięcie szkieletem na każdym wejściu.
//   2. LOADER NIE WYWALA TRASY przy awarii RPC (`.catch(() => null)`): strona
//      ma pokazać powłokę, a nie ekran błędu routera.
//   3. `head()` liczy indeksowalność Z WIDOCZNOŚCI KLUBU, nie z trasy - i to
//      jest reguła bezpieczeństwa, nie SEO-kosmetyka. Osiem tras dzieli się na
//      dwie grupy: kalendarz/harmonogram/biblioteka są indeksowalne w klubie
//      `public`, a tablica/eksperci/spotkanie/wyróżnienie/pomiar mają
//      `forceNoindex` BEZWARUNKOWO, bo wypisują ludzi z nazwiska. Pomyłka
//      w tę drugą stronę wypuszcza skład klubu zamkniętego do indeksu, skąd
//      usuwa się go tygodniami.
//   4. RENDER-PROP powłoki dostaje kartę klubu i przekazuje organizmowi
//      WŁAŚCIWE uprawnienia. To najgęstsze miejsce na błąd w całym pliku:
//      `canPost`, `canRsvp`, `canDeclare` i `canSeeMembers` są koniunkcją
//      sesji i pola z RPC, a przeklejona nazwa pola przechodzi przez `tsc`.
//
// JAK, ŻEBY TO NIE BYŁA FARMA POKRYCIA. Asercje nagłówka idą PRZECIW
// `buildClubHead` wywołanemu wprost na tych samych danych - nie przeciw
// wymyślonym napisom. Test nie może więc „przejść” przez zapisanie w nim
// tego, co kod robi dziś: gdy zmieni się doktryna nagłówka, oba wyniki zmienią
// się razem, a gdy zmieni się WYWOŁANIE w trasie (zgubiony `forceNoindex`,
// zła ścieżka fallbacku) - test pada.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ NAGŁÓWKA: `clubHead.ts` (`isClubIndexable`, polityka pustki, tytuł
//   podrzędny) ma własny zakres w `src/lib/clubs/__tests__/`.
// - POWŁOKI `ClubWorkspaceLayout`: jej pięć stanów (oczekiwanie, awaria RPC,
//   404, brak dostępu, treść) to organizm i jego własny test. Tutaj powłoka
//   jest ATRAPĄ, która woła `children(club)` - bo przedmiotem dowodu jest to,
//   CO trasa przez ten render-prop przekazuje.
// - ORGANIZMÓW: `ClubCalendar`, `ClubSchedule`, `ClubDocumentLibrary`,
//   `ClubInsights`, `ClubBoardScreen`, `ClubExpertsScreen`,
//   `ClubMeetingScreen`, `ClubSpotlightScreen` są tu markerami z zapisanymi
//   propsami; ich zachowanie należy do etapu organizmów.
// - AUTORYTETU DOSTĘPU: `can_read`, `can_reply`, `can_see_members` pochodzą
//   z SECURITY DEFINER RPC i mają pgTAP. Trasa ich nie liczy - ona je CZYTA,
//   i tego dowodzimy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClubViewRow } from "@/lib/clubs/types";

const h = vi.hoisted(() => ({
  /** Karta klubu wystawiana render-propowi powłoki. */
  club: null as unknown,
  /** Sesja widziana przez `useAuth` - `null` znaczy gość. */
  session: null as { user: { id: string } } | null,
  /** Odpowiedź `club_view` dla loadera; `null` = brak wiersza. */
  loaded: null as unknown,
  /** Gdy prawdziwe, `fetchClubBySlug` rzuca - awaria RPC w loaderze. */
  loaderFails: false,
  /** Ile razy loader poszedł do warstwy danych. */
  fetchCalls: 0,
  /** Propsy zapisane przez atrapę powłoki. */
  shell: null as { clubSlug: string; title: string; lead?: string } | null,
  /** Propsy zapisane przez atrapy organizmów, per nazwa. */
  organism: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.session, user: h.session?.user ?? null, isStaff: false }),
}));
vi.mock("@/lib/clubs/publicClub", () => ({
  fetchClubBySlug: () => {
    h.fetchCalls += 1;
    if (h.loaderFails) return Promise.reject(new Error("club_view padło"));
    return Promise.resolve(h.loaded);
  },
}));

// Atrapa powłoki: zapisuje propsy i WOŁA render-prop kartą klubu. Bez tego
// wywołania funkcje przekazujące uprawnienia organizmom nie wykonują się nigdy
// - a właśnie one są tu przedmiotem dowodu.
vi.mock("@/components/clubs/organisms/ClubWorkspaceLayout", () => ({
  ClubWorkspaceLayout: ({
    clubSlug,
    title,
    lead,
    children,
  }: {
    clubSlug: string;
    title: string;
    lead?: string;
    children: (club: ClubViewRow) => ReactNode;
  }) => {
    h.shell = { clubSlug, title, lead };
    const club = h.club;
    return (
      <div data-testid="shell" data-title={title} data-lead={lead ?? ""} data-slug={clubSlug}>
        {club === null ? null : children(club as ClubViewRow)}
      </div>
    );
  },
}));

/** Atrapa organizmu: marker w DOM-ie + zapis propsów pod jego nazwą. */
function organismStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.organism[name] = props;
    return <div data-testid={name} />;
  };
}

vi.mock("@/components/clubs/organisms/ClubCalendar", () => ({
  ClubCalendar: organismStub("ClubCalendar"),
}));
vi.mock("@/components/clubs/organisms/ClubSchedule", () => ({
  ClubSchedule: organismStub("ClubSchedule"),
}));
vi.mock("@/components/clubs/organisms/ClubDocumentLibrary", () => ({
  ClubDocumentLibrary: organismStub("ClubDocumentLibrary"),
}));
vi.mock("@/components/clubs/organisms/ClubInsights", () => ({
  ClubInsights: organismStub("ClubInsights"),
}));
vi.mock("@/components/clubs/organisms/ClubBoardScreen", () => ({
  ClubBoardScreen: organismStub("ClubBoardScreen"),
}));
vi.mock("@/components/clubs/organisms/ClubExpertsScreen", () => ({
  ClubExpertsScreen: organismStub("ClubExpertsScreen"),
}));
vi.mock("@/components/clubs/organisms/ClubMeetingScreen", () => ({
  ClubMeetingScreen: organismStub("ClubMeetingScreen"),
}));
vi.mock("@/components/clubs/organisms/ClubSpotlightScreen", () => ({
  ClubSpotlightScreen: organismStub("ClubSpotlightScreen"),
}));

import { renderRoute, type RouteMetaEntry } from "@/test/routeHarness";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { clubViewRow, CLUB_IDS } from "@/test/clubs/fixtures";
import { Route as BoardRoute } from "@/routes/club.$clubSlug.board";
import { Route as CalendarRoute } from "@/routes/club.$clubSlug.calendar";
import { Route as DocumentsRoute } from "@/routes/club.$clubSlug.documents";
import { Route as ExpertsRoute } from "@/routes/club.$clubSlug.experts";
import { Route as InsightsRoute } from "@/routes/club.$clubSlug.insights";
import { Route as ScheduleRoute } from "@/routes/club.$clubSlug.schedule";
import { Route as SpotlightRoute } from "@/routes/club.$clubSlug.spotlight";
import { Route as MeetingRoute } from "@/routes/club.$clubSlug.e.$eventSlug";

const SLUG = "klub-energetyczny";
const EVENT = "posiedzenie-marcowe";

interface Powierzchnia {
  readonly nazwa: string;
  /** Trasa pliku - dokładnie ten sam obiekt, co w drzewie tras. */
  readonly route: Parameters<typeof renderRoute>[0]["route"];
  /** Wzorzec ścieżki, tak jak w `routeTree.gen.ts`. */
  readonly path: string;
  /** Adres startowy historii pamięciowej. */
  readonly entry: string;
  /** Ścieżka, którą trasa podaje `buildClubHead` jako fallback. */
  readonly fallbackPath: string;
  /** Marker organizmu, który ta trasa wsuwa do powłoki. */
  readonly organism: string;
  /** Czy nagłówek wymusza `noindex` niezależnie od widoczności klubu. */
  readonly forceNoindex: boolean;
  /** Klucz i18n tytułu powierzchni. */
  readonly titleKey: string;
  /** Klucz i18n zajawki powierzchni. */
  readonly leadKey: string;
}

const POWIERZCHNIE: readonly Powierzchnia[] = [
  {
    nazwa: "kalendarz",
    route: CalendarRoute,
    path: "/club/$clubSlug/calendar",
    entry: `/club/${SLUG}/calendar`,
    fallbackPath: `/club/${SLUG}/calendar`,
    organism: "ClubCalendar",
    forceNoindex: false,
    titleKey: "club.calendar.title",
    leadKey: "club.calendar.lead",
  },
  {
    nazwa: "harmonogram",
    route: ScheduleRoute,
    path: "/club/$clubSlug/schedule",
    entry: `/club/${SLUG}/schedule`,
    fallbackPath: `/club/${SLUG}/schedule`,
    organism: "ClubSchedule",
    forceNoindex: false,
    titleKey: "club.schedule.title",
    leadKey: "club.schedule.lead",
  },
  {
    nazwa: "biblioteka",
    route: DocumentsRoute,
    path: "/club/$clubSlug/documents",
    entry: `/club/${SLUG}/documents`,
    fallbackPath: `/club/${SLUG}/documents`,
    organism: "ClubDocumentLibrary",
    forceNoindex: false,
    titleKey: "club.docs.title",
    leadKey: "club.docs.lead",
  },
  {
    nazwa: "pomiar",
    route: InsightsRoute,
    path: "/club/$clubSlug/insights",
    entry: `/club/${SLUG}/insights`,
    fallbackPath: `/club/${SLUG}/insights`,
    organism: "ClubInsights",
    forceNoindex: true,
    titleKey: "club.insights.title",
    leadKey: "club.insights.lead",
  },
  {
    nazwa: "tablica ogłoszeń",
    route: BoardRoute,
    path: "/club/$clubSlug/board",
    entry: `/club/${SLUG}/board`,
    fallbackPath: `/club/${SLUG}/board`,
    organism: "ClubBoardScreen",
    forceNoindex: true,
    titleKey: "club.network.board.title",
    leadKey: "club.network.board.lead",
  },
  {
    nazwa: "eksperci",
    route: ExpertsRoute,
    path: "/club/$clubSlug/experts",
    entry: `/club/${SLUG}/experts`,
    fallbackPath: `/club/${SLUG}/experts`,
    organism: "ClubExpertsScreen",
    forceNoindex: true,
    titleKey: "club.network.experts.pageTitle",
    leadKey: "club.network.experts.lead",
  },
  {
    nazwa: "wyróżnienie członka",
    route: SpotlightRoute,
    path: "/club/$clubSlug/spotlight",
    entry: `/club/${SLUG}/spotlight`,
    fallbackPath: `/club/${SLUG}/spotlight`,
    organism: "ClubSpotlightScreen",
    forceNoindex: true,
    titleKey: "club.network.spotlight.title",
    leadKey: "club.network.spotlight.lead",
  },
  {
    nazwa: "spotkanie",
    route: MeetingRoute,
    path: "/club/$clubSlug/e/$eventSlug",
    entry: `/club/${SLUG}/e/${EVENT}`,
    fallbackPath: `/club/${SLUG}/e/${EVENT}`,
    organism: "ClubMeetingScreen",
    forceNoindex: true,
    titleKey: "club.network.meeting.pageTitle",
    leadKey: "club.network.meeting.lead",
  },
];

/** Wartość nagłówka `robots` z listy `meta` - `null`, gdy nagłówka nie ma. */
function robotsOf(meta: readonly RouteMetaEntry[]): string | null {
  const entry = meta.find((item) => item.name === "robots");
  return typeof entry?.content === "string" ? entry.content : null;
}

function titleOf(meta: readonly RouteMetaEntry[]): string | null {
  const entry = meta.find((item) => typeof item.title === "string");
  return typeof entry?.title === "string" ? entry.title : null;
}

async function mount(surface: Powierzchnia) {
  return renderRoute({ route: surface.route, path: surface.path, initialEntry: surface.entry });
}

beforeEach(() => {
  cleanup();
  h.club = clubViewRow();
  h.session = { user: { id: CLUB_IDS.me } };
  h.loaded = clubViewRow();
  h.loaderFails = false;
  h.fetchCalls = 0;
  h.shell = null;
  h.organism = {};
});

// --- loader ----------------------------------------------------------------

describe("loader - dogrzewa cache pod kluczem, z którego czyta komponent", () => {
  it.each(POWIERZCHNIE)(
    "$nazwa: loader zapisuje kartę klubu pod `clubKeys.bySlug`",
    async (surface) => {
      // Rozjazd klucza jest niewidoczny na ekranie: strona się rysuje, tylko
      // płaci drugim round-tripem do RPC przy każdym wejściu.
      const { queryClient } = await mount(surface);
      expect(h.fetchCalls).toBe(1);
      expect(queryClient.getQueryData(clubKeys.bySlug(SLUG))).not.toBeUndefined();
    },
  );

  it.each(POWIERZCHNIE)("$nazwa: awaria RPC NIE wywala trasy", async (surface) => {
    // `.catch(() => null)` w loaderze: użytkownik z poprawnym linkiem ma
    // zobaczyć powłokę i komunikat powłoki, a nie ekran błędu routera.
    h.loaderFails = true;
    const rendered = await mount(surface);
    expect(rendered.currentPath()).toBe(surface.entry);
    expect(screen.getByTestId("shell")).toBeTruthy();
  });

  it.each(POWIERZCHNIE)(
    "$nazwa: brak wiersza `club_view` też nie wywala trasy",
    async (surface) => {
      h.loaded = null;
      const rendered = await mount(surface);
      expect(rendered.currentPath()).toBe(surface.entry);
    },
  );

  it("loader czyta slug Z PARAMETRU, a nie ze stałej", async () => {
    // Przeklejony literał w `queryFn` dawałby kartę INNEGO klubu przy każdym
    // wejściu - i to jest błąd, którego nie widać na jednym slugu w teście.
    const { queryClient } = await renderRoute({
      route: CalendarRoute,
      path: "/club/$clubSlug/calendar",
      initialEntry: "/club/inny-klub/calendar",
    });
    expect(queryClient.getQueryData(clubKeys.bySlug("inny-klub"))).not.toBeUndefined();
    expect(queryClient.getQueryData(clubKeys.bySlug(SLUG))).toBeUndefined();
  });
});

// --- nagłówek SEO ----------------------------------------------------------

describe("head() - indeksowalność liczy się z WIDOCZNOŚCI klubu", () => {
  it.each(POWIERZCHNIE)(
    "$nazwa: nagłówek zgadza się z `buildClubHead` na tych samych danych",
    async (surface) => {
      const row = clubViewRow({ visibility: "public" });
      h.loaded = row;
      const rendered = await mount(surface);
      const expected = buildClubHead({
        fallbackPath: surface.fallbackPath,
        club: toClubHeadSource(row),
        ...(surface.forceNoindex ? { forceNoindex: true } : {}),
      });
      expect(rendered.meta()).toEqual(expected.meta);
    },
  );

  const INDEKSOWALNE = POWIERZCHNIE.filter((surface) => !surface.forceNoindex);
  const NIGDY_INDEKSOWALNE = POWIERZCHNIE.filter((surface) => surface.forceNoindex);

  it("kanarek podziału: obie grupy są NIEPUSTE", () => {
    // Bez tego test poniżej mógłby cicho zrobić się pusty po zmianie tabeli.
    expect(INDEKSOWALNE.length).toBeGreaterThan(0);
    expect(NIGDY_INDEKSOWALNE.length).toBeGreaterThan(0);
  });

  it.each(INDEKSOWALNE)("$nazwa klubu `public` JEST indeksowalna", async (surface) => {
    h.loaded = clubViewRow({ visibility: "public" });
    const rendered = await mount(surface);
    expect(robotsOf(rendered.meta())).toBe("index, follow");
  });

  it.each(NIGDY_INDEKSOWALNE)(
    "$nazwa NIE jest indeksowalna nawet w klubie `public`",
    async (surface) => {
      // Te powierzchnie wypisują ludzi z nazwiska (tablica, eksperci, obecność
      // na spotkaniu, wyróżnienie) albo są narzędziem prowadzenia (pomiar).
      // `forceNoindex` jest tu regułą, nie preferencją.
      h.loaded = clubViewRow({ visibility: "public" });
      const rendered = await mount(surface);
      expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
    },
  );

  it.each(POWIERZCHNIE)("$nazwa klubu zamkniętego nigdy nie jest indeksowalna", async (surface) => {
    h.loaded = clubViewRow({ visibility: "members" });
    const rendered = await mount(surface);
    expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
  });

  it.each(POWIERZCHNIE)("$nazwa przy AWARII loadera schodzi na `noindex`", async (surface) => {
    // Bezpieczny domysł: brak odpowiedzi nie może dać indeksu. Błąd w tę
    // stronę kosztuje ruch, w drugą - wyciek nazwy klubu zamkniętego.
    h.loaderFails = true;
    const rendered = await mount(surface);
    expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
  });

  it.each(POWIERZCHNIE)("$nazwa ma tytuł także wtedy, gdy loader milczy", async (surface) => {
    h.loaded = null;
    const rendered = await mount(surface);
    expect(titleOf(rendered.meta())).not.toBeNull();
    expect(titleOf(rendered.meta())).not.toBe("");
  });

  it.each(POWIERZCHNIE)(
    "$nazwa niesie NAZWĘ klubu w tytule, gdy loader dowiózł",
    async (surface) => {
      h.loaded = clubViewRow({ name_pl: "Klub korytarzowy", name_en: "Corridor club" });
      const rendered = await mount(surface);
      expect(titleOf(rendered.meta())).toContain("Klub korytarzowy");
    },
  );

  it("`fallbackPath` różni się MIĘDZY trasami - to on jest kanonicznym adresem", () => {
    const paths = POWIERZCHNIE.map((surface) => surface.fallbackPath);
    expect(new Set(paths).size).toBe(POWIERZCHNIE.length);
  });
});

// --- powłoka i render-prop -------------------------------------------------

describe("powłoka - tytuł, zajawka i slug idą z trasy", () => {
  it.each(POWIERZCHNIE)("$nazwa podaje powłoce swój klucz tytułu i zajawki", async (surface) => {
    await mount(surface);
    expect(h.shell?.title).toBe(surface.titleKey);
    expect(h.shell?.lead).toBe(surface.leadKey);
    expect(h.shell?.clubSlug).toBe(SLUG);
  });

  it("tytuły powierzchni są RÓŻNE - osiem stron nie może mieć jednej nazwy", () => {
    const titles = POWIERZCHNIE.map((surface) => surface.titleKey);
    expect(new Set(titles).size).toBe(POWIERZCHNIE.length);
  });

  it.each(POWIERZCHNIE)("$nazwa wsuwa DOKŁADNIE swój organizm", async (surface) => {
    await mount(surface);
    expect(screen.getByTestId(surface.organism)).toBeTruthy();
    const inne = POWIERZCHNIE.filter((other) => other.organism !== surface.organism);
    for (const other of inne) {
      expect(screen.queryByTestId(other.organism)).toBeNull();
    }
  });

  it.each(POWIERZCHNIE)(
    "$nazwa: gdy powłoka nie dowiozła karty klubu, organizm się NIE renderuje",
    async (surface) => {
      // Odpowiednik stanu „404 / brak dostępu” w powłoce: render-prop nie jest
      // wołany, więc organizm nie może pukać do RPC klubu, którego nie ma.
      h.club = null;
      await mount(surface);
      expect(screen.queryByTestId(surface.organism)).toBeNull();
    },
  );

  it("slug z adresu przechodzi do powłoki bez zmian, także niestandardowy", async () => {
    await renderRoute({
      route: DocumentsRoute,
      path: "/club/$clubSlug/documents",
      initialEntry: "/club/klub-2026-A/documents",
    });
    expect(h.shell?.clubSlug).toBe("klub-2026-A");
  });
});

// --- uprawnienia przekazywane organizmom -----------------------------------

describe("uprawnienia organizmów - koniunkcja sesji i pola z RPC", () => {
  it("kalendarz dostaje `canManage` z karty klubu, nie z sesji", async () => {
    h.club = clubViewRow({ can_manage: true });
    await mount(POWIERZCHNIE[0]);
    expect(h.organism.ClubCalendar).toMatchObject({
      clubId: CLUB_IDS.club,
      clubSlug: SLUG,
      canManage: true,
    });
  });

  it("kalendarz bez prawa zarządzania nie obiecuje akcji zarządczych", async () => {
    h.club = clubViewRow({ can_manage: false });
    await mount(POWIERZCHNIE[0]);
    expect(h.organism.ClubCalendar.canManage).toBe(false);
  });

  it("harmonogram dostaje identyfikator i slug klubu", async () => {
    await mount(POWIERZCHNIE[1]);
    expect(h.organism.ClubSchedule).toMatchObject({ clubId: CLUB_IDS.club, clubSlug: SLUG });
  });

  it("biblioteka dostaje identyfikator i slug klubu", async () => {
    await mount(POWIERZCHNIE[2]);
    expect(h.organism.ClubDocumentLibrary).toMatchObject({
      clubId: CLUB_IDS.club,
      clubSlug: SLUG,
    });
  });

  it("pomiar dostaje WYŁĄCZNIE identyfikator - nie ma tam czego robić uprawnieniami", async () => {
    await mount(POWIERZCHNIE[3]);
    expect(h.organism.ClubInsights).toEqual({ clubId: CLUB_IDS.club });
  });

  it("wyróżnienie członka dostaje `canModerate` sprowadzone do wartości logicznej", async () => {
    h.club = clubViewRow({ can_moderate: true });
    await mount(POWIERZCHNIE[6]);
    expect(h.organism.ClubSpotlightScreen).toEqual({ clubId: CLUB_IDS.club, canModerate: true });
  });

  it("wyróżnienie członka bez moderacji nie pokazuje narzędzi redakcyjnych", async () => {
    h.club = clubViewRow({ can_moderate: false });
    await mount(POWIERZCHNIE[6]);
    expect(h.organism.ClubSpotlightScreen.canModerate).toBe(false);
  });

  const KONIUNKCJE: readonly {
    readonly nazwa: string;
    readonly indeks: number;
    readonly organism: string;
    readonly prop: string;
  }[] = [
    { nazwa: "tablica ogłoszeń", indeks: 4, organism: "ClubBoardScreen", prop: "canPost" },
    { nazwa: "eksperci", indeks: 5, organism: "ClubExpertsScreen", prop: "canDeclare" },
    { nazwa: "spotkanie", indeks: 7, organism: "ClubMeetingScreen", prop: "canRsvp" },
  ];

  it.each(KONIUNKCJE)(
    "$nazwa: $prop wymaga JEDNOCZEŚNIE sesji i `can_reply`",
    async ({ indeks, organism, prop }) => {
      // Sama sesja nie wystarcza (obserwator klubu nie pisze), samo
      // `can_reply` też nie (RPC dla `anon` jest zamknięte). Tabela sprawdza
      // wszystkie cztery kombinacje - pojedynczy przypadek przechodzi także
      // dla zwykłego `||`.
      const surface = POWIERZCHNIE[indeks];

      h.session = { user: { id: CLUB_IDS.me } };
      h.club = clubViewRow({ can_reply: true });
      await mount(surface);
      expect(h.organism[organism][prop]).toBe(true);
      cleanup();

      h.session = null;
      h.club = clubViewRow({ can_reply: true });
      await mount(surface);
      expect(h.organism[organism][prop]).toBe(false);
      cleanup();

      h.session = { user: { id: CLUB_IDS.me } };
      h.club = clubViewRow({ can_reply: false });
      await mount(surface);
      expect(h.organism[organism][prop]).toBe(false);
      cleanup();

      h.session = null;
      h.club = clubViewRow({ can_reply: false });
      await mount(surface);
      expect(h.organism[organism][prop]).toBe(false);
    },
  );

  it("eksperci dostają LOKALIZACJĘ, nie surowy kod języka", async () => {
    await mount(POWIERZCHNIE[5]);
    expect(typeof h.organism.ClubExpertsScreen.locale).toBe("string");
    expect(h.organism.ClubExpertsScreen.locale).not.toBe("");
  });

  it("spotkanie dostaje slug wydarzenia Z ADRESU", async () => {
    await mount(POWIERZCHNIE[7]);
    expect(h.organism.ClubMeetingScreen).toMatchObject({
      clubId: CLUB_IDS.club,
      clubSlug: SLUG,
      eventSlug: EVENT,
    });
  });

  it("spotkanie: `canSeeMembers` wymaga SESJI, choć `can_see_members` przepuszcza gościa", async () => {
    // To jest defekt naprawiony w kodzie i opisany w nagłówku trasy:
    // `can_see_members` w bazie równa się `can_read`, więc w klubie `public`
    // przepuszcza także niezalogowanego - a RPC z nazwiskami jest dla `anon`
    // zamknięte. Bez koniunkcji strona dostawała 42501 i KŁAMAŁA, że nikt nie
    // potwierdził obecności.
    h.session = null;
    h.club = clubViewRow({ can_see_members: true });
    await mount(POWIERZCHNIE[7]);
    expect(h.organism.ClubMeetingScreen.canSeeMembers).toBe(false);
    cleanup();

    h.session = { user: { id: CLUB_IDS.me } };
    h.club = clubViewRow({ can_see_members: true });
    await mount(POWIERZCHNIE[7]);
    expect(h.organism.ClubMeetingScreen.canSeeMembers).toBe(true);
    cleanup();

    h.session = { user: { id: CLUB_IDS.me } };
    h.club = clubViewRow({ can_see_members: false });
    await mount(POWIERZCHNIE[7]);
    expect(h.organism.ClubMeetingScreen.canSeeMembers).toBe(false);
  });
});
