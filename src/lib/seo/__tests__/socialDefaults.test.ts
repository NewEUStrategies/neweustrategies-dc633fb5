// Kontrakt domyślnej karty społecznościowej: obrazek z /admin/settings/
// social-preview musi wygrywać z plikiem marki, być tenant-scoped (host) i
// nigdy nie nadpisywać własnej okładki strony.
import { describe, it, expect, beforeEach } from "vitest";
import { buildContentHead, buildRootHead, SITE_DEFAULT_OG_IMAGE } from "@/lib/seo/meta";
import { clearSocialDefaults, rememberSocialDefaults } from "@/lib/seo/socialDefaults";

const find = (meta: Array<Record<string, string>>, key: string, value: string) =>
  meta.find((m) => m[key] === value);

describe("domyślna karta społecznościowa", () => {
  beforeEach(() => clearSocialDefaults());

  it("bez ustawienia używa pliku marki", () => {
    const head = buildContentHead({
      url: "https://neweuropeanstrategies.com/",
      lang: "pl",
      type: "website",
      title: "T",
      description: "D",
    });
    expect(find(head.meta, "property", "og:image")?.content).toBe(
      `https://neweuropeanstrategies.com${SITE_DEFAULT_OG_IMAGE}`,
    );
  });

  it("ustawiony obrazek wygrywa z plikiem marki (og + twitter)", () => {
    rememberSocialDefaults("https://neweuropeanstrategies.com", {
      imageUrl: "https://cdn.example.com/card.jpg",
      imageAlt: "Karta marki",
    });
    const head = buildContentHead({
      url: "https://neweuropeanstrategies.com/blog",
      lang: "pl",
      type: "website",
      title: "T",
      description: "D",
    });
    expect(find(head.meta, "property", "og:image")?.content).toBe(
      "https://cdn.example.com/card.jpg",
    );
    expect(find(head.meta, "name", "twitter:image")?.content).toBe(
      "https://cdn.example.com/card.jpg",
    );
  });

  it("okładka strony nadal wygrywa z domyślną kartą", () => {
    rememberSocialDefaults("https://neweuropeanstrategies.com", {
      imageUrl: "https://cdn.example.com/card.jpg",
      imageAlt: "",
    });
    const head = buildContentHead({
      url: "https://neweuropeanstrategies.com/blog/a",
      lang: "pl",
      type: "article",
      title: "T",
      description: "D",
      image: "https://cdn.example.com/cover.jpg",
    });
    expect(find(head.meta, "property", "og:image")?.content).toBe(
      "https://cdn.example.com/cover.jpg",
    );
  });

  it("nie przecieka między hostami tenantów", () => {
    rememberSocialDefaults("https://a.example", { imageUrl: "https://cdn/a.jpg", imageAlt: "" });
    const head = buildContentHead({
      url: "https://b.example/",
      lang: "en",
      type: "website",
      title: "T",
      description: "D",
    });
    expect(find(head.meta, "property", "og:image")?.content).toBe(
      `https://b.example${SITE_DEFAULT_OG_IMAGE}`,
    );
  });

  it("root head emituje ustawiony obrazek i og:image:alt", () => {
    rememberSocialDefaults("https://neweuropeanstrategies.com", {
      imageUrl: "https://cdn.example.com/card.jpg",
      imageAlt: "Karta marki",
    });
    const meta = buildRootHead("pl", "https://neweuropeanstrategies.com");
    expect(find(meta, "property", "og:image")?.content).toBe("https://cdn.example.com/card.jpg");
    expect(find(meta, "property", "og:image:alt")?.content).toBe("Karta marki");
  });

  it("ścieżka względna jest rozwijana do absolutnego URL", () => {
    rememberSocialDefaults("https://neweuropeanstrategies.com", {
      imageUrl: "/uploads/og.png",
      imageAlt: "",
    });
    const meta = buildRootHead("en", "https://neweuropeanstrategies.com");
    expect(find(meta, "property", "og:image")?.content).toBe(
      "https://neweuropeanstrategies.com/uploads/og.png",
    );
  });
});
