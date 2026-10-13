// Molekula: potwierdzenie decyzji organizatora o zgloszeniu.
//
// JEDNO OKNO NA SZESC CZYNNOSCI. Kazda decyzja to ten sam kontrakt: wiersz,
// czynnosc, notatka wewnetrzna, przy zamknieciu powod dla uczestnika, przy
// anulowaniu oplaconego - decyzja o zwrocie. Szesc osobnych okien roznilo by
// sie tylko naglowkiem, a rozjechaloby sie przy pierwszej zmianie regul.
//
// DWA POLA, DWOCH ODBIORCOW (REG-06, decyzja D10). Notatka wewnetrzna
// (`decision_note`) zostaje w historii zgloszenia i NIGDY nie trafia do
// uczestnika. Powod widoczny dla uczestnika (`participant_reason`) jest osobnym
// polem, tylko przy odrzuceniu i anulowaniu - to jedyny tekst decyzji, ktory
// pokazuje mail i „Moje bilety". Jedno wspolne pole uczylo organizatora pisac
// notatki wewnetrzne, ktore potem czytal uczestnik.
//
// NOTATKA BLOKUJE PRZYCISK TYLKO TAM, GDZIE BAZA JEJ WYMAGA. Odrzucenie i
// anulowanie bez notatki wracaja z bledem `reason_required` (anulowanie - gdy
// organizator rezygnuje ze zwrotu), wiec lepiej zatrzymac je tutaj niz pokazac
// organizatorowi blad serwera. Za dlugi tekst tez blokuje: baza odrzuca go
// (`note_too_long`, `participant_reason_too_long`), nigdy nie przycina.
//
// ZWROT PRZY ANULOWANIU (REG-03). Okno pyta baze o skutek finansowy
// (`admin_event_registration_refund_preview`), bo wiersz listy nie zna
// platnosci. Domyslnie anulowanie oplaconego zleca zwrot; „Nie zwracaj
// platnosci" zostawia w dzienniku wpis bez zwrotu i wymaga notatki.
//
// PODPOWIEDZ ZALEZY OD WIERSZA, NIE OD CZYNNOSCI. Zatwierdzenie prowadzacego
// grupy przyjmuje tez jego gosci (kaskada w bazie, 20260926100000) - organizator
// ma to wiedziec PRZED kliknieciem, a wie o tym tylko organizm znajacy
// powiazania grupy. Dlatego zdanie przychodzi gotowe, z zewnatrz.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CharacterCounter } from "@/components/forms/CharacterCounter";
import { formatMoney } from "@/lib/billing/types";
import { uiLang } from "@/lib/i18n/format";
import {
  DECISION_NOTE_MAX_LENGTH,
  DECISION_NOTE_MIN_LENGTH,
  PARTICIPANT_REASON_MAX_LENGTH,
  actionAcceptsParticipantReason,
  actionRequiresReason,
} from "@/lib/events/registrationRows";
import {
  fetchRegistrationRefundPreview,
  type RegistrationAction,
  type RegistrationRefundPreview,
} from "@/lib/events/registrationsApi";

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

/** Decyzja z okna - oba teksty przyciete, pusty = `null`. */
export interface RegistrationDecision {
  /** Notatka WEWNETRZNA (`decision_note`). */
  note: string | null;
  /** Powod dla uczestnika - `null` przy czynnosci, ktora go nie przyjmuje. */
  participantReason: string | null;
  /** Tylko przy anulowaniu zgloszenia, ktore ma zlecenie zwrotu. */
  refund?: "full" | "none";
}

export interface RegistrationDecideDialogProps {
  open: boolean;
  action: RegistrationAction | null;
  /** Zgloszenie decyzji - okno pyta o skutek finansowy anulowania. */
  registrationId?: string | null;
  personName: string;
  /** Dodatkowe zdanie o skutkach decyzji dla TEGO wiersza (np. goscie grupy). */
  hint?: string | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (decision: RegistrationDecision) => void;
}

export function RegistrationDecideDialog({
  open,
  action,
  registrationId = null,
  personName,
  hint = null,
  isPending,
  onOpenChange,
  onConfirm,
}: RegistrationDecideDialogProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [note, setNote] = useState("");
  const [participantReason, setParticipantReason] = useState("");
  const [waive, setWaive] = useState(false);

  // Nowa decyzja zaczyna od pustych pol - przeniesiony tekst z poprzedniego
  // zgloszenia trafilby do historii albo do uczestnika jako zdanie, ktorego
  // nikt dla niego nie napisal.
  useEffect(() => {
    if (open) {
      setNote("");
      setParticipantReason("");
      setWaive(false);
    }
  }, [open, action]);

  const wantsRefundPreview = open && action === "cancel" && registrationId !== null;
  const refundQuery = useQuery({
    queryKey: ["admin-registration-refund-preview", registrationId],
    queryFn: () => fetchRegistrationRefundPreview(registrationId ?? ""),
    enabled: wantsRefundPreview,
    // Skutek zalezy od zegara i od wplat - okno pyta przy kazdym otwarciu.
    staleTime: 0,
  });

  if (action === null) return null;

  const base = "adminEventRegistration.registrations.decideDialog";
  const refund = wantsRefundPreview ? (refundQuery.data ?? null) : null;
  const refundable = refund !== null && refund.jobState !== null;
  const waiving = refundable && waive;
  const acceptsReason = actionAcceptsParticipantReason(action);
  const noteRequired = actionRequiresReason(action) || waiving;
  // Baza liczy uzasadnienie od 3 znakow tam, gdzie go wymaga (odrzucenie,
  // anulowanie bez zwrotu); przy zwyklym anulowaniu panel chce tylko slowa.
  const noteMinLength =
    action === "reject" || waiving ? DECISION_NOTE_MIN_LENGTH : noteRequired ? 1 : 0;

  const trimmedNote = note.trim();
  const trimmedReason = participantReason.trim();
  const noteTooLong = note.length > DECISION_NOTE_MAX_LENGTH;
  const reasonTooLong = acceptsReason && participantReason.length > PARTICIPANT_REASON_MAX_LENGTH;
  const blocked = trimmedNote.length < noteMinLength || noteTooLong || reasonTooLong;

  function confirm(): void {
    const decision: RegistrationDecision = {
      note: trimmedNote === "" ? null : trimmedNote,
      participantReason: acceptsReason && trimmedReason !== "" ? trimmedReason : null,
    };
    if (refundable) decision.refund = waive ? "none" : "full";
    onConfirm(decision);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(`${base}.${TITLE_KEYS[action]}`)}</DialogTitle>
          <DialogDescription>{t(`${base}.${BODY_KEYS[action]}`)}</DialogDescription>
        </DialogHeader>

        <p className="text-sm font-medium">{personName}</p>
        {hint === null ? null : <p className="text-sm text-muted-foreground">{hint}</p>}

        {wantsRefundPreview && (
          <RefundPreviewLine
            loading={refundQuery.isPending}
            failed={refundQuery.isError}
            refund={refund}
            lang={lang}
          />
        )}
        {refundable && (
          <div className="space-y-1">
            <div className="flex items-start gap-2">
              <Checkbox
                id="registration-decision-waive"
                checked={waive}
                onCheckedChange={(value) => setWaive(value === true)}
                aria-describedby="registration-decision-waive-hint"
              />
              <Label htmlFor="registration-decision-waive" className="text-sm font-normal">
                {t(`${base}.refund.waive`)}
              </Label>
            </div>
            <p id="registration-decision-waive-hint" className="text-xs text-muted-foreground">
              {t(`${base}.refund.waiveHint`)}
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="registration-decision-note">{t(`${base}.noteLabel`)}</Label>
          <Textarea
            id="registration-decision-note"
            value={note}
            rows={3}
            aria-describedby="registration-decision-note-hint registration-decision-note-count"
            aria-invalid={noteTooLong || undefined}
            onChange={(event) => setNote(event.target.value)}
          />
          <p id="registration-decision-note-hint" className="text-xs text-muted-foreground">
            {t(`${base}.noteHint`)}
            {noteRequired ? ` ${t(`${base}.noteRequiredHint`)}` : ""}
          </p>
          <CharacterCounter
            id="registration-decision-note-count"
            count={note.length}
            limit={DECISION_NOTE_MAX_LENGTH}
            lang={lang}
          />
        </div>

        {acceptsReason && (
          <div className="space-y-1.5">
            <Label htmlFor="registration-participant-reason">
              {t(`${base}.participantReasonLabel`)}
            </Label>
            <Textarea
              id="registration-participant-reason"
              value={participantReason}
              rows={3}
              aria-describedby="registration-participant-reason-hint registration-participant-reason-count"
              aria-invalid={reasonTooLong || undefined}
              onChange={(event) => setParticipantReason(event.target.value)}
            />
            <p id="registration-participant-reason-hint" className="text-xs text-muted-foreground">
              {t(`${base}.participantReasonHint`)}
            </p>
            <CharacterCounter
              id="registration-participant-reason-count"
              count={participantReason.length}
              limit={PARTICIPANT_REASON_MAX_LENGTH}
              lang={lang}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t(`${base}.cancelAction`)}
          </Button>
          <Button onClick={confirm} disabled={blocked || isPending}>
            {t(`${base}.confirmAction`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Zdanie o skutku finansowym anulowania (REG-03) - przed decyzja, nie po. */
function RefundPreviewLine({
  loading,
  failed,
  refund,
  lang,
}: {
  loading: boolean;
  failed: boolean;
  refund: RegistrationRefundPreview | null;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const base = "adminEventRegistration.registrations.decideDialog.refund";

  if (loading) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t(`${base}.loading`)}
      </p>
    );
  }
  if (failed || refund === null) {
    return <p className="text-sm text-muted-foreground">{t(`${base}.loadError`)}</p>;
  }

  let sentence: string | null = null;
  if (refund.effect === "full_refund") {
    sentence =
      refund.amountCents !== null && refund.currency !== null
        ? t(`${base}.full`, { amount: formatMoney(refund.amountCents, refund.currency, lang) })
        : t(`${base}.fullPlain`);
  } else if (refund.effect === "organizer_review" || refund.effect === "no_refund") {
    sentence =
      refund.reviewReason === "shared_payment"
        ? t(`${base}.shared`)
        : refund.reviewReason === "manual_payment"
          ? t(`${base}.manual`)
          : t(`${base}.review`);
  } else if (refund.effect === "included_ticket") {
    sentence = t(`${base}.included`);
  }
  if (sentence === null) return null;
  return <p className="text-sm text-foreground">{sentence}</p>;
}
