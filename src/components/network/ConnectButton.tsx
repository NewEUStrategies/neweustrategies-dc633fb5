// Przycisk relacji w sieci kontaktów - jedna maszyna stanów dla wszystkich
// powierzchni (karta w /people, profil autora, sugestie w /network):
//   none        -> "Dodaj do sieci" (popover z opcjonalną notką),
//   pending_out -> "Wysłano" (wycofanie z potwierdzeniem),
//   pending_in  -> "Akceptuj" + ciche odrzucenie (potwierdzenie),
//   connected   -> "W sieci" (wiadomość / usunięcie z potwierdzeniem).
// Odmowa drugiej strony jest niewidoczna - zapraszający dalej widzi
// pending_out (decyzja projektowa, egzekwowana w DB).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Clock, Flag, MessageCircle, UserCheck, UserMinus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { openChatWindow } from "@/lib/chat/chatDockBus";
import { useStartConversation } from "@/lib/chat/useConversations";
import {
  NO_CONNECTION,
  useCancelConnectionRequest,
  useConnectionStatuses,
  useRemoveConnection,
  useRespondToConnectionRequest,
  useSendConnectionRequest,
  type ConnectionState,
} from "@/lib/network/useConnections";
import { ReportUserDialog } from "@/components/network/ReportUserDialog";
import { toastError } from "@/lib/toastError";
import { cn } from "@/lib/utils";
import "@/lib/i18n-network";

const NOTE_MAX = 300;

export interface ConnectButtonProps {
  userId: string;
  displayName: string;
  /**
   * Stan relacji z batchowanego useConnectionStatuses (strony z listami).
   * Gdy pominięty, komponent sam pobiera status dla pojedynczej osoby
   * (np. profil autora).
   */
  state?: ConnectionState;
  /** Zwarta wersja na karty list (ikona + krótka etykieta). */
  compact?: boolean;
  className?: string;
}

export function ConnectButton({
  userId,
  displayName,
  state,
  compact,
  className,
}: ConnectButtonProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const modules = useCommunityModules();
  const selfFetch = state === undefined;
  const statusesQ = useConnectionStatuses(selfFetch && user && user.id !== userId ? [userId] : []);
  const resolved: ConnectionState = state ?? statusesQ.data?.get(userId) ?? NO_CONNECTION;

  const send = useSendConnectionRequest();
  const respond = useRespondToConnectionRequest();
  const cancel = useCancelConnectionRequest();
  const remove = useRemoveConnection();
  const startChat = useStartConversation();

  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<"withdraw" | "decline" | "remove" | null>(null);
  const [connectedOpen, setConnectedOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // Sieć kontaktów dotyczy wyłącznie zalogowanych i cudzych profili,
  // z włączonym modułem (toggle admina w community_modules).
  if (!modules.connections_enabled) return null;
  if (!user || user.id === userId) return null;
  if (selfFetch && statusesQ.isLoading) return null;
  // DB i tak odrzuci (polityka adresata / tenant / blokada) - nie serwujemy
  // przycisku, który może tylko pokazać odmowę.
  if (resolved.status === "none" && !resolved.canInvite) return null;

  const busy = send.isPending || respond.isPending || cancel.isPending || remove.isPending;
  const size = compact ? "sm" : "default";

  const sendInvite = () => {
    send.mutate(
      { userId, message: note },
      {
        onSuccess: () => {
          setNoteOpen(false);
          setNote("");
          toast.success(t("network.invitedToast"));
        },
        onError: (e) => {
          // Dedykowane komunikaty dla reguł DB, których generyczny mapper nie
          // rozróżni (oba przychodzą jako wyjątek P0001 z RPC).
          const msg = (e as { message?: string })?.message ?? "";
          if (msg.includes("rate limited")) {
            setNoteOpen(false);
            toast.error(t("network.rateLimited"));
          } else if (msg.includes("blocked") || msg.includes("peer not available")) {
            setNoteOpen(false);
            toast.error(t("network.inviteBlocked"));
          } else {
            toastError(e, "save");
          }
        },
      },
    );
  };

  if (resolved.status === "none") {
    return (
      <Popover open={noteOpen} onOpenChange={setNoteOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size={size}
            disabled={busy}
            className={cn("gap-1.5", className)}
            aria-label={`${t("network.connect")}: ${displayName}`}
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            <span className={cn(compact && "hidden sm:inline")}>
              {compact ? t("network.connectShort") : t("network.connect")}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-2 p-3">
          <p className="text-sm font-medium">{t("network.inviteNoteLabel")}</p>
          <Textarea
            value={note}
            maxLength={NOTE_MAX}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("network.inviteNotePlaceholder")}
            aria-label={t("network.inviteNoteLabel")}
            className="resize-none text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            {t("network.inviteNoteHint")} ({note.length}/{NOTE_MAX})
          </p>
          <Button
            type="button"
            size="sm"
            className="w-full gap-1.5"
            disabled={send.isPending}
            onClick={sendInvite}
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            {t("network.sendInvite")}
          </Button>
        </PopoverContent>
      </Popover>
    );
  }

  if (resolved.status === "pending_out") {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={busy}
          className={cn("gap-1.5 text-muted-foreground", className)}
          title={t("network.pendingOutHint")}
          aria-label={`${t("network.withdraw")}: ${displayName}`}
          onClick={() => setConfirm("withdraw")}
        >
          <Clock className="h-3.5 w-3.5" aria-hidden />
          <span className={cn(compact && "hidden sm:inline")}>{t("network.pendingOut")}</span>
        </Button>
        <ConfirmDialog
          open={confirm === "withdraw"}
          onOpenChange={(open) => setConfirm(open ? "withdraw" : null)}
          title={t("network.withdrawTitle", { name: displayName })}
          body={t("network.withdrawConfirm")}
          action={t("network.withdraw")}
          onConfirm={() => {
            if (!resolved.connectionId) return;
            cancel.mutate(resolved.connectionId, {
              onSuccess: () => toast.success(t("network.withdrawnToast")),
              onError: (e) => toastError(e, "save"),
            });
          }}
        />
      </>
    );
  }

  if (resolved.status === "pending_in") {
    return (
      <>
        <div className={cn("flex items-center gap-1.5", className)}>
          <Button
            type="button"
            size={size}
            disabled={busy}
            className="gap-1.5"
            aria-label={`${t("network.accept")}: ${displayName}`}
            onClick={() => {
              if (!resolved.connectionId) return;
              respond.mutate(
                { connectionId: resolved.connectionId, accept: true },
                {
                  onSuccess: () => toast.success(t("network.acceptedToast")),
                  onError: (e) => toastError(e, "save"),
                },
              );
            }}
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            <span className={cn(compact && "hidden sm:inline")}>{t("network.accept")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size={size}
            disabled={busy}
            className="gap-1 text-muted-foreground"
            aria-label={`${t("network.decline")}: ${displayName}`}
            onClick={() => setConfirm("decline")}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
        <ConfirmDialog
          open={confirm === "decline"}
          onOpenChange={(open) => setConfirm(open ? "decline" : null)}
          title={t("network.declineTitle", { name: displayName })}
          body={t("network.declineConfirm")}
          action={t("network.decline")}
          onConfirm={() => {
            if (!resolved.connectionId) return;
            respond.mutate(
              { connectionId: resolved.connectionId, accept: false },
              {
                onSuccess: () => toast.success(t("network.declinedToast")),
                onError: (e) => toastError(e, "save"),
              },
            );
          }}
        />
      </>
    );
  }

  // connected
  return (
    <>
      <Popover open={connectedOpen} onOpenChange={setConnectedOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size={size}
            disabled={busy}
            className={cn("gap-1.5", className)}
            aria-label={`${t("network.connected")}: ${displayName}`}
          >
            <UserCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <span className={cn(compact && "hidden sm:inline")}>{t("network.connected")}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1.5">
          <button
            type="button"
            disabled={startChat.isPending}
            className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-2 text-sm hover:bg-muted disabled:opacity-50"
            onClick={() => {
              setConnectedOpen(false);
              startChat.mutate(userId, {
                onSuccess: (conversationId) => openChatWindow({ conversationId }),
                onError: () => toast.error(t("network.startError")),
              });
            }}
          >
            <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t("network.messageAction")}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-2 text-sm hover:bg-muted"
            onClick={() => {
              setConnectedOpen(false);
              setReportOpen(true);
            }}
          >
            <Flag className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t("network.report")}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-2 text-sm text-destructive hover:bg-destructive/10"
            onClick={() => {
              setConnectedOpen(false);
              setConfirm("remove");
            }}
          >
            <UserMinus className="h-4 w-4" aria-hidden />
            {t("network.remove")}
          </button>
        </PopoverContent>
      </Popover>
      <ReportUserDialog
        userId={userId}
        displayName={displayName}
        open={reportOpen}
        onOpenChange={setReportOpen}
      />
      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(open) => setConfirm(open ? "remove" : null)}
        title={t("network.removeTitle", { name: displayName })}
        body={t("network.removeConfirm")}
        action={t("network.remove")}
        onConfirm={() => {
          remove.mutate(userId, {
            onSuccess: () => toast.success(t("network.removedToast")),
            onError: (e) => toastError(e, "save"),
          });
        }}
      />
    </>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  action,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  action: string;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel", { defaultValue: "Anuluj" })}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
