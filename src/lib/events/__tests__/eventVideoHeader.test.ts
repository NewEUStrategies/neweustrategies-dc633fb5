// Naglowek wideo wydarzenia: pobranie identyfikatora i adres osadzenia.
//
// WALIDACJA IDENTYFIKATORA JEST TU RZECZA NAJWAZNIEJSZA. Adres `src` iframe'a
// powstaje przez sklejenie napisu, wiec identyfikator spoza alfabetu
// [A-Za-z0-9_-] jest wektorem wstrzykniecia do atrybutu. Test trzyma ten
// warunek osobno od reszty, zeby nikt go nie „uproscil" razem z formatowaniem.
import { describe, expect, it } from "vitest";

import {
  asEventVideoPlatform,
  EVENT_VIDEO_PLATFORMS,
  parseVideoId,
  videoEmbedUrl,
} from "@/lib/events/eventVideoHeader";

describe("parseVideoId", () => {
  it("goly identyfikator przechodzi bez zmian", () => {
    expect(parseVideoId("ABC123", "youtube")).toBe("ABC123");
    expect(parseVideoId("  ABC123  ", "youtube")).toBe("ABC123");
    expect(parseVideoId("", "youtube")).toBe("");
  });

  it("wyciaga identyfikator z adresu YouTube w obu postaciach", () => {
    expect(parseVideoId("https://www.youtube.com/watch?v=ABC123", "youtube")).toBe("ABC123");
    expect(parseVideoId("https://youtu.be/ABC123", "youtube")).toBe("ABC123");
    expect(parseVideoId("https://www.youtube.com/watch?v=ABC123&t=42", "youtube")).toBe("ABC123");
  });

  it("wyciaga identyfikator z adresu Vimeo", () => {
    expect(parseVideoId("https://vimeo.com/123456", "vimeo")).toBe("123456");
    expect(parseVideoId("https://vimeo.com/123456/", "vimeo")).toBe("123456");
  });

  it("smiec niebedacy adresem wraca bez zmian, zamiast rzucac", () => {
    expect(parseVideoId("to nie jest adres", "youtube")).toBe("to nie jest adres");
    expect(parseVideoId("???", "vimeo")).toBe("???");
  });
});

describe("videoEmbedUrl", () => {
  it("zwraca null, gdy naglowka wideo nie ma", () => {
    expect(videoEmbedUrl("youtube", "")).toBeNull();
    expect(videoEmbedUrl("youtube", "   ")).toBeNull();
    expect(videoEmbedUrl("vimeo", "")).toBeNull();
  });

  it("zwraca null dla identyfikatora ze znakami spoza [A-Za-z0-9_-]", () => {
    expect(videoEmbedUrl("youtube", 'ABC" onload="alert(1)')).toBeNull();
    expect(videoEmbedUrl("youtube", "../../evil")).toBeNull();
    expect(videoEmbedUrl("youtube", "ABC?autoplay=1")).toBeNull();
    expect(videoEmbedUrl("vimeo", "123456#x")).toBeNull();
    expect(videoEmbedUrl("youtube", "a".repeat(65))).toBeNull();
  });

  it("sklada adres osadzenia dla obu platform", () => {
    expect(videoEmbedUrl("youtube", "ABC_123-x")).toBe(
      "https://www.youtube-nocookie.com/embed/ABC_123-x",
    );
    expect(videoEmbedUrl("vimeo", " 123456 ")).toBe("https://player.vimeo.com/video/123456");
  });
});

describe("asEventVideoPlatform", () => {
  it("przepuszcza obie znane platformy", () => {
    for (const platform of EVENT_VIDEO_PLATFORMS) {
      expect(asEventVideoPlatform(platform)).toBe(platform);
    }
  });

  it("pustka i smiec z kolumny czytaja sie jako youtube, nie jako brak", () => {
    // O tym, CZY naglowek wideo istnieje, decyduje identyfikator - nie
    // platforma. Dlatego domyslna platforma nigdy nie jest `null`.
    expect(asEventVideoPlatform(null)).toBe("youtube");
    expect(asEventVideoPlatform(undefined)).toBe("youtube");
    expect(asEventVideoPlatform("")).toBe("youtube");
    expect(asEventVideoPlatform("dailymotion")).toBe("youtube");
  });
});
