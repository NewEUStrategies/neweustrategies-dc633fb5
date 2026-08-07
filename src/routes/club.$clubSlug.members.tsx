// /club/$clubSlug/members - kto należy do klubu.
//
// Szósta trasa modułu z §5.1 specyfikacji, jedyna, której nie było. Skutek jej
// braku nie był kosmetyczny: `club_capabilities.can_see_members` liczyło się
// w bazie od A1 i nie miało po stronie produktu ANI JEDNEGO konsumenta, więc
// cała ta gałąź uprawnienia była martwa. Członek klubu nie miał też odpowiedzi
// na pytanie, z kim właściwie deliberuje - a to jest jedna z dwóch rzeczy
// (obok zasad), które odróżniają klub od kanału.
//
// WIDOCZNOŚĆ. Lista wychodzi WYŁĄCZNIE przez `club_members_list`, które samo
// odsiewa `banned` i `left` - kto został z klubu usunięty, jest sprawą
// moderacji, nie zebrania. Odnośnik do profilu pojawia się tylko wtedy, gdy
// osoba ma publiczny profil (`slug`); reszta jest wypisana bez linku, bo
// katalog klubu nie może obchodzić ustawienia widoczności profilu.
//
// `noindex` bezwarunkowo, także w klubie `public`: nazwiska członków to nie
// jest treść, która ma trafiać do wyszukiwarki - ta sama doktryna, co /people.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BadgeCheck, Users2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { useClubBySlug, useClubMembers } from "@/lib/clubs/useClubs";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/api";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { formatDateShort } from "@/lib/i18n/format";
import { ensureClubI18n } from "@/lib/i18n-club";

const PAGE_SIZE = 60;

export const Route = createFileRoute("/club/$clubSlug/members")({
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
      fallbackPath: `/club/${params.clubSlug}/members`,
      club: loaderData?.club ?? null,
      forceNoindex: true,
    }),
  component: ClubMembersRoute,
});

function ClubMembersRoute() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const lang = isPl ? "pl" : "en";
  const { clubSlug } = Route.useParams();

  const clubQ = useClubBySlug(clubSlug);
  const club = clubQ.data ?? null;
  const canSee = club?.can_see_members === true;
  const membersQ = useClubMembers({
    clubId: canSee ? club?.id : undefined,
    status: "active",
    limit: PAGE_SIZE,
  });

  if (clubQ.isPending) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <div className="h-64 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
      </div>
    );
  }

  if (clubQ.isError) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <ClubErrorNotice onRetry={() => void clubQ.refetch()} />
      </div>
    );
  }

  if (!club) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            {t("club.reason.not_found")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const rows = membersQ.data?.rows ?? [];
  const total = membersQ.data?.total ?? 0;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 h-8 px-2">
        <Link to="/club/$clubSlug" params={{ clubSlug }}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {isPl ? club.name_pl : club.name_en}
        </Link>
      </Button>

      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Users2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          {t("club.roster.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("club.membersCount", { count: club.member_count })}
        </p>
      </header>

      {/* Brak uprawnienia nie jest błędem ani pustką: klub ma prawo nie
          pokazywać składu, a czytelnik ma prawo wiedzieć, że to decyzja
          klubu, a nie awaria. */}
      {!canSee ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t("club.roster.hidden")}
          </CardContent>
        </Card>
      ) : membersQ.isError ? (
        <ClubErrorNotice onRetry={() => void membersQ.refetch()} />
      ) : membersQ.isPending ? (
        <div className="grid gap-2 sm:grid-cols-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t("club.roster.empty")}
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="grid gap-2 sm:grid-cols-2">
            {rows.map((row) => {
              const body = (
                <>
                  <ChatAvatar
                    avatarUrl={row.avatar_url}
                    name={row.display_name}
                    size="md"
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-medium">{row.display_name}</span>
                      {row.verified ? (
                        <BadgeCheck
                          className="h-3.5 w-3.5 shrink-0 text-primary"
                          aria-label={t("club.roster.verified")}
                        />
                      ) : null}
                      {/* Rola `member` to stan domyślny - plakietka przy każdym
                          wierszu byłaby szumem, a nie informacją. */}
                      {row.role !== "member" ? (
                        <Badge variant="outline" className="shrink-0 text-[11px]">
                          {t(`club.role.${row.role}`)}
                        </Badge>
                      ) : null}
                    </div>
                    {row.job_title !== null || row.current_company !== null ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {[row.job_title, row.current_company].filter(Boolean).join(" - ")}
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("club.roster.joined", { date: formatDateShort(row.joined_at, lang) })}
                    </p>
                  </div>
                </>
              );

              return (
                <li key={row.user_id}>
                  {row.slug ? (
                    <Link
                      to="/author/$slug"
                      params={{ slug: row.slug }}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/40"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Ucięcie strony mówi się wprost - nagłówek pokazuje pełny licznik
              z denormalizacji, więc milcząca różnica wygląda jak brak osób. */}
          {total > rows.length ? (
            <p className="mt-3 rounded-lg border border-dashed border-border/60 p-3 text-center text-xs text-muted-foreground">
              {t("club.roster.truncated", { shown: rows.length, total })}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
