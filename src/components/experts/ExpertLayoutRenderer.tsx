// Shared renderer dla strony eksperta. Używany PRZEZ:
//   1. admin/expert-layouts (`ExpertLayoutPreview`) - podgląd w draftcie,
//   2. /author/$slug (public) - realny hub eksperta.
// Dzięki temu preset, kolory, kolejność i widoczność sekcji są 1:1
// identyczne w adminie i publicznie. Ikony social zaciągane są z admin/ikony
// (BrandIcon) - "twitter" mapuje się do "x". Bio jako punktory (max 5).
import type { CSSProperties, ReactNode } from "react";
import { Mail, Newspaper, Mic, BookOpen, Layers } from "@/lib/lucide-shim";
import {
  Globe as LucideGlobe,
  Linkedin as LucideLinkedin,
  Phone,
  Briefcase,
  GraduationCap,
} from "lucide-react";
import { BrandIcon } from "@/components/atoms/BrandIcon";
import { XIcon } from "@/components/atoms/XIcon";
import type { ExpertHubData } from "@/lib/experts/types";
import {
  findExpertPreset,
  isSectionVisible,
  DEFAULT_EXPERT_SECTION_ORDER,
  type ExpertLayoutSettings,
  type ExpertSectionKey,
} from "@/lib/expertLayouts";

export type Lang = "pl" | "en";

export const LABELS: Record<Lang, Record<string, string>> = {
  pl: {
    bio: "Biografia",
    contact: "Kontakt",
    mediaContact: "Kontakt dla mediów",
    inMedia: "W mediach",
    podcasts: "Podcasty",
    materials: "Materiały",
    cv: "Doświadczenie",
    programs: "Programy i projekty",
    expertise: "Obszary ekspertyzy",
    social: "Media społecznościowe",
    profileTagline: "Profil eksperta",
    empty: "Brak danych do wyświetlenia w tej sekcji.",
    placeholder: "Przykładowa treść",
    roleFallback: "Ekspert",
    noBioFallback: "Biogram będzie dostępny wkrótce.",
    noSocialFallback: "Ekspert nie udostępnił jeszcze kanałów kontaktowych.",
    cvPending: "Sekcja CV zostanie uzupełniona wkrótce.",
  },
  en: {
    bio: "Biography",
    contact: "Contact",
    mediaContact: "Media contact",
    inMedia: "In the news",
    podcasts: "Podcasts",
    materials: "Materials",
    cv: "Experience",
    programs: "Programs and projects",
    expertise: "Areas of expertise",
    social: "Social channels",
    profileTagline: "Expert profile",
    empty: "No data to render in this section.",
    placeholder: "Sample content",
    roleFallback: "Expert",
    noBioFallback: "A full biography is coming soon.",
    noSocialFallback: "The expert has not shared any social channels yet.",
    cvPending: "The CV section will be added soon.",
  },
};

export const PLACEHOLDER = {
  pl: {
    bio: [
      "Starsza analityczka polityki europejskiej w New European Strategies, specjalistka od bezpieczeństwa UE i relacji transatlantyckich.",
      "Autorka ponad 40 publikacji recenzowanych i komentatorka w czołowych mediach europejskich.",
      "Wcześniej w MSZ i Parlamencie Europejskim, gdzie kierowała zespołem doradczym ds. polityki wschodniej.",
      "Doradczyni instytucji publicznych oraz wiodących think-tanków w regionie CEE.",
      "Regularna prelegentka Munich Security Conference, GLOBSEC oraz Warsaw Security Forum.",
    ],
    role: "Starsza analityczka · New European Strategies",
    email: "kontakt@przyklad.pl",
    mediaEmail: "media@przyklad.pl",
    phone: "+48 22 000 00 00",
    website: "przyklad.pl",
    areas: ["Bezpieczeństwo europejskie", "Polityka UE", "Relacje transatlantyckie", "Strategia i geopolityka"],
    mentions: [
      { outlet: "Rzeczpospolita", title: "Komentarz eksperta w kontekście polityki bezpieczeństwa UE", date: "2026-06-12" },
      { outlet: "Politico Europe", title: "Interview: Europe's strategic autonomy in 2026", date: "2026-05-30" },
      { outlet: "TVN24", title: "Rozmowa o wojnie hybrydowej i odporności państw NATO", date: "2026-05-14" },
      { outlet: "Financial Times", title: "Op-ed: How EU should respond to shifting alliances", date: "2026-04-28" },
    ],
    podcasts: [
      { title: "Rozmowy o Europie - odc. 12: Nowy porządek bezpieczeństwa", date: "2026-06-01" },
      { title: "Strategy Talks - Ekspertka o polityce wschodniej", date: "2026-05-18" },
      { title: "Bezpieczeństwo XXI wieku - Cyfrowa suwerenność UE", date: "2026-04-22" },
    ],
    materials: [
      "Raport roczny 2026 - Bezpieczeństwo europejskie",
      "Analiza: Polityka zagraniczna UE po 2025",
      "Studium przypadku - Energetyka i geopolityka",
      "Prezentacja: Nowa strategia UE wobec Wschodu",
      "Wywiad ekspercki - Munich Security Conference",
      "Publikacja naukowa - Journal of European Studies",
    ],
    programs: [
      { name: "Program badawczy: Bezpieczeństwo Europy", role: "Kierowniczka" },
      { name: "Inicjatywa Europa 2030", role: "Ekspertka" },
      { name: "Panel gospodarczy NES", role: "Członkini" },
      { name: "Projekt energetyczny", role: "Konsultantka" },
    ],
  },
  en: {
    bio: [
      "Senior Fellow at New European Strategies, leading research on European security and transatlantic relations.",
      "Author of 40+ peer-reviewed publications and a regular commentator across major European media.",
      "Former adviser at the Ministry of Foreign Affairs and the European Parliament (Eastern policy).",
      "Adviser to public institutions and top think tanks focused on the CEE region.",
      "Recurring speaker at Munich Security Conference, GLOBSEC, and Warsaw Security Forum.",
    ],
    role: "Senior Fellow · New European Strategies",
    email: "contact@example.com",
    mediaEmail: "media@example.com",
    phone: "+1 202 000 0000",
    website: "example.com",
    areas: ["European security", "EU policy", "Transatlantic relations", "Strategy & geopolitics"],
    mentions: [
      { outlet: "The Times", title: "Expert commentary on EU security policy", date: "2026-06-12" },
      { outlet: "Politico Europe", title: "Interview: Europe's strategic autonomy in 2026", date: "2026-05-30" },
      { outlet: "Reuters", title: "Analysis: Hybrid warfare and NATO resilience", date: "2026-05-14" },
      { outlet: "Financial Times", title: "Op-ed: How the EU should respond to shifting alliances", date: "2026-04-28" },
    ],
    podcasts: [
      { title: "Europe Talks - ep. 12: A new security order", date: "2026-06-01" },
      { title: "Strategy Talks - Eastern policy revisited", date: "2026-05-18" },
      { title: "21st Century Security - EU digital sovereignty", date: "2026-04-22" },
    ],
    materials: [
      "Annual report 2026 - European security",
      "Analysis: EU foreign policy after 2025",
      "Case study - Energy and geopolitics",
      "Presentation: A new EU Eastern strategy",
      "Expert interview - Munich Security Conference",
      "Scientific publication - Journal of European Studies",
    ],
    programs: [
      { name: "Research programme: European Security", role: "Lead" },
      { name: "Europe 2030 initiative", role: "Expert" },
      { name: "NES economic panel", role: "Member" },
      { name: "Energy project", role: "Consultant" },
    ],
  },
} as const;

export function AvatarPlaceholder({
  name,
  className = "",
  rounded = "rounded-full",
}: {
  name: string;
  className?: string;
  rounded?: string;
}) {
  const initials = (name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className={`${className} ${rounded} flex items-center justify-center font-display text-2xl select-none`}
      style={{
        background:
          "linear-gradient(135deg, color-mix(in oklab, var(--pv-accent) 30%, transparent), color-mix(in oklab, var(--pv-accent) 10%, transparent))",
        color: "var(--pv-accent)",
        border: "2px dashed var(--pv-accent)",
        boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--pv-accent) 25%, transparent)",
      }}
      aria-hidden
    >
      {initials || "??"}
    </div>
  );
}

export function CoverPlaceholder({ className = "" }: { className?: string }) {
  return (
    <div
      className={className}
      style={{
        background:
          "linear-gradient(135deg, color-mix(in oklab, var(--pv-accent) 40%, transparent) 0%, color-mix(in oklab, var(--pv-accent) 15%, transparent) 60%, transparent 100%), repeating-linear-gradient(45deg, rgba(0,0,0,0.04) 0 8px, transparent 8px 16px)",
        border: "1px dashed color-mix(in oklab, var(--pv-accent) 45%, transparent)",
      }}
      aria-hidden
    />
  );
}

/**
 * Główny renderer hero eksperta - zwraca sekcję hero zgodną z presetem.
 * Nie renderuje sekcji poniżej (details / social_row / …) - to robi
 * `ExpertSectionsList`. Rozdzielenie pozwala publicznej stronie wpiąć
 * dodatkowe elementy między hero a resztą (breadcrumbs, pasek ekspertyzy).
 */
export function ExpertLayoutHero({
  hub,
  settings,
  lang,
  showPlaceholders = false,
}: {
  hub: ExpertHubData;
  settings: ExpertLayoutSettings;
  lang: Lang;
  showPlaceholders?: boolean;
}) {
  const preset = findExpertPreset(settings.default_preset);
  const e = hub.expert;
  const ph = PLACEHOLDER[lang];
  const name =
    (e.display_name && e.display_name.trim()) ||
    (showPlaceholders ? (lang === "en" ? "Sample Expert" : "Przykładowy Ekspert") : "");
  const role = e.job_title ?? "";
  const company = e.company ?? "";
  const realRoleLine = [role, company].filter(Boolean).join(" · ");
  // Fallback: gdy brak stanowiska i firmy, na publicznej stronie pokaż "Ekspert"
  // zamiast pustej linii - w preview używamy przykładowej roli.
  const roleLine = realRoleLine || (showPlaceholders ? ph.role : LABELS[lang].roleFallback);
  const realBio = (lang === "en" ? e.bio_en : e.bio_pl) ?? "";
  const bioItems: string[] = (() => {
    const src = realBio.trim();
    if (src) {
      const byLine = src
        .split(/\r?\n+/)
        .map((l) => l.replace(/^\s*[-•*·]\s*/, "").trim())
        .filter(Boolean);
      if (byLine.length > 1) return byLine.slice(0, 5);
      const bySentence = src
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return bySentence.slice(0, 5);
    }
    return showPlaceholders ? ph.bio.slice(0, 5) : [];
  })();

  const hasCover = Boolean(e.cover_url);
  const maxWidth = settings.max_width;

  // Kolory hero konsumujemy przez CSS vars (`--pv-hero-*`) - dzięki temu
  // dark-mode override z `ExpertLayoutStyleScope` wchodzi automatycznie
  // (bez re-renderu z propsem theme). `transparent`/`inherit` to fallbacki
  // ustawiane w `expertLayoutCssVars` gdy admin nie nadpisał koloru.
  const heroStyle: CSSProperties = {
    backgroundColor: "var(--pv-hero-bg)",
    color: "var(--pv-hero-text)",
  };
  const centered = settings.center_hero || preset.centeredContent;

  const roleStyle: CSSProperties = {
    fontSize: "var(--pv-role-size)",
    color: "var(--pv-hero-text)",
    opacity: 0.85,
  };
  const bioStyle: CSSProperties = {
    color: "var(--pv-hero-text)",
    opacity: 0.9,
  };


  const BioBlock = ({ className = "" }: { className?: string }) =>
    bioItems.length > 0 ? (
      <ul
        className={`text-sm leading-relaxed space-y-1.5 pl-0 list-none ${className}`}
        style={bioStyle}
      >
        {bioItems.map((item, i) => (
          <li key={i} className="flex gap-2 items-start">
            <span
              aria-hidden
              className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-[6px]"
              style={{ backgroundColor: "var(--pv-bio-bullet)" }}
            />
            <span className="flex-1">{item}</span>
          </li>
        ))}
      </ul>
    ) : null;

  const sizeLabel = lang === "en" ? "Recommended" : "Zalecane";
  const avatar = (className: string, rounded = "rounded-full", recommend?: string) => {
    const inner = e.avatar_url ? (
      <img
        src={e.avatar_url}
        alt={name}
        className={`${className} ${rounded} object-cover`}
        style={{
          border: "2px solid var(--pv-accent)",
          boxShadow: "0 0 0 3px color-mix(in oklab, var(--pv-accent) 12%, transparent)",
        }}
      />
    ) : (
      <AvatarPlaceholder name={name} className={className} rounded={rounded} />
    );
    if (!recommend || e.avatar_url || !showPlaceholders) return inner;
    return (
      <div className="inline-flex flex-col items-center gap-1">
        {inner}
        <span
          className="text-[10px] leading-none rounded-[6px] px-1.5 py-0.5 border border-dashed whitespace-nowrap"
          style={{
            color: "var(--pv-accent)",
            borderColor: "var(--pv-accent)",
            backgroundColor: "color-mix(in oklab, var(--pv-accent) 6%, transparent)",
          }}
        >
          {sizeLabel}: {recommend}
        </span>
      </div>
    );
  };

  const cover = (className: string, recommend?: string) => {
    const inner = hasCover ? (
      <div
        className={`${className} bg-cover bg-center`}
        style={{ backgroundImage: `url(${e.cover_url})` }}
      />
    ) : (
      <CoverPlaceholder className={className} />
    );
    if (!recommend || hasCover || !showPlaceholders) return inner;
    return (
      <>
        {inner}
        <span
          className="absolute left-2 top-2 z-10 text-[10px] leading-none rounded-[6px] px-1.5 py-0.5 border border-dashed whitespace-nowrap"
          style={{
            color: "var(--pv-accent)",
            borderColor: "var(--pv-accent)",
            backgroundColor: "color-mix(in oklab, #ffffff 70%, transparent)",
          }}
        >
          {sizeLabel}: {recommend}
        </span>
      </>
    );
  };

  const social = (className: string) => (
    <SocialRow expert={e} className={className} showPlaceholders={showPlaceholders} lang={lang} />
  );
  const contact = (className: string) => (
    <ContactInline
      expert={e}
      className={className}
      showPlaceholders={showPlaceholders}
      lang={lang}
      color={"var(--pv-hero-text)"}
    />
  );

  if (preset.heroKind === "centered") {
    return (
      <div className="w-full" style={heroStyle}>
        <div className="mx-auto text-center px-4 py-10" style={{ maxWidth }}>
          <div className="mx-auto inline-block">
            {avatar("h-24 w-24 mx-auto border-2", "rounded-full", "400×400 px")}
          </div>
          <h1 className="mt-4 font-display leading-tight" style={{ fontSize: settings.name_size_lg }}>
            {name}
          </h1>
          <p className="mt-1" style={roleStyle}>
            {roleLine}
          </p>
          {social("mt-4 justify-center")}
          {contact("mt-3 justify-center")}
          <BioBlock className="mt-4 mx-auto max-w-2xl" />
        </div>
      </div>
    );
  }

  if (preset.heroKind === "cover-overlay") {
    return (
      <div style={heroStyle}>
        <div className="relative w-full h-56">
          {cover("absolute inset-0 w-full h-full", "1600×600 px")}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        </div>
        <div className="mx-auto px-4 py-6" style={{ maxWidth }}>
          <div className={`flex gap-4 items-end ${centered ? "justify-center text-center" : ""}`}>
            <div className="-mt-16">
              {avatar("h-24 w-24 border-4 border-background shadow", "rounded-[6px]", "400×400 px")}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-display" style={{ fontSize: settings.name_size_lg }}>
                {name}
              </h1>
              <p className="mt-1" style={roleStyle}>
                {roleLine}
              </p>
              {social("mt-2")}
            </div>
          </div>
          {contact("mt-3")}
          <BioBlock className="mt-4" />
        </div>
      </div>
    );
  }

  if (preset.heroKind === "sidebar") {
    return (
      <div className="mx-auto px-4 py-6" style={{ maxWidth }}>
        <div
          className={`grid gap-6 ${
            preset.sidebar === "right" ? "md:grid-cols-[1fr_260px]" : "md:grid-cols-[260px_1fr]"
          }`}
        >
          <aside
            className={`rounded-[6px] border border-border bg-card p-4 ${
              preset.sidebar === "right" ? "md:order-2" : ""
            }`}
            style={heroStyle}
          >
            {avatar("h-28 w-28", "rounded-[6px]", "480×480 px")}
            <h1 className="mt-3 font-display" style={{ fontSize: settings.name_size_base }}>
              {name}
            </h1>
            <p className="text-xs" style={{ ...roleStyle, fontSize: 12 }}>
              {roleLine}
            </p>
            {social("mt-3")}
            {contact("mt-3 flex-col items-start gap-1")}
          </aside>
          <div style={heroStyle}>
            <BioBlock />
          </div>
        </div>
      </div>
    );
  }

  if (preset.heroKind === "minimal") {
    return (
      <div className="mx-auto px-4 py-10" style={{ ...heroStyle, maxWidth }}>
        <div className={centered ? "text-center" : ""}>
          <div className="h-0.5 w-10 mb-4" style={{ backgroundColor: "var(--pv-accent)" }} />
          <h1 className="font-display" style={{ fontSize: settings.name_size_lg }}>
            {name}
          </h1>
          <p className="mt-1" style={roleStyle}>
            {roleLine}
          </p>
          {social(`mt-4 ${centered ? "justify-center" : ""}`)}
          {contact(`mt-3 ${centered ? "justify-center" : ""}`)}
          <BioBlock className={`mt-4 ${centered ? "mx-auto max-w-2xl" : "max-w-2xl"}`} />
        </div>
      </div>
    );
  }

  if (preset.heroKind === "card") {
    return (
      <div className="mx-auto px-4 py-6" style={{ maxWidth }}>
        <div
          className="rounded-[6px] border border-border bg-card p-6 shadow-sm flex gap-5 items-start"
          style={heroStyle}
        >
          {avatar("h-24 w-24", "rounded-[6px]", "400×400 px")}
          <div className={`flex-1 min-w-0 ${centered ? "text-center mx-auto" : ""}`}>
            <h1 className="font-display" style={{ fontSize: settings.name_size_lg }}>
              {name}
            </h1>
            <p className="mt-1" style={roleStyle}>
              {roleLine}
            </p>
            {social(`mt-3 ${centered ? "justify-center" : ""}`)}
            {contact(`mt-2 ${centered ? "justify-center" : ""}`)}
            <BioBlock className="mt-3" />
          </div>
        </div>
      </div>
    );
  }

  if (preset.heroKind === "editorial") {
    return (
      <div style={heroStyle}>
        <div className="relative w-full h-64">
          {cover("absolute inset-0 w-full h-full", "1600×720 px")}
          <div className="absolute inset-0 bg-black/50" />
          <div className="absolute inset-0 flex items-end">
            <div className="mx-auto w-full px-4 pb-6" style={{ maxWidth }}>
              <h1
                className="font-serif text-white"
                style={{
                  fontSize: settings.name_size_lg,
                  fontFamily: "'Playfair Display', Georgia, serif",
                }}
              >
                {name}
              </h1>
              <p className="text-white/80 italic mt-1">{roleLine}</p>
            </div>
          </div>
        </div>
        <div className="mx-auto px-4 py-6" style={{ maxWidth }}>
          {bioItems.length > 0 && (
            <ul
              className="border-l-4 pl-4 italic text-lg space-y-2 list-none"
              style={{
                borderColor: "var(--pv-accent)",
                fontFamily: "'Playfair Display', Georgia, serif",
                color: heroText ?? undefined,
              }}
            >
              {bioItems.map((item, i) => (
                <li key={i} className="flex gap-2 items-start">
                  <span
                    aria-hidden
                    className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-[6px]"
                    style={{ backgroundColor: "var(--pv-bio-bullet)" }}
                  />
                  <span className="flex-1">{item}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {social("")}
            {contact("")}
          </div>
        </div>
      </div>
    );
  }

  // classic
  return (
    <div style={heroStyle} className="border-b border-border/60">
      <div className="mx-auto px-4 py-10" style={{ maxWidth }}>
        <div className="h-0.5 w-12 mb-5" style={{ backgroundColor: "var(--pv-accent)" }} />
        <div
          className={`flex flex-col md:flex-row gap-6 ${
            centered ? "md:items-center md:justify-center md:text-center" : "items-start"
          }`}
        >
          <div className="shrink-0">{avatar("h-36 w-36 md:h-44 md:w-44", "rounded-[6px]", "600×600 px")}</div>
          <div className="flex-1 min-w-0">
            <p
              className="text-[11px] uppercase tracking-[0.18em] mb-1"
              style={{ color: "var(--pv-accent)" }}
            >
              {LABELS[lang].profileTagline}
            </p>
            <h1 className="font-display leading-[1.05]" style={{ fontSize: settings.name_size_lg }}>
              {name}
            </h1>
            <p className="mt-2" style={roleStyle}>
              {roleLine}
            </p>
            <div className="mt-3 h-px w-full bg-border/60" />
            {social(`mt-3 ${centered ? "justify-center" : ""}`)}
            {contact(`mt-2 ${centered ? "justify-center" : ""}`)}
            <BioBlock className="mt-4" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Wrapper renderujący WSZYSTKIE sekcje wg `section_order` (bez hero). */
export function ExpertSectionsList({
  hub,
  settings,
  lang,
  showPlaceholders = false,
}: {
  hub: ExpertHubData;
  settings: ExpertLayoutSettings;
  lang: Lang;
  showPlaceholders?: boolean;
}) {
  const order = settings.section_order?.length
    ? settings.section_order
    : DEFAULT_EXPERT_SECTION_ORDER;
  return (
    <div className="mx-auto" style={{ maxWidth: settings.max_width }}>
      <div className="grid gap-6 p-4 md:p-6">
        {order.map((key) => {
          if (!isSectionVisible(settings, key)) return null;
          if (key === "hero_cover") return null;
          return (
            <ExpertSectionRenderer
              key={key}
              k={key}
              hub={hub}
              settings={settings}
              lang={lang}
              showPlaceholders={showPlaceholders}
            />
          );
        })}
      </div>
    </div>
  );
}

export function ExpertSectionRenderer({
  k,
  hub,
  settings,
  lang,
  showPlaceholders,
}: {
  k: ExpertSectionKey;
  hub: ExpertHubData;
  settings: ExpertLayoutSettings;
  lang: Lang;
  showPlaceholders: boolean;
}) {
  const preset = findExpertPreset(settings.default_preset);
  const wrap = (title: ReactNode, icon: ReactNode, children: ReactNode) => {
    const inner = (
      <>
        <h2 className="flex items-center gap-2 font-display text-lg">
          <span style={{ color: "var(--pv-accent)" }}>{icon}</span>
          {title}
        </h2>
        <div className={settings.center_details ? "text-center" : ""}>{children}</div>
      </>
    );
    if (preset.id === "card-stack") {
      return (
        <section className="rounded-[6px] border border-border bg-card p-4 shadow-sm space-y-3">
          {inner}
        </section>
      );
    }
    return <section className="space-y-3">{inner}</section>;
  };

  const t = LABELS[lang];
  const e = hub.expert;
  const ph = PLACEHOLDER[lang];
  const placeholderTag = (
    <span
      className="ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-[6px]"
      style={{
        backgroundColor: "color-mix(in oklab, var(--pv-accent) 15%, transparent)",
        color: "var(--pv-accent)",
      }}
    >
      {t.placeholder}
    </span>
  );

  switch (k) {
    case "expertise_bar": {
      const areas =
        hub.areas.length > 0
          ? hub.areas.map((a) => (lang === "en" ? a.name_en : a.name_pl))
          : ph.areas;
      const isPlaceholder = hub.areas.length === 0;
      if (isPlaceholder && !showPlaceholders) return null;
      return (
        <div className="flex flex-wrap gap-1.5 items-center">
          {areas.map((label, i) => (
            <span
              key={`${label}-${i}`}
              className="text-xs px-2 py-1 rounded-[6px] border"
              style={{ borderColor: "var(--pv-accent)", color: "var(--pv-accent)" }}
            >
              {label}
            </span>
          ))}
          {isPlaceholder && showPlaceholders && placeholderTag}
        </div>
      );
    }
    case "details": {
      const bio = lang === "en" ? e.full_bio_en ?? e.bio_en : e.full_bio_pl ?? e.bio_pl;
      const isPlaceholder = !bio;
      if (isPlaceholder && !showPlaceholders) return null;
      return wrap(
        <>
          {t.bio}
          {isPlaceholder && placeholderTag}
        </>,
        <BookOpen className="h-4 w-4" />,
        <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
          {bio ?? ph.bio}
        </p>,
      );
    }
    case "social_row": {
      const hasAny = e.website_url || e.linkedin_url || e.twitter_url || e.contact_email;
      if (!hasAny && !showPlaceholders) return null;
      return wrap(
        <>
          {t.social}
          {!hasAny && placeholderTag}
        </>,
        <Layers className="h-4 w-4" />,
        <SocialRow expert={e} showPlaceholders={showPlaceholders} lang={lang} />,
      );
    }
    case "contact_card": {
      const hasContact = e.contact_email || e.website_url;
      const hasMedia = e.media_contact_email || e.media_contact_phone;
      const isPlaceholder = !hasContact && !hasMedia;
      if (isPlaceholder && !showPlaceholders) return null;
      return wrap(
        <>
          {t.contact}
          {isPlaceholder && placeholderTag}
        </>,
        <Mail className="h-4 w-4" />,
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-[6px] border border-border p-3 space-y-1">
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              {e.contact_email ?? (showPlaceholders ? ph.email : "")}
            </div>
            <div className="flex items-center gap-2">
              <BrandIcon name="website" fallback={LucideGlobe} className="h-3.5 w-3.5 text-muted-foreground" alt="WWW" />
              {e.website_url
                ? e.website_url.replace(/^https?:\/\//, "")
                : showPlaceholders
                  ? ph.website
                  : ""}
            </div>
          </div>
          <div className="rounded-[6px] border border-border p-3 space-y-1">
            <div className="text-xs font-semibold">{t.mediaContact}</div>
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              {e.media_contact_email ?? (showPlaceholders ? ph.mediaEmail : "")}
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              {e.media_contact_phone ?? (showPlaceholders ? ph.phone : "")}
            </div>
          </div>
        </div>,
      );
    }
    case "media_mentions": {
      const items =
        hub.mediaMentions.length > 0
          ? hub.mediaMentions.slice(0, 4).map((m) => ({ outlet: m.outlet, title: m.title, date: m.published_on }))
          : ph.mentions;
      const isPlaceholder = hub.mediaMentions.length === 0;
      if (isPlaceholder && !showPlaceholders) return null;
      return wrap(
        <>
          {t.inMedia}
          {isPlaceholder && placeholderTag}
        </>,
        <Newspaper className="h-4 w-4" />,
        <ul className="divide-y divide-border/60 rounded-[6px] border border-border">
          {items.map((m, i) => (
            <li key={i} className="px-3 py-2 text-sm flex justify-between gap-3">
              <div className="min-w-0">
                <span className="font-medium" style={{ color: "var(--pv-accent)" }}>
                  {m.outlet}
                </span>{" "}
                <span className="text-muted-foreground truncate">{m.title}</span>
              </div>
              <time className="text-xs text-muted-foreground shrink-0">{m.date}</time>
            </li>
          ))}
        </ul>,
      );
    }
    case "podcast_strip": {
      const podcasts = hub.materials.filter((m) => m.kind === "podcast").slice(0, 3);
      const isPlaceholder = podcasts.length === 0;
      if (isPlaceholder && !showPlaceholders) return null;
      const items = isPlaceholder
        ? ph.podcasts
        : podcasts.map((p) => ({ title: (lang === "en" ? p.title_en : p.title_pl) ?? "", date: p.date ?? "" }));
      return wrap(
        <>
          {t.podcasts}
          {isPlaceholder && placeholderTag}
        </>,
        <Mic className="h-4 w-4" />,
        <div className="grid sm:grid-cols-3 gap-3">
          {items.map((p, i) => (
            <div key={i} className="rounded-[6px] border border-border p-3 text-sm">
              <div className="font-medium truncate">{p.title}</div>
              {p.date && <div className="text-xs text-muted-foreground mt-1">{p.date}</div>}
            </div>
          ))}
        </div>,
      );
    }
    case "materials": {
      const real = hub.materials.slice(0, 6);
      const isPlaceholder = real.length === 0;
      if (isPlaceholder && !showPlaceholders) return null;
      return wrap(
        <>
          {t.materials}
          {isPlaceholder && placeholderTag}
        </>,
        <BookOpen className="h-4 w-4" />,
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {isPlaceholder
            ? ph.materials.map((title, i) => (
                <div key={i} className="rounded-[6px] border border-border overflow-hidden bg-card">
                  <CoverPlaceholder className="w-full h-24" />
                  <div className="p-2 text-sm">
                    <div className="text-[10px] uppercase text-muted-foreground">
                      {i % 3 === 0 ? "report" : i % 3 === 1 ? "article" : "video"}
                    </div>
                    <div className="font-medium line-clamp-2">{title}</div>
                  </div>
                </div>
              ))
            : real.map((m) => (
                <div key={m.id} className="rounded-[6px] border border-border overflow-hidden bg-card">
                  {m.cover_url ? (
                    <img src={m.cover_url} alt="" className="w-full h-24 object-cover" />
                  ) : (
                    <CoverPlaceholder className="w-full h-24" />
                  )}
                  <div className="p-2 text-sm">
                    <div className="text-[10px] uppercase text-muted-foreground">{m.kind}</div>
                    <div className="font-medium line-clamp-2">
                      {lang === "en" ? m.title_en : m.title_pl}
                    </div>
                  </div>
                </div>
              ))}
        </div>,
      );
    }
    case "cv": {
      if (!showPlaceholders) return null;
      return wrap(
        <>
          {t.cv}
          {placeholderTag}
        </>,
        <GraduationCap className="h-4 w-4" />,
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-[6px] border border-border p-3">
              <div className="flex items-center gap-2">
                <Briefcase className="h-3.5 w-3.5" style={{ color: "var(--pv-accent)" }} />
                <span className="font-medium">
                  {lang === "en" ? `Position ${i + 1}` : `Stanowisko ${i + 1}`}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {lang === "en" ? "Institution · 2020 - 2024" : "Instytucja · 2020 - 2024"}
              </div>
            </div>
          ))}
        </div>,
      );
    }
    case "programs": {
      const isPlaceholder = hub.programs.length === 0;
      if (isPlaceholder && !showPlaceholders) return null;
      const items = isPlaceholder
        ? ph.programs
        : hub.programs.slice(0, 6).map((p) => ({
            name: (lang === "en" ? p.name_en : p.name_pl) ?? "",
            role: (lang === "en" ? p.role_en : p.role_pl) ?? "",
          }));
      return wrap(
        <>
          {t.programs}
          {isPlaceholder && placeholderTag}
        </>,
        <Briefcase className="h-4 w-4" />,
        <ul className="grid sm:grid-cols-2 gap-2">
          {items.map((p, i) => (
            <li key={i} className="rounded-[6px] border border-border p-2 text-sm">
              <div className="font-medium">{p.name}</div>
              {p.role && <div className="text-xs text-muted-foreground">{p.role}</div>}
            </li>
          ))}
        </ul>,
      );
    }
    default:
      return null;
  }
}

/**
 * Rząd ikon social. Ikony zaciągane z admin/ikony przez BrandIcon
 * (aliasy: twitter → x, website → globe, mail → email itd.). Twitter
 * NIE jest już renderowany oddzielnie - to samo pole url wchodzi jako "x".
 */
export function SocialRow({
  expert,
  className = "",
  showPlaceholders = false,
  lang = "pl",
}: {
  expert: ExpertHubData["expert"];
  className?: string;
  showPlaceholders?: boolean;
  lang?: Lang;
}) {
  const ph = PLACEHOLDER[lang];
  const website = expert.website_url || (showPlaceholders ? `https://${ph.website}` : "");
  const linkedin = expert.linkedin_url || (showPlaceholders ? "https://linkedin.com/in/anna-kowalska" : "");
  const x = expert.twitter_url || (showPlaceholders ? "https://x.com/anna_kowalska" : "");
  const mail = expert.contact_email || (showPlaceholders ? ph.email : "");
  const items: { href: string; node: ReactNode; label: string }[] = [];
  if (website)
    items.push({
      href: website,
      label: "website",
      node: <BrandIcon name="website" fallback={LucideGlobe} className="h-4 w-4" alt="WWW" />,
    });
  if (linkedin)
    items.push({
      href: linkedin,
      label: "linkedin",
      node: <BrandIcon name="linkedin" fallback={LucideLinkedin} className="h-4 w-4" alt="LinkedIn" />,
    });
  if (x)
    items.push({
      href: x,
      label: "x",
      node: <BrandIcon name="x" fallback={XIcon} className="h-4 w-4" alt="X" />,
    });
  if (mail)
    items.push({
      href: `mailto:${mail}`,
      label: "email",
      node: <BrandIcon name="email" fallback={Mail} className="h-4 w-4" alt="E-mail" />,
    });
  if (items.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {items.map((s) => (
        <a
          key={s.label}
          href={s.href}
          target={s.href.startsWith("mailto:") ? undefined : "_blank"}
          rel={s.href.startsWith("mailto:") ? undefined : "noreferrer"}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-border hover:bg-muted"
          style={{ color: "var(--pv-accent)" }}
          aria-label={s.label}
        >
          {s.node}
        </a>
      ))}
    </div>
  );
}

export function ContactInline({
  expert,
  className = "",
  showPlaceholders = false,
  lang = "pl",
  color,
}: {
  expert: ExpertHubData["expert"];
  className?: string;
  showPlaceholders?: boolean;
  lang?: Lang;
  color?: string | null;
}) {
  const ph = PLACEHOLDER[lang];
  const email = expert.contact_email || (showPlaceholders ? ph.email : "");
  const phone = (expert as { phone?: string | null }).phone || (showPlaceholders ? ph.phone : "");
  const site = expert.website_url || (showPlaceholders ? ph.website : "");
  const items: { icon: ReactNode; text: string; href?: string }[] = [];
  if (email)
    items.push({
      icon: <BrandIcon name="email" fallback={Mail} className="h-3.5 w-3.5" alt="" />,
      text: email,
      href: `mailto:${email}`,
    });
  if (phone) items.push({ icon: <Phone className="h-3.5 w-3.5" />, text: phone, href: `tel:${phone.replace(/\s+/g, "")}` });
  if (site)
    items.push({
      icon: <BrandIcon name="website" fallback={LucideGlobe} className="h-3.5 w-3.5" alt="" />,
      text: site.replace(/^https?:\/\//, ""),
      href: site.startsWith("http") ? site : `https://${site}`,
    });
  if (items.length === 0) return null;
  const style: CSSProperties = { color: color ?? undefined, opacity: color ? 0.9 : undefined };
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${className}`} style={style}>
      {items.map((c, i) => (
        <a key={i} href={c.href} className="inline-flex items-center gap-1.5 hover:underline">
          {c.icon}
          <span>{c.text}</span>
        </a>
      ))}
    </div>
  );
}

/**
 * Zwraca `style` do wpięcia w root wrappera. Wystawia WSZYSTKIE tokeny z
 * `expert_layout_settings` jako CSS variables, tak żeby renderer nie musiał
 * czytać tych pól bezpośrednio: `--pv-accent`, `--pv-bio-bullet`, kolory hero
 * (`--pv-hero-bg`, `--pv-hero-text`) oraz responsywne rozmiary tekstu
 * (`--pv-name-size`, `--pv-role-size`) budowane z base/lg przez `clamp()`.
 *
 * `theme` dobiera warianty *_dark. Dla trybu automatycznego (public site)
 * użyj też `<ExpertLayoutStyleScope />` który emituje styl `.dark [scope]`.
 */
export function expertLayoutCssVars(
  settings: ExpertLayoutSettings,
  theme: "light" | "dark" = "light",
): CSSProperties {
  const accent = theme === "dark" ? settings.accent_color_dark : settings.accent_color;
  const bioBullet = theme === "dark" ? settings.bio_bullet_color_dark : settings.bio_bullet_color;
  const heroBg = theme === "dark" ? settings.hero_bg_color_dark : settings.hero_bg_color;
  const heroText = theme === "dark" ? settings.hero_text_color_dark : settings.hero_text_color;

  const nameBase = Math.max(12, settings.name_size_base || 28);
  const nameLg = Math.max(nameBase, settings.name_size_lg || 44);
  const roleBase = Math.max(10, settings.role_size_base || 14);
  const roleLg = Math.max(roleBase, settings.role_size_lg || 18);

  return {
    "--pv-accent": accent ?? "hsl(var(--brand))",
    "--pv-bio-bullet": bioBullet ?? accent ?? "hsl(var(--brand))",
    "--pv-hero-bg": heroBg ?? "transparent",
    "--pv-hero-text": heroText ?? "inherit",
    "--pv-name-size-base": `${nameBase}px`,
    "--pv-name-size-lg": `${nameLg}px`,
    "--pv-name-size": `clamp(${nameBase}px, calc(${nameBase}px + (${nameLg} - ${nameBase}) * ((100vw - 375px) / (1200 - 375))), ${nameLg}px)`,
    "--pv-role-size": `clamp(${roleBase}px, calc(${roleBase}px + (${roleLg} - ${roleBase}) * ((100vw - 375px) / (1200 - 375))), ${roleLg}px)`,
    "--pv-max-width": `${settings.max_width}px`,
  } as CSSProperties;
}

/**
 * Wpina scoped `<style>` z dark-mode override tokenów `--pv-*`. Wywoływać
 * raz na wrapper z unikalnym `scopeId`. Dzięki temu jeden wrapper obsługuje
 * i tryb light, i dark bez przełączania props z zewnątrz.
 */
export function ExpertLayoutStyleScope({
  scopeId,
  settings,
}: {
  scopeId: string;
  settings: ExpertLayoutSettings;
}) {
  const dark = expertLayoutCssVars(settings, "dark") as Record<string, string>;
  const decls = Object.entries(dark)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ");
  const css = `.dark [data-pv-scope="${scopeId}"]{${decls}}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

