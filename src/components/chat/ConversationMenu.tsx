// Molekuła: menu rozmowy (info o kręgu, wygląd, przypnij, archiwizuj, wycisz,
// znikanie wiadomości, blokada, wyczyść historię).
//
// Wyszła z `ChatWindow` jako największy spójny blok JSX tego organizmu (~190
// linii) i JEDYNY, który miał realną logikę prezentacji: cztery pary
// „stan -> etykieta + ikona" (przypięte/odpięte, archiwum/przywrócenie,
// wyciszone/aktywne, zablokowane/odblokowane) plus lista opcji TTL
// z zaznaczeniem aktywnej. Każda z tych par to okazja na rozjazd ikony
// z tekstem - i takiego rozjazdu nie widzi żaden inny test w repo.
//
// Kontrakt komponentu: SAM stan menu (otwarte/zamknięte) i wywołania akcji.
// Mutacje, toasty i dialogi potwierdzeń zostają w organizmie, bo dotyczą
// całego okna, nie samego menu.
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArchiveRestore,
  Ban,
  BellOff,
  Check,
  Eraser,
  Flag,
  MoreVertical,
  Palette,
  Pin,
  PinOff,
  Timer,
  UsersRound,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MUTE_OPTIONS, TTL_MENU_OPTIONS, ttlLabelKey } from "@/lib/chat/menuOptions";
import { cn } from "@/lib/utils";
import { CHAT_ICON_BUTTON_CLASS, CHAT_ICON_BUTTON_PRESSED_CLASS } from "./ChatIconButton";

export interface ConversationMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Krąg pokazuje pozycję „informacje o kręgu"; wątek bezpośredni jej nie ma. */
  isGroup: boolean;
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  /** Aktualne okno znikania wiadomości (null = wyłączone). */
  ttlSeconds: number | null;
  /** Null w kręgu - blokuje się osobę, nie krąg. */
  peerId: string | null;
  peerBlocked: boolean;
  onOpenGroupInfo: () => void;
  onOpenAppearance: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  /** null = zdejmij wyciszenie, -1 = na zawsze, inaczej okno w sekundach. */
  onMute: (seconds: number | null) => void;
  onSetTtl: (seconds: number | null) => void;
  onOpenBlockDialog: () => void;
  /**
   * Zgłoszenie osoby do moderacji. Tylko wątek bezpośredni - zgłasza się
   * OSOBĘ, nie krąg (a w kręgu nie wiadomo którą).
   */
  onOpenReportDialog: () => void;
  onOpenClearDialog: () => void;
}

const ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-muted";
const HEADING_CLASS =
  "px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
const ICON_CLASS = "h-3.5 w-3.5 text-muted-foreground";

export function ConversationMenu(props: ConversationMenuProps) {
  const { t } = useTranslation();
  const { open, onOpenChange, isGroup, pinned, archived, muted, ttlSeconds, peerId, peerBlocked } =
    props;

  // Każda akcja zamyka menu PRZED wywołaniem intencji: menu, które zostaje
  // otwarte nad zmieniającą się listą rozmów, to najczęstsza skarga na
  // klienty czatu („kliknąłem archiwizuj i menu wisi nad pustką").
  const act = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(CHAT_ICON_BUTTON_CLASS, open && CHAT_ICON_BUTTON_PRESSED_CLASS)}
              aria-label={t("chat.menu.title")}
              aria-haspopup="menu"
            >
              <MoreVertical className="h-4 w-4" aria-hidden />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("chat.menu.title")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={4}
        className="w-60 rounded-[6px] border-border/60 bg-popover p-1.5 shadow-xl"
      >
        <div role="menu" aria-label={t("chat.menu.title")} className="flex flex-col">
          {isGroup && (
            <button
              type="button"
              role="menuitem"
              onClick={act(props.onOpenGroupInfo)}
              className={ITEM_CLASS}
            >
              <UsersRound className={ICON_CLASS} aria-hidden />
              {t("chat.group.info")}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={act(props.onOpenAppearance)}
            className={ITEM_CLASS}
          >
            <Palette className={ICON_CLASS} aria-hidden />
            {t("chat.appearance.open")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={act(props.onTogglePin)}
            className={ITEM_CLASS}
          >
            {pinned ? (
              <PinOff className={ICON_CLASS} aria-hidden />
            ) : (
              <Pin className={ICON_CLASS} aria-hidden />
            )}
            {pinned ? t("chat.menu.unpin") : t("chat.menu.pin")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={act(props.onToggleArchive)}
            className={ITEM_CLASS}
          >
            {archived ? (
              <ArchiveRestore className={ICON_CLASS} aria-hidden />
            ) : (
              <Archive className={ICON_CLASS} aria-hidden />
            )}
            {archived ? t("chat.menu.unarchive") : t("chat.menu.archive")}
          </button>

          <p className={HEADING_CLASS}>{t("chat.menu.muteSection")}</p>
          {muted ? (
            <button
              type="button"
              role="menuitem"
              onClick={act(() => props.onMute(null))}
              className={ITEM_CLASS}
            >
              <BellOff className={ICON_CLASS} aria-hidden />
              {t("chat.menu.unmute")}
            </button>
          ) : (
            MUTE_OPTIONS.map((option) => (
              <button
                key={option.seconds}
                type="button"
                role="menuitem"
                onClick={act(() => props.onMute(option.seconds))}
                className={ITEM_CLASS}
              >
                <BellOff className={ICON_CLASS} aria-hidden />
                {t(option.labelKey)}
              </button>
            ))
          )}

          <p className={HEADING_CLASS}>{t("chat.disappearing.title")}</p>
          {TTL_MENU_OPTIONS.map((option) => {
            const active = (ttlSeconds ?? null) === option;
            return (
              <button
                key={option ?? "off"}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={act(() => props.onSetTtl(option))}
                className={cn(ITEM_CLASS, active && "bg-muted font-medium")}
              >
                <Timer className={ICON_CLASS} aria-hidden />
                <span className="flex-1">{t(ttlLabelKey(option))}</span>
                {active && <Check className="h-3.5 w-3.5 text-[var(--brand)]" aria-hidden />}
              </button>
            );
          })}

          <div className="my-1 h-px bg-border/60" aria-hidden />
          {peerId && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={act(props.onOpenBlockDialog)}
                className={cn(ITEM_CLASS, peerBlocked && "text-destructive hover:text-destructive")}
              >
                <Ban className="h-3.5 w-3.5" aria-hidden />
                {peerBlocked ? t("chat.block.unblock") : t("chat.block.block")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={act(props.onOpenReportDialog)}
                className={ITEM_CLASS}
              >
                <Flag className={ICON_CLASS} aria-hidden />
                {t("chat.menu.report")}
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={act(props.onOpenClearDialog)}
            className={cn(ITEM_CLASS, "text-destructive hover:text-destructive")}
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden />
            {t("chat.menu.clear")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
