// Admin edytory dla Phase 4 batch 13 (konwersja / SEO):
// step-list, comparison-table, banner-image, video-hero.

import type { Block, Json } from "@/lib/blocks/types";
import { Plus, Trash2 } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";

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

// ===== Step List (how-it-works) =====

interface StepItem {
  title: string;
  description: string;
  icon: string;
}

export function StepListBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
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
    onChange({ ...block, data: { ...block.data, items: next as unknown as Json[] } });
  };

  return (
    <Shell label="Lista kroków (Jak to działa)">
      <input
        className={inp}
        placeholder="Tytuł sekcji (opcjonalnie)"
        value={String(block.data.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          className={sel}
          value={String(block.data.orientation ?? "vertical")}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, orientation: e.target.value } })
          }
        >
          <option value="vertical">Pionowo</option>
          <option value="horizontal">Poziomo</option>
        </select>
        <select
          className={sel}
          value={String(block.data.numberStyle ?? "circle")}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, numberStyle: e.target.value } })
          }
        >
          <option value="circle">Numer: koło</option>
          <option value="square">Numer: kwadrat</option>
          <option value="plain">Numer: tekst</option>
        </select>
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
                placeholder="Tytuł kroku"
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
                aria-label="Usuń krok"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[48px]"
              placeholder="Opis kroku"
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
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-primary/50"
        >
          <Plus className="w-3.5 h-3.5" /> Dodaj krok
        </button>
      </div>
    </Shell>
  );
}

// ===== Comparison Table (feature matrix) =====

interface CompCell {
  value: string;
}
interface CompRow {
  feature: string;
  values: string[];
}

export function ComparisonTableBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
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
        columns: next as unknown as Json[],
        rows: adjustedRows as unknown as Json[],
      },
    });
  };
  const setRows = (next: CompRow[]) => {
    onChange({ ...block, data: { ...block.data, rows: next as unknown as Json[] } });
  };

  const featuredIdx = Number(block.data.featuredIndex ?? -1);

  return (
    <Shell label="Tabela porównawcza">
      <input
        className={inp}
        placeholder="Tytuł (opcjonalnie)"
        value={String(block.data.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">Kolumny (np. plany)</div>
        {columns.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2">
            <input
              className={inp}
              placeholder={`Kolumna ${i + 1}`}
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
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground",
              ].join(" ")}
              aria-label="Wyróżnij kolumnę"
            >
              {featuredIdx === i ? "★" : "☆"}
            </button>
            <button
              type="button"
              onClick={() => setColumns(columns.filter((_, k) => k !== i))}
              className="px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
              aria-label="Usuń kolumnę"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setColumns([...columns, ""])}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-primary/50"
        >
          <Plus className="w-3.5 h-3.5" /> Dodaj kolumnę
        </button>
      </div>
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">Wiersze (funkcje)</div>
        {rows.map((r, ri) => (
          <div key={ri} className="rounded border border-border p-2 space-y-1.5">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className={inp}
                placeholder="Nazwa funkcji"
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
                aria-label="Usuń wiersz"
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
                  placeholder={`✓, ✗ lub tekst`}
                  value={r.values[ci] ?? ""}
                  onChange={(e) => {
                    const next = [...rows];
                    const v = [...r.values];
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
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-primary/50"
        >
          <Plus className="w-3.5 h-3.5" /> Dodaj wiersz
        </button>
      </div>
    </Shell>
  );
}

// ===== Banner Image (image + text overlay) =====

export function BannerImageBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const d = block.data;
  return (
    <Shell label="Banner z obrazem">
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
        placeholder="Krótki opis (opcjonalnie)"
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
        <select
          className={sel}
          value={String(d.position ?? "left")}
          onChange={(e) => onChange({ ...block, data: { ...d, position: e.target.value } })}
        >
          <option value="left">Tekst lewo</option>
          <option value="center">Tekst środek</option>
          <option value="right">Tekst prawo</option>
        </select>
        <select
          className={sel}
          value={String(d.theme ?? "dark")}
          onChange={(e) => onChange({ ...block, data: { ...d, theme: e.target.value } })}
        >
          <option value="dark">Tekst jasny</option>
          <option value="light">Tekst ciemny</option>
        </select>
        <select
          className={sel}
          value={String(d.aspect ?? "21:9")}
          onChange={(e) => onChange({ ...block, data: { ...d, aspect: e.target.value } })}
        >
          <option value="21:9">21:9</option>
          <option value="16:9">16:9</option>
          <option value="4:3">4:3</option>
          <option value="3:1">3:1</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="range"
          min={0}
          max={90}
          value={Number(d.overlay ?? 35)}
          onChange={(e) => onChange({ ...block, data: { ...d, overlay: Number(e.target.value) } })}
          className="flex-1"
        />
        <span className="tabular-nums w-10 text-right">{Number(d.overlay ?? 35)}%</span>
        <span>Nakładka</span>
      </label>
    </Shell>
  );
}

// ===== Video Hero (background video) =====

export function VideoHeroBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const d = block.data;
  return (
    <Shell label="Hero z tłem wideo">
      <input
        className={inp}
        placeholder="URL pliku wideo (mp4/webm)"
        value={String(d.src ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, src: e.target.value } })}
      />
      <input
        className={inp}
        placeholder="URL plakatu (poster, fallback)"
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
        <select
          className={sel}
          value={String(d.height ?? "lg")}
          onChange={(e) => onChange({ ...block, data: { ...d, height: e.target.value } })}
        >
          <option value="md">Średnia</option>
          <option value="lg">Wysoka</option>
          <option value="screen">Pełny ekran</option>
        </select>
        <select
          className={sel}
          value={String(d.align ?? "center")}
          onChange={(e) => onChange({ ...block, data: { ...d, align: e.target.value } })}
        >
          <option value="left">Wyrównaj lewo</option>
          <option value="center">Wyśrodkuj</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="range"
          min={0}
          max={90}
          value={Number(d.overlay ?? 45)}
          onChange={(e) => onChange({ ...block, data: { ...d, overlay: Number(e.target.value) } })}
          className="flex-1"
        />
        <span className="tabular-nums w-10 text-right">{Number(d.overlay ?? 45)}%</span>
        <span>Nakładka</span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={d.autoplay !== false}
            onChange={(e) => onChange({ ...block, data: { ...d, autoplay: e.target.checked } })}
          />
          Autoodtwarzanie
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={d.loop !== false}
            onChange={(e) => onChange({ ...block, data: { ...d, loop: e.target.checked } })}
          />
          Zapętlenie
        </label>
      </div>
    </Shell>
  );
}
