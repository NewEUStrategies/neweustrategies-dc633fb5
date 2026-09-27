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
//
// KAŻDY WARIANT MIERZY WŁASNY ELEMENT. Baner i plansza to dwa RÓŻNE elementy
// DOM, a obrót ekranu (albo zmiana szerokości okna) podmienia jeden na drugi.
// Hak wyświetlenia obserwuje element z chwili swojego efektu - gdy obu
// wariantom służył jeden hak w rodzicu, zależności (sponsor, miejsce,
// reklama) się nie zmieniały, efekt nie biegł ponownie i obserwator patrzył
// dalej na ODŁĄCZONY baner: plansza po obrocie nigdy nie liczyła się jako
// wyświetlenie. Dlatego każdy wariant jest osobnym komponentem z własnym
// `ref` i własnym hakiem - zmiana wariantu to odmontowanie jednego pomiaru
// i zamontowanie drugiego na elemencie, który naprawdę jest na ekranie.
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
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

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

/** Baner komputera: pionowy, w prawej kolumnie. */
function DesktopHomeAd({
  ad,
  target,
  label,
}: {
  ad: PublicHomeAdRow;
  target: SponsorTarget;
  label: string;
}) {
  const measured = useRef<HTMLElement | null>(null);
  useSponsorImpression(measured, target);
  return (
    <aside ref={measured} aria-label={label} className="hidden lg:block">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
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

/** Plansza telefonu: pełny ekran z przyciskiem zamknięcia. */
function MobileHomeAd({
  ad,
  target,
  label,
  closeLabel,
  onClose,
}: {
  ad: PublicHomeAdRow;
  target: SponsorTarget;
  label: string;
  closeLabel: string;
  onClose: () => void;
}) {
  const measured = useRef<HTMLDivElement | null>(null);
  useSponsorImpression(measured, target);
  return (
    <div
      ref={measured}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 p-4 lg:hidden"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute right-4 top-4 rounded-full bg-muted p-2 text-foreground"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
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

export function EventHomeAd({ slug }: { slug: string }) {
  // Napisy reklamy są w słowniku frontu (`eventFront.homeAd.*`), który przegląd
  // wydarzenia ładuje i tak - nie w słowniku panelu sponsorów.
  ensureEventFrontI18n();
  const { t } = useTranslation();
  const adsQ = usePublicHomeAds(slug);
  const variant = useHomeAdVariant();
  const [seed, setSeed] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => setSeed(Math.random()), []);

  const ad = useMemo(() => {
    const list = adsQ.data ?? [];
    if (list.length === 0 || seed === null) return null;
    // `Math.random()` < 1, więc indeks mieści się w liście; `Math.min` domyka
    // granicę bez gałęzi, której żaden los nie osiągnie.
    return list[Math.min(list.length - 1, Math.floor(seed * list.length))];
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

  if (ad === null || variant === null) return null;

  // Haki pomiaru porównują POLA celu (nie tożsamość obiektu), więc nowy
  // obiekt w każdym renderze nie restartuje obserwatora.
  const target: SponsorTarget = { sponsorId: null, placement: "home_ad", homeAdId: ad.id };
  const label = t("eventFront.homeAd.label");
  if (variant === "desktop") return <DesktopHomeAd ad={ad} target={target} label={label} />;

  // Zamknięta plansza nie istnieje w DOM-ie, więc nie ma czego mierzyć.
  if (closed) return null;
  return (
    <MobileHomeAd
      ad={ad}
      target={target}
      label={label}
      closeLabel={t("eventFront.homeAd.close")}
      onClose={() => {
        setClosed(true);
        try {
          window.sessionStorage.setItem(dismissKey, "1");
        } catch {
          /* brak zapisu - zamknięcie działa w tej karcie */
        }
      }}
    />
  );
}
