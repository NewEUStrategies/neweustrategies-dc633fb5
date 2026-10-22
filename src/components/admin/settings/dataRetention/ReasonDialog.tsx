// Molekuła: okno decyzji z obowiązkowym powodem - przedłużenie kontaktu CRM,
// wykluczenie adresu z wygaszania newslettera i cofnięcie wykluczenia.
//
// DLACZEGO JEDNO OKNO. Wszystkie trzy decyzje trafiają do dziennika audytu
// z powodem o TYM SAMYM limicie (3-500 znaków po obcięciu brzegów - stała
// `DATA_RETENTION_RULES.crmExtensionReason*`, lustro RPC i CHECK). Trzy kopie
// pola z licznikiem rozjechałyby się przy pierwszej zmianie limitu albo
// komunikatu, a admin widziałby w jednej sekcji inny limit niż baza.
//
// LIMIT ODRZUCA, NIE PRZYCINA (AGENTS): wartość spoza zakresu blokuje zapis
// z komunikatem; licznik liczy punkty kodowe jak `char_length` w SQL.
// Powód żyje w stanie okna i znika przy zamknięciu - następna decyzja nie
// dziedziczy uzasadnienia poprzedniej.
import { useId, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DATA_RETENTION_RULES, normalizeExtensionReason } from "@/lib/privacy/dataRetention";

const { crmExtensionReasonMin: MIN, crmExtensionReasonMax: MAX } = DATA_RETENTION_RULES;

export interface ReasonDialogProps {
  open: boolean;
  title: string;
  description: string;
  reasonLabel: string;
  confirmLabel: string;
  pending: boolean;
  /** Akcja nieodwracalna w skutkach (np. wykluczenie anuluje prośbę w toku). */
  destructive?: boolean;
  onClose: () => void;
  /** Powód po walidacji; zwraca `true`, gdy okno ma się zamknąć (zapis udany). */
  onConfirm: (reason: string) => Promise<boolean>;
}

export function ReasonDialog({
  open,
  title,
  description,
  reasonLabel,
  confirmLabel,
  pending,
  destructive = false,
  onClose,
  onConfirm,
}: ReasonDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const [reason, setReason] = useState("");
  const length = [...reason.trim()].length;
  const valid = normalizeExtensionReason(reason) !== null;

  const close = () => {
    setReason("");
    onClose();
  };

  const submit = async () => {
    if (!valid || pending) return;
    if (await onConfirm(reason)) close();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor={`${id}-reason`}>{reasonLabel}</Label>
          <Textarea
            id={`${id}-reason`}
            value={reason}
            rows={3}
            aria-invalid={reason !== "" && !valid ? true : undefined}
            aria-describedby={`${id}-reason-hint`}
            onChange={(event) => setReason(event.target.value)}
          />
          <p id={`${id}-reason-hint`} className="text-xs text-muted-foreground">
            {reason !== "" && !valid
              ? t("adminDataRetention.reason.invalid", { min: MIN, max: MAX })
              : t("adminDataRetention.reason.hint", { min: MIN, max: MAX })}{" "}
            {t("adminDataRetention.reason.count", { count: length, max: MAX })}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t("adminDataRetention.toggle.cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!valid || pending}
            onClick={() => void submit()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
