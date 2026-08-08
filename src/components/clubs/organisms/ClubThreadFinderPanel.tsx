// Organizm: panel „Szukaj" - wyszukiwarka WEWNĄTRZ wątku.
//
// Wyszukiwarka klubowa (`ClubGlobalSearch`) odpowiada na pytanie „w KTÓRYM
// wątku o tym mówiono". Ta odpowiada na inne: „GDZIE W TYM wątku". Po trzech
// miesiącach i dwustu wypowiedziach to jest różnica między odnalezieniem
// ustalenia a przeczytaniem całości od nowa.
//
// Wpisywanie NIE strzela zapytaniem na każdą literę: `useDeferredValue`
// oddaje frazę dopiero wtedy, gdy React ma chwilę wolnego, a hook odcina
// wszystko poniżej dwóch znaków. Jedna litera pasuje do wszystkiego i kosztuje
// pełne skanowanie czterech sekcji.
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClubWorkspaceEmpty } from "@/components/clubs/atoms/ClubWorkspaceEmpty";
import { ClubSectionIcon } from "@/components/clubs/atoms/ClubEntryIcon";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubSnippet } from "@/components/clubs/molecules/ClubSnippet";
import { useClubThreadSearch } from "@/lib/clubs/useThreadWorkspace";
import { groupSearchResults } from "@/lib/clubs/threadWorkspaceTypes";
import { formatDateShort } from "@/lib/i18n/format";

export function ClubThreadFinderPanel({ threadId, lang }: { threadId: string; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const search = useClubThreadSearch({ threadId, query: deferred });

  const groups = useMemo(() => groupSearchResults(search.data ?? []), [search.data]);
  const tooShort = deferred.trim().length > 0 && deferred.trim().length < 2;
  const hasResults = groups.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="club-ws-search" className="text-sm font-medium">
          {t("club.threadHub.search.label")}
        </Label>
        <div className="relative mt-1.5">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="club-ws-search"
            type="search"
            className="pl-9"
            value={query}
            placeholder={t("club.threadHub.search.placeholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {t("club.threadHub.search.hint")}
        </p>
      </div>

      {/* Wynik ogłaszany grzecznie: `aria-live="polite"` mówi, ile znaleziono,
          bez przerywania pisania. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {hasResults
          ? t("club.threadHub.search.resultsCount", { count: search.data?.length ?? 0 })
          : ""}
      </div>

      {search.isError ? (
        <ClubErrorNotice onRetry={() => void search.refetch()} />
      ) : tooShort ? (
        <p className="text-sm text-muted-foreground">{t("club.threadHub.search.tooShort")}</p>
      ) : search.isFetching ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/50" />
          ))}
        </div>
      ) : deferred.trim().length < 2 ? (
        <ClubWorkspaceEmpty
          icon={<Search className="h-5 w-5" />}
          title={t("club.threadHub.search.idle")}
          hint={t("club.threadHub.search.idleHint")}
        />
      ) : !hasResults ? (
        <ClubWorkspaceEmpty
          icon={<Search className="h-5 w-5" />}
          title={t("club.threadHub.search.noResults", { query: deferred.trim() })}
          hint={t("club.threadHub.search.noResultsHint")}
        />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.section}>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ClubSectionIcon section={group.section} className="h-3.5 w-3.5" />
                {t(`club.threadHub.section.${group.section}`)}
                <span className="tabular-nums">({group.rows.length})</span>
              </h3>
              <ul className="space-y-2">
                {group.rows.map((row) => (
                  <li
                    key={`${row.section}-${row.item_id}`}
                    className="rounded-lg border border-border/60 bg-card p-3"
                  >
                    {row.title !== null && row.title.length > 0 ? (
                      <p className="text-sm font-medium">{row.title}</p>
                    ) : null}
                    <ClubSnippet
                      snippet={row.snippet}
                      className="mt-1 text-sm leading-relaxed text-muted-foreground"
                    />
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {row.author_label !== null ? `${row.author_label} · ` : ""}
                      {formatDateShort(row.occurred_at, lang)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
