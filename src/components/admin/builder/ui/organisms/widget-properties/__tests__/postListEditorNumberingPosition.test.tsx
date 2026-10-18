// PostListEditor - położenie i grubość numeru w wariantach „numbered"
// i „ranked".
//
// Rozmiar i kolory numeru pilnuje `postListEditorData`. Tu domykamy trzy
// listy, które widok (`PostListView`) czyta wprost: grubość (napis wagi),
// strona (`left` / `right`) i wyrównanie pionowe (`top` / `middle` /
// `bottom`). Każda zapisuje WARTOŚĆ, którą widok rozumie, pod własnym kluczem,
// a domyślne zaznaczenie w panelu odpowiada domyślnemu rysunkowi strony.
//
// Granice: atrapy Radix Select/Switch, i18n jako echo klucza, Supabase
// (łańcuch z `@/test/supabaseChain`, puste listy - licznik i miniatury nie są
// przedmiotem testu), kalendarz jako atrapa jak w `postListEditorData`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import type { Json, WidgetNode } from "@/lib/builder/types";
import { PostListEditor } from "../PostListEditor";

const db: { current: SupabaseFromStub } = { current: supabaseFromStub() };

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});
vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.current.from(table) },
}));
vi.mock("@/components/admin/blocks/AdminDatePicker", () => ({
  AdminDatePicker: () => null,
}));

function renderEditor(initial: WidgetNode["content"]) {
  const written: Array<[string, Json]> = [];
  function Host() {
    const [content, setContent] = useState<WidgetNode["content"]>(initial);
    return (
      <PostListEditor
        c={content}
        lang="pl"
        setContent={(k, v) => {
          written.push([k, v]);
          setContent((prev) => ({ ...prev, [k]: v }));
        }}
      />
    );
  }
  renderWithQueryClient(<Host />);
  return { written };
}

/** Lista pod etykietą `PropField` (etykieta nie jest powiązana z kontrolką). */
const selectUnder = (label: string): HTMLSelectElement => {
  const select = screen
    .getByText(label, { selector: "label" })
    .parentElement?.querySelector<HTMLSelectElement>("select");
  if (!select) throw new Error(`test: brak listy „${label}"`);
  return select;
};

beforeEach(() => {
  db.current = supabaseFromStub();
  for (const table of ["posts", "categories", "tags", "profiles_public"]) {
    db.current.setResponse(table, ok([]));
  }
});

describe("PostListEditor - położenie numeru", () => {
  it.each(["numbered", "ranked"] as const)(
    "wariant %s: domyślnie waga 800, numer po prawej, u góry",
    (variant) => {
      renderEditor({ source: "dynamic", variant });
      expect(selectUnder("builder.postListEditor.weight").value).toBe("800");
      expect(selectUnder("builder.postListEditor.hPosition").value).toBe("right");
      expect(selectUnder("builder.postListEditor.vPosition").value).toBe("top");
    },
  );

  it("wybory zapisują wartości, które widok rozumie, pod własnymi kluczami", () => {
    const { written } = renderEditor({ source: "dynamic", variant: "ranked" });
    fireEvent.change(selectUnder("builder.postListEditor.weight"), { target: { value: "600" } });
    fireEvent.change(selectUnder("builder.postListEditor.hPosition"), {
      target: { value: "left" },
    });
    fireEvent.change(selectUnder("builder.postListEditor.vPosition"), {
      target: { value: "bottom" },
    });
    expect(written).toEqual([
      ["indexWeight", "600"],
      ["indexSide", "left"],
      ["indexVAlign", "bottom"],
    ]);
  });

  it("wariant kartowy nie ma list położenia numeru", () => {
    renderEditor({ source: "dynamic", variant: "card" });
    expect(
      screen.queryByText("builder.postListEditor.hPosition", { selector: "label" }),
    ).toBeNull();
  });
});
