import { describe, expect, it } from "vitest";
import { normalizeThemeGeometry } from "@/lib/builder/themeGeometry";

describe("normalizeThemeGeometry", () => {
  it("spłaszcza geometrię i typografię, ale zachowuje kolory light/dark", () => {
    const source = {
      sections: [
        {
          style: {
            typography: {
              light: { fontSize: { desktop: "18px", mobile: "15px" }, lineHeight: "1.4" },
              dark: { fontSize: { desktop: "30px", mobile: "24px" }, lineHeight: "2" },
            },
            padding: {
              light: { desktop: "24px", mobile: "12px" },
              dark: { desktop: "8px", mobile: "4px" },
            },
            bgColor: { light: "#fff", dark: "#000" },
            borderColor: { light: "#ddd", dark: "#333" },
          },
        },
      ],
    };

    const normalized = normalizeThemeGeometry(source);
    expect(normalized.sections[0].style.typography).toEqual(
      source.sections[0].style.typography.light,
    );
    expect(normalized.sections[0].style.padding).toEqual(source.sections[0].style.padding.light);
    expect(normalized.sections[0].style.bgColor).toEqual(source.sections[0].style.bgColor);
    expect(normalized.sections[0].style.borderColor).toEqual(source.sections[0].style.borderColor);
  });

  it("używa dark jako wartości zastępczej i nie mutuje źródła", () => {
    const source = { style: { borderRadius: { dark: "10px" } } };
    const normalized = normalizeThemeGeometry(source);
    expect(normalized.style.borderRadius).toBe("10px");
    expect(source.style.borderRadius).toEqual({ dark: "10px" });
  });
});