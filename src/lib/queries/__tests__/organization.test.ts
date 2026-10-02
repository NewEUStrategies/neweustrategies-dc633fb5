// CO TEN PLIK DOWODZI
// -------------------
// Warstwa danych profilu organizacji decyduje o trzech rzeczach, których nie
// widać w renderze, a które psują stronę na produkcji:
//
//   1. CO JEST ORGANIZACJĄ. Term musi być szukany z filtrem `kind`, inaczej
//      `/organization/gospodarka` otworzyłby zwykłą kategorię treści i serwis
//      miałby ten sam byt pod dwoma adresami;
//   2. KTÓRA NAZWA IDZIE DO KARTOTEKI CRM. Term ma dwie nazwy, kartoteka jedną;
//      brak trafienia pod nazwą w języku strony MUSI spróbować drugiej, bo
//      inaczej wersja EN profilu traci logo, branżę i adres;
//   3. JAK SZUKAMY LUDZI. Filtr po `current_company` idzie po nieindeksowanej
//      kolumnie, więc musi być ŚCISŁY (`in`, nie `ilike`) i twardo ograniczony.
//
// Dodatkowo: awaria zapytania o term LECI W GÓRĘ (trasa rozróżnia „nie ma" od
// „nie wiem"), a awaria kartoteki NIE MOŻE wywrócić profilu - marka jest
// dekoracją tożsamości, nie jej warunkiem.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
// ---------------------------
// Nagłówka i JSON-LD trasy (`src/routes/__tests__/organizationRoute.test.tsx`),
// renderu sekcji (`src/components/organizations/__tests__`) ani archiwum wpisów
// - listę bierzemy z `taxonomyArchiveQueryOptions`, które ma własny plik.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { fail, ok, type RecordedChain, type SupabaseFromStub } from "@/test/supabaseChain";
import type { SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase/chain");
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  const from = supabaseFromStub();
  const rpc = supabaseRpcStub();
  h.from = from;
  h.rpc = rpc;
  return { supabase: { from: from.from, rpc: rpc.rpc } };
});

import {
  ORGANIZATION_PEOPLE_LIMIT,
  isCompanyOrganizationSlug,
  organizationCompanyNames,
  organizationDescription,
  organizationName,
  organizationPeopleQueryOptions,
  organizationQueryOptions,
  personFromProfileRow,
  type OrganizationTerm,
} from "@/lib/queries/organization";

function baza(): SupabaseFromStub {
  const s = h.from;
  if (!s) throw new Error("atrapa łańcucha Supabase nie została podpięta");
  return s;
}

function funkcje(): SupabaseRpcStub {
  const s = h.rpc;
  if (!s) throw new Error("atrapa RPC Supabase nie została podpięta");
  return s;
}

function lancuch(tabela: string): RecordedChain {
  const c = baza().lastChain(tabela);
  if (!c) throw new Error(`test: kod nie zbudował łańcucha dla tabeli "${tabela}"`);
  return c;
}

function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const WIERSZ_TERMU = {
  id: "org-1",
  slug: "nato",
  name_pl: "Organizacja Traktatu Północnoatlantyckiego",
  name_en: "North Atlantic Treaty Organization",
  description_pl: "Sojusz polityczno-wojskowy.",
  description_en: null,
  logo_url: null,
  color: null,
};

const TERM: OrganizationTerm = { ...WIERSZ_TERMU };

const MARKA = {
  name: "NATO",
  logo_url: "https://cdn.example/nato.svg",
  website: "nato.int",
  branch: "Bezpieczeństwo",
};

beforeEach(() => {
  baza().reset();
  funkcje().reset();
});

describe("rozstrzyganie termu organizacji", () => {
  it("szuka po slugu I po rodzaju - kategoria treści nie jest organizacją", () => {
    baza().setResponse("categories", ok(null));
    funkcje().setData("crm_company_brand", []);
    return klient()
      .fetchQuery(organizationQueryOptions("gospodarka", "pl"))
      .then((wynik) => {
        expect(wynik).toBeNull();
        const c = lancuch("categories");
        expect(c.calls.filter((call) => call.method === "eq").map((call) => call.args)).toEqual([
          ["kind", "organization"],
          ["slug", "gospodarka"],
        ]);
        expect(c.has("maybeSingle")).toBe(true);
      });
  });

  it("brakujące kolumny opcjonalne termu schodzą do `null`, a nie do `undefined`", async () => {
    // Widok i JSON-LD rozpoznają „brak" po `null` - `undefined` przepuściłby
    // pole do danych strukturalnych jako `"logo": undefined`.
    baza().setResponse(
      "categories",
      ok({ id: "t", slug: "nato", name_pl: "NATO", name_en: "NATO" }),
    );
    funkcje().setData("crm_company_brand", []);
    const wynik = await klient().fetchQuery(organizationQueryOptions("nato", "pl"));
    expect(wynik?.term).toEqual({
      id: "t",
      slug: "nato",
      name_pl: "NATO",
      name_en: "NATO",
      description_pl: null,
      description_en: null,
      logo_url: null,
      color: null,
    });
  });

  it("czyta komplet kolumn wizytówki, nie tylko nazwę", async () => {
    baza().setResponse("categories", ok(WIERSZ_TERMU));
    funkcje().setData("crm_company_brand", [MARKA]);
    const wynik = await klient().fetchQuery(organizationQueryOptions("nato", "pl"));
    expect(String(lancuch("categories").argsOf("select")?.[0])).toBe(
      "id, slug, name_pl, name_en, description_pl, description_en, logo_url, color",
    );
    expect(wynik?.term.id).toBe("org-1");
    expect(wynik?.brand?.branch).toBe("Bezpieczeństwo");
  });

  it("ODMOWA BAZY NIE JEST PUSTKĄ - brak termu i awaria to dwa różne stany", async () => {
    // Trasa robi z `null` twarde 404. Gdyby odmowa odczytu schodziła do tej
    // samej wartości, blip backendu wyrzucałby indeksowaną stronę z wyników.
    baza().setResponse("categories", fail("odmowa odczytu categories", "42501"));
    await expect(klient().fetchQuery(organizationQueryOptions("nato", "pl"))).rejects.toThrow(
      "odmowa odczytu categories",
    );
  });
});

describe("firma z kartoteki (slug `org-<uuid>`)", () => {
  const ID = "6f1c2b9e-1d2a-4c3b-8e7f-0a1b2c3d4e5f";
  const SLUG = `org-${ID}`;
  const WIERSZ_FIRMY = {
    id: ID,
    kind: "organization",
    label: "  Instytut   Badań  ",
    subtitle: "Think tank",
    logo_url: "https://cdn.example/instytut.png",
    website: "instytut.example",
  };

  it("rozpoznaje WYŁĄCZNIE prefiks z pełnym UUID - reszta jest termem", () => {
    expect(isCompanyOrganizationSlug(SLUG)).toBe(true);
    expect(isCompanyOrganizationSlug(`org-${ID.toUpperCase()}`)).toBe(true);
    // „org-" bez identyfikatora i zwykły slug zaczynający się od „org" to termy.
    expect(isCompanyOrganizationSlug("org-")).toBe(false);
    expect(isCompanyOrganizationSlug("org-nato")).toBe(false);
    expect(isCompanyOrganizationSlug("organizacja-narodow")).toBe(false);
    expect(isCompanyOrganizationSlug("nato")).toBe(false);
  });

  it("pyta RPC wzmianek, NIE taksonomię, i markę bierze z tego samego wiersza", async () => {
    funkcje().setData("get_mention_target", [WIERSZ_FIRMY]);
    const wynik = await klient().fetchQuery(organizationQueryOptions(SLUG, "pl"));
    expect(funkcje().lastCall("get_mention_target")?.arg("_slug")).toBe(SLUG);
    // Drugie zapytanie o markę byłoby pytaniem o to samo - kartoteka już ją oddała.
    expect(funkcje().callsFor("crm_company_brand")).toHaveLength(0);
    expect(baza().lastChain("categories")).toBeUndefined();
    expect(wynik).toEqual({
      term: {
        id: ID,
        slug: SLUG,
        name_pl: "Instytut Badań",
        name_en: "Instytut Badań",
        description_pl: null,
        description_en: null,
        logo_url: "https://cdn.example/instytut.png",
        color: null,
      },
      brand: {
        name: "Instytut Badań",
        logoUrl: "https://cdn.example/instytut.png",
        website: "instytut.example",
        branch: "Think tank",
      },
    });
  });

  it("wiersz bez etykiety dostaje nazwę ze sluga, a puste pola marki znikają", async () => {
    funkcje().setData("get_mention_target", [
      { ...WIERSZ_FIRMY, label: "   ", subtitle: null, logo_url: "", website: null },
    ]);
    const wynik = await klient().fetchQuery(organizationQueryOptions(SLUG, "en"));
    expect(wynik?.term.name_en).toBe(SLUG);
    expect(wynik?.term.logo_url).toBeNull();
    expect(wynik?.brand).toEqual({ name: SLUG, logoUrl: null, website: null, branch: null });
  });

  it("wzmianka OSOBY pod tym samym slugiem nie udaje organizacji - to 404", async () => {
    funkcje().setData("get_mention_target", [{ ...WIERSZ_FIRMY, kind: "person" }]);
    expect(await klient().fetchQuery(organizationQueryOptions(SLUG, "pl"))).toBeNull();
  });

  it("brak wiersza to 404, a pusta odpowiedź bazy też", async () => {
    funkcje().setData("get_mention_target", []);
    expect(await klient().fetchQuery(organizationQueryOptions(SLUG, "pl"))).toBeNull();
    funkcje().setData("get_mention_target", null);
    expect(await klient().fetchQuery(organizationQueryOptions(SLUG, "pl"))).toBeNull();
  });

  it("ODMOWA RPC LECI W GÓRĘ - trasa ma zdegradować, a nie zrobić 404", async () => {
    funkcje().setError("get_mention_target", "odmowa wykonania funkcji", "42501");
    await expect(klient().fetchQuery(organizationQueryOptions(SLUG, "pl"))).rejects.toThrow(
      "odmowa wykonania funkcji",
    );
  });
});

describe("marka z kartoteki CRM", () => {
  beforeEach(() => {
    baza().setResponse("categories", ok(WIERSZ_TERMU));
  });

  it("pyta najpierw nazwą w języku strony", async () => {
    funkcje().setData("crm_company_brand", [MARKA]);
    await klient().fetchQuery(organizationQueryOptions("nato", "en"));
    expect(funkcje().lastCall("crm_company_brand")?.arg("p_name")).toBe(TERM.name_en);
  });

  it("po pudle próbuje drugiego wariantu nazwy - kartoteka trzyma JEDNĄ formę", async () => {
    funkcje().setResponse("crm_company_brand", (call) =>
      call.arg("p_name") === TERM.name_pl ? ok([MARKA]) : ok([]),
    );
    const wynik = await klient().fetchQuery(organizationQueryOptions("nato", "en"));
    expect(
      funkcje()
        .callsFor("crm_company_brand")
        .map((c) => c.arg("p_name")),
    ).toEqual([TERM.name_en, TERM.name_pl]);
    expect(wynik?.brand?.name).toBe("NATO");
  });

  it("brak trafienia to `null`, a nie błąd - kartoteka nie jest rejestrem organizacji", async () => {
    funkcje().setData("crm_company_brand", []);
    const wynik = await klient().fetchQuery(organizationQueryOptions("nato", "pl"));
    expect(wynik?.brand).toBeNull();
    expect(wynik?.term.slug).toBe("nato");
  });

  it("pusta odpowiedź kartoteki to pudło, a wiersz bez nazwy bierze nazwę z pytania", async () => {
    funkcje().setResponse("crm_company_brand", (call) =>
      call.arg("p_name") === TERM.name_pl ? ok(null) : ok([{ ...MARKA, name: "  " }]),
    );
    const wynik = await klient().fetchQuery(organizationQueryOptions("nato", "pl"));
    expect(wynik?.brand?.name).toBe(TERM.name_en);
    expect(wynik?.brand?.logoUrl).toBe(MARKA.logo_url);
  });

  it("AWARIA KARTOTEKI NIE WYWRACA PROFILU - marka jest dekoracją tożsamości", async () => {
    funkcje().setError("crm_company_brand", "odmowa wykonania funkcji", "42501");
    const wynik = await klient().fetchQuery(organizationQueryOptions("nato", "pl"));
    expect(wynik?.brand).toBeNull();
    expect(wynik?.term.name_pl).toBe(TERM.name_pl);
  });
});

describe("osoby organizacji", () => {
  it("dopasowuje ŚCIŚLE po wszystkich wariantach nazwy i twardo ogranicza wynik", async () => {
    baza().setResponse("profiles_public", ok([{ slug: "a-nowak", display_name: "Anna Nowak" }]));
    await klient().fetchQuery(organizationPeopleQueryOptions(["NATO", "Sojusz"]));
    const c = lancuch("profiles_public");
    // `in`, nie `ilike`: kolumna nie ma indeksu, a wzorzec to skan sekwencyjny
    // na każde wejście na stronę.
    expect(c.has("ilike")).toBe(false);
    expect(c.argsOf("in")?.[0]).toBe("current_company");
    expect(c.argsOf("in")?.[1]).toEqual(["NATO", "Sojusz"]);
    expect(c.argsOf("limit")?.[0]).toBe(ORGANIZATION_PEOPLE_LIMIT);
  });

  it("bez nazw zapytanie jest WYŁĄCZONE - sekcja nie pyta o nic", () => {
    expect(organizationPeopleQueryOptions([]).enabled).toBe(false);
    expect(organizationPeopleQueryOptions(["  "]).enabled).toBe(false);
    expect(organizationPeopleQueryOptions(["NATO"]).enabled).toBe(true);
  });

  it("klucz zapytania nie zależy od kolejności ani duplikatów nazw", () => {
    expect(organizationPeopleQueryOptions(["B", "A", "B"]).queryKey).toEqual(
      organizationPeopleQueryOptions(["A", "B"]).queryKey,
    );
  });

  it("pusta odpowiedź profili to pusta sekcja, nie błąd", async () => {
    baza().setResponse("profiles_public", ok(null));
    expect(await klient().fetchQuery(organizationPeopleQueryOptions(["NATO"]))).toEqual([]);
  });

  it("odmowa odczytu profili LECI W GÓRĘ, zamiast udawać zero osób", async () => {
    baza().setResponse("profiles_public", fail("odmowa odczytu profili", "42501"));
    await expect(klient().fetchQuery(organizationPeopleQueryOptions(["NATO"]))).rejects.toThrow(
      "odmowa odczytu profili",
    );
  });

  it("wiersz bez sluga wypada - nie ma z czego zbudować adresu profilu", async () => {
    baza().setResponse(
      "profiles_public",
      ok([
        { slug: null, display_name: "Duch" },
        { slug: "a-nowak", first_name: "Anna", last_name: "Nowak", verified_at: "2026-01-01" },
      ]),
    );
    const osoby = await klient().fetchQuery(organizationPeopleQueryOptions(["NATO"]));
    expect(osoby.map((o) => o.slug)).toEqual(["a-nowak"]);
    expect(osoby[0]).toMatchObject({ name: "Anna Nowak", verified: true });
  });
});

describe("czyste reguły wizytówki", () => {
  it("nazwa schodzi na drugi język, a potem na slug", () => {
    expect(organizationName(TERM, "en")).toBe(TERM.name_en);
    expect(organizationName({ ...TERM, name_en: "  " }, "en")).toBe(TERM.name_pl);
    expect(organizationName({ ...TERM, name_pl: "", name_en: "" }, "pl")).toBe("nato");
  });

  it("brak opisu to `null`, a nie pusty napis - element ma ZNIKNĄĆ", () => {
    // Pusty string wyrenderowałby pustą kartę „O organizacji" z nagłówkiem
    // i bez treści; `null` usuwa całą sekcję.
    expect(organizationDescription({ ...TERM, description_pl: null }, "pl")).toBeNull();
    expect(organizationDescription({ ...TERM, description_pl: "   " }, "pl")).toBeNull();
    // Opis w drugim języku jest lepszy niż brak opisu.
    expect(organizationDescription(TERM, "en")).toBe(TERM.description_pl);
  });

  it("warianty nazwy do dopasowania są deduplikowane i pozbawione pustych", () => {
    expect(organizationCompanyNames({ ...TERM, name_en: TERM.name_pl }, null)).toEqual([
      TERM.name_pl,
    ]);
    expect(
      organizationCompanyNames(TERM, { ...MARKA, logoUrl: null, website: null, branch: null }),
    ).toEqual([TERM.name_pl, TERM.name_en, "NATO"]);
  });

  it("stanowisko spada na specjalizację, a jego brak zostaje `null`", () => {
    expect(personFromProfileRow({ slug: "a", specialization: "Analityk" })?.jobTitle).toBe(
      "Analityk",
    );
    expect(personFromProfileRow({ slug: "a" })?.jobTitle).toBeNull();
    expect(personFromProfileRow({ display_name: "Bez sluga" })).toBeNull();
  });
});
