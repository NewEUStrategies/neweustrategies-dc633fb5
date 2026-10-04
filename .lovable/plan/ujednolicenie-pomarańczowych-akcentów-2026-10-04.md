# Ujednolicenie pomarańczowych akcentów

## Zakres
- Zastąpić bursztynowe klasy interfejsu semantycznym kolorem marki opartym na `#FA9346`.
- Zmienić domyślne akcenty, warianty widgetów i formularzy, które nadal wskazują stare odcienie bursztynu.
- Zaktualizować zapisane ustawienia globalnego motywu, aby nie nadpisywały `#FA9346` jaśniejszym bursztynem.
- Zachować odrębne kolory funkcjonalne, które nie są akcentem marki, np. czerwony błąd, zielony sukces i wielobarwną paletę wykresów.

## Kontrola jakości
- Dodać test pilnujący `#FA9346` jako domyślnego akcentu marki.
- Uruchomić testy palety, globalnych kolorów i elementów wydarzeń.
- Sprawdzić ekran wydarzenia w jasnym i ciemnym motywie oraz aktualny stan kompilacji.

## Szczegóły techniczne
- Komponenty będą używać tokenów `brand`/`primary` zamiast klas `amber-*`.
- Stałe starego akcentu zostaną zastąpione tokenem lub `#FA9346` w danych konfiguracyjnych.
- Zapisany JSON motywu zostanie poprawiony bez zmiany struktury bazy.
