// BlocksRenderer na poziomie DOKUMENTU: nadpisania odstępów z inspektora bloku,
// język i zakres tenanta artykułu oraz odporność na wadliwe dane wejściowe.
//
// Co dowodzimy i dlaczego:
//   * margines z inspektora (`style.marginTop/Bottom`) trafia do opakowania
//     bloku jako piksele - także wartość 0 (autor celowo zeruje odstęp) - a blok
//     bez nadpisań NIE dostaje opakowania (zachowuje odstępy prose i
//     wyrównanie wide/full);
//   * `<article>` niesie `lang` treści i znacznik zakresu tenanta tylko wtedy,
//     gdy host podano jawnie (identyczny na serwerze i kliencie);
//   * dokument niepoprawny w całości renderuje pustkę, a jeden blok spoza
//     schematu nie wygasza pozostałych.
//
// Granice: brak atrap - publiczny komponent z prawdziwym i18n.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { BlocksRenderer } from "../BlocksRenderer";

const doc = (blocks: Block[]): BlocksDoc => ({ version: 1, blocks });
const para = (id: string, text: string, style?: Block["style"]): Block => ({
  id,
  type: "paragraph",
  data: { html: `<p>${text}</p>` },
  ...(style ? { style } : {}),
});

describe("nadpisania odstępów bloku", () => {
  it("opakowuje tylko bloki z marginesem i przekłada go na piksele (także 0)", () => {
    const { container } = render(
      <BlocksRenderer
        doc={doc([
          para("a", "Naturalny"),
          para("b", "Góra", { marginTop: 32 }),
          para("c", "Dół", { marginBottom: 0 }),
          para("d", "Oba", { marginTop: 8, marginBottom: 48 }),
        ])}
      />,
    );
    const top = Array.from(container.querySelector("article")?.children ?? []) as HTMLElement[];
    expect(top.map((el) => [el.textContent, el.style.marginTop, el.style.marginBottom])).toEqual([
      ["Naturalny", "", ""],
      ["Góra", "32px", ""],
      ["Dół", "", "0px"],
      ["Oba", "8px", "48px"],
    ]);
    // Blok bez nadpisań to bezpośrednio element bloku, bez dodatkowego <div>.
    expect(top[0].getAttribute("style")).toBeNull();
    expect(top[1].firstElementChild?.textContent).toBe("Góra");
  });
});

describe("artykuł: język, tenant i odporność danych", () => {
  it("niesie język treści, a zakres tenanta tylko dla jawnie podanego hosta", () => {
    const { container, rerender } = render(
      <BlocksRenderer doc={doc([para("a", "Text")])} lang="en" />,
    );
    const article = () => container.querySelector("article");
    expect(article()?.getAttribute("lang")).toBe("en");
    expect(article()?.hasAttribute("data-tenant-scope")).toBe(false);
    rerender(<BlocksRenderer doc={doc([para("a", "Text")])} lang="en" tenantHost="nes.eu" />);
    expect(article()?.getAttribute("data-tenant-scope")).toBe("nes.eu");
  });

  it("dokument niepoprawny w całości nie renderuje nic; blok spoza schematu nie wygasza reszty", () => {
    const broken = render(<BlocksRenderer doc={{ version: 1, blocks: "nie-lista" } as never} />);
    expect(broken.container.innerHTML).toBe("");

    const partial = render(
      <BlocksRenderer
        doc={
          {
            version: 1,
            blocks: [para("a", "Zostaję"), { id: "x", type: "nieznany-typ", data: {} }],
          } as never
        }
      />,
    );
    expect(partial.container.textContent).toBe("Zostaję");
  });
});
