import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdvancedSearchPanel } from "../AdvancedSearchPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

describe("AdvancedSearchPanel", () => {
  beforeEach(() => {
    cleanup();
  });

  it("zaznacza aktywny tryb dopasowania i zakres (aria-pressed)", () => {
    render(<AdvancedSearchPanel url={{ q: "x", match: "phrase" }} onChange={() => {}} />);
    const phrase = screen.getByRole("button", { name: "search.adv.match.phrase" });
    expect(phrase.getAttribute("aria-pressed")).toBe("true");
    const all = screen.getByRole("button", { name: "search.adv.match.all" });
    expect(all.getAttribute("aria-pressed")).toBe("false");
    // Zakres bez wyboru = domyślny "all".
    const scopeAll = screen.getByRole("button", { name: "search.adv.scope.all" });
    expect(scopeAll.getAttribute("aria-pressed")).toBe("true");
  });

  it("wybór trybu emituje łatkę URL; wartość domyślna czyści klucz (undefined)", () => {
    const onChange = vi.fn();
    render(<AdvancedSearchPanel url={{ q: "x" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "search.adv.match.any" }));
    expect(onChange).toHaveBeenCalledWith({ match: "any" });
    fireEvent.click(screen.getByRole("button", { name: "search.adv.scope.title" }));
    expect(onChange).toHaveBeenCalledWith({ scope: "title" });
    fireEvent.click(screen.getByRole("button", { name: "search.adv.match.all" }));
    expect(onChange).toHaveBeenCalledWith({ match: undefined });
  });

  it("pokazuje ściągę składni zapytań", () => {
    render(<AdvancedSearchPanel url={{ q: "" }} onChange={() => {}} />);
    expect(screen.getByText("search.adv.syntax_title")).toBeTruthy();
    expect(screen.getByText("-sankcje")).toBeTruthy();
  });
});
