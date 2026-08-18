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

  groupInfoOpen: boolean;
  onGroupInfoClose: () => void;
  /** Po wyjściu z kręgu wracamy na listę (page) albo zamykamy okno (dock). */
  onLeftGroup?: () => void;

  appearanceOpen: boolean;
  onAppearanceClose: () => void;
}

export function ChatWindowDialogs(props: ChatWindowDialogsProps) {
  const { t } = useTranslation();
  const { deleteTarget, view, isGroup, peerName, peerBlocked } = props;

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
