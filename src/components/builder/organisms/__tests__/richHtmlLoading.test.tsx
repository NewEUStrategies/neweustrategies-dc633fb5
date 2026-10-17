import { Suspense } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  // Bez kompilatora Start: gałąź wybiera `import.meta.env.SSR`, jak w buildzie.
  createIsomorphicFn: () => ({
    server: (server: () => unknown) => ({
      client: (client: () => unknown) => (import.meta.env.SSR ? server : client),
    }),
  }),
}));

// Moduł czyta gałąź przy imporcie - środowisko klienta ustawione przed nim.
vi.stubEnv("SSR", false);
const { RichHtmlView } = await import("../widget-view/RichHtmlView");
const { RichHtmlListView } = await import("../widget-view/RichHtmlListView");
const { RichHtmlContent } = await import("../widget-view/RichHtmlContent");
const { normalizeBuilderRichHtml } = await import("@/lib/builder/normalizeRichHtml");

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

it("keeps the server-normalized list where the browser twin would normalize differently", async () => {
  // Lista w `<p>` to jedna ze znanych klas rozjazdu silników na wejściu
  // niepoprawnym (normalizeRichHtml.test.ts, „ZNANE RÓŻNICE”): serwer zostawia
  // „Treść” w akapicie, bliźniak DOM wynosi ją poza akapit. React 19 nie łata
  // `dangerouslySetInnerHTML` przy hydratacji, więc pierwsze wejście zostaje
  // przy HTML-u serwera - bez błędu i bez podmiany.
  const html = "<p><ul><li>&nbsp;</li></ul>Treść</p><ul><li><ul><li>Punkt</li></ul></li></ul>";
  const container = document.createElement("div");
  container.innerHTML = renderToString(
    <Suspense fallback={<p>Loading list</p>}>
      <RichHtmlContent
        html={normalizeBuilderRichHtml(html)}
        className="cms-rich-content"
        style={{ color: "red" }}
      />
    </Suspense>,
  );
  const serverHtml = container.innerHTML;
  const serverContent = container.querySelector(".cms-rich-content")?.innerHTML;
  expect(serverContent).toContain("<p>Treść</p>");
  const errors: unknown[] = [];
  const root = hydrateRoot(container, view(html), {
    onRecoverableError: (error) => errors.push(error),
  });
  await act(async () => {
    await import("../widget-view/RichHtmlListView");
  });
  expect(errors).toEqual([]);
  expect(container.innerHTML).toBe(serverHtml);
  // Tekst wielokolumnowy dostaje NOWY obiekt `style` (o tej samej treści)
  // z każdym renderem rodzica (`ChromeWidgetView`), tak jak `view()` tutaj.
  // Taki re-render nie może przepisać treści na wersję bliźniaka DOM - inaczej
  // akapit przeskakiwałby po pierwszym re-renderze po hydratacji.
  await act(async () => root.render(view(html)));
  const content = container.querySelector(".cms-rich-content");
  expect(content?.getAttribute("style")).toContain("red");
  expect(content?.innerHTML).toBe(serverContent);
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
