// `ThemeToggle` / `ThemeToggleIcon` - przełącznik motywu z animowaną wymianą
// ikony. Plik pilnuje:
//   * właściwej ikony i etykiety dla obu motywów (słońce w dark, księżyc w light),
//   * klasy animacji wejścia: słońce z obrotem zgodnym ze wskazówkami
//     (`theme-icon-in-cw`), księżyc przeciwnym (`theme-icon-in-ccw`) - to one
//     odtwarzają animację przy każdym przełączeniu (remont przez `key`),
//   * wywołania `toggle` z przycisku.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "../ThemeToggle";
import { ThemeToggleIcon } from "../ThemeToggleIcon";

const h = vi.hoisted(() => ({
  theme: "light" as "light" | "dark",
  toggle: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({ theme: h.theme, toggle: h.toggle, setTheme: vi.fn() }),
}));

beforeEach(() => {
  h.theme = "light";
  h.toggle.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("ThemeToggleIcon - animowana wymiana ikony", () => {
  it("jasny motyw: księżyc z animacją przeciwną do wskazówek", () => {
    const { container } = render(<ThemeToggleIcon isDark={false} iconClassName="w-4 h-4" />);

    const span = container.querySelector("span");
    expect(span?.className).toContain("theme-icon-in-ccw");
    expect(span?.className).not.toContain("theme-icon-in-cw ");
    expect(container.querySelector("svg")?.classList.contains("w-4")).toBe(true);
  });

  it("ciemny motyw: słońce z animacją zgodną ze wskazówkami", () => {
    const { container } = render(<ThemeToggleIcon isDark={true} iconClassName="w-4 h-4" />);

    const span = container.querySelector("span");
    expect(span?.className).toContain("theme-icon-in-cw");
    expect(span?.className).not.toContain("ccw");
  });
});

describe("ThemeToggle - przycisk", () => {
  it("na jasnym motywie oferuje tryb ciemny i woła toggle po kliku", () => {
    render(<ThemeToggle />);

    const button = screen.getByRole("button", { name: "common.preview.darkMode" });
    fireEvent.click(button);

    expect(h.toggle).toHaveBeenCalledTimes(1);
  });

  it("na ciemnym motywie oferuje tryb jasny", () => {
    h.theme = "dark";
    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "common.preview.lightMode" })).toBeTruthy();
  });
});
