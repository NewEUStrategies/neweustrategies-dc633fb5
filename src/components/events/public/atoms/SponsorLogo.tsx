// Atom: logotyp partnera w rozmiarze wynikającym z jego POZIOMU.
//
// NAZWA JEST TREŚCIĄ, LOGOTYP JEST OZDOBĄ. Gdy migawka nie ma adresu logotypu
// (albo obrazek się nie wczyta), pokazujemy nazwę firmy - pusty kwadrat nie
// mówi nikomu, kto sponsoruje kongres. Z tego samego powodu `alt` jest pusty:
// nazwa stoi obok w tekście, więc czytnik ekranu nie powtarza jej dwa razy.
import { useState } from "react";
import { cn } from "@/lib/utils";
import { sponsorLogoClass, type SponsorLogoSize } from "@/lib/events/sponsorsSurface";

export function SponsorLogo({
  name,
  logoUrl,
  size,
  className,
}: {
  name: string;
  logoUrl: string | null;
  size: SponsorLogoSize;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const heightClass = sponsorLogoClass(size);

  if (logoUrl === null || failed) {
    return (
      <span
        className={cn(
          "flex items-center justify-center px-2 text-center text-sm font-semibold text-foreground",
          heightClass,
          className,
        )}
      >
        {name}
      </span>
    );
  }

  return (
    <img
      src={logoUrl}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("w-auto max-w-full object-contain", heightClass, className)}
    />
  );
}
