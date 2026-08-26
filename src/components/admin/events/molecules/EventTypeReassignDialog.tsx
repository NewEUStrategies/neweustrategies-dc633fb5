// Molekuła: PRZEPIĘCIE wydarzeń z jednego rodzaju na inny.
//
// PO CO TEN DIALOG ISTNIEJE. Bez niego „rodzaj w użyciu" jest pułapką bez
// wyjścia: redaktor widzi odcięty kosz i licznik „40 wydarzeń", a żeby je
// przepiąć musiałby otworzyć czterdzieści formularzy. Kasowanie rodzaju
// używanego jest słusznie zablokowane - ale blokada bez drogi wyjścia jest
// błędem projektowym, nie zabezpieczeniem.
//
// LICZBA STOI W PRZYCISKU POTWIERDZENIA („Przepnij 40 wydarzeń"), a nie w tekście
// obok. To reguła całego modułu, zapisana w kontrakcie danych
// (`ANALIZA_BRAKUJACYCH_EKRANOW` §9.2): akcja masowa mówi dokładnie, ile wierszy
// ruszy, w miejscu, w które człowiek klika.
//
// LISTA CELÓW NIE ZAWIERA RODZAJU ŹRÓDŁOWEGO. RPC odrzuca `_from_id = _to_id`
// wyjątkiem `invalid_target`, ale droplista, która pozwala wybrać sam siebie,
// zmusza redaktora do przeczytania odmowy zamiast pokazać mu poprawny zbiór.
//
// JEDNA ODPOWIEDZIALNOŚĆ: wybrać cel i oddać intencję. Molekuła nie woła mutacji
// i nie wie, co się stanie po przepięciu.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "@/lib/lucide-shim";
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
import { FormSelect } from "@/components/atoms/FormSelect";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export interface ReassignTargetOption {
  id: string;
  name: string;
}

export function EventTypeReassignDialog({
  sourceName,
  total,
  targets,
  isPending,
  onClose,
  onConfirm,
}: {
  /** `null` = dialog zamknięty; nazwa rodzaju źródłowego, gdy otwarty. */
  sourceName: string | null;
  total: number;
  /** Rodzaje docelowe BEZ źródłowego - filtrowanie należy do wywołującego. */
  targets: readonly ReassignTargetOption[];
  isPending: boolean;
  onClose: () => void;
  onConfirm: (targetId: string) => void;
}) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  const [targetId, setTargetId] = useState("");

  const close = () => {
    setTargetId("");
    onClose();
  };

  return (
    <Dialog open={sourceName !== null} onOpenChange={(open) => (open ? null : close())}>
      <DialogContent className="event-dialog-compact sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("adminEvents.types.reassignDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("adminEvents.types.reassignDialog.body", { name: sourceName ?? "", total })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="event-type-reassign-target">
            {t("adminEvents.types.reassignDialog.targetLabel")}
          </Label>
          <FormSelect
            id="event-type-reassign-target"
            value={targetId}
            options={targets.map((target) => ({ value: target.id, label: target.name }))}
            aria-label={t("adminEvents.types.reassignDialog.targetLabel")}
            onValueChange={setTargetId}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t("adminEvents.types.reassignDialog.cancelAction")}
          </Button>
          <Button onClick={() => onConfirm(targetId)} disabled={isPending || targetId === ""}>
            {isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {t("adminEvents.types.reassignDialog.confirmAction", { total })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
