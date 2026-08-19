// Molekuła: JEDNO opisane pole tekstowe formularza klubu.
//
// PO CO. Zakładka „Ogólne" miała dziewięć przeklejonych bloków
// `Label + Input/Textarea + podpowiedź`, różniących się czterema wartościami.
// Dziewiąty blok był w recenzji nierozróżnialny od ósmego, a to właśnie tam
// mieszka pomyłka, której nie widać: pole opisane jako angielskie zapisujące
// wartość do kolumny polskiej. Deskryptor pola (`ClubGeneralTextField`) jest
// jedynym wejściem, więc pole nie ma sposobu rozjechać się z tabelą.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać pole i oddać jego treść. Molekuła nie wie,
// do którego klucza wersji roboczej treść trafi (to robi
// `clubGeneralTextPatch`), nie zna siatki, w której stoi, i nie czyta danych
// serwera.
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ClubGeneralTextField } from "@/lib/clubs/adminClubFormFields";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubFormTextField({
  field,
  value,
  onValueChange,
  disabled,
  warningKey,
}: {
  field: ClubGeneralTextField;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  /** Klucz i18n ostrzeżenia POD polem; brak = bez ostrzeżenia. */
  warningKey?: string;
}) {
  // Etykiety pól klubu mieszkają w słowniku PANELU - molekuła dociąga go
  // sama, bo może stanąć w każdym formularzu tego obszaru.
  ensureAdminClubsI18n();
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={field.id}>{t(field.labelKey)}</Label>
      {field.rows === undefined ? (
        <Input
          id={field.id}
          value={value}
          disabled={disabled}
          maxLength={field.maxLength}
          onChange={(event) => onValueChange(event.target.value)}
        />
      ) : (
        <Textarea
          id={field.id}
          rows={field.rows}
          value={value}
          disabled={disabled}
          maxLength={field.maxLength}
          onChange={(event) => onValueChange(event.target.value)}
        />
      )}
      {field.hintKey === undefined ? null : (
        <p className="text-xs text-muted-foreground">{t(field.hintKey)}</p>
      )}
      {warningKey === undefined ? null : (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t(warningKey)}
        </p>
      )}
    </div>
  );
}
