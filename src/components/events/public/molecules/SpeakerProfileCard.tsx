import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
// Redakcyjna karta prelegenta - wspólna dla zakładki „Prelegenci", podglądu
// studia i podglądu karty w panelu (`EventSpeakerCardDialog`).
//
// PORTRET NA CAŁĄ SZEROKOŚĆ, POD NIM SAMA TYPOGRAFIA. Kadr 4:5 niesie kartę
// jak w katalogu konferencji: nazwisko krojem nagłówkowym, stanowisko
// przygaszone, instytucja ze znakiem. Etykiety „Stanowisko" / „Instytucja"
// zostały tylko dla czytnika ekranu (`dt.sr-only`) - na oko hierarchię mówi
// krój i odcień, a wersaliki nad każdą linią były w siatce szumem.
//
// CAŁA KARTA OTWIERA PROFIL, INSTYTUCJA - SWOJE OKNO. Wzorzec rozciągniętego
// przycisku: przyciskiem jest nazwisko, a jego `::after` przykrywa kartę, więc
// klik w portret trafia w ten sam przycisk, a kolejność tabulacji zaczyna się
// od nazwiska. Instytucja i odnośnik redakcji stoją NAD nakładką
// (`relative z-10`) - to dwa osobne przyciski obok siebie, nigdy przycisk
// w przycisku.
//
// TRZY TRYBY, JEDEN RYSUNEK. Pod dostawcą okien (`EventDirectoryProvider` -
// zakładka publiczna) nazwisko i instytucja otwierają okna katalogu. Bez
// dostawcy, z `onSelect` (podgląd w panelu), nazwisko jest przyciskiem
// wołającego. Bez obu - tekstem. Ruch przy najechaniu dostaje tylko karta,
// którą da się kliknąć (`group/speaker` stoi wyłącznie na niej): portret, który
// drgnie pod kursorem, obiecuje okno.
import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";

import { AppLink } from "@/components/atoms/AppLink";
import { SpeakerTrackChips } from "@/components/events/SpeakerTrackChips";
import { SpeakerExpertBadge } from "@/components/events/SpeakerExpertBadge";
import {
  DIRECTORY_TRIGGER_CLASS,
  DirectoryCompanyTrigger,
  DirectoryPersonTrigger,
  useEventDirectory,
} from "@/components/events/public/directory/EventDirectoryContext";
import { buildTransformedImageUrl } from "@/lib/cropSizes";
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import { speakerHasProfileToShow } from "@/lib/builder/speakerRow";
import { directoryOrgKey, personKeyOf } from "@/lib/events/eventDirectory";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import {
  speakerCardAction,
  speakerCardPhoto,
  splitSpeakerRoleInstitution,
} from "@/lib/events/speakerCard";
import { ArrowRight } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";

const PREVIEW_MARKER = '[data-builder-renderer="widget-props-preview"]';
/** Kadr PIONOWY 4:5 - ta sama proporcja w transformacji i w pudle karty. */
const PORTRAIT_WIDTH = 480;
const PORTRAIT_HEIGHT = 600;

/** Nakładka rozciągniętego przycisku - `::after` liczony od `article.relative`. */
const STRETCHED_CLASS = "min-w-0 rounded-[6px] after:absolute after:inset-0";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toLocaleUpperCase("pl-PL") || "?";
}

function Portrait({
  name,
  source,
  priority,
}: {
  name: string;
  source: string | null;
  priority: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url =
    source === null
      ? null
      : buildTransformedImageUrl(source, {
          width: PORTRAIT_WIDTH,
          height: PORTRAIT_HEIGHT,
          resize: "cover",
        });

  // Rogi 6 px i tło są na PUDLE kadru, a nie na obrazie - inicjały zastępcze
  // dostają ten sam obrys, a powiększony przy najechaniu obraz nie wychodzi
  // poza rogi (`overflow-hidden`). Przyciemnienie zamiast szarości: portret
  // zostaje portretem, a nie zdjęciem „nieaktywnym".
  return (
    <span className="grid aspect-[4/5] w-full place-items-center overflow-hidden rounded-[6px] bg-muted">
      {url !== null && failedUrl !== url ? (
        <img
          src={url}
          alt=""
          aria-hidden="true"
          width={PORTRAIT_WIDTH}
          height={PORTRAIT_HEIGHT}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailedUrl(url)}
          className="size-full object-cover transition duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/speaker:brightness-95 group-hover:scale-[1.03] motion-reduce:transition-none"
        />
      ) : (
        <span
          aria-hidden="true"
          className="font-display text-3xl font-semibold tracking-tight text-muted-foreground/70"
        >
          {initials(name)}
        </span>
      )}
    </span>
  );
}

/** Logo instytucji PO LEWEJ jej nazwy - ukrywa sie, gdy plik nie wczyta sie.
 *  Wysokosc STALA (h-6) dla kazdego logo - kwadrat i prostokat maja identyczna
 *  wysokosc; szerokosc plywy z proporcji pliku (w-auto, bez sciskania
 *  max-w, bo object-contain przy scisnietych szerokosciach pomniejsza
 *  wysokosc szerokich logo). Rogi 6 px sa na obrazie, zgodnie z kadrem. */
function InstitutionLogo({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const [isElongated, setIsElongated] = useState(false);

  useEffect(() => {
    setFailed(false);
    setIsElongated(false);
  }, [url]);

  if (failed) return null;

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalHeight <= 0) return;
    const normalizedName = name.trim().toLocaleLowerCase("pl-PL");
    if (normalizedName === "wiseeuropa") {
      setIsElongated(false);
      return;
    }
    // Poziome znaki, takie jak WiseEuropa, nadal dostają zwarty kwadratowy
    // kadr. Dopiero wyraźnie podłużny logotyp zachowuje płynną szerokość.
    setIsElongated(image.naturalWidth / image.naturalHeight > 4);
  };

  return (
    <img
      src={url}
      alt={name}
      loading="lazy"
      decoding="async"
      onLoad={handleLoad}
      onError={() => setFailed(true)}
      data-logo-shape={isElongated ? "elongated" : "compact"}
      className={
        isElongated
          ? "block h-6 w-auto shrink-0 rounded-[6px] object-contain"
          : "block size-6 shrink-0 rounded-[6px] object-cover"
      }
    />
  );
}

export function SpeakerProfileCard({
  speaker,
  lang,
  onSelect,
  priority = false,
}: {
  speaker: PublicSpeakerRow;
  lang: "pl" | "en";
  /** Bez dostawcy okien: podana funkcja zamienia nazwisko w przycisk karty. */
  onSelect?: (speaker: PublicSpeakerRow) => void;
  /**
   * Pierwszy wiersz siatki: portret ładowany od razu. Kadr 4:5 na ćwierć
   * szerokości strony bywa największym obrazem ekranu (LCP), a `lazy` czeka
   * z nim do pierwszego układu strony.
   */
  priority?: boolean;
}) {
  const { t } = useTranslation();
  const directory = useEventDirectory();
  const name = speaker.display_name?.trim() ?? "";
  const role = pickLocalized(speaker, "headline", lang, speaker.job_title ?? "");
  // Stanowisko i instytucja OSOBNO - nawet gdy dane trzymają obie nazwy
  // w jednym polu; wycięcie robi ta sama reguła słów, co deduplikację
  // (i ten sam podział, którym katalog okien klucza instytucję).
  const { position, institution } = splitSpeakerRoleInstitution(role, speaker.company);
  const logoUrl = speaker.card_institution_logo_url?.trim() || null;
  // Osoba bez konta i bez faktów ponad kartę nie jest przyciskiem - okno
  // powtórzyłoby nazwisko i firmę (bramka `eventSpeakerWithoutAccount`).
  const hasProfile = speakerHasProfileToShow(speaker);
  const personKey = hasProfile
    ? personKeyOf({
        userId: speaker.user_id,
        speakerProfileId: speaker.speaker_profile_id,
        personId: speaker.person_id,
      })
    : null;
  const orgKey = directory === null ? null : directoryOrgKey(institution);
  const openLabel = t("eventFront.speakers.card.openProfile", { name, lng: lang });

  const nameText = (
    <span className="block break-words font-display text-lg font-semibold leading-tight tracking-tight text-foreground sm:text-xl">
      {name}
    </span>
  );
  let nameNode: ReactNode = <span className="min-w-0">{nameText}</span>;
  let interactive = false;
  if (directory !== null && personKey !== null) {
    interactive = true;
    nameNode = (
      <DirectoryPersonTrigger personKey={personKey} label={openLabel} className={STRETCHED_CLASS}>
        {nameText}
      </DirectoryPersonTrigger>
    );
  } else if (directory === null && onSelect !== undefined && hasProfile) {
    interactive = true;
    nameNode = (
      <button
        type="button"
        aria-label={openLabel}
        onClick={() => onSelect(speaker)}
        className={cn(DIRECTORY_TRIGGER_CLASS, STRETCHED_CLASS)}
      >
        {nameText}
      </button>
    );
  }

  const action = speakerCardAction(speaker, lang, false);
  const actionLabel = action?.label ?? t("eventFront.speakers.card.linkAction", { lng: lang });
  const actionFor = t("eventFront.speakers.card.actionFor", {
    label: actionLabel,
    name,
    lng: lang,
  });
  // `group` - ta sama strzałka wsuwana o 2 px, co w wierszach okna profilu
  // (klasy, które arkusz już ma - budżet CSS).
  const actionClass =
    "group relative z-10 mt-4 inline-flex w-fit items-center gap-1 text-xs font-semibold text-brand-ink underline-offset-4 hover:underline";
  const actionArrow = (
    <ArrowRight
      aria-hidden="true"
      strokeWidth={1.5}
      className="size-3 shrink-0 transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none"
    />
  );
  const hasInstitution = institution !== "" || logoUrl !== null;

  return (
    <article
      className={cn("relative flex min-w-0 flex-col pb-4", interactive && "group group/speaker")}
    >
      <Portrait name={name} source={speakerCardPhoto(speaker)} priority={priority} />
      <div className="mt-4 flex min-w-0 flex-col">
        <span className="flex items-start gap-1.5">
          {nameNode}
          {speaker.is_expert ? <SpeakerExpertBadge lang={lang} className="mt-1" /> : null}
        </span>
        {position !== "" || hasInstitution ? (
          <dl className="min-w-0">
            {position !== "" ? (
              <>
                <dt className="sr-only">
                  {t("eventFront.speakers.card.positionLabel", { lng: lang })}
                </dt>
                <dd className="mt-1 break-words text-sm leading-snug text-muted-foreground">
                  {position}
                </dd>
              </>
            ) : null}
            {hasInstitution ? (
              <>
                <dt className="sr-only">
                  {t("eventFront.speakers.card.organizationLabel", { lng: lang })}
                </dt>
                <dd className="mt-3 min-w-0">
                  {/* Nazwa PO PRAWEJ logo; samotne logo też ma wiersz. Włosowe
                      podkreślenie tylko na przycisku - to ten sam znak
                      „otwiera instytucję", co w oknie profilu. */}
                  <DirectoryCompanyTrigger
                    orgKey={orgKey}
                    name={institution}
                    logoUrl={logoUrl}
                    label={t("eventFront.directory.openCompany", { name: institution, lng: lang })}
                    className={cn(
                      "flex w-fit max-w-full items-center gap-2.5",
                      orgKey !== null && "relative z-10 rounded-[6px]",
                    )}
                  >
                    {logoUrl !== null ? <InstitutionLogo url={logoUrl} name={institution} /> : null}
                    {institution !== "" ? (
                      <span
                        className={cn(
                          "min-w-0 break-words text-sm leading-snug text-foreground/80",
                          orgKey !== null &&
                            "border-b border-border transition-colors hover:border-primary/40",
                        )}
                      >
                        {institution}
                      </span>
                    ) : null}
                  </DirectoryCompanyTrigger>
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {/* Ścieżki zostają dla czytnika ekranu i parytetu faktów, bez
            widocznych chipów - pełne sesje z godzinami pokazuje okno. */}
        <span className="sr-only">
          <SpeakerTrackChips tracks={speaker.tracks ?? []} lang={lang} />
        </span>
        {action?.kind === "link" ? (
          action.external ? (
            <a
              href={action.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${actionFor} ${t("eventFront.speakers.card.opensInNewTab", { lng: lang })}`}
              onClick={(event) => {
                if (event.currentTarget.closest(PREVIEW_MARKER)) event.preventDefault();
              }}
              className={actionClass}
            >
              {actionLabel}
              {actionArrow}
              <span className="sr-only">
                {" "}
                {t("eventFront.speakers.card.opensInNewTab", { lng: lang })}
              </span>
            </a>
          ) : (
            <AppLink href={action.href} aria-label={actionFor} className={actionClass}>
              {actionLabel}
              {actionArrow}
            </AppLink>
          )
        ) : null}
      </div>
    </article>
  );
}

ensureEventFrontI18n();
