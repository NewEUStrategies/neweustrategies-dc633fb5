// Podgląd na żywo layoutu strony eksperta w panelu admina.
// Renderujemy schematyczny mockup RZECZYWISTYCH danych pierwszego eksperta
// (profiles.slug != null) z uwzględnieniem AKTUALNYCH ustawień z formularza
// (`local`), zanim jeszcze zostaną zapisane. Używamy tego samego renderera,
// co publiczna strona /author/$slug (ExpertLayoutRenderer) - dzięki temu
// preview = produkcja 1:1.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import "@/lib/i18n-admin-layouts";
import { supabase } from "@/integrations/supabase/client";
import { expertHubQueryOptions } from "@/lib/experts/queries";
import { findExpertPreset, type ExpertLayoutSettings } from "@/lib/expertLayouts";
import {
  ExpertLayoutHero,
  ExpertSectionsList,
  expertLayoutCssVars,
  type Lang,
} from "@/components/experts/ExpertLayoutRenderer";

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

export function ExpertLayoutPreview({
  settings,
  savedAt = 0,
}: {
  settings: ExpertLayoutSettings;
  savedAt?: number;
}) {
  const { t } = useTranslation();
  const [lang, setLang] = useState<Lang>("pl");
  const [theme, setTheme] = useState<Theme>("light");
  const [showPlaceholders, setShowPlaceholders] = useState<boolean>(true);
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

  // Preview zawsze konsumuje warianty light/dark z `settings`, więc żeby
  // zobaczyć wersję dark w draftcie, nadpisujemy tymczasowo settings.
  const settingsForTheme = useMemo<ExpertLayoutSettings>(() => {
    if (theme === "light") return settings;
    return {
      ...settings,
      hero_bg_color: settings.hero_bg_color_dark ?? settings.hero_bg_color,
      hero_text_color: settings.hero_text_color_dark ?? settings.hero_text_color,
      accent_color: settings.accent_color_dark ?? settings.accent_color,
      bio_bullet_color: settings.bio_bullet_color_dark ?? settings.bio_bullet_color,
    };
  }, [settings, theme]);

  const previewStyle = useMemo(() => expertLayoutCssVars(settings, theme), [settings, theme]);

  const noSample =
    lang === "en"
      ? "No expert with a slug set. Add a slug to a profile to see the preview."
      : "Brak eksperta z ustawionym slug-iem. Dodaj slug w profilu, aby zobaczyć podgląd.";

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-base">{t("adminLayouts.expertPreview.title")}</h2>
          <p className="text-[11px] text-muted-foreground">
            {mode === "draft"
              ? t("adminLayouts.expertPreview.draftDesc")
              : t("adminLayouts.expertPreview.publishedDesc")}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <ToggleGroup
            options={[
              { v: "draft", label: t("adminLayouts.expertPreview.modeDraft") },
              { v: "published", label: t("adminLayouts.expertPreview.modePublished") },
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
              title={t("adminLayouts.expertPreview.refreshTitle")}
            >
              {t("adminLayouts.expertPreview.refresh")}
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
        <span>{t("adminLayouts.expertPreview.slugLabel")}</span>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value.trim())}
          placeholder={sampleSlug ?? t("adminLayouts.expertPreview.slugPlaceholder")}
          className="mt-1 w-full max-w-xs px-2 py-1.5 rounded-[6px] border border-input bg-background text-xs font-mono text-foreground"
        />
      </label>

      <div
        className={`rounded-[6px] border border-border overflow-hidden shadow-sm ${
          theme === "dark" && mode === "draft" ? "dark" : ""
        }`}
        style={previewStyle}
      >
        {mode === "published" ? (
          !effectiveSlug ? (
            <div className="p-8 text-center text-xs text-muted-foreground bg-background">
              {noSample}
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              key={`${effectiveSlug}-${lang}-${iframeNonce}`}
              src={iframeSrc}
              title={t("adminLayouts.expertPreview.iframeTitle")}
              onLoad={applyThemeToIframe}
              className="w-full h-[1000px] bg-background"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            />
          )
        ) : (
          <div className="bg-background text-foreground">
            {!effectiveSlug ? (
              <div className="p-8 text-center text-xs text-muted-foreground">{noSample}</div>
            ) : isLoading || !hub ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                {lang === "en" ? "Loading preview..." : "Ładowanie podglądu..."}
              </div>
            ) : (
              <>
                <ExpertLayoutHero
                  hub={hub}
                  settings={settingsForTheme}
                  lang={lang}
                  showPlaceholders={showPlaceholders}
                />
                <ExpertSectionsList
                  hub={hub}
                  settings={settingsForTheme}
                  lang={lang}
                  showPlaceholders={showPlaceholders}
                />
              </>
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
