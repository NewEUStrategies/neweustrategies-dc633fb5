// Molekuła: potwierdzenie wycofania „Zapytania do eksperta".
//
// Wycofanie jest teraz operacją NIEODWRACALNĄ W SENSIE PULI: licznik puli
// miesięcznej liczy wszystkie wysłane zapytania, także anulowane (inaczej pętla
// „wyślij → anuluj → wyślij" zerowała limit sprzedawany w cenniku). Skoro cena
// kliknięcia wzrosła, użytkownik musi ją zobaczyć PRZED kliknięciem - stąd
// jawne potwierdzenie z tą jedną informacją, zamiast cichego toastu po fakcie.
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
import { ensureI18n as ensureExpertRequestI18n } from "@/lib/i18n-expert-request";

export interface ExpertRequestCancelDialogProps {
  /** Temat wycofywanego zapytania; `null` zamyka dialog. */
  subject: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  /** Trwa wywołanie RPC - blokuje przycisk potwierdzenia. */
  busy?: boolean;
}

export function ExpertRequestCancelDialog({
  subject,
  onOpenChange,
  onConfirm,
  busy = false,
}: ExpertRequestCancelDialogProps) {
  ensureExpertRequestI18n();
  const { t } = useTranslation();

  return (
    <AlertDialog open={subject !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md rounded-[6px]">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("expertRequest.confirmCancel.title")}</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-2">
            {subject !== null && (
              <span className="truncate text-xs font-semibold text-foreground">{subject}</span>
            )}
            <span>{t("expertRequest.confirmCancel.description")}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-[6px]">
            {t("expertRequest.confirmCancel.keep")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="rounded-[6px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(event) => {
              // Zamknięcie steruje stanem rodzica (po wyniku RPC), nie Radiksem.
              event.preventDefault();
              void onConfirm();
            }}
          >
            {t("expertRequest.confirmCancel.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
