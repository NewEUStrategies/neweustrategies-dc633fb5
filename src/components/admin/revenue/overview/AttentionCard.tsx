// Organizm: „Wymaga uwagi" na Kokpicie huba (SPEC §2.2 `overview`, §6.1) -
// trzy najpoważniejsze OTWARTE diagnozy (waga, skutek trwający przed
// ukrytym, wpływ, liczba) jako zwarte `DiagnosticCard` i odnośnik do pełnej
// Diagnostyki. Montuje ją Kokpit (S7-B).
//
// TA SAMA OCENA CO DIAGNOSTYKA: fakty i wyciszenia z fabryk
// `revenueFactsQueryOptions` / `revenueSnoozesQueryOptions` i wybór
// `topAttention` - karta nie liczy „najważniejszych" po swojemu, więc to, co
// widać na Kokpicie, jest pierwszą pozycją listy w Diagnostyce.
//
// „Napraw" z karty prowadzi do Diagnostyki z `?fix=` (dialog naprawy
// mieszka tam, razem z ponowną oceną i „Cofnij"), zamiast otwierać drugi
// egzemplarz dialogu na Kokpicie.
//
// Brak faktów (`unavailable`, błąd) mówi „nie da się teraz ocenić", nigdy
// „nic pilnego" - pusta lista przy braku danych byłaby cichą zielenią.
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { DiagnosticCard } from "@/components/admin/revenue/diagnostics/DiagnosticCard";
import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import { Button } from "@/components/ui/button";
import { topAttention } from "@/lib/admin/revenue/diagnosticGroups";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";
import {
  evaluateFindings,
  revenueFactsQueryOptions,
  revenueSnoozesQueryOptions,
} from "@/lib/revenue/diagnostics/queries";

/** Ile diagnoz pokazuje Kokpit (SPEC §2.2: „top 3"). */
export const ATTENTION_LIMIT = 3;

export interface AttentionCardProps {
  tenantId: string | null;
  roles: readonly string[];
}

export function AttentionCard({ tenantId, roles }: AttentionCardProps) {
  ensureI18n();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const roleOk = roles.includes("admin") || roles.includes("editor");
  const facts = useQuery(revenueFactsQueryOptions(tenantId, { roleOk }));
  const snoozes = useQuery(revenueSnoozesQueryOptions(tenantId, { roleOk }));

  const top = useMemo(() => {
    if (facts.data?.state !== "ready") return null;
    const active = snoozes.data?.state === "ready" ? snoozes.data.snoozes : [];
    return topAttention(evaluateFindings(facts.data.facts, active), ATTENTION_LIMIT);
  }, [facts.data, snoozes.data]);

  if (!roleOk || !tenantId) return null;
  // Odmowa roli albo MFA: Kokpit pokazuje powiadomienie układu, nie kartę.
  if (facts.data?.state === "forbidden" || facts.data?.state === "mfa_required") return null;

  const allLink = (
    <Button asChild size="sm" variant="outline" className="h-7">
      <Link to="/admin/revenue/$tab" params={{ tab: "diagnostics" }}>
        {t("adminRevenue.attention.all")}
      </Link>
    </Button>
  );

  let body;
  if (top === null) {
    body =
      facts.isPending && !facts.isError ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminRevenue.attention.loading")}
        </p>
      ) : (
        <p role="status" className="m-0 text-sm text-muted-foreground" data-testid="attention-unknown">
          {t("adminRevenue.attention.unknown")}
        </p>
      );
  } else if (top.length === 0) {
    body = (
      <p role="status" className="m-0 text-sm text-muted-foreground" data-testid="attention-empty">
        {t("adminRevenue.attention.empty")}
      </p>
    );
  } else {
    body = (
      <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-3">
        {top.map((finding) => (
          <li key={finding.checkId} className="min-w-0">
            <DiagnosticCard
              finding={finding}
              variant="compact"
              className="h-full"
              factsAt={facts.data?.state === "ready" ? facts.data.facts.computedAt : null}
              onFix={() =>
                void navigate({
                  to: "/admin/revenue/$tab",
                  params: { tab: "diagnostics" },
                  search: { fix: finding.checkId },
                })
              }
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div data-testid="revenue-attention">
      <RevenueSection
        titleKey="adminRevenue.attention.title"
        descriptionKey="adminRevenue.attention.description"
        actions={allLink}
      >
        {body}
      </RevenueSection>
    </div>
  );
}
