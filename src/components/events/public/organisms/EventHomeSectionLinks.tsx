// Organizm: LISTA SEKCJI na stronie głównej wydarzenia.
//
// WZORZEC: docs/zrzuty/swapcard-2026-08-23/38-preview-event-home-desktop.png -
// pod banerem okładki stoi spis wejść w podstrony: kolorowy krążek z ikoną,
// pogrubiona etykieta, szewron przy prawej krawędzi, cały wiersz jest
// odnośnikiem. Odwzorowujemy STRUKTURĘ i ROZMIESZCZENIE; kolory, krój
// i promienie zostają nasze.
//
// DLACZEGO OSOBNY ORGANIZM, A NIE TRZECI TRYB `EventMenuNav`. Tamten komponent
// jest NAWIGACJĄ CHROME'U strony i ma dwa układy, między którymi wybiera
// organizator (`events.pages_display_mode`: „list” albo „grid”). Ten spis jest
// TREŚCIĄ strony głównej - stoi na wzorcu w kolumnie środkowej, pod okładką
// i nad poziomami partnerów, niezależnie od tego, co organizator wybrał dla
// paska nawigacji. Dorobienie tu trzeciej wartości trybu znaczyłoby, że
// przełącznik w panelu przestaje rozstrzygać jedno pytanie.
//
// ŹRÓDŁO I ŚCIEŻKA DZIAŁAJĄ JAK W `EventMenuNav` - jeden hook, jedna reguła:
// `useEventMenu` oddaje pozycje JUŻ przefiltrowane po grupach zapisu wołającego
// (filtr w kliencie znaczyłby, że pełna lista podstron jedzie do każdego
// gościa), a `path` jest CAŁĄ ścieżką strony, więc odnośnik idzie do trasy
// splat `/$` - nie `href`, bo przejście ma zostać w routerze.
//
// KOMPONENT NIE ZAKŁADA ZALOGOWANEGO. `useEventMenu` woła RPC z GRANT-em dla
// `anon`, a hook trzyma gościa pod własną tożsamością w kluczu cache - tutaj
// nie ma i nie może być ani jednego odwołania do sesji.
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { pickTextColor, THEME_TEXT } from "@/lib/post/badgeContrast";
import { useEventMenu } from "@/lib/events/usePublicEvent";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
import type { EventMenuItem } from "@/lib/events/publicEventApi";

ensureEventFrontI18n();

export function EventHomeSectionLinks({
  slug,
  enabled = true,
}: {
  slug: string;
  enabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const menuQuery = useEventMenu(slug, enabled);
  const items = menuQuery.data ?? [];

  // PUSTO ZNACZY NIC W DOM-ie - bez nagłówka, bez ramki, bez szkieletu.
  // Ta sama furtka obsługuje wczytywanie i błąd, i tak ma być: większość
  // wydarzeń nie ma ani jednej podstrony, więc szkielet migałby po to, żeby
  // zniknąć, a ramka „Sekcje” bez wiersza w środku wygląda jak awaria.
  if (items.length === 0) return null;

  return (
    // Własna etykieta punktu orientacyjnego, INNA niż „Podstrony wydarzenia”
    // z `EventMenuNav`: oba spisy mogą stać na jednej stronie, a dwa punkty
    // orientacyjne o tej samej nazwie nie dają się rozróżnić w czytniku ekranu.
    <nav aria-label={t("eventFront.homeSections.label")} className="mt-6">
      {/* LINIE MIĘDZY WIERSZAMI I LINIA ZAMYKAJĄCA. Wzorzec rozdziela wiersze
          samym odstępem, a cienką kreskę stawia dopiero POD listą (nad pasem
          partnerów) - sprawdzone na pikselach zrzutu 38. Bierzemy kreski także
          między wiersze, bo w naszym systemie lista wierszy-odnośników ma
          rozdzielacz (`EventMaterialsSection`), a odstęp sam nie mówi, gdzie
          kończy się jeden klikalny wiersz, a zaczyna następny. */}
      <ul className="divide-y divide-border border-b border-border">
        {items.map((item) => (
          <li key={item.id}>
            <SectionLinkRow
              item={item}
              label={pickLocalized(
                { label_pl: item.labelPl, label_en: item.labelEn },
                "label",
                lang,
                item.path,
              )}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SectionLinkRow({ item, label }: { item: EventMenuItem; label: string }) {
  // KONTRAST LICZY REGUŁA, NIE OKO REDAKTORA. `color` przychodzi z panelu jako
  // dowolny `#RRGGBB`, więc ikona w stałej bieli gaśnie na żółtym, a w stałej
  // czerni na granacie. `pickTextColor` to czysta reguła luminancji (wagi sRGB
  // WCAG) sprawdzona na siatce 125 kolorów w
  // `src/lib/post/__tests__/postRules.test.ts` - przepisanie tej matematyki
  // tutaj dałoby drugie źródło prawdy dla jednej reguły czytelności.
  //
  // `THEME_TEXT` JEST SENTYNELEM „NIE UMIEM TEGO OCENIĆ”: tak degraduje brak
  // koloru ORAZ wartość, której reguła nie parsuje (skrót „#fff”, „rgb(...)”,
  // śmieć z bazy). Wtedy krążek bierze neutralne tło z motywu - bo tło
  // w kolorze, którego nie potrafimy zmierzyć, to ikona w nieznanym kontraście.
  const ink = pickTextColor(item.color);
  const measurable = ink !== THEME_TEXT;

  return (
    <Link
      to="/$"
      params={{ _splat: item.path }}
      className="group flex items-center gap-4 rounded-[6px] px-2 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Krążek stoi w KAŻDYM wierszu, także bez ikony: kolumna etykiet ma
          jedną krawędź, a spis, w którym co drugi napis zaczyna się gdzie
          indziej, czyta się jak zepsuty. Pozycja bez ikony zostaje samym
          krążkiem (dla czytnika ekranu i tak jest ozdobą). */}
      <span
        aria-hidden="true"
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          !measurable && "bg-muted text-foreground",
        )}
        style={measurable ? { backgroundColor: item.color ?? undefined, color: ink } : undefined}
      >
        {item.icon !== null && <DynamicIcon name={item.icon} size={18} />}
      </span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{label}</span>
      <ChevronRight
        aria-hidden="true"
        className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
