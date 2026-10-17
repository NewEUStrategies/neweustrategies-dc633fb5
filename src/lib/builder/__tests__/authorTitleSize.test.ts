import { describe, expect, it } from "vitest";
import { authorSizeFromTitle, resolveAuthorDisplay } from "../authorDisplay";
describe("CMS author title sizing", () => {
  it.each(["pl", "en"] as const)("uses title minus 2 px in %s", (lang) => {
    expect(resolveAuthorDisplay({}, lang).relativeToTitle).toBe(true);
    // Bazowe 12 px (migracja sliderów, reset panelu) nie jest wyborem rozmiaru.
    expect(resolveAuthorDisplay({ authorSizePx: 12 }, lang).relativeToTitle).toBe(true);
    expect(
      resolveAuthorDisplay({ authorSizePx: 16, authorSizeRelativeToTitle: true }, lang),
    ).toMatchObject({ relativeToTitle: true, nameSizeExact: true });
    expect(authorSizeFromTitle(16)).toBe(14);
    expect(authorSizeFromTitle(26)).toBe(24);
    expect(authorSizeFromTitle(18.5)).toBe(16.5);
  });
  it("persists fixed-size mode from the CMS", () => {
    const value = resolveAuthorDisplay(
      { authorSizeRelativeToTitle: false, authorSizePx: 13 },
      "pl",
    );
    expect(value.relativeToTitle).toBe(false);
    expect(value.nameSizePx).toBe(13);
  });

  it("a size typed in the panel is shown as typed (fixed, no desktop scaling)", () => {
    // Zrzut z kanwy: 11 px w panelu dawało 14-15 px (tytuł albo skalowanie 16/12).
    expect(resolveAuthorDisplay({ authorSizePx: 11 }, "pl")).toMatchObject({
      relativeToTitle: false,
      nameSizePx: 11,
      nameSizeExact: true,
    });
    // Jawny przełącznik bez własnego rozmiaru: stałe 12 px, także na desktopie.
    expect(resolveAuthorDisplay({ authorSizeRelativeToTitle: false }, "pl")).toMatchObject({
      relativeToTitle: false,
      nameSizePx: 12,
      nameSizeExact: true,
    });
    // Nic nie wybrano: kontrakt domyślny 12/20 ze skalowaniem desktopowym.
    expect(resolveAuthorDisplay({}, "pl")).toMatchObject({
      nameSizeExact: false,
      avatarSizeExact: false,
    });
    expect(resolveAuthorDisplay({ authorAvatarSizePx: 30 }, "pl").avatarSizeExact).toBe(true);
    expect(resolveAuthorDisplay({ authorAvatarSizePx: 20 }, "pl").avatarSizeExact).toBe(false);
    // Wpisane w panelu 20 px (= bazowe) też jest dosłowne - panel zapisuje znacznik.
    expect(
      resolveAuthorDisplay({ authorAvatarSizePx: 20, authorAvatarSizeExact: true }, "pl")
        .avatarSizeExact,
    ).toBe(true);
    // Reset zapisuje znacznik `false`: kontrakt domyślny ze skalowaniem.
    expect(
      resolveAuthorDisplay({ authorAvatarSizePx: 20, authorAvatarSizeExact: false }, "pl")
        .avatarSizeExact,
    ).toBe(false);
  });
});
