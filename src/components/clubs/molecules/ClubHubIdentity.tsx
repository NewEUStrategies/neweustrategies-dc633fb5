// Pasek tożsamości klubu - pierwsza rzecz, którą widać po wejściu.
//
// CO SIĘ ZMIENIŁO WOBEC POPRZEDNIEJ WERSJI. Okładka była TŁEM paska: zdjęcie
// szło pod tekst, a nad nim leżały dwie warstwy przyciemnienia i rozmycia,
// żeby napis dało się przeczytać. Efekt był taki, że okładki w praktyce nie
// było widać wcale - płaciliśmy transferem za szarą teksturę. Teraz okładka
// jest osobnym pasem NAD treścią: zdjęcie widać w całości, a tekst stoi na
// czystej powierzchni karty i nie potrzebuje żadnego filtra.
//
// Klub bez okładki nie dostaje pustego prostokąta, tylko delikatny pas w
// kolorze akcentu klubu - brak zdjęcia to nie jest stan błędu. Monogram
// wchodzi na pas od dołu, więc identyfikacja klubu działa w obu przypadkach.
//
// Edycja okładki stoi TUTAJ, a nie w panelu administracyjnym: zmienia ją
// prowadzenie klubu, patrząc na to, co zmienia. Przycisk widzi wyłącznie ten,
// kto ma `can_moderate` - baza i tak sprawdzi to po raz drugi.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Landmark, MessagesSquare, PenLine, ShieldQuestion, Users2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClubStatPill } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubTopicChip } from "@/components/clubs/atoms/ClubTopicChip";
import { ClubCoverEditor } from "@/components/clubs/molecules/ClubCoverEditor";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import { clubKeys } from "@/lib/clubs/queryKeys";
import type { ClubViewRow } from "@/lib/clubs/types";
import { formatNumber } from "@/lib/i18n/format";

/** Monogram klubu - dwie litery nazwy. Stoi na okładce i bez niej. */
function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "K";
  const second = words[1]?.[0] ?? words[0]?.[1] ?? "";
  return (first + second).toUpperCase();
}

export function ClubHubIdentity({
  club,
  isPl,
  locale,
  className,
}: {
  club: ClubViewRow;
  isPl: boolean;
  locale: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { topics } = useClubTopics();
  const queryClient = useQueryClient();
  const name = isPl ? club.name_pl : club.name_en;
  const tagline = isPl ? club.tagline_pl : club.tagline_en;
  const coverUrl =
    typeof club.cover_image_url === "string" && club.cover_image_url.trim() !== ""
      ? club.cover_image_url
      : null;
  const canEditCover = club.can_moderate === true;

  return (
    <header
      className={cn(
        "overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm",
        className,
      )}
    >
      {/* PAS OKŁADKI. Wysokość rośnie z ekranem, ale nigdy nie zjada ekranu
          w pionie - to nagłówek, nie hero. Proporcja 4:1 na mobile (mniej
          pustego pasa przy wąskim zdjęciu) przechodzi w stałe wysokości od
          `sm` w górę, żeby na desktopie nagłówek nie rósł bez końca. */}
      <div className="relative aspect-[4/1] max-h-56 min-h-[7rem] w-full sm:aspect-auto sm:h-40 lg:h-52">
        {coverUrl !== null ? (
          <img
            src={coverUrl}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
            loading="eager"
            decoding="async"
          />
        ) : (
          <div className="club-cover-placeholder h-full w-full" aria-hidden="true" />
        )}
        {/* Zejście do karty: wieloprzystankowa krzywa (`club-cover-fade`)
            zamiast dwóch przystanków - tamta wersja rysowała widoczny próg. */}
        <div
          className="club-cover-fade pointer-events-none absolute inset-x-0 bottom-0 h-24 sm:h-32"
          aria-hidden="true"
        />
        {canEditCover ? (
          <ClubCoverEditor
            clubId={club.id}
            hasCover={coverUrl !== null}
            onChanged={() => void queryClient.invalidateQueries({ queryKey: clubKeys.all })}
            className="absolute right-2 top-2 sm:right-3 sm:top-3"
          />
        ) : null}
      </div>

      <div className="relative flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4 sm:px-5 sm:pb-5">
        {/* Monogram wchodzi na okładkę - kotwiczy pas w treści. Większy niż
            wcześniej, także na mobile: to jedyny znak rozpoznawczy klubu. */}
        <div
          className="-mt-10 flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-border/60 bg-card text-2xl font-semibold text-primary shadow-sm sm:-mt-12 sm:h-24 sm:w-24 sm:text-3xl lg:h-28 lg:w-28 lg:text-4xl"
          aria-hidden="true"
        >
          {monogram(name)}
          <Landmark className="h-4 w-4 text-primary/50 sm:h-5 sm:w-5" aria-hidden="true" />
        </div>

        <div className="min-w-0 sm:flex-1 sm:pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <ClubTopicChip topic={club.policy_area} lang={isPl ? "pl" : "en"} catalog={topics} />
            {/* Chatham House to nie odznaka-ozdoba, tylko reguła, która zmienia
                sposób pisania - dlatego stoi przy nazwie, a nie w stopce. */}
            {club.attribution_mode === "chatham" ? (
              <Badge variant="outline" className="gap-1 rounded-lg text-[11px]">
                <ShieldQuestion className="h-3 w-3" aria-hidden="true" />
                {t("club.attribution.chatham")}
              </Badge>
            ) : null}
          </div>

          <h1 className="mt-1.5 text-xl font-semibold leading-tight sm:text-2xl lg:text-3xl">
            {name}
          </h1>

          {tagline !== null && tagline.trim() !== "" ? (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{tagline}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ClubStatPill
              icon={Users2}
              value={formatNumber(club.member_count, locale)}
              label={t("club.hub.identity.members")}
            />
            <ClubStatPill
              icon={MessagesSquare}
              value={formatNumber(club.thread_count, locale)}
              label={t("club.hub.identity.threads")}
            />
          </div>
        </div>

        {/* JEDNA akcja pierwszoplanowa. Wcześniej w tym miejscu stało siedem
            przycisków o równej wadze, czyli żaden nie był następnym krokiem. */}
        <div className="flex w-full items-center gap-2 [&>*]:flex-1 sm:w-auto sm:shrink-0 sm:flex-wrap sm:pb-0.5 sm:[&>*]:flex-none">
          {club.can_post_thread ? (
            // Jedyne miejsce w klubie, gdzie wraca marka - reszta modułu jest
            // neutralna, więc to CTA realnie prowadzi wzrok.
            <Button asChild size="sm" className="club-accent rounded-lg">
              <Link to="/club/$clubSlug/new" params={{ clubSlug: club.slug }}>
                <PenLine className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t("club.newThread")}
              </Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline" className="rounded-lg">
            <Link to="/club/$clubSlug/about" params={{ clubSlug: club.slug }}>
              {t("club.about")}
            </Link>
          </Button>
        </div>
      </div>

      {/* Powód informacyjny mówi się PRZED napisaniem, nie po odrzuceniu wpisu. */}
      {club.reason === "pre_moderation" ? (
        <p className="border-t border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-200 sm:px-5">
          {t("club.reason.pre_moderation")}
        </p>
      ) : null}
    </header>
  );
}
