import { describe, it, expect } from "vitest";
import { parseEmbedUrl, isIframeEmbed } from "@/lib/blocks/embed";

// Rozpoznawanie osadzeń ma jedną cechę wspólną dla wszystkich dostawców:
// gdy wzorzec ścieżki NIE pasuje, kod przechodzi DALEJ, do kolejnego dostawcy,
// aż do bezstratnego fallbacku `unknown`. To właśnie te ramiona „nie pasuje"
// były niewykonane - a one decydują, czy redaktor zobaczy odtwarzacz, czy goły
// link. Tabela chodzi więc parami: adres poprawny i adres tego samego hosta
// o ścieżce, której wzorzec nie łapie.

describe("parseEmbedUrl - dostawcy z wzorcem ścieżki", () => {
  it.each([
    // [host + poprawna ścieżka, dostawca, fragment oczekiwany w embedUrl]
    ["https://www.instagram.com/p/ABC123/", "instagram", "/p/ABC123/embed"],
    ["https://instagram.com/reel/XYZ/", "instagram", "/reel/XYZ/embed"],
    ["https://instagr.am/tv/TV1/", "instagram", "/tv/TV1/embed"],
    ["https://www.tiktok.com/@user/video/1234567890", "tiktok", "/embed/v2/1234567890"],
    ["https://www.tiktok.com/v/987654321", "tiktok", "/embed/v2/987654321"],
    ["https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", "spotify", "embed/track/"],
    ["https://open.spotify.com/episode/EP1", "spotify", "embed/episode/EP1"],
    ["https://open.spotify.com/show/SH1", "spotify", "embed/show/SH1"],
    ["https://open.spotify.com/playlist/PL1", "spotify", "embed/playlist/PL1"],
    ["https://open.spotify.com/album/AL1", "spotify", "embed/album/AL1"],
    ["https://open.spotify.com/artist/AR1", "spotify", "embed/artist/AR1"],
    ["https://www.dailymotion.com/video/x8abcd", "dailymotion", "embed/video/x8abcd"],
    ["https://dai.ly/x8abcd", "dailymotion", "embed/video/x8abcd"],
    ["https://www.twitch.tv/videos/123456", "twitch", "player.twitch.tv/?video=123456"],
    ["https://www.twitch.tv/nazwakanalu", "twitch", "player.twitch.tv/?channel=nazwakanalu"],
    ["https://clips.twitch.tv/JakisKlip", "twitch", "clips.twitch.tv/embed?clip=JakisKlip"],
    ["https://www.loom.com/share/abc123", "loom", "loom.com/embed/abc123"],
    ["https://www.loom.com/embed/abc123", "loom", "loom.com/embed/abc123"],
    ["https://mojafirma.wistia.com/medias/abc123", "wistia", "fast.wistia.net/embed/iframe/abc123"],
    ["https://fast.wistia.net/embed/abc123", "wistia", "fast.wistia.net/embed/iframe/abc123"],
    ["https://codepen.io/autor/pen/abcDEF", "codepen", "codepen.io/autor/embed/abcDEF"],
    ["https://codepen.io/autor/details/abcDEF", "codepen", "codepen.io/autor/embed/abcDEF"],
    ["https://codepen.io/autor/full/abcDEF", "codepen", "codepen.io/autor/embed/abcDEF"],
    ["https://codesandbox.io/s/abc-123", "codesandbox", "codesandbox.io/embed/abc-123"],
    ["https://codesandbox.io/p/sandbox/abc-123", "codesandbox", "codesandbox.io/embed/abc-123"],
    [
      "https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000000/",
      "linkedin",
      "urn:li:activity:7000000000000000000",
    ],
    [
      "https://www.linkedin.com/posts/autor-activity-7000000000000000000-abcd",
      "linkedin",
      "urn:li:activity:7000000000000000000",
    ],
  ])("%s -> dostawca %s", (url, provider, fragment) => {
    const parsed = parseEmbedUrl(url);
    expect(parsed?.provider).toBe(provider);
    expect(parsed?.embedUrl).toContain(fragment);
    expect(parsed?.sourceUrl).toBe(url);
  });

  // Ramię „wzorzec NIE pasuje" - adres tego samego hosta spada na fallback.
  it.each([
    ["https://www.instagram.com/profil-uzytkownika/", "instagram - profil, nie post"],
    ["https://www.tiktok.com/@user", "tiktok - profil bez wideo"],
    ["https://open.spotify.com/user/ktos", "spotify - typ zasobu poza listą"],
    ["https://www.dailymotion.com/kanal", "dailymotion - nie /video/"],
    ["https://www.loom.com/looks/abc", "loom - nie /share/ ani /embed/"],
    ["https://mojafirma.wistia.com/projects/abc", "wistia - nie medias/embed"],
    ["https://codepen.io/autor", "codepen - brak pen/details/full"],
    ["https://codesandbox.io/dashboard", "codesandbox - nie /s/ ani /p/sandbox/"],
    ["https://www.linkedin.com/in/ktos", "linkedin - profil bez activity"],
  ])("%s (%s) spada na bezstratny fallback", (url) => {
    const parsed = parseEmbedUrl(url);
    expect(parsed?.provider).toBe("unknown");
    expect(parsed?.embedUrl).toBe(parsed?.sourceUrl);
  });

  it("dai.ly BEZ identyfikatora spada na fallback", () => {
    expect(parseEmbedUrl("https://dai.ly/")?.provider).toBe("unknown");
  });

  it("clips.twitch.tv BEZ identyfikatora klipu spada na fallback", () => {
    expect(parseEmbedUrl("https://clips.twitch.tv/")?.provider).toBe("unknown");
  });

  it("twitch.tv BEZ kanału spada na fallback", () => {
    expect(parseEmbedUrl("https://www.twitch.tv/")?.provider).toBe("unknown");
  });

  it("osadzenie Twitcha nosi parametr parent - bez niego odtwarzacz odmawia startu", () => {
    const parsed = parseEmbedUrl("https://www.twitch.tv/kanal");
    expect(parsed?.embedUrl).toMatch(/[?&]parent=[^&]+/);
    // Parametr MUSI wskazywać nasz host publiczny, nie host dostawcy platformy.
    expect(parsed?.embedUrl).not.toContain("parent=lovable");
  });
});

describe("parseEmbedUrl - dostawcy bez wzorca ścieżki", () => {
  it.each([
    ["https://www.facebook.com/nazwa/videos/123", "facebook"],
    ["https://fb.watch/abc123/", "facebook"],
    ["https://m.facebook.com/story.php?id=1", "facebook"],
    ["https://gist.github.com/autor/abc123", "github-gist"],
    ["https://www.reddit.com/r/sub/comments/abc/tytul/", "reddit"],
    ["https://old.reddit.com/r/sub/comments/abc/tytul/", "reddit"],
    ["https://www.pinterest.com/pin/123/", "pinterest"],
    ["https://pl.pinterest.com/pin/123/", "pinterest"],
    ["https://bsky.app/profile/ktos/post/abc", "bluesky"],
    ["https://www.threads.net/@ktos/post/abc", "threads"],
    ["https://www.threads.com/@ktos/post/abc", "threads"],
    ["https://mastodon.social/@ktos/123", "mastodon"],
    ["https://mastodon.online/@ktos/123", "mastodon"],
    ["https://mas.to/@ktos/123", "mastodon"],
    ["https://hachyderm.io/@ktos/123", "mastodon"],
    ["https://fosstodon.org/@ktos/123", "mastodon"],
    ["https://serwer.mastodon.social/@ktos/123", "mastodon"],
    ["https://vm.tiktok.com/ZM123/", "tiktok"],
    ["https://vt.tiktok.com/ZM123/", "tiktok"],
  ])("%s -> dostawca %s", (url, provider) => {
    expect(parseEmbedUrl(url)?.provider).toBe(provider);
  });

  it("reddit przenosi ścieżkę do redditmedia", () => {
    const parsed = parseEmbedUrl("https://www.reddit.com/r/sub/comments/abc/tytul/");
    expect(parsed?.embedUrl).toBe(
      "https://www.redditmedia.com/r/sub/comments/abc/tytul/?ref_source=embed&embed=true",
    );
  });

  it("facebook koduje adres źródłowy w parametrze href", () => {
    const url = "https://www.facebook.com/nazwa/videos/123";
    expect(parseEmbedUrl(url)?.embedUrl).toContain(encodeURIComponent(url));
  });

  it.each([
    ["https://mastodon.example.com/@ktos", "instancja poza listą"],
    ["https://threads.pl/@ktos", "domena podobna, ale inna"],
  ])("%s (%s) spada na fallback", (url) => {
    expect(parseEmbedUrl(url)?.provider).toBe("unknown");
  });
});

describe("parseEmbedUrl - YouTube i Vimeo", () => {
  it.each([
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/v/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("%s daje identyfikator %s", (url, id) => {
    const parsed = parseEmbedUrl(url);
    expect(parsed?.provider).toBe("youtube");
    expect(parsed?.embedUrl).toContain(id);
  });

  it.each([
    ["https://youtu.be/abc", "identyfikator za krótki"],
    ["https://www.youtube.com/watch?v=abc", "parametr v za krótki"],
    ["https://www.youtube.com/kanal/nazwa", "ścieżka bez identyfikatora"],
    ["https://www.youtube.com/", "sam host"],
  ])("%s (%s) nie daje osadzenia YouTube", (url) => {
    expect(parseEmbedUrl(url)?.provider).not.toBe("youtube");
  });

  it.each([
    ["https://vimeo.com/123456789", "123456789"],
    ["https://player.vimeo.com/video/123456789", "123456789"],
    ["https://vimeo.com/channels/kanal/123456789", "123456789"],
    ["https://vimeo.com/groups/grupa/videos/123456789", "123456789"],
    ["https://vimeo.com/album/1/video/123456789", "123456789"],
  ])("%s daje identyfikator %s", (url, id) => {
    const parsed = parseEmbedUrl(url);
    expect(parsed?.provider).toBe("vimeo");
    expect(parsed?.embedUrl).toContain(id);
  });

  it("vimeo bez części liczbowej w ścieżce nie daje osadzenia vimeo", () => {
    expect(parseEmbedUrl("https://vimeo.com/uzytkownik")?.provider).not.toBe("vimeo");
  });
});

describe("parseEmbedUrl - wejście nieprawidłowe", () => {
  it.each([
    ["pusty string", ""],
    ["same spacje", "   "],
    ["nie-URL", "to nie jest adres"],
    ["schemat javascript", "javascript:alert(1)"],
    ["schemat data", "data:text/html,<b>x</b>"],
    ["schemat file", "file:///etc/passwd"],
  ])("%s zwraca null", (_l, raw) => {
    expect(parseEmbedUrl(raw)).toBeNull();
  });

  it("adres BEZ schematu jest odrzucany - `new URL` go nie przyjmuje", () => {
    // Kontrakt: rozpoznawanie wymaga pełnego adresu. Wołający (edytor osadzeń)
    // odpowiada za dopisanie `https://`, bo tylko on wie, czy pole było puste,
    // czy użytkownik wkleił skrót.
    expect(parseEmbedUrl("youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(parseEmbedUrl("www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("host z prefiksem www jest normalizowany", () => {
    expect(parseEmbedUrl("https://WWW.Vimeo.com/123")?.provider).toBe("vimeo");
  });
});

describe("isIframeEmbed", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("%s nie jest osadzeniem iframe", (_l, value) => {
    expect(isIframeEmbed(value)).toBe(false);
  });

  it.each([
    "https://youtu.be/dQw4w9WgXcQ",
    "https://vimeo.com/123456789",
    "https://open.spotify.com/track/abc",
  ])("%s jest osadzeniem iframe", (url) => {
    expect(isIframeEmbed(parseEmbedUrl(url))).toBe(true);
  });

  it.each([
    "https://gist.github.com/autor/abc123",
    "https://bsky.app/profile/x/post/y",
    "https://example.test/nieznany",
  ])("%s NIE jest osadzeniem iframe (renderer musi pokazać link/skrypt)", (url) => {
    expect(isIframeEmbed(parseEmbedUrl(url))).toBe(false);
  });
});
