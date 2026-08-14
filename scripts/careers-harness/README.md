# Harness Postgresa - modul REKRUTACJA

## Po co to istnieje

Bramki `check:sql-*` czytaja migracje jako TEKST. Zlapia rozjazd inwariantow
(tenant-scope, literaly `app_role`, granty dla `anon`), ale nie zlapia niczego,
co ujawnia sie dopiero przy WYKONANIU. W tym module realnie wystapily cztery
takie bledy - kazdy przeszedl przez `tsc`, `eslint` i wszystkie bramki tekstowe,
a wywalil sie na pierwszym `psql`:

- `ROW_COUNT_OF()` - funkcja, ktorej w PL/pgSQL nie ma (poprawnie:
  `GET DIAGNOSTICS x = ROW_COUNT`),
- `RETURNS TABLE (path, reason, attempts)` w `career_cv_gc_claim` - nazwy
  parametrow OUT kolidowaly z kolumnami kolejki, czyli klasyczne 42702 przy
  WYWOLANIU, nie przy tworzeniu funkcji,
- polityka odczytu bucketu, ktora przepuszczala obcego najemce (`is_staff()`
  sprawdza role, nie tenanta) - tego nie widzi zaden test jednostkowy,
- trigger `career_application_touch` nadpisujacy `stage_changed_at` - fixture
  testowy, ktory ustawial etap i date jednym UPDATE-em, mierzyl fikcje.

Ten harness to ta sama konstrukcja i te same powody, co `scripts/pg-harness`
(patrz jego README) - tylko powierzchnia styku jest inna.

## Czym to NIE jest

To nie jest replika bazy produkcyjnej. Stawiamy PostgreSQL 16, aplikujemy
`scripts/pg-harness/harness.sql` (tenanty, role, `auth.uid()`, `is_staff()`,
`current_tenant_id()`, atrapy magazynu, `crm_leads`), potem
`careers-harness/harness.sql` - czyli WYLACZNIE to, czego brakuje temu modulowi:

| Obiekt | Dlaczego tutaj, a nie we wspolnym harnessie |
| ------ | ------------------------------------------- |
| `contact_messages` | tabela, na ktorej stoi caly modul; wspolny harness jej nie potrzebuje |
| `storage.buckets.file_size_limit` / `allowed_mime_types` | atrapa ma tylko `(id, name, public)`, a migracja ustawia limit i liste MIME - to jedyna serwerowa egzekucja publicznego uploadu |
| granty schematow `storage` i `auth` | w Supabase zaklada je rozszerzenie magazynu i GoTrue; bez nich test polityk pada na "permission denied", czyli na ATRAPIE |
| `tenants.is_default` | kolumna istnieje w prawdziwym schemacie (patrz `types.ts`), migracje careers wybieraja po niej najemce do backfillu |
| `public_tenant_id()` sterowany sesja | atrapa zwraca najstarszego najemce; bez mozliwosci przestawienia tej wartosci test "anonim z hosta B nie wgra pliku do katalogu A" nie istnieje |
| `current_tenant_id()` jako SECURITY DEFINER | tak brzmi OSTATNIA definicja w migracjach (20260626180412); atrapa ma SECURITY INVOKER, wiec pod RLS zwracala NULL, a polityka `tenant_id = NULL` nie przepuszcza NICZEGO - test tenant-scope "przechodzilby" przez odciecie wszystkiego |

Ostatni wiersz jest wazny: atrapa moze sprawic, ze test przechodzi z ZLEGO
powodu. Dlatego kazda pozycja wyzej jest przepisana z oryginalu, a nie wymyslona.

## Czego harness NIE sprawdza

- Nie sprawdza samego magazynu. `storage.objects` to tabela, wiec polityki RLS
  testujemy realnie, ale `storage.remove()` (jedyna droga usuniecia PLIKU) jest
  po stronie API Supabase - w harnessie nie istnieje. Job drenujacy kolejke ma
  wiec testy jednostkowe na parsowaniu (`cvRetention.test.ts`), a harness
  odpowiada za to, KTO trafia do kolejki i co sie dzieje po domknieciu partii.
- Nie sprawdza `pg_cron`. Krok retencji wolamy w tescie wprost.
- Nie sprawdza wydajnosci. Indeksy zakladamy, ale planow nie mierzymy.

## Uzycie

```bash
bash scripts/careers-harness/run.sh          # migracje modulu + testy runtime
bash scripts/careers-harness/run.sh --keep   # zostaw baze (psql -p 5434 -d nes)
```

Wymaga `postgresql-16` w obrazie. Port 5434 (wspolny harness uzywa 5433), wiec
oba moga stac rownolegle.

## Co jest testowane

Sekcje w `runtime_test.sql`, kazda z asercjami przerywajacymi skrypt:

1. bucket `career-cv` istnieje, jest prywatny, egzekwuje 5 MB i liste MIME
2. `career_roles.slug` unikalny w obrebie najemcy, nie globalnie
3. `career_page_sections` z tenantem w kluczu glownym
4. wiersz pipeline zaklada sie sam dla `form_id = 'careers'`, i tylko dla niego
5. zmiana etapu: znacznik czasu, wpis w dzienniku, autor; UPDATE bez zmiany
   etapu nie zasmieca dziennika; UPDATE nie przenosi procesu do innego najemcy
6. retencja: proces domkniety oddaje CV, otwarty trzyma je bez wzgledu na wiek
7. osierocone: decyduje wiek i referencja, tenant czytany ze sciezki
8. claim/done: kolejka drenuje sie raz, a domkniecie zdejmuje `cv_path` ze
   zgloszenia i zostawia `cv_purged_at`
9. usuniecie zgloszenia kolejkuje jego CV i kasuje pipeline kaskada
10. polityki bucketu: personel widzi WYLACZNIE swojego najemce (takze dla
    plikow legacy, gdzie prawo wynika z referencji)
11. upload: sciezka musi niesc tenanta przegladanego hosta
12. `career_settings`: domyslne 365 dni / 24 h, CHECK odrzuca zero
13. funkcje GC zamkniete dla roli klienckiej
14. dziennik etapow niezapisywalny z panelu
