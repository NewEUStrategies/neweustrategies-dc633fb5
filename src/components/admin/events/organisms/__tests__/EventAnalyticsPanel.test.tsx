// Pulpit „Analityka" JEDNEGO wydarzenia - SKLEJENIE czterech zywych RPC
// w czternascie kafli. Plik stal na 0% funkcji.
//
// PO CO TEN PLIK ISTNIEJE. Ekran analityki jest jedynym miejscem w studiu,
// ktore NIE MA wlasnego zrodla prawdy: kazda liczba pochodzi z licznika, ktory
// juz gdzies indziej stoi (zapisy, program, gielda spotkan, odprawa). Cala
// wartosc tego ekranu to WIERNOSC - i dokladnie ona psuje sie po cichu.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. SZOSTY LICZNIK. Ktos dokłada `useQuery` z wlasnym zliczaniem zgloszen,
//      bo „tak wygodniej" - i od tej chwili pulpit pokazuje inna liczbe niz
//      lista zgloszen, a redaktor nie wie, ktorej wierzyc. Dowodem jest KOMPLET
//      i NAZWY wywolanych funkcji bazy, nie wyglad kafla.
//   2. KRESKA ZAMIENIONA W ZERO. `?? 0` w miejscu `=== null` wyglada niewinnie
//      i wyglada TAK SAMO na ekranie w chwili, gdy dane juz przyszly. Roznica
//      wychodzi tylko wtedy, gdy danych NIE MA: „jeszcze nie policzone" staje
//      sie „nikt sie nie zapisal", a to jest zdanie, po ktorym odwoluje sie
//      wydarzenie.
//   3. FREKWENCJA BEZ ODZNACZEN. `attendanceRate === null` znaczy „nikt jeszcze
//      nie odznaczyl obecnosci". Sklejone z zerem daje „0% frekwencji" przy
//      sali pelnej ludzi.
//   4. LIMIT MIEJSC. Wydarzenie bez limitu ma `capacity === null`; kafel
//      „Wolne miejsca" musi wtedy powiedziec DLACZEGO jest pusty, inaczej
//      wyglada jak wyprzedane.
//   5. DROGOWSKAZ DO RUCHU NA STRONIE. Bez niego redaktor szuka wykresu odslon
//      w wydarzeniu i nie znajduje go nigdzie.
//
// CZEGO SWIADOMIE NIE DUBLUJE. Parserow odpowiedzi bazy
// (`parseRegistrationCounts`, `parseMeetingStats`, `parseOnsiteStats`) - maja
// wlasne pliki testowe; tutaj ida one PRAWDZIWE, bo przedmiotem dowodu jest
// droga „RPC -> parser -> kafel", a nie tabela pojedynczego parsera. Nie
// dubluje tez ukladu prymitywow studia (`EventStudioSection.test.tsx`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import type { EventSessionRow } from "@/lib/events/sessionsApi";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  /**
   * Tryb „odpowiedz nigdy nie przychodzi" - jedyny sposob na ZATRZYMANIE
   * zapytania w stanie oczekiwania. Atrapa RPC odpowiada synchronicznie, wiec
   * bez tej furtki nie da sie odroznic ekranu „jeszcze nie wiadomo" od ekranu
   * „baza odmowila", a to jest przedmiotem jednego z dowodow nizej.
   */
  wiecznePending: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.wiecznePending) return new Promise(() => {});
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-agenda", () => ({ ensureAgendaI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-meetings", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-onsite", () => ({ ensureOnsiteI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-registration", () => ({ ensureI18n: () => undefined }));

// `<Link>` czyta kontekst routera i bez `<RouterProvider>` rzuca. Panel nie jest
// tu montowany trasa - drogowskaz do modulu globalnego ma byc zwyklym adresem.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

const { EventAnalyticsPanel } =
  await import("@/components/admin/events/organisms/EventAnalyticsPanel");

const EVENT_ID = "3f1a0c8e-0000-4000-8000-000000000042";
const A = "adminEvents.studio.analytics.";

/** Kreska kafla bez danych - EM DASH z kodu produkcyjnego, nie zwykly dywiz. */
const KRESKA = "—";

/** Komplet funkcji bazy, z ktorych ekran ma sie skladac - i ANI JEDNEJ wiecej. */
const RPC_PULPITU = [
  "admin_event_meeting_stats",
  "admin_event_onsite_stats",
  "admin_event_registrations_counts",
  "admin_event_sessions_list",
];

/**
 * Wiersz studia - 53 kolumny sygnatury `admin_event_detail`. Panel czyta z niego
 * WYLACZNIE `id`, ale atrapa wezsza od sygnatury przestalaby sie kompilowac przy
 * pierwszej nowej kolumnie i to jest ZALETA, nie koszt.
 */
function detailRow(overrides: Partial<AdminEventDetailRow> = {}): AdminEventDetailRow {
  return {
    branding: {},
    cancelled_at: "",
    capacity: 0,
    chatham_house: false,
    city: "Warszawa",
    country: "Polska",
    cover_url: "",
    created_at: "",
    description_en: "",
    description_pl: "",
    early_rsvp_rank: 0,
    ends_at: "2026-09-01T15:00:00.000Z",
    event_type_id: "",
    external_registration_url: "",
    features: {},
    format: "onsite",
    guest_mode: "full",
    has_recording: false,
    has_stream: false,
    home_design: "standard",
    id: EVENT_ID,
    join_url: "",
    kind: "in_person",
    languages: ["pl", "en"],
    location: "Centrum Konferencyjne",
    min_tier_rank: 0,
    pages_display_mode: "list",
    postal_code: "00-001",
    published_at: "",
    recording_url: "",
    region: "mazowieckie",
    registration_flow: "direct",
    registration_mode: "internal",
    root_page_id: "root",
    rsvp_opens_at: "",
    slug: "kongres-energetyczny",
    social_hashtag: "NES2026",
    starts_at: "2026-09-01T09:00:00.000Z",
    status: "published",
    street_address: "Aleje Jerozolimskie 1",
    support_email: "kontakt@example.org",
    ticket_currency: "PLN",
    ticket_price_cents: 0,
    timezone: "Europe/Warsaw",
    title_en: "Energy Congress",
    title_pl: "Kongres Energetyczny",
    type_accent_color: "",
    type_icon: "",
    type_key: "in_person",
    type_name_en: "",
    type_name_pl: "",
    updated_at: "",
    video_header_id: "",
    video_header_platform: "",
    visibility: "public",
    ...overrides,
  };
}

/** Wiersz sesji - 37 kolumn sygnatury `admin_event_sessions_list`. */
function sessionRow(overrides: Partial<EventSessionRow> = {}): EventSessionRow {
  return {
    allow_overlap: false,
    cancelled_at: "",
    cancelled_count: 0,
    capacity: 0,
    chatham_house: false,
    children_count: 0,
    description_en: "",
    description_pl: "",
    duration_minutes: 60,
    ends_at: "2026-09-01T10:00:00.000Z",
    event_id: EVENT_ID,
    format: "onsite",
    has_recording: false,
    has_stream: false,
    id: "session-1",
    is_private: false,
    min_tier_rank: 0,
    parent_session_id: "",
    published_at: "",
    registered_count: 0,
    requires_signup: false,
    room_capacity: 0,
    room_id: "",
    room_name: "",
    seats_left: 0,
    sort_order: 0,
    speakers_count: 0,
    starts_at: "2026-09-01T09:00:00.000Z",
    status: "published",
    title_en: "Opening",
    title_pl: "Otwarcie",
    track_accent_color: "",
    track_id: "",
    track_key: "",
    track_name_en: "",
    track_name_pl: "",
    waitlist_count: 0,
    ...overrides,
  };
}

/** Odpowiedz `admin_event_registrations_counts` - ksztalt JSON, nie wiersz. */
function counts(over: Record<string, number | null> = {}): Record<string, number | null> {
  return {
    all: 21,
    approved: 14,
    pending: 3,
    waitlist: 4,
    attended: 0,
    cancelled: 0,
    rejected: 0,
    awaiting_notice: 0,
    capacity: 30,
    seats_left: 16,
    ...over,
  };
}

function meetingStats(over: Record<string, number | null> = {}): Record<string, number | null> {
  return { total: 40, held: 12, acceptance_rate: 58.6, attendance_rate: 80, ...over };
}

function onsiteStats(over: Record<string, number | null> = {}): Record<string, number | null> {
  return {
    arrived_total: 18,
    no_show_total: 3,
    attendance_rate: 72,
    walk_in_total: 2,
    badges_printed_people: 17,
    lead_scans_total: 9,
    lead_scans_with_consent: 6,
    ...over,
  };
}

/** Ustawia komplet czterech odpowiedzi; wywolujacy nadpisuje pojedyncze. */
function planujKomplet(rpc: SupabaseRpcStub): void {
  rpc.setData("admin_event_registrations_counts", counts());
  rpc.setData("admin_event_sessions_list", [
    sessionRow({ id: "s-1" }),
    sessionRow({ id: "s-2" }),
    sessionRow({ id: "s-3" }),
  ]);
  rpc.setData("admin_event_meeting_stats", meetingStats());
  rpc.setData("admin_event_onsite_stats", onsiteStats());
}

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function Provider({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function panel() {
  return render(
    <Provider>
      <EventAnalyticsPanel row={detailRow()} />
    </Provider>,
  );
}

/**
 * Wartosc kafla po KLUCZU etykiety. Kafel to dwa akapity w karcie: etykieta,
 * pod nia liczba albo kreska - wiec asercja czyta rodzenstwo etykiety, a nie
 * caly tekst karty (ten zlepilby etykiete z wartoscia i z podpowiedzia).
 */
function kafel(labelKey: string): { wartosc: string; podpowiedz: string | null } {
  const label = screen.getByText(`${A}${labelKey}`);
  const value = label.nextElementSibling;
  if (value === null) throw new Error(`test: kafel ${labelKey} nie ma wiersza wartosci`);
  return {
    wartosc: value.textContent ?? "",
    podpowiedz: value.nextElementSibling?.textContent ?? null,
  };
}

/** Czeka, az wszystkie cztery zapytania dojada - inaczej asercja lapie kreski. */
async function poczekajNaKomplet(): Promise<void> {
  await waitFor(() => expect(kafel("registrationsTotal").wartosc).not.toBe(KRESKA));
  await waitFor(() => expect(kafel("sessions").wartosc).not.toBe(KRESKA));
  await waitFor(() => expect(kafel("arrived").wartosc).not.toBe(KRESKA));
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.wiecznePending = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("EventAnalyticsPanel - komplet zrodel", () => {
  it("sklada pulpit z CZTERECH zywych RPC i nie dokłada zadnego wlasnego licznika", async () => {
    // To jest dowod przeciw „szostemu licznikowi tych samych rzeczy": komplet
    // i nazwy funkcji bazy sa kontraktem tego ekranu. Piata nazwa na tej liscie
    // znaczy, ze pulpit zaczal liczyc sam - czyli ze moze pokazac inna liczbe
    // niz lista zgloszen obok.
    planujKomplet(stub());
    panel();

    await poczekajNaKomplet();
    expect([...new Set(stub().names())].sort()).toEqual(RPC_PULPITU);
  });

  it("kazde zapytanie idzie po TO wydarzenie, nie po dowolne", async () => {
    // Zgubiony `p_event_id` nie wywraca ekranu - oddaje liczby CUDZEGO
    // wydarzenia, a te wygladaja rownie wiarygodnie.
    planujKomplet(stub());
    panel();

    await poczekajNaKomplet();
    for (const name of RPC_PULPITU) {
      expect(stub().lastCall(name)?.arg("p_event_id")).toBe(EVENT_ID);
    }
  });

  it("odprawe czyta w kubelkach godzinnych - analityke czyta sie po wydarzeniu", async () => {
    planujKomplet(stub());
    panel();

    await poczekajNaKomplet();
    expect(stub().lastCall("admin_event_onsite_stats")?.arg("p_bucket_minutes")).toBe(60);
  });

  it("program bierze WSZYSTKIE sesje, takze niepublikowane", async () => {
    // `status: "all"` z `DEFAULT_SESSIONS_QUERY` znaczy, ze filtr statusu NIE
    // leci do bazy. Gdyby poleciał, licznik „Sesje w programie" pokazywalby
    // mniej, niz redaktor widzi na ekranie agendy - i nikt by nie wiedzial,
    // ktory z dwoch ekranow klamie.
    planujKomplet(stub());
    panel();

    await poczekajNaKomplet();
    expect(stub().lastCall("admin_event_sessions_list")?.has("p_status")).toBe(false);
  });
});

describe("EventAnalyticsPanel - liczby", () => {
  it("pokazuje liczby z bazy, kazda w swoim kaflu", async () => {
    planujKomplet(stub());
    panel();

    await poczekajNaKomplet();
    expect(kafel("registrationsTotal").wartosc).toBe("21");
    expect(kafel("approved").wartosc).toBe("14");
    expect(kafel("pending").wartosc).toBe("3");
    expect(kafel("waitlist").wartosc).toBe("4");
    expect(kafel("seatsLeft").wartosc).toBe("16");
    expect(kafel("sessions").wartosc).toBe("3");
    expect(kafel("meetingsHeld").wartosc).toBe("12");
    expect(kafel("arrived").wartosc).toBe("18");
    expect(kafel("noShow").wartosc).toBe("3");
    expect(kafel("walkIn").wartosc).toBe("2");
    expect(kafel("badgesPrinted").wartosc).toBe("17");
    expect(kafel("leadScans").wartosc).toBe("9");
  });

  it("odsetki maja znak procenta, a zgody przy leadach stoja w podpowiedzi", async () => {
    planujKomplet(stub());
    panel();

    await poczekajNaKomplet();
    // 58,6% zaokraglone do pelnego procenta - liczba na kaflu jest napisem,
    // nie surowa wartoscia, wiec asercja idzie na tym, co widzi redaktor.
    expect(kafel("meetingsAcceptance").wartosc).toBe("59%");
    expect(kafel("attendanceRate").wartosc).toBe("72%");
    // Liczba zgod jedzie jako PARAMETR klucza - atrapa i18n dokleja go w
    // nawiasie, wiec widac takze to, czego sam napis by nie pokazal.
    expect(kafel("leadScans").podpowiedz).toBe(`${A}leadScansConsent(count=6)`);
  });

  it("ZERO to zero, a nie kreska - pusta sala po wydarzeniu jest odpowiedzia", async () => {
    // Odwrotna strona doktryny kreski: gdy baza policzyla i wyszlo zero, kafel
    // MUSI pokazac zero. Kreska w tym miejscu kazalaby redaktorowi czekac na
    // liczbe, ktora juz przyszla.
    stub().setData(
      "admin_event_registrations_counts",
      counts({ all: 0, approved: 0, pending: 0, waitlist: 0, seats_left: 30 }),
    );
    stub().setData("admin_event_sessions_list", []);
    stub().setData("admin_event_meeting_stats", meetingStats({ held: 0, acceptance_rate: 0 }));
    stub().setData(
      "admin_event_onsite_stats",
      onsiteStats({ arrived_total: 0, attendance_rate: 0 }),
    );
    panel();

    await waitFor(() => expect(kafel("registrationsTotal").wartosc).toBe("0"));
    expect(kafel("approved").wartosc).toBe("0");
    expect(kafel("sessions").wartosc).toBe("0");
    expect(kafel("meetingsHeld").wartosc).toBe("0");
    expect(kafel("meetingsAcceptance").wartosc).toBe("0%");
    expect(kafel("arrived").wartosc).toBe("0");
    expect(kafel("attendanceRate").wartosc).toBe("0%");
  });
});

describe("EventAnalyticsPanel - „nie wiem” jest osobna odpowiedzia", () => {
  it("frekwencja bez ANI JEDNEGO odznaczenia to kreska, a nie 0%", async () => {
    // `attendance_rate: null` znaczy „nikt jeszcze nie odznaczyl obecnosci".
    // Sklejone z zerem daje „0% frekwencji" przy sali pelnej ludzi - i to jest
    // liczba, ktora trafia potem do raportu dla sponsora.
    planujKomplet(stub());
    stub().setData(
      "admin_event_onsite_stats",
      onsiteStats({ arrived_total: 0, attendance_rate: null }),
    );
    panel();

    await waitFor(() => expect(kafel("arrived").wartosc).toBe("0"));
    expect(kafel("attendanceRate").wartosc).toBe(KRESKA);
  });

  it("odsetek przyjetych zaproszen bez rozstrzygniec to kreska, a nie 0%", async () => {
    planujKomplet(stub());
    stub().setData("admin_event_meeting_stats", meetingStats({ held: 0, acceptance_rate: null }));
    panel();

    await waitFor(() => expect(kafel("meetingsHeld").wartosc).toBe("0"));
    expect(kafel("meetingsAcceptance").wartosc).toBe(KRESKA);
  });

  it("wydarzenie BEZ LIMITU miejsc mowi to wprost, zamiast wygladac na wyprzedane", async () => {
    planujKomplet(stub());
    stub().setData(
      "admin_event_registrations_counts",
      counts({ capacity: null, seats_left: null }),
    );
    panel();

    await waitFor(() => expect(kafel("registrationsTotal").wartosc).toBe("21"));
    const miejsca = kafel("seatsLeft");
    expect(miejsca.wartosc).toBe(KRESKA);
    expect(miejsca.podpowiedz).toBe(`${A}noCapacity`);
  });

  it("wydarzenie Z LIMITEM nie dostaje podpowiedzi o braku limitu", async () => {
    planujKomplet(stub());
    panel();

    await poczekajNaKomplet();
    expect(kafel("seatsLeft").podpowiedz).toBeNull();
  });

  it("dopoki baza nie odpowiedziala, KAZDY kafel jest kreska - zaden nie zmyśla zera", async () => {
    // Najgrozniejszy blad tego ekranu to liczba wzieta znikad. Wzorzec
    // referencyjny pokazywal 48 820 rejestracji przy wydarzeniu na dwadziescia
    // jeden osob; tutaj stan „jeszcze nie wiadomo" ma byc pusty.
    h.wiecznePending = true;
    const { container } = panel();

    await waitFor(() => expect(screen.getAllByText(KRESKA)).toHaveLength(14));
    // Zadnej cyfry na calym pulpicie - poza numerami sekcji, ktore liczy CSS
    // (`counter-increment`), wiec w tekscie DOM ich nie ma.
    expect(container.textContent ?? "").not.toMatch(/[0-9]/);
  });
});

describe("EventAnalyticsPanel - drogowskaz do ruchu na stronie", () => {
  it("odsyla do globalnego modulu analityki, bo wydarzenie nie ma wlasnego licznika odslon", async () => {
    planujKomplet(stub());
    panel();

    await poczekajNaKomplet();
    const link = screen.getByRole("link", { name: "adminEvents.studio.external.openModule" });
    expect(link.getAttribute("href")).toBe("/admin/analytics");
    expect(screen.getByText(`${A}siteTrafficDescription`)).toBeInTheDocument();
  });

  it("naglowek ekranu to ETYKIETA SEKCJI ze sidebara, nie wlasny napis", async () => {
    planujKomplet(stub());
    panel();

    await poczekajNaKomplet();
    expect(
      screen.getByRole("heading", { level: 1, name: "adminEvents.studio.sections.analytics" }),
    ).toBeInTheDocument();
  });

  it("pulpit jest czysty dla axe (takze w stanie bez danych)", async () => {
    h.wiecznePending = true;
    const { container } = panel();

    await waitFor(() => expect(screen.getAllByText(KRESKA)).toHaveLength(14));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("EventAnalyticsPanel - REJESTR DEFEKTOW", () => {
  // DEFEKT: komentarz przy `useOnsiteStats(eventId, 60)` obiecuje „odczyt na
  // wejscie - analityke czyta sie po wydarzeniu, nie przy bramce", ale trzeci
  // argument hooka (`enabled`) zostal domyslny, a razem z nim
  // `refetchInterval: 30_000`. Otwarta zakladka analityki odpytuje wiec ciezkie
  // `admin_event_onsite_stats` co pol minuty - bez konca i bez powodu, bo
  // odprawy juz nie ma. KONSEKWENCJA: pulpit zostawiony na ekranie w biurze
  // generuje 120 wywolan agregatu na godzine na kazdej otwartej karcie, a
  // komentarz w kodzie mowi, ze nie generuje zadnego - wiec nikt tego nie szuka.
  it.fails(
    "DEFEKT: pulpit odpytuje odprawe co 30 sekund, choc komentarz obiecuje jeden odczyt na wejscie",
    async () => {
      vi.useFakeTimers();
      planujKomplet(stub());
      panel();

      // Odczyt wejsciowy. Bez `waitFor`, bo ono liczy WLASNY, prawdziwy zegar
      // i pod sztucznymi timerami czekaloby do konca limitu.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      const przedCzekaniem = stub().callsFor("admin_event_onsite_stats").length;
      expect(przedCzekaniem).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      expect(stub().callsFor("admin_event_onsite_stats")).toHaveLength(przedCzekaniem);
    },
  );

  // DEFEKT: ODMOWA BAZY WYGLADA DOKLADNIE TAK SAMO JAK WCZYTYWANIE. Wszystkie
  // cztery zapytania moga zostac odrzucone (brak roli, wygasla sesja, awaria
  // RPC), a pulpit nadal pokazuje czternascie kresek - czyli to samo, co przez
  // pierwsze polsekundy kazdego wejscia. Ekran nie ma ZADNEGO sygnalu bledu:
  // ani komunikatu, ani `role="alert"`, ani przycisku ponowienia.
  // KONSEKWENCJA: redaktor czeka na liczby, ktore nigdy nie przyjda, i po
  // chwili uznaje, ze wydarzenie „nie ma jeszcze danych" - czyli wyciaga
  // wniosek merytoryczny z awarii. To ta sama zasada, ktora naglowek panelu
  // stosuje do zera: „nie wiem" i „nie udalo sie" to rozne odpowiedzi.
  it.fails(
    "DEFEKT: odmowa czterech RPC daje ekran nieodrozniallny od wczytywania - zaden sygnal bledu",
    async () => {
      h.wiecznePending = true;
      const { container: wczytywanie, unmount } = panel();
      await waitFor(() => expect(screen.getAllByText(KRESKA)).toHaveLength(14));
      const tekstWczytywania = wczytywanie.textContent ?? "";
      unmount();

      h.wiecznePending = false;
      for (const name of RPC_PULPITU) {
        stub().setError(name, "permission denied for function", "42501");
      }
      const { container: odmowa } = panel();
      await waitFor(() =>
        expect(stub().callsFor("admin_event_registrations_counts").length).toBeGreaterThan(0),
      );
      await waitFor(() => expect(screen.getAllByText(KRESKA)).toHaveLength(14));

      expect(odmowa.textContent ?? "").not.toBe(tekstWczytywania);
    },
  );

  // DEFEKT: `percent()` zaokragla przez `Math.round`, wiec kazdy niezerowy
  // odsetek ponizej 0,5% laduje na kaflu jako „0%". Przy duzej gieldzie spotkan
  // (jedno przyjete zaproszenie na trzysta rozstrzygnietych) pulpit mowi
  // „0% przyjetych zaproszen" obok kafla „Spotkania odbyte: 1" - dwie liczby
  // z tego samego wiersza przecza sobie nawzajem. KONSEKWENCJA: to samo
  // splaszczenie, przed ktorym broni sie naglowek panelu przy kresce - realny
  // pomiar zamieniony w „nic sie nie wydarzylo".
  it.fails("DEFEKT: niezerowy odsetek ponizej 0,5% pokazuje sie jako „0%”", async () => {
    planujKomplet(stub());
    stub().setData("admin_event_meeting_stats", meetingStats({ held: 1, acceptance_rate: 0.33 }));
    panel();

    await waitFor(() => expect(kafel("meetingsHeld").wartosc).toBe("1"));
    expect(kafel("meetingsAcceptance").wartosc).not.toBe("0%");
  });
});
