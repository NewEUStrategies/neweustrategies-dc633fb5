import { describe, it, expect } from "vitest";
import type { Block, Json } from "@/lib/blocks/types";
import {
  alignClass,
  bool,
  jsonList,
  num,
  objList,
  readBlocksArray,
  slugify,
  str,
  strList,
} from "../data";

const data = (o: Record<string, Json>): Record<string, Json> => o;

describe("renderer/data typed Json readers", () => {
  it("str returns strings and falls back for non-strings", () => {
    expect(str(data({ a: "hello" }), "a")).toBe("hello");
    expect(str(data({ a: 5 }), "a")).toBe("");
    expect(str(data({}), "a", "fallback")).toBe("fallback");
  });

  it("num coerces numbers and numeric strings, else falls back", () => {
    expect(num(data({ n: 7 }), "n", 1)).toBe(7);
    expect(num(data({ n: "42" }), "n", 1)).toBe(42);
    expect(num(data({ n: "nope" }), "n", 3)).toBe(3);
    expect(num(data({}), "n", 9)).toBe(9);
  });

  it("bool honors explicit default for missing/non-boolean values", () => {
    expect(bool(data({ b: true }), "b", false)).toBe(true);
    expect(bool(data({ b: false }), "b", true)).toBe(false);
    // Non-boolean -> explicit fallback (supports both !==false and Boolean patterns).
    expect(bool(data({ b: "yes" }), "b", true)).toBe(true);
    expect(bool(data({}), "b", false)).toBe(false);
  });

  it("strList keeps only string members", () => {
    expect(strList(data({ items: ["a", 2, null, "b"] }), "items")).toEqual(["a", "b"]);
    expect(strList(data({ items: "not-array" }), "items")).toEqual([]);
  });

  it("jsonList returns the raw array or empty", () => {
    expect(jsonList(data({ items: [1, "x"] }), "items")).toEqual([1, "x"]);
    expect(jsonList(data({}), "items")).toEqual([]);
  });

  it("objList maps only object members, skipping scalars/arrays", () => {
    const out = objList(
      data({ items: [{ label: "one" }, "skip", [1], { label: "two" }] }),
      "items",
      (o) => str(o, "label"),
    );
    expect(out).toEqual(["one", "two"]);
  });

  it("readBlocksArray narrows only well-formed block objects", () => {
    const raw: Json = [
      { id: "b1", type: "paragraph", data: { html: "x" } },
      { nope: true },
      "string",
    ];
    const blocks = readBlocksArray(raw);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("b1");
  });
});

describe("renderer/data presentational helpers", () => {
  const withAlign = (align: NonNullable<Block["style"]>["align"]): Block => ({
    id: "b",
    type: "paragraph",
    data: {},
    style: { align },
  });

  it("alignClass maps style.align to tailwind classes", () => {
    expect(alignClass(withAlign("center"))).toBe("text-center mx-auto");
    expect(alignClass(withAlign("right"))).toBe("text-right ml-auto");
    expect(alignClass(withAlign("wide"))).toBe("mx-auto w-full max-w-5xl");
    expect(alignClass(withAlign("full"))).toBe("w-full");
    expect(alignClass({ id: "b", type: "paragraph", data: {} })).toBe("");
  });

  it("slugify produces deterministic ASCII anchors", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("  Trim -- Me  ")).toBe("trim-me");
    expect(slugify("Ä Ö")).toBe("a-o");
  });
});
