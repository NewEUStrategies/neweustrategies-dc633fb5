// JEDNA droga wyjścia poczty z platformy.
//
// PRZYCZYNA ŹRÓDŁOWA. Repozytorium miało dwie niezależne implementacje wysyłki:
// kampanie strzelały do gatewaya Resend (i odczytywały `id` wiadomości, bez
// którego webhook odbicia nie ma jak trafić do odbiorcy), a procesor kolejki
// wołał `sendLovableEmail` (bez identyfikatora wiadomości, więc odbicia poczty
// transakcyjnej nie korelowały się z niczym). Dwie ścieżki to dwa zestawy
// nagłówków, dwa formaty błędów i dwie klasyfikacje 429 - a przy takim
// rozjeździe pętla zwrotna dostarczalności zamyka się tylko dla połowy poczty.
//
// Ten moduł jest tą jedną drogą: kampanie i dren kolejki wołają `sendEmail`,
// dostają identyczny kształt wyniku (łącznie z `messageId` do korelacji
// webhooków i `retryAfterSeconds` do wspólnego cooldownu) i nie wiedzą, który
// dostawca faktycznie odebrał wiadomość.
//
// Kolejność dostawców: gateway Resend jest PIERWSZY, bo zwraca identyfikator
// wiadomości. `sendLovableEmail` zostaje jako zapas dla środowisk, w których
// nie ma klucza Resend - wtedy poczta nadal wychodzi, tylko bez korelacji.

/** Adres gatewaya connectora Resend (ten sam, którym wysyłają kampanie). */
const RESEND_GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string | null;
  /** Adres wypisu -> nagłówki RFC 8058 (List-Unsubscribe + One-Click). */
  listUnsubscribeUrl?: string | null;
  /** Tagi dostawcy - korelacja zdarzeń webhooka z tenantem/kampanią/odbiorcą. */
  tags?: Record<string, string>;
  /** Etykieta w logu dostarczalności (np. "digest_daily"). */
  label?: string;
  /** Klucz idempotencji dostawcy (kolejka pocztowa). */
  idempotencyKey?: string;
  /** Zweryfikowana subdomena nadawcza (wymagana przez zapasowego dostawcę). */
  senderDomain?: string;
  /** Identyfikator korelacyjny przebiegu (kolejka pocztowa). */
  runId?: string;
  /** Nasz identyfikator wiadomości (klucz idempotencji w email_send_log). */
  messageId?: string;
  /** Token wypisu przekazywany zapasowemu dostawcy. */
  unsubscribeToken?: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** Identyfikator wiadomości u dostawcy - klucz korelacji webhooków. */
  messageId?: string | null;
  status?: number;
  error?: string;
  /**
   * Dostawca odmówił z powodu limitu tempa - wywołujący ma wstrzymać CAŁĄ
   * wysyłkę, nie tylko tę wiadomość.
   */
  rateLimited?: boolean;
  retryAfterSeconds?: number | null;
  /**
   * Odmowa trwała (403, odrzucony adres, nieprawidłowa konfiguracja nadawcy):
   * ponawianie nic nie zmieni, wiadomość idzie prosto do DLQ.
   */
  permanent?: boolean;
  /** Który dostawca obsłużył wysyłkę - do diagnostyki w logu. */
  provider?: "resend" | "lovable" | "none";
}

function resendConfigured(): boolean {
  return Boolean(process.env.LOVABLE_API_KEY && process.env.RESEND_API_KEY);
}

function lovableConfigured(): boolean {
  return Boolean(process.env.LOVABLE_API_KEY);
}

/** Czy w tym środowisku istnieje jakikolwiek skonfigurowany dostawca poczty. */
export function emailProviderConfigured(): boolean {
  return resendConfigured() || lovableConfigured();
}

function retryAfterFromHeaders(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  // Retry-After bywa datą HTTP, nie liczbą sekund.
  const at = Date.parse(raw);
  if (Number.isFinite(at)) {
    const delta = Math.ceil((at - Date.now()) / 1000);
    return delta > 0 ? delta : null;
  }
  return null;
}

async function readMessageId(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null) {
      const id = (body as Record<string, unknown>).id;
      if (typeof id === "string" && id.trim()) return id.trim();
    }
  } catch {
    // Gateway może zwrócić pustą odpowiedź - wysyłka i tak się powiodła.
  }
  return null;
}

function extraHeaders(input: SendEmailInput): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (input.listUnsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${input.listUnsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return Object.keys(headers).length ? headers : undefined;
}

async function sendViaResend(input: SendEmailInput): Promise<SendEmailResult> {
  const tagList = Object.entries(input.tags ?? {}).map(([name, value]) => ({ name, value }));
  const res = await fetch(`${RESEND_GATEWAY_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": String(process.env.RESEND_API_KEY),
    },
    body: JSON.stringify({
      from: input.from || "New European Strategies <onboarding@resend.dev>",
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text || undefined,
      reply_to: input.replyTo || undefined,
      headers: extraHeaders(input),
      tags: tagList.length ? tagList : undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: body.slice(0, 500) || `http_${res.status}`,
      rateLimited: res.status === 429,
      retryAfterSeconds: retryAfterFromHeaders(res.headers),
      // 4xx poza 429 i 408 to odmowa dotycząca TEJ wiadomości (adres, nadawca,
      // treść) - kolejna próba przyniesie tę samą odpowiedź.
      permanent: res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408,
      provider: "resend",
    };
  }
  return { ok: true, messageId: await readMessageId(res), provider: "resend" };
}

function statusOf(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  if (error instanceof Error) {
    const match = /\b(4\d\d|5\d\d)\b/.exec(error.message);
    if (match) return Number(match[1]);
  }
  return null;
}

function retryAfterOf(error: unknown): number | null {
  if (error && typeof error === "object" && "retryAfterSeconds" in error) {
    const value = (error as { retryAfterSeconds: unknown }).retryAfterSeconds;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

async function sendViaLovable(input: SendEmailInput): Promise<SendEmailResult> {
  try {
    const { sendLovableEmail } = await import("@lovable.dev/email-js");
    await sendLovableEmail(
      {
        run_id: input.runId,
        to: input.to,
        from: input.from,
        sender_domain: input.senderDomain,
        subject: input.subject,
        html: input.html,
        text: input.text,
        purpose: "transactional",
        label: input.label,
        idempotency_key: input.idempotencyKey,
        unsubscribe_token: input.unsubscribeToken,
        message_id: input.messageId,
      },
      { apiKey: String(process.env.LOVABLE_API_KEY), sendUrl: process.env.LOVABLE_SEND_URL },
    );
    // Zapasowy dostawca nie zwraca identyfikatora wiadomości: odbicia dojdą do
    // logu, ale bez korelacji z odbiorcą kampanii.
    return { ok: true, messageId: null, provider: "lovable" };
  } catch (error) {
    const status = statusOf(error);
    return {
      ok: false,
      status: status ?? undefined,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      rateLimited: status === 429,
      retryAfterSeconds: retryAfterOf(error),
      permanent: status === 403 || status === 401 || status === 422,
      provider: "lovable",
    };
  }
}

/**
 * Wysyła jedną wiadomość pierwszym skonfigurowanym dostawcą.
 *
 * Nie loguje i nie zapisuje niczego w bazie - wywołujący (dren kolejki,
 * wysyłka kampanii) wie, gdzie należy zapisać wynik, i robi to spójnie ze
 * swoim modelem ponowień.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!input.to?.trim()) {
    return { ok: false, error: "no_recipient", permanent: true, provider: "none" };
  }
  if (resendConfigured()) {
    try {
      return await sendViaResend(input);
    } catch (err) {
      // Awaria sieci/gatewaya jest przejściowa: nie degradujemy do zapasowego
      // dostawcy, bo ryzyko podwójnej wysyłki jest gorsze od jednej próby
      // mniej. Kolejka spróbuje ponownie, kampania zaloguje błąd odbiorcy.
      return {
        ok: false,
        error: String(err).slice(0, 500),
        provider: "resend",
      };
    }
  }
  if (lovableConfigured()) return sendViaLovable(input);
  return { ok: false, error: "email_not_configured", permanent: true, provider: "none" };
}
