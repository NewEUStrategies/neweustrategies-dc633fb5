// Operacje modulu sponsorow, ktore ZABIERAJA wiersz albo ZMIENIAJA widocznosc
// publiczna: usuniecie poziomu, przypiecia firmy i materialu oraz wsadowy
// przelacznik publikacji.
//
// DLACZEGO TEN TEST ISTNIEJE. Te cztery funkcje roznia sie od reszty modulu
// tym, ze ich skutek widac POZA panelem - na stronie wydarzenia albo w postaci
// wiersza, ktorego juz nie ma. Trzy pulapki:
//
//   * `admin_event_sponsors_set_published` czyta flage przez
//     `COALESCE((NULLIF(p_payload->>'is_published',''))::boolean, true)`.
//     BRAK KLUCZA ZNACZY „OPUBLIKUJ". Zgubiony klucz przy wycofywaniu sponsora
//     nie konczy sie bledem - konczy sie publikacja tego, co mialo zniknac.
//   * usuniecie poziomu z przypietymi firmami jest ODRZUCANE (`tier_in_use`),
//     a nie kaskadowe. Odpiecie firm „w tle" byloby cicha utrata poziomu na
//     opublikowanej liscie sponsorow.
//   * material znika PO IDENTYFIKATORZE WIERSZA i nic wiecej. Adres materialu
//     jest wpisywany recznie w dialogu (pole `url`) i wskazuje zasob POZA
//     magazynem plikow tego projektu - `admin_event_sponsor_material_delete`
//     mowi to wprost: „Plik w magazynie nie jest ruszany". Usuwanie sciezki
//     zlozonej z danych wejsciowych kasowaloby cudzy plik.
//
// ZAWEZENIE NAJEMCEM SIEDZI W SQL-u: kazda z tych funkcji zaczyna sie od
// `assert_editor_tenant()` i ma `tenant_id = v_tenant` w WHERE (migracje
// 20260824092824, 20260824093916, 20260824094504). Pilnuje tego bramka
// `check:sql-tenant-scope`; po stronie klienta testowalna jest nazwa funkcji,
// komplet payloadu i to, ze odmowa bazy nie jest polykana.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
  /** Kubelki, po ktore siegnal modul - ma zostac pusty. */
  kubelki: [] as string[],
  /** Sciezki podane do skasowania w magazynie - ma zostac pusta. */
  skasowanePliki: [] as string[][],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
      return h.rpc.rpc(name, args);
    },
    // Magazyn plikow jest ATRAPA GRANICY, nie atrapa modulu: test ma prawo
    // dowiedziec sie, ze modul po niego siegnal, ale nie moze dotknac
    // prawdziwego kubelka.
    storage: {
      from: (bucket: string) => {
        h.kubelki.push(bucket);
        return {
          remove: async (paths: string[]) => {
            h.skasowanePliki.push(paths);
            return { data: null, error: null };
          },
        };
      },
    },
  },
}));

const api = await import("@/lib/events/sponsorsApi");

const POZIOM = "44444444-4444-4444-4444-444444444444";
const SPONSOR = "55555555-5555-5555-5555-555555555555";
const MATERIAL = "66666666-6666-6666-6666-666666666666";
const DRUGI_SPONSOR = "77777777-7777-7777-7777-777777777777";

function rpc(): NonNullable<typeof h.rpc> {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
  return h.rpc;
}

function payloadOf(nazwa: string): Record<string, unknown> {
  const call = rpc().lastCall(nazwa);
  expect(call, `brak wywołania RPC ${nazwa}`).toBeDefined();
  const p = call?.arg("p_payload");
  expect(p !== null && typeof p === "object", `${nazwa}: payload nie jest obiektem`).toBe(true);
  return p as Record<string, unknown>;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.kubelki.length = 0;
  h.skasowanePliki.length = 0;
});

describe("sponsorsApi - usuwanie poziomu sponsorskiego", () => {
  it("poziom z przypiętymi firmami: baza odmawia, firmy NIE są odpinane", async () => {
    rpc().setError(
      "admin_event_sponsor_tier_delete",
      "tier_in_use: 4 company(ies) still pinned to this tier",
    );

    // Komunikat musi zachowac KLUCZ NA POCZATKU - `adminSponsorFailure` czyta
    // go z glowy zdania i dopiero z niego robi tekst dla organizatora.
    await expect(api.deleteSponsorTier(POZIOM)).rejects.toThrow(/^tier_in_use: 4/);
    // Zadnego odpiecia firm „w tle" (`admin_event_sponsor_save`) ani zadnego
    // innego zapisu naprawczego - odmowa jest calym skutkiem operacji.
    expect(rpc().names()).toEqual(["admin_event_sponsor_tier_delete"]);
  });

  it("wolny poziom znika jednym wywołaniem, świadczenia idą kaskadą w bazie", async () => {
    rpc().setData("admin_event_sponsor_tier_delete", true);

    await expect(api.deleteSponsorTier(POZIOM)).resolves.toBe(true);
    expect(rpc().names()).toEqual(["admin_event_sponsor_tier_delete"]);
    expect(rpc().lastCall("admin_event_sponsor_tier_delete")?.keys()).toEqual(["_id"]);
    expect(rpc().lastCall("admin_event_sponsor_tier_delete")?.arg("_id")).toBe(POZIOM);
  });

  it("odpowiedź inna niż `true` nie jest sukcesem", async () => {
    // Panel zdejmuje poziom z listy po tej wartosci; `null` z transportu znaczy
    // „nie wiadomo", a nie „usunieto".
    rpc().setData("admin_event_sponsor_tier_delete", null);
    await expect(api.deleteSponsorTier(POZIOM)).resolves.toBe(false);

    rpc().setData("admin_event_sponsor_tier_delete", false);
    await expect(api.deleteSponsorTier(POZIOM)).resolves.toBe(false);
  });
});

describe("sponsorsApi - usuwanie przypięcia firmy", () => {
  it("kontakty i materiały sponsora idą kaskadą w bazie - klient nie sprząta ich sam", async () => {
    rpc().setData("admin_event_sponsor_delete", true);

    await expect(api.deleteSponsor(SPONSOR)).resolves.toBe(true);

    // Sprzatanie „recznie" (pusta lista kontaktow, kasowanie materialow po
    // kolei) szlo by zapytaniami bez zawezenia najemcem, ktore ma tylko SQL,
    // i zostawialoby polowe roboty przy pierwszym bledzie sieci.
    expect(rpc().names()).toEqual(["admin_event_sponsor_delete"]);
    expect(rpc().lastCall("admin_event_sponsor_delete")?.keys()).toEqual(["_id"]);
    // Wiersz do usuniecia to ten, ktory organizator wskazal na liscie -
    // przypiecie sponsora jest w tabeli nieodroznialne od sasiedniego, wiec
    // pomylony identyfikator zabiera CUDZA firme z opublikowanej listy.
    expect(rpc().lastCall("admin_event_sponsor_delete")?.arg("_id")).toBe(SPONSOR);
  });

  it("brak wiersza w tym najemcy leci wyjątkiem z kluczem bazy", async () => {
    rpc().setError(
      "admin_event_sponsor_delete",
      "not_found: sponsor pin does not exist in this tenant",
    );

    // Klucz `not_found` musi zostac NA POCZATKU zdania - `adminSponsorFailure`
    // czyta go z glowy komunikatu i dopiero z niego robi tekst dla organizatora.
    await expect(api.deleteSponsor(SPONSOR)).rejects.toThrow(/^not_found:/);
    // Odmowa jest ostateczna: zadnej drugiej proby i zadnego sprzatania
    // „skoro i tak nie ma wiersza" - takie sprzatanie szloby bez zawezenia
    // najemcem, ktore ma tylko SQL.
    expect(rpc().names()).toEqual(["admin_event_sponsor_delete"]);
  });
});

describe("sponsorsApi - usuwanie materiału sponsora", () => {
  it("materiał znika po identyfikatorze WIERSZA, a magazyn plików nie jest ruszany", async () => {
    rpc().setData("admin_event_sponsor_material_delete", true);

    await expect(api.deleteSponsorMaterial(MATERIAL)).resolves.toBe(true);

    // Payload to WYLACZNIE identyfikator wiersza wskazanego na liscie. Gdyby
    // szla tu sciezka zlozona z pola `url` (wpisywanego recznie w dialogu),
    // usuniecie pozycji z listy kasowaloby plik, ktory moze nalezec do kogos
    // innego - a wpisu nikt po drodze nie waliduje jako adresu w magazynie.
    expect(rpc().lastCall("admin_event_sponsor_material_delete")?.keys()).toEqual(["_id"]);
    expect(rpc().lastCall("admin_event_sponsor_material_delete")?.arg("_id")).toBe(MATERIAL);
    expect(h.kubelki).toEqual([]);
    expect(h.skasowanePliki).toEqual([]);
  });

  it("odmowa bazy przy materiale nie jest połykana", async () => {
    rpc().setError(
      "admin_event_sponsor_material_delete",
      "not_found: material does not exist in this tenant",
    );

    // Polkniety blad = pozycja znika z ekranu do pierwszego odswiezenia,
    // a na stronie wydarzenia material wisi dalej.
    await expect(api.deleteSponsorMaterial(MATERIAL)).rejects.toThrow(/^not_found:/);
    expect(h.kubelki).toEqual([]);
  });
});

describe("sponsorsApi - wsadowy przełącznik publikacji", () => {
  it("publikacja wysyła jawne `true` i oddaje liczbę zmienionych wierszy", async () => {
    rpc().setData("admin_event_sponsors_set_published", 2);

    await expect(api.setSponsorsPublished([SPONSOR, DRUGI_SPONSOR], true)).resolves.toBe(2);
    expect(payloadOf("admin_event_sponsors_set_published")).toEqual({
      ids: [SPONSOR, DRUGI_SPONSOR],
      is_published: true,
    });
  });

  it("wycofanie wysyła JAWNE `false`, bo brak klucza baza czyta jako publikację", async () => {
    rpc().setData("admin_event_sponsors_set_published", 1);

    await expect(api.setSponsorsPublished([SPONSOR], false)).resolves.toBe(1);
    const p = payloadOf("admin_event_sponsors_set_published");
    // `COALESCE(..., true)` w SQL-u: zgubiony klucz zamienia „schowaj" w
    // „opublikuj", czyli wystawia na strone wydarzenia firmy, ktore mialy z
    // niej zniknac. Obecnosc klucza jest tu wazniejsza niz jego wartosc.
    expect("is_published" in p).toBe(true);
    expect(p.is_published).toBe(false);
  });

  it("przełącznik nie zmienia niczego poza flagą", async () => {
    rpc().setData("admin_event_sponsors_set_published", 1);

    await api.setSponsorsPublished([SPONSOR], true);

    // Zaden poziom, zadna kolejnosc, zadna migawka. Kazde dodatkowe pole
    // w tym payloadzie bylo by zmiana wykonana przy okazji publikacji -
    // czyli zmiana, ktorej organizator nie zlecil i nie zobaczy.
    expect(Object.keys(payloadOf("admin_event_sponsors_set_published")).sort()).toEqual([
      "ids",
      "is_published",
    ]);
  });

  it("identyfikatory idą w komplecie i w kolejności, także gdy lista jest pusta", async () => {
    rpc().setData("admin_event_sponsors_set_published", 0);

    await api.setSponsorsPublished([DRUGI_SPONSOR, SPONSOR], true);
    expect(payloadOf("admin_event_sponsors_set_published").ids).toEqual([DRUGI_SPONSOR, SPONSOR]);

    await api.setSponsorsPublished([], true);
    // `jsonb_typeof(p_payload->'ids') IS DISTINCT FROM 'array'` konczy sie
    // `invalid_payload`, wiec pusty wybor MUSI dojechac jako pusta tablica,
    // a nie jako brak klucza.
    expect(payloadOf("admin_event_sponsors_set_published").ids).toEqual([]);
  });

  it("sponsor bez poziomu blokuje CAŁY wsad - błąd zamiast cichego zera", async () => {
    rpc().setError(
      "admin_event_sponsors_set_published",
      "sponsor_tier_required: 1 sponsor(s) in the selection have no tier",
    );

    // Ciche `0` wygladaloby na ekranie jak „nic nie bylo do zmiany", a nie jak
    // „publikacja nie doszla do skutku".
    await expect(api.setSponsorsPublished([SPONSOR], true)).rejects.toThrow(
      /^sponsor_tier_required: 1/,
    );
  });

  it("brak liczby z bazy to zero zmienionych wierszy, nie NaN na ekranie", async () => {
    rpc().setData("admin_event_sponsors_set_published", null);

    await expect(api.setSponsorsPublished([SPONSOR], false)).resolves.toBe(0);
  });
});
