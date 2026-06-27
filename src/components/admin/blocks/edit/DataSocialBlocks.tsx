// Admin edytory dla Phase 4 batch 12 (data + social proof):
// team-grid, logo-grid, feature-grid, import { useBlocksI18n } from "@/lib/blocks/i18n";
alert-banner, divider-text.

import type { Block, Json } from "@/lib/blocks/types";
import { Plus, Trash2 } from "lucide-react";

interface Props { block: Block; onChange: (next: Block) => void; }

function Shell({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

const inputCls = "w-full text-xs bg-background border border-border rounded px-2 py-2 h-9";
const selectCls = inputCls;

// ===== Team Grid =====

interface TeamMember { name: string; role: string; bio: string; avatar: string; href: string; social: string }

export function TeamGridBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const rawItems = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: TeamMember[] = rawItems.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return {
      name: String(o.name ?? ""),
      role: String(o.role ?? ""),
      bio: String(o.bio ?? ""),
      avatar: String(o.avatar ?? ""),
      href: String(o.href ?? ""),
      social: String(o.social ?? ""),
    };
  });
  const update = (next: TeamMember[]) => {
    onChange({ ...block, data: { ...block.data, items: next as unknown as Json[] } });
  };
  const columns = Number(block.data.columns ?? 3);
  const shape = String(block.data.shape ?? "circle");

  return (
    <Shell label="Siatka zespołu">
      <input
        className={inputCls}
        placeholder="Tytuł sekcji (opcjonalnie)"
        value={String(block.data.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          className={selectCls}
          value={columns}
          onChange={(e) => onChange({ ...block, data: { ...block.data, columns: Number(e.target.value) } })}
        >
          <option value={2}>2 kolumny</option>
          <option value={3}>3 kolumny</option>
          <option value={4}>4 kolumny</option>
        </select>
        <select
          className={selectCls}
          value={shape}
          onChange={(e) => onChange({ ...block, data: { ...block.data, shape: e.target.value } })}
        >
          <option value="circle">Awatary okrągłe</option>
          <option value="square">Awatary kwadratowe</option>
        </select>
      </div>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="rounded border border-border p-2 space-y-1.5">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className={inputCls}
                placeholder="Imię i nazwisko"
                value={it.name}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, name: e.target.value }; update(next);
                }}
              />
              <button
                type="button"
                onClick={() => update(items.filter((_, i) => i !== idx))}
                className="px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
                aria-label="Usuń osobę"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputCls}
                placeholder="Stanowisko"
                value={it.role}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, role: e.target.value }; update(next);
                }}
              />
              <input
                className={inputCls}
                placeholder="URL profilu (opcjonalnie)"
                value={it.href}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, href: e.target.value }; update(next);
                }}
              />
            </div>
            <input
              className={inputCls}
              placeholder="URL awatara"
              value={it.avatar}
              onChange={(e) => {
                const next = [...items]; next[idx] = { ...it, avatar: e.target.value }; update(next);
              }}
            />
            <textarea
              className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[48px]"
              placeholder="Krótki opis / bio"
              value={it.bio}
              onChange={(e) => {
                const next = [...items]; next[idx] = { ...it, bio: e.target.value }; update(next);
              }}
            />
            <input
              className={inputCls}
              placeholder="LinkedIn / X / strona (URL)"
              value={it.social}
              onChange={(e) => {
                const next = [...items]; next[idx] = { ...it, social: e.target.value }; update(next);
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...items, { name: "", role: "", bio: "", avatar: "", href: "", social: "" }])}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-primary/50"
        >
          <Plus className="w-3.5 h-3.5" /> Dodaj osobę
        </button>
      </div>
    </Shell>
  );
}

// ===== Logo Grid =====

interface LogoItem { url: string; alt: string; href: string }

export function LogoGridBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const rawItems = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: LogoItem[] = rawItems.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return { url: String(o.url ?? ""), alt: String(o.alt ?? ""), href: String(o.href ?? "") };
  });
  const update = (next: LogoItem[]) => {
    onChange({ ...block, data: { ...block.data, items: next as unknown as Json[] } });
  };

  return (
    <Shell label="Siatka logotypów (klienci / partnerzy)">
      <input
        className={inputCls}
        placeholder="Tytuł sekcji (opcjonalnie)"
        value={String(block.data.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <div className="grid grid-cols-3 gap-2">
        <select
          className={selectCls}
          value={Number(block.data.columns ?? 5)}
          onChange={(e) => onChange({ ...block, data: { ...block.data, columns: Number(e.target.value) } })}
        >
          <option value={3}>3 kol.</option>
          <option value={4}>4 kol.</option>
          <option value={5}>5 kol.</option>
          <option value={6}>6 kol.</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.grayscale !== false}
            onChange={(e) => onChange({ ...block, data: { ...block.data, grayscale: e.target.checked } })}
          />
          Czarno-białe
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.bordered === true}
            onChange={(e) => onChange({ ...block, data: { ...block.data, bordered: e.target.checked } })}
          />
          Ramki
        </label>
      </div>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="rounded border border-border p-2 space-y-1.5">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className={inputCls}
                placeholder="URL logotypu"
                value={it.url}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, url: e.target.value }; update(next);
                }}
              />
              <button
                type="button"
                onClick={() => update(items.filter((_, i) => i !== idx))}
                className="px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
                aria-label="Usuń logotyp"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputCls}
                placeholder="Nazwa (alt)"
                value={it.alt}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, alt: e.target.value }; update(next);
                }}
              />
              <input
                className={inputCls}
                placeholder={i18n.field("href")}
                value={it.href}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, href: e.target.value }; update(next);
                }}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...items, { url: "", alt: "", href: "" }])}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-primary/50"
        >
          <Plus className="w-3.5 h-3.5" /> Dodaj logotyp
        </button>
      </div>
    </Shell>
  );
}

// ===== Feature Grid =====

interface FeatureItem { icon: string; title: string; description: string; href: string }

export function FeatureGridBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const rawItems = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: FeatureItem[] = rawItems.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return {
      icon: String(o.icon ?? "star"),
      title: String(o.title ?? ""),
      description: String(o.description ?? ""),
      href: String(o.href ?? ""),
    };
  });
  const update = (next: FeatureItem[]) => {
    onChange({ ...block, data: { ...block.data, items: next as unknown as Json[] } });
  };
  const iconOptions = [
    "star", "zap", "shield", "rocket", "heart", "check",
    "trophy", "target", "globe", "lightbulb", "sparkles", "gauge",
  ];

  return (
    <Shell label="Siatka funkcji / cech">
      <input
        className={inputCls}
        placeholder="Tytuł sekcji (opcjonalnie)"
        value={String(block.data.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
      />
      <textarea
        className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[48px]"
        placeholder="Podtytuł sekcji (opcjonalnie)"
        value={String(block.data.subtitle ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, subtitle: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          className={selectCls}
          value={Number(block.data.columns ?? 3)}
          onChange={(e) => onChange({ ...block, data: { ...block.data, columns: Number(e.target.value) } })}
        >
          <option value={2}>2 kolumny</option>
          <option value={3}>3 kolumny</option>
          <option value={4}>4 kolumny</option>
        </select>
        <select
          className={selectCls}
          value={String(block.data.style ?? "card")}
          onChange={(e) => onChange({ ...block, data: { ...block.data, style: e.target.value } })}
        >
          <option value="card">Styl: karta</option>
          <option value="minimal">Styl: minimal</option>
          <option value="bordered">Styl: ramka</option>
        </select>
      </div>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="rounded border border-border p-2 space-y-1.5">
            <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
              <select
                className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
                value={it.icon}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, icon: e.target.value }; update(next);
                }}
              >
                {iconOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <input
                className={inputCls}
                placeholder="Tytuł funkcji"
                value={it.title}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, title: e.target.value }; update(next);
                }}
              />
              <button
                type="button"
                onClick={() => update(items.filter((_, i) => i !== idx))}
                className="px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
                aria-label="Usuń funkcję"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[48px]"
              placeholder="Opis funkcji"
              value={it.description}
              onChange={(e) => {
                const next = [...items]; next[idx] = { ...it, description: e.target.value }; update(next);
              }}
            />
            <input
              className={inputCls}
              placeholder={i18n.field("href")}
              value={it.href}
              onChange={(e) => {
                const next = [...items]; next[idx] = { ...it, href: e.target.value }; update(next);
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...items, { icon: "star", title: "", description: "", href: "" }])}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-primary/50"
        >
          <Plus className="w-3.5 h-3.5" /> Dodaj funkcję
        </button>
      </div>
    </Shell>
  );
}

// ===== Alert Banner =====

export function AlertBannerBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const d = block.data;
  return (
    <Shell label="Banner alertu">
      <select
        className={selectCls}
        value={String(d.variant ?? "info")}
        onChange={(e) => onChange({ ...block, data: { ...d, variant: e.target.value } })}
      >
        <option value="info">Informacja (niebieski)</option>
        <option value="success">Sukces (zielony)</option>
        <option value="warning">Ostrzeżenie (żółty)</option>
        <option value="danger">Błąd (czerwony)</option>
        <option value="neutral">Neutralny (szary)</option>
      </select>
      <input
        className={inputCls}
        placeholder="Tytuł (opcjonalnie)"
        value={String(d.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, title: e.target.value } })}
      />
      <textarea
        className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[56px]"
        placeholder="Treść komunikatu"
        value={String(d.message ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, message: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          className={inputCls}
          placeholder="CTA: etykieta (opcjonalnie)"
          value={String(d.ctaLabel ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, ctaLabel: e.target.value } })}
        />
        <input
          className={inputCls}
          placeholder={i18n.field("ctaUrl")}
          value={String(d.ctaHref ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, ctaHref: e.target.value } })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={d.dismissible === true}
            onChange={(e) => onChange({ ...block, data: { ...d, dismissible: e.target.checked } })}
          />
          Można zamknąć
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={d.showIcon !== false}
            onChange={(e) => onChange({ ...block, data: { ...d, showIcon: e.target.checked } })}
          />
          Pokaż ikonę
        </label>
      </div>
    </Shell>
  );
}

// ===== Divider with text =====

export function DividerTextBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const d = block.data;
  return (
    <Shell label="Separator z tekstem">
      <input
        className={inputCls}
        placeholder="Tekst środkowy (np. lub, sekcja)"
        value={String(d.text ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, text: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          className={selectCls}
          value={String(d.align ?? "center")}
          onChange={(e) => onChange({ ...block, data: { ...d, align: e.target.value } })}
        >
          <option value="left">Tekst po lewej</option>
          <option value="center">Tekst pośrodku</option>
          <option value="right">Tekst po prawej</option>
        </select>
        <select
          className={selectCls}
          value={String(d.lineStyle ?? "solid")}
          onChange={(e) => onChange({ ...block, data: { ...d, lineStyle: e.target.value } })}
        >
          <option value="solid">Linia ciągła</option>
          <option value="dashed">Linia przerywana</option>
          <option value="dotted">Linia kropkowana</option>
        </select>
      </div>
    </Shell>
  );
}
