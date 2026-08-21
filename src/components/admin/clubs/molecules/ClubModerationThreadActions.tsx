// Molekuła: cztery akcje moderatorskie przy JEDNYM temacie.
//
// CO BYŁO W ORGANIZMIE. Lokalny komponent `ThreadActions` w `ClubThreadsTab`
// z trzema wyrażeniami `?:` powtórzonymi po trzy razy każde (akcja, ikona,
// etykieta) - w sumie dziewięć miejsc, w których „przypnij” mogło się rozjechać
// z „odepnij”. Komponent jest wołany z DWÓCH układów: wiersza tabeli (ikony
// z tekstem tylko dla czytnika) i karty (`compact` - ikona plus napis).
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać cztery przyciski i oddać zdarzenie z NAZWĄ
// AKCJI. Molekuła nie woła mutacji i nie zna klubu - kierunek każdej akcji
// wylicza `threadRowActions` z warstwy reguł, więc „odepnij” na wpisie
// nieprzypiętym jest błędem, który wychodzi w teście czystej funkcji, a nie
// dopiero w panelu.
import { useTranslation } from "react-i18next";
import { Eye, Lock, LockOpen, Pin, PinOff, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  threadRowActions,
  type ThreadBoardAction,
  type ThreadBoardRow,
} from "@/lib/clubs/adminThreadsBoard";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubModerationThreadActions({
  row,
  onAct,
  onOpen,
  compact,
}: {
  row: ThreadBoardRow;
  onAct: (action: ThreadBoardAction) => void;
  onOpen: () => void;
  compact?: boolean;
}) {
  ensureAdminClubsI18n();
  const { t } = useTranslation();
  const actions = threadRowActions(row);
  const size = compact === true ? "sm" : "icon";
  const cls = compact === true ? "h-7 px-2 text-xs" : "h-8 w-8";
  const labelCls = compact === true ? "ml-1.5" : "sr-only";

  return (
    <div className="flex flex-wrap gap-1">
      <Button size={size} variant="ghost" className={cls} onClick={onOpen}>
        <Eye className="h-3.5 w-3.5" />
        <span className={labelCls}>{t("adminClubs.threads.open")}</span>
      </Button>
      <Button size={size} variant="ghost" className={cls} onClick={() => onAct(actions.pin.action)}>
        {actions.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        <span className={labelCls}>{t(`adminClubs.threads.${actions.pin.label}`)}</span>
      </Button>
      <Button
        size={size}
        variant="ghost"
        className={cls}
        onClick={() => onAct(actions.lock.action)}
      >
        {actions.locked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        <span className={labelCls}>{t(`adminClubs.threads.${actions.lock.label}`)}</span>
      </Button>
      <Button
        size={size}
        variant="ghost"
        className={`${cls} ${actions.removed ? "" : "text-muted-foreground hover:text-destructive"}`}
        onClick={() => onAct(actions.removal.action)}
      >
        {actions.removed ? (
          <RotateCcw className="h-3.5 w-3.5" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
        <span className={labelCls}>{t(`adminClubs.threads.${actions.removal.label}`)}</span>
      </Button>
    </div>
  );
}
