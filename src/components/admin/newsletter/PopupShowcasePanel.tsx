// Panel administracyjny popupu newslettera (wariant "showcase" i pozostałe).
// Pełna kontrola nad treścią popupu:
//  - Układ: wariant, strona galerii, promień rogów
//  - Lewa strona: marka, hasło, 4 kafle galerii (upload + podpisy PL/EN),
//    rotacja, kolory gradientu, przełączniki elementów
//  - Prawa strona: eyebrow, tytuł, opis, CTA, notka, pola formularza
//    (włącz/wymagane + etykiety PL/EN) oraz zgody (prywatność, regulamin)
//  - Kolory: tło, tekst, tekst pomocniczy, akcent, tekst na akcencie, overlay
// Sekcja ma własny podgląd na żywo (PL/EN) 1:1 z widokiem publicznym.
import { useState } from "react";
import {
  Eye,
  Image as ImageIcon,
  LayoutGrid,
  PanelLeft,
  Palette,
  ListChecks,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ImageSlot } from "@/components/admin/builder/ui/organisms/widget-properties/ImageSlot";
import { PopupPreview } from "@/components/admin/newsletter/PopupPreview";
import {
  resolvePopupFields,
  isPopupFieldLocked,
  type PopupFieldConfig,
} from "@/lib/newsletter/popupFields";
import type { NewsletterSettings, NewsletterShowcaseImage } from "@/hooks/useNewsletterSettings";

const SLOT_HINTS = [
  "Kafel główny - rekomendowane 1200 x 1200 px (1:1), JPG/WEBP, do 400 KB.",
  "Kafel mały - rekomendowane 600 x 600 px (1:1), JPG/WEBP, do 200 KB.",
  "Kafel mały - rekomendowane 600 x 600 px (1:1), JPG/WEBP, do 200 KB.",
  "Kafel szeroki - rekomendowane 1200 x 600 px (2:1), JPG/WEBP, do 300 KB.",
];

const LAYOUTS: { value: NewsletterSettings["popup_layout"]; title: string; desc: string }[] = [
  { value: "stacked", title: "Stacked", desc: "Okładka u góry, formularz pod nią." },
  { value: "split", title: "Split", desc: "Grafika po lewej, formularz po prawej." },
  { value: "showcase", title: "Showcase", desc: "Mozaika 4 zdjęć + formularz." },
];

const TABS = [
  { id: "layout", label: "Układ", icon: LayoutGrid },
  { id: "left", label: "Lewa strona", icon: PanelLeft },
  { id: "right", label: "Prawa strona", icon: ListChecks },
  { id: "colors", label: "Kolory", icon: Palette },
] as const;

type TabId = (typeof TABS)[number]["id"];

function emptySlot(): NewsletterShowcaseImage {
  return { url: "", caption_pl: "", caption_en: "", title_pl: "", title_en: "" };
}

function normalize(images: NewsletterShowcaseImage[]): NewsletterShowcaseImage[] {
  const out = [...images];
  while (out.length < 4) out.push(emptySlot());
  return out.slice(0, 4);
}

interface Props {
  value: NewsletterSettings;
  onChange: (patch: Partial<NewsletterSettings>) => void;
}

export function PopupShowcasePanel({ value, onChange }: Props) {
  const slots = normalize(value.popup_showcase_images ?? []);
  const fields = resolvePopupFields(value.popup_fields);
  const [lang, setLang] = useState<"pl" | "en">("pl");
  const [tab, setTab] = useState<TabId>("layout");
  const showcase = value.popup_layout === "showcase";

  const patchSlot = (index: number, patch: Partial<NewsletterShowcaseImage>) => {
    const next = slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot));
    onChange({ popup_showcase_images: next });
  };

  const patchField = (key: PopupFieldConfig["key"], patch: Partial<PopupFieldConfig>) => {
    const next = fields.map((f) => (f.key === key ? { ...f, ...patch } : f));
    onChange({ popup_fields: next });
  };

  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-5">
      <div className="flex items-center gap-2">
        <LayoutGrid className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-display text-lg">Popup - układ, galeria i treść</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={active}
              className={
                "flex items-center justify-center gap-2 whitespace-nowrap px-3 py-2 text-sm rounded-md border transition-colors " +
                (active
                  ? "border-primary bg-primary/10 text-foreground shadow-sm"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40")
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "layout" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {LAYOUTS.map((l) => {
              const active = value.popup_layout === l.value;
              return (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => onChange({ popup_layout: l.value })}
                  className={
                    "text-left p-3 rounded-md border transition-colors " +
                    (active
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40 text-muted-foreground")
                  }
                >
                  <div className="text-sm font-medium text-foreground">{l.title}</div>
                  <div className="text-[11px] mt-0.5">{l.desc}</div>
                </button>
              );
            })}
          </div>

          {showcase && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Strona galerii</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {(
                    [
                      { v: "left", label: "Galeria po lewej" },
                      { v: "right", label: "Galeria po prawej" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => onChange({ popup_showcase_side: o.v })}
                      aria-pressed={value.popup_showcase_side === o.v}
                      className={
                        "px-3 py-2 text-xs rounded-md border transition-colors " +
                        (value.popup_showcase_side === o.v
                          ? "border-primary bg-primary/10"
                          : "border-border text-muted-foreground hover:text-foreground")
                      }
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Zaokrąglenie (px)</Label>
                <Input
                  type="number"
                  min={0}
                  max={40}
                  value={value.popup_border_radius_px}
                  onChange={(e) =>
                    onChange({
                      popup_border_radius_px: Math.min(
                        40,
                        Math.max(0, Number(e.target.value) || 0),
                      ),
                    })
                  }
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Standard platformy: 6 px.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "left" && showcase && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextRow
              label="Marka (PL)"
              value={value.popup_showcase_brand_pl}
              onChange={(v) => onChange({ popup_showcase_brand_pl: v })}
              placeholder="Newsletter"
            />
            <TextRow
              label="Marka (EN)"
              value={value.popup_showcase_brand_en}
              onChange={(v) => onChange({ popup_showcase_brand_en: v })}
              placeholder="Newsletter"
            />
            <TextRow
              label="Hasło (PL)"
              value={value.popup_showcase_tagline_pl}
              onChange={(v) => onChange({ popup_showcase_tagline_pl: v })}
            />
            <TextRow
              label="Hasło (EN)"
              value={value.popup_showcase_tagline_en}
              onChange={(v) => onChange({ popup_showcase_tagline_en: v })}
            />
            <div>
              <Label>Rotacja kafli (ms)</Label>
              <Input
                type="number"
                min={800}
                max={30000}
                step={100}
                value={value.popup_showcase_rotate_ms}
                onChange={(e) =>
                  onChange({
                    popup_showcase_rotate_ms: Math.min(
                      30000,
                      Math.max(800, Number(e.target.value) || 2600),
                    ),
                  })
                }
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Zakres 800-30000 ms. Rotacja startuje przy min. 2 zdjęciach.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ColorRow
                label="Gradient - start"
                value={value.popup_showcase_grad_from ?? value.popup_accent_color}
                onChange={(v) => onChange({ popup_showcase_grad_from: v })}
              />
              <ColorRow
                label="Gradient - koniec"
                value={value.popup_showcase_grad_to ?? value.popup_bg_color}
                onChange={(v) => onChange({ popup_showcase_grad_to: v })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <ToggleRow
              label="Pokaż markę"
              checked={value.popup_showcase_show_brand}
              onChange={(v) => onChange({ popup_showcase_show_brand: v })}
            />
            <ToggleRow
              label="Pokaż podpisy kafli"
              checked={value.popup_showcase_show_caption}
              onChange={(v) => onChange({ popup_showcase_show_caption: v })}
            />
            <ToggleRow
              label="Pokaż kropki"
              checked={value.popup_showcase_show_dots}
              onChange={(v) => onChange({ popup_showcase_show_dots: v })}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {slots.map((slot, index) => (
              <div key={index} className="rounded-md border border-border p-3 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Kafel {index + 1}
                </div>
                <ImageSlot
                  label="Obraz"
                  icon={<ImageIcon className="w-4 h-4" />}
                  value={slot.url}
                  onChange={(url) => patchSlot(index, { url })}
                  hint={SLOT_HINTS[index]}
                />
                {/* Kolejnosc jak w popupie: najpierw opis, pod nim tytul kafla. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <TextRow
                    label="Opis (PL)"
                    value={slot.caption_pl}
                    onChange={(v) => patchSlot(index, { caption_pl: v })}
                  />
                  <TextRow
                    label="Opis (EN)"
                    value={slot.caption_en}
                    onChange={(v) => patchSlot(index, { caption_en: v })}
                  />
                  <TextRow
                    label="Tytuł (PL)"
                    value={slot.title_pl ?? ""}
                    onChange={(v) => patchSlot(index, { title_pl: v })}
                  />
                  <TextRow
                    label="Tytuł (EN)"
                    value={slot.title_en ?? ""}
                    onChange={(v) => patchSlot(index, { title_en: v })}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "left" && !showcase && (
        <div className="space-y-3">
          <ImageSlot
            label="Grafika boczna / okładka"
            icon={<ImageIcon className="w-4 h-4" />}
            value={value.popup_side_image_url ?? ""}
            onChange={(url) => onChange({ popup_side_image_url: url || null })}
            hint="Układ split - rekomendowane 1000 x 1200 px (5:6). Stacked - 1200 x 600 px (2:1)."
          />
          <ImageSlot
            label="Okładka (stacked)"
            icon={<ImageIcon className="w-4 h-4" />}
            value={value.popup_cover_url ?? ""}
            onChange={(url) => onChange({ popup_cover_url: url || null })}
            hint="Rekomendowane 1200 x 600 px (2:1), JPG/WEBP, do 300 KB."
          />
        </div>
      )}

      {tab === "right" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextRow
              label="Eyebrow (PL)"
              value={value.popup_eyebrow_pl}
              onChange={(v) => onChange({ popup_eyebrow_pl: v })}
            />
            <TextRow
              label="Eyebrow (EN)"
              value={value.popup_eyebrow_en}
              onChange={(v) => onChange({ popup_eyebrow_en: v })}
            />
            <TextRow
              label="Tytuł (PL)"
              value={value.popup_title_pl}
              onChange={(v) => onChange({ popup_title_pl: v })}
            />
            <TextRow
              label="Tytuł (EN)"
              value={value.popup_title_en}
              onChange={(v) => onChange({ popup_title_en: v })}
            />
            <div>
              <Label>Opis (PL)</Label>
              <Textarea
                rows={3}
                value={value.popup_description_pl}
                onChange={(e) => onChange({ popup_description_pl: e.target.value })}
              />
            </div>
            <div>
              <Label>Opis (EN)</Label>
              <Textarea
                rows={3}
                value={value.popup_description_en}
                onChange={(e) => onChange({ popup_description_en: e.target.value })}
              />
            </div>
            <TextRow
              label="Przycisk CTA (PL)"
              value={value.popup_cta_pl}
              onChange={(v) => onChange({ popup_cta_pl: v })}
            />
            <TextRow
              label="Przycisk CTA (EN)"
              value={value.popup_cta_en}
              onChange={(v) => onChange({ popup_cta_en: v })}
            />
            <TextRow
              label="Notka pod formularzem (PL)"
              value={value.popup_note_pl ?? ""}
              onChange={(v) => onChange({ popup_note_pl: v || null })}
            />
            <TextRow
              label="Notka pod formularzem (EN)"
              value={value.popup_note_en ?? ""}
              onChange={(v) => onChange({ popup_note_en: v || null })}
            />
          </div>

          <div className="rounded-md border border-border p-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pola formularza
            </div>
            <ToggleRow
              label="Rozszerzone pola (imię, nazwisko, firma, LinkedIn, telefon)"
              checked={value.popup_extended_fields}
              onChange={(v) => onChange({ popup_extended_fields: v })}
            />
            <div className="space-y-2">
              {fields.map((field) => {
                const locked = isPopupFieldLocked(field.key);
                return (
                  <div
                    key={field.key}
                    className="grid grid-cols-1 sm:grid-cols-[auto_auto_1fr_1fr] items-center gap-2 rounded-md border border-border p-2"
                  >
                    <ToggleRow
                      label="Widoczne"
                      checked={field.enabled}
                      disabled={locked}
                      onChange={(v) => patchField(field.key, { enabled: v })}
                    />
                    <ToggleRow
                      label="Wymagane"
                      checked={field.required}
                      disabled={locked || !field.enabled}
                      onChange={(v) => patchField(field.key, { required: v })}
                    />
                    <Input
                      aria-label={`Etykieta PL - ${field.key}`}
                      value={field.label_pl}
                      onChange={(e) => patchField(field.key, { label_pl: e.target.value })}
                      placeholder="Etykieta PL"
                    />
                    <Input
                      aria-label={`Etykieta EN - ${field.key}`}
                      value={field.label_en}
                      onChange={(e) => patchField(field.key, { label_en: e.target.value })}
                      placeholder="Etykieta EN"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-md border border-border p-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Zgody
            </div>
            <ToggleRow
              label="Wymagaj zgody na Politykę prywatności"
              checked={value.popup_require_privacy}
              onChange={(v) => onChange({ popup_require_privacy: v })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Treść zgody (PL, HTML)</Label>
                <Textarea
                  rows={3}
                  value={value.popup_privacy_html_pl ?? value.policy_html_pl ?? ""}
                  onChange={(e) => onChange({ popup_privacy_html_pl: e.target.value || null })}
                />
              </div>
              <div>
                <Label>Treść zgody (EN, HTML)</Label>
                <Textarea
                  rows={3}
                  value={value.popup_privacy_html_en ?? value.policy_html_en ?? ""}
                  onChange={(e) => onChange({ popup_privacy_html_en: e.target.value || null })}
                />
              </div>
            </div>
            <ToggleRow
              label="Wymagaj akceptacji regulaminu"
              checked={value.popup_require_terms}
              onChange={(v) => onChange({ popup_require_terms: v })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Regulamin (PL, HTML)</Label>
                <Textarea
                  rows={2}
                  value={value.popup_terms_html_pl ?? ""}
                  onChange={(e) => onChange({ popup_terms_html_pl: e.target.value || null })}
                />
              </div>
              <div>
                <Label>Regulamin (EN, HTML)</Label>
                <Textarea
                  rows={2}
                  value={value.popup_terms_html_en ?? ""}
                  onChange={(e) => onChange({ popup_terms_html_en: e.target.value || null })}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "colors" && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ColorRow
            label="Tło popupu"
            value={value.popup_bg_color}
            onChange={(v) => onChange({ popup_bg_color: v })}
          />
          <ColorRow
            label="Tekst"
            value={value.popup_text_color}
            onChange={(v) => onChange({ popup_text_color: v })}
          />
          <ColorRow
            label="Tekst pomocniczy"
            value={value.popup_muted_color}
            onChange={(v) => onChange({ popup_muted_color: v })}
          />
          <ColorRow
            label="Akcent"
            value={value.popup_accent_color}
            onChange={(v) => onChange({ popup_accent_color: v })}
          />
          <ColorRow
            label="Tekst na akcencie"
            value={value.popup_accent_text_color}
            onChange={(v) => onChange({ popup_accent_text_color: v })}
          />
          <div>
            <Label>Overlay (CSS color)</Label>
            <Input
              value={value.popup_overlay_color}
              onChange={(e) => onChange({ popup_overlay_color: e.target.value })}
              placeholder="rgba(0,0,0,0.7)"
            />
          </div>
        </div>
      )}

      <div className="space-y-3 pt-1">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">Podgląd popupu</h4>
          <div className="ml-auto flex items-center gap-1">
            {(["pl", "en"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                aria-pressed={lang === code}
                className={
                  "px-2.5 py-1 text-xs rounded-md transition-colors " +
                  (lang === code
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground")
                }
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-border overflow-hidden bg-gradient-to-br from-muted/40 to-muted/10">
          <PopupPreview settings={value} lang={lang} />
        </div>
      </div>
    </section>
  );
}

function TextRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 rounded-md border border-border bg-transparent"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={
        "flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs transition-colors " +
        (disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted/40")
      }
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        className="h-[16px] w-[16px] shrink-0"
      />
      <span className="min-w-0">{label}</span>
    </label>
  );
}
