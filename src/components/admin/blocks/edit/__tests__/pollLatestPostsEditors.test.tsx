// EDYTORY BLOKÓW DYNAMICZNYCH: `poll` (wybór ankiety z bazy) i `latest-posts`
// - CO REDAKTOR WIDZI I CO TRAFIA DO GRANICY.
//
// PO CO TEN PLIK. Po zdjęciu przejazdu tabeli (`blockEditMatrix.*`, PR #475)
// oba edytory miały tylko przypadkowe wykonanie. Blok ankiety jest jedynym
// edytorem w tej rodzinie, który sam czyta bazę, więc kontrakt obejmuje
// ZAPYTANIE (tabela, kolumny, kolejność, limit) i to, co redaktor zobaczy,
// gdy odczyt się NIE uda. Najnowsze wpisy mają liczbę i przełączniki, które
// renderer (`renderLatestPosts`) czyta własnymi czytnikami i docina do 1-50.
//
// CO MA TU DOWÓD
//  * ankieta: zapytanie do `polls` (kolumny, najnowsze najpierw, limit 100);
//    etykiety opcji (PL -> EN -> id, 80 znaków, status po polsku); zapis
//    `pollId`; komunikaty: brak ankiet, wybrany szkic, ankieta usunięta;
//    BŁĄD odczytu ma własny komunikat, a nie fałszywe „ankieta nie istnieje”,
//  * najnowsze wpisy: liczba pokazuje i zapisuje to, co narysuje strona
//    (1-50, liczba całkowita), przełączniki i układ czytają dane jak renderer
//    (`bool`/wyliczenie), zapisy są LICZBAMI i WARTOŚCIAMI LOGICZNYMI.
//
// GRANICE. Klient Supabase to atrapa łańcucha z modułu wspólnego tabeli
// edytorów (import PIERWSZY) - test ustawia odpowiedź tabeli `polls` i czyta
// zapisany łańcuch. React Query - świeży klient bez ponowień na każdy render
// (`renderEditor` -> `renderWithQueryClient`).
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { supabase } from "@/integrations/supabase/client";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { LatestPostsBlock } from "../LatestPosts";
import { PollBlockEdit } from "../Poll";

const stub = supabase as unknown as SupabaseFromStub;

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  return changes[changes.length - 1];
}

// ---------------------------------------------------------------------------
// Ankieta
// ---------------------------------------------------------------------------

const ANKIETY = [
  { id: "p-1", question_pl: "Czy UE powinna mieć wspólną armię?", question_en: "", status: "open" },
  { id: "p-2", question_pl: "", question_en: "Energy union by 2030?", status: "draft" },
  { id: "p-3", question_pl: "", question_en: "", status: "archived" },
  { id: "p-4", question_pl: "ą".repeat(120), question_en: "", status: "closed" },
];

describe("poll", () => {
  it("czyta tabelę `polls`: cztery kolumny, najnowsze najpierw, najwyżej 100", async () => {
    stub.setResponse("polls", ok(ANKIETY));
    renderEditor(PollBlockEdit, blok("poll", { pollId: "" }));
    await screen.findByRole("option", { name: /wspólną armię/ });
    const zapytanie = stub.lastChain("polls");
    expect(zapytanie?.argsOf("select")).toEqual(["id, question_pl, question_en, status"]);
    expect(zapytanie?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(zapytanie?.argsOf("limit")).toEqual([100]);
  });

  it("etykieta opcji: pytanie PL, w braku EN, w braku id; 80 znaków; status po polsku", async () => {
    stub.setResponse("polls", ok(ANKIETY));
    renderEditor(PollBlockEdit, blok("poll", { pollId: "" }));
    await screen.findByRole("option", { name: /wspólną armię/ });
    const opcje = within(screen.getByRole("combobox"))
      .getAllByRole<HTMLOptionElement>("option")
      .map((o) => o.textContent);
    expect(opcje).toEqual([
      "- wybierz ankietę -",
      "Czy UE powinna mieć wspólną armię? (otwarta)",
      "Energy union by 2030? (szkic)",
      "p-3 (archived)",
      `${"ą".repeat(80)} (zamknięta)`,
    ]);
  });

  it("wybór zapisuje `pollId` z resztą danych; render niczego nie zapisuje", async () => {
    stub.setResponse("polls", ok(ANKIETY));
    const start = blok("poll", { pollId: "", align: "center" });
    const { changes } = renderEditor(PollBlockEdit, start);
    await screen.findByRole("option", { name: /wspólną armię/ });
    expect(changes).toEqual([]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "p-1" } });
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: start.id, type: "poll" });
    expect(zapis.data).toEqual({ pollId: "p-1", align: "center" });
  });

  it("w trakcie odczytu pokazuje „Wczytywanie”, a pusta lista - podpowiedź, gdzie tworzyć ankiety", async () => {
    stub.setResponse("polls", ok([]));
    renderEditor(PollBlockEdit, blok("poll", {}));
    expect(screen.getByText("Wczytywanie ankiet...")).toBeTruthy();
    expect(await screen.findByText(/Brak ankiet/)).toBeTruthy();
    expect(screen.queryByText("Wczytywanie ankiet...")).toBeNull();
  });

  it("odpowiedź bez danych (`null`) to pusta lista, a nie błąd", async () => {
    stub.setResponse("polls", ok(null));
    renderEditor(PollBlockEdit, blok("poll", {}));
    expect(await screen.findByText(/Brak ankiet/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("wybrany szkic ostrzega, że publicznie pojawi się dopiero po otwarciu", async () => {
    stub.setResponse("polls", ok(ANKIETY));
    renderEditor(PollBlockEdit, blok("poll", { pollId: "p-2" }));
    expect(await screen.findByText(/To szkic/)).toBeTruthy();
    expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("p-2");
    expect(screen.queryByText(/już nie istnieje/)).toBeNull();
  });

  it("wybrana ankieta, której nie ma na liście, daje ostrzeżenie o braku renderu", async () => {
    stub.setResponse("polls", ok(ANKIETY));
    renderEditor(PollBlockEdit, blok("poll", { pollId: "p-usunieta" }));
    expect(await screen.findByText(/już nie istnieje/)).toBeTruthy();
  });

  it("BŁĄD odczytu ma własny komunikat - a nie fałszywe „ankieta już nie istnieje”", async () => {
    // NAPRAWIONE 2026-10-18: przy błędzie zapytania (`data` puste, `isLoading`
    // fałszywe) edytor mówił redaktorowi, że wybrana ankieta została USUNIĘTA
    // i blok się nie wyrenderuje - choć ankieta istniała, a padło tylko
    // połączenie albo polityka RLS.
    stub.setResponse("polls", fail("permission denied for table polls", "42501"));
    renderEditor(PollBlockEdit, blok("poll", { pollId: "p-1" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Nie udało się wczytać ankiet");
    expect(screen.queryByText(/już nie istnieje/)).toBeNull();
    expect(screen.queryByText(/Brak ankiet/)).toBeNull();
  });

  it("`pollId`-liczba to brak wyboru, jak w `renderPoll` - bez ostrzeżenia o usuniętej ankiecie", async () => {
    // NAPRAWIONE 2026-10-18: `String(7)` dawało wybór „7” i ostrzeżenie
    // o usuniętej ankiecie; strona (czytnik `str`) traktuje to jako brak
    // ankiety i po prostu nic nie rysuje.
    stub.setResponse("polls", ok(ANKIETY));
    renderEditor(PollBlockEdit, blok("poll", { pollId: 7 }));
    await screen.findByRole("option", { name: /wspólną armię/ });
    expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("");
    expect(screen.queryByText(/już nie istnieje/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Najnowsze wpisy
// ---------------------------------------------------------------------------

describe("latest-posts", () => {
  const liczba = () => screen.getByRole<HTMLInputElement>("spinbutton");
  const przelacznik = (nazwa: string) =>
    screen.getByRole<HTMLInputElement>("checkbox", { name: nazwa });

  it("pusty blok pokazuje wartości domyślne renderera i niczego nie zapisuje", () => {
    const { changes } = renderEditor(LatestPostsBlock, blok("latest-posts", {}));
    expect(liczba().value).toBe("5");
    expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("list");
    expect(przelacznik("Miniatura").checked).toBe(true);
    expect(przelacznik("Zajawka").checked).toBe(false);
    expect(changes).toEqual([]);
  });

  it.each([
    [12, "12"],
    ["dużo", "5"],
    [999, "50"],
    [0, "1"],
  ] as const)("liczba wpisów %j pokazuje się jako %s - tyle narysuje strona", (count, widac) => {
    // NAPRAWIONE 2026-10-18: pole pokazywało surową wartość („NaN”, 999, 0),
    // a `renderLatestPosts` docina ją do 1-50 (domyślnie 5).
    const { container } = renderEditor(LatestPostsBlock, blok("latest-posts", { count }));
    expect(liczba().value).toBe(widac);
    expect(container.textContent).not.toContain("NaN");
  });

  it.each([
    ["12", 12],
    ["0", 1],
    ["999", 50],
    ["2.6", 3],
    ["", 5],
  ])("wpis „%s” zapisuje się jako LICZBA %s z zakresu pola", (wpis, zapisane) => {
    // NAPRAWIONE 2026-10-18: zapis przepuszczał 0, 999 i ułamki, choć pole ma
    // `min=1`/`max=50`, a strona i tak użyje liczby z tego zakresu.
    const start = blok("latest-posts", { count: 7, layout: "grid" });
    const { changes } = renderEditor(LatestPostsBlock, start);
    fireEvent.change(liczba(), { target: { value: wpis } });
    expect(ostatniZapis(changes)).toMatchObject({ id: start.id, type: "latest-posts" });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, count: zapisane });
  });

  it("układ spoza opcji pokazuje „list”; wybór zapisuje się pod `layout`", () => {
    const { changes } = renderEditor(LatestPostsBlock, blok("latest-posts", { layout: "kafelki" }));
    const uklad = screen.getByRole<HTMLSelectElement>("combobox");
    expect(uklad.value).toBe("list");
    fireEvent.change(uklad, { target: { value: "grid" } });
    expect(ostatniZapis(changes).data).toEqual({ layout: "grid" });
  });

  it("przełączniki czytają WARTOŚCI LOGICZNE jak renderer i zapisują je jako takie", () => {
    // NAPRAWIONE 2026-10-18: `Boolean(0)` ukrywało miniatury, a `Boolean("0")`
    // włączało zajawki - renderer (`bool`) dla nie-boolean bierze wartości
    // domyślne: miniatura TAK, zajawka NIE.
    const start = blok("latest-posts", { showImage: 0, showExcerpt: "0" });
    const { changes } = renderEditor(LatestPostsBlock, start);
    expect(przelacznik("Miniatura").checked).toBe(true);
    expect(przelacznik("Zajawka").checked).toBe(false);

    fireEvent.click(przelacznik("Zajawka"));
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, showExcerpt: true });
    fireEvent.click(przelacznik("Miniatura"));
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, showImage: false });
  });

  it("slug kategorii zapisuje się pod `category`", () => {
    const { changes } = renderEditor(LatestPostsBlock, blok("latest-posts", { count: 3 }));
    fireEvent.change(screen.getByPlaceholderText("Slug kategorii (opcjonalnie)"), {
      target: { value: "energia" },
    });
    expect(ostatniZapis(changes).data).toEqual({ count: 3, category: "energia" });
  });
});
