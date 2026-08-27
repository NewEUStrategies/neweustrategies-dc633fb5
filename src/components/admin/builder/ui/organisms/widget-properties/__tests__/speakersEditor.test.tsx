// SpeakersEditor: ORGANIZACJA prelegenta wpisanego ręcznie w studiu.
//
// Regresja przypięta tutaj: karta widgetu `speakers` pokazywała tytuł eksperta,
// ale nie afiliację, bo MODEL TREŚCI widgetu nie miał dla niej pola w ogóle -
// przy źródle „baza" była do wzięcia z kolumny `company` wiersza RPC, a przy
// wpisie ręcznym nie było jej skąd wziąć. Rozstrzygnięcie z commita `145ed72`
// mówi, że fakty o osobie ujednolicamy (układ już nie), więc pole powstało.
//
// TRZY RZECZY, KTÓRE MUSZĄ TRZYMAĆ SIĘ RAZEM:
//  1. panel ZAPISUJE klucz `organization` przez `setContent("speakers", ...)`,
//  2. paleta widgetu SEEDUJE ten klucz, żeby świeży widget nie miał pozycji
//     bez pola (redaktor nie musi wiedzieć, że pole „się pojawi po wpisaniu"),
//  3. renderer publiczny NAPRAWDĘ rysuje to, co panel zapisał - inaczej
//     mielibyśmy dokładnie defekt, którego pilnuje `settingsFidelity`:
//     panel obiecuje, renderer nie czyta.
//
// JEDNO POLE, NIE PARA `_pl` / `_en` - i to jest asercja, nie przypadek:
// publiczna projekcja prelegentów ma JEDNĄ kolumnę afiliacji, więc druga
// rubryka obiecywałaby rozróżnienie, którego przy źródle „baza" nie ma.
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { Json, WidgetContent, WidgetNode } from "@/lib/builder/types";
import { WIDGETS } from "@/lib/builder/registry";
import { SpeakersEditor } from "../SpeakersEditor";
import { SpeakersWidget } from "@/components/builder/organisms/widget-view/SpeakersWidget";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});

type Recorded = Array<[string, Json]>;

function renderEditor(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const calls: Recorded = [];
  const setContent = vi.fn((key: string, value: Json) => {
    calls.push([key, value]);
  });
  render(<SpeakersEditor c={content} lang={lang} setContent={setContent} />);
  return { calls, setContent };
}

function speakersFrom(calls: Recorded): Array<Record<string, unknown>> {
  const last = calls.filter(([key]) => key === "speakers").at(-1);
  return Array.isArray(last?.[1]) ? (last[1] as Array<Record<string, unknown>>) : [];
}

/** Pole afiliacji poznajemy po ETYKIECIE ze słownika (atrapa `t` oddaje klucz),
 *  a nie po pozycji w formularzu - przestawienie pól nie jest defektem. */
function organizationInput(): HTMLInputElement {
  const label = screen.getByText("builder.speakersEditor.organization");
  const field = label.closest("div");
  const input = field?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) throw new Error("brak pola organizacji");
  return input;
}

describe("SpeakersEditor - organizacja wpisu ręcznego", () => {
  it("pokazuje wpisaną wartość i zapisuje ją pod kluczem `organization`", () => {
    const { calls } = renderEditor({
      speakers: [{ id: "sp-1", name: "Anna Kowalska", organization: "Instytut Alfa" }],
    });
    expect(organizationInput().value).toBe("Instytut Alfa");

    fireEvent.change(organizationInput(), { target: { value: "Szkoła Główna Handlowa" } });
    expect(speakersFrom(calls)[0]).toMatchObject({
      name: "Anna Kowalska",
      organization: "Szkoła Główna Handlowa",
    });
  });

  it("pozycja BEZ afiliacji ma pole puste, a nie `undefined` w interfejsie", () => {
    // Dokumenty sprzed tej zmiany nie mają tego klucza w ogóle - i to jest
    // normalny stan, nie awaria panelu.
    renderEditor({ speakers: [{ id: "sp-1", name: "Anna Kowalska" }] });
    expect(organizationInput().value).toBe("");
    expect(screen.queryByDisplayValue("undefined")).toBeNull();
  });

  it("NIE oferuje osobnych rubryk PL i EN dla jednej afiliacji", () => {
    // Rola, kategoria i opis mają bliźniaki językowe; organizacja nie ma i mieć
    // nie może, bo `get_public_speakers` oddaje jedną kolumnę `company`.
    renderEditor({ speakers: [{ id: "sp-1", name: "Anna Kowalska" }] });
    expect(screen.getAllByText("builder.speakersEditor.organization")).toHaveLength(1);
    expect(screen.getAllByText(/^Rola (PL|EN)$/)).toHaveLength(2);
  });

  it("etykieta i podpowiedź idą ze SŁOWNIKA, nie z bliźniaka w kodzie", () => {
    // `check:i18n-hardcoded` trzyma ten plik w rachetcie, więc nowy napis musi
    // mieć klucz w obu językach - atrapa `t` oddaje klucz, czyli jego obecność
    // w drzewie dowodzi, że napis NIE jest wpisany w kod.
    renderEditor({ speakers: [{ id: "sp-1" }] });
    expect(screen.getByText("builder.speakersEditor.organizationHint")).toBeInTheDocument();
  });

  it("„+ dodaj” seeduje klucz afiliacji, a nie zostawia pozycji bez pola", () => {
    const { calls } = renderEditor({ speakers: [] });
    fireEvent.click(screen.getByRole("button", { name: /\+/ }));
    expect(speakersFrom(calls)[0]).toHaveProperty("organization", "");
  });

  it("paleta widgetu seeduje ten sam klucz w pozycji domyślnej", () => {
    const defaults = WIDGETS.find((widget) => widget.type === "speakers")?.defaults();
    const seeded = defaults?.speakers;
    expect(Array.isArray(seeded)).toBe(true);
    expect((seeded as Array<Record<string, unknown>>)[0]).toHaveProperty("organization", "");
  });

  it("źródło z BAZY chowa listę ręczną razem z tym polem", () => {
    // Przy `directory` / `event` karty pochodzą z RPC, więc rubryka afiliacji
    // w panelu obiecywałaby wpływ na coś, czego nie da się nadpisać.
    renderEditor({ source: "directory", speakers: [{ id: "sp-1", name: "Anna" }] });
    expect(screen.queryByText("builder.speakersEditor.organization")).toBeNull();
  });
});

describe("SpeakersEditor -> renderer: afiliacja przechodzi całą drogę", () => {
  it("to, co panel zapisał, karta publiczna NAPRAWDĘ rysuje", () => {
    // Dowód „panel obiecuje = renderer czyta" prowadzony na TYM SAMYM kształcie
    // pozycji, jaki wychodzi z `setContent` - bez tego zmiana nazwy klucza
    // w jednym z dwóch plików przeszłaby oba testy osobno.
    const { calls } = renderEditor({ speakers: [{ id: "sp-1", name: "Anna Kowalska" }] });
    fireEvent.change(organizationInput(), { target: { value: "Instytut Beta" } });
    const saved = speakersFrom(calls);
    cleanup();

    const node: WidgetNode = {
      id: "w-speakers",
      kind: "widget",
      type: "speakers",
      content: { speakers: saved } as WidgetContent,
    };
    // Renderer trzyma zapytanie o źródło „baza" (tu wyłączone przez tryb
    // ręczny), więc potrzebuje klienta zapytań nawet bez sieci.
    renderWithQueryClient(<SpeakersWidget node={node} lang="pl" />);
    expect(screen.getByText("Instytut Beta")).toBeInTheDocument();
  });
});
