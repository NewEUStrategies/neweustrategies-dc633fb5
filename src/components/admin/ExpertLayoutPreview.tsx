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
    placeholder: "Przykładowa treść",
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
    placeholder: "Sample content",
  },
};

// Placeholdery - używane, gdy dane eksperta są puste. Dzięki temu każdy preset
// pokazuje pełen szkielet strony (avatar, okładka, bio, listy) niezależnie od
// tego, czy wybrany ekspert ma wypełnione pola.
const PLACEHOLDER = {
  pl: {
    bio: "Dr Anna Kowalska jest starszą analityczką w zespole polityki europejskiej New European Strategies. Specjalizuje się w polityce bezpieczeństwa UE, relacjach transatlantyckich oraz strategicznej autonomii Europy. Autorka ponad 40 publikacji recenzowanych, komentatorka w czołowych mediach europejskich, doradczyni instytucji publicznych oraz think-tanków. Przed dołączeniem do NES pracowała w Ministerstwie Spraw Zagranicznych oraz w Parlamencie Europejskim, gdzie kierowała zespołem doradczym ds. polityki wschodniej. Regularnie występuje na konferencjach Munich Security Conference, GLOBSEC oraz Warsaw Security Forum.",
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
    bio: "Dr. Anna Kowalska is a Senior Fellow at New European Strategies, where she leads research on European security policy, transatlantic relations, and Europe's strategic autonomy. She is the author of more than 40 peer-reviewed publications, a regular commentator in major European media, and an adviser to public institutions and leading think tanks. Prior to joining NES she served at the Ministry of Foreign Affairs and at the European Parliament, where she led the advisory team on Eastern policy. She is a recurring speaker at the Munich Security Conference, GLOBSEC, and Warsaw Security Forum.",
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

function AvatarPlaceholder({
  name,
  className = "",
  rounded = "rounded-full",
}: {
  name: string;
  className?: string;
  rounded-[6px]?: string;
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
      className={`${className} ${rounded-[6px]} flex items-center justify-center font-display text-2xl select-none`}
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

function CoverPlaceholder({ className = "" }: { className?: string }) {
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

export function ExpertLayoutPreview({
  settings,
  savedAt = 0,
}: {
  settings: ExpertLayoutSettings;
  savedAt?: number;
}) {
  const [lang, setLang] = useState<Lang>("pl");
  const [theme, setTheme] = useState<Theme>("light");
  const [showPlaceholders, setShowPlaceholders] = useState<boolean>(true);
  // 'draft' = mockup napędzany niezapisanym `local`; 'published' = iframe
  // z realnie opublikowaną stroną /author/$slug. Po każdym zapisie
  // automatycznie przełączamy na 'published', żeby administrator widział
  // dokładnie to, co widzi publiczność.
  const [mode, setMode] = useState<"draft" | "published">("draft");
  const [iframeNonce, setIframeNonce] = useState(0);

  useEffect(() => {
    if (savedAt > 0) {
      setMode("published");
      setIframeNonce((n) => n + 1);
    }
  }, [savedAt]);

  const { data: sampleSlug } = useQuery({
    queryKey: ["admin", "expert-layout-preview", "sample-slug"] as const,
    queryFn: fetchSampleSlug,
    staleTime: 5 * 60_000,
  });

  const [slug, setSlug] = useState<string>("");
  const effectiveSlug = slug || sampleSlug || "";

  const { data: hub, isLoading } = useQuery({
    ...expertHubQueryOptions(effectiveSlug),
    enabled: Boolean(effectiveSlug) && mode === "draft",
  });

  const publicHref = effectiveSlug
    ? `${lang === "en" ? "/en" : ""}/author/${encodeURIComponent(effectiveSlug)}`
    : "";
  const iframeSrc = publicHref ? `${publicHref}?__preview=${iframeNonce}` : "";
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const applyThemeToIframe = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      const doc = win.document;
      doc.documentElement.classList.toggle("dark", theme === "dark");
      doc.documentElement.style.colorScheme = theme;
      try {
        win.localStorage.setItem("theme", theme);
      } catch {
        /* storage może być zablokowane w sandboxie */
      }
    } catch {
      /* cross-origin - iframe jest same-origin, ignorujemy */
    }
  };

  useEffect(() => {
    if (mode === "published") applyThemeToIframe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, mode]);


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
            {mode === "draft"
              ? "Roboczy podgląd - klik w preset / kolor / kolejność zmienia widok od razu. Zapis przełącza podgląd na wersję publiczną."
              : "Wersja opublikowana - dokładnie to samo, co widzi publiczność na /author/…. Wróć do trybu roboczego, aby dalej edytować."}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <ToggleGroup
            options={[
              { v: "draft", label: "Roboczy" },
              { v: "published", label: "Publiczny" },
            ]}
            value={mode}
            onChange={(v) => {
              setMode(v as "draft" | "published");
              if (v === "published") setIframeNonce((n) => n + 1);
            }}
          />
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
          <ToggleGroup
            options={[
              { v: "on", label: lang === "en" ? "Sample: on" : "Przykład: wł" },
              { v: "off", label: lang === "en" ? "Sample: off" : "Przykład: wył" },
            ]}
            value={showPlaceholders ? "on" : "off"}
            onChange={(v) => setShowPlaceholders(v === "on")}
          />
          {mode === "published" && (
            <button
              type="button"
              onClick={() => setIframeNonce((n) => n + 1)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] border border-border text-[11px] hover:bg-muted"
              title="Odśwież iframe"
            >
              Odśwież
            </button>
          )}
          {publicHref && (
            <a
              href={publicHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] border border-border text-[11px] hover:bg-muted"
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
          className="mt-1 w-full max-w-xs px-2 py-1.5 rounded-[6px] border border-input bg-background text-xs font-mono text-foreground"
        />
      </label>

      <div
        className={`rounded-[6px] border border-border overflow-hidden shadow-sm ${theme === "dark" && mode === "draft" ? "dark" : ""}`}
        style={previewStyle}
      >
        {mode === "published" ? (
          !effectiveSlug ? (
            <div className="p-8 text-center text-xs text-muted-foreground bg-background">{t.noSample}</div>
          ) : (
            <iframe
              ref={iframeRef}
              key={`${effectiveSlug}-${lang}-${iframeNonce}`}
              src={iframeSrc}
              title="Podgląd publicznej strony eksperta"
              onLoad={applyThemeToIframe}
              className="w-full h-[1000px] bg-background"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            />
          )
        ) : (
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
                showPlaceholders={showPlaceholders}
              />
            )}

            {hub && effectiveSlug && (
              <div className="mx-auto" style={{ maxWidth: settings.max_width }}>
                <div className="grid gap-6 p-4 md:p-6">
                  {order.map((key) => {
                    if (!isSectionVisible(settings, key)) return null;
                    if (key === "hero_cover") return null;
                    return (
                      <SectionRenderer key={key} k={key} hub={hub} settings={settings} lang={lang} showPlaceholders={showPlaceholders} />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
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
    <div className="inline-flex rounded-[6px] border border-border overflow-hidden text-[11px]">
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
  showPlaceholders,
}: {
  hub: ExpertHubData;
  settings: ExpertLayoutSettings;
  lang: Lang;
  heroBg: string | null;
  heroText: string | null;
  maxWidth: number;
  showPlaceholders: boolean;
}) {
  const preset = findExpertPreset(settings.default_preset);
  const e = hub.expert;
  const ph = PLACEHOLDER[lang];
  const name = e.display_name ?? (showPlaceholders ? (lang === "en" ? "Sample Expert" : "Przykładowy Ekspert") : "");
  const role = e.job_title ?? "";
  const company = e.company ?? "";
  const realRoleLine = [role, company].filter(Boolean).join(" · ");
  const roleLine = realRoleLine || (showPlaceholders ? ph.role : "");
  const bioText = (lang === "en" ? e.bio_en : e.bio_pl) ?? (showPlaceholders ? ph.bio : "");
  const hasCover = Boolean(e.cover_url);

  const heroStyle: React.CSSProperties = {
    backgroundColor: heroBg ?? undefined,
    color: heroText ?? undefined,
  };

  const centered = settings.center_hero || preset.centeredContent;

  const avatar = (className: string, rounded = "rounded-full") =>
    e.avatar_url ? (
      <img src={e.avatar_url} alt={name} className={`${className} ${rounded-[6px]} object-cover`} />
    ) : (
      <AvatarPlaceholder name={name} className={className} rounded-[6px]={rounded-[6px]} />
    );

  const cover = (className: string) =>
    hasCover ? (
      <div className={`${className} bg-cover bg-center`} style={{ backgroundImage: `url(${e.cover_url})` }} />
    ) : (
      <CoverPlaceholder className={className} />
    );

  if (preset.heroKind === "centered") {
    return (
      <div className="w-full" style={heroStyle}>
        <div className="mx-auto text-center px-4 py-10" style={{ maxWidth }}>
          <div className="mx-auto inline-block">
            {avatar("h-24 w-24 mx-auto border-2", "rounded-full")}
          </div>
          <h1 className="mt-4 font-display leading-tight" style={{ fontSize: settings.name_size_lg }}>
            {name}
          </h1>
          <p className="mt-1 text-muted-foreground" style={{ fontSize: settings.role_size_lg }}>
            {roleLine}
          </p>
          <SocialRow expert={e} className="mt-4 justify-center" />
        </div>
      </div>
    );
  }

  if (preset.heroKind === "cover-overlay") {
    return (
      <div style={heroStyle}>
        <div className="relative w-full h-56">
          {cover("absolute inset-0 w-full h-full")}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        </div>
        <div className="mx-auto px-4 py-6" style={{ maxWidth }}>
          <div className={`flex gap-4 items-end ${centered ? "justify-center text-center" : ""}`}>
            <div className="-mt-16">{avatar("h-24 w-24 border-4 border-background shadow", "rounded-[6px]")}</div>
            <div>
              <h1 className="font-display" style={{ fontSize: settings.name_size_lg }}>
                {name}
              </h1>
              <p className="mt-1 text-muted-foreground" style={{ fontSize: settings.role_size_lg }}>
                {roleLine}
              </p>
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
            className={`rounded-[6px] border border-border bg-card p-4 ${preset.sidebar === "right" ? "md:order-2" : ""}`}
            style={heroStyle}
          >
            {avatar("h-28 w-28", "rounded-[6px]")}
            <h1 className="mt-3 font-display" style={{ fontSize: settings.name_size_base }}>
              {name}
            </h1>
            <p className="text-xs opacity-80">{roleLine}</p>
            <SocialRow expert={e} className="mt-3" />
          </aside>
          <div className="text-sm text-muted-foreground whitespace-pre-line">{bioText}</div>
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
          <p className="mt-1 text-muted-foreground" style={{ fontSize: settings.role_size_lg }}>
            {roleLine}
          </p>
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
          {avatar("h-24 w-24", "rounded-[6px]")}
          <div className={centered ? "text-center mx-auto" : ""}>
            <h1 className="font-display" style={{ fontSize: settings.name_size_lg }}>
              {name}
            </h1>
            <p className="mt-1 text-muted-foreground" style={{ fontSize: settings.role_size_lg }}>
              {roleLine}
            </p>
            <SocialRow expert={e} className="mt-3" />
          </div>
        </div>
      </div>
    );
  }

  if (preset.heroKind === "editorial") {
    return (
      <div style={heroStyle}>
        <div className="relative w-full h-64">
          {cover("absolute inset-0 w-full h-full")}
          <div className="absolute inset-0 bg-black/50" />
          <div className="absolute inset-0 flex items-end">
            <div className="mx-auto w-full px-4 pb-6" style={{ maxWidth }}>
              <h1
                className="font-serif text-white"
                style={{ fontSize: settings.name_size_lg, fontFamily: "'Playfair Display', Georgia, serif" }}
              >
                {name}
              </h1>
              <p className="text-white/80 italic mt-1">{roleLine}</p>
            </div>
          </div>
        </div>
        <div className="mx-auto px-4 py-6" style={{ maxWidth }}>
          <blockquote
            className="border-l-4 pl-4 italic text-lg"
            style={{ borderColor: "var(--pv-accent)", fontFamily: "'Playfair Display', Georgia, serif" }}
          >
            {bioText}
          </blockquote>
        </div>
      </div>
    );
  }

  // classic (split)
  return (
    <div style={heroStyle}>
      <div className="mx-auto px-4 py-8" style={{ maxWidth }}>
        <div className={`flex flex-col md:flex-row gap-5 ${centered ? "md:items-center md:justify-center md:text-center" : "items-start"}`}>
          <div style={{ outline: e.avatar_url ? "2px solid var(--pv-accent)" : undefined }}>
            {avatar("h-32 w-32 md:h-40 md:w-32", "rounded-[6px]")}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-display leading-tight" style={{ fontSize: settings.name_size_lg }}>
              {name}
            </h1>
            <p className="mt-1 text-muted-foreground" style={{ fontSize: settings.role_size_lg }}>
              {roleLine}
            </p>
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
  showPlaceholders,
}: {
  k: ExpertSectionKey;
  hub: ExpertHubData;
  settings: ExpertLayoutSettings;
  lang: Lang;
  showPlaceholders: boolean;
}) {
  const preset = findExpertPreset(settings.default_preset);
  const wrap = (title: React.ReactNode, icon: React.ReactNode, children: React.ReactNode) => {
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
      style={{ backgroundColor: "color-mix(in oklab, var(--pv-accent) 15%, transparent)", color: "var(--pv-accent)" }}
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
              className="text-xs px-2 py-1 rounded-full border"
              style={{ borderColor: "var(--pv-accent)", color: "var(--pv-accent)" }}
            >
              {label}
            </span>
          ))}
          {isPlaceholder && placeholderTag}
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
      const hasAny =
        e.website_url || e.linkedin_url || e.twitter_url || e.contact_email;
      if (!hasAny && !showPlaceholders) return null;
      return wrap(
        <>
          Social
          {!hasAny && placeholderTag}
        </>,
        <Layers className="h-4 w-4" />,
        hasAny ? (
          <SocialRow expert={e} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {[Globe, Linkedin, Twitter, Mail].map((Icon, i) => (
              <span
                key={i}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-dashed"
                style={{ color: "var(--pv-accent)", borderColor: "var(--pv-accent)" }}
              >
                <Icon className="h-4 w-4" />
              </span>
            ))}
          </div>
        ),
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
              {e.contact_email ?? ph.email}
            </div>
            <div className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              {e.website_url ? e.website_url.replace(/^https?:\/\//, "") : ph.website}
            </div>
          </div>
          <div className="rounded-[6px] border border-border p-3 space-y-1">
            <div className="text-xs font-semibold">{t.mediaContact}</div>
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              {e.media_contact_email ?? ph.mediaEmail}
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              {e.media_contact_phone ?? ph.phone}
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
