# Sponsorzy i reklama - widok jak w Swapcard Studio

Cel: sekcja „Sponsorzy i reklama" w studiu wydarzenia działa jak na zrzutach: sekcje sponsorów z logotypami, edycja w bocznym panelu, dodawanie sekcji (Baner / Siatka logo), przekierowania oraz tabela reklam na stronie głównej wydarzenia ze statystykami. Działające dziś zakładki „Firmy" i „Poziomy" (firmy z CRM) zostają i zasilają nowy widok.

## Co zobaczy redaktor

```text
Sponsorzy i reklama
+-----------------------------+---------------------------------------+
| Sponsorzy                   | [Premium Partner]         (edytuj)(=) |
| opis                        |  logo  logo                           |
| [Utwórz sekcję sponsorów]   | [Silver Partner]          (edytuj)(=) |
|                             |  logo  logo  logo                     |
+-----------------------------+---------------------------------------+
| Reklama na stronie głównej  | Obraz | Grupy docelowe | Wyśw. | Klik. |
| opis (desktop: pion, mobile:| ...                                  |
| pełny ekran)  [Dodaj reklamę]                                      |
+-----------------------------+---------------------------------------+
```

1. **Lista sekcji** - każda sekcja (poziom) to karta z tytułem i logotypami; ikona ołówka (z podpisem „Edytuj" po najechaniu) i uchwyt do przeciągania kolejności.
2. **„Utwórz sekcję sponsorów"** - okno wyboru: **Baner** (jeden obraz na całą szerokość) albo **Siatka logo** (wiele logotypów). Drugi krok: tytuł sekcji, obraz(y) z biblioteki mediów, przekierowanie; „Dodaj kolejne logo" w siatce.
3. **Boczny panel edycji sekcji** - tytuł, lista logotypów (edytuj / usuń / przeciągnij), „Dodaj sponsora", „Usuń sekcję".
4. **Edycja logotypu** - podgląd obrazu + „Przekierowanie": Szczegóły wystawcy (wyszukiwarka firm wydarzenia) / Zewnętrzny URL / Bez linku.
5. **Reklama na stronie głównej wydarzenia** - tabela: obraz, grupy docelowe (z „Grup i uprawnień"), wyświetlenia, kliknięcia; dodawanie/edycja/usuwanie, okno emisji od-do, aktywna/wstrzymana. Kilka reklam dla tej samej grupy wyświetla się losowo.
6. **Strona publiczna** - zakładka Partnerzy i sekcja na przeglądzie rysują baner/siatkę w tej samej kolejności; reklama pokazuje się jako pionowy baner po prawej (desktop) i pełnoekranowa plansza z „Zamknij" (mobile), z oznaczeniem „Reklama".

Całość PL/EN, jasny i ciemny motyw, zgodnie z obecnym layoutem studia.

## Szczegóły techniczne

- Migracja (z GRANT + RLS, tenant_id, polityki staff przez `has_role`):
  - `event_sponsor_tiers`: `+ layout text check in ('banner','grid') default 'grid'`.
  - `event_sponsors`: `+ image_url text`, `+ link_mode text check in ('exhibitor','external','none') default 'none'`, `+ link_url text` (walidacja https), `company_id` staje się opcjonalne (logo bez firmy CRM); constraint: baner = max 1 wpis.
  - nowa `event_home_ads` (id, tenant_id, event_id, image_url, image_mobile_url, link_url, group_ids uuid[], starts_at, ends_at, is_active, sort_order) oraz `event_home_ad_events` (ad_id, kind view/click, session hash, created_at) + RPC `event_home_ad_track` (SECURITY DEFINER, dedup per sesja/dzień, limit) i `admin_event_home_ads_list` ze zliczeniami.
  - RPC `admin_event_sponsor_tiers_reorder` / `admin_event_sponsors_reorder`.
- Front (atomic): `molecules/SponsorSectionCard`, `SponsorLogoRow`, `SponsorRedirectField`; `organisms/SponsorSectionsBoard`, `SponsorSectionDrawer` (Sheet), `AddSponsorSectionDialog` (2 kroki), `EventHomeAdsPanel`, `EventHomeAdDialog`; kolejność przez istniejący mechanizm drag w projekcie.
- Publiczne: `EventSponsorTiers` obsługuje `layout`; nowy `EventHomeAdSlot` (losowanie wg grup użytkownika, śledzenie przez RPC, zgodny z RODO consent jak system reklam).
- i18n: klucze w `i18n-admin-event-sponsors` i publicznym słowniku, parytet PL/EN.
- Testy: dialogi (walidacja tytułu, obrazu, URL), drawer (usuń/kolejność), panel reklam (statystyki, grupy), publiczny slot (losowanie, oznaczenie „Reklama", mobile zamknij), bramki i18n-parity, rpc-contract, migration-ledger.
