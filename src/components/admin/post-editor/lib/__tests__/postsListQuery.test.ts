import { describe, expect, it } from "vitest";
import { supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import {
  PARITY_GAP_FILTERS,
  POSTS_LIST_COLUMNS,
  POSTS_LIST_INVALIDATE_KEYS,
  applyDeletedScope,
  applyMissingEnCountFilters,
  applyPostsListFilters,
  bulkStatusesFor,
  coverageOf,
  deletedAtRange,
  dialogTitleOf,
  emptyStateKey,
  isAllSelected,
  pageRange,
  postsListQueryKey,
  rowTitleOf,
  searchOrExpression,
  selectAllState,
  shouldShowParityGap,
  sortColumnFor,
  toggleAllSelected,
  toggleSelected,
  viewLangFor,
  type PostsListFilters,
  type PostsListQueryBuilder,
} from "../postsListQuery";

/** Atrapa łańcucha PostgREST w kształcie, jakiego wymaga budowniczy listy. */
interface StubChain extends PostsListQueryBuilder<StubChain> {
  select(columns: string, options?: unknown): StubChain;
}

function filters(over: Partial<PostsListFilters> = {}): PostsListFilters {
  return {
    view: "active",
    search: "",
    status: "all",
    lang: "all",
    author: "all",
    trashFrom: "",
    trashTo: "",
    page: 1,
    pageSize: 50,
    ...over,
  };
}

/** Buduje zapytanie listy na atrapie i oddaje ZAPISANY łańcuch ogniw. */
function listChain(over: Partial<PostsListFilters> = {}): RecordedChain {
  const stub = supabaseFromStub();
  const base = (stub.from("posts") as StubChain)
    .select(POSTS_LIST_COLUMNS, { count: "exact" })
    .eq("tenant_id", "tenant-1");
  applyPostsListFilters(base, filters(over));
  const chain = stub.lastChain("posts");
  if (!chain) throw new Error("test: atrapa nie zapisała łańcucha");
  return chain;
}

/** Wszystkie wywołania danego ogniwa (ogniwo bywa użyte kilka razy). */
function callsOf(chain: RecordedChain, method: string): ReadonlyArray<unknown>[] {
  return chain.calls.filter((c) => c.method === method).map((c) => [...c.args]);
}

describe("applyPostsListFilters - zakres zakładki", () => {
  it("widok aktywny bierze WYŁĄCZNIE wiersze bez stempla usunięcia", () => {
    // Usuwanie jest miękkie (`deleted_at`), więc bez tego ogniwa wpisy
    // wyrzucone do kosza wróciłyby na listę główną obok żywych.
    const chain = listChain({ view: "active" });
    expect(callsOf(chain, "is")).toEqual([["deleted_at", null]]);
    expect(callsOf(chain, "not")).toEqual([]);
  });

  it("kosz bierze WYŁĄCZNIE wiersze ze stemplem usunięcia", () => {
    const chain = listChain({ view: "trash" });
    expect(callsOf(chain, "not")).toEqual([["deleted_at", "is", null]]);
    expect(callsOf(chain, "is")).toEqual([]);
  });

  it("applyDeletedScope nakłada tę samą regułę na zapytania liczące", () => {
    // Licznik zakładki „Kosz” i lista kosza MUSZĄ liczyć ten sam zbiór -
    // inaczej zakładka obiecuje 3 wpisy, a otwarty kosz pokazuje 0.
    const stub = supabaseFromStub();
    applyDeletedScope(
      (stub.from("posts") as StubChain).select("id", { count: "exact", head: true }),
      "trash",
    );
    expect(callsOf(stub.lastChain("posts")!, "not")).toEqual([["deleted_at", "is", null]]);
  });
});

describe("searchOrExpression", () => {
  it("szuka po tytule PL, tytule EN i slugu jednym wyrażeniem OR", () => {
    expect(searchOrExpression("Bruksela")).toBe(
      "title_pl.ilike.%Bruksela%,title_en.ilike.%Bruksela%,slug.ilike.%Bruksela%",
    );
  });

  it("pusta fraza i same białe znaki nie dokładają filtra", () => {
    // Filtr `%%` przepuściłby wszystko, ale kosztowałby trzy ILIKE po całej
    // tabeli przy każdym otwarciu pustej listy.
    expect(searchOrExpression("")).toBeNull();
    expect(searchOrExpression("   ")).toBeNull();
    expect(searchOrExpression("\n\t ")).toBeNull();
  });

  it("obcina białe znaki z brzegów frazy", () => {
    expect(searchOrExpression("  Bruksela  ")).toBe(
      "title_pl.ilike.%Bruksela%,title_en.ilike.%Bruksela%,slug.ilike.%Bruksela%",
    );
  });

  it("REGRESJA: fraza nie może dopisać WŁASNYCH warunków do wyrażenia OR", () => {
    // Przecinek rozdziela warunki w `.or()`, a nawiasy je grupują. Fraza
    // wpisana w pole szukania trafia do tego wyrażenia wprost, więc bez
    // czyszczenia „x,tenant_id.eq.inny” wyprowadziłaby listę poza obszar
    // roboczy użytkownika - i pokazała cudze wpisy.
    const expr = searchOrExpression('raport, (tenant_id.eq.other) 100% "x" \\ a_b');
    expect(expr).not.toBeNull();
    const conditions = expr!.split(",");
    expect(conditions).toHaveLength(3);
    expect(conditions[0].startsWith("title_pl.ilike.")).toBe(true);
    expect(conditions[1].startsWith("title_en.ilike.")).toBe(true);
    expect(conditions[2].startsWith("slug.ilike.")).toBe(true);
    expect(expr).not.toContain("(");
    expect(expr).not.toContain(")");
    expect(expr).not.toContain('"');
    expect(expr).not.toContain("\\");
  });

  it("znaki wieloznaczne LIKE z frazy są zdejmowane", () => {
    // `%` i `_` w ILIKE znaczą „cokolwiek” - zostawione, zamieniłyby
    // wyszukiwanie dokładnej frazy w dopasowanie do wszystkiego.
    expect(searchOrExpression("a%b_c")).toBe(
      "title_pl.ilike.%abc%,title_en.ilike.%abc%,slug.ilike.%abc%",
    );
  });

  it("łańcuch listy dostaje wyrażenie szukania jako jedno ogniwo OR", () => {
    expect(callsOf(listChain({ search: "  Rada  " }), "or")).toEqual([
      ["title_pl.ilike.%Rada%,title_en.ilike.%Rada%,slug.ilike.%Rada%"],
    ]);
  });

  it("pusta fraza nie dokłada ogniwa OR do łańcucha", () => {
    expect(callsOf(listChain({ search: "   " }), "or")).toEqual([]);
  });
});

describe("applyPostsListFilters - status i autor", () => {
  it("status inny niż „wszystkie” zawęża zapytanie", () => {
    expect(callsOf(listChain({ status: "draft" }), "eq")).toEqual([
      ["tenant_id", "tenant-1"],
      ["status", "draft"],
    ]);
  });

  it("status „wszystkie” nie dokłada ogniwa", () => {
    expect(callsOf(listChain({ status: "all" }), "eq")).toEqual([["tenant_id", "tenant-1"]]);
  });

  it("REGRESJA: w koszu filtr statusu NIE jest nakładany", () => {
    // Pasek narzędzi chowa selektor statusu w koszu, ale stan filtra zostaje
    // z widoku aktywnego. Gdyby zapytanie nadal go używało, redaktor
    // przełączający się na kosz po filtrze „szkice” zobaczyłby pusty kosz
    // i uznał, że skasowane wpisy przepadły.
    const chain = listChain({ view: "trash", status: "published" });
    expect(callsOf(chain, "eq")).toEqual([["tenant_id", "tenant-1"]]);
  });

  it("filtr autora działa w obu zakładkach", () => {
    expect(callsOf(listChain({ author: "user-7" }), "eq")).toContainEqual([
      "author_id",
      "user-7",
    ]);
    expect(callsOf(listChain({ view: "trash", author: "user-7" }), "eq")).toContainEqual([
      "author_id",
      "user-7",
    ]);
  });

  it("autor „wszyscy” nie zawęża zapytania", () => {
    expect(callsOf(listChain({ author: "all" }), "eq")).toEqual([["tenant_id", "tenant-1"]]);
  });
});

describe("applyPostsListFilters - pokrycie językowe", () => {
  it("„komplet” wymaga obu tytułów: nie-null I nie-pustych", () => {
    const chain = listChain({ lang: "complete" });
    expect(callsOf(chain, "not")).toEqual([
      ["title_pl", "is", null],
      ["title_en", "is", null],
    ]);
    expect(callsOf(chain, "neq")).toEqual([
      ["title_pl", ""],
      ["title_en", ""],
    ]);
  });

  it("REGRESJA: „obecny” język to nie-null ORAZ nie-pusty napis", () => {
    // Sam `not is null` przepuściłby wpis z `title_en = ""`. To jest dokładnie
    // wpis BEZ wersji angielskiej: redaktor filtrujący „ma EN” dostałby go na
    // liście jako przetłumaczony i luka parytetu zostałaby niezauważona.
    const plOnlyPair = listChain({ lang: "has_pl" });
    expect(callsOf(plOnlyPair, "not")).toEqual([["title_pl", "is", null]]);
    expect(callsOf(plOnlyPair, "neq")).toEqual([["title_pl", ""]]);

    const enPair = listChain({ lang: "has_en" });
    expect(callsOf(enPair, "not")).toEqual([["title_en", "is", null]]);
    expect(callsOf(enPair, "neq")).toEqual([["title_en", ""]]);
  });

  it("„brakuje któregoś” łapie null I pusty napis w obu językach", () => {
    expect(callsOf(listChain({ lang: "missing_any" }), "or")).toEqual([
      ["title_pl.is.null,title_pl.eq.,title_en.is.null,title_en.eq."],
    ]);
  });

  it("„tylko PL” = jest tytuł PL, a EN pusty albo brak", () => {
    const chain = listChain({ lang: "pl_only" });
    expect(callsOf(chain, "not")).toEqual([["title_pl", "is", null]]);
    expect(callsOf(chain, "neq")).toEqual([["title_pl", ""]]);
    expect(callsOf(chain, "or")).toEqual([["title_en.is.null,title_en.eq."]]);
  });

  it("„tylko EN” jest lustrzane wobec „tylko PL”", () => {
    const chain = listChain({ lang: "en_only" });
    expect(callsOf(chain, "not")).toEqual([["title_en", "is", null]]);
    expect(callsOf(chain, "neq")).toEqual([["title_en", ""]]);
    expect(callsOf(chain, "or")).toEqual([["title_pl.is.null,title_pl.eq."]]);
  });

  it("filtr „wszystkie” nie nakłada żadnego warunku językowego", () => {
    const chain = listChain({ lang: "all" });
    expect(callsOf(chain, "neq")).toEqual([]);
    expect(callsOf(chain, "or")).toEqual([]);
    expect(callsOf(chain, "not")).toEqual([]);
  });

  it("filtr językowy współistnieje z frazą jako DWA osobne ogniwa OR", () => {
    // Sklejenie ich w jedno wyrażenie zamieniłoby koniunkcję (fraza I brak EN)
    // w alternatywę (fraza LUB brak EN) i wysypało na listę pół tabeli.
    expect(callsOf(listChain({ lang: "pl_only", search: "Rada" }), "or")).toEqual([
      ["title_pl.ilike.%Rada%,title_en.ilike.%Rada%,slug.ilike.%Rada%"],
      ["title_en.is.null,title_en.eq."],
    ]);
  });
});

describe("deletedAtRange", () => {
  it("dzień „od” liczy się od początku doby", () => {
    expect(deletedAtRange("2026-08-01", "")).toEqual({ gte: "2026-08-01T00:00:00.000Z" });
  });

  it("REGRESJA: dzień „do” jest DOMKNIĘTY - do ostatniej milisekundy doby", () => {
    // Input daje samą datę. Bez dosunięcia do końca doby granica wypadłaby na
    // północy i wpisy usunięte tego samego dnia po godzinie 00:00 zniknęłyby
    // z kosza - redaktor uznałby je za bezpowrotnie utracone.
    expect(deletedAtRange("", "2026-08-18")).toEqual({ lte: "2026-08-18T23:59:59.999Z" });
  });

  it("obie granice naraz", () => {
    expect(deletedAtRange("2026-08-01", "2026-08-18")).toEqual({
      gte: "2026-08-01T00:00:00.000Z",
      lte: "2026-08-18T23:59:59.999Z",
    });
  });

  it("puste pola nie dokładają granic", () => {
    expect(deletedAtRange("", "")).toEqual({});
  });

  it("granica „do” obejmuje ostatni dzień miesiąca bez przeskoku", () => {
    expect(deletedAtRange("", "2026-12-31").lte).toBe("2026-12-31T23:59:59.999Z");
  });

  it("łańcuch kosza dostaje granice jako gte/lte na deleted_at", () => {
    const chain = listChain({ view: "trash", trashFrom: "2026-08-01", trashTo: "2026-08-18" });
    expect(callsOf(chain, "gte")).toEqual([["deleted_at", "2026-08-01T00:00:00.000Z"]]);
    expect(callsOf(chain, "lte")).toEqual([["deleted_at", "2026-08-18T23:59:59.999Z"]]);
  });

  it("REGRESJA: zakres dat kosza NIE działa w widoku aktywnym", () => {
    // Pola dat pokazują się tylko w koszu, ale ich stan przeżywa powrót na
    // listę aktywną. Nałożone tam filtrowałyby po `deleted_at`, który dla
    // żywych wpisów jest NULL - lista wyszłaby pusta bez widocznej przyczyny.
    const chain = listChain({ view: "active", trashFrom: "2026-08-01", trashTo: "2026-08-18" });
    expect(callsOf(chain, "gte")).toEqual([]);
    expect(callsOf(chain, "lte")).toEqual([]);
  });
});

describe("sortowanie i paginacja", () => {
  it("lista aktywna sortuje po dacie edycji, kosz po dacie usunięcia", () => {
    expect(sortColumnFor("active")).toBe("updated_at");
    expect(sortColumnFor("trash")).toBe("deleted_at");
    expect(callsOf(listChain({ view: "active" }), "order")).toEqual([
      ["updated_at", { ascending: false }],
    ]);
    expect(callsOf(listChain({ view: "trash" }), "order")).toEqual([
      ["deleted_at", { ascending: false }],
    ]);
  });

  it("pageRange oddaje zakres OBUSTRONNIE DOMKNIĘTY", () => {
    // PostgREST `.range()` jest domknięty z obu stron: `to = from + size`
    // dokładałoby jeden wiersz z następnej strony do każdej strony.
    expect(pageRange(1, 50)).toEqual({ from: 0, to: 49 });
    expect(pageRange(2, 50)).toEqual({ from: 50, to: 99 });
    expect(pageRange(3, 25)).toEqual({ from: 50, to: 74 });
    expect(pageRange(1, 1)).toEqual({ from: 0, to: 0 });
  });

  it("strona liczy się od 1, nie od 0", () => {
    expect(callsOf(listChain({ page: 1, pageSize: 20 }), "range")).toEqual([[0, 19]]);
    expect(callsOf(listChain({ page: 4, pageSize: 20 }), "range")).toEqual([[60, 79]]);
  });

  it("REGRESJA: sortowanie i zakres stron są OSTATNIE w łańcuchu", () => {
    // Zakres nałożony przed filtrami stronicowałby zbiór NIEZAWĘŻONY: strona 1
    // z filtrem „szkice” pokazywałaby pierwsze 50 wierszy całej tabeli,
    // przefiltrowane dopiero po wycięciu - czyli najczęściej pustą listę.
    const chain = listChain({ view: "trash", search: "x", lang: "pl_only", status: "draft" });
    const methods = chain.calls.map((c) => c.method);
    expect(methods.slice(-2)).toEqual(["order", "range"]);
  });
});

describe("postsListQueryKey", () => {
  it("niesie tenanta i KAŻDY filtr w ustalonej kolejności", () => {
    expect(
      postsListQueryKey("tenant-1", filters({ view: "trash", search: "rada", page: 2 })),
    ).toEqual(["admin-posts", "tenant-1", "trash", "rada", "all", "all", "all", "", "", 2, 50]);
  });

  it("REGRESJA: zmiana tenanta zmienia klucz cache", () => {
    // Bez tenanta w kluczu przełączenie obszaru roboczego podałoby z cache
    // listę wpisów POPRZEDNIEJ firmy - i to jako dane bieżącego obszaru.
    expect(postsListQueryKey("tenant-1", filters())).not.toEqual(
      postsListQueryKey("tenant-2", filters()),
    );
  });

  it("każdy filtr z osobna różnicuje klucz", () => {
    // Filtr poza kluczem = lista, która nie odświeża się po jego zmianie.
    const base = postsListQueryKey("t", filters());
    const variants: Partial<PostsListFilters>[] = [
      { view: "trash" },
      { search: "x" },
      { status: "draft" },
      { lang: "pl_only" },
      { author: "u1" },
      { trashFrom: "2026-08-01" },
      { trashTo: "2026-08-18" },
      { page: 2 },
      { pageSize: 25 },
    ];
    for (const over of variants) {
      expect(postsListQueryKey("t", filters(over)), JSON.stringify(over)).not.toEqual(base);
    }
  });
});

describe("POSTS_LIST_INVALIDATE_KEYS", () => {
  it("REGRESJA: unieważnia też licznik luki parytetu PL/EN", () => {
    // `invalidateQueries` dopasowuje po PREFIKSIE tablicy, a nie po prefiksie
    // napisu: klucz ["admin-posts"] nie trafia w ["admin-posts-missing-en-count"].
    // Bez tej pozycji pasek parytetu zostawał po masowej publikacji na starej
    // liczbie - nadal wołał o wersje EN dla wpisów, które właśnie je dostały.
    expect(POSTS_LIST_INVALIDATE_KEYS.map((k) => k[0])).toEqual([
      "admin-posts",
      "admin-posts-trash-count",
      "admin-posts-view-count",
      "admin-posts-missing-en-count",
    ]);
  });

  it("każdy klucz jest jednoelementowym prefiksem (bez tenanta)", () => {
    // Prefiks bez tenanta unieważnia wpisy cache WSZYSTKICH obszarów, więc
    // powrót do poprzedniego obszaru nie pokaże listy sprzed mutacji.
    for (const key of POSTS_LIST_INVALIDATE_KEYS) expect(key).toHaveLength(1);
  });
});

describe("parytet PL/EN", () => {
  it("licznik bierze opublikowane, nieusunięte wpisy bez tytułu EN", () => {
    const stub = supabaseFromStub();
    applyMissingEnCountFilters(
      (stub.from("posts") as StubChain)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", "tenant-1"),
    );
    const chain = stub.lastChain("posts")!;
    expect(callsOf(chain, "eq")).toEqual([
      ["tenant_id", "tenant-1"],
      ["status", "published"],
    ]);
    expect(callsOf(chain, "is")).toEqual([["deleted_at", null]]);
    expect(callsOf(chain, "or")).toEqual([["title_en.is.null,title_en.eq."]]);
  });

  it("REGRESJA: licznik liczy SZERZEJ niż filtr, który podstawia klik w pasek", () => {
    // Rozjazd istniejący w produkcji, przypięty świadomie (naprawa wymaga
    // decyzji redakcyjnej, nie technicznej):
    //   * licznik NIE stawia żadnego warunku na `title_pl`,
    //   * filtr `pl_only`, na który przełącza klik, wymaga NIEPUSTEGO `title_pl`.
    // Wpis opublikowany BEZ OBU tytułów wchodzi więc do liczby na pasku, ale
    // nie wchodzi na listę po kliknięciu: pasek mówi „3 wpisy bez wersji EN”,
    // klik pokazuje 2 wiersze, a trzeciego nie da się tą drogą znaleźć.
    const stub = supabaseFromStub();
    applyMissingEnCountFilters(
      (stub.from("posts") as StubChain).select("id", { count: "exact", head: true }),
    );
    const countChain = stub.lastChain("posts")!;
    const touchesPl = countChain.calls.some((c) =>
      c.args.some((a) => typeof a === "string" && a.includes("title_pl")),
    );
    expect(touchesPl).toBe(false);

    const listedChain = listChain({ status: "published", lang: PARITY_GAP_FILTERS.lang });
    expect(callsOf(listedChain, "not")).toEqual([["title_pl", "is", null]]);
    expect(callsOf(listedChain, "neq")).toEqual([["title_pl", ""]]);
  });

  it("klik w pasek ustawia opublikowane + tylko PL i wraca na pierwszą stronę", () => {
    // Powrót na stronę 1 jest częścią reguły: bez niego redaktor na stronie 4
    // dostałby po kliknięciu pustą listę mimo niezerowego licznika.
    expect(PARITY_GAP_FILTERS).toEqual({ status: "published", lang: "pl_only", page: 1 });
  });

  it("pasek pokazuje się tylko poza koszem i tylko dla dodatniej liczby", () => {
    expect(shouldShowParityGap("active", 3)).toBe(true);
    expect(shouldShowParityGap("active", 0)).toBe(false);
    expect(shouldShowParityGap("trash", 3)).toBe(false);
  });

  it("pasek milczy, dopóki licznik się nie policzył", () => {
    // Zapytanie liczące jest osobne i wraca później niż lista. `undefined`
    // musi znaczyć „nie wiem”, a nie „zero” ani „pokaż” - inaczej pasek
    // mrugałby przy każdym wejściu na listę.
    expect(shouldShowParityGap("active", undefined)).toBe(false);
    expect(shouldShowParityGap("active", null)).toBe(false);
  });
});

describe("coverageOf", () => {
  it("tytuł z treścią daje pokrycie w obu językach", () => {
    expect(coverageOf({ title_pl: "Tytuł", title_en: "Title" })).toEqual({ pl: true, en: true });
  });

  it("REGRESJA: tytuł z samych spacji to BRAK języka", () => {
    // Plakietka „EN” obok wpisu, którego tytuł angielski to jedna spacja,
    // obiecywałaby gotową wersję - a czytelnik dostałby pusty nagłówek.
    expect(coverageOf({ title_pl: "   ", title_en: "\n\t" })).toEqual({ pl: false, en: false });
  });

  it("null i pusty napis to brak języka", () => {
    expect(coverageOf({ title_pl: null, title_en: "" })).toEqual({ pl: false, en: false });
  });

  it("języki liczą się niezależnie", () => {
    expect(coverageOf({ title_pl: "Tytuł", title_en: null })).toEqual({ pl: true, en: false });
    expect(coverageOf({ title_pl: "", title_en: "Title" })).toEqual({ pl: false, en: true });
  });
});

describe("viewLangFor", () => {
  it("REGRESJA: filtr językowy PRZEJMUJE język listy", () => {
    // Redaktor zawęził listę do wersji angielskich - ma zobaczyć tytuły EN
    // i otworzyć edytor po stronie EN, choćby panel miał UI po polsku.
    // Inaczej klikałby wiersz „bez tytułu” i pisał poprawki do wersji PL.
    expect(viewLangFor("en_only", "pl")).toBe("en");
    expect(viewLangFor("has_en", "pl")).toBe("en");
    expect(viewLangFor("pl_only", "en")).toBe("pl");
    expect(viewLangFor("has_pl", "en")).toBe("pl");
  });

  it("bez filtra językowego decyduje język interfejsu", () => {
    expect(viewLangFor("all", "en")).toBe("en");
    expect(viewLangFor("all", "en-GB")).toBe("en");
    expect(viewLangFor("all", "pl")).toBe("pl");
    expect(viewLangFor("all", "pl-PL")).toBe("pl");
  });

  it("filtry niejednoznaczne językowo zostawiają język interfejsu", () => {
    // „komplet” i „brakuje któregoś” dotyczą OBU wersji - nie ma z czego
    // wywnioskować, którą redaktor chce edytować.
    expect(viewLangFor("complete", "en")).toBe("en");
    expect(viewLangFor("missing_any", "pl")).toBe("pl");
  });

  it("brak języka interfejsu schodzi na polski", () => {
    expect(viewLangFor("all", undefined)).toBe("pl");
    expect(viewLangFor("all", null)).toBe("pl");
    expect(viewLangFor("all", "")).toBe("pl");
  });
});

describe("tytuły wierszy i komunikatów", () => {
  const row = { title_pl: "Polski", title_en: "English", slug: "wpis" };

  it("wiersz pokazuje tytuł z języka widoku", () => {
    expect(rowTitleOf(row, "pl")).toBe("Polski");
    expect(rowTitleOf(row, "en")).toBe("English");
  });

  it("REGRESJA: wiersz spada na DRUGI język, gdy w języku widoku pusto", () => {
    // Pusta komórka tytułu w tabeli wygląda jak uszkodzony wiersz. Wpis, który
    // ma dopiero wersję PL, ma być rozpoznawalny także na liście EN.
    expect(rowTitleOf({ title_pl: "Polski", title_en: null }, "en")).toBe("Polski");
    expect(rowTitleOf({ title_pl: "", title_en: "English" }, "pl")).toBe("English");
  });

  it("wiersz bez żadnego tytułu oddaje null (wiersz rysuje „bez tytułu”)", () => {
    expect(rowTitleOf({ title_pl: null, title_en: null }, "pl")).toBeNull();
    expect(rowTitleOf({ title_pl: "", title_en: "" }, "en")).toBeNull();
  });

  it("dialog spada na SLUG, nie na drugi język", () => {
    // „Usunąć trwale?” musi wskazać konkretny wiersz. Slug jest unikalny
    // w obszarze roboczym, tytuł drugiego języka - nie musi.
    expect(dialogTitleOf({ title_pl: null, title_en: "English", slug: "wpis" }, "pl")).toBe(
      "wpis",
    );
    expect(dialogTitleOf({ title_pl: "", title_en: "", slug: "wpis" }, "en")).toBe("wpis");
    expect(dialogTitleOf(row, "en")).toBe("English");
  });
});

describe("zaznaczanie wierszy", () => {
  it("przełącznik dokłada i zdejmuje pojedynczy wiersz", () => {
    const empty = new Set<string>();
    const one = toggleSelected(empty, "a");
    expect([...one]).toEqual(["a"]);
    expect([...toggleSelected(one, "a")]).toEqual([]);
  });

  it("REGRESJA: przełącznik zwraca NOWY zbiór i nie rusza poprzedniego", () => {
    // Stan Reacta porównuje się po tożsamości. Mutacja w miejscu nie
    // przerysowałaby ani checkboxa, ani paska akcji masowych - użytkownik
    // klikałby wiersz i nic by się nie działo.
    const before = new Set(["a"]);
    const after = toggleSelected(before, "b");
    expect(after).not.toBe(before);
    expect([...before]).toEqual(["a"]);
    expect([...after]).toEqual(["a", "b"]);
  });

  it("stan nagłówka: pełna strona, część, nic", () => {
    const ids = ["a", "b", "c"];
    expect(selectAllState(ids, new Set(ids))).toBe(true);
    expect(selectAllState(ids, new Set(["a"]))).toBe("indeterminate");
    expect(selectAllState(ids, new Set())).toBe(false);
  });

  it("pusta strona nigdy nie jest „zaznaczona w całości”", () => {
    // Inaczej checkbox nagłówka na pustej liście pokazywałby ptaszka
    // i sugerował zaznaczenie nieistniejących wierszy.
    expect(isAllSelected([], new Set())).toBe(false);
    expect(selectAllState([], new Set())).toBe(false);
    expect(selectAllState([], new Set(["z-innej-strony"]))).toBe("indeterminate");
  });

  it("klik w nagłówek zaznacza całą stronę, ponowny klik czyści", () => {
    const ids = ["a", "b"];
    expect([...toggleAllSelected(ids, new Set())]).toEqual(["a", "b"]);
    expect([...toggleAllSelected(ids, new Set(ids))]).toEqual([]);
  });

  it("zaznaczenie z INNEJ strony wypada przy „zaznacz wszystkie” (stan zastany)", () => {
    // Zachowanie produkcyjne przypięte świadomie: zaznaczenie przeżywa zmianę
    // strony (pasek masowy liczy je łącznie), ale klik w nagłówek podmienia je
    // na wiersze BIEŻĄCEJ strony. Redaktor, który zaznaczył 3 wpisy na stronie
    // 1 i kliknął „wszystkie” na stronie 2, wykona akcję tylko na stronie 2.
    expect([...toggleAllSelected(["c", "d"], new Set(["a", "b"]))]).toEqual(["c", "d"]);
  });
});

describe("bulkStatusesFor", () => {
  it("administrator może publikować masowo", () => {
    expect(bulkStatusesFor(true)).toEqual(["draft", "pending_review", "published", "archived"]);
  });

  it("REGRESJA: rola bez uprawnień nie dostaje pozycji „opublikowane”", () => {
    // Publikacja hurtowa jest egzekwowana po stronie serwera. Pokazanie
    // pozycji, której serwer odbije, kończy się komunikatem o błędzie po
    // zaznaczeniu 40 wpisów - zamiast brakiem opcji od razu.
    const statuses = bulkStatusesFor(false);
    expect(statuses).not.toContain("published");
    expect(statuses).toContain("pending_review");
    expect(statuses).toEqual(["draft", "pending_review", "archived"]);
  });
});

describe("emptyStateKey", () => {
  it("niepusty widok + brak wyników = komunikat o filtrach", () => {
    // Rozróżnienie jest istotne: „brak wpisów” przy aktywnym filtrze sugeruje
    // utratę danych, zamiast podpowiedzieć wyczyszczenie filtrów.
    expect(emptyStateKey("active", 12)).toBe("admin.list.noResults");
    expect(emptyStateKey("trash", 4)).toBe("admin.list.noResults");
  });

  it("pusty widok mówi wprost, że nie ma czego pokazywać", () => {
    expect(emptyStateKey("active", 0)).toBe("admin.posts.empty");
    expect(emptyStateKey("trash", 0)).toBe("admin.list.trashEmpty");
  });

  it("nieznana jeszcze liczba widoku zachowuje się jak pusty widok (stan zastany)", () => {
    // Licznik widoku to osobne zapytanie. Zanim wróci, pusta lista mówi
    // „brak wpisów” - zamiana na „brak wyników” wymagałaby własnego stanu
    // ładowania, więc zachowanie jest przypięte, a nie zmienione.
    expect(emptyStateKey("active", undefined)).toBe("admin.posts.empty");
    expect(emptyStateKey("trash", null)).toBe("admin.list.trashEmpty");
  });
});

describe("POSTS_LIST_COLUMNS", () => {
  it("niesie kolumny, na których stoją reguły listy", () => {
    // Każda z tych kolumn ma na liście konsumenta: pokrycie językowe, autora,
    // status, sortowanie i zakres kosza. Wypadnięcie którejkolwiek nie psuje
    // zapytania - psuje kolumnę w tabeli, po cichu.
    for (const column of [
      "id",
      "slug",
      "title_pl",
      "title_en",
      "status",
      "publish_at",
      "updated_at",
      "author_id",
      "deleted_at",
    ]) {
      expect(POSTS_LIST_COLUMNS.split(", ")).toContain(column);
    }
  });
});
