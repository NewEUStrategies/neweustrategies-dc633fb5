import { describe, it, expect } from "vitest";
import { formatBytes, extOf } from "../mediaFormat";

describe("formatBytes", () => {
  it("returns 0 B for null, undefined, zero and negatives", () => {
    expect(formatBytes(null)).toBe("0 B");
    expect(formatBytes(undefined)).toBe("0 B");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });

  it("keeps whole bytes without decimals", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("scales into KB / MB / GB", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("drops the decimal once the value is >= 10 in a unit", () => {
    expect(formatBytes(12 * 1024)).toBe("12 KB");
  });
});

describe("extOf", () => {
  it("returns the uppercased extension", () => {
    expect(extOf("photo.jpg")).toBe("JPG");
    expect(extOf("archive.tar.gz")).toBe("GZ");
  });

  it("returns an empty string when there is no extension", () => {
    expect(extOf("README")).toBe("");
  });
});
