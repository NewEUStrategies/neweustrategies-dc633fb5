// Warstwa danych LISTY WYDARZEŃ - nazwa RPC, KOMPLET nazw argumentów i kształt
// odpowiedzi.
//
// DLACZEGO TO JEST TESTOWALNY KONTRAKT, A NIE „opakowanie na `rpc`". Lista jest
// RPC-only świadomie: `join_url` i `recording_url` zostały odcięte od
// klienckiego SELECT-a grantem kolumnowym, więc RPC oddaje wyłącznie dwie FLAGI
// (`has_stream`, `has_recording`). Serwer zakresuje po tym, co dostanie -
// zgubiony albo przemianowany argument jest równoważny UTRACIE ZAWĘŻENIA, czyli
// pokazaniu redaktorowi cudzych wierszy albo policzeniu zakładek od innego
// zbioru niż lista pod nimi. Taki błąd przechodzi przez `tsc` (obiekt
// argumentów jest luźny, a wszystkie argumenty są opcjonalne), przez przegląd
// (jedna literówka wśród ośmiu podobnych kluczy) i przez interfejs (lista i tak
// coś rysuje).
//
// CO TEN PLIK MA ŁAPAĆ.
//   1. NAZWY FUNKCJI (`admin_events_list`, `admin_events_counts`,
//      `admin_event_create`) zgodne z migracją co do znaku.
//   2. BRAK KLUCZA ZAMIAST `null`. I argumenty RPC, i payload `jsonb` są
//      czytane po stronie bazy tak, że „klucza nie ma" znaczy DEFAULT/serwerowe
//      przepisanie, a `null` znaczy „podano puste". Test pilnuje tego przez
//      `has()` / `in`, bo `toEqual` nie odróżnia braku klucza od `undefined`.
//   3. LICZNIKI NIE MAJĄ STATUSU ANI GRANICY CZASU - inaczej zakładka
//      pokazywałaby liczbę własnego zbioru, a nie zbioru całości.
//   4. `jsonb` JEST NIETYPOWANY: brak pola, pole nieliczbowe, NaN, tablica,
//      napis - każde osobno degraduje do zera/pustych liczników, a nie wywraca
//      nagłówka listy.
//   5. ODMOWA BAZY JEST PRZEPUSZCZANA, nie tłumiona pustym zbiorem.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub } from "@/test/supabase/rpc";
import type { EventListParams } from "@/lib/events/eventListParams";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const { createEventFromType, fetchAdminEventCounts, fetchAdminEvents } =
  await import("@/lib/events/eventsListApi");

/** Granica „przyszłe/przeszłe" zamrożona, żeby asercja mogła podać dokładne ISO. */
const TERAZ = new Date("2026-03-10T08:30:00.000Z");

/** Minimalne, poprawne wejście tworzenia - same wymagane pola, reszta `null`. */
function wejscieTworzenia(patch: Partial<Parameters<typeof createEventFromType>[0]> = {}) {
  return {
    eventTypeId: "11111111-2222-3333-4444-555555555555",
    titlePl: "Śniadanie z Komisją",
    titleEn: "Breakfast with the Commission",
    startsAt: "2026-04-01T07:00:00.000Z",
    endsAt: null,
    timezone: null,
    format: null,
    city: null,
    country: null,
    externalRegistrationUrl: null,
    ...patch,
  };
}

/** Payload `jsonb` ostatniego wywołania `admin_event_create`. */
function payload(): Record<string, unknown> {
  const call = h.rpc?.lastCall("admin_event_create");
  if (call === undefined) throw new Error("test: RPC tworzenia nie zostało wywołane");
  return call.arg("p_payload") as Record<string, unknown>;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("fetchAdminEvents - kontrakt RPC listy", () => {
  it("woła funkcję o nazwie z migracji i tylko ją", async () => {
    h.rpc!.setData("admin_events_list", []);
    await fetchAdminEvents({}, TERAZ);
    expect(h.rpc!.names()).toEqual(["admin_events_list"]);
  });

  it("czysta lista wysyła WYŁĄCZNIE paginację - filtrów nie ma jako kluczy", async () => {
    h.rpc!.setData("admin_events_list", []);
    await fetchAdminEvents({}, TERAZ);
    const call = h.rpc!.lastCall("admin_events_list")!;
    expect(call.keys().sort()).toEqual(["p_limit", "p_offset"]);
    // `has` zamiast porównania z `undefined`: klucz o wartości `null` kasuje
    // serwerowy DEFAULT, więc „nie ma klucza" jest INNĄ odpowiedzią.
    expect(call.has("p_status")).toBe(false);
    expect(call.has("p_q")).toBe(false);
    expect(call.has("p_from")).toBe(false);
    expect(call.has("p_to")).toBe(false);
  });

  it("komplet filtrów jedzie pod nazwami argumentów RPC", async () => {
    h.rpc!.setData("admin_events_list", []);
    const params: EventListParams = {
      tab: "draft",
      q: "bruksela",
      t: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      f: "hybrid",
      page: 3,
      size: 50,
    };
    await fetchAdminEvents(params, TERAZ);
    const call = h.rpc!.lastCall("admin_events_list")!;
    expect(call.arg("p_status")).toBe("draft");
    expect(call.arg("p_q")).toBe("bruksela");
    expect(call.arg("p_type_id")).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(call.arg("p_format")).toBe("hybrid");
    expect(call.arg("p_limit")).toBe(50);
    expect(call.arg("p_offset")).toBe(100);
  });

  it("zakładka „przyszłe” to status published PLUS dolna granica czasu", async () => {
    h.rpc!.setData("admin_events_list", []);
    await fetchAdminEvents({ tab: "upcoming" }, TERAZ);
    const call = h.rpc!.lastCall("admin_events_list")!;
    expect(call.arg("p_status")).toBe("published");
    expect(call.arg("p_from")).toBe("2026-03-10T08:30:00.000Z");
    expect(call.has("p_to")).toBe(false);
  });

  it("zakładka „przeszłe” to status published PLUS górna granica czasu", async () => {
    h.rpc!.setData("admin_events_list", []);
    await fetchAdminEvents({ tab: "past" }, TERAZ);
    const call = h.rpc!.lastCall("admin_events_list")!;
    expect(call.arg("p_status")).toBe("published");
    expect(call.arg("p_to")).toBe("2026-03-10T08:30:00.000Z");
    expect(call.has("p_from")).toBe(false);
  });

  it("granica czasu bierze się z podanego „teraz”, nie z zegara systemowego", async () => {
    h.rpc!.setData("admin_events_list", []);
    await fetchAdminEvents({ tab: "upcoming" }, new Date("2019-12-31T23:59:59.000Z"));
    expect(h.rpc!.lastCall("admin_events_list")!.arg("p_from")).toBe("2019-12-31T23:59:59.000Z");
  });

  it("oddaje wiersze RPC bez przepisywania - flagi transmisji i nagrania zostają", async () => {
    const wiersz = {
      id: "e1",
      title_pl: "Debata",
      title_en: "Debate",
      has_stream: true,
      has_recording: false,
      total_count: 137,
      seats_left: 4,
    };
    h.rpc!.setData("admin_events_list", [wiersz]);
    const rows = await fetchAdminEvents({}, TERAZ);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(wiersz);
    // Żadnego adresu transmisji ani nagrania w odpowiedzi - tylko flagi.
    expect(Object.keys(rows[0])).not.toContain("join_url");
    expect(Object.keys(rows[0])).not.toContain("recording_url");
  });

  it("pusty zbiór wierszy to `[]`, a nie awaria", async () => {
    h.rpc!.setData("admin_events_list", []);
    await expect(fetchAdminEvents({}, TERAZ)).resolves.toEqual([]);
  });

  it("`null` z bazy degraduje do `[]` - lista renderuje pustkę, nie wyjątek", async () => {
    h.rpc!.setData("admin_events_list", null);
    await expect(fetchAdminEvents({}, TERAZ)).resolves.toEqual([]);
  });

  it("odmowa bazy jest przepuszczana z kodem SQLSTATE", async () => {
    h.rpc!.setError("admin_events_list", "permission denied for function", "42501");
    await expect(fetchAdminEvents({}, TERAZ)).rejects.toMatchObject({
      message: "permission denied for function",
      code: "42501",
    });
  });

  it("błąd wygrywa nad danymi, jeśli baza odda oba naraz", async () => {
    h.rpc!.setResponse("admin_events_list", {
      data: [{ id: "e1" }],
      error: Object.assign(new Error("statement timeout"), { code: "57014" }),
    });
    await expect(fetchAdminEvents({}, TERAZ)).rejects.toThrow("statement timeout");
  });

  it("brak zaplanowanej odpowiedzi to odmowa, nie ciche `[]`", async () => {
    // Dowód, że atrapa nie udaje poprawnego odczytu funkcji, której nikt nie
    // zaplanował - inaczej każdy kolejny test przestałby cokolwiek znaczyć.
    await expect(fetchAdminEvents({}, TERAZ)).rejects.toThrow(/brak zaplanowanej odpowiedzi/);
  });
});

describe("fetchAdminEventCounts - kontrakt RPC liczników", () => {
  const PELNE = { all: 137, draft: 12, published: 100, cancelled: 25, upcoming: 40, past: 60 };

  it("woła `admin_events_counts` i przekazuje te same filtry co lista", async () => {
    h.rpc!.setData("admin_events_counts", PELNE);
    await fetchAdminEventCounts({
      q: "energia",
      t: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      f: "online",
    });
    const call = h.rpc!.lastCall("admin_events_counts")!;
    expect(call.name).toBe("admin_events_counts");
    expect(call.arg("p_q")).toBe("energia");
    expect(call.arg("p_type_id")).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(call.arg("p_format")).toBe("online");
  });

  it("liczniki NIE dostają statusu, granicy czasu ani paginacji", async () => {
    // Gdyby dostały, każda zakładka pokazywałaby liczbę własnego zbioru -
    // czyli „wersje robocze (12)" obok zakładki, na której i tak jest 12.
    h.rpc!.setData("admin_events_counts", PELNE);
    await fetchAdminEventCounts({ tab: "upcoming", page: 4, size: 100 });
    const call = h.rpc!.lastCall("admin_events_counts")!;
    expect(call.keys()).toEqual([]);
    expect(call.has("p_status")).toBe(false);
    expect(call.has("p_from")).toBe(false);
    expect(call.has("p_to")).toBe(false);
    expect(call.has("p_limit")).toBe(false);
    expect(call.has("p_offset")).toBe(false);
  });

  it("czyta pełną odpowiedź `jsonb` pole po polu", async () => {
    h.rpc!.setData("admin_events_counts", PELNE);
    await expect(fetchAdminEventCounts({})).resolves.toEqual(PELNE);
  });

  it("zero jest liczbą, nie brakiem - zakładka pokazuje „(0)”", async () => {
    h.rpc!.setData("admin_events_counts", { ...PELNE, cancelled: 0 });
    const counts = await fetchAdminEventCounts({});
    expect(counts.cancelled).toBe(0);
  });

  it("brak pola w odpowiedzi degraduje do zera, nie do NaN", async () => {
    h.rpc!.setData("admin_events_counts", { all: 5 });
    const counts = await fetchAdminEventCounts({});
    expect(counts).toEqual({ all: 5, draft: 0, published: 0, cancelled: 0, upcoming: 0, past: 0 });
    expect(Number.isNaN(counts.draft)).toBe(false);
  });

  it("pole nieliczbowe degraduje do zera - napis, `null` i obiekt", async () => {
    h.rpc!.setData("admin_events_counts", {
      ...PELNE,
      all: "137",
      draft: null,
      published: { value: 100 },
      cancelled: true,
    });
    const counts = await fetchAdminEventCounts({});
    expect(counts.all).toBe(0);
    expect(counts.draft).toBe(0);
    expect(counts.published).toBe(0);
    expect(counts.cancelled).toBe(0);
    expect(counts.upcoming).toBe(40);
  });

  it("NaN i nieskończoność nie trafiają na ekran", async () => {
    h.rpc!.setData("admin_events_counts", {
      ...PELNE,
      all: Number.NaN,
      draft: Number.POSITIVE_INFINITY,
      published: Number.NEGATIVE_INFINITY,
    });
    const counts = await fetchAdminEventCounts({});
    expect(counts.all).toBe(0);
    expect(counts.draft).toBe(0);
    expect(counts.published).toBe(0);
  });

  it("liczba ujemna PRZECHODZI bez korekty - warstwa danych nie zgaduje", async () => {
    h.rpc!.setData("admin_events_counts", { ...PELNE, past: -3 });
    await expect(fetchAdminEventCounts({})).resolves.toMatchObject({ past: -3 });
  });

  it("nadmiarowe pola odpowiedzi są ignorowane", async () => {
    h.rpc!.setData("admin_events_counts", { ...PELNE, archived: 9, total: 999 });
    await expect(fetchAdminEventCounts({})).resolves.toEqual(PELNE);
  });

  it("`null` z bazy daje komplet zer", async () => {
    h.rpc!.setData("admin_events_counts", null);
    await expect(fetchAdminEventCounts({})).resolves.toEqual({
      all: 0,
      draft: 0,
      published: 0,
      cancelled: 0,
      upcoming: 0,
      past: 0,
    });
  });

  it("`undefined` z bazy daje komplet zer", async () => {
    h.rpc!.setData("admin_events_counts", undefined);
    await expect(fetchAdminEventCounts({})).resolves.toMatchObject({ all: 0, past: 0 });
  });

  it("wartość skalarna zamiast obiektu daje komplet zer", async () => {
    for (const skalar of ["nonsense", 137, true]) {
      h.rpc!.setData("admin_events_counts", skalar);
      await expect(fetchAdminEventCounts({})).resolves.toMatchObject({ all: 0, draft: 0 });
    }
  });

  it("tablica zamiast obiektu daje komplet zer", async () => {
    // `typeof [] === "object"`, więc bez osobnego `Array.isArray` tablica
    // przeszłaby dalej i czytano by z niej klucze tekstowe.
    h.rpc!.setData("admin_events_counts", [PELNE]);
    await expect(fetchAdminEventCounts({})).resolves.toMatchObject({ all: 0, published: 0 });
  });

  it("pusty obiekt daje komplet zer", async () => {
    h.rpc!.setData("admin_events_counts", {});
    await expect(fetchAdminEventCounts({})).resolves.toEqual({
      all: 0,
      draft: 0,
      published: 0,
      cancelled: 0,
      upcoming: 0,
      past: 0,
    });
  });

  it("odmowa bazy jest przepuszczana, a nie tłumiona zerami", async () => {
    // Zera przy odmowie kłamałyby: „0 wydarzeń" wygląda jak pusty zbiór, a nie
    // jak brak uprawnień.
    h.rpc!.setError("admin_events_counts", "assert_admin_tenant failed", "42501");
    await expect(fetchAdminEventCounts({})).rejects.toMatchObject({ code: "42501" });
  });

  it("USTERKA: dwa puste odczyty oddają TEN SAM obiekt, więc mutacja przecieka", async () => {
    // Zachowanie OBECNE, opisane świadomie. `EMPTY_COUNTS` jest stałą modułu
    // zwracaną przez referencję, a typ zwrotny nie jest `readonly` - wywołujący,
    // który podbije licznik w miejscu (np. optymistyczne „+1" po utworzeniu
    // wydarzenia), zatruwa każdy następny pusty odczyt w tej sesji przeglądarki.
    h.rpc!.setData("admin_events_counts", null);
    const pierwszy = await fetchAdminEventCounts({});
    const drugi = await fetchAdminEventCounts({});
    expect(drugi).toBe(pierwszy);
    pierwszy.all = 99;
    const trzeci = await fetchAdminEventCounts({});
    expect(trzeci.all).toBe(99);
  });
});

describe("createEventFromType - payload jsonb", () => {
  it("woła `admin_event_create` z JEDNYM argumentem `p_payload`", async () => {
    h.rpc!.setData("admin_event_create", "abc");
    await createEventFromType(wejscieTworzenia());
    const call = h.rpc!.lastCall("admin_event_create")!;
    expect(call.name).toBe("admin_event_create");
    expect(call.keys()).toEqual(["p_payload"]);
  });

  it("wymagane pola jadą w snake_case bazy, nie w camelCase formularza", async () => {
    h.rpc!.setData("admin_event_create", "abc");
    await createEventFromType(wejscieTworzenia());
    expect(payload()).toMatchObject({
      event_type_id: "11111111-2222-3333-4444-555555555555",
      title_pl: "Śniadanie z Komisją",
      title_en: "Breakfast with the Commission",
      starts_at: "2026-04-01T07:00:00.000Z",
    });
  });

  it("`null` w polu opcjonalnym POMIJA klucz, a nie wysyła `null`", async () => {
    // Payload jest czytany operatorem `->>`, więc brak klucza i klucz o wartości
    // `null` znaczą dla bazy to samo - ale pominięcie nie kłamie, że cokolwiek
    // podano, i zostawia serwerowi przepisanie wartości z RODZAJU.
    h.rpc!.setData("admin_event_create", "abc");
    await createEventFromType(wejscieTworzenia());
    expect(Object.keys(payload()).sort()).toEqual([
      "event_type_id",
      "starts_at",
      "title_en",
      "title_pl",
    ]);
    for (const klucz of [
      "external_registration_url",
      "ends_at",
      "timezone",
      "format",
      "city",
      "country",
    ]) {
      expect(klucz in payload()).toBe(false);
    }
  });

  it("komplet pól opcjonalnych trafia do payloadu pod nazwami bazy", async () => {
    h.rpc!.setData("admin_event_create", "abc");
    await createEventFromType(
      wejscieTworzenia({
        endsAt: "2026-04-01T09:00:00.000Z",
        timezone: "Europe/Brussels",
        format: "hybrid",
        city: "Bruksela",
        country: "BE",
        externalRegistrationUrl: "https://example.org/rejestracja",
      }),
    );
    expect(payload()).toEqual({
      event_type_id: "11111111-2222-3333-4444-555555555555",
      title_pl: "Śniadanie z Komisją",
      title_en: "Breakfast with the Commission",
      starts_at: "2026-04-01T07:00:00.000Z",
      external_registration_url: "https://example.org/rejestracja",
      ends_at: "2026-04-01T09:00:00.000Z",
      timezone: "Europe/Brussels",
      format: "hybrid",
      city: "Bruksela",
      country: "BE",
    });
  });

  it("każde pole opcjonalne rozstrzyga się OSOBNO - podanie jednego nie wciąga reszty", async () => {
    h.rpc!.setData("admin_event_create", "abc");
    await createEventFromType(wejscieTworzenia({ city: "Warszawa" }));
    expect("city" in payload()).toBe(true);
    expect("country" in payload()).toBe(false);
    expect("format" in payload()).toBe(false);
    expect("ends_at" in payload()).toBe(false);
    expect("timezone" in payload()).toBe(false);
    expect("external_registration_url" in payload()).toBe(false);
  });

  it("pusty napis NIE jest brakiem wartości - klucz jedzie z pustym napisem", async () => {
    // Rozróżnienie ma skutek: dla rodzaju o trybie `external` baza odrzuca
    // wiersz warunkiem `events_external_mode_requires_url`, więc pusty napis ma
    // dojechać do bazy i dostać odmowę, a nie zniknąć po drodze.
    h.rpc!.setData("admin_event_create", "abc");
    await createEventFromType(
      wejscieTworzenia({ externalRegistrationUrl: "", city: "", country: "", timezone: "" }),
    );
    expect(payload().external_registration_url).toBe("");
    expect(payload().city).toBe("");
    expect(payload().country).toBe("");
    expect(payload().timezone).toBe("");
  });

  it("oddaje identyfikator nowego wydarzenia jako napis", async () => {
    h.rpc!.setData("admin_event_create", "99999999-8888-7777-6666-555555555555");
    await expect(createEventFromType(wejscieTworzenia())).resolves.toBe(
      "99999999-8888-7777-6666-555555555555",
    );
  });

  it("odpowiedź nie-napisowa jest sprowadzana do napisu", async () => {
    h.rpc!.setData("admin_event_create", 12345);
    await expect(createEventFromType(wejscieTworzenia())).resolves.toBe("12345");
  });

  it("USTERKA: brak identyfikatora bez błędu daje napis „null”", async () => {
    // Zachowanie OBECNE. `String(null)` to `"null"`, więc ekran przechodzi do
    // trasy `/admin/events/null` zamiast zgłosić, że tworzenie nic nie oddało.
    h.rpc!.setData("admin_event_create", null);
    await expect(createEventFromType(wejscieTworzenia())).resolves.toBe("null");
  });

  it("odmowa warunku bazy jest przepuszczana bez tłumaczenia na zdanie", async () => {
    h.rpc!.setError("admin_event_create", "external_url_required", "P0001");
    await expect(createEventFromType(wejscieTworzenia())).rejects.toMatchObject({
      message: "external_url_required",
      code: "P0001",
    });
  });

  it("przy odmowie nie ma co zwracać - obietnica jest odrzucona, nie spełniona", async () => {
    h.rpc!.setResponse("admin_event_create", {
      data: "e-1",
      error: Object.assign(new Error("assert_admin_tenant failed"), { code: "42501" }),
    });
    await expect(createEventFromType(wejscieTworzenia())).rejects.toThrow(
      "assert_admin_tenant failed",
    );
  });
});
