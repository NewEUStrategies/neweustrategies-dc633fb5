// /club/$clubSlug/experts - katalog kompetencji w klubie.
//
// `noindex` bezwarunkowo: to jest lista nazwisk z przypisanymi dziedzinami,
// czyli dokładnie ten rodzaj treści, którego skład klubu nie wypuszcza do
// wyszukiwarki. Widoczność wewnątrz produktu rozstrzyga `can_see_members`
// po stronie bazy - trasa niczego tu nie zgaduje.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubExpertsScreen } from "@/components/clubs/organisms/ClubExpertsScreen";
import { useAuth } from "@/hooks/useAuth";
import { buildClubHead, clubHeadLoader } from "@/lib/clubs/clubHead";
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
  const { session } = useAuth();

  return (
    <ClubWorkspaceLayout
      clubSlug={clubSlug}
      title={t("club.network.experts.pageTitle")}
      lead={t("club.network.experts.lead")}
    >
      {(club) => (
        <ClubExpertsScreen
          clubId={club.id}
          canDeclare={session !== null && club.can_reply}
          locale={locale}
        />
      )}
    </ClubWorkspaceLayout>
  );
}
