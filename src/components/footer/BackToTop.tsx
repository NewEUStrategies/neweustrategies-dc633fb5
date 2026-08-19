import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronsUp } from "@/lib/lucide-shim";

interface Props {
  thresholdPx?: number;
}

/** Czy system prosi o ograniczenie ruchu. Brak `matchMedia` (SSR) = brak prośby. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function BackToTop({ thresholdPx = 400 }: Props) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > thresholdPx);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [thresholdPx]);

  // Płynne przewijanie jest ANIMACJĄ przez całą wysokość dokumentu - dokładnie
  // tym, co `prefers-reduced-motion` ma wyłączyć. Dla części czytelników
  // (migrena przedsionkowa, choroba lokomocyjna, padaczka światłoczuła) taki
  // przejazd jest objawowy, a nie „mniej ładny". Bez zgłoszonej preferencji
  // zachowanie zostaje bez zmian.
  const onClick = () => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("footer.back_to_top")}
      className={[
        "fixed bottom-6 right-6 z-40 h-11 w-11 rounded-[6px]",
        "bg-brand text-brand-foreground shadow-lg",
        "flex items-center justify-center",
        "transition-all duration-200",
        show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none",
        "hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
      ].join(" ")}
    >
      <ChevronsUp className="w-5 h-5" aria-hidden="true" />
    </button>
  );
}
