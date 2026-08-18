// /club/$clubSlug/documents - biblioteka klubu.
//
// Indeksowalność jest WARUNKOWA i liczona z widoczności klubu, tak samo jak na
// liście wątków: biblioteka klubu `public` jest treścią, która ma prawo dowozić
// ruch, a biblioteka klubu zamkniętego nie może wypłynąć przez wyszukiwarkę.
// Rozstrzyga to `buildClubHead` na podstawie danych z loadera - trasa niczego
// tu nie zgaduje.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubDocumentLibrary } from "@/components/clubs/organisms/ClubDocumentLibrary";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/publicClub";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/documents")({
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
      fallbackPath: `/club/${params.clubSlug}/documents`,
      club: loaderData?.club ?? null,
    }),
  component: ClubDocumentsRoute,
});

function ClubDocumentsRoute() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { clubSlug } = Route.useParams();

  return (
    <ClubWorkspaceLayout
      clubSlug={clubSlug}
      title={t("club.docs.title")}
      lead={t("club.docs.lead")}
    >
      {(club) => <ClubDocumentLibrary clubId={club.id} clubSlug={clubSlug} />}
    </ClubWorkspaceLayout>
  );
}
