// Panel administracyjny darowizn: rejestr wpłat + synchronizacja ze Stripe.
//
// Webhook jest ścieżką podstawową, ale bywa zawodny (endpoint niedostępny,
// wyczerpane ponowienia). Ten moduł porównuje stan lokalny ze Stripe i:
//   1. domyka lokalne wiersze `pending`, dla których sesja Stripe jest
//      opłacona (albo wygasła),
//   2. importuje opłacone sesje darowizn (`metadata.purpose = "donation"`),
//      których w ogóle nie ma w bazie,
//   3. oznacza zwroty (`charge.refunded`) jako `refunded`.
//
// Operacje są idempotentne - powtórny przebieg nie duplikuje wierszy
// (klucz `provider_session_id` jest unikalny).
//
// Moduł server-only (klucze bramki + service_role).
import type Stripe from "stripe";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";

export interface AdminDonationRow {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  recurring: boolean;
  donorEmail: string | null;
  message: string | null;
  provider: string;
  providerSessionId: string;
  providerIntentId: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface DonationsSyncReport {
  environment: StripeEnv;
  sinceIso: string;
  scannedSessions: number;
  settled: number;
  imported: number;
  refunded: number;
  expired: number;
  warnings: string[];
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function resolveTenantId(): Promise<string | null> {
  const [{ resolveTenantIdForHost }, { currentTenantHost }] = await Promise.all([
    import("@/lib/server/tenant.server"),
    import("@/lib/http/requestHost"),
  ]);
  return resolveTenantIdForHost(await currentTenantHost());
}

function isoOf(unixSeconds: number | null | undefined): string | null {
  return typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString() : null;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** Ostatnie wpłaty dla panelu (pełne dane - widok tylko dla roli `admin`). */
export async function listAdminDonations(limit = 50): Promise<AdminDonationRow[]> {
  const tenantId = await resolveTenantId();
  if (!tenantId) return [];
  const supabase = await admin();
  const { data, error } = await supabase
    .from("donations")
    .select(
      "id,amount_cents,currency,status,recurring,donor_email,message,provider,provider_session_id,provider_intent_id,created_at,paid_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    recurring: row.recurring,
    donorEmail: row.donor_email,
    message: row.message,
    provider: row.provider,
    providerSessionId: row.provider_session_id,
    providerIntentId: row.provider_intent_id,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  }));
}

async function isChargeRefunded(stripe: Stripe, intentId: string | null): Promise<boolean> {
  if (!intentId) return false;
  try {
    const intent = await stripe.paymentIntents.retrieve(intentId);
    const chargeId = idOf(
      (intent as Stripe.PaymentIntent & { latest_charge?: string | Stripe.Charge }).latest_charge ??
        null,
    );
    if (!chargeId) return false;
    const charge = await stripe.charges.retrieve(chargeId);
    return charge.refunded === true || (charge.amount_refunded ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Uzgadnia darowizny ze Stripe. Zwraca raport liczbowy - bez PII.
 */
export async function syncDonationsFromStripe(
  environment: StripeEnv,
  sinceHours = 168,
): Promise<DonationsSyncReport> {
  const tenantId = await resolveTenantId();
  const sinceMs = Date.now() - sinceHours * 3_600_000;
  const report: DonationsSyncReport = {
    environment,
    sinceIso: new Date(sinceMs).toISOString(),
    scannedSessions: 0,
    settled: 0,
    imported: 0,
    refunded: 0,
    expired: 0,
    warnings: [],
  };
  if (!tenantId) {
    report.warnings.push("tenant_unresolved");
    return report;
  }

  const supabase = await admin();
  const stripe = createStripeClient(environment);

  // --- 1. Lokalne wiersze: domknięcie / zwroty ---------------------------
  const { data: localRows, error: localError } = await supabase
    .from("donations")
    .select("id,status,provider,provider_session_id,provider_intent_id,created_at")
    .eq("tenant_id", tenantId)
    .eq("provider", "stripe")
    .gte("created_at", report.sinceIso)
    .order("created_at", { ascending: false })
    .limit(500);
  if (localError) throw new Error(localError.message);

  const knownSessionIds = new Set<string>();
  for (const row of localRows ?? []) {
    knownSessionIds.add(row.provider_session_id);
    const sessionId = row.provider_session_id;

    if (row.status === "pending" && sessionId.startsWith("cs_")) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === "paid" || session.status === "complete") {
          const { settleDonation } = await import("@/lib/billing/donations.server");
          await settleDonation({
            donationId: row.id,
            sessionId,
            intentId: idOf(session.payment_intent ?? null),
            amountCents: session.amount_total ?? null,
            currency: session.currency ?? null,
            donorEmail: session.customer_details?.email ?? null,
            paidAt: isoOf(session.created),
          });
          report.settled += 1;
        } else if (session.status === "expired") {
          // ZAPIS MUSI BYĆ SPRAWDZONY. Raport jest jedynym potwierdzeniem,
          // jakie dostaje człowiek domykający księgę - licznik podniesiony po
          // zapisie, który się nie udał, znaczy dla niego „uzgodnione", choć
          // wiersz dalej wisi w `pending`.
          const { error: cancelErr } = await supabase
            .from("donations")
            .update({ status: "canceled" })
            .eq("id", row.id);
          if (cancelErr) {
            report.warnings.push(`expire_write_failed:${row.id}`);
            console.error("[donations sync] expire write failed", cancelErr.message);
          } else {
            report.expired += 1;
          }
        }
      } catch (e) {
        report.warnings.push(`session_lookup_failed:${sessionId}`);
        console.error("[donations sync] session lookup failed", e);
      }
      continue;
    }

    if (row.status === "paid" && (await isChargeRefunded(stripe, row.provider_intent_id))) {
      // Jak wyżej: „zwrócono 1" znaczy dla czytającego, że rejestr jest
      // uzgodniony, status wspierającego cofnięty, a eksport księgowy pokazuje
      // zwrot. Nieudany zapis raportowany jako wykonany to operacja POZORNIE
      // WYKONANA - gorsza od zablokowanej, bo rozjazd wychodzi dopiero przy
      // rocznym rozliczeniu.
      const { error: refundErr } = await supabase
        .from("donations")
        .update({ status: "refunded" })
        .eq("id", row.id);
      if (refundErr) {
        report.warnings.push(`refund_write_failed:${row.id}`);
        console.error("[donations sync] refund write failed", refundErr.message);
      } else {
        report.refunded += 1;
      }
    }
  }

  // Osierocone wiersze `pending:` bez sesji - starsze niż 24h są anulowane.
  const staleIso = new Date(Date.now() - 86_400_000).toISOString();
  const { data: stale } = await supabase
    .from("donations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .like("provider_session_id", "pending:%")
    .lt("created_at", staleIso)
    .limit(200);
  for (const row of stale ?? []) {
    const { error: staleErr } = await supabase
      .from("donations")
      .update({ status: "canceled" })
      .eq("id", row.id);
    if (staleErr) {
      report.warnings.push(`expire_write_failed:${row.id}`);
      console.error("[donations sync] stale expire write failed", staleErr.message);
      continue;
    }
    report.expired += 1;
  }

  // --- 2. Import brakujących sesji ze Stripe ------------------------------
  try {
    const sessions = await stripe.checkout.sessions.list({
      created: { gte: Math.floor(sinceMs / 1000) },
      limit: 100,
    });
    if (sessions.has_more) report.warnings.push("sessions_page_limit");
    for (const session of sessions.data) {
      if (session.metadata?.purpose !== "donation") continue;
      report.scannedSessions += 1;
      if (session.payment_status !== "paid" && session.status !== "complete") continue;
      if (knownSessionIds.has(session.id)) continue;
      if (session.metadata?.donationId) {
        // Wiersz istnieje, ale ma jeszcze zapisany identyfikator tymczasowy.
        const { settleDonation } = await import("@/lib/billing/donations.server");
        await settleDonation({
          donationId: session.metadata.donationId,
          intentId: idOf(session.payment_intent ?? null),
          amountCents: session.amount_total ?? null,
          currency: session.currency ?? null,
          donorEmail: session.customer_details?.email ?? null,
          paidAt: isoOf(session.created),
        });
        await supabase
          .from("donations")
          .update({ provider_session_id: session.id })
          .eq("id", session.metadata.donationId);
        report.settled += 1;
        continue;
      }
      // IZOLACJA TENANTA. Klucz operatora jest jeden na ŚRODOWISKO, a nie na
      // tenanta, więc `checkout.sessions.list` oddaje sesje CAŁEJ instalacji.
      // Wstawienie sesji bez dowodu przynależności z `tenant_id` wywołującego
      // znaczyło, że wpłata na kampanię tenanta B ląduje w księdze tenanta A -
      // tego, którego administrator pierwszy kliknął „uzgodnij". Cudze
      // pieniądze w cudzym rejestrze idą dalej do publicznych statystyk
      // zbiórki, do eksportu księgowego i do triggera nadającego status
      // wspierającego. Przynależność musi więc być STEMPLEM W SESJI
      // (`metadata.tenantId`, nakładanym przez `createDonationSession`),
      // a nie domysłem z tego, kto akurat uruchomił uzgodnienie.
      if (session.metadata?.tenantId !== tenantId) {
        // Sesja spoza naszego formularza (pulpit operatora, link płatniczy)
        // stempla nie ma - i nie zgadujemy za nią. Zgłaszamy ją do RĘCZNEGO
        // przypisania zamiast wciągać w cudzą księgę.
        report.warnings.push(`import_unassigned:${session.id}`);
        continue;
      }
      const { error: insertError } = await supabase.from("donations").insert({
        tenant_id: tenantId,
        amount_cents: session.amount_total ?? 0,
        currency: (session.currency ?? "pln").toUpperCase(),
        donor_email: session.customer_details?.email?.toLowerCase() ?? null,
        provider: "stripe",
        provider_session_id: session.id,
        provider_intent_id: idOf(session.payment_intent ?? null),
        provider_subscription_id: idOf(session.subscription ?? null),
        recurring: session.mode === "subscription",
        status: "paid",
        paid_at: isoOf(session.created),
      });
      if (insertError) {
        report.warnings.push(`import_failed:${session.id}`);
        continue;
      }
      report.imported += 1;
    }
  } catch (e) {
    report.warnings.push("stripe_list_failed");
    console.error("[donations sync] sessions.list failed", e);
  }

  // Uzgodnienie zmieniło rejestr - publiczne statystyki (cache 60 s per izolat)
  // muszą pokazać nowy stan od razu po kliknięciu, a nie za minutę.
  if (report.settled + report.imported + report.refunded + report.expired > 0) {
    const { invalidateEdgeTtlCache } = await import("@/lib/ssrCache");
    await invalidateEdgeTtlCache("donations:public-stats");
  }

  return report;
}
