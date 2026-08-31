// Atom: JEDEN wiersz uprawnienia warstwy - przełącznik, ludzka nazwa, klucz
// techniczny i znacznik „egzekwowane / deklarowane".
//
// Wcześniej uprawnienia były chipami z samym kluczem w foncie maszynowym -
// redakcja nie wiedziała, co realnie włącza. Tutaj nazwa jest zdaniem po
// polsku/angielsku (Red Hat Display), klucz zostaje jako drobny podpis dla
// wdrożeniowca, a opis punktu egzekwowania jest widoczny, nie schowany
// w tooltipie.
import { useTranslation } from "react-i18next";
import { ShieldCheck, Sparkles } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { CapabilityItem } from "@/lib/admin/membership/capabilityModel";

export function CapabilityToggleRow({
  item,
  label,
  disabled,
  onToggle,
}: {
  item: CapabilityItem;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const tc = (k: string) => t(`adminMembership.capabilities.${k}`);
  const badge = item.enforced ? tc("enforcedBadge") : tc("decorativeBadge");
  const Icon = item.enforced ? ShieldCheck : Sparkles;

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-[6px] border px-3 py-2.5 font-sans transition-colors",
        item.enabled ? "border-primary/40 bg-primary/5" : "border-border/60 bg-background",
      )}
    >
      <Switch
        className="mt-0.5 shrink-0"
        checked={item.enabled}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onToggle}
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold leading-tight">{label}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              item.enforced
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
            title={item.enforced ? tc("enforcedHint") : tc("decorativeHint")}
          >
            <Icon className="h-3 w-3" aria-hidden />
            {badge}
          </span>
        </div>
        <p className="text-xs leading-snug text-muted-foreground">{item.where}</p>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{item.key}</p>
      </div>
    </li>
  );
}
