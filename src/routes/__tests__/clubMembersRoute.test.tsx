// Trasa `/club/$clubSlug/members` - SKŁAD KLUBU, czyli odpowiedź na pytanie
// „z kim ja tu właściwie deliberuję”.
//
// CO TEN PLIK DOWODZI. Trasa składu jest jedynym konsumentem uprawnienia
// `club_capabilities.can_see_members` w całym produkcie, więc jej pomyłki nie są
// kosmetyczne. Pilnujemy pięciu rzeczy, których nie widać na ekranie:
//
//   1. NAGŁÓWEK: skład jest `noindex` BEZWARUNKOWO, także w klubie `public` -
//      nazwiska członków nie są treścią, która ma trafiać do wyszukiwarki (ta
//      sama doktryna, co /people). Asercja idzie przeciw `buildClubHead`
//      wywołanemu wprost, nie przeciw wymyślonym napisom.
//   2. BRAMKA: brak uprawnienia wyłącza ZAPYTANIE, a nie tylko widok. Klub,
//      który ukrywa skład, nie ma prawa wysłać listy nazwisk do przeglądarki
//      i schować jej stylem - dlatego sprawdzamy argumenty OBU zapytań
//      (`clubId: undefined`), a nie sam komunikat.
//   3. KONTRAKT PAGINACJI: lista pyta o `status: "active"` i o jedną stronę 60
//      osób, a `total_count` (jedzie w KAŻDYM wierszu z window function) decyduje
//      o komunikacie o ucięciu. Milcząca różnica między nagłówkiem (pełny
//      licznik z denormalizacji) a listą wygląda jak brak osób.
//   4. SKŁAD CZĘŚCIOWY: wiersz bez awatara, bez stanowiska, bez firmy i bez
//      publicznego profilu musi się wyrenderować - i to bez odnośnika do
//      profilu, bo katalog klubu nie obchodzi ustawienia widoczności profilu.
//   5. ZMIANA ROLI: prowadzący dostaje kontrolkę przy CUDZYCH wierszach i ani
//      jednej roli podwyższonej w dropliście, a wynik mutacji ma widoczne oba
//      końce (potwierdzenie i błąd).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ SKŁADU: bramka, strona, zawężenie roli, zbiór ról do wyboru,
//   plakietka, linia stanowiska, odnośnik do profilu, wyjątek „nie zmieniam
//   własnej roli” i próg ucięcia są czystymi funkcjami z własną tabelą
//   przypadków w `src/lib/clubs/__tests__/memberRoster.test.ts`. Tutaj
//   dowodzimy SKLEJENIA: co trasa wysyła do zapytań i co robi z wynikiem.
// - NAGŁÓWKA SEO: `clubHead.ts` ma własny zakres; tu porównujemy meta trasy
//   z `buildClubHead` na tych samych danych.
// - AUTORYZACJI: `can_see_members`, `can_manage` i odsiew `banned`/`left`
//   pochodzą z SECURITY DEFINER RPC i mają pgTAP. Trasa je czyta, nie liczy.
// - KSZTAŁTU RPC: `fetchClubMembers` i `fetchClubRosterSignal` mają własne testy
//   (`api.test.ts`, `networkApi.test.ts`), więc atrapa siedzi na poziomie
//   HOOKÓW, nie klienta Supabase.
// - MOLEKUŁY `ClubEnumSelect` (Radix Select nie działa pod happy-dom bez
//   pełnego pointer API - podmieniona na natywny `<select>`) i `ClubErrorNotice`
//   (marker z zapisem propsów): ich zachowanie należy do etapu molekuł.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ClubMemberRow } from "@/lib/clubs/types";
import type { ClubRosterSignal } from "@/lib/clubs/networkTypes";

const h = vi.hoisted(() => ({
  club: null as unknown,
  clubPending: false,
  clubError: false,
  clubRefetch: vi.fn(),
  /** `undefined` odwzorowuje zapytanie W LOCIE - trasa ma wytrzymać `?? []`. */
  membersData: undefined as { rows: unknown[]; total: number } | undefined,
  membersPending: false,
  membersError: false,
  membersRefetch: vi.fn(),
  /** Argumenty, z jakimi trasa zawołała `useClubMembers`. */
  membersArgs: null as Record<string, unknown> | null,
  signal: null as unknown,
  /** Argumenty, z jakimi trasa zawołała `useClubRosterSignal`. */
  signalArgs: null as Record<string, unknown> | null,
  user: null as { id: string } | null,
  isAdmin: false,
  /** Klub, dla którego trasa zbudowała mutację zmiany roli. */
  roleClubId: null as string | null,
  rolePending: false,
  roleOutcome: "success" as "success" | "error",
  mutateCalls: [] as { userId: string; role: string }[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  loaded: null as unknown,
  loaderFails: false,
  /** Propsy każdego wyrenderowanego `ClubErrorNotice`. */
  notices: [] as { onRetry?: () => void }[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, isAdmin: h.isAdmin, loading: false }),
}));
vi.mock("@/lib/clubs/publicClub", () => ({
  fetchClubBySlug: () =>
    h.loaderFails ? Promise.reject(new Error("club_view padło")) : Promise.resolve(h.loaded),
}));
vi.mock("@/lib/clubs/useClubs", () => ({
  useClubBySlug: () => ({
    data: h.club,
    isPending: h.clubPending,
    isError: h.clubError,
    refetch: h.clubRefetch,
  }),
  useClubMembers: (args: Record<string, unknown>) => {
    h.membersArgs = args;
    return {
      data: h.membersData,
      isPending: h.membersPending,
      isError: h.membersError,
      refetch: h.membersRefetch,
    };
  },
  useSetClubMemberRole: (clubId: string) => {
    h.roleClubId = clubId;
    return {
      isPending: h.rolePending,
      mutate: (
        vars: { userId: string; role: string },
        opts?: { onSuccess?: () => void; onError?: () => void },
      ) => {
        h.mutateCalls.push(vars);
        if (h.roleOutcome === "success") opts?.onSuccess?.();
        else opts?.onError?.();
      },
    };
  },
}));
vi.mock("@/lib/clubs/useClubNetwork", () => ({
  useClubRosterSignal: (args: Record<string, unknown>) => {
    h.signalArgs = args;
    return { data: h.signal };
  },
}));
vi.mock("@/components/clubs/molecules/ClubErrorNotice", () => ({
  ClubErrorNotice: (props: { onRetry?: () => void }) => {
    h.notices.push(props);
    return <div data-testid="ClubErrorNotice" />;
  },
}));
vi.mock("@/components/clubs/molecules/ClubEnumSelect", () => ({
  ClubEnumSelect: (props: {
    label?: string;
    value: string;
    options: readonly string[];
    disabled?: boolean;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={props.label}
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  ),
}));

import { renderRoute, type RouteMetaEntry } from "@/test/routeHarness";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { CLUB_ROSTER_PAGE_SIZE } from "@/lib/clubs/memberRoster";
import { formatDateShort, formatNumber } from "@/lib/i18n/format";
import { CLUB_BASE_ISO, CLUB_IDS, clubMemberRow, clubViewRow } from "@/test/clubs/fixtures";
import { Route as MembersRoute } from "@/routes/club.$clubSlug.members";

const SLUG = "klub-energetyczny";
const PATH = "/club/$clubSlug/members";
const ENTRY = `/club/${SLUG}/members`;

async function mount() {
  return renderRoute({ route: MembersRoute, path: PATH, initialEntry: ENTRY });
}

function robotsOf(meta: readonly RouteMetaEntry[]): string | null {
  const entry = meta.find((item) => item.name === "robots");
  return typeof entry?.content === "string" ? entry.content : null;
}

/** Strona składu o zadanej długości, z pełnym licznikiem w KAŻDYM wierszu. */
function membersPage(
  rows: ClubMemberRow[],
  total: number,
): { rows: ClubMemberRow[]; total: number } {
  return { rows: rows.map((row) => ({ ...row, total_count: total })), total };
}

function rosterSignal(overrides: Partial<ClubRosterSignal> = {}): ClubRosterSignal {
  return {
    membersTotal: 1234,
    new7d: 3,
    active24h: 2,
    active7d: 7,
    faces: [],
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  h.club = clubViewRow({ can_see_members: true, can_manage: false });
  h.clubPending = false;
  h.clubError = false;
  h.clubRefetch.mockReset();
  h.membersData = membersPage([clubMemberRow()], 1);
  h.membersPending = false;
  h.membersError = false;
  h.membersRefetch.mockReset();
  h.membersArgs = null;
  h.signal = null;
  h.signalArgs = null;
  h.user = { id: CLUB_IDS.me };
  h.isAdmin = false;
  h.roleClubId = null;
  h.rolePending = false;
  h.roleOutcome = "success";
  h.mutateCalls = [];
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.loaded = clubViewRow();
  h.loaderFails = false;
  h.notices = [];
});

// --- nagłówek i loader ------------------------------------------------------

describe("skład klubu - nagłówek nie wypuszcza nazwisk do wyszukiwarki", () => {
  it("loader dogrzewa cache pod `clubKeys.bySlug`", async () => {
    const { queryClient } = await mount();
    expect(queryClient.getQueryData(clubKeys.bySlug(SLUG))).not.toBeUndefined();
  });

  it("nagłówek zgadza się z `buildClubHead` na danych z loadera", async () => {
    const row = clubViewRow({ visibility: "public" });
    h.loaded = row;
    const rendered = await mount();
    const expected = buildClubHead({
      fallbackPath: ENTRY,
      club: toClubHeadSource(row),
      forceNoindex: true,
    });
    expect(rendered.meta()).toEqual(expected.meta);
  });

  it.each(["public", "members", "private", "secret"])(
    "klub `%s` daje na składzie `noindex` - nazwiska nie są treścią dla wyszukiwarki",
    async (visibility) => {
      h.loaded = clubViewRow({ visibility });
      const rendered = await mount();
      expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
    },
  );

  it("awaria loadera schodzi na nagłówek zapasowy i NIE wywala trasy", async () => {
    h.loaderFails = true;
    const rendered = await mount();
    const expected = buildClubHead({ fallbackPath: ENTRY, club: null, forceNoindex: true });
    expect(rendered.meta()).toEqual(expected.meta);
    expect(rendered.currentPath()).toBe(ENTRY);
  });
});

// --- bramka `can_see_members` ----------------------------------------------

describe("bramka składu - odmowa zapada PRZED zapytaniem", () => {
  it("bez uprawnienia lista nazwisk NIE WYCHODZI z przeglądarki", async () => {
    h.club = clubViewRow({ can_see_members: false });
    await mount();
    expect(h.membersArgs).toEqual({
      clubId: undefined,
      status: "active",
      limit: CLUB_ROSTER_PAGE_SIZE,
    });
    expect(h.signalArgs).toEqual({ clubId: undefined, limit: CLUB_ROSTER_PAGE_SIZE });
  });

  it("brak uprawnienia to DECYZJA KLUBU, nie awaria i nie pustka", async () => {
    h.club = clubViewRow({ can_see_members: false });
    await mount();
    expect(screen.getByText("club.roster.hidden")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByTestId("ClubErrorNotice")).toBeNull();
    expect(screen.queryByText("club.roster.empty")).toBeNull();
  });

  it("z uprawnieniem oba zapytania dostają klub, filtr `active` i stronę 60", async () => {
    h.club = clubViewRow({ id: CLUB_IDS.club, can_see_members: true });
    await mount();
    expect(h.membersArgs).toEqual({
      clubId: CLUB_IDS.club,
      status: "active",
      limit: CLUB_ROSTER_PAGE_SIZE,
    });
    expect(h.signalArgs).toEqual({ clubId: CLUB_IDS.club, limit: CLUB_ROSTER_PAGE_SIZE });
  });

  it("mutacja zmiany roli dostaje identyfikator klubu z karty", async () => {
    await mount();
    expect(h.roleClubId).toBe(CLUB_IDS.club);
  });

  it("bez karty klubu mutacja nie dostaje identyfikatora do zgadnięcia", async () => {
    h.club = null;
    await mount();
    expect(h.roleClubId).toBe("");
  });
});

// --- cztery stany karty klubu ----------------------------------------------

describe("skład klubu - stany karty klubu są ROZŁĄCZNE", () => {
  it("oczekiwanie na kartę klubu rysuje szkielet, a nie nagłówek składu", async () => {
    h.clubPending = true;
    h.club = null;
    const { container } = await mount();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("club.roster.title")).toBeNull();
  });

  it("awaria karty klubu to NIE 404 - i oferuje ponowienie", async () => {
    h.clubError = true;
    h.club = null;
    await mount();
    expect(screen.getByTestId("ClubErrorNotice")).toBeTruthy();
    expect(screen.queryByText("club.reason.not_found")).toBeNull();
    h.notices[0]?.onRetry?.();
    expect(h.clubRefetch).toHaveBeenCalledTimes(1);
  });

  it("zero wierszy karty to 404 - klub bez dostępu nie zdradza, że istnieje", async () => {
    h.club = null;
    await mount();
    expect(screen.getByText("club.reason.not_found")).toBeTruthy();
    expect(screen.queryByTestId("ClubErrorNotice")).toBeNull();
    expect(screen.queryByText("club.roster.hidden")).toBeNull();
  });

  it("karta klubu daje nagłówek z pełnym licznikiem i drogę powrotną do klubu", async () => {
    h.club = clubViewRow({ member_count: 42, can_see_members: true });
    await mount();
    expect(screen.getByText("club.roster.title")).toBeTruthy();
    expect(screen.getByText("club.membersCount(count=42)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Klub energetyczny" }).getAttribute("href")).toBe(
      `/club/${SLUG}`,
    );
  });
});

// --- stany listy członków --------------------------------------------------

describe("skład klubu - stany listy członków", () => {
  it("awaria listy oferuje ponowienie SAMEJ listy, nie przeładowanie klubu", async () => {
    h.membersError = true;
    await mount();
    expect(screen.getByTestId("ClubErrorNotice")).toBeTruthy();
    h.notices[0]?.onRetry?.();
    expect(h.membersRefetch).toHaveBeenCalledTimes(1);
    expect(h.clubRefetch).not.toHaveBeenCalled();
  });

  it("oczekiwanie na listę rysuje CZTERY zaślepki w siatce wierszy", async () => {
    h.membersPending = true;
    const { container } = await mount();
    expect(container.querySelectorAll('[aria-busy="true"] > div')).toHaveLength(4);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("pusty skład mówi o pustce, a nie o braku uprawnienia", async () => {
    h.membersData = membersPage([], 0);
    await mount();
    expect(screen.getByText("club.roster.empty")).toBeTruthy();
    expect(screen.queryByText("club.roster.hidden")).toBeNull();
  });

  it("zapytanie W LOCIE (bez flagi oczekiwania) czyta się jak pusty skład, a nie jak awaria", async () => {
    h.membersData = undefined;
    await mount();
    expect(screen.getByText("club.roster.empty")).toBeTruthy();
    expect(screen.queryByText(/club\.roster\.truncated/)).toBeNull();
  });
});

// --- wiersz składu ---------------------------------------------------------

describe("wiersz składu - co wolno pokazać przy nazwisku", () => {
  it("wiersz pełny: nazwisko, znacznik weryfikacji, stanowisko i data dołączenia", async () => {
    h.membersData = membersPage([clubMemberRow()], 1);
    await mount();
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    expect(screen.getByLabelText("club.roster.verified")).toBeTruthy();
    expect(screen.getByText("Analityk - NES")).toBeTruthy();
    expect(
      screen.getByText(`club.roster.joined(date=${formatDateShort(CLUB_BASE_ISO, "pl")})`),
    ).toBeTruthy();
  });

  it("osoba z profilem publicznym dostaje odnośnik do profilu", async () => {
    h.membersData = membersPage([clubMemberRow({ slug: "anna-nowak" })], 1);
    await mount();
    expect(screen.getByRole("link", { name: /Anna Nowak/ }).getAttribute("href")).toBe(
      "/author/anna-nowak",
    );
  });

  it("osoba BEZ publicznego profilu jest wypisana bez odnośnika", async () => {
    h.membersData = membersPage([clubMemberRow({ slug: "" })], 1);
    await mount();
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Anna Nowak/ })).toBeNull();
  });

  it("niezweryfikowany członek nie dostaje znacznika weryfikacji", async () => {
    h.membersData = membersPage([clubMemberRow({ verified: false })], 1);
    await mount();
    expect(screen.queryByLabelText("club.roster.verified")).toBeNull();
  });

  it("rola `member` NIE dostaje plakietki - stan domyślny przy każdym wierszu to szum", async () => {
    h.membersData = membersPage([clubMemberRow({ role: "member" })], 1);
    await mount();
    expect(screen.queryByText("club.role.member")).toBeNull();
  });

  it.each(["lead", "moderator", "observer"])(
    "rola `%s` dostaje plakietkę z kluczem roli",
    async (role) => {
      h.membersData = membersPage([clubMemberRow({ role })], 1);
      await mount();
      expect(screen.getByText(`club.role.${role}`)).toBeTruthy();
    },
  );

  it("skład CZĘŚCIOWY (bez awatara, stanowiska, firmy i profilu) renderuje się w całości", async () => {
    h.membersData = membersPage(
      [
        clubMemberRow({
          display_name: "Jan Kowalski",
          avatar_url: "",
          job_title: "",
          current_company: "",
          slug: "",
        }),
      ],
      1,
    );
    const { container } = await mount();
    expect(screen.getByText("Jan Kowalski")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Jan Kowalski/ })).toBeNull();
    // Brak zdjęcia znaczy inicjały, a nie pusty `<img>` z połamanym adresem.
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("JK")).toBeTruthy();
  });

  it("sam pracodawca bez stanowiska daje linię BEZ separatora", async () => {
    h.membersData = membersPage([clubMemberRow({ job_title: "", current_company: "NES" })], 1);
    await mount();
    expect(screen.getByText("NES")).toBeTruthy();
  });

  it.fails(
    "USTERKA: członek bez stanowiska I bez firmy nadal dostaje akapit stanowiska",
    async () => {
      // Regułą produktu jest „linia stanowiska pojawia się, gdy jest co pokazać”.
      // Warunek w trasie brzmi `job_title !== null || current_company !== null`,
      // ale `club_members_list` deklaruje te kolumny jako NON-NULL i oddaje
      // PUSTE CIĄGI (patrz fixture `clubMemberRow`), więc warunek jest zawsze
      // prawdziwy i akapit rysuje się pusty. W wierszu powinien zostać jeden
      // akapit (data dołączenia), a są dwa. Zachowanie zostawione BEZ ZMIANY -
      // usterka zgłoszona w raporcie.
      h.membersData = membersPage([clubMemberRow({ job_title: "", current_company: "" })], 1);
      await mount();
      expect(screen.getByRole("listitem").querySelectorAll("p")).toHaveLength(1);
    },
  );

  it("kolejność wierszy z RPC zostaje nietknięta - porządek jest decyzją bazy", async () => {
    h.membersData = membersPage(
      [
        clubMemberRow({ user_id: CLUB_IDS.lead, display_name: "Zofia Lis", slug: "zofia-lis" }),
        clubMemberRow({ user_id: CLUB_IDS.member, display_name: "Anna Nowak" }),
      ],
      2,
    );
    await mount();
    const names = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(names[0]).toContain("Zofia Lis");
    expect(names[1]).toContain("Anna Nowak");
  });
});

// --- sygnał obecności ------------------------------------------------------

describe("sygnał składu - „czy ktokolwiek tu jest” obok „kto należy”", () => {
  it("cztery liczby o ludziach plus droga do katalogu kompetencji", async () => {
    h.signal = rosterSignal({ membersTotal: 1234, active24h: 2, active7d: 7, new7d: 3 });
    await mount();
    expect(screen.getByText("club.network.roster.total")).toBeTruthy();
    expect(screen.getByText(formatNumber(1234, "pl"))).toBeTruthy();
    expect(screen.getByText("club.network.roster.active24h")).toBeTruthy();
    expect(screen.getByText("club.network.roster.active7d")).toBeTruthy();
    expect(screen.getByText("club.network.roster.new7d")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "club.network.roster.toExperts" }).getAttribute("href"),
    ).toBe(`/club/${SLUG}/experts`);
  });

  it("brak sygnału (zapytanie w locie) nie rysuje pustego paska liczb", async () => {
    h.signal = null;
    await mount();
    expect(screen.queryByText("club.network.roster.total")).toBeNull();
  });

  it("bez uprawnienia pasek liczb nie pojawia się nawet z gotowym sygnałem", async () => {
    h.club = clubViewRow({ can_see_members: false });
    h.signal = rosterSignal();
    await mount();
    expect(screen.queryByText("club.network.roster.total")).toBeNull();
  });

  it("kropkę obecności dostaje WYŁĄCZNIE osoba aktywna w ostatniej dobie", async () => {
    h.signal = rosterSignal({
      faces: [
        {
          userId: CLUB_IDS.member,
          name: "Anna Nowak",
          avatarUrl: null,
          slug: "anna-nowak",
          headline: null,
          role: "member",
          joinedAt: CLUB_BASE_ISO,
          isNew: false,
          isActive: true,
          topics: [],
        },
        {
          userId: CLUB_IDS.lead,
          name: "Zofia Lis",
          avatarUrl: null,
          slug: null,
          headline: null,
          role: "lead",
          joinedAt: CLUB_BASE_ISO,
          isNew: false,
          isActive: false,
          topics: [],
        },
      ],
    });
    h.membersData = membersPage(
      [
        clubMemberRow({ user_id: CLUB_IDS.member, display_name: "Anna Nowak" }),
        clubMemberRow({ user_id: CLUB_IDS.lead, display_name: "Zofia Lis" }),
      ],
      2,
    );
    await mount();
    expect(screen.getAllByLabelText("club.network.roster.activeDot")).toHaveLength(1);
  });
});

// --- kontrakt paginacji ----------------------------------------------------

describe("kontrakt paginacji składu - `total_count` z każdego wiersza", () => {
  it("ucięta strona mówi wprost, ile z ilu widać", async () => {
    h.membersData = membersPage(
      [
        clubMemberRow({ user_id: CLUB_IDS.member }),
        clubMemberRow({ user_id: CLUB_IDS.lead, slug: "" }),
      ],
      61,
    );
    await mount();
    expect(screen.getByText("club.roster.truncated(shown=2,total=61)")).toBeTruthy();
  });

  it("strona pełna (licznik równy liczbie wierszy) NIE mówi o ucięciu", async () => {
    h.membersData = membersPage([clubMemberRow()], 1);
    await mount();
    expect(screen.queryByText(/club\.roster\.truncated/)).toBeNull();
  });
});

// --- zmiana roli w klubie --------------------------------------------------

describe("zmiana roli w składzie - prowadzący klubu bez panelu admina", () => {
  const twoMembers = () =>
    membersPage(
      [
        clubMemberRow({ user_id: CLUB_IDS.me, display_name: "Ja", slug: "" }),
        clubMemberRow({ user_id: CLUB_IDS.member, display_name: "Anna Nowak" }),
      ],
      2,
    );

  it("bez prawa zarządzania nie ma ani podpowiedzi, ani kontrolek", async () => {
    h.club = clubViewRow({ can_see_members: true, can_manage: false });
    h.membersData = twoMembers();
    await mount();
    expect(screen.queryByText("club.roster.manageHint")).toBeNull();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("prowadzący dostaje podpowiedź i kontrolkę przy CUDZYM wierszu, nie przy własnym", async () => {
    h.club = clubViewRow({ can_see_members: true, can_manage: true });
    h.membersData = twoMembers();
    await mount();
    expect(screen.getByText("club.roster.manageHint")).toBeTruthy();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("droplista prowadzącego NIE oferuje ról podwyższonych - baza by je odrzuciła", async () => {
    h.club = clubViewRow({ can_see_members: true, can_manage: true });
    h.membersData = twoMembers();
    h.isAdmin = false;
    await mount();
    const options = screen
      .getAllByRole("option")
      .map((option) => option.getAttribute("value") ?? "");
    expect(options).toEqual(["member", "observer"]);
  });

  it("personel dostaje w dropliście cały słownik ról", async () => {
    h.club = clubViewRow({ can_see_members: true, can_manage: true });
    h.membersData = twoMembers();
    h.isAdmin = true;
    await mount();
    const options = screen
      .getAllByRole("option")
      .map((option) => option.getAttribute("value") ?? "");
    expect(options).toEqual(["lead", "moderator", "member", "observer"]);
  });

  it("wybór roli wysyła użytkownika i rolę, a powodzenie potwierdza", async () => {
    h.club = clubViewRow({ can_see_members: true, can_manage: true });
    h.membersData = twoMembers();
    await mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "observer" } });
    expect(h.mutateCalls).toEqual([{ userId: CLUB_IDS.member, role: "observer" }]);
    expect(h.toastSuccess).toHaveBeenCalledWith("club.roster.roleChanged");
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("odmowa serwera mówi o niepowodzeniu, a nie o zapisanej zmianie", async () => {
    h.club = clubViewRow({ can_see_members: true, can_manage: true });
    h.membersData = twoMembers();
    h.roleOutcome = "error";
    await mount();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "observer" } });
    expect(h.toastError).toHaveBeenCalledWith("club.roster.roleFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("zapis w toku blokuje kontrolkę - druga zmiana nie wyjeżdża w tym samym czasie", async () => {
    h.club = clubViewRow({ can_see_members: true, can_manage: true });
    h.membersData = twoMembers();
    h.rolePending = true;
    await mount();
    expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(true);
  });

  it("nieodczytana sesja nie gasi kontrolek prowadzącego - `can_manage` przyszło z bazy", async () => {
    h.club = clubViewRow({ can_see_members: true, can_manage: true });
    h.membersData = twoMembers();
    h.user = null;
    await mount();
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });
});
