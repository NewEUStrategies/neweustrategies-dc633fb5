// PropertiesPanel - prawa kolumna buildera.
// Renderuje pola edycji dla zaznaczonego widgetu; gdy nic nie jest zaznaczone,
// pokazuje ustawienia calego dokumentu (dla popupu: kolory + layout).
import type {
  NlWidget,
  NlDoc,
  NlLang,
  NlSection,
  NlSectionLayout,
  NlSectionStyle,
  NlSectionMedia,
  NlHeadingWidget,
  NlParagraphWidget,
  NlImageWidget,
  NlDividerWidget,
  NlSpacerWidget,
  NlEmailFieldWidget,
  NlTextFieldWidget,
  NlCheckboxWidget,
  NlSubmitWidget,
  NlSuccessMessageWidget,
  NlSelectWidget,
  NlMailingListsWidget,
  NlSocialProofWidget,
  NlCountdownWidget,
  NlCtaButtonWidget,
  NlCouponWidget,
  NlCloseButtonWidget,
} from "@/lib/newsletter-builder/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Settings2 } from "lucide-react";

// Kompaktowa paleta presetow - dopasowana do design tokens projektu.
const COLOR_PRESETS: string[] = [
  "#000000", "#0a0a0a", "#1a1a1a", "#333333", "#666666", "#999999", "#cccccc", "#ffffff",
  "#f97316", "#ea580c", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981", "#14b8a6",
  "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
  "#ef4444", "#dc2626", "#b91c1c", "#7f1d1d", "transparent",
];

interface Props {
  variant: "inline" | "popup";
  doc: NlDoc;
  selected: NlWidget | null;
  selectedSection: NlSection | null;
  onPatch: (patch: Partial<NlWidget>) => void;
  onPatchPopup: (patch: Partial<NonNullable<NlDoc["popup"]>>) => void;
  onPatchSection: (patch: Partial<NlSectionStyle>) => void;
  onPatchLayout: (layout: NlSectionLayout) => void;
  onPatchSectionMedia: (patch: Partial<NlSectionMedia> | null) => void;
  lang: NlLang;
}

export function PropertiesPanel({
  variant,
  doc,
  selected,
  selectedSection,
  onPatch,
  onPatchPopup,
  onPatchSection,
  onPatchLayout,
  onPatchSectionMedia,
  lang,
}: Props) {
  const title = selected
    ? lang === "pl"
      ? "Wlasciwosci widgetu"
      : "Widget properties"
    : selectedSection
      ? lang === "pl"
        ? "Wlasciwosci sekcji"
        : "Section properties"
      : lang === "pl"
        ? "Ustawienia dokumentu"
        : "Document settings";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Settings2 className="w-3.5 h-3.5" />
        {title}
      </div>
      {selected ? (
        <WidgetProps selected={selected} onPatch={onPatch} />
      ) : selectedSection ? (
        <SectionProps
          section={selectedSection}
          onPatchSection={onPatchSection}
          onPatchLayout={onPatchLayout}
          onPatchSectionMedia={onPatchSectionMedia}
          lang={lang}
        />
      ) : (
        <DocProps
          variant={variant}
          doc={doc}
          onPatchPopup={onPatchPopup}
          onPatchLayout={onPatchLayout}
          lang={lang}
        />
      )}
    </div>
  );
}

function SectionProps({
  section,
  onPatchSection,
  onPatchLayout,
  onPatchSectionMedia,
  lang,
}: {
  section: NlSection;
  onPatchSection: (patch: Partial<NlSectionStyle>) => void;
  onPatchLayout: (layout: NlSectionLayout) => void;
  onPatchSectionMedia: (patch: Partial<NlSectionMedia> | null) => void;
  lang: NlLang;
}) {
  const st = section.style ?? {};
  const media = section.media ?? null;
  return (
    <div className="space-y-4">
      <LayoutPicker current={section.layout ?? "single"} onChange={onPatchLayout} lang={lang} />

      <div className="space-y-3 border-t border-border/60 pt-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {lang === "pl" ? "Obraz sekcji (pelna wysokosc)" : "Section image (full height)"}
          </div>
          {media && (
            <button
              type="button"
              onClick={() => onPatchSectionMedia(null)}
              className="text-[10px] text-destructive hover:underline"
            >
              {lang === "pl" ? "Usun" : "Remove"}
            </button>
          )}
        </div>
        <div>
          <Label>{lang === "pl" ? "URL obrazu" : "Image URL"}</Label>
          <Input
            value={media?.url ?? ""}
            onChange={(e) => onPatchSectionMedia({ url: e.target.value })}
            placeholder="https://..."
          />
        </div>
        {media?.url ? (
          <>
            <div>
              <Label>{lang === "pl" ? "Tekst alt" : "Alt text"}</Label>
              <Input
                value={media.alt ?? ""}
                onChange={(e) => onPatchSectionMedia({ alt: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{lang === "pl" ? "Pozycja" : "Position"}</Label>
                <Select
                  value={media.position}
                  onValueChange={(v) => onPatchSectionMedia({ position: v as "left" | "right" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">{lang === "pl" ? "Lewa" : "Left"}</SelectItem>
                    <SelectItem value="right">{lang === "pl" ? "Prawa" : "Right"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{lang === "pl" ? "Szerokosc (%)" : "Width (%)"}</Label>
                <Input
                  type="number"
                  min={10}
                  max={70}
                  value={media.widthPct ?? 40}
                  onChange={(e) =>
                    onPatchSectionMedia({
                      widthPct: Math.min(70, Math.max(10, Number(e.target.value) || 40)),
                    })
                  }
                />
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="space-y-3 border-t border-border/60 pt-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {lang === "pl" ? "Styl" : "Style"}
        </div>
        <ColorInput
          label={lang === "pl" ? "Tlo" : "Background"}
          value={st.bg}
          onChange={(v) => onPatchSection({ bg: v })}
        />
        <ColorInput
          label={lang === "pl" ? "Kolor tekstu" : "Text color"}
          value={st.fg}
          onChange={(v) => onPatchSection({ fg: v })}
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>{lang === "pl" ? "Padding X (px)" : "Padding X (px)"}</Label>
            <Input
              type="number"
              min={0}
              max={240}
              value={st.paddingX ?? 0}
              onChange={(e) => onPatchSection({ paddingX: Number(e.target.value) || 0 })}
            />
          </div>
          <div>
            <Label>{lang === "pl" ? "Padding Y (px)" : "Padding Y (px)"}</Label>
            <Input
              type="number"
              min={0}
              max={240}
              value={st.paddingY ?? 0}
              onChange={(e) => onPatchSection({ paddingY: Number(e.target.value) || 0 })}
            />
          </div>
          <div>
            <Label>{lang === "pl" ? "Odstep (px)" : "Gap (px)"}</Label>
            <Input
              type="number"
              min={0}
              max={120}
              value={st.gap ?? 12}
              onChange={(e) => onPatchSection({ gap: Number(e.target.value) || 0 })}
            />
          </div>
          <div>
            <Label>{lang === "pl" ? "Zaokraglenie" : "Radius"}</Label>
            <Input
              type="number"
              min={0}
              max={64}
              value={st.radius ?? 0}
              onChange={(e) => onPatchSection({ radius: Number(e.target.value) || 0 })}
            />
          </div>
        </div>
        <div>
          <Label>{lang === "pl" ? "Wyrownanie" : "Alignment"}</Label>
          <Select
            value={st.align ?? "left"}
            onValueChange={(v) => onPatchSection({ align: v as "left" | "center" })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">{lang === "pl" ? "Lewo" : "Left"}</SelectItem>
              <SelectItem value="center">{lang === "pl" ? "Srodek" : "Center"}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function LayoutPicker({
  current,
  onChange,
  lang,
}: {
  current: NlSectionLayout;
  onChange: (l: NlSectionLayout) => void;
  lang: NlLang;
}) {
  const options: { v: NlSectionLayout; label: string; ratio: number[] }[] = [
    { v: "single", label: lang === "pl" ? "1 kol." : "1 col", ratio: [1] },
    { v: "1-2", label: "1 / 3", ratio: [1, 2] },
    { v: "1-1", label: "1 / 2", ratio: [1, 1] },
    { v: "2-1", label: "3 / 1", ratio: [2, 1] },
  ];
  return (
    <div className="space-y-2">
      <Label>{lang === "pl" ? "Uklad sekcji" : "Section layout"}</Label>
      <div className="grid grid-cols-4 gap-1.5">
        {options.map((opt) => {
          const active = current === opt.v;
          return (
            <button
              key={opt.v}
              type="button"
              onClick={() => onChange(opt.v)}
              aria-pressed={active}
              className={
                "flex flex-col items-center gap-1 p-2 rounded-md border text-[10px] transition-colors " +
                (active
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40")
              }
            >
              <div className="flex gap-0.5 w-full h-5">
                {opt.ratio.map((r, i) => (
                  <div
                    key={i}
                    className={active ? "bg-primary/60 rounded-sm" : "bg-muted-foreground/40 rounded-sm"}
                    style={{ flex: r }}
                  />
                ))}
              </div>
              <span className="font-semibold">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


function I18nField({
  label,
  value,
  onChange,
  multiline,
  html,
}: {
  label: string;
  value: { pl: string; en: string };
  onChange: (next: { pl: string; en: string }) => void;
  multiline?: boolean;
  html?: boolean;
}) {
  const Cmp = multiline ? Textarea : Input;
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">PL</div>
        <Cmp value={value.pl} onChange={(e) => onChange({ ...value, pl: e.target.value })} />
      </div>
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">EN</div>
        <Cmp value={value.en} onChange={(e) => onChange({ ...value, en: e.target.value })} />
      </div>
      {html && (
        <p className="text-[10px] text-muted-foreground">
          HTML dozwolony (linki, pogrubienie). Skrypty sa usuwane.
        </p>
      )}
    </div>
  );
}

function ColorInput({
  label,
  value,
  onChange,
  fallback,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  fallback?: string;
}) {
  const v = value ?? fallback ?? "";
  const swatchBg = v || "transparent";
  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <div className="flex gap-1.5 items-center">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={label}
              className="h-7 w-7 shrink-0 rounded border border-input cursor-pointer relative overflow-hidden bg-[conic-gradient(from_0deg,#f3f3f3_25%,#d1d1d1_0_50%,#f3f3f3_0_75%,#d1d1d1_0)] bg-[length:8px_8px]"
            >
              <span
                className="absolute inset-0 rounded-[3px]"
                style={{ backgroundColor: swatchBg }}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" sideOffset={6} className="w-[220px] p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(v) ? v : "#000000"}
                onChange={(e) => onChange(e.target.value)}
                className="h-6 w-6 shrink-0 rounded border border-input cursor-pointer p-0 bg-transparent [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
                aria-label={`${label} - selektor`}
              />
              <Input
                value={v}
                onChange={(e) => onChange(e.target.value || null)}
                placeholder={fallback}
                className="h-6 text-[11px] font-mono px-2"
              />
            </div>
            <div className="grid grid-cols-8 gap-1">
              {COLOR_PRESETS.map((c) => {
                const active = v.toLowerCase() === c.toLowerCase();
                return (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    title={c}
                    onClick={() => onChange(c)}
                    className={
                      "h-5 w-5 rounded border transition-all bg-[conic-gradient(from_0deg,#f3f3f3_25%,#d1d1d1_0_50%,#f3f3f3_0_75%,#d1d1d1_0)] bg-[length:6px_6px] relative " +
                      (active ? "ring-2 ring-primary ring-offset-1 ring-offset-background border-primary" : "border-border/60 hover:border-primary/40")
                    }
                  >
                    <span className="absolute inset-0 rounded-[2px]" style={{ backgroundColor: c }} />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="w-full text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground py-1 border-t border-border/60 pt-2"
            >
              Wyczysc
            </button>
          </PopoverContent>
        </Popover>
        <Input
          value={v}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder={fallback}
          className="h-7 text-xs font-mono px-2"
        />
      </div>
    </div>
  );
}

function WidgetProps({
  selected,
  onPatch,
}: {
  selected: NlWidget;
  onPatch: (patch: Partial<NlWidget>) => void;
}) {
  switch (selected.type) {
    case "heading": {
      const w = selected as NlHeadingWidget;
      return (
        <div className="space-y-4">
          <I18nField label="Tekst" value={w.text} onChange={(text) => onPatch({ text } as Partial<NlWidget>)} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Poziom</Label>
              <Select
                value={String(w.level)}
                onValueChange={(v) => onPatch({ level: Number(v) as 1 | 2 | 3 | 4 } as Partial<NlWidget>)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((l) => (
                    <SelectItem key={l} value={String(l)}>
                      H{l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Wyrownanie</Label>
              <Select
                value={w.align ?? "left"}
                onValueChange={(v) => onPatch({ align: v as "left" | "center" | "right" } as Partial<NlWidget>)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">Lewo</SelectItem>
                  <SelectItem value="center">Srodek</SelectItem>
                  <SelectItem value="right">Prawo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <ColorInput label="Kolor" value={w.color} onChange={(v) => onPatch({ color: v } as Partial<NlWidget>)} />
        </div>
      );
    }
    case "paragraph": {
      const w = selected as NlParagraphWidget;
      return (
        <div className="space-y-4">
          <I18nField label="Tresc (HTML)" value={w.html} onChange={(html) => onPatch({ html } as Partial<NlWidget>)} multiline html />
          <div>
            <Label>Rozmiar</Label>
            <Select
              value={w.size ?? "md"}
              onValueChange={(v) => onPatch({ size: v as "sm" | "md" | "lg" } as Partial<NlWidget>)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sm">Maly</SelectItem>
                <SelectItem value="md">Sredni</SelectItem>
                <SelectItem value="lg">Duzy</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ColorInput label="Kolor" value={w.color} onChange={(v) => onPatch({ color: v } as Partial<NlWidget>)} />
        </div>
      );
    }
    case "image": {
      const w = selected as NlImageWidget;
      return (
        <div className="space-y-3">
          <div>
            <Label>URL obrazu</Label>
            <Input
              value={w.url ?? ""}
              onChange={(e) => onPatch({ url: e.target.value || null } as Partial<NlWidget>)}
              placeholder="https://..."
            />
          </div>
          <div>
            <Label>Tekst alt</Label>
            <Input value={w.alt ?? ""} onChange={(e) => onPatch({ alt: e.target.value } as Partial<NlWidget>)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Proporcje</Label>
              <Select
                value={w.aspect ?? "16/9"}
                onValueChange={(v) => onPatch({ aspect: v as NlImageWidget["aspect"] } as Partial<NlWidget>)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["16/7", "16/9", "1/1", "4/3", "auto"] as const).map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-end gap-2 text-xs pb-2">
              <input
                type="checkbox"
                checked={!!w.rounded}
                onChange={(e) => onPatch({ rounded: e.target.checked } as Partial<NlWidget>)}
              />
              Zaokraglone
            </label>
          </div>
        </div>
      );
    }
    case "divider": {
      const w = selected as NlDividerWidget;
      return (
        <div className="space-y-3">
          <div>
            <Label>Grubosc (px)</Label>
            <Input
              type="number"
              min={1}
              max={12}
              value={w.thickness ?? 1}
              onChange={(e) => onPatch({ thickness: Number(e.target.value) || 1 } as Partial<NlWidget>)}
            />
          </div>
          <ColorInput label="Kolor" value={w.color} onChange={(v) => onPatch({ color: v } as Partial<NlWidget>)} />
        </div>
      );
    }
    case "spacer": {
      const w = selected as NlSpacerWidget;
      return (
        <div>
          <Label>Wysokosc (px)</Label>
          <Input
            type="number"
            min={2}
            max={240}
            value={w.size}
            onChange={(e) => onPatch({ size: Number(e.target.value) || 8 } as Partial<NlWidget>)}
          />
        </div>
      );
    }
    case "field.email": {
      const w = selected as NlEmailFieldWidget;
      return (
        <div className="space-y-3">
          <I18nField label="Etykieta" value={w.label} onChange={(label) => onPatch({ label } as Partial<NlWidget>)} />
          <I18nField label="Placeholder" value={w.placeholder} onChange={(placeholder) => onPatch({ placeholder } as Partial<NlWidget>)} />
          <p className="text-[11px] text-muted-foreground">Pole e-mail jest zawsze wymagane.</p>
        </div>
      );
    }
    case "field.text": {
      const w = selected as NlTextFieldWidget;
      return (
        <div className="space-y-3">
          <div>
            <Label>Nazwa pola</Label>
            <Select
              value={w.name}
              onValueChange={(v) => onPatch({ name: v as NlTextFieldWidget["name"] } as Partial<NlWidget>)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="firstName">Imie</SelectItem>
                <SelectItem value="lastName">Nazwisko</SelectItem>
                <SelectItem value="company">Firma</SelectItem>
                <SelectItem value="position">Stanowisko</SelectItem>
                <SelectItem value="phone">Telefon</SelectItem>
                <SelectItem value="linkedin">LinkedIn</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <I18nField label="Etykieta" value={w.label} onChange={(label) => onPatch({ label } as Partial<NlWidget>)} />
          <I18nField label="Placeholder" value={w.placeholder} onChange={(placeholder) => onPatch({ placeholder } as Partial<NlWidget>)} />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!!w.required}
              onChange={(e) => onPatch({ required: e.target.checked } as Partial<NlWidget>)}
            />
            Wymagane
          </label>
        </div>
      );
    }
    case "field.checkbox": {
      const w = selected as NlCheckboxWidget;
      return (
        <div className="space-y-3">
          <div>
            <Label>Klucz zgody</Label>
            <Input value={w.key} onChange={(e) => onPatch({ key: e.target.value } as Partial<NlWidget>)} />
          </div>
          <I18nField label="Tresc (HTML)" value={w.html} onChange={(html) => onPatch({ html } as Partial<NlWidget>)} multiline html />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!!w.required}
              onChange={(e) => onPatch({ required: e.target.checked } as Partial<NlWidget>)}
            />
            Wymagana zgoda
          </label>
        </div>
      );
    }
    case "submit": {
      const w = selected as NlSubmitWidget;
      return (
        <div className="space-y-3">
          <I18nField label="Etykieta" value={w.label} onChange={(label) => onPatch({ label } as Partial<NlWidget>)} />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!!w.fullWidth}
              onChange={(e) => onPatch({ fullWidth: e.target.checked } as Partial<NlWidget>)}
            />
            Pelna szerokosc
          </label>
          <ColorInput label="Tlo" value={w.bg} onChange={(v) => onPatch({ bg: v } as Partial<NlWidget>)} />
          <ColorInput label="Tekst" value={w.fg} onChange={(v) => onPatch({ fg: v } as Partial<NlWidget>)} />
        </div>
      );
    }
    case "success-message": {
      const w = selected as NlSuccessMessageWidget;
      return <I18nField label="Komunikat" value={w.text} onChange={(text) => onPatch({ text } as Partial<NlWidget>)} multiline />;
    }
    case "field.select": {
      const w = selected as NlSelectWidget;
      return (
        <div className="space-y-3">
          <div>
            <Label>Nazwa (klucz meta)</Label>
            <Input value={w.name} onChange={(e) => onPatch({ name: e.target.value } as Partial<NlWidget>)} />
          </div>
          <I18nField label="Etykieta" value={w.label} onChange={(label) => onPatch({ label } as Partial<NlWidget>)} />
          <I18nField label="Placeholder" value={w.placeholder} onChange={(placeholder) => onPatch({ placeholder } as Partial<NlWidget>)} />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={!!w.required} onChange={(e) => onPatch({ required: e.target.checked } as Partial<NlWidget>)} />
            Wymagane
          </label>
          <div className="space-y-2">
            <Label>Opcje</Label>
            {w.options.map((o, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 items-center">
                <Input value={o.value} placeholder="value" onChange={(e) => {
                  const next = [...w.options]; next[i] = { ...o, value: e.target.value };
                  onPatch({ options: next } as Partial<NlWidget>);
                }} />
                <Input value={o.labelPl} placeholder="PL" onChange={(e) => {
                  const next = [...w.options]; next[i] = { ...o, labelPl: e.target.value };
                  onPatch({ options: next } as Partial<NlWidget>);
                }} />
                <Input value={o.labelEn} placeholder="EN" onChange={(e) => {
                  const next = [...w.options]; next[i] = { ...o, labelEn: e.target.value };
                  onPatch({ options: next } as Partial<NlWidget>);
                }} />
                <button type="button" className="text-destructive text-xs px-2" onClick={() => {
                  const next = w.options.filter((_, j) => j !== i);
                  onPatch({ options: next } as Partial<NlWidget>);
                }}>×</button>
              </div>
            ))}
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-dashed border-border hover:border-primary"
              onClick={() => onPatch({ options: [...w.options, { value: `opt${w.options.length + 1}`, labelPl: "", labelEn: "" }] } as Partial<NlWidget>)}
            >+ dodaj opcje</button>
          </div>
        </div>
      );
    }
    case "field.mailing-lists": {
      const w = selected as NlMailingListsWidget;
      return (
        <div className="space-y-3">
          <I18nField label="Etykieta" value={w.label} onChange={(label) => onPatch({ label } as Partial<NlWidget>)} />
          <div>
            <Label>Tryb</Label>
            <Select value={w.display ?? "checkboxes"} onValueChange={(v) => onPatch({ display: v as "select" | "checkboxes" } as Partial<NlWidget>)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="checkboxes">Checkboxy</SelectItem>
                <SelectItem value="select">Lista rozwijana</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={!!w.required} onChange={(e) => onPatch({ required: e.target.checked } as Partial<NlWidget>)} />
            Wymagane
          </label>
          <p className="text-[11px] text-muted-foreground">Listy zarzadzasz w Overview - Ustawienia logiki.</p>
        </div>
      );
    }
    case "social-proof": {
      const w = selected as NlSocialProofWidget;
      return (
        <div className="space-y-3">
          <I18nField label="Tekst (uzyj {count})" value={w.text} onChange={(text) => onPatch({ text } as Partial<NlWidget>)} />
          <div>
            <Label>Minimalna liczba (fallback)</Label>
            <Input type="number" min={0} value={w.fallbackCount ?? 0} onChange={(e) => onPatch({ fallbackCount: Number(e.target.value) || 0 } as Partial<NlWidget>)} />
          </div>
          <div>
            <Label>Wyrownanie</Label>
            <Select value={w.align ?? "center"} onValueChange={(v) => onPatch({ align: v as "left" | "center" | "right" } as Partial<NlWidget>)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Lewo</SelectItem>
                <SelectItem value="center">Srodek</SelectItem>
                <SelectItem value="right">Prawo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    }
    case "countdown": {
      const w = selected as NlCountdownWidget;
      const dtLocal = (() => {
        const d = new Date(w.deadline);
        if (Number.isNaN(d.getTime())) return "";
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      })();
      return (
        <div className="space-y-3">
          <div>
            <Label>Deadline</Label>
            <Input type="datetime-local" value={dtLocal} onChange={(e) => {
              const iso = e.target.value ? new Date(e.target.value).toISOString() : w.deadline;
              onPatch({ deadline: iso } as Partial<NlWidget>);
            }} />
          </div>
          <ColorInput label="Akcent" value={w.accent} onChange={(v) => onPatch({ accent: v } as Partial<NlWidget>)} />
          <I18nField label="Dni" value={w.labelDays} onChange={(labelDays) => onPatch({ labelDays } as Partial<NlWidget>)} />
          <I18nField label="Godziny" value={w.labelHours} onChange={(labelHours) => onPatch({ labelHours } as Partial<NlWidget>)} />
          <I18nField label="Minuty" value={w.labelMinutes} onChange={(labelMinutes) => onPatch({ labelMinutes } as Partial<NlWidget>)} />
          <I18nField label="Sekundy" value={w.labelSeconds} onChange={(labelSeconds) => onPatch({ labelSeconds } as Partial<NlWidget>)} />
        </div>
      );
    }
    case "cta-button": {
      const w = selected as NlCtaButtonWidget;
      return (
        <div className="space-y-3">
          <I18nField label="Etykieta" value={w.label} onChange={(label) => onPatch({ label } as Partial<NlWidget>)} />
          <div>
            <Label>URL</Label>
            <Input
              value={w.url}
              onChange={(e) => onPatch({ url: e.target.value } as Partial<NlWidget>)}
              placeholder="https://... , mailto:... , /sciezka"
            />
          </div>
          <div>
            <Label>Target</Label>
            <Select
              value={w.target ?? "_self"}
              onValueChange={(v) => onPatch({ target: v as "_self" | "_blank" } as Partial<NlWidget>)}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_self">Ta sama karta</SelectItem>
                <SelectItem value="_blank">Nowa karta</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Wyrownanie</Label>
            <Select
              value={w.align ?? "center"}
              onValueChange={(v) => onPatch({ align: v as "left" | "center" | "right" } as Partial<NlWidget>)}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Do lewej</SelectItem>
                <SelectItem value="center">Wysrodkowany</SelectItem>
                <SelectItem value="right">Do prawej</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={w.fullWidth ?? false}
              onChange={(e) => onPatch({ fullWidth: e.target.checked } as Partial<NlWidget>)}
            />
            <span>Pelna szerokosc</span>
          </label>
          <ColorInput label="Tlo" value={w.bg} onChange={(v) => onPatch({ bg: v } as Partial<NlWidget>)} />
          <ColorInput label="Tekst" value={w.fg} onChange={(v) => onPatch({ fg: v } as Partial<NlWidget>)} />
        </div>
      );
    }
    case "coupon": {
      const w = selected as NlCouponWidget;
      return (
        <div className="space-y-3">
          <div>
            <Label>Kod</Label>
            <Input
              value={w.code}
              onChange={(e) => onPatch({ code: e.target.value.toUpperCase() } as Partial<NlWidget>)}
              className="font-mono uppercase"
              maxLength={64}
            />
          </div>
          <I18nField label="Podpis" value={w.label} onChange={(label) => onPatch({ label } as Partial<NlWidget>)} />
          <I18nField label="Komunikat po kopiowaniu" value={w.copiedLabel} onChange={(copiedLabel) => onPatch({ copiedLabel } as Partial<NlWidget>)} />
          <div>
            <Label>Styl</Label>
            <Select
              value={w.style ?? "dashed"}
              onValueChange={(v) => onPatch({ style: v as "boxed" | "dashed" } as Partial<NlWidget>)}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dashed">Przerywana ramka</SelectItem>
                <SelectItem value="boxed">Pelna ramka</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ColorInput label="Akcent" value={w.accent} onChange={(v) => onPatch({ accent: v } as Partial<NlWidget>)} />
        </div>
      );
    }
    case "close-button": {
      const w = selected as NlCloseButtonWidget;
      return (
        <div className="space-y-3">
          <div>
            <Label>Wariant</Label>
            <Select
              value={w.variant}
              onValueChange={(v) => onPatch({ variant: v as NlCloseButtonWidget["variant"] } as Partial<NlWidget>)}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="icon-x">Ikona X</SelectItem>
                <SelectItem value="icon-chevron">Ikona strzalka</SelectItem>
                <SelectItem value="text">Tekst</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Pozycja</Label>
            <Select
              value={w.position}
              onValueChange={(v) => onPatch({ position: v as NlCloseButtonWidget["position"] } as Partial<NlWidget>)}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="top-right">Rog gorny prawy</SelectItem>
                <SelectItem value="inline">W tresci sekcji</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {w.variant === "text" && (
            <I18nField
              label="Etykieta"
              value={w.label ?? { pl: "Zamknij", en: "Close" }}
              onChange={(label) => onPatch({ label } as Partial<NlWidget>)}
            />
          )}
          <div>
            <Label>Rozmiar (px)</Label>
            <Input
              type="number"
              min={16}
              max={96}
              value={w.size ?? 32}
              onChange={(e) => onPatch({ size: Number(e.target.value) || 32 } as Partial<NlWidget>)}
              className="h-8 text-xs"
            />
          </div>
          <ColorInput label="Tlo" value={w.bg} onChange={(v) => onPatch({ bg: v } as Partial<NlWidget>)} />
          <ColorInput label="Ikona / tekst" value={w.fg} onChange={(v) => onPatch({ fg: v } as Partial<NlWidget>)} />
        </div>
      );
    }
    default:
      return null;
  }
}

function DocProps({
  variant,
  doc,
  onPatchPopup,
  onPatchLayout,
  lang,
}: {
  variant: "inline" | "popup";
  doc: NlDoc;
  onPatchPopup: (patch: Partial<NonNullable<NlDoc["popup"]>>) => void;
  onPatchLayout: (layout: NlSectionLayout) => void;
  lang: NlLang;
}) {
  const currentLayout: NlSectionLayout = doc.sections[0]?.layout ?? "single";
  const layoutBlock = (
    <div className="space-y-2">
      <Label>{lang === "pl" ? "Uklad sekcji" : "Section layout"}</Label>
      <div className="grid grid-cols-4 gap-1.5">
        {(
          [
            { v: "single" as const, label: lang === "pl" ? "1 kol." : "1 col", ratio: [1] },
            { v: "1-2" as const, label: "1 / 3", ratio: [1, 2] },
            { v: "1-1" as const, label: "1 / 2", ratio: [1, 1] },
            { v: "2-1" as const, label: "3 / 1", ratio: [2, 1] },
          ]
        ).map((opt) => {
          const active = currentLayout === opt.v;
          return (
            <button
              key={opt.v}
              type="button"
              onClick={() => onPatchLayout(opt.v)}
              className={
                "flex flex-col items-center gap-1 p-2 rounded-md border text-[10px] transition-colors " +
                (active
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40")
              }
              aria-pressed={active}
            >
              <div className="flex gap-0.5 w-full h-5">
                {opt.ratio.map((r, i) => (
                  <div
                    key={i}
                    className={active ? "bg-primary/60 rounded-sm" : "bg-muted-foreground/40 rounded-sm"}
                    style={{ flex: r }}
                  />
                ))}
              </div>
              <span className="font-semibold">{opt.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {lang === "pl"
          ? "Wybierz uklad i przeciagnij widgety pomiedzy kolumnami."
          : "Pick a layout and drag widgets between columns."}
      </p>
    </div>
  );

  if (variant === "inline") {
    return (
      <div className="space-y-4">
        {layoutBlock}
        <p className="text-xs text-muted-foreground">
          {lang === "pl"
            ? "Wybierz widget na kanwie aby edytowac jego wlasciwosci, lub przeciagnij nowy z lewego panelu."
            : "Select a widget on the canvas to edit its properties, or drag a new one from the left panel."}
        </p>
      </div>
    );
  }
  const p = doc.popup ?? {};
  return (
    <div className="space-y-4">
      {layoutBlock}
      <p className="text-xs text-muted-foreground">
        Ustawienia globalne popupu. Wybierz widget na kanwie aby edytowac jego wlasciwosci.
      </p>
      <div>
        <Label>Uklad</Label>
        <Select value={p.layout ?? "stacked"} onValueChange={(v) => onPatchPopup({ layout: v as "stacked" | "split" })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="stacked">Klasyczny (okladka u gory)</SelectItem>
            <SelectItem value="split">Split (grafika z lewej)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {p.layout === "split" && (
        <div>
          <Label>URL grafiki bocznej</Label>
          <Input
            value={p.sideImage ?? ""}
            onChange={(e) => onPatchPopup({ sideImage: e.target.value || null })}
            placeholder="https://..."
          />
        </div>
      )}
      <ColorInput label="Tlo popupu" value={p.bg} onChange={(v) => onPatchPopup({ bg: v ?? undefined })} fallback="#0a0a0a" />
      <ColorInput label="Kolor tekstu" value={p.fg} onChange={(v) => onPatchPopup({ fg: v ?? undefined })} fallback="#ffffff" />
      <ColorInput label="Kolor akcentu" value={p.accent} onChange={(v) => onPatchPopup({ accent: v ?? undefined })} fallback="#f97316" />
      <div>
        <Label>Overlay (rgba)</Label>
        <Input
          value={p.overlay ?? ""}
          onChange={(e) => onPatchPopup({ overlay: e.target.value })}
          placeholder="rgba(0,0,0,0.7)"
        />
      </div>
      <div>
        <Label>Zaokraglenie (px)</Label>
        <Input
          type="number"
          min={0}
          max={48}
          value={p.radius ?? 16}
          onChange={(e) => onPatchPopup({ radius: Number(e.target.value) || 0 })}
        />
      </div>
    </div>
  );
}
