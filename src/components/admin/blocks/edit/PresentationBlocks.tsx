// Admin edytory dla Phase 4 batch 10 (prezentacyjne):
// icon-box, stats-counter, testimonials, pricing-table, timeline.

import type { Block, Json } from "@/lib/blocks/types";
import { Plus, Trash2 } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";

interface Props { block: Block; onChange: (next: Block) => void; }

function Shell({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

const ICON_NAMES = [
  "star", "heart", "zap", "shield", "trophy", "rocket", "sparkles", "check",
  "clock", "globe", "users", "award", "gem", "flame", "leaf", "target",
];

// ===== Icon Box =====

export function IconBoxBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const d = block.data;
  return (
    <Shell label="Karta z ikoną">
      <select
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={String(d.icon ?? "star")}
        onChange={(e) => onChange({ ...block, data: { ...d, icon: e.target.value } })}
      >
        {ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
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
          placeholder="URL przycisku"
          value={String(d.href ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, href: e.target.value } })}
        />
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          placeholder="Etykieta przycisku"
          value={String(d.linkLabel ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, linkLabel: e.target.value } })}
        />
      </div>
      <select
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={String(d.align ?? "center")}
        onChange={(e) => onChange({ ...block, data: { ...d, align: e.target.value } })}
      >
        <option value="left">Wyrównaj do lewej</option>
        <option value="center">Wyśrodkuj</option>
      </select>
    </Shell>
  );
}

// ===== Stats Counter =====

interface StatItem { value: string; label: string; suffix: string }

export function StatsCounterBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
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
    onChange({ ...block, data: { ...block.data, items: next as unknown as Json[] } });
  };
  const duration = Number(block.data.duration ?? 1500);

  return (
    <Shell label="Liczniki / statystyki">
      <label className="block text-xs text-muted-foreground">
        Czas animacji (ms)
        <input
          type="number"
          className="mt-1 w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
          min={300}
          max={5000}
          value={duration}
          onChange={(e) => onChange({ ...block, data: { ...block.data, duration: Number(e.target.value) } })}
        />
      </label>
      {items.map((it, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
          <input
            className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
            placeholder="Wartość (np. 1200)"
            value={it.value}
            onChange={(e) => {
              const next = [...items]; next[idx] = { ...it, value: e.target.value }; update(next);
            }}
          />
          <input
            className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
            placeholder="Sufiks (+, K, %)"
            value={it.suffix}
            onChange={(e) => {
              const next = [...items]; next[idx] = { ...it, suffix: e.target.value }; update(next);
            }}
          />
          <input
            className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
            placeholder={i18n.field("label")}
            value={it.label}
            onChange={(e) => {
              const next = [...items]; next[idx] = { ...it, label: e.target.value }; update(next);
            }}
          />
          <button
            type="button"
            onClick={() => update(items.filter((_, i) => i !== idx))}
            className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
            aria-label="Usuń"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => update([...items, { value: "", label: "", suffix: "" }])}
        className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-primary/50"
      >
        <Plus className="w-3.5 h-3.5" /> Dodaj wskaźnik
      </button>
    </Shell>
  );
}

// ===== Testimonials =====

interface Testimonial { quote: string; author: string; role: string; avatar: string; rating: number }

export function TestimonialsBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const itemsRaw = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: Testimonial[] = itemsRaw.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return {
      quote: String(o.quote ?? ""),
      author: String(o.author ?? ""),
      role: String(o.role ?? ""),
      avatar: String(o.avatar ?? ""),
      rating: Number(o.rating ?? 5),
    };
  });
  const update = (next: Testimonial[]) => {
    onChange({ ...block, data: { ...block.data, items: next as unknown as Json[] } });
  };
  const layout = String(block.data.layout ?? "grid");

  return (
    <Shell label="Opinie / Testimoniale">
      <select
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={layout}
        onChange={(e) => onChange({ ...block, data: { ...block.data, layout: e.target.value } })}
      >
        <option value="grid">Siatka</option>
        <option value="slider">Slider</option>
      </select>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="rounded border border-border p-2 space-y-1.5">
            <textarea
              className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[56px]"
              placeholder="Cytat / opinia"
              value={it.quote}
              onChange={(e) => {
                const next = [...items]; next[idx] = { ...it, quote: e.target.value }; update(next);
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
                placeholder="Autor"
                value={it.author}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, author: e.target.value }; update(next);
                }}
              />
              <input
                className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
                placeholder="Rola / firma"
                value={it.role}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, role: e.target.value }; update(next);
                }}
              />
            </div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
              <input
                className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
                placeholder="URL awatara"
                value={it.avatar}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, avatar: e.target.value }; update(next);
                }}
              />
              <input
                type="number"
                min={0}
                max={5}
                className="w-16 text-xs bg-background border border-border rounded px-2 py-2 h-9"
                value={it.rating}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, rating: Number(e.target.value) }; update(next);
                }}
              />
              <button
                type="button"
                onClick={() => update(items.filter((_, i) => i !== idx))}
                className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
                aria-label="Usuń opinię"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...items, { quote: "", author: "", role: "", avatar: "", rating: 5 }])}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-primary/50"
        >
          <Plus className="w-3.5 h-3.5" /> Dodaj opinię
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

export function PricingTableBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const itemsRaw = Array.isArray(block.data.plans) ? (block.data.plans as Json[]) : [];
  const plans: PricingPlan[] = itemsRaw.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    const feats = Array.isArray(o.features) ? (o.features as Json[]).map((f) => String(f)) : [];
    return {
      name: String(o.name ?? ""),
      price: String(o.price ?? ""),
      period: String(o.period ?? ""),
      description: String(o.description ?? ""),
      features: feats,
      ctaLabel: String(o.ctaLabel ?? ""),
      ctaHref: String(o.ctaHref ?? ""),
      featured: o.featured === true,
    };
  });

  const update = (next: PricingPlan[]) => {
    onChange({ ...block, data: { ...block.data, plans: next as unknown as Json[] } });
  };

  return (
    <Shell label="Tabela cenowa">
      {plans.map((p, idx) => (
        <div key={idx} className="rounded border border-border p-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder="Nazwa planu"
              value={p.name}
              onChange={(e) => {
                const next = [...plans]; next[idx] = { ...p, name: e.target.value }; update(next);
              }}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={p.featured}
                onChange={(e) => {
                  const next = [...plans]; next[idx] = { ...p, featured: e.target.checked }; update(next);
                }}
              />
              Wyróżniony
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder="Cena (np. 49 PLN)"
              value={p.price}
              onChange={(e) => {
                const next = [...plans]; next[idx] = { ...p, price: e.target.value }; update(next);
              }}
            />
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder="Okres (np. /mies.)"
              value={p.period}
              onChange={(e) => {
                const next = [...plans]; next[idx] = { ...p, period: e.target.value }; update(next);
              }}
            />
          </div>
          <input
            className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
            placeholder="Krótki opis"
            value={p.description}
            onChange={(e) => {
              const next = [...plans]; next[idx] = { ...p, description: e.target.value }; update(next);
            }}
          />
          <textarea
            className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[60px]"
            placeholder="Funkcje (po jednej w linii)"
            value={p.features.join("\n")}
            onChange={(e) => {
              const features = e.target.value.split("\n").map((s) => s.trimEnd()).filter((s) => s.length > 0);
              const next = [...plans]; next[idx] = { ...p, features }; update(next);
            }}
          />
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder="Etykieta CTA"
              value={p.ctaLabel}
              onChange={(e) => {
                const next = [...plans]; next[idx] = { ...p, ctaLabel: e.target.value }; update(next);
              }}
            />
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder="URL CTA"
              value={p.ctaHref}
              onChange={(e) => {
                const next = [...plans]; next[idx] = { ...p, ctaHref: e.target.value }; update(next);
              }}
            />
            <button
              type="button"
              onClick={() => update(plans.filter((_, i) => i !== idx))}
              className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
              aria-label="Usuń plan"
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
            { name: "", price: "", period: "", description: "", features: [], ctaLabel: "", ctaHref: "", featured: false },
          ])
        }
        className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-primary/50"
      >
        <Plus className="w-3.5 h-3.5" /> Dodaj plan
      </button>
    </Shell>
  );
}

// ===== Timeline =====

interface TimelineItem { date: string; title: string; description: string }

export function TimelineBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
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
    onChange({ ...block, data: { ...block.data, items: next as unknown as Json[] } });
  };

  return (
    <Shell label="Oś czasu">
      {items.map((it, idx) => (
        <div key={idx} className="rounded border border-border p-2 space-y-1.5">
          <div className="grid grid-cols-[1fr_2fr_auto] gap-2">
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder="Data (np. 2024)"
              value={it.date}
              onChange={(e) => {
                const next = [...items]; next[idx] = { ...it, date: e.target.value }; update(next);
              }}
            />
            <input
              className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder={i18n.field("title")}
              value={it.title}
              onChange={(e) => {
                const next = [...items]; next[idx] = { ...it, title: e.target.value }; update(next);
              }}
            />
            <button
              type="button"
              onClick={() => update(items.filter((_, i) => i !== idx))}
              className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
              aria-label="Usuń etap"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[56px]"
            placeholder="Opis (opcjonalnie)"
            value={it.description}
            onChange={(e) => {
              const next = [...items]; next[idx] = { ...it, description: e.target.value }; update(next);
            }}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => update([...items, { date: "", title: "", description: "" }])}
        className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-primary/50"
      >
        <Plus className="w-3.5 h-3.5" /> Dodaj etap
      </button>
    </Shell>
  );
}
