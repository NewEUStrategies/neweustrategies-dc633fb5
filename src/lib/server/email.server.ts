// Wspólny nadawca e-maili przez bramkę Resend konektora Lovable.
//
// Historycznie ta funkcja żyła w trzech kopiach (newsletter.functions,
// newsletter-campaigns.functions, contact.functions) - ten moduł jest
// docelowym, współdzielonym wariantem; nowy kod (digest powiadomień) używa
// wyłącznie jego. Env: LOVABLE_API_KEY + RESEND_API_KEY (bez nich zwraca
// email_not_configured zamiast rzucać).
const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string | null;
  headers?: Record<string, string>;
}

export type SendEmailResult = { ok: true } | { ok: false; status?: number; error: string };

export async function sendTransactionalEmail(opts: SendEmailInput): Promise<SendEmailResult> {
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
        reply_to: opts.replyTo || undefined,
        headers: opts.headers && Object.keys(opts.headers).length ? opts.headers : undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: body.slice(0, 500) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 500) };
  }
}
