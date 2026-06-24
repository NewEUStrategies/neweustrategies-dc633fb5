import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp } from "@/lib/lucide-shim";

interface Props {
  thresholdPx?: number;
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

  const onClick = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("footer.back_to_top", { defaultValue: "Wróć na górę" })}
      className={[
        "fixed bottom-6 right-6 z-40 h-11 w-11 rounded-full",
        "bg-brand text-brand-foreground shadow-lg",
        "flex items-center justify-center",
        "transition-all duration-200",
        show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none",
        "hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
      ].join(" ")}
    >
      <ArrowUp className="w-5 h-5" aria-hidden="true" />
    </button>
  );
}
