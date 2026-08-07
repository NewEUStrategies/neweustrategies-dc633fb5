// /club - indeks klubów: moje kluby, odkryj, zaproszenia.
//
// `noindex` dla całej powierzchni poza klubami public - ta sama doktryna,
// co /people i /network. Klub public jest indeksowalny i staje się realnym
// lejkiem pozyskania, ale ta STRONA jest listą, a lista miesza kluby publiczne
// z members-only, więc indeksowanie jej wyciekałoby nazwy klubów zamkniętych.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { MessagesSquare, Users2, Layers, Mail } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useClubList, useMyClubInvitations, useRespondClubInvitation } from "@/lib/clubs/useClubs";
import { CLUB_VISIBILITIES, type ClubVisibility } from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";
import { toast } from "sonner";

export const Route = createFileRoute("/club/")({
  head: () => ({
    meta: [{ title: "Kluby dyskusyjne" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: ClubIndex,
});

function asVisibility(value: string): ClubVisibility {
  return (CLUB_VISIBILITIES as readonly string[]).includes(value)
    ? (value as ClubVisibility)
    : "members";
}

function ClubIndex() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const { session } = useAuth();

  const clubsQ = useClubList();
  const invitationsQ = useMyClubInvitations(Boolean(session));
  const respondM = useRespondClubInvitation();

  if (!session) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <MessagesSquare className="h-8 w-8 text-muted-foreground" />
            <h1 className="text-xl font-semibold">{t("club.membersOnlyTitle")}</h1>
            <p className="max-w-md text-sm text-muted-foreground">{t("club.membersOnlyBody")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const clubs = clubsQ.data?.rows ?? [];
  // Rozdzielamy w kliencie, bo RPC zwraca jedną listę posortowaną tak, że
  // moje kluby są na górze - drugi round-trip po ten sam zbiór byłby marnotrawstwem.
  const mine = clubs.filter((c) => c.my_status === "active");
  const discover = clubs.filter((c) => c.my_status !== "active");
  const invitations = invitationsQ.data ?? [];

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold">{t("club.title")}</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">{t("club.subtitle")}</p>
      </header>

      {invitations.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
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
                    {inv.message ? ` - ${inv.message}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    disabled={respondM.isPending}
                    onClick={() =>
                      respondM.mutate(
                        { invitationId: inv.id, accept: true },
                        {
                          onSuccess: () => toast.success(t("club.invitationAccepted")),
                          onError: () => toast.error(t("adminClubs.saveFailed")),
                        },
                      )
                    }
                  >
                    {t("club.acceptInvitation")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={respondM.isPending}
                    onClick={() =>
                      respondM.mutate(
                        { invitationId: inv.id, accept: false },
                        {
                          onSuccess: () => toast.success(t("club.invitationDeclined")),
                          onError: () => toast.error(t("adminClubs.saveFailed")),
                        },
                      )
                    }
                  >
                    {t("club.declineInvitation")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ClubSection
        title={t("club.myClubs")}
        empty={t("club.empty")}
        clubs={mine}
        isPl={isPl}
        loading={clubsQ.isPending}
      />

      <ClubSection
        title={t("club.discover")}
        empty={t("club.emptyDiscover")}
        clubs={discover}
        isPl={isPl}
        loading={clubsQ.isPending}
      />
    </div>
  );
}

interface ClubCardData {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  tagline_pl: string | null;
  tagline_en: string | null;
  visibility: string;
  member_count: number;
  thread_count: number;
  group_count: number;
}

function ClubSection({
  title,
  empty,
  clubs,
  isPl,
  loading,
}: {
  title: string;
  empty: string;
  clubs: ClubCardData[];
  isPl: boolean;
  loading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : clubs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map((club) => (
            <Link
              key={club.id}
              to="/club/$clubSlug"
              params={{ clubSlug: club.slug }}
              className="group flex flex-col rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium leading-tight group-hover:text-primary">
                  {isPl ? club.name_pl : club.name_en}
                </h3>
                <Badge variant="outline" className="shrink-0 text-[11px]">
                  {t(`club.visibility.${asVisibility(club.visibility)}`)}
                </Badge>
              </div>
              {(isPl ? club.tagline_pl : club.tagline_en) ? (
                <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                  {isPl ? club.tagline_pl : club.tagline_en}
                </p>
              ) : null}
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Users2 className="h-3.5 w-3.5" />
                  {t("club.membersCount", { count: club.member_count })}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MessagesSquare className="h-3.5 w-3.5" />
                  {t("club.threadsCount", { count: club.thread_count })}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" />
                  {t("club.groupsCount", { count: club.group_count })}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
