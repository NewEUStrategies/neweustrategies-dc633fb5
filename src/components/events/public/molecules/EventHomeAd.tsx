// Molekuła: reklama strony głównej wydarzenia. Komputer - pionowy baner w prawej
// kolumnie; telefon - pełnoekranowa plansza z przyciskiem zamknięcia (raz na sesję).
// Przy kilku reklamach dla tej samej grupy wybór jest losowy.
//
// JEDEN WARIANT NA RAZ. Strona montowała DWA egzemplarze (desktop + mobile,
// jeden schowany CSS-em), a każdy losował własną reklamę i liczył własne
// „wyświetlenie" - także ten niewidoczny. Teraz egzemplarz jest jeden, a
// wariant wybiera zapytanie o szerokość ekranu PO hydratacji
// (`useSyncExternalStore` z migawką serwera `null`): serwer i pierwszy render
// klienta rysują to samo (nic), a losowanie też dzieje się w efekcie.
//
// POMIAR DO RAPORTU SPONSORA, NIE WŁASNY LICZNIK. Wyświetlenie (>= 50% przez
// sekundę przy widocznej karcie) i kliknięcie liczą haki z
// `sponsorTrackingReact` pod miejscem `home_ad` - tylko pod dostawcą
// publicznej powłoki i WYŁĄCZNIE po zgodzie marketingowej. Sponsora reklamy
// baza bierze z wiersza reklamy (`event_home_ads.sponsor_id`), nie od klienta.
// Identyfikator sesji pomiaru powstaje dopiero po zgodzie; flaga zamknięcia
// planszy w sessionStorage to preferencja interfejsu, nie pomiar.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { brandedMediaUrl } from "@/lib/media/publicUrl";
import { usePublicHomeAds, type PublicHomeAdRow } from "@/lib/events/sponsorBoardApi";
import {
  useSponsorClickHandlers,
  useSponsorImpression,
  type SponsorTarget,
} from "@/lib/events/sponsorTrackingReact";
import "@/lib/i18n-admin-event-sponsor-board";

/** Próg układu dwukolumnowego (Tailwind `lg`). */
export const HOME_AD_DESKTOP_QUERY = "(min-width: 1024px)";

export type HomeAdVariant = "desktop" | "mobile";

function subscribeViewport(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(HOME_AD_DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function viewportVariant(): HomeAdVariant {
  if (typeof window.matchMedia !== "function") return "desktop";
  return window.matchMedia(HOME_AD_DESKTOP_QUERY).matches ? "desktop" : "mobile";
}

/** Wariant reklamy po hydratacji; `null` na serwerze i w pierwszym renderze. */
function useHomeAdVariant(): HomeAdVariant | null {
  return useSyncExternalStore(subscribeViewport, viewportVariant, () => null);
}

function AdImage({
  ad,
  src,
  className,
  target,
}: {
  ad: PublicHomeAdRow;
  src: string;
  className: string;
  target: SponsorTarget;
}) {
  const clickHandlers = useSponsorClickHandlers(target);
  const img = (
    <img src={brandedMediaUrl(src)} alt={ad.alt_text} className={className} loading="lazy" />
  );
  if (!ad.link_url) return img;
  return (
    <a href={ad.link_url} target="_blank" rel="sponsored noopener noreferrer" {...clickHandlers}>
      {img}
    </a>
  );
}

export function EventHomeAd({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const adsQ = usePublicHomeAds(slug);
  const variant = useHomeAdVariant();
  const [seed, setSeed] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);
  const measured = useRef<HTMLElement | null>(null);
  useEffect(() => setSeed(Math.random()), []);

  const ad = useMemo(() => {
    const list = adsQ.data ?? [];
    if (list.length === 0 || seed === null) return null;
    return list[Math.floor(seed * list.length) % list.length] ?? null;
  }, [adsQ.data, seed]);

  const dismissKey = ad ? `nes-ad-closed-${ad.id}` : "";
  useEffect(() => {
    if (!ad || variant !== "mobile") return;
    try {
      if (window.sessionStorage.getItem(dismissKey) === "1") setClosed(true);
    } catch {
      /* prywatny tryb - plansza po prostu się pokaże */
    }
  }, [ad, variant, dismissKey]);

  const shown = ad !== null && variant !== null && !(variant === "mobile" && closed);
  const target: SponsorTarget | null =
    ad === null ? null : { sponsorId: null, placement: "home_ad", homeAdId: ad.id };
  useSponsorImpression(measured, shown ? target : null);

  if (ad === null || target === null || variant === null) return null;

  const setMeasured = (node: HTMLElement | null) => {
    measured.current = node;
  };

  if (variant === "desktop") {
    return (
      <aside
        ref={setMeasured}
        aria-label={t("sponsorBoard.public.label")}
        className="hidden lg:block"
      >
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("sponsorBoard.public.label")}
        </p>
        <AdImage
          ad={ad}
          src={ad.image_url}
          className="w-full rounded-lg object-cover"
          target={target}
        />
      </aside>
    );
  }

  if (closed) return null;
  return (
    <div
      ref={setMeasured}
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
        target={target}
      />
    </div>
  );
}
