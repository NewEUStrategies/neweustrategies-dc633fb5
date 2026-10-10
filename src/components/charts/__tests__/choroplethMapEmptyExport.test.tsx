// PUSTA MAPA BEZ PRZYCISKÓW EKSPORTU.
//
// Pusty zestaw zostaje panelem (tytuł, rama, komunikat w miejscu rysunku),
// ale rysunku w nim nie ma - eksport PNG/SVG nie ma czego zapisać i rama
// pokazywała po kliknięciu komunikat o błędzie, czyli poprawny stan pusty
// wyglądał na zepsutą stronę. Rama dostaje `exportable={false}`: bez
// przycisków PNG/SVG i bez akapitu o eksporcie w „Jak czytać". Mapa z danymi
// zachowuje oba przyciski.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { GeoAsset } from "@/lib/charts/types";
import type { Json } from "@/lib/content-model/json";
import { parseDataMapConfig } from "@/lib/charts/parse";

const GEO: GeoAsset = {
  v: 1,
  license: "test",
  viewBox: "0 0 960 825",
  countries: [
    { id: "PL", pl: "Polska", en: "Poland", d: "M0 0h8v8h-8z" },
    { id: "DE", pl: "Niemcy", en: "Germany", d: "M10 10h8v8h-8z" },
  ],
};

vi.mock("@/lib/charts/geoQuery", () => ({
  geoAssetQueryOptions: (region: string) => ({
    queryKey: ["geo", region],
    queryFn: () => GEO,
  }),
}));

const { ChoroplethMap } = await import("../ChoroplethMap");

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mapa(data: Record<string, Json>) {
  return render(
    <Wrapper>
      <ChoroplethMap config={parseDataMapConfig(data)} lang="pl" />
    </Wrapper>,
  );
}

afterEach(cleanup);

describe("pusta mapa - panel bez eksportu", () => {
  it("nie ma przycisków PNG/SVG ani komunikatu o błędzie eksportu", () => {
    mapa({ region: "europe", title: "Pusta mapa", values: [] });
    expect(screen.getByText("Pusta mapa")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zapisz wykres jako PNG" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Zapisz wykres jako SVG" })).toBeNull();
    // Pomoc zostaje, ale bez akapitu o eksporcie, którego nie ma.
    fireEvent.click(screen.getByRole("button", { name: "Jak czytać ten wykres" }));
    const dialog = document.querySelector("dialog[open]") as HTMLElement;
    expect(dialog.textContent ?? "").not.toContain("PNG");
  });

  it("mapa z danymi ma oba przyciski eksportu", async () => {
    const { container } = mapa({
      region: "europe",
      title: "Mapa",
      values: [{ id: "PL", value: 1 }],
    });
    await waitFor(() => expect(container.querySelector("svg.block")).not.toBeNull());
    expect(screen.getByRole("button", { name: "Zapisz wykres jako PNG" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zapisz wykres jako SVG" })).toBeTruthy();
  });
});
