// Custom font uploader for the admin "Design" panel.
// Uploads .woff2/.woff/.ttf/.otf to the public `media` bucket under
// `<tenantId>/fonts/*` and appends the entry to design tokens' `fonts.custom`.
import { useState } from "react";
import { Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { uploadCustomFont, type CustomFont } from "@/lib/theme/customFonts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  value: CustomFont[];
  onChange: (next: CustomFont[]) => void;
}

export function CustomFontUploader({ value, onChange }: Props) {
  const { tenantId } = useAuth();
  const [label, setLabel] = useState("");
  const [weight, setWeight] = useState("400");
  const [busy, setBusy] = useState(false);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    if (!tenantId) {
      toast.error("Brak tenant_id - zaloguj się ponownie");
      return;
    }
    if (!label.trim()) {
      toast.error("Podaj nazwę fontu");
      return;
    }
    setBusy(true);
    const font = await uploadCustomFont({ file, label: label.trim(), tenantId, weight });
    setBusy(false);
    if (!font) return;
    if (value.some((f) => f.id === font.id)) {
      toast.error(`Font o id "${font.id}" już istnieje`);
      return;
    }
    onChange([...value, font]);
    setLabel("");
    toast.success(`Dodano font ${font.label}`);
  };

  const remove = (id: string) => onChange(value.filter((f) => f.id !== id));

  return (
    <div className="space-y-3 rounded-md border border-border p-4 bg-card">
      <div className="text-sm font-medium">Własne fonty (.woff2, .woff, .ttf, .otf)</div>
      <p className="text-xs text-muted-foreground">
        Wgrane fonty pojawią się automatycznie jako opcje w wyborze fontu nagłówków i treści.
        Maksymalny rozmiar pliku - 5 MB.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_auto] gap-2 items-end">
        <div>
          <Label className="text-xs">Nazwa wyświetlana</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="np. Brand Display"
          />
        </div>
        <div>
          <Label className="text-xs">Waga (CSS)</Label>
          <Input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="400" />
        </div>
        <div>
          <Button asChild disabled={busy} size="sm">
            <label className="cursor-pointer inline-flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" />
              {busy ? "Wysyłanie..." : "Wybierz plik"}
              <input
                type="file"
                accept=".woff2,.woff,.ttf,.otf,font/*"
                className="hidden"
                onChange={(e) => onPick(e.target.files?.[0])}
              />
            </label>
          </Button>
        </div>
      </div>

      {value.length > 0 && (
        <ul className="space-y-1.5 pt-2 border-t border-border">
          {value.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-3 text-sm py-1.5 px-2 rounded hover:bg-muted/40"
            >
              <span className="flex items-center gap-3 min-w-0 flex-1">
                <span className="text-xs uppercase tracking-wider text-muted-foreground shrink-0">
                  {f.id}
                </span>
                <span className="truncate text-base" style={{ fontFamily: `"${f.id}", system-ui` }}>
                  {f.label} - Aa Bb Cc 123
                </span>
              </span>
              <span className="text-xs text-muted-foreground shrink-0">{f.weight}</span>
              <button
                onClick={() => remove(f.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Usuń ${f.label}`}
                type="button"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
