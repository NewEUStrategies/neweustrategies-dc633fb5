import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePostEditorStep } from "../usePostEditorStep";

describe("usePostEditorStep", () => {
  it("starts on 'details' while the post is still loading (null form)", () => {
    const { result } = renderHook(() => usePostEditorStep(null));
    expect(result.current.step).toBe("details");
  });

  it("auto-jumps to 'content' once a titled post loads", () => {
    const { result, rerender } = renderHook(({ form }) => usePostEditorStep(form), {
      initialProps: { form: null as { title_pl: string; title_en: string } | null },
    });
    expect(result.current.step).toBe("details");
    rerender({ form: { title_pl: "Witaj świecie", title_en: "" } });
    expect(result.current.step).toBe("content");
  });

  it("stays on 'details' for a brand-new untitled post", () => {
    const { result } = renderHook(() => usePostEditorStep({ title_pl: "  ", title_en: "" }));
    expect(result.current.step).toBe("details");
  });

  it("runs the auto-jump only once and never fights manual navigation", () => {
    const { result, rerender } = renderHook(({ form }) => usePostEditorStep(form), {
      initialProps: { form: { title_pl: "Tytuł", title_en: "" } },
    });
    expect(result.current.step).toBe("content");
    // User navigates back to details...
    act(() => result.current.setStep("details"));
    expect(result.current.step).toBe("details");
    // ...and a later form update (e.g. autosave echo) must NOT snap it back.
    rerender({ form: { title_pl: "Tytuł zmieniony", title_en: "" } });
    expect(result.current.step).toBe("details");
  });
});
