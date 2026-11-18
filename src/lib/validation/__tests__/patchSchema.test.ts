import { describe, expect, it } from "vitest";
import { z } from "zod";

import { patchSchema } from "../patchSchema";

const Create = z.object({
  status: z.enum(["draft", "published"]).default("draft"),
  title_pl: z.string().max(5).default(""),
  excerpt: z.string().nullable().optional(),
});

describe("patchSchema", () => {
  it("pominięte pola z domyślką NIE trafiają do łatki (status, tytuł)", () => {
    expect(patchSchema(Create).parse({ excerpt: "x" })).toEqual({ excerpt: "x" });
    expect(patchSchema(Create).parse({})).toEqual({});
  });

  it("przysłane pola nadal przechodzą walidację schematu tworzenia", () => {
    expect(patchSchema(Create).parse({ status: "published" })).toEqual({ status: "published" });
    expect(() => patchSchema(Create).parse({ status: "archived" })).toThrow();
    expect(() => patchSchema(Create).parse({ title_pl: "za długi" })).toThrow();
  });

  it("zachowuje tryb strict obiektu", () => {
    expect(() => patchSchema(Create.strict()).parse({ unknown: 1 })).toThrow();
  });

  it("samo .partial() w Zod 4 dopisałoby domyślki - powód istnienia helpera", () => {
    expect(Create.partial().parse({})).toEqual({ status: "draft", title_pl: "" });
  });
});
