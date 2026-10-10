// LENIWA MAPA DANYCH, KTÓREJ CHUNK SIĘ NIE ZAŁADOWAŁ.
//
// Wykres i mapa danych jadą jednym leniwym chunkiem (`DataVizViews`). Gdy
// import padnie (zerwane łącze, stary deploy bez chunka), wykres od dawna
// dostawał komunikat `ChartLoadFailed`, a mapa - NIC: odrzucona obietnica
// `React.lazy` bez `.catch` leciała do najbliższej granicy błędu, czyli
// wywracała sekcję artykułu. Ten plik pilnuje, że oba widoki bloku dają ten
// sam komunikat w miejscu rysunku.
//
// Import jest psuty atrapą modułu, która RZUCA przy wczytaniu - tak samo jak
// `import()` chunka, którego nie ma na serwerze.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Json } from "@/lib/blocks/types";
// Wspólna instancja i18n - komunikat `ChartLoadFailed` dopisuje się do niej
// (`i18n-public`) dopiero, gdy jest zainicjalizowana.
import "@/lib/i18n";

vi.mock("../../DataVizViews", () => {
  throw new Error("chunk 404");
});

const { ChartBlockView, DataMapBlockView } = await import("../lazyBlockViews");

const KOMUNIKAT = "Biblioteka wykresów nie załadowała się. Sprawdź połączenie.";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("leniwe widoki data-viz - awaria chunka", () => {
  const mapa: Record<string, Json> = { region: "europe", values: [{ id: "PL", value: 1 }] };

  it("mapa danych pokazuje komunikat zamiast dziury albo wywrotki", async () => {
    render(<DataMapBlockView data={mapa} lang="pl" cls="" />);
    expect((await screen.findByRole("status")).textContent).toBe(KOMUNIKAT);
  });

  it("wykres - ten sam komunikat (wzorzec, który mapa przejęła)", async () => {
    render(<ChartBlockView data={{ kind: "bar" }} lang="pl" cls="" />);
    expect((await screen.findByRole("status")).textContent).toBe(KOMUNIKAT);
  });
});
