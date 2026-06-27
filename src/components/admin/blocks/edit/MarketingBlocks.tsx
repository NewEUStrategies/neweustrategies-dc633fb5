// Admin edytory dla Phase 4 batch 11 (sekcje marketingowe):
// hero, cta, carousel, contact-form, mimport { useBlocksI18n } from "@/lib/blocks/i18n";
ap.

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

// ===== Hero =====

export function HeroBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const d = block.data;
  return (
    <Shell label="Sekcja Hero">
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        placeholder={i18n.field("eyebrow")}
        value={String(d.eyebrow ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, eyebrow: e.target.value } })}
      />
      <input
        className="w-full text-sm font-semibold bg-background border border-border rounded px-2 py-2 h-9"
        placeholder={i18n.field("title")}
        value={String(d.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, title: e.target.value } })}
      />
      <textarea
        className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[64px]"
        placeholder={i18n.field("subtitlePh")}
        value={String(d.subtitle ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, subtitle: e.target.value } })}
      />
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        placeholder={i18n.field("coverUrl")}
        value={String(d.bgImage ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, bgImage: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          placeholder={i18n.field("ctaLabel")}
          value={String(d.ctaLabel ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, ctaLabel: e.target.value } })}
        />
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          placeholder={i18n.field("ctaUrl")}
          value={String(d.ctaHref ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, ctaHref: e.target.value } })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          placeholder={i18n.field("secondaryCtaLabel")}
          value={String(d.secondaryLabel ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, secondaryLabel: e.target.value } })}
        />
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          placeholder={i18n.field("secondaryCtaUrl")}
          value={String(d.secondaryHref ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, secondaryHref: e.target.value } })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={String(d.align ?? "center")}
          onChange={(e) => onChange({ ...block, data: { ...d, align: e.target.value } })}
        >
          <option value="left">Wyrównaj do lewej</option>
          <option value="center">Wyśrodkuj</option>
        </select>
        <select
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={String(d.height ?? "md")}
          onChange={(e) => onChange({ ...block, data: { ...d, height: e.target.value } })}
        >
          <option value="sm">Niski</option>
          <option value="md">Średni</option>
          <option value="lg">Wysoki</option>
          <option value="screen">Pełny ekran</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="range"
          min={0}
          max={90}
          value={Number(d.overlay ?? 40)}
          onChange={(e) => onChange({ ...block, data: { ...d, overlay: Number(e.target.value) } })}
          className="flex-1"
        />
        <span className="tabular-nums w-10 text-right">{Number(d.overlay ?? 40)}%</span>
        <span>Nakładka</span>
      </label>
    </Shell>
  );
}

// ===== CTA Section =====

export function CtaSectionBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const d = block.data;
  return (
    <Shell label="Sekcja CTA">
      <input
        className="w-full text-sm font-semibold bg-background border border-border rounded px-2 py-2 h-9"
        placeholder={i18n.field("title")}
        value={String(d.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, title: e.target.value } })}
      />
      <textarea
        className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[48px]"
        placeholder={i18n.field("description")}
        value={String(d.description ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, description: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          placeholder={i18n.field("ctaLabel")}
          value={String(d.ctaLabel ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, ctaLabel: e.target.value } })}
        />
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          placeholder={i18n.field("ctaUrl")}
          value={String(d.ctaHref ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, ctaHref: e.target.value } })}
        />
      </div>
      <select
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={String(d.variant ?? "primary")}
        onChange={(e) => onChange({ ...block, data: { ...d, variant: e.target.value } })}
      >
        <option value="primary">Wariant: podstawowy</option>
        <option value="muted">Wariant: stonowany</option>
        <option value="gradient">Wariant: gradient</option>
        <option value="outline">Wariant: kontur</option>
      </select>
    </Shell>
  );
}

// ===== Image Carousel =====

interface SlideItem { url: string; alt: string; caption: string; href: string }

export function ImageCarouselBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const itemsRaw = Array.isArray(block.data.items) ? (block.data.items as Json[]) : [];
  const items: SlideItem[] = itemsRaw.map((i) => {
    const o = (i ?? {}) as Record<string, Json>;
    return {
      url: String(o.url ?? ""),
      alt: String(o.alt ?? ""),
      caption: String(o.caption ?? ""),
      href: String(o.href ?? ""),
    };
  });
  const update = (next: SlideItem[]) => {
    onChange({ ...block, data: { ...block.data, items: next as unknown as Json[] } });
  };
  const autoplay = block.data.autoplay === true;
  const interval = Number(block.data.interval ?? 5000);
  const aspect = String(block.data.aspect ?? "16:9");

  return (
    <Shell label="Karuzela obrazów">
      <div className="grid grid-cols-2 gap-2">
        <select
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          value={aspect}
          onChange={(e) => onChange({ ...block, data: { ...block.data, aspect: e.target.value } })}
        >
          <option value="16:9">16:9</option>
          <option value="4:3">4:3</option>
          <option value="1:1">1:1</option>
          <option value="21:9">21:9</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={autoplay}
            onChange={(e) => onChange({ ...block, data: { ...block.data, autoplay: e.target.checked } })}
          />
          Autoodtwarzanie
        </label>
      </div>
      {autoplay ? (
        <label className="block text-xs text-muted-foreground">
          Interwał (ms)
          <input
            type="number"
            min={1500}
            max={20000}
            step={500}
            className="mt-1 w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
            value={interval}
            onChange={(e) => onChange({ ...block, data: { ...block.data, interval: Number(e.target.value) } })}
          />
        </label>
      ) : null}
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="rounded border border-border p-2 space-y-1.5">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
                placeholder={i18n.field("imageUrl")}
                value={it.url}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, url: e.target.value }; update(next);
                }}
              />
              <button
                type="button"
                onClick={() => update(items.filter((_, i) => i !== idx))}
                className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive"
                aria-label="Usuń slajd"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
                placeholder={i18n.field("alt")}
                value={it.alt}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, alt: e.target.value }; update(next);
                }}
              />
              <input
                className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
                placeholder={i18n.field("href")}
                value={it.href}
                onChange={(e) => {
                  const next = [...items]; next[idx] = { ...it, href: e.target.value }; update(next);
                }}
              />
            </div>
            <input
              className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
              placeholder={i18n.field("captionPh")}
              value={it.caption}
              onChange={(e) => {
                const next = [...items]; next[idx] = { ...it, caption: e.target.value }; update(next);
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...items, { url: "", alt: "", caption: "", href: "" }])}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:border-primary/50"
        >
          <Plus className="w-3.5 h-3.5" /> Dodaj slajd
        </button>
      </div>
    </Shell>
  );
}

// ===== Contact Form =====

export function ContactFormBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const d = block.data;
  return (
    <Shell label="Formularz kontaktowy">
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        placeholder="Tytuł (np. Napisz do nas)"
        value={String(d.title ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, title: e.target.value } })}
      />
      <textarea
        className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 min-h-[48px]"
        placeholder="Krótki opis"
        value={String(d.description ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, description: e.target.value } })}
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={d.showPhone === true}
            onChange={(e) => onChange({ ...block, data: { ...d, showPhone: e.target.checked } })}
          />
          Pole "Telefon"
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={d.showSubject !== false}
            onChange={(e) => onChange({ ...block, data: { ...d, showSubject: e.target.checked } })}
          />
          Pole "Temat"
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={d.requireConsent !== false}
            onChange={(e) => onChange({ ...block, data: { ...d, requireConsent: e.target.checked } })}
          />
          Wymagaj zgody RODO
        </label>
        <input
          className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
          placeholder="Etykieta wysyłki"
          value={String(d.submitLabel ?? "")}
          onChange={(e) => onChange({ ...block, data: { ...d, submitLabel: e.target.value } })}
        />
      </div>
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        placeholder="Komunikat sukcesu"
        value={String(d.successMessage ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, successMessage: e.target.value } })}
      />
    </Shell>
  );
}

// ===== Map (OSM iframe) =====

export function MapBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const d = block.data;
  const lat = Number(d.lat ?? 52.2297);
  const lng = Number(d.lng ?? 21.0122);
  return (
    <Shell label="Mapa">
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-muted-foreground">
          Szerokość geograficzna
          <input
            type="number"
            step="0.0001"
            className="mt-1 w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
            value={lat}
            onChange={(e) => onChange({ ...block, data: { ...d, lat: Number(e.target.value) } })}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Długość geograficzna
          <input
            type="number"
            step="0.0001"
            className="mt-1 w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
            value={lng}
            onChange={(e) => onChange({ ...block, data: { ...d, lng: Number(e.target.value) } })}
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-muted-foreground">
          Powiększenie (1-18)
          <input
            type="number"
            min={1}
            max={18}
            className="mt-1 w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
            value={Number(d.zoom ?? 13)}
            onChange={(e) => onChange({ ...block, data: { ...d, zoom: Number(e.target.value) } })}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Wysokość (px)
          <input
            type="number"
            min={160}
            max={800}
            className="mt-1 w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
            value={Number(d.height ?? 360)}
            onChange={(e) => onChange({ ...block, data: { ...d, height: Number(e.target.value) } })}
          />
        </label>
      </div>
      <input
        className="w-full text-xs bg-background border border-border rounded px-2 py-2 h-9"
        placeholder="Etykieta markera (np. Nasza siedziba)"
        value={String(d.label ?? "")}
        onChange={(e) => onChange({ ...block, data: { ...d, label: e.target.value } })}
      />
    </Shell>
  );
}
