// Molekuła: nagłówek wątku - pas na PEŁNĄ szerokość huba.
//
// CO SIĘ ZMIENIŁO WZGLĘDEM KARTY. Poprzednio wątek otwierał się kartą: ramka,
// tło `bg-card`, tytuł wielkości nagłówka sekcji. Karta mówi „to jest jeden
// z wielu elementów na stronie". Wątek nie jest elementem strony - wątek JEST
// stroną, a wokół niego stoi jego własny kontekst. Stąd pas o pełnej
// szerokości, tytuł w skali edytorskiej i akcent klubu jako tło.
//
// Akcent wchodzi zmienną CSS ustawianą inline, bo kolor jest DANYMI klubu
// (`clubs.accent_color`), a nie wariantem w kodzie. Gdy klub go nie ma,
// gradient schodzi do neutralnego `--primary` - i to jest jedyny fallback,
// bo hero bez tła wygląda jak niezaładowany, a nie jak stonowany.
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Link2, Lock, Pin, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import { ClubFacepile, type FacepilePerson } from "@/components/clubs/atoms/ClubFacepile";
import { ClubTopicChip } from "@/components/clubs/atoms/ClubTopicChip";
import type { ClubTopicOption } from "@/lib/clubs/topicCatalog";
import { formatDateTime } from "@/lib/i18n/format";

/** Kolor akcentu jako zmienna CSS. Wartość z bazy jest walidowana kształtem
 *  (#rrggbb), bo trafia do `style` - dowolny string byłby wektorem wstrzyknięcia
 *  do atrybutu. Niepoprawna wartość znaczy „użyj domyślnego". */
export function accentStyle(accent: string | null | undefined): CSSProperties | undefined {
  if (typeof accent !== "string" || !/^#[0-9a-fA-F]{6}$/.test(accent)) return undefined;
  return { "--club-accent": accent } as CSSProperties;
}

export interface ClubThreadHeroProps {
  clubSlug: string;
  clubName: string;
  accentColor: string | null;
  title: string;
  kind: string;
  status: string;
  topic: string | null;
  topicCatalog: readonly ClubTopicOption[];
  anchorType: string | null;
  pinned: boolean;
  locked: boolean;
  chatham: boolean;
  authorName: string;
  authorAvatar: string | null;
  authorMuted: boolean;
  createdAt: string;
  edited: boolean;
  lang: "pl" | "en";
  people: readonly FacepilePerson[];
  participantTotal: number;
  /** Pasek statystyk - komponowany przez trasę, bo liczby pochodzą z trzech
   *  różnych zapytań i hero nie ma powodu ich znać. */
  stats: ReactNode;
  actions: ReactNode;
}

export function ClubThreadHero(props: ClubThreadHeroProps) {
  const { t } = useTranslation();
  const {
    clubSlug,
    clubName,
    accentColor,
    title,
    kind,
    status,
    topic,
    topicCatalog,
    anchorType,
    pinned,
    locked,
    chatham,
    authorName,
    authorAvatar,
    authorMuted,
    createdAt,
    edited,
    lang,
    people,
    participantTotal,
    stats,
    actions,
  } = props;

  return (
    <header
      style={accentStyle(accentColor)}
      className={
        // `[--club-accent:theme(...)]` jako wartość domyślna: gdy klub nie ma
        // koloru, `style` nie nadpisuje niczego i zostaje token motywu.
        "relative overflow-hidden border-b border-border/60 [--club-accent:var(--primary)]"
      }
    >
      {/* Warstwa tła: delikatny gradient akcentu. `pointer-events-none`, bo to
          dekoracja - nie może przechwytywać kliknięć z treści nad nią. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          background:
            "radial-gradient(70rem 24rem at 12% -20%, var(--club-accent), transparent 65%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
        style={{ background: "var(--club-accent)" }}
      />

      <div className="relative mx-auto w-full max-w-[1600px] px-3 pb-6 pt-4 sm:px-5 sm:pb-7 lg:px-8">
        <Link
          to="/club/$clubSlug"
          params={{ clubSlug }}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {clubName}
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {pinned ? <Pin className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
          <Badge variant="outline">{t(`club.kind.${kind}`)}</Badge>
          {status === "resolved" ? (
            <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
              {t("club.threadStatus.resolved")}
            </Badge>
          ) : null}
          {locked ? (
            <Badge variant="outline" className="gap-1">
              <Lock className="h-3 w-3" />
              {t("club.threadStatus.locked")}
            </Badge>
          ) : null}
          {chatham ? (
            <Badge variant="outline" className="gap-1">
              <ShieldQuestion className="h-3 w-3" />
              {t("club.attribution.chatham")}
            </Badge>
          ) : null}
          <ClubTopicChip topic={topic} lang={lang} catalog={topicCatalog} />
          {anchorType !== null ? (
            <Badge variant="secondary" className="gap-1">
              <Link2 className="h-3 w-3" aria-hidden="true" />
              {t(`club.anchorType.${anchorType}`)}
            </Badge>
          ) : null}
        </div>

        {/* Skala edytorska, nie nagłówek sekcji. Tytuł wątku jest tytułem
            STRONY - `text-balance` trzyma go w zwartym bloku zamiast zostawiać
            jedno słowo w ostatniej linii. */}
        <h1 className="mt-3 max-w-4xl text-pretty text-2xl font-semibold leading-tight tracking-tight sm:text-3xl lg:text-[2.125rem]">
          {title}
        </h1>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex items-center gap-2.5">
              <ClubAuthorAvatar
                name={authorName}
                avatarUrl={authorAvatar}
                size="md"
                muted={authorMuted}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{authorName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatDateTime(createdAt, lang)}
                  {edited ? ` · ${t("club.edited")}` : ""}
                </p>
              </div>
            </div>

            {people.length > 0 ? (
              <div className="flex items-center gap-2.5">
                <span aria-hidden="true" className="hidden h-8 w-px bg-border/70 sm:block" />
                <ClubFacepile people={people} total={participantTotal} />
                <span className="text-xs text-muted-foreground">
                  {t("club.threadHub.inConversation", { count: participantTotal })}
                </span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>

        {stats}
      </div>
    </header>
  );
}
