// Gotowość kanału podcastowego do zgłoszenia w Apple Podcasts Connect.
//
// Powód istnienia: braki, które Apple traktuje jako blokujące, wychodziły dotąd
// dopiero w ich walidatorze - po zgłoszeniu, bez wskazania czego brakuje w
// naszym panelu. `podcastFeedReadiness` liczy to samo, co emituje builder RSS,
// więc redakcja widzi listę braków ZANIM wyśle kanał.
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { PodcastFeedReadiness } from "@/lib/seo/podcastFeedReadiness";

interface Props {
  readiness: PodcastFeedReadiness;
}

export function PodcastFeedReadinessCard({ readiness }: Props): React.ReactElement {
  const { t } = useTranslation();
  const { ready, blocking, warnings } = readiness;

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

      {ready && blocking.length === 0 && (
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
            {blocking.map((code) => (
              <li key={code}>{t(`adminPodcasts.settings.apple.blocking.${code}`)}</li>
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
            {warnings.map((code) => (
              <li key={code}>{t(`adminPodcasts.settings.apple.warnings.${code}`)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
