// Usuwanie tresci agendy: sesja, sciezka, sala.
//
// DLACZEGO TEN TEST ISTNIEJE. Kasowanie jest jedyna operacja modulu agendy,
// ktorej nie da sie cofnac z ekranu. Trzy rzeczy moga tu pojsc zle i zadna
// z nich nie zapala sie na `tsc`:
//
//   * NAZWA FUNKCJI. `deleteEventTrack` i `deleteEventRoom` roznia sie w kodzie
//     jednym slowem w napisie. Skopiowany napis kasuje INNY rodzaj wiersza niz
//     ten, ktory organizator wskazal na liscie.
//   * NAZWA ARGUMENTU. Funkcje biora `_id`, nie `id` ani `p_id`. Przemianowany
//     argument to 404 z PostgREST, czyli „nic sie nie stalo" z toastem bledu
//     sieci zamiast usuniecia.
//   * ODMOWA BAZY. Sciezka w uzyciu, sala w uzyciu i sesja z zapisami sa
//     ODRZUCANE przez SQL (`track_in_use`, `room_in_use`, `session_has_signups`),
//     a nie kasowane kaskadowo. Polkniety blad zostawia wiersz w bazie i napis
//     „usunieto" na ekranie.
//
// ZAWEZENIE NAJEMCEM SIEDZI W SQL-u. Wszystkie trzy funkcje zaczynaja od
// `assert_editor_tenant()` i maja `tenant_id = v_tenant` w kazdym WHERE
// (migracje 20260824084250 i 20260824084741). Klient nie ma czym tego zawezenia
// podac ani zepsuc - pilnuje go bramka `check:sql-tenant-scope`. Testowalne po
// tej stronie jest to, ze klient wola WLASCIWA funkcje z WLASCIWYM argumentem
// i nie doklada wlasnego sprzatania obok zawezonego SQL-a.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub } from "@/test/supabase/rpc";

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

const api = await import("@/lib/events/sessionsApi");

const SESJA = "11111111-1111-1111-1111-111111111111";
const SCIEZKA = "22222222-2222-2222-2222-222222222222";
const SALA = "33333333-3333-3333-3333-333333333333";

function rpc(): NonNullable<typeof h.rpc> {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
  return h.rpc;
}

/** Argumenty ostatniego wywolania funkcji - do asercji nazwy i kompletu. */
function argsOf(nazwa: string): { klucze: string[]; id: unknown } {
  const call = rpc().lastCall(nazwa);
  expect(call, `brak wywołania RPC ${nazwa}`).toBeDefined();
  return { klucze: call?.keys() ?? [], id: call?.arg("_id") };
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("sessionsApi - usuwanie sesji", () => {
  it("usunięcie sesji idzie JEDNĄ funkcją bazy i oddaje jej odpowiedź", async () => {
    rpc().setData("admin_event_session_delete", true);

    await expect(api.deleteEventSession(SESJA)).resolves.toBe(true);

    // Nazwa funkcji i nazwa argumentu to caly kontrakt, jaki klient tu ma:
    // reszta (najemca, uprawnienie redaktora) jest wymuszona w SQL-u.
    expect(rpc().names()).toEqual(["admin_event_session_delete"]);
    expect(argsOf("admin_event_session_delete")).toEqual({ klucze: ["_id"], id: SESJA });
  });

  it("sesja z aktywnymi zapisami: odmowa bazy wychodzi wyjątkiem, nie cichym fałszem", async () => {
    // SQL liczy zapisy inne niz `cancelled` i podnosi `session_has_signups`
    // z ich liczba. Ekran ma z tego zrobic zdanie „odwolaj sesje zamiast ja
    // kasowac"; polkniety blad zostawilby uczestnikom zapisy na sesje, ktorej
    // organizator juz nie widzi na liscie.
    rpc().setError(
      "admin_event_session_delete",
      "session_has_signups: 12 active signup(s) - cancel the session instead",
    );

    await expect(api.deleteEventSession(SESJA)).rejects.toThrow(/^session_has_signups: 12/);
    // Zadnej drugiej proby ani obejscia: odmowa jest ostateczna.
    expect(rpc().names()).toEqual(["admin_event_session_delete"]);
  });

  it("kaskada podsesji i obsady należy do bazy - klient nie kasuje dzieci sam", async () => {
    rpc().setData("admin_event_session_delete", true);

    await api.deleteEventSession(SESJA);

    // Gdyby klient sprzatal podsesje albo obsade po swojemu, robilby to
    // zapytaniami BEZ zawezenia najemcem, ktore ma tylko SQL. Kaskada FK jest
    // jedynym miejscem, gdzie to sprzatanie moze sie odbyc bezpiecznie.
    expect(rpc().callsFor("admin_event_sessions_list")).toEqual([]);
    expect(rpc().callsFor("admin_event_session_speakers_set")).toEqual([]);
    // Jedno wywolanie i dokladnie ten wiersz, ktory organizator wskazal: sama
    // liczba wywolan nie wyklucza skasowania sasiada z listy.
    expect(rpc().names()).toEqual(["admin_event_session_delete"]);
    expect(argsOf("admin_event_session_delete")).toEqual({ klucze: ["_id"], id: SESJA });
  });

  it("odpowiedź inna niż `true` nie jest zamieniana na sukces", async () => {
    // Panel zdejmuje wiersz z listy po tej wartosci. `null` z transportu to
    // „nie wiem, czy usunieto" - i tak wlasnie ma wygladac na ekranie.
    rpc().setData("admin_event_session_delete", null);
    await expect(api.deleteEventSession(SESJA)).resolves.toBe(false);

    rpc().setData("admin_event_session_delete", false);
    await expect(api.deleteEventSession(SESJA)).resolves.toBe(false);
  });
});

describe("sessionsApi - usuwanie ścieżki", () => {
  it("ścieżka z sesjami NIE jest kasowana kaskadowo - baza odmawia", async () => {
    // FAKTYCZNY kontrakt z migracji: `track_in_use` z liczba sesji, a wiersze
    // sesji zostaja nietkniete. Kaskada wygladalaby tu „wygodniej", ale
    // zabralaby opublikowanej agendzie cale pasmo jednym kliknieciem.
    rpc().setError("admin_event_track_delete", "track_in_use: 7 session(s) still use this track");

    await expect(api.deleteEventTrack(SCIEZKA)).rejects.toThrow(/^track_in_use: 7/);
    // Zadnego „odepnijmy najpierw sesje" (`admin_event_sessions_set_track`) ani
    // zadnego innego zapisu naprawczego: to jest wlasnie ta cicha utrata
    // przypisania, przed ktora odmowa bazy chroni. Asercja idzie na CALA liste
    // wywolan, bo obejscie moze przyjsc dowolna funkcja, nie tylko ta jedna.
    expect(rpc().names()).toEqual(["admin_event_track_delete"]);
  });

  it("odpowiedź inna niż `true` przy ścieżce nie zdejmuje jej z listy", async () => {
    // Ta sama zasada, co przy sesji: panel usuwa wiersz z ekranu po tej
    // wartosci, wiec „nie wiem" z transportu nie moze wygladac jak „usunieto".
    rpc().setData("admin_event_track_delete", null);
    await expect(api.deleteEventTrack(SCIEZKA)).resolves.toBe(false);
  });

  it("wolna ścieżka znika własną funkcją bazy, z identyfikatorem podanym wprost", async () => {
    rpc().setData("admin_event_track_delete", true);

    await expect(api.deleteEventTrack(SCIEZKA)).resolves.toBe(true);
    expect(argsOf("admin_event_track_delete")).toEqual({ klucze: ["_id"], id: SCIEZKA });
  });
});

describe("sessionsApi - usuwanie sali", () => {
  it("sala z sesjami NIE jest kasowana kaskadowo - baza odmawia", async () => {
    // `room_in_use`: sesje zostaja przy sali. Gdyby baza kasowala kaskada,
    // sesje stracilyby miejsce, a uczestnik dostalby agende bez sal.
    rpc().setError("admin_event_room_delete", "room_in_use: 3 session(s) still use this room");

    await expect(api.deleteEventRoom(SALA)).rejects.toThrow(/^room_in_use: 3/);
    // Ani przepisania sesji na inna sale (`admin_event_session_save`), ani
    // zadnego innego zapisu „przy okazji" - odmowa jest calym skutkiem.
    expect(rpc().names()).toEqual(["admin_event_room_delete"]);
  });

  it("odpowiedź inna niż `true` przy sali nie zdejmuje jej z listy", async () => {
    rpc().setData("admin_event_room_delete", null);
    await expect(api.deleteEventRoom(SALA)).resolves.toBe(false);
  });

  it("wolna sala znika własną funkcją bazy, z identyfikatorem podanym wprost", async () => {
    rpc().setData("admin_event_room_delete", true);

    await expect(api.deleteEventRoom(SALA)).resolves.toBe(true);
    expect(argsOf("admin_event_room_delete")).toEqual({ klucze: ["_id"], id: SALA });
  });
});

describe("sessionsApi - trzy rodzaje wierszy, trzy różne funkcje", () => {
  it("każde usunięcie trafia we WŁASNĄ funkcję, z własnym identyfikatorem", async () => {
    // Trzy wywolania roznia sie w kodzie jednym slowem w napisie. Skopiowana
    // nazwa nie konczy sie bledem - konczy sie usunieciem innego wiersza
    // (albo `not_found` przy operacji, ktora organizator uwaza za wykonana).
    rpc().setData("admin_event_session_delete", true);
    rpc().setData("admin_event_track_delete", true);
    rpc().setData("admin_event_room_delete", true);

    await api.deleteEventSession(SESJA);
    await api.deleteEventTrack(SCIEZKA);
    await api.deleteEventRoom(SALA);

    expect(rpc().names()).toEqual([
      "admin_event_session_delete",
      "admin_event_track_delete",
      "admin_event_room_delete",
    ]);
    expect(rpc().calls.map((call) => call.arg("_id"))).toEqual([SESJA, SCIEZKA, SALA]);
  });
});
