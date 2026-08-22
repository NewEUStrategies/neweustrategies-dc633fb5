// Sugestie linków wewnętrznych dla edytora SEO - CIAŁO handlera server fn
// `suggestInternalLinks` (`src/lib/seo/linkSuggestions.functions.ts`).
//
// 1) CO DOWODZI TEN PLIK:
//    * KONTRAKT WEJŚCIA (walidator zod): `postId` musi być uuid, `limit`
//      mieści się w 1..20 i domyślnie wynosi 8, tablice kategorii/tagów oraz
//      długości tytułu i treści mają górne granice - to jedyna bariera przed
//      zapytaniem `in (...)` z tysiącem identyfikatorów i przed wzorcem FTS
//      zbudowanym z całej książki;
//    * ODMOWĘ PRZED ZAPYTANIEM: brak tenanta w profilu kończy pracę pustą
//      listą i ZEREM dalszych zapytań (asercja na liczbie łańcuchów atrapy -
//      w tym cała różnica między „nic nie znalazłem" a „nie pytałem");
//    * PUNKTACJĘ i jej powody (kategoria +4, tag +3, treść +2), sumowanie
//      wpisu trafionego dwiema drogami, sortowanie malejąco po `score`
//      i obcięcie listy do `limit`;
//    * pomijanie sugestii DO SAMEGO SIEBIE na wszystkich trzech ścieżkach
//      (kategorie, tagi, FTS - trzy osobne `continue` w kodzie);
//    * TOKENIZACJĘ wzorca FTS: znaczniki HTML zdejmowane, tokeny krótsze niż
//      4 znaki pomijane, duplikaty scalane, najwyżej 12 tokenów, polskie
//      diakrytyki i cyfry zachowane, treść ucinana do 4000 znaków - oraz brak
//      zapytania FTS, gdy nie ma z czego zbudować wzorca;
//    * ZAKRES zapytań: `tenant_id` i `status = "published"` zapisane
//      w łańcuchu PostgREST. To jedyna warstwa, która chroni redakcję przed
//      zasugerowaniem cudzej albo nieopublikowanej treści, więc asercja stoi
//      na FILTRZE w łańcuchu, nie na danych zwróconych przez atrapę;
//    * DEGRADACJĘ przy błędzie zapytania (handler czyta wyłącznie `data`).
//
// 2) CZEGO ŚWIADOMIE NIE DUBLUJE:
//    * AUTORYZACJI. Atrapa `createServerFn` (`src/test/serverFn.ts`) NIE
//      wykonuje middleware - i tak ma zostać. Cała asercja o autoryzacji w tym
//      pliku to `serverFnMeta()`: funkcja DEKLARUJE `requireSupabaseAuth`
//      i metodę POST. Że brama panelu naprawdę trzyma na żywym SSR, dowodzi
//      e2e - test „/admin/seo is auth-gated (redirects to /auth or /login)"
//      z `e2e/seo.spec.ts`. Zieleń tego pliku wolno czytać tylko jako
//      „logika handlera jest poprawna", nigdy jako „obcy się nie dostanie".
//    * RLS ANI RPC - to pgTAP, ma własne pliki.
//    * TRAS FEEDÓW BAJTAMI. Pozostałe testy `e2e/seo.spec.ts` (sitemapindex,
//      shardy, rss.xml, robots.txt, llms.txt, kontrakt `<head>`) mierzą
//      publiczne wyjścia SSR; ta server fn jest narzędziem redakcyjnym
//      w panelu i nie ma z nimi wspólnej powierzchni.
//    * WARSTWY UI. `InternalLinkSuggestions.tsx` (etykiety powodów przez
//      klucze i18n, kopiowanie linku) tu nie występuje - plik zatrzymuje się
//      na kształcie danych oddawanych panelowi.
//
// UWAGA O IMPORCIE ATRAPY KLIENTA: `supabaseFromStub` bierzemy z kanonicznego
// `@/test/supabase`, a nie ze starszej kopii `src/test/supabaseChain.ts` -
// tamta lista ogniw nie zna `textSearch`, więc ścieżka FTS wywaliłaby się na
// `builder.textSearch is not a function`, a poprawianie wspólnego harnessu
// jest poza zakresem tego zadania.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";
import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabase";
import { suggestInternalLinks } from "@/lib/seo/linkSuggestions.functions";

// ---------------------------------------------------------------------------
// Dane. Wszystkie identyfikatory są poprawnymi uuid-ami, bo walidator wejścia
// odrzuca cokolwiek innego - test punktacji nie może potykać się o kształt id.
const USER_ID = "10000000-0000-4000-8000-000000000001";
const TENANT = "20000000-0000-4000-8000-000000000002";
const OTHER_TENANT = "20000000-0000-4000-8000-000000000099";
const SELF_ID = "30000000-0000-4000-8000-000000000003";
const CAT_A = "40000000-0000-4000-8000-00000000000a";
const CAT_B = "40000000-0000-4000-8000-00000000000b";
const TAG_A = "50000000-0000-4000-8000-00000000000a";
const POST_A = "aa000000-0000-4000-8000-00000000000a";
const POST_B = "bb000000-0000-4000-8000-00000000000b";
const POST_C = "cc000000-0000-4000-8000-00000000000c";

/** Wiersz `post_categories` - powiązanie wpisu z kategorią. */
const catRow = (postId: string, categoryId: string = CAT_A) => ({
  post_id: postId,
  category_id: categoryId,
});

/** Wiersz `post_tags` - powiązanie wpisu z tagiem. */
const tagRow = (postId: string, tagId: string = TAG_A) => ({ post_id: postId, tag_id: tagId });

/** Wiersz z zapytania FTS - handler czyta z niego tylko `id`. */
const ftsRow = (id: string) => ({ id });

/** Wiersz finalnego selecta - kształt, z którego powstaje sugestia. */
const postRow = (id: string, tenantId: string = TENANT) => ({
  id,
  slug: `wpis-${id.slice(0, 2)}`,
  title_pl: `Tytuł ${id.slice(0, 2)}`,
  title_en: null,
  excerpt_pl: null,
  status: "published",
  tenant_id: tenantId,
});

/** Lista poprawnych uuid-ów zadanej długości - do testów granic tablic. */
const uuidList = (count: number): string[] =>
  Array.from(
    { length: count },
    (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
  );

// ---------------------------------------------------------------------------
// Harness. Atrapa zapisuje łańcuch PostgREST, więc oprócz danych możemy
// asertować FILTRY - w tym module to nie ozdoba, a jedyny dowód izolacji.
let supa: SupabaseFromStub;
let plan: {
  profiles: SupabaseResult;
  categories: SupabaseResult;
  tags: SupabaseResult;
  fts: SupabaseResult;
  final: SupabaseResult;
};

beforeEach(() => {
  supa = supabaseFromStub();
  plan = {
    profiles: ok({ tenant_id: TENANT }),
    categories: ok([]),
    tags: ok([]),
    fts: ok([]),
    final: ok([]),
  };
  supa.setResponse("profiles", () => plan.profiles);
  supa.setResponse("post_categories", () => plan.categories);
  supa.setResponse("post_tags", () => plan.tags);
  // Do tabeli `posts` idą DWA różne zapytania: FTS (ma ogniwo `textSearch`)
  // i finalny select po identyfikatorach. Rozróżniamy je po ogniwie, a nie po
  // kolejności wywołań - kolejność zmieniłaby się przy każdej gałęzi wejścia.
  supa.setResponse("posts", (chain) => (chain.has("textSearch") ? plan.fts : plan.final));
  resetServerFnContext();
  setServerFnContext({ supabase: { from: supa.from }, userId: USER_ID });
});

/** Łańcuch zapytania FTS (jedyny z ogniwem `textSearch`). */
const ftsChain = (): RecordedChain | undefined =>
  supa.chainsFor("posts").find((chain) => chain.has("textSearch"));

/** Łańcuch finalnego selecta po identyfikatorach kandydatów. */
const finalChain = (): RecordedChain | undefined =>
  supa.chainsFor("posts").find((chain) => !chain.has("textSearch"));

/**
 * Wzorzec przekazany do `textSearch`. STRAŻNIK, nie rzutowanie: argumenty
 * zapisane przez atrapę są `unknown`, więc typ zawężamy warunkiem w runtime.
 */
function ftsPattern(): string | undefined {
  const value = ftsChain()?.argsOf("textSearch")?.[1];
  return typeof value === "string" ? value : undefined;
}

/** Tokeny wzorca FTS - wzorzec jest sklejany separatorem ` | `. */
function ftsTokens(): string[] {
  const pattern = ftsPattern();
  return pattern === undefined ? [] : pattern.split(" | ");
}

/** Czy łańcuch zawiera ogniwo o dokładnie takich argumentach skalarnych. */
function hasFilter(chain: RecordedChain | undefined, method: string, ...args: unknown[]): boolean {
  return (chain?.calls ?? []).some(
    (call) =>
      call.method === method &&
      call.args.length === args.length &&
      args.every((arg, i) => Object.is(arg, call.args[i])),
  );
}

/** Identyfikatory przekazane do `.in("id", [...])` finalnego selecta. */
function inIds(chain: RecordedChain | undefined): string[] {
  const args = chain?.argsOf("in");
  const value = args?.[1];
  if (args?.[0] !== "id" || !Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

// ---------------------------------------------------------------------------
describe("obudowa server fn - co atrapa dowodzi, a czego nie", () => {
  it("deklaruje middleware `requireSupabaseAuth` i metodę POST", () => {
    const meta = serverFnMeta(suggestInternalLinks);
    // Funkcja czyta CAŁY tenant po tytule i treści szkicu, więc nie może być
    // cachowalnym GET-em ani działać bez uwierzytelnienia. Atrapa middleware
    // nie uruchamia - to asercja o DEKLARACJI, nie o skuteczności bramki.
    expect(meta?.method).toBe("POST");
    expect(meta?.method).not.toBe("GET");
    expect(meta?.middleware).toContain(requireSupabaseAuth);
    expect(meta?.middleware).toHaveLength(1);
  });

  it("ma walidator - bez niego dowolny ładunek trafiłby wprost w zapytania", () => {
    expect(serverFnMeta(suggestInternalLinks)?.hasValidator).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("walidator wejścia", () => {
  it("odrzuca `postId`, który nie jest uuid", async () => {
    await expect(suggestInternalLinks({ data: { postId: "nie-uuid" } })).rejects.toThrow();
    // Odrzucenie następuje PRZED zapytaniem - baza nie widzi ładunku.
    expect(supa.chains).toHaveLength(0);
  });

  it("odrzuca `limit` poza zakresem 1..20", async () => {
    await expect(suggestInternalLinks({ data: { limit: 0 } })).rejects.toThrow();
    await expect(suggestInternalLinks({ data: { limit: 21 } })).rejects.toThrow();
    expect(supa.chains).toHaveLength(0);
  });

  it("przyjmuje skrajne dopuszczalne `limit` (1 i 20)", async () => {
    await expect(suggestInternalLinks({ data: { limit: 1 } })).resolves.toEqual([]);
    await expect(suggestInternalLinks({ data: { limit: 20 } })).resolves.toEqual([]);
  });

  it("pominięty `limit` to domyślka 8 - dziewiąty kandydat nie wchodzi", async () => {
    const ids = uuidList(9);
    plan.categories = ok(ids.map((id) => catRow(id)));
    plan.final = ok(ids.map((id) => postRow(id)));

    const result = await suggestInternalLinks({ data: { categoryIds: [CAT_A] } });

    expect(result).toHaveLength(8);
  });

  it("odrzuca listę kategorii dłuższą niż 50 i listę tagów dłuższą niż 200", async () => {
    // Bez tych granic pojedyncze żądanie z panelu budowałoby zapytanie
    // `in (...)` o dowolnym rozmiarze.
    await expect(suggestInternalLinks({ data: { categoryIds: uuidList(51) } })).rejects.toThrow();
    await expect(suggestInternalLinks({ data: { tagIds: uuidList(201) } })).rejects.toThrow();
    // Same granice są dopuszczalne.
    await expect(suggestInternalLinks({ data: { categoryIds: uuidList(50) } })).resolves.toEqual(
      [],
    );
    await expect(suggestInternalLinks({ data: { tagIds: uuidList(200) } })).resolves.toEqual([]);
  });

  it("odrzuca tytuł dłuższy niż 500 znaków i treść dłuższą niż 20000", async () => {
    await expect(suggestInternalLinks({ data: { titlePl: "a".repeat(501) } })).rejects.toThrow();
    await expect(
      suggestInternalLinks({ data: { contentPl: "a".repeat(20001) } }),
    ).rejects.toThrow();
    expect(supa.chains).toHaveLength(0);
  });

  it("przyjmuje jawne `null` w polach tekstowych - edytor wysyła puste pola jako null", async () => {
    await expect(
      suggestInternalLinks({
        data: { postId: null, titlePl: null, titleEn: null, contentPl: null, contentEn: null },
      }),
    ).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("brak tenanta - odmowa PRZED zapytaniem o cudze wpisy", () => {
  const brakTenanta: Array<[string, SupabaseResult]> = [
    ["brak wiersza profilu", ok(null)],
    ["wiersz bez pola `tenant_id`", ok({})],
    ["`tenant_id` ustawiony na null", ok({ tenant_id: null })],
  ];

  for (const [opis, response] of brakTenanta) {
    it(`${opis}: pusta lista i ZERO dalszych zapytań`, async () => {
      plan.profiles = response;

      const result = await suggestInternalLinks({
        data: { titlePl: "Komisja Europejska", categoryIds: [CAT_A], tagIds: [TAG_A] },
      });

      expect(result).toEqual([]);
      // Sens odmowy: bez tenanta nie da się ograniczyć zakresu, więc żadne
      // zapytanie o wpisy nie leci. Zapytanie „na wszelki wypadek" zwróciłoby
      // kandydatów spoza tenanta i dopiero potem ich odsiewało.
      expect(supa.chains).toHaveLength(1);
      expect(supa.chains[0]?.table).toBe("profiles");
    });
  }

  it("profil czytany jest po identyfikatorze użytkownika z kontekstu", async () => {
    await suggestInternalLinks({ data: {} });

    const chain = supa.lastChain("profiles");
    expect(hasFilter(chain, "eq", "id", USER_ID)).toBe(true);
    expect(chain?.has("maybeSingle")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("brak sugestii", () => {
  it("wszystkie zapytania puste: pusta lista i BRAK finalnego selecta", async () => {
    const result = await suggestInternalLinks({
      data: { titlePl: "Komisja Europejska", categoryIds: [CAT_A], tagIds: [TAG_A] },
    });

    expect(result).toEqual([]);
    // Gałąź `scores.size === 0` wychodzi PRZED zapytaniem o wpisy po id -
    // pusty `in ()` byłby zapytaniem bez sensu.
    expect(finalChain()).toBeUndefined();
    expect(supa.chains.map((chain) => chain.table)).toEqual([
      "profiles",
      "post_categories",
      "post_tags",
      "posts",
    ]);
  });

  it("puste tablice kategorii i tagów nie generują zapytań", async () => {
    await suggestInternalLinks({ data: { categoryIds: [], tagIds: [], titlePl: "abc" } });

    expect(supa.chainsFor("post_categories")).toHaveLength(0);
    expect(supa.chainsFor("post_tags")).toHaveLength(0);
    // „abc" nie daje tokenu (poniżej 4 znaków), więc FTS też nie leci.
    expect(supa.chains.map((chain) => chain.table)).toEqual(["profiles"]);
  });
});

// ---------------------------------------------------------------------------
describe("sugestia do samego siebie jest pomijana", () => {
  it("po wspólnej KATEGORII", async () => {
    plan.categories = ok([catRow(SELF_ID)]);
    plan.final = ok([postRow(SELF_ID)]);

    const result = await suggestInternalLinks({
      data: { postId: SELF_ID, categoryIds: [CAT_A] },
    });

    expect(result).toEqual([]);
    // Nie było kogo dopytywać, więc finalny select nie poszedł.
    expect(finalChain()).toBeUndefined();
  });

  it("po wspólnym TAGU", async () => {
    plan.tags = ok([tagRow(SELF_ID)]);
    plan.final = ok([postRow(SELF_ID)]);

    const result = await suggestInternalLinks({ data: { postId: SELF_ID, tagIds: [TAG_A] } });

    expect(result).toEqual([]);
    expect(finalChain()).toBeUndefined();
  });

  it("po trafieniu FTS w treści", async () => {
    plan.fts = ok([ftsRow(SELF_ID)]);
    plan.final = ok([postRow(SELF_ID)]);

    const result = await suggestInternalLinks({
      data: { postId: SELF_ID, titlePl: "Komisja Europejska" },
    });

    expect(result).toEqual([]);
    expect(finalChain()).toBeUndefined();
  });

  it("obok siebie zostaje realny kandydat - odsiew dotyczy tylko własnego wpisu", async () => {
    plan.categories = ok([catRow(SELF_ID), catRow(POST_A)]);
    plan.tags = ok([tagRow(SELF_ID)]);
    plan.fts = ok([ftsRow(SELF_ID)]);
    plan.final = ok([postRow(POST_A)]);

    const result = await suggestInternalLinks({
      data: {
        postId: SELF_ID,
        titlePl: "Komisja Europejska",
        categoryIds: [CAT_A],
        tagIds: [TAG_A],
      },
    });

    expect(result.map((row) => row.id)).toEqual([POST_A]);
    // Własny wpis nie trafił nawet do zapytania po identyfikatorach.
    expect(inIds(finalChain())).toEqual([POST_A]);
  });
});

// ---------------------------------------------------------------------------
describe("punktacja, powody, sortowanie i obcięcie", () => {
  /** Wejście, które uruchamia wszystkie trzy ścieżki punktowania. */
  const pelneWejscie = {
    titlePl: "Komisja Europejska",
    categoryIds: [CAT_A],
    tagIds: [TAG_A],
  };

  beforeEach(() => {
    plan.categories = ok([catRow(POST_A)]);
    plan.tags = ok([tagRow(POST_A), tagRow(POST_B)]);
    plan.fts = ok([ftsRow(POST_C)]);
    plan.final = ok([postRow(POST_A), postRow(POST_B), postRow(POST_C)]);
  });

  it("kategoria +4, tag +3, treść +2 - wpis trafiony dwoma drogami ma SUMĘ i OBA powody", async () => {
    const result = await suggestInternalLinks({ data: pelneWejscie });

    expect(result.map((row) => [row.id, row.score])).toEqual([
      [POST_A, 7],
      [POST_B, 3],
      [POST_C, 2],
    ]);
    // Oba powody, nie tylko mocniejszy - redakcja widzi, czym wpis się zbliżył.
    expect(result[0]?.reasons).toEqual(["category", "tag"]);
    expect(result[1]?.reasons).toEqual(["tag"]);
    expect(result[2]?.reasons).toEqual(["content"]);
  });

  it("`limit` obcina listę PO sortowaniu - najsłabszy kandydat wypada", async () => {
    const result = await suggestInternalLinks({ data: { ...pelneWejscie, limit: 2 } });

    expect(result.map((row) => row.id)).toEqual([POST_A, POST_B]);
  });

  it("kolejność wyniku bierze się z punktacji, nie z kolejności wierszy bazy", async () => {
    plan.final = ok([postRow(POST_C), postRow(POST_B), postRow(POST_A)]);

    const result = await suggestInternalLinks({ data: pelneWejscie });

    expect(result.map((row) => row.id)).toEqual([POST_A, POST_B, POST_C]);
  });

  it("dwie wspólne kategorie liczą się DWUKROTNIE, a powód pozostaje jeden", async () => {
    plan.categories = ok([catRow(POST_A, CAT_A), catRow(POST_A, CAT_B)]);
    plan.tags = ok([]);
    plan.fts = ok([]);
    plan.final = ok([postRow(POST_A)]);

    const result = await suggestInternalLinks({ data: { categoryIds: [CAT_A, CAT_B] } });

    expect(result[0]?.score).toBe(8);
    // Powody trzyma zbiór, więc powtórzone trafienie nie mnoży etykiety.
    expect(result[0]?.reasons).toEqual(["category"]);
  });

  it("wynik przenosi dokładnie pola potrzebne do wstawienia linku", async () => {
    plan.tags = ok([]);
    plan.fts = ok([]);
    plan.final = ok([
      {
        id: POST_A,
        slug: "analiza-budzetu",
        title_pl: "Analiza budżetu",
        title_en: "Budget analysis",
        excerpt_pl: "Lead analizy",
        status: "published",
        tenant_id: TENANT,
      },
    ]);

    const result = await suggestInternalLinks({ data: { categoryIds: [CAT_A] } });

    // `status` i `tenant_id` są czytane dla filtrów, ale do panelu nie wychodzą.
    expect(result).toEqual([
      {
        id: POST_A,
        slug: "analiza-budzetu",
        title_pl: "Analiza budżetu",
        title_en: "Budget analysis",
        excerpt_pl: "Lead analizy",
        score: 4,
        reasons: ["category"],
      },
    ]);
  });

  it("kandydat z punktami, którego finalny select NIE zwraca, nie trafia do wyniku", async () => {
    // POST_B ma punkty (wspólna kategoria), ale baza go nie oddaje - bo jest
    // szkicem albo należy do innego tenanta. Handler nie dokłada go „z pamięci".
    plan.categories = ok([catRow(POST_A), catRow(POST_B)]);
    plan.tags = ok([]);
    plan.fts = ok([]);
    plan.final = ok([postRow(POST_A)]);

    const result = await suggestInternalLinks({ data: { categoryIds: [CAT_A] } });

    expect(result.map((row) => row.id)).toEqual([POST_A]);
    // Oba identyfikatory poszły do zapytania - odsiew zrobiła baza filtrem.
    expect(inIds(finalChain())).toEqual([POST_A, POST_B]);
  });
});

// ---------------------------------------------------------------------------
describe("tokenizacja wzorca FTS", () => {
  it("zdejmuje znaczniki HTML razem z ich atrybutami", async () => {
    await suggestInternalLinks({
      data: { contentPl: '<p class="lead">Komisja</p><b>Europejska</b>' },
    });

    expect(ftsTokens()).toEqual(["komisja", "europejska"]);
    // Nazwa klasy z atrybutu nie może stać się słowem kluczowym zapytania.
    expect(ftsTokens()).not.toContain("class");
    expect(ftsTokens()).not.toContain("lead");
  });

  it("pomija tokeny krótsze niż 4 znaki", async () => {
    await suggestInternalLinks({ data: { titlePl: "Rada UE ma nowy plan" } });

    expect(ftsTokens()).toEqual(["rada", "nowy", "plan"]);
  });

  it("scala duplikaty i zbiera tokeny ze wszystkich czterech pól", async () => {
    await suggestInternalLinks({
      data: {
        titlePl: "Komisja Komisja",
        titleEn: "KOMISJA commission",
        contentPl: "komisja",
        contentEn: "budget",
      },
    });

    expect(ftsTokens()).toEqual(["komisja", "commission", "budget"]);
  });

  it("bierze najwyżej 12 tokenów", async () => {
    const slowa = Array.from({ length: 15 }, (_, i) => `slowo${String(i).padStart(2, "0")}`);

    await suggestInternalLinks({ data: { contentPl: slowa.join(" ") } });

    expect(ftsTokens()).toHaveLength(12);
    expect(ftsTokens()).toEqual(slowa.slice(0, 12));
  });

  it("zachowuje polskie diakrytyki i cyfry", async () => {
    // Zgubione diakrytyki dawałyby wzorzec, który nie trafia w polską treść,
    // a odrzucone cyfry wykluczyłyby roczniki („budżet 2027").
    await suggestInternalLinks({ data: { titlePl: "Wysłuchanie 2027 wpłynęło" } });

    expect(ftsTokens()).toEqual(["wysłuchanie", "2027", "wpłynęło"]);
  });

  it("treść dłuższa niż 4000 znaków jest ucinana PRZED tokenizacją", async () => {
    const wypelniacz = "aaaa ".repeat(800); // dokładnie 4000 znaków
    await suggestInternalLinks({
      data: { contentPl: `${wypelniacz}pierwszyznacznik`, contentEn: `${wypelniacz}drugiznacznik` },
    });

    expect(ftsTokens()).toEqual(["aaaa"]);
    expect(ftsPattern()).not.toContain("pierwszyznacznik");
    expect(ftsPattern()).not.toContain("drugiznacznik");
  });

  const bezTokenow: Array<[string, Record<string, string | null>]> = [
    [
      "jawne null we wszystkich polach",
      { titlePl: null, titleEn: null, contentPl: null, contentEn: null },
    ],
    ["pola pominięte", {}],
    ["puste napisy", { titlePl: "", titleEn: "", contentPl: "", contentEn: "" }],
    ["same krótkie słowa", { titlePl: "UE ma", contentPl: "<i>ok</i>" }],
  ];

  for (const [opis, data] of bezTokenow) {
    it(`${opis}: nie ma z czego zbudować wzorca, więc zapytanie FTS nie leci`, async () => {
      await suggestInternalLinks({ data });

      expect(ftsChain()).toBeUndefined();
      expect(supa.chainsFor("posts")).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
describe("zakres zapytań - tenant i status w łańcuchu PostgREST", () => {
  it("zapytanie FTS filtruje po tenancie i statusie, łączy tokeny ` | ` i tnie do 40 wierszy", async () => {
    plan.fts = ok([ftsRow(POST_A)]);
    plan.final = ok([postRow(POST_A)]);

    await suggestInternalLinks({ data: { titlePl: "Komisja Europejska" } });

    const chain = ftsChain();
    expect(hasFilter(chain, "eq", "tenant_id", TENANT)).toBe(true);
    expect(hasFilter(chain, "eq", "status", "published")).toBe(true);
    expect(hasFilter(chain, "limit", 40)).toBe(true);
    expect(chain?.argsOf("textSearch")?.[0]).toBe("fts");
    expect(ftsPattern()).toBe("komisja | europejska");
    expect(chain?.argsOf("textSearch")?.[2]).toEqual({ type: "websearch", config: "simple" });
  });

  it("finalny select filtruje po tenancie i statusie oraz po zebranych identyfikatorach", async () => {
    plan.categories = ok([catRow(POST_A)]);
    plan.final = ok([postRow(POST_A)]);

    await suggestInternalLinks({ data: { categoryIds: [CAT_A] } });

    const chain = finalChain();
    expect(inIds(chain)).toEqual([POST_A]);
    expect(hasFilter(chain, "eq", "tenant_id", TENANT)).toBe(true);
    expect(hasFilter(chain, "eq", "status", "published")).toBe(true);
  });

  it("zapytania o kategorie i tagi filtrują TYLKO po podanych identyfikatorach", async () => {
    plan.categories = ok([]);
    plan.tags = ok([]);

    await suggestInternalLinks({ data: { categoryIds: [CAT_A], tagIds: [TAG_A] } });

    expect(supa.lastChain("post_categories")?.argsOf("in")).toEqual(["category_id", [CAT_A]]);
    expect(supa.lastChain("post_tags")?.argsOf("in")).toEqual(["tag_id", [TAG_A]]);
    // ZMIERZONE: te dwa zapytania NIE mają filtru tenanta - powiązania mogą
    // wskazać wpis z obcego tenanta. Odsiew robi dopiero finalny select, więc
    // to on jest jedynym miejscem, w którym izolacja musi być bezwarunkowa.
    expect(supa.lastChain("post_categories")?.has("eq")).toBe(false);
    expect(supa.lastChain("post_tags")?.has("eq")).toBe(false);
  });

  it("wiersz z OBCEGO tenanta w odpowiedzi bazy przechodzi - gwarancję niesie filtr, nie post-filtrowanie", async () => {
    plan.categories = ok([catRow(POST_A)]);
    plan.final = ok([postRow(POST_A, OTHER_TENANT)]);

    const result = await suggestInternalLinks({ data: { categoryIds: [CAT_A] } });

    // ZMIERZONE: handler nie porównuje `tenant_id` wiersza po odczycie - i nie
    // musi, bo PostgREST z takim filtrem takiego wiersza nie zwróci. Dowodem
    // izolacji jest więc OBECNOŚĆ filtru w łańcuchu, dlatego asercja stoi na
    // łańcuchu; gdyby ktoś usunął `.eq("tenant_id", ...)`, upadnie ona, a nie
    // asercja na danych.
    expect(result.map((row) => row.id)).toEqual([POST_A]);
    expect(hasFilter(finalChain(), "eq", "tenant_id", TENANT)).toBe(true);
    expect(hasFilter(finalChain(), "eq", "status", "published")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("degradacja przy błędzie zapytania", () => {
  it("błąd zapytania o profil: pusta lista i żadnego dalszego zapytania", async () => {
    plan.profiles = fail("profiles down");

    await expect(suggestInternalLinks({ data: { categoryIds: [CAT_A] } })).resolves.toEqual([]);
    expect(supa.chains).toHaveLength(1);
  });

  it("błąd zapytania o kategorie: punkty za kategorię przepadają, tagi liczą się dalej", async () => {
    plan.categories = fail("post_categories down");
    plan.tags = ok([tagRow(POST_A)]);
    plan.final = ok([postRow(POST_A)]);

    const result = await suggestInternalLinks({
      data: { categoryIds: [CAT_A], tagIds: [TAG_A] },
    });

    expect(result.map((row) => [row.id, row.score])).toEqual([[POST_A, 3]]);
    expect(result[0]?.reasons).toEqual(["tag"]);
  });

  it("błąd zapytania o tagi: punkty za tag przepadają, kategoria liczy się dalej", async () => {
    plan.categories = ok([catRow(POST_A)]);
    plan.tags = fail("post_tags down");
    plan.final = ok([postRow(POST_A)]);

    const result = await suggestInternalLinks({
      data: { categoryIds: [CAT_A], tagIds: [TAG_A] },
    });

    expect(result.map((row) => [row.id, row.score])).toEqual([[POST_A, 4]]);
    expect(result[0]?.reasons).toEqual(["category"]);
  });

  it("błąd zapytania FTS: punkty za treść przepadają", async () => {
    plan.categories = ok([catRow(POST_A)]);
    plan.fts = fail("fts down");
    plan.final = ok([postRow(POST_A)]);

    const result = await suggestInternalLinks({
      data: { titlePl: "Komisja Europejska", categoryIds: [CAT_A] },
    });

    expect(result.map((row) => [row.id, row.score])).toEqual([[POST_A, 4]]);
    expect(result[0]?.reasons).toEqual(["category"]);
  });

  it("błąd FINALNEGO selecta: pusta lista, mimo policzonych kandydatów", async () => {
    plan.categories = ok([catRow(POST_A)]);
    plan.final = fail("posts down");

    const result = await suggestInternalLinks({ data: { categoryIds: [CAT_A] } });

    expect(result).toEqual([]);
    // Kandydat BYŁ policzony - zapytanie poszło, dopiero odczyt padł.
    expect(inIds(finalChain())).toEqual([POST_A]);
  });

  // DEFEKT: handler czyta z każdej odpowiedzi wyłącznie `data` i ANI RAZU nie
  // zagląda w `error`. Awaria bazy (albo cofnięty grant) daje więc dokładnie
  // ten sam wynik, co poprawne zapytanie bez dopasowań: pustą listę.
  // KONSEKWENCJA: redakcja widzi „brak dopasowań" zamiast błędu i nie wie, że
  // narzędzie nie działa - autor przestaje linkować wewnętrznie, bo „nie ma do
  // czego", a przyczyna (padnięty FTS, odebrany grant) nie zostawia śladu ani
  // w panelu, ani w odpowiedzi server fn.
  it.fails("DEFEKT: awaria zapytania jest NIEROZRÓŻNIALNA od braku dopasowań", async () => {
    plan.categories = fail("post_categories down");
    const awaria = await suggestInternalLinks({ data: { categoryIds: [CAT_A] } });

    plan.categories = ok([]);
    const brakDopasowan = await suggestInternalLinks({ data: { categoryIds: [CAT_A] } });

    expect(awaria).not.toEqual(brakDopasowan);
  });
});
