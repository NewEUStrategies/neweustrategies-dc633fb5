// /club/$clubSlug/output - dorobek klubu.
//
// Indeksowalność jest WARUNKOWA i liczona z widoczności klubu, tak samo jak
// przy bibliotece: dorobek klubu `public` jest treścią, która ma prawo dowozić
// ruch (to są policy papers i stanowiska), a dorobek klubu zamkniętego nie
// może wypłynąć przez wyszukiwarkę. Rozstrzyga to `buildClubHead`.
//
// To jedyna z pięciu nowych tras BEZ `forceNoindex`: pozostałe cztery mówią
// o ludziach, a ta o materiałach.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ClubWorkspaceLayout } from "@/components/clubs/organisms/ClubWorkspaceLayout";
import { ClubOutputScreen } from "@/components/clubs/organisms/ClubOutputScreen";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/api";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { ensureClubI18n } from "@/lib/i18n-club";

export const Route = createFileRoute("/club/$clubSlug/output")({
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
      fallbackPath: `/club/${params.clubSlug}/output`,
      club: loaderData?.club ?? null,
    }),
  component: ClubOutputRoute,
});

function ClubOutputRoute() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const { clubSlug } = Route.useParams();

  return (
    <ClubWorkspaceLayout
      clubSlug={clubSlug}
      isPl={isPl}
      title={t("club.network.output.title")}
      lead={t("club.network.output.lead")}
    >
      {(club) => <ClubOutputScreen clubId={club.id} clubSlug={clubSlug} isPl={isPl} />}
    </ClubWorkspaceLayout>
  );
}
