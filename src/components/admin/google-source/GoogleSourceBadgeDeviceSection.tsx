// Ustawienia badge „Preferowane źródło Google" dla jednego breakpointu.
// Ten sam formularz obsługuje desktop i mobile - różni je tylko tytuł sekcji.
//
// UKŁAD PIONOWY, NIE `Field`. Karty urządzeń stoją po dwie w rzędzie, więc
// dwukolumnowy `Field` (200 px na etykietę) zostawiał kontrolkom ~140 px:
// listy ucinały nazwy wariantów, a trzy pola marginesów (każde `w-32`)
// wychodziły poza kartę na sąsiednią. Etykieta nad kontrolką daje każdej
// pełną szerokość karty, a marginesy dzielą ją po równo (`min-w-0`).
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Checkbox, Select, NumberInput } from "@/components/admin/settings/fields";
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

const MARGIN_FIELDS = [
  { key: "marginTop", caption: "Góra", aria: "margines górny" },
  { key: "marginBottom", caption: "Dół", aria: "margines dolny" },
  { key: "marginX", caption: "Boki", aria: "marginesy boczne" },
] as const;

/** Wiersz karty: etykieta nad kontrolką, opcjonalna podpowiedź pod nią. */
function DeviceRow({
  label,
  hint,
  divider = true,
  children,
}: {
  label: string;
  hint?: string;
  /** Linia pod wierszem; w parze kolumn rysuje ją wspólny kontener. */
  divider?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5 py-3", divider && "border-b border-border last:border-0")}>
      <span className="text-sm font-medium">{label}</span>
      <div className="min-w-0">{children}</div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function GoogleSourceBadgeDeviceSection({ title, placement, onChange }: Props) {
  const set = <K extends keyof GoogleSourceBadgePlacement>(
    key: K,
    value: GoogleSourceBadgePlacement[K],
  ) => onChange({ ...placement, [key]: value });

  return (
    <section className="min-w-0 rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <DeviceRow label="Widoczność">
        <Checkbox
          label={`Pokazuj badge na ${title.toLowerCase()}`}
          checked={placement.enabled}
          onChange={(v) => set("enabled", v)}
        />
      </DeviceRow>
      <div className="grid gap-x-3 border-b border-border sm:grid-cols-2 ">
        <DeviceRow label="Wariant" divider={false}>
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
        </DeviceRow>
        <DeviceRow label="Wyrównanie" divider={false}>
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
        </DeviceRow>
      </div>
      <DeviceRow label="Marginesy (px)" hint="Zakres 0-48 px.">
        <div className="grid grid-cols-3 gap-2">
          {MARGIN_FIELDS.map((f) => (
            <label key={f.key} className="grid min-w-0 gap-1">
              <span className="text-xs text-muted-foreground">{f.caption}</span>
              <NumberInput
                aria-label={`${title} - ${f.aria}`}
                value={placement[f.key]}
                min={0}
                max={48}
                className="w-full min-w-0"
                onChange={(e) => set(f.key, clampMargin(e.currentTarget.value))}
              />
            </label>
          ))}
        </div>
      </DeviceRow>
    </section>
  );
}
