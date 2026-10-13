// Wysyłka SMS - transport do operatora, świadomie wąski.
//
// PO CO W OGÓLE SMS. Powiadomienie o statusie rejestracji na wydarzenie bywa
// czasowo krytyczne: awans z listy rezerwowej dzień przed wydarzeniem albo
// anulowanie po zwrocie środków muszą dotrzeć nawet wtedy, gdy uczestnik nie
// zagląda do skrzynki. Mail zostaje kanałem podstawowym (nosi szczegóły
// i dokument), SMS jest krótkim sygnałem „sprawdź pocztę".
//
// JEDYNE WYJŚCIE TO `sendParticipantSms` (REG-10). Ten moduł zna wyłącznie
// operatora i dziennik idempotencji; wyłącznik platformy, zgodę uczestnika,
// GSM-7 i budżet najemcy sprawdza `@/lib/events/participantNotify.server`,
// który jako JEDYNY importuje `sendSms` (bramka
// `src/lib/notify/__tests__/smsSingleExit.gate.test.ts`). Inni wołający biorą
// stąd najwyżej `normalizePhone`, `trimSmsBody` i typy.
//
// KANAŁ JEST OPCJONALNY I FAIL-SOFT. Bez skonfigurowanego dostawcy funkcja
// zwraca `disabled` i NIE rzuca - webhook płatności nie może się wywrócić przez
// bramkę SMS. Ta sama zasada, co przy mailu: uprawnienie ma priorytet nad
// powiadomieniem.
//
// Moduł server-only (token dostawcy, klient service_role) - importuj
// wyłącznie z handlerów.

export type SmsResult =
  | { ok: true; skipped?: "disabled" | "no_recipient" | "duplicate" | "in_flight" }
  | { ok: false; error: string };

/** Limit jednego segmentu GSM-7 z zapasem na stopkę dostawcy. */
const MAX_LENGTH = 300;

/** Sufit kodu błędu w dzienniku (CHECK `sms_send_log_detail_len`). */
const DETAIL_MAX = 200;

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

/**
 * Wejście transportu. Klucz idempotencji idzie ZAWSZE w parze z najemcą -
 * dziennik `sms_send_log` jest per najemca, a klucz bez najemcy nie miałby
 * gdzie zamieszkać. SMS bez klucza (ludzkie kliknięcie) idzie bez dziennika.
 */
export type SmsInput = { to: string | null | undefined; body: string } & (
  | { idempotencyKey?: undefined; tenantId?: undefined }
  | { idempotencyKey: string; tenantId: string }
);

/** Rezerwacja klucza w dzienniku albo decyzja „nie wysyłaj". */
type ClaimOutcome = { kind: "send"; claimId: string | null } | { kind: "stop"; result: SmsResult };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Rezerwacja klucza przed wysyłką (`sms_send_claim`, REG-11). Klucz NIE jest
 * już zużywany przed operatorem: „wysłane" zapisuje dopiero `finishClaim` po
 * przyjęciu wiadomości, a błąd operatora zwalnia klucz do ponowienia.
 *
 * FAIL-OPEN przy awarii dziennika (błąd RPC, rzut, baza bez migracji):
 * cisza po nieudanej płatności jest gorsza niż SMS wysłany drugi raz przy
 * awarii bazy. Ścieżkę przypomnień i tak trzyma budżet najemcy (fail-closed)
 * i dziennik doręczeń.
 */
async function claimKey(tenantId: string, key: string): Promise<ClaimOutcome> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("sms_send_claim", {
      p_tenant_id: tenantId,
      p_idempotency_key: key,
    });
    if (error) {
      console.error("[sms] idempotency gate failed", { code: error.code, message: error.message });
      return { kind: "send", claimId: null };
    }
    const row =
      typeof data === "object" && data !== null && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    const state = row["state"];
    const claimId = row["claim_id"];
    if (state === "claimed" && typeof claimId === "string" && claimId !== "") {
      return { kind: "send", claimId };
    }
    // `duplicate` mówi prawdę: dziennik ma ten klucz jako PRZYJĘTY przez operatora.
    if (state === "sent") return { kind: "stop", result: { ok: true, skipped: "duplicate" } };
    // Inny proces wysyła ten sam SMS teraz - nie dublujemy, wołający ponowi.
    if (state === "in_flight") return { kind: "stop", result: { ok: true, skipped: "in_flight" } };
    if (state === "exhausted") {
      return { kind: "stop", result: { ok: false, error: "sms_retry_exhausted" } };
    }
    console.error("[sms] idempotency gate failed", { state: String(state) });
    return { kind: "send", claimId: null };
  } catch (err) {
    console.error("[sms] idempotency gate failed", { error: errorText(err) });
    return { kind: "send", claimId: null };
  }
}

/** Zamknięcie rezerwacji wynikiem operatora. Nigdy nie rzuca. */
async function finishClaim(tenantId: string, claimId: string, result: SmsResult): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const args: { p_tenant_id: string; p_claim_id: string; p_status: string; p_detail?: string } = {
      p_tenant_id: tenantId,
      p_claim_id: claimId,
      p_status: result.ok ? "sent" : "failed",
    };
    if (!result.ok) args.p_detail = result.error.slice(0, DETAIL_MAX);
    const { error } = await supabaseAdmin.rpc("sms_send_finish", args);
    if (error) {
      console.error("[sms] idempotency finish failed", {
        code: error.code,
        message: error.message,
      });
    }
  } catch (err) {
    console.error("[sms] idempotency finish failed", { error: errorText(err) });
  }
}

/** Jedno wywołanie operatora (SMSAPI, REST). Nigdy nie rzuca. */
async function deliver(token: string, to: string, body: string): Promise<SmsResult> {
  const sender = process.env["SMSAPI_SENDER"];
  const params = new URLSearchParams({
    to: to.replace("+", ""),
    message: trimSmsBody(body),
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
    return { ok: false, error: errorText(err) };
  }
}

/**
 * Wysyła SMS przez SMSAPI. Dostawca jest wymienny: cała wiedza o nim mieszka
 * w tym module, reszta systemu widzi `sendParticipantSms`.
 *
 * Kolejność: dostawca -> numer -> rezerwacja klucza -> operator -> zamknięcie
 * rezerwacji. Dziennik pytamy dopiero wtedy, gdy wiadomość naprawdę ma dokąd
 * pójść - wyłączony kanał i zły numer nie zostawiają wpisów.
 */
export async function sendSms(input: SmsInput): Promise<SmsResult> {
  const token = process.env["SMSAPI_TOKEN"];
  if (!token) return { ok: true, skipped: "disabled" };

  const to = normalizePhone(input.to);
  if (!to) return { ok: true, skipped: "no_recipient" };

  let claimId: string | null = null;
  if (input.idempotencyKey !== undefined) {
    const claim = await claimKey(input.tenantId, input.idempotencyKey);
    if (claim.kind === "stop") return claim.result;
    claimId = claim.claimId;
  }

  const result = await deliver(token, to, input.body);
  if (claimId !== null && input.tenantId !== undefined) {
    await finishClaim(input.tenantId, claimId, result);
  }
  return result;
}
