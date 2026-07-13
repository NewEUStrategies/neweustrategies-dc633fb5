// Forward a (text) message to another conversation. Mounted only while a
// forward is in progress, so its data (conversation list + peer profiles) is
// fetched on demand, not by every open chat window.
//
// Text-only by design: attachment paths embed the SOURCE conversation id, and
// the storage RLS admits only members of THAT conversation - forwarding a file
// would require server-side copying the object into the target conversation's
// folder (a separate, larger change). The forward action is therefore exposed
// only on text bubbles.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { conversationDisplay } from "@/lib/chat/display";
import { useConversations, usePeerProfiles } from "@/lib/chat/useConversations";
import { useSendMessage } from "@/lib/chat/useMessages";
import type { ChatMessage } from "@/lib/chat/types";
import { ChatAvatar } from "./ChatAvatar";

const MAX_BODY_LENGTH = 8000;

export function ForwardDialog({
  message,
  excludeConversationId,
  onClose,
  onForwarded,
}: {
  message: ChatMessage | null;
  excludeConversationId: string;
  onClose: () => void;
  onForwarded?: (conversationId: string) => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const conversationsQ = useConversations();
  const sendMessage = useSendMessage();

  // Every active (non-archived) conversation except the source one.
  const targets = useMemo(
    () =>
      (conversationsQ.data ?? []).filter(
        (v) => v.conversation.id !== excludeConversationId && !v.me.archived_at,
      ),
    [conversationsQ.data, excludeConversationId],
  );
  const peerIds = useMemo(
    () => [...new Set(targets.flatMap((v) => v.peers.map((p) => p.user_id)))],
    [targets],
  );
  const peersQ = usePeerProfiles(peerIds);

  const normalized = filter.trim().toLowerCase();
  const filtered = normalized
    ? targets.filter((v) =>
        conversationDisplay(v, peersQ.data).name.toLowerCase().includes(normalized),
      )
    : targets;

  const send = (targetId: string) => {
    if (!message?.body) return;
    sendMessage.mutate(
      {
        conversationId: targetId,
        kind: "text",
        body: message.body.slice(0, MAX_BODY_LENGTH),
        forwarded: true,
      },
      {
        onSuccess: () => {
          toast.success(t("chat.forward.sent"));
          onForwarded?.(targetId);
          onClose();
        },
        onError: () => toast.error(t("chat.forward.error")),
      },
    );
  };

  return (
    <Dialog open={!!message} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm gap-0 p-0">
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="text-sm">{t("chat.forward.title")}</DialogTitle>
          <DialogDescription className="line-clamp-2 text-[12px]">
            {message?.body}
          </DialogDescription>
        </DialogHeader>
        <div className="p-2">
          <label className="relative block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="text"
              value={filter}
              autoFocus
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("chat.searchConversations")}
              aria-label={t("chat.searchConversations")}
              className="h-9 w-full rounded-[6px] border border-input bg-muted/40 !pl-[42px] pr-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>
        <div className="max-h-[320px] overflow-y-auto px-1.5 pb-2">
          {filtered.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              {t("chat.forward.noTargets")}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {filtered.map((v) => {
                const display = conversationDisplay(v, peersQ.data, t("chat.group.circle"));
                return (
                  <li key={v.conversation.id}>
                    <button
                      type="button"
                      disabled={sendMessage.isPending}
                      onClick={() => send(v.conversation.id)}
                      className="flex w-full items-center gap-2.5 rounded-[6px] px-2 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
                    >
                      <ChatAvatar name={display.name} avatarUrl={display.avatarUrl} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                        {display.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("chat.close")}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </DialogContent>
    </Dialog>
  );
}
