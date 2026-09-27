// Molekuła: odnośniki „Panel prelegenta" i „Panel recenzenta" w panelu
// uczestnika wydarzenia (`/events/<slug>/me`).
//
// TYLKO DLA TYCH, KTÓRYCH TO DOTYCZY. Link do panelu prelegenta pokazujemy
// osobie, która ma zgłoszenie, wpis w rejestrze prelegentów albo wystąpienie;
// link do panelu recenzenta - aktywnemu recenzentowi naboru. Uczestnik bez
// żadnej z tych ról nie dostaje ani jednego napisu więcej.
//
// ŹRÓDŁO TO TEN SAM ODCZYT, CO PANEL PRELEGENTA (`event_my_speaker_panel`),
// więc wejście w panel po kliknięciu nie pyta bazy drugi raz.
//
// LEKKA Z ZAMIARU: napisy są w słowniku frontu (`eventFront.cfp.*`, ładuje go
// powłoka), a hook z `useCfpShell` dociąga fetcher panelu `import()`-em -
// zakładka „Moje" nie niesie słownika naboru ani parserów jego stron.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useSpeakerPanel } from "@/lib/events/useCfpShell";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

export function EventMeCfpLinks({ slug, signedIn }: { slug: string; signedIn: boolean }) {
  ensureEventFrontI18n();
  const { t } = useTranslation();
  const panelQ = useSpeakerPanel(slug, signedIn);
  const panel = panelQ.data ?? null;
  if (panel === null) return null;
  const isSpeaker =
    panel.submissionsCount > 0 || panel.profile !== null || panel.sessions.length > 0;
  if (!isSpeaker && !panel.isReviewer) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {isSpeaker ? (
        <Button asChild size="sm" variant="outline" title={t("eventFront.cfp.speakerPanelHint")}>
          <Link to="/events/$slug/speaker" params={{ slug }}>
            {t("eventFront.cfp.speakerPanel")}
          </Link>
        </Button>
      ) : null}
      {panel.isReviewer ? (
        <Button asChild size="sm" variant="outline" title={t("eventFront.cfp.reviewerPanelHint")}>
          <Link to="/events/$slug/review" params={{ slug }}>
            {t("eventFront.cfp.reviewerPanel")}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
