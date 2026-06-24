// Wireframe layoutu wpisu wyświetlany od razu w edytorze bloków.
// Pokazuje strukturę aktywnego presetu (cover / nagłówek / sidebar / stopka)
// owijając kanwę bloków tak, by autor widział, w którym slocie pisze.
// Treść samego artykułu (BlockCanvas) renderowana jest jako children
// wewnątrz kolumny "content" - dokładnie tak, jak na froncie.

import type { ReactNode } from "react";
import { findLayout, type PostFormat, type PostLayoutSettings, type LayoutPreset } from "@/lib/postLayouts";

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

function Cover({ url, preset, ratio }: { url?: string | null; preset: LayoutPreset; ratio: number }) {
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
      <ZoneTag label={`Cover · ${preset.cover}`} />
      <div className={`${ZONE} overflow-hidden`} style={{ aspectRatio: aspect }}>
        {url ? (
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-xs text-muted-foreground/70">
            Brak cover · ustaw w panelu Szczegóły
          </div>
        )}
      </div>
    </div>
  );
}

function Header({ title, excerpt, center }: { title: string; excerpt?: string | null; center: boolean }) {
  return (
    <div className={`relative pt-6 ${ZONE} px-4 pb-3 mt-3`}>
      <ZoneTag label={center ? "Nagłówek · centered" : "Nagłówek"} />
      <div className={center ? "text-center mx-auto max-w-2xl" : ""}>
        <p className="font-display text-2xl lg:text-3xl leading-tight text-foreground/90">
          {title || <span className="text-muted-foreground/70">Tytuł wpisu</span>}
        </p>
        {excerpt ? (
          <p className="text-sm text-muted-foreground mt-1.5">{excerpt}</p>
        ) : (
          <p className="text-xs text-muted-foreground/60 mt-1.5">Excerpt - uzupełnij w „Szczegóły"</p>
        )}
        <div className={`flex flex-wrap gap-2 mt-2 text-[11px] text-muted-foreground ${center ? "justify-center" : ""}`}>
          <span className="px-1.5 py-0.5 rounded bg-muted/60">data</span>
          <span className="px-1.5 py-0.5 rounded bg-muted/60">autor</span>
          <span className="px-1.5 py-0.5 rounded bg-muted/60">read time</span>
        </div>
      </div>
    </div>
  );
}

function OverlayCover({ url, title, excerpt, center }: { url?: string | null; title: string; excerpt?: string | null; center: boolean }) {
  return (
    <div className={`relative ${ZONE} overflow-hidden`} style={{ aspectRatio: "16 / 7" }}>
      <ZoneTag label="Cover overlay + nagłówek" />
      {url && <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
      <div className={`absolute inset-x-0 bottom-0 p-4 text-white ${center ? "text-center" : ""}`}>
        <p className="font-display text-xl lg:text-2xl leading-tight">
          {title || "Tytuł wpisu"}
        </p>
        {excerpt && <p className="text-xs opacity-80 mt-1 line-clamp-2">{excerpt}</p>}
      </div>
    </div>
  );
}

function SideBySide({ url, title, excerpt }: { url?: string | null; title: string; excerpt?: string | null }) {
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-center">
      <div className={`relative ${ZONE} overflow-hidden`} style={{ aspectRatio: "4 / 3" }}>
        <ZoneTag label="Cover · side" />
        {url && <img src={url} alt="" className="w-full h-full object-cover" />}
      </div>
      <div className={`relative ${ZONE} px-4 py-4 pt-6`}>
        <ZoneTag label="Nagłówek" />
        <p className="font-display text-xl lg:text-2xl">{title || "Tytuł wpisu"}</p>
        {excerpt && <p className="text-sm text-muted-foreground mt-2">{excerpt}</p>}
      </div>
    </div>
  );
}

function FooterBars({ s }: { s: PostLayoutSettings }) {
  const bars: Array<[string, boolean]> = [
    ["Tagi", s.show_post_tags_bar],
    ["Źródła", s.show_sources_bar],
    ["Via", s.show_via_bar],
    ["Karta autora", s.show_author_card],
    ["Poprzedni / Następny", s.show_prev_next],
    ["Newsletter", s.show_bottom_newsletter],
    ["Floating share", s.show_floating_share_bar],
    ["Auto-load next", s.auto_load_next_post],
  ];
  const enabled = bars.filter(([, v]) => v);
  if (!enabled.length) return null;
  return (
    <div className={`relative pt-6 ${ZONE} px-4 pb-3 mt-4`}>
      <ZoneTag label="Stopka wpisu" />
      <div className="flex flex-wrap gap-1.5">
        {enabled.map(([label]) => (
          <span key={label} className="text-[11px] px-2 py-0.5 rounded-full bg-brand/15 text-foreground/80 border border-brand/30">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className={`relative pt-6 ${ZONE} px-3 pb-3 self-start lg:sticky lg:top-4 space-y-2`}>
      <ZoneTag label="Sidebar" />
      <div className="h-6 rounded bg-muted/60" />
      <div className="h-16 rounded bg-muted/40" />
      <div className="h-24 rounded bg-muted/40" />
      <p className="text-[10px] text-muted-foreground/70 italic">
        Tu pojawi się: ToC, tagi, related, reklama, social.
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
  const preset = findLayout(format, layoutId);
  const ratio = preset.featuredRatioKey ? settings[preset.featuredRatioKey] : 56;
  const center = settings.center_header ?? preset.centerHeaderDefault ?? false;
  const contentMaxW = preset.hasSidebar ? settings.has_sidebar_max_width : settings.no_sidebar_max_width;

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
      <ZoneTag label={`Treść · max ${contentMaxW}px`} />
      <div style={{ maxWidth: `${contentMaxW}px` }} className="w-full mx-auto">
        {children}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground border-b border-border pb-2">
        <span className="font-semibold text-foreground/80">Podgląd layoutu:</span>
        <span className="px-1.5 py-0.5 rounded bg-muted/60">{preset.label}</span>
        <span className="px-1.5 py-0.5 rounded bg-muted/60">format: {format}</span>
        <span className="px-1.5 py-0.5 rounded bg-muted/60">header: {preset.header}</span>
        <span className="px-1.5 py-0.5 rounded bg-muted/60">cover: {preset.cover}</span>
        {preset.hasSidebar && <span className="px-1.5 py-0.5 rounded bg-brand/20">+ sidebar</span>}
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
