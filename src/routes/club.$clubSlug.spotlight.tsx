// /club/$clubSlug/spotlight - "Poznaj członka" z archiwum i redakcją.
//
// `noindex` bezwarunkowo: strona jest w całości opisem konkretnej osoby wraz
// z jej dziedzinami i notką redakcyjną - ta sama doktryna, co przy składzie.
//
// GOŚĆ DOSTAJE KARTĘ UKRYTEGO SKŁADU zamiast komunikatu awarii:
// `club_member_spotlight_current` i `_history` nie mają EXECUTE dla `anon`.
// Trzy stany czytelnika jak na trasie tablicy (`useClubViewer`); zalogowany
// widzi ekran jak dotąd.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubSpotlightScreen } from "@/components/clubs/organisms/ClubSpotlightScreen";
import { ClubRosterHiddenCard } from "@/components/clubs/molecules/ClubGuestCards";
import { useClubViewer } from "@/lib/clubs/useClubViewer";
import { buildClubHead } from "@/lib/clubs/clubHead";
import { clubHeadLoader } from "@/lib/clubs/clubHeadLoader";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/spotlight")({
  // Kartę klubu czyta RAZ loader UKŁADU `/club/$clubSlug`; tutaj zostaje sam
  // odczyt z cache'u na potrzeby nagłówka - zero round-tripów (F09).
  loader: ({ context, params, parentMatchPromise }) =>
    clubHeadLoader(context.queryClient, params.clubSlug, parentMatchPromise),
  head: ({ loaderData, params }) =>
    buildClubHead({
      fallbackPath: `/club/${params.clubSlug}/spotlight`,
      club: loaderData?.club ?? null,
      forceNoindex: true,
    }),
  component: ClubSpotlightRoute,
});

function ClubSpotlightRoute() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { clubSlug } = Route.useParams();
  const viewer = useClubViewer();

  return (
    <ClubWorkspaceLayout
      clubSlug={clubSlug}
      title={t("club.network.spotlight.title")}
      lead={t("club.network.spotlight.lead")}
    >
      {(club) =>
        viewer === "guest" ? (
          <ClubRosterHiddenCard />
        ) : (
          <ClubSpotlightScreen
            clubId={club.id}
            canModerate={club.can_moderate === true}
            enabled={viewer === "signedIn"}
          />
        )
      }
    </ClubWorkspaceLayout>
  );
}
