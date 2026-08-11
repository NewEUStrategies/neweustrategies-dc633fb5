// Sekcja „Moje kluby" z zakładkami tematycznymi.
//
// PROBLEM. Członek kilkunastu klubów dostawał na hubie jedną, nieskończoną
// siatkę - „moje kluby" było najdłuższym blokiem strony i nie dawało się w nim
// niczego znaleźć wzrokiem, bo sąsiadowały ze sobą kluby z zupełnie różnych
// dziedzin. Katalog odkrywania ma pasek obszarów od początku; własne
// członkostwa go nie miały.
//
// ROZWIĄZANIE. Ten sam słownik obszarów, ten sam chip i ta sama skala, co
// w `ClubTopicNav` - ale liczone WYŁĄCZNIE z klubów użytkownika i z zakładką
// „Wszystkie" na przedzie, żeby dotychczasowy widok nadal był jednym
// kliknięciem. Kluby bez obszaru trafiają do „Pozostałe": nic, do czego
// użytkownik należy, nie może zniknąć z tej sekcji (`lib/clubs/myClubGroups`).
//
// Zakładek nie ma, gdy jest jedna grupa - pasek z jednym przyciskiem tylko
// zabiera miejsce nad treścią.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClubTopicFilterChip } from "@/components/clubs/atoms/ClubTopicChip";
import { ClubDirectory, type ClubDirectoryCard } from "@/components/clubs/organisms/ClubDirectory";
import { groupMyClubs, shouldTabMyClubs } from "@/lib/clubs/myClubGroups";
import { topicLabel } from "@/lib/clubs/topicCatalog";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import type { ClubLayout } from "@/lib/clubs/types";

export function MyClubsTabs({
  clubs,
  isPl,
  loading,
  layout,
}: {
  clubs: readonly ClubDirectoryCard[];
  isPl: boolean;
  loading: boolean;
  layout: ClubLayout;
}) {
  const { t } = useTranslation();
  const { topics: catalog } = useClubTopics();
  const lang = isPl ? "pl" : "en";

  const groups = useMemo(() => groupMyClubs(clubs), [clubs]);
  const tabbed = shouldTabMyClubs(groups);

  // `undefined` = zakładka „Wszystkie". Klucz obszaru trzymamy jako string,
  // `null` to grupa „Pozostałe" - stąd sentinel zamiast samego `null`.
  const [active, setActive] = useState<string | null | undefined>(undefined);

  // Zbiór klubów zmienia się (dołączenie, wyjście, refetch) - wybrana zakładka
  // musi wtedy nadal istnieć, inaczej sekcja pokazuje pustkę bez powodu.
  useEffect(() => {
    if (active === undefined) return;
    if (!groups.some((group) => group.area === active)) setActive(undefined);
  }, [groups, active]);

  const visible = useMemo(() => {
    if (active === undefined) return clubs;
    return groups.find((group) => group.area === active)?.clubs ?? [];
  }, [active, clubs, groups]);

  const label = (area: string | null): string =>
    area === null ? t("club.hub.otherTopic") : topicLabel(area, lang, catalog);

  return (
    <div id="club-mine" className="scroll-mt-28">
      {tabbed ? (
        <nav
          aria-label={t("club.hub.myTopicsLabel")}
          className="tabs-scroller -mx-4 mb-3 px-4 pb-1"
        >
          <ul className="flex w-max min-w-full gap-2">
            <li>
              <ClubTopicFilterChip
                active={active === undefined}
                onClick={() => setActive(undefined)}
              >
                {t("club.hub.allTopics")}
                <Count n={clubs.length} />
              </ClubTopicFilterChip>
            </li>
            {groups.map((group) => (
              <li key={group.area ?? "__rest__"}>
                <ClubTopicFilterChip
                  active={active === group.area}
                  onClick={() => setActive(group.area)}
                >
                  {label(group.area)}
                  <Count n={group.clubs.length} />
                </ClubTopicFilterChip>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <ClubDirectory
        title={t("club.myClubs")}
        empty={t("club.empty")}
        clubs={visible}
        isPl={isPl}
        loading={loading}
        layout={layout}
      />
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="text-[10px] opacity-70">{n}</span>;
}
