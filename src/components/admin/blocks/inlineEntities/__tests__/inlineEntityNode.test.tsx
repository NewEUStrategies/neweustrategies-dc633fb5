// Węzeł encji inline w PRAWDZIWYM akapicie (TipTap + pełny zestaw rozszerzeń):
// odwołanie przeżywa edycję akapitu, widok węzła czyta rejestr dokumentu,
// a pasek formatowania wstawia firmę / osobę w miejscu zaznaczenia.
import { describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Block } from "@/lib/blocks/types";
import { ParagraphBlock } from "../../edit/Paragraph";
import {
  InlineEntitiesContext,
  type InlineEntitiesContextValue,
  type InlineEntityEditorRequest,
} from "../InlineEntitiesContext";
import { inlineEntityContent } from "../InlineEntityExtension";
import { company, person, token } from "@/lib/blocks/inlineEntities/__tests__/fixtures";
import "@/lib/i18n-admin-blocks";
import { realT } from "@/test/i18nReal";

// Prawdziwy słownik (rdzeń PL + nakładka bloków) - asercje idą na napisy,
// które zobaczy redakcja.
realT("pl");

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const NIC = () => undefined;
const FALSZ = () => false;

function ctxValue(overrides: Partial<InlineEntitiesContextValue> = {}): InlineEntitiesContextValue {
  return {
    lang: "pl",
    entities: { [company().id]: company(), [person().id]: person() },
    usage: new Map(),
    upsert: vi.fn(),
    remove: vi.fn(),
    importEntities: vi.fn(),
    openEditor: vi.fn(),
    openManager: vi.fn(),
    ...overrides,
  };
}

function Paragraph({ html, onChange }: { html: string; onChange: (b: Block) => void }) {
  const [block, setBlock] = useState<Block>({ id: "p1", type: "paragraph", data: { html } });
  return (
    <ParagraphBlock
      block={block}
      isActive
      onChange={(next) => {
        setBlock(next);
        onChange(next);
      }}
      onTransform={NIC}
      onInsertAfter={NIC}
      onDeleteEmpty={NIC}
      onMergeWithPrevious={FALSZ}
      onFocusPrevious={FALSZ}
      onFocusNext={FALSZ}
      onSelectAllBlocks={NIC}
      onExtendBlockSelection={FALSZ}
    />
  );
}

function mount(html: string, ctx: InlineEntitiesContextValue | null = ctxValue()) {
  const onChange = vi.fn<(b: Block) => void>();
  const wrap = (node: ReactNode) =>
    ctx ? (
      <InlineEntitiesContext.Provider value={ctx}>{node}</InlineEntitiesContext.Provider>
    ) : (
      node
    );
  const view = render(wrap(<Paragraph html={html} onChange={onChange} />));
  return { onChange, view, ctx };
}

describe("inline entity node in the paragraph editor", () => {
  it("renders the registry data (avatar, name) instead of the stale label", async () => {
    const stale = `<p>Brief <span data-nes-entity="ie_acme0001" data-nes-entity-kind="company">Stara nazwa</span> ok</p>`;
    const { view } = mount(stale);
    await waitFor(() => expect(screen.getByText("Acme Energy")).toBeTruthy());
    const chip = view.container.querySelector('[data-nes-entity="ie_acme0001"]');
    expect(chip?.querySelector("img")?.getAttribute("width")).toBe("24");
    expect(chip?.querySelector("img")?.className).toContain("rounded-[6px]");
    expect(screen.queryByText("Stara nazwa")).toBeNull();
  });

  it("shows initials for entities without an image and a warning for unknown ones", async () => {
    const html = `<p>${token(person())} i <span data-nes-entity="ie_ghost001" data-nes-entity-kind="person">Duch</span></p>`;
    mount(html);
    await waitFor(() => expect(screen.getByText("MC")).toBeTruthy());
    const ghost = screen.getByText("Duch").closest('[role="button"]');
    expect(ghost?.getAttribute("title")).toBe("Brak danych - kliknij, aby uzupełnić");
  });

  it("clicking a reference opens the shared editor (with a fallback for unknown ids)", async () => {
    const ctx = ctxValue();
    const html = `<p>${token(company())} <span data-nes-entity="ie_ghost001" data-nes-entity-kind="person">Duch</span></p>`;
    mount(html, ctx);
    await waitFor(() => expect(screen.getByText("Acme Energy")).toBeTruthy());
    fireEvent.click(screen.getByText("Acme Energy"));
    expect(ctx.openEditor).toHaveBeenCalledWith({
      mode: "edit",
      id: "ie_acme0001",
      fallback: { kind: "company", label: "Acme Energy" },
    });
    fireEvent.click(screen.getByText("Duch"));
    expect(ctx.openEditor).toHaveBeenLastCalledWith({
      mode: "edit",
      id: "ie_ghost001",
      fallback: { kind: "person", label: "Duch" },
    });
  });

  it("keeps existing references when another entity is inserted", async () => {
    let request: InlineEntityEditorRequest | null = null;
    const ctx = ctxValue({ openEditor: (r) => (request = r) });
    const { onChange } = mount(`<p>Hej ${token(company())} tam</p>`, ctx);
    await waitFor(() => expect(screen.getByText("Acme Energy")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Wstaw osobę (autor albo ręcznie)" }));
    act(() => {
      if (request?.mode === "create") request.onSaved(person());
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = String(onChange.mock.lastCall?.[0].data.html);
    expect(html).toContain(
      '<span data-nes-entity="ie_acme0001" data-nes-entity-kind="company">Acme Energy</span>',
    );
    expect(html).toContain(
      '<span data-nes-entity="ie_maya0001" data-nes-entity-kind="person">Maya Chen</span>',
    );
  });

  it("toolbar inserts a company/person at the selection via the shared editor", async () => {
    let request: InlineEntityEditorRequest | null = null;
    const ctx = ctxValue({ openEditor: (r) => (request = r) });
    const { onChange } = mount("<p>Tekst</p>", ctx);
    fireEvent.click(await screen.findByRole("button", { name: "Wstaw firmę (dane z CRM)" }));
    expect(request).toMatchObject({ mode: "create", kind: "company" });
    act(() => {
      if (request?.mode === "create") request.onSaved(company());
    });
    await waitFor(() =>
      expect(String(onChange.mock.lastCall?.[0].data.html)).toContain(
        'data-nes-entity="ie_acme0001"',
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Wstaw osobę (autor albo ręcznie)" }));
    expect(request).toMatchObject({ mode: "create", kind: "person" });
  });

  it("hides the entity buttons without a provider", async () => {
    mount("<p>Tekst</p>", null);
    await screen.findByRole("button", { name: "Bold (⌘B)" });
    expect(screen.queryByRole("button", { name: "Wstaw firmę (dane z CRM)" })).toBeNull();
  });

  it("builds insertable content with a trailing space", () => {
    expect(inlineEntityContent(person())).toEqual([
      { type: "inlineEntity", attrs: { id: "ie_maya0001", kind: "person", label: "Maya Chen" } },
      { type: "text", text: " " },
    ]);
  });
});
