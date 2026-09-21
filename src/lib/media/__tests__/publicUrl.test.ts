import { describe, expect, it } from "vitest";
import { brandedMediaUrl, mediaRenderUrl, mediaStoragePath } from "@/lib/media/publicUrl";

describe("publiczny adres mediów marki", () => {
  it("ukrywa techniczny host magazynu", () => {
    expect(
      brandedMediaUrl(
        "https://project.supabase.co/storage/v1/object/public/media/tenant/user/hero.png",
      ),
    ).toBe("https://neweuropeanstrategies.com/media/tenant/user/hero.png");
  });

  it("zachowuje i koduje bezpieczną ścieżkę pliku", () => {
    expect(mediaStoragePath("https://neweuropeanstrategies.com/media/a/b/hero%20image.png")).toBe(
      "a/b/hero image.png",
    );
    expect(brandedMediaUrl("https://neweuropeanstrategies.com/media/a/b/hero%20image.png")).toBe(
      "https://neweuropeanstrategies.com/media/a/b/hero%20image.png",
    );
  });

  it("renderuje markowe media przez bieżące środowisko aplikacji", () => {
    expect(
      mediaRenderUrl("https://neweuropeanstrategies.com/media/tenant/user/hero%20image.png"),
    ).toBe("/media/tenant/user/hero%20image.png");
    expect(mediaRenderUrl("https://cdn.example.org/hero.png")).toBe(
      "https://cdn.example.org/hero.png",
    );
  });

  it("nie przepisuje obcych adresów ani niebezpiecznych ścieżek", () => {
    expect(brandedMediaUrl("https://cdn.example.org/hero.png")).toBe(
      "https://cdn.example.org/hero.png",
    );
    expect(mediaStoragePath("/media/a/../secret.png")).toBeNull();
  });
});
