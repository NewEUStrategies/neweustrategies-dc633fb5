// Gotowość kanału podcastowego do zgłoszenia w Apple Podcasts Connect.
//
// Powód istnienia: braki, które Apple traktuje jako blokujące, wychodziły dotąd
// dopiero w ich walidatorze - po zgłoszeniu, bez wskazania czego brakuje w
// naszym panelu. Redakcja widzi listę braków ZANIM wyśle kanał.
//
// Karta jest CIENKIM RENDEREM: zero własnej walidacji i zero decyzji o tym, co
// jest brakiem. Regułę trzyma `@/lib/podcast/applePodcast` - ona rozstrzyga
// także, którą z trzech dróg wejścia policzyć (gotowa lista braków, metadane
// kanału, wynik starszej checklisty `podcastFeedReadiness`). Dzięki temu ta
// sama karta obsługuje panel sieciowy i - po podaniu `channel`/`show` - program.
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { PodcastFeedReadiness } from "@/lib/seo/podcastFeedReadiness";
import {
  applePodcastBlockingGaps,
  applePodcastWarningGaps,
  isApplePodcastSubmittable,
  resolveApplePodcastGaps,
  type ApplePodcastChannelMeta,
  type ApplePodcastGap,
  type ApplePodcastShowOverride,
} from "@/lib/podcast/applePodcast";

interface Props {
  /** Gotowa lista braków - najkrótsza droga, gdy woła je już rodzic. */
  gaps?: readonly ApplePodcastGap[] | null;
  /** Metadane kanału; karta woła regułę Apple sama. */
  channel?: ApplePodcastChannelMeta | null;
  /** Nadpisania programu - liczone tylko razem z `channel`. */
  show?: ApplePodcastShowOverride | null;
  /** Wynik `podcastFeedReadiness` - droga panelu sieciowego (kontrakt bez zmian). */
  readiness?: PodcastFeedReadiness | null;
}

export function PodcastFeedReadinessCard({
  gaps,
  channel,
  show,
  readiness,
}: Props): React.ReactElement | null {
  const { t } = useTranslation();
  // FAIL-CLOSED WOBEC BRAKU WEJŚCIA. Wszystkie cztery propsy są opcjonalne,
  // bo karta obsługuje trzy różne drogi wejścia - a to znaczy, że
  // `<PodcastFeedReadinessCard />` bez ŻADNEGO wejścia kompiluje się. Reguła
  // dla pustego wejścia zwraca zero braków, więc karta rysowałaby ZIELONĄ
  // ramkę „kanał gotowy do zgłoszenia", nie wiedząc o kanale nic. To jest
  // najgorszy możliwy stan tej karty: jej jedynym zadaniem jest wyłapać awarię
  // CICHĄ, a fałszywe „gotowe" jest właśnie awarią cichą.
  //
  // Dlatego brak wejścia to BRAK KARTY, nie karta zielona. Renderowanie
  // niczego jest tu poprawne: nie ma o czym orzekać, a rodzic, który zapomniał
  // podać dane, zobaczy dziurę w panelu zamiast fałszywej zgody.
  const hasInput = gaps != null || channel != null || readiness != null;
  if (!hasInput) return null;

  const resolved = resolveApplePodcastGaps({ gaps, channel, show, readiness });
  const blocking = applePodcastBlockingGaps(resolved);
  const warnings = applePodcastWarningGaps(resolved);
  // Gotowość liczy predykat reguły, a nie flaga z propsów - inaczej `ready`
  // niezgodne z listą braków dawało zieloną ramkę nad listą braków.
  const ready = isApplePodcastSubmittable(resolved);

  return (
    <section
      className={`grid gap-2 rounded-lg border p-4 ${
        ready
          ? "border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20"
          : "border-amber-500/50 bg-amber-50/40 dark:bg-amber-950/20"
      }`}
    >
      <div className="flex items-center gap-2">
        {ready ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
        )}
        <h3 className="text-sm font-semibold">
          {t("adminPodcasts.settings.apple.readinessTitle")}
        </h3>
      </div>

      {ready && (
        <p className="text-xs text-muted-foreground">
          {t("adminPodcasts.settings.apple.readinessOk")}
        </p>
      )}

      {blocking.length > 0 && (
        <div className="grid gap-1">
          <p className="text-xs font-medium">
            {t("adminPodcasts.settings.apple.readinessBlocking")}
          </p>
          <ul className="ml-4 list-disc text-xs text-muted-foreground">
            {blocking.map((gap) => (
              <li key={`${gap.field}:${gap.messageKey}`}>{t(gap.messageKey)}</li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="grid gap-1">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            {t("adminPodcasts.settings.apple.readinessWarnings")}
          </p>
          <ul className="ml-4 list-disc text-xs text-muted-foreground">
            {warnings.map((gap) => (
              <li key={`${gap.field}:${gap.messageKey}`}>{t(gap.messageKey)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
