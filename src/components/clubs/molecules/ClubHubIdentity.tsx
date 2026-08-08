// Pasek tożsamości klubu - pierwsza rzecz, którą widać po wejściu.
//
// CO SIĘ ZMIENIŁO WOBEC POPRZEDNIEJ WERSJI. Nagłówek był banerem 6:1, tytułem
// i rzędem SIEDMIU przycisków-odnóg. Rząd przycisków nie mówi, gdzie jesteś,
// a baner na pół szerokości nie mówi nic w ogóle - to jest ozdoba zajmująca
// najcenniejsze miejsce na stronie.
//
// Teraz okładka jest TŁEM paska, a nie osobnym kafelkiem: identyfikuje klub
// i nie zabiera pionu. Nad nią stoi warstwa z gradientem, żeby napis był
// czytelny niezależnie od tego, co redakcja wgrała jako okładkę - łącznie
// z jasnym zdjęciem, na którym biały tekst znikał.
//
// Klub BEZ okładki nie dostaje pustego prostokąta, tylko ten sam pasek na
// powierzchni karty. Brak zdjęcia to nie jest stan błędu.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MessagesSquare, PenLine, ShieldQuestion, Users2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClubStatPill } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubTopicChip } from "@/components/clubs/atoms/ClubTopicChip";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import type { ClubViewRow } from "@/lib/clubs/types";
import { formatNumber } from "@/lib/i18n/format";

/** Monogram klubu - dwie litery nazwy. Używany, gdy nie ma okładki. */
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
  const name = isPl ? club.name_pl : club.name_en;
  const tagline = isPl ? club.tagline_pl : club.tagline_en;
  const cover = typeof club.cover_image_url === "string" && club.cover_image_url.trim() !== "";

  return (
    <header
      className={cn("relative overflow-hidden rounded-lg border border-border/60", className)}
    >
      {cover ? (
        <>
          <img
            src={club.cover_image_url}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
          />
          {/* Dwie warstwy, nie jedna: pionowy gradient robi czytelność napisu,
              a płaskie przyciemnienie ratuje okładki bardzo jasne, na których
              sam gradient jeszcze nie wystarcza. */}
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/40"
            aria-hidden="true"
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-card" aria-hidden="true" />
      )}

      <div className="relative flex flex-wrap items-start gap-4 p-4 sm:p-5">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-primary/10 text-lg font-semibold text-primary sm:h-16 sm:w-16"
          aria-hidden="true"
        >
          {monogram(name)}
        </div>

        <div className="min-w-0 flex-1">
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
        <div className="flex shrink-0 flex-wrap items-center gap-2">
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
        <p className="relative border-t border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-200 sm:px-5">
          {t("club.reason.pre_moderation")}
        </p>
      ) : null}
    </header>
  );
}
