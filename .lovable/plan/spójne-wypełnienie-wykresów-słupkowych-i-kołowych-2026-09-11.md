# Spójne wypełnienie wykresów słupkowych i kołowych

## Zakres
- Ustawić jasne wnętrze i ciemniejszy obrys jako wspólny wygląd wykresów słupkowych, poziomych, histogramów, tornado oraz wykresów kołowych i pierścieniowych.
- Zachować kolory kategorii, czytelność w jasnym i ciemnym motywie, animacje, stany aktywne oraz interakcje.
- Dostosować etykiety segmentów do jasnego wnętrza, aby tekst pozostał czytelny.

## Szczegóły techniczne
- Wykorzystać istniejące tokeny `--chart-*-inner` i `--chart-*-edge`, bez kolorów wpisanych bezpośrednio w komponentach.
- Ujednolicić renderery słupków i segmentów, także dla układów wieloseryjnych i skumulowanych.
- Zaktualizować testy regresji stylu i uruchomić testy wykresów oraz kontrolę typów.
