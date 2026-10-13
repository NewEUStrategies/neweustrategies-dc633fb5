// Zadanie tła: obiekty Google Wallet unieważnionych biletów -> INACTIVE (OPS-14).
//
// SKĄD BIERZE SIĘ PRACA. Baza zgłasza dezaktywację triggerami (migracja
// 20261013111600): zgłoszenie przestało dawać przepustkę (anulowanie,
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
// Od 20261013112500 partia niesie też NAGROBKI obiektów usuniętych wydarzeń
// i zgłoszeń (ten sam kształt pozycji, rozliczenie po identyfikatorze) - dla
// zadania to zwykłe obiekty do unieważnienia.
//
// WYNIK WYWOŁANIA GOOGLE:
//   * 2xx i 404 (obiektu nie ma - nie ma czego unieważnić) -> revoked;
//   * każdy inny status albo błąd sieci -> failed z krótką przyczyną
//     (`http 403`, `timeout`, `network`) - bez treści odpowiedzi i bez sekretów;
//     baza ponawia z odstępem, po 8 próbach przestaje (`gaveUp` w wyniku
//     przebiegu, przyczyna w `event_wallet_passes.revoke_error`; operacje
//     przywracają porzucone `_event_wallet_pass_revocations_requeue()`);
//   * minięty termin partii -> deferred (próba nie przepada).
//
// PRZYWRÓCENIE ACTIVE (best-effort, z tym samym tokenem):
//   * obiekt, który w trakcie próby uczestnik dodał ponownie (ten sam kod,
//     znów ważny) - `reactivate` z rozliczenia;
//   * obiekt, którego zgłoszenie dezaktywacji zajęcie zamknęło jako
//     nieaktualne PO próbie (PATCH INACTIVE mógł dojść do Google, choć nie
//     został odnotowany) - `reactivate` z zajęcia (F7).
// W obu przypadkach baza wyczyściła skrót treści, więc nawet nieudane
// przywrócenie naprawia następne „Dodaj do Google Wallet” (pełny zapis).
//
// TOKEN DOPIERO PRZY PRACY, A JEGO BŁĄD NIE ZJADA PRÓB (F10). Token jest
// potrzebny tylko, gdy zajęcie oddało obiekty - pusta kolejka nie kosztuje
// wymiany. Wymiana, która się nie udała (klucz konta usługi usunięty,
// wyłączony albo obrócony w GCP), to awaria CAŁEGO zadania, nie obiektu:
// partia wraca jako `deferred` (próba oddana, dzierżawa zdjęta), a przebieg
// rzuca - krok crona świeci na czerwono przy każdym ticku, aż ktoś naprawi
// klucz, i żaden obiekt nie dochodzi przez awarię do sufitu 8 prób.
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
  /** Zamknięte przez bazę bez wywołania (wydarzenie minione, zgłoszenie znów ważne, nagrobek wygasły). */
  closed: number;
  /**
   * Obiekty, którym przywrócono ACTIVE: wydane ponownie w trakcie próby albo
   * zamknięte jako nieaktualne po próbie, która mogła dojść do Google.
   */
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

/** Identyfikatory obiektów z listy `reactivate` (zajęcie albo rozliczenie). */
function objectIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && id !== "")
    : [];
}

function readClaim(data: Json | null): {
  claimedAt: string | null;
  passes: ClaimedPass[];
  closed: number;
  reactivate: string[];
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
  return {
    claimedAt,
    passes,
    closed: count(payload.closed),
    reactivate: objectIds(payload.reactivate),
  };
}

interface SettleLists {
  readonly revoked: string[];
  readonly failed: { id: string; error: string }[];
  readonly deferred: string[];
}

/** Rozliczenie partii; `null`, gdy się nie udało (dzierżawa w bazie wygaśnie sama). */
async function settle(
  admin: DbClient,
  claimedAt: string,
  lists: SettleLists,
): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await admin.rpc("_event_wallet_pass_revocations_settle", {
      p_claimed_at: claimedAt,
      p_revoked: lists.revoked,
      p_failed: lists.failed,
      p_deferred: lists.deferred,
    });
    if (error) {
      console.error("[wallet] google revocations settle failed:", error.message);
      return null;
    }
    return isRecord(data) ? data : {};
  } catch (err) {
    console.error("[wallet] google revocations settle failed:", String(err));
    return null;
  }
}

/**
 * Cron: obiekty Google Wallet do unieważnienia. Termin sprawdzamy PRZED
 * zajęciem (miniony termin nie zajmuje niczego) i przed każdym wywołaniem.
 * Rzuca przy błędzie zajęcia i przy nieudanej wymianie tokenu (partia oddana
 * jako `deferred`) - krok crona świeci wtedy na czerwono.
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
  const claimedAt = claim.passes.length > 0 ? claim.claimedAt : null;
  result.claimed = claimedAt === null ? 0 : claim.passes.length;
  if (claimedAt === null && claim.reactivate.length === 0) return result;

  let token: string;
  try {
    token = await walletAccessToken(config.serviceAccount, Date.now());
  } catch (err) {
    // Awaria zadania, nie obiektu (F10): partia wraca bez zużycia próby.
    const reason = revokeErrorLabel(err);
    if (claimedAt !== null) {
      const deferred = claim.passes.map((pass) => pass.id);
      await settle(admin, claimedAt, { revoked: [], failed: [], deferred });
    }
    if (claim.reactivate.length > 0) {
      // Skrót treści jest już wyczyszczony - następne dodanie zapisze obiekt.
      console.warn("[wallet] google reactivations skipped:", claim.reactivate.length);
    }
    throw new Error(`google wallet token failed: ${reason}`);
  }

  const reactivate = new Set(claim.reactivate);
  if (claimedAt !== null) {
    const revoked: string[] = [];
    const failed: { id: string; error: string }[] = [];
    const deferred: string[] = [];
    for (const pass of claim.passes) {
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

    const summary = await settle(admin, claimedAt, { revoked, failed, deferred });
    if (summary === null) {
      // Nierozliczone zajęcie wygaśnie samo; ponowny PATCH INACTIVE jest idempotentny.
      result.revoked = revoked.length;
      result.failed = failed.length;
      result.deferred = deferred.length;
    } else {
      result.revoked = count(summary.revoked);
      result.failed = count(summary.failed);
      result.deferred = count(summary.deferred);
      result.gaveUp = count(summary.gave_up);
      for (const objectId of objectIds(summary.reactivate)) reactivate.add(objectId);
    }
  }

  // Best-effort: baza wyczyściła skrót treści, więc następne dodanie i tak
  // zapisze obiekt w całości (ze stanem ACTIVE).
  for (const objectId of reactivate) {
    try {
      await setWalletObjectState(objectId, "ACTIVE", token);
      result.reactivated += 1;
    } catch (err) {
      console.warn("[wallet] google reactivation failed:", revokeErrorLabel(err));
    }
  }
  return result;
}
