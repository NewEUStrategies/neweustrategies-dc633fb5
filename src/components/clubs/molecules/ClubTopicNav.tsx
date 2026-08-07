// Nawigacja po obszarach polityki - wejscie do klubow "per tematyka".
//
// Obszary NIE sa listowane ze slownika POLICY_AREAS w calosci. Pokazujemy
// wylacznie te, w ktorych faktycznie stoi jakis klub, i piszemy przy nich
// liczbe. Pusta zakladka "Migracja", ktora po klinieciu daje pusty ekran, to
// obietnica bez pokrycia - a na powierzchni odkrywania obietnica bez pokrycia
// kosztuje wiecej niz brak zakladki.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { areaLabel } from "@/lib/tracker/stages";
import { countClubTopics } from "@/lib/clubs/topics";
import { cn } from "@/lib/utils";

export function ClubTopicNav({
  clubs,
  value,
  onChange,
  isPl,
}: {
  clubs: readonly { policy_area: string | null }[];
  value: string | null;
  onChange: (area: string | null) => void;
  isPl: boolean;
}) {
  const { t } = useTranslation();
  const topics = useMemo(() => countClubTopics(clubs), [clubs]);

  // Jedna tematyka to nie jest wybor - pasek z jednym przyciskiem tylko
  // zabiera miejsce nad trescia.
  if (topics.length < 2) return null;

  const lang = isPl ? "pl" : "en";

  return (
    <nav aria-label={t("club.hub.topicsLabel")} className="-mx-4 overflow-x-auto px-4 pb-1">
      <ul className="flex w-max min-w-full gap-2">
        <li>
          <TopicChip active={value === null} onClick={() => onChange(null)}>
            {t("club.hub.allTopics")}
            <Count n={clubs.length} />
          </TopicChip>
        </li>
        {topics.map((topic) => (
          <li key={topic.area}>
            <TopicChip
              active={value === topic.area}
              onClick={() => onChange(value === topic.area ? null : topic.area)}
            >
              {areaLabel(topic.area, lang)}
              <Count n={topic.count} />
            </TopicChip>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function TopicChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/60 bg-card text-foreground hover:border-primary/40",
      )}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return <span className="text-xs opacity-70">{n}</span>;
}
