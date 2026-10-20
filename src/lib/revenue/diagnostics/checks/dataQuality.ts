// Reguły obszaru „Jakość danych" (SPEC §5.7, I5/I6). Liczby huba są tyle
// warte, ile źródła: dokument bez środowiska miesza piaskownicę z produkcją,
// MRR z ceny katalogowej to szacunek, a migawka rozjechana z księgą to dwie
// różne odpowiedzi na to samo pytanie.
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

/**
 * Tolerancja rozjazdu migawki i księgi - lustro `BRIDGE_TOLERANCE`
 * (`lib/revenue/finance/mrrMath.ts`, 0,5 %; parytet w teście reguł). Kopia,
 * bo tamten moduł ciągnie arytmetykę repricingu do chunku chipu sygnałów
 * w modułach, który czyta te reguły.
 */
export const LEDGER_DRIFT_TOLERANCE = 0.005;

/** Więcej niż połowa źródeł benchmarków przeterminowana = rejestr wymaga przeglądu. */
export const BENCHMARK_STALE_MAJORITY = 0.5;

/** Piaskownica „żyje", gdy miała subskrypcję w ostatnim tygodniu. */
export const SANDBOX_RECENT_DAYS = 7;

const DAY_MS = 86_400_000;
const OWNER = { to: "/admin/monetization-ledger" } as const;

export const DATA_QUALITY_CHECKS = [
  {
    id: "data_quality.documents_env_unknown",
    area: "data_quality",
    severity: "warning",
    evaluate(facts) {
      const docs = areaFacts(facts, "data_quality")?.documentsEnvUnknown;
      if (docs?.recent30d === undefined || docs.older === undefined) return UNKNOWN;
      if (docs.recent30d + docs.older === 0) return OK;
      // Nowe dokumenty bez środowiska = webhook nadal je tak zapisuje.
      return finding(docs.recent30d > 0 ? "error" : "warn", {
        count: docs.recent30d + docs.older,
        evidence: ev("documentsEnvUnknown", { count: docs.recent30d + docs.older, recent: docs.recent30d }),
      });
    },
    fix: { kind: "code", issueRef: "data_quality.documents_env_unknown" },
    owner: OWNER,
    snoozable: true,
  },
  {
    id: "data_quality.mrr_catalog_basis",
    area: "data_quality",
    severity: "warning",
    evaluate(facts) {
      const basis = areaFacts(facts, "data_quality")?.mrrCatalogBasis;
      // `null` = brak migawek albo redaktor (udział MRR to dana finansowa).
      if (!basis || basis.share === undefined || basis.share === null) return UNKNOWN;
      if (basis.share <= 0) return OK;
      const percent = Math.round(basis.share * 100);
      return finding(basis.share >= 1 ? "error" : "warn", {
        evidence: ev("mrrCatalogBasis", { percent }),
      });
    },
    fix: { kind: "link", to: "/admin/billing", search: { tab: "subscriptions" } },
    owner: OWNER,
    snoozable: true,
  },
  {
    // Krytyczna i NIEWYCISZALNA: rozjazd ponad tolerancję mostka znaczy, że
    // migawka i księga liczą różny MRR - każda liczba przychodu w hubie jest
    // wtedy niepewna.
    id: "data_quality.ledger_drift",
    area: "data_quality",
    severity: "critical",
    evaluate(facts) {
      const drift = areaFacts(facts, "data_quality")?.ledgerDrift;
      if (!drift || drift.maxRatio === undefined || drift.maxRatio === null) return UNKNOWN;
      if (drift.maxRatio === 0) return OK;
      const percent = Math.round(drift.maxRatio * 10_000) / 100;
      const currencies = (drift.currencies ?? [])
        .filter((c) => c.ratio !== null && c.ratio > 0)
        .map((c) => c.currency);
      return finding(drift.maxRatio > LEDGER_DRIFT_TOLERANCE ? "error" : "warn", {
        count: currencies.length,
        refs: currencies,
        evidence: ev("ledgerDrift", {
          percent,
          tolerance: LEDGER_DRIFT_TOLERANCE * 100,
          currencies: currencies.join(", "),
        }),
      });
    },
    fix: { kind: "code", issueRef: "data_quality.ledger_drift" },
    owner: OWNER,
    snoozable: false,
  },
  {
    id: "data_quality.benchmark_stale",
    area: "data_quality",
    severity: "info",
    evaluate(facts) {
      const sources = areaFacts(facts, "data_quality")?.benchmarkSources;
      if (!sources) return UNKNOWN;
      if (sources.stale === 0 || sources.total === 0) return OK;
      return finding(sources.stale / sources.total > BENCHMARK_STALE_MAJORITY ? "error" : "warn", {
        count: sources.stale,
        evidence: ev("benchmarkStale", { count: sources.stale, total: sources.total }),
      });
    },
    fix: { kind: "link", to: "/admin/revenue/metrics" },
    owner: { to: "/admin/revenue/metrics" },
    snoozable: true,
  },
  {
    // Tylko subskrypcje piaskownicy, zero produkcyjnych: hub pokazuje zera.
    // Piaskownica aktywna w ostatnim tygodniu przy zerze produkcji = kasa
    // prawdopodobnie sprzedaje na kluczach testowych (error).
    id: "data_quality.sandbox_only",
    area: "data_quality",
    severity: "info",
    evaluate(facts) {
      const dq = areaFacts(facts, "data_quality");
      const now = facts.computedAt === null ? Number.NaN : Date.parse(facts.computedAt);
      if (dq?.live?.subscriptions === undefined || dq.sandbox?.subscriptions === undefined) {
        return UNKNOWN;
      }
      if (dq.live.subscriptions > 0 || dq.sandbox.subscriptions === 0) return OK;
      const lastSandbox = dq.sandbox.lastAt ? Date.parse(dq.sandbox.lastAt) : Number.NaN;
      const recent = Number.isFinite(now) && Number.isFinite(lastSandbox)
        && lastSandbox >= now - SANDBOX_RECENT_DAYS * DAY_MS;
      return finding(recent ? "error" : "warn", {
        count: dq.sandbox.subscriptions,
        evidence: ev(recent ? "sandboxActive" : "sandboxOnly", { count: dq.sandbox.subscriptions }),
      });
    },
    fix: { kind: "link", to: "/admin/billing" },
    owner: { to: "/admin/billing" },
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
