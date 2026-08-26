// Molekula: potwierdzenie decyzji organizatora o zgloszeniu.
//
// JEDNO OKNO NA SZESC CZYNNOSCI. Kazda decyzja to ten sam kontrakt: wiersz,
// czynnosc, opcjonalne uzasadnienie. Szesc osobnych okien roznilo by sie tylko
// naglowkiem, a rozjechaloby sie przy pierwszej zmianie regul powodu.
//
// POWOD BLOKUJE PRZYCISK TYLKO TAM, GDZIE BAZA GO WYMAGA. Odrzucenie i
// anulowanie bez uzasadnienia wracaja z bledem `reason_required`, wiec lepiej
// zatrzymac je tutaj niz pokazac organizatorowi blad serwera. Przy pozostalych
// czynnosciach to samo pole jest notatka wewnetrzna - nieobowiazkowa.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { actionRequiresReason } from "@/lib/events/registrationRows";
import type { RegistrationAction } from "@/lib/events/registrationsApi";

const TITLE_KEYS: Record<RegistrationAction, string> = {
  approve: "approveTitle",
  reject: "rejectTitle",
  waitlist: "waitlistTitle",
  cancel: "cancelTitle",
  attended: "attendedTitle",
  no_show: "noShowTitle",
};

const BODY_KEYS: Record<RegistrationAction, string> = {
  approve: "approveBody",
  reject: "rejectBody",
  waitlist: "waitlistBody",
  cancel: "cancelBody",
  attended: "attendedBody",
  no_show: "noShowBody",
};

export interface RegistrationDecideDialogProps {
  open: boolean;
  action: RegistrationAction | null;
  personName: string;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: string | null) => void;
}

export function RegistrationDecideDialog({
  open,
  action,
  personName,
  isPending,
  onOpenChange,
  onConfirm,
}: RegistrationDecideDialogProps) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");

  // Nowa decyzja zaczyna od pustego pola - przeniesiony powod z poprzedniego
  // zgloszenia trafilby do historii jako uzasadnienie, ktorego nikt nie napisal.
  useEffect(() => {
    if (open) setNote("");
  }, [open, action]);

  if (action === null) return null;

  const base = "adminEventRegistration.registrations.decideDialog";
  const reasonRequired = actionRequiresReason(action);
  const trimmed = note.trim();
  const blocked = reasonRequired && trimmed === "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(`${base}.${TITLE_KEYS[action]}`)}</DialogTitle>
          <DialogDescription>{t(`${base}.${BODY_KEYS[action]}`)}</DialogDescription>
        </DialogHeader>

        <p className="text-sm font-medium">{personName}</p>

        <div className="space-y-1.5">
          <Label htmlFor="registration-decision-note">
            {reasonRequired ? t(`${base}.reasonLabel`) : t(`${base}.noteLabel`)}
          </Label>
          <Textarea
            id="registration-decision-note"
            value={note}
            rows={3}
            placeholder={reasonRequired ? t(`${base}.reasonPlaceholder`) : undefined}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t(`${base}.cancelAction`)}
          </Button>
          <Button
            onClick={() => onConfirm(trimmed === "" ? null : trimmed)}
            disabled={blocked || isPending}
          >
            {t(`${base}.confirmAction`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
