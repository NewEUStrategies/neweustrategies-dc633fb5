// Pasek akcji przy wizytówce uczestnika: „dodaj do znajomych" (relacja na całej
// platformie), „umów spotkanie 1:1" (sloty tego wydarzenia) i „napisz wiadomość".
//
// ZASADY:
//  - konto platformy jest warunkiem czatu i zaproszenia do sieci kontaktów;
//    uczestnik bez konta (wpis wyłącznie w kartotece wydarzenia) dostaje sam
//    przycisk spotkania,
//  - niezalogowany widz nie dostaje przycisków, tylko zachętę do logowania -
//    dokładnie tak, jak w reszcie platformy,
//  - własnej wizytówki nie da się „dodać do znajomych": pokazujemy notkę, że to
//    podgląd paska, który zobaczą inni.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarPlus, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConnectButton } from "@/components/network/ConnectButton";
import { DirectMessageButton } from "@/components/network/DirectMessageButton";
import { MeetingInviteDialog } from "@/components/events/meetings/MeetingInviteDialog";
import { useAuth } from "@/hooks/useAuth";
import { useInviteToMeeting } from "@/lib/events/useMyMeetings";
import { meetingErrorI18nKey } from "@/lib/events/meetingsErrors";
import { cn } from "@/lib/utils";
import { ensureI18n as ensureCartI18n } from "@/lib/i18n-cart";

ensureCartI18n();

export interface EventPersonActionsProps {
  /** Slug wydarzenia - potrzebny do zaproszenia na spotkanie. */
  slug: string | null;
  /** Konto na platformie (gdy uczestnik ma powiązane konto). */
  userId: string | null;
  displayName: string;
  displayAvatar?: string | null;
  /** Kartoteka uczestnika w tym wydarzeniu - adresat zaproszenia 1-1. */
  registrationId?: string | null;
  timezone?: string | null;
  /** Stan spotkania: zaproszony / potwierdzone - wtedy nie zapraszamy ponownie. */
  meetingStatus?: "invited" | "accepted" | null;
  /** Podgląd własnej wizytówki - akcje są wyłączone. */
  self?: boolean;
  onOpenMeetings?: () => void;
  className?: string;
}

export function EventPersonActions({
  slug,
  userId,
  displayName,
  displayAvatar,
  registrationId = null,
  timezone = null,
  meetingStatus = null,
  self = false,
  onOpenMeetings,
  className,
}: EventPersonActionsProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const invite = useInviteToMeeting(slug);

  if (self) {
    return (
      <p className={cn("text-xs italic text-muted-foreground", className)}>
        {t("eventMe.publicPreview.actionsSelf")}
      </p>
    );
  }

  if (user === null) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {t("eventMe.publicPreview.actionsSignIn")}
      </p>
    );
  }

  const canInvite = slug !== null && registrationId !== null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {userId !== null && (
        <ConnectButton userId={userId} displayName={displayName} compact />
      )}

      {canInvite &&
        (meetingStatus === null ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 rounded-[6px]"
            onClick={() => setInviteOpen(true)}
          >
            {invite.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {t("eventMe.publicPreview.meeting")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 rounded-[6px]"
            onClick={onOpenMeetings}
          >
            <Users className="mr-2 h-4 w-4" aria-hidden="true" />
            {meetingStatus === "invited"
              ? t("eventMe.publicPreview.meetingInvited")
              : t("eventMe.publicPreview.meetingAccepted")}
          </Button>
        ))}

      {userId !== null && (
        <DirectMessageButton
          userId={userId}
          displayName={displayName}
          displayAvatar={displayAvatar ?? null}
          compact
        />
      )}

      {canInvite && (
        <MeetingInviteDialog
          open={inviteOpen}
          slug={slug}
          counterpartRegistrationId={registrationId}
          counterpartName={displayName}
          timezone={timezone}
          isPending={invite.isPending}
          onOpenChange={setInviteOpen}
          onSubmit={(input) => {
            invite.mutate(
              {
                eventSlug: slug,
                counterpartRegistrationId: registrationId,
                startsAt: input.startsAt,
                topic: input.topic,
                message: input.message,
              },
              {
                onSuccess: () => {
                  setInviteOpen(false);
                  toast.success(t("eventMe.publicPreview.meetingSent"));
                },
                onError: (error) => toast.error(t(meetingErrorI18nKey(error))),
              },
            );
          }}
        />
      )}
    </div>
  );
}
