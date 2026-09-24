// Provider encji inline: rejestr z dokumentu, użycia w obu wersjach
// językowych, aktualizacje funkcyjne historii, menedżer i schowek między
// materiałami (kopiuj -> typ MIME + localStorage, wklej -> import rekordów).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import type { BlocksDoc } from "@/lib/blocks/types";
import { readInlineEntities } from "@/lib/blocks/inlineEntities/registry";
import {
  INLINE_ENTITY_CLIPBOARD_MIME,
  rememberCopiedInlineEntities,
  serializeInlineEntityClipboard,
} from "@/lib/blocks/inlineEntities/clipboard";
import {
  company,
  docWith,
  paragraph,
  person,
  token,
} from "@/lib/blocks/inlineEntities/__tests__/fixtures";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";

realT("pl");

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Okno edycji ma własne testy - tu liczy się tylko, KTÓRE żądanie dostało.
vi.mock("../InlineEntityDialog", () => ({
  InlineEntityDialog: ({ request }: { request: { mode: string; id?: string } | null }) =>
    request ? <div data-testid="entity-dialog">{`${request.mode}:${request.id ?? ""}`}</div> : null,
}));

const { InlineEntitiesProvider } = await import("../InlineEntitiesProvider");
const { useInlineEntities } = await import("../InlineEntitiesContext");
const { InlineEntitiesManagerButton } = await import("../InlineEntitiesManagerButton");

type Ctx = NonNullable<ReturnType<typeof useInlineEntities>>;

function Probe({ onCtx }: { onCtx: (ctx: Ctx) => void }) {
  const ctx = useInlineEntities();
  if (ctx) onCtx(ctx);
  return null;
}

function mount(active: BlocksDoc, other: BlocksDoc = { version: 1, blocks: [] }) {
  const update = vi.fn();
  let ctx: Ctx | null = null;
  function Host() {
    const rootRef = useRef<HTMLDivElement | null>(null);
    return (
      <div ref={rootRef}>
        <InlineEntitiesProvider
          activeDoc={active}
          otherDoc={other}
          lang="pl"
          update={update}
          rootRef={rootRef}
        >
          <InlineEntitiesManagerButton />
          <p data-testid="inside">{"treść"}</p>
          <Probe onCtx={(c) => (ctx = c)} />
        </InlineEntitiesProvider>
      </div>
    );
  }
  const utils = render(
    <>
      <Host />
      <p data-testid="outside">poza</p>
    </>,
  );
  /** Stosuje ostatnią aktualizację funkcyjną do dokumentu. */
  const applyLast = (doc: BlocksDoc): BlocksDoc => {
    const fn = update.mock.lastCall?.[0] as (d: BlocksDoc) => BlocksDoc;
    return fn(doc);
  };
  return { ...utils, update, ctx: () => ctx!, applyLast };
}

function clipboardEvent(type: "copy" | "cut" | "paste", data: Record<string, string>) {
  const store = new Map(Object.entries(data));
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (mime: string) => store.get(mime) ?? "",
      setData: (mime: string, value: string) => store.set(mime, value),
    },
  });
  return { event, store };
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("InlineEntitiesProvider", () => {
  const active = docWith(
    [paragraph("p1", `${token(company())} ${token(company())}`)],
    [company(), person()],
  );
  const other = docWith([paragraph("e1", token(company()))], [company()]);

  it("exposes the registry and counts uses in both languages", () => {
    const { ctx } = mount(active, other);
    expect(Object.keys(ctx().entities).sort()).toEqual(["ie_acme0001", "ie_maya0001"]);
    expect(ctx().usage.get("ie_acme0001")).toBe(3);
    expect(ctx().usage.get("ie_maya0001")).toBeUndefined();
    expect(ctx().lang).toBe("pl");
    // Przycisk menedżera pokazuje liczbę rekordów.
    expect(screen.getByRole("button", { name: /Firmy i osoby/ }).textContent).toContain("2");
  });

  it("applies upsert/remove/import as functional history updates", () => {
    const { ctx, update, applyLast } = mount(active);
    act(() => ctx().upsert(company({ name: "Nowa" })));
    expect(readInlineEntities(applyLast(active)).ie_acme0001).toMatchObject({ name: "Nowa" });
    act(() => ctx().remove("ie_maya0001"));
    expect(readInlineEntities(applyLast(active)).ie_maya0001).toBeUndefined();
    const calls = update.mock.calls.length;
    act(() => ctx().importEntities([]));
    expect(update.mock.calls.length).toBe(calls);
    act(() => ctx().importEntities([person({ id: "ie_new00001" })]));
    expect(readInlineEntities(applyLast(active)).ie_new00001).toBeDefined();
  });

  it("routes editor requests and the manager to the dialogs", () => {
    const { ctx, update, applyLast } = mount(active, other);
    act(() => ctx().openEditor({ mode: "edit", id: "ie_acme0001" }));
    expect(screen.getByTestId("entity-dialog").textContent).toBe("edit:ie_acme0001");
    fireEvent.click(screen.getByRole("button", { name: /Firmy i osoby/ }));
    expect(screen.getByRole("heading", { name: "Firmy i osoby w materiale" })).toBeTruthy();
    // Używana firma nie da się usunąć, nieużywana osoba - tak.
    expect(screen.getByRole("button", { name: "Usuń z materiału: Acme Energy" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Usuń z materiału: Maya Chen" }));
    expect(readInlineEntities(applyLast(active)).ie_maya0001).toBeUndefined();
    expect(update).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edytuj: Maya Chen" }));
    expect(screen.getByTestId("entity-dialog").textContent).toBe("edit:ie_maya0001");
  });

  it("adds the records to the clipboard when references are copied", () => {
    mount(active);
    const { event, store } = clipboardEvent("copy", { "text/html": `<p>${token(company())}</p>` });
    act(() => {
      screen.getByTestId("inside").dispatchEvent(event);
    });
    expect(JSON.parse(store.get(INLINE_ENTITY_CLIPBOARD_MIME)!).entities[0].id).toBe("ie_acme0001");
    expect(window.localStorage.getItem("nes:inline-entities:clipboard")).toContain("ie_acme0001");
  });

  it("ignores copies without references and events from outside the editor", () => {
    mount(active);
    const plain = clipboardEvent("cut", { "text/html": "<p>x</p>" });
    act(() => {
      screen.getByTestId("inside").dispatchEvent(plain.event);
    });
    expect(plain.store.has(INLINE_ENTITY_CLIPBOARD_MIME)).toBe(false);
    const outside = clipboardEvent("copy", { "text/html": token(company()) });
    act(() => {
      screen.getByTestId("outside").dispatchEvent(outside.event);
    });
    expect(outside.store.has(INLINE_ENTITY_CLIPBOARD_MIME)).toBe(false);
  });

  it("imports records for pasted references unknown to this material (after the paste)", () => {
    vi.useFakeTimers();
    const target = docWith([], []);
    const { update, applyLast } = mount(target);
    const payload = serializeInlineEntityClipboard([company(), person()]);
    const { event } = clipboardEvent("paste", {
      "text/html": `<p>${token(company())}</p>`,
      [INLINE_ENTITY_CLIPBOARD_MIME]: payload,
    });
    act(() => {
      screen.getByTestId("inside").dispatchEvent(event);
    });
    expect(update).not.toHaveBeenCalled();
    act(() => {
      vi.runAllTimers();
    });
    const imported = readInlineEntities(applyLast(target));
    expect(Object.keys(imported)).toEqual(["ie_acme0001"]);
  });

  it("falls back to localStorage and skips known or unrecoverable references", () => {
    vi.useFakeTimers();
    const target = docWith([], [company()]);
    const { update, applyLast } = mount(target);
    rememberCopiedInlineEntities([person()]);
    const known = clipboardEvent("paste", { "text/html": token(company()) });
    act(() => {
      screen.getByTestId("inside").dispatchEvent(known.event);
      vi.runAllTimers();
    });
    expect(update).not.toHaveBeenCalled();
    const ghost = clipboardEvent("paste", {
      "text/html": '<span data-nes-entity="ie_ghost001">?</span>',
    });
    act(() => {
      screen.getByTestId("inside").dispatchEvent(ghost.event);
      vi.runAllTimers();
    });
    expect(update).not.toHaveBeenCalled();
    const recalled = clipboardEvent("paste", { "text/html": token(person()) });
    act(() => {
      screen.getByTestId("inside").dispatchEvent(recalled.event);
      vi.runAllTimers();
    });
    expect(readInlineEntities(applyLast(target)).ie_maya0001).toBeDefined();
    const outside = clipboardEvent("paste", { "text/html": token(person({ id: "ie_other001" })) });
    act(() => {
      screen.getByTestId("outside").dispatchEvent(outside.event);
      vi.runAllTimers();
    });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
