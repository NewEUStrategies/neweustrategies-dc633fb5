import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "@tanstack/react-router";
import { Link as LinkIcon } from "@/lib/lucide-shim";
import type { MediaUsageArea, MediaUsageItem } from "@/lib/media.functions";

interface MediaUsageListProps {
  isLoading: boolean;
  error: unknown;
  items: MediaUsageItem[] | undefined;
}

/**
 * Molecule: renders where a media asset is used (posts / pages), with a deep
 * link into each editor. Handles loading / error / empty / list states.
 */
export function MediaUsageList({ isLoading, error, items }: MediaUsageListProps) {
  const { t } = useTranslation();
  const list = items ?? [];

  const areaLabel = (a: MediaUsageArea): string => {
    const map: Record<MediaUsageArea, string> = {
      cover: t("admin.media.usage.cover", { defaultValue: "Okładka" }),
      excerpt: t("admin.media.usage.excerpt", { defaultValue: "Zajawka" }),
      content: t("admin.media.usage.content", { defaultValue: "Treść" }),
      builder: t("admin.media.usage.builder", { defaultValue: "Builder" }),
      blocks: t("admin.media.usage.blocks", { defaultValue: "Bloki" }),
      layout: t("admin.media.usage.layout", { defaultValue: "Layout" }),
    };
    return map[a];
  };

  return (
    <div className="p-3 text-xs">
      {isLoading && (
        <p className="text-muted-foreground">
          {t("admin.loading", { defaultValue: "Ładowanie…" })}
        </p>
      )}
      {error != null && (
        <p className="text-destructive">{error instanceof Error ? error.message : String(error)}</p>
      )}
      {!isLoading && error == null && list.length === 0 && (
        <p className="text-muted-foreground">
          {t("admin.media.notUsed", {
            defaultValue: "Ten materiał nie jest jeszcze używany w żadnym poście ani stronie.",
          })}
        </p>
      )}
      {list.length > 0 && (
        <ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
          {list.map((it) => (
            <li key={`${it.kind}-${it.id}`} className="p-2 hover:bg-muted/40 flex flex-col gap-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate" title={it.title}>
                    {it.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1 flex-wrap">
                    <span className="uppercase font-semibold">
                      {it.kind === "post"
                        ? t("admin.media.post", { defaultValue: "Post" })
                        : t("admin.media.page", { defaultValue: "Strona" })}
                    </span>
                    <span>·</span>
                    <span className="truncate">/{it.slug}</span>
                  </div>
                </div>
                <RouterLink
                  to={it.kind === "post" ? "/admin/posts/$slug" : "/admin/pages/$slug"}
                  params={{ slug: it.slug }}
                  className="shrink-0 inline-flex items-center gap-1 text-brand hover:underline"
                  title={t("admin.edit", { defaultValue: "Edytuj" })}
                >
                  {t("admin.edit", { defaultValue: "Edytuj" })}
                  <LinkIcon className="w-3 h-3" />
                </RouterLink>
              </div>
              <div className="flex flex-wrap gap-1">
                {it.where.map((a) => (
                  <span
                    key={a}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide"
                  >
                    {areaLabel(a)}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
