// Markowy adres publicznych mediów: /media/<ścieżka>. Nie ujawnia w interfejsie
// technicznego hosta magazynu, a pliki nadal korzystają z jego trwałości i cache.
import { createFileRoute } from "@tanstack/react-router";
import { mediaStoragePath } from "@/lib/media/publicUrl";

const PASSTHROUGH_HEADERS = ["content-type", "content-length", "etag", "last-modified"] as const;

async function serveMedia(request: Request, splat: string): Promise<Response> {
  const storagePath = mediaStoragePath(`/media/${splat}`);
  const storageOrigin = process.env.SUPABASE_URL;
  if (!storagePath || !storageOrigin) return new Response("Not found", { status: 404 });

  const upstream = new URL(
    `/storage/v1/object/public/media/${storagePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`,
    storageOrigin,
  );
  const response = await fetch(upstream, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: request.headers.get("range") ? { Range: request.headers.get("range") ?? "" } : {},
  });
  if (!response.ok && response.status !== 206) {
    return new Response("Not found", { status: response.status === 404 ? 404 : 502 });
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
      GET: ({ request, params }) => serveMedia(request, params._splat),
      HEAD: ({ request, params }) => serveMedia(request, params._splat),
    },
  },
});
