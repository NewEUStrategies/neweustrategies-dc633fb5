// `/club` - hub, czyli KATALOG klubów.
//
// CO TEN PLIK DOWODZI. Reguły podziału i liczników mieszkają od teraz
// w `lib/clubs/hubCatalog` i mają własną tabelę przypadków. Tu zostaje to,
// czego czysta funkcja nie dosięga, a co decyduje o użyteczności strony:
//
//   1. `noindex` BEZWARUNKOWO. Lista miesza kluby `public` z zamkniętymi, więc
//      jej zaindeksowanie wyciekałoby NAZWY klubów zamkniętych. Indeksowalna
//      jest strona KLUBU - i to ona jest wejściem z wyszukiwarki.
//   2. WYSZUKIWANIE ZASTĘPUJE KATALOG, nie stoi obok niego. Fraza od dwóch
//      znaków gasi pasek obszarów, siatkę specjalizacji i „pokaż więcej",
//      a pokazuje dwa bloki wyników: dopasowanie NAZW klubów (liczone
//      w pamięci, bo wyszukiwanie serwerowe szuka w WĄTKACH) i trafienia
//      z RPC. Sklejenie tych warstw było realnym błędem: nazwa klubu wpisana
//      we fragmentach nie trafiała w nic.
//   3. GOŚĆ vs ZALOGOWANY to dwie różne strony, nie ta sama z ukrytymi
//      elementami: gość nie dostaje wyszukiwarki ani pustego katalogu „Kluby
//      otwarte", tylko mapę specjalizacji i drogę do rejestracji. Zapytanie
//      wyszukiwania jest dla niego WYŁĄCZONE - inaczej RPC dostaje ruch za
//      funkcję, której wynik i tak byłby pusty.
//   4. ZAPROSZENIA mają termin, więc stoją wysoko - i odpowiedź na nie musi
//      nazwać skutek (przyjęte / odrzucone) oraz przetłumaczyć błąd RPC na
//      klucz i18n, nie pokazać surowego tekstu z Postgresa.
//   5. AWARIA katalogu jest jedynym stanem, w którym hub nie ma z czego
//      zbudować żadnego modułu - katalog JEST tą stroną, więc pokazuje
//      komunikat z ponowieniem, a nie pustą siatkę.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ KATALOGU: `hubCatalog.test.ts` (podział, liczniki, progi).
// - DOSTĘPU: `hubAccess.test.ts` (`resolveClubHubAccess`). Tu dowodzimy, że
//   trasa woła go z LICZBĄ aktywnych członkostw i liczbą zaproszeń, i że
//   gościowi nie podaje stanu dostępu wcale.
// - RANKINGU NAZW: `clubMatch.test.ts` (`rankClubs`).
// - ORGANIZMÓW: `ClubHubHero`, `ClubDirectory`, `MyClubsTabs`,
//   `ClubSpecializationGrid`, `ClubInvitationInbox`, `ClubGlobalSearch*` to
//   atrapy-markery; ich zachowanie należy do etapu organizmów.
//
// JEDNA GAŁĄŹ NIEOSIĄGALNA. Linia 118 trasy - `club.policy_area === null ? null
// : topicLabel(...)` w domykaniu etykiety obszaru dla rankingu nazw - nie ma
// wejścia dla lewego ramienia: `club_list` typuje `policy_area` jako `string`
// (nie `string | null`), więc wiersz bez przypisanego obszaru przychodzi
// z PUSTYM NAPISEM, a nie z `null`. Testy jadą pustym napisem, bo to jest
// realna reprezentacja pustki w tej kolumnie; wymuszenie `null` wymagałoby
// rzutowania, którego reguły repozytorium zabraniają. Obrona zostaje w kodzie
// na wypadek zmiany kontraktu RPC - tylko nie da się jej wywołać z TypeScriptu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClubListRow } from "@/lib/clubs/types";

interface RespondVars {
  invitationId: string;
  accept: boolean;
}

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  isStaff: false,
  tierRank: null as number | null,
  clubs: { rows: [] as unknown[], total: 0 } as { rows: unknown[]; total: number } | undefined,
  clubsPending: false,
  clubsError: false,
  refetch: vi.fn(),
  invitations: [] as { id: string; club_id: string }[] | undefined,
  searchHits: [] as unknown[] | undefined,
  searchPending: false,
  searchError: false,
  searchRefetch: vi.fn(),
  /** Argumenty, z jakimi trasa zawołała wyszukiwanie serwerowe. */
  searchArgs: null as Record<string, unknown> | null,
  /** Limit, z jakim trasa zawołała katalog - rośnie po „pokaż więcej”. */
  listArgs: [] as { enabled: boolean; limit: number }[],
  respondError: null as unknown,
  respondCalls: [] as RespondVars[],
  respondPending: false,
  respondVars: null as RespondVars | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Propsy zapisane przez atrapy organizmów. */
  organism: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
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
// Debounce wyłączony: przedmiotem dowodu jest PRÓG frazy i to, co gasi katalog,
// a nie czas oczekiwania (ten ma własny test hooka).
vi.mock("@/hooks/useDebouncedValue", () => ({ useDebouncedValue: (value: string) => value }));
vi.mock("@/lib/clubs/useClubTopics", () => ({ useClubTopics: () => ({ topics: [] }) }));
vi.mock("@/lib/clubs/useClubs", () => ({
  useClubList: (enabled: boolean, limit: number) => {
    h.listArgs.push({ enabled, limit });
    return {
      data: h.clubs,
      isPending: h.clubsPending,
      isError: h.clubsError,
      refetch: h.refetch,
    };
  },
  useClubSearch: (args: Record<string, unknown>) => {
    h.searchArgs = args;
    return {
      data: h.searchHits,
      isPending: h.searchPending,
      isError: h.searchError,
      refetch: h.searchRefetch,
    };
  },
  useMyClubInvitations: () => ({ data: h.invitations }),
  // Zgloszenia klubow: atrapa oddaje puste, bo ten test bada KATALOG.
  useMyClubProposals: () => ({ data: [] }),
  useRespondClubInvitation: () => ({
    mutate: (
      vars: RespondVars,
      handlers: { onSuccess: () => void; onError: (error: unknown) => void },
    ) => {
      h.respondCalls.push(vars);
      if (h.respondError !== null) handlers.onError(h.respondError);
      else handlers.onSuccess();
    },
    isPending: h.respondPending,
    variables: h.respondVars,
  }),
}));

/** Atrapa organizmu: marker + zapis propsów. */
function organismStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.organism[name] = props;
    return <div data-testid={name} />;
  };
}

vi.mock("@/components/clubs/organisms/ClubHubHero", () => ({
  ClubHubHero: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
    h.organism.ClubHubHero = props;
    return <div data-testid="ClubHubHero">{children}</div>;
  },
}));
vi.mock("@/components/clubs/organisms/ClubInvitationInbox", () => ({
  ClubInvitationInbox: organismStub("ClubInvitationInbox"),
}));
vi.mock("@/components/clubs/organisms/ClubDirectory", () => ({
  ClubDirectory: (props: Record<string, unknown>) => {
    // Katalog pojawia się w dwóch miejscach (dopasowanie nazw i „Odkryj”), więc
    // zapisujemy WSZYSTKIE wystąpienia, nie ostatnie.
    const seen = h.organism.ClubDirectoryAll;
    const list = Array.isArray(seen?.calls) ? seen.calls : [];
    h.organism.ClubDirectoryAll = { calls: [...list, props] };
    return <div data-testid="ClubDirectory" data-title={String(props.title)} />;
  },
}));
vi.mock("@/components/clubs/organisms/MyClubsTabs", () => ({
  MyClubsTabs: organismStub("MyClubsTabs"),
}));
vi.mock("@/components/clubs/organisms/ClubSpecializationGrid", () => ({
  ClubSpecializationGrid: organismStub("ClubSpecializationGrid"),
}));
vi.mock("@/components/clubs/molecules/ClubErrorNotice", () => ({
  ClubErrorNotice: organismStub("ClubErrorNotice"),
}));
vi.mock("@/components/clubs/organisms/ClubGlobalSearch", () => ({
  ClubGlobalSearchInput: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (next: string) => void;
  }) => (
    <input
      data-testid="ClubGlobalSearchInput"
      aria-label="szukaj"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  ClubGlobalSearchResults: organismStub("ClubGlobalSearchResults"),
}));
vi.mock("@/components/clubs/molecules/ClubHubLayoutSwitch", () => ({
  ClubHubLayoutSwitch: organismStub("ClubHubLayoutSwitch"),
  useClubHubLayout: () => ["cards", () => {}],
}));
vi.mock("@/components/clubs/molecules/ClubTopicNav", () => ({
  ClubTopicNav: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (next: string | null) => void;
  }) => (
    <button
      type="button"
      data-testid="ClubTopicNav"
      data-value={value ?? ""}
      onClick={() => onChange("energy")}
    >
      obszary
    </button>
  ),
}));

import { renderRoute, type RouteMetaEntry } from "@/test/routeHarness";
import { buildClubHead } from "@/lib/clubs/clubHead";
import { CLUB_IDS, clubListRow } from "@/test/clubs/fixtures";
import { Route as CatalogRoute } from "@/routes/club.index";

const PATH = "/club/";

async function mount() {
  return renderRoute({ route: CatalogRoute, path: PATH, initialEntry: "/club" });
}

function robotsOf(meta: readonly RouteMetaEntry[]): string | null {
  const entry = meta.find((item) => item.name === "robots");
  return typeof entry?.content === "string" ? entry.content : null;
}

function directoryCalls(): Record<string, unknown>[] {
  const seen = h.organism.ClubDirectoryAll;
  return Array.isArray(seen?.calls) ? (seen.calls as Record<string, unknown>[]) : [];
}

function catalog(...rows: ClubListRow[]): void {
  h.clubs = { rows, total: rows.length };
}

function search(query: string): void {
  fireEvent.change(screen.getByTestId("ClubGlobalSearchInput"), { target: { value: query } });
}

beforeEach(() => {
  cleanup();
  h.session = { user: { id: CLUB_IDS.me } };
  h.isStaff = false;
  h.tierRank = 20;
  h.clubs = { rows: [], total: 0 };
  h.clubsPending = false;
  h.clubsError = false;
  h.refetch.mockReset();
  h.invitations = [];
  h.searchHits = [];
  h.searchPending = false;
  h.searchError = false;
  h.searchRefetch.mockReset();
  h.searchArgs = null;
  h.listArgs = [];
  h.respondError = null;
  h.respondCalls = [];
  h.respondPending = false;
  h.respondVars = null;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.organism = {};
});

// --- nagłówek --------------------------------------------------------------

describe("nagłówek - katalog nie należy do indeksu", () => {
  it("emituje `noindex` bezwarunkowo i zgadza się z `buildClubHead`", async () => {
    const rendered = await mount();
    expect(robotsOf(rendered.meta())).toBe("noindex, nofollow");
    const expected = buildClubHead({ fallbackPath: "/club", club: null, forceNoindex: true });
    expect(rendered.meta()).toEqual(expected.meta);
  });

  it("nie ma loadera - katalog czyta komponent, a nagłówek nie zależy od danych", () => {
    expect(CatalogRoute.options.loader).toBeUndefined();
  });
});

// --- gość vs zalogowany ----------------------------------------------------

describe("gość - mapa specjalizacji zamiast katalogu", () => {
  beforeEach(() => {
    h.session = null;
  });

  it("dostaje drogę do REJESTRACJI, a nie wyszukiwarkę", async () => {
    await mount();
    expect(screen.queryByTestId("ClubGlobalSearchInput")).toBeNull();
    const cta = screen.getByRole("link", { name: /club\.signIn/ });
    expect(cta.getAttribute("href")).toBe("/membership-registration");
  });

  it("dostaje siatkę specjalizacji BEZ znacznika zalogowania", async () => {
    await mount();
    expect(screen.getByTestId("ClubSpecializationGrid")).toBeTruthy();
    expect(h.organism.ClubSpecializationGrid.signedIn).toBeUndefined();
  });

  it("NIE dostaje stanu dostępu - `access` jest dla niego `null`", async () => {
    // Stan dostępu opisuje, czego brakuje CZŁONKOWI. Gościowi pokazywałby
    // diagnozę konta, którego nie ma.
    h.tierRank = 40;
    await mount();
    expect(h.organism.ClubHubHero.access).toBeNull();
    expect(h.organism.ClubHubHero.signedIn).toBe(false);
  });

  it("nie widzi paska obszarów, przełącznika układu ani „Moich klubów”", async () => {
    catalog(clubListRow({ my_status: "active" }));
    await mount();
    expect(screen.queryByTestId("ClubTopicNav")).toBeNull();
    expect(screen.queryByTestId("ClubHubLayoutSwitch")).toBeNull();
    expect(screen.queryByTestId("MyClubsTabs")).toBeNull();
  });

  it("nie widzi „pokaż więcej”, choćby okno RPC było ucięte", async () => {
    h.clubs = { rows: [clubListRow()], total: 500 };
    await mount();
    expect(screen.queryByRole("button", { name: /club\.hub\.showMore/ })).toBeNull();
  });

  it("skrzynka zaproszeń jest ukryta nawet przy niepustej odpowiedzi", async () => {
    h.invitations = [{ id: "inv-1", club_id: CLUB_IDS.club }];
    await mount();
    expect(screen.queryByTestId("ClubInvitationInbox")).toBeNull();
  });
});

describe("zalogowany - katalog ze sterowaniem", () => {
  it("dostaje wyszukiwarkę, pasek obszarów i przełącznik układu", async () => {
    await mount();
    expect(screen.getByTestId("ClubGlobalSearchInput")).toBeTruthy();
    expect(screen.getByTestId("ClubTopicNav")).toBeTruthy();
    expect(screen.getByTestId("ClubHubLayoutSwitch")).toBeTruthy();
  });

  it("siatka specjalizacji jest oznaczona jako dla zalogowanego", async () => {
    await mount();
    expect(h.organism.ClubSpecializationGrid.signedIn).toBe(true);
  });

  it("stan dostępu liczy się z LICZBY aktywnych członkostw i zaproszeń", async () => {
    catalog(
      clubListRow({ id: "a", my_status: "active" }),
      clubListRow({ id: "b", my_status: "active" }),
      clubListRow({ id: "c", my_status: "pending" }),
    );
    h.invitations = [{ id: "inv-1", club_id: CLUB_IDS.club }];
    await mount();
    expect(h.organism.ClubHubHero.signedIn).toBe(true);
    expect(h.organism.ClubHubHero.access).not.toBeNull();
    expect(h.organism.ClubHubHero.stats).toEqual({ clubs: 3, threads: 36, seats: 126, mine: 2 });
  });

  it("brak danych o warstwie nie wywala stanu dostępu - ranga schodzi na `null`", async () => {
    // `null` znaczy „nie wiem", a nie „warstwa darmowa": zamiana na `0`
    // dawałaby diagnozę „podnieś plan" komuś, kogo planu jeszcze nie znamy.
    h.tierRank = null;
    await mount();
    expect(h.organism.ClubHubHero.access).not.toBeNull();
  });

  it("„Moje kluby” pojawiają się TYLKO wtedy, gdy są", async () => {
    catalog(clubListRow({ my_status: "pending" }));
    const first = await mount();
    expect(screen.queryByTestId("MyClubsTabs")).toBeNull();
    first.unmount();
    cleanup();

    catalog(clubListRow({ my_status: "active" }));
    await mount();
    expect(screen.getByTestId("MyClubsTabs")).toBeTruthy();
  });

  it("„Odkryj” pojawia się DOPIERO po wybraniu obszaru", async () => {
    // Katalog nie stoi już płasko na hubie: zalogowany wybiera najpierw
    // specjalizację, a kluby wypisuje jej strona.
    catalog(clubListRow({ my_status: "", policy_area: "energy" }));
    await mount();
    expect(directoryCalls()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("ClubTopicNav"));
    await waitFor(() => {
      expect(directoryCalls()).toHaveLength(1);
    });
    expect(directoryCalls()[0].title).toBe("club.discover");
  });

  it("wybrany obszar zawęża „Odkryj”, ale nie „Moje kluby”", async () => {
    catalog(
      clubListRow({ id: "moj", my_status: "active", policy_area: "transport" }),
      clubListRow({ id: "pasuje", my_status: "", policy_area: "energy" }),
      clubListRow({ id: "nie", my_status: "", policy_area: "transport" }),
    );
    await mount();
    fireEvent.click(screen.getByTestId("ClubTopicNav"));
    await waitFor(() => {
      expect(directoryCalls()).toHaveLength(1);
    });
    const discover = directoryCalls()[0].clubs;
    expect(Array.isArray(discover) ? discover.map((r) => (r as ClubListRow).id) : []).toEqual([
      "pasuje",
    ]);
    const mine = h.organism.MyClubsTabs.clubs;
    expect(Array.isArray(mine) ? mine.map((r) => (r as ClubListRow).id) : []).toEqual(["moj"]);
  });

  it("„pokaż więcej” dokłada porcję do LIMITU zapytania, a nie stronę", async () => {
    h.clubs = { rows: [clubListRow()], total: 250 };
    await mount();
    const przed = h.listArgs.at(-1)?.limit ?? 0;
    expect(przed).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: /club\.hub\.showMore/ }));
    await waitFor(() => {
      expect(h.listArgs.at(-1)?.limit).toBe(200);
    });
  });

  it("„pokaż więcej” mówi, ILE z ILU widać - inaczej ucięcie jest niewidoczne", async () => {
    h.clubs = { rows: [clubListRow(), clubListRow({ id: "b" })], total: 250 };
    await mount();
    const button = screen.getByRole("button", { name: /club\.hub\.showMore/ });
    expect(button.textContent).toContain("shown=2");
    expect(button.textContent).toContain("total=250");
  });

  it("nieucięty katalog NIE oferuje doładowania", async () => {
    h.clubs = { rows: [clubListRow()], total: 1 };
    await mount();
    expect(screen.queryByRole("button", { name: /club\.hub\.showMore/ })).toBeNull();
  });

  it("brak odpowiedzi katalogu (`undefined`) nie wywala huba", async () => {
    h.clubs = undefined;
    await mount();
    expect(h.organism.ClubHubHero.stats).toEqual({ clubs: 0, threads: 0, seats: 0, mine: 0 });
  });

  it("brak odpowiedzi o zaproszeniach nie pokazuje skrzynki", async () => {
    h.invitations = undefined;
    await mount();
    expect(screen.queryByTestId("ClubInvitationInbox")).toBeNull();
  });

  it("stan oczekiwania na katalog jedzie do organizmów jako `loading`", async () => {
    catalog(clubListRow({ my_status: "active" }));
    h.clubsPending = true;
    await mount();
    expect(h.organism.MyClubsTabs.loading).toBe(true);
  });
});

// --- wyszukiwanie ----------------------------------------------------------

describe("wyszukiwanie - ZASTĘPUJE katalog", () => {
  it("jedna litera nie uruchamia wyszukiwania ani nie gasi katalogu", async () => {
    catalog(clubListRow({ my_status: "active" }));
    await mount();
    search("e");
    await waitFor(() => {
      expect(screen.getByTestId("MyClubsTabs")).toBeTruthy();
    });
    expect(screen.queryByTestId("ClubGlobalSearchResults")).toBeNull();
    expect(h.searchArgs?.enabled).toBe(false);
  });

  it("dwa znaki gaszą katalog i pokazują wyniki", async () => {
    catalog(clubListRow({ my_status: "active" }));
    await mount();
    search("en");
    await waitFor(() => {
      expect(screen.getByTestId("ClubGlobalSearchResults")).toBeTruthy();
    });
    expect(screen.queryByTestId("MyClubsTabs")).toBeNull();
    expect(screen.queryByTestId("ClubTopicNav")).toBeNull();
    expect(screen.queryByTestId("ClubSpecializationGrid")).toBeNull();
  });

  it("wyszukiwanie serwerowe idzie z FRAZĄ i bez zawężenia do klubu", async () => {
    await mount();
    search("energia");
    await waitFor(() => {
      expect(h.searchArgs).toEqual({ query: "energia", clubId: null, enabled: true });
    });
  });

  it("dopasowanie NAZW klubów jest osobnym blokiem nad trafieniami z RPC", async () => {
    // Wyszukiwanie serwerowe szuka w WĄTKACH; nazwa klubu wpisana we
    // fragmentach nie trafiała więc w nic. Dopasowanie nazw liczymy w pamięci.
    catalog(clubListRow({ name_pl: "Klub energetyczny", name_en: "Energy club" }));
    await mount();
    search("energ");
    await waitFor(() => {
      expect(directoryCalls().length).toBeGreaterThan(0);
    });
    expect(directoryCalls().at(-1)?.title).toBe("club.hub.clubMatches");
  });

  it("klub BEZ przypisanego obszaru też daje się dopasować po nazwie", async () => {
    // Ranking dostaje etykietę obszaru jako dodatkowe pole dopasowania. Klub
    // z `policy_area = null` nie ma jej wcale - i to nie może wywalić
    // dopasowania po samej nazwie.
    catalog(clubListRow({ name_pl: "Klub energetyczny", name_en: "Energy club", policy_area: "" }));
    await mount();
    search("energ");
    await waitFor(() => {
      expect(directoryCalls().length).toBeGreaterThan(0);
    });
    const hits = directoryCalls().at(-1)?.clubs;
    expect(Array.isArray(hits) ? hits.length : 0).toBe(1);
  });

  it("brak dopasowania nazw NIE renderuje pustego bloku dopasowań", async () => {
    catalog(clubListRow({ name_pl: "Klub transportowy", name_en: "Transport club" }));
    await mount();
    search("zzzzzz");
    await waitFor(() => {
      expect(screen.getByTestId("ClubGlobalSearchResults")).toBeTruthy();
    });
    expect(directoryCalls()).toHaveLength(0);
  });

  it("wyniki niosą stan zapytania: w locie, awarię i frazę", async () => {
    h.searchPending = true;
    h.searchError = true;
    await mount();
    search("energia");
    await waitFor(() => {
      expect(h.organism.ClubGlobalSearchResults).toMatchObject({
        pending: true,
        failed: true,
        query: "energia",
      });
    });
  });

  it("awaria wyszukiwania oferuje PONOWIENIE właśnie tego zapytania", async () => {
    h.searchError = true;
    await mount();
    search("energia");
    await waitFor(() => {
      expect(typeof h.organism.ClubGlobalSearchResults.onRetry).toBe("function");
    });
    const onRetry = h.organism.ClubGlobalSearchResults.onRetry;
    if (typeof onRetry === "function") onRetry();
    expect(h.searchRefetch).toHaveBeenCalledTimes(1);
    expect(h.refetch).not.toHaveBeenCalled();
  });

  it("brak odpowiedzi wyszukiwania daje pustą listę trafień, nie `undefined`", async () => {
    h.searchHits = undefined;
    await mount();
    search("energia");
    await waitFor(() => {
      expect(h.organism.ClubGlobalSearchResults.hits).toEqual([]);
    });
  });

  it("gość nie wysyła zapytania wyszukiwania - RPC nie dostaje ruchu na darmo", async () => {
    h.session = null;
    await mount();
    expect(h.searchArgs?.enabled).toBe(false);
  });
});

// --- zaproszenia -----------------------------------------------------------

describe("zaproszenia - jedyny moduł z terminem", () => {
  beforeEach(() => {
    h.invitations = [{ id: "inv-1", club_id: CLUB_IDS.club }];
  });

  it("skrzynka pojawia się dla zalogowanego z zaproszeniami", async () => {
    await mount();
    expect(screen.getByTestId("ClubInvitationInbox")).toBeTruthy();
    expect(h.organism.ClubInvitationInbox.invitations).toEqual(h.invitations);
  });

  it("przyjęcie nazywa skutek WPROST", async () => {
    await mount();
    const onRespond = h.organism.ClubInvitationInbox.onRespond;
    if (typeof onRespond !== "function") throw new Error("brak obsługi odpowiedzi");
    onRespond("inv-1", true);
    await waitFor(() => {
      expect(h.toastSuccess).toHaveBeenCalledWith("club.invitationAccepted");
    });
    expect(h.respondCalls).toEqual([{ invitationId: "inv-1", accept: true }]);
  });

  it("odrzucenie nazywa INNY skutek - to nie ten sam komunikat", async () => {
    await mount();
    const onRespond = h.organism.ClubInvitationInbox.onRespond;
    if (typeof onRespond !== "function") throw new Error("brak obsługi odpowiedzi");
    onRespond("inv-1", false);
    await waitFor(() => {
      expect(h.toastSuccess).toHaveBeenCalledWith("club.invitationDeclined");
    });
    expect(h.respondCalls).toEqual([{ invitationId: "inv-1", accept: false }]);
  });

  it("błąd RPC pokazuje KLUCZ i18n, nie surowy tekst z Postgresa", async () => {
    h.respondError = new Error("ERROR:  clubs: slug already taken (SQLSTATE 23505)");
    await mount();
    const onRespond = h.organism.ClubInvitationInbox.onRespond;
    if (typeof onRespond !== "function") throw new Error("brak obsługi odpowiedzi");
    onRespond("inv-1", true);
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.create.error.slug_taken");
    });
    const message = String(h.toastError.mock.calls.at(-1)?.[0]);
    expect(message).not.toContain("SQLSTATE");
  });

  it("błąd nierozpoznany degraduje do klucza ogólnego", async () => {
    h.respondError = new Error("connection reset");
    await mount();
    const onRespond = h.organism.ClubInvitationInbox.onRespond;
    if (typeof onRespond !== "function") throw new Error("brak obsługi odpowiedzi");
    onRespond("inv-1", true);
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.create.error.unknown");
    });
  });

  it("w czasie odpowiedzi skrzynka wie, KTÓRE zaproszenie jest w toku", async () => {
    // Bez tego wszystkie wiersze zamierają jednocześnie, więc użytkownik nie
    // wie, czy jego klik został przyjęty.
    h.respondPending = true;
    h.respondVars = { invitationId: "inv-1", accept: true };
    await mount();
    expect(h.organism.ClubInvitationInbox.pendingId).toBe("inv-1");
  });

  it("poza odpowiedzią żaden wiersz nie jest oznaczony jako w toku", async () => {
    h.respondPending = false;
    h.respondVars = { invitationId: "inv-1", accept: true };
    await mount();
    expect(h.organism.ClubInvitationInbox.pendingId).toBeNull();
  });

  it("odpowiedź w toku BEZ zmiennych mutacji nie wskazuje wiersza", async () => {
    h.respondPending = true;
    h.respondVars = null;
    await mount();
    expect(h.organism.ClubInvitationInbox.pendingId).toBeNull();
  });

  it("pusta lista zaproszeń nie zostawia nagłówka skrzynki", async () => {
    h.invitations = [];
    await mount();
    expect(screen.queryByTestId("ClubInvitationInbox")).toBeNull();
  });
});

// --- awaria katalogu -------------------------------------------------------

describe("awaria katalogu - hub nie ma z czego zbudować strony", () => {
  it("pokazuje komunikat awarii ZAMIAST wszystkich modułów", async () => {
    h.clubsError = true;
    await mount();
    expect(screen.getByTestId("ClubErrorNotice")).toBeTruthy();
    expect(screen.queryByTestId("ClubHubHero")).toBeNull();
    expect(screen.queryByTestId("ClubSpecializationGrid")).toBeNull();
  });

  it("komunikat awarii oferuje PONOWIENIE odczytu katalogu", async () => {
    h.clubsError = true;
    await mount();
    const onRetry = h.organism.ClubErrorNotice.onRetry;
    if (typeof onRetry !== "function") throw new Error("brak ponowienia");
    onRetry();
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("awaria katalogu dotyczy też gościa - nie pokazujemy mu mapy bez danych", async () => {
    h.session = null;
    h.clubsError = true;
    await mount();
    expect(screen.getByTestId("ClubErrorNotice")).toBeTruthy();
  });
});
