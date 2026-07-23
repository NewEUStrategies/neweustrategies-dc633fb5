// Direct Message: uniwersalny przycisk na profilach ekspertów i użytkowników.
// - Ukryty dla anonów oraz dla własnego profilu.
// - Miękka bramka po `features.chat_enabled` bieżącej warstwy członkostwa:
//   Essential (chat_enabled=false) -> otwiera dialog z zachętą do upgrade'u
//   (Plus i wyżej). Twarda bramka i tak siedzi w
//   `get_or_create_direct_conversation` w bazie, więc UI tylko szanuje
//   deklarację, żeby nie serwować przycisku, który natychmiast rzuca 403.
// - Aktywny (Plus/Pro/VIP+): startuje rozmowę i otwiera dock czatu. Gdy DB
//   sygnalizuje "chat: expert requires request", `useStartConversation`
//   otwiera globalny ExpertRequestDialog przez bus - tu tylko wyciszamy toast.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Check, Lock, MessageCircle } from "lucide-react";
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
import { useAuth } from "@/hooks/useAuth";
import { useCurrentTier, tierHasFeature } from "@/lib/billing/tiers";
import { useStartConversation } from "@/lib/chat/useConversations";
import { openChatWindow } from "@/lib/chat/chatDockBus";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { cn } from "@/lib/utils";
import "@/lib/i18n-direct-message";

export interface DirectMessageButtonProps {
  userId: string;
  displayName: string;
  displayAvatar?: string | null;
  compact?: boolean;
  className?: string;
}

export function DirectMessageButton({
  userId,
  displayName,
  displayAvatar,
  compact,
  className,
}: DirectMessageButtonProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const modules = useCommunityModules();
  const tierQ = useCurrentTier();
  const startChat = useStartConversation();
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  if (!modules.chat_enabled) return null;
  if (!user || user.id === userId) return null;

  const canDm =
    tierQ.data && tierQ.data.features
      ? tierHasFeature(tierQ.data.features, "chat_enabled")
      : false;
  // Dopóki nie znamy warstwy, nie decydujemy - domyślnie zablokowane, żeby nie
  // migać "aktywne -> zablokowane" po rozstrzygnięciu warstwy.
  const locked = !canDm;
  const size = compact ? "sm" : "default";

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

  const handleClick = (): void => {
    if (locked) {
      setUpgradeOpen(true);
      return;
    }
    openChat();
  };

  return (
    <>
      <Button
        type="button"
        variant={locked ? "outline" : "default"}
        size={size}
        disabled={startChat.isPending}
        onClick={handleClick}
        aria-label={t("directMessage.ariaLabel", { name: displayName })}
        title={locked ? t("directMessage.tooltipLocked") : t("directMessage.tooltipEnabled")}
        className={cn(
          "gap-1.5 rounded-[6px]",
          locked && "text-muted-foreground",
          className,
        )}
      >
        {locked ? (
          <Lock className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <MessageCircle className="h-3.5 w-3.5" aria-hidden />
        )}
        <span className={cn(compact && "hidden sm:inline")}>
          {t("directMessage.button")}
        </span>
      </Button>

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => setUpgradeOpen(false)}
            >
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
