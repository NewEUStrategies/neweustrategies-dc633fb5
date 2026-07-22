// Chip-filtry w stylu HubSpot: każdy filtr = przycisk-chip; po kliknięciu
// otwiera popover z edycją wartości; aktywne chipy pokazują wartość i mają
// przycisk usunięcia. "Wyczyść wszystko" resetuje do DEFAULT_COMPANY_FILTER.
import { useMemo } from "react";
import {
  MapPin,
  Building,
  Target,
  CalendarClock,
  Activity,
  Hash,
  X,
  RotateCcw,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_COMPANY_FILTER,
  isDefaultFilter,
  type CompanyFilter,
} from "@/lib/crm/companyViews";

interface Props {
  lang: "pl" | "en";
  value: CompanyFilter;
  onChange: (next: CompanyFilter) => void;
  countries: string[];
  branches: string[];
}

export function CompanyFilterChips({ lang, value, onChange, countries, branches }: Props) {
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const rangeLabels = useMemo(
    () => ({
      any: t("Dowolnie", "Any"),
      "7d": t("Ostatnie 7 dni", "Last 7 days"),
      "30d": t("Ostatnie 30 dni", "Last 30 days"),
      "90d": t("Ostatnie 90 dni", "Last 90 days"),
      "365d": t("Ostatni rok", "Last year"),
    }),
    [lang],
  );
  const hasLeadsLabels: Record<CompanyFilter["hasLeads"], string> = {
    any: t("Dowolnie", "Any"),
    with: t("Z leadami", "With leads"),
    without: t("Bez leadów", "Without leads"),
  };

  const update = (patch: Partial<CompanyFilter>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip
        icon={<MapPin className="h-3 w-3" aria-hidden />}
        label={t("Kraj", "Country")}
        value={value.country}
        onClear={() => update({ country: null })}
      >
        <Select
          value={value.country ?? "any"}
          onValueChange={(v) => update({ country: v === "any" ? null : v })}
        >
          <SelectTrigger className="h-8 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t("Dowolny", "Any")}</SelectItem>
            {countries.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Chip>

      <Chip
        icon={<Building className="h-3 w-3" aria-hidden />}
        label={t("Branża", "Industry")}
        value={value.branch}
        onClear={() => update({ branch: null })}
      >
        <Select
          value={value.branch ?? "any"}
          onValueChange={(v) => update({ branch: v === "any" ? null : v })}
        >
          <SelectTrigger className="h-8 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t("Dowolna", "Any")}</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Chip>

      <Chip
        icon={<Target className="h-3 w-3" aria-hidden />}
        label={t("Leady", "Leads")}
        value={value.hasLeads !== "any" ? hasLeadsLabels[value.hasLeads] : null}
        onClear={() => update({ hasLeads: "any" })}
      >
        <Select
          value={value.hasLeads}
          onValueChange={(v) => update({ hasLeads: v as CompanyFilter["hasLeads"] })}
        >
          <SelectTrigger className="h-8 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["any", "with", "without"] as const).map((k) => (
              <SelectItem key={k} value={k}>
                {hasLeadsLabels[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Chip>

      <Chip
        icon={<CalendarClock className="h-3 w-3" aria-hidden />}
        label={t("Utworzono", "Created")}
        value={value.createdRange !== "any" ? rangeLabels[value.createdRange] : null}
        onClear={() => update({ createdRange: "any" })}
      >
        <Select
          value={value.createdRange}
          onValueChange={(v) => update({ createdRange: v as CompanyFilter["createdRange"] })}
        >
          <SelectTrigger className="h-8 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["any", "7d", "30d", "90d", "365d"] as const).map((k) => (
              <SelectItem key={k} value={k}>
                {rangeLabels[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Chip>

      <Chip
        icon={<Activity className="h-3 w-3" aria-hidden />}
        label={t("Aktywność", "Activity")}
        value={value.activityRange !== "any" ? rangeLabels[value.activityRange] : null}
        onClear={() => update({ activityRange: "any" })}
      >
        <Select
          value={value.activityRange}
          onValueChange={(v) => update({ activityRange: v as CompanyFilter["activityRange"] })}
        >
          <SelectTrigger className="h-8 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["any", "7d", "30d", "90d"] as const).map((k) => (
              <SelectItem key={k} value={k}>
                {rangeLabels[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Chip>

      <Chip
        icon={<Hash className="h-3 w-3" aria-hidden />}
        label={t("Min. leadów", "Min leads")}
        value={value.minLeads && value.minLeads > 0 ? String(value.minLeads) : null}
        onClear={() => update({ minLeads: null })}
      >
        <Input
          type="number"
          min={0}
          className="h-8 text-[12px]"
          value={value.minLeads ?? ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            update({ minLeads: Number.isFinite(n) && n > 0 ? Math.floor(n) : null });
          }}
        />
      </Chip>

      {!isDefaultFilter(value) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(DEFAULT_COMPANY_FILTER)}
          className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          {t("Wyczyść filtry", "Clear filters")}
        </Button>
      )}
    </div>
  );
}

function Chip({
  icon,
  label,
  value,
  onClear,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  onClear: () => void;
  children: React.ReactNode;
}) {
  const active = value !== null && value !== "";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-medium transition-colors ${
            active
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/70 bg-background text-muted-foreground hover:border-border hover:text-foreground"
          }`}
        >
          {icon}
          <span>{label}</span>
          {active && (
            <>
              <span className="text-foreground/70">·</span>
              <span className="max-w-[100px] truncate text-foreground">{value}</span>
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear"
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                className="ml-0.5 grid h-3.5 w-3.5 place-items-center rounded hover:bg-primary/20"
              >
                <X className="h-2.5 w-2.5" aria-hidden />
              </span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        {children}
      </PopoverContent>
    </Popover>
  );
}
