// Molekuła: jawna zgoda na SMS-y o JEDNYM zgłoszeniu (REG-10, decyzja D12).
//
// ZGODA JEST ZDANIEM, NIE PRZEŁĄCZNIKIEM. Przełącznik SMS na karcie zgłoszenia
// i w przypomnieniach nie zapisuje niczego sam: otwiera to okno, a dopiero
// „Zgadzam się" wysyła `sms_consent: true` razem ze zmianą (baza stempluje
// wtedy zgodę). „Anuluj" nie wysyła nic - przełącznik zostaje wyłączony.
//
// NUMER NIE WYCHODZI. Zdanie pokazuje wyłącznie trzy ostatnie cyfry
// (`phone_hint` z bazy); bez podpowiedzi mówi „na numer podany w zgłoszeniu".
// Zmiana numeru zdejmuje zgodę, więc zgoda zawsze dotyczy numeru z tego zdania.
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ensureI18n } from "@/lib/i18n-participant-tickets";

ensureI18n();

export function SmsConsentConfirm({
  open,
  phoneHint,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** Trzy ostatnie cyfry numeru albo `null`, gdy baza ich nie podała. */
  phoneHint: string | null;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("participantTickets.channels.smsConsent.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {phoneHint === null
              ? t("participantTickets.channels.smsConsent.bodyNoHint")
              : t("participantTickets.channels.smsConsent.body", { hint: phoneHint })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("participantTickets.channels.smsConsent.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              // Okno zamyka wołający po decyzji - inaczej Radix zamknąłby je
              // przed zapisem i błąd zgody nie miałby gdzie się pokazać.
              event.preventDefault();
              onConfirm();
            }}
          >
            {t("participantTickets.channels.smsConsent.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
