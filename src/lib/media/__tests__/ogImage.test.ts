// Kontrakt walidacji i planu kompresji karty OG (1200x630).
import { describe, it, expect } from "vitest";
import {
  OG_MAX_BYTES,
  checkOgDimensions,
  checkOgMime,
  planOgCompression,
} from "@/lib/media/ogImage";

describe("checkOgMime", () => {
  it("przepuszcza formaty czytane przez scrapery", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp"])
      expect(checkOgMime(mime)).toBeNull();
  });

  it("ostrzega o formatach wymagających konwersji", () => {
    expect(checkOgMime("image/avif")).toMatchObject({
      code: "mime_converted",
      severity: "warning",
    });
  });

  it("odrzuca nieobsługiwane typy", () => {
    expect(checkOgMime("application/pdf")).toMatchObject({
      code: "mime_unsupported",
      severity: "error",
    });
    expect(checkOgMime("")).toMatchObject({ severity: "error" });
  });
});

describe("checkOgDimensions", () => {
  it("akceptuje dokładne 1200x630", () => {
    expect(checkOgDimensions(1200, 630)).toBeNull();
  });

  it("odrzuca inne proporcje", () => {
    expect(checkOgDimensions(1200, 1200)).toMatchObject({
      code: "dimensions_mismatch",
      severity: "error",
    });
    expect(checkOgDimensions(0, 0)).toMatchObject({ severity: "error" });
  });

  it("odrzuca zbyt małe pliki o poprawnej proporcji", () => {
    expect(checkOgDimensions(600, 315)).toMatchObject({
      code: "dimensions_too_small",
      severity: "error",
    });
  });

  it("dopuszcza większe pliki i zapowiada skalowanie", () => {
    expect(checkOgDimensions(2400, 1260)).toMatchObject({
      code: "dimensions_downscaled",
      severity: "warning",
    });
  });
});

describe("planOgCompression", () => {
  it("skaluje do 1200 px szerokości", () => {
    const plan = planOgCompression(2400, 1260, 900_000);
    expect(plan.width).toBe(1200);
    expect(plan.height).toBe(630);
    expect(plan.mime).toBe("image/jpeg");
  });

  it("nie powiększa mniejszych kadrów", () => {
    const plan = planOgCompression(1200, 630, 50_000);
    expect(plan.width).toBe(1200);
  });

  it("agresywniej kompresuje ciężkie pliki", () => {
    const heavy = planOgCompression(1200, 630, OG_MAX_BYTES * 3);
    const light = planOgCompression(1200, 630, 100_000);
    expect(heavy.qualities[0]).toBeLessThan(light.qualities[0] as number);
  });

  it("zachowuje PNG dla grafik z przezroczystością", () => {
    expect(planOgCompression(1200, 630, 100_000, true).mime).toBe("image/png");
  });
});
