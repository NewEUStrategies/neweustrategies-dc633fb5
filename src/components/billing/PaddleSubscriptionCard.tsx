// Portal klienta w profilu: pełna obsługa subskrypcji bez opuszczania ekranu -
// podgląd planu i statusu, zmiana planu (upgrade proporcjonalnie, downgrade od
// nowego okresu), aktualizacja metody płatności oraz anulowanie z zachowaniem
// opłaconego okresu. Dane pochodzą z tabeli `subscriptions` (filtr środowiska),
// akcje z server fn opartych o zweryfikowaną sesję użytkownika.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  CreditCard,
  ExternalLink,
  Loader2,
  Minus,
  PauseCircle,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { billingKeys } from "@/lib/billing/keys";
import { fetchActivePlans } from "@/lib/billing/queries";
import {
  canResumePaddleSubscription,
  catalogEntryFor,
  fetchMyPaddleSubscription,
  isPaddleSubscriptionActive,
  type PaddleSubscriptionRow,
} from "@/lib/billing/paddleSubscription";
import { paddlePriceForPlan, planChangeDirection } from "@/lib/billing/paddleCatalog";
import { formatMoney, planName, type AccessPlan } from "@/lib/billing/types";
import { getPaddleEnvironment } from "@/lib/paddle";
import {
  cancelPaddleSubscription,
  changePaddlePlan,
  createPaddlePortalSession,
  previewPaddlePlanChange,
  resumePaddleSubscription,
  updatePaddleSubscriptionSeats,
} from "@/utils/payments.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Hook współdzielony przez profil i strażników dostępu. */
export function useMyPaddleSubscription() {
  const { session } = useAuth();
  const env = getPaddleEnvironment();
  return useQuery({
    queryKey: billingKeys.myPaddleSubscription(session?.user?.id, env),
    queryFn: fetchMyPaddleSubscription,
    enabled: !!session,
  });
}

export function PaddleSubscriptionCard({ subscription }: { subscription: PaddleSubscriptionRow }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  const environment = getPaddleEnvironment();
  const [targetPriceId, setTargetPriceId] = useState("");
  const [seats, setSeats] = useState(Math.max(1, subscription.quantity ?? 1));

  const plansQ = useQuery({ queryKey: billingKeys.plansActive(), queryFn: fetchActivePlans });
  const entry = catalogEntryFor(subscription);

  const currentPlan = useMemo<AccessPlan | null>(
    () =>
      (plansQ.data ?? []).find((plan) => paddlePriceForPlan(plan)?.priceId === entry?.priceId) ??
      null,
    [plansQ.data, entry?.priceId],
  );

  const targets = useMemo(
    () =>
      (plansQ.data ?? [])
        .map((plan) => ({ plan, price: paddlePriceForPlan(plan) }))
        .filter(
          (item): item is { plan: AccessPlan; price: NonNullable<typeof item.price> } =>
            !!item.price && item.price.priceId !== entry?.priceId,
        ),
    [plansQ.data, entry?.priceId],
  );

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: billingKeys.myPaddleSubscriptionAll() });
    void qc.invalidateQueries({ queryKey: billingKeys.currentTierAll() });
  };

  const changePlan = useMutation({
    mutationFn: (priceId: string) =>
      changePaddlePlan({ data: { targetPriceId: priceId, environment } }),
    onSuccess: (result) => {
      setTargetPriceId("");
      refresh();
      toast.success(
        result.direction === "downgrade"
          ? t("profile.subscription.portal.downgradeScheduled")
          : t("profile.subscription.changePlan.success"),
      );
    },
    onError: () => toast.error(t("profile.subscription.changePlan.error")),
  });

  const cancel = useMutation({
    mutationFn: () => cancelPaddleSubscription({ data: { environment } }),
    onSuccess: () => {
      refresh();
      toast.success(t("profile.subscription.canceled"));
    },
    onError: () => toast.error(t("profile.subscription.cancelFailed")),
  });

  const resume = useMutation({
    mutationFn: () => resumePaddleSubscription({ data: { environment } }),
    onSuccess: (result) => {
      refresh();
      toast.success(
        result.mode === "unpaused"
          ? t("profile.subscription.portal.paused.success")
          : t("profile.subscription.resumed"),
      );
    },
    onError: () => toast.error(t("profile.subscription.resumeError")),
  });

  // Podgląd kosztu liczy operator - pokazujemy go zanim klient potwierdzi
  // zmianę, żeby nikt nie zobaczył dopłaty dopiero na wyciągu z karty.
  const previewQ = useQuery({
    queryKey: billingKeys.planChangePreview(subscription.id, targetPriceId, environment),
    queryFn: () => previewPaddlePlanChange({ data: { targetPriceId, environment } }),
    enabled: !!targetPriceId,
    staleTime: 60_000,
  });

  const seatsMutation = useMutation({
    mutationFn: (quantity: number) =>
      updatePaddleSubscriptionSeats({ data: { quantity, environment } }),
    onSuccess: () => {
      refresh();
      toast.success(t("profile.subscription.portal.seats.success"));
    },
    onError: () => toast.error(t("profile.subscription.portal.seats.error")),
  });

  const portal = useMutation({
    mutationFn: (mode: "payment" | "overview") =>
      createPaddlePortalSession({ data: { environment } }).then((session) => ({ session, mode })),
    onSuccess: ({ session, mode }) => {
      const url =
        mode === "payment"
          ? (session.updatePaymentMethodUrl ?? session.overviewUrl)
          : session.overviewUrl;
      // Portal dostawcy nie działa w iframe - zawsze nowa karta.
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: () => toast.error(t("profile.subscription.portal.error")),
  });

  const busy =
    changePlan.isPending ||
    cancel.isPending ||
    resume.isPending ||
    portal.isPending ||
    seatsMutation.isPending;

  const perSeat = !!entry?.perSeat;
  const currentSeats = Math.max(1, subscription.quantity ?? 1);

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL") : "-";

  const direction = targetPriceId
    ? planChangeDirection(subscription.price_id, targetPriceId)
    : "same";
  const canResume = canResumePaddleSubscription(subscription);
  const active = isPaddleSubscriptionActive(subscription);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>{t("profile.subscription.title")}</span>
          <Badge variant={active ? "default" : "secondary"}>
            {t(`profile.subscription.portal.status.${subscription.status}`, {
              defaultValue: subscription.status,
            })}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("profile.subscription.plan")}>
            <div className="text-lg font-semibold">
              {currentPlan
                ? planName(currentPlan, lang)
                : (entry?.tierKey ?? subscription.price_id)}
            </div>
            {currentPlan && (
              <div className="text-sm text-muted-foreground">
                {formatMoney(currentPlan.price_cents, currentPlan.currency, lang)}
                {subscription.quantity > 1 ? ` × ${subscription.quantity}` : ""}
              </div>
            )}
          </Field>
          <Field
            label={
              subscription.cancel_at_period_end
                ? t("profile.subscription.cancelsAt")
                : t("profile.subscription.renewsAt")
            }
          >
            <div>{fmtDate(subscription.current_period_end)}</div>
          </Field>
        </div>

        {subscription.status === "past_due" && (
          <p className="rounded-[6px] border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm">
            {t("profile.subscription.portal.pastDue")}
          </p>
        )}

        {/* Wstrzymana subskrypcja - dostęp wraca dopiero po wznowieniu. */}
        {subscription.status === "paused" && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-border/60 bg-muted/30 px-3 py-2.5">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <PauseCircle className="h-4 w-4 shrink-0" aria-hidden />
              {t("profile.subscription.portal.paused.note")}
            </p>
            <Button size="sm" disabled={busy} onClick={() => resume.mutate()}>
              {resume.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("profile.subscription.portal.paused.cta")}
            </Button>
          </div>
        )}

        {subscription.cancel_at_period_end && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-border/60 bg-muted/30 px-3 py-2.5">
            <p className="text-sm text-muted-foreground">
              {t("profile.subscription.accessUntil", {
                date: fmtDate(subscription.current_period_end),
              })}
            </p>
            {canResume && (
              <Button size="sm" disabled={busy} onClick={() => resume.mutate()}>
                {resume.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("profile.subscription.resume")}
              </Button>
            )}
          </div>
        )}

        {/* Zmiana planu inline - bez przechodzenia na cennik. */}
        <div className="space-y-2 rounded-[6px] border border-border/60 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ArrowRightLeft className="h-4 w-4" aria-hidden />
            {t("profile.subscription.changePlan.title")}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("profile.subscription.portal.changeHint")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Select value={targetPriceId} onValueChange={setTargetPriceId} disabled={busy}>
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue placeholder={t("profile.subscription.changePlan.placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {targets.map(({ plan, price }) => (
                  <SelectItem key={price.priceId} value={price.priceId}>
                    {planName(plan, lang)} - {formatMoney(plan.price_cents, plan.currency, lang)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={!targetPriceId || busy}
              onClick={() => changePlan.mutate(targetPriceId)}
            >
              {changePlan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("profile.subscription.changePlan.cta")}
            </Button>
          </div>
          {direction !== "same" && (
            <p className="text-xs text-muted-foreground">
              {direction === "upgrade"
                ? t("profile.subscription.portal.upgradeNote")
                : t("profile.subscription.portal.downgradeNote")}
            </p>
          )}
          {targetPriceId && (
            <p className="text-xs font-medium">
              {previewQ.isLoading
                ? t("profile.subscription.portal.preview.loading")
                : previewQ.data?.amountCents != null && previewQ.data.currency
                  ? previewQ.data.direction === "upgrade"
                    ? t("profile.subscription.portal.preview.upgrade", {
                        amount: formatMoney(
                          previewQ.data.amountCents,
                          previewQ.data.currency,
                          lang,
                        ),
                      })
                    : t("profile.subscription.portal.preview.downgrade", {
                        amount: formatMoney(
                          previewQ.data.amountCents,
                          previewQ.data.currency,
                          lang,
                        ),
                        date: fmtDate(previewQ.data.nextBilledAt ?? null),
                      })
                  : t("profile.subscription.portal.preview.unavailable")}
            </p>
          )}
        </div>

        {/* Miejsca w planie zespołowym - w górę i w dół, bez kontaktu z nami. */}
        {perSeat && (
          <div className="space-y-2 rounded-[6px] border border-border/60 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" aria-hidden />
              {t("profile.subscription.portal.seats.title")}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("profile.subscription.portal.seats.hint")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label={`${t("profile.subscription.portal.seats.label")} -1`}
                  disabled={busy || seats <= 1}
                  onClick={() => setSeats((n) => Math.max(1, n - 1))}
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </Button>
                <span className="min-w-10 text-center text-lg font-semibold tabular-nums">
                  {seats}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label={`${t("profile.subscription.portal.seats.label")} +1`}
                  disabled={busy || seats >= 500}
                  onClick={() => setSeats((n) => Math.min(500, n + 1))}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <Button
                disabled={busy || seats === currentSeats}
                onClick={() => seatsMutation.mutate(seats)}
              >
                {seatsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("profile.subscription.portal.seats.cta")}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => portal.mutate("payment")}>
            <CreditCard className="mr-2 h-4 w-4" aria-hidden />
            {t("profile.subscription.portal.updatePayment")}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => portal.mutate("overview")}>
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
            {t("profile.subscription.portal.openPortal")}
          </Button>
          {!subscription.cancel_at_period_end && subscription.status !== "canceled" && (
            <Button variant="destructive" disabled={busy} onClick={() => cancel.mutate()}>
              {cancel.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("profile.subscription.cancel")}
            </Button>
          )}
        </div>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {t("profile.subscription.portal.secureNote")}
        </p>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
