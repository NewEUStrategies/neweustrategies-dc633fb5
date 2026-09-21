import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Handler = (ctx: { request: Request; params: { _splat?: string } }) => Promise<Response>;
const h = vi.hoisted(() => ({
  handlers: null as { GET: Handler; HEAD: Handler } | null,
  fetch: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { server: { handlers: { GET: Handler; HEAD: Handler } } }) => {
    h.handlers = options.server.handlers;
    return options;
  },
}));
import "../media.$";

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://storage.example.test");
  vi.stubGlobal("fetch", h.fetch);
  h.fetch.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function serve(method: "GET" | "HEAD", path?: string, headers: HeadersInit = {}, query = "") {
  if (!h.handlers) throw new Error("route did not register handlers");
  return h.handlers[method]({
    request: new Request(`https://nes.example/media/file${query}`, { method, headers }),
    params: { _splat: path },
  });
}

it.each(["GET", "HEAD"] as const)(
  "%s rejects missing or unsafe paths without fetching storage",
  async (method) => {
    expect((await serve(method)).status).toBe(404);
    expect((await serve(method, "../private/file")).status).toBe(404);
    vi.stubEnv("SUPABASE_URL", "");
    expect((await serve(method, "image.png")).status).toBe(404);
    expect(h.fetch).not.toHaveBeenCalled();
  },
);

it("streams the body, encodes path segments and forwards cache validators", async () => {
  h.fetch.mockResolvedValue(
    new Response("file", {
      headers: {
        "content-type": "image/png",
        "content-length": "4",
        etag: '"image-1"',
        "last-modified": "Sat, 12 Sep 2026 10:00:00 GMT",
        "accept-ranges": "bytes",
      },
    }),
  );
  const response = await serve("GET", "folder/obraz test.png");
  expect(await response.text()).toBe("file");
  const [url, init] = h.fetch.mock.calls[0];
  expect(String(url)).toBe(
    "https://storage.example.test/storage/v1/object/public/media/folder/obraz%20test.png",
  );
  expect(init).toEqual({ method: "GET", headers: {} });
  expect(response.headers.get("etag")).toBe('"image-1"');
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("content-length")).toBe("4");
  expect(response.headers.get("last-modified")).toBe("Sat, 12 Sep 2026 10:00:00 GMT");
  expect(response.headers.get("accept-ranges")).toBe("bytes");
  expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
});

it("preserves partial responses and suppresses bodies on HEAD", async () => {
  h.fetch.mockResolvedValue(
    new Response(null, { status: 206, headers: { "content-range": "bytes 0-3/100" } }),
  );
  const response = await serve("HEAD", "video.mp4", { range: "bytes=0-3" });
  expect(response.status).toBe(206);
  expect(await response.text()).toBe("");
  expect(response.headers.get("content-range")).toBe("bytes 0-3/100");
  expect(response.headers.get("accept-ranges")).toBeNull();
  expect(h.fetch.mock.calls[0][1]).toEqual({ method: "HEAD", headers: { Range: "bytes=0-3" } });
});

it.each([
  [400, 404],
  [403, 404],
  [404, 404],
  [500, 502],
  [302, 502],
])("maps storage status %s to %s", async (upstream, expected) => {
  h.fetch.mockResolvedValue(new Response("storage detail", { status: upstream }));
  const response = await serve("GET", "image.png");
  expect(response.status).toBe(expected);
  expect(await response.text()).toBe("Not found");
});

it("wariant kadrowany trafia na transformację obrazu z ograniczonymi parametrami", async () => {
  h.fetch.mockResolvedValue(new Response("img", { headers: { "content-type": "image/jpeg" } }));
  await serve("GET", "cover.jpg", {}, "?width=9999&height=300&resize=cover&quality=88");
  expect(String(h.fetch.mock.calls[0][0])).toBe(
    "https://storage.example.test/storage/v1/render/image/public/media/cover.jpg?width=4000&height=300&resize=cover&quality=88",
  );
});

it("wariant szerokościowy nie wymaga wysokości, a śmieciowe parametry są pomijane", async () => {
  h.fetch.mockResolvedValue(new Response("img", { headers: { "content-type": "image/jpeg" } }));
  await serve("GET", "cover.jpg", {}, "?width=320&resize=hack&quality=1");
  expect(String(h.fetch.mock.calls[0][0])).toBe(
    "https://storage.example.test/storage/v1/render/image/public/media/cover.jpg?width=320",
  );
  h.fetch.mockClear();
  await serve("GET", "cover.jpg", {}, "?width=0&height=abc");
  expect(String(h.fetch.mock.calls[0][0])).toBe(
    "https://storage.example.test/storage/v1/object/public/media/cover.jpg",
  );
});

it("przekazuje do magazynu Accept i walidatory warunkowe obok Range", async () => {
  // `Accept` przesądza o WebP - transformacja Supabase negocjuje format
  // WYŁĄCZNIE tym nagłówkiem (parametr `format` zna tylko `origin`). Bez
  // przekazania markowa ścieżka /media/* zawsze oddawałaby format oryginału.
  // Walidatory pozwalają magazynowi odpowiedzieć 304 zamiast całego ciała.
  h.fetch.mockResolvedValue(new Response("img", { headers: { "content-type": "image/webp" } }));
  await serve(
    "GET",
    "cover.jpg",
    {
      accept: "image/avif,image/webp,image/*;q=0.8",
      "if-none-match": '"image-1"',
      "if-modified-since": "Sat, 12 Sep 2026 10:00:00 GMT",
      range: "bytes=0-99",
    },
    "?width=320",
  );
  expect(h.fetch.mock.calls[0][1]).toEqual({
    method: "GET",
    headers: {
      Accept: "image/avif,image/webp,image/*;q=0.8",
      "If-None-Match": '"image-1"',
      "If-Modified-Since": "Sat, 12 Sep 2026 10:00:00 GMT",
      Range: "bytes=0-99",
    },
  });
});

it("Accept z gwiazdką idzie dalej dosłownie, bez naszej interpretacji", async () => {
  // Negocjację prowadzi upstream. Każde "poprawianie" listy typów po drodze
  // rozjechałoby nasz wybór z tym, co realnie odda magazyn.
  h.fetch.mockResolvedValue(new Response("img", { headers: { "content-type": "image/jpeg" } }));
  await serve("GET", "cover.jpg", { accept: "*/*" });
  expect(h.fetch.mock.calls[0][1]).toEqual({ method: "GET", headers: { Accept: "*/*" } });
});

it.each(["GET", "HEAD"] as const)("%s oznacza odpowiedź Vary: Accept", async (method) => {
  // Treść zależy od `Accept` (WebP kontra format oryginału). Bez `Vary` cache
  // brzegowy podałby WebP przeglądarce, która go nie obsługuje.
  h.fetch.mockResolvedValue(new Response("img", { headers: { "content-type": "image/webp" } }));
  const response = await serve(method, "cover.jpg", { accept: "image/webp" });
  expect(response.headers.get("vary")).toBe("Accept");
});

it("304 z magazynu wraca jako 304, nie jako brak pliku", async () => {
  // Pułapka: warunek `!response.ok && status !== 206` uznałby 304 za 4xx i
  // zwrócił 404. Przeglądarka pobrałaby wtedy pełne ciało (albo zobaczyła błąd)
  // zamiast odświeżyć wpis w cache jednym pustym obrotem.
  h.fetch.mockResolvedValue(
    new Response(null, {
      status: 304,
      headers: { etag: '"image-1"', "last-modified": "Sat, 12 Sep 2026 10:00:00 GMT" },
    }),
  );
  const response = await serve("GET", "cover.jpg", { "if-none-match": '"image-1"' });
  expect(response.status).toBe(304);
  expect(await response.text()).toBe("");
  expect(response.headers.get("etag")).toBe('"image-1"');
  expect(response.headers.get("last-modified")).toBe("Sat, 12 Sep 2026 10:00:00 GMT");
  expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
  expect(response.headers.get("vary")).toBe("Accept");
});

it("304 nie opisuje ciała, którego nie wysyła", async () => {
  // `Content-Type`/`Content-Length` przepisane z upstreamu kłamałyby o pustej
  // odpowiedzi - część pośredników liczy na zgodność tych pól z treścią.
  h.fetch.mockResolvedValue(
    new Response(null, {
      status: 304,
      headers: { etag: '"image-1"', "content-type": "image/webp", "content-length": "1234" },
    }),
  );
  const response = await serve("GET", "cover.jpg", { "if-none-match": '"image-1"' });
  expect(response.headers.get("content-type")).toBeNull();
  expect(response.headers.get("content-length")).toBeNull();
});

it("wyjątek dla 304 nie rozszczelnił mapowania błędów magazynu", async () => {
  // Strażnik: 404/400 nadal są brakiem pliku, a 5xx awarią bramy - przepuszczenie
  // 304 miało dotknąć wyłącznie żądań warunkowych.
  for (const [upstream, expected] of [
    [404, 404],
    [400, 404],
    [500, 502],
  ] as const) {
    h.fetch.mockResolvedValue(new Response("storage detail", { status: upstream }));
    const response = await serve("GET", "cover.jpg", { "if-none-match": '"image-1"' });
    expect(response.status).toBe(expected);
    expect(await response.text()).toBe("Not found");
  }
});
