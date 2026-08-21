// Molekuła: JEDEN opisany wiersz tekstowy w dialogu panelu klubów.
//
// PO CO. Dwa dialogi panelu (`ClubCreateDialog`, `ClubGroupEditorDialog`)
// miały razem DZIESIĘĆ przeklejonych bloków `Label + Input|Textarea
// + podpowiedź`, różniących się czterema wartościami: `id`, kluczem etykiety,
// limitem znaków i liczbą wierszy. Dziesiąty blok był w recenzji
// nierozróżnialny od dziewiątego - a dokładnie tam mieszka pomyłka, której nie
// widać na ekranie: pole opisane etykietą angielską zapisujące treść do
// polskiego klucza wersji roboczej. Jedno wejście = jedno miejsce na tę pomyłkę.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać opisane pole i oddać jego treść. Molekuła NIE
// wie, do którego klucza wersji roboczej treść trafi, nie zna siatki, w której
// stoi, i nie czyta danych serwera.
//
// DLACZEGO NIE `ClubFormTextField`. Ta molekuła jest sterowana deskryptorem
// `ClubGeneralTextField` z tabeli zakładki „Ogólne" (dziewięć pól klubu ze
// stałymi `id`) i nie zna ani typu pola HTML (`datetime-local` harmonogramu
// działu), ani zastępczej treści odbijającej inne pole (nazwa angielska
// pokazuje polską). Wspólny deskryptor musiałby przyjąć oba zbiory pól i
// przestałby pilnować tabeli - a to była cała jego wartość.
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubDialogTextRow({
  id,
  labelKey,
  value,
  onValueChange,
  maxLength,
  rows,
  type,
  hintKey,
  placeholderKey,
  placeholderText,
  autoFocus,
  disabled,
}: {
  id: string;
  labelKey: string;
  value: string;
  onValueChange: (value: string) => void;
  maxLength?: number;
  /** Obecne = pole wielolinijkowe o tej liczbie wierszy. */
  rows?: number;
  /** Typ pola HTML (np. `datetime-local`); tylko dla pola jednolinijkowego. */
  type?: string;
  hintKey?: string;
  /** Zastępcza treść z SŁOWNIKA. */
  placeholderKey?: string;
  /** Zastępcza treść GOTOWA - odbicie innego pola, nie napis ze słownika. */
  placeholderText?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  // Etykiety pól klubu mieszkają w słowniku PANELU - molekuła dociąga go sama,
  // bo może stanąć w każdym dialogu tego obszaru.
  ensureAdminClubsI18n();
  const { t } = useTranslation();

  // Gotowa treść bije słownik: nazwa angielska odbija wpisaną nazwę polską,
  // a gdy tamta jest pusta - odbija pustkę, nie podpowiedź ze słownika.
  const placeholder =
    placeholderText ?? (placeholderKey === undefined ? undefined : t(placeholderKey));

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(labelKey)}</Label>
      {rows === undefined ? (
        <Input
          id={id}
          type={type}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
        />
      ) : (
        <Textarea
          id={id}
          rows={rows}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
        />
      )}
      {hintKey === undefined ? null : <p className="text-xs text-muted-foreground">{t(hintKey)}</p>}
    </div>
  );
}
