// Regresja mapy źródeł z /admin/settings/social-preview: każdy typ treści ma
// wskazane miejsce edycji, a domyślna karta nie nadpisuje własnych okładek -
// ani per host (tenant), ani per wpis.
import { describe, it, expect, beforeEach } from "vitest";
import { socialSourceRows } from "@/lib/seo/socialPreviewSources";
import { buildContentHead, SITE_DEFAULT_OG_IMAGE } from "@/lib/seo/meta";
import { clearSocialDefaults, rememberSocialDefaults } from "@/lib/seo/socialDefaults";

const og = (url: string, image?: string) =>
  buildContentHead({
    url,
    lang: "pl",
    type: image ? "article" : "website",
    title: "T",
    description: "D",
    ...(image ? { image } : {}),
  }).meta.find((m) => m["property"] === "og:image")?.["content"];

describe("mapa źródeł podglądu linków", () => {
  it("pokrywa wszystkie typy treści i nie duplikuje wierszy", () => {
    const rows = socialSourceRows("pl");
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(["home", "posts", "pages", "authors", "podcasts", "newsletter"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ma tłumaczenia PL i EN dla każdego wiersza", () => {
    const pl = socialSourceRows("pl");
    const en = socialSourceRows("en");
    expect(en.map((r) => r.id)).toEqual(pl.map((r) => r.id));
    for (let i = 0; i < pl.length; i++) {
      expect(pl[i]?.where.trim()).toBeTruthy();
      expect(en[i]?.where.trim()).toBeTruthy();
      expect(en[i]?.how).not.toBe(pl[i]?.how);
    }
  });

  it("linkuje każdy edytowalny typ, a stronę główną zostawia bez linku", () => {
    const rows = socialSourceRows("en");
    expect(rows.find((r) => r.id === "home")?.to).toBeUndefined();
    for (const row of rows.filter((r) => r.id !== "home"))
      expect(row.to?.startsWith("/admin/")).toBe(true);
  });

  it("deklaruje, że domyślna karta nigdy nie nadpisuje własnego obrazka", () => {
    expect(socialSourceRows("pl").every((r) => r.overridesOwnImage === false)).toBe(true);
  });
});

describe("fallbacki karty per host", () => {
  beforeEach(() => clearSocialDefaults());

  it("stosuje ustawienie hosta tylko tam, gdzie brak własnej okładki", () => {
    rememberSocialDefaults("https://a.example", {
      imageUrl: "https://cdn/a-card.jpg",
      imageAlt: "A",
    });
    expect(og("https://a.example/")).toBe("https://cdn/a-card.jpg");
    expect(og("https://a.example/post", "https://cdn/cover.jpg")).toBe("https://cdn/cover.jpg");
  });

  it("nie miesza kart między hostami i wraca do pliku marki", () => {
    rememberSocialDefaults("https://a.example", { imageUrl: "https://cdn/a.jpg", imageAlt: "" });
    rememberSocialDefaults("https://b.example", { imageUrl: "https://cdn/b.jpg", imageAlt: "" });
    expect(og("https://a.example/")).toBe("https://cdn/a.jpg");
    expect(og("https://b.example/")).toBe("https://cdn/b.jpg");
    expect(og("https://c.example/")).toBe(`https://c.example${SITE_DEFAULT_OG_IMAGE}`);
  });

  it("ignoruje różnice portu i wielkości liter w hoście", () => {
    rememberSocialDefaults("https://A.Example:443", {
      imageUrl: "https://cdn/a.jpg",
      imageAlt: "",
    });
    expect(og("https://a.example/x")).toBe("https://cdn/a.jpg");
  });

  it("czyszczenie store'u przywraca plik marki", () => {
    rememberSocialDefaults("https://a.example", { imageUrl: "https://cdn/a.jpg", imageAlt: "" });
    clearSocialDefaults();
    expect(og("https://a.example/")).toBe(`https://a.example${SITE_DEFAULT_OG_IMAGE}`);
  });
});
