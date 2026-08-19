// Direct Message: uniwersalny przycisk na profilach ekspertów i użytkowników.
// - Ukryty dla anonów oraz dla własnego profilu.
// - Widoczny wyłącznie gdy relacja z odbiorcą jest zaakceptowana (status
//   "connected" w user_connections). W pozostałych stanach komponent zwraca
//   null - wtedy miejsce zapełnia ConnectButton (patrz MessageOrConnectButton).
// - Miękka bramka po `features.chat_enabled` bieżącej warstwy członkostwa:
//   Essential (chat_enabled=false) -> otwiera dialog z zachętą do upgrade'u
//   (Plus i wyżej). Twarda bramka i tak siedzi w
//   `get_or_create_direct_conversation` w bazie, więc UI tylko szanuje
//   deklarację, żeby nie serwować przycisku, który natychmiast rzuca 403.
// - Aktywny (Plus/Pro/VIP+): startuje rozmowę i otwiera dock czatu. Gdy DB
//   sygnalizuje "chat: expert requires request", `useStartConversation`
//   otwiera globalny ExpertRequestDialog przez bus - tu tylko wyciszamy toast.
import { useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Check, Loader2, Lock, MessageCircleMore } from "lucide-react";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentTier, tierHasFeature } from "@/lib/billing/tiers";
import { useStartConversation } from "@/lib/chat/useConversations";
import { openChatWindow } from "@/lib/chat/chatDockBus";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useConnectionStatuses, type ConnectionState } from "@/lib/network/useConnections";
import { cn } from "@/lib/utils";
import "@/lib/i18n-direct-message";

export interface DirectMessageButtonProps {
  userId: string;
  displayName: string;
  displayAvatar?: string | null;
  /** Kompaktowy przycisk h-8 (listy, kafelki wyszukiwarki). */
  compact?: boolean;
  /** Tylko ikona - do wąskich pigułek i kart w gridzie. */
  iconOnly?: boolean;
  className?: string;
  /**
   * Opcjonalny, znany z góry status relacji (np. z batchowanego RPC).
   * Gdy pominięty, komponent pobiera status samodzielnie.
   */
  connectionState?: ConnectionState;
}

export function DirectMessageButton({
  userId,
  displayName,
  displayAvatar,
  compact,
  iconOnly,
  className,
  connectionState,
}: DirectMessageButtonProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const modules = useCommunityModules();
  const tierQ = useCurrentTier();
  const startChat = useStartConversation();
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const selfFetch = connectionState === undefined;
  const statusQ = useConnectionStatuses(
    selfFetch && modules.connections_enabled && user && user.id !== userId ? [userId] : [],
  );
  const resolved = connectionState ?? statusQ.data?.get(userId) ?? null;
  const isLoading = selfFetch && statusQ.isLoading;

  // Sieć kontaktów dotyczy wyłącznie zalogowanych i cudzych profili,
  // z włączonym modułem (toggle admina w community_modules).
  if (!modules.chat_enabled) return null;
  if (!user || user.id === userId) return null;

  // Dopóki nie znamy statusu relacji, pokazujemy stabilny placeholder,
  // żeby nie powodować layout shiftu na listach i profilach.
  if (isLoading) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled
        aria-hidden
        className={cn(
          "rounded-[6px] shrink-0 opacity-60 cursor-not-allowed",
          compact || iconOnly ? "h-8 w-8" : "h-9 w-9",
          className,
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      </Button>
    );
  }

  // Wiadomość bezpośrednia wymaga zaakceptowanego kontaktu (connected).
  // Inne stany (none / pending_out / pending_in) pozostawiamy ConnectButton.
  if (resolved?.status !== "connected") return null;

  const canDm =
    tierQ.data && tierQ.data.features ? tierHasFeature(tierQ.data.features, "chat_enabled") : false;
  // Dopóki nie znamy warstwy, nie decydujemy - domyślnie zablokowane, żeby nie
  // migać "aktywne -> zablokowane" po rozstrzygnięciu warstwy.
  const locked = !canDm;

  const openChat = (): void => {
    startChat.mutate(
      { peerId: userId, peerName: displayName, peerAvatar: displayAvatar ?? null },
      {
        onSuccess: (conversationId) => openChatWindow({ conversationId }),
        onError: (err) => {
          const msg = err instanceof Error ? err.message : "";
          // ExpertRequestDialog otwiera się z busa - toast byłby duplikatem.
          if (msg.includes("chat: expert requires request")) return;
          if (msg.includes("chat: tier disabled")) {
            setUpgradeOpen(true);
            return;
          }
          toast.error(t("directMessage.startError"));
        },
      },
    );
  };

  const isBusy = startChat.isPending;

  const handleClick = (e: MouseEvent): void => {
    // W listach osoby często siedzą pod <Link>/<AppLink> - nie chcemy, żeby
    // klik w przycisk otwierał profil.
    e.preventDefault();
    e.stopPropagation();
    // Blokada wielokrotnych kliknięć w trakcie tworzenia rozmowy.
    if (isBusy) return;
    if (locked) {
      setUpgradeOpen(true);
      return;
    }
    openChat();
  };

  const label = isBusy ? t("directMessage.opening") : t("directMessage.button");
  const aria = isBusy
    ? t("directMessage.ariaBusy", { name: displayName })
    : t("directMessage.ariaLabel", { name: displayName });
  const title = isBusy
    ? t("directMessage.tooltipBusy")
    : locked
      ? t("directMessage.tooltipLocked")
      : t("directMessage.tooltipEnabled");
  const Icon = isBusy ? Loader2 : locked ? Lock : MessageCircleMore;

  return (
    <>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={isBusy}
              aria-busy={isBusy}
              aria-disabled={isBusy}
              data-loading={isBusy ? "true" : undefined}
              onClick={handleClick}
              aria-label={aria}
              className={cn(
                "rounded-[6px] shrink-0 transition-colors",
                compact || iconOnly ? "h-8 w-8" : "h-9 w-9",
                !locked && !isBusy && "hover:bg-brand/10 hover:text-brand hover:border-brand/40",
                locked && !isBusy && "text-muted-foreground hover:bg-muted/60",
                isBusy && "cursor-wait opacity-80",
                className,
              )}
            >
              <Icon className={cn("h-4 w-4", isBusy && "animate-spin")} aria-hidden />
              <span className="sr-only">{label}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {title}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircleMore
                className="h-5 w-5"
                aria-hidden
                style={{ color: "var(--brand)" }}
              />
              {t("directMessage.upgrade.title")}
            </DialogTitle>
            <DialogDescription>
              {t("directMessage.upgrade.description", { name: displayName })}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-1 rounded-[6px] border border-border/60 bg-muted/30 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("directMessage.upgrade.benefitsHeading")}
            </p>
            <ul className="space-y-2 text-sm">
              {[
                t("directMessage.upgrade.benefit1"),
                t("directMessage.upgrade.benefit2"),
                t("directMessage.upgrade.benefit3"),
              ].map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden
                    style={{ color: "var(--brand)" }}
                  />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="ghost" onClick={() => setUpgradeOpen(false)}>
              {t("directMessage.upgrade.cancel")}
            </Button>
            <Button asChild>
              <Link to="/pricing" onClick={() => setUpgradeOpen(false)}>
                {t("directMessage.upgrade.cta")}
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
