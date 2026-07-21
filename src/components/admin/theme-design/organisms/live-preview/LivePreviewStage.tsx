// Organism (presentational): renders the body of the live post preview for the
// currently-active tab. Reads geometry from the draft and text from the
// bilingual sample copy; colors come from the scoped `--td-*` variables set on
// the ancestor preview root.
import { useTranslation } from "react-i18next";
import { Facebook, Instagram, Youtube, Linkedin, Mail } from "lucide-react";
import type { ThemeDesign, ThemeDesignLang } from "@/lib/theme/themeDesign";
import { MetaSeparator } from "../../atoms";
import { ToolbarButtonPreview } from "../../molecules";
import { getPreviewCopy, getTabTitle, type PreviewSection } from "../../lib";
import "@/lib/i18n-admin-theme-design";

const SOCIAL_ICONS = [Facebook, Instagram, Youtube, Linkedin, Mail] as const;

export function LivePreviewStage({
  draft,
  previewLang,
  isDark,
  activeTab,
}: {
  draft: ThemeDesign;
  previewLang: ThemeDesignLang;
  isDark: boolean;
  activeTab: PreviewSection;
}) {
  const { t } = useTranslation();
  const copy = getPreviewCopy(previewLang);

  return (
    <>
      <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-widest opacity-60 font-semibold">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
        <span>
          {t("adminThemeDesign.live.tabPrefix")} {getTabTitle(activeTab, previewLang)}
        </span>
      </div>

      {activeTab === "block-heading" && (
        <div className="space-y-3">
          <h2 className="cms-block-heading">{copy.eyebrow}</h2>
          <h2 className="cms-block-heading">{copy.listHeader}</h2>
        </div>
      )}

      {activeTab === "thumbnail" && (
        <div className="grid sm:grid-cols-2 gap-6 max-w-xl">
          <div
            className="cms-thumb relative overflow-hidden"
            style={{
              aspectRatio: draft.thumbnail.aspectRatio,
              background: "linear-gradient(135deg, #fa9346 0%, #b0552a 100%)",
            }}
          >
            <span
              className="absolute left-3 top-3 rounded-sm px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: "rgba(0,0,0,.65)", color: "#fff" }}
            >
              {copy.category}
            </span>
          </div>
          <div
            className="cms-thumb relative overflow-hidden"
            style={{
              aspectRatio: draft.thumbnail.aspectRatio,
              background: "linear-gradient(135deg, #2b3550 0%, #0f172a 100%)",
            }}
          />
        </div>
      )}

      {activeTab === "read-more" && (
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" className="cms-read-more inline-flex items-center gap-1 border">
            {copy.readMore}
            {draft.readMoreButton.arrow && <span aria-hidden>→</span>}
          </button>
          <button
            type="button"
            className="cms-read-more inline-flex items-center gap-1 border opacity-70"
          >
            {copy.readMore}
          </button>
        </div>
      )}

      {activeTab === "meta" && (
        <div
          className="cms-meta-info inline-flex flex-wrap items-center"
          style={{
            gap: draft.metaInfo.gap,
            fontSize: draft.metaInfo.fontSize,
            textTransform: draft.metaInfo.uppercase ? "uppercase" : "none",
          }}
        >
          <span>{copy.author}</span>
          <MetaSeparator kind={draft.metaInfo.separator} />
          <span>{copy.published}</span>
          <MetaSeparator kind={draft.metaInfo.separator} />
          <span>{copy.read}</span>
        </div>
      )}

      {activeTab === "toolbar" && (
        <div className="space-y-2">
          <div
            className="inline-flex items-center gap-1 rounded-md p-1"
            style={{ background: "color-mix(in oklab, currentColor 6%, transparent)" }}
          >
            <ToolbarButtonPreview design={draft} icon="B" />
            <ToolbarButtonPreview design={draft} icon="I" />
            <ToolbarButtonPreview design={draft} icon="U" active />
            <ToolbarButtonPreview design={draft} icon="•" />
            <ToolbarButtonPreview design={draft} icon="⧉" />
          </div>
          <p className="text-[10px] opacity-60">{t("adminThemeDesign.live.activeStateNote")}</p>
        </div>
      )}

      {activeTab === "mode-switch" && (
        <div
          className="inline-flex p-0.5 border"
          style={{
            background: "var(--td-ms-track-bg, transparent)",
            borderColor: "var(--td-ms-track-border, currentColor)",
            borderRadius: draft.modeSwitcher.radius,
          }}
        >
          {copy.modeItems.map((label, index) => {
            const active = index === (isDark ? 2 : 0);
            return (
              <span
                key={label}
                className="px-3 py-1.5 text-[12px] font-medium transition-colors"
                style={{
                  background: active ? "var(--td-ms-active-bg, transparent)" : "transparent",
                  color: active
                    ? "var(--td-ms-active-color, currentColor)"
                    : "var(--td-ms-inactive, currentColor)",
                  borderRadius: `calc(${draft.modeSwitcher.radius} - 2px)`,
                }}
              >
                {label}
              </span>
            );
          })}
        </div>
      )}

      {activeTab === "social" && (
        <div className="inline-flex items-center" style={{ gap: draft.socialIcons.gap }}>
          {SOCIAL_ICONS.map((Icon, index) => (
            <span
              key={index}
              className="inline-flex items-center justify-center"
              style={{
                background: "var(--td-si-bg, transparent)",
                color: "var(--td-si-color, currentColor)",
                padding: `${draft.socialIcons.paddingY} ${draft.socialIcons.paddingX}`,
                borderRadius: draft.socialIcons.radius,
              }}
            >
              <Icon style={{ width: draft.socialIcons.size, height: draft.socialIcons.size }} />
            </span>
          ))}
        </div>
      )}

      {activeTab === "post-title" && (
        <div className="space-y-3 max-w-2xl">
          <h3 className="cms-post-title">
            <a href="#" onClick={(e) => e.preventDefault()}>
              {copy.title}
            </a>
          </h3>
          <h3 className="cms-post-title" style={{ fontSize: "15px" }}>
            {copy.items[0]}
          </h3>
        </div>
      )}

      {activeTab === "post-excerpt" && <p className="cms-post-excerpt max-w-2xl">{copy.excerpt}</p>}

      {activeTab === "list-index" && (
        <ol className="grid sm:grid-cols-3 gap-4 max-w-3xl">
          {copy.items.map((item, index) => (
            <li
              key={item}
              className="flex items-start gap-3 pb-3 border-b"
              style={{ borderColor: "color-mix(in oklab, currentColor 12%, transparent)" }}
            >
              <span
                className="font-display tabular-nums leading-none shrink-0"
                style={{
                  fontSize: "44px",
                  fontWeight: draft.listIndex.weight,
                  color: isDark ? draft.listIndex.colorDark : draft.listIndex.colorLight,
                  opacity: draft.listIndex.opacity,
                }}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                className="cms-post-title"
                style={{ fontSize: "15px" }}
              >
                {item}
              </a>
            </li>
          ))}
        </ol>
      )}

      {activeTab === "carousel" && (
        <div className="space-y-3">
          <div className="flex gap-4 overflow-hidden">
            {[0, 1, 2].map((index) => (
              <article key={index} className="w-56 shrink-0 space-y-2">
                <div
                  className="cms-thumb relative overflow-hidden"
                  style={{
                    aspectRatio: draft.thumbnail.aspectRatio,
                    background: index % 2
                      ? "linear-gradient(135deg, #2b3550 0%, #0f172a 100%)"
                      : "linear-gradient(135deg, #fa9346 0%, #b0552a 100%)",
                  }}
                />
                <h3 className="cms-post-title" style={{ fontSize: "14px" }}>
                  {copy.items[index] ?? copy.title}
                </h3>
              </article>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="h-1.5 rounded-full"
                style={{
                  width: index === 0 ? 20 : 8,
                  background: index === 0
                    ? "var(--brand, currentColor)"
                    : "color-mix(in oklab, currentColor 25%, transparent)",
                }}
              />
            ))}
          </div>
        </div>
      )}

      {activeTab === "overlay" && (
        <article className="max-w-2xl">
          <div
            className="cms-thumb relative overflow-hidden"
            style={{
              aspectRatio: draft.thumbnail.aspectRatio,
              background: "linear-gradient(135deg, #fa9346 0%, #b0552a 55%, #3a1e10 100%)",
            }}
          >
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background: "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,.72) 100%)",
              }}
            />
            <span
              className="absolute left-4 top-4 rounded-sm px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: "rgba(0,0,0,.65)", color: "#fff" }}
            >
              {copy.overlayCategory}
            </span>
            <div className="absolute inset-x-0 bottom-0 p-4 md:p-5 space-y-2 text-white">
              <h3
                className="cms-post-title"
                style={{ color: "#fff", textShadow: "0 2px 12px rgba(0,0,0,.35)" }}
              >
                {copy.title}
              </h3>
              <p
                className="cms-post-excerpt"
                style={{ color: "rgba(255,255,255,.85)", marginTop: 0 }}
              >
                {copy.excerpt}
              </p>
              <div
                className="cms-meta-info inline-flex flex-wrap items-center"
                style={{
                  gap: draft.metaInfo.gap,
                  fontSize: draft.metaInfo.fontSize,
                  textTransform: draft.metaInfo.uppercase ? "uppercase" : "none",
                  color: "rgba(255,255,255,.85)",
                }}
              >
                <span>{copy.author}</span>
                <MetaSeparator kind={draft.metaInfo.separator} />
                <span>{copy.published}</span>
              </div>
            </div>
          </div>
        </article>
      )}
    </>
  );
}
