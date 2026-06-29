// Server function: persists contact-form submission and (optionally) sends
// confirmation + admin-notification emails via the Resend connector gateway.
// If no Resend key is configured the message is still stored - the function
// degrades silently so the form never breaks for end users.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ContactInput = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  phone: z.string().max(40).optional(),
  company: z.string().max(200).optional(),
  subject: z.string().max(300).optional(),
  message: z.string().min(1).max(8000),
  consent: z.boolean(),
  newsletterOptIn: z.boolean().optional(),
  lang: z.enum(["pl", "en"]),
  recipient: z.string().email().max(320).optional(),
  source: z.string().max(500).optional(),
});

type ContactPayload = z.infer<typeof ContactInput>;

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

async function sendEmail(opts: {
  to: string; subject: string; html: string; from?: string;
}): Promise<void> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) return; // graceful no-op when not configured
  try {
    await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: opts.from || "Contact <onboarding@resend.dev>",
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
  } catch (err) {
    console.error("[contact] email send failed", err);
  }
}

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] ?? c));
}

async function buildAutoReply(p: ContactPayload, settings: Record<string, unknown> | null): Promise<{ subject: string; html: string }> {
  const lang = p.lang;
  const subject = String(settings?.[`auto_reply_subject_${lang}`] ?? (lang === "pl" ? "Dziękujemy za wiadomość" : "Thanks for reaching out"));
  const body = String(settings?.[`auto_reply_body_${lang}`] ?? (lang === "pl"
    ? "Dziękujemy za kontakt - odpowiemy najszybciej jak to możliwe."
    : "Thanks for reaching out - we will reply as soon as possible."));
  const hi = lang === "pl" ? `Cześć ${esc(p.name)},` : `Hi ${esc(p.name)},`;
  const yourMsg = lang === "pl" ? "Twoja wiadomość" : "Your message";
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
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
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2 style="margin:0 0 12px">${esc(subject)}</h2>
      <table style="border-collapse:collapse;font-size:14px">
        ${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("")}
      </table>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
      <pre style="white-space:pre-wrap;font-family:inherit;font-size:14px">${esc(p.message)}</pre>
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
        recipient: data.recipient ?? null,
        newsletter_opt_in: data.newsletterOptIn ?? false,
        source: data.source ?? null,
        status: "new",
      })
      .select("id, tenant_id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "insert failed");

    // Load tenant contact settings (if any) for templated auto-reply
    const { data: settings } = await supabaseAdmin
      .from("contact_form_settings")
      .select("*")
      .eq("tenant_id", inserted.tenant_id)
      .maybeSingle();

    const fromAddress = settings?.from_address && settings?.from_name
      ? `${settings.from_name} <${settings.from_address}>`
      : (settings?.from_address ?? undefined);

    // Auto-reply to sender
    if (settings?.auto_reply_enabled !== false) {
      const reply = await buildAutoReply(data, settings as Record<string, unknown> | null);
      await sendEmail({ to: data.email, subject: reply.subject, html: reply.html, from: fromAddress });
    }

    // Admin notification
    const adminTo = data.recipient || settings?.default_recipient || null;
    if (settings?.notify_admin_enabled !== false && adminTo) {
      const notice = buildAdminNotice(data);
      await sendEmail({ to: adminTo, subject: notice.subject, html: notice.html, from: fromAddress });
    }

    // Mark confirmation_sent_at when at least one mail was attempted
    if (process.env.RESEND_API_KEY) {
      await supabaseAdmin
        .from("contact_messages")
        .update({ confirmation_sent_at: new Date().toISOString() })
        .eq("id", inserted.id);
    }

    // Newsletter opt-in: enqueue subscriber (double opt-in handled by existing newsletter pipeline)
    if (data.newsletterOptIn) {
      await supabaseAdmin
        .from("newsletter_subscribers")
        .upsert({
          email: data.email,
          display_name: data.name,
          tenant_id: inserted.tenant_id,
          language: data.lang,
          status: "pending",
          source: "contact-form",
        }, { onConflict: "tenant_id,email" });
    }

    return { ok: true as const };
  });
