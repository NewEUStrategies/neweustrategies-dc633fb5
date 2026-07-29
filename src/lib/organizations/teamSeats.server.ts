// Most między subskrypcją planu Zespół (rozliczaną ZA MIEJSCE) a organizacją
// członkowską. Wywoływane wyłącznie z zaufanego serwera (webhook operatora),
// dlatego korzysta z klienta serwisowego i funkcji definera
// `org_apply_subscription_seats`, która sama dopasowuje miejsca do limitu.
//
// Reguła: liczba opłaconych miejsc jest jedynym źródłem prawdy o limicie,
// a stan subskrypcji (aktywna / wstrzymana / anulowana) steruje tym, czy
// organizacja w ogóle nadaje uprawnienia.
import { catalogEntryByPriceId } from "@/lib/billing/paddleCatalog";

export interface SeatsSyncResult {
  linked: boolean;
  orgId?: string;
  seatsLimit?: number;
  active?: number;
  suspended?: number;
}

function readSyncResult(value: unknown): SeatsSyncResult {
  if (!value || typeof value !== "object") return { linked: false };
  const row = value as Record<string, unknown>;
  if (row.linked !== true) return { linked: false };
  return {
    linked: true,
    orgId: typeof row.org_id === "string" ? row.org_id : undefined,
    seatsLimit: typeof row.seats_limit === "number" ? row.seats_limit : undefined,
    active: typeof row.active === "number" ? row.active : undefined,
    suspended: typeof row.suspended === "number" ? row.suspended : undefined,
  };
}

/** Czy dana cena to plan rozliczany za miejsce (Zespół). */
export function isPerSeatPrice(priceId: string | null | undefined): boolean {
  return catalogEntryByPriceId(priceId)?.perSeat === true;
}

/**
 * Liczba opłaconych miejsc -> limit organizacji + dopasowanie uprawnień.
 * Bezpieczne dla subskrypcji bez organizacji (zwraca `linked: false`).
 */
export async function applySubscriptionSeats(input: {
  subscriptionId: string;
  quantity: number;
  priceId: string | null;
}): Promise<SeatsSyncResult> {
  if (!isPerSeatPrice(input.priceId)) return { linked: false };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("org_apply_subscription_seats", {
    p_subscription_id: input.subscriptionId,
    p_quantity: Math.max(1, Math.min(500, Math.trunc(input.quantity || 1))),
  });
  if (error) {
    console.error("[orgs] seats sync failed", input.subscriptionId, error.message);
    return { linked: false };
  }
  const result = readSyncResult(data);
  // Zmniejszenie liczby opłaconych miejsc = ktoś wchodzi w karencję - musi
  // dostać maila z datą i informacją, co dalej.
  if (result.linked && result.orgId) {
    await notifySeatAccessChanges({ orgId: result.orgId, reconcile: data }).catch(() => undefined);
  }
  return result;
}

/**
 * Stan subskrypcji -> stan organizacji. Wstrzymanie/anulowanie odbiera
 * uprawnienia CAŁEMU zespołowi (mo.status decyduje w current_membership_tier),
 * a wznowienie je przywraca - bez ruszania listy miejsc.
 */
export async function applySubscriptionOrgState(input: {
  subscriptionId: string;
  status: string;
  priceId: string | null;
}): Promise<{ changed: boolean }> {
  if (!isPerSeatPrice(input.priceId)) return { changed: false };
  const entitled = input.status === "active" || input.status === "trialing";

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("member_organizations")
    .update({ status: entitled ? "active" : "suspended", updated_at: new Date().toISOString() })
    .eq("paddle_subscription_id", input.subscriptionId)
    .select("id");
  if (error) {
    console.error("[orgs] org state sync failed", input.subscriptionId, error.message);
    return { changed: false };
  }
  return { changed: (data ?? []).length > 0 };
}

// ---------------------------------------------------------------------------
// Karencja po zmniejszeniu liczby miejsc
//
// Zmniejszenie limitu nie odbiera dostępu natychmiast: baza przenosi miejsca
// ponad limit do stanu `grace` z datą końca, a dopiero po tym terminie gasi
// uprawnienia. Poniższe funkcje zamieniają wynik przeliczenia na powiadomienia
// e-mail - osoba dowiaduje się, do kiedy ma dostęp i co może zrobić dalej.
// Wysyłka jest fail-soft: błąd maila nigdy nie może wywrócić webhooka ani
// zapisu limitu.

export interface SeatNotice {
  seatId: string;
  email: string;
  graceUntil?: string | null;
}

/** Lista miejsc, które właśnie weszły w karencję (z wyniku RPC). */
export function readEnteredGrace(value: unknown): SeatNotice[] {
  return readNoticeList(value, "entered_grace");
}

/** Lista miejsc, które właśnie straciły dostęp (z wyniku RPC). */
export function readLostAccess(value: unknown): SeatNotice[] {
  return readNoticeList(value, "lost_access");
}

function readNoticeList(value: unknown, key: string): SeatNotice[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as Record<string, unknown>)[key];
  if (!Array.isArray(raw)) return [];
  const out: SeatNotice[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
    const seatId = typeof row.seat_id === "string" ? row.seat_id : "";
    if (!email || !seatId) continue;
    out.push({
      seatId,
      email,
      graceUntil: typeof row.grace_until === "string" ? row.grace_until : null,
    });
  }
  return out;
}

/** Język odbiorcy z zapisu do newslettera - domyślnie polski. */
async function recipientLang(email: string): Promise<"pl" | "en"> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("newsletter_subscribers")
    .select("language")
    .eq("email", email)
    .maybeSingle();
  return data?.language === "en" ? "en" : "pl";
}

/**
 * Powiadomienia o skutkach zmiany limitu miejsc.
 * `entered_grace` -> mail z datą końca dostępu, `lost_access` -> mail o końcu.
 */
export async function notifySeatAccessChanges(input: {
  orgId: string;
  reconcile: unknown;
}): Promise<{ graceSent: number; endedSent: number }> {
  const entered = readEnteredGrace(input.reconcile);
  const lost = readLostAccess(input.reconcile);
  if (entered.length === 0 && lost.length === 0) return { graceSent: 0, endedSent: 0 };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: org } = await supabaseAdmin
    .from("member_organizations")
    .select("name")
    .eq("id", input.orgId)
    .maybeSingle();
  const orgName = org?.name ?? null;

  const { sendTxEmail, formatDate } = await import("@/lib/email/transactional.server");

  let graceSent = 0;
  let endedSent = 0;

  for (const seat of entered) {
    const lang = await recipientLang(seat.email);
    const res = await sendTxEmail({
      type: "team_seat_grace",
      to: seat.email,
      lang,
      subjectName: orgName,
      details: [
        ...(orgName
          ? [{ label: lang === "pl" ? "Organizacja" : "Organisation", value: orgName }]
          : []),
        ...(seat.graceUntil
          ? [
              {
                label: lang === "pl" ? "Dostęp do" : "Access until",
                value: formatDate(seat.graceUntil, lang),
              },
            ]
          : []),
      ],
      ctaPath: "/profile/subscription",
      bodyVars: { planName: orgName, accessUntil: seat.graceUntil ? formatDate(seat.graceUntil, lang) : null },
      // Ten sam okres karencji = ten sam mail, nawet przy kilku przeliczeniach.
      idempotencyKey: `team-seat-grace:${seat.seatId}:${seat.graceUntil ?? "none"}`,
    });
    if (res.ok && !res.skipped) graceSent += 1;
  }

  for (const seat of lost) {
    const lang = await recipientLang(seat.email);
    const res = await sendTxEmail({
      type: "team_seat_access_ended",
      to: seat.email,
      lang,
      subjectName: orgName,
      details: orgName
        ? [{ label: lang === "pl" ? "Organizacja" : "Organisation", value: orgName }]
        : [],
      ctaPath: "/pricing",
      bodyVars: { planName: orgName },
      idempotencyKey: `team-seat-ended:${seat.seatId}:${new Date().toISOString().slice(0, 10)}`,
    });
    if (res.ok && !res.skipped) endedSent += 1;
  }

  return { graceSent, endedSent };
}

/**
 * Wygaszenie karencji, która minęła: odbiera dostęp i wysyła mail końcowy.
 * Wołane cyklicznie przez zaplecze - bezpieczne przy wielokrotnym uruchomieniu.
 */
export async function expireSeatGrace(): Promise<{ expired: number; notified: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("org_expire_seat_grace");
  if (error) {
    console.error("[orgs] grace expiry failed", error.message);
    return { expired: 0, notified: 0 };
  }
  const rows =
    data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).expired)
      ? ((data as Record<string, unknown>).expired as unknown[])
      : [];

  // Grupujemy po organizacji, żeby nazwa firmy w mailu zgadzała się z miejscem.
  const byOrg = new Map<string, unknown[]>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const orgId = (row as Record<string, unknown>).org_id;
    if (typeof orgId !== "string") continue;
    const list = byOrg.get(orgId) ?? [];
    list.push(row);
    byOrg.set(orgId, list);
  }

  let notified = 0;
  for (const [orgId, list] of byOrg) {
    const res = await notifySeatAccessChanges({ orgId, reconcile: { lost_access: list } });
    notified += res.endedSent;
  }
  return { expired: rows.length, notified };
}

// ---------------------------------------------------------------------------
// Harmonogram przypomnień w trakcie karencji
//
// Poza mailem "wchodzisz w karencję" i mailem końcowym wysyłamy jeszcze
// przypomnienia na N dni przed utratą dostępu. Progi są konfigurowalne per
// organizacja (np. 14/7/3/1), a gdy nie ustawiono własnych - obowiązują
// domyślne 7 i 1. Uruchamiane raz na dobę z crona rozliczeniowego; idempotencja
// opiera się na kluczu (miejsce + termin karencji + próg), więc powtórne
// wywołania nie duplikują wysyłki.

export {
  DEFAULT_SEAT_GRACE_REMINDER_DAYS,
  normalizeReminderDays,
} from "@/lib/organizations/teamSeats";

import {
  DEFAULT_SEAT_GRACE_REMINDER_DAYS as DEFAULT_REMINDER_DAYS,
  MAX_REMINDER_DAY,
  effectiveReminderDays,
  normalizeReminderDays as normalizeDays,
} from "@/lib/organizations/teamSeats";

const DAY_MS = 86_400_000;

/** Ile pełnych dni zostało do terminu (zaokrąglone w górę, min. 0). */
function daysUntil(iso: string, now: number): number {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return -1;
  return Math.max(0, Math.ceil((ts - now) / DAY_MS));
}

export interface SeatGraceReminderResult {
  checked: number;
  sent: number;
  /** Progi użyte globalnie (override) lub domyślne, gdy liczą się per organizacja. */
  days: number[];
  /** Czy progi pochodziły z konfiguracji organizacji. */
  perOrg: boolean;
}


/**
 * Przypomnienia dla miejsc w karencji, którym zostało dokładnie N dni.
 * Bez `offsets` progi bierzemy z konfiguracji każdej organizacji
 * (`seats_grace_reminder_days`), z fallbackiem do wartości domyślnych.
 * Fail-soft: pojedynczy błąd wysyłki nie przerywa całej serii.
 */
export async function sendSeatGraceReminders(
  offsets?: readonly number[] | null,
): Promise<SeatGraceReminderResult> {
  const override = offsets && offsets.length > 0 ? normalizeDays(offsets) : null;
  const perOrg = override === null;
  const days = override ?? [...DEFAULT_REMINDER_DAYS];
  const empty = { checked: 0, sent: 0, days, perOrg };
  if (!perOrg && days.length === 0) return empty;

  const now = Date.now();
  const maxDay = perOrg ? MAX_REMINDER_DAY : days[0];
  const horizon = new Date(now + (maxDay + 1) * DAY_MS).toISOString();

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("organization_seats")
    .select("id, org_id, invited_email, grace_until")
    .eq("status", "grace")
    .not("grace_until", "is", null)
    .gt("grace_until", new Date(now).toISOString())
    .lte("grace_until", horizon);
  if (error) {
    console.error("[orgs] grace reminders query failed", error.message);
    return empty;
  }

  const rows = (data ?? []).filter((row) => typeof row.grace_until === "string");
  if (rows.length === 0) return empty;

  // Nazwa i progi organizacji jednym zapytaniem - mail musi pokazywać właściwą
  // firmę, a harmonogram respektować jej ustawienia.
  const orgIds = [...new Set(rows.map((row) => row.org_id))];
  const { data: orgs } = await supabaseAdmin
    .from("member_organizations")
    .select("id, name, seats_grace_reminder_days")
    .in("id", orgIds);
  const orgNames = new Map<string, string>();
  const orgDays = new Map<string, number[]>();
  for (const org of orgs ?? []) {
    if (org.name) orgNames.set(org.id, org.name);
    orgDays.set(org.id, effectiveReminderDays(org.seats_grace_reminder_days));
  }

  const { sendTxEmail, formatDate } = await import("@/lib/email/transactional.server");

  let sent = 0;
  for (const row of rows) {
    const graceUntil = row.grace_until as string;
    const left = daysUntil(graceUntil, now);
    const rowDays = override ?? orgDays.get(row.org_id) ?? [...DEFAULT_REMINDER_DAYS];
    if (!rowDays.includes(left)) continue;

    const email = (row.invited_email ?? "").trim().toLowerCase();
    if (!email) continue;
    const orgName = orgNames.get(row.org_id) ?? null;

    const lang = await recipientLang(email);
    const until = formatDate(graceUntil, lang);

    const res = await sendTxEmail({
      type: "team_seat_grace_reminder",
      to: email,
      lang,
      subjectName: orgName,
      details: [
        ...(orgName
          ? [{ label: lang === "pl" ? "Organizacja" : "Organisation", value: orgName }]
          : []),
        { label: lang === "pl" ? "Dostęp do" : "Access until", value: until },
        {
          label: lang === "pl" ? "Pozostało" : "Time left",
          value:
            lang === "pl"
              ? `${left} ${left === 1 ? "dzień" : "dni"}`
              : `${left} day${left === 1 ? "" : "s"}`,
        },
      ],
      ctaPath: "/profile/subscription",
      bodyVars: { planName: orgName, orgName, accessUntil: until, daysLeft: left },
      idempotencyKey: `team-seat-grace-reminder:${row.id}:${graceUntil}:${left}`,
    }).catch((err: unknown) => {
      console.error("[orgs] grace reminder send failed", row.id, err);
      return { ok: false as const, skipped: false };
    });
    if (res.ok && !res.skipped) sent += 1;
  }

  return { checked: rows.length, sent, days, perOrg };
}
