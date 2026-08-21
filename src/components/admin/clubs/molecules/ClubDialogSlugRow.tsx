// Molekuła: pole adresu klubu z ŻYWĄ informacją o dostępności.
//
// PO CO. W `ClubCreateDialog` ten jeden wiersz był rozrzucony na trzy miejsca:
// pole z prefiksem `/club/`, lokalny komponent `SlugState` rysujący ikonę i
// akapit pod polem, który sam liczył ton i `role="alert"`. Trzy miejsca na
// JEDNĄ informację - „czy ten adres jest wolny" - z których każde miało własną
// drabinkę warunków po tym samym stanie. Rozjechanie ich znaczy zieloną fajkę
// nad czerwonym komunikatem i odwrotnie.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać adres i to, co o nim wiadomo. Molekuła nie
// pyta serwera i nie liczy stanu adresu - dostaje go gotowego
// (`clubCreateSlugState`), a napisy i znacznik bierze z deskryptorów
// (`clubCreateSlugMessage`, `clubCreateSlugMark`).
//
// DOSTĘPNOŚĆ NIE JEST TU DODATKIEM. Znacznik jest ikoną, więc jego znaczenie
// istnieje WYŁĄCZNIE w `aria-label`; akapit stanu jest powiązany z polem przez
// `aria-describedby`, a przy zajętym adresie dostaje `role="alert"`, bo to
// jedyna odmowa, którą piszący naprawia natychmiast.
import { useTranslation } from "react-i18next";
import { Check, Loader2, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  clubCreateSlugMark,
  clubCreateSlugMessage,
  type ClubCreateSlugState,
} from "@/lib/clubs/adminClubCreateForm";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

/** Znacznik stanu OBOK pola. Ikona bez tekstu, więc `aria-label` jest treścią. */
function SlugMark({ state }: { state: ClubCreateSlugState }) {
  const { t } = useTranslation();
  const descriptor = clubCreateSlugMark(state);
  if (descriptor.mark === "spinner") {
    return (
      <Loader2
        className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
        aria-label={t(descriptor.labelKey)}
      />
    );
  }
  if (descriptor.mark === "ok") {
    return (
      <Check
        className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-label={t(descriptor.labelKey)}
      />
    );
  }
  if (descriptor.mark === "error") {
    return <X className="h-4 w-4 shrink-0 text-destructive" aria-label={t(descriptor.labelKey)} />;
  }
  // Miejsce zarezerwowane: pole nie skacze w poziomie, gdy znacznik się pojawia.
  return <span className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

export function ClubDialogSlugRow({
  id,
  labelKey,
  prefix,
  value,
  state,
  maxLength,
  onValueChange,
  disabled,
}: {
  id: string;
  labelKey: string;
  /** Widoczny przedrostek adresu publicznego - kontekst, nie treść pola. */
  prefix: string;
  value: string;
  state: ClubCreateSlugState;
  maxLength?: number;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();
  const message = clubCreateSlugMessage(state);
  const stateId = `${id}-state`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(labelKey)}</Label>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-sm text-muted-foreground">{prefix}</span>
        <Input
          id={id}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          aria-describedby={stateId}
          onChange={(event) => onValueChange(event.target.value)}
        />
        <SlugMark state={state} />
      </div>
      <p
        id={stateId}
        role={message.alert ? "alert" : undefined}
        className={
          message.alert ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"
        }
      >
        {t(message.key)}
      </p>
    </div>
  );
}
