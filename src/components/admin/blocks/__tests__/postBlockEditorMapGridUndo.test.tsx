// Ctrl+Z W ARKUSZU DANYCH MAPY cofa w HISTORII BLOKU (kontrakt PR2,
// „DataGrid behaviour" 6) - tak samo jak w arkuszu wykresu.
//
// Komórki siatki mapy są polami `<input>`, a zmiana (zatwierdzony kod albo
// liczba, wklejony zakres, wstawiony wiersz) idzie do treści bloku od razu.
// Siatka leży w `[data-chart-grid]`, więc `PostBlockEditor` cofa wtedy
// dokument; niezatwierdzony wpis kodu albo liczby cofa sama komórka -
// wtedy historia dokumentu stoi.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Block, BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { installWidgetGateFetch } from "@/test/widgetGateEnvironment";

installWidgetGateFetch();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/admin/onboarding/CoachmarkTour", () => ({ CoachmarkTour: () => null }));
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/charts/ChoroplethMap", () => ({
  ChoroplethMap: () => <div data-testid="podglad-mapy" />,
}));

const { PostBlockEditor } = await import("../PostBlockEditor");

const MAPA: Block = {
  id: "m1",
  type: "data-map",
  data: {
    region: "europe",
    values: [
      { id: "PL", value: 10 },
      { id: "DE", value: 12 },
    ],
  },
};

function zamontuj() {
  const zmiany: LocalizedBlocks[] = [];
  const start: LocalizedBlocks = {
    pl: { version: 1, blocks: [MAPA] } as BlocksDoc,
    en: { version: 1, blocks: [] } as BlocksDoc,
  };
  function Rodzic() {
    const [v, setV] = useState(start);
    return (
      <PostBlockEditor
        value={v}
        onChange={(next) => {
          zmiany.push(next);
          setV(next);
        }}
        documentPane={<div />}
      />
    );
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Rodzic />
    </QueryClientProvider>,
  );
  return { zmiany };
}

const wartosci = (z: LocalizedBlocks[]) => {
  const blok = z.at(-1)?.pl.blocks.find((b) => b.id === "m1");
  return blok?.data.values;
};

describe("PostBlockEditor - Ctrl+Z w arkuszu danych mapy", () => {
  it("zatwierdzona liczba i Ctrl+Z w polu siatki - dokument wraca", () => {
    const { zmiany } = zamontuj();
    const pole = screen.getByRole("textbox", { name: "Polska - wartość" });
    fireEvent.change(pole, { target: { value: "99" } });
    fireEvent.blur(pole);
    expect(wartosci(zmiany)).toEqual([
      { id: "PL", value: 99 },
      { id: "DE", value: 12 },
    ]);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Kod albo nazwa kraju, wiersz 1" }), {
      key: "z",
      ctrlKey: true,
    });
    expect(wartosci(zmiany)).toEqual([
      { id: "PL", value: 10 },
      { id: "DE", value: 12 },
    ]);
  });

  it("niezatwierdzony wpis kodu cofa sama komórka - dokument stoi", () => {
    const { zmiany } = zamontuj();
    const kod = screen.getByRole("textbox", {
      name: "Kod albo nazwa kraju, wiersz 1",
    }) as HTMLInputElement;
    fireEvent.change(kod, { target: { value: "Czec" } });
    const przed = zmiany.length;
    fireEvent.keyDown(kod, { key: "z", ctrlKey: true });
    expect(kod.value).toBe("PL");
    expect(zmiany).toHaveLength(przed);
  });
});
