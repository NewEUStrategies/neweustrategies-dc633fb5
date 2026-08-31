// Organizm: sekcja „Co otwiera ta warstwa" w edytorze warstwy członkostwa.
//
// Składa trzy rzeczy w jedną historię: podsumowanie (ile uprawnień włączonych,
// z tego ile realnie egzekwowanych), grupy przełączników po obszarze bramki,
// limity liczbowe. Surowy JSON żyje w zwijanej sekcji „zaawansowane" - nadal
// dostępny dla wdrożeniowca, ale nie jest już pierwszą rzeczą, którą widzi
// redakcja.
//
// Stanu nie ma - wszystko jest funkcją draftu `features` (string JSON), więc
// przełączniki, limity i pole surowe zawsze pokazują to samo.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, FileJson } from "lucide-react";

import { Input } from "@/components/ui/input";
import { LimitField } from "@/components/admin/membership/atoms/LimitField";
import { CapabilityGroupCard } from "@/components/admin/membership/molecules/CapabilityGroupCard";
import { ExpertRequestQuotaEditor } from "@/components/admin/pricing/ExpertRequestQuotaEditor";
import {
  groupCapabilities,
  readLimit,
  summarizeCapabilities,
  toggleCapability,
  unknownFlagKeys,
  writeLimit,
  TIER_LIMIT_KEYS,
} from "@/lib/admin/membership/capabilityModel";

export function TierCapabilitiesPanel({
  value,
  onChange,
  disabled,
}: {
  /** Draft pola features jako string JSON. */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const tc = (k: string, opts?: Record<string, unknown>) =>
    t(`adminMembership.capabilities.${k}`, opts);

  const groups = useMemo(() => groupCapabilities(value, lang), [value, lang]);
  const summary = useMemo(() => summarizeCapabilities(value), [value]);
  const unknown = useMemo(() => unknownFlagKeys(value), [value]);

  return (
    <div className="space-y-4 font-sans">
      <header className="rounded-[6px] border border-border/70 bg-background px-3 py-2.5">
        <h3 className="text-sm font-bold">{tc("heading")}</h3>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{tc("hint")}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
          <span className="rounded-[6px] bg-muted px-2 py-0.5 tabular-nums">
            {tc("summary.enabled", { count: summary.enabled, total: summary.total })}
          </span>
          <span className="rounded-[6px] bg-primary/10 px-2 py-0.5 text-primary tabular-nums">
            {tc("summary.enforced", { count: summary.enforced })}
          </span>
          <span className="rounded-[6px] bg-muted px-2 py-0.5 text-muted-foreground tabular-nums">
            {tc("summary.decorative", { count: summary.decorative })}
          </span>
        </div>
      </header>

      <div className="space-y-3">
        {groups.map((group) => (
          <CapabilityGroupCard
            key={group.gate}
            group={group}
            disabled={disabled}
            onToggle={(key) => onChange(toggleCapability(value, key))}
          />
        ))}
      </div>

      <section className="rounded-[6px] border border-border/70 bg-muted/20 p-3">
        <h4 className="text-xs font-bold uppercase tracking-wide">{tc("limits.heading")}</h4>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{tc("limits.hint")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {TIER_LIMIT_KEYS.map((key) => (
            <LimitField
              key={key}
              id={`tier-limit-${key}`}
              label={tc(`limits.${key}`)}
              value={readLimit(value, key)}
              max={key === "event_ticket_discount_pct" ? 100 : 9999}
              disabled={disabled}
              onChange={(next) => onChange(writeLimit(value, key, next))}
            />
          ))}
          <div className="sm:col-span-2">
            <ExpertRequestQuotaEditor value={value} onChange={onChange} disabled={disabled} />
          </div>
        </div>
      </section>

      {unknown.length > 0 && (
        <section className="rounded-[6px] border border-dashed border-border px-3 py-2">
          <h4 className="text-xs font-bold uppercase tracking-wide">{tc("unknown.heading")}</h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{tc("unknown.hint")}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {unknown.map((key) => (
              <li
                key={key}
                className="rounded-[6px] bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {key}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="group rounded-[6px] border border-border/70 bg-background">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold">
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
            aria-hidden
          />
          <FileJson className="h-3.5 w-3.5" aria-hidden />
          {tc("advanced.heading")}
        </summary>
        <div className="space-y-1 border-t border-border/60 p-3">
          <p className="text-[11px] text-muted-foreground">{tc("advanced.hint")}</p>
          <Input
            aria-label={tc("advanced.heading")}
            className="h-9 rounded-[6px] text-xs"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </details>
    </div>
  );
}
