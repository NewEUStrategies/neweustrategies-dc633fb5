// /club/$clubSlug - hub klubu.
//
// CZYM TO JEST. Nie listą wątków z filtrami nad nią, tylko HUBEM INTEGRACJI
// DYSKUSJI: jednym strumieniem, w którym rozmowa (wątki) miesza się
// z kontekstem, w jakim się toczy (nadchodzące terminy, świeże materiały,
// bieżący etap prac), i dwiema szynami - nawigacją klubu po lewej i pulsem
// po prawej. Poprzednia wersja tej trasy była płaską listą tytułów pod rzędem
// siedmiu przycisków; cała logika układu żyje teraz w `ClubHub`, a tutaj
// zostaje wyłącznie to, co należy do TRASY: indeksowalność, granice błędu
// i rozstrzygnięcie dostępu.
//
// Indeksowalność jest WARUNKOWA i liczona z widoczności klubu: tylko klub
// `public` dostaje indeks, reszta `noindex,nofollow`. To ta sama doktryna,
// co warunkowy noindex na /author/$slug - klub prywatny nie może wypłynąć
// przez wyszukiwarkę, nawet gdyby ktoś trafił na URL.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MessagesSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClubDetailSkeleton } from "@/components/clubs/atoms/ClubSkeletons";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubAccessGate } from "@/components/clubs/organisms/ClubAccessGate";
import { ClubHub } from "@/components/clubs/organisms/ClubHub";

import { useClubBySlug } from "@/lib/clubs/useClubs";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/api";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { ensureClubI18n } from "@/lib/i18n-club";

// `?tag=` to segmentacja wątków przez #tagi w treści: klik w tag w dowolnym
// wpisie zawęża strumień klubu do tej frazy. Trzymamy to w URL-u, bo taki
// widok ma być linkowalny (i wracalny przyciskiem wstecz).
interface ClubHubSearch {
  tag?: string;
}

export const Route = createFileRoute("/club/$clubSlug/")({
  validateSearch: (raw: Record<string, unknown>): ClubHubSearch => ({
    ...(typeof raw.tag === "string" && raw.tag !== "" ? { tag: raw.tag.slice(0, 50) } : {}),
  }),
  // Indeksowalność liczy się z WIDOCZNOŚCI klubu, a head() jest synchroniczne -
  // stąd loader. Klub `public` jest jedyną powierzchnią modułu, która ma
  // dowozić ruch z wyszukiwarek (V1 §5.1).
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
      fallbackPath: `/club/${params.clubSlug}`,
      club: loaderData?.club ?? null,
    }),
  component: ClubHubRoute,
});

const SHELL = "mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8";

function ClubHubRoute() {
  ensureClubI18n();
  const { t } = useTranslation();
  const { clubSlug } = Route.useParams();

  const clubQ = useClubBySlug(clubSlug);
  const club = clubQ.data ?? null;

  // Skeleton ma KSZTAŁT huba, więc dojście danych nie przebudowuje układu.
  if (clubQ.isPending) {
    return (
      <div className={`${SHELL} py-6`}>
        <ClubDetailSkeleton />
      </div>
    );
  }

  // Awaria RPC to NIE jest 404. Zero wierszy znaczy "nie ma czego pokazać"
  // (klub `secret` bez dostępu nie ma prawa zdradzić, że istnieje), a błąd
  // sieci albo bazy ma powiedzieć, że problem jest po naszej stronie -
  // inaczej użytkownik z poprawnym linkiem dowiaduje się, że klub nie istnieje.
  if (clubQ.isError) {
    return (
      <div className={`${SHELL} py-12`}>
        <ClubErrorNotice onRetry={() => void clubQ.refetch()} />
      </div>
    );
  }

  if (club === null) {
    return (
      <div className={`${SHELL} py-12`}>
        <Card className="rounded-lg">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <MessagesSquare className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t("club.reason.not_found")}</p>
            <Button asChild variant="outline" size="sm" className="rounded-lg">
              <Link to="/club">{t("club.title")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Karta klubu zamkniętego jest widoczna, treść nie - to jest sens tej
  // widoczności. Bramka nie tłumaczy się z odmowy, tylko pokazuje wartość
  // klubu i drogę do środka (rejestracja albo podniesienie planu).
  if (!club.can_read) {
    return (
      <div className={`${SHELL} py-8`}>
        <ClubAccessGate club={club} />
      </div>
    );
  }

  return <ClubHub club={club} />;
}
