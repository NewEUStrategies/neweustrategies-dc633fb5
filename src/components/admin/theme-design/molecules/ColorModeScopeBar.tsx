// Molecule: the "you are editing colors for mode: Light / Dark" scope bar.
// Controls which slot (light value vs. dark override) every ColorControl on
// the page writes to.
import { useTranslation } from "react-i18next";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import "@/lib/i18n-admin-theme-design";
import type { PreviewMode } from "../types";

export function ColorModeScopeBar({
  mode,
  onModeChange,
}: {
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
      <span className="text-xs text-muted-foreground pl-1">
        {t("adminThemeDesign.editColorsForMode")}
      </span>
      <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
        {(["light", "dark"] as const).map((value) => {
          const active = mode === value;
          const Icon = value === "light" ? Sun : Moon;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onModeChange(value)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-sm text-xs font-medium transition-colors",
                active
                  ? "bg-brand text-[color:var(--brand-foreground)] shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {value === "light" ? "Light" : "Dark"}
            </button>
          );
        })}
      </div>
      <span className="text-[11px] text-muted-foreground ml-auto pr-1">
        {t("adminThemeDesign.emptyInherit")}
      </span>
    </div>
  );
}
