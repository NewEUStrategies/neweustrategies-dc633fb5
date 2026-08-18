// USTAWIENIA LAYOUTU ARCHIWÓW - `archive-layout-settings.ts`.
// Do 18.08.2026: 0 z 5 funkcji.
//
// `coerce` jest tu bramką ODPORNOŚCI: wiersz przychodzi z bazy, gdzie kolumny
// są liczbami i napisami bez ograniczenia do dozwolonych wariantów. Wartość
// spoza zakresu (wariant 99, sześć kolumn, styl listy zapisany przez starszy
// panel) NIE MOŻE dotrzeć do renderera archiwum - musi się skleić do wartości
// bezpiecznej. Inaczej strona kategorii renderuje siatkę o zerowej liczbie
// kolumn albo sięga po wariant, którego nie ma.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, type SupabaseFromStub } from "@/test/supabaseChain";

const stubs = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});
// Cache per-isolate jest tu przezroczysty - test ma mierzyć `coerce`
// i kształt zapytania, a nie zapamiętywanie wyniku między wywołaniami.
vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: async <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
}));

import {
  DEFAULT_ARCHIVE_LAYOUT,
  archiveLayoutQueryOptions,
  type ArchiveLayoutSettings,
} from "@/lib/archive-layout-settings";

function stub() {
  const s = stubs.from;
  if (!s) throw new Error("atrapa supabase nie została zainicjalizowana");
  return s;
}

/** Pełny wiersz bazy z możliwością nadpisania pojedynczych kolumn. */
function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    archive_type: "category",
    layout_variant: 3,
    columns: 2,
    list_style: "masonry",
    show_hero: false,
    show_description: false,
    show_follow: false,
    show_breadcrumbs: false,
    show_sidebar: true,
    sidebar_position: "left",
    sidebar_widgets: ["popular", "newsletter"],
    show_featured_top: false,
    show_related_taxonomies: true,
    show_podcasts: false,
    hero_bg_style: "mesh",
    posts_per_page: 24,
    ...overrides,
  };
}

/** Uruchamia queryFn opcji zapytania i oddaje sklejone ustawienia. */
async function load(
  archiveType: "category" | "tag",
  row: Record<string, unknown> | null,
  error?: string,
): Promise<ArchiveLayoutSettings> {
  stub().reset();
  stub().setResponse("archive_layout_settings", error ? fail(error) : ok(row));
  const options = archiveLayoutQueryOptions(archiveType);
  const queryFn = options.queryFn as (ctx: unknown) => Promise<ArchiveLayoutSettings>;
  return queryFn({});
}

beforeEach(() => {
  stub().reset();
});

describe("archiveLayoutQueryOptions - klucz i zapytanie", () => {
  it("klucz zapytania rozróżnia kategorie od tagów", () => {
    // Wspólny klucz sprawiłby, że ustawienia archiwum tagów pokazałyby się na
    // archiwum kategorii (i odwrotnie) - z cache'u, bez żadnego żądania.
    expect(archiveLayoutQueryOptions("category").queryKey).toEqual([
      "archive-layout-settings",
      "category",
    ]);
    expect(archiveLayoutQueryOptions("tag").queryKey).toEqual(["archive-layout-settings", "tag"]);
  });

  it("zapytanie filtruje po rodzaju archiwum", async () => {
    await load("tag", null);
    expect(stub().lastChain("archive_layout_settings")?.argsOf("eq")).toEqual([
      "archive_type",
      "tag",
    ]);
  });

  it("czyta POJEDYNCZY wiersz i toleruje jego brak", async () => {
    await load("category", null);
    expect(stub().lastChain("archive_layout_settings")?.has("maybeSingle")).toBe(true);
  });

  it("błąd odczytu wychodzi na wierzch", async () => {
    await expect(load("category", null, "odmowa odczytu")).rejects.toThrow("odmowa odczytu");
  });
});

describe("coerce - brak wiersza", () => {
  it("oddaje komplet wartości domyślnych z pustym identyfikatorem", async () => {
    // Świeży tenant nie ma jeszcze wiersza; archiwum musi się wtedy wyrenderować
    // w konfiguracji domyślnej, a nie paść na `null`.
    const out = await load("category", null);
    expect(out).toEqual({ id: "", archive_type: "category", ...DEFAULT_ARCHIVE_LAYOUT });
  });

  it("zapamiętuje rodzaj archiwum, o który pytano", async () => {
    expect((await load("tag", null)).archive_type).toBe("tag");
  });
});

describe("coerce - wiersz poprawny", () => {
  it("przepuszcza wszystkie wartości bez zmian", async () => {
    const out = await load("category", dbRow());
    expect(out).toMatchObject({
      id: "row-1",
      layout_variant: 3,
      columns: 2,
      list_style: "masonry",
      sidebar_position: "left",
      hero_bg_style: "mesh",
      posts_per_page: 24,
      show_sidebar: true,
      show_related_taxonomies: true,
    });
  });

  it("zachowuje flagi ustawione na FAŁSZ", async () => {
    // Naiwne `?? domyślna` zamieniłoby świadome wyłączenie hero z powrotem
    // na włączone.
    const out = await load("category", dbRow());
    expect(out.show_hero).toBe(false);
    expect(out.show_description).toBe(false);
    expect(out.show_podcasts).toBe(false);
  });
});

describe("coerce - wartości spoza zakresu", () => {
  it("KLAMRUJE wariant układu do zakresu 1-6", async () => {
    expect((await load("category", dbRow({ layout_variant: 99 }))).layout_variant).toBe(6);
    expect((await load("category", dbRow({ layout_variant: 0 }))).layout_variant).toBe(1);
    expect((await load("category", dbRow({ layout_variant: -5 }))).layout_variant).toBe(1);
  });

  it("KLAMRUJE liczbę kolumn do zakresu 1-4", async () => {
    // Zero kolumn to siatka bez treści; dwanaście to nieczytelna kaszanka.
    expect((await load("category", dbRow({ columns: 12 }))).columns).toBe(4);
    expect((await load("category", dbRow({ columns: 0 }))).columns).toBe(1);
  });

  it("wartości skrajne zakresu przechodzą nietknięte", async () => {
    expect((await load("category", dbRow({ layout_variant: 1, columns: 1 }))).columns).toBe(1);
    expect((await load("category", dbRow({ layout_variant: 6, columns: 4 }))).layout_variant).toBe(
      6,
    );
  });

  it("nieznany rodzaj archiwum skleja się do kategorii", async () => {
    // Kolumna jest tekstowa; jedynym wariantem innym niż kategoria jest tag.
    expect((await load("category", dbRow({ archive_type: "cokolwiek" }))).archive_type).toBe(
      "category",
    );
    expect((await load("category", dbRow({ archive_type: "tag" }))).archive_type).toBe("tag");
  });

  it("brak stylu listy spada na siatkę", async () => {
    expect((await load("category", dbRow({ list_style: null }))).list_style).toBe("grid");
  });

  it("brak pozycji panelu bocznego spada na prawą stronę", async () => {
    expect((await load("category", dbRow({ sidebar_position: null }))).sidebar_position).toBe(
      "right",
    );
  });

  it("brak tła hero spada na gradient", async () => {
    expect((await load("category", dbRow({ hero_bg_style: null }))).hero_bg_style).toBe("gradient");
  });
});

describe("coerce - widgety panelu bocznego", () => {
  it("ODSIEWA klucze spoza katalogu", async () => {
    // Klucz z przyszłej wersji albo literówka nie może dotrzeć do renderera -
    // panel boczny próbowałby wyrenderować widget, którego nie ma.
    const out = await load(
      "category",
      dbRow({ sidebar_widgets: ["popular", "nieznany", "ads", 42, null] }),
    );
    expect(out.sidebar_widgets).toEqual(["popular", "ads"]);
  });

  it("przepuszcza pełny katalog w zapisanej kolejności", async () => {
    const order = ["ads", "newsletter", "related", "popular"];
    expect((await load("category", dbRow({ sidebar_widgets: order }))).sidebar_widgets).toEqual(
      order,
    );
  });

  it("pusta lista jest UZNAWANĄ decyzją, nie brakiem", async () => {
    // Redaktor może świadomie wyłączyć wszystkie widgety - to nie to samo, co
    // brak zapisu, więc lista nie może wtedy wracać do domyślnej.
    expect((await load("category", dbRow({ sidebar_widgets: [] }))).sidebar_widgets).toEqual([]);
  });

  it("wartość, która NIE jest listą, spada na katalog domyślny", async () => {
    for (const broken of [null, "popular", 42, { a: 1 }]) {
      const out = await load("category", dbRow({ sidebar_widgets: broken }));
      expect(out.sidebar_widgets).toEqual(DEFAULT_ARCHIVE_LAYOUT.sidebar_widgets);
    }
  });
});

describe("DEFAULT_ARCHIVE_LAYOUT", () => {
  it("mieści się we własnych zakresach", async () => {
    // Domyślne wartości muszą przechodzić tę samą bramkę, co wiersz z bazy -
    // inaczej `coerce` klamrowałby własne wartości domyślne.
    expect(DEFAULT_ARCHIVE_LAYOUT.layout_variant).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_ARCHIVE_LAYOUT.layout_variant).toBeLessThanOrEqual(6);
    expect(DEFAULT_ARCHIVE_LAYOUT.columns).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_ARCHIVE_LAYOUT.columns).toBeLessThanOrEqual(4);
  });

  it("domyślne widgety są WYŁĄCZNIE kluczami z katalogu", async () => {
    const out = await load(
      "category",
      dbRow({ sidebar_widgets: [...DEFAULT_ARCHIVE_LAYOUT.sidebar_widgets] }),
    );
    expect(out.sidebar_widgets).toEqual(DEFAULT_ARCHIVE_LAYOUT.sidebar_widgets);
  });

  it("liczba wpisów na stronę jest dodatnia", async () => {
    expect(DEFAULT_ARCHIVE_LAYOUT.posts_per_page).toBeGreaterThan(0);
  });
});
