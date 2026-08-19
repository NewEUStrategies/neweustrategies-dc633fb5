import { useState } from "react";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CountryCombobox,
  normalizeCountrySearch,
  useCountryList,
} from "@/components/interests/CountryCombobox";

const countryFixture = vi.hoisted(() => ({
  names: {
    pl: { PL: "Polska", DE: "Niemcy", XX: "Łódź" } as Record<string, string>,
    en: { PL: "Poland", DE: "Germany", XX: "Lodz" } as Record<string, string>,
  },
}));

vi.mock("@/lib/countries", () => ({
  getNames: (lang: "pl" | "en") => countryFixture.names[lang],
  getAlpha2Code: (name: string) =>
    ({ Polska: "PL", Poland: "PL", Niemcy: "DE", Germany: "DE" })[name],
}));

function Harness({ lang = "pl" }: { lang?: "pl" | "en" }) {
  const [value, setValue] = useState("");
  return (
    <CountryCombobox
      value={value}
      onChange={setValue}
      lang={lang}
      label={lang === "pl" ? "Kraj" : "Country"}
      required
      name="country"
    />
  );
}

describe("CountryCombobox", () => {
  beforeEach(() => {
    countryFixture.names.pl = { PL: "Polska", DE: "Niemcy", XX: "Łódź" };
    countryFixture.names.en = { PL: "Poland", DE: "Germany", XX: "Lodz" };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("normalizuje znaki diakrytyczne, w tym polskie Ł", () => {
    expect(normalizeCountrySearch("  POLSKA  ")).toBe("  polska  ");
    expect(normalizeCountrySearch("Łódź")).toBe("lodz");
    expect(normalizeCountrySearch("Crème brûlée")).toBe("creme brulee");
  });

  it("buduje posortowaną listę odpowiednią dla języka", () => {
    const { result, rerender } = renderHook(({ lang }) => useCountryList(lang), {
      initialProps: { lang: "pl" as "pl" | "en" },
    });
    expect(result.current).toHaveLength(3);
    expect(result.current).toContain("Polska");

    rerender({ lang: "en" });
    expect(result.current).toContain("Poland");
    expect(result.current).not.toContain("Polska");
  });

  it("znajduje Polskę bez względu na wielkość liter", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Kraj" });

    fireEvent.change(input, { target: { value: "polska" } });

    expect(screen.getByRole("option", { name: "Polska" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Niemcy" })).not.toBeInTheDocument();
  });

  it("znajduje syntetyczną nazwę Łódź po wpisaniu lodz", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Kraj" });

    fireEvent.change(input, { target: { value: "lodz" } });

    expect(screen.getByRole("option", { name: "Łódź" })).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("pozostawia wpis użytkownika, gdy kraj nie istnieje", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Kraj" });

    fireEvent.change(input, { target: { value: "Atlantyda" } });

    expect(input).toHaveValue("Atlantyda");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("nie otwiera pustej listy katalogowej", () => {
    countryFixture.names.pl = {};
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Kraj" });

    fireEvent.focus(input);

    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("wybiera podświetloną pozycję klawiszami strzałek i Enter", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Kraj" });
    fireEvent.focus(input);
    const options = screen.getAllByRole("option");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toBe(options[1]?.id);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue(options[1]?.textContent ?? "");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("obsługuje strzałkę w górę i zamyka listę klawiszem Escape", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Kraj" });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });

    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0]?.id);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("wybiera kraj myszą i pokazuje jego flagę", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Kraj" });
    fireEvent.change(input, { target: { value: "Pol" } });

    fireEvent.mouseDown(screen.getByRole("option", { name: "Polska" }));

    expect(input).toHaveValue("Polska");
    expect(document.querySelector('img[src*="/pl.png"]')).toBeInTheDocument();
  });

  it("zamyka listę po kliknięciu poza polem", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Kraj" });
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
