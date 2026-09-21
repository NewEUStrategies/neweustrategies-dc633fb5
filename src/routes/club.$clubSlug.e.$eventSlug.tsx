// /club/$clubSlug/e/$eventSlug - jedno spotkanie klubu.
//
// SEGMENT `e`, nie `event`: ta sama konwencja, co `t` przy wątku
// (`/club/$clubSlug/t/$threadSlug`). Krótki segment jest tu wyborem
// SPÓJNOŚCI, a nie oszczędności znaków - dwa byty tej samej klasy (rozmowa
// i spotkanie) mają mieć adresy tego samego kształtu.
//
// `noindex` bezwarunkowo: strona wypisuje z nazwiska ludzi, którzy zadeklarowali
// obecność na spotkaniu klubu. Kalendarz publiczny to co innego niż lista
// nazwisk - ta sama doktryna, co przy składzie.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubMeetingScreen } from "@/components/clubs/organisms/ClubMeetingScreen";
import { useAuth } from "@/hooks/useAuth";
import { buildClubHead, clubHeadLoader } from "@/lib/clubs/clubHead";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/e/$eventSlug")({
  // Kartę klubu czyta RAZ loader UKŁADU `/club/$clubSlug`; tutaj zostaje sam
  // odczyt z cache'u na potrzeby nagłówka - zero round-tripów (F09).
  loader: ({ context, params, parentMatchPromise }) =>
    clubHeadLoader(context.queryClient, params.clubSlug, parentMatchPromise),
  head: ({ loaderData, params }) =>
    buildClubHead({
      fallbackPath: `/club/${params.clubSlug}/e/${params.eventSlug}`,
      club: loaderData?.club ?? null,
      forceNoindex: true,
    }),
  component: ClubMeetingRoute,
});

function ClubMeetingRoute() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { clubSlug, eventSlug } = Route.useParams();
  const { session } = useAuth();

  return (
    <ClubWorkspaceLayout
      clubSlug={clubSlug}
      title={t("club.network.meeting.pageTitle")}
      lead={t("club.network.meeting.lead")}
    >
      {(club) => (
        <ClubMeetingScreen
          clubId={club.id}
          clubSlug={clubSlug}
          eventSlug={eventSlug}
          canRsvp={session !== null && club.can_reply}
          // `can_see_members` to w bazie dokladnie `can_read`, wiec w klubie
          // `public` przepuszcza takze NIEZALOGOWANEGO - a RPC z nazwiskami
          // jest dla `anon` zamkniete. Bez tego warunku strona probowalaby
          // pobrac liste, dostawala 42501 i pokazywala "nikt nie potwierdzil",
          // czyli klamala o pustym spotkaniu.
          canSeeMembers={session !== null && club.can_see_members}
        />
      )}
    </ClubWorkspaceLayout>
  );
}
