# Zrzuty ekranu wzorca (Swapcard Studio) i innych źródeł

## Po co w repozytorium, a nie w czacie

Wzorcem odwzorowania modułu wydarzeń jest Swapcard Studio, a odwzorowanie idzie
ekran po ekranie: etykieta, umiejscowienie przycisku, kolejność pól. Zrzut
przesłany w rozmowie żyje tyle, ile rozmowa - a pytanie „czy tam naprawdę było
`State`, czy `Region`" wraca po dwóch tygodniach, przy trzeciej iteracji tego
samego ekranu. Zrzut w repozytorium jest **dowodem przy dokumentacji**:
`docs/MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md` opisuje, co widać, a plik
obok pokazuje, że opis się nie rozjechał.

Druga, praktyczna przyczyna: przez repozytorium przechodzi dowolna liczba plików
naraz, a rozmowa ma limit załączników na wiadomość.

## Jak dokładać

1. Katalog na partię: `docs/zrzuty/<zrodlo>-<RRRR-MM-DD>/`, np.
   `swapcard-2026-08-26`. Data jest datą ZEBRANIA zrzutów, nie datą ekranu.
2. Nazwa pliku: `<nr>-<ekran>.png`, numer dwucyfrowy, ekran po angielsku,
   małymi literami, myślniki zamiast spacji - np. `01-registration-form.png`,
   `02-registration-tickets.png`. Numer daje KOLEJNOŚĆ czytania, więc rośnie
   tak, jak się klika w panelu, a nie alfabetycznie.
3. Wrzucić przez GitHub („Add file" -> „Upload files" w katalogu partii) albo
   zwykłym `git add`. Jedno i drugie przyjmuje wiele plików naraz.
4. W rozmowie wystarczy podać nazwę katalogu partii - pliki czytam z dysku.

## Czego tu nie wrzucamy

Zrzutów z danymi osobowymi uczestników (imiona, e-maile, telefony na listach
zapisów) ani z tokenami i adresami z paska przeglądarki zawierającymi klucze.
Repozytorium jest prywatne, ale zrzut listy uczestników jest zbiorem danych
osobowych i nie ma powodu, żeby leżał w historii gita. Jeśli ekran jest
potrzebny, a dane nie - zamazać przed wrzuceniem.
