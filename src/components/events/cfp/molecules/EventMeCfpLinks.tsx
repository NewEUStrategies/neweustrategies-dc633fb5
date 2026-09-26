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
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useSpeakerPanel } from "@/lib/events/useCfpMe";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";

export function EventMeCfpLinks({ slug, signedIn }: { slug: string; signedIn: boolean }) {
  ensureEventCfpI18n();
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
        <Button asChild size="sm" variant="outline" title={t("eventCfp.me.speakerPanelHint")}>
          <Link to="/events/$slug/speaker" params={{ slug }}>
            {t("eventCfp.me.speakerPanel")}
          </Link>
        </Button>
      ) : null}
      {panel.isReviewer ? (
        <Button asChild size="sm" variant="outline" title={t("eventCfp.me.reviewerPanelHint")}>
          <Link to="/events/$slug/review" params={{ slug }}>
            {t("eventCfp.me.reviewerPanel")}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
