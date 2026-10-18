// Admin edytory dla Phase 4 batch 10 (prezentacyjne):
// icon-box, stats-counter, testimonials, pricing-table, timeline.

import { useState } from "react";
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

const ICON_NAMES = [
  "star",
  "heart",
  "zap",
  "shield",
  "trophy",
  "rocket",
  "sparkles",
  "check",
  "clock",
  "globe",
  "users",
  "award",
  "gem",
  "flame",
  "leaf",
  "target",
];

// ===== Icon Box =====

export function IconBoxBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const pb = (k: string) => i18n.editor("presentationBlocks", k);
  const d = block.data;
  // Wyrównanie, którego UŻYJE `renderIconBox` (inne niż „left" -> „center").
  // Natywny `<select>` bez pasującej opcji pokazałby pierwszą, czyli „left".
  const align = d.align === "left" ? "left" : "center";
  return (
    <Shell label={pb("iconBoxLabel")}>
      <AdminSelect
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={String(d.icon ?? "star")}
        onChange={(e) => onChange({ ...block, data: { ...d, icon: e.target.value } })}
      >
        {ICON_NAMES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </AdminSelect>
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        placeholder={i18n.field("title")}
        value={String(d.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, title: e.target.value } })}
      />
      <textarea
        className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[60px]"
        placeholder={i18n.field("description")}
        value={String(d.description ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, description: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          placeholder={pb("buttonUrl")}
          value={String(d.href ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, href: e.target.value } })}
        />
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          placeholder={pb("buttonLabel")}
          value={String(d.linkLabel ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, linkLabel: e.target.value } })}
        />
      </div>
      <AdminSelect
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={align}
        onChange={(e) => onChange({ ...block, data: { ...d, align: e.target.value } })}
      >
        <option value="left">{pb("alignLeft")}</option>
        <option value="center">{pb("alignCenter")}</option>
      </AdminSelect>
    </Shell>
  );
}

// ===== Stats Counter =====

interface StatItem {
  value: string;
  label: string;
  suffix: string;
}

export function StatsCounterBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const pb = (k: string) => i18n.editor("presentationBlocks", k);
  const itemsRaw = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: StatItem[] = itemsRaw.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return {
      value: String(o.value ?? ""),
      label: String(o.label ?? ""),
      suffix: String(o.suffix ?? ""),
    };
  });
  const update = (next: StatItem[]) => {
    onChange({ ...block, data: { ...block.data, items: toJsonArray(next) } });
  };
  // Ten sam czytnik co `renderStatsCounter`: śmieć w danych to 1500 ms, a nie
  // `NaN` (puste pole i ostrzeżenie Reacta o `NaN` w atrybucie `value`).
  const duration = num(block.data, "duration", 1500);

  return (
    <Shell label={pb("statsLabel")}>
      <label className="block text-xs text-muted-foreground">
        {pb("animDuration")}
        <input
          type="number"
          className="mt-1 w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
          min={300}
          max={5000}
          value={duration}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, duration: Number(e.target.value) } })
          }
        />
      </label>
      {items.map((it, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
          <input
            className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
            placeholder={pb("statValue")}
            value={it.value}
            onChange={(e) => {
              const next = [...items];
              next[idx] = { ...it, value: e.target.value };
              update(next);
            }}
          />
          <input
            className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
            placeholder={pb("statSuffix")}
            value={it.suffix}
            onChange={(e) => {
              const next = [...items];
              next[idx] = { ...it, suffix: e.target.value };
              update(next);
            }}
          />
          <input
            className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
            placeholder={i18n.field("label")}
            value={it.label}
            onChange={(e) => {
              const next = [...items];
              next[idx] = { ...it, label: e.target.value };
              update(next);
            }}
          />
          <button
            type="button"
            onClick={() => update(items.filter((_, i) => i !== idx))}
            className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
            aria-label={pb("remove")}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => update([...items, { value: "", label: "", suffix: "" }])}
        className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
      >
        <Plus className="w-3.5 h-3.5" /> {pb("addStat")}
      </button>
    </Shell>
  );
}

// ===== Testimonials =====

/**
 * Ocena docięta do 0-5, jak w `TestimonialsView`. Odczyt podaje tu wynik `num`
 * z domyślną 0 (brak albo śmieć = bez gwiazdek - edytor zakładał dla braku 5,
 * więc zapis dowolnego innego pola opinii dopisywał jej pięć gwiazdek na
 * stronie), a zapis - `Number()` wpisu z pola liczbowego, które oddaje pusty
 * napis (0) albo poprawną liczbę, nigdy `NaN`.
 */
function clampRating(raw: number): number {
  return Math.max(0, Math.min(5, raw));
}

interface Testimonial {
  quote: string;
  author: string;
  role: string;
  avatar: string;
  rating: number;
}

export function TestimonialsBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const pb = (k: string) => i18n.editor("presentationBlocks", k);
  const itemsRaw = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: Testimonial[] = itemsRaw.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return {
      quote: String(o.quote ?? ""),
      author: String(o.author ?? ""),
      role: String(o.role ?? ""),
      avatar: String(o.avatar ?? ""),
      rating: clampRating(num(o, "rating", 0)),
    };
  });
  const update = (next: Testimonial[]) => {
    onChange({ ...block, data: { ...block.data, items: toJsonArray(next) } });
  };
  const layout = String(block.data.layout ?? "grid");

  return (
    <Shell label={pb("testimonialsLabel")}>
      <AdminSelect
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={layout}
        onChange={(e) => onChange({ ...block, data: { ...block.data, layout: e.target.value } })}
      >
        <option value="grid">{pb("layoutGrid")}</option>
        <option value="slider">{pb("layoutSlider")}</option>
      </AdminSelect>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="rounded border border-border p-2 space-y-1.5">
            <textarea
              className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[56px]"
              placeholder={pb("quote")}
              value={it.quote}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...it, quote: e.target.value };
                update(next);
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
                placeholder={pb("author")}
                value={it.author}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, author: e.target.value };
                  update(next);
                }}
              />
              <input
                className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
                placeholder={pb("role")}
                value={it.role}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, role: e.target.value };
                  update(next);
                }}
              />
            </div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
              <input
                className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
                placeholder={pb("avatarUrl")}
                value={it.avatar}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, avatar: e.target.value };
                  update(next);
                }}
              />
              <input
                type="number"
                min={0}
                max={5}
                className="w-16 text-xs bg-background border border-border rounded px-2 py-2 h-9"
                value={it.rating}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...it, rating: clampRating(Number(e.target.value)) };
                  update(next);
                }}
              />
              <button
                type="button"
                onClick={() => update(items.filter((_, i) => i !== idx))}
                className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
                aria-label={pb("removeTestimonial")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            update([...items, { quote: "", author: "", role: "", avatar: "", rating: 5 }])
          }
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
        >
          <Plus className="w-3.5 h-3.5" /> {pb("addTestimonial")}
        </button>
      </div>
    </Shell>
  );
}

// ===== Pricing Table =====

interface PricingPlan {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  featured: boolean;
}

/** Tekst pola -> lista funkcji: linia = funkcja, bez spacji na końcu i pustych linii. */
function toFeatures(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trimEnd())
    .filter((s) => s.length > 0);
}

/**
 * Funkcje planu z dokumentu. Napis i liczba to treść; `null`, obiekt czy
 * tablica z importu NIE są funkcją - `String()` zrobiłby z nich „null"
 * i „[object Object]", a pierwsza edycja planu utrwaliłaby ten napis.
 */
function readFeatures(raw: Json | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is string | number => typeof f === "string" || typeof f === "number")
    .map(String);
}

/**
 * Pole „funkcje, po jednej w linii". Zapis do dokumentu jest OCZYSZCZONY
 * (`toFeatures`), więc pole nie może czytać wartości z zapisu: edytor jest
 * sterowany przez dokument i po każdym znaku dostawałby tekst bez spacji
 * na końcu i bez nowej linii - spacji między słowami i Entera na końcu
 * linii nie dało się wpisać. Szkic trzyma surowy tekst, ale TYLKO dopóki
 * zgadza się z dokumentem: zmiana z zewnątrz (cofnięcie) wygrywa.
 */
function FeaturesField({
  features,
  placeholder,
  onChange,
}: {
  features: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const stored = features.join("\n");
  const value = draft !== null && toFeatures(draft).join("\n") === stored ? draft : stored;
  return (
    <textarea
      className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[60px]"
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(toFeatures(e.target.value));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export function PricingTableBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const pb = (k: string) => i18n.editor("presentationBlocks", k);
  const itemsRaw = Array.isArray(block.data.plans) ? (block.data.plans as Json[]) : [];
  const plans: PricingPlan[] = itemsRaw.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return {
      name: String(o.name ?? ""),
      price: String(o.price ?? ""),
      period: String(o.period ?? ""),
      description: String(o.description ?? ""),
      features: readFeatures(o.features),
      ctaLabel: String(o.ctaLabel ?? ""),
      ctaHref: String(o.ctaHref ?? ""),
      featured: o.featured === true,
    };
  });

  const update = (next: PricingPlan[]) => {
    onChange({ ...block, data: { ...block.data, plans: toJsonArray(next) } });
  };

  return (
    <Shell label={pb("pricingLabel")}>
      {plans.map((p, idx) => (
        <div key={idx} className="rounded border border-border p-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder={pb("planName")}
              value={p.name}
              onChange={(e) => {
                const next = [...plans];
                next[idx] = { ...p, name: e.target.value };
                update(next);
              }}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={p.featured}
                onChange={(e) => {
                  const next = [...plans];
                  next[idx] = { ...p, featured: e.target.checked };
                  update(next);
                }}
              />
              {pb("featured")}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder={pb("price")}
              value={p.price}
              onChange={(e) => {
                const next = [...plans];
                next[idx] = { ...p, price: e.target.value };
                update(next);
              }}
            />
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder={pb("period")}
              value={p.period}
              onChange={(e) => {
                const next = [...plans];
                next[idx] = { ...p, period: e.target.value };
                update(next);
              }}
            />
          </div>
          <input
            className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
            placeholder={pb("shortDesc")}
            value={p.description}
            onChange={(e) => {
              const next = [...plans];
              next[idx] = { ...p, description: e.target.value };
              update(next);
            }}
          />
          <FeaturesField
            features={p.features}
            placeholder={pb("features")}
            onChange={(features) => {
              const next = [...plans];
              next[idx] = { ...p, features };
              update(next);
            }}
          />
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder={pb("ctaLabel")}
              value={p.ctaLabel}
              onChange={(e) => {
                const next = [...plans];
                next[idx] = { ...p, ctaLabel: e.target.value };
                update(next);
              }}
            />
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder={pb("ctaUrl")}
              value={p.ctaHref}
              onChange={(e) => {
                const next = [...plans];
                next[idx] = { ...p, ctaHref: e.target.value };
                update(next);
              }}
            />
            <button
              type="button"
              onClick={() => update(plans.filter((_, i) => i !== idx))}
              className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
              aria-label={pb("removePlan")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          update([
            ...plans,
            {
              name: "",
              price: "",
              period: "",
              description: "",
              features: [],
              ctaLabel: "",
              ctaHref: "",
              featured: false,
            },
          ])
        }
        className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
      >
        <Plus className="w-3.5 h-3.5" /> {pb("addPlan")}
      </button>
    </Shell>
  );
}

// ===== Timeline =====

interface TimelineItem {
  date: string;
  title: string;
  description: string;
}

export function TimelineBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const pb = (k: string) => i18n.editor("presentationBlocks", k);
  const itemsRaw = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: TimelineItem[] = itemsRaw.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return {
      date: String(o.date ?? ""),
      title: String(o.title ?? ""),
      description: String(o.description ?? ""),
    };
  });
  const update = (next: TimelineItem[]) => {
    onChange({ ...block, data: { ...block.data, items: toJsonArray(next) } });
  };

  return (
    <Shell label={pb("timelineLabel")}>
      {items.map((it, idx) => (
        <div key={idx} className="rounded border border-border p-2 space-y-1.5">
          <div className="grid grid-cols-[1fr_2fr_auto] gap-2">
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder={pb("date")}
              value={it.date}
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...it, date: e.target.value };
                update(next);
              }}
            />
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder={i18n.field("title")}
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
              className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
              aria-label={pb("removeStage")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[56px]"
            placeholder={pb("descOptional")}
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
        onClick={() => update([...items, { date: "", title: "", description: "" }])}
        className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-foreground/50"
      >
        <Plus className="w-3.5 h-3.5" /> {pb("addStage")}
      </button>
    </Shell>
  );
}
