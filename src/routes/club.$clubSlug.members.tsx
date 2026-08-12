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
import { toast } from "sonner";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  CalendarPlus,
  GraduationCap,
  Users2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ClubPresenceAvatar,
  ClubSignalMetric,
} from "@/components/clubs/atoms/ClubNetworkPrimitives";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubEnumSelect } from "@/components/admin/clubs/molecules/ClubEnumSelect";
import { useAuth } from "@/hooks/useAuth";
import { CLUB_MEMBER_ROLES, type ClubMemberRole } from "@/lib/clubs/types";
import { useClubBySlug, useClubMembers, useSetClubMemberRole } from "@/lib/clubs/useClubs";
import { useClubRosterSignal } from "@/lib/clubs/useClubNetwork";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/api";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { formatDateShort, formatNumber, uiLang, uiLocale } from "@/lib/i18n/format";
import { ensureClubI18n } from "@/lib/i18n-club";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

const PAGE_SIZE = 60;

/** Rola z RPC zawężona do słownika klienta - nieznana wartość z nowszej
 *  migracji nie może wywrócić listy, więc degraduje do stanu domyślnego. */
function asRole(value: string): ClubMemberRole {
  return (CLUB_MEMBER_ROLES as readonly string[]).includes(value)
    ? (value as ClubMemberRole)
    : "member";
}

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
  const lang = uiLang(i18n.language);
  const locale = uiLocale(i18n.language);
  const { clubSlug } = Route.useParams();

  const { user, isAdmin } = useAuth();
  const clubQ = useClubBySlug(clubSlug);
  const club = clubQ.data ?? null;
  const canSee = club?.can_see_members === true;
  const membersQ = useClubMembers({
    clubId: canSee ? club?.id : undefined,
    status: "active",
    limit: PAGE_SIZE,
  });
  // SYGNAŁ OBECNOŚCI (A32). Lista nazwisk odpowiada na pytanie "kto należy",
  // a nie na pytanie "czy ktokolwiek tu jest" - a to drugie jest pierwszym,
  // które zadaje człowiek wchodzący na skład klubu, którego nie zna.
  // Limit twarzy równy stronie listy, żeby kropka obecności nie znikała
  // w połowie ekranu.
  const signalQ = useClubRosterSignal({
    clubId: canSee ? club?.id : undefined,
    limit: PAGE_SIZE,
  });
  const setRoleM = useSetClubMemberRole(club?.id ?? "");

  // Prowadzący klubu zarządza rolami W KLUBIE - panel administracyjny jest dla
  // niego zamknięty (bramka `isAdmin` na trasie), więc bez tego `club_set_role`
  // nie miał ŻADNEJ drogi wywołania, a prowadzący nie mógł wyznaczyć moderatora
  // we własnym klubie.
  const canManage = club?.can_manage === true;
  // `is_club_admin` w bazie to dokładnie admin|super_admin, czyli `isAdmin`
  // tutaj. Role podwyższone (`lead`, `moderator`) RPC przepuszcza wyłącznie im,
  // więc droplista prowadzącego ich nie oferuje - wybór, którego baza odrzuci,
  // jest błędem interfejsu, a nie ostrzeżeniem serwera.
  const assignableRoles: readonly ClubMemberRole[] = isAdmin
    ? CLUB_MEMBER_ROLES
    : (["member", "observer"] as const);

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

  const rows = membersQ.data?.rows ?? [];
  const total = membersQ.data?.total ?? 0;
  const signal = signalQ.data ?? null;
  // Twarze przychodzą tą samą regułą widoczności profilu, co lista członków
  // (`discoverable OR can_manage OR ja`), więc mapa pokrywa dokładnie te
  // wiersze, które są na ekranie - i nie ma osób z kropką bez wiersza.
  const activeIds = new Set(
    (signal?.faces ?? []).filter((face) => face.isActive).map((face) => face.userId),
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 h-8 px-2">
        <Link to="/club/$clubSlug" params={{ clubSlug }}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {pickLocalized(club, "name", lang)}
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

      {/* SYGNAŁ SKŁADU: cztery liczby o LUDZIACH. Iskra aktywności stała tu do
          A34 i wypadła razem z tą samą iskrą w szynie - wykres odpowiadał na
          pytanie o wolumen ruchu, a ta strona jest o tym, kto należy i kto tu
          bywa. Twarze niosą wiersze listy niżej, więc rząd awatarów byłby
          tu powtórzeniem, a nie informacją. */}
      {canSee && signal !== null ? (
        <section className="mb-5 rounded-lg border border-border/60 bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
              <ClubSignalMetric
                icon={Users2}
                value={formatNumber(signal.membersTotal, locale)}
                label={t("club.network.roster.total")}
              />
              <ClubSignalMetric
                icon={Activity}
                value={formatNumber(signal.active24h, locale)}
                label={t("club.network.roster.active24h")}
                emphasis={signal.active24h > 0}
              />
              <ClubSignalMetric
                icon={CalendarClock}
                value={formatNumber(signal.active7d, locale)}
                label={t("club.network.roster.active7d")}
              />
              <ClubSignalMetric
                icon={CalendarPlus}
                value={formatNumber(signal.new7d, locale)}
                label={t("club.network.roster.new7d")}
                emphasis={signal.new7d > 0}
              />
            </div>
            {/* Szereg aktywności wycofany w A34 - skład mówi twarzami. */}
          </div>

          {/* Kompetencje mają własny ekran - tam są filtrem i wyszukiwarką,
              a nie ozdobą przy nazwisku. Skład odpowiada na "kto należy",
              katalog na "kto się na czym zna". */}
          <Button asChild variant="outline" size="sm" className="mt-4 rounded-lg">
            <Link to="/club/$clubSlug/experts" params={{ clubSlug }}>
              <GraduationCap className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t("club.network.roster.toExperts")}
            </Link>
          </Button>
        </section>
      ) : null}

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
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-busy="true">
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
          {canManage ? (
            <p className="mb-3 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              {t("club.roster.manageHint")}
            </p>
          ) : null}

          <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {rows.map((row) => {
              const body = (
                <>
                  <ClubPresenceAvatar
                    name={row.display_name}
                    avatarUrl={row.avatar_url}
                    active={activeIds.has(row.user_id)}
                    size="md"
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
                          {t(`club.role.${asRole(row.role)}`)}
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

              // Zmiana WŁASNEJ roli nie ma sensu i jest jedyną, która mogłaby
              // odebrać prowadzącemu dostęp do tej kontrolki - stąd wyjątek.
              const editable = canManage && row.user_id !== user?.id;

              return (
                <li key={row.user_id} className="space-y-1.5">
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
                  {editable ? (
                    <ClubEnumSelect
                      label={t("club.roster.roleLabel")}
                      value={asRole(row.role)}
                      options={assignableRoles}
                      i18nPrefix="club.role"
                      disabled={setRoleM.isPending}
                      onChange={(role) =>
                        setRoleM.mutate(
                          { userId: row.user_id, role },
                          {
                            onSuccess: () => toast.success(t("club.roster.roleChanged")),
                            onError: () => toast.error(t("club.roster.roleFailed")),
                          },
                        )
                      }
                    />
                  ) : null}
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
