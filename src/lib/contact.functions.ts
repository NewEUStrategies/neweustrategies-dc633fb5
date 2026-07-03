// Server function: persists contact-form submission, sends auto-reply +
// admin notification, and (when newsletterOptIn) starts a double opt-in flow
// for the newsletter subscriber. Emails are sent through the Resend connector
// gateway. If Resend or LOVABLE_API_KEY are missing, email steps degrade
// silently - the message is still stored so the form never breaks.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

// SECURITY: `recipient` is intentionally NOT part of the public input.
// The admin notification address must come from the trusted server-side
// contact_form_settings.default_recipient - never from user input - otherwise
// this endpoint can be abused as an open email relay.
const ContactInput = z.object({
  name: z.string().trim().min(1).max(200),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(40).optional(),
  company: z.string().trim().max(200).optional(),
  subject: z.string().trim().max(300).optional(),
  message: z.string().trim().min(1).max(8000),
  consent: z.boolean(),
  newsletterOptIn: z.boolean().optional(),
  lang: z.enum(["pl", "en"]),
  source: z.string().trim().max(500).optional(),
});

type ContactPayload = z.infer<typeof ContactInput>;

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const DOI_TTL_MS = 1000 * 60 * 60 * 48; // 48h

async function sendEmail(opts: {
  to: string; subject: string; html: string; from?: string;
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
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
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
      console.error("[contact] resend error", res.status, body.slice(0, 500));
      return { ok: false, status: res.status, error: body.slice(0, 500) };
    }
    return { ok: true };
  } catch (err) {
    console.error("[contact] email send failed", err);
    return { ok: false, error: String(err) };
  }
}

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] ?? c));
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

function hexToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function buildAutoReply(p: ContactPayload, settings: Record<string, unknown> | null): { subject: string; html: string } {
  const lang = p.lang;
  const subject = String(settings?.[`auto_reply_subject_${lang}`] ??
    (lang === "pl" ? "Dziękujemy za wiadomość" : "Thanks for reaching out"));
  const body = String(settings?.[`auto_reply_body_${lang}`] ?? (lang === "pl"
    ? "Dziękujemy za kontakt - odpowiemy najszybciej jak to możliwe."
    : "Thanks for reaching out - we will reply as soon as possible."));
  const hi = lang === "pl" ? `Cześć ${esc(p.name)},` : `Hi ${esc(p.name)},`;
  const yourMsg = lang === "pl" ? "Twoja wiadomość" : "Your message";
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;max-width:560px">
      <p>${hi}</p>
      <p>${esc(body)}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
      <p style="color:#666;font-size:13px">${yourMsg}:</p>
      <blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #ccc;color:#444;font-size:13px;white-space:pre-wrap">${esc(p.message)}</blockquote>
    </div>`;
  return { subject, html };
}

function buildAdminNotice(p: ContactPayload): { subject: string; html: string } {
  const subject = `[Contact] ${p.subject || (p.lang === "pl" ? "Nowa wiadomość" : "New message")}`;
  const rows: Array<[string, string]> = [
    ["Name", p.name], ["Email", p.email],
    ...(p.phone ? [["Phone", p.phone] as [string, string]] : []),
    ...(p.company ? [["Company", p.company] as [string, string]] : []),
    ...(p.subject ? [["Subject", p.subject] as [string, string]] : []),
    ...(p.source ? [["Page", p.source] as [string, string]] : []),
    ["Lang", p.lang],
    ["Consent", p.consent ? "yes" : "no"],
    ...(p.newsletterOptIn ? [["Newsletter opt-in", "yes"] as [string, string]] : []),
  ];
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;max-width:640px">
      <h2 style="margin:0 0 12px">${esc(subject)}</h2>
      <table style="border-collapse:collapse;font-size:14px">
        ${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("")}
      </table>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
      <pre style="white-space:pre-wrap;font-family:inherit;font-size:14px">${esc(p.message)}</pre>
    </div>`;
  return { subject, html };
}

function buildDoiEmail(p: ContactPayload, confirmUrl: string): { subject: string; html: string } {
  const pl = p.lang === "pl";
  const subject = pl
    ? "Potwierdź zapis do newslettera"
    : "Confirm your newsletter subscription";
  const hi = pl ? `Cześć ${esc(p.name)},` : `Hi ${esc(p.name)},`;
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

export const submitContactMessage = createServerFn({ method: "POST" })
  .inputValidator((data) => ContactInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inserted, error } = await supabaseAdmin
      .from("contact_messages")
      .insert({
        name: data.name,
        email: data.email,
        phone: data.phone ?? null,
        company: data.company ?? null,
        subject: data.subject ?? null,
        message: data.message,
        consent: data.consent,
        lang: data.lang,
        recipient: null,
        newsletter_opt_in: data.newsletterOptIn ?? false,
        source: data.source ?? null,
        status: "new",
      })
      .select("id, tenant_id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "insert failed");

    const { data: cfs } = await supabaseAdmin
      .from("contact_form_settings")
      .select("*")
      .eq("tenant_id", inserted.tenant_id)
      .maybeSingle();
    const settings = cfs as Record<string, unknown> | null;

    const fromAddress = settings?.from_address && settings?.from_name
      ? `${settings.from_name as string} <${settings.from_address as string}>`
      : (settings?.from_address as string | undefined);

    // 1) Auto-reply to sender
    let autoReplyResult: { ok: boolean; error?: string } = { ok: false, error: "skipped" };
    if (settings?.auto_reply_enabled !== false) {
      const reply = buildAutoReply(data, settings);
      autoReplyResult = await sendEmail({
        to: data.email, subject: reply.subject, html: reply.html, from: fromAddress,
      });
    }

    // 2) Admin notification
    const adminTo = ((settings?.default_recipient as string | null) || null);
    let adminResult: { ok: boolean; error?: string } = { ok: false, error: "no_recipient" };
    if (settings?.notify_admin_enabled !== false && adminTo) {
      const notice = buildAdminNotice(data);
      adminResult = await sendEmail({
        to: adminTo, subject: notice.subject, html: notice.html, from: fromAddress,
      });
    }

    if (autoReplyResult.ok || adminResult.ok) {
      await supabaseAdmin
        .from("contact_messages")
        .update({ confirmation_sent_at: new Date().toISOString() })
        .eq("id", inserted.id);
    }

    // 3) Newsletter opt-in with double opt-in
    let doiResult: { ok: boolean; status?: "pending" | "subscribed" | "exists"; error?: string } | null = null;
    if (data.newsletterOptIn) {
      const { data: nls } = await supabaseAdmin
        .from("newsletter_settings")
        .select("double_opt_in, enabled")
        .eq("tenant_id", inserted.tenant_id)
        .maybeSingle();

      const doiEnabled = (nls?.double_opt_in ?? true) !== false
        && (settings?.newsletter_double_optin ?? true) !== false;

      // Check existing subscriber to avoid resetting an already-confirmed one.
      const { data: existing } = await supabaseAdmin
        .from("newsletter_subscribers")
        .select("id, status")
        .eq("tenant_id", inserted.tenant_id)
        .eq("email", data.email)
        .maybeSingle();

      if (existing?.status === "subscribed") {
        doiResult = { ok: true, status: "exists" };
      } else if (doiEnabled) {
        const token = hexToken(32);
        const expires = new Date(Date.now() + DOI_TTL_MS).toISOString();
        const { error: upErr } = await supabaseAdmin
          .from("newsletter_subscribers")
          .upsert({
            email: data.email,
            display_name: data.name,
            tenant_id: inserted.tenant_id,
            language: data.lang,
            status: "pending",
            source: "contact-form",
            confirmation_token: token,
            confirmation_expires_at: expires,
          }, { onConflict: "tenant_id,email" });

        if (upErr) {
          doiResult = { ok: false, error: upErr.message };
        } else {
          const origin = originFromRequest();
          const confirmUrl = `${origin}/api/public/newsletter/confirm?token=${encodeURIComponent(token)}`;
          const doiMail = buildDoiEmail(data, confirmUrl);
          const send = await sendEmail({
            to: data.email, subject: doiMail.subject, html: doiMail.html, from: fromAddress,
          });
          doiResult = send.ok
            ? { ok: true, status: "pending" }
            : { ok: false, status: "pending", error: send.error };
        }
      } else {
        // Single opt-in path
        const { error: upErr } = await supabaseAdmin
          .from("newsletter_subscribers")
          .upsert({
            email: data.email,
            display_name: data.name,
            tenant_id: inserted.tenant_id,
            language: data.lang,
            status: "subscribed",
            confirmed_at: new Date().toISOString(),
            source: "contact-form",
          }, { onConflict: "tenant_id,email" });
        doiResult = upErr ? { ok: false, error: upErr.message } : { ok: true, status: "subscribed" };
      }
    }

    return {
      ok: true as const,
      id: inserted.id,
      emails: {
        autoReply: autoReplyResult.ok,
        admin: adminResult.ok,
        newsletter: doiResult,
      },
    };
  });
