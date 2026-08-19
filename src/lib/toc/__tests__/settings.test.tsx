// Warstwa ustawień spisu treści. Stan wyjściowy: 51,2% linii i 1 z 10 funkcji -
// martwe były `mergeTocSettings`, `extractHeadingsFromBlocks`, `countHeadings`,
// `countPostHeadings`, `useTocDefaults` i `useSaveTocDefaults`, czyli CAŁA
// ścieżka od dokumentu wpisu do spisu treści widzianego przez czytelnika oraz
// cały zapis panelu.
//
// Cztery reguły, których złamanie widzi użytkownik:
//
//   1. SCALANIE Z NADPISANIEM PER WPIS. `null` w nadpisaniu znaczy „użyj
//      globalnych", nie „wyłącz". Pomylenie tych dwóch znaczeń gasi spis treści
//      na wszystkich wpisach, które nigdy niczego nie nadpisały.
//   2. KOTWICE POCHODZĄ Z JEDNEJ DERYWACJI. `href="#…"` w spisie treści i `id`
//      w wyrenderowanym `<h2>` muszą być IDENTYCZNE - także wtedy, gdy dokument
//      ma dwa nagłówki o tej samej treści (deduplikacja `-2`).
//   3. NIEPOPRAWNY WIERSZ W BAZIE NIE GASI STRONY. `useTocDefaults` degraduje do
//      wartości domyślnych, zamiast puszczać dalej wynik nieudanej walidacji.
//   4. ZAPIS JEST UPSERTEM Z JAWNYM KONFLIKTEM `tenant_id,key`. Bez tego panel
//      jednego obszaru roboczego zapisywałby w cudzym wierszu albo w żadnym.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
}));

// Fabryka atrapy importuje WYŁĄCZNIE `@/test/supabaseChain` - moduł bez ani
// jednego importu z produkcji. Sięgnięcie tu po `@/test/postExperience/fixtures`
// zawieszało cały plik: fixture'y importują `@/lib/toc/settings`, ten importuje
// mockowanego klienta, a jego fabryka czekała na fixture'y - zamknięty cykl
// inicjalizacji modułów.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import {
  TOC_COLUMNS,
  TOC_DEFAULTS,
  TOC_LAYOUTS,
  TOC_SETTING_KEY,
  TocDefaultsSchema,
  countHeadings,
  countPostHeadings,
  extractHeadingsFromBlockList,
  extractHeadingsFromBlocks,
  mergeTocSettings,
  slugifyHeading,
  useSaveTocDefaults,
  useTocDefaults,
  type TocDefaults,
} from "@/lib/toc/settings";
import {
  SITE_SETTINGS_QUERY_KEY,
  blocksDoc,
  fail,
  headingBlock,
  headingLadderDoc,
  ok,
  paragraphBlock,
  tocDefaults,
  tocOverride,
  type SupabaseFromStub,
} from "@/test/postExperience/fixtures";
import { resetPendingWrites } from "@/lib/useSiteSetting";

const from = () => stubs.from as SupabaseFromStub;

function harness(settings?: Record<string, unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (settings) queryClient.setQueryData(SITE_SETTINGS_QUERY_KEY, settings);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  from().reset();
  resetPendingWrites();
});

describe("mergeTocSettings - globalne + nadpisanie per wpis", () => {
  it("brak nadpisania zwraca globalne BEZ kopiowania (ta sama referencja)", () => {
    const defaults = tocDefaults();
    expect(mergeTocSettings(defaults, null)).toBe(defaults);
    expect(mergeTocSettings(defaults, undefined)).toBe(defaults);
  });

  it("`null` w polu znaczy: uzyj globalnych, a NIE: wylacz", () => {
    const defaults = tocDefaults({ enabled: true, sticky: true, position: 7 });
    const merged = mergeTocSettings(defaults, tocOverride());
    expect(merged.enabled).toBe(true);
    expect(merged.sticky).toBe(true);
    expect(merged.position).toBe(7);
  });

  it("nadpisuje wyłącznie podane pola, resztę bierze z globalnych", () => {
    const defaults = tocDefaults({ layout: "boxed", columns: "col-1", minHeadings: 4 });
    const merged = mergeTocSettings(defaults, tocOverride({ layout: "inline" }));
    expect(merged.layout).toBe("inline");
    expect(merged.columns).toBe("col-1");
    expect(merged.minHeadings).toBe(4);
  });

  it("nadpisanie `enabled: false` faktycznie gasi spis treści", () => {
    const merged = mergeTocSettings(
      tocDefaults({ enabled: true }),
      tocOverride({ enabled: false }),
    );
    expect(merged.enabled).toBe(false);
    expect(TOC_DEFAULTS.enabled).toBe(true);
  });

  it("nadpisanie `position: 0` (na górze) nie jest gubione jako wartość falsy", () => {
    const merged = mergeTocSettings(tocDefaults({ position: 3 }), tocOverride({ position: 0 }));
    expect(merged.position).toBe(0);
    expect(merged.showInBody).toBe(TOC_DEFAULTS.showInBody);
  });

  it("nadpisanie `position: -1` (tylko sidebar) przechodzi bez zmiany znaku", () => {
    const merged = mergeTocSettings(tocDefaults(), tocOverride({ position: -1 }));
    expect(merged.position).toBe(-1);
    expect(merged.enabled).toBe(true);
  });

  it("nadpisanie `showInBody: false` przy globalnym `true` gasi ToC w treści", () => {
    const merged = mergeTocSettings(
      tocDefaults({ showInBody: true }),
      tocOverride({ showInBody: false }),
    );
    expect(merged.showInBody).toBe(false);
    expect(merged.layout).toBe(TOC_DEFAULTS.layout);
  });

  it("pole nadmiarowe w nadpisaniu nie przecieka do wyniku", () => {
    const merged = mergeTocSettings(tocDefaults({ minLevel: 2 }), {
      ...tocOverride({ sticky: true }),
      // Pole, którego schemat nadpisania nie zna (np. zostawione po starszej
      // wersji panelu) - scalanie wybiera pola JAWNIE, więc nie ma jak wejść.
      minLevel: 5,
    } as NonNullable<ReturnType<typeof tocOverride>>);
    expect(merged.minLevel).toBe(2);
    expect(merged.sticky).toBe(true);
  });

  it("nie mutuje wejściowych globalnych", () => {
    const defaults = tocDefaults({ layout: "boxed" });
    mergeTocSettings(defaults, tocOverride({ layout: "sticky-sidebar" }));
    expect(defaults.layout).toBe("boxed");
  });
});

describe("TocDefaultsSchema - domykanie braków i odsiew niezgodnych typów", () => {
  it("pusty obiekt daje pełny zestaw wartości domyślnych", () => {
    const parsed = TocDefaultsSchema.parse({});
    expect(parsed).toEqual(TOC_DEFAULTS);
    expect(parsed.colors.accent).toBe("#fa9346");
  });

  it("brakujące pole zagnieżdżone jest domykane, podane zostaje", () => {
    const parsed = TocDefaultsSchema.parse({ colors: { accent: "#123456" } });
    expect(parsed.colors.accent).toBe("#123456");
    expect(parsed.colors.bg).toBe(TOC_DEFAULTS.colors.bg);
  });

  it("typ niezgodny odrzuca cały zapis (safeParse nie przechodzi)", () => {
    expect(TocDefaultsSchema.safeParse({ enabled: "tak" }).success).toBe(false);
    expect(TocDefaultsSchema.safeParse({ layout: "karuzela" }).success).toBe(false);
  });

  it("pozycja poza zakresem -1..20 jest odrzucana", () => {
    expect(TocDefaultsSchema.safeParse({ position: -2 }).success).toBe(false);
    expect(TocDefaultsSchema.safeParse({ position: 21 }).success).toBe(false);
  });

  it("każdy wariant układu i kolumn z katalogu przechodzi walidację", () => {
    for (const layout of TOC_LAYOUTS) {
      expect(TocDefaultsSchema.safeParse({ layout }).success).toBe(true);
    }
    for (const columns of TOC_COLUMNS) {
      expect(TocDefaultsSchema.safeParse({ columns }).success).toBe(true);
    }
  });
});

describe("extractHeadingsFromBlocks - nagłówki z dokumentu blokowego", () => {
  it("dokument pusty / null / undefined daje pustą listę", () => {
    expect(extractHeadingsFromBlocks(null)).toEqual([]);
    expect(extractHeadingsFromBlocks(undefined)).toEqual([]);
    expect(extractHeadingsFromBlocks(blocksDoc())).toEqual([]);
  });

  it("bierze WYŁĄCZNIE bloki typu heading", () => {
    const doc = blocksDoc(
      paragraphBlock("Wstęp bez nagłówka"),
      headingBlock(2, "Sekcja"),
      paragraphBlock("Treść sekcji"),
    );
    const items = extractHeadingsFromBlocks(doc);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("Sekcja");
  });

  it("zachowuje kolejność dokumentu i poziomy", () => {
    const items = extractHeadingsFromBlocks(headingLadderDoc());
    expect(items.map((i) => i.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(items[0].text).toBe("Tytuł główny");
  });

  it("nagłówek pusty (sam tekst albo same białe znaki) jest pomijany", () => {
    const doc = blocksDoc(
      headingBlock(2, "", "h-empty"),
      headingBlock(2, "   ", "h-blank"),
      headingBlock(2, "Realny"),
    );
    const items = extractHeadingsFromBlocks(doc);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("Realny");
  });

  it("poziom poza 1..6 jest przycinany do zakresu", () => {
    const doc = blocksDoc(headingBlock(0, "Za nisko"), headingBlock(9, "Za wysoko"));
    const items = extractHeadingsFromBlocks(doc);
    expect(items[0].level).toBe(1);
    expect(items[1].level).toBe(6);
  });

  it("brak pola `level` degraduje do H2, nie do NaN", () => {
    const doc = blocksDoc({ id: "h-nolevel", type: "heading", data: { text: "Bez poziomu" } });
    const items = extractHeadingsFromBlocks(doc);
    expect(items[0].level).toBe(2);
    expect(Number.isFinite(items[0].level)).toBe(true);
  });

  it("nagłówek zapisany jako inline HTML jest sprowadzany do tekstu", () => {
    const doc = blocksDoc(headingBlock(2, "Rola <strong>UE</strong> w regionie"));
    const items = extractHeadingsFromBlocks(doc);
    expect(items[0].text).toBe("Rola UE w regionie");
    expect(items[0].text).not.toContain("<strong>");
  });

  it("PARYTET KOTWIC: dwa nagłówki o tej samej treści dostają RÓŻNE kotwice", () => {
    const doc = blocksDoc(
      headingBlock(2, "Wnioski", "h-a"),
      paragraphBlock("Środek"),
      headingBlock(2, "Wnioski", "h-b"),
    );
    const items = extractHeadingsFromBlocks(doc);
    expect(items).toHaveLength(2);
    expect(items[0].anchor).not.toBe(items[1].anchor);
  });

  it("PARYTET SLUGOWANIA: kotwica przechodzi przez kanoniczny slugifikator (litera l z kreska)", () => {
    const doc = blocksDoc(headingBlock(2, "Ochrona małych przedsiębiorstw"));
    const items = extractHeadingsFromBlocks(doc);
    // Ten sam slugifikator, którego używa renderer nagłówków - inaczej spis
    // treści linkowałby do `#…-ma-ych-…`, a `id` w `<h2>` brzmiałoby inaczej.
    expect(items[0].anchor).toBe(slugifyHeading("Ochrona małych przedsiębiorstw"));
    expect(items[0].anchor).toContain("malych");
  });

  it("wariant na płaskiej liście bloków daje ten sam wynik co na dokumencie", () => {
    const doc = headingLadderDoc();
    expect(extractHeadingsFromBlockList(doc.blocks)).toEqual(extractHeadingsFromBlocks(doc));
  });

  it("płaska lista pusta / null / undefined daje pustą listę", () => {
    expect(extractHeadingsFromBlockList([])).toEqual([]);
    expect(extractHeadingsFromBlockList(null)).toEqual([]);
    expect(extractHeadingsFromBlockList(undefined)).toEqual([]);
  });
});

describe("countHeadings / countPostHeadings", () => {
  it("liczy per poziom i sumuje", () => {
    const counts = countHeadings(extractHeadingsFromBlocks(headingLadderDoc()));
    expect(counts.total).toBe(6);
    expect(counts).toMatchObject({ h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1 });
  });

  it("pusta lista daje zera na każdym poziomie", () => {
    const counts = countHeadings([]);
    expect(counts.total).toBe(0);
    expect(counts.h2).toBe(0);
  });

  it("pominięty poziom zostaje zerem, a nie dziurą w obiekcie", () => {
    const doc = blocksDoc(headingBlock(2, "Alfa"), headingBlock(4, "Beta"));
    const counts = countHeadings(extractHeadingsFromBlocks(doc));
    expect(counts.h3).toBe(0);
    expect(counts).toMatchObject({ h2: 1, h4: 1, total: 2 });
  });

  it("liczy nagłówki NIEZALEŻNIE dla obu języków wpisu", () => {
    const counts = countPostHeadings({
      pl: blocksDoc(headingBlock(2, "Sekcja"), headingBlock(3, "Podsekcja")),
      en: blocksDoc(headingBlock(2, "Section")),
    });
    expect(counts.pl.total).toBe(2);
    expect(counts.en.total).toBe(1);
  });

  it("brak dokumentu w jednym języku daje tam zera, nie wyjątek", () => {
    const counts = countPostHeadings({ pl: blocksDoc(headingBlock(2, "Sekcja")) } as never);
    expect(counts.pl.total).toBe(1);
    expect(counts.en.total).toBe(0);
  });

  it("brak całego wpisu (`null`) daje zera dla obu języków", () => {
    const counts = countPostHeadings(null);
    expect(counts.pl.total).toBe(0);
    expect(counts.en.total).toBe(0);
  });
});

describe("useTocDefaults - odczyt globalnych ustawień", () => {
  it("brak wiersza w site_settings daje wartości domyślne", async () => {
    const { wrapper } = harness({});
    const { result } = renderHook(() => useTocDefaults(), { wrapper });
    await waitFor(() => expect(result.current.layout).toBe(TOC_DEFAULTS.layout));
    expect(result.current.enabled).toBe(true);
  });

  it("wiersz częściowy jest domykany defaultami (bez `undefined` w zagnieżdżeniach)", async () => {
    const { wrapper } = harness({ [TOC_SETTING_KEY]: { layout: "inline", minHeadings: 5 } });
    const { result } = renderHook(() => useTocDefaults(), { wrapper });
    await waitFor(() => expect(result.current.layout).toBe("inline"));
    expect(result.current.colors.accent).toBe(TOC_DEFAULTS.colors.accent);
    expect(result.current.minHeadings).toBe(5);
  });

  it("USZKODZONY wiersz degraduje do defaultów, zamiast gasić stronę", async () => {
    const { wrapper } = harness({ [TOC_SETTING_KEY]: { layout: "karuzela", position: 999 } });
    const { result } = renderHook(() => useTocDefaults(), { wrapper });
    await waitFor(() => expect(result.current.layout).toBe(TOC_DEFAULTS.layout));
    expect(result.current.position).toBe(TOC_DEFAULTS.position);
  });

  it("wartość nie-obiektowa (np. napis) też degraduje do defaultów", async () => {
    const { wrapper } = harness({ [TOC_SETTING_KEY]: "boxed" });
    const { result } = renderHook(() => useTocDefaults(), { wrapper });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(result.current.layout).toBe(TOC_DEFAULTS.layout);
  });
});

describe("useSaveTocDefaults - zapis panelu", () => {
  function draft(overrides: Partial<TocDefaults> = {}): TocDefaults {
    return tocDefaults({ layout: "inline", minHeadings: 4, ...overrides });
  }

  it("zapisuje przez UPSERT na site_settings z kluczem konfliktu `tenant_id,key`", async () => {
    from().setResponse("site_settings", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveTocDefaults(), { wrapper });

    await result.current.mutateAsync(draft());

    const chain = from().lastChain("site_settings");
    expect(chain?.has("upsert")).toBe(true);
    expect(chain?.argsOf("upsert")?.[1]).toEqual({ onConflict: "tenant_id,key" });
  });

  it("wysyła KLUCZ ustawienia i wartość draftu", async () => {
    from().setResponse("site_settings", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveTocDefaults(), { wrapper });

    await result.current.mutateAsync(draft({ sticky: true }));

    const row = from().lastChain("site_settings")?.argsOf("upsert")?.[0] as {
      key: string;
      value: TocDefaults;
    };
    expect(row.key).toBe(TOC_SETTING_KEY);
    expect(row.value).toMatchObject({ layout: "inline", sticky: true });
  });

  it("sukces unieważnia zbiorczy cache ustawień i potwierdza zapis użytkownikowi", async () => {
    from().setResponse("site_settings", ok(null));
    const { wrapper, queryClient } = harness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveTocDefaults(), { wrapper });

    await result.current.mutateAsync(draft());

    expect(invalidate).toHaveBeenCalledWith({ queryKey: SITE_SETTINGS_QUERY_KEY });
    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("zwraca zapisany draft, żeby wywołujący odświeżył formularz tym, co poszło do bazy", async () => {
    from().setResponse("site_settings", ok(null));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveTocDefaults(), { wrapper });

    const returned = await result.current.mutateAsync(draft({ ordered: true }));

    expect(returned.ordered).toBe(true);
    expect(returned.layout).toBe("inline");
  });

  it("BŁĄD BAZY nie jest cichym sukcesem: mutacja rzuca i pokazuje komunikat", async () => {
    from().setResponse("site_settings", fail("permission denied for table site_settings"));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveTocDefaults(), { wrapper });

    await expect(result.current.mutateAsync(draft())).rejects.toThrow(/permission denied/);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("błąd bez treści komunikatu nadal daje komunikat dla użytkownika", async () => {
    from().setResponse("site_settings", fail(""));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSaveTocDefaults(), { wrapper });

    await expect(result.current.mutateAsync(draft())).rejects.toThrow();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError.mock.calls[0][0]).toBeTruthy();
  });
});
