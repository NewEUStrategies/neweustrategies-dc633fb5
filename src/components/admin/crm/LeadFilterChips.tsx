// Chip-filtry listy osób CRM w stylu HubSpot (lustrzane wobec
// CompanyFilterChips): każdy filtr = chip; klik otwiera popover z edycją,
// aktywne chipy pokazują wartość i mają przycisk czyszczenia. Wartości chipów
// mapują się 1:1 na LeadFilterSchema, więc bieżący stan da się zapisać jako
// widok (saved_views) i odtworzyć po obu stronach (SQL liczy filtr serwerowo).
import {
  Activity,
  CalendarClock,
  Building,
  Flag,
  Flame,
  Inbox,
  MapPin,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_LEAD_FILTER, isDefaultLeadFilter, type LeadFilter } from "@/lib/crm/leadViews";
import { SCORE_BAND_LABELS, type ScoreBand } from "@/lib/crm/scoring";

interface Props {
  lang: "pl" | "en";
  value: LeadFilter;
  onChange: (next: LeadFilter) => void;
  stageLabels: Record<Exclude<LeadFilter["stage"], "any">, string>;
  countries: string[];
}

export function LeadFilterChips({ lang, value, onChange, stageLabels, countries }: Props) {
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const rangeLabels = {
    any: t("Dowolnie", "Any"),
    "7d": t("Ostatnie 7 dni", "Last 7 days"),
    "30d": t("Ostatnie 30 dni", "Last 30 days"),
    "90d": t("Ostatnie 90 dni", "Last 90 days"),
    "365d": t("Ostatni rok", "Last year"),
  };
  const sourceLabels: Record<Exclude<LeadFilter["source"], "any">, string> = {
    form: t("Formularz", "Form"),
    newsletter: "Newsletter",
    import: t("Import / ręcznie", "Import / manual"),
  };

  const update = (patch: Partial<LeadFilter>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip
        icon={<Flag className="h-3 w-3" aria-hidden />}
        label={t("Etap", "Stage")}
        value={value.stage !== "any" ? stageLabels[value.stage] : null}
        onClear={() => update({ stage: "any" })}
      >
        <Select
          value={value.stage}
          onValueChange={(v) => update({ stage: v as LeadFilter["stage"] })}
        >
          <SelectTrigger className="h-8 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t("Dowolny", "Any")}</SelectItem>
            {(Object.keys(stageLabels) as Array<Exclude<LeadFilter["stage"], "any">>).map((s) => (
              <SelectItem key={s} value={s}>
                {stageLabels[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Chip>

      <Chip
        icon={<Flame className="h-3 w-3" aria-hidden />}
        label={t("Poziom", "Band")}
        value={value.band !== "any" ? SCORE_BAND_LABELS[lang][value.band as ScoreBand] : null}
        onClear={() => update({ band: "any" })}
      >
        <Select value={value.band} onValueChange={(v) => update({ band: v as LeadFilter["band"] })}>
          <SelectTrigger className="h-8 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t("Dowolny", "Any")}</SelectItem>
            {(["hot", "warm", "cool", "cold"] as const).map((b) => (
              <SelectItem key={b} value={b}>
                {SCORE_BAND_LABELS[lang][b]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Chip>

      <Chip
        icon={<Inbox className="h-3 w-3" aria-hidden />}
        label={t("Źródło", "Source")}
        value={value.source !== "any" ? sourceLabels[value.source] : null}
        onClear={() => update({ source: "any" })}
      >
        <Select
          value={value.source}
          onValueChange={(v) => update({ source: v as LeadFilter["source"] })}
        >
          <SelectTrigger className="h-8 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t("Dowolne", "Any")}</SelectItem>
            {(["form", "newsletter", "import"] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {sourceLabels[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Chip>

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
        label={t("Firma", "Company")}
        value={value.company}
        onClear={() => update({ company: null })}
      >
        <Input
          className="h-8 text-[12px]"
          placeholder={t("Dokładna nazwa firmy", "Exact company name")}
          value={value.company ?? ""}
          onChange={(e) => update({ company: e.target.value.trim() ? e.target.value : null })}
        />
      </Chip>

      <Chip
        icon={<CalendarClock className="h-3 w-3" aria-hidden />}
        label={t("Utworzono", "Created")}
        value={value.createdRange !== "any" ? rangeLabels[value.createdRange] : null}
        onClear={() => update({ createdRange: "any" })}
      >
        <Select
          value={value.createdRange}
          onValueChange={(v) => update({ createdRange: v as LeadFilter["createdRange"] })}
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
          onValueChange={(v) => update({ activityRange: v as LeadFilter["activityRange"] })}
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
        icon={<ShieldCheck className="h-3 w-3" aria-hidden />}
        label={t("Zgoda mkt.", "Consent")}
        value={value.consentOnly ? t("Tylko ze zgodą", "With consent") : null}
        onClear={() => update({ consentOnly: false })}
      >
        <label className="flex items-center gap-2 px-1 py-0.5 text-[12px]">
          <Switch
            checked={value.consentOnly}
            onCheckedChange={(v) => update({ consentOnly: v === true })}
          />
          {t("Tylko kontakty ze zgodą marketingową", "Only contacts with marketing consent")}
        </label>
      </Chip>

      {!isDefaultLeadFilter(value) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(DEFAULT_LEAD_FILTER)}
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
              <span className="max-w-[110px] truncate text-foreground">{value}</span>
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
      <PopoverContent align="start" className="w-64 p-2">
        {children}
      </PopoverContent>
    </Popover>
  );
}
