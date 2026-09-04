// PLASZCZYZNA KUPUJACEGO: kwalifikacja do stawki, oferta pakietow, wlasne
// zamowienia, wlasne miejsca i zaproszenie wystawiane PRZEZ KUPUJACEGO.
//
// PODZIAL PRACY. `admissionApi.test.ts` wzial czysty rachunek
// (`parseAdmissionQuote`, `ticketCheckoutRefusal`, klucze i18n), a pierwsza fala
// (`admissionPurchase.test.ts`) - wycene i sam zakup. Zostala CALA reszta
// pliku: `audienceQualifies`, `fetchPackagesOffer`, `fetchMyPackageOrders`,
// `fetchMyPackageSeats` i `inviteMyPackageSeat` - piec funkcji, ktore przed ta
// praca nie wykonaly sie ani razu (zmierzone: 73,33% linii, 66,66% funkcji).
//
// CO ROZSTRZYGA TA PLASZCZYZNA.
//
// 1) ZAKRES BIERZE SIE Z SESJI, NIE Z ARGUMENTU. `event_my_package_orders()`
//    nie ma ZADNEGO parametru, a `event_my_package_seats(p_order_id)` sprawdza
//    w SQL, ze zamowienie nalezy do wolajacego
//    (`o.buyer_user_id = v_uid`, `20260828152704:265-270`). Klient, ktory
//    probowalby podac tozsamosc sam, dostalby wywolanie, ktorego PostgREST
//    nie rozwiaze, albo - gorzej - argument cicho zignorowany, wygladajacy
//    w przegladzie na zabezpieczenie. Zawezenie najemcem siedzi w SQL
//    (`_caller_tenant()`); pilnuje go bramka `check:sql-tenant-scope`.
// 2) KWALIFIKACJA DO STAWKI JEST PIENIEDZMI. `event_audience_qualifies`
//    odpowiada, czy WOLAJACY moze kupic po stawce grupy (akademickiej,
//    firmowej, czlonkowskiej). Odpowiedz inna niz `true` MUSI znaczyc „nie":
//    zamiana nieczytelnej odpowiedzi w „tak" otwieralaby znizke kazdemu,
//    kto ma szczescie do awarii transportu.
// 3) TOKEN ZAPROSZENIA WRACA RAZ. `event_package_seat_invite` oddaje kod jawny
//    wylacznie w odpowiedzi, a w bazie zostaje SHA-256
//    (`20260825191948:1129-1141`). Ekran kupujacego sklada z niego odnosnik do
//    skopiowania (`EventPackagesPurchase.tsx:415-421`).
//
// ATRAPA OBEJMUJE WYLACZNIE KLIENTA SUPABASE (granica). `admissionApi` jest
// modulem POKRYWANYM i nie wolno go podmieniac.
//
// RODO: kupujacy i zapraszani sa syntetyczni, adresy wylacznie w `example.com`.
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

const api = await import("@/lib/events/admissionApi");

const ORDER_ID = "3a4b0000-0000-4000-8000-000000000001";
const SEAT_ID = "3a4b0000-0000-4000-8000-000000000002";

/** Token syntetyczny w ksztalcie tego, co sklada baza (dwa UUID bez myslnikow). */
const INVITE_TOKEN = "7f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d";

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

/* ------------------------------------------------- kwalifikacja do stawki --- */

describe("audienceQualifies", () => {
  it("`true` z bazy otwiera stawke grupy", async () => {
    rpc().setData("event_audience_qualifies", true);

    await expect(api.audienceQualifies("academic")).resolves.toBe(true);
    // Nazwa grupy jedzie TAKA, jaka stoi w ofercie: SQL porownuje ja doslownie
    // z `event_audience_grants.audience` i z CHECK-iem pakietu, wiec kazde
    // „poprawianie" po drodze (male litery, przyciecie) rozjechaloby stawke
    // z uprawnieniem.
    expect(rpc().lastCall("event_audience_qualifies")?.args).toEqual({ p_audience: "academic" });
  });

  it("`false` z bazy zamyka stawke", async () => {
    rpc().setData("event_audience_qualifies", false);

    await expect(api.audienceQualifies("company")).resolves.toBe(false);
  });

  it("odpowiedz NIEBOOLOWSKA nie otwiera znizki", async () => {
    // `data === true` porownuje SCISLE i to jest tu warunek, nie ozdoba.
    // Napis `"true"`, jedynka albo pusta odpowiedz z transportu przeszly by
    // przez `Boolean(data)` jako „tak" i sprzedaly stawke akademicka komus,
    // kto nie ma zweryfikowanej domeny uczelni.
    for (const odpowiedz of ["true", 1, {}, [], null, undefined]) {
      rpc().setData("event_audience_qualifies", odpowiedz);
      await expect(api.audienceQualifies("academic")).resolves.toBe(false);
    }
  });

  it("odmowa bazy leci wyjatkiem, a nie cichym `false`", async () => {
    // Roznica jest widoczna dla kupujacego: `false` to „nie masz prawa do tej
    // stawki" (ekran pokazuje cene podstawowa), a wyjatek to „nie wiemy"
    // (ekran ma poprosic o ponowienie). Sklejenie obu kazaloby zaplacic
    // pelna cene komus, kto ma zniżkę.
    rpc().setError("event_audience_qualifies", "forbidden: authentication required");

    await expect(api.audienceQualifies("member")).rejects.toThrow(/forbidden/);
  });
});

/* --------------------------------------------------------- oferta pakietow --- */

describe("fetchPackagesOffer", () => {
  it("oferta idzie po SLUGU wydarzenia i wraca bez przerabiania", async () => {
    // `packages_left: null` znaczy „bez limitu", a `qualifies: false` - „stawka
    // wymaga potwierdzenia". Ekran zakupu czyta obie kolumny wprost, wiec
    // warstwa danych nie ma ich prawa uzupelniac.
    const pakiet = {
      id: "3a4b0000-0000-4000-8000-000000000003",
      key: "delegacja_uczelniana",
      packages_left: null,
      qualifies: false,
      price_cents: 120000,
      currency: "PLN",
    };
    rpc().setData("event_packages_offer", [pakiet]);

    await expect(api.fetchPackagesOffer("kongres-przykladowy-2026")).resolves.toEqual([pakiet]);
    expect(rpc().lastCall("event_packages_offer")?.args).toEqual({
      p_slug: "kongres-przykladowy-2026",
    });
  });

  it("brak oferty to pusta lista, a nie `null` na ekranie zakupu", async () => {
    // SQL konczy `RETURN` bez wierszy, gdy wolajacy nie jest zalogowany albo
    // slug nie istnieje (`20260828152704:122-134`) - ekran ma wtedy pokazac
    // „brak pakietow", a nie wywrocic sie na mapowaniu po niczym.
    rpc().setData("event_packages_offer", null);

    await expect(api.fetchPackagesOffer("kongres-przykladowy-2026")).resolves.toEqual([]);
  });

  it("odmowa bazy leci wyjatkiem, a nie pusta oferta", async () => {
    rpc().setError("event_packages_offer", "not_found: event does not exist");

    await expect(api.fetchPackagesOffer("nie-ma-takiego")).rejects.toThrow(/not_found/);
  });
});

/* --------------------------------------------------- wlasne zamowienia --- */

describe("fetchMyPackageOrders", () => {
  it("wola funkcje BEZ ARGUMENTOW - tozsamosc bierze sie z sesji", async () => {
    rpc().setData("event_my_package_orders", []);

    await api.fetchMyPackageOrders();

    // Najpierw: funkcja W OGOLE zostala wolana i zadna inna. Bez tego zdania
    // asercja na `call?.args` przechodzilaby takze wtedy, gdyby warstwa danych
    // nie odpytala bazy ani razu i oddala pusta liste z niczego.
    expect(rpc().names()).toEqual(["event_my_package_orders"]);
    const call = rpc().lastCall("event_my_package_orders");
    // `event_my_package_orders()` nie ma parametrow: zakres liczy `auth.uid()`
    // i `_caller_tenant()` w SQL. Dolozony argument (choćby `p_user_id`) daloby
    // wywolanie, ktorego PostgREST nie rozwiaze na te sygnature - a gdyby
    // rozwiazal, byloby zaproszeniem do podstawienia cudzej tozsamosci.
    expect(call?.keys()).toEqual([]);
    expect(call?.args).toBeUndefined();
  });

  it("wiersze wracaja w kolejnosci bazy, brak zamowien to pusta lista", async () => {
    const zamowienia = [
      { id: ORDER_ID, status: "paid", seats_total: 5, total_cents: 120000 },
      { id: "3a4b0000-0000-4000-8000-000000000004", status: "pending", seats_total: 2 },
    ];
    rpc().setData("event_my_package_orders", zamowienia);
    await expect(api.fetchMyPackageOrders()).resolves.toEqual(zamowienia);

    rpc().setData("event_my_package_orders", null);
    await expect(api.fetchMyPackageOrders()).resolves.toEqual([]);
  });

  it("odmowa bazy leci wyjatkiem, a nie lista `nie masz zamowien`", async () => {
    // Puste „nie masz zamowien" po awarii kazaloby kupujacemu zaplacic drugi
    // raz za pakiet, ktory juz ma.
    rpc().setError("event_my_package_orders", "forbidden: authentication required");

    await expect(api.fetchMyPackageOrders()).rejects.toThrow(/forbidden/);
  });
});

/* -------------------------------------------------------- wlasne miejsca --- */

describe("fetchMyPackageSeats", () => {
  it("miejsca ida po identyfikatorze ZAMOWIENIA, wlascicielstwo sprawdza SQL", async () => {
    const miejsca = [
      { id: SEAT_ID, state: "invited", invite_email: "delegat@example.com", attendee_name: "" },
      { id: "3a4b0000-0000-4000-8000-000000000005", state: "free", invite_email: null },
    ];
    rpc().setData("event_my_package_seats", miejsca);

    await expect(api.fetchMyPackageSeats(ORDER_ID)).resolves.toEqual(miejsca);
    // Jeden argument i tylko jeden: `buyer_user_id = v_uid` w SQL decyduje,
    // czy w ogole cokolwiek wroci (`20260828152704:265-270`).
    expect(rpc().lastCall("event_my_package_seats")?.args).toEqual({ p_order_id: ORDER_ID });
  });

  it("cudze zamowienie oddaje ZERO wierszy, a nie blad - i klient tego nie udaje", async () => {
    // SQL na cudzym zamowieniu konczy `RETURN` bez wierszy. Ekran ma wtedy
    // pokazac pusta liste miejsc, a nie zgadywac liczby z zamowienia.
    rpc().setData("event_my_package_seats", []);

    await expect(api.fetchMyPackageSeats(ORDER_ID)).resolves.toEqual([]);
    // I zadnej sciezki zapasowej po pustej odpowiedzi. Doniesienie miejsc
    // z `admin_event_package_seats_list` konczyloby sie `forbidden` dla
    // zwyklego kupujacego, a dla kupujacego bedacego zarazem redaktorem
    // wydarzenia - pokazaniem miejsc z CUDZEGO zamowienia, bo tamta funkcja
    // pyta o uprawnienie redaktora, a nie o wlascicielstwo zamowienia.
    expect(rpc().names()).toEqual(["event_my_package_seats"]);
  });

  it("brak danych to pusta lista; odmowa to wyjatek", async () => {
    rpc().setData("event_my_package_seats", null);
    await expect(api.fetchMyPackageSeats(ORDER_ID)).resolves.toEqual([]);

    rpc().setError("event_my_package_seats", "forbidden: authentication required");
    await expect(api.fetchMyPackageSeats(ORDER_ID)).rejects.toThrow(/forbidden/);
  });
});

/* ------------------------------------------- zaproszenie od KUPUJACEGO --- */

describe("inviteMyPackageSeat", () => {
  const zaproszenie: import("@/lib/events/admissionApi").BuyerSeatInviteInput = {
    orderId: ORDER_ID,
    email: "delegat@example.com",
    name: "Halina Zaremba",
    expiresInDays: 14,
  };

  it("idzie funkcja KUPUJACEGO, nie funkcja organizatora", async () => {
    rpc().setData("event_package_seat_invite", {
      seat_id: SEAT_ID,
      token: INVITE_TOKEN,
      expires_at: "2026-10-15T10:00:00.000Z",
    });

    const wynik = await api.inviteMyPackageSeat(zaproszenie);

    expect(wynik).toEqual({
      seatId: SEAT_ID,
      inviteToken: INVITE_TOKEN,
      expiresAt: "2026-10-15T10:00:00.000Z",
    });
    // `admin_event_package_seat_invite` wymaga roli redaktora
    // (`assert_editor_tenant()`), wiec pomylka nazwy zamienilaby dzialajacy
    // ekran kupujacego w stale `forbidden`. Nazwy sa myląco podobne - stad
    // asercja na CALA liste wywolanych funkcji.
    expect(rpc().names()).toEqual(["event_package_seat_invite"]);
  });

  it("adres jedzie w postaci KANONICZNEJ - male litery, bez spacji", async () => {
    rpc().setData("event_package_seat_invite", { seat_id: SEAT_ID, token: INVITE_TOKEN });

    await api.inviteMyPackageSeat({
      ...zaproszenie,
      email: "  Delegat@Example.com  ",
      name: "  Halina Zaremba  ",
    });

    const sent = payloadOf("event_package_seat_invite");
    // Ten adres zostaje w wierszu miejsca jako `invite_email` i to on jest
    // pokazywany na liscie miejsc oraz porownywany przy przyjeciu zaproszenia.
    // Wersja z wielkimi literami i spacjami wygladalaby jak DRUGI, inny
    // zapraszany na tym samym miejscu.
    expect(sent.email).toBe("delegat@example.com");
    expect(sent.name).toBe("Halina Zaremba");
  });

  it("ladunek ma dokladnie cztery klucze, ktore czyta baza", async () => {
    rpc().setData("event_package_seat_invite", { seat_id: SEAT_ID, token: INVITE_TOKEN });

    await api.inviteMyPackageSeat(zaproszenie);

    // Funkcja NIE odrzuca nieznanego klucza - po prostu go ignoruje
    // (`20260825191948:1064-1080`). Literowka w nazwie nie konczy sie wiec
    // bledem, tylko zaproszeniem waznym 30 dni zamiast 14, albo bez nazwiska.
    expect(payloadOf("event_package_seat_invite")).toEqual({
      package_order_id: ORDER_ID,
      email: "delegat@example.com",
      name: "Halina Zaremba",
      expires_in_days: 14,
    });
  });

  it("brak terminu waznosci w odpowiedzi czyta sie jako `null`, nie jako pusty napis", async () => {
    rpc().setData("event_package_seat_invite", { seat_id: SEAT_ID, token: INVITE_TOKEN });

    const wynik = await api.inviteMyPackageSeat(zaproszenie);

    // Ekran pokazuje date waznosci obok odnosnika. Pusty napis zamiast `null`
    // przeszedlby przez `new Date("")` i wyswietlil „Invalid Date" tam, gdzie
    // ma stac „bez terminu" - a zapraszany musi wiedziec, do kiedy ma czas.
    // Asercja obejmuje CALY wynik: brak jednego pola nie ma prawa wyzerowac
    // pozostalych, bo token jest tu jedynym egzemplarzem kodu jawnego.
    expect(wynik).toEqual({
      seatId: SEAT_ID,
      inviteToken: INVITE_TOKEN,
      expiresAt: null,
    });
  });

  it("brak wolnego miejsca odmawia zamiast wystawiac zaproszenie donikad", async () => {
    rpc().setError(
      "event_package_seat_invite",
      "no_free_seat: every seat of this package is taken or invited",
    );

    // SQL szuka miejsca `registration_id IS NULL AND invite_email IS NULL AND
    // revoked_at IS NULL` i przy braku podnosi wyjatek
    // (`20260825191948:1112-1118`). Polkniety blad dalby pusty token i toast
    // „zaproszono", po ktorym kupujacy wyslalby martwy odnosnik.
    await expect(api.inviteMyPackageSeat(zaproszenie)).rejects.toThrow(/^no_free_seat:/);
  });

  it("cudze zamowienie i anulowane zamowienie sa ODMOWA, nie pustym wynikiem", async () => {
    rpc().setError(
      "event_package_seat_invite",
      "forbidden: only the buyer or the organiser may hand out seats",
    );
    await expect(api.inviteMyPackageSeat(zaproszenie)).rejects.toThrow(/^forbidden:/);

    rpc().setError(
      "event_package_seat_invite",
      "order_cancelled: seats of a cancelled order cannot be handed out",
    );
    await expect(api.inviteMyPackageSeat(zaproszenie)).rejects.toThrow(/^order_cancelled:/);
  });

  // DEFEKT ZAREJESTROWANY, NIE NAPRAWIONY (`it.fails`).
  //
  // `inviteMyPackageSeat` (`admissionApi.ts:300-305`) czyta odpowiedz przez
  // `record()`/`text()` z fallbackiem na pusty napis, wiec odpowiedz
  // nieczytelna (`null`, ksztalt bez `token`) zamienia sie w POPRAWNIE
  // WYGLADAJACY wynik: `seatId: ""`, `inviteToken: ""`. Ekran kupujacego
  // (`EventPackagesPurchase.tsx:414-423`) na sukcesie sklada z tego
  // `packageInviteUrl(origin, "")`, czyli adres `/events/invite/` BEZ tokenu,
  // pokazuje toast „zaproszono" i czysci formularz. Miejsce jest wtedy
  // w bazie juz zajete przez zaproszenie (`invite_email` ustawione), a token
  // jawny - jedyny egzemplarz, bo w bazie stoi sam SHA-256 - przepadl:
  // kupujacy nie moze ani wyslac odnosnika, ani zaprosic ponownie na to samo
  // miejsce. Siostrzany modul robi to poprawnie: `acceptPackageInvite`
  // (`packageInviteApi.ts:92-97`) rzuca `unknown: invitation response is not
  // readable` zamiast rysowac pusty sukces. Poprawka nalezy do produkcji:
  // brak `token` ma byc bledem.
  it.fails("DEFEKT: odpowiedz bez tokenu daje puste zaproszenie zamiast bledu", async () => {
    rpc().setData("event_package_seat_invite", { seat_id: SEAT_ID });

    await expect(api.inviteMyPackageSeat(zaproszenie)).rejects.toThrow();
  });
});
