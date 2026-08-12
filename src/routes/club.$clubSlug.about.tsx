// /club/$clubSlug/about - zasady, dołączenie, poziom powiadomień.
//
// Zasady pokazujemy PRZED wejściem, nie po. To nie jest uprzejmość: przy
// usunięciu konta treść zostaje w klubie (anonimizacja autorstwa, V1 §7),
// a to wymaga zgody wyrażonej wcześniej, nie domniemanej później.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, ScrollText } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useAcceptClubRules,
  useClubBySlug,
  useJoinClub,
  useLeaveClub,
  useMyClubMemberships,
  useSetClubNotifyLevel,
} from "@/lib/clubs/useClubs";
import { ClubEnumSelect } from "@/components/admin/clubs/molecules/ClubEnumSelect";
import { CLUB_NOTIFY_LEVELS, toClubInviteError, toClubNotifyLevel } from "@/lib/clubs/types";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/api";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { ensureClubI18n } from "@/lib/i18n-club";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

export const Route = createFileRoute("/club/$clubSlug/about")({
  loader: async ({ context, params }) => {
    const club = await context.queryClient
      .ensureQueryData({
        queryKey: clubKeys.bySlug(params.clubSlug),
        queryFn: () => fetchClubBySlug(params.clubSlug),
      })
      .catch(() => null);
    return { club: toClubHeadSource(club) };
  },
  head: ({ loaderData, params }) =>
    buildClubHead({
      fallbackPath: `/club/${params.clubSlug}/about`,
      club: loaderData?.club ?? null,
    }),
  component: ClubAbout,
});

function ClubAbout() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { clubSlug } = Route.useParams();
  const { session } = useAuth();

  const clubQ = useClubBySlug(clubSlug);
  const club = clubQ.data ?? null;
  const joinM = useJoinClub();
  const leaveM = useLeaveClub();
  const rulesM = useAcceptClubRules(club?.id ?? "");
  const notifyM = useSetClubNotifyLevel(club?.id ?? "");
  // `club_view` NIE zwraca poziomu powiadomień - jedynym źródłem jest
  // `club_my_memberships.notify_level`. Kontrolka miała tu literał "digest",
  // więc pokazywała ten poziom KAŻDEMU: użytkownik ustawiał "wszystkie",
  // dostawał zielony toast i natychmiast widział z powrotem "skrót", bez
  // żadnego sposobu sprawdzenia, co faktycznie ma ustawione.
  const membershipsQ = useMyClubMemberships(Boolean(session));
  const myNotifyLevel = toClubNotifyLevel(
    membershipsQ.data?.find((row) => row.club_id === club?.id)?.notify_level,
  );

  if (clubQ.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-8">
        <div className="h-64 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
      </div>
    );
  }
  if (clubQ.isError) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-12">
        <ClubErrorNotice onRetry={() => void clubQ.refetch()} />
      </div>
    );
  }
  if (!club) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-12">
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            {t("club.reason.not_found")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const isMember = club.my_status === "active";
  const rules = pickLocalized(club, "rules", lang);
  const description = pickLocalized(club, "description", lang);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 h-8 px-2">
        <Link to="/club/$clubSlug" params={{ clubSlug }}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          {pickLocalized(club, "name", lang)}
        </Link>
      </Button>

      <h1 className="text-3xl font-semibold">{pickLocalized(club, "name", lang)}</h1>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline">{t(`club.visibility.${club.visibility}`)}</Badge>
        <Badge variant="outline">{t(`club.joinPolicy.${club.join_policy}`)}</Badge>
        <Badge variant="outline">{t(`club.attribution.${club.attribution_mode}`)}</Badge>
        <Badge variant="outline">{t(`club.whoCanPost.${club.who_can_post}`)}</Badge>
      </div>

      {description ? (
        <p className="mt-5 whitespace-pre-wrap leading-relaxed">{description}</p>
      ) : null}

      {rules ? (
        <Card className="mt-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-4 w-4" />
              {t("club.rules")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{rules}</p>
            {isMember && club.rules_accepted_at === null ? (
              <Button
                className="mt-4"
                size="sm"
                disabled={rulesM.isPending}
                onClick={() =>
                  rulesM.mutate(undefined, {
                    onSuccess: () => toast.success(t("club.rulesAccepted")),
                    onError: () => toast.error(t("adminClubs.saveFailed")),
                  })
                }
              >
                {t("club.acceptRules")}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {session ? (
        <Card className="mt-6">
          <CardContent className="space-y-4 p-5">
            {isMember ? (
              <>
                <ClubEnumSelect
                  id="club-notify"
                  label={t("club.notifyLevel")}
                  value={myNotifyLevel}
                  options={CLUB_NOTIFY_LEVELS}
                  i18nPrefix="club.notify"
                  onChange={(level) =>
                    notifyM.mutate(level, {
                      onSuccess: () => toast.success(t("adminClubs.saved")),
                      onError: () => toast.error(t("adminClubs.saveFailed")),
                    })
                  }
                  disabled={notifyM.isPending}
                />
                <Button
                  variant="outline"
                  disabled={leaveM.isPending}
                  onClick={() =>
                    leaveM.mutate(club.id, {
                      onSuccess: () => toast.success(t("club.leftClub")),
                      onError: () => toast.error(t("adminClubs.saveFailed")),
                    })
                  }
                >
                  {t("club.leave")}
                </Button>
              </>
            ) : club.join_policy === "invite" ? (
              <p className="text-sm text-muted-foreground">
                {t("adminClubs.invitations.error.invitation_required")}
              </p>
            ) : (
              <Button
                disabled={joinM.isPending}
                onClick={() =>
                  joinM.mutate(club.id, {
                    onSuccess: (status) =>
                      toast.success(
                        status === "active" ? t("club.joined") : t("club.joinRequested"),
                      ),
                    onError: (error) => {
                      const code = toClubInviteError(error);
                      toast.error(
                        code
                          ? t(`adminClubs.invitations.error.${code}`)
                          : t("adminClubs.saveFailed"),
                      );
                    },
                  })
                }
              >
                {club.join_policy === "open" ? t("club.join") : t("club.requestJoin")}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
