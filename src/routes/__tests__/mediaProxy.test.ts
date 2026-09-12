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
function serve(method: "GET" | "HEAD", path?: string, headers: HeadersInit = {}) {
  if (!h.handlers) throw new Error("route did not register handlers");
  return h.handlers[method]({
    request: new Request("https://nes.example/media/file", { method, headers }),
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
