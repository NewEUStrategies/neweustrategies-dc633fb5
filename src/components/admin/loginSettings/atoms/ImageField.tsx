import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { Image as ImageIcon, Moon, Sun, Upload, X } from "@/lib/lucide-shim";

export interface ImageFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  aspect?: string;
  previewBg?: "light" | "dark";
  icon?: "light" | "dark";
  fallbackUrl?: string;
  disabled?: boolean;
}

export function ImageField({
  label,
  value,
  onChange,
  hint,
  aspect = "16 / 9",
  previewBg,
  icon,
  fallbackUrl,
  disabled = false,
}: ImageFieldProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const bgClass =
    previewBg === "dark"
      ? "bg-neutral-900 border-neutral-800"
      : previewBg === "light"
        ? "bg-neutral-50 border-neutral-200"
        : "bg-muted border-border";
  const Icon = icon === "dark" ? Moon : icon === "light" ? Sun : null;
  const displayUrl = value || fallbackUrl || "";
  const isFallback = !value && Boolean(fallbackUrl);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={inputId} className="flex items-center gap-1.5">
          {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
          {label}
        </Label>
        {value ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange("")}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="h-3 w-3" aria-hidden /> {t("adminLoginSettings.clear")}
          </button>
        ) : null}
      </div>
      <div
        className={`relative flex w-full items-center justify-center overflow-hidden rounded-lg border ${bgClass}`}
        style={{ aspectRatio: aspect }}
      >
        {displayUrl ? (
          <>
            <img
              src={displayUrl}
              alt={label}
              className="absolute inset-0 h-full w-full object-cover"
            />
            {isFallback ? (
              <span className="absolute left-2 top-2 z-10 rounded-full bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white backdrop-blur">
                {t("adminLoginSettings.defaultBadge")}
              </span>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
            <ImageIcon className="h-6 w-6 opacity-60" aria-hidden />
            <span>{t("adminLoginSettings.noImage")}</span>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("adminLoginSettings.imgUrlPlaceholder")}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {t("adminLoginSettings.pick")}
        </Button>
      </div>
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
      <MediaPickerDialog
        open={open}
        onOpenChange={setOpen}
        onPick={(url) => {
          onChange(url);
          setOpen(false);
        }}
        accept="image"
        title={t("adminLoginSettings.pickImage", { label })}
      />
    </div>
  );
}
