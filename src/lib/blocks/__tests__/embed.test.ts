import { describe, it, expect } from "vitest";
import { parseEmbedUrl, isIframeEmbed, type EmbedProvider } from "@/lib/blocks/embed";

function p(url: string): { provider: EmbedProvider; embedUrl: string } {
  const r = parseEmbedUrl(url);
  if (!r) throw new Error(`parseEmbedUrl returned null for ${url}`);
  return { provider: r.provider, embedUrl: r.embedUrl };
}

describe("parseEmbedUrl - YouTube variants", () => {
  const ID = "dQw4w9WgXcQ";
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ])("normalises %s", (url) => {
    const r = p(url);
    expect(r.provider).toBe("youtube");
    expect(r.embedUrl).toContain(`/embed/${ID}`);
  });

  it("preserves start time when present", () => {
    expect(p(`https://youtu.be/${ID}?t=120`).embedUrl).toContain("start=120");
  });
});

describe("parseEmbedUrl - Vimeo variants", () => {
  it.each([
    "https://vimeo.com/76979871",
    "https://player.vimeo.com/video/76979871",
    "https://vimeo.com/channels/staffpicks/76979871",
    "https://vimeo.com/groups/x/videos/76979871",
    "https://vimeo.com/76979871/abc123",
  ])("normalises %s", (url) => {
    const r = p(url);
    expect(r.provider).toBe("vimeo");
    expect(r.embedUrl).toBe("https://player.vimeo.com/video/76979871");
  });
});

describe("parseEmbedUrl - X / Twitter", () => {
  it.each([
    "https://x.com/jack/status/20",
    "https://twitter.com/jack/status/20",
    "https://mobile.twitter.com/jack/status/20",
  ])("recognises %s", (url) => {
    const r = p(url);
    expect(r.provider).toBe("x");
    expect(r.embedUrl).toContain("platform.twitter.com");
  });
});

describe("parseEmbedUrl - other providers", () => {
  it("Instagram post / reel / tv", () => {
    expect(p("https://www.instagram.com/p/AbC123/").provider).toBe("instagram");
    expect(p("https://instagram.com/reel/XyZ987/").embedUrl).toContain("/reel/XyZ987/embed");
  });
  it("TikTok video", () => {
    expect(p("https://www.tiktok.com/@user/video/7212345678901234567").provider).toBe("tiktok");
  });
  it("Spotify track", () => {
    expect(p("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC").embedUrl)
      .toBe("https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC");
  });
  it("SoundCloud", () => {
    expect(p("https://soundcloud.com/artist/track").provider).toBe("soundcloud");
  });
  it("Dailymotion + dai.ly", () => {
    expect(p("https://www.dailymotion.com/video/x7tgad0").embedUrl).toContain("/embed/video/x7tgad0");
    expect(p("https://dai.ly/x7tgad0").embedUrl).toContain("/embed/video/x7tgad0");
  });
  it("Twitch channel + VOD + clip", () => {
    expect(p("https://www.twitch.tv/shroud").embedUrl).toContain("channel=shroud");
    expect(p("https://www.twitch.tv/videos/123456").embedUrl).toContain("video=123456");
    expect(p("https://clips.twitch.tv/HelloClip").embedUrl).toContain("clips.twitch.tv/embed?clip=HelloClip");
  });
  it("Loom + Wistia + CodePen + CodeSandbox", () => {
    expect(p("https://www.loom.com/share/abc123").embedUrl).toBe("https://www.loom.com/embed/abc123");
    expect(p("https://fast.wistia.com/medias/xyz789").embedUrl).toContain("fast.wistia.net/embed/iframe/xyz789");
    expect(p("https://codepen.io/user/pen/abcDEF").embedUrl).toContain("codepen.io/user/embed/abcDEF");
    expect(p("https://codesandbox.io/s/abc123").embedUrl).toBe("https://codesandbox.io/embed/abc123");
  });
  it("LinkedIn activity", () => {
    expect(p("https://www.linkedin.com/posts/x_activity-7012345678901234567-abcd")
      .embedUrl).toContain("urn:li:activity:7012345678901234567");
  });
});

describe("parseEmbedUrl - lossless fallback", () => {
  it("returns provider 'unknown' with original URL preserved", () => {
    const r = parseEmbedUrl("https://example.com/some/page");
    expect(r?.provider).toBe("unknown");
    expect(r?.embedUrl).toBe("https://example.com/some/page");
    expect(r?.sourceUrl).toBe("https://example.com/some/page");
  });
  it("rejects invalid / non-http URLs", () => {
    expect(parseEmbedUrl("")).toBeNull();
    expect(parseEmbedUrl("not a url")).toBeNull();
    expect(parseEmbedUrl("javascript:alert(1)")).toBeNull();
    expect(parseEmbedUrl("ftp://example.com/file")).toBeNull();
  });
});

describe("isIframeEmbed", () => {
  it("marks iframe-able providers", () => {
    expect(isIframeEmbed(parseEmbedUrl("https://youtu.be/dQw4w9WgXcQ"))).toBe(true);
    expect(isIframeEmbed(parseEmbedUrl("https://open.spotify.com/track/abc"))).toBe(true);
  });
  it("excludes unknown / link-only providers", () => {
    expect(isIframeEmbed(parseEmbedUrl("https://example.com/x"))).toBe(false);
    expect(isIframeEmbed(parseEmbedUrl("https://gist.github.com/u/abc"))).toBe(false);
    expect(isIframeEmbed(parseEmbedUrl("https://bsky.app/profile/x.bsky.social/post/abc"))).toBe(false);
    expect(isIframeEmbed(null)).toBe(false);
  });
});
