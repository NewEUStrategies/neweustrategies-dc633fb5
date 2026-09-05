// PANEL ORGANIZATORA: ZAPIS PAKIETU, ZAMOWIENIE I ZAPROSZENIE NA MIEJSCE -
// czyli cala strona ZAPISUJACA `packagesApi.ts`, ktorej pierwsza fala nie
// ruszyla.
//
// PODZIAL PRACY. `packagesApiMutations.test.ts` wziel operacje ZABIERAJACE
// (usuniecie pakietu, zmiana statusu zamowienia, odwolanie miejsca). Tutaj
// stoi reszta: `fetchEventPackages`, `saveEventPackage`, `fetchPackageOrders`,
// `createPackageOrder`, `fetchPackageSeats`, `invitePackageSeat`
// i `packageInviteUrl`. Zmierzone przed ta praca: 48,64% linii i 18,42% galezi -
// najnizsze galezie calego modulu wydarzen.
//
// DLACZEGO AKURAT TE GALEZIE. To jest warstwa, przez ktora ida PIENIADZE
// i DOSTEP:
//
// 1) `payload()` (`packagesApi.ts:101-108`) pomija WYLACZNIE `undefined`.
//    Roznica miedzy „klucza nie ma" a „klucz jest i niesie null" jest w SQL
//    ROZSTRZYGAJACA: `admin_event_package_upsert` czyta limit przez
//    `CASE WHEN p_payload ? 'quota' THEN ... ELSE p.quota END`
//    (`20260827221214:121-124`), wiec zgubiony klucz nie znaczy „bez limitu",
//    tylko „zostaw stary limit". Organizator zdejmujacy limit sprzedazy
//    zobaczylby wtedy zapis bez bledu i pakiet, ktory nadal sie wyprzedaje.
// 2) Z tego samego powodu ZERO i FALSZ musza dojechac. Cena `0` (pakiet
//    dolaczany do umowy), `is_active: false` (wycofanie oferty), `sort_order: 0`
//    (pierwsza pozycja) - kazda z tych wartosci jest falszywa w JS, a w SQL
//    stoi za nia `COALESCE(..., p.<kolumna>)`, czyli zgubienie klucza
//    PRZYWRACA poprzednia wartosc. Cicha zamiana ceny 0 z powrotem na 1 200 zl
//    to nie jest usterka kosmetyczna.
// 3) KLUCZ I WYDARZENIE SA NIEZMIENNE PO ZAPISIE - i to klient trzyma, bo SQL
//    przy edycji bierze `event_id` z wiersza, a `key` w ogole go nie czyta
//    (`20260827221214:86-93, 110-140`). Przy TWORZENIU jest odwrotnie: bez
//    tych dwoch pol baza odmawia (`invalid_request: event_id is required`,
//    `invalid_key`).
// 4) TOKEN ZAPROSZENIA WRACA RAZ. `admin_event_package_seat_invite` oddaje kod
//    jawny wylacznie w odpowiedzi (`20260827221214:508-513`); w bazie zostaje
//    sam SHA-256. Dialog miejsc sklada z niego odnosnik i pokazuje go do
//    skopiowania (`EventPackageSeatsDialog.tsx:96-98`), wiec kazdy fallback
//    w odczycie tej odpowiedzi jest fallbackiem na kluczu do zapisu na cudze
//    nazwisko.
//
// ZAKRES NAJEMCY (zasada 12). Wszystko idzie przez RPC `admin_event_*`, wiec
// zawezenie siedzi w SQL: `assert_editor_tenant()` plus `tenant_id = v_tenant`
// w kazdym zapytaniu (`20260827221214:76-79, 86-93, 287-303, 466-490`).
// Pilnuje go bramka `check:sql-tenant-scope`. Po stronie klienta testowalne
// jest to, ze klient NIE PROBUJE podac najemcy sam - podany bylby zignorowany,
// a w przegladzie udawalby zabezpieczenie.
//
// ATRAPA OBEJMUJE WYLACZNIE KLIENTA SUPABASE (granica). Sam `packagesApi` jest
// modulem POKRYWANYM i nie wolno go podmieniac.
//
// RODO: platnicy i zapraszani sa syntetyczni, adresy wylacznie w `example.com`.
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

const EVENT_ID = "2e3f0000-0000-4000-8000-000000000001";
const PACKAGE_ID = "2e3f0000-0000-4000-8000-000000000002";
const TICKET_TYPE_ID = "2e3f0000-0000-4000-8000-000000000003";
const ORDER_ID = "2e3f0000-0000-4000-8000-000000000004";
const SEAT_ID = "2e3f0000-0000-4000-8000-000000000005";

/** Token syntetyczny w ksztalcie tego, co oddaje `_event_new_qr_token()`. */
const INVITE_TOKEN = "Vb3nQe7tRk1yUw9xZc5aMd2fHj4pLs8g";

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

/** Kompletny pakiet w ksztalcie, w ktorym oddaje go dialog - baza do zmiany. */
const PAKIET: import("@/lib/events/packagesApi").EventPackageInput = {
  id: null,
  eventId: EVENT_ID,
  key: "delegacja_uczelniana",
  ticketTypeId: TICKET_TYPE_ID,
  namePl: "Delegacja uczelniana",
  nameEn: "University delegation",
  descriptionPl: "Piec miejsc dla jednej uczelni.",
  descriptionEn: "Five seats for one university.",
  audience: "academic",
  seats: 5,
  priceCents: 120000,
  currency: "PLN",
  quota: 10,
  salesFrom: "2026-10-01T08:00:00.000Z",
  salesTo: "2026-11-15T22:00:00.000Z",
  minTierRank: 0,
  requiresVerification: true,
  isActive: true,
  sortOrder: 100,
};

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

/* -------------------------------------------------------- lista pakietow --- */

describe("fetchEventPackages", () => {
  it("oddaje wiersze bazy bez przerabiania ich po drodze", async () => {
    // Wiersz jest tu skrocony do kolumn, ktore czyta panel; chodzi o to, ze
    // warstwa danych NIE zmienia ich ksztaltu - `EventPackagesPanel` czyta
    // `quota === null` jako „bez limitu", wiec podmiana null na 0 zamienilaby
    // pakiet bez limitu w pakiet wyprzedany.
    const wiersz = { id: PACKAGE_ID, name_pl: "Delegacja uczelniana", quota: null, seats: 5 };
    rpc().setData("admin_event_packages_list", [wiersz]);

    await expect(api.fetchEventPackages(EVENT_ID)).resolves.toEqual([wiersz]);
    expect(rpc().lastCall("admin_event_packages_list")?.args).toEqual({ p_event_id: EVENT_ID });
  });

  it("brak wierszy to pusta lista, a nie `null` na ekranie", async () => {
    // `data ?? []`: gdyby przeszlo `null`, panel probowalby mapowac po niczym
    // i wywrocilby caly ekran studia zamiast pokazac „brak pakietow".
    rpc().setData("admin_event_packages_list", null);

    await expect(api.fetchEventPackages(EVENT_ID)).resolves.toEqual([]);
  });

  it("odmowa bazy leci wyjatkiem, a nie pusta lista udajaca brak oferty", async () => {
    rpc().setError("admin_event_packages_list", "forbidden: editor role required");

    await expect(api.fetchEventPackages(EVENT_ID)).rejects.toThrow(/forbidden/);
  });
});

/* --------------------------------------------------------- zapis pakietu --- */

describe("saveEventPackage - nowy pakiet", () => {
  it("nowy pakiet niesie wydarzenie i klucz, bo bez nich baza odmawia", async () => {
    // `admin_event_package_upsert` idzie sciezka INSERT dopiero, gdy `id` jest
    // puste, i wtedy WYMAGA obu pol: `invalid_request: event_id is required`
    // oraz `invalid_key` (`20260827221214:95-97, 143-149`). Atrapa odwzorowuje
    // te dwa warunki, zeby test sprawdzal SKUTEK braku, a nie sama obecnosc
    // klucza w obiekcie.
    rpc().setResponse("admin_event_package_upsert", (call) => {
      const sent = call.arg("p_payload");
      const bag =
        sent !== null && typeof sent === "object" ? (sent as Record<string, unknown>) : {};
      if (bag.id === null && bag.event_id === undefined) {
        return fail("invalid_request: event_id is required");
      }
      if (bag.id === null && typeof bag.key !== "string") {
        return fail("invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$");
      }
      return ok(PACKAGE_ID);
    });

    await expect(api.saveEventPackage(PAKIET)).resolves.toBe(PACKAGE_ID);
    const sent = payloadOf("admin_event_package_upsert");
    expect(sent.event_id).toBe(EVENT_ID);
    expect(sent.key).toBe("delegacja_uczelniana");
  });

  it("ladunek nowego pakietu ma DOKLADNIE te klucze, ktore czyta baza", async () => {
    rpc().setData("admin_event_package_upsert", PACKAGE_ID);

    await api.saveEventPackage(PAKIET);

    // `admin_event_package_upsert` czyta pola PO NAZWIE i nie odrzuca klucza,
    // ktorego nie zna - literowka w tlumaczeniu camelCase -> snake_case nie
    // konczy sie wiec bledem, tylko polem, ktore cicho nie zostalo zapisane.
    // Organizator nie ma jak tego zauwazyc: dialog pokazuje to, co wpisal,
    // a nie to, co stoi w wierszu. Rozjezdza sie wtedy cena, liczba miejsc
    // albo prog poziomu czlonkowskiego - czyli warunki sprzedazy pakietu,
    // ktory ktos juz kupil. Stad asercja na CALY ladunek, a nie na wybrane pola.
    expect(payloadOf("admin_event_package_upsert")).toEqual({
      id: null,
      event_id: EVENT_ID,
      key: "delegacja_uczelniana",
      ticket_type_id: TICKET_TYPE_ID,
      name_pl: "Delegacja uczelniana",
      name_en: "University delegation",
      description_pl: "Piec miejsc dla jednej uczelni.",
      description_en: "Five seats for one university.",
      audience: "academic",
      seats: 5,
      price_cents: 120000,
      currency: "PLN",
      quota: 10,
      sales_from: "2026-10-01T08:00:00.000Z",
      sales_to: "2026-11-15T22:00:00.000Z",
      min_tier_rank: 0,
      requires_verification: true,
      is_active: true,
      sort_order: 100,
    });
  });

  it("nie probuje sam podac najemcy - poza `p_payload` nie ma zadnego argumentu", async () => {
    rpc().setData("admin_event_package_upsert", PACKAGE_ID);
    await api.saveEventPackage(PAKIET);

    // Najemca bierze sie z `assert_editor_tenant()`, a nie z wywolania.
    // Dolozony `tenant_id` bylby zignorowany przez funkcje i mylacy
    // w przegladzie - stad asercja na CALY zestaw argumentow.
    expect(rpc().lastCall("admin_event_package_upsert")?.keys()).toEqual(["p_payload"]);
  });
});

describe("saveEventPackage - edycja pakietu", () => {
  it("edycja NIE niesie ani wydarzenia, ani klucza", async () => {
    rpc().setData("admin_event_package_upsert", PACKAGE_ID);

    await api.saveEventPackage({ ...PAKIET, id: PACKAGE_ID });

    const sent = payloadOf("admin_event_package_upsert");
    expect(sent.id).toBe(PACKAGE_ID);
    // Klucz pakietu jest identyfikatorem oferty w zamowieniach juz zlozonych,
    // a wydarzenie - jej miejscem w kalendarzu. Baza przy edycji czyta oba
    // z WIERSZA, wiec wyslanie ich stad byloby obietnica zmiany, ktora nigdy
    // nie nastapi: dialog pokazalby nowy klucz, a lista - stary.
    expect("event_id" in sent).toBe(false);
    expect("key" in sent).toBe(false);
  });

  it("zdjecie limitu jedzie JAWNYM `null`, bo brak klucza znaczy `zostaw stary limit`", async () => {
    rpc().setData("admin_event_package_upsert", PACKAGE_ID);

    await api.saveEventPackage({ ...PAKIET, id: PACKAGE_ID, quota: null, salesTo: null });

    const sent = payloadOf("admin_event_package_upsert");
    // `CASE WHEN p_payload ? 'quota' THEN ... ELSE p.quota END`: o wyniku
    // decyduje OBECNOSC klucza, nie jego wartosc. Zgubiony klucz to pakiet,
    // ktory dalej ma limit 10 sztuk, mimo ze organizator go zdjal i dostal
    // potwierdzenie zapisu.
    expect("quota" in sent).toBe(true);
    expect(sent.quota).toBeNull();
    // To samo z oknem sprzedazy: `null` znaczy „w sprzedazy do odwolania".
    expect("sales_to" in sent).toBe(true);
    expect(sent.sales_to).toBeNull();
  });

  it("zero i falsz dojezdzaja jako zero i falsz, a nie jako brak pola", async () => {
    rpc().setData("admin_event_package_upsert", PACKAGE_ID);

    await api.saveEventPackage({
      ...PAKIET,
      id: PACKAGE_ID,
      priceCents: 0,
      minTierRank: 0,
      sortOrder: 0,
      isActive: false,
      requiresVerification: false,
    });

    const sent = payloadOf("admin_event_package_upsert");
    // Kazda z tych kolumn ma w SQL `COALESCE(<z payloadu>, p.<kolumna>)`, wiec
    // pominiecie klucza PRZYWRACA poprzednia wartosc. Pakiet dolaczany do umowy
    // (cena 0) wrocilby do 1 200 zl, wycofana oferta zostalaby aktywna,
    // a pierwsza pozycja listy nie ruszylaby sie z konca.
    expect(sent.price_cents).toBe(0);
    expect(sent.min_tier_rank).toBe(0);
    expect(sent.sort_order).toBe(0);
    expect(sent.is_active).toBe(false);
    expect(sent.requires_verification).toBe(false);
  });

  it("odmowa `not_found` z cudzego najemcy leci wyjatkiem, bez identyfikatora", async () => {
    rpc().setError(
      "admin_event_package_upsert",
      "not_found: package does not exist in this tenant",
    );

    // Polkniety blad dalby `String(undefined)` = `"undefined"` jako identyfikator
    // pakietu i panel odpytalby o niego kolejne ekrany.
    await expect(api.saveEventPackage({ ...PAKIET, id: PACKAGE_ID })).rejects.toThrow(/not_found/);
    expect(rpc().names()).toEqual(["admin_event_package_upsert"]);
  });

  it("odmowa nazw dwujezycznych nie konczy sie druga proba zapisu", async () => {
    rpc().setError(
      "admin_event_package_upsert",
      "invalid_names: the name is required in both languages",
    );

    await expect(api.saveEventPackage({ ...PAKIET, id: PACKAGE_ID, nameEn: "" })).rejects.toThrow(
      /^invalid_names:/,
    );
    // Zadnego „zapiszmy chociaz polska nazwe": jedno wywolanie i odmowa.
    expect(rpc().callsFor("admin_event_package_upsert")).toHaveLength(1);
  });
});

/* ------------------------------------------------------ lista zamowien --- */

describe("fetchPackageOrders", () => {
  it("bez wybranego pakietu NIE wysyla `p_package_id` - to sa wszystkie zamowienia", async () => {
    rpc().setData("admin_event_package_orders_list", []);

    await api.fetchPackageOrders(EVENT_ID, null);

    // Argument pominiety znaczy „bez filtra" (funkcja ma dla niego DEFAULT).
    // Wyslany `null` byloby czyms innym: PostgREST podalby jawny NULL,
    // a warunek `p.id = NULL` nie trafia w zaden wiersz - lista zamowien
    // wydarzenia byla by pusta bez jednego bledu.
    expect(rpc().lastCall("admin_event_package_orders_list")?.args).toEqual({
      p_event_id: EVENT_ID,
    });
    expect(rpc().lastCall("admin_event_package_orders_list")?.has("p_package_id")).toBe(false);
  });

  it("wybrany pakiet zawezaja OBA argumenty naraz", async () => {
    rpc().setData("admin_event_package_orders_list", []);

    await api.fetchPackageOrders(EVENT_ID, PACKAGE_ID);

    expect(rpc().lastCall("admin_event_package_orders_list")?.args).toEqual({
      p_event_id: EVENT_ID,
      p_package_id: PACKAGE_ID,
    });
  });

  it("brak wierszy to pusta lista; odmowa to wyjatek", async () => {
    rpc().setData("admin_event_package_orders_list", null);
    await expect(api.fetchPackageOrders(EVENT_ID, null)).resolves.toEqual([]);

    rpc().setError("admin_event_package_orders_list", "forbidden: editor role required");
    await expect(api.fetchPackageOrders(EVENT_ID, PACKAGE_ID)).rejects.toThrow(/forbidden/);
  });
});

/* ------------------------------------------------------ zapis zamowienia --- */

describe("createPackageOrder", () => {
  const zamowienie: import("@/lib/events/packagesApi").PackageOrderInput = {
    packageId: PACKAGE_ID,
    buyerEmail: "kwestura@example.com",
    buyerName: "Kwestura Uczelni Przykladowej",
    seatsTotal: null,
    amountCents: null,
    invoiceNote: "Zamowienie 17/2026",
  };

  it("klient NIE wysyla ani waluty, ani statusu - obie bierze baza", async () => {
    rpc().setData("admin_event_package_order_create", ORDER_ID);

    await expect(api.createPackageOrder(zamowienie)).resolves.toBe(ORDER_ID);

    // Waluta idzie z PAKIETU (`v_package.currency`), a status jest wpisywany
    // na sztywno jako `pending` (`20260827221214:322-327`). Gdyby klient
    // podawal je sam, panel mogl by zalozyc zamowienie od razu „oplacone"
    // albo w innej walucie niz oferta - i ksiegowosc nie mialaby jak tego
    // odroznic od platnosci, ktora naprawde wplynela.
    expect(Object.keys(payloadOf("admin_event_package_order_create")).sort()).toEqual([
      "amount_cents",
      "buyer_email",
      "buyer_name",
      "invoice_note",
      "package_id",
      "seats_total",
    ]);
  });

  it("`null` w liczbie miejsc i kwocie znaczy `tak, jak w pakiecie`", async () => {
    rpc().setData("admin_event_package_order_create", ORDER_ID);

    await api.createPackageOrder(zamowienie);

    const sent = payloadOf("admin_event_package_order_create");
    // SQL czyta oba przez `COALESCE((NULLIF(p_payload->>'...',''))::integer,
    // v_package.seats / v_package.price_cents)` (`20260827221214:316, 326`),
    // wiec jawny null jest tu poprawnym „wez z oferty".
    expect(sent.seats_total).toBeNull();
    expect(sent.amount_cents).toBeNull();
  });

  it("kwota `0` jedzie jako zero, a nie znika w drodze do faktury", async () => {
    rpc().setData("admin_event_package_order_create", ORDER_ID);

    await api.createPackageOrder({ ...zamowienie, amountCents: 0, seatsTotal: 3 });

    const sent = payloadOf("admin_event_package_order_create");
    // Pakiet rozliczony poza platnoscia online (barter, umowa sponsorska) ma
    // kwote 0. Zgubienie tego klucza wpisaloby do zamowienia PELNA cene
    // z oferty - i taka kwota poszlaby na fakture.
    expect(sent.amount_cents).toBe(0);
    expect(sent.seats_total).toBe(3);
  });

  it("wyprzedany pakiet konczy sie odmowa, a nie zamowieniem bez pokrycia", async () => {
    rpc().setError(
      "admin_event_package_order_create",
      "package_sold_out: no packages of this kind are left",
    );

    // Ciche `String(undefined)` dalo by identyfikator `"undefined"`, panel
    // otworzylby na nim dialog miejsc i organizator zapraszalby ludzi na
    // miejsca, ktorych nie ma.
    await expect(api.createPackageOrder(zamowienie)).rejects.toThrow(/^package_sold_out:/);
    expect(rpc().names()).toEqual(["admin_event_package_order_create"]);
  });

  it("bledny adres platnika zatrzymuje baza, klient go nie obchodzi", async () => {
    rpc().setError(
      "admin_event_package_order_create",
      "invalid_email: a valid buyer e-mail is required",
    );

    await expect(
      api.createPackageOrder({ ...zamowienie, buyerEmail: "kwestura(at)example.com" }),
    ).rejects.toThrow(/^invalid_email:/);
    // Adres dojechal do bazy TAKI, JAKI wpisano - klient go nie „naprawia",
    // bo poprawiony po cichu adres to faktura wyslana pod zgadniete miejsce.
    expect(payloadOf("admin_event_package_order_create").buyer_email).toBe(
      "kwestura(at)example.com",
    );
  });
});

/* --------------------------------------------------------- lista miejsc --- */

describe("fetchPackageSeats", () => {
  it("miejsca ida po identyfikatorze ZAMOWIENIA i niczym wiecej", async () => {
    const wolne = { id: SEAT_ID, state: "free", attendee_name: null, invite_email: null };
    rpc().setData("admin_event_package_seats_list", [wolne]);

    await expect(api.fetchPackageSeats(ORDER_ID)).resolves.toEqual([wolne]);
    // Puste kolumny miejsca WOLNEGO zostaja puste - dialog czyta `null` jako
    // „do rozdania" (`EventPackageSeatsDialog.tsx:159-166`).
    expect(rpc().lastCall("admin_event_package_seats_list")?.args).toEqual({
      p_order_id: ORDER_ID,
    });
  });

  it("brak miejsc to pusta lista; odmowa to wyjatek", async () => {
    rpc().setData("admin_event_package_seats_list", null);
    await expect(api.fetchPackageSeats(ORDER_ID)).resolves.toEqual([]);

    rpc().setError(
      "admin_event_package_seats_list",
      "not_found: order does not exist in this tenant",
    );
    await expect(api.fetchPackageSeats(ORDER_ID)).rejects.toThrow(/not_found/);
  });
});

/* --------------------------------------------------- zaproszenie miejsca --- */

describe("invitePackageSeat", () => {
  it("zaproszenie niesie miejsce, adres, nazwisko i waznosc - i nic poza tym", async () => {
    rpc().setData("admin_event_package_seat_invite", {
      seat_id: SEAT_ID,
      invite_token: INVITE_TOKEN,
    });

    const wynik = await api.invitePackageSeat({
      seatId: SEAT_ID,
      inviteEmail: "delegat@example.com",
      inviteName: "Halina Zaremba",
      validDays: 14,
    });

    expect(wynik).toEqual({ seatId: SEAT_ID, inviteToken: INVITE_TOKEN });
    expect(payloadOf("admin_event_package_seat_invite")).toEqual({
      id: SEAT_ID,
      invite_email: "delegat@example.com",
      invite_name: "Halina Zaremba",
      valid_days: 14,
    });
  });

  it("miejsce juz zajete odmawia i NIE oddaje zadnego tokenu", async () => {
    rpc().setError(
      "admin_event_package_seat_invite",
      "seat_taken: this seat is already assigned to a participant",
    );

    // Polknieta odmowa dalaby `inviteToken: ""`, dialog zlozylby z niego
    // odnosnik i organizator wyslalby drugiej osobie link do miejsca, ktore
    // ma juz uczestnika.
    await expect(
      api.invitePackageSeat({
        seatId: SEAT_ID,
        inviteEmail: "delegat@example.com",
        inviteName: "Halina Zaremba",
        validDays: 14,
      }),
    ).rejects.toThrow(/^seat_taken:/);
  });

  it("anulowane zamowienie nie rozdaje miejsc", async () => {
    rpc().setError(
      "admin_event_package_seat_invite",
      "order_cancelled: the order behind this seat is cancelled",
    );

    await expect(
      api.invitePackageSeat({
        seatId: SEAT_ID,
        inviteEmail: "delegat@example.com",
        inviteName: "Halina Zaremba",
        validDays: 400,
      }),
    ).rejects.toThrow(/^order_cancelled:/);
  });

  it("brak `seat_id` w odpowiedzi nie gubi miejsca - wraca to, o ktore pytano", async () => {
    // Odpowiedz bez identyfikatora miejsca zdarza sie przy zmianie ksztaltu
    // `jsonb_build_object`. Fallback na wejsciowy `seatId` jest tu SLUSZNY:
    // zaproszenie dotyczylo tego miejsca i dialog musi wiedziec, ktory wiersz
    // odswiezyc.
    rpc().setData("admin_event_package_seat_invite", { invite_token: INVITE_TOKEN });

    const wynik = await api.invitePackageSeat({
      seatId: SEAT_ID,
      inviteEmail: "delegat@example.com",
      inviteName: "",
      validDays: 30,
    });

    expect(wynik.seatId).toBe(SEAT_ID);
    expect(wynik.inviteToken).toBe(INVITE_TOKEN);
  });

  // DEFEKT NAPRAWIONY W PRODUKCJI - opis nizej zostaje jako powod kontraktu.
  //
  // `invitePackageSeat` (`packagesApi.ts:270-274`) czyta odpowiedz przez
  // `(data ?? {}) as Record<string, unknown>` i konczy `String(record.invite_token ?? "")`.
  // Odpowiedz nieczytelna (`null`, ksztalt bez `invite_token`) zamienia sie
  // wiec w POPRAWNIE WYGLADAJACY wynik z PUSTYM tokenem. Skutek widac na
  // ekranie: `EventPackageSeatsDialog.tsx:95-98` na sukcesie pokazuje toast
  // „zaproszono" i sklada `packageInviteUrl(origin, "")`, czyli adres
  // `/events/invite/` bez tokenu; organizator kopiuje ten adres i wysyla go
  // zapraszanemu, a token jawny - ktory istnial wylacznie w tej jednej
  // odpowiedzi - jest juz nie do odzyskania, bo w bazie stoi sam SHA-256.
  // Siostrzany modul robi to poprawnie: `acceptPackageInvite`
  // (`packageInviteApi.ts:92-97`) rzuca `unknown: invitation response is not
  // readable` zamiast rysowac pusty sukces. Poprawka nalezy do produkcji:
  // brak `invite_token` ma byc bledem, a nie pustym napisem.
  it("DEFEKT: nieczytelna odpowiedz daje puste zaproszenie zamiast bledu", async () => {
    // `null` jest tu ksztaltem NAJGORSZYM z mozliwych: `(data ?? {})` robi
    // z niego pusty obiekt, wiec fallbacki wypelniaja OBA pola wyniku -
    // miejsce z wejscia i token pustym napisem.
    rpc().setData("admin_event_package_seat_invite", null);

    await expect(
      api.invitePackageSeat({
        seatId: SEAT_ID,
        inviteEmail: "delegat@example.com",
        inviteName: "Halina Zaremba",
        validDays: 14,
      }),
    ).rejects.toThrow();
  });
});

/* ------------------------------------------------- adres zaproszenia --- */

describe("packageInviteUrl", () => {
  it("sklada adres, pod ktorym zapraszany domyka swoj zapis", () => {
    expect(api.packageInviteUrl("https://wydarzenia.example.org", INVITE_TOKEN)).toBe(
      `https://wydarzenia.example.org/events/invite/${INVITE_TOKEN}`,
    );
  });

  it("token jest KODOWANY, wiec ukosnik nie rozbija sciezki na dwa segmenty", () => {
    // Trasa ma jeden parametr `$token` (`routes/events_.invite.$token.tsx`).
    // Znak `/` albo `+` wstawiony surowo do adresu robi z jednego tokenu dwa
    // segmenty sciezki - zapraszany dostaje wtedy 404 zamiast formularza,
    // a token jednorazowy juz sie zuzyl.
    expect(api.packageInviteUrl("https://wydarzenia.example.org", "aa/bb+cc dd")).toBe(
      "https://wydarzenia.example.org/events/invite/aa%2Fbb%2Bcc%20dd",
    );
  });

  it("pusty `origin` daje adres wzgledny, a nie adres do nikad", () => {
    // `EventPackageSeatsDialog.tsx:97` podaje `""` przy renderze serwerowym.
    // Adres wzgledny jest wtedy jedyna poprawna odpowiedzia - sklejenie
    // z domyslna domena wyslaloby zapraszanego pod cudze wydarzenie.
    expect(api.packageInviteUrl("", INVITE_TOKEN)).toBe(`/events/invite/${INVITE_TOKEN}`);
  });
});
