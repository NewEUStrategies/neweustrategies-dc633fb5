// Molecule: per-device visibility toggles.
import type { AdvancedSettings } from "@/lib/builder/types";
import { Monitor, Tablet, Smartphone } from "@/lib/lucide-shim";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  value: AdvancedSettings | undefined;
  onChange: (mut: (a: AdvancedSettings) => void) => void;
}

const DEVICES: Array<
  ["desktop" | "tablet" | "mobile", React.ComponentType<{ className?: string }>, string]
> = [
  ["desktop", Monitor, "Desktop"],
  ["tablet", Tablet, "Tablet"],
  ["mobile", Smartphone, "Mobile"],
];

export function VisibilityControl({ value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {DEVICES.map(([d, Icon, label]) => {
        const hidden = !!value?.hideOn?.[d];
        return (
          <button
            key={d}
            type="button"
            onClick={() =>
              onChange((a) => {
                a.hideOn = { ...(a.hideOn ?? {}), [d]: !hidden };
              })
            }
            className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded border text-[10px] transition ${
              hidden
                ? "bg-destructive/10 border-destructive/40 text-destructive"
                : "bg-muted/30 border-border hover:bg-muted text-muted-foreground"
            }`}
            title={
              hidden
                ? t("builder.visibility.hiddenOn", { device: label })
                : t("builder.visibility.visibleOn", { device: label })
            }
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
