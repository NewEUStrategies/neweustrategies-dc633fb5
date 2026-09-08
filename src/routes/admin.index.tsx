import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FileText, FolderTree, Tags, Image as ImageIcon } from "@/lib/lucide-shim";
import { useRequiredTenant } from "@/hooks/useAuth";
import { AdminBiStrip } from "@/components/admin/analytics/AdminBiStrip";

export const Route = createFileRoute("/admin/")({
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslation();
  const tenantId = useRequiredTenant();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["admin-stats", tenantId],
    queryFn: async () => {
      // Count on the server: PostgREST limits returned rows, so array.length
      // silently capped the dashboard at the API page size. HEAD avoids
      // transferring every post just to count it. RLS remains authoritative.
      const count = (table: "posts" | "categories" | "tags" | "media") =>
        supabase.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
      const countPosts = () =>
        supabase
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .is("deleted_at", null);
      const [posts, published, drafts, cats, tags, media] = await Promise.all([
        countPosts(),
        countPosts().eq("status", "published"),
        countPosts().eq("status", "draft"),
        count("categories"),
        count("tags"),
        count("media"),
      ]);
      for (const result of [posts, published, drafts, cats, tags, media]) {
        if (result.error) throw result.error;
        if (result.count == null) throw new Error("Dashboard count missing from database response");
      }
      return {
        posts: posts.count!,
        published: published.count!,
        drafts: drafts.count!,
        categories: cats.count!,
        tags: tags.count!,
        media: media.count!,
      };
    },
  });

  const cards = [
    {
      to: "/admin/posts",
      icon: FileText,
      label: t("admin.nav.posts"),
      value: data?.posts ?? 0,
      sub: `${data?.published ?? 0} ${t("admin.published")} · ${data?.drafts ?? 0} ${t("admin.drafts")}`,
    },
    {
      to: "/admin/categories",
      icon: FolderTree,
      label: t("admin.nav.categories"),
      value: data?.categories ?? 0,
    },
    { to: "/admin/tags", icon: Tags, label: t("admin.nav.tags"), value: data?.tags ?? 0 },
    { to: "/admin/media", icon: ImageIcon, label: t("admin.nav.media"), value: data?.media ?? 0 },
  ];

  return (
    <div data-theme-typography>
      <h1 className="font-display text-xl font-bold mb-1">{t("admin.dashboard.title")}</h1>
      <p className="text-xs text-muted-foreground mb-4">{t("admin.dashboard.subtitle")}</p>
      {isPending && <p role="status">{t("admin.loading")}</p>}
      {isError && (
        <div role="alert">
          <p>{t("admin.dashboard.loadError")}</p>
          <button type="button" onClick={() => void refetch()}>
            {t("admin.dashboard.retry")}
          </button>
        </div>
      )}
      {data && !isError && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {cards.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className="bg-card border border-border rounded-md p-3 hover:border-brand transition"
            >
              <c.icon
                className="w-4 h-4 mb-1.5"
                style={{ color: "var(--gc-icon, var(--gc-highlight, var(--brand)))" }}
              />
              <div className="text-xl font-bold font-display leading-tight">{c.value}</div>
              <div className="text-[12px] font-medium mt-0.5">{c.label}</div>
              {c.sub && <div className="text-[10px] text-muted-foreground mt-1">{c.sub}</div>}
            </Link>
          ))}
        </div>
      )}

      {/* Analityka modułu 17 - realne dane RUM + błędy przeglądarki */}
      <AdminBiStrip days={14} className="mt-6" />
    </div>
  );
}
