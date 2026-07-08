// Wireframe layoutu wpisu wyświetlany od razu w edytorze bloków.
// Pokazuje strukturę aktywnego presetu (cover / nagłówek / sidebar / stopka)
// owijając kanwę bloków tak, by autor widział, w którym slocie pisze.
// Treść samego artykułu (BlockCanvas) renderowana jest jako children
// wewnątrz kolumny "content" - dokładnie tak, jak na froncie.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
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

function Header({
  title,
  excerpt,
  center,
}: {
  title: string;
  excerpt?: string | null;
  center: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={`relative pt-6 ${ZONE} px-4 pb-3 mt-3`}>
      <ZoneTag
        label={
          center
            ? t("admin.layoutScaffold.header.centered", { defaultValue: "Nagłówek - centered" })
            : t("admin.layoutScaffold.header.label", { defaultValue: "Nagłówek" })
        }
      />
      <div className={center ? "text-center mx-auto max-w-2xl" : ""}>
        <p className="font-display text-2xl md:text-3xl lg:text-4xl leading-[1.1] font-bold text-foreground/90">
          {title || (
            <span className="text-muted-foreground/70">
              {t("admin.layoutScaffold.titlePlaceholder", { defaultValue: "Tytuł wpisu" })}
            </span>
          )}
        </p>
        {excerpt ? (
          <p className="text-sm md:text-base text-muted-foreground mt-1.5">{excerpt}</p>
        ) : (
          <p className="text-xs text-muted-foreground/60 mt-1.5">
            {t("admin.layoutScaffold.excerptPlaceholder", {
              defaultValue: "Excerpt - uzupełnij w „Szczegóły\"",
            })}
          </p>
        )}
        <div
          className={`flex flex-wrap gap-2 mt-2 text-[11px] text-muted-foreground ${center ? "justify-center" : ""}`}
        >
          <span className="px-1.5 py-0.5 rounded bg-muted/60">
            {t("admin.layoutScaffold.meta.date", { defaultValue: "data" })}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-muted/60">
            {t("admin.layoutScaffold.meta.author", { defaultValue: "autor" })}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-muted/60">
            {t("admin.layoutScaffold.meta.readTime", { defaultValue: "read time" })}
          </span>
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
}: {
  url?: string | null;
  title: string;
  excerpt?: string | null;
  center: boolean;
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
        <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" />
      )}
      {/* Ciemny gradient - identyczny jak w publicznym renderze (PostLayoutRenderer). */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/55 to-black/90" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_rgba(0,0,0,0.55)_75%)]" />

      {/* Zawartość: kategorie -> tytuł -> excerpt -> meta. Rozmiary dokładnie
          zsynchronizowane z src/components/PostLayoutRenderer.tsx. */}
      <div
        className={`absolute inset-x-0 bottom-0 p-5 md:p-8 lg:p-10 text-white ${
          center ? "text-center" : ""
        }`}
      >
        <div className={`flex flex-wrap gap-1.5 mb-3 ${center ? "justify-center" : ""}`}>
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-sm"
            style={{ background: "#FDB078", color: "#111" }}
          >
            {t("admin.layoutScaffold.overlay.category", { defaultValue: "Kategoria" })}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-sm bg-white/15 text-white/90 border border-white/20">
            {t("admin.layoutScaffold.overlay.tag", { defaultValue: "Tag" })}
          </span>
        </div>

        <p className="font-display font-bold text-2xl md:text-3xl lg:text-4xl leading-[1.1] mb-2">
          {title ||
            t("admin.layoutScaffold.titlePlaceholder", { defaultValue: "Tytuł wpisu" })}
        </p>

        {excerpt && (
          <p
            className={`text-xs md:text-sm lg:text-base text-white/80 max-w-2xl line-clamp-2 mb-3 ${
              center ? "mx-auto" : ""
            }`}
          >
            {excerpt}
          </p>
        )}

        <div
          className={`flex flex-wrap gap-x-3 gap-y-1 text-[10px] md:text-[11px] lg:text-xs text-white/70 items-center ${
            center ? "justify-center" : ""
          }`}
        >
          <span>
            {t("admin.layoutScaffold.overlay.by", { defaultValue: "Autor:" })}{" "}
            <span className="underline text-white/90">
              {t("admin.layoutScaffold.overlay.author", { defaultValue: "Imię Nazwisko" })}
            </span>
          </span>
          <span className="opacity-50">|</span>
          <span>
            {t("admin.layoutScaffold.overlay.published", {
              defaultValue: "Opublikowano: DD/MM/YYYY",
            })}
          </span>
          <span className="opacity-50">|</span>
          <span>
            {t("admin.layoutScaffold.overlay.readTime", { defaultValue: "X min czytania" })}
          </span>
          <span className="opacity-50">|</span>
          <span className="inline-flex gap-1.5" aria-hidden="true">
            <span className="w-4 h-4 rounded-full bg-white/15 grid place-items-center text-[8px]">
              f
            </span>
            <span className="w-4 h-4 rounded-full bg-white/15 grid place-items-center text-[8px]">
              x
            </span>
            <span className="w-4 h-4 rounded-full bg-white/15 grid place-items-center text-[8px]">
              in
            </span>
            <span className="w-4 h-4 rounded-full bg-white/15 grid place-items-center text-[8px]">
              @
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

function SideBySide({
  url,
  title,
  excerpt,
}: {
  url?: string | null;
  title: string;
  excerpt?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-center">
      <div className={`relative ${ZONE} overflow-hidden`} style={{ aspectRatio: "4 / 3" }}>
        <ZoneTag
          label={t("admin.layoutScaffold.sideBySide.cover", { defaultValue: "Cover - side" })}
        />
        {url && <img src={url} alt="" className="w-full h-full object-cover" />}
      </div>
      <div className={`relative ${ZONE} px-4 py-4 pt-6`}>
        <ZoneTag label={t("admin.layoutScaffold.header.label", { defaultValue: "Nagłówek" })} />
        <p className="font-display text-xl md:text-2xl lg:text-3xl font-bold leading-[1.1]">
          {title ||
            t("admin.layoutScaffold.titlePlaceholder", { defaultValue: "Tytuł wpisu" })}
        </p>
        {excerpt && <p className="text-sm md:text-base text-muted-foreground mt-2">{excerpt}</p>}
      </div>
    </div>
  );
}

function FooterBars({ s }: { s: PostLayoutSettings }) {
  const { t } = useTranslation();
  const bars: Array<[string, boolean]> = [
    [t("admin.layoutScaffold.footer.tags", { defaultValue: "Tagi" }), s.show_post_tags_bar],
    [t("admin.layoutScaffold.footer.sources", { defaultValue: "Źródła" }), s.show_sources_bar],
    [t("admin.layoutScaffold.footer.via", { defaultValue: "Via" }), s.show_via_bar],
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
      <ZoneTag
        label={t("admin.layoutScaffold.footer.label", { defaultValue: "Stopka wpisu" })}
      />
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
      return <OverlayCover url={coverImageUrl} title={title} excerpt={excerpt} center={center} />;
    }
    if (preset.header === "side-by-side") {
      return <SideBySide url={coverImageUrl} title={title} excerpt={excerpt} />;
    }
    if (preset.header === "below-cover") {
      return (
        <>
          <Cover url={coverImageUrl} preset={preset} ratio={ratio} />
          <Header title={title} excerpt={excerpt} center={center} />
        </>
      );
    }
    if (preset.header === "no-cover") {
      return <Header title={title} excerpt={excerpt} center={center} />;
    }
    // above-cover (default)
    return (
      <>
        <Header title={title} excerpt={excerpt} center={center} />
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
