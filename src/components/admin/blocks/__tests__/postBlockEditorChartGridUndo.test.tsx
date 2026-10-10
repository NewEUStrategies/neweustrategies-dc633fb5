// Ctrl+Z W ARKUSZU DANYCH WYKRESU cofa w HISTORII BLOKU (kontrakt PR2,
// „DataGrid behaviour" 6).
//
// Komórki arkusza są polami `<input>`, a `PostBlockEditor` oddaje Ctrl+Z
// w polach edytowalnych przeglądarce. W arkuszu to było złe: zmiana komórki
// (zatwierdzona liczba, wklejony zakres, wstawiony wiersz) idzie do treści
// bloku od razu, więc natywne cofnięcie w polu nie cofało niczego w treści.
// Teraz Ctrl+Z wewnątrz `[data-chart-grid]` cofa dokument, a niezatwierdzony
// szkic liczby cofa sama komórka - wtedy historia dokumentu stoi.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Block, BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/admin/onboarding/CoachmarkTour", () => ({ CoachmarkTour: () => null }));
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/charts/Chart", () => ({ Chart: () => <div data-testid="podglad" /> }));

const { PostBlockEditor } = await import("../PostBlockEditor");

const WYKRES: Block = {
  id: "w1",
  type: "chart",
  data: {
    kind: "bar",
    categories: ["2023", "2024"],
    series: [{ name: "Eksport", values: [10, 12], colorSlot: 3 }],
  },
};

function zamontuj() {
  const zmiany: LocalizedBlocks[] = [];
  const start: LocalizedBlocks = {
    pl: { version: 1, blocks: [WYKRES] } as BlocksDoc,
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
  render(<Rodzic />);
  return { zmiany };
}

const wartosci = (z: LocalizedBlocks[]) => {
  const blok = z.at(-1)?.pl.blocks.find((b) => b.id === "w1");
  return (blok?.data.series as Array<{ values: number[] }> | undefined)?.[0]?.values;
};

describe("PostBlockEditor - Ctrl+Z w arkuszu danych wykresu", () => {
  it("zatwierdzona komórka i Ctrl+Z w polu arkusza - dokument wraca", () => {
    const { zmiany } = zamontuj();
    const pole = screen.getByRole("textbox", { name: "2023 - Eksport" });
    fireEvent.change(pole, { target: { value: "99" } });
    fireEvent.blur(pole);
    expect(wartosci(zmiany)).toEqual([99, 12]);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Etykieta kategorii 1" }), {
      key: "z",
      ctrlKey: true,
    });
    expect(wartosci(zmiany)).toEqual([10, 12]);
  });

  it("niezatwierdzony szkic cofa sama komórka - dokument stoi", () => {
    const { zmiany } = zamontuj();
    const pole = screen.getByRole("textbox", { name: "2023 - Eksport" }) as HTMLInputElement;
    fireEvent.change(pole, { target: { value: "99" } });
    const przed = zmiany.length;
    fireEvent.keyDown(pole, { key: "z", ctrlKey: true });
    expect(pole.value).toBe("10");
    expect(zmiany).toHaveLength(przed);
  });
});
