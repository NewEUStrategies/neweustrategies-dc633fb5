// Enter vs. Shift+Enter w pozycji listy: twardy enter tworzy nowy punkt,
// miękki enter (Shift+Enter) łamie wiersz wewnątrz bieżącej pozycji.
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListBlockEdit } from "@/components/admin/blocks/edit/ListBlock";
import type { Block } from "@/lib/blocks/types";

function block(): Block {
  return { id: "b1", type: "list", data: { items: ["pierwszy"], ordered: false } } as Block;
}

describe("ListBlockEdit - miękki enter", () => {
  it("Enter dodaje nową pozycję listy", () => {
    const onChange = vi.fn();
    render(<ListBlockEdit block={block()} onChange={onChange} />);
    const item = screen.getAllByRole("textbox")[0];
    fireEvent.keyDown(item, { key: "Enter" });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0] as Block;
    expect(next.data.items).toEqual(["pierwszy", ""]);
  });

  it("Shift+Enter nie tworzy nowej pozycji, tylko łamie wiersz", () => {
    const onChange = vi.fn();
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    render(<ListBlockEdit block={block()} onChange={onChange} />);
    const item = screen.getAllByRole("textbox")[0];
    fireEvent.keyDown(item, { key: "Enter", shiftKey: true });
    expect(exec).toHaveBeenCalledWith("insertLineBreak");
    const items = onChange.mock.calls.map((c) => (c[0] as Block).data.items);
    for (const list of items) expect(list).toHaveLength(1);
  });

  it("renders semantic CMS markers and preserves nesting levels", () => {
    const onChange = vi.fn();
    const nested: Block = {
      id: "nested",
      type: "list",
      data: { items: ["główny", "zagnieżdżony"], ordered: false, levels: [1, 2] },
    } as Block;
    const { container } = render(<ListBlockEdit block={nested} onChange={onChange} />);

    expect(container.querySelector(".cms-block-list-editor--unordered")).not.toBeNull();
    expect(container.querySelectorAll(".cms-list-bullet")).toHaveLength(2);
    expect(container.querySelector('[data-level="2"]')).not.toBeNull();
  });

  it("renders ordered values as branded number badges", () => {
    const ordered: Block = {
      id: "ordered",
      type: "list",
      data: { items: ["pierwszy", "drugi"], ordered: true },
    } as Block;
    const { container } = render(<ListBlockEdit block={ordered} onChange={vi.fn()} />);

    expect(
      Array.from(container.querySelectorAll(".cms-list-number")).map((node) => node.textContent),
    ).toEqual(["1", "2"]);
  });
});
