// Kanarek silnika sanityzacji + bramka przypięcia `dompurify`.
//
// Kontekst (odtworzony pomiarem, nie hipoteza): DOMPurify >= 3.4.8 czyta
// `nodeName` przez getter z `Node.prototype`. W środowiskach, które definiują
// `nodeName` na klasie POCHODNEJ (tak robi happy-dom - czyli ŚRODOWISKO TESTOWE
// TEGO REPO), taki getter zwraca dla elementu pusty string, allowlista nie
// dopasowuje niczego i `<script>` PRZEŻYWA sanityzację - także przy jawnym
// `FORBID_TAGS`. Zakres `^3.4.7` dopuszczał 3.4.8-3.4.12, więc zwykłe
// `bun install` mogło wprowadzić tę degradację bez żadnego sygnału.
//
// Testy poniżej pilnują OBU warstw obrony:
//   1. wersja `dompurify` jest przypięta dokładnie (bez `^`);
//   2. gdyby i tak trafił się zdegradowany silnik, `sanitizeHtml` NIE wypuszcza
//      markup - degraduje do zaescape'owanego tekstu (fail-closed).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSanitizerEngine,
  escapeHtmlToText,
  probeSanitizerEngine,
  resetSanitizerEngineProbe,
} from "../sanitizeEngineGuard";

afterEach(() => {
  resetSanitizerEngineProbe();
});

/** Atrapa sprawnego silnika: usuwa wykonywalny markup, zachowuje `<p>ok</p>`. */
function goodEngine(dirty: string): string {
  return dirty
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<img\b[^>]*>/gi, "");
}

describe("probeSanitizerEngine", () => {
  it("reports a healthy engine that strips executable markup and keeps content", () => {
    const probe = probeSanitizerEngine(goodEngine);
    expect(probe.status).toBe("healthy");
    expect(probe.reason).toBe("");
  });

  it("detects the exact leak shape measured with dompurify 3.4.12 + happy-dom", () => {
    // Verbatim: the <p> wrapper is gone and the <script> body survives.
    const probe = probeSanitizerEngine(() => "ok<script>alert(1)</script>");
    expect(probe.status).toBe("degraded");
    expect(probe.reason).toContain("leak");
  });

  it("detects each forbidden tag class on its own", () => {
    const leaks = [
      "<p>ok</p><script>alert(1)</script>",
      "<p>ok</p><style>x{}</style>",
      '<p>ok</p><iframe src="x"></iframe>',
      "<p>ok</p></script>",
      '<p>ok</p><img src=x onerror="alert(1)">',
    ];
    for (const leak of leaks) {
      expect(probeSanitizerEngine(() => leak).status, leak).toBe("degraded");
    }
  });

  it("treats an engine that throws as degraded", () => {
    const probe = probeSanitizerEngine(() => {
      throw new Error("no DOM");
    });
    expect(probe.status).toBe("degraded");
    expect(probe.reason).toContain("no DOM");
  });

  it("treats an engine that swallows ALL content as degraded", () => {
    // Leak-free but useless: it would blank out every article. Not "healthy".
    const probe = probeSanitizerEngine(() => "");
    expect(probe.status).toBe("degraded");
    expect(probe.reason).toContain("lost safe markup");
  });

  it("treats an engine that returns text-only (no markup) as degraded", () => {
    // Escaping everything is the FAIL-CLOSED fallback, not a healthy engine -
    // otherwise the guard could never tell the two apart.
    expect(probeSanitizerEngine((dirty) => escapeHtmlToText(dirty)).status).toBe("degraded");
  });

  it("does not fire on a single combined payload quirk (isolated vectors only)", () => {
    // Measured: under happy-dom even the HEALTHY dompurify 3.4.7 lets <style>
    // survive when it directly follows <script>. A combined canary payload would
    // therefore raise a false alarm; per-vector probing must not.
    expect(probeSanitizerEngine(goodEngine).status).toBe("healthy");
  });
});

describe("assertSanitizerEngine", () => {
  it("probes once and caches the verdict", () => {
    let calls = 0;
    const engine = (dirty: string) => {
      calls += 1;
      return goodEngine(dirty);
    };
    expect(assertSanitizerEngine(engine)).toBe("healthy");
    expect(assertSanitizerEngine(engine)).toBe("healthy");
    expect(assertSanitizerEngine(engine)).toBe("healthy");
    // One probe = one call per canary case, not one per sanitizeHtml() call.
    expect(calls).toBe(4);
  });

  it("re-probes after an explicit reset", () => {
    let probes = 0;
    const engine = (dirty: string) => {
      if (dirty.includes("<script>")) probes += 1;
      return goodEngine(dirty);
    };
    assertSanitizerEngine(engine);
    resetSanitizerEngineProbe();
    assertSanitizerEngine(engine);
    expect(probes).toBe(2);
  });

  it("reports degraded without throwing (sanitization must never break the page)", () => {
    expect(assertSanitizerEngine(() => "ok<script>alert(1)</script>")).toBe("degraded");
  });
});

describe("escapeHtmlToText (fail-closed output)", () => {
  it("neutralises every markup-significant character", () => {
    expect(escapeHtmlToText('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeHtmlToText("a & b")).toBe("a &amp; b");
    expect(escapeHtmlToText("it's")).toBe("it&#39;s");
  });

  it("leaves no character that could re-open a tag", () => {
    const out = escapeHtmlToText('<img src=x onerror="alert(1)">');
    expect(out).not.toMatch(/[<>"']/);
  });

  it("is safe for content with no markup at all", () => {
    expect(escapeHtmlToText("Wyzwania małych firm")).toBe("Wyzwania małych firm");
  });
});

describe("dompurify dependency pin", () => {
  const pkg = JSON.parse(
    // `resolve` od CWD, nie od `import.meta.url`: pod happy-dom URL modułu nie
    // jest schematem `file:`, a vitest uruchamia się z korzenia repozytorium.
    readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };

  it("is pinned to an exact version - no caret on the XSS sanitizer", () => {
    const spec = pkg.dependencies.dompurify;
    expect(spec, "dompurify must stay a direct dependency").toBeTruthy();
    expect(spec, `dompurify must be pinned exactly, got "${spec}"`).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("stays below the version that regressed on non-spec DOM engines", () => {
    const [major, minor, patch] = pkg.dependencies.dompurify.split(".").map(Number);
    const isBefore348 = major < 3 || (major === 3 && (minor < 4 || (minor === 4 && patch < 8)));
    expect(
      isBefore348,
      "dompurify >= 3.4.8 reads nodeName off Node.prototype; re-verify the engine canary " +
        "against happy-dom before raising this pin",
    ).toBe(true);
  });
});
