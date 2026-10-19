// Biblioteka widgetów: zwijanie SEKCJI POMOCNICZYCH (zapisane szablony,
// widgety globalne) i PODGRUP w kategorii.
//
// Zwijanie kategorii ma testy w `WidgetLibrary.test.tsx`; tu dowodzimy reszty
// tego samego kontraktu, bo redakcja układa paletę raz i oczekuje, że:
//  * zwinięta sekcja naprawdę chowa swoje pozycje (a rozwinięcie je oddaje),
//  * stan trafia do `localStorage` pod kluczem tej sekcji / podgrupy
//    (`__tpl`, `__global`, `<kategoria>__<podgrupa>`) i przeżywa przeładowanie,
//  * zablokowana pamięć przeglądarki (tryb prywatny) nie psuje zwijania.
//
// Do tego dane przeciągania KONTENERA Z ZAKŁADKAMI: kanwa rozpoznaje
// kontener po własnym typie MIME i z JSON-a czyta, czy ma mieć zakładki -
// zgubiona flaga to zwykły kontener w miejscu zakładek.
//
// Atrapy: hooki danych (`useSectionTemplates`, `useGlobalWidgets` - zapytania
// do bazy), dialog historii (osobne okno z własnym zapytaniem, tu nieużywane)
// i słownik (`i18nStub`: napis = klucz).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WidgetLibrary } from "../WidgetLibrary";

const data = vi.hoisted(() => ({
  templates: [] as Array<{ id: string; name: string; data: unknown; created_at: string }>,
  globals: [] as Array<{ id: string; name: string; data: { type: string } }>,
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/lib/builder/templates", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSectionTemplates: () => ({
      items: data.templates,
      loading: false,
      reload: vi.fn(),
      save: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    }),
  };
});
vi.mock("@/lib/builder/globalWidgets", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useGlobalWidgets: () => ({ items: data.globals, loading: false, remove: vi.fn() }),
  };
});
vi.mock("../TemplateHistoryDialog", () => ({ TemplateHistoryDialog: () => null }));

const STORAGE_KEY = "builder.lib.collapsed";
/**
 * Typ MIME kontenera, który czyta kanwa (`CONTAINER_MIME` z `VisualCanvas`).
 * Literał, a nie import: moduł kanwy ciągnie cały renderer buildera, a tu
 * chodzi właśnie o to, że ta wartość jest kontraktem między dwoma modułami.
 */
const CONTAINER_MIME = "application/x-container";

function renderLibrary() {
  return render(
    <WidgetLibrary onPickWidget={vi.fn()} onPickStructure={vi.fn()} onPickTemplate={vi.fn()} />,
  );
}

/** Nagłówek sekcji/podgrupy po kluczu słownika w jego treści. */
function header(key: string): HTMLElement {
  const found = screen
    .getAllByRole("button")
    .find((b) => (b.textContent ?? "").includes(`builder.widgetLibrary.${key}`));
  if (!found) throw new Error(`test: brak nagłówka ${key}`);
  return found;
}

function saved(): Record<string, boolean> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, boolean>;
}

beforeEach(() => {
  localStorage.clear();
  data.templates = [{ id: "t1", name: "Hero firmy", data: {}, created_at: "2026-01-01" }];
  data.globals = [{ id: "g1", name: "Stopka kontaktowa", data: { type: "text" } }];
});

describe("WidgetLibrary - zwijanie sekcji pomocniczych", () => {
  it.each([
    ["zapisane szablony", "templates", "__tpl", "Hero firmy"],
    ["widgety globalne", "globals", "__global", "Stopka kontaktowa"],
  ])("%s: zwinięcie chowa pozycje, rozwinięcie je oddaje", (_label, key, storageKey, item) => {
    renderLibrary();
    expect(screen.getByText(item)).toBeTruthy();

    fireEvent.click(header(key));
    expect(screen.queryByText(item)).toBeNull();
    expect(saved()[storageKey]).toBe(true);

    fireEvent.click(header(key));
    expect(screen.getByText(item)).toBeTruthy();
    expect(saved()[storageKey]).toBe(false);
  });

  it("zwinięte sekcje pomocnicze zostają zwinięte po przeładowaniu", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ __tpl: true, __global: true }));
    renderLibrary();
    expect(screen.queryByText("Hero firmy")).toBeNull();
    expect(screen.queryByText("Stopka kontaktowa")).toBeNull();
  });
});

describe("WidgetLibrary - zwijanie podgrup kategorii", () => {
  it("zwinięcie podgrupy chowa dokładnie jej kafelki i zapisuje klucz kategoria__podgrupa", () => {
    renderLibrary();
    const sub = header("sub.typography");
    // Licznik w nagłówku to obietnica: tyle kafelków znika po zwinięciu.
    const count = Number(/\((\d+)\)/.exec(sub.textContent ?? "")?.[1]);
    expect(count).toBeGreaterThan(0);
    const before = document.querySelectorAll("[draggable=true]").length;

    fireEvent.click(sub);
    expect(document.querySelectorAll("[draggable=true]").length).toBe(before - count);
    expect(saved()["basic__typography"]).toBe(true);

    fireEvent.click(header("sub.typography"));
    expect(document.querySelectorAll("[draggable=true]").length).toBe(before);
  });

  it("zablokowana pamięć przeglądarki nie blokuje zwijania", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage zablokowany");
    });
    try {
      renderLibrary();
      fireEvent.click(header("templates"));
      // Zapamiętanie jest wygodą; samo zwinięcie musi zadziałać.
      expect(screen.queryByText("Hero firmy")).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });
});

describe("WidgetLibrary - przeciąganie kontenera z zakładkami", () => {
  it("niesie typ MIME kontenera z flagą zakładek", () => {
    renderLibrary();
    const data: Record<string, string> = {};
    const dataTransfer = {
      setData: (mime: string, value: string) => {
        data[mime] = value;
      },
    };
    fireEvent.dragStart(screen.getByTitle("builder.widgetLibrary.containerTabsTitle"), {
      dataTransfer,
    });
    expect(JSON.parse(data[CONTAINER_MIME] ?? "null")).toEqual({ withTabs: true });
    expect(data["text/plain"]).toBe("builder.widgetLibrary.containerTabs");
  });
});
