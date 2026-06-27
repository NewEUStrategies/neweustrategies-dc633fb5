// Admin edytory dla Phase 4 batch 9 (interaktywne):
// accordion, tabs, countdown, progress.

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

// ===== Accordion =====

interface AccordionItem { title: string; body: string }

export function AccordionBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const itemsRaw = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: AccordionItem[] = itemsRaw.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return { title: String(o.title ?? ""), body: String(o.body ?? "") };
  });
  const allowMultiple = block.data.allowMultiple === true;

  const update = (next: AccordionItem[]) => {
    onChange({ ...block, data: { ...block.data, items: next as unknown as Json[] } });
  };

  return (
    <Shell label="Akordeon">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={allowMultiple}
          onChange={(e) => onChange({ ...block, data: { ...block.data, allowMultiple: e.target.checked } })}
        />
        Zezwalaj na otwieranie wielu sekcji
      </label>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="space-y-1.5 rounded border border-border p-2">
            <div className="flex gap-2">
              <input
                className="flex-1 text-xs bg-background border border-border rounded px-2 py-2 h-9"
                value={it.title}
                placeholder="Tytuł sekcji"
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
                aria-label="Usuń sekcję"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[64px]"
              value={it.body}
              placeholder="Treść (HTML / markdown)"
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...it, body: e.target.value };
                update(next);
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...items, { title: "", body: "" }])}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-primary/50"
        >
          <Plus className="w-3.5 h-3.5" /> Dodaj sekcję
        </button>
      </div>
    </Shell>
  );
}

// ===== Tabs =====

interface TabItem { label: string; body: string }

export function TabsBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const itemsRaw = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: TabItem[] = itemsRaw.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return { label: String(o.label ?? ""), body: String(o.body ?? "") };
  });
  const orientation = String(block.data.orientation ?? "horizontal");

  const update = (next: TabItem[]) => {
    onChange({ ...block, data: { ...block.data, items: next as unknown as Json[] } });
  };

  return (
    <Shell label="Zakładki">
      <select
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={orientation}
        onChange={(e) => onChange({ ...block, data: { ...block.data, orientation: e.target.value } })}
      >
        <option value="horizontal">Poziomo</option>
        <option value="vertical">Pionowo</option>
      </select>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="space-y-1.5 rounded border border-border p-2">
            <div className="flex gap-2">
              <input
                className="flex-1 text-xs bg-background border border-border rounded px-2 py-2 h-9"
                value={it.label}
                placeholder="Etykieta zakładki"
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
                aria-label="Usuń zakładkę"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[64px]"
              value={it.body}
              placeholder="Treść (HTML)"
              onChange={(e) => {
                const next = [...items];
                next[idx] = { ...it, body: e.target.value };
                update(next);
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...items, { label: "", body: "" }])}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-primary/50"
        >
          <Plus className="w-3.5 h-3.5" /> Dodaj zakładkę
        </button>
      </div>
    </Shell>
  );
}

// ===== Countdown =====

export function CountdownBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const targetAt = String(block.data.targetAt ?? "");
  const label = String(block.data.label ?? "");
  const expiredText = String(block.data.expiredText ?? "");
  return (
    <Shell label="Odliczanie">
      <input
        type="datetime-local"
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={targetAt}
        onChange={(e) => onChange({ ...block, data: { ...block.data, targetAt: e.target.value } })}
      />
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={label}
        placeholder="Opis (np. Do końca promocji)"
        onChange={(e) => onChange({ ...block, data: { ...block.data, label: e.target.value } })}
      />
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={expiredText}
        placeholder="Tekst po wygaśnięciu (np. Promocja zakończona)"
        onChange={(e) => onChange({ ...block, data: { ...block.data, expiredText: e.target.value } })}
      />
    </Shell>
  );
}

// ===== Progress =====

export function ProgressBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const value = Number(block.data.value ?? 50);
  const label = String(block.data.label ?? "");
  const showValue = block.data.showValue !== false;
  const color = String(block.data.color ?? "primary");
  return (
    <Shell label="Pasek postępu">
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={label}
        placeholder={i18n.field("label")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, label: e.target.value } })}
      />
      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange({ ...block, data: { ...block.data, value: Number(e.target.value) } })}
        />
        <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">{value}%</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={color}
          onChange={(e) => onChange({ ...block, data: { ...block.data, color: e.target.value } })}
        >
          <option value="primary">Podstawowy</option>
          <option value="success">Sukces</option>
          <option value="warning">Ostrzeżenie</option>
          <option value="danger">Krytyczny</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showValue}
            onChange={(e) => onChange({ ...block, data: { ...block.data, showValue: e.target.checked } })}
          />
          Pokaż %
        </label>
      </div>
    </Shell>
  );
}
