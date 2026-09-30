import { lazy, Suspense, type ComponentType } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

it.each(["stored preference", "early toggle"])(
  "retains SSR content when a lazy widget hydrates after a theme change: %s",
  async (change) => {
    function Controls() {
      const { toggle } = useTheme();
      return <button onClick={toggle}>Theme</button>;
    }
    function Content() {
      const { theme } = useTheme();
      // CMS typography can be configured only for the light theme. The style
      // node's presence must match SSR even when the current theme is dark.
      return (
        <>
          {theme === "light" && <style>{"article { color: black }"}</style>}
          <article data-theme={theme}>Server article</article>
        </>
      );
    }
    const view = (Widget: ComponentType) => (
      <ThemeProvider>
        <Controls />
        <Suspense fallback={<p>Loading</p>}>
          <Widget />
        </Suspense>
      </ThemeProvider>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(view(Content));
    document.body.append(host);
    const original = host.querySelector("article");
    let release!: (module: { default: typeof Content }) => void;
    const pending = new Promise<{ default: typeof Content }>((resolve) => {
      release = resolve;
    });
    if (change === "stored preference") localStorage.setItem("theme", "dark");
    const errors: unknown[] = [];
    const root = hydrateRoot(host, view(lazy(() => pending)), {
      onRecoverableError: (error) => errors.push(error),
    });
    try {
      await act(async () => {});
      if (change === "early toggle") {
        fireEvent.click(screen.getByRole("button", { name: "Theme" }));
        expect(document.documentElement).toHaveClass("dark");
      }
      expect(original?.isConnected).toBe(true);
      await act(async () => {
        release({ default: Content });
        await pending;
      });
      expect(errors).toEqual([]);
      expect(host.querySelector("article")).toBe(original);
      expect(original).toHaveAttribute("data-theme", "dark");
      expect(host.querySelector("style")).toBeNull();
    } finally {
      release({ default: Content });
      await act(async () => root.unmount());
      host.remove();
    }
  },
);
