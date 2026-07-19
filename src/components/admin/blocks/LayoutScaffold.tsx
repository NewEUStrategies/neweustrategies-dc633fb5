// Wireframe layoutu wpisu wyświetlany od razu w edytorze bloków.
// Pokazuje strukturę aktywnego presetu (cover / nagłówek / sidebar / stopka)
// owijając kanwę bloków tak, by autor widział, w którym slocie pisze.
// Treść samego artykułu (BlockCanvas) renderowana jest jako children
// wewnątrz kolumny "content" - dokładnie tak, jak na froncie.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-blocks";
import {
  findLayout,
  overlayTypographyStyle,
  headerTypographyStyle,
  type PostFormat,
  type PostLayoutSettings,
  type LayoutPreset,
} from "@/lib/postLayouts";

interface Props {
  format: PostFormat;
  layoutId: string;
  settings: PostLayoutSettings;
  title: string;
  excerpt?: string | null;
  coverImageUrl?: string | null;
  children: ReactNode;
}

const ZONE = "rounded-md border border-dashed border-border/70 bg-muted/20";
const ZONE_LABEL =
  "absolute top-1.5 left-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80 bg-background/90 px-1.5 py-0.5 rounded";

function ZoneTag({ label }: { label: string }) {
  return <span className={ZONE_LABEL}>{label}</span>;
}

function Cover({
  url,
  preset,
  ratio,
}: {
  url?: string | null;
  preset: LayoutPreset;
  ratio: number;
}) {
  const { t } = useTranslation();
  if (preset.cover === "none") return null;
  const aspect =
    preset.cover === "ratio"
      ? `100 / ${ratio}`
      : preset.cover === "full-bleed"
        ? "16 / 7"
        : preset.cover === "boxed"
          ? "16 / 9"
          : "21 / 9";
  const wrap =
    preset.cover === "full-bleed"
      ? "-mx-4 lg:-mx-8"
      : preset.cover === "boxed"
        ? "max-w-2xl mx-auto"
        : "";
  return (
    <div className={`relative ${wrap}`}>
      <ZoneTag
        label={t("admin.layoutScaffold.cover.label", {
          defaultValue: "Cover - {{variant}}",
          variant: preset.cover,
        })}
      />
      <div className={`${ZONE} overflow-hidden`} style={{ aspectRatio: aspect }}>
        {url ? (
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-xs text-muted-foreground/70">
            {t("admin.layoutScaffold.cover.empty", {
              defaultValue: "Brak cover - ustaw w panelu Szczegóły",
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Meta bar zgodny 1:1 z <PostOverlayMeta /> (public): ikona + etykieta,
// bez separatorów "|" i bez ikon social. Kolor/rozmiar via klasy nadrzędne.
function ScaffoldMetaPreview() {
  const { i18n } = useTranslation();
  const lang = (i18n.language ?? "").startsWith("en") ? "en" : "pl";
  const L = {
    pl: { by: "Autor", published: "Opublikowano", read: "X min czytania", name: "Imię Nazwisko" },
    en: { by: "By", published: "Published", read: "X min read", name: "First Last" },
  }[lang];
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-3.5 h-3.5 opacity-80"
          aria-hidden
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
        </svg>
        <span className="opacity-80">{L.by}</span>
        <span className="font-medium underline">{L.name}</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-3.5 h-3.5 opacity-80"
          aria-hidden
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className="opacity-80">{L.published}:</span>
        <span>DD/MM/YYYY</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-3.5 h-3.5 opacity-80"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <span>{L.read}</span>
      </span>
    </>
  );
}

// Chip kategorii zgodny 1:1 z <CategoryBadges /> (public).
function CategoryChipPreview({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-sm px-3 py-1 text-xs font-semibold uppercase tracking-wide shadow-sm bg-foreground/85 text-background">
      {label}
    </span>
  );
}

function Header({
  title,
  excerpt,
  center,
  settings,
}: {
  title: string;
  excerpt?: string | null;
  center: boolean;
  settings: PostLayoutSettings;
}) {
  const { t } = useTranslation();
  return (
    <div className={`relative pt-6 ${ZONE} px-4 pb-3 mt-3`} style={headerTypographyStyle(settings)}>
      <ZoneTag
        label={
          center
            ? t("admin.layoutScaffold.header.centered", { defaultValue: "Nagłówek - centered" })
            : t("admin.layoutScaffold.header.label", { defaultValue: "Nagłówek" })
        }
      />
      <div className={center ? "text-center mx-auto max-w-2xl" : ""}>
        <div className={`mb-4 flex flex-wrap gap-2 ${center ? "justify-center" : ""}`}>
          <CategoryChipPreview
            label={t("admin.layoutScaffold.overlay.category", { defaultValue: "Kategoria" })}
          />
        </div>
        <h1 className="header-title-typography font-display font-bold leading-[1.1] mb-4 text-foreground/90">
          {title || (
            <span className="text-muted-foreground/70">
              {t("admin.layoutScaffold.titlePlaceholder", { defaultValue: "Tytuł wpisu" })}
            </span>
          )}
        </h1>
        {excerpt ? (
          <p className="header-excerpt-typography text-muted-foreground mb-4">{excerpt}</p>
        ) : (
          <p className="text-xs text-muted-foreground/60 mb-4">
            {t("admin.layoutScaffold.excerptPlaceholder", {
              defaultValue: 'Excerpt - uzupełnij w „Szczegóły"',
            })}
          </p>
        )}
        <div
          className={`text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 items-center ${center ? "justify-center" : ""}`}
        >
          <ScaffoldMetaPreview />
        </div>
      </div>
    </div>
  );
}

function OverlayCover({
  url,
  title,
  excerpt,
  center,
  settings,
}: {
  url?: string | null;
  title: string;
  excerpt?: string | null;
  center: boolean;
  settings: PostLayoutSettings;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`relative ${ZONE} overflow-hidden bg-neutral-900`}
      style={{ aspectRatio: "16 / 8" }}
    >
      <ZoneTag
        label={t("admin.layoutScaffold.overlay.label", {
          defaultValue: "Cover overlay + nagłówek",
        })}
      />
      {url && (
        <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" />
      )}
      {/* Ciemny gradient - identyczny jak w publicznym renderze (PostLayoutRenderer). */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/55 to-black/90" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_rgba(0,0,0,0.55)_75%)]" />

      {/* Zawartość: kategorie -> tytuł -> excerpt -> meta. Rozmiary sterowane
          z admin.post-layouts przez CSS-vars (overlayTypographyStyle) -
          zsynchronizowane z src/components/PostLayoutRenderer.tsx. */}
      <div
        className={`absolute inset-x-0 bottom-0 p-5 md:p-8 lg:p-10 text-white ${
          center ? "text-center" : ""
        }`}
        style={overlayTypographyStyle(settings)}
      >
        <div className={`overlay-meta-card w-full ${center ? "text-center" : ""}`}>
          <div className={`mb-3 flex flex-wrap gap-1.5 ${center ? "justify-center" : ""}`}>
            <CategoryChipPreview
              label={t("admin.layoutScaffold.overlay.category", { defaultValue: "Kategoria" })}
            />
          </div>

          <h1 className="overlay-meta-title overlay-title-typography font-display font-bold leading-[1.1] mb-2 text-white">
            {title || t("admin.layoutScaffold.titlePlaceholder", { defaultValue: "Tytuł wpisu" })}
          </h1>

          {excerpt && (
            <p
              className={`overlay-meta-description overlay-excerpt-typography text-white/80 mb-3 line-clamp-2 max-w-2xl ${
                center ? "mx-auto" : ""
              }`}
            >
              {excerpt}
            </p>
          )}

          <div
            className={`text-[10px] md:text-[11px] lg:text-xs flex flex-wrap items-center gap-x-4 gap-y-1 text-white/70 ${
              center ? "justify-center" : ""
            }`}
          >
            <ScaffoldMetaPreview />
          </div>
        </div>
      </div>
    </div>
  );
}

function SideBySide({
  url,
  title,
  excerpt,
  settings,
}: {
  url?: string | null;
  title: string;
  excerpt?: string | null;
  settings: PostLayoutSettings;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-center" style={headerTypographyStyle(settings)}>
      <div className={`relative ${ZONE} overflow-hidden`} style={{ aspectRatio: "4 / 3" }}>
        <ZoneTag
          label={t("admin.layoutScaffold.sideBySide.cover", { defaultValue: "Cover - side" })}
        />
        {url && <img src={url} alt="" className="w-full h-full object-cover" />}
      </div>
      <div className={`relative ${ZONE} px-4 py-4 pt-6`}>
        <ZoneTag label={t("admin.layoutScaffold.header.label", { defaultValue: "Nagłówek" })} />
        <p className="font-display header-title-typography font-bold leading-[1.1]">
          {title || t("admin.layoutScaffold.titlePlaceholder", { defaultValue: "Tytuł wpisu" })}
        </p>
        {excerpt && (
          <p className="header-excerpt-typography text-muted-foreground mt-2">{excerpt}</p>
        )}
      </div>
    </div>
  );
}

function FooterBars({ s }: { s: PostLayoutSettings }) {
  const { t } = useTranslation();
  const bars: Array<[string, boolean]> = [
    [t("admin.layoutScaffold.footer.tags", { defaultValue: "Tagi" }), s.show_post_tags_bar],
    [
      t("admin.layoutScaffold.footer.authorCard", { defaultValue: "Karta autora" }),
      s.show_author_card,
    ],
    [
      t("admin.layoutScaffold.footer.prevNext", { defaultValue: "Poprzedni / Następny" }),
      s.show_prev_next,
    ],
    [
      t("admin.layoutScaffold.footer.newsletter", { defaultValue: "Newsletter" }),
      s.show_bottom_newsletter,
    ],
    [
      t("admin.layoutScaffold.footer.floatingShare", { defaultValue: "Floating share" }),
      s.show_floating_share_bar,
    ],
    [
      t("admin.layoutScaffold.footer.autoLoad", { defaultValue: "Auto-load next" }),
      s.auto_load_next_post,
    ],
  ];
  const enabled = bars.filter(([, v]) => v);
  if (!enabled.length) return null;
  return (
    <div className={`relative pt-6 ${ZONE} px-4 pb-3 mt-4`}>
      <ZoneTag label={t("admin.layoutScaffold.footer.label", { defaultValue: "Stopka wpisu" })} />
      <div className="flex flex-wrap gap-1.5">
        {enabled.map(([label]) => (
          <span
            key={label}
            className="text-[11px] px-2 py-0.5 rounded-full bg-brand/15 text-foreground/80 border border-brand/30"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Sidebar() {
  const { t } = useTranslation();
  return (
    <aside className={`relative pt-6 ${ZONE} px-3 pb-3 self-start lg:sticky lg:top-4 space-y-2`}>
      <ZoneTag label={t("admin.layoutScaffold.sidebar.label", { defaultValue: "Sidebar" })} />
      <div className="h-6 rounded bg-muted/60" />
      <div className="h-16 rounded bg-muted/40" />
      <div className="h-24 rounded bg-muted/40" />
      <p className="text-[10px] text-muted-foreground/70 italic">
        {t("admin.layoutScaffold.sidebar.hint", {
          defaultValue: "Tu pojawi się: ToC, tagi, related, reklama, social.",
        })}
      </p>
    </aside>
  );
}

export function LayoutScaffold({
  format,
  layoutId,
  settings,
  title,
  excerpt,
  coverImageUrl,
  children,
}: Props) {
  const { t } = useTranslation();
  const preset = findLayout(format, layoutId);
  const ratio = preset.featuredRatioKey ? settings[preset.featuredRatioKey] : 56;
  const center = settings.center_header ?? preset.centerHeaderDefault ?? false;
  const contentMaxW = preset.hasSidebar
    ? settings.has_sidebar_max_width
    : settings.no_sidebar_max_width;

  const topZone = (() => {
    if (preset.header === "overlay") {
      return (
        <OverlayCover
          url={coverImageUrl}
          title={title}
          excerpt={excerpt}
          center={center}
          settings={settings}
        />
      );
    }
    if (preset.header === "side-by-side") {
      return <SideBySide url={coverImageUrl} title={title} excerpt={excerpt} settings={settings} />;
    }
    if (preset.header === "below-cover") {
      return (
        <>
          <Cover url={coverImageUrl} preset={preset} ratio={ratio} />
          <Header title={title} excerpt={excerpt} center={center} settings={settings} />
        </>
      );
    }
    if (preset.header === "no-cover") {
      return <Header title={title} excerpt={excerpt} center={center} settings={settings} />;
    }
    // above-cover (default)
    return (
      <>
        <Header title={title} excerpt={excerpt} center={center} settings={settings} />
        {coverImageUrl !== undefined && <Cover url={coverImageUrl} preset={preset} ratio={ratio} />}
      </>
    );
  })();

  const contentZone = (
    <div className={`relative pt-6 ${ZONE} p-4 mt-4`}>
      <ZoneTag
        label={t("admin.layoutScaffold.content.label", {
          defaultValue: "Treść - max {{max}}px",
          max: contentMaxW,
        })}
      />
      <div style={{ maxWidth: `${contentMaxW}px` }} className="w-full mx-auto">
        {children}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground border-b border-border pb-2">
        <span className="font-semibold text-foreground/80">
          {t("admin.layoutScaffold.summary.title", { defaultValue: "Podgląd layoutu:" })}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-muted/60">{preset.label}</span>
        <span className="px-1.5 py-0.5 rounded bg-muted/60">
          {t("admin.layoutScaffold.summary.format", {
            defaultValue: "format: {{value}}",
            value: format,
          })}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-muted/60">
          {t("admin.layoutScaffold.summary.header", {
            defaultValue: "header: {{value}}",
            value: preset.header,
          })}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-muted/60">
          {t("admin.layoutScaffold.summary.cover", {
            defaultValue: "cover: {{value}}",
            value: preset.cover,
          })}
        </span>
        {preset.hasSidebar && (
          <span className="px-1.5 py-0.5 rounded bg-brand/20">
            {t("admin.layoutScaffold.summary.sidebar", { defaultValue: "+ sidebar" })}
          </span>
        )}
      </div>

      {topZone}

      {preset.hasSidebar ? (
        <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-4">
          <div>{contentZone}</div>
          <Sidebar />
        </div>
      ) : (
        contentZone
      )}

      <FooterBars s={settings} />
    </div>
  );
}
