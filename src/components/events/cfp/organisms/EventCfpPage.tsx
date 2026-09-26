// Organizm: STRONA NABORU PRELEGENTÓW wydarzenia (`/events/<slug>/cfp`).
//
// DANE TYLKO PO STRONIE KLIENTA. Faza naboru zmienia się z upływem czasu
// (otwarcie, termin), a dokument publiczny bywa podawany z cache krawędzi
// godzinami. Gdyby SSR wpisał do HTML-a „nabór otwarty", strona z cache
// zapraszałaby do zgłoszeń po terminie. Dlatego zapytanie startuje dopiero po
// montażu, a SSR i pierwszy render klienta pokazują ten sam szkielet.
//
// FAZĘ LICZY BAZA (`event_cfp_public` -> `_event_cfp_phase`). Zegar
// przeglądarki służy wyłącznie odliczaniu (`CfpCountdown`).
//
// TREŚCI ORGANIZATORA TO ZWYKŁY TEKST. Wstęp i zasady renderujemy jako tekst
// z zachowaniem akapitów - bez HTML-a z bazy, więc bez powierzchni dla XSS.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CfpSignInButton } from "@/components/events/cfp/atoms/CfpSignInButton";
import { CfpCountdown } from "@/components/events/cfp/molecules/CfpCountdown";
import { useAuth } from "@/hooks/useAuth";
import { localizedPair } from "@/lib/events/cfpEnums";
import type { CfpPublic } from "@/lib/events/cfpSurface";
import { formatEventDateTime } from "@/lib/events/timezone";
import { useCfpPublic } from "@/lib/events/useCfpMe";
import { uiLang } from "@/lib/i18n/format";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";
import { useNowMs } from "@/lib/time/useNowMs";

export function EventCfpPage({ slug }: { slug: string }) {
  ensureEventCfpI18n();
  const { t } = useTranslation();
  // `useNowMs()` = `null` w SSR i pierwszym renderze - to jest bramka montażu.
  const mounted = useNowMs() !== null;
  const cfpQ = useCfpPublic(slug, mounted);
  const cfp = cfpQ.data;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold">{t("eventCfp.page.title")}</h1>
      {!mounted || cfpQ.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-5 w-2/3 rounded-[6px]" />
          <Skeleton className="h-24 w-full rounded-[6px]" />
        </div>
      ) : cfpQ.error ? (
        <p className="text-sm text-muted-foreground" role="alert">
          {t("eventCfp.common.loadFailed")}
        </p>
      ) : cfp === null || cfp === undefined || cfp.phase === "none" ? (
        <p className="text-sm text-muted-foreground">{t("eventCfp.page.unavailable")}</p>
      ) : (
        <CfpContent slug={slug} cfp={cfp} />
      )}
    </div>
  );
}

function CfpContent({ slug, cfp }: { slug: string; cfp: CfpPublic }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { session } = useAuth();
  const when = (iso: string | null) => formatEventDateTime(iso, cfp.timezone, lang);
  const intro = localizedPair(lang, cfp.introPl, cfp.introEn);
  const guidelines = localizedPair(lang, cfp.guidelinesPl, cfp.guidelinesEn);

  const phaseLine =
    cfp.phase === "scheduled"
      ? t("eventCfp.page.phase.scheduled", { date: when(cfp.opensAt) })
      : cfp.phase === "open"
        ? cfp.closesAt === null
          ? t("eventCfp.page.phase.openNoDeadline")
          : t("eventCfp.page.phase.open", { date: when(cfp.closesAt) })
        : t("eventCfp.page.phase.closed");

  return (
    <div className="space-y-6">
      <section className="space-y-2 rounded-[6px] border border-border bg-muted/30 p-4">
        <p className="text-sm">{phaseLine}</p>
        {cfp.phase === "scheduled" ? <CfpCountdown target={cfp.opensAt} mode="toOpen" /> : null}
        {cfp.phase === "open" ? <CfpCountdown target={cfp.closesAt} mode="toClose" /> : null}
        {cfp.phase === "open" ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {session ? (
              <>
                <Button asChild size="sm">
                  <Link to="/events/$slug/cfp-submit" params={{ slug }}>
                    {t("eventCfp.page.submit")}
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/events/$slug/speaker" params={{ slug }}>
                    {t("eventCfp.page.mySubmissions")}
                  </Link>
                </Button>
              </>
            ) : (
              <CfpSignInButton
                label={t("eventCfp.page.signInToSubmit")}
                title={t("eventCfp.submit.signInTitle")}
                description={t("eventCfp.submit.signInBody")}
              />
            )}
          </div>
        ) : null}
      </section>

      {intro === "" ? null : (
        <p className="whitespace-pre-line text-base leading-relaxed">{intro}</p>
      )}

      {guidelines === "" ? null : (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("eventCfp.page.guidelines")}</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed">{guidelines}</p>
        </section>
      )}

      {cfp.formats.length === 0 ? null : (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("eventCfp.page.formats")}</h2>
          <ul className="flex flex-wrap gap-2">
            {cfp.formats.map((format) => (
              <li key={format.key}>
                <Badge variant="outline">
                  {localizedPair(lang, format.labelPl, format.labelEn)} ·{" "}
                  {t("eventCfp.page.formatDuration", { count: format.durationMin })}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cfp.tracks.length === 0 ? null : (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("eventCfp.page.tracks")}</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {cfp.tracks.map((track) => (
              <li key={track.id}>{localizedPair(lang, track.namePl, track.nameEn)}</li>
            ))}
          </ul>
        </section>
      )}

      {cfp.fields.length === 0 ? null : (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("eventCfp.page.questions")}</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {cfp.fields.map((field) => (
              <li key={field.key}>{localizedPair(lang, field.labelPl, field.labelEn)}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-1 text-sm text-muted-foreground">
        <p>{t("eventCfp.page.limit", { count: cfp.maxPerSubmitter })}</p>
        {cfp.allowCoSpeakers ? <p>{t("eventCfp.page.coSpeakers")}</p> : null}
      </section>
    </div>
  );
}
