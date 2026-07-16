// Live preview panel embedding the actual layout component with mock data,
// so the admin sees the effect of every setting change in real time.
import { useTranslation } from "react-i18next";
import { getLayoutComponent } from "@/components/archive/layouts/registry";
import type { ArchiveLayoutSettings, ArchiveType } from "@/lib/archive-layout-settings";
import type { BlogListItem } from "@/lib/queries/public";

interface Props {
  archiveType: ArchiveType;
  settings: ArchiveLayoutSettings;
  lang: "pl" | "en";
}

function mockPosts(lang: "pl" | "en"): BlogListItem[] {
  const titles =
    lang === "en"
      ? [
          "Europe rethinks its defence posture",
          "New sanctions on the eastern front",
          "Energy security beyond 2030",
          "The next round of enlargement",
          "Cyber-resilience of critical infrastructure",
          "Strategic autonomy revisited",
          "Rare earths and the green transition",
          "Baltic security after the summit",
        ]
      : [
          "Europa przemyśla postawę obronną",
          "Nowe sankcje na wschodnim froncie",
          "Bezpieczeństwo energetyczne po 2030",
          "Kolejna runda rozszerzenia",
          "Cyber-odporność infrastruktury krytycznej",
          "Strategiczna autonomia raz jeszcze",
          "Metale rzadkie a zielona transformacja",
          "Bezpieczeństwo bałtyckie po szczycie",
        ];
  return titles.map((title, i) => ({
    id: `preview-${i}`,
    slug: `preview-${i}`,
    title_pl: title,
    title_en: title,
    excerpt_pl:
      lang === "en"
        ? "Short excerpt used only for the admin preview."
        : "Krótki fragment użyty tylko w podglądzie.",
    excerpt_en: "Short excerpt used only for the admin preview.",
    cover_image_url: null,
    published_at: new Date(Date.now() - i * 86400_000).toISOString(),
    parent_page_id: "preview",
    href: "#preview",
  }));
}

export function ArchiveLivePreview({ archiveType, settings, lang }: Props) {
  const { t } = useTranslation();
  const LayoutComponent = getLayoutComponent(settings.layout_variant);
  const allPosts = mockPosts(lang);
  const posts = allPosts.slice(0, Math.max(1, Math.min(settings.posts_per_page, allPosts.length)));
  const name =
    archiveType === "category"
      ? lang === "en"
        ? "Sample category"
        : "Przykładowa kategoria"
      : lang === "en"
        ? "sample-tag"
        : "przyklad-tag";
  const description =
    lang === "en"
      ? "This is a live preview populated with mock posts. Toggle settings above to see the effect immediately."
      : "To jest podgląd na żywo z przykładowymi wpisami. Zmień ustawienia powyżej, aby zobaczyć efekt.";

  const podcastsMock = settings.show_podcasts ? (
    <div className="pt-10 mt-10 border-t border-border">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        {lang === "en" ? "Podcasts" : "Podcasty"}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card/60 p-4 flex gap-3 items-center"
          >
            <div className="h-14 w-14 rounded-md bg-muted shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                {lang === "en" ? `Sample episode ${i + 1}` : `Odcinek przykładowy ${i + 1}`}
              </div>
              <div className="text-xs text-muted-foreground">
                {lang === "en" ? "Mock preview" : "Podgląd"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("archiveLayout.livePreview", { defaultValue: lang === "en" ? "Live preview" : "Podgląd na żywo" })}
        </h2>
        <span className="text-xs text-muted-foreground">
          {t("archiveLayout.livePreviewHint", {
            defaultValue:
              lang === "en"
                ? "Changes are visible before saving"
                : "Zmiany są widoczne przed zapisaniem",
          })}
        </span>
      </div>
      <div
        className="rounded-xl border border-border overflow-hidden shadow-sm bg-linear-to-br from-muted/40 via-background to-muted/20 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900"
        aria-label={
          lang === "en" ? "Archive layout live preview" : "Podgląd układu archiwum"
        }
      >
        <div
          className="pointer-events-none select-none max-h-[680px] overflow-auto"
          // Layout components use full-viewport sections; a fixed max height
          // keeps the preview compact without breaking their internal grid.
        >
          <LayoutComponent
            kind={archiveType}
            taxonomy={{
              id: "preview",
              slug: "preview",
              name_pl: name,
              name_en: name,
              description_pl: description,
              description_en: description,
              featured_section: null,
            }}
            posts={posts}
            lang={lang}
            settings={settings}
            page={1}
            pageSize={settings.posts_per_page}
            total={posts.length}
            sort="newest"
            onPageChange={() => undefined}
            onSortChange={() => undefined}
            isPending={false}
            emptyText={lang === "en" ? "No posts." : "Brak wpisów."}
            previewMode
            extraBelow={podcastsMock}
          />
        </div>
      </div>
    </section>
  );
}
