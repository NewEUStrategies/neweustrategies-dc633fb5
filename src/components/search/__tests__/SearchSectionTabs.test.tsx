import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchSectionTabs } from "../SearchSectionTabs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

describe("SearchSectionTabs", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renderuje pięć sekcji w kolejności premium z wzorcem tablist/tab", () => {
    render(<SearchSectionTabs active="all" onPick={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "search.tabs.all",
      "search.tabs.titles",
      "search.tabs.types",
      "search.tabs.topics",
      "search.tabs.people",
    ]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
  });

  it("klik w zakładkę emituje jej identyfikator", () => {
    const onPick = vi.fn();
    render(<SearchSectionTabs active="all" onPick={onPick} />);
    fireEvent.click(screen.getByRole("tab", { name: /search\.tabs\.people/ }));
    expect(onPick).toHaveBeenCalledWith("people");
  });

  it("pokazuje liczniki tylko dla znanych wartości", () => {
    render(<SearchSectionTabs active="people" counts={{ people: 7 }} onPick={() => {}} />);
    const people = screen.getByRole("tab", { name: /search\.tabs\.people/ });
    expect(people.textContent).toContain("7");
    const titles = screen.getByRole("tab", { name: /search\.tabs\.titles/ });
    expect(titles.textContent).not.toMatch(/\d/);
  });
});
