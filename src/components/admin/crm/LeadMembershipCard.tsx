// Karta członkostwa przy leadzie CRM: efektywna warstwa (ta sama reguła co
// current_membership_tier), źródło (subskrypcja / nadanie / organizacja /
// domyślna), aktywny plan płatny i organizacja. Sprzedaż widzi od razu, czy
// rozmawia z płacącym członkiem - bez przełączania do panelu użytkowników.
// Klucz zapytania pochodzi z billingKeys, więc zdarzenia subscription.* /
// membership_grant.* / organization.* z szyny domenowej odświeżają kartę na
// żywo (mapa inwalidacji).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Crown } from "lucide-react";
import { billingKeys } from "@/lib/billing/keys";
import { getCrmLeadMembership } from "@/lib/crm.functions";
import type { CrmLeadMembershipSummary } from "@/lib/crm/membershipSummary";

type Props = { leadId: string; lang: "pl" | "en" };

const SOURCE_LABELS: Record<CrmLeadMembershipSummary["source"], { pl: string; en: string }> = {
  subscription: { pl: "subskrypcja", en: "subscription" },
  grant: { pl: "nadanie", en: "grant" },
  organization: { pl: "organizacja", en: "organisation" },
  default: { pl: "warstwa domyślna", en: "default tier" },
};

export function LeadMembershipCard({ leadId, lang }: Props) {
  const fn = useServerFn(getCrmLeadMembership);
  const q = useQuery({
    queryKey: billingKeys.crmLeadMembership(leadId),
    queryFn: async () => {
      const r = (await fn({ data: { id: leadId } })) as { json: string };
      return JSON.parse(r.json) as CrmLeadMembershipSummary | null;
    },
    staleTime: 60_000,
  });

  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL") : null;

  const summary = q.data ?? null;
  const tierLabel = summary?.tier
    ? lang === "en"
      ? summary.tier.name_en || summary.tier.name_pl
      : summary.tier.name_pl || summary.tier.name_en
    : null;
  const planLabel = summary?.subscription?.plan
    ? lang === "en"
      ? summary.subscription.plan.name_en || summary.subscription.plan.name_pl
      : summary.subscription.plan.name_pl || summary.subscription.plan.name_en
    : null;
  const periodEnd = fmtDate(summary?.subscription?.current_period_end ?? null);

  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-center gap-1.5 border-b px-3 py-2 text-[12px] font-medium">
        <Crown className="h-3.5 w-3.5" aria-hidden="true" />
        {t("Członkostwo", "Membership")}
      </div>
      <div className="space-y-2 p-3">
        {q.isLoading ? (
          <div className="text-[11px] text-muted-foreground">{t("Ładowanie…", "Loading…")}</div>
        ) : !summary ? (
          <div className="text-[11px] text-muted-foreground">
            {t(
              "Brak powiązanego konta - lead nie ma jeszcze profilu na platformie.",
              "No linked account - this lead has no platform profile yet.",
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {tierLabel ?? t("bez warstwy", "no tier")}
              </span>
              {summary.tier && (
                <span className="text-[10px] text-muted-foreground">
                  {t("ranga", "rank")} {summary.tier.rank}
                </span>
              )}
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {SOURCE_LABELS[summary.source][lang]}
              </span>
            </div>

            {summary.subscription && (
              <div className="rounded border p-2 text-[11px]">
                <div className="font-medium">{planLabel ?? t("Plan płatny", "Paid plan")}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {summary.subscription.canceled_at
                    ? periodEnd
                      ? t(
                          `Anulowana - dostęp do ${periodEnd}`,
                          `Cancelled - access until ${periodEnd}`,
                        )
                      : t("Anulowana", "Cancelled")
                    : periodEnd
                      ? t(`Aktywna - odnowienie ${periodEnd}`, `Active - renews ${periodEnd}`)
                      : t("Aktywna - bezterminowo", "Active - no expiry")}
                </div>
              </div>
            )}

            {summary.organization && (
              <div className="text-[10px] text-muted-foreground">
                {t("Organizacja", "Organisation")}:{" "}
                <span className="font-medium text-foreground">{summary.organization.name}</span>
              </div>
            )}

            {summary.active_grants > 0 && (
              <div className="text-[10px] text-muted-foreground">
                {t("Aktywne nadania poza planem", "Active off-plan grants")}:{" "}
                <span className="tabular-nums font-medium text-foreground">
                  {summary.active_grants}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
