// `/club` - „pokaż więcej" NA ŻYWO: prawdziwa trasa, prawdziwy `useClubList`
// (react-query `useInfiniteQuery`), prawdziwa warstwa danych `fetchClubList`
// i atrapa RPC `club_list`, która tnie stronę DOKŁADNIE jak A13:
// `LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200) OFFSET p_offset`.
//
// CO TO DOWODZI. Błąd, który ten plik zamyka: „pokaż więcej" rosło przez
// `p_limit` (100 -> 200 -> 300) i zawsze czytało od zera. Po przywróceniu
// sufitu A13 (20261017130000) prośba o 300 wracała jako 200 wierszy - lista
// stawała na 200, licznik w przycisku dalej mówił o całości, a przycisk
// zostawał i nic nie robił. Atrapa hooka (`clubCatalogRoute.test.tsx`) tego
// nie złapie, bo nie zna sufitu ani offsetu; tu każda porcja przechodzi
// przez prawdziwy klucz cache'u, `getNextPageParam` i sklejenie porcji.
//
//   1. Druga porcja idzie z `p_offset = 100` i TYM SAMYM `p_limit = 100`.
//   2. 250 klubów: po dwóch kliknięciach na ekranie jest 250 kart (ponad
//      sufit 200), przycisk znika, a licznik równa się sumie z okna RPC.
//   3. Porcje nakładające się na styku (porządek przesunął się między
//      kliknięciami) dają każdy klub RAZ.
//   4. Nieudana porcja nie gasi huba: karty zostają, przycisk zostaje,
//      a ponowne kliknięcie dociąga brakującą porcję.
//
// CZEGO NIE DUBLUJE. Reguł offsetu i sklejania w izolacji
// (`hubCatalog.test.ts`), kontraktu hooka z atrapą warstwy danych
// (`clubHooks.test.tsx`), reszty huba (`clubCatalogRoute.test.tsx`).
// Organizmy są atrapami-markerami; katalog widać przez propsy paska obszarów
// (dostaje CAŁY wczytany katalog) i liczniki `ClubHubHero`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClubListRow } from "@/lib/clubs/types";

const h = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  /** Propsy zapisane przez atrapy organizmów. */
  organism: {} as Record<string, Record<string, unknown>>,
}));

vi.mock(
  "@/integrations/supabase/client",
  async () => (await import("@/test/clubs/fixtures")).clubSupabaseMock,
);
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: { user: { id: "user-me" } },
    user: { id: "user-me" },
    isStaff: false,
    loading: false,
  }),
}));
vi.mock("@/lib/billing/tiers", () => ({ useCurrentTier: () => ({ data: { rank: 20 } }) }));
vi.mock("@/hooks/useDebouncedValue", () => ({ useDebouncedValue: (value: string) => value }));
vi.mock("@/lib/clubs/useClubTopics", () => ({ useClubTopics: () => ({ topics: [] }) }));
// Katalog PRAWDZIWY (`useClubCatalog`), reszta bariery to stałe atrapy - one
// nie są przedmiotem tego dowodu, a ich prawdziwe wersje pukałyby do RPC,
// którego atrapa nie planuje.
vi.mock("@/lib/clubs/useClubs", async () => {
  const catalog = await import("@/lib/clubs/useClubCatalog");
  return {
    useClubList: catalog.useClubList,
    useClubSearch: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
    useMyClubInvitations: () => ({ data: [] }),
    useMyClubProposals: () => ({ data: [] }),
    useRespondClubInvitation: () => ({ mutate: vi.fn(), isPending: false, variables: null }),
  };
});

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
  ClubDirectory: organismStub("ClubDirectory"),
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
  ClubGlobalSearchInput: organismStub("ClubGlobalSearchInput"),
  ClubGlobalSearchResults: organismStub("ClubGlobalSearchResults"),
}));
vi.mock("@/components/clubs/molecules/ClubHubLayoutSwitch", () => ({
  ClubHubLayoutSwitch: organismStub("ClubHubLayoutSwitch"),
  useClubHubLayout: () => ["cards", () => {}],
}));
// Pasek obszarów dostaje CAŁY wczytany katalog - to jest okno na to, co hub
// ma w pamięci po sklejeniu porcji.
vi.mock("@/components/clubs/molecules/ClubTopicNav", () => ({
  ClubTopicNav: organismStub("ClubTopicNav"),
}));
vi.mock("@/components/clubs/molecules/ClubProposeDialog", () => ({
  ClubProposeDialog: organismStub("ClubProposeDialog"),
}));

import { fail } from "@/test/supabase/chain";
import type { RecordedRpc } from "@/test/supabase/rpc";
import { renderRoute } from "@/test/routeHarness";
import { clubListRow, clubRpc, resetClubRpc } from "@/test/clubs/fixtures";
import { Route as CatalogRoute } from "@/routes/club.index";

/** Sufit strony `club_list` w SQL (A13, 20261017130000). */
const SQL_PAGE_CAP = 200;

function club(i: number): ClubListRow {
  return clubListRow({
    id: `club-${String(i).padStart(3, "0")}`,
    slug: `klub-${i}`,
    name_pl: `Klub ${i}`,
    my_status: "",
    my_role: "",
  });
}

/**
 * `club_list` w porządku serwera: odpowiada wycinkiem po `p_offset` z limitem
 * przyciętym DOKŁADNIE jak `LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1),
 * 200) OFFSET GREATEST(COALESCE(p_offset, 0), 0)`, a `total_count` niesie
 * każdy wiersz (okno liczone przed LIMIT). Katalog czytany LENIWIE, więc test
 * może go zmienić między porcjami.
 */
function serveClubList(catalog: () => readonly ClubListRow[]): void {
  clubRpc.setResponse("club_list", (call: RecordedRpc) => {
    const all = catalog();
    const rawLimit = call.arg("p_limit");
    const rawOffset = call.arg("p_offset");
    const limit = Math.min(
      Math.max(typeof rawLimit === "number" ? rawLimit : 100, 1),
      SQL_PAGE_CAP,
    );
    const offset = Math.max(typeof rawOffset === "number" ? rawOffset : 0, 0);
    const rows = all
      .slice(offset, offset + limit)
      .map((row) => ({ ...row, total_count: all.length }));
    return { data: rows, error: null };
  });
}

function listCalls(): { p_limit: unknown; p_offset: unknown }[] {
  return clubRpc
    .callsFor("club_list")
    .map((call) => ({ p_limit: call.arg("p_limit"), p_offset: call.arg("p_offset") }));
}

/** Identyfikatory klubów, które hub ma w pamięci (pasek obszarów dostaje całość). */
function loadedIds(): string[] {
  const clubs = h.organism.ClubTopicNav?.clubs;
  return Array.isArray(clubs) ? clubs.map((row) => (row as ClubListRow).id) : [];
}

function heroClubCount(): unknown {
  const stats = h.organism.ClubHubHero?.stats as { clubs?: number } | undefined;
  return stats?.clubs;
}

function showMoreButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: /club\.hub\.showMore/ });
}

async function mount() {
  const rendered = await renderRoute({
    route: CatalogRoute,
    path: "/club/",
    initialEntry: "/club",
  });
  await waitFor(() => expect(loadedIds().length).toBeGreaterThan(0));
  return rendered;
}

async function clickShowMoreAndWait(expectedLoaded: number): Promise<void> {
  const button = showMoreButton();
  if (button === null) throw new Error("brak przycisku „pokaż więcej”");
  fireEvent.click(button);
  await waitFor(() => expect(loadedIds()).toHaveLength(expectedLoaded));
}

beforeEach(() => {
  cleanup();
  resetClubRpc("user-me");
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
  h.organism = {};
});

describe("„pokaż więcej” stronicuje po p_offset - sufit A13 nie zatrzymuje katalogu", () => {
  const CATALOG = Array.from({ length: 250 }, (_, i) => club(i));

  it("pierwsza porcja to p_limit 100 / p_offset 0, a przycisk mówi „100 z 250”", async () => {
    serveClubList(() => CATALOG);
    await mount();

    expect(listCalls()).toEqual([{ p_limit: 100, p_offset: 0 }]);
    expect(loadedIds()).toHaveLength(100);
    const button = showMoreButton();
    expect(button?.textContent).toContain("shown=100");
    expect(button?.textContent).toContain("total=250");
  });

  it("druga porcja idzie z p_offset = 100 i TYM SAMYM p_limit = 100", async () => {
    serveClubList(() => CATALOG);
    await mount();

    await clickShowMoreAndWait(200);

    expect(listCalls()).toEqual([
      { p_limit: 100, p_offset: 0 },
      { p_limit: 100, p_offset: 100 },
    ]);
    expect(loadedIds().slice(100, 102)).toEqual(["club-100", "club-101"]);
    const button = showMoreButton();
    expect(button?.textContent).toContain("shown=200");
    expect(button?.textContent).toContain("total=250");
  });

  it("250 klubów: po dwóch kliknięciach 250 kart, przycisk znika, licznik = suma", async () => {
    serveClubList(() => CATALOG);
    await mount();

    await clickShowMoreAndWait(200);
    await clickShowMoreAndWait(250);

    // Ponad sufit 200 - dokładnie tu rosnący `p_limit` stawał.
    expect(loadedIds()).toEqual(CATALOG.map((row) => row.id));
    expect(heroClubCount()).toBe(250);
    await waitFor(() => expect(showMoreButton()).toBeNull());
    expect(listCalls()).toEqual([
      { p_limit: 100, p_offset: 0 },
      { p_limit: 100, p_offset: 100 },
      { p_limit: 100, p_offset: 200 },
    ]);
    // Żadne wywołanie nie prosi o więcej, niż baza i tak odda.
    expect(listCalls().every((call) => Number(call.p_limit) <= SQL_PAGE_CAP)).toBe(true);
  });

  it("katalog mieszczący się w jednej porcji nie pokazuje przycisku wcale", async () => {
    serveClubList(() => CATALOG.slice(0, 40));
    await mount();

    expect(loadedIds()).toHaveLength(40);
    expect(showMoreButton()).toBeNull();
    expect(listCalls()).toHaveLength(1);
  });
});

describe("porcje nakładające się na styku - każdy klub RAZ", () => {
  it("dwa kluby weszły na początek porządku między kliknięciami - zero duplikatów", async () => {
    // Nowa aktywność podnosi klub na początek (`last_activity_at DESC`), więc
    // offset 100 liczy się od przesuniętej listy i zaczyna od dwóch ostatnich
    // kart porcji 1. Bez deduplikacji stałyby w katalogu dwa razy (dwa takie
    // same klucze Reacta, podwójne liczniki).
    let catalog: ClubListRow[] = Array.from({ length: 250 }, (_, i) => club(i));
    serveClubList(() => catalog);
    await mount();
    catalog = [club(900), club(901), ...catalog];

    fireEvent.click(showMoreButton() as HTMLElement);
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    await waitFor(() => expect(loadedIds()).toHaveLength(198));

    const ids = loadedIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "club-098")).toHaveLength(1);
    expect(ids.filter((id) => id === "club-099")).toHaveLength(1);
    // Offset liczy wiersze ODDANE przez serwer (200), nie unikalne (198) -
    // trzecia porcja nie pobiera ponownie tego samego styku.
    await clickShowMoreAndWait(250);
    expect(listCalls().at(-1)).toEqual({ p_limit: 100, p_offset: 200 });
    expect(new Set(loadedIds()).size).toBe(250);
    await waitFor(() => expect(showMoreButton()).toBeNull());
  });
});

describe("nieudana porcja nie gasi huba", () => {
  it("karty i przycisk zostają, toast mówi o awarii, ponowienie dociąga porcję", async () => {
    const catalog = Array.from({ length: 250 }, (_, i) => club(i));
    let failNext = true;
    clubRpc.setResponse("club_list", (call: RecordedRpc) => {
      const offset = Number(call.arg("p_offset"));
      if (offset === 100 && failNext) {
        failNext = false;
        return fail("canceling statement due to statement timeout", "57014");
      }
      const rows = catalog
        .slice(offset, offset + Number(call.arg("p_limit")))
        .map((row) => ({ ...row, total_count: catalog.length }));
      return { data: rows, error: null };
    });
    await mount();

    fireEvent.click(showMoreButton() as HTMLElement);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("club.loadError"));

    // Pierwsza porcja leży dalej na ekranie, zamiast zniknąć pod komunikatem.
    expect(screen.queryByTestId("ClubErrorNotice")).toBeNull();
    expect(loadedIds()).toHaveLength(100);
    await waitFor(() => expect(showMoreButton()?.hasAttribute("disabled")).toBe(false));

    await clickShowMoreAndWait(200);
    expect(listCalls().map((call) => call.p_offset)).toEqual([0, 100, 100]);
  });
});
