// Markowy adres publicznych mediów: /media/<ścieżka>. Nie ujawnia w interfejsie
// technicznego hosta magazynu, a pliki nadal korzystają z jego trwałości i cache.
import { createFileRoute } from "@tanstack/react-router";
import { mediaStoragePath } from "@/lib/media/publicUrl";

const PASSTHROUGH_HEADERS = ["content-type", "content-length", "etag", "last-modified"] as const;

/**
 * Warianty rozmiarowe muszą działać pod markową domeną - inaczej miniatury
 * cofałyby się do technicznego hosta magazynu. Przepisujemy więc `width`,
 * `height`, `resize` i `quality` na endpoint transformacji obrazu.
 */
function imageTransform(url: URL): URLSearchParams | null {
  const width = Number(url.searchParams.get("width") ?? "");
  const height = Number(url.searchParams.get("height") ?? "");
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const resize = url.searchParams.get("resize");
  const quality = Number(url.searchParams.get("quality") ?? "");
  const params = new URLSearchParams({
    width: String(Math.min(Math.round(width), 4000)),
    height: String(Math.min(Math.round(height), 4000)),
  });
  if (resize === "cover" || resize === "contain" || resize === "fill") params.set("resize", resize);
  if (Number.isFinite(quality) && quality >= 20 && quality <= 100) {
    params.set("quality", String(Math.round(quality)));
  }
  return params;
}

async function serveMedia(request: Request, splat: string): Promise<Response> {
  const storagePath = mediaStoragePath(`/media/${splat}`);
  const storageOrigin = process.env.SUPABASE_URL;
  if (!storagePath || !storageOrigin) return new Response("Not found", { status: 404 });

  const transform = imageTransform(new URL(request.url));
  const encodedPath = storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const upstream = new URL(
    transform
      ? `/storage/v1/render/image/public/media/${encodedPath}?${transform.toString()}`
      : `/storage/v1/object/public/media/${encodedPath}`,
    storageOrigin,
  );
  const response = await fetch(upstream, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: request.headers.get("range") ? { Range: request.headers.get("range") ?? "" } : {},
  });
  if (!response.ok && response.status !== 206) {
    // Magazyn zgłasza brak obiektu również statusem 400 (`NoSuchKey`), dlatego
    // każdą odpowiedź 4xx traktujemy jako brak pliku - nie jako awarię serwera.
    const missing = response.status >= 400 && response.status < 500;
    return new Response("Not found", { status: missing ? 404 : 502 });
  }

  const headers = new Headers({
    "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of PASSTHROUGH_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  const contentRange = response.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);
  if (response.headers.get("accept-ranges")) headers.set("Accept-Ranges", "bytes");

  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    headers,
  });
}

export const Route = createFileRoute("/media/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveMedia(request, params._splat ?? ""),
      HEAD: ({ request, params }) => serveMedia(request, params._splat ?? ""),
    },
  },
});
