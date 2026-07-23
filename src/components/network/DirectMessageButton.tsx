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
import { useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Check, Lock, MessageSquare } from "lucide-react";
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
  /** Kompaktowy przycisk h-8 (listy, kafelki wyszukiwarki). */
  compact?: boolean;
  /** Tylko ikona - do wąskich pigułek i kart w gridzie. */
  iconOnly?: boolean;
  className?: string;
}

export function DirectMessageButton({
  userId,
  displayName,
  displayAvatar,
  compact,
  iconOnly,
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

  const handleClick = (e: MouseEvent): void => {
    // W listach osoby często siedzą pod <Link>/<AppLink> - nie chcemy, żeby
    // klik w przycisk otwierał profil.
    e.preventDefault();
    e.stopPropagation();
    if (locked) {
      setUpgradeOpen(true);
      return;
    }
    openChat();
  };

  const label = t("directMessage.button");
  const aria = t("directMessage.ariaLabel", { name: displayName });
  const title = locked ? t("directMessage.tooltipLocked") : t("directMessage.tooltipEnabled");
  const Icon = locked ? Lock : MessageCircle;

  return (
    <>
      <Button
        type="button"
        variant={locked || iconOnly ? "outline" : "default"}
        size={iconOnly ? "icon" : compact ? "sm" : "default"}
        disabled={startChat.isPending}
        onClick={handleClick}
        aria-label={aria}
        title={title}
        className={cn(
          "gap-1.5 rounded-[6px]",
          compact && !iconOnly && "h-8 px-2.5 text-xs",
          iconOnly && "h-8 w-8 shrink-0 transition-colors [&_svg]:transition-colors",
          iconOnly && !locked && "hover:bg-brand/10 hover:text-brand hover:border-brand/40",
          iconOnly && locked && "hover:bg-muted/60",
          locked && "text-muted-foreground",
          className,
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {!iconOnly && (
          <span className={cn(compact && "hidden sm:inline")}>{label}</span>
        )}
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
