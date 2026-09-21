// `/admin/events/new` - KREATOR WYDARZENIA, jedyne wejście do modułu.
//
// PO CO TEN PLIK ISTNIEJE. Trasa stała na zerze pokrycia (0/24 linii, 0/1
// funkcji), a jest to ekran, przez który przechodzi KAŻDE wydarzenie serwisu -
// nie ma drugiej drogi utworzenia wiersza w `events`. Wszystko, co ta trasa
// robi, robi RAZ i nieodwracalnie, więc każdy z czterech jej obowiązków psuje
// się widocznie:
//
//   1. BRAMKA ROLI. Autor bez roli redaktora dostaje z bazy `42501`
//      (`assert_editor_tenant()` przy `admin_event_create`) niezależnie od tego,
//      co pokaże ekran. Zdanie zamiast formularza istnieje po to, żeby odmowa
//      nie wyglądała na awarię - a nie po to, żeby cokolwiek zabezpieczać.
//      Zdjęte zdanie znaczy formularz, który wypełnia się do końca i dopiero
//      wtedy odmawia.
//
//   2. NORMALIZACJA SZKICU. Formularz oddaje SAME NAPISY. To trasa decyduje,
//      że puste pole znaczy „nie podano" (klucz w ogóle nie jedzie do bazy,
//      więc wartość liczy rodzaj wydarzenia), a nie „podano pustkę". Zgubiona
//      normalizacja zapisuje `""` do kolumn, w których baza spodziewa się
//      wartości rodzaju - i wydarzenie powstaje bez strefy, bez formatu i bez
//      końca.
//
//   3. DOKĄD IDZIEMY PO ZAPISIE. Kreator zbiera pięć pól, resztę uzupełnia
//      studio, więc tworzenie kończy się NA PULPICIE nowego wydarzenia. Powrót
//      na listę kazałby redaktorowi odszukać świeży wiersz wśród kilkudziesięciu
//      i wejść w niego ręcznie - dwa kliknięcia po to, żeby wrócić do pracy,
//      której nie skończył.
//
//   4. NAGŁÓWEK RAILU MÓWI PRAWDĘ. Sidebar czyta stan trzymany w TRASIE
//      (`onDraftChange`), a nie w formularzu. Zerwany raport w górę daje
//      „Nowe wydarzenie" nad polem, w którym tytuł jest już wpisany - czyli
//      panel kłamiący o stanie, który redaktor ma przed oczami.
//
// ZAWĘŻENIE NAJEMCĄ SIEDZI W SQL. Zapis idzie przez RPC `admin_event_create`,
// więc tutaj asertujemy NAZWĘ FUNKCJI i ŁADUNEK; tego, że funkcja pisze
// wyłącznie w obrębie najemcy wołającego, pilnuje bramka `check:sql-tenant-scope`
// nad migracją, a nie test frontu.
//
// WZORZEC ATRAP przejęty z `adminEventStudioSectionRoutes.test.tsx` (atrapa
// `supabase.rpc` z `@/test/supabase/rpc`, montaż trasy przez
// `@/test/routeHarness`, `routeHead` do nagłówka dokumentu).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Walidacji pól - cała żyje w
// `EventCreateForm` i ma własny plik. (2) Ramy studia w trybie tworzenia -
// `EventStudioCreateShell` ma własny plik; tutaj stoi atrapa zapisująca to, co
// trasa jej podała. (3) Kontraktu samego RPC (dziedziczenie siedmiu wartości
// z rodzaju) - to warstwa SQL i jej testy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { ok, supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase";
import type { EventCreateDraft } from "@/components/admin/events/organisms/EventCreateForm";
import type { EventTypeOption } from "@/lib/events/eventTypes";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  /** Rola wołającego - przestawiana per przypadek. */
  isAdmin: false,
  roles: [] as string[],
  /** Język interfejsu - decyduje, którą wersję tytułu widzi rail. */
  lang: "pl",
  /**
   * Szkic, który atrapa formularza raportuje w górę i wysyła.
   *
   * `null`, a nie pusty obiekt: `EventCreateDraft` ma same pola WYMAGANE, więc
   * „pusty szkic" musiałby być fikcją podpartą rzutowaniem. Ustawia go
   * `beforeEach`, a brak jest błędem testu, nie stanem formularza.
   */
  draft: null as EventCreateDraft | null,
  /** Co trasa podała ramie studia, w kolejności renderów. */
  rail: [] as { title: string; date: string }[],
  /** Wywołania `navigate` - dokąd trasa wysyła redaktora. */
  nawigacje: [] as { to: unknown; params?: unknown }[],
  /** Toasty - jedyny kanał, którym trasa mówi o skutku zapisu. */
  toastOk: [] as string[],
  toastErr: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub(() => h.lang);
});
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => void h.toastOk.push(message),
    error: (message: string) => void h.toastErr.push(message),
    info: () => undefined,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: h.isAdmin, roles: h.roles }),
}));

// `useNavigate` jest atrapowany, bo cel („pulpit wydarzenia", „lista") to
// trasy, których w drzewie zmontowanym przez harness NIE MA - harness montuje
// dokładnie jedną trasę. Przedmiotem dowodu jest DOKĄD trasa wysyła redaktora,
// a nie to, jak router rysuje tamten ekran.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => (options: { to: unknown; params?: unknown }) => {
    h.nawigacje.push(options);
    return Promise.resolve();
  },
}));

// Rama studia w trybie tworzenia ma własny plik testowy. Tutaj interesuje nas
// WYŁĄCZNIE to, co trasa jej podaje - bo to jest treść nagłówka railu.
vi.mock("@/components/admin/events/studio/EventStudioCreateShell", () => ({
  EventStudioCreateShell: ({
    eventTitle,
    startsAtLabel,
    children,
  }: {
    eventTitle: string;
    startsAtLabel: string;
    children: React.ReactNode;
  }) => {
    h.rail.push({ title: eventTitle, date: startsAtLabel });
    return (
      <div data-testid="rama-kreatora" data-title={eventTitle} data-date={startsAtLabel}>
        {children}
      </div>
    );
  },
}));

// Formularz ma własny plik testowy (walidacja pięciu pól, dziedziczenie
// rodzaju). Tutaj jest WYZWALACZEM: oddaje w górę szkic ustawiony przez test
// i pozwala wywołać dokładnie te trzy zdarzenia, które trasa obsługuje.
vi.mock("@/components/admin/events/organisms/EventCreateForm", () => ({
  EventCreateForm: ({
    types,
    isSaving,
    onCancel,
    onSubmit,
    onDraftChange,
  }: {
    types: readonly EventTypeOption[];
    isSaving: boolean;
    onCancel: () => void;
    onSubmit: (draft: EventCreateDraft) => void;
    onDraftChange?: (draft: EventCreateDraft) => void;
  }) => (
    <div data-testid="formularz" data-types={types.length} data-saving={String(isSaving)}>
      <button type="button" onClick={() => onDraftChange?.(szkic())}>
        raportuj-szkic
      </button>
      <button type="button" onClick={() => onSubmit(szkic())}>
        zapisz
      </button>
      <button type="button" onClick={onCancel}>
        anuluj
      </button>
    </div>
  ),
}));

const { renderRoute, routeHead } = await import("@/test/routeHarness");
const { Route: NewEventRoute } = await import("@/routes/admin.events_.new");

const NEW_EVENT_ID = "9c2f5a71-0000-4000-8000-0000000000aa";

/** Rodzaj wydarzenia w kształcie, jaki oddaje RPC `event_types_active`. */
function eventTypeOption(overrides: Partial<EventTypeOption> = {}): EventTypeOption {
  return {
    id: "7b3e1d40-0000-4000-8000-000000000001",
    key: "conference",
    name_pl: "Konferencja",
    name_en: "Conference",
    description_pl: null,
    description_en: null,
    icon: null,
    accent_color: null,
    sort_order: 10,
    default_capacity: null,
    default_duration_minutes: null,
    default_format: "onsite",
    default_guest_mode: "full",
    default_min_tier_rank: 0,
    default_registration_mode: "rsvp",
    default_registration_flow: "instant",
    default_chatham_house: false,
    requires_ticket: false,
    ...overrides,
  };
}

/** Szkic kreatora: pola WYPEŁNIONE - stan, w którym zapis ma prawo przejść. */
function pelnySzkic(overrides: Partial<EventCreateDraft> = {}): EventCreateDraft {
  return {
    eventTypeId: "7b3e1d40-0000-4000-8000-000000000001",
    titlePl: "  Kongres Bezpieczeństwa Gospodarczego  ",
    titleEn: "  Economic Security Congress  ",
    startsAt: "2027-03-11T09:00",
    endsAt: "2027-03-12T17:00",
    timezone: "Europe/Warsaw",
    format: "hybrid",
    city: "Warszawa",
    country: "PL",
    externalRegistrationUrl: "",
    ...overrides,
  };
}

/** Szkic ustawiony przez przypadek - brak znaczy błąd testu, nie pusty formularz. */
function szkic(): EventCreateDraft {
  if (h.draft === null) throw new Error("test: szkic kreatora nie został ustawiony");
  return h.draft;
}

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
  return h.rpc;
}

/** Ładunek `p_payload` ostatniego wywołania `admin_event_create`. */
function payload(): Record<string, unknown> {
  const call = stub().lastCall("admin_event_create");
  const raw = call?.arg("p_payload");
  if (raw === null || typeof raw !== "object") {
    throw new Error("test: `admin_event_create` nie dostał ładunku");
  }
  return { ...(raw as Record<string, unknown>) };
}

async function zamontuj() {
  return renderRoute({
    route: NewEventRoute,
    path: "/admin/events/new",
    initialEntry: "/admin/events/new",
  });
}

/** Montaż + czekanie na katalog rodzajów, czyli na stan gotowy do zapisu. */
async function zamontujJakoRedaktor() {
  h.roles = ["editor"];
  stub().setResponse("event_types_active", ok([eventTypeOption()]));
  stub().setResponse("admin_event_create", ok(NEW_EVENT_ID));
  const utils = await zamontuj();
  await waitFor(() => expect(screen.getByTestId("formularz").dataset.types).toBe("1"));
  return utils;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.isAdmin = false;
  h.roles = [];
  h.lang = "pl";
  h.draft = pelnySzkic();
  h.rail = [];
  h.nawigacje = [];
  h.toastOk = [];
  h.toastErr = [];
});

afterEach(cleanup);

describe("nagłówek dokumentu kreatora", () => {
  it("trzyma panel POZA wyszukiwarką i nazywa ekran po ludzku", () => {
    // Adres panelu w indeksie to wyciek mapy administracji; kreator jest przy
    // tym jedyną stroną modułu, której adres nie zawiera identyfikatora, więc
    // najłatwiej byłoby go „przeoczyć" przy dokładaniu `noindex`.
    const entries = (routeHead(NewEventRoute).meta ?? []) as Record<string, unknown>[];

    expect(entries.find((entry) => "title" in entry)?.title).toBe("New event · Admin");
    expect(entries.find((entry) => entry.name === "robots")?.content).toBe("noindex, nofollow");
    expect(String(entries.find((entry) => entry.name === "description")?.content)).toContain(
      "event type",
    );
  });
});

describe("bramka roli - odmowa ma wyglądać na decyzję, nie na awarię", () => {
  it("czytelnik bez roli redaktora dostaje ZDANIE, a nie formularz", async () => {
    await zamontuj();

    expect(screen.getByText("adminEvents.list.adminOnly")).toBeTruthy();
    expect(screen.queryByTestId("formularz")).toBeNull();
    expect(screen.queryByTestId("rama-kreatora")).toBeNull();
  });

  it("czytelnik bez roli NIE MA jak zawołać `admin_event_create`", async () => {
    // Bramka ekranu nie zastępuje bramki bazy, ale ma jej nie zapraszać:
    // formularz, który wypełnia się do końca i dopiero wtedy odmawia, kosztuje
    // redaktora całą sesję wpisywania.
    await zamontuj();

    await waitFor(() => expect(stub().callsFor("event_types_active").length).toBeGreaterThan(0));
    expect(stub().callsFor("admin_event_create")).toEqual([]);
  });

  it("rola `editor` otwiera kreator", async () => {
    await zamontujJakoRedaktor();

    expect(screen.getByTestId("rama-kreatora")).toBeTruthy();
    expect(screen.queryByText("adminEvents.list.adminOnly")).toBeNull();
  });

  it("administrator BEZ jawnej roli redaktora też otwiera kreator", async () => {
    // `isAdmin` pochodzi z `admin`/`super_admin`, a te role nie zawierają
    // `editor` w tablicy. Warunek liczący samą tablicę zamknąłby kreator przed
    // administratorem serwisu.
    h.isAdmin = true;
    stub().setResponse("event_types_active", ok([eventTypeOption()]));

    await zamontuj();

    expect(screen.getByTestId("rama-kreatora")).toBeTruthy();
  });
});

describe("katalog rodzajów - selekt kreatora", () => {
  it("rodzaje jadą do formularza z RPC `event_types_active`", async () => {
    // Rodzaje są per najemca i redakcyjne, więc żadna stała w kodzie nie jest
    // dla nich poprawna - pusta lista jest tu stanem NORMALNYM, nie awarią.
    h.roles = ["editor"];
    stub().setResponse(
      "event_types_active",
      ok([eventTypeOption(), eventTypeOption({ id: "7b3e1d40-0000-4000-8000-000000000002" })]),
    );

    await zamontuj();

    await waitFor(() => expect(screen.getByTestId("formularz").dataset.types).toBe("2"));
    expect(stub().names()).toContain("event_types_active");
  });

  it("pusty katalog rodzajów NIE jest awarią - kreator stoi i czeka", async () => {
    h.roles = ["editor"];
    stub().setResponse("event_types_active", ok([]));

    await zamontuj();

    expect(screen.getByTestId("formularz").dataset.types).toBe("0");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("nagłówek railu - sidebar czyta stan TRASY, nie formularza", () => {
  it("tytuł wpisywany w formularzu dojeżdża do ramy studia", async () => {
    await zamontujJakoRedaktor();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "raportuj-szkic" }));
    });

    await waitFor(() =>
      expect(screen.getByTestId("rama-kreatora").dataset.title).toBe(
        "  Kongres Bezpieczeństwa Gospodarczego  ",
      ),
    );
  });

  it("interfejs EN bierze tytuł angielski, ale spada na polski, gdy go nie ma", async () => {
    // Wydarzenie powstaje zwykle po polsku (panel nie wymaga wersji EN).
    // Rail bez zapasowego języka pokazywałby redaktorowi z interfejsem EN
    // „Nowe wydarzenie" nad polem, w którym tytuł już stoi.
    h.lang = "en";
    h.draft = pelnySzkic({ titleEn: "" });
    await zamontujJakoRedaktor();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "raportuj-szkic" }));
    });

    await waitFor(() =>
      expect(screen.getByTestId("rama-kreatora").dataset.title).toBe(
        "  Kongres Bezpieczeństwa Gospodarczego  ",
      ),
    );
  });

  it("termin w railu jest DATĄ DLA CZŁOWIEKA, a nie surową wartością pola", async () => {
    // Pole formularza oddaje `2027-03-11T09:00`. Rail ma pokazać to samo, co
    // redaktor zobaczy potem w studiu - inaczej przejście z kreatora do studia
    // podmienia napis pod nosem.
    await zamontujJakoRedaktor();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "raportuj-szkic" }));
    });

    await waitFor(() => expect(screen.getByTestId("rama-kreatora").dataset.date).not.toBe(""));
    // DOKŁADNY napis, nie „zawiera 2027": surowe `2027-03-11T09:00` też zawiera
    // rok, a różnica między nim a datą dla człowieka jest właśnie tym, czego
    // ten przypadek pilnuje. Napis jest niezależny od strefy maszyny, bo
    // wartość pola jest czasem LOKALNYM, a rail formatuje ją w tej samej
    // strefie - godzina na zegarze wychodzi ta sama, w Warszawie i w Nowym Jorku.
    expect(screen.getByTestId("rama-kreatora").dataset.date).toBe("11 marca 2027 09:00");
  });

  it("pusty termin daje PUSTY napis - rama sama powie „bez terminu”", async () => {
    // Trasa nie zgaduje daty i nie wstawia „dziś": brak terminu jest stanem
    // szkicu, a zdanie o nim należy do ramy, nie do dwóch miejsc naraz.
    h.draft = pelnySzkic({ startsAt: "" });
    await zamontujJakoRedaktor();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "raportuj-szkic" }));
    });

    await waitFor(() => expect(h.rail.at(-1)?.date).toBe(""));
  });
});

describe("zapis - ładunek RPC `admin_event_create`", () => {
  it("tytuły idą PRZYCIĘTE, a chwila rozpoczęcia w ISO", async () => {
    // Redaktor wkleja tytuł ze spacją na końcu; taki napis wchodzi potem do
    // sluga, do karty społecznościowej i do wyszukiwania w panelu.
    await zamontujJakoRedaktor();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "zapisz" }));
    });

    await waitFor(() => expect(stub().callsFor("admin_event_create")).toHaveLength(1));
    const p = payload();
    expect(p.title_pl).toBe("Kongres Bezpieczeństwa Gospodarczego");
    expect(p.title_en).toBe("Economic Security Congress");
    expect(p.starts_at).toBe(new Date("2027-03-11T09:00").toISOString());
    expect(p.event_type_id).toBe("7b3e1d40-0000-4000-8000-000000000001");
  });

  it("pola WYPEŁNIONE jadą w ładunku - baza nie ma ich skąd zgadnąć", async () => {
    await zamontujJakoRedaktor();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "zapisz" }));
    });

    await waitFor(() => expect(stub().callsFor("admin_event_create")).toHaveLength(1));
    const p = payload();
    expect(p.ends_at).toBe(new Date("2027-03-12T17:00").toISOString());
    expect(p.timezone).toBe("Europe/Warsaw");
    expect(p.format).toBe("hybrid");
    expect(p.city).toBe("Warszawa");
    expect(p.country).toBe("PL");
  });

  it("pole PUSTE ZNIKA z ładunku - „nie podano” to nie „podano pustkę”", async () => {
    // Najważniejsza asercja tego bloku. Ładunek jest czytany operatorem `->>`,
    // więc brak klucza znaczy „policz z rodzaju wydarzenia", a `""` znaczy
    // „zapisz pustkę". Wydarzenie bez strefy i bez formatu nie da się później
    // poprawnie pokazać uczestnikowi w innej strefie.
    h.draft = pelnySzkic({
      endsAt: "   ",
      timezone: "  ",
      format: "",
      city: "",
      country: "  ",
      externalRegistrationUrl: "  ",
    });
    await zamontujJakoRedaktor();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "zapisz" }));
    });

    await waitFor(() => expect(stub().callsFor("admin_event_create")).toHaveLength(1));
    const p = payload();
    expect(Object.keys(p).sort()).toEqual(["event_type_id", "starts_at", "title_en", "title_pl"]);
  });

  it("adres rejestracji zewnętrznej jedzie PRZYCIĘTY, gdy redaktor go podał", async () => {
    h.draft = pelnySzkic({ externalRegistrationUrl: "  https://example.org/zapisy  " });
    await zamontujJakoRedaktor();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "zapisz" }));
    });

    await waitFor(() => expect(stub().callsFor("admin_event_create")).toHaveLength(1));
    expect(payload().external_registration_url).toBe("https://example.org/zapisy");
  });

  it("zapis idzie WYŁĄCZNIE przez RPC - trasa nie dotyka tabeli `events`", async () => {
    // Zawężenie najemcą i bramka roli siedzą w SQL (`assert_editor_tenant`),
    // więc zapis tabelaryczny obszedłby jedno i drugie. Pilnuje tego także
    // bramka `check:sql-tenant-scope` nad migracją; tutaj utrwalamy, że front
    // nie ma drugiej ścieżki zapisu.
    await zamontujJakoRedaktor();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "zapisz" }));
    });

    await waitFor(() => expect(stub().callsFor("admin_event_create")).toHaveLength(1));
    expect([...new Set(stub().names())].sort()).toEqual([
      "admin_event_create",
      "event_types_active",
    ]);
  });

  it("udany zapis ODŚWIEŻA katalog rodzajów - liczniki przy rodzajach się zmieniły", async () => {
    // Skutek uboczny, ale zamierzony i widoczny: lista rodzajów pokazuje przy
    // każdym z nich liczbę wydarzeń. Bez unieważnienia redaktor wraca na listę
    // rodzajów i widzi licznik sprzed swojego zapisu - czyli dane, o których
    // wie, że są nieprawdziwe.
    await zamontujJakoRedaktor();
    const przedZapisem = stub().callsFor("event_types_active").length;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "zapisz" }));
    });

    await waitFor(() =>
      expect(stub().callsFor("event_types_active").length).toBeGreaterThan(przedZapisem),
    );
  });
});

describe("po zapisie - dokąd wraca redaktor", () => {
  it("udany zapis prowadzi NA PULPIT nowego wydarzenia, nie na listę", async () => {
    // To jest cała decyzja tej trasy o ciągu dalszym. Powrót na listę kazałby
    // odszukać świeży wiersz wśród kilkudziesięciu i wejść w niego ręcznie.
    await zamontujJakoRedaktor();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "zapisz" }));
    });

    await waitFor(() => expect(h.nawigacje).toHaveLength(1));
    expect(h.nawigacje[0]).toEqual({
      to: "/admin/events/$eventId/overview",
      params: { eventId: NEW_EVENT_ID },
    });
    expect(h.toastOk).toEqual(["adminEvents.list.toasts.created"]);
  });

  it("odmowa bazy pokazuje JEJ komunikat i ZOSTAWIA redaktora na kreatorze", async () => {
    // Redaktor ma zobaczyć, co odmówiło, i mieć pod ręką wpisane pola.
    // Nawigacja przy błędzie skasowałaby całą sesję wypełniania.
    h.roles = ["editor"];
    stub().setResponse("event_types_active", ok([eventTypeOption()]));
    stub().setError("admin_event_create", "brak uprawnień redaktora", "42501");
    await zamontuj();
    await waitFor(() => expect(screen.getByTestId("formularz")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "zapisz" }));
    });

    await waitFor(() => expect(h.toastErr).toEqual(["brak uprawnień redaktora"]));
    expect(h.nawigacje).toEqual([]);
    expect(screen.getByTestId("formularz")).toBeTruthy();
  });

  it("„Anuluj” wraca NA LISTĘ - kreator nie ma czego zapisywać", async () => {
    await zamontujJakoRedaktor();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "anuluj" }));
    });

    expect(h.nawigacje).toEqual([{ to: "/admin/events/list" }]);
    expect(stub().callsFor("admin_event_create")).toEqual([]);
  });
});
