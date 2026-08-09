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
import { MessagesSquare, PenLine, ShieldQuestion, Users2 } from "lucide-react";
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
          w pionie - to nagłówek, nie hero. */}
      <div className="relative h-24 w-full sm:h-32 lg:h-40">
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
          <div
            className="h-full w-full bg-gradient-to-br from-primary/25 via-primary/10 to-transparent"
            aria-hidden="true"
          />
        )}
        {/* Cienki gradient tylko przy DOLNEJ krawędzi - domyka pas w kartę,
            zamiast przyciemniać całe zdjęcie. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent"
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

      <div className="relative flex flex-wrap items-end gap-3 px-4 pb-4 sm:gap-4 sm:px-5 sm:pb-5">
        {/* Monogram wchodzi na okładkę - kotwiczy pas w treści. */}
        <div
          className="-mt-8 flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-lg font-semibold text-primary shadow-sm sm:-mt-10 sm:h-20 sm:w-20 sm:text-xl"
          aria-hidden="true"
        >
          {monogram(name)}
        </div>

        <div className="min-w-0 flex-1 pt-2">
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 pb-0.5">
          {club.can_post_thread ? (
            <Button asChild size="sm" className="rounded-lg">
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
