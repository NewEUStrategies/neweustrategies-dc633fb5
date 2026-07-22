// Dialog retencyjny w przepływie anulowania subskrypcji:
//   1) ankieta powodu (katalog powodów z panelu admina + komentarz),
//   2) kontrofertka rabatowa (procent / liczba płatności / ważność z
//      retention_settings) - akceptacja tworzy personalny kupon B2B,
//   3) ekran z kodem do skopiowania.
// Zapis ankiety NIGDY nie blokuje anulowania - jeśli serwer analityki
// zawiedzie, rezygnacja i tak przechodzi (feedback jest best-effort).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BadgePercent, Check, Copy, Loader2 } from "lucide-react";
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
import { reasonLabel, useRetentionReasons, useRetentionSettings } from "@/lib/retention/queries";
import { acceptRetentionOffer, submitRetentionFeedback } from "@/lib/retention/functions";
import { ensureI18n as ensureRetentionI18n } from "@/lib/i18n-retention";

type Step = "reason" | "offer" | "accepted";

interface AcceptedOffer {
  code: string;
  discountPct: number;
  discountPeriods: number;
  validUntil: string;
}

export function RetentionDialog({
  open,
  onOpenChange,
  subscriptionId,
  onConfirmCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionId: string;
  onConfirmCancel: () => Promise<void> | void;
}) {
  ensureRetentionI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";

  const settingsQ = useRetentionSettings(open);
  const reasonsQ = useRetentionReasons(open);
  const submitFeedback = useServerFn(submitRetentionFeedback);
  const acceptOffer = useServerFn(acceptRetentionOffer);

  const [step, setStep] = useState<Step>("reason");
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [offerBlocked, setOfferBlocked] = useState(false);
  const [accepted, setAccepted] = useState<AcceptedOffer | null>(null);

  useEffect(() => {
    if (!open) {
      setStep("reason");
      setReasonId(null);
      setComment("");
      setBusy(false);
      setOfferBlocked(false);
      setAccepted(null);
    }
  }, [open]);

  const reasons = useMemo(() => reasonsQ.data ?? [], [reasonsQ.data]);
  const settings = settingsQ.data ?? null;
  const offerAvailable = !!settings && settings.enabled && settings.discount_pct > 0;

  const selectedLabel = useMemo(() => {
    const row = reasons.find((r) => r.id === reasonId);
    return row ? reasonLabel(row, lang) : t("retention.otherReason");
  }, [reasons, reasonId, lang, t]);

  // Ankieta jest best-effort: błąd zapisu nie może zablokować rezygnacji.
  const recordFeedback = async (offerShown: boolean) => {
    try {
      await submitFeedback({
        data: {
          subscriptionId,
          reasonId,
          reasonLabel: selectedLabel,
          comment: comment.trim() || undefined,
          offerShown,
        },
      });
    } catch (error) {
      console.error("[retention] feedback save failed", error);
    }
  };

  const finalizeCancel = async (offerShown: boolean) => {
    setBusy(true);
    try {
      await recordFeedback(offerShown);
      await onConfirmCancel();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const onContinue = async () => {
    if (offerAvailable) {
      setStep("offer");
      return;
    }
    await finalizeCancel(false);
  };

  const onAccept = async () => {
    setBusy(true);
    try {
      const result = await acceptOffer({
        data: {
          subscriptionId,
          reasonId,
          reasonLabel: selectedLabel,
          comment: comment.trim() || undefined,
        },
      });
      if (result.ok) {
        setAccepted({
          code: result.code,
          discountPct: result.discountPct,
          discountPeriods: result.discountPeriods,
          validUntil: result.validUntil,
        });
        setStep("accepted");
      } else {
        setOfferBlocked(true);
      }
    } catch {
      toast.error(t("retention.errors.offer"));
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!accepted) return;
    try {
      await navigator.clipboard.writeText(accepted.code);
      toast.success(t("retention.accepted.copied"));
    } catch {
      // Brak uprawnień schowka - kod pozostaje widoczny do przepisania.
    }
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL");

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        {step === "reason" && (
          <>
            <DialogHeader>
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
                    <label
                      key={reason.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                        reasonId === reason.id
                          ? "border-primary bg-primary/5"
                          : "border-border/60 hover:bg-muted/40",
                      )}
                    >
                      <input
                        type="radio"
                        name="retention-reason"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={reasonId === reason.id}
                        onChange={() => setReasonId(reason.id)}
                      />
                      <span>{reasonLabel(reason, lang)}</span>
                    </label>
                  ))}
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                      reasonId === null
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:bg-muted/40",
                    )}
                  >
                    <input
                      type="radio"
                      name="retention-reason"
                      className="h-3.5 w-3.5 accent-primary"
                      checked={reasonId === null}
                      onChange={() => setReasonId(null)}
                    />
                    <span>{t("retention.otherReason")}</span>
                  </label>
                </>
              )}
            </fieldset>
            <div>
              <Label htmlFor="retention-comment" className="text-xs">
                {t("retention.commentLabel")}
              </Label>
              <Textarea
                id="retention-comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t("retention.commentPlaceholder")}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
                {t("retention.keep")}
              </Button>
              <Button variant="destructive" disabled={busy} onClick={onContinue}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t("retention.continue")}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "offer" && settings && (
          <>
            <DialogHeader>
              <DialogTitle>{t("retention.offer.title")}</DialogTitle>
            </DialogHeader>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 text-center">
              <BadgePercent className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
              <p className="mt-2 text-lg font-semibold">
                {t("retention.offer.body", {
                  pct: settings.discount_pct,
                  periods: settings.discount_periods,
                })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("retention.offer.hint", { days: settings.coupon_valid_days })}
              </p>
            </div>
            {offerBlocked && (
              <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {t("retention.offer.alreadyRedeemed")}
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
            <DialogFooter className="gap-2 sm:flex-col">
              {!offerBlocked && (
                <Button className="w-full" disabled={busy} onClick={onAccept}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t("retention.offer.accept", { pct: settings.discount_pct })}
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => finalizeCancel(true)}
              >
                {t("retention.offer.declineAndCancel")}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "accepted" && accepted && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Check className="h-5 w-5 text-primary" aria-hidden="true" />
                {t("retention.accepted.title")}
              </DialogTitle>
              <DialogDescription>
                {t("retention.accepted.body", {
                  pct: accepted.discountPct,
                  periods: accepted.discountPeriods,
                  date: fmtDate(accepted.validUntil),
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5">
              <code className="text-base font-semibold tracking-wide">{accepted.code}</code>
              <Button size="sm" variant="outline" onClick={copyCode}>
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {t("retention.accepted.copy")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("retention.accepted.where")}</p>
            <DialogFooter>
              <Button className="w-full" onClick={() => onOpenChange(false)}>
                {t("retention.accepted.close")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
