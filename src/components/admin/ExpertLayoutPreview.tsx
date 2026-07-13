// Podgląd na żywo layoutu strony eksperta w panelu admina.
// Renderujemy schematyczny mockup RZECZYWISTYCH danych pierwszego eksperta
// (profiles.slug != null) z uwzględnieniem AKTUALNYCH ustawień z formularza
// (`local`), zanim jeszcze zostaną zapisane. Dzięki temu klikanie presetu /
// zmiana kolorów / kolejności / widoczności = natychmiastowa zmiana w UI.
//
// Nie ładujemy publicznej strony w iframe, bo:
//   1. publiczna strona konsumuje zapisane `expert_layout_settings`,
//      a chcemy widzieć NIEZAPISANE zmiany od razu,
//   2. iframe wymuszałby pełny reload przy każdym kliknięciu.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Mail,
  Phone,
  Globe,
  Linkedin,
  Twitter,
  ExternalLink,
  Newspaper,
  Mic,
  BookOpen,
  Briefcase,
  GraduationCap,
  Layers,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { expertHubQueryOptions } from "@/lib/experts/queries";
import type { ExpertHubData } from "@/lib/experts/types";
import {
  findExpertPreset,
  isSectionVisible,
  DEFAULT_EXPERT_SECTION_ORDER,
  type ExpertLayoutSettings,
  type ExpertSectionKey,
} from "@/lib/expertLayouts";

type Lang = "pl" | "en";
type Theme = "light" | "dark";

async function fetchSampleSlug(): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("slug")
    .not("slug", "is", null)
    .limit(1)
    .maybeSingle();
  return (data?.slug as string | null) ?? null;
}

const LABELS: Record<Lang, Record<string, string>> = {
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
    noSample: "Brak eksperta z ustawionym slug-iem. Dodaj slug w profilu, aby zobaczyć podgląd.",
    empty: "Brak danych do wyświetlenia w tej sekcji.",
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
    noSample: "No expert with a slug set. Add a slug to a profile to see the preview.",
    empty: "No data to render in this section.",
  },
};

export function ExpertLayoutPreview({ settings }: { settings: ExpertLayoutSettings }) {
  const [lang, setLang] = useState<Lang>("pl");
  const [theme, setTheme] = useState<Theme>("light");

  const { data: sampleSlug } = useQuery({
    queryKey: ["admin", "expert-layout-preview", "sample-slug"] as const,
    queryFn: fetchSampleSlug,
    staleTime: 5 * 60_000,
  });

  const [slug, setSlug] = useState<string>("");
  const effectiveSlug = slug || sampleSlug || "";

  const { data: hub, isLoading } = useQuery({
    ...expertHubQueryOptions(effectiveSlug),
    enabled: Boolean(effectiveSlug),
  });

  const preset = findExpertPreset(settings.default_preset);
  const order = settings.section_order?.length ? settings.section_order : DEFAULT_EXPERT_SECTION_ORDER;

  // Kolory - warianty light/dark; puste = auto (kolor motywu).
  const heroBg = theme === "dark" ? settings.hero_bg_color_dark : settings.hero_bg_color;
  const heroText = theme === "dark" ? settings.hero_text_color_dark : settings.hero_text_color;
  const accent = theme === "dark" ? settings.accent_color_dark : settings.accent_color;

  const t = LABELS[lang];

  const previewStyle = useMemo(
    () =>
      ({
        "--pv-accent": accent ?? "hsl(var(--brand))",
      }) as React.CSSProperties,
    [accent],
  );

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-base">Podgląd na żywo</h2>
          <p className="text-[11px] text-muted-foreground">
            Zmiany widać od razu po kliknięciu - dane realnego eksperta, ale wariant/kolejność/kolory
            pochodzą z niezapisanych ustawień powyżej. Zapis utrwala je publicznie.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <ToggleGroup
            options={[
              { v: "pl", label: "PL" },
              { v: "en", label: "EN" },
            ]}
            value={lang}
            onChange={(v) => setLang(v as Lang)}
          />
          <ToggleGroup
            options={[
              { v: "light", label: "Light" },
              { v: "dark", label: "Dark" },
            ]}
            value={theme}
            onChange={(v) => setTheme(v as Theme)}
          />
          {effectiveSlug && (
            <a
              href={`${lang === "en" ? "/en" : ""}/author/${encodeURIComponent(effectiveSlug)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-[11px] hover:bg-muted"
              title={lang === "en" ? "Open in a new tab" : "Otwórz w nowej karcie"}
            >
              <ExternalLink className="h-3 w-3" />
              {lang === "en" ? "Open" : "Otwórz"}
            </a>
          )}
        </div>
      </div>

      <label className="block text-[11px] text-muted-foreground">
        <span>Slug eksperta (profiles.slug)</span>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value.trim())}
          placeholder={sampleSlug ?? "np. jan-kowalski"}
          className="mt-1 w-full max-w-xs px-2 py-1.5 rounded border border-input bg-background text-xs font-mono text-foreground"
        />
      </label>

      <div
        className={`rounded-lg border border-border overflow-hidden shadow-sm ${theme === "dark" ? "dark" : ""}`}
        style={previewStyle}
      >
        <div className="bg-background text-foreground">
          {!effectiveSlug ? (
            <div className="p-8 text-center text-xs text-muted-foreground">{t.noSample}</div>
          ) : isLoading || !hub ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              {lang === "en" ? "Loading preview..." : "Ładowanie podglądu..."}
            </div>
          ) : (
            <ExpertMockup
              hub={hub}
              settings={settings}
              lang={lang}
              heroBg={heroBg}
              heroText={heroText}
              maxWidth={settings.max_width}
            />
          )}

          {hub && effectiveSlug && (
            <div className="mx-auto" style={{ maxWidth: settings.max_width }}>
              <div className="grid gap-6 p-4 md:p-6">
                {order.map((key) => {
                  if (!isSectionVisible(settings, key)) return null;
                  if (key === "hero_cover") return null; // hero renderowany w mockupie
                  return <SectionRenderer key={key} k={key} hub={hub} settings={settings} lang={lang} />;
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Aktywny preset: <b>{lang === "en" ? preset.label_en : preset.label_pl}</b> ·{" "}
        {lang === "en" ? preset.description_en : preset.description_pl}
      </p>
    </section>
  );
}

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { v: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded border border-border overflow-hidden text-[11px]">
      {options.map((o, i) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={`px-2 py-1 ${i > 0 ? "border-l border-border" : ""} ${
            value === o.v ? "bg-brand text-brand-foreground" : "bg-background text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- HERO ----------------------------------------------------------
function ExpertMockup({
  hub,
  settings,
  lang,
  heroBg,
  heroText,
  maxWidth,
}: {
  hub: ExpertHubData;
  settings: ExpertLayoutSettings;
  lang: Lang;
  heroBg: string | null;
  heroText: string | null;
  maxWidth: number;
}) {
  const preset = findExpertPreset(settings.default_preset);
  const e = hub.expert;
  const name = e.display_name ?? "-";
  const role = e.job_title ?? "";
  const company = e.company ?? "";
  const roleLine = [role, company].filter(Boolean).join(" · ");

  const heroStyle: React.CSSProperties = {
    backgroundColor: heroBg ?? undefined,
    color: heroText ?? undefined,
  };

  const centered = settings.center_hero || preset.centeredContent;

  if (preset.heroKind === "centered") {
    return (
      <div className="w-full" style={heroStyle}>
        <div className="mx-auto text-center px-4 py-10" style={{ maxWidth }}>
          {e.avatar_url && (
            <img
              src={e.avatar_url}
              alt={name}
              className="mx-auto h-24 w-24 rounded-full object-cover border-2"
              style={{ borderColor: "var(--pv-accent)" }}
            />
          )}
          <h1
            className="mt-4 font-display leading-tight"
            style={{ fontSize: settings.name_size_lg }}
          >
            {name}
          </h1>
          {roleLine && (
            <p className="mt-1 text-muted-foreground" style={{ fontSize: settings.role_size_lg }}>
              {roleLine}
            </p>
          )}
          <SocialRow expert={e} className="mt-4 justify-center" />
        </div>
      </div>
    );
  }

  if (preset.heroKind === "cover-overlay" && e.cover_url) {
    return (
      <div style={heroStyle}>
        <div
          className="relative w-full h-56 bg-cover bg-center"
          style={{ backgroundImage: `url(${e.cover_url})` }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        </div>
        <div className="mx-auto px-4 py-6" style={{ maxWidth }}>
          <div className={`flex gap-4 items-end ${centered ? "justify-center text-center" : ""}`}>
            {e.avatar_url && (
              <img
                src={e.avatar_url}
                alt={name}
                className="-mt-16 h-24 w-24 rounded-md object-cover border-4 border-background shadow"
              />
            )}
            <div>
              <h1 className="font-display" style={{ fontSize: settings.name_size_lg }}>
                {name}
              </h1>
              {roleLine && (
                <p className="mt-1 text-muted-foreground" style={{ fontSize: settings.role_size_lg }}>
                  {roleLine}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (preset.heroKind === "sidebar") {
    return (
      <div className="mx-auto px-4 py-6" style={{ maxWidth }}>
        <div className={`grid gap-6 ${preset.sidebar === "right" ? "md:grid-cols-[1fr_260px]" : "md:grid-cols-[260px_1fr]"}`}>
          <aside
            className={`rounded-lg border border-border bg-card p-4 ${preset.sidebar === "right" ? "md:order-2" : ""}`}
            style={heroStyle}
          >
            {e.avatar_url && (
              <img src={e.avatar_url} alt={name} className="h-28 w-28 rounded object-cover" />
            )}
            <h1 className="mt-3 font-display" style={{ fontSize: settings.name_size_base }}>
              {name}
            </h1>
            {roleLine && <p className="text-xs opacity-80">{roleLine}</p>}
            <SocialRow expert={e} className="mt-3" />
          </aside>
          <div className="text-sm text-muted-foreground">
            {lang === "en" ? e.bio_en ?? "" : e.bio_pl ?? ""}
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
          {roleLine && (
            <p className="mt-1 text-muted-foreground" style={{ fontSize: settings.role_size_lg }}>
              {roleLine}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (preset.heroKind === "card") {
    return (
      <div className="mx-auto px-4 py-6" style={{ maxWidth }}>
        <div
          className="rounded-xl border border-border bg-card p-6 shadow-sm flex gap-5 items-start"
          style={heroStyle}
        >
          {e.avatar_url && (
            <img src={e.avatar_url} alt={name} className="h-24 w-24 rounded-lg object-cover" />
          )}
          <div className={centered ? "text-center mx-auto" : ""}>
            <h1 className="font-display" style={{ fontSize: settings.name_size_lg }}>
              {name}
            </h1>
            {roleLine && (
              <p className="mt-1 text-muted-foreground" style={{ fontSize: settings.role_size_lg }}>
                {roleLine}
              </p>
            )}
            <SocialRow expert={e} className="mt-3" />
          </div>
        </div>
      </div>
    );
  }

  if (preset.heroKind === "editorial") {
    return (
      <div style={heroStyle}>
        {e.cover_url && (
          <div
            className="relative w-full h-64 bg-cover bg-center"
            style={{ backgroundImage: `url(${e.cover_url})` }}
          >
            <div className="absolute inset-0 bg-black/50" />
            <div className="absolute inset-0 flex items-end">
              <div className="mx-auto w-full px-4 pb-6" style={{ maxWidth }}>
                <h1
                  className="font-serif text-white"
                  style={{ fontSize: settings.name_size_lg, fontFamily: "'Playfair Display', Georgia, serif" }}
                >
                  {name}
                </h1>
                {roleLine && <p className="text-white/80 italic mt-1">{roleLine}</p>}
              </div>
            </div>
          </div>
        )}
        {(lang === "en" ? e.bio_en : e.bio_pl) && (
          <div className="mx-auto px-4 py-6" style={{ maxWidth }}>
            <blockquote
              className="border-l-4 pl-4 italic text-lg"
              style={{ borderColor: "var(--pv-accent)", fontFamily: "'Playfair Display', Georgia, serif" }}
            >
              {(lang === "en" ? e.bio_en : e.bio_pl) as string}
            </blockquote>
          </div>
        )}
      </div>
    );
  }

  // classic (split)
  return (
    <div style={heroStyle}>
      <div className="mx-auto px-4 py-8" style={{ maxWidth }}>
        <div className={`flex flex-col md:flex-row gap-5 ${centered ? "md:items-center md:justify-center md:text-center" : "items-start"}`}>
          {e.avatar_url && (
            <img
              src={e.avatar_url}
              alt={name}
              className="h-32 w-32 md:h-40 md:w-32 rounded-sm object-cover"
              style={{ outline: "2px solid var(--pv-accent)" }}
            />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-display leading-tight" style={{ fontSize: settings.name_size_lg }}>
              {name}
            </h1>
            {roleLine && (
              <p className="mt-1 text-muted-foreground" style={{ fontSize: settings.role_size_lg }}>
                {roleLine}
              </p>
            )}
            <SocialRow expert={e} className={`mt-3 ${centered ? "justify-center" : ""}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- SEKCJE --------------------------------------------------------
function SectionRenderer({
  k,
  hub,
  settings,
  lang,
}: {
  k: ExpertSectionKey;
  hub: ExpertHubData;
  settings: ExpertLayoutSettings;
  lang: Lang;
}) {
  const preset = findExpertPreset(settings.default_preset);
  const wrap = (title: string, icon: React.ReactNode, children: React.ReactNode) => {
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
        <section className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3">
          {inner}
        </section>
      );
    }
    return <section className="space-y-3">{inner}</section>;
  };

  const t = LABELS[lang];
  const e = hub.expert;

  switch (k) {
    case "expertise_bar": {
      if (hub.areas.length === 0) return null;
      return (
        <div className="flex flex-wrap gap-1.5">
          {hub.areas.map((a) => (
            <span
              key={a.id}
              className="text-xs px-2 py-1 rounded-full border"
              style={{ borderColor: "var(--pv-accent)", color: "var(--pv-accent)" }}
            >
              {lang === "en" ? a.name_en : a.name_pl}
            </span>
          ))}
        </div>
      );
    }
    case "details": {
      const bio = lang === "en" ? e.full_bio_en ?? e.bio_en : e.full_bio_pl ?? e.bio_pl;
      if (!bio) return null;
      return wrap(
        t.bio,
        <BookOpen className="h-4 w-4" />,
        <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">{bio}</p>,
      );
    }
    case "social_row": {
      return wrap(
        "Social",
        <Layers className="h-4 w-4" />,
        <SocialRow expert={e} />,
      );
    }
    case "contact_card": {
      if (!e.contact_email && !e.website_url && !e.media_contact_email) return null;
      return wrap(
        t.contact,
        <Mail className="h-4 w-4" />,
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          {(e.contact_email || e.website_url) && (
            <div className="rounded border border-border p-3 space-y-1">
              {e.contact_email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  {e.contact_email}
                </div>
              )}
              {e.website_url && (
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                  {e.website_url.replace(/^https?:\/\//, "")}
                </div>
              )}
            </div>
          )}
          {(e.media_contact_email || e.media_contact_phone) && (
            <div className="rounded border border-border p-3 space-y-1">
              <div className="text-xs font-semibold">{t.mediaContact}</div>
              {e.media_contact_email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  {e.media_contact_email}
                </div>
              )}
              {e.media_contact_phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  {e.media_contact_phone}
                </div>
              )}
            </div>
          )}
        </div>,
      );
    }
    case "media_mentions": {
      if (hub.mediaMentions.length === 0) return null;
      return wrap(
        t.inMedia,
        <Newspaper className="h-4 w-4" />,
        <ul className="divide-y divide-border/60 rounded border border-border">
          {hub.mediaMentions.slice(0, 4).map((m) => (
            <li key={m.id} className="px-3 py-2 text-sm flex justify-between gap-3">
              <div className="min-w-0">
                <span className="font-medium" style={{ color: "var(--pv-accent)" }}>
                  {m.outlet}
                </span>{" "}
                <span className="text-muted-foreground truncate">{m.title}</span>
              </div>
              <time className="text-xs text-muted-foreground shrink-0">{m.published_on}</time>
            </li>
          ))}
        </ul>,
      );
    }
    case "podcast_strip": {
      const podcasts = hub.materials.filter((m) => m.kind === "podcast").slice(0, 3);
      if (podcasts.length === 0) return null;
      return wrap(
        t.podcasts,
        <Mic className="h-4 w-4" />,
        <div className="grid sm:grid-cols-3 gap-3">
          {podcasts.map((p) => (
            <div key={p.id} className="rounded border border-border p-3 text-sm">
              <div className="font-medium truncate">{lang === "en" ? p.title_en : p.title_pl}</div>
              {p.date && <div className="text-xs text-muted-foreground mt-1">{p.date}</div>}
            </div>
          ))}
        </div>,
      );
    }
    case "materials": {
      const items = hub.materials.slice(0, 6);
      if (items.length === 0) return null;
      return wrap(
        t.materials,
        <BookOpen className="h-4 w-4" />,
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((m) => (
            <div key={m.id} className="rounded border border-border overflow-hidden bg-card">
              {m.cover_url && <img src={m.cover_url} alt="" className="w-full h-24 object-cover" />}
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
      return wrap(
        t.cv,
        <GraduationCap className="h-4 w-4" />,
        <p className="text-sm text-muted-foreground">
          {lang === "en"
            ? "CV entries (experience, education, skills) render here."
            : "Wpisy CV (doświadczenie, edukacja, umiejętności) pojawią się tutaj."}
        </p>,
      );
    }
    case "programs": {
      if (hub.programs.length === 0) return null;
      return wrap(
        t.programs,
        <Briefcase className="h-4 w-4" />,
        <ul className="grid sm:grid-cols-2 gap-2">
          {hub.programs.slice(0, 6).map((p) => (
            <li key={p.id} className="rounded border border-border p-2 text-sm">
              <div className="font-medium">{lang === "en" ? p.name_en : p.name_pl}</div>
              {(lang === "en" ? p.role_en : p.role_pl) && (
                <div className="text-xs text-muted-foreground">
                  {(lang === "en" ? p.role_en : p.role_pl) as string}
                </div>
              )}
            </li>
          ))}
        </ul>,
      );
    }
    default:
      return null;
  }
}

function SocialRow({
  expert,
  className = "",
}: {
  expert: ExpertHubData["expert"];
  className?: string;
}) {
  const items: { href: string; icon: React.ReactNode; label: string }[] = [];
  if (expert.website_url) items.push({ href: expert.website_url, icon: <Globe className="h-4 w-4" />, label: "web" });
  if (expert.linkedin_url) items.push({ href: expert.linkedin_url, icon: <Linkedin className="h-4 w-4" />, label: "linkedin" });
  if (expert.twitter_url) items.push({ href: expert.twitter_url, icon: <Twitter className="h-4 w-4" />, label: "x" });
  if (expert.contact_email) items.push({ href: `mailto:${expert.contact_email}`, icon: <Mail className="h-4 w-4" />, label: "mail" });
  if (items.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {items.map((s) => (
        <a
          key={s.label}
          href={s.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border hover:bg-muted"
          style={{ color: "var(--pv-accent)" }}
          aria-label={s.label}
        >
          {s.icon}
        </a>
      ))}
    </div>
  );
}
