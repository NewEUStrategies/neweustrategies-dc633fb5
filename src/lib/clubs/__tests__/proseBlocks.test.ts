import { describe, expect, it } from "vitest";
import { parseProseBlocks } from "@/lib/clubs/proseBlocks";
import { applyListAutoformat } from "@/lib/text/listAutoformat";

describe("parseProseBlocks", () => {
  it("wydziela listę numerowaną z zachowaniem numeru startowego", () => {
    const blocks = parseProseBlocks("Wstęp\n\n2. Alfa\n3. Beta");
    expect(blocks[0]).toEqual({ kind: "paragraph", text: "Wstęp" });
    expect(blocks[1]).toEqual({ kind: "ordered", items: ["Alfa", "Beta"], start: 2 });
  });

  it("wydziela listę punktowaną i rozdziela typy list", () => {
    const blocks = parseProseBlocks("- Alfa\n• Beta\n1. Gamma");
    expect(blocks[0]).toEqual({ kind: "bullet", items: ["Alfa", "Beta"] });
    expect(blocks[1]).toEqual({ kind: "ordered", items: ["Gamma"], start: 1 });
  });

  it("zwykły tekst pozostaje akapitem", () => {
    expect(parseProseBlocks("Alfa\nBeta")).toEqual([{ kind: "paragraph", text: "Alfa\nBeta" }]);
  });
});

describe("applyListAutoformat", () => {
  it("kontynuuje numerację po Enterze", () => {
    const value = "1. Alfa";
    const result = applyListAutoformat(value, value.length, value.length, "Enter");
    expect(result?.value).toBe("1. Alfa\n2. ");
    expect(result?.cursor).toBe("1. Alfa\n2. ".length);
  });

  it("kontynuuje punktor", () => {
    const value = "- Alfa";
    expect(applyListAutoformat(value, value.length, value.length, "Enter")?.value).toBe(
      "- Alfa\n- ",
    );
  });

  it("pusty punktor kończy listę", () => {
    const value = "- Alfa\n- ";
    expect(applyListAutoformat(value, value.length, value.length, "Enter")?.value).toBe("- Alfa\n");
  });

  it("nie reaguje poza listą", () => {
    expect(applyListAutoformat("Alfa", 4, 4, "Enter")).toBeNull();
  });
});
