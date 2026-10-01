import { Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tanstack/router-core/isServer", () => ({ isServer: false }));
import { RichHtmlView } from "../widget-view/RichHtmlView";
import { RichHtmlListView } from "../widget-view/RichHtmlListView";

beforeEach(() => vi.stubEnv("SSR", false));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const view = (html: string) => (
  <Suspense fallback={<p>Loading list</p>}>
    <RichHtmlView html={html} className="cms-rich-content" style={{ color: "red" }} />
  </Suspense>
);

it("hydrates the eager SSR list without replacing its DOM while the client chunk resolves", async () => {
  const html = "<ul><li><ul><li>SSR item</li></ul></li></ul>";
  const container = document.createElement("div");
  container.innerHTML = renderToString(
    <Suspense fallback={<p>Loading list</p>}>
      <RichHtmlListView html={html} className="cms-rich-content" style={{ color: "red" }} />
    </Suspense>,
  );
  const item = container.querySelector("li");
  const errors: unknown[] = [];
  const root = hydrateRoot(container, view(html), {
    onRecoverableError: (error) => errors.push(error),
  });
  await act(async () => {
    await import("../widget-view/RichHtmlListView");
  });
  expect(errors).toEqual([]);
  expect(container.textContent).toBe("SSR item");
  expect(container.querySelector("li")).toBe(item);
  await act(async () => root.unmount());
});

it("renders ordinary rich text immediately and still sanitizes it", () => {
  const { container } = render(
    view(
      '<p>Visible <strong>text</strong></p><img src="x" onerror="alert(1)"><script>alert(1)</script>',
    ),
  );
  expect(screen.getByText("text").tagName).toBe("STRONG");
  expect(screen.queryByText("Loading list")).toBeNull();
  expect(container.querySelector("script, [onerror]")).toBeNull();
  expect(container.querySelector(".cms-rich-content")?.getAttribute("style")).toContain("red");
});

it("loads normalization for lists and supports switching between list and plain content", async () => {
  const { container, rerender } = render(view("<UL><LI><UL><LI>Real item</LI></UL></LI></UL>"));
  await screen.findByText("Real item");
  expect(container.querySelectorAll("ul")).toHaveLength(1);
  expect(container.querySelectorAll("li")).toHaveLength(1);
  rerender(view("<p>Plain update</p>"));
  expect(screen.getByText("Plain update")).toBeTruthy();
  expect(container.querySelector("ul")).toBeNull();
  rerender(view('<ol><li>&nbsp;</li><li><a href="javascript:alert(1)">Safe item</a></li></ol>'));
  await screen.findByText("Safe item");
  expect(container.querySelectorAll("li")).toHaveLength(1);
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
});
