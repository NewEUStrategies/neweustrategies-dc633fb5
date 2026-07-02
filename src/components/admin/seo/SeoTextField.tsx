// Molecule: SEO title/description field - input or textarea with the pixel
// meter, a placeholder showing the derived fallback, and a character cap.
// Wskazniki bledow:
//   - twardy limit znakow (maxLength) -> aria-invalid, czerwony pasek, komunikat
//   - miekkie przekroczenie budzetu pikselowego Google (grade === "long")
//     -> aria-describedby z ostrzezeniem, pole zostaje edytowalne (Google
//     tylko utnie snippet, ale nie odrzuci wpisu).
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SerpMeter } from "@/components/admin/seo/SerpMeter";
import { serpDescriptionMetric, serpTitleMetric } from "@/lib/seo/serp";

interface SeoTextFieldProps {
  label: string;
  kind: "title" | "description";
  value: string | null;
  /** Derived fallback shown as placeholder and measured when value is empty. */
  fallback: string;
  maxLength: number;
  onChange: (value: string | null) => void;
}

export function SeoTextField({
  label,
  kind,
  value,
  fallback,
  maxLength,
  onChange,
}: SeoTextFieldProps) {
  const { t } = useTranslation();
  const id = useId();
  const errorId = `${id}-err`;
  const raw = value ?? "";
  const effective = raw.trim() || fallback;
  const metric = kind === "title" ? serpTitleMetric(effective) : serpDescriptionMetric(effective);
  const overHardLimit = raw.length >= maxLength;
  const overPixelBudget = raw.length > 0 && metric.grade === "long";
  const isInvalid = overHardLimit;
  const handle = (next: string) => onChange(next.length ? next : null);
  const helperText = overHardLimit
    ? t("admin.seo.field.errorMax", {
        defaultValue: "Osiągnięto twardy limit {{max}} znaków - skróć wpis.",
        max: maxLength,
      })
    : overPixelBudget
      ? t("admin.seo.field.warnPixel", {
          defaultValue: "Za długi dla Google - zostanie ucięty w wynikach wyszukiwania.",
        })
      : null;

  const commonProps = {
    id,
    value: raw,
    maxLength,
    placeholder: fallback,
    "aria-invalid": isInvalid || undefined,
    "aria-describedby": helperText ? errorId : undefined,
    className: cn(
      (isInvalid || overPixelBudget) &&
        "border-destructive/70 focus-visible:ring-destructive/40",
    ),
  };

  return (
    <div>
      <Label htmlFor={id} className="flex items-center justify-between">
        <span>{label}</span>
        <span
          className={cn(
            "text-[10px] font-normal tabular-nums",
            overHardLimit ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {raw.length}/{maxLength}
        </span>
      </Label>
      {kind === "title" ? (
        <Input {...commonProps} onChange={(e) => handle(e.target.value)} />
      ) : (
        <Textarea {...commonProps} rows={3} onChange={(e) => handle(e.target.value)} />
      )}
      <SerpMeter metric={metric} />
      {helperText && (
        <p
          id={errorId}
          role={isInvalid ? "alert" : undefined}
          className={cn(
            "mt-1 text-[11px]",
            isInvalid ? "text-destructive" : "text-amber-600 dark:text-amber-400",
          )}
        >
          {helperText}
        </p>
      )}
    </div>
  );
}
