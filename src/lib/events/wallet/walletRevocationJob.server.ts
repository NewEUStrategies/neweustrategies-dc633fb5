// Zadanie tła: obiekty Google Wallet unieważnionych biletów -> INACTIVE (OPS-14).
//
// SKĄD BIERZE SIĘ PRACA. Baza zgłasza dezaktywację triggerami (migracja
// 20261012130000): zgłoszenie przestało dawać przepustkę (anulowanie,
// odrzucenie, zwrot, `no_show`), zmienił się kod biletu (ponowna wysyłka,
// unieważnienie zgubionego), wydarzenie odwołano albo obiekt zastąpił nowszy.
// Baza nie umie zawołać Google Wallet API - klucz konta usługi żyje
// w sekretach aplikacji - więc woła je to zadanie, w istniejącym
// harmonogramie: tick `/api/public/jobs-tick` (pg_cron co minutę) i siatka
// `/api/public/community-cron` (job `event-wallet-passes`).
//
// JEDNO ZAJĘCIE, JEDNO ROZLICZENIE NA PARTIĘ (wzorzec zawiadomień o odwołanych
// biletach). `_event_wallet_pass_revocations_claim` zajmuje partię (SKIP
// LOCKED, dzierżawa, odstęp ponowień 5 min * 2^(próba-1), najwyżej 8 prób)
// i sama zamyka bez sieci przypadki, w których wywołanie nic by nie dało
// (wydarzenie skończone - obiekt wygasł; zgłoszenie znów ważne z tym samym
// kodem). `_event_wallet_pass_revocations_settle` rozlicza wynik po dzierżawie.
//
// WYNIK WYWOŁANIA GOOGLE:
//   * 2xx i 404 (obiektu nie ma - nie ma czego unieważnić) -> revoked;
//   * każdy inny status albo błąd sieci -> failed z krótką przyczyną
//     (`http 403`, `timeout`, `network`) - bez treści odpowiedzi i bez sekretów;
//     baza ponawia z odstępem, po 8 próbach przestaje (`gaveUp` w wyniku
//     przebiegu, przyczyna w `event_wallet_passes.revoke_error`);
//   * minięty termin partii -> deferred (próba nie przepada).
// Obiekt, który w trakcie próby uczestnik dodał ponownie (ten sam kod, znów
// ważny), rozliczenie oddaje w `reactivate` - zadanie przywraca mu ACTIVE.
//
// BRAK KONFIGURACJI GOOGLE = nic do zrobienia (`skipped: not_configured`),
// a nie awaria: zadanie niczego nie zajmuje, więc próby nie przepadają.
// Brak funkcji w bazie (kod przed migracją) = `skipped: migration_pending`.
//
// Moduł server-only (klient service_role, klucz konta usługi).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

import { GoogleWalletError, setWalletObjectState, walletAccessToken } from "./googleWallet.server";
import { googleWalletConfig } from "./walletConfig.server";

type DbClient = SupabaseClient<Database>;

/** Budżet partii, gdy wołający nie poda terminu (`community-cron`). */
const WALLET_REVOCATIONS_BUDGET_MS = 10_000;

export interface WalletRevocationsResult {
  /** Obiekty zajęte w tej partii (do wywołania Google). */
  claimed: number;
  /** Ustawione jako INACTIVE (albo już nieistniejące). */
  revoked: number;
  /** Nieudane wywołania - wracają po odstępie. */
  failed: number;
  /** Odłożone przez termin - wracają od razu. */
  deferred: number;
  /** Nieudana ÓSMA próba - obiekt zostaje z błędem, bez dalszych prób. */
  gaveUp: number;
  /** Zamknięte przez bazę bez wywołania (wydarzenie minione, zgłoszenie znów ważne). */
  closed: number;
  /** Obiekty wydane ponownie w trakcie próby, którym przywrócono ACTIVE. */
  reactivated: number;
  skipped?: "not_configured" | "migration_pending";
}

interface ClaimedPass {
  readonly id: string;
  readonly objectId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Przyczyna błędu do `revoke_error`: status HTTP albo rodzaj błędu sieci, nic więcej. */
export function revokeErrorLabel(err: unknown): string {
  if (err instanceof GoogleWalletError) return `http ${err.status}`;
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return "timeout";
  }
  return "network";
}

function readClaim(data: Json | null): {
  claimedAt: string | null;
  passes: ClaimedPass[];
  closed: number;
} {
  const payload = isRecord(data) ? data : {};
  const claimedAt = typeof payload.claimed_at === "string" ? payload.claimed_at : null;
  const list: unknown[] = Array.isArray(payload.passes) ? payload.passes : [];
  const passes: ClaimedPass[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== "string" || typeof item.object_id !== "string") continue;
    passes.push({ id: item.id, objectId: item.object_id });
  }
  return { claimedAt, passes, closed: count(payload.closed) };
}

/**
 * Cron: obiekty Google Wallet do unieważnienia. Termin sprawdzamy PRZED
 * zajęciem (miniony termin nie zajmuje niczego) i przed każdym wywołaniem.
 * Rzuca tylko przy błędzie zajęcia - krok crona świeci wtedy na czerwono.
 */
export async function runWalletPassRevocations(
  admin: DbClient,
  options: { limit?: number; deadlineAt?: number } = {},
): Promise<WalletRevocationsResult> {
  const deadlineAt = options.deadlineAt ?? Date.now() + WALLET_REVOCATIONS_BUDGET_MS;
  const result: WalletRevocationsResult = {
    claimed: 0,
    revoked: 0,
    failed: 0,
    deferred: 0,
    gaveUp: 0,
    closed: 0,
    reactivated: 0,
  };
  if (Date.now() > deadlineAt) return result;

  const config = googleWalletConfig();
  if (config === null) return { ...result, skipped: "not_configured" };

  const { data, error } = await admin.rpc("_event_wallet_pass_revocations_claim", {
    p_limit: options.limit ?? 20,
  });
  if (error) {
    if (isMigrationPending(error)) return { ...result, skipped: "migration_pending" };
    throw new Error(error.message);
  }
  const claim = readClaim(data);
  result.closed = claim.closed;
  result.claimed = claim.passes.length;
  if (claim.claimedAt === null || claim.passes.length === 0) return result;

  const revoked: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const deferred: string[] = [];

  let token: string | null = null;
  let tokenError: string | null = null;
  try {
    token = await walletAccessToken(config.serviceAccount, Date.now());
  } catch (err) {
    tokenError = `token ${revokeErrorLabel(err)}`;
  }

  for (const pass of claim.passes) {
    if (token === null) {
      failed.push({ id: pass.id, error: tokenError ?? "token" });
      continue;
    }
    if (Date.now() > deadlineAt) {
      deferred.push(pass.id);
      continue;
    }
    try {
      await setWalletObjectState(pass.objectId, "INACTIVE", token);
      revoked.push(pass.id);
    } catch (err) {
      failed.push({ id: pass.id, error: revokeErrorLabel(err) });
    }
  }
  if (failed.length > 0) {
    console.warn(
      "[wallet] google revocations failed:",
      failed.length,
      [...new Set(failed.map((f) => f.error))].join(", "),
    );
  }

  let reactivate: string[] = [];
  try {
    const { data: settled, error: settleError } = await admin.rpc(
      "_event_wallet_pass_revocations_settle",
      {
        p_claimed_at: claim.claimedAt,
        p_revoked: revoked,
        p_failed: failed,
        p_deferred: deferred,
      },
    );
    if (settleError) {
      // Nierozliczone zajęcie wygaśnie samo; ponowny PATCH INACTIVE jest idempotentny.
      console.error("[wallet] google revocations settle failed:", settleError.message);
      result.revoked = revoked.length;
      result.failed = failed.length;
      result.deferred = deferred.length;
      return result;
    }
    const summary = isRecord(settled) ? settled : {};
    result.revoked = count(summary.revoked);
    result.failed = count(summary.failed);
    result.deferred = count(summary.deferred);
    result.gaveUp = count(summary.gave_up);
    reactivate = Array.isArray(summary.reactivate)
      ? summary.reactivate.filter((id): id is string => typeof id === "string")
      : [];
  } catch (err) {
    console.error("[wallet] google revocations settle failed:", String(err));
    result.revoked = revoked.length;
    result.failed = failed.length;
    result.deferred = deferred.length;
    return result;
  }

  // Wydany ponownie w trakcie próby: PATCH INACTIVE mógł przyjść po zapisie
  // trasy. Best-effort - dziennik wyczyścił skrót treści, więc następne
  // dodanie i tak zapisze obiekt w całości (ze stanem ACTIVE).
  for (const objectId of reactivate) {
    if (token === null) break;
    try {
      await setWalletObjectState(objectId, "ACTIVE", token);
      result.reactivated += 1;
    } catch (err) {
      console.warn("[wallet] google reactivation failed:", revokeErrorLabel(err));
    }
  }
  return result;
}
