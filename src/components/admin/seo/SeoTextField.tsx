// Molecule: SEO title/description field - input or textarea with the pixel
// meter, a placeholder showing the derived fallback, and a character cap.
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
  const effective = (value ?? "").trim() || fallback;
  const metric = kind === "title" ? serpTitleMetric(effective) : serpDescriptionMetric(effective);
  const handle = (next: string) => onChange(next.length ? next : null);
  return (
    <div>
      <Label className="flex items-center justify-between">
        <span>{label}</span>
        <span className="text-[10px] font-normal text-muted-foreground">
          {(value ?? "").length}/{maxLength}
        </span>
      </Label>
      {kind === "title" ? (
        <Input
          value={value ?? ""}
          maxLength={maxLength}
          placeholder={fallback}
          onChange={(e) => handle(e.target.value)}
        />
      ) : (
        <Textarea
          value={value ?? ""}
          maxLength={maxLength}
          rows={3}
          placeholder={fallback}
          onChange={(e) => handle(e.target.value)}
        />
      )}
      <SerpMeter metric={metric} />
    </div>
  );
}
