// Powłoka każdej powierzchni przestrzeni roboczej klubu.
//
// PO CO. Cztery nowe trasy (biblioteka, kalendarz, harmonogram, pomiar)
// odpowiadają na ten sam zestaw pytań przed narysowaniem czegokolwiek: czy
// klub istnieje, czy wołający ma prawo czytać, czy dane jeszcze lecą, co
// pokazać przy awarii RPC. Cztery kopie tej odpowiedzi rozjechałyby się przy
// pierwszej zmianie - dokładnie tak, jak rozjechała się reguła autora, zanim
// dostała wspólne `toAuthorLabel`.
//
// GRANICE SĄ TE SAME, CO NA LIŚCIE WĄTKÓW i to jest celowe:
//   * awaria RPC to NIE 404 - użytkownik z poprawnym linkiem ma się dowiedzieć,
//     że problem jest po naszej stronie,
//   * zero wierszy z `club_view` to 404, nie 403 - klub `secret` bez dostępu
//     nie ma prawa zdradzić, że istnieje,
//   * `can_read = false` pokazuje wizytówkę i powód, nie pustą listę.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ClubCover } from "@/components/clubs/atoms/ClubCover";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
// Ta sama nawigacja, co w hubie. Wcześniej stały tu dwie różne kontrolki
// (pigułki na podstronach, szyna w hubie), więc ten sam zestaw sekcji miał
// dwa kształty i dwa promienie - a użytkownik nie ma powodu domyślać się,
// że to jest ta sama nawigacja.
import { ClubHubSectionBar, ClubWorkspaceRail } from "@/components/clubs/molecules/ClubHubRail";
import { ClubDetailSkeleton } from "@/components/clubs/atoms/ClubSkeletons";
import { useClubBySlug } from "@/lib/clubs/useClubs";
import type { ClubViewRow } from "@/lib/clubs/types";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { uiLang } from "@/lib/i18n/format";

/** Jedna szerokość i jeden rytm marginesów dla całego modułu klubów. */
const SHELL = "mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-6";

export function ClubWorkspaceLayout({
  clubSlug,
  title,
  lead,
  actions,
  children,
}: {
  clubSlug: string;
  /** Tytuł POWIERZCHNI (np. "Biblioteka"), nie klubu - nazwa klubu stoi wyżej. */
  title: string;
  lead?: string;
  actions?: ReactNode;
  children: (club: ClubViewRow) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const clubQ = useClubBySlug(clubSlug);
  const club = clubQ.data ?? null;

  if (clubQ.isPending) {
    return (
      <div className={SHELL}>
        <ClubDetailSkeleton />
      </div>
    );
  }

  if (clubQ.isError) {
    return (
      <div className={SHELL}>
        <ClubErrorNotice onRetry={() => void clubQ.refetch()} />
      </div>
    );
  }

  if (club === null) {
    return (
      <div className={SHELL}>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <MessagesSquare className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t("club.reason.not_found")}</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/club">{t("club.title")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const name = pickLocalized(club, "name", lang);

  // Karta klubu zamkniętego jest widoczna, treść nie - to jest sens tej
  // widoczności. Powód i akcja zamiast pustej biblioteki.
  if (!club.can_read) {
    return (
      <div className={SHELL}>
        <Card className="overflow-hidden">
          <ClubCover
            url={club.cover_image_url}
            variant="banner"
            className="rounded-none border-0"
          />
          <CardContent className="space-y-4 p-8 text-center">
            <h1 className="text-2xl font-semibold">{name}</h1>
            <p className="text-sm text-muted-foreground">
              {club.reason ? t(`club.reason.${club.reason}`) : t("club.reason.not_member")}
            </p>
            {club.join_policy !== "invite" ? (
              <Button asChild>
                <Link to="/club/$clubSlug/about" params={{ clubSlug }}>
                  {club.join_policy === "open" ? t("club.join") : t("club.requestJoin")}
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={SHELL}>
      {/* Dwie kolumny, dokładnie jak w hubie: szyna sekcji stoi w tym samym
          miejscu na każdej powierzchni klubu, więc nawigacja nie „przeskakuje"
          między stroną klubu a jego podstroną. Poniżej `lg` szyna znika, a jej
          lista wraca jako pasek nad treścią. */}
      <div className="grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1 [scrollbar-width:thin]">
          <ClubWorkspaceRail club={club} />
        </aside>

        <main className="min-w-0">
          <ClubHubSectionBar
            clubSlug={clubSlug}
            canSeeMembers={club.can_see_members}
            className="mb-3 lg:hidden"
          />

          <header className="mb-4 rounded-lg border border-border/60 bg-card p-4 sm:p-5">
            {/* Nazwa klubu jako nadtytuł i link: powierzchnia robocza jest
                WEWNĄTRZ klubu, więc droga powrotna musi być widoczna bez
                szukania przycisku "wstecz". */}
            <Link
              to="/club/$clubSlug"
              params={{ clubSlug }}
              className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              {name}
            </Link>
            <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold leading-tight sm:text-2xl">{title}</h1>
                {lead !== undefined && lead !== "" ? (
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{lead}</p>
                ) : null}
              </div>
              {actions !== undefined ? (
                <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
              ) : null}
            </div>
          </header>

          {children(club)}
        </main>
      </div>
    </div>
  );
}
