# Microsites jako produkt (C4)

Data: 2026-07-20 · Status: zdolność domknięta; dorobek (konkretne microsites) to praca redakcyjna.

Ocena konkurencyjna (2026-07-20) wskazała: NES ma jedyny w stawce builder self-service (9,5),
ale ustępuje CSIS/mediom dorobkiem interaktywnym. Ten dokument opisuje, jak składać trwałe
microsites (typu CSIS ChinaPower) z istniejących klocków - po zmianach z tej gałęzi bez żadnego
kodu per microsite.

## Mechanika (co robi platforma)

1. **Poddrzewo stron = subścieżka.** Strona-korzeń (np. `/-bezpieczenstwo-baltyku`) + podstrony
   w drzewie (`/-bezpieczenstwo-baltyku/energetyka`, `/analizy`, `/dane`); ścieżki i breadcrumby
   wynikają z hierarchii `pages.parent_id` (page_full_path).
2. **Własny nagłówek na całym poddrzewie.** `pages.header_override` DZIEDZICZY w dół drzewa
   (zmiana w `src/lib/queries/public.ts`): ustaw raz na stronie-korzeniu (np. `hidden` albo
   wariant nagłówka), a wszystkie podstrony microsite'u przejmują to ustawienie; podstrona może
   nadpisać własnym. Wcześniej trzeba było ustawiać per strona.
3. **Własna nawigacja.** Na stronie-korzeniu i podstronach użyj widgetów buildera `menu` /
   `nav-link` / `mega-menu` jako **globalnego widgetu** (builder: „zapisz jako globalny") -
   jedna edycja nawigacji microsite'u propaguje się na wszystkie jego strony.
4. **Własna paleta.** Globalne kolory buildera + motywy per sekcja (light/dark override per
   widget/sekcja) pozwalają nadać poddrzewu odrębny akcent bez dotykania motywu globalnego.
5. **Szablon.** `template_type = landing` (strona bez chrome'u treściowego; builder rysuje
   hero, sekcje, stopkę microsite'u). Digital features (sankey, macierz ryzyka, mapa korytarzy,
   oś czasu, wykresy, mapy danych) są widgetami - patrz `docs/DIGITAL_FEATURES.md`.

## Przepis krok po kroku (redakcja)

1. Utwórz stronę-korzeń: szablon **Landing**, `header_override` wg potrzeby
   (np. `hidden` + własna nawigacja w hero), paleta sekcji na kolor microsite'u.
2. Zbuduj nawigację microsite'u jako **widget globalny** i wstaw na korzeniu.
3. Dodaj podstrony jako dzieci korzenia (drzewo w `/admin/pages`); wstaw ten sam globalny
   widget nawigacji (jedna edycja = aktualizacja wszędzie). Nagłówek dziedziczy się sam.
4. Wpisy tematyczne przypinaj do poddrzewa (`parent_page_id` = strona microsite'u,
   np. `/analizy`) - kanoniczne URL-e wpisów żyją w subścieżce microsite'u.
   (Uwaga: wpisy renderują się w globalnym chrome - dziedziczenie nagłówka dotyczy stron;
   to świadome ograniczenie pierwszej iteracji.)
5. Publikację premiery zaplanuj `publish_at` (strony mają harmonogram od tej gałęzi).

## Ograniczenia pierwszej iteracji

- Dziedziczenie `header_override` obejmuje strony (builder); wpisy pod poddrzewem
  zachowują globalny nagłówek serwisu.
- Odrębna stopka microsite'u = sekcja stopki w szablonie strony (builder), nie osobny
  mechanizm.
