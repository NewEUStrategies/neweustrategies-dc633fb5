// Molekuła: wybór specjalizacji klubu (panel administratora).
//
// Lista pochodzi z katalogu organizacji (`club_specializations`), a nie
// z zaszytej tablicy - administrator może dodać własną specjalizację. Opcja
// "bez specjalizacji" zostaje, bo klub roboczy nie musi mieć jeszcze obszaru;
// taki klub po prostu nie pojawi się na żadnej stronie specjalizacji.
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useClubSpecializations } from "@/lib/clubs/useClubSpecializations";
import {
  buildSpecializationViews,
  fallbackSpecializationSources,
} from "@/lib/clubs/specializations";

const NONE = "__none__";

export function ClubSpecializationSelect({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  label?: string;
  hint?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const listQ = useClubSpecializations();
  const rows = listQ.data ?? [];
  const options = buildSpecializationViews(
    rows.length > 0 ? rows : fallbackSpecializationSources(),
    isPl,
    (key) => t(key),
  );
  const current = value !== null && value.trim().length > 0 ? value : NONE;
  // Specjalizacja wyłączona w międzyczasie nie może po cichu zniknąć
  // z formularza - inaczej pierwszy zapis skasowałby przypisanie klubu.
  const known = options.some((option) => option.slug === current);

  return (
    <div className="space-y-1.5">
      {label !== undefined ? (
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
      ) : null}
      <Select
        value={current}
        onValueChange={(next) => onChange(next === NONE ? null : next)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={t("adminClubs.specializations.none")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("adminClubs.specializations.none")}</SelectItem>
          {!known && current !== NONE ? <SelectItem value={current}>{current}</SelectItem> : null}
          {options.map((option) => (
            <SelectItem key={option.slug} value={option.slug}>
              {option.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint !== undefined ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
