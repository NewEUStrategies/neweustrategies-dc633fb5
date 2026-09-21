import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DOC_GUARD_HEADER,
  DOC_GUARD_TRUNCATION_MARKER,
  HtmlEndScanner,
  getDocumentGuardSnapshot,
  guardDocumentResponse,
  guardDocumentStream,
  resetDocumentGuardForTests,
} from "../documentStreamGuard.server";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Strumień, który emituje chunki i - jak wiszący SSR - NIGDY się nie zamyka. */
function neverClosingStream(chunks: string[], intervalMs = 0): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let index = 0;
      const push = () => {
        if (index >= chunks.length) return; // zostaje otwarty w nieskończoność
        controller.enqueue(encoder.encode(chunks[index]!));
        index += 1;
        if (intervalMs > 0) setTimeout(push, intervalMs);
        else push();
      };
      push();
    },
  });
}

/** Strumień zamykający się naturalnie po wyemitowaniu chunków. */
function closingStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += decoder.decode(value, { stream: true });
  }
}

afterEach(() => {
  resetDocumentGuardForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HtmlEndScanner", () => {
  it("accepts empty chunks and remembers an already found end", () => {
    const scanner = new HtmlEndScanner();
    expect(scanner.push(new Uint8Array())).toBe(false);
    expect(scanner.push(encoder.encode("</html>"))).toBe(true);
    expect(scanner.push(encoder.encode("trailing serialization"))).toBe(true);
  });
  it("wykrywa sentinel w jednym chunku", () => {
    const scanner = new HtmlEndScanner();
    expect(scanner.push(encoder.encode("<html><body>x</body></html>"))).toBe(true);
  });

  it("wykrywa sentinel rozcięty granicą chunków", () => {
    const scanner = new HtmlEndScanner();
    expect(scanner.push(encoder.encode("</body></ht"))).toBe(false);
    expect(scanner.push(encoder.encode("ml>"))).toBe(true);
  });

  it("jest niewrażliwy na wielkość liter", () => {
    const scanner = new HtmlEndScanner();
    expect(scanner.push(encoder.encode("</BODY></HTML>"))).toBe(true);
  });

  it("nie daje fałszywych trafień", () => {
    const scanner = new HtmlEndScanner();
    expect(scanner.push(encoder.encode("</head><body>html> </html"))).toBe(false);
  });
});

describe("guardDocumentStream", () => {
  it("cancels the upstream reader when the consumer disconnects", async () => {
    const cancel = vi.fn();
    const guarded = guardDocumentStream(new ReadableStream({ cancel }), { maxMs: 50 });
    await guarded.cancel("client disconnected");
    expect(cancel).toHaveBeenCalledExactlyOnceWith("client disconnected");
    expect(getDocumentGuardSnapshot()).toMatchObject({ closedBySource: 1, incidents: [] });
  });
  it("settles cancellation even if upstream cleanup rejects", async () => {
    const guarded = guardDocumentStream(
      new ReadableStream({ cancel: () => Promise.reject(new Error("upstream gone")) }),
    );
    await expect(guarded.cancel()).resolves.toBeUndefined();
  });
  it("ignores empty chunks and does not extend grace for trailing bytes after HTML end", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array());
        c.enqueue(encoder.encode("</html>"));
        c.enqueue(encoder.encode("tail"));
      },
    });
    const result = readAll(guardDocumentStream(stream, { sentinelGraceMs: 10 }));
    await vi.advanceTimersByTimeAsync(11);
    expect(await result).toBe("</html>tail");
    expect(getDocumentGuardSnapshot().closedBySentinel).toBe(1);
  });
  it.each(["5", "0", "-1", "garbage"])(
    "validates the environment's hard deadline %s",
    async (value) => {
      vi.useFakeTimers();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubEnv("SSR_DOC_GUARD_MAX_MS", value);
      const result = readAll(guardDocumentStream(new ReadableStream()));
      await vi.advanceTimersByTimeAsync(value === "5" ? 6 : 20_001);
      expect(await result).toContain('reason="timeout"');
    },
  );
  it("bounds incident history and keeps the most recent route", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const reads = Array.from({ length: 52 }, (_, i) =>
      readAll(guardDocumentStream(new ReadableStream(), { maxMs: 5, label: `route-${i}` })),
    );
    await vi.advanceTimersByTimeAsync(6);
    await Promise.all(reads);
    expect(getDocumentGuardSnapshot().incidents).toHaveLength(50);
    expect(getDocumentGuardSnapshot().incidents[0].label).toBe("route-51");
  });
  it("happy path: źródło zamyka się samo, bajty przechodzą nietknięte", async () => {
    const html = "<html><body>ok</body></html>";
    const out = await readAll(
      guardDocumentStream(closingStream(["<html><body>", "ok</body></html>"])),
    );
    expect(out).toBe(html);
    const snapshot = getDocumentGuardSnapshot();
    expect(snapshot.closedBySource).toBe(1);
    expect(snapshot.incidents).toHaveLength(0);
  });

  it("sentinel: kompletny dokument na wiecznie otwartym źródle zamyka się po łasce", async () => {
    const stream = guardDocumentStream(neverClosingStream(["<html><body>ok", "</body></html>"]), {
      sentinelGraceMs: 30,
      idleMs: 5_000,
      maxMs: 5_000,
      label: "test/sentinel",
    });
    const startedAt = Date.now();
    const out = await readAll(stream);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    // Dokument był kompletny - ogon awaryjny NIE jest dosztukowywany, więc
    // nie ma też sygnatury ucięcia (inaczej bramka e2e miałaby fałszywy alarm).
    expect(out).toBe("<html><body>ok</body></html>");
    expect(out).not.toContain(DOC_GUARD_TRUNCATION_MARKER);
    expect(getDocumentGuardSnapshot().closedBySentinel).toBe(1);
  });

  it("idle: ucięty dokument dostaje parsowalny ogon z sygnaturą i incydent", async () => {
    const stream = guardDocumentStream(neverClosingStream(["<html><body>partial"]), {
      idleMs: 40,
      maxMs: 5_000,
      label: "test/idle",
    });
    const out = await readAll(stream);
    // Ogon jest parsowalny dla crawlera...
    expect(out.startsWith("<html><body>partial")).toBe(true);
    expect(out.trimEnd().endsWith("</body></html>")).toBe(true);
    // ...ale NIE udaje dokumentu kompletnego: nosi maszynowo pewną sygnaturę
    // z powodem zamknięcia. To jedyny sposób, w jaki bramka e2e może odróżnić
    // dokument ucięty od dokumentu domkniętego przez sam render.
    expect(out).toContain(DOC_GUARD_TRUNCATION_MARKER);
    expect(out).toContain('reason="idle"');
    const snapshot = getDocumentGuardSnapshot();
    expect(snapshot.closedByIdle).toBe(1);
    expect(snapshot.incidents[0]).toMatchObject({
      label: "test/idle",
      reason: "idle",
      sawHtmlEnd: false,
    });
  });

  it("timeout: stały strumyczek chunków nie odracza twardego sufitu", async () => {
    const trickle = new ReadableStream<Uint8Array>({
      start(controller) {
        const tick = () => {
          try {
            controller.enqueue(encoder.encode("<p>chunk</p>"));
          } catch {
            return; // strumień domknięty przez strażnika
          }
          setTimeout(tick, 20);
        };
        tick();
      },
    });
    const out = await readAll(
      guardDocumentStream(trickle, { idleMs: 5_000, maxMs: 120, label: "test/timeout" }),
    );
    expect(out.endsWith("\n</body></html>")).toBe(true);
    expect(out).toContain('reason="timeout"');
    expect(getDocumentGuardSnapshot().closedByTimeout).toBe(1);
  });

  it("timeout przed pierwszym bajtem zamyka pusty strumień z ogonem", async () => {
    const silent = new ReadableStream<Uint8Array>({ start() {} });
    const out = await readAll(guardDocumentStream(silent, { maxMs: 40, label: "test/empty" }));
    expect(out).toContain(DOC_GUARD_TRUNCATION_MARKER);
    expect(out.trimEnd().endsWith("</body></html>")).toBe(true);
    expect(out).toContain('bytes="0"');
    expect(getDocumentGuardSnapshot().closedByTimeout).toBe(1);
  });
});

describe("guardDocumentResponse", () => {
  const request = new Request("https://tenant.example.com/blog");

  it("opakowuje dokument HTML i wymusza domknięcie", async () => {
    const response = new Response(neverClosingStream(["<html><body>x</body></html>"]), {
      headers: { "content-type": "text/html; charset=utf-8", "x-nes-cache": "MISS" },
    });
    const guarded = guardDocumentResponse(request, response, { sentinelGraceMs: 20 });
    expect(guarded).not.toBe(response);
    // Nagłówki i status przechodzą bez zmian...
    expect(guarded.headers.get("x-nes-cache")).toBe("MISS");
    expect(guarded.status).toBe(200);
    // ...dochodzi wyłącznie ślad uzbrojenia strażnika (dowód dla bramki e2e,
    // że asercja "brak sygnatury ucięcia" nie jest pusta).
    expect(guarded.headers.get(DOC_GUARD_HEADER)).toBe("on");
    expect(response.headers.get(DOC_GUARD_HEADER)).toBeNull();
    const out = await readAll(guarded.body!);
    expect(out).toBe("<html><body>x</body></html>");
  });

  it("etykieta incydentu niesie host tenanta i ścieżkę", async () => {
    const response = new Response(neverClosingStream(["<html>partial"]), {
      headers: { "content-type": "text/html" },
    });
    const guarded = guardDocumentResponse(request, response, { idleMs: 30 });
    await readAll(guarded.body!);
    expect(getDocumentGuardSnapshot().incidents[0]?.label).toBe("tenant.example.com/blog");
  });

  it("nie dotyka odpowiedzi nie-HTML, bez body i metod nie-GET/HEAD", () => {
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    expect(guardDocumentResponse(request, json)).toBe(json);

    const empty = new Response(null, {
      status: 301,
      headers: { "content-type": "text/html", location: "/en" },
    });
    expect(guardDocumentResponse(request, empty)).toBe(empty);

    const post = new Request("https://tenant.example.com/api", { method: "POST" });
    const html = new Response("<html></html>", { headers: { "content-type": "text/html" } });
    expect(guardDocumentResponse(post, html)).toBe(html);
  });

  it("kill-switch SSR_DOC_GUARD=off wyłącza opakowanie", () => {
    const previous = process.env.SSR_DOC_GUARD;
    process.env.SSR_DOC_GUARD = "off";
    try {
      const response = new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      });
      expect(guardDocumentResponse(request, response)).toBe(response);
    } finally {
      if (previous === undefined) delete process.env.SSR_DOC_GUARD;
      else process.env.SSR_DOC_GUARD = previous;
    }
  });
});

it.each([false, true])(
  "records upstream failure separately from natural EOF (HTML complete: %s)",
  async (complete) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let sourceController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        sourceController = c;
      },
    });
    const reader = guardDocumentStream(source).getReader();
    const html = complete ? "<html><body>content</body></html>" : "<html><body>content";
    sourceController!.enqueue(encoder.encode(html));
    expect(decoder.decode((await reader.read()).value)).toBe(html);
    sourceController!.error(new Error("upstream transport disconnected"));
    const tail = await reader.read();
    if (complete) expect(tail.done).toBe(true);
    else {
      expect(decoder.decode(tail.value)).toContain(DOC_GUARD_TRUNCATION_MARKER);
      expect(decoder.decode(tail.value)).toContain('reason="error"');
      expect((await reader.read()).done).toBe(true);
    }
    expect(getDocumentGuardSnapshot()).toMatchObject({
      closedBySource: 0,
      closedByError: 1,
      incidents: [{ reason: "error", sawHtmlEnd: complete }],
    });
  },
);
