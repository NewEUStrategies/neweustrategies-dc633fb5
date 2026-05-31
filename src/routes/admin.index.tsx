import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FileText, FolderTree, Tags, Image as ImageIcon } from "@/lib/lucide-shim";

export const Route = createFileRoute("/admin/")({
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const [posts, cats, tags, media] = await Promise.all([
        supabase.from("posts").select("id, status", { count: "exact", head: false }),
        supabase.from("categories").select("id", { count: "exact", head: true }),
        supabase.from("tags").select("id", { count: "exact", head: true }),
        supabase.from("media").select("id", { count: "exact", head: true }),
      ]);
      return {
        posts: posts.data?.length ?? 0,
        published: posts.data?.filter((p) => p.status === "published").length ?? 0,
        drafts: posts.data?.filter((p) => p.status === "draft").length ?? 0,
        categories: cats.count ?? 0,
        tags: tags.count ?? 0,
        media: media.count ?? 0,
      };
    },
  });

  const cards = [
    { to: "/admin/posts", icon: FileText, label: t("admin.nav.posts"), value: data?.posts ?? 0, sub: `${data?.published ?? 0} ${t("admin.published")} · ${data?.drafts ?? 0} ${t("admin.drafts")}` },
    { to: "/admin/categories", icon: FolderTree, label: t("admin.nav.categories"), value: data?.categories ?? 0 },
    { to: "/admin/tags", icon: Tags, label: t("admin.nav.tags"), value: data?.tags ?? 0 },
    { to: "/admin/media", icon: ImageIcon, label: t("admin.nav.media"), value: data?.media ?? 0 },
  ];

  return (
    <div>
      <h1 className="font-display text-3xl font-bold mb-2">{t("admin.dashboard.title")}</h1>
      <p className="text-muted-foreground mb-8">{t("admin.dashboard.subtitle")}</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Link key={c.to} to={c.to} className="bg-card border border-border rounded-lg p-5 hover:border-brand transition">
            <c.icon className="w-6 h-6 text-brand mb-3" />
            <div className="text-3xl font-bold font-display">{c.value}</div>
            <div className="text-sm font-medium mt-1">{c.label}</div>
            {c.sub && <div className="text-xs text-muted-foreground mt-2">{c.sub}</div>}
          </Link>
        ))}
      </div>
    </div>
  );
}
