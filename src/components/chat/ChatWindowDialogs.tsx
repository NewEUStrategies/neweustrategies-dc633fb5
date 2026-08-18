// Molekuła: wszystkie warstwy modalne okna rozmowy w jednym miejscu.
//
// Cofnięcie wysłania, wyczyszczenie historii i blokada osoby to trzy
// potwierdzenia zbudowane z tego samego atomu (`ChatConfirmDialog`);
// przekazywanie dalej, informacje o kręgu i wygląd rozmowy mają własne
// komponenty. Organizm nie musi znać żadnego z nich - podaje stan i intencje.
//
// Dlaczego RAZEM, a nie sześć osobnych wstawek w `ChatWindow`: te dialogi
// dzielą jedną regułę, którą łatwo złamać osobno - portal Radixa żyje POZA
// drzewem okna, więc dialog wyrenderowany warunkowo razem z `variant` gubi
// stan przy przełączeniu wariantu. Trzymane w jednej molekule renderują się
// dokładnie raz, niezależnie od tego, który wariant chrome'u je otacza.
import { useTranslation } from "react-i18next";
import { ReportUserDialog } from "@/components/network/ReportUserDialog";
import type { ChatMessage, ConversationView } from "@/lib/chat/types";
import { ChatAppearanceDialog } from "./ChatAppearanceDialog";
import { ChatConfirmDialog } from "./ChatConfirmDialog";
import { ForwardDialog } from "./ForwardDialog";
import { GroupInfoDialog } from "./GroupInfoDialog";

export interface ChatWindowDialogsProps {
  conversationId: string;
  /** Widok rozmowy - null, dopóki lista się nie wczyta (dialogi wtedy nieaktywne). */
  view: ConversationView | undefined;
  isGroup: boolean;
  peerName: string;
  /** Null w kręgu - blokada i zgłoszenie dotyczą OSOBY, nie wątku. */
  peerId: string | null;
  peerBlocked: boolean;

  /** Cofnięcie wysłania: wiadomość docelowa albo null. */
  deleteTarget: ChatMessage | null;
  onDeleteTargetChange: (message: ChatMessage | null) => void;
  onConfirmDelete: (message: ChatMessage) => void;

  /** Przekazanie do innej rozmowy. */
  forwardTarget: ChatMessage | null;
  onForwardClose: () => void;

  clearDialogOpen: boolean;
  onClearDialogOpenChange: (open: boolean) => void;
  onConfirmClear: () => void;

  blockDialogOpen: boolean;
  onBlockDialogOpenChange: (open: boolean) => void;
  onConfirmBlockToggle: () => void;

  /**
   * Zgłoszenie osoby do moderacji tenanta. Reużywa dialogu sieci kontaktów
   * (`ReportUserDialog`), bo powody, limit dzienny i deduplikację egzekwuje ten
   * sam RPC `report_user` - drugi dialog o tej samej treści byłby drugim
   * miejscem do rozjazdu z listą powodów w bazie.
   */
  reportDialogOpen: boolean;
  onReportDialogOpenChange: (open: boolean) => void;

  groupInfoOpen: boolean;
  onGroupInfoClose: () => void;
  /** Po wyjściu z kręgu wracamy na listę (page) albo zamykamy okno (dock). */
  onLeftGroup?: () => void;

  appearanceOpen: boolean;
  onAppearanceClose: () => void;
}

export function ChatWindowDialogs(props: ChatWindowDialogsProps) {
  const { t } = useTranslation();
  const { deleteTarget, view, isGroup, peerName, peerId, peerBlocked } = props;

  return (
    <>
      <ChatConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) props.onDeleteTargetChange(null);
        }}
        title={t("chat.deleteMessage")}
        description={t("chat.deleteConfirm")}
        confirmLabel={t("chat.deleteMessage")}
        cancelLabel={t("chat.close")}
        onConfirm={() => {
          if (deleteTarget) props.onConfirmDelete(deleteTarget);
          props.onDeleteTargetChange(null);
        }}
      />

      <ForwardDialog
        message={props.forwardTarget}
        excludeConversationId={props.conversationId}
        onClose={props.onForwardClose}
      />

      <ChatConfirmDialog
        open={props.clearDialogOpen}
        onOpenChange={props.onClearDialogOpenChange}
        title={t("chat.menu.clear")}
        description={t("chat.menu.clearConfirm")}
        confirmLabel={t("chat.menu.clear")}
        cancelLabel={t("chat.close")}
        onConfirm={props.onConfirmClear}
      />

      <ChatConfirmDialog
        open={props.blockDialogOpen}
        onOpenChange={props.onBlockDialogOpenChange}
        title={
          peerBlocked
            ? t("chat.block.unblockTitle", { name: peerName })
            : t("chat.block.blockTitle", { name: peerName })
        }
        description={peerBlocked ? t("chat.block.unblockConfirm") : t("chat.block.blockConfirm")}
        confirmLabel={peerBlocked ? t("chat.block.unblock") : t("chat.block.block")}
        cancelLabel={t("chat.close")}
        onConfirm={props.onConfirmBlockToggle}
      />

      {peerId && (
        <ReportUserDialog
          userId={peerId}
          displayName={peerName}
          open={props.reportDialogOpen}
          onOpenChange={props.onReportDialogOpenChange}
        />
      )}

      {isGroup && view && (
        <GroupInfoDialog
          view={view}
          open={props.groupInfoOpen}
          onClose={props.onGroupInfoClose}
          onLeft={props.onLeftGroup}
        />
      )}

      {view && (
        <ChatAppearanceDialog
          view={view}
          open={props.appearanceOpen}
          onClose={props.onAppearanceClose}
        />
      )}
    </>
  );
}
