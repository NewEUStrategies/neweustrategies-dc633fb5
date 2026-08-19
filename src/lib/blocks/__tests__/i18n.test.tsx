import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

import { useBlocksI18n } from "@/lib/blocks/i18n";

// Wrapper `useBlocksI18n` był martwy (0% linii, 0 z 6 funkcji), a to on decyduje,
// w jakim namespace ląduje KAŻDA etykieta edytora i widoku bloku. Zły prefiks nie
// wywala renderu - pokazuje surowy klucz na publicznej stronie. Asercje idą na
// KLUCZACH (atrapa echuje klucz), nie na polskim napisie: test na napisie padałby
// przy pierwszej poprawionej literówce w tłumaczeniu.

describe("useBlocksI18n", () => {
  it("t() przepuszcza klucz bez prefiksu (rzadkie klucze spoza namespace)", () => {
    const { result } = renderHook(() => useBlocksI18n());
    expect(result.current.t("common.save")).toBe("common.save");
  });

  it.each([
    ["field", "urlPh", "blocks.fields.urlPh"],
    ["ui", "addBlock", "blocks.ui.addBlock"],
    ["viewer", "loadMore", "blocks.viewers.loadMore"],
  ] as const)("%s() prefiksuje klucz na %s -> %s", (method, key, expected) => {
    const { result } = renderHook(() => useBlocksI18n());
    expect(result.current[method](key)).toBe(expected);
  });

  it("editor() składa prefiks z grupy i klucza", () => {
    const { result } = renderHook(() => useBlocksI18n());
    expect(result.current.editor("gallery", "columns")).toBe("blocks.editors.gallery.columns");
  });

  it.each(["t", "field", "ui", "viewer"] as const)(
    "%s() przekazuje parametry interpolacji do i18next",
    (method) => {
      const { result } = renderHook(() => useBlocksI18n());
      expect(result.current[method]("k", { count: 3 })).toContain("count=3");
    },
  );

  it("editor() przekazuje parametry interpolacji", () => {
    const { result } = renderHook(() => useBlocksI18n());
    expect(result.current.editor("g", "k", { count: 0 })).toBe("blocks.editors.g.k(count=0)");
  });

  // Pusty klucz i pusta grupa - fałszywe, ale PRAWIDŁOWE wejścia. Wrapper nie
  // ma prawa ich odrzucić ani zgubić kropki, bo wtedy fallback i18next szuka
  // innego klucza niż ten, który jest w pliku tłumaczeń.
  it("zachowuje kropki także dla pustego klucza i pustej grupy", () => {
    const { result } = renderHook(() => useBlocksI18n());
    expect(result.current.field("")).toBe("blocks.fields.");
    expect(result.current.editor("", "")).toBe("blocks.editors..");
  });
});
