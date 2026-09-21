# Plan: interaktywne odpowiedzi, posty i wzmianki

## Cel
Uspójnić środkową część wątku z zachowaniem podobnym do LinkedIn: odpowiedzi mają być bardziej interaktywne, z rozwijaniem wątków podrzędnych, a treści postów i odpowiedzi mają obsługiwać osoby, firmy i hashtagi.

## Zakres zmian
- Dodać komponent `Discussion` oparty o istniejący styl projektu i dostępne rozwijanie odpowiedzi.
- Zastosować go w widoku wątku klubowego, tak aby odpowiedzi z dziećmi dało się zwijać i rozwijać bez utraty obecnych reakcji, zgłoszeń, edycji i oznaczania rozwiązania.
- Zastąpić prosty renderer treści postów klubowych rendererem z linkami, @wzmiankami, firmami i #hashtagami, tak jak w odpowiedziach.
- Rozszerzyć podpowiedzi @wzmianek: osoby oraz organizacje z bazy publicznej wyszukiwarki osób i organizacji.
- Dodać publiczną wizytówkę firmy w podglądzie wzmianki i prowadzić ją do istniejącego wyszukiwania po organizacji.
- Uzupełnić tłumaczenia PL/EN.
- Dodać testy dla parsera/linkowania oraz rozwijania odpowiedzi.

## Szczegóły techniczne
- Użyję istniejącego RPC `search_people_orgs`, które już zwraca osoby i organizacje w bezpiecznym, tenantowym zakresie.
- Nie zmieniam schematu bazy ani zasad dostępu.
- Hashtagi nadal będą działały jako filtry klubowe.
- Widoczne linki do osób pozostaną `/author/$slug`; firmy będą prowadzić do wyszukiwania organizacji.
- Rozwijanie odpowiedzi będzie lokalnym stanem UI, bez dodatkowych zapytań.

## Walidacja
- Testy jednostkowe dla wzmianek i komponentu dyskusji.
- Kontrola typów po zmianach.
