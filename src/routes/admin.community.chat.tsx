// /admin/community/chat — moderacja konwersacji i wiadomości.
// - Lista konwersacji z liczbą uczestników / wiadomości / ostatnim preview
// - Drill-in: podgląd wiadomości + soft-delete
// - Delete konwersacji (cascade)
// - Purge wygasłych wiadomości
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { pl as plLocale, enGB } from "date-fns/locale";
import { MessageCircle, Trash2, EyeOff, RefreshCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  deleteConversation,
  fetchAdminConversations,
  fetchConversationMessages,
  purgeExpiredMessages,
  softDeleteMessage,
  type ConversationListItem,
} from "@/lib/admin/community";

export const Route = createFileRoute("/admin/community/chat")({
  head: () => ({ meta: [{ title: "Chat · Community · Admin" }] }),
  component: AdminCommunityChat,
});

function AdminCommunityChat() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const locale = isPl ? plLocale : enGB;
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<ConversationListItem | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const conversationsQ = useQuery({
    queryKey: ["admin-community-conversations", q],
    queryFn: () => fetchAdminConversations({ search: q }),
    staleTime: 15_000,
  });

  const messagesQ = useQuery({
    queryKey: ["admin-community-messages", selected?.id],
    queryFn: () => fetchConversationMessages(selected!.id),
    enabled: !!selected,
    staleTime: 5_000,
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-community-conversations"] });
      qc.invalidateQueries({ queryKey: ["admin-community-stats"] });
      toast.success(isPl ? "Usunięto konwersację" : "Conversation deleted");
      setConfirmDeleteId(null);
      setSelected(null);
    },
    onError: () => toast.error(isPl ? "Błąd usuwania" : "Delete failed"),
  });

  const softDeleteM = useMutation({
    mutationFn: (id: string) => softDeleteMessage(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-community-messages"] });
      qc.invalidateQueries({ queryKey: ["admin-community-conversations"] });
      toast.success(isPl ? "Wiadomość ukryta" : "Message hidden");
    },
    onError: () => toast.error(isPl ? "Błąd" : "Failed"),
  });

  const purgeM = useMutation({
    mutationFn: purgeExpiredMessages,
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["admin-community-conversations"] });
      toast.success(isPl ? `Wyczyszczono ${count}` : `Purged ${count}`);
    },
    onError: () => toast.error(isPl ? "Błąd" : "Failed"),
  });

  const rows = conversationsQ.data ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-xl font-semibold">{isPl ? "Moderacja czatu" : "Chat moderation"}</h2>
          <p className="text-sm text-muted-foreground">
            {isPl
              ? "Widok wszystkich konwersacji w bazie z możliwością usuwania i ukrywania wiadomości."
              : "All conversations in the database with the ability to delete or hide messages."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isPl ? "Szukaj w treści…" : "Search preview…"}
            className="w-[240px]"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => purgeM.mutate()}
            disabled={purgeM.isPending}
          >
            <RefreshCcw className="w-4 h-4 mr-2" />
            {isPl ? "Purge" : "Purge"}
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          {conversationsQ.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">
              {isPl ? "Ładowanie…" : "Loading…"}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              {isPl ? "Brak konwersacji." : "No conversations."}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((c) => (
                <li key={c.id} className="p-3 hover:bg-muted/40 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSelected(c)}
                      className="flex-1 text-left space-y-1"
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <MessageCircle className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="font-medium truncate">
                          {c.title ?? (isPl ? "Konwersacja 1:1" : "Direct chat")}
                        </span>
                        <Badge variant="secondary" className="text-[10px]">
                          {c.kind}
                        </Badge>
                        {c.message_ttl_seconds && (
                          <Badge variant="outline" className="text-[10px]">
                            TTL {c.message_ttl_seconds / 3600}h
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.last_message_preview ?? (isPl ? "(brak treści)" : "(no content)")}
                      </div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-3">
                        <span>
                          {isPl ? "Uczestn." : "Participants"}: {c.participants_count}
                        </span>
                        <span>
                          {isPl ? "Wiad." : "Msgs"}: {c.messages_count}
                        </span>
                        {c.last_message_at && (
                          <span>
                            {formatDistanceToNow(new Date(c.last_message_at), {
                              addSuffix: true,
                              locale,
                            })}
                          </span>
                        )}
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirmDeleteId(c.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Podgląd wiadomości */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.title ?? (isPl ? "Konwersacja" : "Conversation")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {messagesQ.isLoading ? (
              <div className="text-sm text-muted-foreground">
                {isPl ? "Ładowanie…" : "Loading…"}
              </div>
            ) : (messagesQ.data ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {isPl ? "Brak wiadomości." : "No messages."}
              </div>
            ) : (
              (messagesQ.data ?? []).map((m) => (
                <div
                  key={m.id}
                  className={
                    "p-2 rounded-md border text-sm space-y-1 " +
                    (m.deleted_at
                      ? "bg-muted/30 border-dashed opacity-70"
                      : "bg-background border-border")
                  }
                >
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">
                      {m.kind}
                    </Badge>
                    <span>
                      {formatDistanceToNow(new Date(m.created_at), { addSuffix: true, locale })}
                    </span>
                    {m.forwarded && (
                      <Badge variant="secondary" className="text-[10px]">
                        ↪
                      </Badge>
                    )}
                    <span className="ml-auto font-mono">{m.sender_id.slice(0, 8)}</span>
                    {!m.deleted_at && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => softDeleteM.mutate(m.id)}
                        title={isPl ? "Ukryj wiadomość" : "Hide message"}
                      >
                        <EyeOff className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap break-words">
                    {m.deleted_at ? (
                      <span className="italic text-muted-foreground">
                        {isPl ? "[wiadomość ukryta]" : "[hidden]"}
                      </span>
                    ) : (
                      (m.body ?? (m.attachment_name ? `📎 ${m.attachment_name}` : "-"))
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              <X className="w-4 h-4 mr-2" />
              {isPl ? "Zamknij" : "Close"}
            </Button>
            {selected && (
              <Button variant="destructive" onClick={() => setConfirmDeleteId(selected.id)}>
                <Trash2 className="w-4 h-4 mr-2" />
                {isPl ? "Usuń konwersację" : "Delete conversation"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <Dialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isPl ? "Usunąć konwersację?" : "Delete conversation?"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {isPl
              ? "Ta akcja usunie konwersację wraz ze wszystkimi wiadomościami i uczestnikami. Operacja jest nieodwracalna."
              : "This will remove the conversation with every message and participant. Irreversible."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
              {isPl ? "Anuluj" : "Cancel"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteId && deleteM.mutate(confirmDeleteId)}
              disabled={deleteM.isPending}
            >
              {isPl ? "Usuń" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
