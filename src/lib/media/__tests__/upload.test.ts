import { describe, expect, it } from "vitest";
import {
  AUDIO_MIME,
  IMAGE_MIME,
  UPLOADABLE_MIME,
  UPLOAD_ACCEPT_ATTR,
  VIDEO_MIME,
  checkUploadable,
  maxBytesForMime,
  storageObjectPath,
} from "@/lib/media/upload";

const MB = 1024 * 1024;

describe("UPLOADABLE_MIME", () => {
  it("never allows SVG into the public media bucket", () => {
    // Bucket jest publiczny i serwuje bajty bezposrednio - osadzony <script>
    // w SVG wykonalby sie w kontekscie domeny (stored XSS).
    expect(UPLOADABLE_MIME).not.toContain("image/svg+xml");
    expect(IMAGE_MIME).not.toContain("image/svg+xml");
    expect(UPLOAD_ACCEPT_ATTR).not.toContain("svg");
  });

  it("never allows markup or script types", () => {
    for (const dangerous of [
      "image/svg+xml",
      "text/html",
      "application/xhtml+xml",
      "text/javascript",
      "application/javascript",
      "application/xml",
    ]) {
      expect(UPLOADABLE_MIME).not.toContain(dangerous);
    }
  });

  it("splits into non-overlapping image/audio/video subsets", () => {
    expect(IMAGE_MIME.length).toBeGreaterThan(0);
    expect(AUDIO_MIME.length).toBeGreaterThan(0);
    expect(VIDEO_MIME.length).toBeGreaterThan(0);
    expect(IMAGE_MIME.some((m) => AUDIO_MIME.includes(m))).toBe(false);
    expect(IMAGE_MIME.some((m) => VIDEO_MIME.includes(m))).toBe(false);
  });

  it("uses an explicit accept list rather than an image/* wildcard", () => {
    // `image/*` obejmowalo image/svg+xml, wiec UI zapraszal do wgrania typu,
    // ktory platforma odrzuca.
    expect(UPLOAD_ACCEPT_ATTR).not.toContain("*");
    expect(UPLOAD_ACCEPT_ATTR).toContain("image/png");
  });
});

describe("checkUploadable", () => {
  it("rejects a disallowed MIME before any bytes leave the browser", () => {
    const rejection = checkUploadable({ type: "image/svg+xml", size: 1024 });
    expect(rejection).toEqual({ kind: "mime", mime: "image/svg+xml" });
  });

  it("rejects a file renamed to a safe extension but carrying an SVG MIME", () => {
    expect(checkUploadable({ type: "image/svg+xml", size: 10 })).not.toBeNull();
  });

  it("rejects an empty/unknown MIME", () => {
    expect(checkUploadable({ type: "", size: 10 })).toEqual({ kind: "mime", mime: "" });
  });

  it("accepts an allowed image under the size cap", () => {
    expect(checkUploadable({ type: "image/png", size: 2 * MB })).toBeNull();
  });

  it("enforces the per-type size ceiling", () => {
    expect(checkUploadable({ type: "image/png", size: 11 * MB })).toEqual({
      kind: "size",
      sizeBytes: 11 * MB,
      maxBytes: 10 * MB,
    });
    // Odcinek podcastu ma znacznie wyzszy pulap niz obrazek.
    expect(checkUploadable({ type: "audio/mpeg", size: 120 * MB })).toBeNull();
    expect(checkUploadable({ type: "video/mp4", size: 120 * MB })).toBeNull();
  });

  it("honours a narrowed allowlist (image-only picker)", () => {
    expect(checkUploadable({ type: "audio/mpeg", size: 10 }, IMAGE_MIME)).toEqual({
      kind: "mime",
      mime: "audio/mpeg",
    });
  });
});

describe("maxBytesForMime", () => {
  it("scales the ceiling by media kind", () => {
    expect(maxBytesForMime("image/png")).toBe(10 * MB);
    expect(maxBytesForMime("application/pdf")).toBe(10 * MB);
    expect(maxBytesForMime("video/mp4")).toBe(200 * MB);
    expect(maxBytesForMime("audio/mpeg")).toBe(300 * MB);
  });
});

describe("storageObjectPath", () => {
  it("puts the tenant id first so storage RLS matches", () => {
    const path = storageObjectPath({
      tenantId: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
      filename: "photo.PNG",
      uniqueSuffix: "fixed",
    });
    expect(path).toBe(
      "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/fixed.png",
    );
  });

  it("supports a subfolder segment", () => {
    const path = storageObjectPath({
      tenantId: "t",
      userId: "u",
      filename: "bg.webp",
      subfolder: "widgets",
      uniqueSuffix: "fixed",
    });
    expect(path).toBe("t/u/widgets/fixed.webp");
  });

  it("never lets a crafted filename escape the tenant prefix", () => {
    const path = storageObjectPath({
      tenantId: "t",
      userId: "u",
      filename: "../../../etc/passwd",
      uniqueSuffix: "fixed",
    });
    expect(path.startsWith("t/u/")).toBe(true);
    expect(path).not.toContain("..");
  });

  it("falls back to a bin extension for an extensionless name", () => {
    expect(
      storageObjectPath({ tenantId: "t", userId: "u", filename: "noext", uniqueSuffix: "fixed" }),
    ).toBe("t/u/fixed.bin");
  });
});
