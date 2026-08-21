// Molekuła: DIALOG KADENCJI ROLI.
//
// CO BYŁA W ORGANIZMIE. Lokalny komponent `TenureDialog` na dole pliku, który
// trzymał WŁASNY stan pola daty i WŁASNY egzemplarz mutacji
// (`useUpsertClubMember`) - czyli stan serwera w miejscu, które ma tylko
// pokazać formularz. Dwa egzemplarze tej samej mutacji w jednym ekranie mają
// dwa niezależne `isPending`, więc „zapisuję” w dialogu nie gasiło niczego
// w tabeli i odwrotnie.
//
// JEDNA ODPOWIEDZIALNOŚĆ: formularz kadencji. Molekuła jest w PEŁNI
// KONTROLOWANA - wartość pola i stan zapisu przychodzą propsami, a mutację
// woła organizm. Dzięki temu wyzerowanie pola po udanym zapisie jest decyzją
// tego, kto zna wynik zapisu.
//
// POLE DATY STARTUJE PUSTE także wtedy, gdy kadencja jest ustawiona: dialog
// otwiera się po to, żeby ją ZMIENIĆ, a bieżący termin i tak stoi w zdaniu
// wyżej. Wstępne wypełnienie kusiłoby do zapisu bez zmiany.
//
// SŁOWNIK PANELU, NIE PUBLICZNY. Klucze `adminClubs.*` mieszkają
// w `i18n-clubs-admin`, który trzeba jawnie dociągnąć - inaczej molekuła
// renderuje GOŁY KLUCZ, czego nie widzi ani bramka parytetu, ani bramka
// rozjazdu kod<->słownik. Dlatego `ensureAdminClubsI18n()` stoi tutaj,
// a nie tylko w organizmie: molekuła bywa zamontowana bez niego.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasMemberTenure } from "@/lib/clubs/adminMemberRoster";
import { formatDateTime } from "@/lib/i18n/format";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubRosterTenureDialog({
  displayName,
  expiresAt,
  value,
  language,
  pending,
  onValueChange,
  onSave,
  onClear,
  onOpenChange,
}: {
  /** `null` = dialog zamknięty. Nazwisko jest jednocześnie kluczem otwarcia. */
  displayName: string | null;
  expiresAt: string | null;
  value: string;
  language: string | undefined;
  pending: boolean;
  onValueChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();
  const hasTenure = hasMemberTenure(expiresAt);

  return (
    <Dialog open={displayName !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-left">{t("adminClubs.members.tenureTitle")}</DialogTitle>
          <DialogDescription className="text-left">
            {t("adminClubs.members.tenureHint")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="font-medium">{displayName}</span>
            {" · "}
            {hasTenure && expiresAt !== null
              ? formatDateTime(expiresAt, language)
              : t("adminClubs.members.tenureNone")}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="club-tenure-date">{t("adminClubs.members.tenureUntil")}</Label>
            <Input
              id="club-tenure-date"
              type="date"
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="ghost"
            className="sm:mr-auto"
            disabled={!hasTenure || pending}
            onClick={onClear}
          >
            {t("adminClubs.members.tenureClear")}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={value.trim() === "" || pending} onClick={onSave}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
