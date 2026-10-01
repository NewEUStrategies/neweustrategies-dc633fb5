// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setColoCacheForTests } from "../documentCacheL2.server";
import { withMediaCache } from "../mediaCache.server";

const background = vi.hoisted(() => ({ work: [] as Promise<unknown>[] }));
vi.mock("../waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => {
    background.work.push(work.catch(() => undefined));
  },
}));

const entries = new Map<string, Response>();
const match = vi.fn(async (key: Request) => entries.get(key.url)?.clone());
const put = vi.fn(async (key: Request, response: Response) => {
  entries.set(key.url, new Response(await response.arrayBuffer(), response));
});
const source = new URL(
  "https://storage.test/storage/v1/render/image/public/media/tenant/a.webp?width=640",
);
const request = (headers?: HeadersInit, host = "site.test", method = "GET") =>
  new Request(`https://${host}/media/tenant/a.webp?width=640`, { headers, method });
const image = () =>
  new Response("image", {
    headers: {
      "content-type": "image/webp",
      "content-length": "5",
      "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable",
      vary: "Accept",
      etag: '"v1"',
    },
  });
const load = vi.fn(async () => image());
const flush = () => Promise.all(background.work);

beforeEach(() => {
  entries.clear();
  background.work = [];
  vi.clearAllMocks();
  match.mockImplementation(async (key) => entries.get(key.url)?.clone());
  put.mockImplementation(async (key, response) => {
    entries.set(key.url, new Response(await response.arrayBuffer(), response));
  });
  load.mockImplementation(async () => image());
  setColoCacheForTests({ match, put });
});

afterEach(async () => {
  await flush();
  setColoCacheForTests(undefined);
});

describe("public media colo cache", () => {
  it("serves the next visitor without fetching storage and preserves body and headers", async () => {
    const first = await withMediaCache(request({ accept: "image/webp" }), source, load);
    expect(await first.text()).toBe("image");
    await flush();
    const second = await withMediaCache(request({ accept: "image/webp" }), source, load);
    expect(await second.text()).toBe("image");
    expect(second.headers.get("etag")).toBe('"v1"');
    expect(second.headers.get("cache-control")).toBe(image().headers.get("cache-control"));
    expect(second.headers.get("vary")).toBe("Accept");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["format", request({ accept: "image/png" }), source],
    ["exact Accept", request({ accept: "image/webp;q=0" }), source],
    ["host", request({ accept: "image/webp" }, "other.test"), source],
    [
      "storage project",
      request({ accept: "image/webp" }),
      new URL(source.href.replace("storage.test", "other-storage.test")),
    ],
    [
      "tenant",
      request({ accept: "image/webp" }),
      new URL(source.href.replace("/tenant/", "/other-tenant/")),
    ],
    ["size", request({ accept: "image/webp" }), new URL(source.href.replace("640", "320"))],
  ])("isolates %s variants", async (_name, nextRequest, nextSource) => {
    await withMediaCache(request({ accept: "image/webp" }), source, load);
    await flush();
    await withMediaCache(nextRequest, nextSource, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each([
    request({}, "site.test", "HEAD"),
    request({ range: "bytes=0-3" }),
    request({ "if-range": '"v1"' }),
    request({ "if-none-match": '"v1"' }),
    request({ "if-modified-since": "Wed, 30 Sep 2026 12:00:00 GMT" }),
  ])("leaves conditional, range and HEAD requests to storage", async (req) => {
    const upstreamResponse = new Response(null, { status: 304 });
    load.mockResolvedValue(upstreamResponse);
    expect(await withMediaCache(req, source, load)).toBe(upstreamResponse);
    expect(match).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it.each([
    [206, "image/webp", "5"],
    [404, "image/webp", "5"],
    [502, "image/webp", "5"],
    [200, "video/mp4", "5"],
    [200, "image/webp", null],
    [200, "image/webp", "5242881"],
  ])("does not store status %s, type %s, length %s", async (status, type, length) => {
    const headers = new Headers({ "content-type": type });
    if (length) headers.set("content-length", length);
    load.mockResolvedValue(new Response("body", { status, headers }));
    await withMediaCache(request(), source, load);
    await flush();
    expect(put).not.toHaveBeenCalled();
  });

  it("fails open when Cache API is absent or read/write fails", async () => {
    setColoCacheForTests(null);
    expect(await (await withMediaCache(request(), source, load)).text()).toBe("image");
    setColoCacheForTests({ match, put });
    match.mockRejectedValue(new Error("cache unavailable"));
    put.mockRejectedValue(new Error("cache unavailable"));
    expect(await (await withMediaCache(request(), source, load)).text()).toBe("image");
    await expect(flush()).resolves.toBeDefined();
  });

  it("returns the response while the cache write is still pending", async () => {
    let finish: () => void = () => {};
    put.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const response = await withMediaCache(request(), source, load);
    expect(await response.text()).toBe("image");
    expect(put).toHaveBeenCalledTimes(1);
    finish();
    await flush();
  });
});
