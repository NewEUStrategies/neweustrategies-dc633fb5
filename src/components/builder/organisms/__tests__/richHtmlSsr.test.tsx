// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  // Bez kompilatora Start: gałąź wybiera `import.meta.env.SSR`, jak w buildzie.
  createIsomorphicFn: () => ({
    server: (server: () => unknown) => ({
      client: (client: () => unknown) => (import.meta.env.SSR ? server : client),
    }),
  }),
}));

vi.stubEnv("SSR", true);
const { RichHtmlView } = await import("../widget-view/RichHtmlView");

it("renders normalized lists synchronously in SSR, with footnotes and sanitization intact", () => {
  const html = renderToStaticMarkup(
    <RichHtmlView
      html={"<ul><li><ul><li>Item [fn]Source[/fn]</li></ul></li></ul><script>alert(1)</script>"}
    />,
  );
  expect(html.match(/<ul>/g)).toHaveLength(1);
  expect(html).toContain("Item");
  expect(html).not.toContain("[fn]");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("Loading");
});
