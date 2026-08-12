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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useMyExpertRequestQuota } from "@/lib/chat/useExpertRequests";
import { expertRequestGateOpen } from "@/lib/chat/expertRequestGate";
import { openExpertRequestDialog } from "@/lib/chat/expertRequestDialogBus";
import { ensureI18n as ensureExpertRequestI18n } from "@/lib/i18n-expert-request";

export interface ExpertRequestButtonProps {
  expertId: string;
  expertName: string;
  expertAvatar?: string | null;
  /**
   * Per-user zgoda odbiorcy na zapytania (profiles.expert_requests_enabled).
   * undefined = nieznana (traktowana jak włączona, domyślna wartość kolumny).
   */
  recipientEnabled?: boolean;
  /** Zwarta wersja (ikona + krótka etykieta) na listy/karty. */
  compact?: boolean;
  /** Wariant „tylko ikona" (h-8 w-8) - gęsty pasek akcji na profilu eksperta. */
  iconOnly?: boolean;
  className?: string;
}

export function ExpertRequestButton({
  expertId,
  expertName,
  expertAvatar,
  recipientEnabled,
  compact,
  iconOnly,
  className,
}: ExpertRequestButtonProps) {
  ensureExpertRequestI18n();
  const { t } = useTranslation();
  const { user } = useAuth();
  const modules = useCommunityModules();
  const quotaQ = useMyExpertRequestQuota();

  // Bramka funkcji: globalny przełącznik tenanta ORAZ zgoda eksperta. Wyłączenie
  // po którejkolwiek stronie chowa przycisk (serwer i tak odrzuci wysyłkę).
  if (!expertRequestGateOpen({ globalEnabled: modules.expert_requests_enabled, recipientEnabled }))
    return null;

  // Anon / własny profil -> nie serwujemy przycisku.
  if (!user || user.id === expertId) return null;
  // Podczas ładowania puli pokazujemy stabilny, disabled placeholder zamiast
  // znikać - w przeciwnym razie na wolniejszej sieci CTA "wskakuje" po chwili,
  // co czyta się jako layout shift (mirror wzorca z DirectMessageButton).
  if (quotaQ.isPending) {
    return (
      <Button
        type="button"
        variant="outline"
        size={iconOnly ? "icon" : compact ? "sm" : "default"}
        disabled
        aria-hidden
        className={cn(
          "h-8 gap-1.5 opacity-60 pointer-events-none",
          iconOnly && "w-8 shrink-0",
          className,
        )}
      >
        <MessageSquareQuote className="h-3.5 w-3.5" aria-hidden />
        {!iconOnly && (
          <span className={cn(compact && "hidden sm:inline")}>
            {compact ? t("expertRequest.ctaShort") : t("expertRequest.cta")}
          </span>
        )}
      </Button>
    );
  }

  const quota = quotaQ.data;
  // Progi bezpośrednie piszą zwykłą wiadomością (ConnectButton) - bez zapytania.
  if (quota?.direct) return null;

  // Sentinel puli „nieograniczonej" (RPC zwraca duże liczby dla VIP+/ekspertów).
  const UNLIMITED_THRESHOLD = 1000;
  const isUnlimited = !!quota && quota.quota >= UNLIMITED_THRESHOLD;
  const hasAllowance = !!quota && quota.quota > 0 && !isUnlimited;
  const exhausted = hasAllowance && quota.remaining <= 0;
  const tooltip = hasAllowance
    ? `${t("expertRequest.cta")} (${quota.remaining}/${quota.quota})`
    : t("expertRequest.cta");

  const button = (
    <Button
      type="button"
      variant="outline"
      size={iconOnly ? "icon" : compact ? "sm" : "default"}
      className={cn(
        "h-8 gap-1.5 transition-colors hover:bg-brand/10 hover:text-brand hover:border-brand/40 [&_svg]:transition-colors",
        iconOnly && "relative w-8 shrink-0",
        className,
      )}
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
      {!iconOnly && (
        <span className={cn(compact && "hidden sm:inline")}>
          {compact ? t("expertRequest.ctaShort") : t("expertRequest.cta")}
        </span>
      )}
      {hasAllowance && !iconOnly && (
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
      {/* W trybie ikonowym pula jest tylko sygnałem wyczerpania - pełna
          informacja („x/y") żyje w tooltipie, żeby nie rozpychać paska akcji. */}
      {hasAllowance && iconOnly && exhausted && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500"
        />
      )}
    </Button>
  );

  if (!iconOnly) return button;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
