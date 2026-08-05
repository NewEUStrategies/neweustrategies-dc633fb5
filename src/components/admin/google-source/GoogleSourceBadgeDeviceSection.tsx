// Ustawienia badge „Preferowane źródło Google" dla jednego breakpointu.
// Ten sam formularz obsługuje desktop i mobile - różni je tylko tytuł sekcji.
import { Field, Checkbox, Select, NumberInput } from "@/components/admin/settings/fields";
import {
  clampMargin,
  type GoogleSourceBadgeAlign,
  type GoogleSourceBadgePlacement,
  type GoogleSourceBadgeVariant,
} from "@/lib/seo/googleSourceBadge";

interface Props {
  title: string;
  placement: GoogleSourceBadgePlacement;
  onChange: (next: GoogleSourceBadgePlacement) => void;
}

const VARIANTS: { value: GoogleSourceBadgeVariant; label: string }[] = [
  { value: "default", label: "Pełny (tytuł + podpis)" },
  { value: "compact", label: "Kompakt (sam tytuł)" },
  { value: "icon", label: "Sam sygnet" },
];

const ALIGNMENTS: { value: GoogleSourceBadgeAlign; label: string }[] = [
  { value: "start", label: "Do lewej" },
  { value: "center", label: "Wyśrodkowany" },
  { value: "end", label: "Do prawej" },
];

export function GoogleSourceBadgeDeviceSection({ title, placement, onChange }: Props) {
  const set = <K extends keyof GoogleSourceBadgePlacement>(
    key: K,
    value: GoogleSourceBadgePlacement[K],
  ) => onChange({ ...placement, [key]: value });

  return (
    <section className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <Field label="Widoczność">
        <Checkbox
          label={`Pokazuj badge na ${title.toLowerCase()}`}
          checked={placement.enabled}
          onChange={(v) => set("enabled", v)}
        />
      </Field>
      <Field label="Wariant">
        <Select
          value={placement.variant}
          onChange={(e) => set("variant", e.currentTarget.value as GoogleSourceBadgeVariant)}
        >
          {VARIANTS.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Wyrównanie">
        <Select
          value={placement.align}
          onChange={(e) => set("align", e.currentTarget.value as GoogleSourceBadgeAlign)}
        >
          {ALIGNMENTS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Marginesy (px)" hint="Zakres 0-48 px: góra, dół oraz boki.">
        <div className="grid grid-cols-3 gap-2">
          <NumberInput
            aria-label={`${title} - margines górny`}
            value={placement.marginTop}
            min={0}
            max={48}
            onChange={(e) => set("marginTop", clampMargin(e.currentTarget.value))}
          />
          <NumberInput
            aria-label={`${title} - margines dolny`}
            value={placement.marginBottom}
            min={0}
            max={48}
            onChange={(e) => set("marginBottom", clampMargin(e.currentTarget.value))}
          />
          <NumberInput
            aria-label={`${title} - marginesy boczne`}
            value={placement.marginX}
            min={0}
            max={48}
            onChange={(e) => set("marginX", clampMargin(e.currentTarget.value))}
          />
        </div>
      </Field>
    </section>
  );
}
