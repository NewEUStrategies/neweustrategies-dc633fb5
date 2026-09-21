// GIELDA SPOTKAN 1-1: ODCZYTY PANELU, ODCZYT KONFIGURACJI I ODMOWY BAZY.
//
// PODZIAL PRACY. `meetingsApi.test.ts` wzial KONTRAKT NAZW w ladunkach (ktory
// klucz czyta ktora funkcja bazy), `meetingsApiMutations.test.ts` (pierwsza
// fala) - usuwanie stolika i okna oraz przelacznik widocznosci w katalogu.
// Tutaj stoi to, czego nie wolal nikt: `fetchMeetingTables`,
// `fetchMeetingSettings` (razem z degradacja `parseMeetingSettings`),
// `fetchMeetingStats`, `fetchMeetingDirectory`, WARTOSCI DOMYSLNE ladunkow
// i galezie ODMOWY wszystkich pozostalych funkcji. Zmierzone przed ta praca:
// 83,49% linii, 88,57% funkcji, 69,68% galezi - galezie byly tu najslabsze.
//
// CO TU PILNUJEMY.
//
// 1) NIECZYTELNA KONFIGURACJA MA DEGRADOWAC DO STANU BEZPIECZNEGO.
//    `admin_event_meeting_settings_get` oddaje `jsonb`, wiec typ generowany to
//    `Json` - deklaracja intencji, nie fakt o ksztalcie. Wczesniej bylo tu
//    podwojne rzutowanie i zmiana nazwy klucza w `jsonb_build_object`
//    zamieniala sie w ekran ustawien z pustymi polami BEZ jednego bledu -
//    organizator zapisalby wtedy wartosci domyslne na dzialajacej gieldzie
//    (`meetingsApi.ts:164-178`). Test przypina wlasnie to: brak danych daje
//    `configured: false`, `is_enabled: false` i `visibility: "disabled"`,
//    czyli „skonfiguruj od nowa", a nie „znam twoja konfiguracje".
// 2) `null` TO BRAK LIMITU, A NIE ZERO. `max_invites_per_person` i
//    `max_meetings_per_day` sa w bazie NULL-owalne i NULL znaczy „bez limitu".
//    Sklejenie ich z zerem ZAMKNELOBY gielde: nikt nie moglby wyslac ani
//    jednego zaproszenia, a ekran pokazywalby poprawnie wygladajaca
//    konfiguracje.
// 3) WARTOSC DOMYSLNA JEST CZESCIA KONTRAKTU. `status ?? "all"`, `limit ?? 50`,
//    `limit ?? 100`: filtr `all` NIE jest wartoscia w bazie, tylko umowionym
//    „bez filtra". Zgubiona domyslna zamienia otwarcie panelu w pusty ekran.
// 4) ODMOWA MA POLECIEC WYJATKIEM. Kazda funkcja tego pliku konczy sie
//    `if (error) throw error`, a nad nim stoi ekran, ktory bez wyjatku
//    narysuje sukces: przyjete spotkanie, ktorego nie ma, albo zapisane okno
//    dostepnosci, ktorego baza nie przyjela.
//
// ZAWEZENIE NAJEMCEM SIEDZI W SQL (zasada 12): plaszczyzna panelu zaczyna sie
// od `assert_editor_tenant()`, plaszczyzna uczestnika od `public_tenant_id()`
// plus `auth.uid()` (`20260825063440`, `20260828131628`). Pilnuje go bramka
// `check:sql-tenant-scope`; po stronie klienta testowalne jest to, ze klient
// NIE PROBUJE podac najemcy ani tozsamosci sam.
//
// ATRAPA OBEJMUJE WYLACZNIE KLIENTA SUPABASE (granica). `meetingsApi` jest
// modulem POKRYWANYM i nie wolno go podmieniac.
//
// RODO: uczestnicy, firmy i identyfikatory sa syntetyczne.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/meetingsApi");

const EVENT_ID = "8d9e0000-0000-4000-8000-000000000001";
const EVENT_SLUG = "kongres-przykladowy-2026";
const GROUP_ID = "8d9e0000-0000-4000-8000-000000000002";
const TABLE_ID = "8d9e0000-0000-4000-8000-000000000003";
const REG_A = "8d9e0000-0000-4000-8000-000000000004";
const REG_B = "8d9e0000-0000-4000-8000-000000000005";
const MEETING_ID = "8d9e0000-0000-4000-8000-000000000006";
const WINDOW_ID = "8d9e0000-0000-4000-8000-000000000007";

function rpc(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function payloadOf(name: string): Record<string, unknown> {
  const call = rpc().lastCall(name);
  if (call === undefined) throw new Error(`test: ${name} nie zostalo wolane`);
  const sent = call.arg("p_payload");
  if (sent === null || typeof sent !== "object") {
    throw new Error(`test: ${name} dostalo p_payload, ktory nie jest obiektem`);
  }
  return sent as Record<string, unknown>;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

/* ------------------------------------------------------------- stoliki --- */

describe("fetchMeetingTables", () => {
  it("stoliki ida po wydarzeniu i wracaja z licznikami bazy nietknietymi", async () => {
    // `next_meeting_at: null` znaczy „stolik wolny do konca gieldy". Panel
    // czyta te kolumne wprost, wiec uzupelnienie jej data biezaca pokazaloby
    // wolny stolik jako zajety.
    const stolik = {
      id: TABLE_ID,
      label: "Stolik 12",
      capacity: 1,
      meetings_count: 0,
      minutes_taken: 0,
      next_meeting_at: null,
      room_name: null,
    };
    rpc().setData("admin_event_meeting_tables_list", [stolik]);

    await expect(api.fetchMeetingTables(EVENT_ID)).resolves.toEqual([stolik]);
    expect(rpc().lastCall("admin_event_meeting_tables_list")?.args).toEqual({
      p_event_id: EVENT_ID,
    });
  });

  it("brak stolikow to pusta lista, a nie `null` w panelu", async () => {
    rpc().setData("admin_event_meeting_tables_list", null);

    await expect(api.fetchMeetingTables(EVENT_ID)).resolves.toEqual([]);
  });
});

/* ------------------------------------------------- konfiguracja gieldy --- */

/** Odpowiedz `admin_event_meeting_settings_get` w komplecie, jak z bazy. */
const KONFIGURACJA = {
  configured: true,
  event_id: EVENT_ID,
  event_timezone: "Europe/Warsaw",
  is_enabled: true,
  slot_minutes: 20,
  break_minutes: 5,
  day_start_time: "09:00",
  day_end_time: "17:00",
  meeting_days: ["2026-10-12", "2026-10-13"],
  timezone: "Europe/Warsaw",
  invites_open_at: "2026-09-20T08:00:00+00:00",
  invites_close_at: "2026-10-11T20:00:00+00:00",
  max_invites_per_person: 8,
  max_meetings_per_day: 6,
  invite_expires_after_hours: 72,
  visibility: "groups",
  intro_pl: "Zaproszenia otwieramy 20 wrzesnia.",
  intro_en: "Invitations open on 20 September.",
  updated_at: "2026-09-01T10:00:00+00:00",
  requester_groups: [
    {
      group_id: GROUP_ID,
      key: "wystawcy",
      name_pl: "Wystawcy",
      name_en: "Exhibitors",
      can_meet: true,
      can_lead_retrieval: true,
    },
  ],
  invitee_groups: [],
  available_groups: [],
  tables_count: 12,
  seats_count: 12,
  participants_count: 340,
  with_availability_count: 96,
};

describe("fetchMeetingSettings", () => {
  it("czyta odpowiedz bazy pole po polu, razem z regulami grup", async () => {
    rpc().setData("admin_event_meeting_settings_get", KONFIGURACJA);

    const ustawienia = await api.fetchMeetingSettings(EVENT_ID);

    expect(rpc().lastCall("admin_event_meeting_settings_get")?.args).toEqual({
      p_event_id: EVENT_ID,
    });
    expect(ustawienia.configured).toBe(true);
    expect(ustawienia.is_enabled).toBe(true);
    expect(ustawienia.visibility).toBe("groups");
    expect(ustawienia.meeting_days).toEqual(["2026-10-12", "2026-10-13"]);
    expect(ustawienia.max_invites_per_person).toBe(8);
    expect(ustawienia.requester_groups).toEqual([
      {
        group_id: GROUP_ID,
        key: "wystawcy",
        name_pl: "Wystawcy",
        name_en: "Exhibitors",
        can_meet: true,
        can_lead_retrieval: true,
      },
    ]);
    // Liczniki sa jedynym miejscem, z ktorego organizator dowiaduje sie, ile
    // osob ma w ogole zadeklarowana dostepnosc - zanim wlaczy gielde.
    expect(ustawienia.tables_count).toBe(12);
    expect(ustawienia.with_availability_count).toBe(96);
  });

  it("odpowiedz NIECZYTELNA degraduje do `skonfiguruj od nowa`, a nie do wlaczonej gieldy", async () => {
    // Tablica, napis i `null` to trzy ksztalty, ktore transport albo zmiana
    // `jsonb_build_object` moga tu przyniesc. Kazdy z nich ma dac ten SAM
    // bezpieczny stan: gielda wylaczona, widocznosc `disabled`, brak grup.
    // Odwrotnosc - `is_enabled: true` z pustymi polami - kazalaby ekranowi
    // zapisac konfiguracje domyslna NA DZIALAJACEJ gieldzie.
    for (const odpowiedz of [null, [], "brak", 7]) {
      rpc().setData("admin_event_meeting_settings_get", odpowiedz);

      const ustawienia = await api.fetchMeetingSettings(EVENT_ID);

      expect(ustawienia.configured).toBe(false);
      expect(ustawienia.is_enabled).toBe(false);
      expect(ustawienia.visibility).toBe("disabled");
      expect(ustawienia.requester_groups).toEqual([]);
      expect(ustawienia.available_groups).toEqual([]);
      expect(ustawienia.meeting_days).toEqual([]);
      // Wydarzenie bierze sie z ARGUMENTU: ekran bez identyfikatora nie umialby
      // zapisac zmian, a to jest wlasnie ten przypadek.
      expect(ustawienia.event_id).toBe(EVENT_ID);
    }
  });

  it("puste `event_id` w odpowiedzi nie zabiera ekranowi mozliwosci zapisu", async () => {
    rpc().setData("admin_event_meeting_settings_get", { ...KONFIGURACJA, event_id: "" });

    await expect(api.fetchMeetingSettings(EVENT_ID)).resolves.toMatchObject({
      event_id: EVENT_ID,
      configured: true,
    });
  });

  it("BRAK LIMITU zostaje brakiem limitu, a nie zerem", async () => {
    rpc().setData("admin_event_meeting_settings_get", {
      ...KONFIGURACJA,
      max_invites_per_person: null,
      max_meetings_per_day: undefined,
    });

    const ustawienia = await api.fetchMeetingSettings(EVENT_ID);

    // Zero znaczy „ani jednego zaproszenia" i zamknieloby gielde przy
    // wlaczonym przelaczniku - najgorszy mozliwy stan, bo wyglada na dzialajacy.
    expect(ustawienia.max_invites_per_person).toBeNull();
    expect(ustawienia.max_meetings_per_day).toBeNull();
  });

  it("nieznana regula widocznosci degraduje do `disabled`, a nie do `everyone`", async () => {
    rpc().setData("admin_event_meeting_settings_get", {
      ...KONFIGURACJA,
      visibility: "sponsors_only",
    });

    // Nazwa spoza CHECK-a moze przyjsc ze starszego klienta albo z migracji
    // w toku. Domysl „pewnie chodzilo o wszystkich" wystawilby liste
    // uczestnikow szerzej, niz chcial organizator - i to bez sladu w interfejsie.
    await expect(api.fetchMeetingSettings(EVENT_ID)).resolves.toMatchObject({
      visibility: "disabled",
    });
  });

  it("liczby i napisy o zlym typie schodza do wartosci domyslnych, a nie do `NaN`", async () => {
    rpc().setData("admin_event_meeting_settings_get", {
      ...KONFIGURACJA,
      slot_minutes: "20",
      invite_expires_after_hours: null,
      day_start_time: 900,
      invites_open_at: "",
      updated_at: 17,
    });

    const ustawienia = await api.fetchMeetingSettings(EVENT_ID);

    // Napis `"20"` w polu minut przeszedlby przez arytmetyke siatki terminow
    // jako sklejenie tekstu, a `NaN` w dlugosci okna zwinąłby cala siatke.
    expect(ustawienia.slot_minutes).toBe(0);
    expect(ustawienia.invite_expires_after_hours).toBe(0);
    expect(ustawienia.day_start_time).toBe("");
    // Pusty napis w dacie to BRAK daty, a nie data - `new Date("")` daje
    // „Invalid Date" na ekranie ustawien.
    expect(ustawienia.invites_open_at).toBeNull();
    expect(ustawienia.updated_at).toBeNull();
  });

  it("dni gieldy filtruja sie do samych napisow, a nie-tablica daje pusta liste", async () => {
    rpc().setData("admin_event_meeting_settings_get", {
      ...KONFIGURACJA,
      meeting_days: ["2026-10-12", 20261013, null, "2026-10-14"],
    });
    // Liczba w miejscu daty zrobilaby z siatki dzien o nazwie „20261013",
    // ktorego nikt nie umie wybrac w kalendarzu.
    await expect(api.fetchMeetingSettings(EVENT_ID)).resolves.toMatchObject({
      meeting_days: ["2026-10-12", "2026-10-14"],
    });

    rpc().setData("admin_event_meeting_settings_get", {
      ...KONFIGURACJA,
      meeting_days: "2026-10-12",
    });
    await expect(api.fetchMeetingSettings(EVENT_ID)).resolves.toMatchObject({ meeting_days: [] });
  });

  it("grupa BEZ identyfikatora wypada z reguly - regula wskazujaca na nic jest gorsza niz brak reguly", async () => {
    rpc().setData("admin_event_meeting_settings_get", {
      ...KONFIGURACJA,
      requester_groups: [
        { key: "bez-id", name_pl: "Bez identyfikatora", name_en: "No id" },
        "napis zamiast grupy",
        null,
        {
          group_id: GROUP_ID,
          key: "wystawcy",
          name_pl: "Wystawcy",
          name_en: "Exhibitors",
          can_meet: true,
          can_lead_retrieval: false,
        },
      ],
      invitee_groups: "wszyscy",
    });

    const ustawienia = await api.fetchMeetingSettings(EVENT_ID);

    // Panel odsyla `group_id` przy zapisie reguly. Wiersz bez niego zapisalby
    // regule wskazujaca na nic - czyli regule, ktora nikogo nie dopuszcza
    // i nikogo nie blokuje, a w interfejsie wyglada na ustawiona.
    expect(ustawienia.requester_groups).toEqual([
      {
        group_id: GROUP_ID,
        key: "wystawcy",
        name_pl: "Wystawcy",
        name_en: "Exhibitors",
        can_meet: true,
        can_lead_retrieval: false,
      },
    ]);
    expect(ustawienia.invitee_groups).toEqual([]);
  });
});

/* ------------------------------------------------------- statystyki --- */

describe("fetchMeetingStats", () => {
  it("oddaje `jsonb` bazy w calosci, bez skladania liczb po stronie klienta", async () => {
    const statystyki = {
      total: 128,
      by_status: { invited: 30, accepted: 80, declined: 10, cancelled: 8 },
      acceptance_rate: 0.72,
    };
    rpc().setData("admin_event_meeting_stats", statystyki);

    await expect(api.fetchMeetingStats(EVENT_ID)).resolves.toEqual(statystyki);
    expect(rpc().lastCall("admin_event_meeting_stats")?.args).toEqual({ p_event_id: EVENT_ID });
  });

  it("`null` z bazy wraca jako `null`, a nie jako zerowe statystyki", async () => {
    rpc().setData("admin_event_meeting_stats", null);

    // Panel statystyk rozroznia „brak danych" od „zero spotkan". Podstawienie
    // zer kazaloby organizatorowi uwierzyc, ze gielda nie ruszyla, choc dane
    // po prostu nie dojechaly.
    await expect(api.fetchMeetingStats(EVENT_ID)).resolves.toBeNull();
  });
});

/* -------------------------------------------------- katalog uczestnikow --- */

describe("fetchMeetingDirectory", () => {
  it("po slugu nie wysyla identyfikatora wydarzenia, a `wszystkie grupy` to BRAK klucza", async () => {
    rpc().setData("event_meeting_directory", { rows: [], total_count: 0 });

    await api.fetchMeetingDirectory({ eventSlug: EVENT_SLUG, groupId: null });

    // `group_id` pominiety znaczy „bez filtra grupy". Wyslany jawny `null`
    // przeszedlby przez `NULLIF(p_payload->>'group_id','')::uuid` tak samo,
    // ale klucz `event_id: null` juz nie: SQL wybiera wydarzenie warunkiem
    // `(v_event_id IS NOT NULL AND e.id = v_event_id) OR (v_event_id IS NULL
    // AND e.slug = v_slug)` (`20260828131628:34-40`), wiec spojnosc tej pary
    // decyduje o tym, czy katalog w ogole cos znajdzie.
    expect(payloadOf("event_meeting_directory")).toEqual({ event_slug: EVENT_SLUG });
  });

  it("po identyfikatorze niesie filtr grupy, fraze i stronicowanie", async () => {
    rpc().setData("event_meeting_directory", { rows: [], total_count: 0 });

    await api.fetchMeetingDirectory({
      eventId: EVENT_ID,
      q: "fabryka",
      groupId: GROUP_ID,
      limit: 24,
      offset: 48,
    });

    expect(payloadOf("event_meeting_directory")).toEqual({
      event_id: EVENT_ID,
      q: "fabryka",
      group_id: GROUP_ID,
      limit: 24,
      offset: 48,
    });
  });

  it("wiersz BEZ identyfikatora zgloszenia wypada z listy", async () => {
    rpc().setData("event_meeting_directory", {
      scope: "registered",
      my_registration_id: REG_A,
      total_count: 2,
      rows: [
        { first_name: "Bez", last_name: "Zgloszenia" },
        {
          registration_id: REG_B,
          first_name: "Halina",
          last_name: "Zaremba",
          company: "Przykladowa Fabryka",
          has_availability: true,
          meeting_status: "invited",
        },
      ],
    });

    const katalog = await api.fetchMeetingDirectory({ eventSlug: EVENT_SLUG });

    // `counterpart_registration_id` to jedyna droga do zaproszenia kogos
    // nowego (`meetingsApi.ts:619-627`). Karta bez tego identyfikatora daloby
    // sie kliknac, a zaproszenie odbiloby sie od bazy - czyli odmowa PO
    // kliknieciu, w najgorszym mozliwym momencie.
    expect(katalog.rows).toHaveLength(1);
    expect(katalog.rows[0]?.registrationId).toBe(REG_B);
    expect(katalog.rows[0]?.meetingStatus).toBe("invited");
    expect(katalog.myRegistrationId).toBe(REG_A);
    expect(katalog.scope).toBe("registered");
  });

  it("powod blokady dojezdza z bazy - kazdy ma inne nastepne dzialanie", async () => {
    rpc().setData("event_meeting_directory", {
      blocked: "requester_not_participating",
      scope: "none",
      rows: [],
    });

    // „Nie jestes zapisany" znaczy „zapisz sie", a „giełda wyłączona" znaczy
    // „czekaj". Jeden komunikat „brak dostepu" kasowalby te roznice.
    await expect(api.fetchMeetingDirectory({ eventSlug: EVENT_SLUG })).resolves.toMatchObject({
      blocked: "requester_not_participating",
      scope: "none",
      rows: [],
    });
  });
});

/* --------------------------------------------- wartosci domyslne ladunkow --- */

describe("meetingsApi - wartosci domyslne ladunku", () => {
  it("lista panelu bez filtrow otwiera sie na WSZYSTKICH spotkaniach, pierwsze 50", async () => {
    rpc().setData("admin_event_meetings_list", []);

    await api.fetchAdminMeetings({ eventId: EVENT_ID });

    // `all` NIE jest stanem w bazie, tylko umowionym „bez filtra". Gdyby
    // klient nic tu nie wyslal, SQL porownalby stan z NULL-em i panel otworzyl
    // sie pusty - a organizator uznalby, ze gielda nie ruszyla.
    expect(payloadOf("admin_event_meetings_list")).toEqual({
      event_id: EVENT_ID,
      status: "all",
      table_id: null,
      group_id: null,
      sponsor_id: null,
      day: null,
      from: null,
      to: null,
      q: null,
      limit: 50,
      offset: 0,
    });
  });

  it("wybrane filtry panelu jada zamiast domyslnych", async () => {
    rpc().setData("admin_event_meetings_list", []);

    await api.fetchAdminMeetings({
      eventId: EVENT_ID,
      status: "expired",
      tableId: TABLE_ID,
      day: "2026-10-12",
      search: "zaremba",
      limit: 10,
      offset: 20,
    });

    const sent = payloadOf("admin_event_meetings_list");
    // `pending` i `expired` sa WIDOKAMI stanu `invited`, a nie stanami w bazie -
    // rozstrzyga je SQL, wiec klient ma je oddac nietkniete.
    expect(sent.status).toBe("expired");
    expect(sent.table_id).toBe(TABLE_ID);
    expect(sent.q).toBe("zaremba");
    expect(sent.limit).toBe(10);
    expect(sent.offset).toBe(20);
  });

  it("wolne terminy panelu maja domyslny limit 50 i puste okno czasowe", async () => {
    rpc().setData("admin_event_meeting_free_slots", []);

    await expect(
      api.fetchAdminFreeSlots({
        eventId: EVENT_ID,
        aRegistrationId: REG_A,
        bRegistrationId: REG_B,
      }),
    ).resolves.toEqual([]);

    // Bez limitu SQL oddalby wszystkie terminy calej gieldy - lista, ktorej
    // organizator nie przewinie, i zapytanie, ktore rosnie z kazdym dniem.
    expect(payloadOf("admin_event_meeting_free_slots")).toEqual({
      event_id: EVENT_ID,
      a_registration_id: REG_A,
      b_registration_id: REG_B,
      from: null,
      to: null,
      limit: 50,
    });
  });

  it("plaszczyzna uczestnika po IDENTYFIKATORZE wydarzenia zeruje slug, nie odwrotnie", async () => {
    rpc().setData("event_meeting_exchange", { grid: [] });
    await api.fetchMeetingExchange({ eventId: EVENT_ID });
    // Obie drogi do wydarzenia jada zawsze, jedna z nich pusta: SQL wybiera
    // po tej, ktora nie jest NULL-em. Wyslanie obu naraz albo zadnej konczy
    // sie `invalid_payload`.
    expect(payloadOf("event_meeting_exchange")).toEqual({
      event_id: EVENT_ID,
      event_slug: null,
    });

    rpc().setData("event_meeting_free_slots", []);
    await api.fetchMyFreeSlots({ eventId: EVENT_ID, counterpartRegistrationId: REG_B });
    expect(payloadOf("event_meeting_free_slots")).toEqual({
      event_id: EVENT_ID,
      event_slug: null,
      counterpart_registration_id: REG_B,
      from: null,
      to: null,
      limit: 50,
    });

    rpc().setData("event_meeting_invite", { meeting_id: MEETING_ID });
    await api.inviteToMeeting({
      eventId: EVENT_ID,
      counterpartRegistrationId: REG_B,
      startsAt: "2026-10-12T09:00:00.000Z",
    });
    const zaproszenie = payloadOf("event_meeting_invite");
    expect(zaproszenie.event_id).toBe(EVENT_ID);
    expect(zaproszenie.event_slug).toBeNull();
    // Temat i wiadomosc sa dobrowolne - jawny `null` znaczy „bez tresci",
    // a nie „zostaw poprzednia".
    expect(zaproszenie.topic).toBeNull();
    expect(zaproszenie.message).toBeNull();

    rpc().setData("event_meeting_availability_set", WINDOW_ID);
    await api.saveMyAvailability({
      eventId: EVENT_ID,
      startsAt: "2026-10-12T09:00:00.000Z",
      endsAt: "2026-10-12T12:00:00.000Z",
    });
    const okno = payloadOf("event_meeting_availability_set");
    expect(okno.event_id).toBe(EVENT_ID);
    expect(okno.event_slug).toBeNull();
    expect(okno.id).toBeNull();
    // `is_open` POMINIETE znaczy „zostaw jak bylo" - okno zamkniete recznie
    // nie ma sie otwierac przy zwyklej zmianie godzin.
    expect("is_open" in okno).toBe(false);
  });

  it("moje spotkania bez filtra to wszystkie stany i pierwsze 100", async () => {
    rpc().setData("event_meetings_mine", []);

    await expect(api.fetchMyMeetings({ eventSlug: EVENT_SLUG })).resolves.toEqual([]);
    expect(payloadOf("event_meetings_mine")).toEqual({
      event_id: null,
      event_slug: EVENT_SLUG,
      status: "all",
      limit: 100,
    });

    await api.fetchMyMeetings({ eventId: EVENT_ID, status: "accepted", limit: 5 });
    expect(payloadOf("event_meetings_mine")).toEqual({
      event_id: EVENT_ID,
      event_slug: null,
      status: "accepted",
      limit: 5,
    });
  });

  it("brak wierszy z bazy to PUSTA LISTA na kazdej z czterech list gieldy", async () => {
    // `data ?? []` jest tu warunkiem, nie kosmetyka: `null` dojechalby do
    // `.map()` w panelu spotkan i w wyborze terminu, czyli zamiast zdania
    // „brak wolnych terminow" wywrocilby caly ekran gieldy. A brak wolnych
    // terminow jest tu stanem CZESTYM - obie strony maja swoje okna i czesto
    // nie maja wspolnego.
    rpc().setData("admin_event_meetings_list", null);
    await expect(api.fetchAdminMeetings({ eventId: EVENT_ID })).resolves.toEqual([]);

    rpc().setData("admin_event_meeting_free_slots", null);
    await expect(
      api.fetchAdminFreeSlots({
        eventId: EVENT_ID,
        aRegistrationId: REG_A,
        bRegistrationId: REG_B,
      }),
    ).resolves.toEqual([]);

    rpc().setData("event_meeting_free_slots", null);
    await expect(
      api.fetchMyFreeSlots({ eventSlug: EVENT_SLUG, counterpartRegistrationId: REG_B }),
    ).resolves.toEqual([]);

    rpc().setData("event_meetings_mine", null);
    await expect(api.fetchMyMeetings({ eventSlug: EVENT_SLUG })).resolves.toEqual([]);
  });

  it("odwolanie bez powodu wysyla JAWNY `null`, a nie brak klucza", async () => {
    rpc().setData("event_meeting_cancel", { status: "cancelled" });

    await api.cancelMeeting({ meetingId: MEETING_ID });

    // Powod odwolania trafia do powiadomienia dla drugiej strony. Brak klucza
    // i jawny `null` to dla `admin_event_meeting_set_status`-owej rodziny
    // funkcji dwie rozne rzeczy; klient trzyma jedna z nich, zeby zapis nie
    // zalezal od tego, czy uzytkownik dotknal pola.
    expect(payloadOf("event_meeting_cancel")).toEqual({
      meeting_id: MEETING_ID,
      reason: null,
    });
  });
});

/* ------------------------------------------------------ odmowy bazy --- */

/** Jedno wywolanie warstwy danych razem z odmowa, ktora ma z niego wyleciec. */
interface Odmowa {
  readonly nazwa: string;
  readonly komunikat: string;
  readonly wywolaj: () => Promise<unknown>;
}

const ODMOWY: readonly Odmowa[] = [
  {
    nazwa: "admin_event_meeting_tables_list",
    komunikat: "forbidden: editor role required",
    wywolaj: () => api.fetchMeetingTables(EVENT_ID),
  },
  {
    nazwa: "admin_event_meeting_table_save",
    komunikat: "not_found: room does not exist in this tenant",
    wywolaj: () =>
      api.saveMeetingTable({
        id: null,
        eventId: EVENT_ID,
        label: "Stolik 12",
        zone: null,
        roomId: null,
        capacity: 1,
        note: null,
        sortOrder: 10,
        isActive: true,
      }),
  },
  {
    nazwa: "admin_event_meeting_settings_get",
    komunikat: "not_found: event does not exist in this tenant",
    wywolaj: () => api.fetchMeetingSettings(EVENT_ID),
  },
  {
    nazwa: "admin_event_meeting_settings_save",
    komunikat: "invalid_request: day_end_time must be after day_start_time",
    wywolaj: () =>
      api.saveMeetingSettings({
        eventId: EVENT_ID,
        isEnabled: true,
        timezone: "Europe/Warsaw",
        slotMinutes: 20,
        breakMinutes: 5,
        dayStartTime: "17:00",
        dayEndTime: "09:00",
        meetingDays: ["2026-10-12"],
        invitesOpenAt: null,
        invitesCloseAt: null,
        inviteExpiresAfterHours: 72,
        maxInvitesPerPerson: null,
        maxMeetingsPerDay: null,
        visibility: "everyone",
        introPl: "",
        introEn: "",
      }),
  },
  {
    nazwa: "admin_event_meetings_list",
    komunikat: "forbidden: editor role required",
    wywolaj: () => api.fetchAdminMeetings({ eventId: EVENT_ID }),
  },
  {
    nazwa: "admin_event_meeting_stats",
    komunikat: "not_found: event does not exist in this tenant",
    wywolaj: () => api.fetchMeetingStats(EVENT_ID),
  },
  {
    nazwa: "admin_event_meeting_set_status",
    komunikat: "invalid_status: meeting is not accepted",
    wywolaj: () => api.setMeetingStatus({ meetingId: MEETING_ID, status: "held" }),
  },
  {
    nazwa: "admin_event_meeting_free_slots",
    komunikat: "not_found: registration does not exist in this tenant",
    wywolaj: () =>
      api.fetchAdminFreeSlots({
        eventId: EVENT_ID,
        aRegistrationId: REG_A,
        bRegistrationId: REG_B,
      }),
  },
  {
    nazwa: "admin_event_meeting_arrange",
    komunikat: "slot_taken: the table is busy at this time",
    wywolaj: () =>
      api.arrangeMeeting({
        eventId: EVENT_ID,
        requesterRegistrationId: REG_A,
        inviteeRegistrationId: REG_B,
        startsAt: "2026-10-12T09:00:00.000Z",
      }),
  },
  {
    nazwa: "admin_event_meeting_availability_set",
    komunikat: "invalid_window: ends_at must be after starts_at",
    wywolaj: () =>
      api.saveAdminAvailability({
        registrationId: REG_A,
        startsAt: "2026-10-12T12:00:00.000Z",
        endsAt: "2026-10-12T09:00:00.000Z",
      }),
  },
  {
    nazwa: "event_meeting_exchange",
    komunikat: "auth_required: sign in to use the exchange",
    wywolaj: () => api.fetchMeetingExchange({ eventSlug: EVENT_SLUG }),
  },
  {
    nazwa: "event_meeting_availability_set",
    komunikat: "meetings_disabled: the exchange is closed",
    wywolaj: () =>
      api.saveMyAvailability({
        eventSlug: EVENT_SLUG,
        startsAt: "2026-10-12T09:00:00.000Z",
        endsAt: "2026-10-12T12:00:00.000Z",
      }),
  },
  {
    nazwa: "event_meeting_availability_delete",
    komunikat: "availability_has_meetings: 1 meeting(s) sit inside this window",
    wywolaj: () => api.deleteMyAvailability(WINDOW_ID),
  },
  {
    nazwa: "event_meeting_free_slots",
    komunikat: "not_found: counterpart is not participating",
    wywolaj: () =>
      api.fetchMyFreeSlots({ eventSlug: EVENT_SLUG, counterpartRegistrationId: REG_B }),
  },
  {
    nazwa: "event_meeting_invite",
    komunikat: "invite_limit_reached: you have used all your invitations",
    wywolaj: () =>
      api.inviteToMeeting({
        eventSlug: EVENT_SLUG,
        counterpartRegistrationId: REG_B,
        startsAt: "2026-10-12T09:00:00.000Z",
      }),
  },
  {
    nazwa: "event_meeting_directory",
    komunikat: "auth_required: sign in to browse the participant list",
    wywolaj: () => api.fetchMeetingDirectory({ eventSlug: EVENT_SLUG }),
  },
  {
    nazwa: "event_meeting_respond",
    komunikat: "invite_expired: this invitation is no longer valid",
    wywolaj: () => api.respondToMeeting({ meetingId: MEETING_ID, decision: "accept" }),
  },
  {
    nazwa: "event_meeting_cancel",
    komunikat: "forbidden: only a party of this meeting may cancel it",
    wywolaj: () => api.cancelMeeting({ meetingId: MEETING_ID }),
  },
  {
    nazwa: "event_meeting_reschedule",
    komunikat: "slot_taken: the other party is busy at this time",
    wywolaj: () =>
      api.rescheduleMeeting({ meetingId: MEETING_ID, startsAt: "2026-10-12T11:00:00.000Z" }),
  },
  {
    nazwa: "event_meetings_mine",
    komunikat: "auth_required: sign in to see your meetings",
    wywolaj: () => api.fetchMyMeetings({ eventSlug: EVENT_SLUG }),
  },
];

describe("meetingsApi - odmowa bazy nie jest polykana", () => {
  // KAZDA z tych funkcji konczy sie `if (error) throw error`. Bez tego rzutu
  // ekran gieldy narysowalby sukces: pusta siatke terminow zamiast komunikatu
  // „giełda wyłączona", potwierdzenie przyjecia spotkania, ktorego baza nie
  // przyjela, albo zapisane okno dostepnosci, ktorego nie ma. Odmowa jest tu
  // JEDYNYM kanalem informacji - funkcje oddaja `Json` albo listy, wiec
  // z samej wartosci nie da sie odczytac, czy operacja doszla do skutku.
  it.each(ODMOWY)("$nazwa oddaje odmowe wolajacemu", async ({ nazwa, komunikat, wywolaj }) => {
    rpc().setError(nazwa, komunikat);

    await expect(wywolaj()).rejects.toThrow(komunikat.split(":")[0] ?? komunikat);
    // Zadnej proby naprawczej „skoro sie nie udalo": jedno wywolanie i koniec.
    // Druga proba szlaby bez wiedzy o tym, co juz sie zapisalo.
    expect(rpc().names()).toEqual([nazwa]);
  });
});
