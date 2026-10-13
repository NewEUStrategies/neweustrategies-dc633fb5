// ZAKŁADKA „PARTNERZY" - ściana logotypów z oknem instytucji.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. KAFEL GUBI FAKT. Rola i stoisko zostają na kaflu; opis i strona
//      partnera przeszły do okna - test pilnuje, że są TAM, a nie nigdzie.
//   2. KLIK BEZ RAPORTU. Wyjście na stronę partnera stoi dziś w oknie i musi
//      liczyć się pod `partners_tab`; samo otwarcie okna klikiem NIE jest.
//   3. NIEMY PRZYCISK. Kilkanaście „Otwórz" bez nazwy firmy to dla czytnika
//      ekranu lista nierozróżnialnych pozycji.
//   4. ATRAPA PRZYCISKU. Bez dostawcy okien (podgląd studia) kafel jest
//      tekstem - przycisk, który niczego nie otwiera, kłamie.
//   5. PLAKIETKA SZKICU na stronie publicznej albo zdublowana przez okno.
//
// ATRAPY TYLKO NA GRANICACH: klient Supabase (RPC), `IntersectionObserver`
// i zależności trackera. Parser, hooki zapytań, katalog i okno są prawdziwe.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub } from "@/test/supabase/rpc";
import type { SponsorTrackerDeps } from "@/lib/events/sponsorTracking";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

const { SponsorTrackingProvider } = await import("@/lib/events/sponsorTrackingReact");
const { EventSponsorsSection } =
  await import("@/components/events/public/organisms/EventSponsorsSection");
const { EventPartnersTabView } =
  await import("@/components/events/public/organisms/EventPartnersTab");
const { EventDirectoryProvider } =
  await import("@/components/events/public/directory/EventDirectoryContext");
const { buildEventDirectory } = await import("@/lib/events/eventDirectory");
const { parseSponsorTiers } = await import("@/lib/events/sponsorsSurface");

const SP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SP_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
/** Sesja serwera (OPS-09) już w magazynie - pozycje idą beaconem z sesją. */
const SESSION = "f".repeat(64);
const DIALOG_WAIT = { timeout: 5000 };
const OPEN_NORDWIND = "eventFront.directory.openCompany(name=Nordwind Analytics)";

type Wire = Record<string, unknown>;

function sponsorWire(over: Wire = {}): Wire {
  return {
    id: SP_A,
    name: "Nordwind Analytics",
    logo: "https://cdn.example.org/nordwind.svg",
    url: "https://nordwind.example",
    description_pl: "Analityka ryzyka dla infrastruktury krytycznej.",
    description_en: null,
    country: "Polska",
    role: "sponsor",
    booth_label: "A12",
    sort_order: 0,
    ...over,
  };
}

function tierWire(over: Wire = {}): Wire {
  return {
    tier_id: "tier-gold",
    tier_key: "gold",
    tier_name_pl: "Złoty Partner",
    tier_name_en: "Gold Partner",
    tier_description_pl: "Najwyższy pakiet kongresu.",
    tier_description_en: null,
    tier_rank: 30,
    tier_accent_color: "#b8860b",
    tier_logo_size: "lg",
    benefits: [
      { id: "b1", label_pl: "Stoisko 12 m2", label_en: null },
      { id: "b2", label_pl: "Logo na scenie", label_en: null },
    ],
    sponsors: [
      sponsorWire(),
      sponsorWire({
        id: SP_B,
        name: "Beta Media",
        logo: null,
        url: null,
        role: "media_partner",
        booth_label: null,
        description_pl: null,
        sort_order: 1,
      }),
    ],
    ...over,
  };
}

const BRONZE = {
  tier_id: "tier-bronze",
  tier_key: "bronze",
  tier_name_pl: "Brązowy Partner",
  tier_name_en: "Bronze Partner",
  tier_description_pl: null,
  tier_description_en: null,
  tier_rank: 10,
  tier_accent_color: null,
  tier_logo_size: "sm",
  benefits: [],
  sponsors: [
    sponsorWire({ id: SP_C, name: "Cedr Consulting", url: null, link_mode: "none", logo: null }),
  ],
};

/** Sesja agendy wspierana przez partnera - źródło wzbogacające okna. */
const SPONSORED_SESSION = {
  id: "s-energia",
  starts_at: "2026-11-05T09:00:00Z",
  ends_at: "2026-11-05T10:00:00Z",
  timezone: "Europe/Warsaw",
  title_pl: "Panel: bezpieczeństwo energetyczne",
  title_en: null,
  session_sponsor_id: SP_A,
  session_sponsor_name: "Nordwind Analytics",
  speakers: [],
};

class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
  constructor(public callback: IntersectionObserverCallback) {
    FakeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  fire(ratio: number) {
    this.callback(
      [{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function trackerDeps() {
  const sent: { items: Record<string, string>[] }[] = [];
  const deps: SponsorTrackerDeps = {
    hasConsent: () => true,
    send: (_endpoint, payload) => {
      sent.push(payload as unknown as { items: Record<string, string>[] });
      return true;
    },
    exchange: async () => null,
    schedule: () => () => undefined,
    storage: () => ({ getItem: () => SESSION }) as unknown as Storage,
  };
  return { deps, items: () => sent.flatMap((batch) => batch.items) };
}

function withClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function tab(): ReactElement {
  return <EventSponsorsSection slug="kongres" placement="partners_tab" />;
}

/** Klik w odnośnik partnera nie może otworzyć okna happy-dom (ruch sieciowy). */
function stopNavigation(event: Event): void {
  event.preventDefault();
}

beforeEach(() => {
  document.addEventListener("click", stopNavigation);
  h.rpc = supabaseRpcStub();
  h.rpc.setData("event_sponsors_public", [tierWire(), BRONZE]);
  h.rpc.setData("event_agenda", []);
  FakeObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  cleanup();
  document.removeEventListener("click", stopNavigation);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("zakładka „Partnerzy” - kafle", () => {
  it("poziom ma nagłówek, licznik, opis i korzyści zdaniem; kafel - nazwę, rolę i stoisko", async () => {
    const { container } = withClient(tab());
    await screen.findByText("Beta Media");

    expect(screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent)).toEqual([
      "Złoty Partner",
      "Brązowy Partner",
    ]);
    expect(screen.getByText("eventFront.directory.partnersCount(count=2)")).toBeTruthy();
    expect(screen.getByText("eventFront.directory.partnersCount(count=1)")).toBeTruthy();
    expect(screen.getByText("Najwyższy pakiet kongresu.")).toBeTruthy();
    expect(screen.getByText("eventFront.sponsors.benefitsLabel")).toBeTruthy();
    expect(screen.getByText("Stoisko 12 m2")).toBeTruthy();
    expect(screen.getByText("Logo na scenie")).toBeTruthy();

    // Jedno `li` na partnera; rola i stoisko jedną linią, opis - dopiero w oknie.
    const nordwind = screen.getByText("Nordwind Analytics").closest("li");
    expect(nordwind?.textContent).toContain(
      "eventFront.sponsors.roles.sponsor · eventFront.sponsors.boothLabel(label=A12)",
    );
    expect(screen.getByText("Beta Media").closest("li")?.textContent).toContain(
      "eventFront.sponsors.roles.mediaPartner",
    );
    expect(screen.queryByText("Analityka ryzyka dla infrastruktury krytycznej.")).toBeNull();
    // Kafel nie wychodzi na zewnątrz - wyjście stoi w oknie.
    expect(container.querySelector("a")).toBeNull();
  });

  it("akcent poziomu jest kropką przy nazwie, a nie kolorem całego nagłówka", async () => {
    withClient(tab());
    const gold = await screen.findByRole("heading", { level: 2, name: "Złoty Partner" });
    expect(gold.getAttribute("style")).toBeNull();
    const dot = gold.querySelector<HTMLElement>("[aria-hidden='true']");
    expect(dot).not.toBeNull();
    expect(dot?.style.backgroundColor).not.toBe("");
    const bronze = screen.getByRole("heading", { level: 2, name: "Brązowy Partner" });
    expect(bronze.querySelector("[aria-hidden='true']")).toBeNull();
  });

  it("złoty kafel jest szerszy niż brązowy (szerokość z poziomu, nie z liczby logotypów)", async () => {
    const { container } = withClient(tab());
    await screen.findByText("Cedr Consulting");
    const [gold, bronze] = [...container.querySelectorAll("ul[style]")].map((list) =>
      Number(/minmax\(min\(([0-9.]+)rem/.exec(list.getAttribute("style") ?? "")?.[1]),
    );
    expect(gold).toBeGreaterThan(bronze);
  });

  it("logotyp jest ozdobą - nazwa firmy leci do czytnika ekranu raz", async () => {
    withClient(tab());
    await screen.findByText("Nordwind Analytics");
    const tile = screen.getByText("Nordwind Analytics").closest("li") as HTMLElement;
    expect(tile.querySelector("img")?.closest("[aria-hidden='true']")).not.toBeNull();
    const readAloud = within(tile)
      .getAllByText("Nordwind Analytics")
      .filter((node) => node.closest("[aria-hidden='true']") === null);
    expect(readAloud).toHaveLength(1);
  });
});

describe("zakładka „Partnerzy” - okno instytucji", () => {
  it("kafel jest przyciskiem z nazwą firmy, który otwiera okno z opisem, krajem i stroną", async () => {
    withClient(tab());
    const trigger = await screen.findByRole("button", { name: OPEN_NORDWIND });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.closest("li")?.className).toContain("group");
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", {}, DIALOG_WAIT);
    expect(
      within(dialog).getByRole("heading", { level: 2, name: "Nordwind Analytics" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("Analityka ryzyka dla infrastruktury krytycznej."),
    ).toBeTruthy();
    expect(within(dialog).getByText("Polska")).toBeTruthy();
    expect(within(dialog).getByText("eventFront.sponsors.boothLabel(label=A12)")).toBeTruthy();
    const link = within(dialog).getByRole("link");
    expect(link.getAttribute("href")).toBe("https://nordwind.example");
    expect(link.getAttribute("target")).toBe("_blank");
    // Odnośnik opłacony nie oddaje partnerowi rankingu - jak dawny kafel.
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("tryb `none` organizatora: okno partnera nie ma odnośnika", async () => {
    withClient(tab());
    fireEvent.click(
      await screen.findByRole("button", {
        name: "eventFront.directory.openCompany(name=Cedr Consulting)",
      }),
    );
    const dialog = await screen.findByRole("dialog", {}, DIALOG_WAIT);
    expect(within(dialog).getByRole("heading", { level: 2, name: "Cedr Consulting" })).toBeTruthy();
    expect(within(dialog).queryByRole("link")).toBeNull();
  });

  it("program śpi do sygnału zamiaru, potem okno pokazuje sesje wspierane przez partnera", async () => {
    h.rpc?.setData("event_agenda", [SPONSORED_SESSION]);
    withClient(tab());
    const trigger = await screen.findByRole("button", { name: OPEN_NORDWIND });
    // Wejście na zakładkę pyta wyłącznie o partnerów.
    expect(h.rpc?.names()).toEqual(["event_sponsors_public"]);

    fireEvent.focus(trigger);
    await waitFor(() => expect(h.rpc?.names()).toContain("event_agenda"));
    expect(h.rpc?.callsFor("event_sponsors_public")).toHaveLength(1);

    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", {}, DIALOG_WAIT);
    expect(await within(dialog).findByText("Panel: bezpieczeństwo energetyczne")).toBeTruthy();
    expect(within(dialog).getByText("eventFront.directory.supportedSessions")).toBeTruthy();
  });
});

describe("zakładka „Partnerzy” - pomiar dla raportu sponsora", () => {
  it("każdy kafel liczy wyświetlenie, a klik liczy dopiero odnośnik w oknie - pod `partners_tab`", async () => {
    const t = trackerDeps();
    withClient(
      <SponsorTrackingProvider eventSlug="kongres" deps={t.deps}>
        {tab()}
      </SponsorTrackingProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: OPEN_NORDWIND }));
    const dialog = await screen.findByRole("dialog", {}, DIALOG_WAIT);
    expect(t.items()).toEqual([]);

    fireEvent.click(within(dialog).getByRole("link"));
    expect(t.items()).toEqual([{ sponsor_id: SP_A, placement: "partners_tab", kind: "click" }]);

    // Trzy kafle, trzy obserwatory - okno nie dokłada własnego.
    expect(FakeObserver.instances).toHaveLength(3);
    vi.useFakeTimers();
    for (const observer of FakeObserver.instances) act(() => observer.fire(1));
    act(() => vi.advanceTimersByTime(1000));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    const views = t.items().slice(1);
    expect(views.map((item) => item.sponsor_id).sort()).toEqual([SP_A, SP_B, SP_C]);
    expect(new Set(views.map((item) => `${item.placement}:${item.kind}`))).toEqual(
      new Set(["partners_tab:view"]),
    );
  });
});

describe("EventPartnersTabView - rysunek bez zapytania", () => {
  const tiers = parseSponsorTiers([
    tierWire({
      sponsors: [sponsorWire(), sponsorWire({ id: SP_B, name: "Baltic Print", sort_order: 1 })],
    }),
  ] as never).map((tier) => ({
    ...tier,
    sponsors: tier.sponsors.map((sponsor) =>
      sponsor.id === SP_B ? { ...sponsor, isDraft: true } : sponsor,
    ),
  }));

  it("bez dostawcy okien kafel jest tekstem - ani jednego przycisku, bez ruchu przy najechaniu", () => {
    const { container } = render(<EventPartnersTabView tiers={tiers} />);
    expect(screen.getByText("Nordwind Analytics")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(container.querySelector("a")).toBeNull();
    const tiles = container.querySelectorAll("li.relative");
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) expect(tile.classList.contains("group")).toBe(false);
  });

  it("plakietka szkicu i przygaszony znak TYLKO z napisem od wołającego", () => {
    const plain = render(<EventPartnersTabView tiers={tiers} />);
    expect(plain.container.querySelector(".opacity-60")).toBeNull();
    expect(screen.queryByText("Nieogłoszony")).toBeNull();
    plain.unmount();

    const { container } = render(<EventPartnersTabView tiers={tiers} draftLabel="Nieogłoszony" />);
    const badge = screen.getByText("Nieogłoszony");
    expect(badge.closest("li")?.textContent).toContain("Baltic Print");
    expect(badge.closest("[aria-hidden='true']")).toBeNull();
    const dimmed = container.querySelectorAll(".opacity-60");
    expect(dimmed).toHaveLength(1);
    expect(dimmed[0].closest("li")?.textContent).toContain("Baltic Print");
  });

  it("pod dostawcą z zewnątrz (podgląd studia) okno działa, a strona partnera jest tekstem", async () => {
    const directory = buildEventDirectory({ sponsorTiers: tiers }, "pl");
    withClient(
      <EventDirectoryProvider directory={directory} slug={null} eventId={null} live={false}>
        <EventPartnersTabView tiers={tiers} draftLabel="Nieogłoszony" />
      </EventDirectoryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: OPEN_NORDWIND }));
    const dialog = await screen.findByRole("dialog", {}, DIALOG_WAIT);
    expect(within(dialog).getByText("nordwind.example")).toBeTruthy();
    expect(within(dialog).queryByRole("link")).toBeNull();
    // Okno nie powtarza plakietki - na stronie zostaje jedna.
    expect(screen.getAllByText("Nieogłoszony")).toHaveLength(1);
  });

  it("pusta lista mówi to samo zdanie, co sekcja na przeglądzie", () => {
    render(<EventPartnersTabView tiers={[]} />);
    expect(screen.getByText("eventFront.sections.sponsors.empty")).toBeTruthy();
  });
});
