// PropertiesPanel - prawa kolumna buildera.
// Renderuje pola edycji dla zaznaczonego widgetu; gdy nic nie jest zaznaczone,
// pokazuje ustawienia calego dokumentu (dla popupu: kolory + layout).
import type {
  NlWidget,
  NlDoc,
  NlLang,
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
import { Settings2 } from "lucide-react";

interface Props {
  variant: "inline" | "popup";
  doc: NlDoc;
  selected: NlWidget | null;
  onPatch: (patch: Partial<NlWidget>) => void;
  onPatchPopup: (patch: Partial<NonNullable<NlDoc["popup"]>>) => void;
  lang: NlLang;
}

export function PropertiesPanel({ variant, doc, selected, onPatch, onPatchPopup, lang }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Settings2 className="w-3.5 h-3.5" />
        {selected
          ? lang === "pl"
            ? "Wlasciwosci widgetu"
            : "Widget properties"
          : lang === "pl"
            ? "Ustawienia dokumentu"
            : "Document settings"}
      </div>
      {selected ? (
        <WidgetProps selected={selected} onPatch={onPatch} />
      ) : (
        <DocProps variant={variant} doc={doc} onPatchPopup={onPatchPopup} />
      )}
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
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <input
          type="color"
          value={v || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 rounded border border-input cursor-pointer"
        />
        <Input value={v} onChange={(e) => onChange(e.target.value || null)} placeholder={fallback} />
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
    default:
      return null;
  }
}

function DocProps({
  variant,
  doc,
  onPatchPopup,
}: {
  variant: "inline" | "popup";
  doc: NlDoc;
  onPatchPopup: (patch: Partial<NonNullable<NlDoc["popup"]>>) => void;
}) {
  if (variant === "inline") {
    return (
      <p className="text-xs text-muted-foreground">
        Wybierz widget na kanwie aby edytowac jego wlasciwosci, lub przeciagnij nowy z lewego panelu.
      </p>
    );
  }
  const p = doc.popup ?? {};
  return (
    <div className="space-y-3">
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
