// Atom: znak instytucji - logo albo monogram, gdy pliku nie ma lub się nie
// wczyta. Wspólny dla kart (uczestnicy, prelegenci, partnerzy) i okna
// instytucji, więc ta sama firma ma na każdej zakładce ten sam znak.
//
// LOGO STOI NA BIELI TAKŻE W CIEMNYM MOTYWIE. Logotypy partnerów są rysowane
// pod jasne tło (granatowe litery, przezroczyste PNG) - na ciemnej płycie
// znikały. Biała podkładka z włosową ramką to konwencja ścian partnerów
// i czyta się jako celowa, a nie jako dziura w motywie.
//
// MONOGRAM ZAMIAST PUSTEGO MIEJSCA. Instytucja bez logo dostaje inicjały
// w tym samym obrysie, więc wiersz nie skacze, gdy plik nie dojedzie.
import { useState } from "react";

import { mediaRenderUrl } from "@/lib/media/publicUrl";
import { cn } from "@/lib/utils";

// Wyłącznie klasy już obecne w arkuszu (budżet CSS - komentarz bloku
// „ZAKŁADKI MODUŁOWE WYDARZENIA" w `src/styles.css`). Szarość monogramu idzie
// stylem: na białej podkładce w OBU motywach musi być ciemna, a token
// `--muted-foreground` w ciemnym motywie jest jasny.
const SIZE_CLASS = {
  xs: "size-5 rounded-[4px] p-0.5 text-[8px]",
  sm: "size-7 rounded-[5px] p-0.5 text-[10px]",
  md: "size-11 rounded-[6px] p-1 text-xs",
  lg: "h-20 w-20 rounded-[8px] p-2.5 text-lg",
} as const;

export type EventOrgLogoSize = keyof typeof SIZE_CLASS;

const MONOGRAM_INK = { color: "#71717a" } as const;

/** Dwie litery z nazwy: pierwsze litery dwóch pierwszych słów („Polski Instytut" -> „PI"). */
export function orgMonogram(name: string): string {
  const words = name
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
  const letters =
    words.length === 1 ? words[0].slice(0, 2) : `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`;
  return letters.toLocaleUpperCase("pl-PL") || "·";
}

export function EventOrgLogo({
  name,
  logoUrl,
  size = "sm",
  className,
}: {
  name: string;
  logoUrl: string | null | undefined;
  size?: EventOrgLogoSize;
  className?: string;
}) {
  const source = typeof logoUrl === "string" && logoUrl.trim() !== "" ? logoUrl.trim() : null;
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = source !== null && failed !== source;

  return (
    <span
      aria-hidden="true"
      className={cn(
        // Flex, nie siatka: procent wysokości obrazu w siatce liczy się od
        // ścieżki „auto" i logo wypadało ze środka pudła o znanej wysokości.
        "flex shrink-0 items-center justify-center overflow-hidden border border-border bg-white font-semibold tracking-wide",
        SIZE_CLASS[size],
        className,
      )}
      style={MONOGRAM_INK}
    >
      {showImage ? (
        <img
          src={mediaRenderUrl(source)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(source)}
          className="size-full object-contain"
        />
      ) : (
        <span>{orgMonogram(name)}</span>
      )}
    </span>
  );
}
