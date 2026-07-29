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
