// Custom font uploader for the admin "Design" panel.
// Uploads .woff2/.woff/.ttf/.otf to the public `media` bucket under
// `<tenantId>/fonts/*` and appends the entry to design tokens' `fonts.custom`.
import { useState } from "react";
import { CaseSensitive, Trash2, Type, Upload } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-panes-misc";
import { useAuth } from "@/hooks/useAuth";
import { uploadCustomFont, type CustomFont } from "@/lib/theme/customFonts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UploadArea } from "@/components/ui/upload-area";
import "@/lib/i18n-upload-area";

interface Props {
  value: CustomFont[];
  onChange: (next: CustomFont[]) => void;
}

export function CustomFontUploader({ value, onChange }: Props) {
  const { t } = useTranslation();
  const { tenantId } = useAuth();
  const [label, setLabel] = useState("");
  const [weight, setWeight] = useState("400");
  const [busy, setBusy] = useState(false);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    if (!tenantId) {
      toast.error(t("adminPanesMisc.customFont.errNoTenant"));
      return;
    }
    if (!label.trim()) {
      toast.error(t("adminPanesMisc.customFont.errNoName"));
      return;
    }
    setBusy(true);
    const font = await uploadCustomFont({ file, label: label.trim(), tenantId, weight });
    setBusy(false);
    if (!font) return;
    if (value.some((f) => f.id === font.id)) {
      toast.error(t("adminPanesMisc.customFont.errDuplicate", { id: font.id }));
      return;
    }
    onChange([...value, font]);
    setLabel("");
    toast.success(t("adminPanesMisc.customFont.addedToast", { label: font.label }));
  };

  const remove = (id: string) => onChange(value.filter((f) => f.id !== id));

  return (
    <div className="space-y-3 rounded-md border border-border p-4 bg-card">
      <div className="text-sm font-medium">{t("adminPanesMisc.customFont.title")}</div>
      <p className="text-xs text-muted-foreground">{t("adminPanesMisc.customFont.hint")}</p>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-2 items-end">
        <div>
          <Label className="text-xs">{t("adminPanesMisc.customFont.displayName")}</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("adminPanesMisc.customFont.namePlaceholder")}
          />
        </div>
        <div>
          <Label className="text-xs">{t("adminPanesMisc.customFont.weight")}</Label>
          <Input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="400" />
        </div>
      </div>

      <UploadArea
        size="sm"
        title={t("uploadArea.font.title")}
        description={t("uploadArea.font.description")}
        ctaLabel={t("adminPanesMisc.customFont.pickFile")}
        busyLabel={t("adminPanesMisc.customFont.uploading")}
        busy={busy}
        icons={[Type, Upload, CaseSensitive]}
        accept=".woff2,.woff,.ttf,.otf,font/*"
        onFiles={(files) => void onPick(files[0])}
      />

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
                aria-label={t("adminPanesMisc.customFont.removeAria", { label: f.label })}
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
