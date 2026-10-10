// TABELA -> WYKRES NA KANWIE: ODMOWA I UWAGI SĄ WIDOCZNE (PR2).
//
// `transformBlock(table, "chart")` zwraca `null` dla tabeli bez liczb, a menu
// „Przekształć w" liczy cele po TYPIE bloku, więc pozycja „Wykres" jest
// oferowana także takiej tabeli. Bez komunikatu kliknięcie nie robiło nic -
// redaktor nie wiedział, czy edytor się zawiesił. Udane przekształcenie
// potrafi też coś zgubić (komórki nieliczbowe, limity serii), a import pliku
// mówi o tym zdaniami `importProblemText`; kanwa mówi teraz tym samym.
//
// Kanwa jest PRAWDZIWA (edytory bloków, pasek, menu); mockowany jest tylko
// `sonner` - granica UI, przez którą sprawdzamy komunikat.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";

const toasty = vi.hoisted(() => ({
  error: vi.fn(),
  message: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toasty }));

const t = realT("pl");

const { BlockCanvas } = await import("../BlockCanvas");

function tabela(rows: string[][]): Block {
  return { id: "t1", type: "table", data: { rows, header: false } } as Block;
}

function zamontuj(blok: Block) {
  const onChange = vi.fn<(next: BlocksDoc, immediate?: boolean) => void>();
  render(
    <BlockCanvas
      doc={{ version: 1, blocks: [blok] } as BlocksDoc}
      activeId={blok.id}
      onSelect={() => {}}
      onChange={onChange}
      selectedIds={[]}
      onSelectedIdsChange={() => {}}
    />,
  );
  return { onChange };
}

async function przeksztalcWWykres(): Promise<void> {
  fireEvent.click(screen.getAllByRole("button", { name: t("blocks.transform.menuLabel") })[0]);
  const menu = await waitFor(() => screen.getByRole("dialog"));
  fireEvent.click(within(menu).getByRole("button", { name: t("blocks.types.chart") }));
}

describe("kanwa: tabela -> wykres", () => {
  it("tabela bez liczb zostaje nietknięta, a redaktor dostaje zdanie dlaczego", async () => {
    toasty.error.mockClear();
    const { onChange } = zamontuj(
      tabela([
        ["Kraj", "Stolica"],
        ["Polska", "Warszawa"],
      ]),
    );
    await przeksztalcWWykres();
    await waitFor(() =>
      expect(toasty.error).toHaveBeenCalledWith(t("blocks.transform.tableNoNumbers")),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("udane przekształcenie z komórką nieliczbową mówi o tym zdaniem importu", async () => {
    toasty.message.mockClear();
    const { onChange } = zamontuj(
      tabela([
        ["", "Eksport"],
        ["2023", "12,5"],
        ["2024", "b.d."],
      ]),
    );
    await przeksztalcWWykres();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const doc = onChange.mock.calls.at(-1)?.[0];
    expect(doc?.blocks[0]?.type).toBe("chart");
    expect(toasty.message).toHaveBeenCalledTimes(1);
    const [tytul, opcje] = toasty.message.mock.calls[0] as [string, { description: string }];
    expect(tytul).toBe(t("blocks.transform.chartProblems"));
    expect(opcje.description.length).toBeGreaterThan(0);
  });

  it("czysta tabela liczb przechodzi bez komunikatu", async () => {
    toasty.message.mockClear();
    toasty.error.mockClear();
    const { onChange } = zamontuj(
      tabela([
        ["", "Eksport"],
        ["2023", "12,5"],
        ["2024", "14"],
      ]),
    );
    await przeksztalcWWykres();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(toasty.message).not.toHaveBeenCalled();
    expect(toasty.error).not.toHaveBeenCalled();
  });
});
