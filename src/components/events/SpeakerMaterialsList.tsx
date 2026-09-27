// Materiały prelegenta w dialogu profilu na stronie wydarzenia.
//
// POKAZUJE TO, CO ORGANIZATOR OPUBLIKOWAŁ. Baza (`event_speaker_materials_public`)
// oddaje wyłącznie materiały opublikowane, osób z listy prelegentów, w zakresie
// widoczności widza (materiał „dla zapisanych" tylko przy zatwierdzonym zapisie).
// Ten komponent niczego nie filtruje po widoczności - wybiera tylko materiały
// TEJ osoby z listy całego wydarzenia (jedno zapytanie na wydarzenie, wspólne
// dla wszystkich dialogów).
//
// NIC NIE RYSUJE, GDY NIE MA CZEGO POKAZAĆ (wczytywanie, brak materiałów) -
// dialog profilu nie dostaje pustego nagłówka. Błąd mówi o sobie jednym zdaniem,
// zamiast udawać, że materiałów nie ma.
//
// ADRES OTWIERA SIĘ W NOWEJ KARCIE Z `noopener noreferrer nofollow`: to adres
// wpisany przez prelegenta, nie może dostać dostępu do okna strony.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { localizedPair, type SpeakerMaterialKind } from "@/lib/events/cfpEnums";
import { publicSpeakerMaterialsQueryOptions } from "@/lib/events/speakerMaterialsPublic";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import { ExternalLink } from "@/lib/lucide-shim";

const KIND_LABEL_KEYS: Record<SpeakerMaterialKind, string> = {
  slides: "eventFront.speakers.materials.kinds.slides",
  document: "eventFront.speakers.materials.kinds.document",
  video: "eventFront.speakers.materials.kinds.video",
  link: "eventFront.speakers.materials.kinds.link",
};

export function SpeakerMaterialsList({
  eventId,
  speakerProfileId,
  lang,
}: {
  eventId: string;
  speakerProfileId: string;
  lang: "pl" | "en";
}) {
  ensureEventFrontI18n();
  const { t } = useTranslation();
  const { user } = useAuth();
  const materialsQ = useQuery(publicSpeakerMaterialsQueryOptions(eventId, user?.id ?? null));

  if (materialsQ.isError) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        {t("eventFront.speakers.materials.loadFailed", { lng: lang })}
      </p>
    );
  }
  const mine = (materialsQ.data ?? []).filter(
    (material) => material.speakerProfileId === speakerProfileId,
  );
  if (mine.length === 0) return null;

  return (
    <section className="space-y-2" aria-labelledby={`speaker-materials-${speakerProfileId}`}>
      <h4
        id={`speaker-materials-${speakerProfileId}`}
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {t("eventFront.speakers.materials.heading", { lng: lang })}
      </h4>
      <ul className="space-y-1.5">
        {mine.map((material) => (
          <li key={material.id}>
            <a
              href={material.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="group/mat flex items-start gap-2.5 rounded-[6px] border border-border/60 bg-background p-2.5 text-sm transition-colors hover:border-[color:var(--speakers-accent,var(--brand))]/50"
            >
              <ExternalLink
                aria-hidden
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover/mat:text-brand-ink"
              />
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">
                  {localizedPair(lang, material.titlePl, material.titleEn)}
                </span>
                <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span>{t(KIND_LABEL_KEYS[material.kind], { lng: lang })}</span>
                  {material.registeredOnly ? (
                    <span>{t("eventFront.speakers.materials.registeredOnly", { lng: lang })}</span>
                  ) : null}
                  <span className="sr-only">
                    {t("eventFront.speakers.card.opensInNewTab", { lng: lang })}
                  </span>
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
