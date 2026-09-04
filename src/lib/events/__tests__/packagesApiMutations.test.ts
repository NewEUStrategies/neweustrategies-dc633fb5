// PANEL ORGANIZATORA: USUWANIE PAKIETU, ZMIANA STATUSU ZAMOWIENIA, ODWOLANIE
// MIEJSCA - trzy operacje, ktore w tescie nie wykonaly sie ani razu.
//
// WZORZEC PRZYCZYNY. Suita modulu 22 testuje CZYTANIE i TWORZENIE, a nie
// testuje usuwania, odwolywania i zmiany statusu. Dwadziescia dziewiec zapytan
// `fetch*` ma pokrycie, dziewietnascie operacji destrukcyjnych - nie.
// `packagesApi.ts` mial 10,81% linii wlasnie dlatego: `packageDraft.test.ts`
// sprawdza szkic formularza, `useEventPackages.test.ts` atrapuje cala warstwe
// danych, a same mutacje nikt nie wywolal.
//
// CO TU PILNUJEMY.
//
// 1) NAZWA FUNKCJI I NAZWA ARGUMENTU. Usuniecie i odwolanie ida przez argument
//    `_id` (z podkreslnikiem), a zmiana statusu przez `p_payload`. Literowka
//    w nazwie argumentu przechodzi przez `tsc` (obiekt argumentow jest luzny)
//    i konczy sie funkcja, ktorej PostgREST nie znajduje - albo, gorzej,
//    funkcja wolana z wartoscia domyslna. Dla operacji NIEODWRACALNYCH to
//    jedyna bramka po stronie klienta.
// 2) ODMOWA MA POLECIEC WYJATKIEM. Wszystkie trzy funkcje zwracaja `true`
//    bezwarunkowo, wiec cala informacja o niepowodzeniu siedzi w bledzie.
//    Polkniety blad daje panel, ktory zdejmuje wiersz z listy, choc w bazie
//    nadal jest.
// 3) ZAKRES NAJEMCY (zasada 12). Te operacje ida przez RPC `admin_event_*`,
//    wiec zawezenie najemcem siedzi w SQL: `assert_editor_tenant()` plus
//    warunek `tenant_id = v_tenant` w kazdym zapytaniu
//    (`20260827221214:185-212, 354-400, 527-553`). Pilnuje go bramka
//    `check:sql-tenant-scope`. Po stronie klienta testowalne jest to, ze
//    klient NIE PROBUJE podac najemcy sam - podany bylby i tak zignorowany,
//    a w przegladzie udawalby zabezpieczenie.
// 4) WYSCIG ODWOLANIA Z PRZYJECIEM. Miejsce przyjete przez zapraszanego nie
//    moze dac sie odwolac po cichu i odwrotnie. Rozstrzygniecie jest w SQL,
//    nie w domysle: `admin_event_package_seat_revoke` aktualizuje wylacznie
//    wiersz z `registration_id IS NULL AND revoked_at IS NULL` i podnosi
//    `not_found`, gdy nic nie trafil (`20260827221214:537-550`), a
//    `event_package_invite_accept` szuka miejsca po SKROCIE tokenu, ktory
//    odwolanie kasuje (`20260827221214:616-624`). Obie strony wiec odmawiaja -
//    i to jest zachowanie, ktore tu przypinamy.
//
// ATRAPA OBEJMUJE WYLACZNIE KLIENTA SUPABASE. Baza w tescie wyscigu jest
// zamodelowana jednym wierszem miejsca, ktory trzyma SKROT tokenu, a nie token -
// dokladnie tak, jak `event_package_seats.invite_token_hash`.
//
// RODO: zapraszani i platnicy sa syntetyczni, adresy wylacznie `example.com`.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/test/supabase/chain";
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

const api = await import("@/lib/events/packagesApi");
const invites = await import("@/lib/events/packageInviteApi");

/**
 * Wejscie SPOZA typu. Status w panelu jest typowany, ale do warstwy danych
 * trafia rowniez to, co przyjdzie ze starszego klienta albo z parametru
 * adresu. Luzny interfejs LOKALNY (bez `as any`, bez `@ts-expect-error`)
 * pozwala wyslac taki napis i sprawdzic, kto go zatrzymuje.
 */
interface LooseOrderStatusApi {
  setPackageOrderStatus(id: string, status: string): Promise<boolean>;
}
const looseApi: LooseOrderStatusApi = api;

const PACKAGE_ID = "1c2d0000-0000-4000-8000-000000000111";
const ORDER_ID = "1c2d0000-0000-4000-8000-000000000222";
const SEAT_ID = "1c2d0000-0000-4000-8000-000000000333";
const REGISTRATION_ID = "1c2d0000-0000-4000-8000-000000000444";
const EVENT_ID = "1c2d0000-0000-4000-8000-000000000555";

/** Token syntetyczny w ksztalcie zaproszenia organizatora - 32 znaki base64url. */
const INVITE_TOKEN = "Kx7pQr2sTu9vWx1yZa3bCd5eFg7hJk0m";

function rpc(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function payloadOf(name: string): Record<string, unknown> {
  const call = rpc().lastCall(name);
  if (call === undefined) throw new Error(`test: ${name} nie zostalo wolane`);
  const payload = call.arg("p_payload");
  if (payload === null || typeof payload !== "object") {
    throw new Error(`test: ${name} dostalo p_payload, ktory nie jest obiektem`);
  }
  return payload as Record<string, unknown>;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

/* ---------------------------------------------------- usuniecie pakietu --- */

describe("deleteEventPackage", () => {
  it("wola `admin_event_package_delete` z argumentem `_id` i niczym wiecej", async () => {
    rpc().setData("admin_event_package_delete", true);
    const removed = await api.deleteEventPackage(PACKAGE_ID);

    expect(removed).toBe(true);
    expect(rpc().names()).toEqual(["admin_event_package_delete"]);
    const call = rpc().lastCall("admin_event_package_delete");
    expect(call?.keys()).toEqual(["_id"]);
    expect(call?.arg("_id")).toBe(PACKAGE_ID);
  });

  // ZAKRES NAJEMCY SIEDZI W SQL (zasada 12): `assert_editor_tenant()` plus
  // `p.tenant_id = v_tenant` w sprawdzeniu istnienia, w zliczeniu zamowien
  // i w samym `DELETE` (`20260827221214:191-208`); bramka
  // `check:sql-tenant-scope` pilnuje, ze ten warunek nie zniknie. Klient nie
  // ma czego dokladac - `tenant_id` w argumentach bylby ignorowany przez
  // funkcje i mylacy w przegladzie.
  it("nie probuje sam podac najemcy - jedzie sam identyfikator", async () => {
    rpc().setData("admin_event_package_delete", true);
    await api.deleteEventPackage(PACKAGE_ID);

    // Porownujemy CALY obiekt argumentow, a nie dwie zgadniete nazwy: kazde
    // dolozone pole (`tenant_id`, `p_tenant`, `org_id`, cokolwiek) lamie te
    // asercje, bo funkcja bierze najemce z `assert_editor_tenant()`, a nie
    // z wywolania - argument od klienta bylby zignorowany i mylacy.
    expect(rpc().lastCall("admin_event_package_delete")?.args).toEqual({ _id: PACKAGE_ID });
  });

  // Pakiet ze sprzedanym zamowieniem trzyma pieniadze i miejsca uczestnikow.
  // Baza odmawia (`package_in_use`), a panel MUSI zobaczyc te odmowe - inaczej
  // zdejmie karte z listy i organizator uwierzy, ze oferta zniknela.
  it("odmowa `package_in_use` leci wyjatkiem, a nie cichym sukcesem", async () => {
    rpc().setError("admin_event_package_delete", "package_in_use: 3 order(s) use this package");

    await expect(api.deleteEventPackage(PACKAGE_ID)).rejects.toThrow(/package_in_use/);
    // Zadnej proby „na sile": jedno wywolanie i koniec.
    expect(rpc().names()).toEqual(["admin_event_package_delete"]);
  });

  it("pakiet z cudzego najemcy konczy sie `not_found`, nie usunieciem", async () => {
    rpc().setError(
      "admin_event_package_delete",
      "not_found: package does not exist in this tenant",
    );

    await expect(api.deleteEventPackage(PACKAGE_ID)).rejects.toThrow(/not_found/);
  });
});

/* -------------------------------------------- status zamowienia pakietu --- */

describe("setPackageOrderStatus", () => {
  it("identyfikator jedzie W LADUNKU razem ze statusem", async () => {
    rpc().setData("admin_event_package_order_set_status", true);
    const changed = await api.setPackageOrderStatus(ORDER_ID, "paid");

    expect(changed).toBe(true);
    const call = rpc().lastCall("admin_event_package_order_set_status");
    // Funkcja przyjmuje JEDEN argument `p_payload` - `_id` obok niego dalby
    // wywolanie, ktorego PostgREST nie rozwiaze.
    expect(call?.keys()).toEqual(["p_payload"]);
    expect(payloadOf("admin_event_package_order_set_status")).toEqual({
      id: ORDER_ID,
      status: "paid",
    });
  });

  // `refunded` bylo w tej liscie brakujace i zamowienia nie dalo sie oznaczyc
  // jako zwrocone z panelu (komentarz `packagesApi.ts:86-93`). Kazdy stan
  // z CHECK-a ma dojechac do bazy DOKLADNIE pod swoja nazwa - baza porownuje
  // `lower(btrim(...))` z czworka nazw (`20260827221214:367`).
  it("wszystkie cztery stany z CHECK-a jada nietkniete, ze zwrotem wlacznie", async () => {
    rpc().setData("admin_event_package_order_set_status", true);

    for (const status of api.PACKAGE_ORDER_STATUSES) {
      await api.setPackageOrderStatus(ORDER_ID, status);
      expect(payloadOf("admin_event_package_order_set_status").status).toBe(status);
    }
    expect(rpc().callsFor("admin_event_package_order_set_status")).toHaveLength(4);
  });

  // ROZSTRZYGNIECIE: ZMIANA STATUSU JEST ODWRACALNA, JEJ SKUTEK - NIE.
  //
  // Warstwa danych nie zna kierunku: nie pyta o stan poprzedni, nie ma listy
  // przejsc dozwolonych i wysyla `paid -> pending` tak samo jak
  // `pending -> paid`. Baza tez nie broni kierunku (`20260827221214:367-385`).
  // Nieodwracalny jest SKUTEK anulowania: `status = 'cancelled'` kasuje skroty
  // tokenow i oznacza `revoked_at` na kazdym miejscu bez zgloszenia
  // (`20260827221214:387-397`), a powrot na `paid` NICZEGO nie przywraca.
  // Dlatego test pilnuje, ze cofniecie statusu nie wysyla zadnego drugiego
  // wywolania udajacego odtworzenie zaproszen - organizator musi zaprosic
  // ponownie recznie (`invitePackageSeat`).
  it("cofniecie statusu jest zwyklym wywolaniem, ale nie przywraca zaproszen", async () => {
    rpc().setData("admin_event_package_order_set_status", true);

    await api.setPackageOrderStatus(ORDER_ID, "cancelled");
    await api.setPackageOrderStatus(ORDER_ID, "paid");

    expect(rpc().names()).toEqual([
      "admin_event_package_order_set_status",
      "admin_event_package_order_set_status",
    ]);
    expect(payloadOf("admin_event_package_order_set_status").status).toBe("paid");
    // Zadnego „odwolania odwolania": modul nie wola ani ponownego zaproszenia,
    // ani zadnej funkcji odtwarzajacej miejsca.
    expect(rpc().names()).not.toContain("admin_event_package_seat_invite");
  });

  // Nieznany stan nie ma przejsc: baza podnosi `invalid_status`
  // (`20260827221214:367-369`), a warstwa danych ma ten blad ODDAC. Gdyby go
  // polknela i zwrocila `true`, panel pokazalby zmiane statusu, ktorej nigdy
  // nie bylo, i ksiegowosc szukalaby platnosci po nieistniejacym stanie.
  it("nieznany status nie przechodzi - odmowa bazy leci wyjatkiem", async () => {
    rpc().setResponse("admin_event_package_order_set_status", (call) => {
      const sent = call.arg("p_payload");
      const status =
        sent !== null && typeof sent === "object"
          ? String((sent as Record<string, unknown>).status ?? "")
          : "";
      const known: readonly string[] = api.PACKAGE_ORDER_STATUSES;
      return known.includes(status) ? ok(true) : fail("invalid_status: unknown order status");
    });

    await expect(looseApi.setPackageOrderStatus(ORDER_ID, "archived")).rejects.toThrow(
      /invalid_status/,
    );
    expect(payloadOf("admin_event_package_order_set_status").status).toBe("archived");
    await expect(api.setPackageOrderStatus(ORDER_ID, "refunded")).resolves.toBe(true);
  });

  it("nieznane zamowienie konczy sie odmowa, a nie potwierdzeniem", async () => {
    rpc().setError(
      "admin_event_package_order_set_status",
      "not_found: order does not exist in this tenant",
    );

    await expect(api.setPackageOrderStatus(ORDER_ID, "cancelled")).rejects.toThrow(/not_found/);
  });
});

/* -------------------------------------------------- odwolanie miejsca --- */

describe("revokePackageSeat", () => {
  it("wola `admin_event_package_seat_revoke` z argumentem `_id`", async () => {
    rpc().setData("admin_event_package_seat_revoke", true);
    const revoked = await api.revokePackageSeat(SEAT_ID);

    expect(revoked).toBe(true);
    const call = rpc().lastCall("admin_event_package_seat_revoke");
    expect(call?.keys()).toEqual(["_id"]);
    expect(call?.arg("_id")).toBe(SEAT_ID);
  });

  it("odmowa bazy leci wyjatkiem, a nie cichym `true`", async () => {
    rpc().setError(
      "admin_event_package_seat_revoke",
      "not_found: no pending invitation on this seat",
    );

    await expect(api.revokePackageSeat(SEAT_ID)).rejects.toThrow(/not_found/);
  });
});

/* -------------------------------------- wyscig: odwolanie a przyjecie --- */

/** Jeden wiersz `event_package_seats` w zakresie, ktory rozstrzyga wyscig. */
interface SeatRow {
  id: string;
  /** W bazie stoi SHA-256 tokenu, nigdy token - `packagesApi.ts:9-12`. */
  inviteTokenHash: string | null;
  registrationId: string | null;
  revokedAt: string | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Atrapy obu funkcji odwzorowuja WARUNKI Z SQL, bo to one rozstrzygaja wyscig:
 * odwolanie trafia wylacznie w miejsce bez zgloszenia i bez odwolania
 * (`20260827221214:537-547`), a przyjecie szuka miejsca po skrocie tokenu,
 * ktory odwolanie kasuje (`20260827221214:616-624`).
 */
function wireSeat(seat: SeatRow): void {
  rpc().setResponse("admin_event_package_seat_revoke", (call) => {
    const matches =
      call.arg("_id") === seat.id && seat.registrationId === null && seat.revokedAt === null;
    if (!matches) return fail("not_found: no pending invitation on this seat");
    seat.inviteTokenHash = null;
    return ok(true);
  });

  rpc().setResponse("event_package_invite_accept", (call) => {
    const sent = call.arg("p_payload");
    const presented =
      sent !== null && typeof sent === "object"
        ? String((sent as Record<string, unknown>).token ?? "")
        : "";
    if (seat.inviteTokenHash === null || seat.inviteTokenHash !== sha256(presented)) {
      return fail("invalid_token: the invitation is not valid");
    }
    if (seat.registrationId !== null) {
      return fail("seat_taken: this invitation has already been used");
    }
    seat.registrationId = REGISTRATION_ID;
    seat.inviteTokenHash = null;
    return ok({
      registration_id: REGISTRATION_ID,
      event_id: EVENT_ID,
      status: "approved",
      qr_token: "Qr9tZv2xAb4cDe6fGh8jKl0mNp1rSt3u",
      manage_token: "Mn5oPq7rSt9uVw1xYz3aBc5dEf7gHi9j",
    });
  });
}

const accepting: import("@/lib/events/packageInviteApi").PackageInviteAcceptInput = {
  token: INVITE_TOKEN,
  firstName: "Halina",
  lastName: "Zaremba",
  consentDataProcessing: true,
};

describe("wyscig: odwolanie miejsca a przyjecie zaproszenia", () => {
  it("odwolanie PO przyjeciu nie przechodzi po cichu - baza odmawia", async () => {
    const seat: SeatRow = {
      id: SEAT_ID,
      inviteTokenHash: sha256(INVITE_TOKEN),
      registrationId: null,
      revokedAt: null,
    };
    wireSeat(seat);

    // Wyscig wygral zapraszany: ma zgloszenie i OBA jednorazowe klucze, wiec
    // ma czym wejsc na wydarzenie i czym zarzadzac swoim zapisem.
    const accepted = await invites.acceptPackageInvite(accepting);
    expect(accepted.registrationId).toBe(REGISTRATION_ID);
    expect(accepted.eventId).toBe(EVENT_ID);
    expect(accepted.qrToken).not.toBeNull();
    expect(accepted.manageToken).not.toBeNull();

    // Klient NIE rozstrzyga wyscigu u siebie - odwolanie i tak jedzie do bazy
    // z identyfikatorem miejsca, a odmowa dojezdza wyjatkiem, nie jako `true`.
    await expect(api.revokePackageSeat(SEAT_ID)).rejects.toThrow(/not_found/);
    expect(rpc().lastCall("admin_event_package_seat_revoke")?.args).toEqual({ _id: SEAT_ID });
    // Zgloszenie uczestnika zostaje - odwolanie nie zdejmuje zajetego miejsca.
    expect(seat.registrationId).toBe(REGISTRATION_ID);
  });

  it("przyjecie PO odwolaniu nie tworzy zgloszenia - token juz nie istnieje", async () => {
    const seat: SeatRow = {
      id: SEAT_ID,
      inviteTokenHash: sha256(INVITE_TOKEN),
      registrationId: null,
      revokedAt: null,
    };
    wireSeat(seat);

    await expect(api.revokePackageSeat(SEAT_ID)).resolves.toBe(true);
    await expect(invites.acceptPackageInvite(accepting)).rejects.toThrow(/invalid_token/);

    // Proba przyjecia NAPRAWDE poszla do bazy z tokenem - klient nie pamieta
    // odwolania i nie odsyla zapraszanego bez pytania. Rozstrzyga baza,
    // a jej odmowa jest wyjatkiem, nie wynikiem z pustymi polami.
    expect(rpc().names()).toEqual([
      "admin_event_package_seat_revoke",
      "event_package_invite_accept",
    ]);
    expect(payloadOf("event_package_invite_accept").token).toBe(INVITE_TOKEN);
    // Zadne zgloszenie nie powstalo - miejsce zostaje wolne dla nastepnego zaproszenia.
    expect(seat.registrationId).toBeNull();
  });

  // Odwolanie idzie po IDENTYFIKATORZE MIEJSCA, nie po tokenie: token jest
  // poswiadczeniem zapraszanego i nie ma prawa pojawic sie w wywolaniu panelu.
  it("odwolanie nie niesie tokenu zaproszenia", async () => {
    const seat: SeatRow = {
      id: SEAT_ID,
      inviteTokenHash: sha256(INVITE_TOKEN),
      registrationId: null,
      revokedAt: null,
    };
    wireSeat(seat);

    await expect(api.revokePackageSeat(SEAT_ID)).resolves.toBe(true);

    // Cale wywolanie, nie sam ostatni argument: token nie ma prawa pojawic sie
    // ani jako parametr, ani w zadnym polu obok - inaczej wyciekalby do logow
    // PostgREST i do zbieracza bledow razem z trescia zapytania.
    const revokeCalls = rpc().callsFor("admin_event_package_seat_revoke");
    expect(revokeCalls).toHaveLength(1);
    expect(JSON.stringify(revokeCalls[0]?.args ?? {})).not.toContain(INVITE_TOKEN);
    expect(revokeCalls[0]?.args).toEqual({ _id: SEAT_ID });
  });
});
