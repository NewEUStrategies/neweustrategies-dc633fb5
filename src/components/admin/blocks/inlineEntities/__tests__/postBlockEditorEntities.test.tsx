// Encje inline w PEŁNYM edytorze wpisu: edycja rekordu w jednym miejscu
// przepisuje wszystkie odwołania (etykiety) i rejestr drugiej wersji językowej,
// a cofnięcie przywraca poprzedni stan - bez dotykania CRM ani profilu autora.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LocalizedBlocks } from "@/lib/blocks/types";
import { readInlineEntities } from "@/lib/blocks/inlineEntities/registry";
import { company, docWith, paragraph, token } from "@/lib/blocks/inlineEntities/__tests__/fixtures";
import { realT } from "@/test/i18nReal";

realT("pl");

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/admin/onboarding/CoachmarkTour", () => ({ CoachmarkTour: () => null }));
vi.mock("../InlineEntityImageField", () => ({ InlineEntityImageField: () => null }));

const { PostBlockEditor } = await import("../../PostBlockEditor");

function mount(start: LocalizedBlocks) {
  const changes: LocalizedBlocks[] = [];
  function Parent() {
    const [value, setValue] = useState(start);
    return (
      <PostBlockEditor
        value={value}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
        documentPane={<div />}
      />
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Parent />
    </QueryClientProvider>,
  );
  return changes;
}

describe("PostBlockEditor + inline entities", () => {
  it("edits one record and updates every occurrence in both languages", async () => {
    const start: LocalizedBlocks = {
      pl: docWith(
        [paragraph("p1", `<p>${token(company())} i znowu ${token(company())}</p>`)],
        [company()],
      ),
      en: docWith([paragraph("e1", `<p>${token(company())}</p>`)], []),
    };
    const changes = mount(start);

    fireEvent.click(screen.getByRole("button", { name: /Firmy i osoby/ }));
    expect(screen.getByText("3×")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edytuj: Acme Energy" }));
    fireEvent.change(await screen.findByLabelText("Nazwa firmy"), {
      target: { value: "Acme Storage" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz zmiany" }));

    await waitFor(() => expect(changes.length).toBeGreaterThan(0));
    const last = changes.at(-1)!;
    expect(readInlineEntities(last.pl).ie_acme0001).toMatchObject({ name: "Acme Storage" });
    expect(readInlineEntities(last.en).ie_acme0001).toMatchObject({ name: "Acme Storage" });
    const plHtml = String(last.pl.blocks[0].data.html);
    expect(plHtml.match(/>Acme Storage<\/span>/g)).toHaveLength(2);
    expect(String(last.en.blocks[0].data.html)).toContain(">Acme Storage</span>");

    // Cofnięcie przywraca poprzednią nazwę - także w lustrze EN.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Cofnij" }));
    });
    await waitFor(() =>
      expect(readInlineEntities(changes.at(-1)!.en).ie_acme0001).toMatchObject({
        name: "Acme Energy",
      }),
    );
  });

  it("does not create a new EN object while nothing changes in the registry", async () => {
    const start: LocalizedBlocks = {
      pl: docWith(
        [paragraph("p1", "<p>Akapit pierwszy</p>"), paragraph("p2", "<p>Akapit drugi</p>")],
        [],
      ),
      en: docWith([], []),
    };
    const changes = mount(start);
    // Aktywacja bloku i przestawienie go skrótem = realna propagacja PL.
    fireEvent.click((await screen.findAllByText("Akapit pierwszy"))[0]);
    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(changes.length).toBeGreaterThan(0));
    expect(changes.at(-1)!.pl.blocks.map((b) => b.id)).toEqual(["p2", "p1"]);
    // Lustro rejestru nie ma czego kopiować - EN zostaje TYM SAMYM obiektem.
    for (const change of changes) expect(change.en).toBe(start.en);
  });
});
