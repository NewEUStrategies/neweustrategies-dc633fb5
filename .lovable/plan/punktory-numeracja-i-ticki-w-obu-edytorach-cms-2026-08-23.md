# Punktory, numeracja i ticki w obu edytorach CMS

## Zakres

Wdrożę przesłany system wizualny dla zwykłych list nieuporządkowanych, list numerowanych i ikon statusu w:
- builderze stron/widgetów (Elementor-style),
- edytorze blokowym wpisów (Gutenberg-style),
- podglądzie oraz publicznie opublikowanej treści.

Lista zadań / checkboxy pozostaną bez zmian, zgodnie z wymaganiem.

## Implementacja

1. **Wspólne tokeny i style list**
   - Dodam jeden semantyczny zestaw reguł korzystający z istniejącego `--brand` zamiast duplikowania koloru pomarańczowego.
   - Lista punktowana: marker 6 px, 50% krycia, krótki scale + pełny kolor przy hoverze całego wiersza.
   - Zagnieżdżenia: mniejszy marker i zmiana kształtu/krycia zależnie od poziomu.
   - Lista numerowana: statyczne numerowane plakietki 1.35 rem, promień 5 px, tło brand 10%, bez animacji.
   - Mobile otrzyma węższą kolumnę markera; dark mode zachowa ten sam rytm i właściwy kontrast.
   - `prefers-reduced-motion` wyłączy wszystkie nowe animacje.

2. **Edytor blokowy wpisów (Gutenberg-style)**
   - Zaktualizuję `ListBlockEdit`, aby marker, numeracja i zagnieżdżenia odpowiadały widokowi publicznemu, bez naruszania Enter / Shift+Enter / Tab.
   - Publiczny `renderList` otrzyma stabilne klasy i strukturę dla plakietek numerów oraz markerów kolejnych poziomów.
   - Zachowam importowane poziomy, mieszane listy Word/Google Docs oraz niestandardowy numer startowy.

3. **Builder widgetów (Elementor-style)**
   - Obejmę wspólnym stylem listy HTML renderowane przez widget tekstowy `RichHtmlView`, tak aby canvas, preview i publikacja wyglądały identycznie.
   - Selektory będą ograniczone do treści CMS, żeby nie zmienić list nawigacji, kart, panelu admina ani list funkcjonalnych.
   - Jawnie wykluczę checklisty, checkboxy i istniejące komponenty list zadań.

4. **Ticki i ikony statusu**
   - W treści CMS zamienię obsługiwane symbole `✅`, `❌` i `⚠️` na dekoracyjne, skalujące się z tekstem ikony SVG o właściwych kolorach i grubości linii.
   - Dodam animację pop dla ikon `success` i `info` w powiadomieniach Sonner; błędy, ostrzeżenia i loading pozostaną statyczne.
   - Ikony będą `aria-hidden`, a tekst zachowa pełne znaczenie bez grafiki.

5. **Testy i weryfikacja**
   - Dodam testy renderera list: unordered, ordered, start, zagnieżdżenia i mieszane poziomy.
   - Rozszerzę testy `ListBlockEdit` o strukturę markerów bez regresji miękkiego entera.
   - Dodam testy widgetu rich HTML dla list i konwersji ikon statusu oraz kontrakt CSS dla reduced motion.
   - Uruchomię selektywne testy Vitest i zweryfikuję wizualnie w przeglądarce canvas oraz publiczny rendering na desktopie i mobile.

## Poza zakresem

- Brak zmian w wyglądzie i zachowaniu list zadań / checkboxów.
- Brak zmian w listach aplikacyjnych, menu, nawigacji, ToC, przypisach i komponentach administracyjnych niebędących treścią CMS.
- Brak zmian modelu danych lub backendu.
