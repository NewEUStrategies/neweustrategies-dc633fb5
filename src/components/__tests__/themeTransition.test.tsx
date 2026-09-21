import { Suspense } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "../ThemeProvider";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

it("keeps visible content during an early theme change while a descendant suspends", async () => {
  let ready = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  function Controls() {
    const { toggle } = useTheme();
    return <button onClick={toggle}>Theme</button>;
  }
  function Content() {
    const { theme } = useTheme();
    if (theme === "dark" && !ready) throw pending;
    return <article>Visible content: {theme}</article>;
  }
  render(
    <ThemeProvider>
      <Controls />
      <Suspense fallback={<p>Loading</p>}>
        <Content />
      </Suspense>
    </ThemeProvider>,
  );
  expect(screen.getByRole("article")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Theme" }));
  expect(document.documentElement).toHaveClass("dark");
  expect(localStorage.getItem("theme")).toBe("dark");
  expect(screen.getByRole("article")).toBeVisible();
  expect(screen.queryByText("Loading")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Theme" }));
  expect(document.documentElement).not.toHaveClass("dark");
  fireEvent.click(screen.getByRole("button", { name: "Theme" }));
  expect(document.documentElement).toHaveClass("dark");
  await act(async () => {
    ready = true;
    release();
    await pending;
  });
  expect(screen.getByRole("article")).toHaveTextContent("Visible content: dark");
});
