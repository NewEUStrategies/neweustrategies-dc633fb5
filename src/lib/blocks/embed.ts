// Embed URL parser. Pure, deterministic, no DOM.
//
// Goal: normalise a user-supplied URL into a canonical iframe-ready embed
// URL for the most common providers. Unknown URLs return provider: "unknown"
// with the original URL preserved (lossless) so the renderer can still
// surface a link / fallback iframe instead of dropping the content.

export type EmbedProvider =
  | "youtube"
  | "vimeo"
  | "x"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "spotify"
  | "soundcloud"
  | "dailymotion"
  | "twitch"
  | "loom"
  | "wistia"
  | "codepen"
  | "codesandbox"
  | "github-gist"
  | "reddit"
  | "pinterest"
  | "linkedin"
  | "bluesky"
  | "threads"
  | "mastodon"
  | "unknown";

export interface ParsedEmbed {
  provider: EmbedProvider;
  /** Canonical iframe-ready URL (or original URL when no canonical form). */
  embedUrl: string;
  /** Original input URL, always preserved for lossless re-export. */
  sourceUrl: string;
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function hostOf(u: URL): string {
  return u.hostname.replace(/^www\./, "").toLowerCase();
}

function ytId(u: URL, host: string): string | null {
  if (host === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0] ?? "";
    return /^[\w-]{6,}$/.test(id) ? id : null;
  }
  if (host.endsWith("youtube.com") || host === "youtube-nocookie.com" || host === "m.youtube.com") {
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{6,}$/.test(v)) return v;
    const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/);
    if (m) return m[1];
  }
  return null;
}

function vimeoId(u: URL, host: string): string | null {
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
  // Forms: /123, /channels/x/123, /groups/x/videos/123, /video/123, /album/x/video/123, /123/<hash>
  const parts = u.pathname.split("/").filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (/^\d+$/.test(parts[i])) return parts[i];
  }
  return null;
}

function tiktokId(u: URL, host: string): string | null {
  if (!host.endsWith("tiktok.com")) return null;
  const m = u.pathname.match(/\/video\/(\d+)/) ?? u.pathname.match(/\/v\/(\d+)/);
  return m ? m[1] : null;
}

function spotifyPath(u: URL, host: string): string | null {
  if (host !== "open.spotify.com") return null;
  // /track/ID, /episode/ID, /show/ID, /playlist/ID, /album/ID, /artist/ID
  const m = u.pathname.match(/^\/(track|episode|show|playlist|album|artist)\/([A-Za-z0-9]+)/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function parseEmbedUrl(raw: string): ParsedEmbed | null {
  const url = (raw || "").trim();
  if (!url) return null;
  const u = safeUrl(url);
  if (!u) return null;
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const host = hostOf(u);
  const sourceUrl = url;

  // ---- YouTube (all common variants: watch, youtu.be, embed, shorts, live, no-cookie, m.) ----
  const yt = ytId(u, host);
  if (yt) {
    const t = u.searchParams.get("t") ?? u.searchParams.get("start");
    const startSec = t ? Number(String(t).replace(/[^\d]/g, "")) : 0;
    const qs = startSec > 0 ? `?start=${startSec}` : "";
    return {
      provider: "youtube",
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}${qs}`,
      sourceUrl,
    };
  }

  // ---- Vimeo (vimeo.com/123, player.vimeo.com/video/123, channels, groups, albums) ----
  const vid = vimeoId(u, host);
  if (vid) {
    return { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${vid}`, sourceUrl };
  }

  // ---- X / Twitter (twitter.com, x.com, mobile.twitter.com, nitter mirrors collapsed to x) ----
  if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") {
    return {
      provider: "x",
      embedUrl: `https://platform.twitter.com/embed/Tweet.html?url=${encodeURIComponent(url)}`,
      sourceUrl,
    };
  }

  // ---- Instagram (post, reel, tv) ----
  if (host === "instagram.com" || host === "instagr.am") {
    const m = u.pathname.match(/^\/(p|reel|tv)\/([\w-]+)/);
    if (m)
      return {
        provider: "instagram",
        embedUrl: `https://www.instagram.com/${m[1]}/${m[2]}/embed`,
        sourceUrl,
      };
  }

  // ---- TikTok (tiktok.com/@user/video/id, vm.tiktok.com short links handled lossless) ----
  const tk = tiktokId(u, host);
  if (tk) {
    return { provider: "tiktok", embedUrl: `https://www.tiktok.com/embed/v2/${tk}`, sourceUrl };
  }
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    return { provider: "tiktok", embedUrl: sourceUrl, sourceUrl };
  }

  // ---- Facebook (videos, posts, fb.watch) ----
  if (host === "facebook.com" || host === "fb.watch" || host === "m.facebook.com") {
    return {
      provider: "facebook",
      embedUrl: `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(url)}&show_text=true`,
      sourceUrl,
    };
  }

  // ---- Spotify (track, episode, show, playlist, album, artist) ----
  const sp = spotifyPath(u, host);
  if (sp) {
    return { provider: "spotify", embedUrl: `https://open.spotify.com/embed/${sp}`, sourceUrl };
  }

  // ---- SoundCloud (oEmbed style player) ----
  if (host === "soundcloud.com" || host === "m.soundcloud.com") {
    return {
      provider: "soundcloud",
      embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&visual=true`,
      sourceUrl,
    };
  }

  // ---- Dailymotion (dai.ly short + dailymotion.com/video/ID) ----
  if (host === "dailymotion.com") {
    const m = u.pathname.match(/^\/video\/([A-Za-z0-9]+)/);
    if (m)
      return {
        provider: "dailymotion",
        embedUrl: `https://www.dailymotion.com/embed/video/${m[1]}`,
        sourceUrl,
      };
  }
  if (host === "dai.ly") {
    const id = u.pathname.replace(/^\//, "");
    if (id)
      return {
        provider: "dailymotion",
        embedUrl: `https://www.dailymotion.com/embed/video/${id}`,
        sourceUrl,
      };
  }

  // ---- Twitch (channel live + video VOD + clip) ----
  if (host === "twitch.tv") {
    const parent = "lovable.app";
    const vod = u.pathname.match(/^\/videos\/(\d+)/);
    if (vod)
      return {
        provider: "twitch",
        embedUrl: `https://player.twitch.tv/?video=${vod[1]}&parent=${parent}`,
        sourceUrl,
      };
    const channel = u.pathname.replace(/^\//, "").split("/")[0];
    if (channel)
      return {
        provider: "twitch",
        embedUrl: `https://player.twitch.tv/?channel=${channel}&parent=${parent}`,
        sourceUrl,
      };
  }
  if (host === "clips.twitch.tv") {
    const clip = u.pathname.replace(/^\//, "");
    if (clip)
      return {
        provider: "twitch",
        embedUrl: `https://clips.twitch.tv/embed?clip=${clip}&parent=lovable.app`,
        sourceUrl,
      };
  }

  // ---- Loom ----
  if (host === "loom.com") {
    const m = u.pathname.match(/^\/(share|embed)\/([\w-]+)/);
    if (m) return { provider: "loom", embedUrl: `https://www.loom.com/embed/${m[2]}`, sourceUrl };
  }

  // ---- Wistia ----
  if (host.endsWith("wistia.com") || host.endsWith("wistia.net")) {
    const m = u.pathname.match(/(?:medias|embed)\/([\w-]+)/);
    if (m)
      return {
        provider: "wistia",
        embedUrl: `https://fast.wistia.net/embed/iframe/${m[1]}`,
        sourceUrl,
      };
  }

  // ---- CodePen ----
  if (host === "codepen.io") {
    const m = u.pathname.match(/^\/([\w-]+)\/(?:pen|details|full)\/([\w-]+)/);
    if (m)
      return {
        provider: "codepen",
        embedUrl: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`,
        sourceUrl,
      };
  }

  // ---- CodeSandbox ----
  if (host === "codesandbox.io") {
    const m = u.pathname.match(/^\/(?:s|p\/sandbox)\/([\w-]+)/);
    if (m)
      return {
        provider: "codesandbox",
        embedUrl: `https://codesandbox.io/embed/${m[1]}`,
        sourceUrl,
      };
  }

  // ---- GitHub Gist (no iframe URL; renderer can render script tag) ----
  if (host === "gist.github.com") {
    return { provider: "github-gist", embedUrl: sourceUrl, sourceUrl };
  }

  // ---- Reddit ----
  if (host === "reddit.com" || host === "old.reddit.com") {
    return {
      provider: "reddit",
      embedUrl: `https://www.redditmedia.com${u.pathname}?ref_source=embed&embed=true`,
      sourceUrl,
    };
  }

  // ---- Pinterest ----
  if (host === "pinterest.com" || /\.pinterest\.com$/.test(host)) {
    return { provider: "pinterest", embedUrl: sourceUrl, sourceUrl };
  }

  // ---- LinkedIn (posts use embed URL with urn) ----
  if (host === "linkedin.com") {
    const m = u.pathname.match(/activity[-:](\d+)/);
    if (m)
      return {
        provider: "linkedin",
        embedUrl: `https://www.linkedin.com/embed/feed/update/urn:li:activity:${m[1]}`,
        sourceUrl,
      };
  }

  // ---- Bluesky / Threads / Mastodon-ish (no canonical iframe; preserve) ----
  if (host === "bsky.app") return { provider: "bluesky", embedUrl: sourceUrl, sourceUrl };
  if (host === "threads.net" || host === "threads.com")
    return { provider: "threads", embedUrl: sourceUrl, sourceUrl };
  if (
    /^(?:.+\.)?(?:mastodon\.social|mastodon\.online|mas\.to|hachyderm\.io|fosstodon\.org)$/.test(
      host,
    )
  ) {
    return { provider: "mastodon", embedUrl: sourceUrl, sourceUrl };
  }

  // ---- Lossless fallback: unknown provider, original URL preserved ----
  return { provider: "unknown", embedUrl: sourceUrl, sourceUrl };
}

/** Providers that expose a real iframe-loadable embed URL. */
const IFRAME_PROVIDERS = new Set<EmbedProvider>([
  "youtube",
  "vimeo",
  "x",
  "instagram",
  "tiktok",
  "facebook",
  "spotify",
  "soundcloud",
  "dailymotion",
  "twitch",
  "loom",
  "wistia",
  "codepen",
  "codesandbox",
  "reddit",
  "linkedin",
]);

export function isIframeEmbed(parsed: ParsedEmbed | null | undefined): boolean {
  return !!parsed && IFRAME_PROVIDERS.has(parsed.provider);
}
