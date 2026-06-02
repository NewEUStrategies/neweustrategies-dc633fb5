import { Check, AlertTriangle } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";

type LangFlag = boolean;

interface LangCoverageBadgesProps {
  pl: LangFlag;
  en: LangFlag;
  className?: string;
  /** label override (defaults: "PL" / "EN") */
  labelPl?: string;
  labelEn?: string;
  /** when true, tooltip explains missing locale */
  missingTitlePl?: string;
  missingTitleEn?: string;
}

/**
 * Atom: shows two compact language pills with check/warning state.
 * Used in admin list rows to signal localisation coverage at a glance.
 */
export function LangCoverageBadges({
  pl,
  en,
  className,
  labelPl = "PL",
  labelEn = "EN",
  missingTitlePl,
  missingTitleEn,
}: LangCoverageBadgesProps) {
  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <Pill ok={pl} label={labelPl} title={pl ? labelPl : missingTitlePl} />
      <Pill ok={en} label={labelEn} title={en ? labelEn : missingTitleEn} />
    </div>
  );
}

function Pill({ ok, label, title }: { ok: boolean; label: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide border",
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      )}
    >
      {ok ? <Check className="w-2.5 h-2.5" /> : <AlertTriangle className="w-2.5 h-2.5" />}
      {label}
    </span>
  );
}
