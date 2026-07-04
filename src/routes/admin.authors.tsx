import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useRequiredTenant } from "@/hooks/useAuth";
import { ExternalLink, User as UserIcon, Search } from "lucide-react";

export const Route = createFileRoute("/admin/authors")({
  component: Authors,
});

type Role = "super_admin" | "admin" | "editor" | "author" | "user";

interface AuthorRow {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  slug: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  roles: Role[];
  posts_count: number;
}

const AUTHOR_ROLES = new Set<Role>(["author", "editor", "admin", "super_admin"]);

function Authors() {
  const { t, i18n } = useTranslation();
  const tenantId = useRequiredTenant();
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-authors", tenantId],
    queryFn: async (): Promise<AuthorRow[]> => {
      const { data: rows, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      const authors = (rows ?? [])
        .map((r) => ({ ...r, roles: (r.roles ?? []) as Role[] }))
        .filter((r) => r.roles.some((role) => AUTHOR_ROLES.has(role)));

      // Fetch published-posts count per author in one call.
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
      return authors.map((a) => ({ ...a, posts_count: counts.get(a.id) ?? 0 }));
    },
  });

  const filtered = useMemo(() => {
    const list = data ?? [];
    const term = q.trim().toLowerCase();
    const base = term
      ? list.filter(
          (a) =>
            (a.display_name ?? "").toLowerCase().includes(term) ||
            (a.email ?? "").toLowerCase().includes(term) ||
            (a.slug ?? "").toLowerCase().includes(term),
        )
      : list;
    return [...base].sort(
      (a, b) =>
        b.posts_count - a.posts_count ||
        (a.display_name ?? "").localeCompare(b.display_name ?? "", undefined, {
          sensitivity: "base",
        }),
    );
  }, [data, q]);

  const label = (key: string, pl: string, en: string) =>
    t(key, { defaultValue: i18n.language === "pl" ? pl : en });

  return (
    <div>
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold">
            {label("admin.authors.title", "Autorzy", "Authors")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {label(
              "admin.authors.subtitle",
              "Agregacja profili autorów - podgląd bio, socials i liczby publikacji.",
              "Aggregated author profiles - bio, socials and publication counts.",
            )}
          </p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={label("admin.authors.search", "Szukaj autora...", "Search authors...")}
            className="pl-8"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          {label("admin.loading", "Ładowanie...", "Loading...")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {label("admin.authors.empty", "Brak autorów.", "No authors yet.")}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((a) => {
            const bio = (i18n.language === "en" ? a.bio_en : a.bio_pl) ?? a.bio_pl ?? a.bio_en;
            return (
              <article
                key={a.id}
                className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3"
              >
                <div className="flex items-start gap-3">
                  {a.avatar_url ? (
                    <img
                      src={a.avatar_url}
                      alt={a.display_name ?? ""}
                      className="w-14 h-14 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                      <UserIcon className="w-6 h-6" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-foreground truncate">
                      {a.display_name ?? "-"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{a.email}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.roles.map((r) => (
                        <Badge key={r} variant="secondary" className="text-[10px]">
                          {r}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                {bio && <p className="text-sm text-muted-foreground line-clamp-3 m-0">{bio}</p>}
                <div className="mt-auto flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {a.posts_count}{" "}
                    {i18n.language === "pl"
                      ? a.posts_count === 1
                        ? "wpis"
                        : a.posts_count < 5 && a.posts_count > 1
                          ? "wpisy"
                          : "wpisów"
                      : a.posts_count === 1
                        ? "post"
                        : "posts"}
                  </span>
                  <div className="flex items-center gap-2">
                    <Link to="/admin/users" className="text-primary hover:underline">
                      {label("admin.authors.manage", "Zarządzaj", "Manage")}
                    </Link>
                    {a.slug && (
                      <a
                        href={`/author/${a.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {label("admin.authors.viewPublic", "Profil", "Profile")}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
