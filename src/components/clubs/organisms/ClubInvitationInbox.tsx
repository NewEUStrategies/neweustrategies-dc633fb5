// Skrzynka zaproszeń do klubów.
//
// Stoi WYSOKO na stronie i ma własne obramowanie w kolorze akcentu, bo to
// jedyny moduł huba z terminem: zaproszenie wygasa. Reszta strony poczeka,
// to nie.
//
// Odrzucenia nie da się cofnąć samemu, więc przycisk pyta o potwierdzenie.
// Przyjęcie - nie: z klubu zawsze można wyjść.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { ClubMyInvitationRow } from "@/lib/clubs/types";
import { formatDateShort } from "@/lib/i18n/format";

export function ClubInvitationInbox({
  invitations,
  isPl,
  pending,
  onRespond,
}: {
  invitations: readonly ClubMyInvitationRow[];
  isPl: boolean;
  pending: boolean;
  onRespond: (invitationId: string, accept: boolean) => void;
}) {
  const { t } = useTranslation();
  const [declining, setDeclining] = useState<ClubMyInvitationRow | null>(null);

  if (invitations.length === 0) return null;

  return (
    <section className="mb-8" aria-labelledby="club-invitations-heading">
      <h2
        id="club-invitations-heading"
        className="mb-3 flex items-center gap-2 text-lg font-semibold"
      >
        <Mail className="h-4 w-4" />
        {t("club.invitations")}
        <Badge variant="secondary">{invitations.length}</Badge>
      </h2>

      <ul className="space-y-2">
        {invitations.map((inv) => (
          <li
            key={inv.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{isPl ? inv.club_name_pl : inv.club_name_en}</p>
              <p className="text-sm text-muted-foreground">
                {t("club.invitedBy", { name: inv.inviter_name })}
                {inv.message !== null && inv.message.trim() !== "" ? ` - ${inv.message}` : ""}
              </p>
              {inv.expires_at !== null ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("club.hub.inviteExpires", {
                    date: formatDateShort(inv.expires_at, isPl ? "pl" : "en"),
                  })}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" disabled={pending} onClick={() => onRespond(inv.id, true)}>
                {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {t("club.acceptInvitation")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setDeclining(inv)}
              >
                {t("club.declineInvitation")}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <AlertDialog open={declining !== null} onOpenChange={(open) => !open && setDeclining(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("club.hub.declineTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("club.hub.declineBody", {
                club:
                  declining === null ? "" : isPl ? declining.club_name_pl : declining.club_name_en,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (declining !== null) onRespond(declining.id, false);
                setDeclining(null);
              }}
            >
              {t("club.declineInvitation")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
