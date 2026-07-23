// „Zapytanie do eksperta" - jawny CTA na profilu eksperta (hub autora).
// Otwiera globalny ExpertRequestDialog (bus) z prefillem odbiorcy. Widoczny
// tylko dla zalogowanych, na cudzym profilu i dla warstw, które SKŁADAJĄ
// zapytania (Plus/Pro). Progi „bezpośrednie" (VIP i wyżej, eksperci, admin)
// piszą wprost przez zwykłą wiadomość - nie pokazujemy im tego CTA.
// Pula rozstrzygana serwerowo (my_expert_request_quota), więc etykieta
// „1/1" jest zgodna z bramką send_expert_request per tenant.
import { useTranslation } from "react-i18next";
import { MessageSquareQuote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useMyExpertRequestQuota } from "@/lib/chat/useExpertRequests";
import { openExpertRequestDialog } from "@/lib/chat/expertRequestDialogBus";
import { ensureI18n as ensureExpertRequestI18n } from "@/lib/i18n-expert-request";

export interface ExpertRequestButtonProps {
  expertId: string;
  expertName: string;
  expertAvatar?: string | null;
  /** Zwarta wersja (ikona + krótka etykieta) na listy/karty. */
  compact?: boolean;
  className?: string;
}

export function ExpertRequestButton({
  expertId,
  expertName,
  expertAvatar,
  compact,
  className,
}: ExpertRequestButtonProps) {
  ensureExpertRequestI18n();
  const { t } = useTranslation();
  const { user } = useAuth();
  const quotaQ = useMyExpertRequestQuota();

  // Anon / własny profil / jeszcze nie znamy puli -> nie serwujemy przycisku.
  if (!user || user.id === expertId) return null;
  if (quotaQ.isPending) return null;

  const quota = quotaQ.data;
  // Progi bezpośrednie piszą zwykłą wiadomością (ConnectButton) - bez zapytania.
  if (quota?.direct) return null;

  const hasAllowance = !!quota && quota.quota > 0;
  const exhausted = hasAllowance && quota.remaining <= 0;

  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? "sm" : "default"}
      className={cn("h-8 gap-1.5", className)}
      aria-label={`${t("expertRequest.cta")}: ${expertName}`}
      onClick={() =>
        openExpertRequestDialog({
          recipientId: expertId,
          recipientName: expertName,
          recipientAvatar: expertAvatar ?? null,
        })
      }
    >
      <MessageSquareQuote className="h-3.5 w-3.5" aria-hidden />
      <span className={cn(compact && "hidden sm:inline")}>
        {compact ? t("expertRequest.ctaShort") : t("expertRequest.cta")}
      </span>
      {hasAllowance && (
        <span
          className={cn(
            "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
            exhausted
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : "bg-primary/10 text-primary",
          )}
        >
          {quota.remaining}/{quota.quota}
        </span>
      )}
    </Button>
  );
}
