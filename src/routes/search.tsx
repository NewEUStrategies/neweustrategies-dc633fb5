// Public search page: /search?q=...&category=&author=&from=&to=
// Facets are derived from the match set so users can drill down.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon, X } from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArchivePostList } from "@/components/archive/ArchivePostList";
import { searchQueryOptions, type SearchFilters } from "@/lib/queries/archives";

const SearchParams = z.object({
  q: z.string().optional().default(""),
  category: z.string().optional(),
  author: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

type SearchInput = z.infer<typeof SearchParams>;

export const Route = createFileRoute("/search")({
  staticData: { ownChrome: true },
  validateSearch: (s: Record<string, unknown>): SearchInput => SearchParams.parse(s),
  head: () => ({
    meta: [
      { title: "Szukaj" },
      { name: "description", content: "Wyszukiwarka wpisów" },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const [draft, setDraft] = useState(search.q);

  useEffect(() => { setDraft(search.q); }, [search.q]);

  const filters: SearchFilters = {
    q: search.q,
    categoryId: search.category,
    authorId: search.author,
    dateFrom: search.from,
    dateTo: search.to,
  };

  const { data, isFetching } = useQuery(searchQueryOptions(filters));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({ search: (s: SearchInput) => ({ ...s, q: draft }) });
  };

  const updateFilter = (key: keyof SearchInput, value: string | undefined) => {
    navigate({ search: (s: SearchInput) => ({ ...s, [key]: value || undefined }) });
  };

  const clearAll = () => navigate({ search: { q: search.q } });

  const active =
    !!search.category || !!search.author || !!search.from || !!search.to;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
        <h1 className="font-display text-3xl lg:text-4xl mb-6">{t("search.title", { defaultValue: "Szukaj" })}</h1>
        <form onSubmit={submit} className="flex gap-2 mb-8">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("search.placeholder", { defaultValue: "Wpisz frazę..." })}
              className="pl-9"
              autoFocus
            />
          </div>
          <Button type="submit">Szukaj</Button>
        </form>

        {search.q.trim().length < 2 ? (
          <p className="text-sm text-muted-foreground">Wpisz co najmniej 2 znaki.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-8">
            <aside className="space-y-5">
              <header className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Filtry</h2>
                {active && (
                  <button onClick={clearAll} className="text-xs text-brand inline-flex items-center gap-1 hover:underline">
                    <X className="w-3 h-3" />Wyczyść
                  </button>
                )}
              </header>

              <div>
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Data</h3>
                <div className="space-y-2">
                  <label className="block text-xs">
                    Od
                    <Input
                      type="date"
                      value={search.from ?? ""}
                      onChange={(e) => updateFilter("from", e.target.value)}
                    />
                  </label>
                  <label className="block text-xs">
                    Do
                    <Input
                      type="date"
                      value={search.to ?? ""}
                      onChange={(e) => updateFilter("to", e.target.value)}
                    />
                  </label>
                </div>
              </div>

              {data && data.facets.categories.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Kategorie</h3>
                  <ul className="space-y-1 text-sm">
                    {data.facets.categories.map((c) => {
                      const isActive = search.category === c.id;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => updateFilter("category", isActive ? undefined : c.id)}
                            className={`w-full text-left flex justify-between items-center px-2 py-1 rounded ${isActive ? "bg-brand/10 text-brand" : "hover:bg-muted"}`}
                          >
                            <span className="truncate">{c.name}</span>
                            <span className="text-xs text-muted-foreground">{c.count}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {data && data.facets.authors.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Autorzy</h3>
                  <ul className="space-y-1 text-sm">
                    {data.facets.authors.map((a) => {
                      const isActive = search.author === a.id;
                      return (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => updateFilter("author", isActive ? undefined : a.id)}
                            className={`w-full text-left flex justify-between items-center px-2 py-1 rounded ${isActive ? "bg-brand/10 text-brand" : "hover:bg-muted"}`}
                          >
                            <span className="truncate">{a.name}</span>
                            <span className="text-xs text-muted-foreground">{a.count}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </aside>

            <section>
              <p className="text-sm text-muted-foreground mb-4">
                {isFetching ? "Szukam..." : `Wyników: ${data?.posts.length ?? 0}`}
              </p>
              {data && (
                <ArchivePostList
                  posts={data.posts}
                  lang={lang}
                  emptyText="Brak wyników. Spróbuj innej frazy lub zmień filtry."
                />
              )}
            </section>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
