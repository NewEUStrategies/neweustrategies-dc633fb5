// "Wydarzenie jako iskra": host (lub staff) tworzy trwałą grupę czatu dla
// uczestników RSVP 'going'. RPC create_event_group jest idempotentne - drugi
// klik po prostu otwiera istniejący krąg w /messages.
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useCreateEventGroup } from "@/lib/network/useConnections";
import { toastError } from "@/lib/toastError";
import "@/lib/i18n-network";

export function EventGroupButton({
  eventId,
  hostUserId,
  eventStatus,
}: {
  eventId: string;
  hostUserId: string | null;
  eventStatus: string;
}) {
  const { t } = useTranslation();
  const { user, isStaff } = useAuth();
  const modules = useCommunityModules();
  const navigate = useNavigate();
  const createGroup = useCreateEventGroup();

  const canManage = !!user && (isStaff || user.id === hostUserId);
  if (!modules.chat_enabled || !canManage || eventStatus !== "published") return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[6px] border border-border/60 bg-muted/30 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-snug">{t("network.eventGroupCreate")}</p>
        <p className="text-xs leading-snug text-muted-foreground">{t("network.eventGroupHint")}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5"
        disabled={createGroup.isPending}
        onClick={() =>
          createGroup.mutate(eventId, {
            onSuccess: (conversationId) => {
              toast.success(t("network.eventGroupCreated"));
              void navigate({ to: "/messages", search: { c: conversationId } });
            },
            onError: (e) => {
              const msg = (e as { message?: string })?.message ?? "";
              if (msg.includes("no attendees") || msg.includes("no eligible members")) {
                toast.error(t("network.eventGroupEmpty"));
              } else {
                toastError(e, "save");
              }
            },
          })
        }
      >
        <UsersRound className="h-3.5 w-3.5" aria-hidden />
        {t("network.eventGroupOpen")}
      </Button>
    </div>
  );
}
