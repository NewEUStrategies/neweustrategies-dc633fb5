// Atom: znacznik „GPC" - najmniejszy nośnik informacji, że sygnał Global
// Privacy Control jest w grze. Trafia w wiersz kategorii banera, w wiersz zgody
// w centrum prywatności i w wiersz historii rejestru, dlatego nie ma własnych
// kolorów marki: korzysta z `--cb-*` (nadpisania banera) z fallbackiem na tokeny
// semantyczne motywu, więc wygląda spójnie na każdej z tych powierzchni.
import { ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ensureI18n } from "@/lib/i18n-consent-gpc";
import { cn } from "@/lib/utils";

ensureI18n();

export interface GpcBadgeProps {
  /** `solid` dla banera (wyraźny), `subtle` dla list i tabel audytu. */
  variant?: "solid" | "subtle";
  /**
   * Klucz i18n etykiety obok skrótu (np. `consentGpc.categoryLocked`). KLUCZ,
   * nie gotowy tekst: nakładka `consentGpc.*` jedzie tym samym leniwym chunkiem
   * co ten atom, więc wołający (baner, panel zgód) nie musi jej importować
   * statycznie tylko po to, żeby przetłumaczyć jedno słowo.
   */
  labelKey?: string;
  className?: string;
}

export function GpcBadge({ variant = "subtle", labelKey, className }: GpcBadgeProps) {
  const { t } = useTranslation();
  const solid = variant === "solid";
  const label = labelKey ? t(labelKey) : null;

  return (
    <span
      data-testid="gpc-badge"
      title={t("consentGpc.badgeTitle")}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5",
        "text-[10px] font-semibold uppercase tracking-[0.1em] leading-none",
        solid
          ? "bg-[color:var(--cb-accent,var(--primary))] text-[color:var(--cb-accent-fg,var(--primary-foreground))]"
          : "bg-[color:var(--cb-accent,var(--primary))]/12 text-[color:var(--cb-accent,var(--primary))]",
        className,
      )}
    >
      <ShieldOff aria-hidden className="h-3 w-3" />
      <span>{t("consentGpc.badge")}</span>
      {label ? <span className="font-medium normal-case tracking-normal">{label}</span> : null}
    </span>
  );
}
