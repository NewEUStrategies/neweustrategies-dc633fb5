// Dialog anulowania subskrypcji (S2, P01, P02, Z-09) - NAJWYŻEJ 2 KROKI.
//
//   * `retention_settings.enabled = false` -> samo potwierdzenie (1 krok);
//   * włączony przepływ -> krok 1: powód (opcjonalny) + komentarz;
//     krok 2 (tylko gdy oferta się należy): rabat dopinany do subskrypcji.
//   * „Anuluj mimo to" jest widoczne na KAŻDYM kroku (DSA art. 25, wytyczne
//     UOKiK): ankieta i oferta nie mogą stać na drodze wyjścia - z kroku 1
//     anulowanie to jedno kliknięcie, z oferty też jedno.
//
// PRZEPŁYW W BAZIE. Otwarcie woła `startRetentionFlow` (wiersz `started` -
// mianownik skuteczności zatrzymania); decyzja aktualizuje TEN SAM wiersz
// (`submitRetentionFeedback`: `canceled` albo `saved`); zamknięcie okna bez
// decyzji zostawia `started`, który skaner po 24 h domyka jako porzucony.
// Start przepływu jest best-effort: jego awaria degraduje dialog do samego
// potwierdzenia, a NIE blokuje anulowania.
//
// OKNO ZAMYKA SIĘ WYŁĄCZNIE PO UDANEJ REZYGNACJI. Zamknięcie dialogu jest dla
// klienta najmocniejszym sygnałem „zrobione", więc po nieudanym anulowaniu
// okno zostaje z komunikatem (`role="alert"`) i pozwala ponowić.
// `onConfirmCancel` sygnalizuje porażkę ODRZUCENIEM promise'a.
//
// Ankieta jest zapisywana PO udanym anulowaniu i bez czekania na odpowiedź:
// wiszące połączenie z analityką nie może trzymać klienta w płatnej
// subskrypcji, a nieudane anulowanie nie może zostawić wpisu „anulowano".
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BadgePercent, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/lib/i18n/format";
import { reasonLabel, useRetentionReasons } from "@/lib/retention/queries";
import {
  acceptRetentionOffer,
  startRetentionFlow,
  submitRetentionFeedback,
  type RetentionFlowStart,
} from "@/lib/retention/functions";
import { ensureI18n as ensureRetentionI18n } from "@/lib/i18n-retention";
import { ensureI18n as ensureProfileI18n } from "@/lib/i18n-profile";

type Phase = "loading" | "confirm" | "reason" | "offer" | "accepted";

/** Wybór w ankiecie: id powodu z katalogu, „inny" albo nic (Z-09). */
type ReasonChoice = { kind: "none" } | { kind: "other" } | { kind: "catalog"; id: string };

interface AcceptedOffer {
  discountPct: number;
  discountPeriods: number;
}

export function RetentionDialog({
  open,
  onOpenChange,
  subscriptionId,
  onConfirmCancel,
  accessUntil = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionId: string;
  /**
   * Wykonuje rezygnację. MUSI odrzucić promise, gdy anulowanie nie przeszło -
   * inaczej dialog nie ma jak odróżnić skutku i zamknie się jak po sukcesie.
   */
  onConfirmCancel: () => Promise<void> | void;
  /** Koniec opłaconego okresu (ISO) - zdanie „dostęp zostaje do …". */
  accessUntil?: string | null;
}) {
  ensureRetentionI18n();
  ensureProfileI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";

  const startFlow = useServerFn(startRetentionFlow);
  const submitFeedback = useServerFn(submitRetentionFeedback);
  const acceptOffer = useServerFn(acceptRetentionOffer);

  const [phase, setPhase] = useState<Phase>("loading");
  const [flow, setFlow] = useState<RetentionFlowStart | null>(null);
  const [choice, setChoice] = useState<ReasonChoice>({ kind: "none" });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [offerShown, setOfferShown] = useState(false);
  const [offerFailed, setOfferFailed] = useState<"already_redeemed" | "unavailable" | null>(null);
  const [cancelFailed, setCancelFailed] = useState(false);
  const [accepted, setAccepted] = useState<AcceptedOffer | null>(null);

  // Każde otwarcie zaczyna od czystego stanu i od (wznowienia) przepływu.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPhase("loading");
    setFlow(null);
    setChoice({ kind: "none" });
    setComment("");
    setBusy(false);
    setOfferShown(false);
    setOfferFailed(null);
    setCancelFailed(false);
    setAccepted(null);
    Promise.resolve()
      .then(() => startFlow({ data: { subscriptionId } }))
      .then((started) => {
        if (!alive) return;
        setFlow(started);
        setPhase(started.surveyEnabled ? "reason" : "confirm");
      })
      .catch((error: unknown) => {
        // Bez przepływu nadal da się anulować - to jest wymóg, nie wygoda.
        console.error("[retention] flow start failed", error);
        if (alive) setPhase("confirm");
      });
    return () => {
      alive = false;
    };
  }, [open, subscriptionId, startFlow]);

  const surveyOpen = open && (phase === "reason" || phase === "offer");
  const reasonsQ = useRetentionReasons(surveyOpen);
  const reasons = useMemo(() => reasonsQ.data ?? [], [reasonsQ.data]);
  const offer = flow?.offer.available ? flow.offer : null;
  const twoSteps = offer !== null && offerFailed === null;

  const chosen = useMemo((): { reasonId: string | null; reasonLabel: string | null } => {
    if (choice.kind === "catalog") {
      const row = reasons.find((r) => r.id === choice.id);
      return { reasonId: choice.id, reasonLabel: row ? reasonLabel(row, lang) : null };
    }
    if (choice.kind === "other") return { reasonId: null, reasonLabel: t("retention.otherReason") };
    return { reasonId: null, reasonLabel: null };
  }, [choice, reasons, lang, t]);

  const record = (outcome: "canceled" | "saved") => {
    Promise.resolve()
      .then(() =>
        submitFeedback({
          data: {
            subscriptionId,
            feedbackId: flow?.feedbackId ?? null,
            outcome,
            offerShown,
            reasonId: chosen.reasonId,
            reasonLabel: chosen.reasonLabel,
            comment: comment.trim() || undefined,
          },
        }),
      )
      .catch((error: unknown) => console.error("[retention] feedback save failed", error));
  };

  const cancelNow = async () => {
    setBusy(true);
    setCancelFailed(false);
    try {
      await onConfirmCancel();
      record("canceled");
      onOpenChange(false);
    } catch (error) {
      console.error("[retention] cancel failed", error);
      setCancelFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const keep = () => {
    if (flow) record("saved");
    onOpenChange(false);
  };

  const showOffer = () => {
    setOfferShown(true);
    setPhase("offer");
  };

  const accept = async () => {
    if (!flow) return;
    setBusy(true);
    try {
      const result = await acceptOffer({
        data: {
          subscriptionId,
          feedbackId: flow.feedbackId,
          reasonId: chosen.reasonId,
          reasonLabel: chosen.reasonLabel,
          comment: comment.trim() || undefined,
        },
      });
      if (result.ok) {
        setAccepted({ discountPct: result.discountPct, discountPeriods: result.discountPeriods });
        setPhase("accepted");
      } else {
        setOfferFailed(result.reason === "already_redeemed" ? "already_redeemed" : "unavailable");
      }
    } catch (error) {
      console.error("[retention] offer failed", error);
      setOfferFailed("unavailable");
    } finally {
      setBusy(false);
    }
  };

  const spinner = busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />;
  const failedNote = cancelFailed && <CancelFailedNote message={t("retention.errors.cancel")} />;
  const stepLabel = (step: number) =>
    twoSteps ? (
      <p className="text-xs text-muted-foreground" data-retention-step={step}>
        {t("profile.retentionFlow.stepLabel", { step, total: 2 })}
      </p>
    ) : null;

  const keepButton = (
    <Button variant="ghost" disabled={busy} onClick={keep}>
      {t("profile.retentionFlow.keep")}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md" data-retention-phase={phase}>
        {(phase === "loading" || phase === "confirm") && (
          <>
            <DialogHeader>
              <DialogTitle>{t("profile.retentionFlow.confirmTitle")}</DialogTitle>
              <DialogDescription>
                {accessUntil
                  ? t("profile.retentionFlow.confirmBodyDate", {
                      date: formatDateShort(accessUntil, lang),
                    })
                  : t("profile.retentionFlow.confirmBody")}
              </DialogDescription>
            </DialogHeader>
            {phase === "loading" && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {t("profile.retentionFlow.loading")}
              </p>
            )}
            {failedNote}
            <DialogFooter className="gap-2">
              {keepButton}
              <Button variant="destructive" disabled={busy} onClick={() => void cancelNow()}>
                {spinner}
                {t("profile.retentionFlow.confirmCancel")}
              </Button>
            </DialogFooter>
          </>
        )}

        {phase === "reason" && (
          <>
            <DialogHeader>
              {stepLabel(1)}
              <DialogTitle>{t("retention.title")}</DialogTitle>
              <DialogDescription>{t("retention.subtitle")}</DialogDescription>
            </DialogHeader>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs font-medium">{t("retention.reasonHeading")}</legend>
              {reasonsQ.isLoading ? (
                <div className="space-y-1.5" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-9 animate-pulse rounded-md bg-muted/50" />
                  ))}
                </div>
              ) : (
                <>
                  {reasons.map((reason) => (
                    <ReasonOption
                      key={reason.id}
                      checked={choice.kind === "catalog" && choice.id === reason.id}
                      onSelect={() => setChoice({ kind: "catalog", id: reason.id })}
                      label={reasonLabel(reason, lang)}
                    />
                  ))}
                  <ReasonOption
                    checked={choice.kind === "other"}
                    onSelect={() => setChoice({ kind: "other" })}
                    label={t("retention.otherReason")}
                  />
                </>
              )}
              <p className="text-xs text-muted-foreground">
                {t("profile.retentionFlow.noReasonHint")}
              </p>
            </fieldset>
            <div>
              <Label htmlFor="retention-comment" className="text-xs">
                {t("retention.commentLabel")}
              </Label>
              <Textarea
                id="retention-comment"
                rows={3}
                maxLength={2000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t("retention.commentPlaceholder")}
              />
            </div>
            {failedNote}
            <DialogFooter className="gap-2">
              {keepButton}
              <Button variant="destructive" disabled={busy} onClick={() => void cancelNow()}>
                {spinner}
                {t("profile.retentionFlow.cancelAnyway")}
              </Button>
              {twoSteps && (
                <Button disabled={busy} onClick={showOffer}>
                  {t("profile.retentionFlow.next")}
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {phase === "offer" && offer && (
          <>
            <DialogHeader>
              {stepLabel(2)}
              <DialogTitle>{t("retention.offer.title")}</DialogTitle>
            </DialogHeader>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 text-center">
              <BadgePercent className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
              <p className="mt-2 text-lg font-semibold">
                {t("retention.offer.body", {
                  pct: offer.discountPct,
                  count: offer.discountPeriods,
                })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("profile.retentionFlow.offer.hint")}
              </p>
            </div>
            {offerFailed && (
              <p
                role="status"
                className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
              >
                {offerFailed === "already_redeemed"
                  ? t("retention.offer.alreadyRedeemed")
                  : t("profile.retentionFlow.offer.unavailable")}
              </p>
            )}
            <p className="text-center text-xs text-muted-foreground">
              {t("retention.offer.downgradeHint")}{" "}
              <Link
                to="/pricing"
                className="font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => onOpenChange(false)}
              >
                {t("retention.offer.downgradeCta")}
              </Link>
            </p>
            {failedNote}
            <DialogFooter className="gap-2 sm:flex-col">
              {!offerFailed && (
                <Button className="w-full" disabled={busy} onClick={() => void accept()}>
                  {spinner}
                  {t("retention.offer.accept", { pct: offer.discountPct })}
                </Button>
              )}
              <Button
                variant="destructive"
                className="w-full"
                disabled={busy}
                onClick={() => void cancelNow()}
              >
                {t("profile.retentionFlow.cancelAnyway")}
              </Button>
              {offerFailed && (
                <Button variant="ghost" className="w-full" disabled={busy} onClick={keep}>
                  {t("profile.retentionFlow.keep")}
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {phase === "accepted" && accepted && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Check className="h-5 w-5 text-primary" aria-hidden="true" />
                {t("profile.retentionFlow.accepted.title")}
              </DialogTitle>
              <DialogDescription>
                {t("profile.retentionFlow.accepted.body", {
                  pct: accepted.discountPct,
                  count: accepted.discountPeriods,
                })}
              </DialogDescription>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              {t("profile.retentionFlow.accepted.note")}
            </p>
            <DialogFooter>
              <Button className="w-full" onClick={() => onOpenChange(false)}>
                {t("profile.retentionFlow.accepted.close")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReasonOption({
  checked,
  onSelect,
  label,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
        checked ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/40",
      )}
    >
      <input
        type="radio"
        name="retention-reason"
        className="h-3.5 w-3.5 accent-primary"
        checked={checked}
        onChange={onSelect}
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * Komunikat o NIEUDANEJ rezygnacji. `role="alert"`: klient, który właśnie
 * kliknął „anuluj", musi usłyszeć od czytnika ekranu, że subskrypcja jest
 * nadal aktywna - brak zmiany na ekranie zostałby odczytany jako brak reakcji.
 */
function CancelFailedNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      {message}
    </p>
  );
}
