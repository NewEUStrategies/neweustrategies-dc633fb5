// Chip-filtry listy osób CRM w stylu HubSpot (lustrzane wobec
// CompanyFilterChips): każdy filtr = chip; klik otwiera popover z edycją,
// aktywne chipy pokazują wartość i mają przycisk czyszczenia. Wartości chipów
// mapują się 1:1 na LeadFilterSchema, więc bieżący stan da się zapisać jako
// widok (saved_views) i odtworzyć po obu stronach (SQL liczy filtr serwerowo).
import { useState } from "react";
import {
  Activity,
  CalendarClock,
  Building,
  Flag,
  Flame,
  Inbox,
  Layers,
  MapPin,
  Milestone,
  RotateCcw,
  ShieldCheck,
  Tag as TagIcon,
  UserRound,
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
import { Checkbox } from "@/components/ui/checkbox";
import { DEFAULT_LEAD_FILTER, isDefaultLeadFilter, type LeadFilter } from "@/lib/crm/leadViews";
import { CRM_SOURCE_TYPES } from "@/lib/crm/leadListSpec";
import { LIFECYCLE_STAGES } from "@/lib/crm/lifecycle";
import { SCORE_BAND_LABELS, type ScoreBand } from "@/lib/crm/scoring";
import { crmLifecycleDict } from "@/lib/i18n-admin-crm-lifecycle";

/** Limit tagu i liczby tagów filtra - te same co `LeadListFilterSchema`. */
const FILTER_TAG_MAX = 40;
const FILTER_TAGS_MAX = 20;

interface Props {
  lang: "pl" | "en";
  value: LeadFilter;
  onChange: (next: LeadFilter) => void;
  stageLabels: Record<Exclude<LeadFilter["stage"], "any">, string>;
  countries: string[];
  /** Tagi znane z bieżącej listy (podpowiedzi chipa „Tagi"). */
  tagOptions?: readonly string[];
  /** Zespół CRM (chip „Właściciel"); brak = chip ukryty. */
  owners?: ReadonlyArray<{ id: string; label: string }>;
}

export function LeadFilterChips({
  lang,
  value,
  onChange,
  stageLabels,
  countries,
  tagOptions = [],
  owners,
}: Props) {
  const lc = crmLifecycleDict(lang);
  const [tagDraft, setTagDraft] = useState("");
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
        icon={<Milestone className="h-3 w-3" aria-hidden />}
        label={lc.filters.lifecycle}
        value={value.lifecycle ? lc.stages[value.lifecycle] : null}
        onClear={() => update({ lifecycle: undefined })}
      >
        <Select
          value={value.lifecycle ?? "any"}
          onValueChange={(v) =>
            update({ lifecycle: v === "any" ? undefined : (v as LeadFilter["lifecycle"]) })
          }
        >
          <SelectTrigger className="h-8 text-[12px]" aria-label={lc.filters.lifecycle}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{lc.filters.any}</SelectItem>
            {LIFECYCLE_STAGES.map((stage) => (
              <SelectItem key={stage} value={stage}>
                {lc.stages[stage]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Chip>

      <Chip
        icon={<Layers className="h-3 w-3" aria-hidden />}
        label={lc.filters.segment}
        value={value.sourceType ? lc.segments[value.sourceType] : null}
        onClear={() => update({ sourceType: undefined })}
      >
        <Select
          value={value.sourceType ?? "any"}
          onValueChange={(v) =>
            update({ sourceType: v === "any" ? undefined : (v as LeadFilter["sourceType"]) })
          }
        >
          <SelectTrigger className="h-8 text-[12px]" aria-label={lc.filters.segment}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{lc.filters.any}</SelectItem>
            {CRM_SOURCE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {lc.segments[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Chip>

      <Chip
        icon={<TagIcon className="h-3 w-3" aria-hidden />}
        label={lc.filters.tags}
        value={
          value.tags && value.tags.length > 0
            ? value.tags.length === 1
              ? value.tags[0]
              : lc.filters.selected.replace("{{count}}", String(value.tags.length))
            : null
        }
        onClear={() => update({ tags: undefined })}
      >
        <TagsEditor
          lang={lang}
          selected={value.tags ?? []}
          options={tagOptions}
          draft={tagDraft}
          onDraft={setTagDraft}
          onChange={(tags) => update({ tags: tags.length > 0 ? tags : undefined })}
        />
      </Chip>

      {owners && (
        <Chip
          icon={<UserRound className="h-3 w-3" aria-hidden />}
          label={lc.filters.owner}
          value={
            value.ownerIds && value.ownerIds.length > 0
              ? value.ownerIds.length === 1
                ? (owners.find((o) => o.id === value.ownerIds?.[0])?.label ?? lc.filters.owner)
                : lc.filters.selected.replace("{{count}}", String(value.ownerIds.length))
              : null
          }
          onClear={() => update({ ownerIds: undefined })}
        >
          {owners.length === 0 ? (
            <p className="px-1 py-0.5 text-[12px] text-muted-foreground">{lc.filters.ownerEmpty}</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto" aria-label={lc.filters.owner}>
              {owners.map((owner) => {
                const checked = value.ownerIds?.includes(owner.id) ?? false;
                const id = `lead-owner-${owner.id}`;
                return (
                  <li key={owner.id}>
                    <label htmlFor={id} className="flex items-center gap-2 px-1 py-0.5 text-[12px]">
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(next) => {
                          const current = value.ownerIds ?? [];
                          const ids =
                            next === true
                              ? [...current, owner.id]
                              : current.filter((x) => x !== owner.id);
                          update({ ownerIds: ids.length > 0 ? ids : undefined });
                        }}
                      />
                      {owner.label}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </Chip>
      )}

      {/* Stare źródło heurystyczne - wyłącznie, gdy niesie je wczytany widok
          (nowe widoki filtrują po segmencie; „Import" heurystyczny był pusty). */}
      {value.source !== "any" && (
        <Chip
          icon={<Inbox className="h-3 w-3" aria-hidden />}
          label={lc.filters.legacySource}
          value={sourceLabels[value.source]}
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
      )}

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

/**
 * Edytor tagów filtra: podpowiedzi z bieżącej listy + własny tag. Limit
 * 40 znaków ODRZUCA, nie przycina (ten sam co walidacja serwera) - przycięty
 * tag szukałby czego innego niż wpisano.
 */
function TagsEditor({
  lang,
  selected,
  options,
  draft,
  onDraft,
  onChange,
}: {
  lang: "pl" | "en";
  selected: readonly string[];
  options: readonly string[];
  draft: string;
  onDraft: (value: string) => void;
  onChange: (tags: string[]) => void;
}) {
  const lc = crmLifecycleDict(lang);
  const trimmed = draft.trim();
  const tooLong = trimmed.length > FILTER_TAG_MAX;
  const full = selected.length >= FILTER_TAGS_MAX;
  const add = (tag: string) => {
    const t = tag.trim();
    if (!t || t.length > FILTER_TAG_MAX || selected.includes(t) || full) return;
    onChange([...selected, t]);
    onDraft("");
  };
  const suggestions = options
    .filter(
      (o) => !selected.includes(o) && (!trimmed || o.toLowerCase().includes(trimmed.toLowerCase())),
    )
    .slice(0, 8);
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">{lc.filters.tagsHint}</p>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {selected.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                onClick={() => onChange(selected.filter((x) => x !== tag))}
                className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary"
                aria-label={lc.filters.remove.replace("{{value}}", tag)}
              >
                {tag}
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          add(draft);
        }}
      >
        <Input
          className="h-8 text-[12px]"
          placeholder={lc.filters.tagsPlaceholder}
          value={draft}
          aria-label={lc.filters.tags}
          aria-invalid={tooLong || undefined}
          onChange={(e) => onDraft(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-8 px-2 text-[11px]"
          disabled={!trimmed || tooLong || full}
        >
          {lc.filters.tagsAdd}
        </Button>
      </form>
      {suggestions.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={lc.filters.tagsPlaceholder}>
          {suggestions.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                onClick={() => add(tag)}
                className="rounded border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-border hover:text-foreground"
              >
                {tag}
              </button>
            </li>
          ))}
        </ul>
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
