// Pasek obszarów tematycznych nad strumieniem wątków - poziom "wybór tematu"
// między działem a wątkiem.
//
// PO CO TO JEST CZWARTYM POZIOMEM. Klub -> dział -> [tutaj] -> wątek. Dział
// (`club_groups`) to organizacyjna hierarchia redakcji - "Architektura
// bezpieczeństwa" i jej poddziały. Obszar (`club_threads.topic`) to PŁASKA,
// PRZEKROJOWA klasyfikacja z jednego katalogu (geopolityka, cyber, energetyka...)
// - ten sam wątek o cyberbezpieczeństwie mógłby siedzieć w dziale "Architektura
// bezpieczeństwa" albo w "Zdolności i przemysł obronny", i obszar to jedyna
// oś, która go znajdzie niezależnie od tego, gdzie redakcja go zaszufladkowała.
//
// Do tej pory ta kolumna w bazie była ustawiana raz przy zakładaniu wątku
// i odtąd niewidoczna: nie pokazywała się na wierszu, nie dało się po niej
// filtrować. Ten pasek naprawia dokładnie tę lukę.
//
// LICZNIKI SĄ CELOWO NIEZALEŻNE OD BIEŻĄCEGO ZAWĘŻENIA DZIAŁEM. Tak samo jak
// panel źródeł w prawej szynie: klub filtrowany do jednego działu i tak
// pokazuje TU liczby ze WSZYSTKICH działów, bo pytanie "ile jest wątków o tym
// obszarze w całym klubie" jest ważniejsze niż idealna zgodność z bieżącym
// zawężeniem. Kliknięcie obszaru, który w połączeniu z aktualnym działem nie
// da wyników, wylatuje w ten sam, prawdziwy komunikat "club.filters.empty" -
// a nie w obietnicę bez pokrycia.
//
// JEDEN OBSZAR TO NIE JEST WYBÓR - pasek z jednym przyciskiem tylko zabiera
// miejsce nad treścią, dokładnie jak w `ClubTopicNav` na katalogu klubów.
import { useMemo } from "react";
import { uiLang } from "@/lib/i18n/format";
import { useTranslation } from "react-i18next";
import { HUB_CONTROL, HUB_COUNT } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubTopicFilterChip } from "@/components/clubs/atoms/ClubTopicChip";
import { countThreadTopics } from "@/lib/clubs/threadTopics";
import { topicLabel, type ClubTopicOption } from "@/lib/clubs/topicCatalog";
import type { ClubThreadListRow } from "@/lib/clubs/types";

/** Licznik ma stopień pisma chipu - mniejszą wagę daje mu krycie, nie rozmiar. */
function Count({ n }: { n: number }) {
  return <span className={`${HUB_COUNT} opacity-70`}>{n}</span>;
}

export function ClubThreadTopicBar({
  threads,
  catalog,
  value,
  onChange,
  className,
}: {
  /** Wątki CAŁEGO klubu - patrz nagłówek pliku (liczniki, nie bieżące zawężenie). */
  threads: readonly ClubThreadListRow[];
  catalog: readonly ClubTopicOption[];
  value: string | null;
  onChange: (topic: string | null) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const topics = useMemo(() => countThreadTopics(threads), [threads]);

  if (topics.length < 2) return null;

  return (
    <div className={className}>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("club.topic.label")}
      </p>
      {/* Obszary zawijają się do kolejnych rzędów - przewijany pasek chował
          część katalogu za krawędzią ekranu. Chip ma wysokość kontrolki huba
          (28 px), tę samą co przełącznik źródła i filtry rodzaju obok. */}
      <nav aria-label={t("club.topic.label")}>
        <ul className="flex flex-wrap gap-1">
          <li className="max-w-full">
            <ClubTopicFilterChip
              active={value === null}
              onClick={() => onChange(null)}
              size="sm"
              className={HUB_CONTROL}
            >
              {t("club.hub.allTopics")}
              <Count n={threads.length} />
            </ClubTopicFilterChip>
          </li>
          {topics.map((topic) => (
            <li key={topic.area} className="max-w-full">
              <ClubTopicFilterChip
                active={value === topic.area}
                onClick={() => onChange(value === topic.area ? null : topic.area)}
                size="sm"
                className={HUB_CONTROL}
              >
                {topicLabel(topic.area, lang, catalog)}
                <Count n={topic.count} />
              </ClubTopicFilterChip>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
