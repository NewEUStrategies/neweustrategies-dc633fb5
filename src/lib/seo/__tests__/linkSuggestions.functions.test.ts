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
//      4 znaki pomijane, duplikaty scalane, najwyżej 12 tokenów, diakrytyki
//      zdejmowane jak `unaccent` w wektorze (z `ł` → `l`), cyfry zachowane,
//      treść ucinana do 4000 znaków - oraz brak zapytania FTS, gdy nie ma
//      z czego zbudować wzorca;
//    * KONTRAKT KOLUMNY FTS ZE SCHEMATEM: `textSearch` celuje w `FTS_COLUMN`,
//      a ta nazwa jest kolumną tsvector `posts` w wygenerowanych typach
//      i w migracji; wzorzec to surowe `to_tsquery` z OR (` | `), nie
//      `websearch` (tam `|` to interpunkcja i powstaje AND wszystkich słów);
//    * LIMIT KANDYDATÓW w finalnym `.in("id", ids)` - do selecta idzie
//      najwyżej `MAX_FINAL_CANDIDATES` najlepiej punktowanych (bez tego
//      popularna kategoria dawała 414 na bramie);
//    * ZAKRES zapytań: `tenant_id` i `status = "published"` zapisane
//      w łańcuchu PostgREST. To jedyna warstwa, która chroni redakcję przed
//      zasugerowaniem cudzej albo nieopublikowanej treści, więc asercja stoi
//      na FILTRZE w łańcuchu, nie na danych zwróconych przez atrapę;
//    * JAWNOŚĆ AWARII: błąd KAŻDEGO z pięciu zapytań (profil, kategorie, tagi,
//      FTS, finalny select) kończy się wyjątkiem `LinkSuggestionsQueryError`
//      z etapem w treści i wpisem w log serwera bez danych osobowych - a nie
//      pustą listą, której nie da się odróżnić od braku dopasowań;
//    * RÓWNOLEGŁOŚĆ trzech źródeł kandydatów (kategorie, tagi, FTS) - jedna
//      runda do bazy zamiast trzech kolejnych.
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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  FTS_COLUMN,
  LINK_SUGGESTIONS_QUERY_FAILED,
  LinkSuggestionsQueryError,
  MAX_FINAL_CANDIDATES,
  suggestInternalLinks,
} from "@/lib/seo/linkSuggestions.functions";

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

  it("zdejmuje polskie diakrytyki jak `unaccent` w wektorze i zachowuje cyfry", async () => {
    // `posts.search_vector` to `to_tsvector('simple', unaccent(...))` - w bazie
    // jest leksem `wysluchanie`, a nie `wysłuchanie`. Token z diakrytykami nie
    // trafiłby w ŻADEN wpis. Odrzucone cyfry wykluczyłyby roczniki („budżet 2027").
    await suggestInternalLinks({ data: { titlePl: "Wysłuchanie 2027 wpłynęło" } });

    expect(ftsTokens()).toEqual(["wysluchanie", "2027", "wplynelo"]);
  });

  it("`ł` i wielkie litery z diakrytykami sprowadza do bazy - NFD sam `ł` nie rozkłada", async () => {
    await suggestInternalLinks({ data: { titlePl: "ŁÓDŹ ŁADZIE źródło Żółć" } });

    expect(ftsTokens()).toEqual(["lodz", "ladzie", "zrodlo", "zolc"]);
  });

  it("samodzielne `^` i `` ` `` dalej rozdzielają słowa - zdejmowane są tylko znaki łączące", async () => {
    await suggestInternalLinks({ data: { titlePl: "komisja^europejska`reforma" } });

    expect(ftsTokens()).toEqual(["komisja", "europejska", "reforma"]);
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
    expect(chain?.argsOf("textSearch")?.[0]).toBe(FTS_COLUMN);
    expect(ftsPattern()).toBe("komisja | europejska");
  });

  it("FTS celuje w `search_vector` - kolumny `posts.fts` NIE MA (42703 przy każdym wywołaniu)", async () => {
    await suggestInternalLinks({ data: { titlePl: "Komisja Europejska" } });

    expect(FTS_COLUMN).toBe("search_vector");
    expect(ftsChain()?.argsOf("textSearch")?.[0]).toBe("search_vector");
    expect(ftsChain()?.argsOf("textSearch")?.[0]).not.toBe("fts");
  });

  it("wzorzec to surowe `to_tsquery` z OR - BEZ `type: websearch`, który z ` | ` robi AND", async () => {
    // postgrest-js: brak `type` → operator `fts(simple)` = `to_tsquery`, gdzie
    // `|` to OR i wystarczy JEDEN wspólny token. `type: "websearch"` →
    // `wfts`, a `websearch_to_tsquery` traktuje `|` jak interpunkcję: wpis
    // musiałby zawierać WSZYSTKIE 12 tokenów z tytułu i treści.
    await suggestInternalLinks({ data: { titlePl: "Komisja Europejska reforma" } });

    const options = ftsChain()?.argsOf("textSearch")?.[2];
    expect(options).toEqual({ config: "simple" });
    expect(options).not.toHaveProperty("type");
    expect(ftsPattern()).toBe("komisja | europejska | reforma");
    // Każdy token to wyłącznie litery/cyfry - żaden nie wnosi składni tsquery
    // (`&`, `!`, `:`, `(`), więc operator między nimi jest jedynym operatorem.
    for (const token of ftsTokens()) expect(token).toMatch(/^[\p{L}\p{N}]+$/u);
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
describe("kontrakt kolumny FTS ze schematem bazy", () => {
  // Atrapa rozpoznaje zapytanie FTS po ogniwie `textSearch` i przyjmie KAŻDĄ
  // nazwę kolumny - tak przez długi czas przechodziło `posts.fts`, którego
  // w schemacie nie ma. `satisfies keyof PostsRow` w kodzie łapie to w tsc;
  // ten blok łapie to w samym vitest, czytając typy i migrację.
  const ROOT = process.cwd();
  const typesSrc = readFileSync(join(ROOT, "src/integrations/supabase/types.ts"), "utf8");
  const migrationSrc = readFileSync(
    join(ROOT, "supabase/migrations/20260628210000_fulltext_search.sql"),
    "utf8",
  );

  /** Ciało `posts: { Row: { ... } }` z wygenerowanych typów. */
  function postsRowBlock(): string {
    const start = typesSrc.indexOf("      posts: {\n        Row: {");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = typesSrc.indexOf("\n        }", start);
    return typesSrc.slice(start, end);
  }

  it("`FTS_COLUMN` jest kolumną wiersza `posts` w wygenerowanych typach (tsvector → `unknown`)", () => {
    const row = postsRowBlock();

    expect(row).toMatch(new RegExp(`\\n\\s+${FTS_COLUMN}: unknown\\n`));
    // Kolumny `fts` w `posts` nie ma - to ona dawała 42703 na produkcji.
    expect(row).not.toMatch(/\n\s+fts\??: /);
  });

  it("migracja dodaje `posts.search_vector tsvector` z indeksem GIN", () => {
    expect(migrationSrc).toContain(
      `ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS ${FTS_COLUMN} tsvector;`,
    );
    expect(migrationSrc).toMatch(new RegExp(`ON public\\.posts USING gin \\(${FTS_COLUMN}\\)`));
  });

  it("wektor powstaje z `to_tsvector('simple', unaccent(...))` - stąd `config: simple` i tokeny bez diakrytyków", () => {
    const fn = migrationSrc.slice(
      migrationSrc.indexOf("FUNCTION public.nes_posts_search_vector("),
      migrationSrc.indexOf("FUNCTION public.nes_pages_search_vector("),
    );

    expect(fn).toContain("to_tsvector('simple', unaccent(");
    // Żadna inna konfiguracja (np. `polish`, `english`) - inaczej `config:
    // "simple"` w zapytaniu i ręczne zdejmowanie diakrytyków by się rozjechały.
    expect(fn).not.toMatch(/to_tsvector\('(?!simple')/);
  });
});

// ---------------------------------------------------------------------------
describe("limit kandydatów w finalnym selekcie", () => {
  // Powiązania kategorii/tagów nie mają limitu, a każdy uuid to ~37 znaków
  // w URL GET `.in("id", ...)`. Kilkaset wpisów w popularnej kategorii dawało
  // 414 na bramie - po rundzie 1 trwały błąd etapu `posts`, którego przycisk
  // „Spróbuj ponownie" z definicji nie naprawi.
  const kandydaci = (count: number, prefix: string): string[] =>
    Array.from(
      { length: count },
      (_, i) => `${prefix}${String(i).padStart(6, "0")}-0000-4000-8000-000000000000`,
    );

  it("ponad `MAX_FINAL_CANDIDATES` kandydatów: do selecta idzie dokładnie limit, najlepiej punktowani PIERWSI", async () => {
    const tylkoKategoria = kandydaci(150, "a1");
    const kategoriaITag = kandydaci(30, "b2");
    plan.categories = ok([...tylkoKategoria, ...kategoriaITag].map((id) => catRow(id)));
    plan.tags = ok(kategoriaITag.map((id) => tagRow(id)));

    await suggestInternalLinks({ data: { categoryIds: [CAT_A], tagIds: [TAG_A] } });

    const ids = inIds(finalChain());
    expect(MAX_FINAL_CANDIDATES).toBe(100);
    expect(ids).toHaveLength(MAX_FINAL_CANDIDATES);
    // Wpisy z kategorią I tagiem (7 pkt) wyprzedzają same kategorie (4 pkt),
    // choć w odpowiedzi bazy przyszły na końcu.
    expect(ids.slice(0, 30)).toEqual(kategoriaITag);
    // Przy remisie decyduje kolejność źródła (sortowanie stabilne).
    expect(ids.slice(30)).toEqual(tylkoKategoria.slice(0, MAX_FINAL_CANDIDATES - 30));
  });

  it("dokładnie `MAX_FINAL_CANDIDATES` kandydatów: wszyscy idą do selecta, nikt nie odpada", async () => {
    const wszyscy = kandydaci(MAX_FINAL_CANDIDATES, "c3");
    plan.categories = ok(wszyscy.map((id) => catRow(id)));

    await suggestInternalLinks({ data: { categoryIds: [CAT_A] } });

    expect(inIds(finalChain())).toEqual(wszyscy);
  });

  it("obcięcie nie zmienia wyniku - najlepszy kandydat spoza pierwszej setki w kolejności bazy i tak wygrywa", async () => {
    const tlo = kandydaci(140, "d4");
    const najlepszy = "ee000000-0000-4000-8000-0000000000ee";
    plan.categories = ok([...tlo, najlepszy].map((id) => catRow(id)));
    plan.tags = ok([tagRow(najlepszy)]);
    plan.fts = ok([ftsRow(najlepszy)]);
    plan.final = ok([postRow(najlepszy), postRow(tlo[0]!)]);

    const result = await suggestInternalLinks({
      data: { titlePl: "Komisja Europejska", categoryIds: [CAT_A], tagIds: [TAG_A], limit: 1 },
    });

    expect(inIds(finalChain())[0]).toBe(najlepszy);
    expect(result.map((row) => [row.id, row.score])).toEqual([[najlepszy, 9]]);
  });
});

// ---------------------------------------------------------------------------
describe("równoległe źródła kandydatów", () => {
  it("kategorie, tagi i FTS lecą RAZEM - żadne nie czeka na odpowiedź poprzedniego", async () => {
    // Odpowiedź o kategorie wstrzymana bramką. Przy zapytaniach kolejnych
    // łańcuchy tagów i FTS nie powstałyby, dopóki kategorie nie wrócą.
    let otworz: () => void = () => {};
    const bramka = new Promise<void>((resolve) => {
      otworz = resolve;
    });
    plan.categories = ok([catRow(POST_A)]);
    plan.tags = ok([tagRow(POST_B)]);
    plan.fts = ok([ftsRow(POST_C)]);
    plan.final = ok([postRow(POST_A), postRow(POST_B), postRow(POST_C)]);
    supa.setResponse("post_categories", async () => {
      await bramka;
      return plan.categories;
    });

    const wynik = suggestInternalLinks({
      data: { titlePl: "Komisja Europejska", categoryIds: [CAT_A], tagIds: [TAG_A] },
    });

    await vi.waitFor(() => expect(supa.chainsFor("post_tags")).toHaveLength(1));
    expect(ftsChain()).toBeDefined();
    // Finalny select czeka na WSZYSTKIE trzy źródła - potrzebuje pełnej punktacji.
    expect(finalChain()).toBeUndefined();

    otworz();
    const result = await wynik;

    expect(result.map((row) => [row.id, row.score])).toEqual([
      [POST_A, 4],
      [POST_B, 3],
      [POST_C, 2],
    ]);
  });

  it("profil idzie PRZED źródłami kandydatów - bez tenanta żadne z nich nie startuje", async () => {
    // Równoległość nie obejmuje profilu: tenant jest filtrem zapytania FTS,
    // a jego brak ma kończyć pracę zerem dalszych zapytań.
    plan.categories = ok([catRow(POST_A)]);
    plan.final = ok([postRow(POST_A)]);

    await suggestInternalLinks({ data: { titlePl: "Komisja Europejska", categoryIds: [CAT_A] } });

    expect(supa.chains[0]?.table).toBe("profiles");
    expect(supa.chains.map((chain) => chain.table)).toEqual([
      "profiles",
      "post_categories",
      "posts",
      "posts",
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("awaria zapytania jest jawna - wyjątek i log, nie pusta lista", () => {
  // KONSEKWENCJA, której pilnuje ten blok: gdyby awaria bazy (albo cofnięty
  // grant) dawała ten sam wynik, co poprawne zapytanie bez dopasowań, redakcja
  // widziałaby „brak dopasowań" zamiast błędu i nie wiedziała, że narzędzie
  // nie działa - autor przestaje linkować wewnętrznie, bo „nie ma do czego",
  // a przyczyna (padnięty FTS, odebrany grant) nie zostawia śladu ani
  // w panelu, ani w logu serwera.
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  /** Wyjątek z wywołania - test asertuje KLASĘ, etap i treść, nie samo „rzuciło". */
  async function bladWywolania(data: Record<string, unknown>): Promise<unknown> {
    try {
      await suggestInternalLinks({ data });
    } catch (error) {
      return error;
    }
    throw new Error("test: oczekiwano wyjątku, wywołanie się rozwiązało");
  }

  it("błąd zapytania o profil: wyjątek etapu `profile` i ŻADNEGO dalszego zapytania", async () => {
    plan.profiles = fail("profiles down");

    const error = await bladWywolania({ categoryIds: [CAT_A] });

    expect(error).toBeInstanceOf(LinkSuggestionsQueryError);
    expect((error as LinkSuggestionsQueryError).stage).toBe("profile");
    expect(supa.chains).toHaveLength(1);
  });

  const zrodla: Array<{
    etap: "categories" | "tags" | "fts";
    psuj: () => void;
  }> = [
    { etap: "categories", psuj: () => (plan.categories = fail("post_categories down")) },
    { etap: "tags", psuj: () => (plan.tags = fail("post_tags down")) },
    { etap: "fts", psuj: () => (plan.fts = fail("fts down")) },
  ];

  for (const { etap, psuj } of zrodla) {
    it(`błąd źródła \`${etap}\`: wyjątek tego etapu, BEZ częściowego wyniku i bez finalnego selecta`, async () => {
      // Pozostałe źródła mają trafienia - przed poprawką handler oddawał je
      // jako wynik z cicho zaniżoną punktacją. Teraz punktacja bez jednego
      // źródła nie wychodzi wcale.
      plan.categories = ok([catRow(POST_A)]);
      plan.tags = ok([tagRow(POST_A)]);
      plan.fts = ok([ftsRow(POST_A)]);
      plan.final = ok([postRow(POST_A)]);
      psuj();

      const error = await bladWywolania({
        titlePl: "Komisja Europejska",
        categoryIds: [CAT_A],
        tagIds: [TAG_A],
      });

      expect(error).toBeInstanceOf(LinkSuggestionsQueryError);
      expect((error as LinkSuggestionsQueryError).stage).toBe(etap);
      expect(finalChain()).toBeUndefined();
    });
  }

  it("dwa źródła padają naraz: etap w wyjątku jest deterministyczny (pierwszy w kolejności)", async () => {
    plan.tags = fail("post_tags down");
    plan.fts = fail("fts down");

    const error = await bladWywolania({ titlePl: "Komisja Europejska", tagIds: [TAG_A] });

    expect((error as LinkSuggestionsQueryError).stage).toBe("tags");
  });

  it("błąd FINALNEGO selecta: wyjątek etapu `posts`, choć kandydaci byli policzeni", async () => {
    // Spójnie z resztą: późny odczyt, który pada, to też awaria, a nie
    // „brak dopasowań". Przed poprawką ten przypadek kończył się pustą listą.
    plan.categories = ok([catRow(POST_A)]);
    plan.final = fail("posts down");

    const error = await bladWywolania({ categoryIds: [CAT_A] });

    expect(error).toBeInstanceOf(LinkSuggestionsQueryError);
    expect((error as LinkSuggestionsQueryError).stage).toBe("posts");
    // Kandydat BYŁ policzony - zapytanie poszło, dopiero odczyt padł.
    expect(inIds(finalChain())).toEqual([POST_A]);
  });

  it("STRAŻNIK: awaria zapytania jest ROZRÓŻNIALNA od braku dopasowań", async () => {
    plan.categories = fail("post_categories down");
    const awaria = suggestInternalLinks({ data: { categoryIds: [CAT_A] } });

    await expect(awaria).rejects.toThrow(LinkSuggestionsQueryError);

    plan.categories = ok([]);
    const brakDopasowan = await suggestInternalLinks({ data: { categoryIds: [CAT_A] } });

    expect(brakDopasowan).toEqual([]);
  });

  it("treść wyjątku to kod i etap - komunikat bazy NIE wychodzi do przeglądarki", async () => {
    plan.categories = fail("permission denied for table post_categories", "42501");

    const error = await bladWywolania({ categoryIds: [CAT_A] });

    expect((error as Error).message).toBe(`${LINK_SUGGESTIONS_QUERY_FAILED}: categories`);
    expect((error as Error).message).not.toContain("permission denied");
    expect((error as LinkSuggestionsQueryError).code).toBe(LINK_SUGGESTIONS_QUERY_FAILED);
  });

  it("awaria zostawia ślad w logu serwera: etap, kod i komunikat PostgREST", async () => {
    plan.fts = fail("canceling statement due to statement timeout", "57014");

    await bladWywolania({ titlePl: "Komisja Europejska" });

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("[linkSuggestions] query failed", {
      stage: "fts",
      code: "57014",
      message: "canceling statement due to statement timeout",
    });
  });

  it("log nie niesie danych osobowych ani treści szkicu", async () => {
    plan.fts = fail("fts down");

    await bladWywolania({ postId: SELF_ID, titlePl: "Komisja Europejska", tagIds: [TAG_A] });

    const zalogowane = JSON.stringify(consoleError.mock.calls);
    expect(zalogowane).not.toContain(USER_ID);
    expect(zalogowane).not.toContain(TENANT);
    expect(zalogowane).not.toContain(SELF_ID);
    expect(zalogowane.toLowerCase()).not.toContain("komisja");
  });

  it("brak kodu w błędzie PostgREST loguje `code: null`, a nie gubi wpisu", async () => {
    plan.final = fail("posts down");
    plan.categories = ok([catRow(POST_A)]);

    await bladWywolania({ categoryIds: [CAT_A] });

    expect(consoleError).toHaveBeenCalledWith("[linkSuggestions] query failed", {
      stage: "posts",
      code: null,
      message: "posts down",
    });
  });

  // Negatywy - poprawka nie może zamienić w błąd tego, co błędem nie jest.
  it("zapytania bez błędu i bez wierszy: pusta lista, BEZ wyjątku i BEZ wpisu w logu", async () => {
    await expect(
      suggestInternalLinks({
        data: { titlePl: "Komisja Europejska", categoryIds: [CAT_A], tagIds: [TAG_A] },
      }),
    ).resolves.toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("`data: null` bez `error` w źródle kandydatów to brak trafień, nie awaria", async () => {
    plan.categories = ok(null);
    plan.tags = ok([tagRow(POST_A)]);
    plan.final = ok([postRow(POST_A)]);

    const result = await suggestInternalLinks({ data: { categoryIds: [CAT_A], tagIds: [TAG_A] } });

    expect(result.map((row) => [row.id, row.score])).toEqual([[POST_A, 3]]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("profil bez tenanta pozostaje ODMOWĄ (pusta lista), nie awarią", async () => {
    plan.profiles = ok({ tenant_id: null });

    await expect(suggestInternalLinks({ data: { categoryIds: [CAT_A] } })).resolves.toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
