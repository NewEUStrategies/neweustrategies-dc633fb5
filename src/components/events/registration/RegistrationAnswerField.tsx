// Atom: JEDNO pole zdefiniowane przez organizatora (`event_registration_fields`).
//
// WARTOSC JEST NAPISEM ALBO LISTA NAPISOW - konwersja na liczbe/bool zyje w
// `registrationSubmitDraft.ts`. Komponent nie zna kontraktu RPC i nie powinien:
// gdyby konwertowal, mielibysmy dwa miejsca, w ktorych „false" moze zostac
// napisem „false".
//
// TYP `file` NIE JEST UPLOADEM. Zapis jest dostepny takze dla gosci bez konta,
// a publiczny wrzut plikow do storage'u byloby otwartym wiadrem. Pytanie o plik
// przyjmujemy jako ADRES (https), o czym mowi podpowiedz - lepiej niz kontrolka,
// ktora wyglada na dzialajaca i nic nie wysyla.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { RegistrationFormField } from "@/lib/events/registrationFormSurface";
import { FieldBox } from "@/components/ui/field-box";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function RegistrationAnswerField({
  field,
  value,
  onChange,
  lang,
  error,
}: {
  field: RegistrationFormField;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
  lang: "pl" | "en";
  /** Gotowe zdanie o bledzie albo `null` - komponent nie zna kluczy walidacji. */
  error: string | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const label = (lang === "en" ? field.labelEn : field.labelPl) || field.key;
  const help = lang === "en" ? field.helpEn : field.helpPl;
  const text = Array.isArray(value) ? "" : (value ?? "");
  const list = Array.isArray(value) ? value : [];
  const optionLabel = (option: { labelPl: string; labelEn: string; value: string }): string =>
    (lang === "en" ? option.labelEn : option.labelPl) || option.value;

  const describedBy = [help !== "" ? `${id}-help` : null, error !== null ? `${id}-error` : null]
    .filter((entry): entry is string => entry !== null)
    .join(" ");

  return (
    <div className="space-y-2">
      {field.fieldType === "text" || field.fieldType === "number" || field.fieldType === "date" ? (
        <FieldBox
          label={label}
          required={field.isRequired}
          invalid={error !== null}
          type={field.fieldType === "text" ? "text" : field.fieldType}
          value={text}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.fieldType === "file" ? (
        <FieldBox
          label={`${label} (https://)`}
          required={field.isRequired}
          invalid={error !== null}
          type="url"
          inputMode="url"
          value={text}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.fieldType === "textarea" ? (
        <div className="space-y-1">
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            {label}
            {field.isRequired ? " *" : ""}
          </label>
          <Textarea
            id={id}
            rows={4}
            value={text}
            aria-invalid={error !== null ? true : undefined}
            aria-describedby={describedBy === "" ? undefined : describedBy}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      ) : field.fieldType === "select" ? (
        <div className="space-y-1">
          <span className="text-sm font-medium text-foreground">
            {label}
            {field.isRequired ? " *" : ""}
          </span>
          <Select value={text === "" ? undefined : text} onValueChange={onChange}>
            <SelectTrigger
              aria-label={label}
              aria-invalid={error !== null ? true : undefined}
              aria-describedby={describedBy === "" ? undefined : describedBy}
            >
              <SelectValue placeholder={t("eventRegistration.labels.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {optionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : field.fieldType === "multiselect" ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">
            {label}
            {field.isRequired ? " *" : ""}
          </legend>
          {field.options.map((option) => {
            const checked = list.includes(option.value);
            return (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) =>
                    onChange(
                      next === true
                        ? [...list, option.value]
                        : list.filter((entry) => entry !== option.value),
                    )
                  }
                />
                <span className="text-foreground">{optionLabel(option)}</span>
              </label>
            );
          })}
        </fieldset>
      ) : (
        // checkbox / switch / consent - jedna decyzja tak/nie, jeden ksztalt.
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={text === "true"}
            aria-describedby={describedBy === "" ? undefined : describedBy}
            onCheckedChange={(next) => onChange(next === true ? "true" : "")}
          />
          <span className="text-foreground">
            {label}
            {field.isRequired ? " *" : ""}
          </span>
        </label>
      )}

      {help !== "" && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {error !== null && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
