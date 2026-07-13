// Podgląd na żywo publicznej strony eksperta w panelu admina.
// Iframe wskazuje na /author/{slug} (lub /en/author/{slug} dla EN); po
// każdym `onLoad` wstrzykujemy do dokumentu iframe klasę .dark oraz zapis
// `localStorage.theme`, żeby dark/light przełączały się bez pełnego reloadu
// z zewnątrz. Zmiana slug/lang/theme = twardy refresh iframe (przez `key`).
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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

export function ExpertLayoutPreview({ savedAt }: { savedAt?: number }) {
  const { data: sampleSlug } = useQuery({
    queryKey: ["admin", "expert-layout-preview", "sample-slug"] as const,
    queryFn: fetchSampleSlug,
    staleTime: 5 * 60_000,
  });

  const [slug, setSlug] = useState<string>("");
  useEffect(() => {
    if (!slug && sampleSlug) setSlug(sampleSlug);
  }, [sampleSlug, slug]);

  const [lang, setLang] = useState<Lang>("pl");
  const [theme, setTheme] = useState<Theme>("light");
  const [nonce, setNonce] = useState<number>(0);

  // Twardy refresh po zapisie ustawień - żeby preview pobrał świeże dane.
  useEffect(() => {
    if (savedAt) setNonce((n) => n + 1);
  }, [savedAt]);

  const src = useMemo(() => {
    if (!slug) return "";
    const prefix = lang === "en" ? "/en" : "";
    return `${prefix}/author/${encodeURIComponent(slug)}?__preview=${nonce}`;
  }, [slug, lang, nonce]);

  const applyTheme = (win: Window | null) => {
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
      /* cross-origin niemożliwe - iframe jest same-origin, więc ignorujemy */
    }
  };

  const onIframeLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    applyTheme(e.currentTarget.contentWindow);
  };

  // Reaguj na zmianę motywu bez reloadu iframe.
  useEffect(() => {
    const el = document.getElementById("expert-preview-iframe") as HTMLIFrameElement | null;
    applyTheme(el?.contentWindow ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-base">Podgląd na żywo</h2>
          <p className="text-[11px] text-muted-foreground">
            Publiczna strona eksperta - przełącz język i motyw, żeby zobaczyć jak wygląda.
            Zapisz zmiany, aby odświeżyć dane.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="inline-flex rounded border border-border overflow-hidden text-[11px]">
            <button
              type="button"
              onClick={() => setLang("pl")}
              className={`px-2 py-1 ${lang === "pl" ? "bg-brand text-brand-foreground" : "bg-background"}`}
              aria-pressed={lang === "pl"}
            >
              PL
            </button>
            <button
              type="button"
              onClick={() => setLang("en")}
              className={`px-2 py-1 border-l border-border ${lang === "en" ? "bg-brand text-brand-foreground" : "bg-background"}`}
              aria-pressed={lang === "en"}
            >
              EN
            </button>
          </div>
          <div className="inline-flex rounded border border-border overflow-hidden text-[11px]">
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={`px-2 py-1 ${theme === "light" ? "bg-brand text-brand-foreground" : "bg-background"}`}
              aria-pressed={theme === "light"}
            >
              Light
            </button>
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={`px-2 py-1 border-l border-border ${theme === "dark" ? "bg-brand text-brand-foreground" : "bg-background"}`}
              aria-pressed={theme === "dark"}
            >
              Dark
            </button>
          </div>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-[11px] hover:bg-muted"
            title="Odśwież podgląd"
          >
            <RefreshCw className="h-3 w-3" /> Odśwież
          </button>
          {src && (
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-[11px] hover:bg-muted"
              title="Otwórz w nowej karcie"
            >
              <ExternalLink className="h-3 w-3" /> Otwórz
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

      <div className="rounded-lg border border-border overflow-hidden bg-background shadow-sm">
        {!slug ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            Brak eksperta z ustawionym slug-iem. Dodaj slug w profilu, aby zobaczyć podgląd.
          </div>
        ) : (
          <iframe
            id="expert-preview-iframe"
            key={`${slug}-${lang}-${nonce}`}
            src={src}
            title="Podgląd strony eksperta"
            onLoad={onIframeLoad}
            className="w-full h-[900px] bg-background"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        )}
      </div>
    </section>
  );
}
