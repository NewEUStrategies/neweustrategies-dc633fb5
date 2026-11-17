// /club/$clubSlug/board - tablica ogłoszeń "Szukam / Oferuję".
//
// `noindex` BEZWARUNKOWO, także w klubie `public`. Ogłoszenia członków są
// prośbami skierowanymi do wnętrza klubu ("szukam kontaktu w MON") i mają
// jedną cechę, której nie ma żadna inna powierzchnia tego modułu: wskazują
// KONKRETNĄ osobę razem z tym, czego jej brakuje. Wypuszczenie tego do
// wyszukiwarki zamienia mechanizm sieciujący w źródło leadów dla obcych -
// ta sama doktryna, co przy składzie klubu i /people.
//
// GOŚĆ DOSTAJE KARTĘ LOGOWANIA, NIE EKRAN. `club_board_notices_list` nie ma
// EXECUTE dla `anon`, a kafelek tablicy stoi w szynie także dla gościa - który
// dostawał komunikat awarii z ponowieniem kończącym się tym samym 42501.
// Trzy stany czytelnika (`useClubViewer`): dopóki nie wiadomo, kto czyta
// (SSR, pierwszy render klienta, sesja w drodze), stoi ekran z WYŁĄCZONYM
// zapytaniem - ten sam szkielet, który serwer zawsze tu rysował, więc członek
// nie widzi mignięcia karty dla gościa; gość dostaje kartę, członek ekran.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubBoardScreen } from "@/components/clubs/organisms/ClubBoardScreen";
import { ClubMembersOnlyCard } from "@/components/clubs/molecules/ClubGuestCards";
import { useClubViewer } from "@/lib/clubs/useClubViewer";
import { buildClubHead } from "@/lib/clubs/clubHead";
import { clubHeadLoader } from "@/lib/clubs/clubHeadLoader";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/board")({
  // Kartę klubu czyta RAZ loader UKŁADU `/club/$clubSlug`; tutaj zostaje sam
  // odczyt z cache'u na potrzeby nagłówka - zero round-tripów (F09).
  loader: ({ context, params, parentMatchPromise }) =>
    clubHeadLoader(context.queryClient, params.clubSlug, parentMatchPromise),
  head: ({ loaderData, params }) =>
    buildClubHead({
      fallbackPath: `/club/${params.clubSlug}/board`,
      club: loaderData?.club ?? null,
      forceNoindex: true,
    }),
  component: ClubBoardRoute,
});

function ClubBoardRoute() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { clubSlug } = Route.useParams();
  const viewer = useClubViewer();

  return (
    <ClubWorkspaceLayout
      clubSlug={clubSlug}
      title={t("club.network.board.title")}
      lead={t("club.network.board.lead")}
    >
      {(club) =>
        viewer === "guest" ? (
          <ClubMembersOnlyCard />
        ) : (
          <ClubBoardScreen
            clubId={club.id}
            canPost={viewer === "signedIn" && club.can_reply}
            enabled={viewer === "signedIn"}
          />
        )
      }
    </ClubWorkspaceLayout>
  );
}
