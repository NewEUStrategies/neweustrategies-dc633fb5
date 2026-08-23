// MAILA NIE DA SIĘ WYCOFAĆ - a ten plik decyduje, KTÓRE wpisy w nim wylądują.
//
// `fetchEmailDocPostRows` biegnie NA SERWERZE w chwili wysyłki, więc każda
// nietrafiona gałąź kończy się w cudzej skrzynce:
//   * brak filtra `tenant_id` lub `status = "published"` to wysyłka SZKICU
//     albo cudzego wpisu do całej listy adresowej - nie da się tego odwołać,
//   * zgubiony filtr `deleted_at IS NULL` promuje wpis, który redakcja
//     świadomie usunęła,
//   * zignorowana kolejność `postIds` w trybie ręcznym wysyła "wybór redakcji"
//     w kolejności bazy, czyli nie ten, który redaktor zatwierdził,
//   * wyjątek w pobraniu MUSI dawać pusty blok (mail bez sekcji), a nie
//     wywalać całą wysyłkę w połowie kampanii.
//
// `postRefsForLang` jest czyste, ale równie nieodwracalne: zły prefiks języka
// prowadzi odbiorcę EN na polską wersję wpisu, a niedomknięty fallback wysyła
// pusty tytuł jako klikalny link.
//
// `renderEmailHtml.test.ts` dotyka `postRefsForLang` dwoma przypadkami;
// warstwa pobrania nie była dotknięta w ogóle. DETERMINIZM: zero sieci, klient
// bazy jest lokalną atrapą łańcucha, czas zamrożony na 2026-08-22T10:00:00Z.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchEmailDocPostRows,
  postRefsForLang,
  type EmailDocDbClient,
  type EmailPostRow,
} from "../emailDocResolve";
import { DEFAULT_EMAIL_DOC_STYLE, type EmailDoc, type EmailPostListBlock } from "../emailDoc";

const NOW_ISO = "2026-08-22T10:00:00.000Z";

/** Jedno ogniwo zapisane przez atrapę klienta bazy. */
interface Call {
  method: string;
  args: unknown[];
}
interface Chain {
  table: string;
  calls: Call[];
}

type Reply = { data: unknown; error: { message: string } | null };
type Responder = (chain: Chain) => Reply;

/**
 * Kształt łańcucha, jakim `emailDocResolve` posługuje się w produkcji
 * (prywatny `AnyQ` z modułu). Powtórzony tu JAWNIE, bo to jest kontrakt
 * podlegający dowodowi: gdyby kod zaczął wołać ogniwo spoza tej listy,
 * test ma przestać się kompilować, a nie po cichu je pochłonąć.
 */
interface ChainQ {
  select: (s: string) => ChainQ;
  eq: (c: string, v: unknown) => ChainQ;
  in: (c: string, v: unknown[]) => ChainQ;
  is: (c: string, v: unknown) => ChainQ;
  not: (c: string, op: string, v: unknown) => ChainQ;
  order: (c: string, o: { ascending: boolean }) => ChainQ;
  limit: (n: number) => ChainQ;
  maybeSingle: () => Promise<Reply>;
  then: Promise<Reply>["then"];
}

/**
 * Atrapa klienta w kształcie `EmailDocDbClient`. Świadomie lokalna, a nie
 * `supabaseFromStub()`: rozwiązywanie bloków bierze klient LUŹNYM interfejsem
 * (wzorzec `tbl()`), więc test ma dowodzić, że kod działa z takim właśnie
 * kontraktem, a nie z pełnym klientem supabase-js.
 */
function dbStub(responders: Record<string, Responder | Reply>) {
  const chains: Chain[] = [];
  const reply = (chain: Chain): Reply => {
    const r = responders[chain.table];
    if (r === undefined) {
      throw new Error(`test: brak zaplanowanej odpowiedzi dla tabeli "${chain.table}"`);
    }
    return typeof r === "function" ? r(chain) : r;
  };
  const client: EmailDocDbClient = {
    from(table: string) {
      const chain: Chain = { table, calls: [] };
      chains.push(chain);
      const link =
        (method: string) =>
        (...args: unknown[]): ChainQ => {
          chain.calls.push({ method, args });
          return builder;
        };
      const settle = (): Promise<Reply> => Promise.resolve(reply(chain));
      const builder: ChainQ = {
        select: link("select"),
        eq: link("eq"),
        in: link("in"),
        is: link("is"),
        not: link("not"),
        order: link("order"),
        limit: link("limit"),
        maybeSingle: () => {
          chain.calls.push({ method: "maybeSingle", args: [] });
          return settle();
        },
        // Thenable: `await q` bez ogniwa terminalnego - tak czyta większość
        // zapytań w `fetchForBlock`.
        then: (onFulfilled, onRejected) => settle().then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
  return {
    client,
    chains,
    chainsFor: (table: string) => chains.filter((c) => c.table === table),
    /** Argumenty wszystkich wystąpień ogniwa w łańcuchu danej tabeli. */
    argsOfAll(table: string, method: string): unknown[][] {
      return chains
        .filter((c) => c.table === table)
        .flatMap((c) => c.calls.filter((k) => k.method === method).map((k) => k.args));
    },
  };
}

const TENANT = "11111111-1111-4111-8111-111111111111";

function row(over: Partial<EmailPostRow> = {}): EmailPostRow {
  return {
    id: "post-1",
    slug: "reforma-rynku-energii",
    title_pl: "Reforma rynku energii",
    title_en: "Energy market reform",
    excerpt_pl: "<p>Krótkie <b>streszczenie</b>.</p>",
    excerpt_en: "<p>A short <b>summary</b>.</p>",
    cover_image_url: "https://cdn.example.org/okladka.jpg",
    ...over,
  };
}

function postListBlock(over: Partial<EmailPostListBlock> = {}): EmailPostListBlock {
  return {
    id: "blok-1",
    type: "post-list",
    heading: { pl: "Najnowsze", en: "Latest" },
    mode: "latest",
    count: 3,
    categorySlug: null,
    postIds: [],
    layout: "list",
    showExcerpt: true,
    ...over,
  };
}

function docWith(blocks: EmailDoc["blocks"]): EmailDoc {
  return { version: 1, blocks, style: { ...DEFAULT_EMAIL_DOC_STYLE } };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
describe("fetchEmailDocPostRows - tryb 'najnowsze'", () => {
  it("czyta wyłącznie opublikowane, nieusunięte wpisy TEGO obszaru roboczego", async () => {
    const db = dbStub({ posts: { data: [row()], error: null } });
    await fetchEmailDocPostRows(db.client, TENANT, docWith([postListBlock()]));

    const eqs = db.argsOfAll("posts", "eq");
    // Brak któregokolwiek z tych filtrów = szkic albo cudzy wpis w wysyłce.
    expect(eqs).toContainEqual(["tenant_id", TENANT]);
    expect(eqs).toContainEqual(["status", "published"]);
    expect(db.argsOfAll("posts", "is")).toContainEqual(["deleted_at", null]);
  });

  it("bierze tyle wpisów, ile ustawił redaktor, od najnowszych", async () => {
    const db = dbStub({ posts: { data: [row()], error: null } });
    await fetchEmailDocPostRows(db.client, TENANT, docWith([postListBlock({ count: 5 })]));

    expect(db.argsOfAll("posts", "order")).toContainEqual(["published_at", { ascending: false }]);
    expect(db.argsOfAll("posts", "limit")).toContainEqual([5]);
  });

  it("wynik jest przypisany do identyfikatora bloku, bo renderer szuka po nim", async () => {
    const db = dbStub({ posts: { data: [row({ id: "post-9" })], error: null } });
    const out = await fetchEmailDocPostRows(
      db.client,
      TENANT,
      docWith([postListBlock({ id: "blok-abc" })]),
    );

    expect(Object.keys(out)).toEqual(["blok-abc"]);
    expect(out["blok-abc"]?.[0]?.id).toBe("post-9");
  });

  it("odpowiedź niebędąca tablicą daje pusty blok, a nie wysypkę renderera", async () => {
    const db = dbStub({ posts: { data: null, error: null } });
    const out = await fetchEmailDocPostRows(db.client, TENANT, docWith([postListBlock()]));
    expect(out["blok-1"]).toEqual([]);
  });

  it("dokument bez bloku listy wpisów nie odpytuje bazy ani razu", async () => {
    const db = dbStub({});
    const out = await fetchEmailDocPostRows(
      db.client,
      TENANT,
      docWith([{ id: "d", type: "divider" }]),
    );
    expect(out).toEqual({});
    expect(db.chains).toHaveLength(0);
  });

  it("awaria pobrania gasi jeden blok, nie całą kampanię", async () => {
    const db = dbStub({
      posts: () => {
        throw new Error("connection terminated unexpectedly");
      },
    });
    const out = await fetchEmailDocPostRows(db.client, TENANT, docWith([postListBlock()]));
    // Odbiorca dostanie mail bez tej sekcji - to jedyny bezpieczny skutek.
    expect(out["blok-1"]).toEqual([]);
  });

  it("dwa bloki listy są rozwiązywane niezależnie", async () => {
    let call = 0;
    const db = dbStub({
      posts: () => {
        call += 1;
        return { data: call === 1 ? [row({ id: "a" })] : [row({ id: "b" })], error: null };
      },
    });
    const out = await fetchEmailDocPostRows(
      db.client,
      TENANT,
      docWith([postListBlock({ id: "b1" }), postListBlock({ id: "b2" })]),
    );
    expect(out["b1"]?.[0]?.id).toBe("a");
    expect(out["b2"]?.[0]?.id).toBe("b");
  });
});

// ---------------------------------------------------------------------------
describe("fetchEmailDocPostRows - zawężenie kategorią", () => {
  it("kategoria jest rozwiązywana w obszarze roboczym, a wpisy zawężone do jej powiązań", async () => {
    const db = dbStub({
      categories: { data: { id: "cat-1" }, error: null },
      post_categories: { data: [{ post_id: "p1" }, { post_id: "p2" }], error: null },
      posts: { data: [row({ id: "p1" })], error: null },
    });
    await fetchEmailDocPostRows(
      db.client,
      TENANT,
      docWith([postListBlock({ categorySlug: "energia" })]),
    );

    const catEqs = db.argsOfAll("categories", "eq");
    expect(catEqs).toContainEqual(["tenant_id", TENANT]);
    expect(catEqs).toContainEqual(["slug", "energia"]);
    expect(db.argsOfAll("post_categories", "eq")).toContainEqual(["category_id", "cat-1"]);
    expect(db.argsOfAll("posts", "in")).toContainEqual(["id", ["p1", "p2"]]);
  });

  it("nieistniejąca kategoria daje pusty blok zamiast całej gazety", async () => {
    // Bez tego literówka w slugu wysłałaby WSZYSTKIE najnowsze wpisy zamiast
    // wybranej sekcji tematycznej.
    const db = dbStub({ categories: { data: null, error: null } });
    const out = await fetchEmailDocPostRows(
      db.client,
      TENANT,
      docWith([postListBlock({ categorySlug: "nie-ma-takiej" })]),
    );
    expect(out["blok-1"]).toEqual([]);
    expect(db.chainsFor("posts")).toHaveLength(0);
  });

  it("kategoria bez żadnego wpisu daje pusty blok, a nie listę bez zawężenia", async () => {
    const db = dbStub({
      categories: { data: { id: "cat-1" }, error: null },
      post_categories: { data: [], error: null },
    });
    const out = await fetchEmailDocPostRows(
      db.client,
      TENANT,
      docWith([postListBlock({ categorySlug: "pusta" })]),
    );
    expect(out["blok-1"]).toEqual([]);
    expect(db.chainsFor("posts")).toHaveLength(0);
  });

  it("uszkodzona odpowiedź o powiązaniach też zatrzymuje blok, zamiast go rozszerzyć", async () => {
    const db = dbStub({
      categories: { data: { id: "cat-1" }, error: null },
      post_categories: { data: "nie-tablica", error: null },
    });
    const out = await fetchEmailDocPostRows(
      db.client,
      TENANT,
      docWith([postListBlock({ categorySlug: "energia" })]),
    );
    expect(out["blok-1"]).toEqual([]);
  });

  it("liczba powiązań jest ograniczona - jedna kategoria nie zaciąga całej bazy", async () => {
    const db = dbStub({
      categories: { data: { id: "cat-1" }, error: null },
      post_categories: { data: [{ post_id: "p1" }], error: null },
      posts: { data: [row({ id: "p1" })], error: null },
    });
    await fetchEmailDocPostRows(
      db.client,
      TENANT,
      docWith([postListBlock({ categorySlug: "energia" })]),
    );
    expect(db.argsOfAll("post_categories", "limit")).toContainEqual([200]);
  });
});

// ---------------------------------------------------------------------------
describe("fetchEmailDocPostRows - tryb ręcznego wyboru", () => {
  it("pusty wybór nie odpytuje bazy i nie podstawia 'najnowszych'", async () => {
    // Podstawienie najnowszych wysłałoby wpisy, których redaktor NIE wybrał.
    const db = dbStub({});
    const out = await fetchEmailDocPostRows(
      db.client,
      TENANT,
      docWith([postListBlock({ mode: "manual", postIds: [] })]),
    );
    expect(out["blok-1"]).toEqual([]);
    expect(db.chains).toHaveLength(0);
  });

  it("wybrane wpisy jadą w kolejności redaktora, nie w kolejności bazy", async () => {
    const db = dbStub({
      posts: {
        data: [
          row({ id: "c", slug: "c" }),
          row({ id: "a", slug: "a" }),
          row({ id: "b", slug: "b" }),
        ],
        error: null,
      },
    });
    const out = await fetchEmailDocPostRows(
      db.client,
      TENANT,
      docWith([postListBlock({ mode: "manual", postIds: ["a", "b", "c"] })]),
    );
    expect(out["blok-1"]?.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(db.argsOfAll("posts", "in")).toContainEqual(["id", ["a", "b", "c"]]);
  });

  it("wpis wycofany między zapisem a wysyłką po prostu wypada z listy", async () => {
    const db = dbStub({ posts: { data: [row({ id: "a", slug: "a" })], error: null } });
    const out = await fetchEmailDocPostRows(
      db.client,
      TENANT,
      docWith([postListBlock({ mode: "manual", postIds: ["a", "usuniety"] })]),
    );
    expect(out["blok-1"]?.map((r) => r.id)).toEqual(["a"]);
  });

  it("ręczny wybór też przechodzi przez filtry publikacji i obszaru roboczego", async () => {
    const db = dbStub({ posts: { data: [], error: null } });
    await fetchEmailDocPostRows(
      db.client,
      TENANT,
      docWith([postListBlock({ mode: "manual", postIds: ["a"] })]),
    );
    const eqs = db.argsOfAll("posts", "eq");
    expect(eqs).toContainEqual(["tenant_id", TENANT]);
    expect(eqs).toContainEqual(["status", "published"]);
    expect(db.argsOfAll("posts", "is")).toContainEqual(["deleted_at", null]);
  });

  it("uszkodzona odpowiedź w trybie ręcznym daje pusty blok", async () => {
    const db = dbStub({ posts: { data: { nie: "tablica" }, error: null } });
    const out = await fetchEmailDocPostRows(
      db.client,
      TENANT,
      docWith([postListBlock({ mode: "manual", postIds: ["a"] })]),
    );
    expect(out["blok-1"]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("postRefsForLang - dokąd prowadzi link w mailu", () => {
  it("odbiorca angielski dostaje adres z prefiksem /en", () => {
    const out = postRefsForLang({ b: [row()] }, "https://example.org", "en");
    expect(out.b?.[0]?.href).toBe("https://example.org/en/post/reforma-rynku-energii");
  });

  it("odbiorca polski dostaje adres bez prefiksu", () => {
    const out = postRefsForLang({ b: [row()] }, "https://example.org", "pl");
    expect(out.b?.[0]?.href).toBe("https://example.org/post/reforma-rynku-energii");
  });

  it("nadmiarowe ukośniki w originie nie produkują podwójnego slasha w linku", () => {
    const out = postRefsForLang({ b: [row()] }, "https://example.org///", "pl");
    expect(out.b?.[0]?.href).toBe("https://example.org/post/reforma-rynku-energii");
  });

  it("slug ze znakami specjalnymi jest zakodowany - link nie rozpada się w kliencie pocztowym", () => {
    const out = postRefsForLang({ b: [row({ slug: "raport 2026/q1" })] }, "https://x.pl", "pl");
    expect(out.b?.[0]?.href).toBe("https://x.pl/post/raport%202026%2Fq1");
  });

  it("brak tłumaczenia tytułu spada na drugi język, a nie na pusty link", () => {
    const out = postRefsForLang({ b: [row({ title_en: null })] }, "https://x.pl", "en");
    expect(out.b?.[0]?.title).toBe("Reforma rynku energii");
  });

  it("wpis zupełnie bez tytułu daje pusty napis, a nie 'null' w treści maila", () => {
    const out = postRefsForLang(
      { b: [row({ title_pl: null, title_en: null, excerpt_pl: null, excerpt_en: null })] },
      "https://x.pl",
      "pl",
    );
    expect(out.b?.[0]?.title).toBe("");
    expect(out.b?.[0]?.excerpt).toBe("");
  });

  it("zajawka traci znaczniki HTML - w mailu ma być tekst, nie kod", () => {
    const out = postRefsForLang({ b: [row()] }, "https://x.pl", "pl");
    expect(out.b?.[0]?.excerpt).toBe("Krótkie streszczenie .");
  });

  it("zajawka jest przycięta do 220 znaków, żeby karta wpisu nie rozjechała się w skrzynce", () => {
    const long = "a".repeat(400);
    const out = postRefsForLang({ b: [row({ excerpt_pl: long })] }, "https://x.pl", "pl");
    expect(out.b?.[0]?.excerpt).toHaveLength(220);
  });

  it("okładka przechodzi bez zmian, a jej brak zostaje pustką", () => {
    const withCover = postRefsForLang({ b: [row()] }, "https://x.pl", "pl");
    expect(withCover.b?.[0]?.coverUrl).toBe("https://cdn.example.org/okladka.jpg");
    const without = postRefsForLang({ b: [row({ cover_image_url: null })] }, "https://x.pl", "pl");
    expect(without.b?.[0]?.coverUrl).toBeNull();
  });

  it("pusty blok zostaje pustą listą - renderer pomija taką sekcję", () => {
    expect(postRefsForLang({ b: [] }, "https://x.pl", "pl")).toEqual({ b: [] });
  });
});
