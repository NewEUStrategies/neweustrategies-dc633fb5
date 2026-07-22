// Menedżer kolumn tabeli osób CRM (HubSpot "Manage columns").
import { Columns3, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LEAD_COLUMNS, DEFAULT_LEAD_VIEW_CONFIG } from "@/lib/crm/leadViews";
import type { LeadColumnKey } from "@/lib/crm/leadViews";

interface Props {
  lang: "pl" | "en";
  active: LeadColumnKey[];
  onChange: (next: LeadColumnKey[]) => void;
}

export function LeadColumnManager({ lang, active, onChange }: Props) {
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const set = new Set(active);
  const toggle = (key: LeadColumnKey) => {
    if (key === "name") return;
    const next = LEAD_COLUMNS.filter((c) =>
      c.key === key ? !set.has(key) : set.has(c.key),
    ).map((c) => c.key);
    onChange(next.length ? next : ["name"]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]">
          <Columns3 className="h-3.5 w-3.5" aria-hidden />
          {t("Kolumny", "Columns")}
          <span className="rounded bg-muted px-1.5 py-0 text-[10px] font-semibold tabular-nums">
            {active.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="flex items-center justify-between px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>{t("Kolumny tabeli", "Table columns")}</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[10px] font-normal text-muted-foreground hover:text-foreground"
            onClick={() => onChange([...DEFAULT_LEAD_VIEW_CONFIG.columns])}
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {t("Domyślne", "Reset")}
          </button>
        </div>
        <ul className="max-h-80 overflow-y-auto">
          {LEAD_COLUMNS.map((c) => {
            const checked = set.has(c.key);
            const disabled = c.required;
            return (
              <li key={c.key}>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[12px] hover:bg-muted ${
                    disabled ? "opacity-70" : ""
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={() => toggle(c.key)}
                  />
                  <span className="flex-1">{lang === "pl" ? c.labelPl : c.labelEn}</span>
                  {c.required && (
                    <span className="text-[10px] uppercase text-muted-foreground/60">
                      {t("stałe", "fixed")}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
