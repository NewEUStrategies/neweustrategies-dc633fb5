// Molekuła: SPIS SEKCJI strony głównej wydarzenia - sam rysunek wierszy, bez
// źródła pozycji i bez odnośnika.
//
// WZORZEC: docs/zrzuty/swapcard-2026-08-23/38-preview-event-home-desktop.png -
// pod banerem okładki stoi pięć wierszy: kolorowy krążek z ikoną, pogrubiona
// etykieta, szewron przy prawej krawędzi, cienkie kreski między wierszami
// i kreska zamykająca pod ostatnim.
//
// PO CO ODDZIELIĆ RYSUNEK OD POZYCJI - dokładnie ten sam powód, co przy
// `EventTabsBar` i `EventMenuTiles`, i ten sam defekt, który już raz kosztował
// właściciela zgłoszenie. `EventHomeSectionLinks` bierze pozycje z RPC
// `event_menu`, które ma w ciele `AND e.status = 'published'`, a każdy wiersz
// jest `<Link>`-iem wyprowadzającym ze studia. Podgląd w studiu nie może więc
// zamontować tamtego organizmu - a spis MUSI w podglądzie być, bo to on jest
// treścią strony głównej wzorca i jego brak był całą treścią zgłoszenia
// („niemal pusty ekran").
//
// PRZED TĄ ZMIANĄ PODGLĄD RYSOWAŁ TU KAFLE `EventMenuTiles` NIEZALEŻNIE OD
// TRYBU, a strona publiczna wybiera między kaflami i tym spisem po
// `events.pages_display_mode` (`grid` / `list`). Redaktor w trybie `list`
// - czyli domyślnym - widział więc w podglądzie obwiedzione kafle, a po
// publikacji wiersze z krążkami. Warunek jest teraz TEN SAM w obu miejscach.
//
// KONTRAST LICZY REGUŁA, NIE OKO REDAKTORA - i liczy go TYLKO TUTAJ. `color`
// przychodzi z panelu jako dowolny `#RRGGBB`, więc ikona w stałej bieli gaśnie
// na żółtym, a w stałej czerni na granacie. `pickTextColor` to czysta reguła
// luminancji (wagi sRGB WCAG) sprawdzona na siatce 125 kolorów
// w `src/lib/post/__tests__/postRules.test.ts` - przepisanie tej matematyki
// w podglądzie dałoby drugie źródło prawdy dla jednej reguły czytelności.
//
// `THEME_TEXT` JEST SENTYNELEM „NIE UMIEM TEGO OCENIĆ": tak degraduje brak
// koloru ORAZ wartość, której reguła nie parsuje (skrót „#fff", „rgb(...)",
// śmieć z bazy). Wtedy krążek bierze neutralne tło z motywu - bo tło w kolorze,
// którego nie potrafimy zmierzyć, to ikona w nieznanym kontraście.
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { pickTextColor, THEME_TEXT } from "@/lib/post/badgeContrast";

export function EventSectionLinks({
  label,
  children,
}: {
  /** Etykieta dostępności - napis, nie klucz: molekuła nie zna słownika. */
  label: string;
  /** Pozycje jako `<li>` - patrz nagłówek pliku. */
  children: ReactNode;
}) {
  return (
    // Własna etykieta punktu orientacyjnego, INNA niż „Podstrony wydarzenia"
    // z `EventMenuNav`: oba spisy mogą stać na jednej stronie, a dwa punkty
    // orientacyjne o tej samej nazwie nie dają się rozróżnić w czytniku ekranu.
    <nav aria-label={label} className="mt-6">
      {/* LINIE MIĘDZY WIERSZAMI I LINIA ZAMYKAJĄCA. Wzorzec rozdziela wiersze
          samym odstępem, a cienką kreskę stawia dopiero POD listą (nad pasem
          partnerów) - sprawdzone na pikselach zrzutu 38. Bierzemy kreski także
          między wiersze, bo w naszym systemie lista wierszy-odnośników ma
          rozdzielacz (`EventMaterialsSection`), a odstęp sam nie mówi, gdzie
          kończy się jeden klikalny wiersz, a zaczyna następny. */}
      <ul className="divide-y divide-border border-b border-border">{children}</ul>
    </nav>
  );
}

/** Klasa wiersza - `EventPageLink` na stronie publicznej, `<span>` w podglądzie. */
export const EVENT_SECTION_LINK_CLASS =
  "group flex items-center gap-4 rounded-[6px] px-2 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function EventSectionLinkBody({
  icon,
  color,
  label,
}: {
  /** Nazwa ikony z panelu; `null` albo pusty napis = krążek bez ikony. */
  icon: string | null;
  /** `#RRGGBB` z panelu; `null` albo pusty napis = krążek z motywu. */
  color: string | null;
  label: string;
}) {
  const ink = pickTextColor(color);
  const measurable = ink !== THEME_TEXT;

  return (
    <>
      {/* Kafelek stoi w KAŻDYM wierszu, także bez ikony: kolumna etykiet ma
          jedną krawędź, a spis, w którym co drugi napis zaczyna się gdzie
          indziej, czyta się jak zepsuty. Pozycja bez ikony zostaje samym
          kafelkiem (dla czytnika ekranu i tak jest ozdobą).

          KWADRAT Z ZAOKRĄGLENIEM 6 px, NIE KRĄŻEK - to jest promień, którym
          w tym systemie zaokrąglamy pola, pastylki i kafle (`rounded-[6px]`
          w `EVENT_SECTION_LINK_CLASS` linię niżej). Okrągła plamka obok
          kwadratowego wiersza była jedynym elementem z innym językiem
          kształtu. */}
      <span
        aria-hidden="true"
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px]",
          !measurable && "bg-muted text-foreground",
        )}
        style={measurable ? { backgroundColor: color ?? undefined, color: ink } : undefined}
      >
        {icon === null || icon === "" ? null : <DynamicIcon name={icon} size={18} />}
      </span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{label}</span>
      <ChevronRight
        aria-hidden="true"
        className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </>
  );
}
