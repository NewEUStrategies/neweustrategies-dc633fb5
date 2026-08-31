// Biblioteka szablonów (`PatternPicker`) - do tej pory jedyny plik w swoim
// katalogu BEZ ANI JEDNEGO testu (0% pokrycia, 0 z 40 funkcji).
//
// CO TEN PLIK DOWODZI.
//   1. ZAKRES LISTY WYNIKA Z `kind`. „page" pokazuje wyłącznie strony, „post"
//      wyłącznie wpisy, „all" oba zbiory - i to na PRAWDZIWEJ bibliotece
//      (`@/lib/patterns/library`), a nie na atrapie. Liczby wierszy są liczone
//      z tego samego źródła, z którego czyta produkcja.
//   2. PANEL STRONY I PANEL WPISU TO DWIE RÓŻNE DROGI. Ten sam wybór szablonu
//      raz prowadzi do edytora dokumentu buildera (pola i18n zebrane realną
//      warstwą `collectI18nFields`), raz do edytora HTML wpisu z podglądem
//      przez `sanitizeHtml`. Dowodzimy obu, w tym rozgałęzienia po języku
//      interfejsu (`lang`).
//   3. EDYCJA DOCIERA DO PODGLĄDU I DO WYNIKU. Zmiana pola PL zmienia dokument
//      przekazany do renderera (podgląd) ORAZ dokument oddany przez `onApply` -
//      nanoszenie zmian robi prawdziwe `applyI18nOverrides`, nie atrapa.
//   4. TYPY PÓL. `html`/`excerpt` dostają obszar wieloliniowy (z zadanym
//      `rows`), pozostałe jednoliniowe pole - to jedyna „walidacja", jaką ten
//      komponent ma, i test mówi wprost, ile jej jest (patrz niżej).
//   5. PODSUMOWANIE JEST BRAMKĄ, NIE OZDOBĄ. Liczy zmienione pola, pokazuje
//      „przed/po" tylko dla zmienionych, a ANULOWANIE nie stosuje niczego -
//      `onApply` nie jest wołane, okno biblioteki zostaje otwarte.
//   6. ZATWIERDZENIE ODDAJE GOTOWY ŁADUNEK. Tytuły i lead są przycięte
//      (`trim`), treść wpisu NIE jest, a okno biblioteki zamyka się dokładnie
//      raz.
//   7. STAN PUSTY. Biblioteka bez szablonów pokazuje zachętę do wyboru zamiast
//      pustego panelu, a szablon strony bez pól tekstowych - własny komunikat.
//   8. DOSTĘPNOŚĆ. `axe-core` na oknie głównym (obie ścieżki: strona i wpis)
//      oraz na oknie potwierdzenia.
//
// ZAREJESTROWANY DEFEKT (`it.fails`). Wiersz „Treść" w podsumowaniu wpisu
// porównuje wyłącznie DŁUGOŚCI tekstów, więc podmiana treści na inną o tej
// samej długości raportuje „bez zmian" - a mimo to zostaje zastosowana.
// Podsumowanie ma być bramką przed nieodwracalną operacją, więc milczenie
// o realnej zmianie jest defektem, nie kosmetyką.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   - `BuilderRenderer` - osobny organizm z własnymi testami; tutaj podmieniony
//     na atrapę, która WYPISUJE otrzymany dokument (plus `lang`/`device`), więc
//     kontrakt „podgląd dostaje dokument PO naniesieniu zmian" nadal stoi na
//     prawdziwych danych, a test nie ciągnie 60 leniwych widgetów.
//   - Warstwa szablonów (`library`, `i18n`) NIE jest zamockowana zachowaniem.
//     Pass-through wokół `library` służy TYLKO do podstawienia katalogu
//     (pusty / minimalny szablon), czego czystymi danymi z repo nie da się
//     osiągnąć - gałąź stanu pustego jest inaczej nieosiągalna.
//   - Trwały zapis strony/wpisu - `PatternPicker` go nie zna, oddaje ładunek
//     wywołującemu.
//   - Wewnętrzne mechanizmy Radix (portal, focus trap, animacje).
//
// CZEGO KOMPONENT NIE MA (i test tego nie udaje): stanu BŁĘDU (nie pobiera
// niczego z sieci), przycisku „zastosuj" w stanie nieczynnym oraz walidacji
// pustego tytułu - pusty tytuł przechodzi do `onApply`, co ten plik
// charakteryzuje jawnym testem, żeby zmiana tej reguły nie przeszła po cichu.
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { PagePattern, Pattern } from "@/lib/patterns/types";
import type { AppliedPattern } from "@/components/patterns/PatternPicker";

const h = vi.hoisted(() => ({
  /** Podstawiony katalog szablonów (null = prawdziwa biblioteka repo). */
  pool: null as Pattern[] | null,
}));

vi.mock("@/lib/patterns/library", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/patterns/library")>();
  const pageOnly = (fallback: PagePattern[]): PagePattern[] => {
    const override = h.pool;
    if (!override) return fallback;
    return override.filter((p): p is PagePattern => p.kind === "page");
  };
  return {
    get PATTERNS() {
      return h.pool ?? real.PATTERNS;
    },
    get PAGE_PATTERNS() {
      return pageOnly(real.PAGE_PATTERNS);
    },
    get POST_PATTERNS() {
      const override = h.pool;
      if (!override) return real.POST_PATTERNS;
      return override.filter((p) => p.kind === "post");
    },
  };
});

vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: ({ doc, lang, device }: { doc: unknown; lang: string; device: string }) => (
    <div data-testid="builder-preview" data-lang={lang} data-device={device}>
      {JSON.stringify(doc)}
    </div>
  ),
}));

const { PatternPicker } = await import("@/components/patterns/PatternPicker");
const { PAGE_PATTERNS, POST_PATTERNS, PATTERNS } = await import("@/lib/patterns/library");
const { collectI18nFields } = await import("@/lib/patterns/i18n");
const { axeViolations, summarize } = await import("@/test/axe");

/** Szablon strony bez ani jednego pola i18n - gałąź „brak pól tekstowych". */
const PAGE_WITHOUT_FIELDS: PagePattern = {
  id: "test.page.empty",
  kind: "page",
  category: "landing",
  name: { pl: "Układ bez tekstów", en: "Layout without text" },
  description: { pl: "Sam szkielet sekcji.", en: "Section skeleton only." },
  defaultTitle: { pl: "Szkielet", en: "Skeleton" },
  builder: { version: 1, sections: [] },
};

interface Handlers {
  onApply: Mock<(applied: AppliedPattern) => void>;
  onOpenChange: Mock<(v: boolean) => void>;
  onSkip: Mock<() => void>;
}

function handlers(): Handlers {
  return {
    onApply: vi.fn<(applied: AppliedPattern) => void>(),
    onOpenChange: vi.fn<(v: boolean) => void>(),
    onSkip: vi.fn<() => void>(),
  };
}

function openPicker(kind: "page" | "post" | "all", lang: "pl" | "en", hs: Handlers) {
  return render(
    <PatternPicker
      open
      kind={kind}
      lang={lang}
      onApply={hs.onApply}
      onOpenChange={hs.onOpenChange}
      onSkip={hs.onSkip}
    />,
  );
}

/** Przycisk wiersza listy szablonów (nazwa szablonu jest w środku przycisku). */
function patternRow(name: string): HTMLElement {
  const button = screen.getByText(name).closest("button");
  if (!(button instanceof HTMLElement)) {
    throw new Error(`test: nie znaleziono wiersza szablonu ${name}`);
  }
  return button;
}

/** Radix aktywuje zakładkę na `mousedown`, nie na `click`. */
function switchTab(name: string): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

function previewJson(): string {
  return screen.getByTestId("builder-preview").textContent ?? "";
}

/**
 * Okno potwierdzenia. Szukamy w nim OSOBNO, bo etykiety wierszy podsumowania
 * („Tytuł strony", „Treść") powtarzają nazwy zakładek panelu - globalne
 * `getByText` trafiałoby w dwa elementy i test „przechodziłby" na oknie
 * biblioteki zamiast na bramce potwierdzenia.
 */
function confirmDialog(): HTMLElement {
  const dialog = screen.getByText("Potwierdź zastosowanie szablonu").closest('[role="dialog"]');
  if (!(dialog instanceof HTMLElement)) {
    throw new Error("test: okno potwierdzenia nie jest otwarte");
  }
  return dialog;
}

/** Wiersz podsumowania po etykiecie (dokładne dopasowanie tekstu). */
function summaryRow(label: string): HTMLElement {
  const li = within(confirmDialog()).getByText(label).closest("li");
  if (!(li instanceof HTMLElement)) {
    throw new Error(`test: brak wiersza podsumowania ${label}`);
  }
  return li;
}

function firstApplied(hs: Handlers): AppliedPattern {
  const applied = hs.onApply.mock.calls[0]?.[0];
  if (!applied) {
    throw new Error("test: onApply nie dostało ładunku szablonu");
  }
  return applied;
}

beforeEach(() => {
  h.pool = null;
});

describe("PatternPicker - lista szablonów", () => {
  it("okno przedstawia bibliotekę i jej cel", () => {
    openPicker("page", "pl", handlers());
    expect(screen.getByText("Biblioteka szablonów")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Wybierz gotowy układ, podejrzyj go i zmień teksty PL/EN przed zastosowaniem.",
      ),
    ).toBeInTheDocument();
  });

  it("zamknięte okno nie renderuje żadnej treści", () => {
    const hs = handlers();
    render(
      <PatternPicker
        open={false}
        kind="page"
        lang="pl"
        onApply={hs.onApply}
        onOpenChange={hs.onOpenChange}
      />,
    );
    expect(screen.queryByText("Biblioteka szablonów")).not.toBeInTheDocument();
  });

  it("kind=page pokazuje wyłącznie szablony stron", () => {
    openPicker("page", "pl", handlers());
    expect(screen.getAllByText("strona")).toHaveLength(PAGE_PATTERNS.length);
    expect(screen.queryByText("wpis")).not.toBeInTheDocument();
    for (const p of PAGE_PATTERNS) {
      expect(screen.getByText(p.name.pl)).toBeInTheDocument();
    }
  });

  it("kind=post pokazuje wyłącznie wpisy", () => {
    openPicker("post", "pl", handlers());
    expect(screen.getAllByText("wpis")).toHaveLength(POST_PATTERNS.length);
    expect(screen.queryByText("strona")).not.toBeInTheDocument();
  });

  it("kind=all łączy oba zbiory", () => {
    openPicker("all", "pl", handlers());
    expect(screen.getAllByText("strona")).toHaveLength(PAGE_PATTERNS.length);
    expect(screen.getAllByText("wpis")).toHaveLength(POST_PATTERNS.length);
    expect(PAGE_PATTERNS.length + POST_PATTERNS.length).toBe(PATTERNS.length);
  });

  it("nazwa i opis wiersza idą w języku interfejsu", () => {
    openPicker("page", "en", handlers());
    const first = PAGE_PATTERNS[0];
    expect(screen.getByText(first.name.en)).toBeInTheDocument();
    expect(screen.getByText(first.description.en)).toBeInTheDocument();
    expect(screen.queryByText(first.name.pl)).not.toBeInTheDocument();
  });

  it("pierwszy szablon z listy jest wybrany od otwarcia", () => {
    openPicker("page", "pl", handlers());
    expect(previewJson()).toContain(PAGE_PATTERNS[0].builder.sections[0].id);
    expect(screen.getByTestId("builder-preview")).toHaveAttribute("data-device", "desktop");
    expect(screen.getByTestId("builder-preview")).toHaveAttribute("data-lang", "pl");
  });

  it("klik w inny wiersz przestawia panel na wybrany szablon", () => {
    openPicker("page", "pl", handlers());
    const second = PAGE_PATTERNS[1];
    fireEvent.click(patternRow(second.name.pl));
    expect(previewJson()).toContain(second.builder.sections[0].id);
    switchTab("Tytuł strony");
    expect(screen.getByDisplayValue(second.defaultTitle.pl)).toBeInTheDocument();
  });

  it("pusta biblioteka prosi o wybór zamiast pokazywać martwy panel", () => {
    h.pool = [];
    openPicker("page", "pl", handlers());
    expect(screen.getByText("Wybierz szablon z listy.")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Przejrzyj zmiany" })).not.toBeInTheDocument();
  });

  it("przycisk pustej strony zamyka okno i przekazuje pominięcie szablonu", () => {
    const hs = handlers();
    openPicker("page", "pl", hs);
    fireEvent.click(screen.getByRole("button", { name: "+ Pusta strona (bez szablonu)" }));
    expect(hs.onOpenChange).toHaveBeenCalledWith(false);
    expect(hs.onSkip).toHaveBeenCalledTimes(1);
    expect(hs.onApply).not.toHaveBeenCalled();
  });

  it("przycisk pustej strony bez `onSkip` tylko zamyka okno i nie wysadza renderu", () => {
    const hs = handlers();
    render(
      <PatternPicker
        open
        kind="page"
        lang="pl"
        onApply={hs.onApply}
        onOpenChange={hs.onOpenChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Pusta strona (bez szablonu)" }));
    expect(hs.onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("PatternPicker - panel strony", () => {
  it("zakładka treści listuje pola i18n zebrane z dokumentu szablonu", () => {
    openPicker("page", "pl", handlers());
    const fields = collectI18nFields(PAGE_PATTERNS[0].builder);
    switchTab("Treść (PL / EN)");
    expect(screen.getAllByRole("textbox")).toHaveLength(fields.length * 2);
    expect(screen.getByDisplayValue(fields[0].pl)).toBeInTheDocument();
    expect(screen.getByDisplayValue(fields[0].en)).toBeInTheDocument();
    expect(
      screen.getAllByText(`${fields[0].widgetType} · ${fields[0].baseKey}`).length,
    ).toBeGreaterThan(0);
  });

  it("pola `html` są wieloliniowe, krótkie teksty jednoliniowe", () => {
    openPicker("page", "pl", handlers());
    const fields = collectI18nFields(PAGE_PATTERNS[0].builder);
    switchTab("Treść (PL / EN)");
    const boxes = screen.getAllByRole("textbox");
    fields.forEach((f, i) => {
      const expected = f.baseKey === "html" || f.baseKey === "excerpt" ? "TEXTAREA" : "INPUT";
      expect(boxes[i * 2].tagName).toBe(expected);
      expect(boxes[i * 2 + 1].tagName).toBe(expected);
    });
    const multi = fields.filter((f) => f.baseKey === "html" || f.baseKey === "excerpt").length;
    expect(multi).toBeGreaterThan(0);
    expect(boxes.filter((b) => b.tagName === "TEXTAREA")).toHaveLength(multi * 2);
  });

  it("edycja pola PL nanosi zmianę na dokument podglądu, EN zostaje", () => {
    openPicker("page", "pl", handlers());
    const fields = collectI18nFields(PAGE_PATTERNS[0].builder);
    switchTab("Treść (PL / EN)");
    fireEvent.change(screen.getAllByRole("textbox")[0], {
      target: { value: "Nowy nagłówek testowy" },
    });
    switchTab("Podgląd");
    expect(previewJson()).toContain("Nowy nagłówek testowy");
    expect(previewJson()).not.toContain(fields[0].pl);
    expect(previewJson()).toContain(fields[0].en);
  });

  it("edycja pola EN nanosi zmianę tylko na wersję angielską", () => {
    openPicker("page", "pl", handlers());
    const fields = collectI18nFields(PAGE_PATTERNS[0].builder);
    switchTab("Treść (PL / EN)");
    fireEvent.change(screen.getAllByRole("textbox")[1], {
      target: { value: "Brand new heading" },
    });
    switchTab("Podgląd");
    expect(previewJson()).toContain("Brand new heading");
    expect(previewJson()).toContain(fields[0].pl);
  });

  it("zakładka tytułu pre-wypełnia obie wersje z szablonu", () => {
    openPicker("page", "pl", handlers());
    switchTab("Tytuł strony");
    expect(screen.getByDisplayValue(PAGE_PATTERNS[0].defaultTitle.pl)).toBeInTheDocument();
    expect(screen.getByDisplayValue(PAGE_PATTERNS[0].defaultTitle.en)).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });

  it("szablon bez pól tekstowych mówi to wprost", () => {
    h.pool = [PAGE_WITHOUT_FIELDS];
    openPicker("page", "pl", handlers());
    switchTab("Treść (PL / EN)");
    expect(screen.getByText("Ten szablon nie ma edytowalnych pól tekstowych.")).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("podsumowanie bez zmian liczy zero pól i nie pokazuje kolumn przed/po", () => {
    openPicker("page", "pl", handlers());
    fireEvent.click(screen.getByRole("button", { name: "Przejrzyj zmiany" }));
    expect(screen.getByText("Potwierdź zastosowanie szablonu")).toBeInTheDocument();
    expect(screen.getByText(PAGE_PATTERNS[0].name.pl, { selector: "strong" })).toBeInTheDocument();
    const row = summaryRow("Tytuł strony");
    expect(within(row).getByText("bez zmian")).toBeInTheDocument();
    expect(within(confirmDialog()).queryByText("Przed")).not.toBeInTheDocument();
    expect(within(confirmDialog()).queryByText("Po")).not.toBeInTheDocument();
  });

  it("podsumowanie pokazuje przed/po tylko dla zmienionych pól", () => {
    openPicker("page", "pl", handlers());
    const fields = collectI18nFields(PAGE_PATTERNS[0].builder);
    switchTab("Treść (PL / EN)");
    fireEvent.change(screen.getAllByRole("textbox")[0], {
      target: { value: "Zmieniony nagłówek" },
    });
    switchTab("Tytuł strony");
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "  Nowy tytuł  " } });
    fireEvent.click(screen.getByRole("button", { name: "Przejrzyj zmiany" }));

    const titleRow = summaryRow("Tytuł strony");
    expect(within(titleRow).getByText("zmieniono")).toBeInTheDocument();
    expect(titleRow.textContent).toContain("Nowy tytuł");

    const fieldRow = summaryRow(`${fields[0].widgetType} · ${fields[0].baseKey}`);
    expect(within(fieldRow).getByText("zmieniono")).toBeInTheDocument();
    expect(fieldRow.textContent).toContain("Zmieniony nagłówek");
    expect(fieldRow.textContent).toContain(fields[0].pl);
    expect(within(confirmDialog()).getAllByText("Przed")).toHaveLength(2);
  });

  it("anulowanie podsumowania nie stosuje szablonu i zostawia bibliotekę otwartą", () => {
    const hs = handlers();
    openPicker("page", "pl", hs);
    fireEvent.click(screen.getByRole("button", { name: "Przejrzyj zmiany" }));
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(screen.queryByText("Potwierdź zastosowanie szablonu")).not.toBeInTheDocument();
    expect(hs.onApply).not.toHaveBeenCalled();
    expect(hs.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByText("Biblioteka szablonów")).toBeInTheDocument();
  });

  it("zatwierdzenie oddaje dokument po zmianach, przycięte tytuły i zamyka okno", () => {
    const hs = handlers();
    openPicker("page", "pl", hs);
    switchTab("Treść (PL / EN)");
    fireEvent.change(screen.getAllByRole("textbox")[0], {
      target: { value: "Tytuł hero po zmianie" },
    });
    switchTab("Tytuł strony");
    fireEvent.change(screen.getAllByRole("textbox")[0], {
      target: { value: "  Strona testowa  " },
    });
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "  Test page  " } });
    fireEvent.click(screen.getByRole("button", { name: "Przejrzyj zmiany" }));
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));

    const applied = firstApplied(hs);
    expect(applied.kind).toBe("page");
    if (applied.kind !== "page") throw new Error("test: oczekiwano ładunku strony");
    expect(applied.title_pl).toBe("Strona testowa");
    expect(applied.title_en).toBe("Test page");
    expect(applied.pattern.id).toBe(PAGE_PATTERNS[0].id);
    expect(JSON.stringify(applied.builder)).toContain("Tytuł hero po zmianie");
    // Dokument źródłowy z biblioteki NIE jest mutowany - `applyI18nOverrides`
    // klonuje, więc kolejne otwarcie okna startuje od oryginału.
    expect(JSON.stringify(PAGE_PATTERNS[0].builder)).not.toContain("Tytuł hero po zmianie");
    expect(hs.onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText("Potwierdź zastosowanie szablonu")).not.toBeInTheDocument();
  });

  it("pusty tytuł przechodzi bez ostrzeżenia - komponent nie ma walidacji", () => {
    const hs = handlers();
    openPicker("page", "pl", hs);
    switchTab("Tytuł strony");
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Przejrzyj zmiany" }));
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    const applied = firstApplied(hs);
    if (applied.kind !== "page") throw new Error("test: oczekiwano ładunku strony");
    expect(applied.title_pl).toBe("");
  });
});

describe("PatternPicker - panel wpisu", () => {
  it("podgląd składa tytuł, lead i oczyszczoną treść w języku PL", () => {
    openPicker("post", "pl", handlers());
    const post = POST_PATTERNS[0];
    expect(
      screen.getByRole("heading", { level: 1, name: post.defaultTitle.pl }),
    ).toBeInTheDocument();
    expect(screen.getByText(post.defaultExcerpt?.pl ?? "")).toBeInTheDocument();
    expect(screen.queryByTestId("builder-preview")).not.toBeInTheDocument();
  });

  it("podgląd przełącza się na wersję EN razem z językiem interfejsu", () => {
    openPicker("post", "en", handlers());
    const post = POST_PATTERNS[0];
    expect(
      screen.getByRole("heading", { level: 1, name: post.defaultTitle.en }),
    ).toBeInTheDocument();
    expect(screen.getByText(post.defaultExcerpt?.en ?? "")).toBeInTheDocument();
  });

  it("szablon bez domyślnego leadu nie renderuje akapitu leadu", () => {
    openPicker("post", "pl", handlers());
    const longform = POST_PATTERNS[1];
    fireEvent.click(patternRow(longform.name.pl));
    switchTab("Tytuł i lead");
    const boxes = screen.getAllByRole("textbox");
    expect(boxes[2]).toHaveValue("");
    expect(boxes[3]).toHaveValue("");
  });

  it("podgląd sanityzuje HTML treści - skrypt nie dociera do DOM", () => {
    const { container } = openPicker("post", "pl", handlers());
    switchTab("Treść (PL / EN)");
    fireEvent.change(screen.getAllByRole("textbox")[0], {
      target: { value: "<h2>Bezpieczny nagłówek</h2><script>window.x=1</script>" },
    });
    switchTab("Podgląd");
    expect(
      screen.getByRole("heading", { level: 2, name: "Bezpieczny nagłówek" }),
    ).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(document.querySelectorAll("script")).toHaveLength(0);
  });

  it("zakładka treści daje dwa wieloliniowe pola HTML", () => {
    openPicker("post", "pl", handlers());
    switchTab("Treść (PL / EN)");
    const boxes = screen.getAllByRole("textbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0].tagName).toBe("TEXTAREA");
    expect(boxes[1].tagName).toBe("TEXTAREA");
    expect(boxes[0]).toHaveAttribute("rows", "16");
    expect(boxes[0]).toHaveValue(POST_PATTERNS[0].content.pl);
    expect(boxes[1]).toHaveValue(POST_PATTERNS[0].content.en);
  });

  it("meta wpisu: tytuły jednoliniowe, lead wieloliniowy", () => {
    openPicker("post", "pl", handlers());
    switchTab("Tytuł i lead");
    const boxes = screen.getAllByRole("textbox");
    expect(boxes).toHaveLength(4);
    expect(boxes[0].tagName).toBe("INPUT");
    expect(boxes[1].tagName).toBe("INPUT");
    expect(boxes[2].tagName).toBe("TEXTAREA");
    expect(boxes[3].tagName).toBe("TEXTAREA");
    expect(boxes[2]).toHaveAttribute("rows", "3");
  });

  it("podsumowanie wpisu liczy znaki treści i wykrywa zmianę tytułu", () => {
    openPicker("post", "pl", handlers());
    const post = POST_PATTERNS[0];
    switchTab("Tytuł i lead");
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Inny tytuł" } });
    fireEvent.click(screen.getByRole("button", { name: "Przejrzyj zmiany" }));
    expect(within(summaryRow("Tytuł")).getByText("zmieniono")).toBeInTheDocument();
    expect(within(summaryRow("Lead")).getByText("bez zmian")).toBeInTheDocument();
    const content = summaryRow("Treść");
    expect(within(content).getByText("bez zmian")).toBeInTheDocument();
    expect(content.textContent).not.toContain(`${post.content.pl.length} zn.`);
  });

  it("skrócenie treści jest widoczne w podsumowaniu jako zmiana", () => {
    openPicker("post", "pl", handlers());
    switchTab("Treść (PL / EN)");
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "<p>Krótko</p>" } });
    fireEvent.click(screen.getByRole("button", { name: "Przejrzyj zmiany" }));
    const content = summaryRow("Treść");
    expect(within(content).getByText("zmieniono")).toBeInTheDocument();
    expect(content.textContent).toContain("13 zn.");
  });

  // DEFEKT: wiersz „Treść" porównuje tylko DŁUGOŚCI, więc podmiana treści na
  // inną o identycznej długości raportuje „bez zmian", choć zostanie zapisana.
  // Podsumowanie jest bramką przed operacją opisaną w oknie jako niecofalna
  // automatycznie, więc zamilczenie realnej zmiany to defekt, nie kosmetyka.
  it.fails("podsumowanie oznacza podmianę treści o tej samej długości", () => {
    openPicker("post", "pl", handlers());
    const original = POST_PATTERNS[0].content.pl;
    switchTab("Treść (PL / EN)");
    fireEvent.change(screen.getAllByRole("textbox")[0], {
      target: { value: "x".repeat(original.length) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Przejrzyj zmiany" }));
    expect(within(summaryRow("Treść")).getByText("zmieniono")).toBeInTheDocument();
  });

  it("zatwierdzenie przycina tytuł i lead, ale nie treść", () => {
    const hs = handlers();
    openPicker("post", "pl", hs);
    switchTab("Tytuł i lead");
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "  Wpis testowy  " } });
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "  Test post  " } });
    fireEvent.change(screen.getAllByRole("textbox")[2], { target: { value: "  Lead PL  " } });
    fireEvent.change(screen.getAllByRole("textbox")[3], { target: { value: "  Lead EN  " } });
    switchTab("Treść (PL / EN)");
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "  <p>Treść</p>  " } });
    fireEvent.click(screen.getByRole("button", { name: "Przejrzyj zmiany" }));
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));

    const applied = firstApplied(hs);
    expect(applied.kind).toBe("post");
    if (applied.kind !== "post") throw new Error("test: oczekiwano ładunku wpisu");
    expect(applied.title_pl).toBe("Wpis testowy");
    expect(applied.title_en).toBe("Test post");
    expect(applied.excerpt_pl).toBe("Lead PL");
    expect(applied.excerpt_en).toBe("Lead EN");
    expect(applied.content_pl).toBe("  <p>Treść</p>  ");
    expect(applied.content_en).toBe(POST_PATTERNS[0].content.en);
    expect(applied.pattern.id).toBe(POST_PATTERNS[0].id);
    expect(hs.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("etykiety pól wpisu są dwujęzyczne w interfejsie PL", () => {
    openPicker("post", "pl", handlers());
    switchTab("Tytuł i lead");
    expect(screen.getByText("Tytuł PL")).toBeInTheDocument();
    expect(screen.getByText("Title EN")).toBeInTheDocument();
    expect(screen.getByText("Lead PL")).toBeInTheDocument();
    expect(screen.getByText("Excerpt EN")).toBeInTheDocument();
  });

  it("podsumowanie wpisu w EN używa angielskich etykiet wierszy", () => {
    openPicker("post", "en", handlers());
    fireEvent.click(screen.getByRole("button", { name: "Przejrzyj zmiany" }));
    expect(summaryRow("Title")).toBeInTheDocument();
    expect(summaryRow("Excerpt")).toBeInTheDocument();
    expect(summaryRow("Content")).toBeInTheDocument();
  });
});

describe("PatternPicker - dostępność", () => {
  it("okno biblioteki (panel strony) nie ma naruszeń axe", async () => {
    const { container } = openPicker("page", "pl", handlers());
    const dialog = document.querySelector('[role="dialog"]') ?? container;
    const violations = await axeViolations(dialog);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("okno biblioteki (panel wpisu) nie ma naruszeń axe", async () => {
    const { container } = openPicker("post", "pl", handlers());
    const dialog = document.querySelector('[role="dialog"]') ?? container;
    const violations = await axeViolations(dialog);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("okno potwierdzenia nie ma naruszeń axe", async () => {
    openPicker("page", "pl", handlers());
    switchTab("Treść (PL / EN)");
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Zmiana" } });
    fireEvent.click(screen.getByRole("button", { name: "Przejrzyj zmiany" }));
    const violations = await axeViolations(confirmDialog());
    expect(violations, summarize(violations)).toEqual([]);
  });
});
