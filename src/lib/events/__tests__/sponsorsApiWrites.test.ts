// MODUL SPONSOROW: KOLEJNOSC, WYSZUKIWARKA FIRM, KARTA SPONSORA I ZAPIS
// MATERIALU - reszta pliku, ktorej nie wzieły ani `sponsorsApi.test.ts`, ani
// pierwsza fala.
//
// PODZIAL PRACY. `sponsorsApi.test.ts` wzial filtry listy i zapis sponsora,
// `sponsorsApiMutations.test.ts` (pierwsza fala) - usuwanie i wsadowa
// publikacje. Tutaj stoi to, czego nie wolal nikt: `fetchSponsorTiers`,
// `reorderSponsorTiers`, `fetchSponsorDetail`, `searchSponsorCompanies`,
// `reorderSponsors`, `saveSponsorMaterial` oraz galezie ODMOWY funkcji, ktore
// dotad testowano wylacznie na przebiegu szczesliwym. Zmierzone przed ta praca:
// 73,84% linii, 70,83% funkcji, 56,66% galezi.
//
// CO TU PILNUJEMY.
//
// 1) POMINIETY KLUCZ TO NIE JEST JAWNY NULL. `payload()`
//    (`sponsorsApi.ts:64-70`) pomija wylacznie `undefined`, a SQL czyta to
//    doslownie: `COALESCE(i.rank, t.rank)` w kolejnosci poziomow
//    (`20260824092824:259-260`) i `COALESCE((...)::boolean, is_published)`
//    w materiale (`20260824094504:29`). Zgubiony klucz nie jest wiec „brakiem
//    zmiany" po stronie ekranu - jest PRZYWROCENIEM starej wartosci.
// 2) ZERO JEST WARTOSCIA, NIE PUSTKA. `sort_order: 0` to pierwsza pozycja na
//    liscie. `admin_event_sponsors_reorder` POMIJA pozycje bez `sort_order`
//    (`NULLIF(x->>'sort_order','') IS NOT NULL`, `20260824093916:290-291`),
//    wiec zgubione zero znaczy „ten sponsor sie nie przestawil" - i tylko ten
//    jeden, po przeciagnieciu go na sam poczatek listy.
// 3) FILTR PUSTY TO BRAK FILTRA. `args()` (`sponsorsApi.ts:56-62`) wycina
//    `undefined` z argumentow POZYCYJNYCH, bo `admin_event_sponsor_companies_search`
//    ma dla nich DEFAULT-y (`p_q DEFAULT NULL`, `p_limit DEFAULT 20`).
//    Wyslany jawny `null` to co innego niz brak argumentu.
// 4) ODMOWA MA POLECIEC WYJATKIEM. `unwrap()` i kazda funkcja zapisujaca
//    zamieniaja blad bazy na `new Error(error.message)` z KLUCZEM NA POCZATKU
//    zdania - `adminSponsorFailure` czyta go z glowy komunikatu. Polkniety
//    blad daje ekran, ktory potwierdza zmiane nieistniejaca w bazie.
//
// ZAWEZENIE NAJEMCEM SIEDZI W SQL (zasada 12): kazda z tych funkcji zaczyna sie
// od `assert_editor_tenant()` i ma `tenant_id = v_tenant` w WHERE (migracje
// 20260824092824, 20260824093602, 20260824093916, 20260824094233,
// 20260824094504). Pilnuje go bramka `check:sql-tenant-scope`; po stronie
// klienta testowalna jest nazwa funkcji, komplet ladunku i to, ze klient nie
// probuje podac najemcy sam.
//
// ATRAPA OBEJMUJE WYLACZNIE KLIENTA SUPABASE (granica). `sponsorsApi` jest
// modulem POKRYWANYM i nie wolno go podmieniac.
//
// RODO: firmy, osoby i adresy sa syntetyczne, poczta wylacznie w `example.com`.
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

const api = await import("@/lib/events/sponsorsApi");

const EVENT_ID = "5c6d0000-0000-4000-8000-000000000001";
const TIER_ZLOTY = "5c6d0000-0000-4000-8000-000000000002";
const TIER_SREBRNY = "5c6d0000-0000-4000-8000-000000000003";
const SPONSOR_A = "5c6d0000-0000-4000-8000-000000000004";
const SPONSOR_B = "5c6d0000-0000-4000-8000-000000000005";
const MATERIAL_ID = "5c6d0000-0000-4000-8000-000000000006";

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

/** Pozycje `items` z ladunku - jedyny ksztalt, ktory czyta `jsonb_array_elements`. */
function itemsOf(name: string): Array<Record<string, unknown>> {
  const items = payloadOf(name).items;
  if (!Array.isArray(items)) throw new Error(`test: ${name} nie wyslalo tablicy items`);
  return items.map((item) => {
    if (item === null || typeof item !== "object") {
      throw new Error(`test: ${name} wyslalo pozycje, ktora nie jest obiektem`);
    }
    return item as Record<string, unknown>;
  });
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

/* -------------------------------------------------------- lista poziomow --- */

describe("fetchSponsorTiers", () => {
  it("poziomy ida po wydarzeniu i wracaja bez przerabiania", async () => {
    // `max_companies: null` znaczy „bez limitu firm", a `accent_color: null` -
    // „bez koloru akcentu". Panel czyta obie kolumny wprost, wiec uzupelnienie
    // ich tutaj zamienilo by poziom otwarty w poziom zamkniety.
    const poziom = { id: TIER_ZLOTY, key: "zloty", max_companies: null, accent_color: null };
    rpc().setData("admin_event_sponsor_tiers_list", [poziom]);

    await expect(api.fetchSponsorTiers(EVENT_ID)).resolves.toEqual([poziom]);
    expect(rpc().lastCall("admin_event_sponsor_tiers_list")?.args).toEqual({
      p_event_id: EVENT_ID,
    });
  });

  it("brak poziomow to pusta lista, a nie `null` w panelu", async () => {
    rpc().setData("admin_event_sponsor_tiers_list", null);

    await expect(api.fetchSponsorTiers(EVENT_ID)).resolves.toEqual([]);
  });

  it("odmowa bazy leci wyjatkiem z kluczem na poczatku zdania", async () => {
    // Pusta lista po awarii wygladalaby jak wydarzenie bez poziomow
    // sponsorskich - a wtedy organizator zalozylby je drugi raz i rozbil
    // przypiecia firm na dwa rownolegle zestawy.
    rpc().setError("admin_event_sponsor_tiers_list", "forbidden: editor role required");

    await expect(api.fetchSponsorTiers(EVENT_ID)).rejects.toThrow(/^forbidden:/);
  });
});

/* --------------------------------------------------- kolejnosc poziomow --- */

describe("reorderSponsorTiers", () => {
  it("przeciagniecie samej kolejnosci NIE niesie rangi poziomu", async () => {
    rpc().setData("admin_event_sponsor_tiers_reorder", 2);

    const przestawione = await api.reorderSponsorTiers([
      { id: TIER_ZLOTY, sortOrder: 0 },
      { id: TIER_SREBRNY, sortOrder: 1 },
    ]);

    expect(przestawione).toBe(2);
    // `rank` pominiety znaczy w SQL `COALESCE(i.rank, t.rank)`, czyli „zostaw
    // range". Wyslanie tu czegokolwiek - choćby zera z formularza - zrownaloby
    // rangi wszystkich poziomow, a ranga decyduje o wielkosci logotypu i o tym,
    // ktory poziom stoi wyzej na opublikowanej liscie sponsorow.
    expect(itemsOf("admin_event_sponsor_tiers_reorder")).toEqual([
      { id: TIER_ZLOTY, sort_order: 0 },
      { id: TIER_SREBRNY, sort_order: 1 },
    ]);
  });

  it("zmiana rangi jedzie razem z kolejnoscia, gdy organizator o nia poprosil", async () => {
    rpc().setData("admin_event_sponsor_tiers_reorder", 1);

    await api.reorderSponsorTiers([{ id: TIER_ZLOTY, sortOrder: 0, rank: 10 }]);

    expect(itemsOf("admin_event_sponsor_tiers_reorder")).toEqual([
      { id: TIER_ZLOTY, sort_order: 0, rank: 10 },
    ]);
  });

  it("pusty wybor jedzie jako PUSTA TABLICA, bo brak klucza to `invalid_payload`", async () => {
    rpc().setData("admin_event_sponsor_tiers_reorder", 0);

    await expect(api.reorderSponsorTiers([])).resolves.toBe(0);
    // `jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'` konczy sie
    // wyjatkiem (`20260824092824:253-255`), wiec pusta lista MUSI dojechac
    // jako tablica, a nie zniknac z ladunku.
    expect(payloadOf("admin_event_sponsor_tiers_reorder")).toEqual({ items: [] });
  });

  it("brak liczby z bazy to zero przestawionych wierszy, a nie NaN na ekranie", async () => {
    rpc().setData("admin_event_sponsor_tiers_reorder", null);

    // `Number(null)` to 0, ale `Number(undefined)` to NaN - i to NaN
    // wyladowaloby w zdaniu „przestawiono NaN poziomow".
    await expect(api.reorderSponsorTiers([{ id: TIER_ZLOTY, sortOrder: 0 }])).resolves.toBe(0);
  });

  it("odmowa bazy leci wyjatkiem, a nie cichym zerem", async () => {
    rpc().setError(
      "admin_event_sponsor_tiers_reorder",
      "invalid_payload: items must be an array of {id, sort_order, rank}",
    );

    // Ciche `0` wygladaloby jak „nic nie bylo do przestawienia", czyli jak
    // sukces - a lista wrocilaby do starej kolejnosci przy odswiezeniu.
    await expect(api.reorderSponsorTiers([{ id: TIER_ZLOTY, sortOrder: 0 }])).rejects.toThrow(
      /^invalid_payload:/,
    );
  });
});

/* --------------------------------------------------- kolejnosc sponsorow --- */

describe("reorderSponsors", () => {
  it("pozycja pierwsza jedzie jako `sort_order: 0`, nie znika z ladunku", async () => {
    rpc().setData("admin_event_sponsors_reorder", 2);

    await expect(
      api.reorderSponsors([
        { id: SPONSOR_A, sortOrder: 0 },
        { id: SPONSOR_B, sortOrder: 10 },
      ]),
    ).resolves.toBe(2);

    // SQL pomija pozycje bez `sort_order`. Zgubione zero znaczy: firma
    // przeciagnieta na sam poczatek listy jako jedyna nie zmieni miejsca -
    // i to na liscie, ktora jest widoczna publicznie.
    expect(itemsOf("admin_event_sponsors_reorder")).toEqual([
      { id: SPONSOR_A, sort_order: 0 },
      { id: SPONSOR_B, sort_order: 10 },
    ]);
  });

  it("ranga NIE jedzie z przypieciem firmy - ranga nalezy do poziomu", async () => {
    rpc().setData("admin_event_sponsors_reorder", 1);

    await api.reorderSponsors([{ id: SPONSOR_A, sortOrder: 3, rank: 99 }]);

    // `admin_event_sponsors_reorder` czyta wylacznie `id` i `sort_order`
    // (`20260824093916:284-289`). Ranga wyslana stad byla by pozorna zmiana:
    // organizator zobaczylby ja w formularzu, baza by ja pominela, a przy
    // odswiezeniu wrocilaby ranga poziomu.
    expect(itemsOf("admin_event_sponsors_reorder")).toEqual([{ id: SPONSOR_A, sort_order: 3 }]);
  });

  it("brak liczby to zero; odmowa to wyjatek", async () => {
    rpc().setData("admin_event_sponsors_reorder", null);
    await expect(api.reorderSponsors([{ id: SPONSOR_A, sortOrder: 1 }])).resolves.toBe(0);

    rpc().setError("admin_event_sponsors_reorder", "forbidden: editor role required");
    await expect(api.reorderSponsors([{ id: SPONSOR_A, sortOrder: 1 }])).rejects.toThrow(
      /^forbidden:/,
    );
  });
});

/* ------------------------------------------------------- karta sponsora --- */

describe("fetchSponsorDetail", () => {
  it("oddaje PIERWSZY wiersz, bo `RETURNS TABLE` niesie liste nawet dla jednego", async () => {
    const karta = {
      id: SPONSOR_A,
      snapshot_name: "Przykladowa Fabryka Sp. z o.o.",
      crm_name: "Przykladowa Fabryka",
      crm_drift_fields: ["name"],
      contacts: [],
      materials: [],
    };
    rpc().setData("admin_event_sponsor_detail", [karta]);

    await expect(api.fetchSponsorDetail(SPONSOR_A)).resolves.toEqual(karta);
    expect(rpc().lastCall("admin_event_sponsor_detail")?.args).toEqual({ _id: SPONSOR_A });
  });

  it("brak wiersza to `null`, a nie `undefined` z pustej tablicy", async () => {
    // Dialog rozroznia „jeszcze sie laduje" od „nie ma takiego przypiecia".
    // `undefined` z `rows[0]` wpadloby w te pierwsza galaz i zostawilo
    // wirujacy wskaznik ladowania na zawsze.
    rpc().setData("admin_event_sponsor_detail", []);
    await expect(api.fetchSponsorDetail(SPONSOR_A)).resolves.toBeNull();

    rpc().setData("admin_event_sponsor_detail", null);
    await expect(api.fetchSponsorDetail(SPONSOR_A)).resolves.toBeNull();
  });

  it("odmowa bazy leci wyjatkiem, a nie kartą pustą", async () => {
    rpc().setError(
      "admin_event_sponsor_detail",
      "not_found: sponsor pin does not exist in this tenant",
    );

    await expect(api.fetchSponsorDetail(SPONSOR_A)).rejects.toThrow(/^not_found:/);
  });
});

/* --------------------------------------------------- wyszukiwarka firm --- */

describe("searchSponsorCompanies", () => {
  it("pusta fraza to BRAK argumentu, czyli pierwsza strona kartoteki", async () => {
    rpc().setData("admin_event_sponsor_companies_search", []);

    await api.searchSponsorCompanies(EVENT_ID, "   ");

    // `p_q DEFAULT NULL` i `p_limit DEFAULT 20`: pominiety argument znaczy
    // „pokaz wszystko z limitem domyslnym". Wyslany pusty napis dawalby
    // `c.name ILIKE '%%'` - to samo, ale juz nie dzieki DEFAULT-owi, tylko
    // przypadkiem, a `p_limit: undefined` przeszedlby przez PostgREST jako
    // jawny NULL i wywrocil `LEAST(GREATEST(COALESCE(...)))`.
    expect(rpc().lastCall("admin_event_sponsor_companies_search")?.args).toEqual({
      p_event_id: EVENT_ID,
    });
  });

  it("fraza i limit jada, gdy sa podane", async () => {
    rpc().setData("admin_event_sponsor_companies_search", []);

    await api.searchSponsorCompanies(EVENT_ID, "fabryka", 5);

    expect(rpc().lastCall("admin_event_sponsor_companies_search")?.args).toEqual({
      p_event_id: EVENT_ID,
      p_q: "fabryka",
      p_limit: 5,
    });
  });

  it("wyniki wracaja z flagą przypiecia nietknietą; brak wynikow to pusta lista", async () => {
    const firma = {
      id: "5c6d0000-0000-4000-8000-000000000007",
      name: "Przykladowa Fabryka Sp. z o.o.",
      domain: "example.com",
      is_pinned: true,
      pinned_sponsor_id: SPONSOR_A,
      events_count: 3,
    };
    rpc().setData("admin_event_sponsor_companies_search", [firma]);
    // `is_pinned` decyduje o tym, czy dialog zaproponuje przypiecie, czy
    // odeśle do juz istniejacego wiersza. Zgubienie tej kolumny konczy sie
    // druga karta tej samej firmy na jednym wydarzeniu.
    await expect(api.searchSponsorCompanies(EVENT_ID, "fabryka")).resolves.toEqual([firma]);

    rpc().setData("admin_event_sponsor_companies_search", null);
    await expect(api.searchSponsorCompanies(EVENT_ID, "fabryka")).resolves.toEqual([]);
  });

  it("odmowa bazy leci wyjatkiem, a nie pusta kartoteka", async () => {
    rpc().setError("admin_event_sponsor_companies_search", "forbidden: editor role required");

    await expect(api.searchSponsorCompanies(EVENT_ID, "fabryka")).rejects.toThrow(/^forbidden:/);
  });
});

/* -------------------------------------------------- zapis materialu --- */

describe("saveSponsorMaterial", () => {
  it("nowy material niesie PRZYPIECIE, a nie wydarzenie", async () => {
    rpc().setData("admin_event_sponsor_material_save", MATERIAL_ID);

    const id = await api.saveSponsorMaterial({
      sponsorId: SPONSOR_A,
      kind: "presentation",
      titlePl: "Prezentacja partnera",
      titleEn: "Partner deck",
      url: "https://materialy.example.org/deck.pdf",
      sortOrder: 10,
      isPublished: true,
    });

    expect(id).toBe(MATERIAL_ID);
    const sent = payloadOf("admin_event_sponsor_material_save");
    // Wydarzenie bierze sie Z PRZYPIECIA (`SELECT s.event_id ... WHERE s.id =
    // v_sponsor_id`, `20260824094504:48-52`) wlasnie po to, zeby klient nie mial
    // czym rozjechac pary sponsor-wydarzenie. Wyslane stad `event_id` byloby
    // drugim zrodlem prawdy o tej samej rzeczy.
    expect("event_id" in sent).toBe(false);
    expect(sent.sponsor_id).toBe(SPONSOR_A);
    expect(sent.url).toBe("https://materialy.example.org/deck.pdf");
  });

  it("edycja nie niesie ani przypiecia, ani adresu, gdy organizator ich nie ruszal", async () => {
    rpc().setData("admin_event_sponsor_material_save", MATERIAL_ID);

    await api.saveSponsorMaterial({
      id: MATERIAL_ID,
      titlePl: "Prezentacja partnera (2026)",
      titleEn: "Partner deck (2026)",
    });

    const sent = payloadOf("admin_event_sponsor_material_save");
    expect(sent.id).toBe(MATERIAL_ID);
    // `url = COALESCE(NULLIF(btrim(...), ''), url)`: brak klucza zostawia stary
    // adres. Gdyby klient wysylal tu pusty napis z niewypelnionego pola, adres
    // i tak by przetrwal - ale gdyby wysylal `null`, pozycja na stronie
    // wydarzenia zostalaby bez odnosnika.
    expect("url" in sent).toBe(false);
    expect("sponsor_id" in sent).toBe(false);
    expect(Object.keys(sent).sort()).toEqual(["id", "title_en", "title_pl"]);
  });

  it("wycofanie materialu ze strony jedzie JAWNYM `false`", async () => {
    rpc().setData("admin_event_sponsor_material_save", MATERIAL_ID);

    await api.saveSponsorMaterial({
      id: MATERIAL_ID,
      titlePl: "Prezentacja partnera",
      titleEn: "Partner deck",
      isPublished: false,
      sortOrder: 0,
    });

    const sent = payloadOf("admin_event_sponsor_material_save");
    // `COALESCE((NULLIF(p_payload->>'is_published',''))::boolean, is_published)`:
    // zgubiony klucz ZOSTAWIA material opublikowany. Organizator dostalby
    // potwierdzenie zapisu, a plik nadal wisialby na stronie wydarzenia.
    expect("is_published" in sent).toBe(true);
    expect(sent.is_published).toBe(false);
    // To samo z zerem: pierwsza pozycja listy materialow.
    expect(sent.sort_order).toBe(0);
  });

  it("nowy material bez adresu zatrzymuje baza, a odmowa nie jest polykana", async () => {
    rpc().setError("admin_event_sponsor_material_save", "invalid_url: url is required");

    await expect(
      api.saveSponsorMaterial({
        sponsorId: SPONSOR_A,
        titlePl: "Prezentacja partnera",
        titleEn: "Partner deck",
      }),
    ).rejects.toThrow(/^invalid_url:/);
    // Polkniety blad dalby `String(undefined)` = `"undefined"` jako
    // identyfikator materialu, a panel odswiezylby po nim liste.
    expect(rpc().names()).toEqual(["admin_event_sponsor_material_save"]);
  });

  it("material z cudzego najemcy konczy sie `not_found`", async () => {
    rpc().setError(
      "admin_event_sponsor_material_save",
      "not_found: material does not exist in this tenant",
    );

    await expect(
      api.saveSponsorMaterial({ id: MATERIAL_ID, titlePl: "A", titleEn: "B" }),
    ).rejects.toThrow(/^not_found:/);
  });
});

/* ------------------------------------------ odmowy pozostalych zapisow --- */

describe("sponsorsApi - odmowa bazy w pozostalych zapisach", () => {
  it("poziom bez obu nazw nie zapisuje sie po cichu", async () => {
    rpc().setError("admin_event_sponsor_tier_save", "invalid_names: both names are required");

    // `saveSponsorTier` oddaje `String(data)`, wiec polkniety blad dalby
    // identyfikator `"undefined"` i panel probowalby po nim odswiezyc poziom.
    await expect(
      api.saveSponsorTier({ eventId: EVENT_ID, key: "zloty", namePl: "Zloty", nameEn: "" }),
    ).rejects.toThrow(/^invalid_names:/);
  });

  it("odswiezanie migawek: odmowa to wyjatek, brak liczby to zero", async () => {
    rpc().setError(
      "admin_event_sponsor_snapshot_refresh",
      "not_found: sponsor pin does not exist in this tenant",
    );
    // Migawka jest tym, co widzi odwiedzajacy strone wydarzenia. Ciche `0`
    // znaczyloby „nic nie wymagalo odswiezenia", czyli „dane sa aktualne" -
    // a byly by rozjechane z kartoteka CRM.
    await expect(api.refreshSponsorSnapshots({ ids: [SPONSOR_A] })).rejects.toThrow(/^not_found:/);

    rpc().setData("admin_event_sponsor_snapshot_refresh", null);
    await expect(api.refreshSponsorSnapshots({ eventId: EVENT_ID })).resolves.toBe(0);
  });

  it("kontakty sponsora: odmowa to wyjatek, brak liczby to zero", async () => {
    rpc().setError(
      "admin_event_sponsor_contacts_set",
      "not_found: lead does not exist in this tenant",
    );
    // `admin_event_sponsor_contacts_set` USTAWIA caly zestaw kontaktow naraz,
    // wiec polknieta odmowa zostawilaby na ekranie liste, ktorej w bazie nie ma -
    // i organizator pisalby na wydarzeniu do osoby, ktora juz nie odpowiada za
    // te firme.
    await expect(
      api.setSponsorContacts(SPONSOR_A, [
        { leadId: "5c6d0000-0000-4000-8000-000000000008", role: "primary", isPrimary: true },
      ]),
    ).rejects.toThrow(/^not_found:/);

    rpc().setData("admin_event_sponsor_contacts_set", null);
    await expect(api.setSponsorContacts(SPONSOR_A, [])).resolves.toBe(0);
  });

  it("kolejnosc materialow: odmowa to wyjatek, brak liczby to zero", async () => {
    rpc().setError(
      "admin_event_sponsor_materials_reorder",
      "invalid_payload: items must be an array of {id, sort_order}",
    );
    await expect(api.reorderSponsorMaterials([{ id: MATERIAL_ID, sortOrder: 0 }])).rejects.toThrow(
      /^invalid_payload:/,
    );

    rpc().setData("admin_event_sponsor_materials_reorder", null);
    await expect(api.reorderSponsorMaterials([])).resolves.toBe(0);
  });
});
