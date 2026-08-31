// Molekuła: jedna grupa uprawnień (obszar bramki) z licznikiem włączonych.
// Grupowanie po obszarze to sedno nowego UX - admin czyta „Treści i analizy",
// a nie 21 kluczy pod rząd.
import { useTranslation } from "react-i18next";

import { CapabilityToggleRow } from "@/components/admin/membership/atoms/CapabilityToggleRow";
import type { CapabilityGroup } from "@/lib/admin/membership/capabilityModel";

export function CapabilityGroupCard({
  group,
  disabled,
  onToggle,
}: {
  group: CapabilityGroup;
  disabled?: boolean;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  const tc = (k: string, opts?: Record<string, unknown>) =>
    t(`adminMembership.capabilities.${k}`, opts);

  return (
    <section className="rounded-[6px] border border-border/70 bg-muted/20 font-sans">
      <header className="flex items-start justify-between gap-3 border-b border-border/60 px-3 py-2">
        <div className="min-w-0">
          <h4 className="text-xs font-bold uppercase tracking-wide">
            {tc(`gates.${group.gate}`)}
          </h4>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {tc(`gateHints.${group.gate}`)}
          </p>
        </div>
        <span className="shrink-0 rounded-[6px] bg-background px-2 py-0.5 text-[11px] font-semibold tabular-nums">
          {tc("groupCount", { enabled: group.enabledCount, total: group.totalCount })}
        </span>
      </header>
      <ul className="space-y-2 p-3">
        {group.items.map((item) => (
          <CapabilityToggleRow
            key={item.key}
            item={item}
            label={tc(`labels.${item.key}`)}
            disabled={disabled}
            onToggle={() => onToggle(item.key)}
          />
        ))}
      </ul>
    </section>
  );
}
