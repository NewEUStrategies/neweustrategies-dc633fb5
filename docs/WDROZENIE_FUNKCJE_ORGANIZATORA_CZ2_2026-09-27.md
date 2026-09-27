# Wdrożenie: funkcje organizatora wydarzeń, część 2 - migracje wdrażalne przez Lovable i domknięcie przeglądu

**Data:** 2026-09-27
**Poprzednik:** PR #410 (scalony 2026-09-27, `8a671a933`). To NOWA zmiana, nie kontynuacja #410.
**Notatka części 1:** `docs/WDROZENIE_FUNKCJE_ORGANIZATORA_2026-09-27.md` (tło, zmiany na `main`,
audyt nakładania się, status przeglądu do chwili scalenia #410).

## 1. Stan po scaleniu #410

- Na `main` jest narzędzie do cięcia migracji (`scripts/split-migration.ts`,
  `src/lib/ci/migrationSplit*.ts`) i bramka rozmiaru (`migrationSize.gate`), która jest
  **czerwona celowo**: wskazuje dziesięć niewdrożonych migracji ponad limit Lovable
  (osiem funkcji organizatora oraz `20260926153100` z #406 i `20260926180000` z #407).
- Dopóki te pliki nie są pocięte, Lovable ich nie wdroży, a panele naboru prelegentów, faktur,
  planu sali, raportu sponsora, lejka Ads i skanera nie mają tabel w bazie.

## 2. Zakres tego PR (lista kontrolna)

- [ ] Domknięcie narzędzia do cięcia po dwóch recenzjach (lekser: `\r` w komentarzu, dowód na
      cięciu wewnątrz treści `$$`, `E'...\'...'` i zagnieżdżone `/* */`; odmowa cięcia migracji
      już wdrożonej; kroki po cięciu w CLI).
- [ ] **Pocięcie dziesięciu migracji na części do 45 KB** na granicach instrukcji SQL, bliźniaki
      drizzle, dziennik, migawki, rejestr pasów; dowód równoważności `pg_dump --schema-only`
      przed i po; bramka rozmiaru zielona.
- [ ] Skaner offline i Wallet, część 2: przepełnienie kolejki, wygasanie poświadczenia,
      czyszczenie listy przy zmianie poświadczenia, odświeżanie parowania, zakres urządzenia,
      limit per token, `callerSupabase`, `downloadBlob`.
- [ ] Lejek Google Ads: uwagi przeglądu i dostosowania do #403-#407.
- [ ] Plan sali: uwagi przeglądu (kolejność blokad, geometria, eksport CSV, metryki).
- [ ] Kopiowanie edycji: ustawienia uczestnika z #406, `_event_safe_timezone`.
- [ ] Most CRM: stan per intencja (check-in nie nadpisuje błędu naboru), deduplikacja osi czasu.
- [ ] Odświeżanie publicznej listy prelegentów po potwierdzeniu udziału i po zmianach mówców
      w agendzie; komentarz a działanie `useViewerCard`.
- [ ] Zielone CI i pełny `events-harness`.

## 3. Wdrożenie produkcji (po scaleniu)

Lista części i kolejność zastosowania z panelu Lovable zostanie wpisana tutaj po pocięciu
migracji. Starych plików nie uruchamiaj ręcznie w edytorze SQL.
