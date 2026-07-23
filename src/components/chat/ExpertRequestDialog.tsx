// ExpertRequestDialog - sformalizowane „Zapytanie do eksperta".
// Otwierany globalnie przez `expertRequestDialogBus` gdy serwer zwróci
// `chat: expert requires request`; można też odpalać wprost w profilu
// eksperta (ExpertRequestButton) lub w wynikach wyszukiwania.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Plus, X, ExternalLink } from "@/lib/lucide-shim";
import { toast } from "sonner";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FloatingInput, FloatingTextarea } from "@/components/ui/floating-input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSendExpertRequest, useMyExpertRequestQuota } from "@/lib/chat/useExpertRequests";
import type { ExpertRequestPrefill } from "@/lib/chat/expertRequestDialogBus";

const schema = z.object({
  subject: z.string().trim().min(5).max(140),
  reason: z.string().trim().min(20).max(2000),
  questions: z.array(z.string().trim().min(5).max(500)).max(5),
  expectedAnswers: z.string().trim().max(2000).optional(),
  externalLinks: z
    .array(
      z
        .string()
        .trim()
        .regex(/^https?:\/\//i),
    )
    .max(3),
});

export interface ExpertRequestDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prefill: ExpertRequestPrefill | null;
}

function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function ExpertRequestDialog({ open, onOpenChange, prefill }: ExpertRequestDialogProps) {
  const { t } = useTranslation();
  const send = useSendExpertRequest();
  const quotaQ = useMyExpertRequestQuota();

  const [subject, setSubject] = useState("");
  const [reason, setReason] = useState("");
  const [questions, setQuestions] = useState<string[]>([""]);
  const [expectedAnswers, setExpectedAnswers] = useState("");
  const [externalLinks, setExternalLinks] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset po otwarciu.
  useEffect(() => {
    if (!open) return;
    setSubject(prefill?.subject ?? "");
    setReason("");
    setQuestions([""]);
    setExpectedAnswers("");
    setExternalLinks([]);
    setErrors({});
  }, [open, prefill?.recipientId, prefill?.subject]);

  const quota = quotaQ.data;
  const quotaLine = useMemo(() => {
    if (!quota) return null;
    if (quota.direct) return t("expertRequest.quota.direct");
    if (quota.quota <= 0) return t("expertRequest.quota.none");
    if (quota.remaining <= 0) return t("expertRequest.quota.exhausted", { quota: quota.quota });
    return t("expertRequest.quota.remaining", {
      remaining: quota.remaining,
      quota: quota.quota,
    });
  }, [quota, t]);

  const outOfQuota = !!quota && !quota.direct && quota.remaining <= 0;

  const canSubmit = useMemo(
    () =>
      subject.trim().length >= 5 &&
      reason.trim().length >= 20 &&
      !!prefill?.recipientId &&
      !outOfQuota,
    [subject, reason, prefill?.recipientId, outOfQuota],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prefill?.recipientId) return;
    const cleanedQuestions = questions.map((q) => q.trim()).filter((q) => q.length > 0);
    const cleanedLinks = externalLinks.map((l) => l.trim()).filter((l) => l.length > 0);

    const parsed = schema.safeParse({
      subject: subject.trim(),
      reason: reason.trim(),
      questions: cleanedQuestions,
      expectedAnswers: expectedAnswers.trim() || undefined,
      externalLinks: cleanedLinks,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString() ?? "form";
        if (key === "subject") errs.subject = t("expertRequest.validation.subject");
        else if (key === "reason") errs.reason = t("expertRequest.validation.reason");
        else if (key === "questions") errs.questions = t("expertRequest.validation.question");
        else if (key === "externalLinks") errs.externalLinks = t("expertRequest.validation.link");
      }
      setErrors(errs);
      return;
    }
    setErrors({});
    try {
      await send.mutateAsync({
        recipientId: prefill.recipientId,
        subject: parsed.data.subject,
        reason: parsed.data.reason,
        questions: parsed.data.questions,
        expectedAnswers: parsed.data.expectedAnswers,
        externalLinks: parsed.data.externalLinks,
      });
      toast.success(t("expertRequest.sentToast"));
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("monthly quota")) toast.error(t("expertRequest.error.monthlyQuota"));
      else if (msg.includes("rate limit")) toast.error(t("expertRequest.error.rateLimit"));
      else if (msg.includes("recipient is not gated") || msg.includes("not an expert"))
        toast.error(t("expertRequest.error.notExpert"));
      else if (msg.includes("tier disabled")) toast.error(t("expertRequest.error.tierDisabled"));
      else toast.error(t("expertRequest.error.generic"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("expertRequest.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("expertRequest.dialogSubtitle")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {prefill && (
            <div className="flex items-center gap-3 rounded-[6px] border border-border bg-muted/40 p-3">
              <Avatar className="h-10 w-10 rounded-[6px]">
                <AvatarImage
                  src={prefill.recipientAvatar ?? undefined}
                  alt={prefill.recipientName ?? ""}
                  className="rounded-[6px] object-cover"
                />
                <AvatarFallback className="rounded-[6px] bg-foreground text-[11px] font-bold text-background">
                  {initials(prefill.recipientName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("expertRequest.recipientLabel")}
                </p>
                <p className="truncate text-sm font-semibold text-foreground">
                  {prefill.recipientName ?? "-"}
                </p>
              </div>
            </div>
          )}

          {quotaLine && (
            <p
              className={cnQuota(outOfQuota || (!!quota && quota.quota <= 0 && !quota.direct))}
              role="status"
            >
              {quotaLine}
            </p>
          )}

          <FloatingInput
            label={t("expertRequest.fields.subject")}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={140}
            error={errors.subject}
            required
          />

          <FloatingTextarea
            label={t("expertRequest.fields.reason")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
            rows={5}
            error={errors.reason}
            required
          />

          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("expertRequest.fields.questions")}
            </p>
            {questions.map((q, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  <FloatingInput
                    label={t("expertRequest.fields.questionPlaceholder", { n: i + 1 })}
                    value={q}
                    maxLength={500}
                    onChange={(e) => {
                      const next = questions.slice();
                      next[i] = e.target.value;
                      setQuestions(next);
                    }}
                  />
                </div>
                {questions.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-1 h-9 w-9 shrink-0"
                    aria-label={t("expertRequest.fields.removeQuestion")}
                    onClick={() => setQuestions(questions.filter((_, j) => j !== i))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {questions.length < 5 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start rounded-[6px]"
                onClick={() => setQuestions([...questions, ""])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t("expertRequest.fields.addQuestion")}
              </Button>
            )}
            {errors.questions && <p className="text-xs text-destructive">{errors.questions}</p>}
          </div>

          <FloatingTextarea
            label={t("expertRequest.fields.expectedAnswers")}
            value={expectedAnswers}
            onChange={(e) => setExpectedAnswers(e.target.value)}
            maxLength={2000}
            rows={3}
          />

          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("expertRequest.fields.links")}
            </p>
            {externalLinks.map((l, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  <FloatingInput
                    label={t("expertRequest.fields.linkPlaceholder")}
                    value={l}
                    type="url"
                    onChange={(e) => {
                      const next = externalLinks.slice();
                      next[i] = e.target.value;
                      setExternalLinks(next);
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-1 h-9 w-9 shrink-0"
                  aria-label={t("expertRequest.fields.removeLink")}
                  onClick={() => setExternalLinks(externalLinks.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {externalLinks.length < 3 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start rounded-[6px]"
                onClick={() => setExternalLinks([...externalLinks, ""])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t("expertRequest.fields.addLink")}
              </Button>
            )}
            {errors.externalLinks && (
              <p className="text-xs text-destructive">{errors.externalLinks}</p>
            )}
          </div>

          <Link
            to="/pricing"
            className="inline-flex items-center gap-1.5 self-start text-[12px] font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("expertRequest.upgradeCta")}
          </Link>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-[6px]"
            >
              {t("expertRequest.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit || send.isPending} className="rounded-[6px]">
              {send.isPending ? t("expertRequest.sending") : t("expertRequest.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Baner puli: neutralny gdy są zapytania, ostrzegawczy gdy wyczerpane/brak. */
function cnQuota(warn: boolean): string {
  return warn
    ? "rounded-[6px] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300"
    : "rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground";
}
