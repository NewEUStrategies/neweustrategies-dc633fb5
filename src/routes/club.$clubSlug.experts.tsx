// /club/$clubSlug/experts - katalog kompetencji w klubie.
//
// `noindex` bezwarunkowo: to jest lista nazwisk z przypisanymi dziedzinami,
// czyli dokładnie ten rodzaj treści, którego skład klubu nie wypuszcza do
// wyszukiwarki. Widoczność wewnątrz produktu rozstrzyga `can_see_members`
// po stronie bazy - trasa niczego tu nie zgaduje.
//
// GOŚĆ DOSTAJE KARTĘ UKRYTEGO SKŁADU. `club_experts_list` i
// `club_expertise_areas` nie mają EXECUTE dla `anon`; gość z udostępnionego
// linku widział pole szukania i komunikat awarii. Teraz widzi to samo zdanie,
// co na trasie składu (`/members`). Zalogowany - bez zmian: o pustce lub
// liście nadal rozstrzyga `can_see_members` w ciele RPC. Przed rozstrzygnięciem
// sesji stoi ekran z wyłączonymi zapytaniami (szkielet z HTML-u serwera) -
// patrz trasa tablicy i `useClubViewer`.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubExpertsScreen } from "@/components/clubs/organisms/ClubExpertsScreen";
import { ClubRosterHiddenCard } from "@/components/clubs/molecules/ClubGuestCards";
import { useClubViewer } from "@/lib/clubs/useClubViewer";
import { buildClubHead } from "@/lib/clubs/clubHead";
import { clubHeadLoader } from "@/lib/clubs/clubHeadLoader";
import { uiLocale } from "@/lib/i18n/format";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/experts")({
  // Kartę klubu czyta RAZ loader UKŁADU `/club/$clubSlug`; tutaj zostaje sam
  // odczyt z cache'u na potrzeby nagłówka - zero round-tripów (F09).
  loader: ({ context, params, parentMatchPromise }) =>
    clubHeadLoader(context.queryClient, params.clubSlug, parentMatchPromise),
  head: ({ loaderData, params }) =>
    buildClubHead({
      fallbackPath: `/club/${params.clubSlug}/experts`,
      club: loaderData?.club ?? null,
      forceNoindex: true,
    }),
  component: ClubExpertsRoute,
});

function ClubExpertsRoute() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const locale = uiLocale(i18n.language);
  const { clubSlug } = Route.useParams();
  const viewer = useClubViewer();

  return (
    <ClubWorkspaceLayout
      clubSlug={clubSlug}
      title={t("club.network.experts.pageTitle")}
      lead={t("club.network.experts.lead")}
    >
      {(club) =>
        viewer === "guest" ? (
          <ClubRosterHiddenCard />
        ) : (
          <ClubExpertsScreen
            clubId={club.id}
            canDeclare={viewer === "signedIn" && club.can_reply}
            locale={locale}
            enabled={viewer === "signedIn"}
          />
        )
      }
    </ClubWorkspaceLayout>
  );
}
