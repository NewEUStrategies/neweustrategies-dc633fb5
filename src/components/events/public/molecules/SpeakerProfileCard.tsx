// Redakcyjna karta prelegenta wspólna dla strony publicznej i podglądu studia.
// Karta pokazuje pełny portret oraz rozdziela stanowisko od instytucji. Jeżeli
// profil ma treść, cały główny obszar otwiera wspólny dialog profilu.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { AppLink } from "@/components/atoms/AppLink";
import { SpeakerExpertBadge } from "@/components/events/SpeakerExpertBadge";
import { SpeakerTrackChips } from "@/components/events/SpeakerTrackChips";
import { buildTransformedImageUrl } from "@/lib/cropSizes";
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import { speakerHasProfileToShow } from "@/lib/builder/speakerRow";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { speakerCardAction, speakerCardPhoto, speakerOrganizationLine } from "@/lib/events/speakerCard";

const PREVIEW_MARKER = '[data-builder-renderer="widget-props-preview"]';
/** Zdjęcie jest KWADRATOWE - jedna miara na szerokość i wysokość kadru. */
const PORTRAIT_WIDTH = 480;
const PORTRAIT_HEIGHT = 480;
/** Zachowany eksport kontraktu dla konsumentów mierzących koszt obrazu karty. */
export const SPEAKER_CARD_LARGE_PX = PORTRAIT_HEIGHT;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toLocaleUpperCase("pl-PL") || "?";
}

function Portrait({ name, source }: { name: string; source: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url =
    source === null
      ? null
      : buildTransformedImageUrl(source, {
          width: PORTRAIT_WIDTH,
          height: PORTRAIT_HEIGHT,
          resize: "cover",
        });

  return (
    <span className="relative block aspect-square w-28 shrink-0 sm:w-32">
      {/* Rogi 6 px są na PUDLE kadru, a nie na obrazie - inicjały zastępcze
          dostają ten sam obrys, co zdjęcie, więc podmiana jest niezauważalna. */}
      <span className="relative grid size-full place-items-center overflow-hidden rounded-[6px] bg-muted text-xl font-semibold text-muted-foreground">
        {url !== null && failedUrl !== url ? (
          <img
            src={url}
            alt=""
            aria-hidden="true"
            width={PORTRAIT_WIDTH}
            height={PORTRAIT_HEIGHT}
            loading="lazy"
            decoding="async"
            onError={() => setFailedUrl(url)}
            className="size-full object-cover transition duration-500 group-hover/speaker:brightness-95 group-focus-visible/speaker:brightness-95 motion-reduce:transition-none"
          />
        ) : (
          <span aria-hidden="true">{initials(name)}</span>
        )}
      </span>
    </span>
  );
}

function CardBody({ speaker, lang }: { speaker: PublicSpeakerRow; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const name = speaker.display_name?.trim() ?? "";
  const role = pickLocalized(speaker, "headline", lang, speaker.job_title ?? "");
  const organization = speakerOrganizationLine(role, speaker.company) ?? "";
  const tracks = speaker.tracks ?? [];

  return (
    <>
      <Portrait name={name} source={speakerCardPhoto(speaker)} />
      <span className="flex min-w-0 flex-1 flex-col pt-1 text-left">
        <span className="text-xl font-bold leading-tight text-foreground sm:text-2xl">{name}</span>
        <span className="mt-4 space-y-3">
          {role !== "" ? (
            <span className="block">
              <span className="block text-[10px] font-extrabold uppercase text-muted-foreground">
                {t("eventFront.speakers.card.positionLabel", { lng: lang })}
              </span>
              <span title={role} className="mt-1 block text-sm font-semibold leading-snug text-foreground">
                {role}
              </span>
            </span>
          ) : null}
          {organization !== "" ? (
            <span className="block">
              <span className="block text-[10px] font-extrabold uppercase text-muted-foreground">
                {t("eventFront.speakers.card.organizationLabel", { lng: lang })}
              </span>
              <span title={organization} className="mt-1 block text-sm font-normal leading-snug text-muted-foreground">
                {organization}
              </span>
            </span>
          ) : null}
        </span>
        {(speaker.is_expert || tracks.length > 0) && (
          <span className="mt-auto flex flex-wrap items-center gap-2 pt-5">
            {speaker.is_expert ? <SpeakerExpertBadge lang={lang} /> : null}
            <SpeakerTrackChips tracks={tracks} lang={lang} />
          </span>
        )}
      </span>
    </>
  );
}

export function SpeakerProfileCard({
  speaker,
  lang,
  onSelect,
}: {
  speaker: PublicSpeakerRow;
  lang: "pl" | "en";
  onSelect?: (speaker: PublicSpeakerRow) => void;
}) {
  const { t } = useTranslation();
  const name = speaker.display_name?.trim() ?? "";
  const canOpenProfile = onSelect !== undefined && speakerHasProfileToShow(speaker);
  const action = speakerCardAction(speaker, lang, false);
  const content = <CardBody speaker={speaker} lang={lang} />;
  let main: ReactNode = (
    <div className="group/speaker flex h-full w-full gap-7 px-2 py-3 sm:gap-9">{content}</div>
  );

  if (canOpenProfile) {
    main = (
      <Button
        type="button"
        variant="ghost"
        onClick={() => onSelect(speaker)}
        aria-label={t("eventFront.speakers.card.openProfile", { name, lng: lang })}
        className="group/speaker h-full min-h-52 w-full items-stretch justify-start gap-7 whitespace-normal rounded-none px-2 py-3 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 sm:gap-9"
      >
        {content}
      </Button>
    );
  }

  return (
    <article className="relative flex h-full min-w-0 flex-col border-b border-border bg-background py-5">
      {main}
      {action?.kind === "link" ? (
        action.external ? (
          <a
            href={action.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              if (event.currentTarget.closest(PREVIEW_MARKER)) event.preventDefault();
            }}
            className="ml-37 mt-1 w-fit text-xs font-semibold text-brand-ink underline-offset-4 hover:underline sm:ml-43"
          >
            {action.label ?? t("eventFront.speakers.card.linkAction", { lng: lang })}
            <span className="sr-only"> {t("eventFront.speakers.card.opensInNewTab", { lng: lang })}</span>
          </a>
        ) : (
          <AppLink
            href={action.href}
            className="ml-37 mt-1 w-fit text-xs font-semibold text-brand-ink underline-offset-4 hover:underline sm:ml-43"
          >
            {action.label ?? t("eventFront.speakers.card.linkAction", { lng: lang })}
          </AppLink>
        )
      ) : null}
    </article>
  );
}