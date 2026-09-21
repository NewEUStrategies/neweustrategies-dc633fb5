import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import FaGlyph from "../lucide-shim.fa";

describe("Font Awesome fallback rendering", () => {
  it("returns no misleading symbol for an unmapped name", () => {
    expect(renderToString(<FaGlyph name="MissingIcon" />)).toBe("");
  });
  it.each([
    [undefined, "17px"],
    [40, "29px"],
    ["2rem", "2rem"],
  ] as const)("scales numeric size %s while preserving CSS units", (size, width) => {
    const html = renderToString(
      <FaGlyph name="Home" size={size} color="red" className="nav-icon" aria-label="Home" />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain(`width:${width}`);
    expect(html).toContain(`height:${width}`);
    expect(html).toContain("color:red");
    expect(html).toContain('aria-label="Home"');
    expect(html).toContain("nav-icon");
  });
  it("honors an explicit caller style override", () => {
    expect(renderToString(<FaGlyph name="Home" style={{ width: "3em" }} />)).toContain("width:3em");
  });
});
