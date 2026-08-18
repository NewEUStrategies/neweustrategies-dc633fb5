import { describe, expect, it } from "vitest";
import type { SectionNode } from "@/lib/builder/types";
import {
  builderRevisionsQuery,
  documentForSection,
  documentForWidget,
  formatVersionDate,
  restoreEntityType,
} from "../builderVersions";

describe("restoreEntityType", () => {
  it("REGRESJA: popup przywraca się jako POPUP, nie jako widget globalny", () => {
    // Organizm miał tu warunek z dwiema identycznymi gałęziami
    // (`tab === "template" ? "global_widget" : "global_widget"`), więc mutacja
    // przywracania zawsze dostawała typ widgetu globalnego. Podgląd rozróżniał
    // zakładki poprawnie, więc redaktor widział WŁAŚCIWĄ starą wersję popupu,
    // a po kliknięciu „Przywróć tę wersję" dostawał ogólny błąd - payload
    // popupu nie przechodzi przez `parseGlobalWidgetRevision`.
    expect(restoreEntityType("popup")).toBe("popup");
  });

  it("widget globalny przywraca się jako widget globalny", () => {
    expect(restoreEntityType("global_widget")).toBe("global_widget");
  });

  it("szablon sekcji nie ma typu encji buildera - ma własną warstwę danych", () => {
    expect(restoreEntityType("template")).toBeNull();
  });
});

describe("builderRevisionsQuery", () => {
  it("pyta o wersje encji wskazanej zakładką", () => {
    expect(builderRevisionsQuery("popup", "pop-1")).toEqual({
      entityType: "popup",
      entityId: "pop-1",
    });
    expect(builderRevisionsQuery("global_widget", "w-1")).toEqual({
      entityType: "global_widget",
      entityId: "w-1",
    });
  });

  it("wyłącza zapytanie dla szablonów, zerując identyfikator", () => {
    // `useBuilderRevisions` ma `enabled: Boolean(entityId)`, więc null to jedyny
    // sposób, żeby zakładka szablonów nie odpytywała tabeli wersji buildera.
    expect(builderRevisionsQuery("template", "tpl-1")).toEqual({
      entityType: "global_widget",
      entityId: null,
    });
  });

  it("brak wybranego elementu też wyłącza zapytanie", () => {
    expect(builderRevisionsQuery("popup", null).entityId).toBeNull();
  });
});

describe("documentForSection", () => {
  it("owija sekcję w dokument w wersji 1, nie kopiując jej", () => {
    const section = { id: "s1", kind: "section", children: [] } as unknown as SectionNode;
    const doc = documentForSection(section);
    expect(doc.version).toBe(1);
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]).toBe(section);
  });
});

describe("documentForWidget", () => {
  it("buduje pełną ścieżkę sekcja -> kolumna -> widget", () => {
    // Renderer buildera nie umie wyrenderować samego widgetu - bez kolumny
    // i sekcji podgląd wersji widgetu globalnego byłby pusty.
    const doc = documentForWidget({ type: "hero", content: { title: "Cześć" } });
    const section = doc.sections[0] as unknown as { children: Array<{ children: unknown[] }> };
    const column = section.children[0];
    const widget = column.children[0] as { type: string; kind: string; content: unknown };

    expect(doc.version).toBe(1);
    expect(widget.kind).toBe("widget");
    expect(widget.type).toBe("hero");
    expect(widget.content).toEqual({ title: "Cześć" });
  });

  it("nadaje sekcji, kolumnie i widgetowi RÓŻNE identyfikatory", () => {
    // Powtórzony id w jednym dokumencie rozjeżdża klucze Reacta i selekcję
    // w rendererze - podgląd zaczyna reagować na kliknięcie nie tam, gdzie trzeba.
    const doc = documentForWidget({ type: "hero" });
    const section = doc.sections[0] as unknown as {
      id: string;
      children: Array<{ id: string; children: Array<{ id: string }> }>;
    };
    const ids = [section.id, section.children[0].id, section.children[0].children[0].id];
    expect(new Set(ids).size).toBe(3);
  });

  it("kolumna zajmuje pełną szerokość siatki", () => {
    const doc = documentForWidget({ type: "hero" });
    const section = doc.sections[0] as unknown as { children: Array<{ span: number }> };
    expect(section.children[0].span).toBe(12);
  });

  it("dwa wywołania dają niezależne dokumenty", () => {
    const a = documentForWidget({ type: "hero" });
    const b = documentForWidget({ type: "hero" });
    expect(a.sections[0]).not.toBe(b.sections[0]);
  });
});

describe("formatVersionDate", () => {
  it("formatuje znacznik czasu w obu językach panelu", () => {
    const iso = "2026-08-18T10:30:00.000Z";
    const pl = formatVersionDate(iso, "pl");
    const en = formatVersionDate(iso, "en");
    expect(pl).toMatch(/2026/);
    expect(en).toMatch(/2026/);
    // Różne lokalizacje mają różny zapis daty - gdyby `uiLocale` ignorowało
    // język, obie wartości byłyby identyczne i przełącznik nic by nie robił.
    expect(pl).not.toBe(en);
  });

  it("niepoprawny znacznik oddaje bez zmian, zamiast pokazać „Invalid Date”", () => {
    // Lista wersji ma pokazać, CO jest w bazie - „Invalid Date" ukrywa problem
    // zamiast go zgłosić.
    expect(formatVersionDate("nie-data", "pl")).toBe("nie-data");
    expect(formatVersionDate("", "en")).toBe("");
  });
});
