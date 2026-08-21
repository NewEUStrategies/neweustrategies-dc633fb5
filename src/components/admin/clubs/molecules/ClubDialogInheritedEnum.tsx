// Molekuła: ustawienie działu ze słownika, które MOŻE dziedziczyć z klubu.
//
// PO CO. `ClubGroupEditorDialog` miał CZTERY niemal identyczne bloki
// `InheritedField` + `ClubEnumSelect`, różniące się kluczem etykiety, tablicą
// słownika i nazwą pola wersji roboczej. Każdy z nich powtarzał tę samą
// nieoczywistą regułę wyłączania: droplista jest wyłączona, gdy trwa zapis
// ALBO gdy wartość jest dziedziczona, a sam przełącznik „dziedzicz/nadpisz"
// tylko przy zapisie. Blok, w którym ten warunek zgubi drugi członek, daje
// droplistę, którą można ruszyć przy włączonym dziedziczeniu - i wybór, który
// nigdzie nie poleci, bo payload wysyła wtedy pusty string.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać, SKĄD bierze się wartość, i pozwolić to
// zmienić. Molekuła nie zna kontraktu RPC (pusty string = dziedzicz - to robi
// `clubGroupSavePayload`) ani zawężenia widoczności przy zdjęciu dziedziczenia
// (to `clubGroupOverridePatch`); dostaje gotową tablicę opcji i oddaje dwie
// intencje.
import { useTranslation } from "react-i18next";
import { InheritedField } from "../atoms/InheritedField";
import { ClubEnumSelect } from "@/components/clubs/molecules/ClubEnumSelect";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubDialogInheritedEnum<T extends string>({
  labelKey,
  i18nPrefix,
  value,
  options,
  inherited,
  disabled,
  onToggleInherit,
  onValueChange,
}: {
  labelKey: string;
  /** Prefiks klucza etykiet słownika; opcja to `${i18nPrefix}.${wartość}`. */
  i18nPrefix: string;
  value: T;
  options: readonly T[];
  inherited: boolean;
  /** Zapis w locie - blokuje i przełącznik, i droplistę. */
  disabled?: boolean;
  onToggleInherit: (inherit: boolean) => void;
  onValueChange: (value: T) => void;
}) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();

  return (
    <InheritedField
      label={t(labelKey)}
      inherited={inherited}
      onToggleInherit={onToggleInherit}
      disabled={disabled}
    >
      <ClubEnumSelect
        value={value}
        options={options}
        i18nPrefix={i18nPrefix}
        onChange={onValueChange}
        // Dwa powody wyłączenia, oba konieczne: trwający zapis i dziedziczenie.
        disabled={(disabled ?? false) || inherited}
      />
    </InheritedField>
  );
}
