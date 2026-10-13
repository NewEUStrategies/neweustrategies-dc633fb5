// Molekuła: co stanie się z wpłatą, gdy uczestnik odwoła udział (REG-03).
//
// POKAZUJEMY PRZED POTWIERDZENIEM, NIE PO. Uczestnik, który dowiaduje się
// o braku zwrotu z maila po rezygnacji, nie miał wyboru - a baza przyjmuje
// rezygnację opłaconego zgłoszenia dopiero ze skutkiem, który ten ekran
// pokazał (`acknowledged_effect`).
//
// KWOTA I TERMIN W STREFIE WYDARZENIA. Termin zwrotu liczy baza od startu
// wydarzenia, więc „do 15 września 10:00" ma znaczyć godzinę wydarzenia, a nie
// maszyny, która renderuje stronę.
//
// GOŚĆ GRUPY NIE POZNAJE SUMY PŁATNIKA: przy wspólnej wpłacie baza nie oddaje
// kwoty, a zdanie mówi tylko, że decyduje organizator.
import { Loader2, RotateCcw, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/billing/types";
import type { CancellationPreview, CancellationRefund } from "@/lib/events/cancellationPreview";
import { uiLang } from "@/lib/i18n/format";
import { formatEventDateTime } from "@/lib/events/timezone";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Zdania skutku dla jednego podglądu - puste, gdy rezygnacja nie dotyczy pieniędzy. */
function cancellationEffectSentences(
  refund: CancellationRefund,
  t: Translate,
  lang: "pl" | "en",
  timezone: string | null,
): string[] {
  const amount =
    refund.amountCents !== null && refund.currency !== null
      ? formatMoney(refund.amountCents, refund.currency, lang)
      : null;
  const deadline =
    refund.refundDeadlineAt === null
      ? ""
      : formatEventDateTime(refund.refundDeadlineAt, timezone, lang);
  const out: string[] = [];

  switch (refund.effect) {
    case "full_refund":
      out.push(
        amount === null
          ? t("eventRegistration.cancelRefund.fullRefundPlain")
          : t("eventRegistration.cancelRefund.fullRefund", { amount }),
      );
      if (deadline !== "")
        out.push(t("eventRegistration.cancelRefund.deadline", { date: deadline }));
      break;
    case "no_refund":
      if (refund.reviewReason === "refund_disabled") {
        out.push(t("eventRegistration.cancelRefund.noRefundDisabled"));
      } else {
        out.push(
          deadline === ""
            ? t("eventRegistration.cancelRefund.noRefundWindowPlain")
            : t("eventRegistration.cancelRefund.noRefundWindow", { date: deadline }),
        );
      }
      break;
    case "organizer_review":
      out.push(
        t(
          refund.reviewReason === "shared_payment"
            ? "eventRegistration.cancelRefund.reviewShared"
            : refund.reviewReason === "manual_payment"
              ? "eventRegistration.cancelRefund.reviewManual"
              : "eventRegistration.cancelRefund.reviewGeneric",
        ),
      );
      break;
    case "included_ticket":
      out.push(t("eventRegistration.cancelRefund.includedTicket"));
      break;
    case "none":
      break;
  }

  if (refund.groupGuestsClosing > 0) {
    out.push(t("eventRegistration.cancelRefund.groupGuests", { count: refund.groupGuestsClosing }));
  }
  return out;
}

export function CancellationFinancialEffect({
  preview,
  isError,
  onRetry,
  timezone = null,
}: {
  /** `undefined` = jeszcze się wczytuje. */
  preview: CancellationPreview | undefined;
  isError: boolean;
  onRetry: () => void;
  /** Strefa wydarzenia - termin zwrotu w godzinie wydarzenia. */
  timezone?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  if (isError) {
    return (
      <div role="alert" className="space-y-2 rounded-[6px] border border-border bg-card p-3">
        <p className="text-sm text-foreground">{t("eventRegistration.cancelRefund.loadError")}</p>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("eventRegistration.cancelRefund.retry")}
        </Button>
      </div>
    );
  }

  if (preview === undefined) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t("eventRegistration.cancelRefund.loading")}
      </p>
    );
  }

  if (preview.kind !== "ok" || preview.refund === null) return null;
  const sentences = cancellationEffectSentences(preview.refund, t, lang, timezone);
  if (sentences.length === 0) return null;

  return (
    <section
      aria-label={t("eventRegistration.cancelRefund.title")}
      className="space-y-1.5 rounded-[6px] border border-border bg-card p-3"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Wallet className="h-4 w-4" aria-hidden="true" />
        {t("eventRegistration.cancelRefund.title")}
      </h3>
      {sentences.map((sentence) => (
        <p key={sentence} className="text-sm text-foreground">
          {sentence}
        </p>
      ))}
    </section>
  );
}
