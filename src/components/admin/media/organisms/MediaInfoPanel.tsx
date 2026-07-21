import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MoreVertical } from "@/lib/lucide-shim";
import type { ImageSize, MediaRow } from "../types";
import { formatBytes } from "../lib/mediaFormat";
import { InfoRow } from "../atoms/InfoRow";

interface MediaInfoPanelProps {
  target: MediaRow | null;
  imgSize: ImageSize | null;
  onSaveAlt: (id: string, altText: string) => Promise<void>;
}

/**
 * Organism: the metadata side panel. Shows dimensions/size/mime/dates and lets
 * the editor curate the alt text for images (accessibility + SEO).
 */
export function MediaInfoPanel({ target, imgSize, onSaveAlt }: MediaInfoPanelProps) {
  const { t } = useTranslation();
  const [altDraft, setAltDraft] = useState("");
  const [savingAlt, setSavingAlt] = useState(false);

  useEffect(() => {
    setAltDraft(target?.alt_text ?? "");
  }, [target?.id, target?.alt_text]);

  if (!target) {
    return (
      <p className="text-muted-foreground">
        {t("admin.media.selectOneFile", {
          defaultValue: "Zaznacz jeden plik, aby zobaczyć szczegóły.",
        })}
      </p>
    );
  }

  const isImage = target.mime_type?.startsWith("image/");
  const dirty = (target.alt_text ?? "") !== altDraft;

  return (
    <div className="space-y-3">
      {isImage ? (
        <img
          src={target.public_url}
          alt={target.alt_text || target.filename}
          className="w-full rounded border border-border object-contain max-h-56 bg-muted/20"
        />
      ) : (
        <div className="w-full aspect-video rounded bg-muted flex items-center justify-center text-3xl">
          📄
        </div>
      )}
      <div className="space-y-1">
        <div className="font-semibold truncate" title={target.filename}>
          {target.filename}
        </div>
        <InfoRow
          label={t("admin.media.infoType", { defaultValue: "Typ" })}
          value={target.mime_type ?? "-"}
        />
        <InfoRow
          label={t("admin.media.infoSize", { defaultValue: "Rozmiar" })}
          value={formatBytes(target.size_bytes)}
        />
        {imgSize && (
          <InfoRow
            label={t("admin.media.infoDimensions", { defaultValue: "Wymiary" })}
            value={`${imgSize.w} × ${imgSize.h} px`}
          />
        )}
        <InfoRow
          label={t("admin.media.infoFolder", { defaultValue: "Folder" })}
          value={target.folder_path}
        />
        <InfoRow
          label={t("admin.media.infoCreated", { defaultValue: "Utworzono" })}
          value={new Date(target.created_at).toLocaleString()}
        />
        <InfoRow label={t("admin.media.infoId", { defaultValue: "ID" })} value={target.id} mono />
      </div>
      {isImage && (
        <div className="pt-2 border-t border-border space-y-2">
          <label className="block text-muted-foreground" htmlFor={`alt-${target.id}`}>
            {t("admin.media.altText", { defaultValue: "Tekst alternatywny (alt)" })}
          </label>
          <textarea
            id={`alt-${target.id}`}
            value={altDraft}
            onChange={(e) => setAltDraft(e.target.value.slice(0, 500))}
            rows={2}
            placeholder={t("admin.media.altPlaceholder", {
              defaultValue: "Opisz obraz dla czytników ekranu i SEO",
            })}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">{altDraft.length}/500</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!dirty || savingAlt}
              onClick={async () => {
                setSavingAlt(true);
                try {
                  await onSaveAlt(target.id, altDraft.trim());
                  toast.success(t("admin.saved", { defaultValue: "Zapisano" }));
                } finally {
                  setSavingAlt(false);
                }
              }}
            >
              {savingAlt
                ? t("admin.saving", { defaultValue: "Zapisywanie…" })
                : t("admin.save", { defaultValue: "Zapisz" })}
            </Button>
          </div>
        </div>
      )}
      <div className="pt-2 border-t border-border space-y-1">
        <a
          href={target.public_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-brand hover:underline"
        >
          {t("admin.media.openInNewTab", { defaultValue: "Otwórz w nowej karcie" })}{" "}
          <MoreVertical className="w-3 h-3 rotate-90" />
        </a>
      </div>
    </div>
  );
}
