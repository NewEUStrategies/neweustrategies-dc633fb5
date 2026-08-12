// Nawigacja po obszarach tematycznych - wejscie do klubow "per tematyka".
//
// Obszary NIE sa listowane z calego katalogu. Pokazujemy wylacznie te, w
// ktorych faktycznie stoi jakis klub, i piszemy przy nich liczbe. Pusta
// zakladka, ktora po kliknieciu daje pusty ekran, to obietnica bez pokrycia.
//
// Wyglad chipa pochodzi z atomu `ClubTopicChip` - ten sam ksztalt, ta sama
// skala i te same kolory co chipy w klubie i w watku.
import { useMemo } from "react";
import { uiLang } from "@/lib/i18n/format";
import { useTranslation } from "react-i18next";
import { topicLabel } from "@/lib/clubs/topicCatalog";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import { countClubTopics } from "@/lib/clubs/topics";
import { ClubTopicFilterChip } from "@/components/clubs/atoms/ClubTopicChip";

export function ClubTopicNav({
  clubs,
  value,
  onChange,
}: {
  clubs: readonly { policy_area: string | null }[];
  value: string | null;
  onChange: (area: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const { topics: catalog } = useClubTopics();
  const topics = useMemo(() => countClubTopics(clubs), [clubs]);

  // Jedna tematyka to nie jest wybor - pasek z jednym przyciskiem tylko
  // zabiera miejsce nad trescia.
  if (topics.length < 2) return null;

  const lang = uiLang(i18n.language);

  return (
    <nav aria-label={t("club.hub.topicsLabel")} className="-mx-4 overflow-x-auto px-4 pb-1">
      <ul className="flex w-max min-w-full gap-2">
        <li>
          <ClubTopicFilterChip active={value === null} onClick={() => onChange(null)}>
            {t("club.hub.allTopics")}
            <Count n={clubs.length} />
          </ClubTopicFilterChip>
        </li>
        {topics.map((topic) => (
          <li key={topic.area}>
            <ClubTopicFilterChip
              active={value === topic.area}
              onClick={() => onChange(value === topic.area ? null : topic.area)}
            >
              {topicLabel(topic.area, lang, catalog)}
              <Count n={topic.count} />
            </ClubTopicFilterChip>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Count({ n }: { n: number }) {
  return <span className="text-[10px] opacity-70">{n}</span>;
}
