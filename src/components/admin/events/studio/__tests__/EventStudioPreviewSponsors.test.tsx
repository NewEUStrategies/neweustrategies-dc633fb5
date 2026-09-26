// PARTNERZY W PODGLADZIE STUDIA - od wiersza RPC panelu do rysunku kanwy.
//
// PO CO OSOBNY PLIK. `EventStudioPreview.test.tsx` stawia kanwe jako ATRAPE
// (ma wlasna bramke parytetu), wiec nie widzi, co z partnerow zostaje na
// ekranie. Zgloszenie brzmialo „sponsorzy nie sa widoczni w podgladzie
// panelu" i mialo TRZY przyczyny naraz, kazda w innym miejscu lancucha:
//   1. nakladka pytala tylko o przypiecia OGLOSZONE, a tablica „Sponsorzy
//      i reklama" zapisuje nowe logo jako nieogloszone - pas byl pusty;
//   2. strona glowna podgladu nie miala sekcji „Partnerzy" (kafle z opisem
//      poziomu i korzysciami), bo podglad dostawal tylko dojazd i kontakt;
//   3. zakladka „Partnerzy" nie rysowala partnerow wcale.
// Ten plik idzie CALYM lancuchem: atrapa RPC -> `sponsorTiersFromAdminRows`
// -> `live.sponsorTiers` -> prawdziwa kanwa -> prawdziwe komponenty publiczne.
//
// I JEDNA RZECZ, KTORA SIE NIE MOZE ZMIENIC. Sponsor przy SESJI programu nadal
// idzie tylko z przypiecia ogloszonego (tak jak w publicznym `event_agenda`) -
// pokazanie nieogloszonych partnerow w pasie nie moze przy okazji obiecac
// logotypu przy sesji.
//
// CZEGO SWIADOMIE NIE DUBLUJE. Parytetu ukladu kanwy ze strona publiczna
// (`eventPreviewPublicParity.gate.test.tsx`), mapowania wierszy
// (`sponsorsPreview.test.ts`) i rysunku kafli oraz pasa
// (`eventSponsorsSurfaces.test.tsx`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { STUDIO_EVENT_ID, adminEventSessionRow } from "@/test/events/adminEventStudioRows";
import {
  EMPTY_EVENT_PREVIEW,
  type EventPreviewModel,
} from "@/components/admin/events/studio/EventStudioPreviewContext";
import type { EventSponsorRow, EventSponsorTierRow } from "@/lib/events/sponsorsApi";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  db: null as SupabaseFromStub | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
    from: (table: string) => {
      if (h.db === null) throw new Error("test: atrapa lancucha nie zostala ustawiona");
      return h.db.from(table);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// Nakladki slownikow rejestruja sie efektem ubocznym i ciagna rdzen i18n - ten
// plik mierzy, CO sie rysuje, a nie brzmienie napisow (klucz = napis).
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-community", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-event-front", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-cart", () => ({ ensureI18n: () => undefined }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/profile/useViewerCard", () => ({ useViewerCardFacts: () => null }));
vi.mock("@/lib/admin/community", () => ({ fetchEventSpeakers: vi.fn(async () => []) }));
// Dokument CMS podstrony i zakladka uczestnika maja wlasne testy; tutaj sa
// pustymi atrapami, bo przedmiotem dowodu jest tresc Z BAZY pod dokumentem.
vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({ BuilderRenderer: () => null }));
vi.mock("@/components/admin/events/studio/PreviewMePanel", () => ({ PreviewMePanel: () => null }));

const { EventStudioPreview } = await import("@/components/admin/events/studio/EventStudioPreview");
const { EventStudioPreviewProvider } =
  await import("@/components/admin/events/studio/EventStudioPreviewContext");

const P = "adminEvents.studio.preview.";
const DRAFT = `${P}sponsorDraftBadge`;

/** Ogloszony partner poziomu „Zloty". */
const NORDWIND = "Nordwind Analytics";
/** Partner dodany z tablicy - NIEOGLOSZONY. */
const BALTIC = "Baltic Print";

function sponsorRow(patch: Partial<EventSponsorRow>): EventSponsorRow {
  return {
    booth_label: "",
    company_id: "c1",
    contacts_count: 0,
    created_at: "2026-09-01T10:00:00.000Z",
    crm_city: "",
    crm_country: "",
    crm_drift: false,
    crm_drift_fields: [],
    crm_logo_url: "",
    crm_name: "",
    crm_website: "",
    event_id: STUDIO_EVENT_ID,
    id: "sp-nordwind",
    is_published: true,
    materials_count: 0,
    published_materials_count: 0,
    role: "sponsor",
    snapshot_country: "",
    snapshot_description_en: "",
    snapshot_description_pl: "",
    snapshot_logo_url: "",
    snapshot_name: NORDWIND,
    snapshot_source: "crm",
    snapshot_taken_at: "2026-09-01T10:00:00.000Z",
    snapshot_website: "",
    sort_order: 10,
    tier_accent_color: "",
    tier_id: "t-gold",
    tier_key: "gold",
    tier_logo_size: "md",
    tier_name_en: "Gold partners",
    tier_name_pl: "Złoci partnerzy",
    tier_rank: 10,
    total_count: 2,
    updated_at: "2026-09-01T10:00:00.000Z",
    ...patch,
  };
}

function tierRow(): EventSponsorTierRow {
  return {
    accent_color: "",
    benefits: [{ id: "b1", label_pl: "Stoisko 12 m2", label_en: "12 sqm booth", sort_order: 1 }],
    created_at: "2026-09-01T10:00:00.000Z",
    description_en: "Top package",
    description_pl: "Najwyższy pakiet",
    event_id: STUDIO_EVENT_ID,
    id: "t-gold",
    is_active: true,
    key: "gold",
    logo_size: "md",
    max_companies: 0,
    name_en: "Gold partners",
    name_pl: "Złoci partnerzy",
    published_sponsors_count: 1,
    rank: 10,
    slots_left: 0,
    sort_order: 10,
    sponsors_count: 2,
    updated_at: "2026-09-01T10:00:00.000Z",
  };
}

const MENU: EventPreviewModel["menu"] = [
  {
    key: "menu-agenda",
    pageId: "page-agenda",
    path: "program",
    label: "Program",
    icon: "calendar",
    color: "",
    module: "agenda",
  },
  {
    key: "menu-partners",
    pageId: "page-partners",
    path: "partnerzy",
    label: "Partnerzy",
    icon: "handshake",
    color: "",
    module: "partners",
  },
];

function Provider({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function nakladka() {
  const model: EventPreviewModel = {
    ...EMPTY_EVENT_PREVIEW,
    titlePl: "Kongres Energetyczny",
    slug: "kongres-energetyczny",
    timezone: "Europe/Warsaw",
    menu: MENU,
  };
  return render(
    <Provider>
      <EventStudioPreviewProvider base={model}>
        <EventStudioPreview
          open
          onOpenChange={() => undefined}
          publicHref={null}
          eventId={STUDIO_EVENT_ID}
        />
      </EventStudioPreviewProvider>
    </Provider>,
  );
}

/**
 * Sekcja „Partnerzy" strony glownej - `EventPageSections` nadaje jej kotwice
 * `#event-sponsors` (ta sama na stronie publicznej, cel spisu sekcji).
 */
function sekcjaPartnerow(): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector<HTMLElement>("#event-sponsors");
    if (found === null) throw new Error("brak sekcji #event-sponsors");
    return found;
  });
}

/** Przejscie do podstrony przez zakladke paska - tak, jak kliknie organizator. */
function otworzZakladke(nazwa: string): void {
  const tabs = screen.getByRole("navigation", { name: "eventFront.header.tabsLabel" });
  act(() => {
    fireEvent.click(within(tabs).getByRole("button", { name: nazwa }));
  });
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.db = supabaseFromStub();
  h.rpc.setData("admin_event_sponsors_list", [
    sponsorRow({}),
    sponsorRow({
      id: "sp-baltic",
      snapshot_name: BALTIC,
      is_published: false,
      sort_order: 20,
      snapshot_website: "https://baltic.example.com",
    }),
  ]);
  h.rpc.setData("admin_event_sponsor_tiers_list", [tierRow()]);
  h.rpc.setData("admin_event_sessions_list", [
    adminEventSessionRow({
      id: "5a1c0000-0000-4000-8000-0000000000b1",
      title_pl: "Panel partnera nieogloszonego",
      sponsor_id: "sp-baltic",
      sponsor_name: BALTIC,
      sponsor_role: "sponsor",
    }),
    adminEventSessionRow({
      id: "5a1c0000-0000-4000-8000-0000000000a1",
      title_pl: "Panel partnera ogloszonego",
      starts_at: "2026-09-01T11:00:00.000Z",
      ends_at: "2026-09-01T12:00:00.000Z",
      sponsor_id: "sp-nordwind",
      sponsor_name: NORDWIND,
      sponsor_role: "sponsor",
    }),
  ]);
  h.rpc.setData("admin_event_tracks_list", []);
  h.rpc.setData("admin_event_registrations_list", []);
  h.db.setResponse("pages", ok({ builder_data: null }));
});

afterEach(cleanup);

describe("podglad studia - partnerzy na stronie glownej", () => {
  it("pas pokazuje TAKZE partnera nieogloszonego - przygaszonego, z plakietka", async () => {
    nakladka();

    const sekcja = await sekcjaPartnerow();
    await waitFor(() => expect(within(sekcja).getAllByText(BALTIC).length).toBeGreaterThan(0));
    // Pas stoi przed sekcja „Partnerzy". Partner ze strona WWW jest w pasie
    // odnosnikiem, a jego nazwa (dla czytnika) mowi, dokad prowadzi - plakietka
    // wchodzi do tej nazwy, bo nie jest pod `aria-hidden`.
    const odnosnik = screen
      .getAllByRole("link")
      .find((link) => !sekcja.contains(link) && link.textContent?.includes(BALTIC));
    expect(odnosnik?.getAttribute("href")).toBe("https://baltic.example.com");
    expect(within(odnosnik as HTMLElement).getByText(DRAFT)).toBeInTheDocument();
    // Ogloszony partner bez strony WWW stoi w pasie bez plakietki.
    const ogloszony = screen
      .getAllByText(NORDWIND)
      .find((node) => !sekcja.contains(node) && node.closest("[aria-hidden='true']") === null);
    expect(ogloszony?.closest("li")?.textContent).not.toContain(DRAFT);
  });

  it("sekcja „Partnerzy” staje na stronie glownej z opisem i korzysciami poziomu", async () => {
    const { container } = nakladka();

    const sekcja = await sekcjaPartnerow();
    await waitFor(() => expect(within(sekcja).getAllByText(BALTIC).length).toBeGreaterThan(0));
    expect(within(sekcja).getByText("Najwyższy pakiet")).toBeInTheDocument();
    expect(within(sekcja).getByText("Stoisko 12 m2")).toBeInTheDocument();
    // Kafel nieogloszonego partnera niesie plakietke, ogloszonego - nie.
    const kafle = within(sekcja)
      .getAllByRole("listitem")
      .filter((li) => li.querySelector("a, div"));
    const kafelSzkicu = kafle.find((li) => li.textContent?.includes(BALTIC));
    const kafelOgloszony = kafle.find((li) => li.textContent?.includes(NORDWIND));
    expect(kafelSzkicu?.textContent).toContain(DRAFT);
    expect(kafelOgloszony?.textContent).not.toContain(DRAFT);
    // Strona glowna podgladu nie ma sekcji z bazy, ktorej nakladka nie zna.
    expect(container.querySelector("#event-materials")).toBeNull();
    expect(container.querySelector("#event-agenda")).toBeNull();
  });

  it("strona glowna z partnerami (takze nieogloszonymi) nie ma naruszen axe", async () => {
    const { container } = nakladka();
    await sekcjaPartnerow();
    await waitFor(() => expect(new Set(h.rpc?.names()).size).toBeGreaterThanOrEqual(5));

    // `heading-order` wylaczone SWIADOMIE i tylko tutaj. Pas stoi tam, gdzie
    // na stronie publicznej - zaraz pod `h1` przegladu - a nazwa poziomu w pasie
    // jest `h3` (`EventSponsorTiersView`). Strona publiczna ma ten sam skok
    // h1 -> h3 (regula „best-practice", nie WCAG); podglad ma go odwzorowac,
    // a nie poprawiac po swojemu. Poprawka nalezy do publicznego pasa.
    const naruszenia = await axeViolations(container, { "heading-order": { enabled: false } });
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

describe("podglad studia - podstrony", () => {
  it("zakladka „Partnerzy” rysuje partnerow pod dokumentem CMS - z plakietka przy nieogloszonym", async () => {
    nakladka();
    await sekcjaPartnerow();

    otworzZakladke("Partnerzy");

    const strona = await screen.findByTestId("event-preview-page");
    await waitFor(() => expect(within(strona).getAllByText(BALTIC).length).toBeGreaterThan(0));
    expect(within(strona).getAllByText(NORDWIND).length).toBeGreaterThan(0);
    expect(within(strona).getByText(DRAFT)).toBeInTheDocument();
    expect(within(strona).queryByText(`${P}moduleEmptyPartners`)).toBeNull();
  });

  it("program NIE przypina sesji partnera nieogloszonego - jak publiczne `event_agenda`", async () => {
    nakladka();
    await sekcjaPartnerow();

    otworzZakladke("Program");

    const strona = await screen.findByTestId("event-preview-page");
    await within(strona).findByText("Panel partnera nieogloszonego");
    // Sesja ogloszonego partnera ma jego nazwe, sesja nieogloszonego - zadnej.
    expect(within(strona).getByText(NORDWIND)).toBeInTheDocument();
    expect(within(strona).queryByText(BALTIC)).toBeNull();
  });
});
