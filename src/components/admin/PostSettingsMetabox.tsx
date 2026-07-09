// Foxiz-style metabox z zakładkami w edytorze wpisów i stron.
// - Zakładki po lewej (pionowo, jak w Foxiz "Single Page Settings")
// - Panel po prawej
// - Zakładki: Spis treści (ToC), Ochrona treści (Membership), Kluczowe punkty
// - Wariant "page" ukrywa zakładkę Kluczowych punktów.
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  ListOrdered,
  Lock,
  ListChecks,
  Trash2,
  ExternalLink,
  Columns2,
  Rows2,
  AlignJustify,
  Heading1,
  Heading2,
  Heading3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccessSettingsPane } from "@/components/admin/AccessSettingsPane";
import {
  TOC_LAYOUTS,
  TOC_COLUMNS,
  useTocDefaults,
  countPostHeadings,
  type TocLayout,
  type TocColumns,
  type TocOverride,
  type HeadingCounts,
} from "@/lib/toc/settings";
import type { LocalizedBlocks } from "@/lib/blocks/types";
import type { AccessEntityType } from "@/hooks/useContentAccess";

type EntityType = "post" | "page";

export interface PostSettingsMetaboxProps {
  entityType: EntityType;
  entityId: string | null;
  tocOverride: TocOverride | null | undefined;
  onTocOverrideChange: (next: TocOverride | null) => void;
  /** Bieżąca zawartość edytora blokowego - używana do live-liczenia H1/H2/H3. */
  postBlocks?: LocalizedBlocks | null;
  /** Punkty PL/EN - tylko dla wpisów. */
  takeawaysPl?: string[];
  takeawaysEn?: string[];
  onTakeawaysChange?: (lang: "pl" | "en", next: string[]) => void;
}

type TabKey = "toc" | "membership" | "takeaways";

const MAX_TAKEAWAYS = 7;
const MAX_TAKEAWAY_LEN = 500;
const RECOMMENDED_MIN = 40;
const RECOMMENDED_MAX = 200;

export function PostSettingsMetabox({
  entityType,
  entityId,
  tocOverride,
  onTocOverrideChange,
  postBlocks,
  takeawaysPl = [],
  takeawaysEn = [],
  onTakeawaysChange,
}: PostSettingsMetaboxProps) {
  const { t } = useTranslation();
  // Zarówno wpisy jak i strony mogą korzystać z sekcji „Dowiesz się, że...";
  // jedynym warunkiem jest podanie handlera zmiany przez rodzica.
  const showTakeaways = !!onTakeawaysChange;
  const [tab, setTab] = useState<TabKey>("toc");

  const tabs: { id: TabKey; icon: typeof ListOrdered; label: string }[] = [
    {
      id: "toc",
      icon: ListOrdered,
      label: t("admin.metabox.tabs.toc", { defaultValue: "Spis treści" }),
    },
    {
      id: "membership",
      icon: Lock,
      label: t("admin.metabox.tabs.membership", { defaultValue: "Ochrona treści" }),
    },
    ...(showTakeaways
      ? [
          {
            id: "takeaways" as const,
            icon: ListChecks,
            label: t("admin.metabox.tabs.takeaways", { defaultValue: "Dowiesz się…" }),
          },
        ]
      : []),
  ];

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-semibold">
          {t("admin.metabox.title", { defaultValue: "Ustawienia strony" })}
        </h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {t("admin.metabox.subtitle", {
            defaultValue: "Nadpisania globalnych opcji tylko dla tego wpisu.",
          })}
        </p>
      </header>
      <div className="grid grid-cols-[180px_minmax(0,1fr)] min-h-[280px]">
        {/* Sidebar tabs */}
        <nav
          className="border-r border-border bg-muted/20 p-2 flex flex-col gap-1"
          aria-label="Metabox tabs"
        >
          {tabs.map(({ id, icon: Icon, label }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors",
                  active
                    ? "bg-green-500/15 text-green-700 dark:text-green-400 font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                aria-pressed={active}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Panel */}
        <div className="p-4">
          {tab === "toc" && (
            <TocTab
              override={tocOverride ?? null}
              onChange={onTocOverrideChange}
              postBlocks={postBlocks ?? null}
            />
          )}
          {tab === "membership" && (
            <AccessSettingsPane
              entityType={entityType as AccessEntityType}
              entityId={entityId}
            />
          )}
          {tab === "takeaways" && showTakeaways && (
            <TakeawaysTab
              pl={takeawaysPl}
              en={takeawaysEn}
              onChange={onTakeawaysChange!}
            />
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------- ToC tab ----------------

const COLUMN_OPTIONS: {
  value: TocColumns;
  icon: typeof Columns2;
  label: string;
  desc: string;
}[] = [
  {
    value: "col-1",
    icon: AlignJustify,
    label: "1 kolumna",
    desc: "Pełna szerokość, klasyczny układ",
  },
  {
    value: "col-2",
    icon: Columns2,
    label: "2 kolumny",
    desc: "Pełna szerokość, długie ToC dzielone",
  },
  {
    value: "half",
    icon: Rows2,
    label: "Połowa",
    desc: "50% szerokości treści",
  },
];

function TocTab({
  override,
  onChange,
  postBlocks,
}: {
  override: TocOverride | null;
  onChange: (next: TocOverride | null) => void;
  postBlocks: LocalizedBlocks | null;
}) {
  const { t } = useTranslation();
  const defaults = useTocDefaults();

  const counts = useMemo(() => countPostHeadings(postBlocks), [postBlocks]);

  const value = override ?? {};
  const patch = (p: Partial<NonNullable<TocOverride>>) => {
    const merged = { ...value, ...p };
    const allEmpty = Object.values(merged).every((v) => v === null || v === undefined);
    onChange(allEmpty ? null : merged);
  };

  const isOverridden =
    !!override && Object.values(override).some((v) => v !== null && v !== undefined);

  const effectiveColumns: TocColumns = value.columns ?? defaults.columns;

  return (
    <div className="space-y-4">
      <PanelHead
        title={t("admin.metabox.toc.title", { defaultValue: "Spis treści (ToC)" })}
        hint={t("admin.metabox.toc.hint", {
          defaultValue:
            "Dziedziczy z globalnych ustawień. Nadpisz tylko to, co ma być inne dla tego wpisu.",
        })}
        globalHref="/admin/toc"
      />

      {/* Live heading counter - z tekstu wpisu, dla PL/EN */}
      <HeadingCounter
        pl={counts.pl}
        en={counts.en}
        minLevel={defaults.minLevel}
        maxLevel={defaults.maxLevel}
      />

      <RowOverride
        label={t("admin.metabox.toc.enabled", { defaultValue: "Włącz ToC dla tego wpisu" })}
        globalValue={defaults.enabled ? "włączony" : "wyłączony"}
        overridden={value.enabled !== null && value.enabled !== undefined}
        onClear={() => patch({ enabled: null })}
      >
        <Switch
          checked={value.enabled ?? defaults.enabled}
          onCheckedChange={(v) => patch({ enabled: v })}
        />
      </RowOverride>

      <RowOverride
        label={t("admin.metabox.toc.layout", { defaultValue: "Wygląd karty" })}
        globalValue={defaults.layout}
        overridden={!!value.layout}
        onClear={() => patch({ layout: null })}
      >
        <Select
          value={value.layout ?? defaults.layout}
          onValueChange={(v) => patch({ layout: v as TocLayout })}
        >
          <SelectTrigger className="h-9 w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TOC_LAYOUTS.map((l) => (
              <SelectItem key={l} value={l}>
                {l === "boxed" ? "Karta" : l === "inline" ? "Inline" : "Sticky sidebar"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </RowOverride>

      {/* Kolumny - trzy opcje w formie segmented control */}
      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label className="text-sm font-medium">Kolumny spisu treści</Label>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Globalnie:{" "}
              <span className="font-mono">
                {COLUMN_OPTIONS.find((o) => o.value === defaults.columns)?.label}
              </span>
              {value.columns != null && (
                <button
                  type="button"
                  onClick={() => patch({ columns: null })}
                  className="ml-2 text-brand hover:underline"
                >
                  wyczyść nadpisanie
                </button>
              )}
            </p>
          </div>
        </div>
        <div
          className="grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label="Układ kolumnowy ToC"
        >
          {COLUMN_OPTIONS.map(({ value: v, icon: Icon, label, desc }) => {
            const active = effectiveColumns === v;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => patch({ columns: v })}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-center transition-colors",
                  active
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border bg-background hover:border-brand/50 hover:bg-muted",
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-medium">{label}</span>
                <span className="text-[10px] leading-tight text-muted-foreground">{desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      <RowOverride
        label={t("admin.metabox.toc.position", {
          defaultValue: "Pozycja (po ilu akapitach)",
        })}
        globalValue={String(defaults.position)}
        overridden={value.position !== null && value.position !== undefined}
        onClear={() => patch({ position: null })}
      >
        <Input
          type="number"
          min={-1}
          max={20}
          value={value.position ?? defaults.position}
          onChange={(e) => patch({ position: parseInt(e.target.value || "0", 10) })}
          className="h-9 w-[100px]"
        />
      </RowOverride>

      <RowOverride
        label={t("admin.metabox.toc.sticky", { defaultValue: "Sticky przy scrollu" })}
        globalValue={defaults.sticky ? "włączony" : "wyłączony"}
        overridden={value.sticky !== null && value.sticky !== undefined}
        onClear={() => patch({ sticky: null })}
      >
        <Switch
          checked={value.sticky ?? defaults.sticky}
          onCheckedChange={(v) => patch({ sticky: v })}
        />
      </RowOverride>

      {isOverridden && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          {t("admin.metabox.toc.resetAll", {
            defaultValue: "Przywróć wszystkie ustawienia globalne",
          })}
        </button>
      )}
    </div>
  );
}

// Kompaktowy licznik nagłówków - PL/EN, z podświetleniem poziomów spoza zakresu.
function HeadingCounter({
  pl,
  en,
  minLevel,
  maxLevel,
}: {
  pl: HeadingCounts;
  en: HeadingCounts;
  minLevel: number;
  maxLevel: number;
}) {
  const rows: { icon: typeof Heading1; level: 1 | 2 | 3; label: string }[] = [
    { icon: Heading1, level: 1, label: "H1" },
    { icon: Heading2, level: 2, label: "H2" },
    { icon: Heading3, level: 3, label: "H3" },
  ];
  const cell = (c: HeadingCounts, level: 1 | 2 | 3) => {
    const inRange = level >= minLevel && level <= maxLevel;
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center min-w-[1.75rem] h-6 px-1.5 rounded font-mono text-[11px] tabular-nums",
          inRange
            ? c[`h${level}`] > 0
              ? "bg-brand/15 text-brand"
              : "bg-muted text-muted-foreground"
            : "bg-muted/40 text-muted-foreground/60 line-through",
        )}
        title={inRange ? "Poziom w zakresie ToC" : "Poziom poza zakresem - nie trafi do ToC"}
      >
        {c[`h${level}`]}
      </span>
    );
  };

  return (
    <div className="rounded-lg border border-dashed border-border bg-background/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Wykryte nagłówki w treści
        </div>
        <div className="text-[10px] text-muted-foreground">
          Zakres ToC: <span className="font-mono">H{minLevel}-H{maxLevel}</span>
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-1.5">
        <span />
        <span className="text-[10px] font-medium text-muted-foreground uppercase">PL</span>
        <span className="text-[10px] font-medium text-muted-foreground uppercase">EN</span>
        {rows.map(({ icon: Icon, level, label }) => (
          <div key={level} className="contents">
            <div className="flex items-center gap-1.5 text-xs text-foreground/80">
              <Icon className="w-3.5 h-3.5" />
              <span className="font-medium">{label}</span>
            </div>
            <div>{cell(pl, level)}</div>
            <div>{cell(en, level)}</div>
          </div>
        ))}
      </div>
      {pl.total === 0 && en.total === 0 && (
        <p className="text-[10px] text-muted-foreground italic mt-2">
          Brak nagłówków w edytorze bloków. Dodaj H1/H2/H3, aby ToC wygenerował się automatycznie.
        </p>
      )}
    </div>
  );
}


// ---------------- Takeaways tab ----------------
function TakeawaysTab({
  pl,
  en,
  onChange,
}: {
  pl: string[];
  en: string[];
  onChange: (lang: "pl" | "en", next: string[]) => void;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<"pl" | "en">("pl");
  const current = active === "pl" ? pl : en;

  const updateAt = (idx: number, value: string) => {
    const next = [...current];
    next[idx] = value.slice(0, MAX_TAKEAWAY_LEN);
    onChange(active, next);
  };
  const removeAt = (idx: number) => onChange(active, current.filter((_, i) => i !== idx));
  const add = () => {
    if (current.length >= MAX_TAKEAWAYS) return;
    onChange(active, [...current, ""]);
  };

  return (
    <div className="space-y-4">
      <PanelHead
        title={t("admin.metabox.takeaways.title", { defaultValue: "Dowiesz się, że…" })}
        hint={t("admin.metabox.takeaways.hint", {
          defaultValue:
            "Max 6 punktów. Rekomendacja: jedno zdanie = jedna myśl, ok. 90-160 znaków na punkt.",
        })}
        globalHref="/admin/key-takeaways"
      />

      <Tabs value={active} onValueChange={(v) => setActive(v === "en" ? "en" : "pl")}>
        <TabsList>
          <TabsTrigger value="pl">
            PL ({pl.filter(Boolean).length}/{MAX_TAKEAWAYS})
          </TabsTrigger>
          <TabsTrigger value="en">
            EN ({en.filter(Boolean).length}/{MAX_TAKEAWAYS})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {current.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          {t("post.takeaways.empty", { defaultValue: "Brak punktów dla tego języka." })}
        </p>
      ) : (
        <ul className="space-y-3">
          {current.map((bullet, i) => (
            <TakeawayRow
              key={i}
              index={i}
              value={bullet}
              onChange={(v) => updateAt(i, v)}
              onRemove={() => removeAt(i)}
            />
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={current.length >= MAX_TAKEAWAYS}
      >
        + {t("post.takeaways.add", { defaultValue: "Dodaj punkt" })}
      </Button>
    </div>
  );
}

function TakeawayRow({
  index,
  value,
  onChange,
  onRemove,
}: {
  index: number;
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const len = value.length;
  const status =
    len === 0
      ? "empty"
      : len < RECOMMENDED_MIN
        ? "short"
        : len <= RECOMMENDED_MAX
          ? "ok"
          : "long";
  const statusColor = {
    empty: "text-muted-foreground",
    short: "text-yellow-600 dark:text-yellow-400",
    ok: "text-green-600 dark:text-green-400",
    long: "text-orange-600 dark:text-orange-400",
  }[status];
  const statusMsg = {
    empty: "",
    short: "Za krótkie – dodaj kontekst",
    ok: "Dobra długość",
    long: "Rozbij na kilka punktów – jedno zdanie, jedna myśl",
  }[status];

  return (
    <li className="flex items-start gap-2">
      <span className="mt-2 text-xs text-muted-foreground w-5 text-right shrink-0">
        {index + 1}.
      </span>
      <div className="flex-1">
        <Textarea
          value={value}
          rows={2}
          maxLength={MAX_TAKEAWAY_LEN}
          placeholder="Jedno zdanie, jedna myśl…"
          onChange={(e) => onChange(e.target.value)}
        />
        <div className={cn("mt-1 text-[10px] flex justify-between gap-2", statusColor)}>
          <span>{statusMsg}</span>
          <span className="tabular-nums">
            {len}/{MAX_TAKEAWAY_LEN} · rekom. {RECOMMENDED_MIN}-{RECOMMENDED_MAX}
          </span>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRemove}
        aria-label="Usuń punkt"
      >
        <Trash2 className="w-4 h-4 text-destructive" />
      </Button>
    </li>
  );
}

// ---------------- Shared helpers ----------------
function PanelHead({
  title,
  hint,
  globalHref,
}: {
  title: string;
  hint: string;
  globalHref?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 pb-3 border-b border-border">
      <div className="min-w-0">
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>
      </div>
      {globalHref && (
        <Link
          to={globalHref}
          className="text-[11px] text-brand hover:underline shrink-0 flex items-center gap-1"
        >
          Ustawienia globalne <ExternalLink className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}

function RowOverride({
  label,
  globalValue,
  overridden,
  onClear,
  children,
}: {
  label: string;
  globalValue: string;
  overridden: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          Globalnie: <span className="font-mono">{globalValue}</span>
          {overridden && (
            <button
              type="button"
              onClick={onClear}
              className="ml-2 text-brand hover:underline"
            >
              wyczyść nadpisanie
            </button>
          )}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
