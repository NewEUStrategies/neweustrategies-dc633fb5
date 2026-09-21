// Widget "Zespół (siatka)" (`team-member-grid`) - JEDNA siatka opisanych osób
// z oknem pełnej kartoteki po kliknięciu.
//
// CZYM SIĘ RÓŻNI OD `team-member` I DLACZEGO ISTNIEJE OSOBNO.
// Starszy `team-member` to JEDEN kafelek: redakcja składała zespół, wstawiając
// N widgetów do N kolumn, a wspólny nagłówek sekcji dokładała osobnym
// `heading`. Siatka miała wtedy tyle szerokości ile kolumn, a zmiana układu
// z trzech na cztery osoby była przestawianiem layoutu, nie edycją treści.
// Ten widget trzyma CAŁY zespół w jednej liście (`members`), więc kolumny są
// ustawieniem, a kolejność - przeciągnięciem wiersza w panelu. Tamten widget
// zostaje nietknięty: dokumenty, które go używają, renderują się dalej bez
// migracji.
//
// MODEL OSOBY JEST PEŁNĄ KARTOTEKĄ, NIE PODPISEM POD ZDJĘCIEM. Karta w siatce
// pokazuje minimum (zdjęcie, etykieta zespołu/programu, imię, rola, skrót
// biogramu), a okno - wszystko, co o tej osobie wiadomo: biogram, rolę w New
// European Strategies, afiliację zewnętrzną, przynależność projektową, kontakt
// i social media. Każde z tych pól ma wariant PL/EN, bo kartoteka osoby jest
// treścią redakcyjną, a nie metadaną.
//
// PUSTE POLE = BRAK ELEMENTU, NIGDY PLACEHOLDER. Dokładnie jak w `team-member`
// i `travel-route-card`: dopóki pole nie zostanie wypełnione, widget nie rysuje
// ani wiersza, ani ikony. Osoba bez imienia nie renderuje się w ogóle - nazwa
// niesie dostępną etykietę kafelka, więc kafelek bez niej byłby przyciskiem
// bez nazwy.
//
// SSR I HYDRATACJA. Render jest czystą funkcją treści: zero `window`,
// `Date.now()` i `Math.random()`, żadnego stanu czytanego z przeglądarki.
// Jedyny stan (`openIndex`) startuje z `null` po obu stronach, więc serwer
// i klient produkują IDENTYCZNY DOM, a okno Radixa montuje się dopiero po
// kliknięciu - razem z `BrandIcon`, który dopiero wtedy odpytuje bibliotekę
// ikon. Zdjęcia idą przez `WidgetMediaImage` (prawdziwy `<img>` w HTML
// serwera), a nie przez Radix Avatar, który renderuje obraz dopiero po
// `onload` w przeglądarce - inaczej dokument z serwera nie miałby ani jednej
// twarzy, a hydratacja podmieniałaby inicjały na zdjęcia.
import { useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { WidgetNode, WidgetContent } from "@/lib/builder/types";
import { sanitizeHtml } from "@/lib/sanitize";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { XIcon } from "@/components/atoms/XIcon";
import { WidgetMediaImage } from "@/components/atoms/WidgetMediaImage";
import {
  Facebook,
  Linkedin,
  Globe,
  Instagram,
  Youtube,
  Mail,
  Smartphone,
  Handshake,
  Layers,
  Target,
  ExternalLink,
} from "@/lib/lucide-shim";
import { getBool, getNum, getStr, type Lang } from "./frame";
import {
  TEAM_GRID_DEFAULT_RADIUS,
  TEAM_GRID_SOCIAL_LABEL,
  teamGridColumnsClass,
  teamGridHeader,
  teamGridInitials,
  teamGridMembers,
  type TeamGridMember,
  type TeamGridSocialKey,
} from "@/lib/builder/teamGrid";
import "@/lib/i18n-team-grid";

/** Zapasowe ikony, gdy biblioteka ikon nie ma własnego wariantu marki. */
const SOCIAL_FALLBACK: Record<TeamGridSocialKey, React.ComponentType<{ className?: string }>> = {
  x: XIcon,
  facebook: Facebook,
  linkedin: Linkedin,
  instagram: Instagram,
  youtube: Youtube,
  website: Globe,
};

export function TeamMemberGridWidget({
  node,
  lang,
  editable,
}: {
  node: WidgetNode;
  lang: Lang;
  editable?: boolean;
}) {
  const c = (node.content ?? {}) as WidgetContent;
  const { t: translate } = useTranslation();
  // Napis jedzie za językiem TREŚCI, nie za językiem panelu - patrz nagłówek
  // `src/lib/i18n-team-grid.ts`.
  //
  // KLUCZ JEST PEŁNYM LITERAŁEM W MIEJSCU WYWOŁANIA, a nie sklejany z prefiksu
  // wewnątrz opakowania. Statyczny skaner `check:i18n-drift` czyta argumenty
  // `t("…")` dosłownie: przy sklejce widziałby `dialog.projects` i zgłaszał
  // klucz, którego w słowniku nie ma (`missing_both`), zamiast pilnować tego,
  // który naprawdę wołamy.
  const t = (key: string): string => translate(key, { lng: lang });

  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const triggersRef = useRef<Array<HTMLButtonElement | null>>([]);

  // Ustawienia czytamy PRZED wyjściem na pustej liście osób - dzięki temu
  // bramka wierności widzi je w każdej próbce i żadne nie wygląda na martwe
  // tylko dlatego, że świeży widget nie ma jeszcze nikogo w zespole.
  const { badge, heading, intro } = teamGridHeader(c, lang);
  const columns = Math.min(4, Math.max(2, Math.round(getNum(c, "columns", 3))));
  const radius = Math.min(
    48,
    Math.max(0, Math.round(getNum(c, "radius", TEAM_GRID_DEFAULT_RADIUS))),
  );
  const accent = getStr(c, "accentColor") || "var(--brand)";
  const grayscale = getBool(c, "grayscale", true);
  const openPopup = getBool(c, "openPopup", true);

  const members = teamGridMembers(c, lang);
  const active = openIndex === null ? null : (members[openIndex] ?? null);

  // Jedna zmienna niesie zaokrąglenie do WSZYSTKICH powierzchni widgetu
  // (kadr zdjęcia, plakietki, ramka siatki, okno) - bez niej każda z nich
  // miałaby własną klasę i rozjechałyby się przy pierwszej zmianie ustawienia.
  const rootStyle: CSSProperties = {
    ["--tg-radius" as string]: `${radius}px`,
    ["--tg-accent" as string]: accent,
  };

  if (members.length === 0) {
    // Na stronie publicznej pusty zespół to brak sekcji, a nie pusta ramka.
    // W kanwie redaktor musi wiedzieć, GDZIE wpisać osoby - stąd podpowiedź.
    if (!editable) return null;
    return (
      <div
        className="cms-team-grid rounded-[var(--tg-radius)] border border-dashed border-border/60 bg-muted/20 p-6 text-center text-xs text-muted-foreground"
        style={rootStyle}
        data-team-grid-empty
      >
        {t("teamGrid.empty")}
      </div>
    );
  }

  const openMember = (index: number) => {
    // W kanwie okno się nie otwiera - właściwości ustawia panel boczny (ten sam
    // guard co w `team-member`; bez niego klik w kafelek zasłaniał edytor).
    if (editable || !openPopup) return;
    setOpenIndex(index);
  };

  return (
    <div className="cms-team-grid w-full" style={rootStyle} data-team-grid-id={node.id}>
      {(badge || heading || intro) && (
        <div className="mx-auto max-w-2xl text-center">
          {badge && (
            <span className="mb-5 inline-flex items-center rounded-[var(--tg-radius)] border border-border px-3 py-1 text-xs uppercase tracking-widest text-foreground">
              {badge}
            </span>
          )}
          {heading && (
            <h2 className="cms-block-heading font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {heading}
            </h2>
          )}
          {intro && <p className="mt-4 text-base text-muted-foreground">{intro}</p>}
        </div>
      )}

      <div
        className={`mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--tg-radius)] border border-border bg-border ${teamGridColumnsClass(columns)}`}
      >
        {members.map((member, index) => (
          <TeamGridCard
            key={member.key}
            member={member}
            grayscale={grayscale}
            interactive={openPopup}
            hint={t("teamGrid.cardHint")}
            onOpen={() => openMember(index)}
            registerTrigger={(el) => {
              triggersRef.current[index] = el;
            }}
          />
        ))}
      </div>

      {openPopup && (
        <Dialog
          open={active !== null}
          onOpenChange={(next) => {
            if (!next) setOpenIndex(null);
          }}
        >
          <DialogContent
            className="max-h-[85vh] max-w-3xl gap-0 overflow-y-auto rounded-[var(--tg-radius)] p-0"
            style={rootStyle}
            onCloseAutoFocus={(event) => {
              // Fokus wraca na kafelek, z którego okno zostało otwarte -
              // inaczej po zamknięciu ląduje na <body> i nawigacja klawiaturą
              // zaczyna od początku dokumentu.
              event.preventDefault();
              if (openIndex !== null) triggersRef.current[openIndex]?.focus();
            }}
          >
            {active && <TeamMemberDialogBody member={active} t={t} />}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Kafelek osoby. Przycisk ALBO zwykły blok - zależnie od tego, czy okno jest
 * włączone. To nie jest kosmetyka: element o roli `button`, który po kliknięciu
 * nic nie robi, obiecuje czytnikowi ekranu interakcję, której nie ma.
 */
function TeamGridCard({
  member,
  grayscale,
  interactive,
  hint,
  onOpen,
  registerTrigger,
}: {
  member: TeamGridMember;
  grayscale: boolean;
  interactive: boolean;
  hint: string;
  onOpen: () => void;
  registerTrigger: (el: HTMLButtonElement | null) => void;
}) {
  const body = (
    <>
      <div className="flex items-center gap-4">
        {member.avatar ? (
          <WidgetMediaImage
            src={member.avatar}
            alt={member.name}
            frameClassName="relative block size-16 shrink-0 overflow-hidden rounded-[var(--tg-radius)] border border-border"
            foregroundClassName={`absolute inset-0 block h-full w-full object-cover transition-all duration-300 ${
              grayscale ? "grayscale group-hover:grayscale-0" : ""
            }`}
            sizes="64px"
            responsiveWidths={[64, 128]}
          />
        ) : (
          <span
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-[var(--tg-radius)] border border-border bg-muted text-sm font-semibold text-muted-foreground"
          >
            {teamGridInitials(member.name)}
          </span>
        )}
        <div className="flex flex-col items-start gap-1">
          {member.department && (
            <span className="inline-flex items-center rounded-[var(--tg-radius)] bg-secondary px-2.5 py-0.5 text-[10px] font-normal text-secondary-foreground">
              {member.department}
            </span>
          )}
          <span className="text-sm font-semibold leading-snug text-foreground">{member.name}</span>
          {member.role && <span className="text-xs text-muted-foreground">{member.role}</span>}
        </div>
      </div>
      {member.bio && <p className="text-sm leading-relaxed text-muted-foreground">{member.bio}</p>}
    </>
  );

  const base =
    "cms-team-grid-card group flex flex-col gap-5 bg-card p-6 text-left transition-colors duration-200 sm:p-8";

  if (!interactive) {
    return (
      <div className={base} data-team-grid-member={member.key}>
        {body}
      </div>
    );
  }

  return (
    <button
      ref={registerTrigger}
      type="button"
      onClick={onOpen}
      aria-label={member.name}
      aria-haspopup="dialog"
      title={hint}
      className={`${base} cursor-pointer hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tg-accent)]/60`}
      data-team-grid-member={member.key}
    >
      {body}
    </button>
  );
}

/** Ciało okna - wydzielone, bo montuje się wyłącznie po otwarciu. */
function TeamMemberDialogBody({
  member,
  t,
}: {
  member: TeamGridMember;
  t: (key: string) => string;
}) {
  const hasContact = Boolean(member.email || member.phone);
  return (
    <>
      <DialogTitle className="sr-only">{member.name}</DialogTitle>
      <DialogDescription className="sr-only">
        {member.role || t("teamGrid.dialog.fallbackDescription")}
      </DialogDescription>

      <div className="grid gap-0 md:grid-cols-[minmax(200px,260px)_1fr]">
        <div className="flex flex-col items-center gap-3 border-border bg-muted/30 p-6 text-center md:border-r">
          {member.avatar ? (
            <WidgetMediaImage
              src={member.avatar}
              alt={member.name}
              frameClassName="relative block size-28 shrink-0 overflow-hidden rounded-[var(--tg-radius)] border border-border"
              sizes="112px"
              responsiveWidths={[112, 224]}
            />
          ) : (
            <span
              aria-hidden
              className="flex size-28 items-center justify-center rounded-[var(--tg-radius)] border border-border bg-muted text-xl font-semibold text-muted-foreground"
            >
              {teamGridInitials(member.name)}
            </span>
          )}
          {member.department && (
            <span className="inline-flex items-center rounded-[var(--tg-radius)] bg-secondary px-2.5 py-0.5 text-[10px] text-secondary-foreground">
              {member.department}
            </span>
          )}
          <h2 className="font-display text-lg font-bold leading-tight text-foreground">
            {member.name}
          </h2>
          {member.role && (
            <p
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: "var(--tg-accent)" }}
            >
              {member.role}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-5 p-6">
          {member.role && (
            <TeamGridSection
              icon={<Target className="h-3.5 w-3.5" />}
              title={t("teamGrid.dialog.role")}
            >
              <p className="text-sm text-foreground/90">{member.role}</p>
            </TeamGridSection>
          )}

          {member.affiliation && (
            <TeamGridSection
              icon={<Handshake className="h-3.5 w-3.5" />}
              title={t("teamGrid.dialog.affiliation")}
            >
              <p className="text-sm text-foreground/90">{member.affiliation}</p>
            </TeamGridSection>
          )}

          {member.projects.length > 0 && (
            <TeamGridSection
              icon={<Layers className="h-3.5 w-3.5" />}
              title={t("teamGrid.dialog.projects")}
            >
              <ul className="flex flex-wrap gap-1.5">
                {member.projects.map((project) => (
                  <li
                    key={project}
                    className="inline-flex items-center rounded-[var(--tg-radius)] border border-border bg-muted/60 px-2 py-0.5 text-xs text-foreground/80"
                  >
                    {project}
                  </li>
                ))}
              </ul>
            </TeamGridSection>
          )}

          {(member.fullBio || member.bio) && (
            <TeamGridSection title={t("teamGrid.dialog.about")}>
              {member.fullBio ? (
                <div
                  className="cms-post-content prose prose-sm max-w-none text-foreground/90"
                  // Sanityzacja stoi TUTAJ, przy samym sinku, a nie w modelu:
                  // `check:dangerous-html` wymaga dowodu w miejscu wstawienia,
                  // bo odkażanie „gdzieś po drodze" nie daje się sprawdzić
                  // statycznie i psuje się cicho przy drugim źródle pola.
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(member.fullBio) }}
                />
              ) : (
                // Skrót z kafelka jest WĘZŁEM TEKSTOWYM, nie HTML-em: pole
                // `bio` nie przechodzi przez `sanitizeHtml`, więc wstawione
                // przez `dangerouslySetInnerHTML` niosłoby surową treść pola
                // prosto do DOM (i pokazywałoby markery przypisów dosłownie).
                <p className="text-sm leading-relaxed text-foreground/90">{member.bio}</p>
              )}
            </TeamGridSection>
          )}

          {hasContact && (
            <TeamGridSection title={t("teamGrid.dialog.contact")}>
              <dl className="grid gap-2 text-sm">
                {member.email && (
                  <div className="flex items-center gap-3">
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      <Mail className="h-3.5 w-3.5" aria-hidden />
                      {t("teamGrid.dialog.email")}
                    </dt>
                    <dd>
                      <a
                        href={`mailto:${member.email}`}
                        className="hover:text-[color:var(--tg-accent)]"
                      >
                        {member.email}
                      </a>
                    </dd>
                  </div>
                )}
                {member.phone && (
                  <div className="flex items-center gap-3">
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      <Smartphone className="h-3.5 w-3.5" aria-hidden />
                      {t("teamGrid.dialog.phone")}
                    </dt>
                    <dd>
                      <a
                        href={`tel:${member.phone}`}
                        className="hover:text-[color:var(--tg-accent)]"
                      >
                        {member.phone}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </TeamGridSection>
          )}

          {member.socials.length > 0 && (
            <TeamGridSection title={t("teamGrid.dialog.social")}>
              <div className="flex flex-wrap items-center gap-2">
                {member.socials.map(({ key, url }) => (
                  <a
                    key={key}
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={TEAM_GRID_SOCIAL_LABEL[key]}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--tg-radius)] border border-border bg-muted/60 text-foreground/80 transition-colors hover:border-[color:var(--tg-accent)]/50 hover:text-[color:var(--tg-accent)]"
                  >
                    <BrandIcon
                      name={key}
                      fallback={SOCIAL_FALLBACK[key]}
                      className="h-4 w-4"
                      alt={TEAM_GRID_SOCIAL_LABEL[key]}
                    />
                  </a>
                ))}
              </div>
            </TeamGridSection>
          )}

          {member.profileHref && (
            <a
              href={member.profileHref}
              className="inline-flex items-center gap-1 text-xs font-medium text-[color:var(--tg-accent)] hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {t("teamGrid.dialog.profileLink")}
            </a>
          )}
        </div>
      </div>
    </>
  );
}

function TeamGridSection({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}
