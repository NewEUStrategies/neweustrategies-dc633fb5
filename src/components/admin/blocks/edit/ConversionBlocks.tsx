// Admin edytory dla Phase 4 batch 13 (konwersja / SEO):
// step-list, comparison-table, banner-image, video-hero.

import type { Block, Json } from "@/lib/blocks/types";
import { Plus, Trash2 } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { AdminSelect } from "../AdminSelect";
import { toJsonArray } from "@/lib/content-model/json";
import { num } from "@/components/blocks/renderer/data";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

function Shell({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

const inp = "w-full text-xs bg-background border border-border rounded px-2 py-2 h-9";
const sel = inp;

/**
 * Nakładka TAK, JAK JĄ NARYSUJE STRONA: ten sam czytnik co renderer (`num` -
 * liczba skończona albo wartość domyślna) i to samo docięcie do 0-90 co
 * `BannerImageView`/`VideoHeroView`. Suwak i tak pokazuje wartość w zakresie,
 * ale podpis obok czytał surową liczbę („150%", „NaN%").
 */
function overlayPct(d: Record<string, Json>, fallback: number): number {
  return Math.max(0, Math.min(90, num(d, "overlay", fallback)));
}

// ===== Step List (how-it-works) =====

interface StepItem {
  title: string;
  description: string;
  icon: string;
}

export function StepListBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const cb = (k: string) => i18n.editor("conversionBlocks", k);
  const raw = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: StepItem[] = raw.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return {
      title: String(o.title ?? ""),
      description: String(o.description ?? ""),
      icon: String(o.icon ?? ""),
    };
  });
  const update = (next: StepItem[]) => {
    onChange({ ...block, data: { ...block.data, items: toJsonArray(next) } });
  };

  return (
    <Shell label={cb("stepsLabel")}>
      <input
        className={inp}
        placeholder={cb("sectionTitle")}
        value={String(block.data.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className={sel}
          value={String(block.data.orientation ?? "vertical")}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, orientation: e.target.value } })
          }
        >
          <option value="vertical">{cb("vertical")}</option>
          <option value="horizontal">{cb("horizontal")}</option>
        </AdminSelect>
        <AdminSelect
          className={sel}
          value={String(block.data.numberStyle ?? "circle")}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, numberStyle: e.target.value } })
          }
        >
          <option value="circle">{cb("numCircle")}</option>
          <option value="square">{cb("numSquare")}</option>
          <option value="plain">{cb("numPlain")}</option>
        </AdminSelect>
      </div>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="rounded border border-border p-2 space-y-1.5">
            <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
              <span className="text-xs font-semibold text-muted-foreground w-6 text-center">
                {idx + 1}.
              </span>
              <input
                className={inp}
                placeholder={cb("stepTitle")}
                value={it.title}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, title: e.target.value };
                  update(next);
                }}
              />
              <button
                type="button"
                onClick={() => update(items.filter((_, i) => i !== idx))}
                className="px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
                aria-label={cb("removeStep")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[48px]"
              placeholder={cb("stepDesc")}
              value={it.description}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...it, description: e.target.value };
                update(next);
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...items, { title: "", description: "", icon: "" }])}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
        >
          <Plus className="w-3.5 h-3.5" /> {cb("addStep")}
        </button>
      </div>
    </Shell>
  );
}

// ===== Comparison Table (feature matrix) =====

interface CompRow {
  feature: string;
  values: string[];
}

export function ComparisonTableBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const cb = (k: string, o?: Record<string, unknown>) => i18n.editor("conversionBlocks", k, o);
  const rawCols = Array.isArray(block.data.columns) ? (block.data.columns as Json[]) : [];
  const columns: string[] = rawCols.map((c) => String(c ?? ""));
  const rawRows = Array.isArray(block.data.rows) ? (block.data.rows as Json[]) : [];
  const rows: CompRow[] = rawRows.map((r) => {
    const o = (r ?? {}) as Record<string, Json>;
    const vs = Array.isArray(o.values) ? (o.values as Json[]) : [];
    return {
      feature: String(o.feature ?? ""),
      values: vs.map((v) => String(v ?? "")),
    };
  });

  const setColumns = (next: string[]) => {
    // dostosuj długość values w każdym rzędzie
    const adjustedRows = rows.map((r) => {
      const v = next.map((_, i) => r.values[i] ?? "");
      return { ...r, values: v };
    });
    onChange({
      ...block,
      data: {
        ...block.data,
        columns: toJsonArray(next),
        rows: toJsonArray(adjustedRows),
      },
    });
  };
  const setRows = (next: CompRow[]) => {
    onChange({ ...block, data: { ...block.data, rows: toJsonArray(next) } });
  };

  // Ten sam czytnik co renderer publiczny (`renderComparisonTable`): liczba
  // skończona albo -1, więc śmieć w danych nie zamienia się tu w `NaN`.
  const featuredIdx = num(block.data, "featuredIndex", -1);

  // Usunięcie kolumny wycina komórkę o TYM SAMYM indeksie z każdego wiersza.
  // `setColumns` umie tylko dopasować DŁUGOŚĆ (czyta stare wartości po nowych
  // indeksach), więc przy kolumnie środkowej zostawiałoby wartość usuniętej
  // kolumny, a gubiło ostatniej. Wyróżnienie jedzie razem ze swoją kolumną -
  // renderer podświetla wyłącznie po indeksie.
  const removeColumn = (i: number) => {
    const nextFeatured = featuredIdx === i ? -1 : featuredIdx > i ? featuredIdx - 1 : featuredIdx;
    onChange({
      ...block,
      data: {
        ...block.data,
        columns: toJsonArray(columns.filter((_, k) => k !== i)),
        rows: toJsonArray(
          rows.map((r) => ({
            ...r,
            values: columns.map((_, k) => r.values[k] ?? "").filter((_, k) => k !== i),
          })),
        ),
        ...(nextFeatured !== featuredIdx ? { featuredIndex: nextFeatured } : {}),
      },
    });
  };

  return (
    <Shell label={cb("compareLabel")}>
      <input
        className={inp}
        placeholder={cb("title")}
        value={String(block.data.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">{cb("columnsHint")}</div>
        {columns.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2">
            <input
              className={inp}
              placeholder={cb("columnN", { n: i + 1 })}
              value={c}
              onChange={(e) => {
                const next = [...columns];
                next[i] = e.target.value;
                setColumns(next);
              }}
            />
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...block,
                  data: { ...block.data, featuredIndex: featuredIdx === i ? -1 : i },
                })
              }
              className={[
                "text-xs px-2 py-1 rounded border",
                featuredIdx === i
                  ? "border-foreground text-foreground"
                  : "border-border text-muted-foreground",
              ].join(" ")}
              aria-label={cb("highlightColumn")}
              aria-pressed={featuredIdx === i}
            >
              {featuredIdx === i ? "★" : "☆"}
            </button>
            <button
              type="button"
              onClick={() => removeColumn(i)}
              className="px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
              aria-label={cb("removeColumn")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setColumns([...columns, ""])}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
        >
          <Plus className="w-3.5 h-3.5" /> {cb("addColumn")}
        </button>
      </div>
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">{cb("rowsHint")}</div>
        {rows.map((r, ri) => (
          <div key={ri} className="rounded border border-border p-2 space-y-1.5">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className={inp}
                placeholder={cb("featureName")}
                value={r.feature}
                onChange={(e) => {
                  const next = [...rows];
                  next[ri] = { ...r, feature: e.target.value };
                  setRows(next);
                }}
              />
              <button
                type="button"
                onClick={() => setRows(rows.filter((_, k) => k !== ri))}
                className="px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
                aria-label={cb("removeRow")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div
              className="grid gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0,1fr))`,
              }}
            >
              {columns.map((_, ci) => (
                <input
                  key={ci}
                  className={inp}
                  placeholder={cb("cellHint")}
                  value={r.values[ci] ?? ""}
                  onChange={(e) => {
                    const next = [...rows];
                    // Dopełnienie do liczby kolumn: wiersz krótszy (import)
                    // dałby tablicę RZADKĄ, a dziura po `JSON.stringify` to `null`.
                    const v = columns.map((_, k) => r.values[k] ?? "");
                    v[ci] = e.target.value;
                    next[ri] = { ...r, values: v };
                    setRows(next);
                  }}
                />
              ))}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRows([...rows, { feature: "", values: columns.map(() => "") }])}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
        >
          <Plus className="w-3.5 h-3.5" /> {cb("addRow")}
        </button>
      </div>
    </Shell>
  );
}

// ===== Banner Image (image + text overlay) =====

export function BannerImageBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const cb = (k: string) => i18n.editor("conversionBlocks", k);
  const d = block.data;
  const overlay = overlayPct(d, 35);
  return (
    <Shell label={cb("bannerLabel")}>
      <input
        className={inp}
        placeholder={i18n.field("imageUrl")}
        value={String(d.image ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, image: e.target.value } })}
      />
      <input
        className={inp}
        placeholder={i18n.field("alt")}
        value={String(d.alt ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, alt: e.target.value } })}
      />
      <input
        className={inp + " text-sm font-semibold"}
        placeholder={i18n.field("title")}
        value={String(d.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, title: e.target.value } })}
      />
      <textarea
        className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[48px]"
        placeholder={cb("shortDesc")}
        value={String(d.description ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, description: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          className={inp}
          placeholder={i18n.field("ctaLabel")}
          value={String(d.ctaLabel ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, ctaLabel: e.target.value } })}
        />
        <input
          className={inp}
          placeholder={i18n.field("ctaUrl")}
          value={String(d.ctaHref ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, ctaHref: e.target.value } })}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <AdminSelect
          className={sel}
          value={String(d.position ?? "left")}
          onChange={(e) => onChange({ ...block, data: { ...d, position: e.target.value } })}
        >
          <option value="left">{cb("posLeft")}</option>
          <option value="center">{cb("posCenter")}</option>
          <option value="right">{cb("posRight")}</option>
        </AdminSelect>
        <AdminSelect
          className={sel}
          value={String(d.theme ?? "dark")}
          onChange={(e) => onChange({ ...block, data: { ...d, theme: e.target.value } })}
        >
          <option value="dark">{cb("textLight")}</option>
          <option value="light">{cb("textDark")}</option>
        </AdminSelect>
        <AdminSelect
          className={sel}
          value={String(d.aspect ?? "21:9")}
          onChange={(e) => onChange({ ...block, data: { ...d, aspect: e.target.value } })}
        >
          <option value="21:9">21:9</option>
          <option value="16:9">16:9</option>
          <option value="4:3">4:3</option>
          <option value="3:1">3:1</option>
        </AdminSelect>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="range"
          min={0}
          max={90}
          value={overlay}
          onChange={(e) => onChange({ ...block, data: { ...d, overlay: Number(e.target.value) } })}
          className="flex-1"
        />
        <span className="tabular-nums w-10 text-right">{overlay}%</span>
        <span>{cb("overlay")}</span>
      </label>
    </Shell>
  );
}

// ===== Video Hero (background video) =====

export function VideoHeroBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const cb = (k: string) => i18n.editor("conversionBlocks", k);
  const d = block.data;
  const overlay = overlayPct(d, 45);
  // Listy pokazują wartość, której UŻYJE `renderVideoHero` - natywny `<select>`
  // bez pasującej opcji pokazałby pierwszą („md", „left"), a strona rysuje
  // dla nieznanej wysokości „lg", a dla nieznanego wyrównania „center".
  const height = d.height === "md" || d.height === "screen" ? d.height : "lg";
  const align = d.align === "left" ? "left" : "center";
  return (
    <Shell label={cb("videoLabel")}>
      <input
        className={inp}
        placeholder={cb("videoUrl")}
        value={String(d.src ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, src: e.target.value } })}
      />
      <input
        className={inp}
        placeholder={cb("posterUrl")}
        value={String(d.poster ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, poster: e.target.value } })}
      />
      <input
        className={inp + " text-sm font-semibold"}
        placeholder={i18n.field("title")}
        value={String(d.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, title: e.target.value } })}
      />
      <textarea
        className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[48px]"
        placeholder={i18n.field("subtitlePh")}
        value={String(d.subtitle ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, subtitle: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          className={inp}
          placeholder={i18n.field("ctaLabel")}
          value={String(d.ctaLabel ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, ctaLabel: e.target.value } })}
        />
        <input
          className={inp}
          placeholder={i18n.field("ctaUrl")}
          value={String(d.ctaHref ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, ctaHref: e.target.value } })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className={sel}
          value={height}
          onChange={(e) => onChange({ ...block, data: { ...d, height: e.target.value } })}
        >
          <option value="md">{cb("heightMd")}</option>
          <option value="lg">{cb("heightLg")}</option>
          <option value="screen">{cb("heightScreen")}</option>
        </AdminSelect>
        <AdminSelect
          className={sel}
          value={align}
          onChange={(e) => onChange({ ...block, data: { ...d, align: e.target.value } })}
        >
          <option value="left">{cb("alignLeft")}</option>
          <option value="center">{cb("alignCenter")}</option>
        </AdminSelect>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="range"
          min={0}
          max={90}
          value={overlay}
          onChange={(e) => onChange({ ...block, data: { ...d, overlay: Number(e.target.value) } })}
          className="flex-1"
        />
        <span className="tabular-nums w-10 text-right">{overlay}%</span>
        <span>{cb("overlay")}</span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={d.autoplay !== false}
            onChange={(e) => onChange({ ...block, data: { ...d, autoplay: e.target.checked } })}
          />
          {cb("autoplay")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={d.loop !== false}
            onChange={(e) => onChange({ ...block, data: { ...d, loop: e.target.checked } })}
          />
          {cb("loop")}
        </label>
      </div>
    </Shell>
  );
}
