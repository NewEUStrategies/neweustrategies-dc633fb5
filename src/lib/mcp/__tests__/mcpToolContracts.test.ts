// SCHEMATY WEJŚCIA I DEKLARACJE TRZECH NARZĘDZI /mcp.
//
// PO CO TEN PLIK ISTNIEJE OSOBNO OD `mcpTools.test.ts`. Handler i schemat to
// DWIE różne warstwy i tylko jedna z nich wykonuje się w teście handlera.
// `defineTool` jest funkcją tożsamościową (sprawdzone w `dist/index.js`), więc
// `inputSchema` NIE jest stosowany przy wywołaniu `tool.handler(...)` - domyślne
// wartości i zaciski nakłada SDK, ZANIM wejdzie w handler. Test handlera podaje
// argumenty wprost, więc nie dowodzi NICZEGO o `lang` domyślnym ani o granicach
// `limit`. Ten plik zamyka tę drugą połowę: schematy są tu sprawdzane
// BEZPOŚREDNIO, przez `z.object(inputSchema).safeParse(...)`.
//
// CO JEST PRZEDMIOTEM DOWODU:
//   1. `lang` domyślnie `"pl"` i wyłącznie `"pl" | "en"` - to schemat decyduje,
//      w jakim języku publiczne API oddaje treść wołającemu, który języka nie
//      podał,
//   2. `limit` - domyślnie 10, całkowity, minimum 1, maksimum 50. Górna
//      granica jest OCHRONĄ BAZY: to publiczny endpoint, więc `limit: 100000`
//      od wołającego byłby darmowym skanem tabeli,
//   3. ZACISK ODRZUCA, A NIE PRZYCINA. `z.number().min(1).max(50)` NIE zmienia
//      51 na 50 - odrzuca całe wejście. To rozróżnienie jest kontraktem
//      widocznym dla klienta MCP (dostaje błąd walidacji, nie okrojoną listę),
//      więc jest tu asertowane wprost,
//   4. `slug` i `query` są obcinane ze spacji i nie mogą być puste - wejście
//      z samych spacji musi PADAĆ, a nie trafiać do zapytania jako `%%`,
//   5. deklaracje czytane przez klienta MCP w `tools/list`: nazwa, tytuł, opis
//      i adnotacje `readOnlyHint`/`idempotentHint`/`openWorldHint`.
//
// DLACZEGO ADNOTACJE SĄ PRZEDMIOTEM DOWODU. To PODPOWIEDZI dla klienta, nie
// wymuszenie - i właśnie dlatego ich rozjazd z rzeczywistością jest groźny:
// `readOnlyHint: true` przy narzędziu, które kiedyś zaczęłoby pisać, pozwala
// klientom MCP wołać je BEZ pytania użytkownika o zgodę. Trzy narzędzia są
// wyłącznie do czytania i ten stan ma być przypięty.
//
// CZEGO NIE ATRAPUJEMY. Nic. Plik nie woła handlerów, więc nie dotyka ani
// bazy, ani hosta - importuje prawdziwe narzędzia i prawdziwe schematy zod.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import searchPosts from "@/lib/mcp/tools/search-posts";
import getPost from "@/lib/mcp/tools/get-post";
import listRecentPosts from "@/lib/mcp/tools/list-recent-posts";

// --- pomocnicy --------------------------------------------------------------

/**
 * Schemat narzędzia jako obiekt zod. `inputSchema` jest SUROWYM kształtem
 * (`{ slug: z.string() }`), a nie `z.object(...)` - SDK dokłada owijkę
 * wewnętrznie, więc test musi zrobić to samo, żeby mierzyć TĘ walidację,
 * która działa w produkcji.
 *
 * STRAŻNIK, nie rzutowanie: warunek sprawdza w runtime, że kształt istnieje.
 * Wyjątek zamiast `undefined`, bo test „przechodzący" na braku schematu
 * przechodziłby też w świecie, w którym walidacji nie ma wcale.
 */
function schemaOf(shape: z.ZodRawShape | undefined): z.ZodObject<z.ZodRawShape> {
  if (!shape) throw new Error("test: narzędzie nie deklaruje `inputSchema`");
  return z.object(shape);
}

const getPostSchema = schemaOf(getPost.inputSchema);
const searchPostsSchema = schemaOf(searchPosts.inputSchema);
const listRecentPostsSchema = schemaOf(listRecentPosts.inputSchema);

describe("get_post - schemat wejścia", () => {
  it("bez `lang` oddaje polski", () => {
    expect(getPostSchema.parse({ slug: "traktat-o-cle" })).toEqual({
      slug: "traktat-o-cle",
      lang: "pl",
    });
  });

  it("przyjmuje `lang` 'en' i 'pl'", () => {
    expect(getPostSchema.parse({ slug: "a", lang: "en" }).lang).toBe("en");
    expect(getPostSchema.parse({ slug: "a", lang: "pl" }).lang).toBe("pl");
  });

  // Lista języków jest ZAMKNIĘTA: nieznany kod trafiłby do interpolacji nazwy
  // kolumny (`title_${t}`), a strażnik `lang === "en" ? "en" : "pl"` w handlerze
  // jest drugą linią obrony, nie pierwszą.
  it("odrzuca język poza listą", () => {
    expect(getPostSchema.safeParse({ slug: "a", lang: "de" }).success).toBe(false);
  });

  it("obcina spacje w slugu", () => {
    expect(getPostSchema.parse({ slug: "  traktat-o-cle  " }).slug).toBe("traktat-o-cle");
  });

  // Slug z samych spacji MUSI padać, a nie trafiać do `.eq("slug", "")`:
  // zapytanie o pusty slug jest zawsze pustką, więc wołający dostałby
  // „nie ma takiego wpisu" zamiast informacji o złym wejściu.
  it("odrzuca slug pusty i slug z samych spacji", () => {
    expect(getPostSchema.safeParse({ slug: "" }).success).toBe(false);
    expect(getPostSchema.safeParse({ slug: "   " }).success).toBe(false);
  });

  it("wymaga sluga - to jedyne pole obowiązkowe", () => {
    expect(getPostSchema.safeParse({}).success).toBe(false);
    expect(getPostSchema.safeParse({ lang: "pl" }).success).toBe(false);
  });

  it("nie deklaruje limitu - narzędzie oddaje jeden wpis", () => {
    expect(Object.keys(getPost.inputSchema ?? {}).sort()).toEqual(["lang", "slug"]);
  });
});

describe("search_posts - schemat wejścia", () => {
  it("bez `lang` i bez `limit` oddaje polski i dziesięć wyników", () => {
    expect(searchPostsSchema.parse({ query: "cło" })).toEqual({
      query: "cło",
      lang: "pl",
      limit: 10,
    });
  });

  it("obcina spacje we frazie i odrzuca frazę pustą", () => {
    expect(searchPostsSchema.parse({ query: "  cło  " }).query).toBe("cło");
    expect(searchPostsSchema.safeParse({ query: "" }).success).toBe(false);
    expect(searchPostsSchema.safeParse({ query: "   " }).success).toBe(false);
  });

  it("wymaga frazy", () => {
    expect(searchPostsSchema.safeParse({}).success).toBe(false);
  });

  it("przyjmuje limit z domkniętego przedziału 1-50", () => {
    expect(searchPostsSchema.parse({ query: "cło", limit: 1 }).limit).toBe(1);
    expect(searchPostsSchema.parse({ query: "cło", limit: 50 }).limit).toBe(50);
  });

  // GÓRNA GRANICA JEST OCHRONĄ BAZY na PUBLICZNYM endpoincie: bez niej
  // wołający zamawia dowolnie duży skan `posts` jednym żądaniem.
  it("odrzuca limit poza przedziałem - NIE przycina go do granicy", () => {
    expect(searchPostsSchema.safeParse({ query: "cło", limit: 0 }).success).toBe(false);
    expect(searchPostsSchema.safeParse({ query: "cło", limit: 51 }).success).toBe(false);
    expect(searchPostsSchema.safeParse({ query: "cło", limit: 100000 }).success).toBe(false);
  });

  it("odrzuca limit niecałkowity i limit podany ciągiem", () => {
    expect(searchPostsSchema.safeParse({ query: "cło", limit: 10.5 }).success).toBe(false);
    expect(searchPostsSchema.safeParse({ query: "cło", limit: "10" }).success).toBe(false);
  });

  it("odrzuca język poza listą", () => {
    expect(searchPostsSchema.safeParse({ query: "cło", lang: "fr" }).success).toBe(false);
  });
});

describe("list_recent_posts - schemat wejścia", () => {
  // Narzędzie „co nowego" musi dać się zawołać BEZ ARGUMENTÓW - to jego punkt
  // wejścia dla modelu, który jeszcze nic o witrynie nie wie.
  it("woła się bez żadnego argumentu i dostaje polski oraz dziesięć wyników", () => {
    expect(listRecentPostsSchema.parse({})).toEqual({ lang: "pl", limit: 10 });
  });

  it("przyjmuje limit z domkniętego przedziału 1-50", () => {
    expect(listRecentPostsSchema.parse({ limit: 1 }).limit).toBe(1);
    expect(listRecentPostsSchema.parse({ limit: 50 }).limit).toBe(50);
  });

  it("odrzuca limit poza przedziałem - NIE przycina go do granicy", () => {
    expect(listRecentPostsSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listRecentPostsSchema.safeParse({ limit: 51 }).success).toBe(false);
  });

  it("odrzuca limit niecałkowity", () => {
    expect(listRecentPostsSchema.safeParse({ limit: 2.5 }).success).toBe(false);
  });

  it("odrzuca język poza listą", () => {
    expect(listRecentPostsSchema.safeParse({ lang: "es" }).success).toBe(false);
  });
});

describe("trzy narzędzia - spójność zacisków między narzędziami", () => {
  // Rozjazd domyślnych wartości między narzędziami tego samego API jest
  // defektem doświadczenia: model, który zawoła `list_recent_posts` i potem
  // `search_posts`, dostałby treść w dwóch różnych językach albo listy różnej
  // długości bez żadnego powodu.
  it("`lang` domyślne jest identyczne we wszystkich trzech", () => {
    expect([
      getPostSchema.parse({ slug: "a" }).lang,
      searchPostsSchema.parse({ query: "a" }).lang,
      listRecentPostsSchema.parse({}).lang,
    ]).toEqual(["pl", "pl", "pl"]);
  });

  it("`limit` domyślne i granice są identyczne w obu narzędziach listujących", () => {
    expect(searchPostsSchema.parse({ query: "a" }).limit).toBe(
      listRecentPostsSchema.parse({}).limit,
    );
    expect(searchPostsSchema.safeParse({ query: "a", limit: 51 }).success).toBe(
      listRecentPostsSchema.safeParse({ limit: 51 }).success,
    );
    expect(searchPostsSchema.safeParse({ query: "a", limit: 0 }).success).toBe(
      listRecentPostsSchema.safeParse({ limit: 0 }).success,
    );
  });
});

describe("trzy narzędzia - deklaracje czytane w tools/list", () => {
  const narzedzia = [searchPosts, getPost, listRecentPosts] as const;

  it("nazwy narzędzi to stabilny kontrakt publiczny", () => {
    expect(narzedzia.map((t) => t.name)).toEqual(["search_posts", "get_post", "list_recent_posts"]);
  });

  it("każde narzędzie ma niepusty tytuł i opis", () => {
    for (const tool of narzedzia) {
      expect(tool.title.trim().length).toBeGreaterThan(0);
      expect(tool.description.trim().length).toBeGreaterThan(0);
    }
  });

  // Opis jest tekstem, po którym MODEL wybiera narzędzie. Opis nienazywający
  // wejścia (slug / fraza) prowadzi do wołania narzędzia z byle czym.
  it("opis get_post mówi o slugu, opis search_posts o szukaniu po słowie", () => {
    expect(getPost.description).toContain("slug");
    expect(searchPosts.description.toLowerCase()).toContain("search");
  });

  // ADNOTACJE STERUJĄ ZGODĄ UŻYTKOWNIKA W KLIENCIE MCP. `readOnlyHint: true`
  // pozwala wołać narzędzie bez pytania; gdyby któreś zaczęło pisać przy
  // niezmienionej adnotacji, klienci robiliby to po cichu.
  it("wszystkie trzy są zadeklarowane jako tylko do czytania i idempotentne", () => {
    for (const tool of narzedzia) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  // `openWorldHint: false` mówi, że narzędzie czyta WŁASNĄ, zamkniętą
  // dziedzinę (treść tej witryny), a nie otwarty internet. To istotne dla
  // klienta ważącego ryzyko wywołania.
  it("żadne narzędzie nie deklaruje działania nieodwracalnego", () => {
    for (const tool of narzedzia) {
      expect(tool.annotations?.destructiveHint).toBeUndefined();
      expect(tool.annotations?.openWorldHint).toBe(false);
    }
  });

  it("każde narzędzie deklaruje schemat wejścia z opisami pól", () => {
    for (const tool of narzedzia) {
      const shape = tool.inputSchema;
      expect(shape).toBeDefined();
      for (const [pole, typ] of Object.entries(shape ?? {})) {
        expect(typ.description, `pole \`${pole}\` w \`${tool.name}\` bez opisu`).toBeTruthy();
      }
    }
  });

  // Narzędzia są tylko do czytania i oddają JSON w bloku tekstowym plus
  // `structuredContent`. `outputSchema` nie jest zadeklarowany świadomie -
  // przypinamy to, żeby jego dołożenie było zmianą widoczną w teście.
  it("żadne narzędzie nie deklaruje outputSchema", () => {
    for (const tool of narzedzia) {
      expect(tool.outputSchema).toBeUndefined();
    }
  });
});
