// Organizm: katalog planów dostępu (`access_plans`) w /admin/paywall i w hubie
// „Przychód i lejek" (S7 reużywa go bez zmian - PLAN S1 §4.7).
//
// CO SIĘ ZMIENIŁO WZGLĘDEM EKRANU SPRZED S1 (DIAGNOZA paywalla, def. 3 i 4):
//   * ODCZYT `adminPlansAllQueryOptions()` - klucz `billingKeys.admin.plansAll()`,
//     który unieważnia szyna przy `access_plan.changed.v1`. Dawny literał
//     `["admin-access-plans"]` nie był w mapie szyny, więc zmiana planu
//     w Członkostwie nie docierała tutaj do przeładowania strony.
//   * SPRZEDAŻ OSOBNO OD AKTYWNOŚCI. Kolumna „Sprzedaż" (`for_sale`, cennik
//     v6.2) była niewidoczna dla admina. „Wycofany" = nie przyjmuje nowych
//     zakupów, ale obecni klienci odnawiają się; „Nieaktywny" odcina wszystkich
//     (webhook mapuje cenę tylko na plan aktywny - PLAN S1 V3).
//   * PLAN NIESPRZEDAWALNY WIDAĆ OD RAZU. Plan w sprzedaży (poza jednorazowym)
//     bez pary (warstwa, cykl) w `BILLING_CATALOG` kończy zakup w kasie błędem
//     `plan_price_missing` - odznaka mówi to przy wierszu, zanim powie klient.
//   * USUWANIE (D-S1-05). FK `user_subscriptions.plan_id … ON DELETE CASCADE`
//     kasuje subskrypcje razem z historią klientów. Redaktor nie usuwa wcale
//     (SQL i tak go nie wpuści - polityka `plans staff delete` jest dla
//     admina), więc przycisk jest wyłączony z powodem. Admin dostaje dialog
//     z LICZBĄ subskrypcji; przy liczbie > 0 usunięcie jest zablokowane, a akcją
//     zastępczą jest „Wycofaj ze sprzedaży" (patch `for_sale = false`).
//
// Edycja żyje w `AccessPlanEditorDialog` - sekcja tylko zgłasza `onEdit(id)`
// (`null` = nowy plan), a trasa trzyma identyfikator w `?plan=`.
import { useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Layers, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";

import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import { planMissingCatalogPair } from "@/components/admin/paywall/accessPlanDraft";
import { DisabledReason } from "@/components/admin/pricing/atoms/DisabledReason";
import { HintTooltip } from "@/components/admin/pricing/atoms/HintTooltip";
import { showSaveError } from "@/components/admin/pricing/saveErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { confirmDialog } from "@/lib/appDialogs";
import { convertToDisplayCurrency } from "@/lib/billing/displayCurrency";
import {
  adminPlansAllQueryOptions,
  isPlanHasSubscriptionsError,
  planSubscriptionCountQueryOptions,
  useDeleteAccessPlan,
  useSaveAccessPlanPatch,
  type AccessPlanRow,
} from "@/lib/billing/planQueries";
import { formatMoney, planName } from "@/lib/billing/types";
import { ensureI18n } from "@/lib/i18n-admin-paywall-sync";
import { toastError } from "@/lib/toastError";

export function PaywallPlansSection({
  onEdit,
  readOnly = false,
}: {
  /** Otwórz edytor planu (`null` = nowy plan). */
  onEdit: (planId: string | null) => void;
  /** Hub S7 dla redaktora: podgląd bez akcji zapisu. */
  readOnly?: boolean;
}) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  // `isAdmin` obejmuje też `super_admin`, którego polityka DELETE na
  // `access_plans` NIE wpuszcza - przycisk dostępny dla niego kończyłby się
  // cichym „0 usuniętych wierszy". Uprawnienie = dokładnie rola SQL.
  const { roles } = useAuth();
  const canDelete = roles.includes("admin") && !readOnly;
  const plansQ = useQuery(adminPlansAllQueryOptions());
  const saveM = useSaveAccessPlanPatch("paywall");
  const deleteM = useDeleteAccessPlan();
  const plans = plansQ.data ?? [];
  const readOnlyReason = readOnly ? t("adminPaywall.readOnly.hint") : null;

  const withdraw = async (plan: AccessPlanRow) => {
    try {
      await saveM.mutateAsync({
        id: plan.id,
        expectedUpdatedAt: plan.updated_at,
        patch: { for_sale: false },
      });
      toast.success(t("adminPaywall.plans.withdrawnToast"));
    } catch (err) {
      showSaveError(err, t, () => void plansQ.refetch());
    }
  };

  const confirmBlocked = async (plan: AccessPlanRow, count: number) => {
    const name = planName(plan, lang);
    // Plan już wycofany: akcja zastępcza jest wykonana, zostaje tylko powód
    // odmowy - dialog z przyciskiem „Wycofaj" byłby pustym gestem.
    if (!plan.for_sale) {
      toast.error(t("adminPaywall.plans.deleteBlockedTitle", { name }), {
        description: t("adminPaywall.plans.alreadyWithdrawn"),
      });
      return;
    }
    const ok = await confirmDialog({
      title: t("adminPaywall.plans.deleteBlockedTitle", { name }),
      description: t("adminPaywall.plans.deleteBlockedDescription", { count }),
      confirmLabel: t("adminPaywall.plans.withdraw"),
    });
    if (ok) await withdraw(plan);
  };

  const remove = async (plan: AccessPlanRow) => {
    let count: number;
    try {
      // Świeża liczba przy każdym kliknięciu (`staleTime: 0`): decyzja
      // „wolno usunąć" nie może stać na liczbie sprzed minuty.
      count = await qc.fetchQuery({ ...planSubscriptionCountQueryOptions(plan.id), staleTime: 0 });
    } catch (err) {
      console.error("[paywall] subscription count failed", err);
      toast.error(t("adminPaywall.plans.countError"));
      return;
    }
    if (count > 0) return confirmBlocked(plan, count);
    const name = planName(plan, lang);
    const ok = await confirmDialog({
      title: t("adminPaywall.plans.deleteTitle", { name }),
      description: t("adminPaywall.plans.deleteDescription"),
      confirmLabel: t("adminPaywall.plans.deleteConfirm"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteM.mutateAsync({ id: plan.id });
      toast.success(t("adminPaywall.plans.deleted"));
    } catch (err) {
      // Ktoś kupił plan, gdy dialog stał otwarty: mutator sprawdził liczbę
      // ponownie i odmówił - prowadzimy admina do akcji zastępczej.
      if (isPlanHasSubscriptionsError(err)) return confirmBlocked(plan, err.subscriptionCount);
      toastError(err, "delete");
    }
  };

  const columns = 6;

  return (
    <SectionCard
      icon={Layers}
      title={t("adminPaywall.plans.title")}
      description={t("adminPaywall.plans.description")}
      padded={false}
    >
      <div className="flex justify-end border-b border-border/60 px-5 py-3">
        <DisabledReason reason={readOnlyReason}>
          <Button size="sm" disabled={readOnly} onClick={() => onEdit(null)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("adminPaywall.plans.add")}
          </Button>
        </DisabledReason>
      </div>
      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label={t("adminPaywall.plans.caption")}
      >
        <table className="w-full text-sm">
          <caption className="sr-only">{t("adminPaywall.plans.caption")}</caption>
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="p-3 text-left font-medium">
                {t("adminPaywall.plans.colName")}
              </th>
              <th scope="col" className="p-3 text-left font-medium">
                {t("adminPaywall.plans.colPrice")}
              </th>
              <th scope="col" className="p-3 text-left font-medium">
                {t("adminPaywall.plans.colInterval")}
              </th>
              <th scope="col" className="p-3 text-left font-medium">
                {t("adminPaywall.plans.colStatus")}
              </th>
              <th scope="col" className="p-3 text-left font-medium">
                {t("adminPaywall.plans.colSale")}
              </th>
              <th scope="col" className="p-3 text-right font-medium">
                <span className="sr-only">{t("adminPaywall.plans.colActions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <PlanRow
                key={plan.id}
                plan={plan}
                lang={lang}
                deleteReason={
                  canDelete ? null : (readOnlyReason ?? t("adminPaywall.plans.deleteAdminOnly"))
                }
                deleting={deleteM.isPending}
                onEdit={() => onEdit(plan.id)}
                onDelete={() => void remove(plan)}
              />
            ))}
            {(plansQ.isPending || plansQ.isError || plans.length === 0) && (
              <tr>
                <td colSpan={columns} className="p-6 text-center text-sm text-muted-foreground">
                  {plansQ.isError ? (
                    <span role="alert" className="inline-flex items-center gap-2">
                      {t("adminPaywall.plans.readError")}
                      <Button size="sm" variant="outline" onClick={() => void plansQ.refetch()}>
                        {t("adminPaywall.plans.retry")}
                      </Button>
                    </span>
                  ) : plansQ.isPending ? (
                    <span role="status">{t("common.loading")}</span>
                  ) : (
                    t("adminPaywall.plans.empty")
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

/** Wiersz planu - własny komponent, bo podpowiedź katalogu potrzebuje `useId`. */
function PlanRow({
  plan,
  lang,
  deleteReason,
  deleting,
  onEdit,
  onDelete,
}: {
  plan: AccessPlanRow;
  lang: "pl" | "en";
  /** Powód blokady usuwania albo `null` (admin). */
  deleteReason: string | null;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const name = planName(plan, lang);
  const missingPair = planMissingCatalogPair(plan);
  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/40">
      <td className="p-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{name}</span>
          {plan.highlighted && (
            <Badge variant="secondary" className="h-5 rounded-[6px] px-1.5 text-[10px]">
              <Sparkles className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
              {t("adminPaywall.plans.highlighted")}
            </Badge>
          )}
        </div>
        {plan.name_en && plan.name_pl && (
          <div className="text-xs text-muted-foreground">
            {lang === "en" ? plan.name_pl : plan.name_en}
          </div>
        )}
      </td>
      <td className="p-3 tabular-nums">
        {formatMoney(plan.price_cents, plan.currency, lang)}
        {plan.currency.toUpperCase() === "PLN" && (
          <div className="text-[11px] text-muted-foreground">
            {t("adminPaywall.plans.eurApprox", {
              amount: formatMoney(
                convertToDisplayCurrency(plan.price_cents, plan.currency, "EUR").cents,
                "EUR",
                lang,
              ),
            })}
          </div>
        )}
      </td>
      <td className="p-3 text-muted-foreground">{t(`adminPaywall.interval.${plan.interval}`)}</td>
      <td className="p-3">
        {plan.active ? (
          <Badge variant="secondary" className="rounded-[6px]">
            {t("adminPaywall.plans.active")}
          </Badge>
        ) : (
          <Badge variant="outline" className="rounded-[6px] text-muted-foreground">
            {t("adminPaywall.plans.inactive")}
          </Badge>
        )}
      </td>
      <td className="p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {plan.for_sale ? (
            <Badge variant="secondary" className="rounded-[6px]">
              {t("adminPaywall.plans.forSale")}
            </Badge>
          ) : (
            <Badge variant="outline" className="rounded-[6px] text-muted-foreground">
              {t("adminPaywall.plans.withdrawn")}
            </Badge>
          )}
          {missingPair && (
            <span className="inline-flex items-center gap-0.5">
              <Badge
                variant="outline"
                aria-describedby={hintId}
                className="gap-1 rounded-[6px] border-destructive/40 text-destructive"
              >
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {t("adminPaywall.plans.noCatalogPair")}
              </Badge>
              <HintTooltip
                id={hintId}
                text={t("adminPaywall.plans.noCatalogPairHint")}
                label={t("adminPaywall.plans.noCatalogPair")}
              />
            </span>
          )}
        </div>
      </td>
      <td className="p-3">
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="outline"
            aria-label={t("adminPaywall.plans.editLabel", { name })}
            onClick={onEdit}
          >
            <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t("adminPaywall.plans.edit")}
          </Button>
          <DisabledReason reason={deleteReason}>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              aria-label={t("adminPaywall.plans.deleteLabel", { name })}
              disabled={deleteReason !== null || deleting}
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DisabledReason>
        </div>
      </td>
    </tr>
  );
}
