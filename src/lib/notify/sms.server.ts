// Wysyłka SMS - jedno wyjście z systemu, świadomie wąskie.
//
// PO CO W OGÓLE SMS. Powiadomienie o statusie rejestracji na wydarzenie bywa
// czasowo krytyczne: awans z listy rezerwowej dzień przed wydarzeniem albo
// anulowanie po zwrocie środków muszą dotrzeć nawet wtedy, gdy uczestnik nie
// zagląda do skrzynki. Mail zostaje kanałem podstawowym (nosi szczegóły
// i dokument), SMS jest krótkim sygnałem „sprawdź pocztę".
//
// KANAŁ JEST OPCJONALNY I FAIL-SOFT. Bez skonfigurowanego dostawcy funkcja
// zwraca `disabled` i NIE rzuca - webhook płatności nie może się wywrócić przez
// bramkę SMS. Ta sama zasada, co przy mailu: uprawnienie ma priorytet nad
// powiadomieniem.
//
// Moduł server-only (token dostawcy) - importuj wyłącznie z handlerów.

export type SmsResult =
  | { ok: true; skipped?: "disabled" | "no_recipient" | "duplicate" }
  | { ok: false; error: string };

/** Limit jednego segmentu GSM-7 z zapasem na stopkę dostawcy. */
const MAX_LENGTH = 300;

/** Kubełek licznika, w którym mieszkają klucze idempotencji SMS-a. */
const IDEMPOTENCY_SCOPE = "sms_once";

/**
 * Okno bramki powtórzeń - 3 doby, bo tyle mniej więcej ponawia webhooka
 * operator płatności, a to on jest źródłem duplikatów.
 */
const IDEMPOTENCY_WINDOW_MINUTES = 3 * 24 * 60;

/**
 * Normalizuje numer do E.164. Numer bez prefiksu kraju traktujemy jako polski
 * (baza uczestników jest głównie krajowa), bo wysyłka na numer bez kierunkowego
 * i tak zostałaby odrzucona przez dostawcę.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const value = (raw ?? "").replace(/[\s()-]/g, "");
  if (value === "") return null;
  if (/^\+[1-9]\d{7,14}$/.test(value)) return value;
  if (/^00[1-9]\d{7,14}$/.test(value)) return `+${value.slice(2)}`;
  if (/^\d{9}$/.test(value)) return `+48${value}`;
  return null;
}

/** Skraca treść do jednego rozsądnego SMS-a bez ucinania w połowie słowa. */
export function trimSmsBody(body: string): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (text.length <= MAX_LENGTH) return text;
  const cut = text.slice(0, MAX_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export interface SmsInput {
  to: string | null | undefined;
  body: string;
  /**
   * Klucz idempotencji - ten sam klucz nie wyśle SMS-a dwa razy. Pole jest
   * OPCJONALNE, żeby nie zmieniać kontraktu wołającym, którzy nadają
   * z ludzkiego kliknięcia: bez klucza brama zachowuje się dokładnie jak dotąd.
   */
  idempotencyKey?: string;
}

/**
 * Bramka powtórzeń. Poczta ma na to `email_send_log` (`sendTxEmail` liczy
 * wpisy po `message_id`); SMS nie ma ŻADNEGO dziennika, więc rolę pamięci
 * pełni licznik `rate_limits` z limitem 1 - `rate_limit_hit` robi
 * INSERT ... ON CONFLICT DO UPDATE RETURNING, czyli rozstrzyga wyścig dwóch
 * dostarczeń tego samego webhooka w jednym zapytaniu.
 *
 * ZNANA SZCZELINA: okno licznika jest kubełkiem stałej długości, więc
 * ponowienie, które przekroczy jego granicę, przejdzie. Przechyla to bramkę
 * w stronę wysłania, nie wyciszenia - tak samo jak fail-open niżej, bo awaria
 * licznika nie może zabrać uczestnikowi wiadomości o pieniądzach.
 */
async function alreadySent(key: string): Promise<boolean> {
  try {
    const { rateLimit } = await import("@/lib/server/rate-limit.server");
    const allowed = await rateLimit({
      scope: IDEMPOTENCY_SCOPE,
      subjectId: key,
      max: 1,
      windowMinutes: IDEMPOTENCY_WINDOW_MINUTES,
    });
    return !allowed;
  } catch (err) {
    console.error("[sms] idempotency gate failed", err);
    return false;
  }
}

/**
 * Wysyła SMS przez SMSAPI (REST). Dostawca jest wymienny: cała wiedza o nim
 * mieszka w tej jednej funkcji, reszta systemu widzi `sendSms`.
 */
export async function sendSms(input: SmsInput): Promise<SmsResult> {
  const token = process.env["SMSAPI_TOKEN"];
  const sender = process.env["SMSAPI_SENDER"];
  if (!token) return { ok: true, skipped: "disabled" };

  const to = normalizePhone(input.to);
  if (!to) return { ok: true, skipped: "no_recipient" };

  // Bramka stoi PO sprawdzeniu dostawcy i numeru: klucz ma się zużywać
  // dopiero wtedy, gdy wiadomość naprawdę ma dokąd pójść.
  if (input.idempotencyKey && (await alreadySent(input.idempotencyKey))) {
    return { ok: true, skipped: "duplicate" };
  }

  const params = new URLSearchParams({
    to: to.replace("+", ""),
    message: trimSmsBody(input.body),
    format: "json",
    encoding: "utf-8",
  });
  if (sender) params.set("from", sender);

  try {
    const response = await fetch("https://api.smsapi.pl/sms.do", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!response.ok) {
      return { ok: false, error: `sms_http_${response.status}` };
    }
    const payload = (await response.json()) as { error?: unknown; message?: unknown };
    if (payload.error) {
      return { ok: false, error: `sms_provider_${String(payload.error)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
