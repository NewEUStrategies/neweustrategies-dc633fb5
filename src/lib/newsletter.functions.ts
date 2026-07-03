// Server-side newsletter subscription with double opt-in (DOI).
//
// Why server-side: the public signup forms must NOT mint the confirmation token
// or write the subscriber row themselves. A client-known token lets anyone call
// the public confirm endpoint and flip an arbitrary address to "subscribed"
// without proving control of the mailbox (consent forgery). This function mints
// the token server-side, upserts the pending subscriber via service_role and
// sends the confirm e-mail through the Resend connector gateway - mirroring the
// contact-form DOI flow (contact.functions.ts). Email steps degrade silently
// when Resend / LOVABLE_API_KEY are missing, but the pending row is still
// written so the address can be confirmed once mail is configured.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const DOI_TTL_MS = 1000 * 60 * 60 * 48; // 48h

const NewsletterInput = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().max(160).optional(),
  language: z.enum(["pl", "en"]).default("pl"),
  source: z.string().trim().max(120).optional(),
  // Popup "extended fields" (job, company, linkedin, phone, mailing_list, ...)
  // are persisted verbatim in newsletter_subscribers.meta; keys/values capped.
  meta: z.record(z.string().max(64), z.string().max(500)).optional(),
});

export type NewsletterSubscribeResult =
  | { ok: true; status: "pending" | "subscribed" | "exists"; emailSent?: boolean }
  | { ok: false; error: string };

function esc(v: string): string {
  return v.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function hexToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function originFromRequest(): string {
  try {
    const req = getRequest();
    const url = new URL(req.url);
    const fwdHost = req.headers.get("x-forwarded-host");
    const fwdProto = req.headers.get("x-forwarded-proto");
    return `${fwdProto ?? url.protocol.replace(":", "")}://${fwdHost ?? url.host}`;
  } catch {
    return "";
  }
}

async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<{ ok: boolean; status?: number; error?: string }> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
    return { ok: false, error: "email_not_configured" };
  }
  try {
    const res = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: opts.from || "New European Strategies <onboarding@resend.dev>",
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[newsletter] resend error", res.status, body.slice(0, 500));
      return { ok: false, status: res.status, error: body.slice(0, 500) };
    }
    return { ok: true };
  } catch (err) {
    console.error("[newsletter] email send failed", err);
    return { ok: false, error: String(err) };
  }
}

function buildDoiEmail(
  name: string | null,
  lang: "pl" | "en",
  confirmUrl: string,
): { subject: string; html: string } {
  const pl = lang === "pl";
  const subject = pl ? "Potwierdź zapis do newslettera" : "Confirm your newsletter subscription";
  const hi = name ? (pl ? `Cześć ${esc(name)},` : `Hi ${esc(name)},`) : pl ? "Cześć," : "Hi,";
  const intro = pl
    ? "Dziękujemy za chęć zapisu do naszego newslettera. Aby dokończyć rejestrację, potwierdź swój adres e-mail klikając poniższy przycisk:"
    : "Thanks for signing up to our newsletter. To complete your subscription please confirm your email by clicking the button below:";
  const cta = pl ? "Potwierdź zapis" : "Confirm subscription";
  const note = pl
    ? "Link wygasa za 48 godzin. Jeśli to nie Ty - zignoruj tę wiadomość, nic się nie stanie."
    : "This link expires in 48 hours. If this wasn't you, just ignore this message - nothing will happen.";
  const fallback = pl
    ? "Jeśli przycisk nie działa, skopiuj ten adres do przeglądarki:"
    : "If the button doesn't work, copy this URL into your browser:";
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:560px">
      <p>${hi}</p>
      <p>${intro}</p>
      <p style="margin:24px 0">
        <a href="${esc(confirmUrl)}"
           style="display:inline-block;background:#FA9346;color:#fff;text-decoration:none;
                  padding:12px 22px;border-radius:6px;font-weight:600">${cta}</a>
      </p>
      <p style="color:#555;font-size:13px">${note}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
      <p style="color:#888;font-size:12px">${fallback}<br>
        <span style="word-break:break-all">${esc(confirmUrl)}</span></p>
    </div>`;
  return { subject, html };
}

/**
 * Subscribe an address to the newsletter. Public (no auth): callable from the
 * on-site signup forms. Idempotent - an already-confirmed address returns
 * "exists" without resetting it, and repeat DOI attempts refresh the token and
 * resend the confirm mail. The response never distinguishes "new" from
 * "already knew you" beyond the coarse status, so it does not leak whether an
 * address is on the list.
 */
export const subscribeToNewsletter = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => NewsletterInput.parse(data))
  .handler(async ({ data }): Promise<NewsletterSubscribeResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();

    // Service-role read bypasses RLS, so the settings lookup MUST be pinned to
    // the tenant owning the request host - an unfiltered maybeSingle() breaks
    // the moment a second tenant configures its newsletter, and would attribute
    // the signup to whichever tenant's row happened to match.
    const [{ resolveTenantIdForHost }, { currentTenantHost }] = await Promise.all([
      import("@/lib/server/tenant.server"),
      import("@/lib/http/requestHost"),
    ]);
    const hostTenantId = await resolveTenantIdForHost(await currentTenantHost());
    if (!hostTenantId) return { ok: false, error: "not_configured" };

    const { data: settings } = await supabaseAdmin
      .from("newsletter_settings")
      .select("tenant_id, enabled, double_opt_in")
      .eq("tenant_id", hostTenantId)
      .maybeSingle();
    if (!settings?.tenant_id) return { ok: false, error: "not_configured" };
    if (settings.enabled === false) return { ok: false, error: "disabled" };

    const tenantId = settings.tenant_id;
    const doi = settings.double_opt_in === true;
    const displayName = data.name?.trim() || null;
    const meta = data.meta && Object.keys(data.meta).length ? data.meta : null;

    // Never reset an already-confirmed subscriber.
    const { data: existing } = await supabaseAdmin
      .from("newsletter_subscribers")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("email", email)
      .maybeSingle();
    if (existing?.status === "subscribed") return { ok: true, status: "exists" };

    // `meta` is spread in only when present so a later signup (e.g. a plain form
    // over a popup entry) never clobbers previously captured fields with null.
    const base = {
      tenant_id: tenantId,
      email,
      display_name: displayName,
      language: data.language,
      source: data.source ?? "newsletter-form",
      ...(meta ? { meta } : {}),
    };

    if (!doi) {
      const { error } = await supabaseAdmin.from("newsletter_subscribers").upsert(
        {
          ...base,
          status: "subscribed",
          confirmed_at: new Date().toISOString(),
          confirmation_token: null,
          confirmation_expires_at: null,
        },
        { onConflict: "tenant_id,email" },
      );
      if (error) return { ok: false, error: error.message };
      return { ok: true, status: "subscribed" };
    }

    const token = hexToken(32);
    const { error } = await supabaseAdmin.from("newsletter_subscribers").upsert(
      {
        ...base,
        status: "pending",
        confirmed_at: null,
        confirmation_token: token,
        confirmation_expires_at: new Date(Date.now() + DOI_TTL_MS).toISOString(),
      },
      { onConflict: "tenant_id,email" },
    );
    if (error) return { ok: false, error: error.message };

    const confirmUrl = `${originFromRequest()}/api/public/newsletter/confirm?token=${encodeURIComponent(token)}`;
    const mail = buildDoiEmail(displayName, data.language, confirmUrl);
    const send = await sendEmail({ to: email, subject: mail.subject, html: mail.html });
    return { ok: true, status: "pending", emailSent: send.ok };
  });
