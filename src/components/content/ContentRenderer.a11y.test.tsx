import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ContentRenderer } from "./ContentRenderer";
import { emptyDocument } from "@/lib/builder/types";
import type { BlocksDoc } from "@/lib/blocks/types";
import { axeViolations, summarize } from "@/test/axe";

const blocks = (html: string): BlocksDoc => ({
  version: 1,
  blocks: [{ id: "p1", type: "paragraph", data: { html } }],
});

const RICH_HTML = `
  <h2>Nagłówek sekcji</h2>
  <p>Akapit z <a href="https://example.com">odnośnikiem</a> i <strong>pogrubieniem</strong>.</p>
  <ul><li>Element listy</li><li>Drugi element</li></ul>
  <figure><img src="https://x/storage/v1/object/public/m/a.jpg" alt="Opis obrazu" /><figcaption>Podpis</figcaption></figure>
`;

describe("ContentRenderer accessibility (axe)", () => {
  it("renders accessible HTML for the richtext path", async () => {
    const { container } = render(
      <main>
        <ContentRenderer editor="richtext" builderDoc={emptyDocument()} blocksDoc={null} html={RICH_HTML} lang="pl" />
      </main>,
    );
    const v = await axeViolations(container);
    expect(v, summarize(v)).toEqual([]);
  });

  it("renders accessible output for the blocks engine", async () => {
    const { container } = render(
      <main>
        <ContentRenderer
          editor="blocks"
          builderDoc={emptyDocument()}
          blocksDoc={blocks("<p>Treść z <a href='https://example.com'>linkiem</a>.</p>")}
          html=""
          lang="en"
        />
      </main>,
    );
    const v = await axeViolations(container);
    expect(v, summarize(v)).toEqual([]);
  });
});
