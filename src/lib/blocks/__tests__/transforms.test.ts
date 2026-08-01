import { describe, it, expect } from "vitest";
import { transformBlock, getTransformTargets } from "@/lib/blocks/transforms";
import type { Block } from "@/lib/blocks/types";

const paragraph: Block = {
  id: "b_p",
  type: "paragraph",
  data: { html: "Hello <strong>world</strong>" },
};

describe("getTransformTargets", () => {
  it("offers the text family without the current type", () => {
    const targets = getTransformTargets(paragraph);
    expect(targets).toContain("heading");
    expect(targets).toContain("list");
    expect(targets).toContain("quote");
    expect(targets).not.toContain("paragraph");
  });

  it("offers nothing for non-text blocks", () => {
    expect(getTransformTargets({ id: "b_i", type: "image", data: { url: "/x.png" } })).toEqual([]);
  });
});

describe("transformBlock", () => {
  it("paragraph -> heading keeps inline HTML", () => {
    const out = transformBlock(paragraph, "heading")!;
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("heading");
    expect(out[0].data.text).toBe("Hello <strong>world</strong>");
    expect(out[0].data.level).toBe(2);
  });

  it("heading -> paragraph keeps inline HTML", () => {
    const heading: Block = {
      id: "b_h",
      type: "heading",
      data: { level: 3, text: "Tytuł <em>sekcji</em>", anchor: "" },
    };
    const out = transformBlock(heading, "paragraph")!;
    expect(out[0].type).toBe("paragraph");
    expect(out[0].data.html).toBe("Tytuł <em>sekcji</em>");
  });

  it("list -> paragraph emits one paragraph per item (Gutenberg behavior)", () => {
    const list: Block = {
      id: "b_l",
      type: "list",
      data: { ordered: false, items: ["Jeden", "Dwa <strong>mocne</strong>"] },
    };
    const out = transformBlock(list, "paragraph")!;
    expect(out).toHaveLength(2);
    expect(out[0].data.html).toBe("Jeden");
    expect(out[1].data.html).toBe("Dwa <strong>mocne</strong>");
  });

  it("paragraph -> list splits lines into items", () => {
    const p: Block = { id: "b_p2", type: "paragraph", data: { html: "Jeden<br>Dwa" } };
    const out = transformBlock(p, "list")!;
    expect(out[0].type).toBe("list");
    expect(out[0].data.items).toEqual(["Jeden", "Dwa"]);
  });

  it("paragraph -> quote strips markup into text", () => {
    const out = transformBlock(paragraph, "quote")!;
    expect(out[0].type).toBe("quote");
    expect(out[0].data.text).toBe("Hello world");
  });

  it("paragraph -> code keeps raw text", () => {
    const p: Block = { id: "b_c", type: "paragraph", data: { html: "const a = 1;" } };
    const out = transformBlock(p, "code")!;
    expect(out[0].type).toBe("code");
    expect(out[0].data.code).toBe("const a = 1;");
  });

  it("quote -> pullquote carries text and cite", () => {
    const q: Block = { id: "b_q", type: "quote", data: { text: "Motto", cite: "Autor" } };
    const out = transformBlock(q, "pullquote")!;
    expect(out[0].type).toBe("pullquote");
    expect(out[0].data.text).toBe("Motto");
    expect(out[0].data.cite).toBe("Autor");
  });

  it("details gets first line as summary, rest as body", () => {
    const p: Block = { id: "b_d", type: "paragraph", data: { html: "Pytanie<br>Odpowiedź" } };
    const out = transformBlock(p, "details")!;
    expect(out[0].data.summary).toBe("Pytanie");
    expect(out[0].data.body).toBe("Odpowiedź");
  });

  it("returns null for same-type or unsupported targets", () => {
    expect(transformBlock(paragraph, "paragraph")).toBeNull();
    expect(transformBlock(paragraph, "chart")).toBeNull();
  });

  it("every advertised target produces a non-empty transformation", () => {
    for (const target of getTransformTargets(paragraph)) {
      const out = transformBlock(paragraph, target);
      expect(out, `transform to ${target}`).not.toBeNull();
      expect(out!.length).toBeGreaterThan(0);
      expect(out![0].type).toBe(target);
    }
  });
});
