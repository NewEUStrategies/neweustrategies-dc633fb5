// Molekuła: reklama strony głównej wydarzenia. Komputer - pionowy baner w prawej
// kolumnie; telefon - pełnoekranowa plansza z przyciskiem zamknięcia (raz na sesję).
// Przy kilku reklamach dla tej samej grupy wybór jest losowy. Liczenie wyświetleń
// i kliknięć idzie przez RPC z anonimowym identyfikatorem sesji (baza trzyma hash).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { brandedMediaUrl } from "@/lib/media/publicUrl";
import { trackHomeAd, usePublicHomeAds, type PublicHomeAdRow } from "@/lib/events/sponsorBoardApi";
import "@/lib/i18n-admin-event-sponsor-board";

const SESSION_KEY = "nes-ad-session";

function sessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return "anonymous-session";
  }
}

function AdImage({ ad, src, className }: { ad: PublicHomeAdRow; src: string; className: string }) {
  const img = (
    <img src={brandedMediaUrl(src)} alt={ad.alt_text} className={className} loading="lazy" />
  );
  if (ad.link_url === "") return img;
  return (
    <a
      href={ad.link_url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={() => void trackHomeAd(ad.id, "click", sessionId())}
    >
      {img}
    </a>
  );
}

export function EventHomeAd({ slug, variant }: { slug: string; variant: "desktop" | "mobile" }) {
  const { t } = useTranslation();
  const adsQ = usePublicHomeAds(slug);
  const [seed, setSeed] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => setSeed(Math.random()), []);

  const ad = useMemo(() => {
    const list = adsQ.data ?? [];
    if (list.length === 0 || seed === null) return null;
    return list[Math.floor(seed * list.length) % list.length] ?? null;
  }, [adsQ.data, seed]);

  const dismissKey = ad ? `nes-ad-closed-${ad.id}` : "";
  useEffect(() => {
    if (!ad) return;
    if (variant === "mobile") {
      try {
        if (window.sessionStorage.getItem(dismissKey) === "1") setClosed(true);
      } catch {
        /* prywatny tryb - plansza po prostu się pokaże */
      }
    }
    void trackHomeAd(ad.id, "view", sessionId());
  }, [ad, variant, dismissKey]);

  if (!ad) return null;

  if (variant === "desktop") {
    return (
      <aside aria-label={t("sponsorBoard.public.label")} className="hidden lg:block">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("sponsorBoard.public.label")}
        </p>
        <AdImage ad={ad} src={ad.image_url} className="w-full rounded-lg object-cover" />
      </aside>
    );
  }

  if (closed) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("sponsorBoard.public.label")}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 p-4 lg:hidden"
    >
      <button
        type="button"
        onClick={() => {
          setClosed(true);
          try {
            window.sessionStorage.setItem(dismissKey, "1");
          } catch {
            /* brak zapisu - zamknięcie działa w tej karcie */
          }
        }}
        aria-label={t("sponsorBoard.public.close")}
        className="absolute right-4 top-4 rounded-full bg-muted p-2 text-foreground"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("sponsorBoard.public.label")}
      </p>
      <AdImage
        ad={ad}
        src={ad.image_mobile_url || ad.image_url}
        className="max-h-[80vh] w-auto rounded-lg object-contain"
      />
    </div>
  );
}
