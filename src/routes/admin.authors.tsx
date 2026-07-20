// Panel administracyjny „Autorzy" (== eksperci). Widok w layoucie think-tank,
// spójny wizualnie z publicznym katalogiem /experts: karty z avatarem,
// obszarami ekspertyzy, licznikiem publikacji, filtrami po obszarze i
// programie oraz odznaką „zweryfikowany". Dodatkowo elementy panelowe:
// wyszukiwarka, role, e-mail, akcje „Zarządzaj" / „Profil".
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRequiredTenant } from "@/hooks/useAuth";
import { expertsDirectoryQueryOptions } from "@/lib/experts/directory";
import { adminUsersQueryOptions, type AdminRole } from "@/lib/admin/users-query";
import { BadgeCheck, ExternalLink, Search, Users } from "lucide-react";
import { ensureI18n as ensureExpertsI18n } from "@/lib/i18n-experts";
export const Route = createFileRoute("/admin/authors")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(expertsDirectoryQueryOptions());
    return null;
  },
  component: Authors,
});

type Role = AdminRole;

interface AuthorRow {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  slug: string | null;
  roles: Role[];
  posts_count: number;
}

const AUTHOR_ROLES = new Set<Role>(["author", "editor", "admin", "super_admin"]);
const ALL = "__all__";

function Authors() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureExpertsI18n();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const tenantId = useRequiredTenant();
  const [q, setQ] = useState("");
  const [areaSlug, setAreaSlug] = useState<string | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);

  const { data: directory } = useSuspenseQuery(expertsDirectoryQueryOptions());

  // Wspólny cache z /admin/users - obie strony aktualizują się razem po
  // imporcie zespołu, zaproszeniach czy zmianie ról.
  const { data: allUsers } = useQuery(adminUsersQueryOptions(tenantId));

  const { data: rows, isLoading } = useQuery({
    queryKey: ["admin-authors-posts", tenantId, (allUsers ?? []).length],
    enabled: !!allUsers,
    queryFn: async (): Promise<AuthorRow[]> => {
      const authors = (allUsers ?? []).filter((r) =>
        r.roles.some((role) => AUTHOR_ROLES.has(role)),
      );
      const ids = authors.map((a) => a.id);
      const counts = new Map<string, number>();
      if (ids.length > 0) {
        const { data: postRows } = await supabase
          .from("posts")
          .select("author_id")
          .in("author_id", ids)
          .eq("status", "published")
          .is("deleted_at", null);
        for (const row of postRows ?? []) {
          const key = (row as { author_id: string | null }).author_id ?? "";
          if (!key) continue;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      return authors.map((a) => ({
        id: a.id,
        display_name: a.display_name,
        email: a.email,
        avatar_url: a.avatar_url,
        slug: a.slug,
        roles: a.roles,
        posts_count: counts.get(a.id) ?? 0,
      }));
    },
  });

  const expertById = useMemo(
    () => new Map(directory.experts.map((e) => [e.id, e] as const)),
    [directory.experts],
  );

  const areaId = useMemo(
    () => directory.facets.areas.find((a) => a.slug === areaSlug)?.id ?? null,
    [directory.facets.areas, areaSlug],
  );

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const term = q.trim().toLowerCase();
    return list
      .filter((a) => {
        if (term) {
          const hay = `${a.display_name ?? ""} ${a.email ?? ""} ${a.slug ?? ""}`.toLowerCase();
          if (!hay.includes(term)) return false;
        }
        const ex = expertById.get(a.id);
        if (areaId && !ex?.areas.some((x) => x.id === areaId)) return false;
        if (programId && !ex?.programs.some((p) => p.id === programId)) return false;
        return true;
      })
      .sort(
        (a, b) =>
          b.posts_count - a.posts_count ||
          (a.display_name ?? "").localeCompare(b.display_name ?? "", undefined, {
            sensitivity: "base",
          }),
      );
  }, [rows, q, areaId, programId, expertById]);

  const label = (key: string, pl: string, en: string) =>
    t(key, { defaultValue: lang === "pl" ? pl : en });

  const hasActiveFilters = areaSlug !== null || programId !== null || q.trim().length > 0;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl">
            {label("admin.authors.title", "Autorzy", "Authors")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {label(
              "admin.authors.subtitle",
              "Zespół ekspertów i redakcji - profile, obszary ekspertyzy i publikacje.",
              "Experts and editorial team - profiles, areas of expertise and publications.",
            )}
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search
            className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={label("admin.authors.search", "Szukaj autora...", "Search authors...")}
            className="pl-8"
          />
        </div>
      </header>

      {(directory.facets.areas.length > 0 || directory.facets.programs.length > 0) && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {directory.facets.areas.length > 0 && (
            <Select
              value={areaSlug ?? ALL}
              onValueChange={(next) => setAreaSlug(next === ALL ? null : next)}
            >
              <SelectTrigger
                aria-label={t("expert.filterArea")}
                className="h-9 w-auto min-w-[160px] max-w-[240px] rounded-[6px] bg-muted/30 text-xs"
              >
                <SelectValue placeholder={t("expert.allAreas")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("expert.allAreas")}</SelectItem>
                {directory.facets.areas.map((a) => (
                  <SelectItem key={a.id} value={a.slug}>
                    {lang === "en" ? a.name_en : a.name_pl}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {directory.facets.programs.length > 0 && (
            <Select
              value={programId ?? ALL}
              onValueChange={(next) => setProgramId(next === ALL ? null : next)}
            >
              <SelectTrigger
                aria-label={t("expert.filterProgram")}
                className="h-9 w-auto min-w-[160px] max-w-[240px] rounded-[6px] bg-muted/30 text-xs"
              >
                <SelectValue placeholder={t("expert.allPrograms")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("expert.allPrograms")}</SelectItem>
                {directory.facets.programs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {lang === "en" ? p.name_en : p.name_pl}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 text-xs"
              onClick={() => {
                setAreaSlug(null);
                setProgramId(null);
                setQ("");
              }}
            >
              {t("expert.clearFilters")}
            </Button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          {label("admin.loading", "Ładowanie...", "Loading...")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[8px] border border-dashed border-border/70 p-12 text-center">
          <Users className="h-6 w-6 text-muted-foreground/50" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {hasActiveFilters
              ? t("expert.directoryEmptyFiltered")
              : label("admin.authors.empty", "Brak autorów.", "No authors yet.")}
          </p>
        </div>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a) => {
            const ex = expertById.get(a.id);
            const target = a.slug ?? a.id;
            const role = ex ? [ex.job_title, ex.company].filter(Boolean).join(" · ") : null;
            return (
              <li
                key={a.id}
                className="flex flex-col gap-3 rounded-[10px] border border-border/60 bg-card p-4 transition-colors hover:border-border"
              >
                <div className="flex items-start gap-3">
                  {a.avatar_url ? (
                    <img
                      src={a.avatar_url}
                      alt=""
                      className="h-14 w-14 rounded-[5px] object-cover"
                    />
                  ) : (
                    <div className="grid h-14 w-14 place-items-center rounded-[5px] bg-muted text-sm text-muted-foreground">
                      {(a.display_name ?? "?").slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate font-semibold">
                      {a.display_name ?? "-"}
                      {ex?.verified_at && (
                        <BadgeCheck
                          className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400"
                          aria-hidden
                        />
                      )}
                    </p>
                    {role ? (
                      <p className="truncate text-xs text-muted-foreground">{role}</p>
                    ) : a.email ? (
                      <p className="truncate text-xs text-muted-foreground">{a.email}</p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.roles.map((r) => (
                        <Badge key={r} variant="secondary" className="text-[10px]">
                          {r}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                {ex && ex.areas.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {ex.areas.slice(0, 3).map((area) => (
                      <span
                        key={area.id}
                        className="rounded-full border border-[var(--brand)]/25 bg-[var(--brand)]/5 px-2 py-0.5 text-[11px] text-foreground/80"
                      >
                        {lang === "en" ? area.name_en : area.name_pl}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="text-xs text-muted-foreground">
                    {t("expert.publicationsCount", { count: a.posts_count })}
                  </span>
                  <div className="flex items-center gap-3 text-xs">
                    <Link to="/admin/users" className="font-medium text-primary hover:underline">
                      {label("admin.authors.manage", "Zarządzaj", "Manage")}
                    </Link>
                    {a.slug && (
                      <Link
                        to="/author/$slug"
                        params={{ slug: target }}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                      >
                        {t("expert.viewProfile")}
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
