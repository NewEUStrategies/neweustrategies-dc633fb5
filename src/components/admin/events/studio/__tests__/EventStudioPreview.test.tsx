// PODGLAD NA ZYWO - pelnoekranowa NAKLADKA nad studiem wydarzenia.
//
// PO CO TEN PLIK ISTNIEJE. Nakladka jest jedynym miejscem w panelu, w ktorym
// redaktor widzi to, co zobaczy uczestnik - i jednoczesnie najdrozszym: przy
// otwarciu ciagnie program, prelegentow, uczestnikow, partnerow i dokument
// wybranej podstrony. Dwie rzeczy musza tu byc prawda naraz: ZAMKNIETY PODGLAD
// NIE KOSZTUJE NIC, a OTWARTY pokazuje dane szkicu, nie pustke z projekcji
// publicznej.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. ZAMKNIETA NAKLADKA ZACZYNA PYTAC. `enabled: open` w szesciu zapytaniach
//      to szesc miejsc na literowke. Skutek jest niewidoczny na ekranie: kazde
//      wejscie na dowolna sekcje studia ciagnie liste zgloszen i partnerow,
//      ktorych nikt nie oglada.
//   2. NAKLADKA PRZESTAJE BYC STANEM I STAJE SIE TRASA. Wyjscie z podgladu
//      przeladowuje wtedy ekran, a niezapisany szkic formularza ginie po
//      drodze. Dowodem jest to, ze zamkniecie wola `onOpenChange`, a nie
//      nawigacje - i ze „wroc do listy wydarzen" robi OBIE rzeczy naraz.
//   3. ESCAPE PRZESTAJE ZAMYKAC. Nakladka zabiera caly ekran, wiec bez Escape
//      jedynym wyjsciem jest trafienie w jeden przycisk w pasku.
//   4. SZKIC DOSTAJE ODNOSNIK DO STRONY, KTOREJ NIE MA. „Otworz strone
//      publiczna" przy szkicu prowadzi na 404 - odnosnika ma po prostu nie byc.
//   5. WYBOR PODSTRONY GUBI SIE PRZY ODSWIEZENIU. Menu i dokument przychodza
//      z zapytan; kazde ponowne pobranie na moment oddaje pustke, a podglad,
//      ktory czytalby tylko `base.menu`, wracalby na strone glowna „sam
//      z siebie". Dlatego cel nawigacji nosi WLASNA kopie etykiety i sciezki.
//   6. PUSTA LISTA PARTNEROW UDAJE „BRAK PARTNEROW". Kanwa dostaje obok wierszy
//      STATUS listy: wczytywanie, awaria (zdaniem o ODCZYCIE, nie „nie
//      zapisano zmian") albo odpowiedz - a wylaczone zapytanie (brak
//      wydarzenia) nie wczytuje sie w nieskonczonosc.
//   7. NIEOGLOSZONE PRZYPIECIA WYPYCHAJA OGLOSZONE. Jedna strona RPC to
//      najwyzej 200 wierszy, posortowanych ranga poziomu - 180 ogloszonych
//      i 30 nieogloszonych gubilo wtedy ogloszonych z konca listy i wylaczalo
//      filtr sponsora przy pasmach. Nakladka czyta liste strona po stronie az do
//      `total_count`, a filtr wylacza dopiero PRAWDZIWE uciecie (twardy stop).
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Rysunku strony - `EventPreviewCanvas` ma
// wlasna bramke parytetu (`eventPreviewPublicParity.gate.test.tsx`); tutaj stoi
// atrapa, ktora ZAPISUJE otrzymany model. (2) Mapowan `previewLiveData` - maja
// wlasny plik; tu dowodzimy, ze zapytania w ogole leca i po TO wydarzenie.
// (3) Powierzchni podstron modulowych - `EventPreviewLiveModule.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { STUDIO_EVENT_ID } from "@/test/events/adminEventStudioRows";
import {
  EMPTY_EVENT_PREVIEW,
  type EventPreviewModel,
} from "@/components/admin/events/studio/EventStudioPreviewContext";
import type { EventPreviewLiveData } from "@/components/admin/events/studio/EventPreviewLiveModule";
import type { EventSponsorRow } from "@/lib/events/sponsorsApi";
import type { EventTrackRow } from "@/lib/events/sessionsApi";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  db: null as SupabaseFromStub | null,
  navigate: vi.fn(),
  /** Kolejne rysunki kanwy - model, urzadzenie i zywe fakty, w kolejnosci. */
  rysunki: [] as {
    device: string;
    model: EventPreviewModel;
    live: EventPreviewLiveData;
  }[],
  /** Ostatnie `onNavigate` / `onBack` przekazane kanwie. */
  nawiguj: null as ((target: { key: string; pageId: string } | null) => void) | null,
  wroc: null as (() => void) | null,
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
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => h.navigate,
}));

// Tozsamosc widza nalezy do SESJI, nie do szkicu - i ma wlasna warstwe danych.
vi.mock("@/lib/profile/useViewerCard", () => ({ useViewerCardFacts: () => null }));

// Rejestr prelegentow czyta osobna warstwa panelu spolecznosci; tutaj liczy sie
// wylacznie to, CZY i KIEDY nakladka o niego pyta.
vi.mock("@/lib/admin/community", () => ({ fetchEventSpeakers: vi.fn(async () => []) }));

// Kanwa ma wlasna bramke parytetu ze strona publiczna. Atrapa ZAPISUJE model
// i oddaje dwa wejscia, ktorych wlascicielem jest nakladka: nawigacje po menu
// i powrot do listy wydarzen.
vi.mock("@/components/admin/events/studio/EventPreviewCanvas", () => ({
  PREVIEW_WIDTHS: { desktop: 1240, mobile: 390 },
  EventPreviewCanvas: (props: {
    device: string;
    model: EventPreviewModel;
    live: EventPreviewLiveData;
    onNavigate: (target: { key: string; pageId: string } | null) => void;
    onBack: () => void;
  }) => {
    h.rysunki.push({
      device: props.device,
      model: props.model,
      live: props.live,
    });
    h.nawiguj = props.onNavigate;
    h.wroc = props.onBack;
    return <div data-testid="kanwa" data-device={props.device} />;
  },
}));

const { EventStudioPreview } = await import("@/components/admin/events/studio/EventStudioPreview");
const { EventStudioPreviewProvider } =
  await import("@/components/admin/events/studio/EventStudioPreviewContext");

const P = "adminEvents.studio.preview.";

/** Pozycja menu podgladu - modulowa, bo ona niesie zywe dane. */
const POZYCJA_PROGRAM = {
  key: "menu-agenda",
  pageId: "page-agenda",
  path: "/program",
  label: "Program",
  icon: "calendar",
  color: "",
  // `module` jest UNIA WARTOSCI, nie napisem - bez `as const` literal rozszerza
  // sie do `string` i pozycja przestaje pasowac do `EventMenuDraftItem`.
  module: "agenda" as const,
};

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function Provider({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function nakladka(
  options: {
    open?: boolean;
    publicHref?: string | null;
    onOpenChange?: (open: boolean) => void;
    base?: Partial<EventPreviewModel>;
    eventId?: string;
  } = {},
) {
  const model: EventPreviewModel = {
    ...EMPTY_EVENT_PREVIEW,
    titlePl: "Kongres Energetyczny",
    slug: "kongres-energetyczny",
    menu: [POZYCJA_PROGRAM],
    ...options.base,
  };
  return render(
    <Provider>
      <EventStudioPreviewProvider base={model}>
        <EventStudioPreview
          open={options.open ?? true}
          onOpenChange={options.onOpenChange ?? (() => undefined)}
          publicHref={options.publicHref ?? null}
          eventId={options.eventId ?? STUDIO_EVENT_ID}
        />
      </EventStudioPreviewProvider>
    </Provider>,
  );
}

/** Ostatni model, ktory dojechal do kanwy. */
function ostatniModel(): EventPreviewModel {
  const rysunek = h.rysunki.at(-1);
  if (rysunek === undefined) throw new Error("test: kanwa nie zostala narysowana");
  return rysunek.model;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.db = supabaseFromStub();
  h.navigate.mockClear();
  h.rysunki = [];
  h.nawiguj = null;
  h.wroc = null;
  stub().setData("admin_event_sponsors_list", []);
  stub().setData("admin_event_sponsor_tiers_list", []);
  stub().setData("admin_event_sessions_list", []);
  stub().setData("admin_event_tracks_list", []);
  stub().setData("admin_event_registrations_list", []);
  h.db.setResponse("pages", ok({ builder_data: null }));
});

afterEach(cleanup);

describe("EventStudioPreview - zamkniety podglad nie kosztuje nic", () => {
  it("ZAMKNIETY: nie rysuje niczego I NIE PYTA bazy o ani jedna liste", async () => {
    const { container } = nakladka({ open: false });

    // Domykamy kolejke mikrozadan - zapytanie odpalone „mimo wszystko" (czyli
    // z zepsuta flaga `enabled`) zapisaloby sie w atrapie wlasnie tutaj.
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.innerHTML).toBe("");
    expect(stub().names()).toEqual([]);
    expect(h.db?.chains).toEqual([]);
    expect(h.rysunki).toHaveLength(0);
  });

  it("OTWARTY: pyta o partnerow i ich poziomy, program, pasma i uczestnikow - po TO wydarzenie", async () => {
    // Druga polowa pary. Sam „nie pyta, gdy zamkniety" przechodzilby takze
    // wtedy, gdyby nakladka nie pytala NIGDY - a wtedy podglad szkicu byłby
    // pusty, czyli dokladnie tym, co ten modul mial naprawic.
    nakladka({ open: true });

    await waitFor(() => expect(new Set(stub().names()).size).toBeGreaterThanOrEqual(5));
    const nazwy = [...new Set(stub().names())].sort();
    expect(nazwy).toEqual([
      "admin_event_registrations_list",
      "admin_event_sessions_list",
      "admin_event_sponsor_tiers_list",
      "admin_event_sponsors_list",
      "admin_event_tracks_list",
    ]);
    for (const nazwa of nazwy) {
      expect(stub().lastCall(nazwa)?.arg("p_event_id")).toBe(STUDIO_EVENT_ID);
    }
  });

  // ZMIANA: ta asercja twierdzila, ze partnerzy ida z filtrem „published".
  // Tablica „Sponsorzy i reklama" zapisuje nowe logo jako NIEOGLOSZONE, wiec
  // taki podglad pokazywal pustke w miejscu logotypow, ktore organizator widzial
  // na tablicy. Dzis nakladka bierze WSZYSTKIE przypiecia (nieogloszone rysuje
  // przygaszone, z plakietka), a sponsor przy sesji dalej odsiewa sie po
  // `is_published` - dowod w `EventStudioPreviewSponsors.test.tsx`.
  it("partnerzy ida BEZ filtra ogloszen - nieogloszonych podglad pokazuje, znaczonych", async () => {
    nakladka({ open: true });

    await waitFor(() => expect(stub().lastCall("admin_event_sponsors_list")).toBeDefined());
    expect(stub().lastCall("admin_event_sponsors_list")?.has("p_published")).toBe(false);
    expect(stub().lastCall("admin_event_sponsors_list")?.arg("p_limit")).toBe(200);
    // Krotka lista to jedna strona od zera - bez dopytywania o nastepna.
    expect(stub().lastCall("admin_event_sponsors_list")?.arg("p_offset")).toBe(0);
    expect(stub().callsFor("admin_event_sponsors_list")).toHaveLength(1);
  });

  it("poziomy partnerow ida osobnym zapytaniem - opis i korzysci poziomu nie leza na liscie przypiec", async () => {
    nakladka({ open: true });

    await waitFor(() => expect(stub().lastCall("admin_event_sponsor_tiers_list")).toBeDefined());
    expect(stub().lastCall("admin_event_sponsor_tiers_list")?.keys()).toEqual(["p_event_id"]);
  });
});

describe("EventStudioPreview - stan listy partnerow", () => {
  /** Status partnerow w ostatnim rysunku kanwy. */
  function ostatniStatus() {
    const rysunek = h.rysunki.at(-1);
    if (rysunek === undefined) throw new Error("test: kanwa nie zostala narysowana");
    return rysunek.live.sponsorsStatus;
  }

  it("zanim lista dojedzie, kanwa wie, ze to WCZYTYWANIE - a po odpowiedzi, ze gotowe", async () => {
    nakladka({ open: true });

    expect(h.rysunki[0]?.live.sponsorsStatus).toEqual({ state: "pending" });
    await waitFor(() => expect(ostatniStatus()).toEqual({ state: "ready" }));
  });

  it("awaria bez znanego klucza to zdanie o ODCZYCIE, nie „nie udalo sie zapisac zmian”", async () => {
    stub().setError("admin_event_sponsors_list", "Failed to fetch");
    nakladka({ open: true });

    await waitFor(() =>
      expect(ostatniStatus()).toEqual({ state: "error", message: `${P}sponsorsLoadFailed` }),
    );
  });

  it("znana odmowa bazy mowi swoim zdaniem z mapy odmow sponsorow", async () => {
    stub().setError("admin_event_sponsors_list", "forbidden: event admins only", "42501");
    nakladka({ open: true });

    const { adminSponsorErrorMessage } = await import("@/lib/events/adminSponsorErrors");
    await waitFor(() =>
      expect(ostatniStatus()).toEqual({
        state: "error",
        message: adminSponsorErrorMessage(new Error("forbidden")),
      }),
    );
  });

  it("bez wydarzenia lista jest WYLACZONA - to odpowiedz „brak partnerow”, nie wieczne wczytywanie", async () => {
    nakladka({ open: true, eventId: "" });
    await screen.findByTestId("kanwa");

    expect(ostatniStatus()).toEqual({ state: "ready" });
    expect(stub().callsFor("admin_event_sponsors_list")).toHaveLength(0);
  });
});

describe("EventStudioPreview - partnerzy ponad jedna strone RPC", () => {
  /** Wiersz listy przypiec; ranga poziomu ustala kolejnosc jak `ORDER BY` RPC. */
  function przypiecie(
    id: string,
    patch: Partial<EventSponsorRow> & Pick<EventSponsorRow, "total_count">,
  ): EventSponsorRow {
    return {
      booth_label: "",
      company_id: `firma-${id}`,
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
      id,
      is_published: true,
      materials_count: 0,
      published_materials_count: 0,
      role: "sponsor",
      snapshot_country: "",
      snapshot_description_en: "",
      snapshot_description_pl: "",
      snapshot_logo_url: "",
      snapshot_name: `Firma ${id}`,
      snapshot_source: "crm",
      snapshot_taken_at: "2026-09-01T10:00:00.000Z",
      snapshot_website: "",
      sort_order: 10,
      tier_accent_color: "",
      tier_id: "t-silver",
      tier_key: "silver",
      tier_logo_size: "md",
      tier_name_en: "Silver",
      tier_name_pl: "Srebrni",
      tier_rank: 10,
      updated_at: "2026-09-01T10:00:00.000Z",
      ...patch,
    };
  }

  /** Pasmo ze sponsorem - wiersz `admin_event_tracks_list` w zakresie chipa. */
  function pasmo(id: string, sponsorId: string): EventTrackRow {
    return {
      id,
      name_pl: `Pasmo ${id}`,
      name_en: `Track ${id}`,
      accent_color: "#FA9346",
      sponsor_id: sponsorId,
      sponsor_name: `Firma ${sponsorId}`,
      sponsor_logo_url: null,
      sponsor_role: "sponsor",
      sessions_count: 1,
      draft_count: 0,
      is_active: true,
      is_public: true,
    } as unknown as EventTrackRow;
  }

  /** RPC oddaje strone wedlug `p_offset` / `p_limit` - jak prawdziwa funkcja. */
  function listaStronami(rows: EventSponsorRow[]): void {
    stub().setResponse("admin_event_sponsors_list", (call) => {
      const offset = Number(call.arg("p_offset"));
      return { data: rows.slice(offset, offset + Number(call.arg("p_limit"))), error: null };
    });
  }

  function ostatnieDane(): EventPreviewLiveData {
    const rysunek = h.rysunki.at(-1);
    if (rysunek === undefined) throw new Error("test: kanwa nie zostala narysowana");
    return rysunek.live;
  }

  const partnerzyPodgladu = () =>
    ostatnieDane().sponsorTiers.flatMap((tier) => tier.sponsors.map((sponsor) => sponsor));

  it("180 ogloszonych + 30 nieogloszonych: DWIE strony, komplet ogloszonych i filtr pasm DZIALA", async () => {
    // Kolejnosc RPC: ranga malejaco - nieogloszeni ze Zlotego (ranga 30) stoja
    // PRZED ogloszonymi ze Srebrnego, wiec na drugiej stronie laduje 10
    // ogloszonych z konca listy. Jedna strona by ich zgubila.
    const TOTAL = 210;
    const nieogloszone = Array.from({ length: 30 }, (_, i) =>
      przypiecie(`draft-${i}`, {
        is_published: false,
        tier_id: "t-gold",
        tier_key: "gold",
        tier_rank: 30,
        total_count: TOTAL,
      }),
    );
    const ogloszone = Array.from({ length: 180 }, (_, i) =>
      przypiecie(`ann-${i}`, { sort_order: i, total_count: TOTAL }),
    );
    listaStronami([...nieogloszone, ...ogloszone]);
    stub().setData("admin_event_tracks_list", [
      pasmo("szkic", "draft-0"),
      pasmo("koniec", "ann-179"),
    ]);

    nakladka({ open: true });

    await waitFor(() => expect(partnerzyPodgladu()).toHaveLength(TOTAL));
    expect(
      stub()
        .callsFor("admin_event_sponsors_list")
        .map((call) => [call.arg("p_offset"), call.arg("p_limit")]),
    ).toEqual([
      [0, 200],
      [200, 200],
    ]);
    const idki = new Set(partnerzyPodgladu().map((sponsor) => sponsor.id));
    for (const sponsor of ogloszone) expect(idki.has(sponsor.id)).toBe(true);
    expect(partnerzyPodgladu().filter((sponsor) => sponsor.isDraft === true)).toHaveLength(30);

    // Filtr ogloszen przy pasmach zostaje WLACZONY: sponsor z nieogloszonego
    // przypiecia znika z chipa, a ogloszony z DRUGIEJ strony zostaje.
    await waitFor(() => expect(ostatnieDane().tracks).toHaveLength(2));
    const chipy = new Map(ostatnieDane().tracks.map((chip) => [chip.id, chip.sponsorName]));
    expect(chipy.get("szkic")).toBeNull();
    expect(chipy.get("koniec")).toBe("Firma ann-179");
  });

  it("uciecie ZA twardym stopem (10 stron): lista z ostrzezeniem, a filtr pasm WYLACZONY jak dawniej", async () => {
    // 2100 przypiec to 11 stron - petla staje po 10. `total_count` mowi, ze
    // lista jest niepelna, wiec brak przypiecia nie dowodzi „nieogloszone":
    // podglad nie filtruje, zeby nie zdjac sponsora, ktorego pokaze strona.
    const TOTAL = 2100;
    const wiersze = Array.from({ length: TOTAL }, (_, i) =>
      przypiecie(`p-${i}`, { is_published: i !== 0, total_count: TOTAL }),
    );
    listaStronami(wiersze);
    stub().setData("admin_event_tracks_list", [pasmo("szkic", "p-0")]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    nakladka({ open: true });

    await waitFor(() => expect(partnerzyPodgladu()).toHaveLength(2000));
    expect(stub().callsFor("admin_event_sponsors_list")).toHaveLength(10);
    expect(stub().lastCall("admin_event_sponsors_list")?.arg("p_offset")).toBe(1800);
    expect(warn).toHaveBeenCalledWith(
      "[events] sponsor list stopped at page cap",
      expect.objectContaining({ eventId: STUDIO_EVENT_ID, loaded: 2000 }),
    );
    await waitFor(() => expect(ostatnieDane().tracks).toHaveLength(1));
    expect(ostatnieDane().tracks[0]?.sponsorName).toBe("Firma p-0");
    warn.mockRestore();
  });
});

describe("EventStudioPreview - nakladka jest STANEM, nie trasa", () => {
  it("Escape zamyka nakladke bez nawigacji - szkic formularza zostaje", async () => {
    const zmiany: boolean[] = [];
    nakladka({ open: true, onOpenChange: (open) => zmiany.push(open) });
    await screen.findByTestId("kanwa");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(zmiany).toEqual([false]);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("inny klawisz nie zamyka - nakladka nie moze znikac przy pisaniu", async () => {
    const zmiany: boolean[] = [];
    nakladka({ open: true, onOpenChange: (open) => zmiany.push(open) });
    await screen.findByTestId("kanwa");

    fireEvent.keyDown(document, { key: "a" });

    expect(zmiany).toEqual([]);
  });

  it("przycisk „Zamknij podglad” oddaje stan w gore, a nie przeladowuje ekranu", async () => {
    const zmiany: boolean[] = [];
    nakladka({ open: true, onOpenChange: (open) => zmiany.push(open) });
    await screen.findByTestId("kanwa");

    fireEvent.click(screen.getByRole("button", { name: `${P}close` }));

    expect(zmiany).toEqual([false]);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("„Wroc do listy wydarzen” robi DWIE rzeczy: zamyka nakladke i wychodzi ze studia", async () => {
    const zmiany: boolean[] = [];
    nakladka({ open: true, onOpenChange: (open) => zmiany.push(open) });
    await screen.findByTestId("kanwa");

    act(() => h.wroc?.());

    expect(zmiany).toEqual([false]);
    expect(h.navigate).toHaveBeenCalledWith({ to: "/admin/events" });
  });
});

describe("EventStudioPreview - strona publiczna", () => {
  it("SZKIC nie dostaje odnosnika - prowadzilby na 404", async () => {
    nakladka({ open: true, publicHref: null });
    await screen.findByTestId("kanwa");

    expect(screen.queryByRole("link", { name: `${P}openPublic` })).toBeNull();
  });

  it("OPUBLIKOWANE dostaje odnosnik otwierany w nowej karcie", async () => {
    nakladka({ open: true, publicHref: "/events/kongres-energetyczny" });
    await screen.findByTestId("kanwa");

    const link = screen.getByRole("link", { name: `${P}openPublic` });
    expect(link).toHaveAttribute("href", "/events/kongres-energetyczny");
    expect(link).toHaveAttribute("target", "_blank");
    // Bez `noreferrer` otwarta strona dostaje uchwyt do okna panelu.
    expect(link).toHaveAttribute("rel", "noreferrer");
  });
});

describe("EventStudioPreview - przelacznik urzadzenia", () => {
  it("domyslnie stoi na pulpicie, a AKTYWNA zakladka jest wcisnieta", async () => {
    nakladka({ open: true });
    await screen.findByTestId("kanwa");

    expect(screen.getByRole("button", { name: `${P}desktop` })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: `${P}mobile` })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("kanwa").getAttribute("data-device")).toBe("desktop");
  });

  it("przelaczenie na telefon zmienia SZEROKOSC KANWY, nie tylko wyglad zakladki", async () => {
    // Sam `aria-pressed` nie dowodzi niczego: przelacznik ma zwezic rysunek do
    // 390 px, inaczej redaktor oglada widok pulpitu z podswietlona ikona telefonu.
    const { container } = nakladka({ open: true });
    await screen.findByTestId("kanwa");

    fireEvent.click(screen.getByRole("button", { name: `${P}mobile` }));

    expect(screen.getByTestId("kanwa").getAttribute("data-device")).toBe("mobile");
    expect(screen.getByRole("button", { name: `${P}mobile` })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const kartka = container.querySelector('[style*="width: 390px"]');
    expect(kartka).not.toBeNull();
  });
});

describe("EventStudioPreview - skala z ZMIERZONEJ szerokosci ramy", () => {
  /** Atrapa `ResizeObserver` - happy-dom go nie ma, a nakladka bez niego nie mierzy. */
  class Obserwator {
    static ostatni: Obserwator | null = null;
    readonly obserwowane: Element[] = [];
    rozlaczony = false;
    constructor(readonly zawiadom: () => void) {
      Obserwator.ostatni = this;
    }
    observe(element: Element) {
      this.obserwowane.push(element);
    }
    disconnect() {
      this.rozlaczony = true;
    }
  }

  beforeEach(() => {
    Obserwator.ostatni = null;
    vi.stubGlobal("ResizeObserver", Obserwator);
    // Rama 620 px i kanwa wysoka na 1000 px - happy-dom nie liczy ukladu,
    // wiec wymiary podaje test.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(620);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pulpit 1240 px w ramie 620 px rysuje sie w skali 0,5 - z wysokoscia wnetrza", async () => {
    const { container } = nakladka({ open: true });
    await screen.findByTestId("kanwa");

    // Kartka zajmuje zmierzona szerokosc, a wysokosc to wysokosc kanwy w skali.
    await waitFor(() => expect(container.querySelector('[style*="width: 620px"]')).not.toBeNull());
    expect(container.querySelector('[style*="height: 500px"]')).not.toBeNull();
    expect(container.querySelector('[style*="scale(0.5)"]')).not.toBeNull();
    // Obserwator patrzy na rame i na kanwe - zmiana ktorejkolwiek przelicza skale.
    expect(Obserwator.ostatni?.obserwowane).toHaveLength(2);
  });

  it("zmiana rozmiaru przelicza skale, a zamkniecie odlacza obserwatora", async () => {
    const { unmount, container } = nakladka({ open: true });
    await screen.findByTestId("kanwa");
    const obserwator = Obserwator.ostatni;

    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(310);
    act(() => obserwator?.zawiadom());
    await waitFor(() => expect(container.querySelector('[style*="scale(0.25)"]')).not.toBeNull());

    unmount();
    expect(obserwator?.rozlaczony).toBe(true);
    // Spozniony sygnal po zamknieciu nie ma czego mierzyc - i nie moze sie wywrocic.
    expect(() => obserwator?.zawiadom()).not.toThrow();
  });

  it("przegladarka bez `ResizeObserver` dostaje jeden pomiar przy otwarciu - i nie pada", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { container } = nakladka({ open: true });
    await screen.findByTestId("kanwa");

    await waitFor(() => expect(container.querySelector('[style*="scale(0.5)"]')).not.toBeNull());
    expect(Obserwator.ostatni).toBeNull();
  });

  it("powrot z telefonu na pulpit przywraca szerokosc pulpitu", async () => {
    nakladka({ open: true });
    await screen.findByTestId("kanwa");

    fireEvent.click(screen.getByRole("button", { name: `${P}mobile` }));
    fireEvent.click(screen.getByRole("button", { name: `${P}desktop` }));

    expect(screen.getByTestId("kanwa").getAttribute("data-device")).toBe("desktop");
  });
});

describe("EventStudioPreview - nawigacja po podstronach", () => {
  it("wybor pozycji menu przenosi ETYKIETE, SCIEZKE i ZNACZNIK MODULU do modelu", async () => {
    nakladka({ open: true });
    await screen.findByTestId("kanwa");
    expect(ostatniModel().selectedPage).toBeNull();

    act(() => h.nawiguj?.({ key: POZYCJA_PROGRAM.key, pageId: POZYCJA_PROGRAM.pageId }));

    await waitFor(() => expect(ostatniModel().selectedPage).not.toBeNull());
    expect(ostatniModel().selectedPage).toMatchObject({
      key: "menu-agenda",
      label: "Program",
      path: "/program",
      // Bez znacznika modulu podstrona narysowalaby sam naglowek, bez programu.
      module: "agenda",
    });
  });

  it("powrot na strone glowna czysci wybor", async () => {
    nakladka({ open: true });
    await screen.findByTestId("kanwa");
    act(() => h.nawiguj?.({ key: POZYCJA_PROGRAM.key, pageId: POZYCJA_PROGRAM.pageId }));
    await waitFor(() => expect(ostatniModel().selectedPage).not.toBeNull());

    act(() => h.nawiguj?.(null));

    await waitFor(() => expect(ostatniModel().selectedPage).toBeNull());
  });

  it("pozycja SPOZA menu nadal ma etykiete - cel nawigacji nosi wlasna kopie", async () => {
    // To jest obrona przed „strona znika sama z siebie": gdy menu na moment
    // wroci puste (odswiezenie po zapisie), podglad ma rysowac dalej to, co
    // redaktor wlasnie wybral, a nie wracac na strone glowna.
    nakladka({ open: true, base: { menu: [] } });
    await screen.findByTestId("kanwa");

    act(() => h.nawiguj?.({ key: "menu-agenda", pageId: "page-agenda" }));

    await waitFor(() => expect(ostatniModel().selectedPage).not.toBeNull());
    expect(ostatniModel().selectedPage?.key).toBe("menu-agenda");
    // Etykiety w menu nie bylo, wiec zostaje pusta - ale STRONA SIE NIE GUBI.
    expect(ostatniModel().selectedPage?.label).toBe("");
  });

  it("pusta podstrona oddaje `document: null` - to inna odpowiedz niz „patrzymy na strone glowna”", async () => {
    nakladka({ open: true });
    await screen.findByTestId("kanwa");

    act(() => h.nawiguj?.({ key: POZYCJA_PROGRAM.key, pageId: POZYCJA_PROGRAM.pageId }));

    await waitFor(() => expect(ostatniModel().selectedPage).not.toBeNull());
    expect(ostatniModel().selectedPage?.document).toBeNull();
    expect(h.db?.lastChain("pages")?.argsOf("eq")).toEqual(["id", "page-agenda"]);
  });
});

describe("EventStudioPreview - dostepnosc", () => {
  it("nakladka jest NAZWANYM oknem dialogowym", async () => {
    nakladka({ open: true });
    await screen.findByTestId("kanwa");

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", `${P}title`);
  });

  it("nakladka nie ma naruszen axe", async () => {
    const { container } = nakladka({ open: true, publicHref: "/events/kongres-energetyczny" });
    await screen.findByTestId("kanwa");
    // Czekamy, az wszystkie zapytania nakladki dojada - axe ma ogladac ekran
    // po ustaniu przerysowan, a nie w polowie wczytywania.
    await waitFor(() => expect(new Set(stub().names()).size).toBeGreaterThanOrEqual(5));

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
