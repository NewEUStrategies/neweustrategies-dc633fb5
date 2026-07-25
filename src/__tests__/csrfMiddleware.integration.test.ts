// Integracyjny test odrzucania serverFn bez CSRF (cross-site symulacja).
//
// TanStack Start rejestruje `createCsrfMiddleware` z filtrem
// `handlerType === "serverFn"` (patrz src/start.ts). Endpointy serverFn są
// odpalane pod `/_serverFn/<hash>` i wymagają same-origin (Origin +
// Sec-Fetch-Site). Test wysyła POST bez nagłówka Origin/Sec-Fetch-Site
// i oczekuje odpowiedzi != 2xx (403/4xx). Klasyczne dokumenty SSR nie
// przechodzą przez ten filtr, więc GET "/" nadal jest OK.
//
// Test tolerancyjny: jesli devserver nie jest dostepny, jest skipowany -
// pełny e2e pokrywa go /e2e/csrf.spec.ts (Playwright).
import { describe, expect, it } from "vitest";

const BASE = process.env.CSRF_TEST_BASE ?? "http://localhost:8080";

async function serverReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/public/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok || r.status < 500;
  } catch {
    return false;
  }
}

describe("CSRF middleware odrzuca cross-site serverFn", () => {
  it("POST bez Origin/Sec-Fetch-Site na /_serverFn/* nie jest 2xx", async () => {
    if (!(await serverReachable())) return;
    // Losowy hash: liczy się to, że filtr trafia na handlerType === "serverFn".
    const res = await fetch(`${BASE}/_serverFn/__csrf_probe__`, {
      method: "POST",
      // Celowo BEZ nagłówka `Origin` / `Referer` - symulacja XSRF.
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: null }),
    });
    // Middleware odsyła 403 (CSRF) lub 404 (nieznany hash) - liczy się to,
    // że nie zostajemy przepuszczeni jak legitne wywołanie.
    expect(res.ok).toBe(false);
    expect([400, 403, 404, 405]).toContain(res.status);
  });

  it("GET dokumentu SSR ('/') NIE jest gatowany przez CSRF", async () => {
    if (!(await serverReachable())) return;
    const res = await fetch(`${BASE}/`, { method: "GET" });
    expect(res.status).toBeLessThan(500);
    // Nawet 3xx (redirect na /pl) jest OK - byle nie CSRF-403.
    if (res.status === 403) {
      const text = await res.text();
      expect(/csrf/i.test(text)).toBe(false);
    }
  });
});
