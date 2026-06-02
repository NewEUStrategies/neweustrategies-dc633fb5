// Parser URL-i do embedów. Czysty, deterministyczny, bez DOM.

export type EmbedProvider = "youtube" | "vimeo" | "x" | "unknown";

export interface ParsedEmbed {
  provider: EmbedProvider;
  embedUrl: string;
}

export function parseEmbedUrl(raw: string): ParsedEmbed | null {
  const url = (raw || "").trim();
  if (!url) return null;

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  const host = u.hostname.replace(/^www\./, "");

  // YouTube
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = u.searchParams.get("v");
    if (v) return { provider: "youtube", embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(v)}` };
    const shortsMatch = u.pathname.match(/^\/shorts\/([\w-]+)/);
    if (shortsMatch) return { provider: "youtube", embedUrl: `https://www.youtube.com/embed/${shortsMatch[1]}` };
  }
  if (host === "youtu.be") {
    const id = u.pathname.replace(/^\//, "").split("/")[0];
    if (id) return { provider: "youtube", embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(id)}` };
  }

  // Vimeo
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    if (id && /^\d+$/.test(id)) {
      return { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${id}` };
    }
  }

  // X / Twitter — używamy publicwidgets embed
  if (host === "x.com" || host === "twitter.com") {
    return { provider: "x", embedUrl: `https://platform.twitter.com/embed/Tweet.html?url=${encodeURIComponent(url)}` };
  }

  return null;
}
