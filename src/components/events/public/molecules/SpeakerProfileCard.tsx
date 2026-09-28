// Redakcyjna karta prelegenta wspólna dla strony publicznej i podglądu studia.
// Karta pokazuje pełny portret oraz rozdziela stanowisko od instytucji. Jeżeli
// profil ma treść, cały główny obszar otwiera wspólny dialog profilu.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { AppLink } from "@/components/atoms/AppLink";
import { SpeakerExpertBadge } from "@/components/events/SpeakerExpertBadge";
import { buildTransformedImageUrl } from "@/lib/cropSizes";
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import { speakerHasProfileToShow } from "@/lib/builder/speakerRow";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { speakerCardAction, speakerCardPhoto, splitSpeakerRoleInstitution } from "@/lib/events/speakerCard";

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

  // `self-start` - bez tego rozciaganie flexa karty (items-stretch) nadpisuje
  // aspect-ratio i zdjecie znow staje sie prostokatem, a nie kwadratem.
  return (
    <span className="relative block aspect-square w-28 shrink-0 self-start sm:w-32">
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

/** Logo instytucji PO LEWEJ jej nazwy - ukrywa sie, gdy plik nie wczyta sie.
 *  Wysokosc stala (h-9), szerokosc plywa z proporcji pliku, ale jest zacieta
 *  (max-w-16), wiec logo kwadratowe daje kwadrat 36 px, a prostokatne -
 *  szerszy prostokat; plik skaluje sie object-contain do tych wymiarow.
 *  Rogi 6 px sa na obrazie, zgodnie z kadrem portretu. */
function InstitutionLogo({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={url}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="block h-9 w-auto max-w-16 shrink-0 rounded-[6px] object-contain"
    />
  );
}

function CardBody({ speaker, lang }: { speaker: PublicSpeakerRow; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const name = speaker.display_name?.trim() ?? "";
  const role = pickLocalized(speaker, "headline", lang, speaker.job_title ?? "");
  // Stanowisko i instytucja OSOBNO - nawet gdy dane trzymają obie nazwy
  // w jednym polu; wycięcie robi ta sama reguła słów, co deduplikację.
  const { position, institution } = splitSpeakerRoleInstitution(role, speaker.company);
  const logoUrl = speaker.card_institution_logo_url?.trim() || null;

  const FactLine = ({ label, value, emphasized }: { label: string; value: string; emphasized: boolean }) => (
    <span className="block">
      <span className="block text-[10px] font-extrabold uppercase text-muted-foreground">{label}</span>
      <span
        title={value}
        className={
          emphasized
            ? "mt-1 block text-sm font-normal leading-snug text-foreground"
            : "mt-1 block text-sm font-normal leading-snug text-muted-foreground"
        }
      >
        {value}
      </span>
    </span>
  );

  return (
    <>
      <Portrait name={name} source={speakerCardPhoto(speaker)} />
      <span className="flex min-w-0 flex-1 flex-col pt-1 text-left">
        <span className="text-xl font-bold leading-tight text-foreground sm:text-2xl">{name}</span>
        <span className="mt-2 space-y-3">
          {position !== "" ? (
            <FactLine
              emphasized
              label={t("eventFront.speakers.card.positionLabel", { lng: lang })}
              value={position}
            />
          ) : null}
          {institution !== "" || logoUrl !== null ? (
            <span className="block">
              <span className="block text-[10px] font-extrabold uppercase text-muted-foreground">
                {t("eventFront.speakers.card.organizationLabel", { lng: lang })}
              </span>
              {/* Nazwa PO PRAWEJ logo, wycentrowana wzgledeM jego wysokosci
                  (items-center); samotne logo tez ma wiersz. */}
              <span className="mt-1 flex min-w-0 items-center gap-3">
                {logoUrl !== null ? <InstitutionLogo url={logoUrl} name={institution} /> : null}
                {institution !== "" ? (
                  <span title={institution} className="block min-w-0 text-sm font-normal leading-snug text-muted-foreground">
                    {institution}
                  </span>
                ) : null}
              </span>
            </span>
          ) : null}
        </span>
        {speaker.is_expert ? (
          <span className="mt-auto flex flex-wrap items-center gap-2 pt-5">
            <SpeakerExpertBadge lang={lang} />
          </span>
        ) : null}
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
    <div className="group/speaker flex h-full w-full gap-5 px-2 py-3 sm:gap-6">{content}</div>
  );

  if (canOpenProfile) {
    main = (
      <Button
        type="button"
        variant="ghost"
        onClick={() => onSelect(speaker)}
        aria-label={t("eventFront.speakers.card.openProfile", { name, lng: lang })}
        className="group/speaker h-full min-h-52 w-full items-stretch justify-start gap-5 whitespace-normal rounded-none px-2 py-3 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 sm:gap-6"
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
            className="ml-37 mt-1 w-fit text-xs font-semibold text-brand-ink underline-offset-4 hover:underline sm:ml-42"
          >
            {action.label ?? t("eventFront.speakers.card.linkAction", { lng: lang })}
            <span className="sr-only"> {t("eventFront.speakers.card.opensInNewTab", { lng: lang })}</span>
          </a>
        ) : (
          <AppLink
            href={action.href}
            className="ml-37 mt-1 w-fit text-xs font-semibold text-brand-ink underline-offset-4 hover:underline sm:ml-42"
          >
            {action.label ?? t("eventFront.speakers.card.linkAction", { lng: lang })}
          </AppLink>
        )
      ) : null}
    </article>
  );
}