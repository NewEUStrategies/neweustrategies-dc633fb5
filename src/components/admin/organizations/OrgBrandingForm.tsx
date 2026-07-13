// Formularz brandingu: kolory (color-picker + hex), 5 slotów logo z uploadem.
// Zapis natychmiastowy per pole (kolor - blur; logo - po uploadzie).
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { uploadOrgLogo, updateOrgBranding, type LogoSlot } from "@/lib/admin/org-branding";

type Lang = "pl" | "en";

export interface OrgBrandingValue {
  brand_primary: string;
  brand_accent: string;
  brand_ink: string;
  logo_h_light: string | null;
  logo_h_dark: string | null;
  logo_v_light: string | null;
  logo_v_dark: string | null;
  logo_favicon: string | null;
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => onChange(local)}
          className="h-9 w-12 cursor-pointer rounded border border-border/60 bg-transparent"
          aria-label={label}
        />
        <Input
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => onChange(local)}
          className="h-9 flex-1 font-mono text-sm"
          placeholder="#000000"
        />
      </div>
    </div>
  );
}

function LogoUploadSlot({
  label,
  hint,
  slot,
  url,
  onChange,
  orgId,
  lang,
}: {
  label: string;
  hint: string;
  slot: LogoSlot;
  url: string | null;
  onChange: (u: string | null) => void;
  orgId: string;
  lang: Lang;
}) {
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const isDark = slot.endsWith("_dark");
  const bgClass = isDark ? "bg-neutral-900" : "bg-neutral-50";

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const newUrl = await uploadOrgLogo(orgId, slot, file);
      await updateOrgBranding(orgId, { [slot]: newUrl });
      onChange(newUrl);
      toast.success(L("Wgrano logo", "Logo uploaded"));
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "invalid-mime") toast.error(L("Nieobsługiwany format", "Unsupported format"));
      else if (code === "too-large") toast.error(L("Plik za duży (max 2 MB)", "File too large (max 2MB)"));
      else toast.error(L("Nie udało się wgrać", "Upload failed"));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    try {
      await updateOrgBranding(orgId, { [slot]: null });
      onChange(null);
      toast.success(L("Usunięto logo", "Logo removed"));
    } catch {
      toast.error(L("Nie udało się usunąć", "Delete failed"));
    }
  };

  return (
    <div className="rounded-md border border-border/60 p-2 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium truncate">{label}</p>
          <p className="text-[10px] text-muted-foreground">{hint}</p>
        </div>
        {url ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            aria-label={L("Usuń", "Remove")}
            onClick={() => void clear()}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      <div className={`flex h-20 items-center justify-center rounded ${bgClass} p-2`}>
        {url ? (
          <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className={`text-[10px] uppercase tracking-wide ${isDark ? "text-white/60" : "text-neutral-400"}`}>
            {L("Brak", "Empty")}
          </span>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full h-8 text-xs"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mr-1.5 h-3.5 w-3.5" />
        {url ? L("Zamień", "Replace") : L("Wgraj", "Upload")}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/svg+xml,image/png,image/webp,image/jpeg,image/x-icon"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function OrgBrandingForm({
  orgId,
  value,
  onChange,
  lang,
}: {
  orgId: string;
  value: OrgBrandingValue;
  onChange: (next: OrgBrandingValue) => void;
  lang: Lang;
}) {
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);

  const saveColor = async (patch: Partial<OrgBrandingValue>) => {
    onChange({ ...value, ...patch });
    try {
      await updateOrgBranding(orgId, patch);
    } catch {
      toast.error(L("Nie zapisano koloru", "Color not saved"));
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {L("Kolory marki", "Brand colors")}
        </h3>
        <div className="grid gap-3 md:grid-cols-3">
          <ColorField
            label={L("Główny", "Primary")}
            value={value.brand_primary}
            onChange={(v) => void saveColor({ brand_primary: v })}
          />
          <ColorField
            label={L("Akcent", "Accent")}
            value={value.brand_accent}
            onChange={(v) => void saveColor({ brand_accent: v })}
          />
          <ColorField
            label={L("Tekst na tle marki", "Ink on brand")}
            value={value.brand_ink}
            onChange={(v) => void saveColor({ brand_ink: v })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {L("Logo poziome", "Horizontal logo")}
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          <LogoUploadSlot
            label={L("Poziome - jasne tło", "Horizontal - light bg")}
            hint={L("Ciemna wersja logo", "Dark logo version")}
            slot="logo_h_light"
            url={value.logo_h_light}
            onChange={(u) => onChange({ ...value, logo_h_light: u })}
            orgId={orgId}
            lang={lang}
          />
          <LogoUploadSlot
            label={L("Poziome - ciemne tło", "Horizontal - dark bg")}
            hint={L("Jasna wersja logo", "Light logo version")}
            slot="logo_h_dark"
            url={value.logo_h_dark}
            onChange={(u) => onChange({ ...value, logo_h_dark: u })}
            orgId={orgId}
            lang={lang}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {L("Logo pionowe", "Vertical logo")}
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          <LogoUploadSlot
            label={L("Pionowe - jasne tło", "Vertical - light bg")}
            hint={L("Ciemna wersja logo", "Dark logo version")}
            slot="logo_v_light"
            url={value.logo_v_light}
            onChange={(u) => onChange({ ...value, logo_v_light: u })}
            orgId={orgId}
            lang={lang}
          />
          <LogoUploadSlot
            label={L("Pionowe - ciemne tło", "Vertical - dark bg")}
            hint={L("Jasna wersja logo", "Light logo version")}
            slot="logo_v_dark"
            url={value.logo_v_dark}
            onChange={(u) => onChange({ ...value, logo_v_dark: u })}
            orgId={orgId}
            lang={lang}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {L("Favicon", "Favicon")}
        </h3>
        <div className="max-w-xs">
          <LogoUploadSlot
            label={L("Favicon", "Favicon")}
            hint={L("Kwadratowy PNG/SVG 512px", "Square PNG/SVG 512px")}
            slot="logo_favicon"
            url={value.logo_favicon}
            onChange={(u) => onChange({ ...value, logo_favicon: u })}
            orgId={orgId}
            lang={lang}
          />
        </div>
      </section>
    </div>
  );
}
