// Harmonogram wydarzenia: ustawienia całego widgetu oraz poziom DNIA i SESJI.
//
// Plik-brat `eventScheduleEditor.test.tsx` pilnuje liści (prelegenci,
// sponsorzy, godziny) i reguł „kto wygrywa". Tutaj stoi to, co redakcja
// ustawia nad nimi:
//  1. nagłówek i wstęp idą pod klucze EDYTOWANEJ wersji językowej,
//  2. liczba kolumn i przełączniki pokazują to, co RYSUJE widok
//     (`EventScheduleView`), także dla starszej treści,
//  3. dodanie dnia/sesji seeduje pełny kształt (widok nie dostaje dziur),
//     a edycja dnia lub sesji scala się z resztą wpisu zamiast go zastępować.
//
// Atrapy jak w pliku-bracie: słownik-echo (`i18nStub`), Radix Select/Switch
// jako natywne kontrolki, Supabase (wyszukiwarka profili w wierszu
// prelegenta), `ProfilePicker` (ma własny test).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { EventScheduleEditor } from "../EventScheduleEditor";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

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
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.current.from(table) },
}));
vi.mock("../ProfilePicker", () => ({ ProfilePicker: () => null }));

type Content = WidgetNode["content"];
type Row = Record<string, Json>;

function renderEditor(initial: Content, lang: "pl" | "en" = "pl") {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<Content>(initial);
    return (
      <EventScheduleEditor
        c={content}
        lang={lang}
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  const view = renderWithQueryClient(<Host />);
  const last = (key: string): Json | undefined => written.filter(([k]) => k === key).at(-1)?.[1];
  const days = (): Row[] => (last("days") ?? []) as Row[];
  const sessions = (day = 0): Row[] => (days()[day]?.sessions ?? []) as Row[];
  return { ...view, written, last, days, sessions };
}

function fieldUnder(label: string, index = 0): HTMLInputElement & HTMLSelectElement {
  const node = screen.getAllByText(label, { selector: "label" })[index];
  const field = node?.parentElement?.querySelector("input, textarea, select");
  if (!field) throw new Error(`test: brak pola #${index} pod etykietą „${label}"`);
  return field as HTMLInputElement & HTMLSelectElement;
}

const button = (name: string, index = 0): HTMLButtonElement => {
  const found = screen.getAllByRole("button", { name })[index];
  if (!found) throw new Error(`test: brak przycisku „${name}" (#${index})`);
  return found as HTMLButtonElement;
};

const session = (over: Row = {}): Row => ({
  id: "s-1",
  timeStart: "10:00",
  timeEnd: "11:00",
  kind: "session",
  title_pl: "Otwarcie",
  title_en: "Opening",
  description_pl: "",
  description_en: "",
  room: "",
  href: "",
  speakers: [],
  sponsors: [],
  ...over,
});
const day = (over: Row = {}): Row => ({
  id: "day-1",
  label_pl: "Dzień 1",
  label_en: "Day 1",
  date: "2026-09-01",
  sessions: [session()],
  ...over,
});

beforeEach(() => {
  db.current = supabaseFromStub();
  db.current.setResponse("profiles", ok([]));
});

describe("EventScheduleEditor - ustawienia widgetu", () => {
  it("nagłówek i wstęp zapisują się pod kluczami edytowanej wersji językowej", () => {
    const { last } = renderEditor({ heading_pl: "Agenda PL" }, "en");
    const heading = fieldUnder("Heading (EN)");
    expect(heading.value).toBe("");
    fireEvent.change(heading, { target: { value: "Schedule" } });
    fireEvent.change(fieldUnder("Intro (EN)"), { target: { value: "Two days" } });
    expect(last("heading_en")).toBe("Schedule");
    expect(last("intro_en")).toBe("Two days");
    expect(last("heading_pl")).toBeUndefined();
  });

  it("liczba kolumn zapisuje się jako LICZBA", () => {
    const { last } = renderEditor({ columns: 2 });
    fireEvent.change(fieldUnder("Kolumny sesji"), { target: { value: "1" } });
    expect(last("columns")).toBe(1);
  });

  it.each([
    [undefined, "2"],
    [1, "1"],
    [0, "1"],
    [3, "2"],
    // Widok czyta liczby przez `getNum` - napis to dla niego brak wartości,
    // czyli dwie kolumny. Panel pokazywał tu jedną.
    ["1", "2"],
  ])("kolumny %j w treści pokazują %s - tyle, ile rysuje widok", (stored, shown) => {
    renderEditor(stored === undefined ? {} : { columns: stored as Json });
    expect(fieldUnder("Kolumny sesji").value).toBe(shown);
  });

  it("kolor akcentu zapisuje się, a wyczyszczony daje PUSTY napis", () => {
    const { last } = renderEditor({ accentColor: "#111111" });
    const field = fieldUnder("Kolor akcentu");
    fireEvent.change(field, { target: { value: "#c0ffee" } });
    expect(last("accentColor")).toBe("#c0ffee");
    fireEvent.change(field, { target: { value: "" } });
    expect(last("accentColor")).toBe("");
  });

  it.each([
    ["Zakładki dni", "showDayTabs"],
    ["Dialog profilu prelegenta", "openProfile"],
  ])("przełącznik „%s” jest domyślnie włączony i zapisuje wartość logiczną", (label, key) => {
    const { last } = renderEditor({});
    const toggle = fieldUnder(label);
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(last(key)).toBe(false);
  });

  it("jawne wyłączenie przełącznika w treści jest widoczne w panelu", () => {
    renderEditor({ showDayTabs: false, openProfile: false });
    expect(fieldUnder("Zakładki dni").checked).toBe(false);
    expect(fieldUnder("Dialog profilu prelegenta").checked).toBe(false);
  });
});

describe("EventScheduleEditor - dni", () => {
  it("„+ Dodaj” dopisuje dzień z numerem i pustą listą sesji", () => {
    const { days } = renderEditor({ days: [day()] });
    fireEvent.click(button("+ common.add"));
    expect(days()).toHaveLength(2);
    expect(days()[0]).toEqual(day());
    expect(days()[1]).toMatchObject({
      label_pl: "Dzień 2",
      label_en: "Day 2",
      date: "",
      sessions: [],
    });
    expect(String(days()[1]?.id)).toMatch(/^day-/);
  });

  it("etykiety i data dnia scalają się z resztą dnia", () => {
    const { days } = renderEditor({ days: [day()] });
    fireEvent.change(fieldUnder("Etykieta PL"), { target: { value: "Otwarcie" } });
    fireEvent.change(fieldUnder("Etykieta EN"), { target: { value: "Opening day" } });
    fireEvent.change(fieldUnder("Data"), { target: { value: "2026-09-02" } });
    expect(days()[0]).toEqual(
      day({ label_pl: "Otwarcie", label_en: "Opening day", date: "2026-09-02" }),
    );
  });

  it("tytuł ramki dnia: etykieta wersji, potem polska, potem numer", () => {
    renderEditor(
      {
        days: [
          day({ id: "d1", label_en: "First" }),
          day({ id: "d2", label_pl: "Drugi", label_en: "" }),
          day({ id: "d3", label_pl: "", label_en: "" }),
        ],
      },
      "en",
    );
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Drugi")).toBeTruthy();
    expect(screen.getByText("Day #3")).toBeTruthy();
  });

  it("usunięcie dnia zostawia pozostałe", () => {
    const { days } = renderEditor({
      days: [day({ id: "d1", sessions: [] }), day({ id: "d2", sessions: [] })],
    });
    fireEvent.click(button("builder.common.delete", 0));
    expect(days().map((d) => d.id)).toEqual(["d2"]);
  });
});

describe("EventScheduleEditor - sesje", () => {
  it("„+ Dodaj sesję” dopisuje sesję z pełnym kształtem i licznik rośnie", () => {
    const { sessions } = renderEditor({ days: [day()] });
    expect(screen.getByText("Sesje (1)")).toBeTruthy();
    fireEvent.click(button("+ Dodaj sesję"));
    expect(sessions()).toHaveLength(2);
    expect(sessions()[0]).toEqual(session());
    const added = sessions()[1]!;
    expect(added).toMatchObject({
      timeStart: "",
      timeEnd: "",
      kind: "session",
      title_pl: "",
      title_en: "",
      description_pl: "",
      description_en: "",
      room: "",
      href: "",
      speakers: [],
      sponsors: [],
    });
    expect(String(added.id)).toMatch(/^ses-/);
    expect(screen.getByText("Sesje (2)")).toBeTruthy();
  });

  it.each([
    ["Tytuł PL", "title_pl", "Przemówienie"],
    ["Tytuł EN", "title_en", "Keynote"],
    ["Opis PL", "description_pl", "Rozmowa o rynku"],
    ["Opis EN", "description_en", "Market talk"],
    ["Sala / miejsce", "room", "Sala A"],
    ["Link sesji", "href", "/wydarzenia/otwarcie"],
  ])("pole „%s” scala się z resztą sesji pod kluczem %s", (label, key, value) => {
    const { sessions } = renderEditor({ days: [day()] });
    fireEvent.change(fieldUnder(label), { target: { value } });
    expect(sessions()).toEqual([session({ [key]: value })]);
  });

  it.each([
    ["Rola PL", "role_pl", "Moderatorka"],
    ["Rola EN", "role_en", "Moderator"],
    ["Zdjęcie (URL)", "photo", "https://cdn.test/ewa.png"],
  ])("pole prelegenta „%s” scala się z resztą wpisu pod kluczem %s", (label, key, value) => {
    const base = { id: "sp-1", userId: "", name: "Ewa", role_pl: "", role_en: "", photo: "" };
    const { sessions } = renderEditor({
      days: [day({ sessions: [session({ speakers: [base] })] })],
    });
    fireEvent.change(fieldUnder(label), { target: { value } });
    expect(sessions()[0]?.speakers).toEqual([{ ...base, [key]: value }]);
  });

  it("tytuł ramki sesji: tytuł wersji, potem polski, potem numer", () => {
    renderEditor(
      {
        days: [
          day({
            sessions: [
              session({ id: "a", title_en: "Opening EN" }),
              session({ id: "b", title_pl: "Tylko PL", title_en: "" }),
              session({ id: "c", title_pl: "", title_en: "" }),
            ],
          }),
        ],
      },
      "en",
    );
    expect(screen.getByText("Opening EN")).toBeTruthy();
    expect(screen.getByText("Tylko PL")).toBeTruthy();
    expect(screen.getByText("Session #3")).toBeTruthy();
  });

  it("usunięcie sesji zostawia pozostałe sesje tego dnia", () => {
    const { sessions } = renderEditor({
      days: [day({ sessions: [session({ id: "a" }), session({ id: "b" })] })],
    });
    // Kolejność przycisków usuwania: dzień, sesja a, sesja b.
    fireEvent.click(button("builder.common.delete", 1));
    expect(sessions().map((s) => s.id)).toEqual(["b"]);
  });

  it("sesja z garbage w treści (nie-obiekt) nie przesuwa podlist sąsiednich sesji", () => {
    // Model redakcyjny dopasowuje podlisty do sesji po pozycji - śmieć MIĘDZY
    // sesjami nie może przypisać prelegentów drugiej sesji pierwszej.
    renderEditor({
      days: [
        "nie-dzień" as unknown as Row,
        day({
          sessions: [
            session({ id: "a", speakers: [] }),
            42 as unknown as Row,
            session({ id: "b", speakers: [{ id: "sp-b", name: "Bartosz" }] }),
          ],
        }),
      ],
    });
    const frames = screen.getAllByText(/^(Otwarcie|Bartosz)$/);
    expect(frames.map((f) => f.textContent)).toEqual(["Otwarcie", "Otwarcie", "Bartosz"]);
  });

  it("wpis bez id dostaje id zastępcze, a nie-obiekt w podliście nie dostaje wiersza", () => {
    const { sessions } = renderEditor({
      days: [
        day({
          sessions: [
            session({
              kind: "break",
              speakers: ["x", { name: "" }] as unknown as Json,
              sponsors: [7, { name: "" }] as unknown as Json,
            }),
          ],
        }),
      ],
    });
    // Pusty wpis bez id też jest wierszem redakcyjnym - z numerem, nie znika.
    expect(screen.getByText("Prelegent #1")).toBeTruthy();
    expect(screen.queryByText("Prelegent #2")).toBeNull();
    expect(screen.getByText("Sponsor #1")).toBeTruthy();
    expect(screen.queryByText("Sponsor #2")).toBeNull();
    fireEvent.change(fieldUnder("Imię i nazwisko"), { target: { value: "Ewa" } });
    // Id zastępcze liczy pozycję w SUROWEJ liście (jak `parseSpeaker`).
    expect(sessions()[0]?.speakers).toEqual([
      { id: "sp-1", userId: "", name: "Ewa", role_pl: "", role_en: "", photo: "" },
    ]);
    expect(sessions()[0]?.sponsors).toEqual([{ id: "spn-1", name: "", logo: "", url: "" }]);
  });

  it("angielski panel sesji ma angielskie rubryki", () => {
    renderEditor({ days: [day()] }, "en");
    for (const label of ["From", "To", "Title PL", "Description EN", "Room / place"]) {
      expect(screen.getByText(label, { selector: "label" })).toBeTruthy();
    }
    expect(button("+ Add session")).toBeTruthy();
  });
});
