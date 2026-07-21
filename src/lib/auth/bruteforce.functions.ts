// Server-side brute-force guards for password login, password reset, and the
// content paywall. Called from the client BEFORE Supabase Auth (login/reset)
// or via a server-fn wrapper (paywall). All buckets are atomic (INSERT ...
// ON CONFLICT DO UPDATE RETURNING) and fail-CLOSED - a DB blip must not
// remove the cap on credential guessing.
//
// IP is derived from the trusted forwarded headers (Lovable edge proxy sets
// them); an sha256 keyed with SESSION_SECRET is stored so raw IPs never land
// in rate_limits. Email is normalised (lowercase + trim) then hashed the same
// way so a leaked rate_limits row cannot enumerate accounts by email.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { clientIpFromHeaders } from "@/lib/http/rateLimit";

const SALT = () =>
  process.env.SESSION_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "brute-force-fallback-salt";

function hashSubject(kind: string, raw: string): string {
  return `${kind}:${createHash("sha256").update(`${SALT()}|${kind}|${raw}`).digest("hex").slice(0, 32)}`;
}

function currentIpHash(): string | null {
  try {
    const req = getRequest();
    const headers = req?.headers;
    if (!headers) return null;
    const ip = clientIpFromHeaders(headers);
    if (!ip || ip === "unknown") return null;
    return hashSubject("ip", ip);
  } catch {
    return null;
  }
}

interface HitOptions {
  scope: string;
  subject: string;
  max: number;
  windowMinutes: number;
}

async function hitBucket(opts: HitOptions): Promise<{ allowed: boolean; hits: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("rate_limit_hit", {
    _scope: opts.scope,
    _subject: opts.subject,
    _max: opts.max,
    _window_minutes: opts.windowMinutes,
  });
  if (error) {
    // Fail-CLOSED: brute-force protection must not disappear during a DB blip.
    console.warn(`[bruteforce] ${opts.scope} failed:`, error.message);
    return { allowed: false, hits: opts.max + 1 };
  }
  const row = Array.isArray(data) ? data[0] : (data as { allowed?: boolean; hits?: number } | null);
  return {
    allowed: row?.allowed === true,
    hits: typeof row?.hits === "number" ? row.hits : 0,
  };
}

// -----------------------------------------------------------------------------
// Pre-auth guard: called by login/signup/reset forms BEFORE Supabase Auth.
// Two atomic buckets per attempt:
//   * per IP  - stops one attacker cycling emails.
//   * per email - stops a distributed attack focused on one account.
// Buckets are hashed subjects; return value is generic ("ok") so no
// enumeration signal leaks even if a caller inspects the response.
// -----------------------------------------------------------------------------
// Akceptujemy również "signin" jako alias "login" - część UI (LoginPopup,
// /login) używa tej nazwy dla trybu logowania. Preprocess mapuje wartość
// przed walidacją enum, żeby jedno źródło prawdy było po stronie serwera.
const preAuthSchema = z.object({
  kind: z.preprocess((v) => (v === "signin" ? "login" : v), z.enum(["login", "reset", "signup"])),
  email: z.string().trim().toLowerCase().email().max(254),
});

export const preAuthGuard = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => preAuthSchema.parse(raw))
  .handler(async ({ data }) => {
    const ipHash = currentIpHash();
    const emailSubject = hashSubject(`email:${data.kind}`, data.email);

    // login is the most sensitive - stricter caps than reset/signup.
    const perIp = data.kind === "login" ? { max: 15, window: 5 } : { max: 10, window: 15 };
    const perEmail = data.kind === "login" ? { max: 8, window: 15 } : { max: 5, window: 30 };

    if (ipHash) {
      const ip = await hitBucket({
        scope: `auth_${data.kind}_ip`,
        subject: ipHash,
        max: perIp.max,
        windowMinutes: perIp.window,
      });
      if (!ip.allowed) {
        throw new Error("auth: rate_limited");
      }
    }

    const email = await hitBucket({
      scope: `auth_${data.kind}_email`,
      subject: emailSubject,
      max: perEmail.max,
      windowMinutes: perEmail.window,
    });
    if (!email.allowed) {
      throw new Error("auth: rate_limited");
    }

    return { ok: true as const };
  });

// -----------------------------------------------------------------------------
// Paywall unlock wrapper: extracts IP server-side (browser cannot be trusted
// to send it) and passes the hash to verify_content_password, which enforces
// per-entity (10/min) AND per-IP (20/5min) caps atomically.
// -----------------------------------------------------------------------------
const unlockSchema = z.object({
  entityType: z.enum(["post", "page"]),
  entityId: z.string().uuid(),
  password: z.string().min(1).max(200),
});

export const unlockContentPassword = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => unlockSchema.parse(raw))
  .handler(async ({ data }) => {
    const ipHash = currentIpHash();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("verify_content_password", {
      _entity_type: data.entityType,
      _entity_id: data.entityId,
      _password: data.password,
      _ip_hash: ipHash ?? undefined,
    });
    if (error) {
      const msg = error.message?.includes("too many attempts")
        ? "content_password: rate_limited"
        : "content_password: failed";
      throw new Error(msg);
    }
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.ok !== true) {
      return {
        ok: false as const,
        content_pl: null,
        content_en: null,
        builder_data: null,
        blocks_data: null,
      };
    }
    return {
      ok: true as const,
      content_pl: (row.content_pl as string | null) ?? null,
      content_en: (row.content_en as string | null) ?? null,
      builder_data: (row.builder_data as unknown) ?? null,
      blocks_data: (row.blocks_data as unknown) ?? null,
    };
  });
