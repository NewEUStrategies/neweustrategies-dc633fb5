// POMIAR EKSPOZYCJI SPONSORÓW na publicznej stronie wydarzenia (raport dla
// sponsora, F6): pas partnerów, sekcja i zakładka „Partnerzy”, znaczek
// sponsora w agendzie, materiały partnerów i reklama strony głównej.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. ZŁE MIEJSCE W RAPORCIE. Każda powierzchnia liczy się pod WŁASNYM
//      miejscem (`home_strip`, `partners_section`, `partners_tab`,
//      `agenda_session`, `agenda_track`, `materials`, `home_ad`) - sponsor
//      płaci za konkretne miejsca i raport ma je rozróżniać.
//   2. KLIK ZNACZKA AGENDY. Znaczek nie jest odnośnikiem, więc liczy się
//      wyłącznie wyświetlenie; baza i tak odrzuciłaby klik, ale front nie
//      powinien go wysyłać.
//   3. POMIAR BEZ DOSTAWCY. Te same komponenty rysuje podgląd w studiu - bez
//      dostawcy nie wolno obserwować ani liczyć kliknięć.
//   4. POMIAR BEZ ZGODY. Brak zgody marketingowej = nic nie wychodzi.
//   5. DOKĄD PROWADZI LOGOTYP. `link_mode` organizatora: `external` - adres
//      przekierowania, `none` - bez odnośnika, `exhibitor` (i nieznany tryb) -
//      strona firmy. Pas i sekcja muszą prowadzić w to samo miejsce.
//   6. REKLAMA: JEDEN EGZEMPLARZ, JEDNO WYŚWIETLENIE. Wariant wybiera szerokość
//      ekranu PO hydratacji, niewidoczny wariant nie istnieje w DOM-ie, a
//      zamknięta plansza nie liczy się jako wyświetlenie.
//   7. HYDRATACJA. Dostawca pomiaru nie zmienia znaczników serwera, a reklama
//      na serwerze nie rysuje niczego (bez rozjazdu przy hydratacji).
//
// ATRAPY TYLKO NA GRANICACH: klient Supabase (RPC), `IntersectionObserver`
// (happy-dom nie liczy widoczności) i zależności trackera (zgoda, beacon).
// Parsery, hooki zapytań, komponenty i `SponsorTrackingProvider` są prawdziwe.
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub } from "@/test/supabase/rpc";
import type { SponsorTrackerDeps } from "@/lib/events/sponsorTracking";
import type { AgendaSession, AgendaTrack } from "@/lib/events/agendaSurface";

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
const { EventSponsorTiers, EventSponsorTiersView } =
  await import("@/components/events/public/organisms/EventSponsorTiers");
const { EventMaterialsSection } =
  await import("@/components/events/public/organisms/EventMaterialsSection");
const { AgendaSessionCard } =
  await import("@/components/events/public/molecules/AgendaSessionCard");
const { EventHomeAd } = await import("@/components/events/public/molecules/EventHomeAd");
const { parseSponsorMaterials, parseSponsorTiers } = await import("@/lib/events/sponsorsSurface");
const { publicEventKeys } = await import("@/lib/events/usePublicEvent");

const SP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MAT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AD_1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const AD_2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SESSION = "f".repeat(32);

// ---------------------------------------------------------------- atrapy ---

class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(public callback: IntersectionObserverCallback) {
    FakeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
  fire(ratio: number) {
    // Rozłączony obserwator nie powiadamia - tak jak prawdziwy.
    if (this.disconnected) return;
    this.callback(
      [{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

interface Sent {
  event_slug: string;
  session: string;
  items: Record<string, string>[];
}

function trackerDeps(consent = true) {
  const sent: Sent[] = [];
  const deps: SponsorTrackerDeps = {
    hasConsent: () => consent,
    send: (_endpoint, payload) => {
      sent.push(payload as unknown as Sent);
      return true;
    },
    schedule: () => () => undefined,
    storage: () => null,
    randomId: () => SESSION,
  };
  return { deps, sent, items: () => sent.flatMap((batch) => batch.items) };
}

type Wire = Record<string, unknown>;

/** Kolejność kafli ustala parser (nazwa, kolejność) - asercja patrzy na zbiór. */
function bySponsor(items: Record<string, string>[]): Record<string, string>[] {
  return [...items].sort((a, b) => (a.sponsor_id ?? "").localeCompare(b.sponsor_id ?? ""));
}

function sponsorWire(over: Wire = {}): Wire {
  return {
    id: SP_A,
    name: "Nordwind Analytics",
    logo: null,
    url: "https://nordwind.example",
    description_pl: null,
    description_en: null,
    country: "PL",
    role: "sponsor",
    booth_label: null,
    sort_order: 0,
    ...over,
  };
}

function tierWire(sponsors: Wire[]): Wire {
  return {
    tier_id: "tier-gold",
    tier_key: "gold",
    tier_name_pl: "Złoty Partner",
    tier_name_en: "Gold Partner",
    tier_description_pl: null,
    tier_description_en: null,
    tier_rank: 30,
    tier_accent_color: null,
    tier_logo_size: "md",
    benefits: [],
    sponsors,
  };
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function tracked(node: ReactNode, deps: SponsorTrackerDeps, slug = "kongres"): ReactElement {
  return (
    <SponsorTrackingProvider eventSlug={slug} deps={deps}>
      {node}
    </SponsorTrackingProvider>
  );
}

function withClient(node: ReactElement, qc = client()) {
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

/** Wszystkie obserwowane elementy widoczne w 100% przez sekundę + wyjście ze strony. */
function seeEverything(): void {
  vi.useFakeTimers();
  for (const observer of FakeObserver.instances) act(() => observer.fire(1));
  act(() => vi.advanceTimersByTime(1000));
  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
}

let visibility: DocumentVisibilityState = "visible";

/** Klik w odnośnik partnera nie może otworzyć okna happy-dom (to byłby ruch sieciowy). */
function stopNavigation(event: Event): void {
  event.preventDefault();
}

beforeEach(() => {
  document.addEventListener("click", stopNavigation);
  document.addEventListener("auxclick", stopNavigation);
  h.rpc = supabaseRpcStub();
  FakeObserver.instances = [];
  visibility = "visible";
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() => {
  cleanup();
  document.removeEventListener("click", stopNavigation);
  document.removeEventListener("auxclick", stopNavigation);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ------------------------------------------------------- dokąd prowadzi ---

describe("link logotypu wg ustawienia organizatora (`link_mode`)", () => {
  it("parser liczy cel: external -> link_url, none -> brak, exhibitor/nieznany -> strona firmy", () => {
    const tiers = parseSponsorTiers([
      tierWire([
        sponsorWire({ id: "s1", link_mode: "external", link_url: "https://go.example/x" }),
        sponsorWire({ id: "s2", link_mode: "none", link_url: "https://go.example/y" }),
        sponsorWire({ id: "s3", link_mode: "exhibitor" }),
        sponsorWire({ id: "s4", link_mode: "portal" }),
        sponsorWire({ id: "s5" }),
        sponsorWire({ id: "s6", link_mode: "external", link_url: null }),
        sponsorWire({ id: "s7", link_mode: "exhibitor", url: null }),
      ]),
    ] as never);
    expect(tiers[0].sponsors.map((s) => [s.id, s.linkMode, s.href])).toEqual([
      ["s1", "external", "https://go.example/x"],
      ["s2", "none", null],
      ["s3", "exhibitor", "https://nordwind.example"],
      ["s4", "exhibitor", "https://nordwind.example"],
      ["s5", "exhibitor", "https://nordwind.example"],
      ["s6", "external", null],
      ["s7", "exhibitor", null],
    ]);
  });

  it("sekcja i pas prowadzą w TO SAMO miejsce, a tryb `none` nie jest odnośnikiem", async () => {
    h.rpc?.setData("event_sponsors_public", [
      tierWire([
        sponsorWire({ link_mode: "external", link_url: "https://go.example/kampania" }),
        sponsorWire({ id: SP_B, name: "Bez Linku SA", link_mode: "none" }),
      ]),
    ]);
    withClient(
      <>
        <EventSponsorTiers slug="kongres" />
        <EventSponsorsSection slug="kongres" />
      </>,
    );
    await screen.findAllByText("Bez Linku SA");
    const links = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .filter((href) => href !== null);
    expect(links).toEqual(["https://go.example/kampania", "https://go.example/kampania"]);
    for (const node of screen.getAllByText("Bez Linku SA")) expect(node.closest("a")).toBeNull();
  });
});

// ------------------------------------------------------------- partnerzy ---

describe("pas partnerów i sekcja „Partnerzy”", () => {
  beforeEach(() => {
    h.rpc?.setData("event_sponsors_public", [
      tierWire([sponsorWire(), sponsorWire({ id: SP_B, name: "Beta", url: null })]),
    ]);
  });

  it("bez dostawcy (podgląd w studiu) nic nie jest obserwowane", async () => {
    withClient(
      <>
        <EventSponsorTiers slug="kongres" />
        <EventSponsorsSection slug="kongres" />
      </>,
    );
    await screen.findAllByText("Beta");
    expect(FakeObserver.instances).toEqual([]);
  });

  it("pas liczy wyświetlenia pod `home_strip`, a klik odnośnika wychodzi od razu", async () => {
    const t = trackerDeps();
    withClient(tracked(<EventSponsorTiers slug="kongres" />, t.deps));
    await screen.findAllByText("Beta");
    const link = screen.getByRole("link");
    fireEvent.click(link);
    expect(t.items()).toEqual([{ sponsor_id: SP_A, placement: "home_strip", kind: "click" }]);
    // Środkowy przycisk (nowa karta) to też klik; prawy - nie.
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(t.items()).toHaveLength(2);
    seeEverything();
    expect(bySponsor(t.items().slice(2))).toEqual([
      { sponsor_id: SP_A, placement: "home_strip", kind: "view" },
      { sponsor_id: SP_B, placement: "home_strip", kind: "view" },
    ]);
    expect(t.sent.every((batch) => batch.event_slug === "kongres")).toBe(true);
  });

  it("sekcja liczy się pod `partners_section`, zakładka pod `partners_tab`", async () => {
    const section = trackerDeps();
    const first = withClient(tracked(<EventSponsorsSection slug="kongres" />, section.deps));
    await screen.findAllByText("Beta");
    fireEvent.click(screen.getByRole("link"));
    seeEverything();
    expect(section.items()[0]).toEqual({
      sponsor_id: SP_A,
      placement: "partners_section",
      kind: "click",
    });
    expect(bySponsor(section.items().slice(1))).toEqual([
      { sponsor_id: SP_A, placement: "partners_section", kind: "view" },
      { sponsor_id: SP_B, placement: "partners_section", kind: "view" },
    ]);
    first.unmount();
    vi.useRealTimers();
    FakeObserver.instances = [];

    const tab = trackerDeps();
    withClient(tracked(<EventSponsorsSection slug="kongres" placement="partners_tab" />, tab.deps));
    await screen.findAllByText("Beta");
    seeEverything();
    expect(new Set(tab.items().map((item) => item.placement))).toEqual(new Set(["partners_tab"]));
  });

  it("bez zgody marketingowej nic nie wychodzi - ani klik, ani wyświetlenie", async () => {
    const t = trackerDeps(false);
    withClient(tracked(<EventSponsorsSection slug="kongres" />, t.deps));
    await screen.findAllByText("Beta");
    fireEvent.click(screen.getByRole("link"));
    seeEverything();
    expect(t.sent).toEqual([]);
  });

  it("dostawca pomiaru nie zmienia znaczników serwera pasa partnerów", () => {
    const tiers = parseSponsorTiers([tierWire([sponsorWire()])] as never);
    const plain = renderToString(<EventSponsorTiersView tiers={tiers} />);
    const withProvider = renderToString(
      tracked(<EventSponsorTiersView tiers={tiers} />, trackerDeps().deps),
    );
    expect(withProvider).toBe(plain);
    expect(plain).toContain('href="https://nordwind.example"');
  });
});

// ---------------------------------------------------------------- agenda ---

function agendaTrack(over: Partial<AgendaTrack> = {}): AgendaTrack {
  return {
    id: "t1",
    key: "t1",
    namePl: "Energia",
    nameEn: null,
    accentColor: null,
    sponsor: null,
    ...over,
  };
}

function agendaSession(over: Partial<AgendaSession>): AgendaSession {
  return {
    id: "s1",
    eventId: "e1",
    parentSessionId: null,
    titlePl: "Sesja otwarcia",
    titleEn: null,
    descriptionPl: null,
    descriptionEn: null,
    affiliationPl: null,
    affiliationEn: null,
    startsAt: "2099-06-20T08:00:00Z",
    endsAt: "2099-06-20T09:00:00Z",
    timezone: "Europe/Warsaw",
    format: "onsite",
    status: "published",
    sortOrder: 1,
    chathamHouse: false,
    minTierRank: 0,
    requiresSignup: false,
    capacity: null,
    registeredCount: 0,
    seatsLeft: null,
    track: null,
    room: null,
    sponsor: null,
    hasStream: false,
    hasRecording: false,
    mySignupStatus: null,
    accessState: "open",
    speakers: [],
    ...over,
  };
}

function card(session: AgendaSession) {
  return (
    <AgendaSessionCard
      session={session}
      pending={false}
      signedIn={false}
      onSignup={() => undefined}
      onCancel={() => undefined}
    />
  );
}

describe("znaczek sponsora w agendzie", () => {
  it("sponsor sesji liczy się pod `agenda_session`, TYLKO jako wyświetlenie", () => {
    const t = trackerDeps();
    render(
      tracked(
        card(
          agendaSession({
            sponsor: { id: SP_A, name: "Orlen", logoUrl: null, role: "partner" },
            track: agendaTrack({ sponsor: { id: SP_B, name: "PGZ", logoUrl: null, role: null } }),
          }),
        ),
        t.deps,
      ),
    );
    fireEvent.click(screen.getByTitle("Orlen"));
    expect(t.sent).toEqual([]);
    seeEverything();
    expect(t.items()).toEqual([{ sponsor_id: SP_A, placement: "agenda_session", kind: "view" }]);
  });

  it("sponsor odziedziczony ze ścieżki liczy się pod `agenda_track`", () => {
    const t = trackerDeps();
    render(
      tracked(
        card(
          agendaSession({
            track: agendaTrack({ sponsor: { id: SP_B, name: "PGZ", logoUrl: null, role: null } }),
          }),
        ),
        t.deps,
      ),
    );
    seeEverything();
    expect(t.items()).toEqual([{ sponsor_id: SP_B, placement: "agenda_track", kind: "view" }]);
  });

  it("sesja bez sponsora niczego nie obserwuje", () => {
    render(tracked(card(agendaSession({})), trackerDeps().deps));
    expect(FakeObserver.instances).toEqual([]);
  });
});

// ------------------------------------------------------------- materiały ---

describe("materiały partnerów", () => {
  it("grupa liczy wyświetlenie pod `materials`, otwarcie pliku to `material_open`", async () => {
    h.rpc?.setData("event_sponsor_materials_public", [
      {
        id: MAT,
        sponsor_id: SP_A,
        sponsor_name: "Nordwind Analytics",
        sponsor_logo_url: null,
        tier_id: null,
        tier_name_pl: null,
        tier_name_en: null,
        tier_rank: 0,
        title_pl: "Raport rynku",
        title_en: null,
        kind: "document",
        url: "https://cdn.example.org/raport.pdf",
        sort_order: 0,
      },
    ]);
    const t = trackerDeps();
    withClient(tracked(<EventMaterialsSection slug="kongres" />, t.deps));
    const link = (await screen.findByText("Raport rynku")).closest("a") as HTMLElement;
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(t.items()).toEqual([
      { sponsor_id: SP_A, placement: "materials", kind: "material_open", material_id: MAT },
    ]);
    seeEverything();
    expect(t.items()[1]).toEqual({ sponsor_id: SP_A, placement: "materials", kind: "view" });
  });
});

// ------------------------------------------------------ reklama główna ---

function ad(id: string, over: Wire = {}): Wire {
  return {
    id,
    image_url: `https://cdn.example.org/${id}.webp`,
    image_mobile_url: "",
    link_url: "https://sponsor.example/oferta",
    alt_text: `Reklama ${id.slice(0, 2)}`,
    sponsor_id: SP_A,
    ...over,
  };
}

function viewport(desktop: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: desktop,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", (query: string) => {
    expect(query).toBe("(min-width: 1024px)");
    return media;
  });
  return {
    change(next: boolean) {
      media.matches = next;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

describe("reklama na stronie głównej", () => {
  beforeEach(() => {
    h.rpc?.setData("event_home_ads_for_viewer", [ad(AD_1), ad(AD_2, { link_url: "" })]);
    window.sessionStorage.clear();
  });

  it("komputer: JEDEN baner, wyświetlenie i klik pod `home_ad` z identyfikatorem reklamy", async () => {
    viewport(true);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const t = trackerDeps();
    withClient(tracked(<EventHomeAd slug="kongres" />, t.deps));
    const banner = await screen.findByRole("complementary", { name: "sponsorBoard.public.label" });
    expect(within(banner).getAllByRole("img")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(within(banner).getByRole("link"));
    seeEverything();
    // Sponsora reklamy baza bierze z wiersza reklamy - klient go nie podaje.
    expect(t.items()).toEqual([
      { placement: "home_ad", kind: "click", home_ad_id: AD_1 },
      { placement: "home_ad", kind: "view", home_ad_id: AD_1 },
    ]);
    expect(h.rpc?.lastCall("event_home_ads_for_viewer")?.arg("p_slug")).toBe("kongres");
  });

  it("telefon: plansza zamiast banera; reklama bez linku nie jest odnośnikiem", async () => {
    viewport(false);
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const t = trackerDeps();
    withClient(tracked(<EventHomeAd slug="kongres" />, t.deps));
    const dialog = await screen.findByRole("dialog", { name: "sponsorBoard.public.label" });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(within(dialog).queryByRole("link")).toBeNull();
    expect(within(dialog).getByRole("img").getAttribute("src")).toContain(AD_2);
    seeEverything();
    expect(t.items()).toEqual([{ placement: "home_ad", kind: "view", home_ad_id: AD_2 }]);
  });

  it("zamknięta plansza znika, zapamiętuje zamknięcie i NIE liczy wyświetlenia", async () => {
    viewport(false);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const t = trackerDeps();
    const first = withClient(tracked(<EventHomeAd slug="kongres" />, t.deps));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "sponsorBoard.public.close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    seeEverything();
    expect(t.sent).toEqual([]);
    expect(window.sessionStorage.getItem(`nes-ad-closed-${AD_1}`)).toBe("1");
    first.unmount();
    vi.useRealTimers();

    // Ponowne wejście w tej samej karcie: plansza się nie pokazuje.
    withClient(tracked(<EventHomeAd slug="kongres" />, t.deps));
    await waitFor(() => expect(h.rpc?.names().length).toBeGreaterThan(1));
    await act(async () => undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("zablokowany sessionStorage nie wywraca planszy", async () => {
    viewport(false);
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    withClient(<EventHomeAd slug="kongres" />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "sponsorBoard.public.close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("obrót ekranu przełącza wariant bez drugiego egzemplarza", async () => {
    const screenSize = viewport(true);
    vi.spyOn(Math, "random").mockReturnValue(0);
    withClient(<EventHomeAd slug="kongres" />);
    await screen.findByRole("complementary");
    screenSize.change(false);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("brak reklam i przeglądarka bez matchMedia: nic, a bez reklam - bez obserwatora", async () => {
    h.rpc?.setData("event_home_ads_for_viewer", []);
    vi.stubGlobal("matchMedia", undefined);
    const { container } = withClient(tracked(<EventHomeAd slug="kongres" />, trackerDeps().deps));
    await waitFor(() => expect(h.rpc?.names()).toEqual(["event_home_ads_for_viewer"]));
    await act(async () => undefined);
    expect(container.innerHTML).toBe("");
    expect(FakeObserver.instances).toEqual([]);
  });

  it("bez matchMedia wariantem jest baner", async () => {
    vi.stubGlobal("matchMedia", undefined);
    vi.spyOn(Math, "random").mockReturnValue(0);
    withClient(<EventHomeAd slug="kongres" />);
    expect(await screen.findByRole("complementary")).toBeTruthy();
  });

  it("serwer nie rysuje reklamy, a hydratacja przechodzi bez rozjazdu i dopiero wtedy losuje", async () => {
    viewport(true);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const qc = client();
    qc.setQueryData(["event-home-ads-public", "kongres"], [ad(AD_1)]);
    const view = (
      <QueryClientProvider client={qc}>
        {tracked(<EventHomeAd slug="kongres" />, trackerDeps().deps)}
      </QueryClientProvider>
    );
    const html = renderToString(view);
    expect(html).toBe("");
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(host, view, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(host.querySelector("aside img")?.getAttribute("alt")).toBe("Reklama dd");
    act(() => root.unmount());
    host.remove();
  });
});

// ------------------------------------------------------------ hydratacja ---

describe("hydratacja powierzchni z pomiarem", () => {
  function seeded(): QueryClient {
    const qc = client();
    qc.setQueryData(
      publicEventKeys.sponsors("kongres"),
      parseSponsorTiers([
        tierWire([sponsorWire(), sponsorWire({ id: SP_B, name: "Beta", url: null })]),
      ] as never),
    );
    qc.setQueryData(
      publicEventKeys.materials("kongres"),
      parseSponsorMaterials([
        {
          id: MAT,
          sponsor_id: SP_A,
          sponsor_name: "Nordwind Analytics",
          sponsor_logo_url: null,
          tier_id: null,
          tier_name_pl: null,
          tier_name_en: null,
          tier_rank: 0,
          title_pl: "Raport rynku",
          title_en: null,
          kind: "document",
          url: "https://cdn.example.org/raport.pdf",
          sort_order: 0,
        },
      ] as never),
    );
    return qc;
  }

  const surfaces = (): ReactElement => (
    <>
      <EventSponsorTiers slug="kongres" />
      <EventSponsorsSection slug="kongres" />
      <EventMaterialsSection slug="kongres" />
      {card(
        agendaSession({
          sponsor: { id: SP_A, name: "Orlen", logoUrl: null, role: "partner" },
        }),
      )}
    </>
  );

  it("dostawca pomiaru nie zmienia ani jednego znacznika serwera", () => {
    const plain = renderToString(
      <QueryClientProvider client={seeded()}>{surfaces()}</QueryClientProvider>,
    );
    const measured = renderToString(
      <QueryClientProvider client={seeded()}>
        {tracked(surfaces(), trackerDeps().deps)}
      </QueryClientProvider>,
    );
    expect(measured).toBe(plain);
    // Treść naprawdę się narysowała - porównanie pustych napisów nie dowodzi niczego.
    expect(plain).toContain("Nordwind Analytics");
    expect(plain).toContain("Raport rynku");
    expect(plain).toContain("Orlen");
  });

  it("hydratacja z pomiarem przechodzi bez rozjazdu, a obserwatory startują dopiero po niej", async () => {
    const t = trackerDeps();
    const view = (
      <QueryClientProvider client={seeded()}>{tracked(surfaces(), t.deps)}</QueryClientProvider>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(view);
    document.body.append(host);
    expect(FakeObserver.instances).toEqual([]);
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(host, view, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    // Pas (2), sekcja (2), grupa materiałów (1), znaczek agendy (1).
    expect(FakeObserver.instances).toHaveLength(6);
    expect(t.sent).toEqual([]);
    act(() => root.unmount());
    host.remove();
  });
});
