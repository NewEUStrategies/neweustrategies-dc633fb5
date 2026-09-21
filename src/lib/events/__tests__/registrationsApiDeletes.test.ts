// USUWANIE BILETU I USUWANIE POLA FORMULARZA - dwie operacje panelu
// organizatora, których do tej pory nie wykonał ani jeden test.
//
// DLACZEGO TEN PLIK ISTNIEJE. `registrationsApi.test.ts` pilnuje kontraktu
// ładunków `*_upsert`, listy i decyzji. Ekranowy `useEventRegistrations.test.ts`
// ATRAPUJE cały moduł danych (`deleteEventTicket: vi.fn()`,
// `deleteRegistrationField: vi.fn()`), więc obie funkcje nie zostały wywołane
// nigdzie ani razu. Dla operacji NIEODWRACALNEJ warstwa danych jest jedyną
// bramką po stronie klienta - a składa się z trzech rzeczy, z których każda psuje
// się cicho: nazwy funkcji, nazwy argumentu i przepuszczenia odmowy.
//
// 1) NAZWA ARGUMENTU `_id` (z podkreślnikiem). Obiekt argumentów RPC jest luźny,
//    więc literówka przechodzi przez `tsc` i przez przegląd, a kończy się
//    wywołaniem, którego PostgREST nie rozwiąże. Odróżnia to obie funkcje od
//    reszty modułu, która jedzie przez `p_payload`.
//
// 2) ODMOWA MUSI DOJECHAĆ NIETKNIĘTA. Mapa `adminRegistrationErrors` czyta
//    GŁOWĘ komunikatu plpgsql (człon przed dwukropkiem) i wyciąga LICZBĘ z ogona
//    do zdania „Bilet jest używany przez {{count}} zapisów". Warstwa danych,
//    która owinęłaby błąd we własny tekst, zamieniłaby to zdanie na „Rekord nie
//    istnieje" albo na awaryjne `unknown` - organizator straciłby jedyną
//    informację o tym, CO zablokowało usunięcie i ile tego jest.
//
// 3) ZAKRES NAJEMCY (zasada 12). Obie operacje idą przez RPC `admin_event_*`,
//    więc zawężenie najemcą siedzi w SQL: `assert_editor_tenant()` plus warunek
//    `tenant_id = v_tenant` w każdym zapytaniu i w samym `DELETE`
//    (`20260824091301:160-180` dla pola, `:386-416` dla biletu). Pilnuje go
//    bramka `check:sql-tenant-scope`. Po stronie klienta testowalne jest to, że
//    klient NIE PODAJE najemcy sam - podany byłby i tak zignorowany, a
//    w przeglądzie udawałby zabezpieczenie.
//
// ROZSTRZYGNIĘCIE, KTÓREGO WYMAGA ZLECENIE: BAZA BRONI BILETU, A POLA NIE BRONI.
// `admin_event_ticket_delete` liczy zgłoszenia z tym biletem i podnosi
// `ticket_in_use`, bo klucz obcy jest `ON DELETE SET NULL` - samo usunięcie
// PRZESZŁOBY i po cichu odebrało zapisom bilet (`20260824091301:396-408`).
// `admin_event_registration_field_delete` kasuje definicję pola BEZ innego
// warunku niż najemca (`20260824091301:169-176`) i to również jest przemyślane:
// odpowiedzi uczestników siedzą w `event_registrations.answers` POD KLUCZEM POLA
// i zostają tam po usunięciu pytania (komentarz funkcji w tej samej migracji).
// Utratą danych uczestnika byłoby dopiero kasowanie odpowiedzi razem
// z definicją - i tego nie robi ani baza, ani klient.
//
// RODO: identyfikatory syntetyczne, żadnych danych uczestników w tym pliku.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import {
  adminRegistrationErrorMessage,
  adminRegistrationFailure,
} from "@/lib/events/adminRegistrationErrors";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/registrationsApi");

const TICKET_ID = "2a1b0000-0000-4000-8000-000000000101";
const FIELD_ID = "2a1b0000-0000-4000-8000-000000000202";

function rpc(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
  return h.rpc;
}

/** Odmowa wyjęta z obietnicy bez `try`/`catch` - dalej trafia do mapy zdań. */
async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

/* ------------------------------------------------------ usunięcie biletu --- */

describe("deleteEventTicket", () => {
  it("woła `admin_event_ticket_delete` z jednym argumentem `_id`", async () => {
    rpc().setData("admin_event_ticket_delete", true);

    const removed = await api.deleteEventTicket(TICKET_ID);

    expect(removed).toBe(true);
    // Jedno wywołanie i koniec: żadnego odczytu listy „na wszelki wypadek",
    // który przy odmowie zdążyłby odświeżyć panel i zamaskować porażkę.
    expect(rpc().names()).toEqual(["admin_event_ticket_delete"]);
    const call = rpc().lastCall("admin_event_ticket_delete");
    expect(call?.keys()).toEqual(["_id"]);
    expect(call?.arg("_id")).toBe(TICKET_ID);
  });

  it("nie próbuje sam podać najemcy ani wydarzenia", async () => {
    rpc().setData("admin_event_ticket_delete", true);
    await api.deleteEventTicket(TICKET_ID);

    // Komplet argumentów, nie sama nieobecność trzech nazw: przy asercji
    // wyłącznie negatywnej funkcja, która NIE zawołałaby bazy, przechodziłaby
    // jako „nie podaje najemcy" - a to jest usunięcie, które się nie wydarzyło.
    const call = rpc().lastCall("admin_event_ticket_delete");
    expect(call?.keys()).toEqual(["_id"]);
    expect(call?.has("tenant_id")).toBe(false);
    expect(call?.has("p_tenant_id")).toBe(false);
    expect(call?.has("p_event_id")).toBe(false);
  });

  // Bilet z choćby jednym zapisem trzyma historię uczestnika i pieniądze.
  // Odmowa musi dojechać do panelu W CAŁOŚCI, bo dopiero z liczby w ogonie
  // powstaje zdanie mówiące organizatorowi, ile zapisów blokuje usunięcie
  // i że poprawną operacją jest wyłączenie biletu, nie kasowanie.
  it("odmowa `ticket_in_use` dojeżdża do panelu razem z liczbą zapisów", async () => {
    rpc().setError("admin_event_ticket_delete", "ticket_in_use: 3 registration(s) use this ticket");

    const error = await refusalOf(api.deleteEventTicket(TICKET_ID));

    expect(error).toBeInstanceOf(Error);
    const failure = adminRegistrationFailure(error);
    expect(failure.key).toBe("adminEventRegistration.errors.ticketInUse");
    expect(failure.params.count).toBe(3);
    expect(adminRegistrationErrorMessage(error)).toContain("3");
    // Żadnej próby „na siłę": klient nie ponawia i nie podmienia usunięcia
    // na ciche wyłączenie biletu, bo organizator zobaczyłby wtedy sukces
    // operacji, o którą nie prosił.
    expect(rpc().names()).toEqual(["admin_event_ticket_delete"]);
  });

  it("bilet z cudzego najemcy kończy się `not_found`, a nie usunięciem", async () => {
    rpc().setError("admin_event_ticket_delete", "not_found: ticket does not exist in this tenant");

    const error = await refusalOf(api.deleteEventTicket(TICKET_ID));

    expect(error).toBeInstanceOf(Error);
    // Zawężenie najemcą jest w SQL, więc jedyne, co widzi klient, to odmowa -
    // i ona nie może zamienić się w `true`, bo panel zdjąłby z listy bilet
    // stojący w cudzej organizacji nietknięty.
    expect(adminRegistrationFailure(error).key).toBe("adminEventRegistration.errors.notFound");
  });

  it("brak sieci też nie kończy się cichym sukcesem", async () => {
    rpc().setResponse("admin_event_ticket_delete", () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(api.deleteEventTicket(TICKET_ID)).rejects.toThrow(/Failed to fetch/);
  });

  // JEDYNYM KANAŁEM PORAŻKI JEST WYJĄTEK. Funkcja deklaruje `Promise<boolean>`,
  // ale wartości oddanej przez bazę NIE CZYTA - `RETURN true` z SQL-a jest
  // ignorowane tak samo jak hipotetyczne `false`. Dziś jest to bezpieczne, bo
  // funkcja albo zwraca `true`, albo podnosi wyjątek (`20260824091301:386-416`).
  // Test przypina ten stan po to, żeby zmiana SQL-a na „zwróć false, gdy nic nie
  // skasowano" nie przeszła bez zmiany klienta: panel zdjąłby wtedy z listy
  // bilet, który w bazie nadal stoi.
  it("wartość oddana przez bazę jest ignorowana - `false` też daje `true`", async () => {
    rpc().setData("admin_event_ticket_delete", false);

    await expect(api.deleteEventTicket(TICKET_ID)).resolves.toBe(true);
  });
});

/* ----------------------------------------- usunięcie pola formularza zapisu --- */

describe("deleteRegistrationField", () => {
  it("woła `admin_event_registration_field_delete` z jednym argumentem `_id`", async () => {
    rpc().setData("admin_event_registration_field_delete", true);

    const removed = await api.deleteRegistrationField(FIELD_ID);

    expect(removed).toBe(true);
    expect(rpc().names()).toEqual(["admin_event_registration_field_delete"]);
    const call = rpc().lastCall("admin_event_registration_field_delete");
    expect(call?.keys()).toEqual(["_id"]);
    expect(call?.arg("_id")).toBe(FIELD_ID);
  });

  it("nie próbuje sam podać najemcy ani wydarzenia", async () => {
    rpc().setData("admin_event_registration_field_delete", true);
    await api.deleteRegistrationField(FIELD_ID);

    // Jak przy bilecie: brak wywołania nie może przechodzić jako spełniony
    // warunek zakresu.
    const call = rpc().lastCall("admin_event_registration_field_delete");
    expect(call?.keys()).toEqual(["_id"]);
    expect(call?.has("tenant_id")).toBe(false);
    expect(call?.has("p_tenant_id")).toBe(false);
    expect(call?.has("p_event_id")).toBe(false);
  });

  // ODPOWIEDZI UCZESTNIKÓW NIE SĄ RUSZANE. Baza kasuje wyłącznie DEFINICJĘ pola;
  // to, co ludzie odpowiedzieli, zostaje w `event_registrations.answers` pod
  // kluczem pola. Gdyby klient dokładał do tego własne sprzątanie odpowiedzi
  // (drugie wywołanie, aktualizacja zgłoszeń), organizator kasując literówkę
  // w etykiecie kasowałby dane zebrane od uczestników - i nikt by tego nie
  // zauważył, bo panel pokazałby zwykły sukces.
  it("kasuje wyłącznie definicję pola - żadnego drugiego wywołania po odpowiedzi", async () => {
    rpc().setData("admin_event_registration_field_delete", true);

    await api.deleteRegistrationField(FIELD_ID);

    expect(rpc().names()).toEqual(["admin_event_registration_field_delete"]);
    expect(rpc().names()).not.toContain("admin_event_registration_upsert");
  });

  // FAKT DO PRZYPIĘCIA (zlecenie, pkt 2): baza NIE BRONI usunięcia pola, na które
  // ktoś już odpowiedział, i jest to różnica względem biletu. Ten sam warunek
  // („istnieją zgłoszenia korzystające z tego wiersza") kończy się odmową przy
  // bilecie i sukcesem przy polu. Klient przepuszcza obie polityki bez zmian -
  // nie dokłada własnej blokady pola ani nie połyka odmowy biletu.
  it("dwie operacje, dwie polityki: bilet w użyciu odmawia, pole z odpowiedziami się kasuje", async () => {
    rpc().setError("admin_event_ticket_delete", "ticket_in_use: 7 registration(s) use this ticket");
    rpc().setData("admin_event_registration_field_delete", true);

    await expect(api.deleteEventTicket(TICKET_ID)).rejects.toThrow(/ticket_in_use/);
    await expect(api.deleteRegistrationField(FIELD_ID)).resolves.toBe(true);
  });

  it("pole z cudzego najemcy kończy się `not_found`, a nie usunięciem", async () => {
    rpc().setError(
      "admin_event_registration_field_delete",
      "not_found: field does not exist in this tenant",
    );

    const error = await refusalOf(api.deleteRegistrationField(FIELD_ID));

    expect(error).toBeInstanceOf(Error);
    expect(adminRegistrationFailure(error).key).toBe("adminEventRegistration.errors.notFound");
  });

  it("odmowa uprawnień (`42501`) leci wyjątkiem, a nie pustym sukcesem", async () => {
    rpc().setError(
      "admin_event_registration_field_delete",
      "permission denied for function admin_event_registration_field_delete",
      "42501",
    );

    const error = await refusalOf(api.deleteRegistrationField(FIELD_ID));

    expect(error).toBeInstanceOf(Error);
    // Tekst Postgresa nie ma głowy w kształcie klucza, więc mapa oddaje zdanie
    // awaryjne zamiast pokazywać organizatorowi nazwę funkcji SQL.
    expect(adminRegistrationFailure(error).key).toBe("adminEventRegistration.errors.unknown");
  });

  it("wartość oddana przez bazę jest ignorowana - `false` też daje `true`", async () => {
    rpc().setData("admin_event_registration_field_delete", false);

    await expect(api.deleteRegistrationField(FIELD_ID)).resolves.toBe(true);
  });
});
