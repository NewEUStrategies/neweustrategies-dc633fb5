// Shared header block used by multiple archive layouts.
import { useTranslation } from "react-i18next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowButton } from "@/components/FollowButton";
import { HeroBackground } from "./heroBackgrounds";
import type { ArchiveLayoutSettings } from "@/lib/archive-layout-settings";

interface Props {
  kind: "category" | "tag";
  taxonomyId: string;
  name: string;
  description: string | null;
  lang: "pl" | "en";
  settings: ArchiveLayoutSettings;
  variant?: "default" | "compact" | "wide";
}

export function ArchiveHeader({
  kind,
  taxonomyId,
  name,
  description,
  lang,
  settings,
  variant = "default",
}: Props) {
  const { t } = useTranslation();
  const crumbLabel =
    kind === "category"
      ? t("archiveLayout.breadcrumbs.categories")
      : t("archiveLayout.breadcrumbs.tags");
  const displayName = kind === "tag" ? `#${name}` : name;
  const isWide = variant === "wide";
  const isCompact = variant === "compact";

  return (
    <header
      className={`relative ${isWide ? "py-14 lg:py-20" : isCompact ? "py-6" : "py-10"} overflow-hidden`}
    >
      {settings.show_hero && <HeroBackground style={settings.hero_bg_style} />}
      <div className="max-w-[1200px] mx-auto px-4 lg:px-8">
        {settings.show_breadcrumbs && (
          <Breadcrumbs
            items={[
              { label: crumbLabel, href: kind === "category" ? "/blog" : "/blog" },
              { label: displayName },
            ]}
          />
        )}
        {settings.show_hero && (
          <>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{crumbLabel}</p>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <h1
                className={`font-display ${isWide ? "text-4xl lg:text-5xl" : "text-3xl lg:text-4xl"}`}
              >
                {displayName}
              </h1>
              {settings.show_follow && (
                <FollowButton targetType={kind} targetId={taxonomyId} lang={lang} />
              )}
            </div>
            {settings.show_description && description && (
              <p className="text-muted-foreground mt-3 max-w-2xl">{description}</p>
            )}
          </>
        )}
      </div>
    </header>
  );
}
