# Materiały przekazania S8 i S7 (2026-10-20)

Praca nad S8 i S7 została przerwana na limicie tokenów, zanim weszła do PR
jako kod. Żeby nic nie przepadło, jest tu jako łatki i materiały robocze -
**nie jest to kod aplikacji**:

- `s8/0001-S8.1-fundament-lista-galeria.patch` - zacommitowane i sprawdzone
  podzadanie S8.1 (warstwa `src/lib/admin/journeys/*`, lista ścieżek
  z galerią, ustawienia i zdrowie silnika), bez integracji plików
  współdzielonych;
- `s7/0001-S7.1-diagnostyka-WIP-niedokonczone.patch` - NIEDOKOŃCZONE
  podzadanie S7.1 (diagnostyka), przerwane w trakcie, bez bramek;
- `s8/STAN_S8.md`, `s7/STAN_S7.md` - podział na podzadania, zakres,
  kryteria, raport S8.1 z `integration_requests`;
- `s8/S8.md`, `s7/S7.md` - pakiety kontekstu (wyciąg ze SPEC, kontrakty,
  zgłoszenia, wiedza Insidera).

Instrukcja dokończenia: `docs/PROMPT_KONTYNUACJI_HUB_2026-10-20.md`
(kroki 1 i 2). Po zintegrowaniu wycinka jego katalog usuwa się z PR.
