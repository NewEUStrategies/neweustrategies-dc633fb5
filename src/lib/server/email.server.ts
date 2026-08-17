// Wspólny nadawca e-maili przez bramkę Resend konektora platformy.
//
// Historycznie ta funkcja żyła w trzech kopiach (newsletter.functions,
// newsletter-campaigns.functions, contact.functions) - ten moduł jest
// docelowym, współdzielonym wariantem; nowy kod (digest powiadomień) używa
// wyłącznie jego. Env: LOVABLE_API_KEY + RESEND_API_KEY (bez nich zwraca
// email_not_configured zamiast rzucać).
//
// Higiena listy: gdy wołający poda `tenantId`, wysyłka przechodzi przez listę
// wykluczeń (bounce/complaint). Poczta transakcyjna jest zwykle wyłączona spod
// takich blokad, ale TWARDE odbicie i skarga na spam dotyczą skrzynki, nie
// treści - dobijanie się do nich psuje reputację domeny dla WSZYSTKICH
// wysyłek, także tych krytycznych. Blokady czasowe (soft bounce) świadomie
// przepuszczamy: transakcyjna wiadomość jest zwykle ważniejsza niż jedna
// dodatkowa próba dostarczenia.
const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string | null;
  headers?: Record<string, string>;
  /** Tagi dostawcy - korelacja zdarzeń dostarczalności z tenantem. */
  tags?: Record<string, string>;
  /**
   * Tenant odbiorcy. Podany -> wysyłka respektuje trwałe wykluczenia.
   * Pominięty -> wysyłka bez sprawdzenia (ścieżki bez kontekstu tenanta).
   */
  tenantId?: string | null;
}

export type SendEmailResult =
  { ok: true; messageId: string | null } | { ok: false; status?: number; error: string };

/** Czy adres ma TRWAŁĄ blokadę w tym tenancie (best-effort, fail-open). */
async function isPermanentlySuppressed(tenantId: string, email: string): Promise<boolean> {
  try {
    const [{ supabaseAdmin }, { fetchSuppressedEmails }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/email/suppression.server"),
    ]);
    const hits = await fetchSuppressedEmails(supabaseAdmin, tenantId, [email]);
    return hits.get(email.trim().toLowerCase())?.scope === "permanent";
  } catch (err) {
    console.error("[email] suppression check failed", err);
    return false;
  }
}

export async function sendTransactionalEmail(opts: SendEmailInput): Promise<SendEmailResult> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
    return { ok: false, error: "email_not_configured" };
  }
  if (opts.tenantId && (await isPermanentlySuppressed(opts.tenantId, opts.to))) {
    return { ok: false, error: "recipient_suppressed" };
  }
  try {
    const tagList = Object.entries(opts.tags ?? {}).map(([name, value]) => ({ name, value }));
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
        tags: tagList.length ? tagList : undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: body.slice(0, 500) };
    }
    // Identyfikator wiadomości u dostawcy pozwala webhookowi przypisać
    // późniejsze odbicie/skargę do konkretnej wysyłki.
    let messageId: string | null = null;
    try {
      const body: unknown = await res.json();
      if (typeof body === "object" && body !== null) {
        const id = (body as Record<string, unknown>).id;
        if (typeof id === "string" && id.trim()) messageId = id.trim();
      }
    } catch {
      // Pusta/nietypowa odpowiedź gatewaya nie unieważnia wysyłki.
    }
    return { ok: true, messageId };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 500) };
  }
}
