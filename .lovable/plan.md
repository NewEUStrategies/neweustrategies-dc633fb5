# Pełna synchronizacja geometrii trybu jasnego i ciemnego

## Zakres
- Ustanowić jedną wspólną wartość dla typografii, rozmiarów, odstępów, wyrównania, obramowań, cieni i geometrii interakcji widgetów.
- Pozostawić osobne ustawienia light/dark wyłącznie dla kolorów, teł, gradientów, obrazów wariantowych i kontrastu.
- Ujednolicić panel CMS Buildera: zmiana typografii lub geometrii w dowolnym trybie aktualizuje tę samą wartość widoczną w obu trybach.
- Zachować responsywne różnice desktop/tablet/mobile - synchronizacja dotyczy motywu, nie breakpointów.

## Dane istniejących stron
- Przeskanować `builder_data` wszystkich stron i innych dokumentów Buildera pod kątem zapisanych obiektów `{ light, dark }` w polach geometrycznych.
- Znormalizować istniejące rozbieżności do jednej wartości, preferując aktualną wartość light, a przy jej braku dark, bez zmiany treści, kolorów ani ustawień urządzeń.
- Nie zmieniać schematu bazy ani ustawień tenantów; aktualizacja obejmie wyłącznie dane dokumentów zawierające niespójne ustawienia.

## Zabezpieczenia
- Dodać wspólny resolver i zapis wartości geometrycznych, aby render publiczny, podgląd i edytor korzystały z tego samego źródła prawdy.
- Usunąć możliwość ponownego zapisania osobnej typografii lub geometrii dla light/dark, zachowując dotychczasową obsługę osobnych kolorów.
- Dodać testy dla typografii, odstępów, obramowań i hover oraz test migracji starszych danych.

## Weryfikacja
- Uruchomić testy Buildera i kontrolę typów.
- Porównać reprezentatywne widgety oraz pełne strony w light/dark na desktopie i telefonie; wartości geometryczne muszą być identyczne, a różnić mogą się wyłącznie role kolorystyczne.
- Sprawdzić brak poziomego przepełnienia i poprawny zapis po ponownym otwarciu edytora.

## Szczegóły techniczne
- `Themed<T>` pozostaje dla właściwości kolorystycznych.
- `WidgetTypography` i pozostałe pola geometryczne będą odczytywane i zapisywane jako wartości wspólne; starsze obiekty themed zostaną bezpiecznie spłaszczone.
- Breakpointy w `ResponsiveValue<T>` pozostają bez zmian, dzięki czemu mobile może różnić się od desktopu, lecz nie od drugiego motywu na tym samym urządzeniu.
