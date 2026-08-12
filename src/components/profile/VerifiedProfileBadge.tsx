// Atom: znacznik "Zweryfikowany profil" przy nazwisku.
//
// Jedno miejsce prawdy dla wszystkich powierzchni profilowych (własny profil
// /profile, podgląd gościa, strona eksperta /author/$slug), żeby odznaka
// wyglądała i zachowywała się identycznie niezależnie od kontekstu.
import { useTranslation } from "react-i18next";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { ensureI18n as ensureExpertsI18n } from "@/lib/i18n-experts";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type VerifiedProfileBadgeSize = "sm" | "md";

export function VerifiedProfileBadge({
  size = "md",
  withLabel = true,
  className,
}: {
  size?: VerifiedProfileBadgeSize;
  withLabel?: boolean;
  className?: string;
}) {
  // Słownik rejestrowany tutaj, nie w trasie: odznaka wisi na trzech
  // niezależnych powierzchniach i żadna nie musi o tym pamiętać.
  ensureExpertsI18n();
  const { t } = useTranslation();
  // Bez `defaultValue`: oba klucze istnieją w PL i EN, a polska wartość
  // zapasowa oznaczała tylko tyle, że anglojęzyczny użytkownik zobaczyłby
  // „Zweryfikowany" po cichu, gdyby rejestracja słownika kiedyś wypadła.
  const label = t("expert.verifiedBadge");
  const title = t("expert.verifiedBadgeTitle");

  if (!withLabel) {
    const icon = (
      <BadgeCheck
        className={cn(
          "shrink-0 text-sky-600 dark:text-sky-300",
          size === "sm" ? "h-4 w-4" : "h-5 w-5",
          className,
        )}
        aria-label={label}
      />
    );

    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>{icon}</TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {title}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-[6px] bg-sky-400/25 font-medium text-sky-900 dark:text-sky-50 align-middle",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        className,
      )}
    >
      <BadgeCheck className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
      {label}
    </span>
  );
}

export default VerifiedProfileBadge;
