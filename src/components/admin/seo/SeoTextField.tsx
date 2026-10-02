// Molecule: SEO title/description field - input or textarea with the pixel
// meter, a placeholder showing the derived fallback, and a character cap.
// Wskazniki bledow:
//   - twardy limit znakow (maxLength) -> aria-invalid, czerwony pasek, komunikat
//     z role="alert" (czytnik przerywa).
//   - miekkie przekroczenie budzetu pikselowego Google (grade === "long")
//     -> aria-describedby z ostrzezeniem w STALYM regionie role="status"
//     (`severityLiveRole("warning")`), pole zostaje edytowalne (Google tylko
//     utnie snippet, ale nie odrzuci wpisu). Ostrzezenie liczy sie od wartosci
//     SKUTECZNEJ - takze gdy pole jest puste i do Google pojdzie fallback.
//     Ramka pola robi sie czerwona TYLKO przy bledzie albo przy WLASNYM wpisie
//     ponad budzetem; nietkniete puste pole z dlugim fallbackiem dostaje sam
//     komunikat w regionie status (czerwien = blad, a redakcja niczego tu nie
//     wpisala - w wiekszosci wpisow fallback opisu z zajawki ma ~1150 px).
//
// Dlaczego region jest staly, a nie warunkowy: ostrzezenie pojawia sie w trakcie
// pisania, gdy pole ma juz fokus, wiec `aria-describedby` (czytane przy wejsciu
// w pole) go nie oglosi. Region `status` musi istniec w DOM PRZED wstawieniem
// tresci, inaczej czesc czytnikow przemilczy pierwsza zmiane. Tresc zmienia sie
// tylko przy ZMIANIE STANU (brak -> ostrzezenie -> brak); kolejne znaki przy
// trwajacym ostrzezeniu nie dotykaja wezla tekstowego, wiec czytnik nie
// powtarza komunikatu przy kazdym nacisnieciu klawisza.
import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SerpMeter } from "@/components/admin/seo/SerpMeter";
import { CharCounter, isAtHardLimit } from "@/components/admin/seo/atoms/CharCounter";
import { severityLiveRole } from "@/components/admin/seo/atoms/SeverityBadge";
import { serpDescriptionMetric, serpTitleMetric } from "@/lib/seo/serp";

interface SeoTextFieldProps {
  label: string;
  kind: "title" | "description";
  value: string | null;
  /** Derived fallback shown as placeholder and measured when value is empty. */
  fallback: string;
  /**
   * Tekst, ktory przy PUSTYM polu naprawde pojdzie do Google, gdy rozni sie od
   * placeholdera - dla tytulu to fallback RAZEM z sufiksem marki
   * (`applyTitleSuffix(fallback, effectiveTitleSuffix(settings), false)`),
   * bo `<title>` dostaje sufiks tylko wtedy, gdy redakcja nie nadpisala tytulu.
   * Bez tego pole mierzy 460 px "dobrego" fallbacku, a Google tnie 737 px.
   * Domyslnie `fallback`. Wlasny wpis redakcji jest mierzony bez zmian.
   */
  measuredFallback?: string;
  maxLength: number;
  onChange: (value: string | null) => void;
}

export function SeoTextField({
  label,
  kind,
  value,
  fallback,
  measuredFallback,
  maxLength,
  onChange,
}: SeoTextFieldProps) {
  const { t } = useTranslation();
  const id = useId();
  const errorId = `${id}-err`;
  const warnId = `${id}-warn`;
  const raw = value ?? "";
  const ownValue = raw.trim();
  const effective = ownValue || (measuredFallback ?? fallback);
  // Pomiar tylko przy zmianie mierzonego tekstu: rodzic (SeoPanel) renderuje
  // wszystkie pola przy kazdym nacisnieciu klawisza w KTORYMKOLWIEK z nich.
  const metric = useMemo(
    () => (kind === "title" ? serpTitleMetric(effective) : serpDescriptionMetric(effective)),
    [kind, effective],
  );
  const overHardLimit = isAtHardLimit(raw.length, maxLength);
  // Mierzona jest wartosc SKUTECZNA, wiec i ostrzezenie od niej zalezy: przy
  // pustym polu Google dostanie fallback - i utnie go tak samo.
  const overPixelBudget = metric.grade === "long";
  const isInvalid = overHardLimit;
  // Twardy limit wygrywa: jeden komunikat naraz, nie dwa.
  const showPixelWarning = overPixelBudget && !overHardLimit;
  // Czerwien tylko dla bledu albo dla WLASNEGO wpisu ponad budzetem.
  const destructiveTone = isInvalid || (overPixelBudget && ownValue.length > 0);
  const handle = (next: string) => onChange(next.length ? next : null);
  const describedBy = overHardLimit ? errorId : showPixelWarning ? warnId : undefined;

  const commonProps = {
    id,
    value: raw,
    maxLength,
    placeholder: fallback,
    "aria-invalid": isInvalid || undefined,
    "aria-describedby": describedBy,
    className: cn(destructiveTone && "border-destructive/70 focus-visible:ring-destructive/40"),
  };

  return (
    <div>
      <Label htmlFor={id} className="flex items-center justify-between">
        <span>{label}</span>
        <CharCounter length={raw.length} max={maxLength} />
      </Label>
      {kind === "title" ? (
        <Input {...commonProps} onChange={(e) => handle(e.target.value)} />
      ) : (
        <Textarea {...commonProps} rows={3} onChange={(e) => handle(e.target.value)} />
      )}
      <SerpMeter metric={metric} />
      {overHardLimit && (
        <p
          id={errorId}
          role={severityLiveRole("error")}
          className="mt-1 text-[11px] text-destructive"
        >
          {t("admin.seo.field.errorMax", { max: maxLength })}
        </p>
      )}
      <p
        id={warnId}
        role={severityLiveRole("warning")}
        className={cn("text-[11px] text-amber-600 dark:text-amber-400", showPixelWarning && "mt-1")}
      >
        {showPixelWarning ? t("admin.seo.field.warnPixel") : null}
      </p>
    </div>
  );
}
