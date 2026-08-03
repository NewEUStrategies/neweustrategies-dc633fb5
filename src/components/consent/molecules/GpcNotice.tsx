// Molekuła: nota o sygnale Global Privacy Control.
//
// Dwa stany, oba obowiązkowe prawnie:
//   * `honored`   - sygnał działa; obowiązek przejrzystości (art. 12-13 RODO)
//                   wymaga, żeby użytkownik WIEDZIAŁ, że jego sygnał został
//                   uwzględniony, a nie tylko domyślał się z wyłączonych
//                   przełączników,
//   * `overridden` - sygnał jest aktywny, ale użytkownik świadomie go nadpisał;
//                   nota nazywa ten stan i daje jednoklikowy powrót, bo
//                   wycofanie zgody musi być tak łatwe jak jej udzielenie
//                   (art. 7 ust. 3 RODO).
//
// Bez własnych kolorów marki: `--cb-*` z fallbackiem na tokeny semantyczne, więc
// ta sama molekuła pasuje do banera (własna paleta admina) i do /profile/privacy
// (paleta motywu). Warianty rozmiaru odpowiadają gęstości obu powierzchni.
import { ShieldCheck, ShieldOff, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GpcBadge } from "@/components/consent/atoms/GpcBadge";
import type { GpcSource } from "@/lib/consent/gpc";
import { ensureI18n } from "@/lib/i18n-consent-gpc";
import { cn } from "@/lib/utils";

ensureI18n();

export interface GpcNoticeProps {
  /** Nośnik, z którego odczytaliśmy sygnał - pokazywany jako meta. */
  source: GpcSource;
  /** `true`, gdy użytkownik świadomie nadpisał sygnał jawną zgodą. */
  overridden?: boolean;
  /** Powrót do respektowania sygnału (widoczny tylko w stanie `overridden`). */
  onRestore?: () => void;
  /** `compact` dla banera i list, `card` dla samodzielnej sekcji strony. */
  variant?: "card" | "compact";
  className?: string;
}

const SOURCE_KEYS: Readonly<Record<GpcSource, string | null>> = {
  navigator: "consentGpc.honored.source.navigator",
  header: "consentGpc.honored.source.header",
  cookie: "consentGpc.honored.source.cookie",
  none: null,
};

export function GpcNotice({
  source,
  overridden = false,
  onRestore,
  variant = "card",
  className,
}: GpcNoticeProps) {
  const { t } = useTranslation();
  const compact = variant === "compact";
  const sourceKey = SOURCE_KEYS[source];
  const Icon = overridden ? ShieldOff : ShieldCheck;

  return (
    <aside
      data-testid="gpc-notice"
      data-gpc-state={overridden ? "overridden" : "honored"}
      className={cn(
        "flex gap-3 rounded-[5px] text-left",
        "border border-[color:var(--cb-border,var(--border))]",
        "bg-[color:var(--cb-accent,var(--primary))]/8",
        compact ? "px-3 py-2.5" : "px-4 py-3.5",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center rounded-full",
          "bg-[color:var(--cb-accent,var(--primary))]/15 text-[color:var(--cb-accent,var(--primary))]",
          compact ? "h-7 w-7" : "h-9 w-9",
        )}
      >
        <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </span>

      <div className={cn("grid min-w-0 gap-1", compact ? "text-[11.5px]" : "text-xs")}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-[color:var(--cb-fg,var(--foreground))]">
            {overridden ? t("consentGpc.overridden.title") : t("consentGpc.honored.title")}
          </p>
          <GpcBadge variant={overridden ? "subtle" : "solid"} />
        </div>

        <p className="leading-relaxed text-[color:var(--cb-fg,var(--muted-foreground))]/90">
          {overridden ? t("consentGpc.overridden.body") : t("consentGpc.honored.body")}
        </p>

        {!overridden && !compact ? (
          <>
            <p className="leading-relaxed text-[color:var(--cb-fg,var(--muted-foreground))]/80">
              {t("consentGpc.honored.scope")}
            </p>
            <p className="leading-relaxed text-[color:var(--cb-fg,var(--muted-foreground))]/80">
              {t("consentGpc.honored.overrideHint")}
            </p>
          </>
        ) : null}

        {sourceKey ? (
          <p className="font-mono text-[10px] leading-relaxed text-[color:var(--cb-fg,var(--muted-foreground))]/70">
            {t(sourceKey)}
          </p>
        ) : null}

        {overridden && onRestore ? (
          <button
            type="button"
            onClick={onRestore}
            className={cn(
              "mt-1 inline-flex w-fit items-center gap-1.5 rounded-md border px-2.5 py-1.5",
              "border-[color:var(--cb-border,var(--border))] text-[11px] font-medium",
              "text-[color:var(--cb-fg,var(--foreground))] transition-colors",
              "hover:bg-[color:var(--cb-accent,var(--primary))]/12",
            )}
          >
            <RotateCcw aria-hidden className="h-3 w-3" />
            {t("consentGpc.overridden.restore")}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
