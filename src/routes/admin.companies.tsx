// Admin: lista firm CRM (`crm_companies`). Widok read-only z wyszukiwarką.
// Klik w wiersz otwiera `/admin/companies/:id`. Zabezpieczone przez
// `requireStaff` w server-fn oraz `_authenticated` layout w AdminShell.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";

import { listCrmCompanies } from "@/lib/crm-companies.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Building2, Search, ChevronRight, ExternalLink } from "lucide-react";

type CompanyRow = {
  id: string;
  name: string;
  domain: string | null;
  country: string | null;
  branch: string | null;
  city: string | null;
  website: string | null;
  phone: string | null;
  updated_at: string;
};

export const Route = createFileRoute("/admin/companies")({
  head: () => ({
    meta: [
      { title: "Firmy CRM | Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminCompaniesPage,
});

function AdminCompaniesPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const listFn = useServerFn(listCrmCompanies);

  const query = useQuery({
    queryKey: ["admin", "crm-companies", search],
    queryFn: async () => {
      const res = await listFn({ data: { search: search || undefined, limit: 200 } });
      return JSON.parse(res.json) as CompanyRow[];
    },
    staleTime: 30_000,
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4">
      <header className="flex items-center gap-3">
        <Building2 className="h-5 w-5 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">
          {lang === "pl" ? "Firmy CRM" : "CRM companies"}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/admin/crm">
            <Button variant="ghost" size="sm">
              {lang === "pl" ? "Wróć do CRM" : "Back to CRM"}
            </Button>
          </Link>
        </div>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={lang === "pl" ? "Szukaj firmy, domeny, miasta…" : "Search company, domain, city…"}
          className="pl-9"
          aria-label={lang === "pl" ? "Szukaj firmy" : "Search company"}
        />
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        {query.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">
            {lang === "pl" ? "Ładowanie…" : "Loading…"}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            {lang === "pl" ? "Brak firm." : "No companies."}
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => navigate({ to: "/admin/companies/$id", params: { id: c.id } })}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/60 focus:bg-muted focus:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 truncate font-medium">
                      {c.name}
                      {c.website && (
                        <a
                          href={c.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                          aria-label={c.website}
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[c.domain, c.branch, [c.city, c.country].filter(Boolean).join(", ")]
                        .filter(Boolean)
                        .join(" - ") || (lang === "pl" ? "Brak metadanych" : "No metadata")}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
