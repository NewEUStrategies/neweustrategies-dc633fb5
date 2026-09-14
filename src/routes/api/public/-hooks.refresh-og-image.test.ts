// Webhook wymuszający regenerację og:image autora: POST
// /api/public/hooks/refresh-og-image.
//
// PO CO. Trasa nie miała ŻADNEGO testu, a jest publicznym ZAPISEM do
// `profiles.updated_at` chronionym wyłącznie podpisem HMAC. Podpis obejmował
// SAM slug, czyli był WIECZNYM tokenem powtórzenia: raz podejrzany w logach
// proxy albo w konfiguracji integracji dawał bezterminowe prawo do
// unicestwiania cache og:image u scraperów, a unieważnić go można było tylko
// rotacją `OG_REFRESH_SECRET` dla wszystkich slugów naraz.
//
// Ten plik utrwala kontrakt po domknięciu:
//   1. podpis obejmuje `${timestamp}.${slug}` i wygasa po oknie tolerancji
//      wspólnym z webhookami Resend (300 s),
//   2. FAZA 1 wdrożenia: stary podpis (bez `x-og-timestamp`) nadal przechodzi,
//      ale zostawia w logu ostrzeżenie `legacy signature` - bez tego okna
//      odświeżanie og:image cicho przestałoby działać u zewnętrznych wołających,
//   3. limit 10/h per slug (fail-closed) zamyka darmowe powtarzanie w oknie,
//   4. 500 nie oddaje komunikatu Postgresa.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { freezeClock, FIXED_NOW_MS } from "@/test/time";
import { WEBHOOK_TOLERANCE_SECONDS } from "@/lib/email/webhookSignature.server";

const h = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  maybeSingle: vi.fn(),
  updated: [] as Record<string, unknown>[],
  filters: [] as { column: string; value: unknown }[],
}));

vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        h.updated.push(patch);
        return {
          eq: (column: string, value: unknown) => {
            h.filters.push({ column, value });
            return { select: () => ({ maybeSingle: h.maybeSingle }) };
          },
        };
      },
    }),
  },
}));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/hooks.refresh-og-image";

const POST = routeServerHandlers(Route).POST!;

const SECRET = "og-secret-testowy";
const SLUG = "jan-kowalski";

freezeClock();

/** Znacznik czasu, który handler uzna za świeży (zegar jest zamrożony). */
function nowTs(): number {
  return Math.floor(FIXED_NOW_MS / 1000);
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

function post(headers: Record<string, string>, slug: string = SLUG): Promise<Response> {
  return POST({
    request: new Request("https://redakcja.example.test/api/public/hooks/refresh-og-image", {
      method: "POST",
      headers,
      body: JSON.stringify({ slug }),
    }),
  });
}

/** Żądanie podpisane bieżącym kontraktem: `${timestamp}.${slug}`. */
function signedPost(options: { ts?: number; slug?: string } = {}): Promise<Response> {
  const slug = options.slug ?? SLUG;
  const ts = options.ts ?? nowTs();
  return post({ "x-og-timestamp": String(ts), "x-og-signature": sign(`${ts}.${slug}`) }, slug);
}

const originalSecret = process.env.OG_REFRESH_SECRET;

beforeEach(() => {
  process.env.OG_REFRESH_SECRET = SECRET;
  h.rateLimit.mockReset().mockResolvedValue(true);
  h.maybeSingle
    .mockReset()
    .mockResolvedValue({ data: { id: "p1", slug: SLUG, updated_at: null }, error: null });
  h.updated = [];
  h.filters = [];
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.OG_REFRESH_SECRET;
  else process.env.OG_REFRESH_SECRET = originalSecret;
});

// ---------------------------------------------------------------------------
describe("konfiguracja i wejście", () => {
  it("bez OG_REFRESH_SECRET w env endpoint jest WYŁĄCZONY (501), a nie otwarty", async () => {
    delete process.env.OG_REFRESH_SECRET;

    const res = await signedPost();

    expect(res.status).toBe(501);
    expect(h.updated).toHaveLength(0);
  });

  it("slug spoza alfabetu [a-z0-9-] kończy się 400 przed weryfikacją podpisu", async () => {
    const res = await signedPost({ slug: "jan kowalski; drop" });

    expect(res.status).toBe(400);
    expect(h.rateLimit).not.toHaveBeenCalled();
  });

  it("ciało niebędące JSON-em kończy się 400, a nie wyjątkiem", async () => {
    const res = await POST({
      request: new Request("https://redakcja.example.test/api/public/hooks/refresh-og-image", {
        method: "POST",
        headers: { "x-og-timestamp": String(nowTs()) },
        body: "to nie jest json",
      }),
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("podpis ze znacznikiem czasu", () => {
  it("poprawny podpis bumpuje `updated_at` TEGO sluga i oddaje wersję", async () => {
    h.maybeSingle.mockResolvedValue({
      data: { id: "p1", slug: SLUG, updated_at: new Date(FIXED_NOW_MS).toISOString() },
      error: null,
    });

    const res = await signedPost();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, slug: SLUG, version: FIXED_NOW_MS });
    expect(h.filters).toEqual([{ column: "slug", value: SLUG }]);
    expect(h.updated).toHaveLength(1);
  });

  it("podpis NAD SAMYM SLUGIEM podany razem ze znacznikiem czasu NIE przechodzi", async () => {
    // Dokładnie ten podpis krążył dotąd w konfiguracji integracji. Gdyby
    // przechodził w nowej gałęzi, znacznik czasu byłby ozdobą.
    const res = await post({
      "x-og-timestamp": String(nowTs()),
      "x-og-signature": sign(SLUG),
    });

    expect(res.status).toBe(401);
    expect(h.updated).toHaveLength(0);
  });

  it("podpis dla INNEGO sluga nie otwiera cudzego profilu", async () => {
    const ts = nowTs();

    const res = await post(
      { "x-og-timestamp": String(ts), "x-og-signature": sign(`${ts}.ktos-inny`) },
      SLUG,
    );

    expect(res.status).toBe(401);
  });

  it("podpis PRZETERMINOWANY (poza oknem tolerancji) kończy się 401", async () => {
    const res = await signedPost({ ts: nowTs() - WEBHOOK_TOLERANCE_SECONDS - 1 });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Expired signature" });
    expect(h.updated).toHaveLength(0);
  });

  it("podpis z PRZYSZŁOŚCI poza oknem też jest odrzucany - okno działa w obie strony", async () => {
    const res = await signedPost({ ts: nowTs() + WEBHOOK_TOLERANCE_SECONDS + 1 });

    expect(res.status).toBe(401);
  });

  it("znacznik czasu w oknie (na jego krawędzi) jest jeszcze akceptowany", async () => {
    const res = await signedPost({ ts: nowTs() - WEBHOOK_TOLERANCE_SECONDS });

    expect(res.status).toBe(200);
  });

  it("znacznik czasu niebędący liczbą kończy się 401, a nie NaN-em w podpisie", async () => {
    const res = await post({
      "x-og-timestamp": "wczoraj",
      "x-og-signature": sign(`wczoraj.${SLUG}`),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid timestamp" });
  });

  it('brak nagłówka z podpisem kończy się 401 - pusty podpis nie porównuje się „równo"', async () => {
    const res = await post({ "x-og-timestamp": String(nowTs()) });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe("faza 1 wdrożenia: stary kontrakt podpisu", () => {
  it("podpis nad samym slugiem (bez `x-og-timestamp`) PRZECHODZI, ale zostawia ostrzeżenie", async () => {
    // Zewnętrzni wołający (CI, cron, integracje) podpisują dziś sam slug.
    // Zerwanie tego kontraktu bez okna przejściowego zatrzymałoby odświeżanie
    // og:image CICHO - objaw pojawiłby się tygodnie później, starą miniaturą.
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await post({ "x-og-signature": sign(SLUG) });

    expect(res.status).toBe(200);
    expect(warned).toHaveBeenCalledWith("[og-refresh] legacy signature", SLUG);
    warned.mockRestore();
  });

  it("BŁĘDNY stary podpis nadal kończy się 401 - gałąź zgodności nie jest furtką", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await post({ "x-og-signature": sign("zupelnie-co-innego") });

    expect(res.status).toBe(401);
    expect(warned).not.toHaveBeenCalled();
    warned.mockRestore();
  });
});

// ---------------------------------------------------------------------------
describe("limit powtórzeń i odporność", () => {
  it("limit jest per SLUG, fail-closed, 10/h - i biegnie dopiero po weryfikacji podpisu", async () => {
    await signedPost();

    expect(h.rateLimit).toHaveBeenCalledWith({
      scope: "og-refresh",
      subjectId: SLUG,
      max: 10,
      windowMinutes: 60,
      failClosed: true,
    });
  });

  it("przekroczony limit kończy się 429 i NIE dotyka profilu", async () => {
    h.rateLimit.mockResolvedValue(false);

    const res = await signedPost();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    expect(h.updated).toHaveLength(0);
  });

  it("nieznany slug kończy się 404", async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await signedPost();

    expect(res.status).toBe(404);
  });

  it("500 NIE oddaje komunikatu Postgresa - pełna treść idzie do logu workera", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    h.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for column "updated_at" of relation "profiles"' },
    });

    const res = await signedPost();
    const payload = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(payload).toEqual({ error: "update_failed" });
    expect(logged).toHaveBeenCalledWith(
      "[og-refresh] update failed",
      expect.stringContaining("profiles"),
    );
    logged.mockRestore();
  });
});
