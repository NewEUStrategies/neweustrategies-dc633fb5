import { describe, expect, it } from "vitest";
import {
  CLUB_COVER_MAX_BYTES,
  checkClubCoverFile,
  clubCoverObjectPath,
} from "@/lib/clubs/coverApi";

describe("okładka klubu - walidacja pliku", () => {
  it("przyjmuje typowe formaty rastrowe", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/avif"]) {
      expect(checkClubCoverFile({ type, size: 1024 })).toBeNull();
    }
  });

  it("odrzuca SVG - publiczny bucket, ryzyko trwałego XSS", () => {
    expect(checkClubCoverFile({ type: "image/svg+xml", size: 1024 })).toEqual({
      kind: "mime",
      mime: "image/svg+xml",
    });
  });

  it("odrzuca plik powyżej limitu, ale przepuszcza dokładnie limit", () => {
    expect(checkClubCoverFile({ type: "image/png", size: CLUB_COVER_MAX_BYTES })).toBeNull();
    expect(checkClubCoverFile({ type: "image/png", size: CLUB_COVER_MAX_BYTES + 1 })).toMatchObject(
      { kind: "size" },
    );
  });
});

describe("okładka klubu - klucz obiektu", () => {
  it("trzyma plik w prefiksie klubu, którego pilnuje polityka storage", () => {
    expect(clubCoverObjectPath({ clubId: "abc", filename: "baner.PNG", uniqueSuffix: "u1" })).toBe(
      "club-covers/abc/u1.png",
    );
  });

  it("czyści rozszerzenie z przemytu ścieżki i podwójnego rozszerzenia", () => {
    expect(
      clubCoverObjectPath({
        clubId: "abc",
        filename: "evil.png.../../x.hTmL",
        uniqueSuffix: "u2",
      }),
    ).toBe("club-covers/abc/u2.html");
  });

  it("bez rozszerzenia wpada w bezpieczny fallback", () => {
    expect(clubCoverObjectPath({ clubId: "abc", filename: "cover", uniqueSuffix: "u3" })).toBe(
      "club-covers/abc/u3.jpg",
    );
  });
});
