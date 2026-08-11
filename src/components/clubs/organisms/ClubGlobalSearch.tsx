// Wyszukiwanie PONAD klubami na stronie głównej.
//
// `club_search` przyjmował `p_club_id` jako opcjonalny od etapu A6 i cały czas
// umiał szukać po wszystkich klubach naraz - tylko nikt go tak nie wołał.
// Strona klubu podawała swoje id, więc jedyną drogą do wątku sprzed pół roku
// było przypomnienie sobie, w którym klubie się odbył.
//
// Widoczność liczy RPC per wiersz (club_capabilities), więc wynik z klubu
// `secret`, do którego nie należę, nie istnieje - a nie "istnieje i jest
// ukryty". To ta sama doktryna, co pusta lista zamiast 403.
//
// Wyniki ZASTĘPUJĄ strumień aktywności zamiast stawać obok niego: dwie listy
// naraz na telefonie znaczą, że czytelnik nie wie, którą czyta.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Clock, MessageSquare, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import type { ClubSearchResult } from "@/lib/clubs/types";
import { formatDateShort } from "@/lib/i18n/format";

export function ClubGlobalSearchInput({
  value,
  onChange,
  placeholderKey = "club.hub.searchPlaceholder",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Strona klubu szuka W KLUBIE, hub - ponad klubami; poza etykietą pola
   *  kontrolka jest identyczna, więc różni je jeden klucz, a nie kopia. */
  placeholderKey?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(placeholderKey)}
        aria-label={t(placeholderKey)}
        className="pl-9 pr-11 !bg-transparent dark:!bg-transparent shadow-none border-[color:var(--cp-line,var(--border))] focus-visible:border-[color:var(--cp-gold,var(--ring))]"
      />
      {value !== "" ? (
        // Prymityw `Button`, nie gołe `<button>`: to on dokłada
        // `pointer-coarse:min-h-11`, czyli cel dotykowy 44 px wymagany przez
        // regułę repo (WCAG 2.5.5), oraz spójny pierścień focus-visible.
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => onChange("")}
          aria-label={t("club.searchClear")}
          className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

export function ClubGlobalSearchResults({
  hits,
  pending,
  failed,
  query,
  isPl,
  onRetry,
}: {
  hits: readonly ClubSearchResult[];
  pending: boolean;
  /** Awaria RPC. Bez tego "brak wyników" i "nie udało się szukać" wyglądają
   *  identycznie, a to są dwie zupełnie różne informacje dla czytelnika. */
  failed?: boolean;
  query: string;
  isPl: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();

  if (failed === true) {
    return <ClubErrorNotice compact onRetry={onRetry} />;
  }

  if (pending) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/50" />
        ))}
      </div>
    );
  }

  if (hits.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          {t("club.searchEmpty", { query })}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Wyniki ZASTĘPUJĄ strumień, a zmiana zachodzi po debounce, gdy fokus
          został w polu - bez regionu live czytnik ekranu nie ogłasza niczego. */}
      <p aria-live="polite" className="mb-2 text-xs text-muted-foreground">
        {t("club.hub.searchCount", { count: hits.length })}
      </p>
      <ul className="space-y-2">
        {hits.map((hit) => (
          <li key={hit.thread_id}>
            <Link
              to="/club/$clubSlug/t/$threadSlug"
              params={{ clubSlug: hit.club_slug, threadSlug: hit.thread_slug }}
              className="block rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="flex flex-wrap items-center gap-2">
                {/* Nazwa klubu PRZED tytułem: przy szukaniu ponad klubami to
                    ona mówi czytelnikowi, gdzie właściwie trafił. */}
                <span className="text-xs font-medium text-primary">
                  {isPl ? hit.club_name_pl : hit.club_name_en}
                </span>
                <Badge variant="outline" className="text-[11px]">
                  {t(`club.kind.${hit.kind}`)}
                </Badge>
              </div>
              <h3 className="mt-1 font-medium leading-snug">{hit.title}</h3>
              {/* Fragment jest DOWODEM trafienia, więc warstwa semantyczna,
                  która go nie ma, musi powiedzieć wprost, czemu wiersz tu jest.
                  Bez tego czytelnik szuka swojej frazy w tytule, nie znajduje
                  jej i uznaje wynik za pomyłkę wyszukiwarki. */}
              {hit.snippet !== null && hit.snippet !== "" ? (
                // ts_headline zwraca fragment ze znacznikami <b>. Renderujemy go
                // jako TEKST po zdjęciu znaczników - wstrzykiwanie HTML z bazy
                // do listy wyników nie jest tego warte.
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {hit.snippet.replace(/<\/?b>/g, "")}
                </p>
              ) : hit.match === "semantic" ? (
                <p className="mt-1 text-xs italic text-muted-foreground">
                  {t("club.searchSemanticHit")}
                </p>
              ) : null}
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  {hit.reply_count}
                </span>
                {hit.last_reply_at !== null ? (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDateShort(hit.last_reply_at, isPl ? "pl" : "en")}
                  </span>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
