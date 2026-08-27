// Dialog profilu prelegenta - wyswietlany na wydarzeniach (agenda, sekcja
// prelegentow, widget speakers). Sklada profil prelegenta (speaker_profiles:
// rola sceniczna, bio, tematy, statystyki) z profilem eksperta (author_profiles
// + odznaka 'expert') i lista wystapien (event_speakers -> events). Dane
// pochodza z RPC get_public_speakers - wylacznie publiczne kolumny; i18n PL/EN
// z fallbackiem; 6px rounding; dark/light przez tokeny semantyczne.
//
// DWA ZRODLA FAKTOW, BO PRELEGENT BEZ KONTA NIE MA CZEGO DOCIAGNAC.
// `speakerProfileQueryOptions` pyta bazy PO `user_id` - a osoba wpisana recznie
// w studiu (kartoteka `event_people`) konta nie ma, wiec dla niej to zapytanie
// nie ma nawet czym zapytac. Publiczna lista wydarzenia
// (`event_speakers_public`) niesie jednak JEJ FAKTY WPROST W WIERSZU: biogram,
// tematy, jezyki, stanowisko, firme, statystyki. Dlatego powierzchnia, ktora
// otwiera dialog, podaje ten wiersz propsem `row`, a dociaganie po `user_id`
// zostaje TYLKO tam, gdzie konto istnieje.
//
// PIERWSZENSTWO: dociagniety profil > wiersz z listy > dane awaryjne z tresci
// widgetu. Nie odwrotnie - dociagniety profil jest swiezszy i pelniejszy
// (`slug` do pelnego profilu, lista wystapien), a wiersz listy jest migawka
// z tego samego RPC, ktory narysowal karte. Bez tej kolejnosci klik w osobe
// z kontem cofalby ja do migawki na czas dociagania.
//
// SZKIELET TYLKO WTEDY, GDY NIE MA CZEGO POKAZAC. Skoro wiersz przyszedl razem
// z kliknieciem, to okno moze byc pelne od PIERWSZEJ KLATKI - migotanie
// szkieletu nad danymi, ktore juz sa w pamieci, to strata, nie informacja.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppLink } from "@/components/atoms/AppLink";
import { SpeakerExpertBadge } from "@/components/events/SpeakerExpertBadge";
import { ArrowRight, CalendarClock, MapPin } from "@/lib/lucide-shim";
import {
  speakerEngagementsQueryOptions,
  speakerProfileQueryOptions,
  type PublicSpeakerRow,
  type SpeakerEngagement,
} from "@/lib/builder/speakersQuery";
import { SpeakerAvatar } from "./SpeakerAvatar";
import { SpeakerStars } from "./SpeakerStars";
import { uiLocale } from "@/lib/i18n/format";

type Lang = "pl" | "en";

/** Dane awaryjne z tresci widgetu - pokazywane, zanim (lub gdy) profil w bazie
 *  jest niedostepny, zeby dialog nigdy nie byl pusty. */
export interface SpeakerDialogFallback {
  name?: string;
  role?: string;
  photo?: string;
}

interface SpeakerProfileDialogProps {
  /** Konto prelegenta. PUSTY NAPIS = osoba bez konta: zapytania spia, liczy `row`. */
  userId: string;
  lang: Lang;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Wiersz publicznej listy wydarzenia, w ktory czytelnik kliknal.
   *
   * To NIE jest `fallback` pod inna nazwa: `fallback` niesie trzy pola z tresci
   * widgetu (imie, rola, zdjecie) i istnieje po to, zeby okno nie bylo puste,
   * a `row` jest PELNYM wierszem RPC - dla prelegenta bez konta JEDYNYM
   * zrodlem biogramu, tematow, jezykow i statystyk.
   */
  row?: PublicSpeakerRow | null;
  fallback?: SpeakerDialogFallback;
}

function loc(pl: string | null, en: string | null, lang: Lang): string {
  const primary = lang === "pl" ? pl : en;
  return primary || pl || en || "";
}

function formatEngagementDate(iso: string, lang: Lang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(uiLocale(lang), {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function EngagementRow({ item, lang }: { item: SpeakerEngagement; lang: Lang }) {
  const title = lang === "pl" ? item.title_pl || item.title_en : item.title_en || item.title_pl;
  return (
    <li>
      <AppLink
        href={`/events/${item.slug}`}
        className="group/eng flex items-start gap-2.5 rounded-[6px] border border-border/60 bg-background p-2.5 transition-colors hover:border-[color:var(--speakers-accent,var(--brand))]/50"
      >
        <CalendarClock
          aria-hidden
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover/eng:text-brand-ink"
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">{title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{formatEngagementDate(item.starts_at, lang)}</span>
            {item.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin aria-hidden className="h-3 w-3" />
                {item.location}
              </span>
            ) : null}
          </span>
        </span>
      </AppLink>
    </li>
  );
}

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[6px] border border-border/60 bg-muted/30 px-3 py-2 text-center">
      <div className="text-base font-semibold text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function DialogSkeleton() {
  return (
    <div aria-hidden className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-20 w-20 animate-pulse rounded-[6px] bg-muted/60" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 animate-pulse rounded-[6px] bg-muted/60" />
          <div className="h-3 w-1/2 animate-pulse rounded-[6px] bg-muted/60" />
        </div>
      </div>
      <div className="h-16 w-full animate-pulse rounded-[6px] bg-muted/60" />
    </div>
  );
}

function ProfileBody({
  profile,
  fallback,
  lang,
  engagements,
}: {
  profile: PublicSpeakerRow | null;
  fallback?: SpeakerDialogFallback;
  lang: Lang;
  engagements: SpeakerEngagement[];
}) {
  const name = profile?.display_name || fallback?.name || "";
  const headline = profile
    ? loc(profile.headline_pl, profile.headline_en, lang) || profile.job_title || ""
    : fallback?.role || "";
  const bio = profile ? loc(profile.bio_pl, profile.bio_en, lang) : "";
  // Fallback symetryczny PL <-> EN (jak loc() dla pol tekstowych).
  const topics = profile ? (lang === "pl" ? profile.topics_pl : profile.topics_en) : [];
  const topicsOther = profile ? (lang === "pl" ? profile.topics_en : profile.topics_pl) : [];
  const topicsShown = topics.length ? topics : topicsOther;
  const photo = profile?.avatar_url || fallback?.photo || null;
  const companyLine = [profile?.job_title, profile?.company].filter(Boolean).join(" · ");
  const now = Date.now();
  const upcoming = engagements.filter((e) => new Date(e.starts_at).getTime() >= now);
  const past = engagements.filter((e) => new Date(e.starts_at).getTime() < now);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <SpeakerAvatar name={name} photoUrl={photo} size="xl" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-semibold leading-tight text-foreground">
              {name}
            </h3>
            {/* WSPÓLNA PLAKIETKA, NIE WŁASNY JSX. Ten dialog otwiera się PROSTO
                z zapowiedzi na przeglądzie, więc czytelnik widzi oba rysunki
                w jednym kliknięciu - a stały tu dwa różne. Dodatkowo napis był
                zaszyty `lang === "pl" ? … : …`, czyli poza słownikiem.
                WYGLĄD ZOSTAJE: `withLabel` daje tę samą pigułkę z widocznym
                napisem, a `lang` trzyma ją przy języku PROPSA - dialog nie
                czyta języka z instancji i18n. */}
            {profile?.is_expert && <SpeakerExpertBadge withLabel lang={lang} />}
          </div>
          {headline ? <p className="text-sm text-muted-foreground">{headline}</p> : null}
          {companyLine && companyLine !== headline ? (
            <p className="text-xs text-muted-foreground">{companyLine}</p>
          ) : null}
          {profile && profile.languages.length > 0 && (
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
              {(lang === "pl" ? "Języki: " : "Languages: ") +
                profile.languages.map((l) => l.toUpperCase()).join(", ")}
            </p>
          )}
        </div>
      </div>

      {profile && (profile.talks_count > 0 || profile.rating > 0 || profile.reviews_count > 0) && (
        <div className="grid grid-cols-3 gap-2">
          <StatBox
            value={String(profile.talks_count)}
            label={lang === "pl" ? "wystąpień" : "talks"}
          />
          <div className="rounded-[6px] border border-border/60 bg-muted/30 px-3 py-2 text-center">
            <div className="flex items-center justify-center gap-1 text-base font-semibold text-foreground">
              {profile.rating > 0 ? profile.rating.toFixed(1) : "-"}
            </div>
            <div className="flex justify-center">
              <SpeakerStars rating={profile.rating} />
            </div>
          </div>
          <StatBox
            value={String(profile.reviews_count)}
            label={lang === "pl" ? "opinii" : "reviews"}
          />
        </div>
      )}

      {bio ? <p className="text-sm leading-relaxed text-foreground/90">{bio}</p> : null}

      {topicsShown.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topicsShown.map((topic) => (
            <span
              key={topic}
              className="rounded-[6px] bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {topic}
            </span>
          ))}
        </div>
      )}

      {(upcoming.length > 0 || past.length > 0) && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {lang === "pl" ? "Wystąpienia" : "Engagements"}
          </h4>
          <ul className="space-y-1.5">
            {upcoming.map((item) => (
              <EngagementRow key={item.id} item={item} lang={lang} />
            ))}
            {past.slice(0, Math.max(0, 5 - upcoming.length)).map((item) => (
              <EngagementRow key={item.id} item={item} lang={lang} />
            ))}
          </ul>
        </div>
      )}

      {profile?.slug && (
        <div className="pt-1">
          <AppLink
            href={`/author/${profile.slug}`}
            className="inline-flex items-center gap-1.5 rounded-[6px] border border-border/70 bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-[color:var(--speakers-accent,var(--brand))]/50 hover:text-brand-ink"
          >
            {lang === "pl" ? "Zobacz pełny profil" : "View full profile"}
            <ArrowRight aria-hidden className="h-4 w-4" />
          </AppLink>
        </div>
      )}
    </div>
  );
}

export function SpeakerProfileDialog({
  userId,
  lang,
  open,
  onOpenChange,
  row,
  fallback,
}: SpeakerProfileDialogProps) {
  const profileQ = useQuery({ ...speakerProfileQueryOptions(userId), enabled: open && !!userId });
  const engagementsQ = useQuery({
    ...speakerEngagementsQueryOptions(userId),
    enabled: open && !!userId,
  });

  const engagements = useMemo(() => engagementsQ.data ?? [], [engagementsQ.data]);
  // Profil z bazy wygrywa z wierszem listy, wiersz listy z danymi awaryjnymi.
  const shown = profileQ.data ?? row ?? null;
  const title =
    shown?.display_name ||
    fallback?.name ||
    (lang === "pl" ? "Profil prelegenta" : "Speaker profile");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-[6px]">
        <DialogHeader>
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {lang === "pl"
              ? "Profil prelegenta z biogramem i listą wystąpień."
              : "Speaker profile with bio and list of engagements."}
          </DialogDescription>
        </DialogHeader>
        {profileQ.isLoading && shown === null ? (
          <DialogSkeleton />
        ) : (
          <ProfileBody profile={shown} fallback={fallback} lang={lang} engagements={engagements} />
        )}
      </DialogContent>
    </Dialog>
  );
}
