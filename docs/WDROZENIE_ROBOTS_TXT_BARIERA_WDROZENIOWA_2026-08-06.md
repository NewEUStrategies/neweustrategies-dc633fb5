# Wdrożenie: druga bariera precedencji assetów + podgląd robots.txt w panelu (2026-08-06)

Domknięcie dwóch luk, które zostały po `WDROZENIE_ROBOTS_TXT_ROUTING_2026-08-06.md`
(finding nr 2 z `OCENA_FUNKCJI_TABELE_2026-08-06_R2.md`, MODUŁ 8). Tamto wdrożenie
usunęło `public/robots.txt` i postawiło bramkę repo; tu dochodzą bariera na
poziomie WDROŻENIA i widoczność powierzchni dla redakcji.

| Luka                                                                                | Status      |
| ----------------------------------------------------------------------------------- | ----------- |
| Brak `run_worker_first` - wrangler nadal oddaje pierwszeństwo assetom dla tych ścieżek | ✅ wdrożone |
| Redakcja nie widzi, co /robots.txt publikuje (był tylko tekst podpowiedzi)           | ✅ wdrożone |
| Bramka nie liczyła adresu bez rozszerzenia dla `*.html` (poza `index.html`)          | ✅ wdrożone |

---

## 1. `assets.run_worker_first` - bariera na poziomie wdrożenia

Bramka repo pilnuje katalogu `public/`. Nie widzi jednak plików, które trafiają
do artefaktu **poza repozytorium**: kroku CI, skryptu postbuild, wygenerowanego
`.output/public/`. A pierwszeństwo warstwy assetów działa niezależnie od tego,
skąd plik się wziął.

`vite.config.ts` deklaruje więc `cloudflare.wrangler.assets.run_worker_first` dla
adresów z rejestru `MACHINE_SURFACES` - worker wygrywa dla powierzchni
maszynowych bez względu na zawartość artefaktu. Lista pochodzi z rejestru, więc
nowa sitemapa czy feed jest chroniona automatycznie, bez drugiego miejsca do
pamiętania.

Szczegóły, które łatwo przeoczyć przy zmianie tej konfiguracji:

- nitro scala `cloudflare.wrangler` (defu) ze swoimi `overrides`, więc
  `assets.binding` i `assets.directory` pozostają nitrowe - dokładamy wyłącznie
  `run_worker_first`;
- build loguje `[cloudflare] Wrangler config 'assets' ... is overridden`. Dotyczy
  to podkluczy nadpisywanych przez nitro, nie naszego - tak wygląda poprawne
  scalanie, nie błąd;
- `deployConfig: true` powtarza domyślne zachowanie presetu (`deployConfig ??=
  true`) i jest w obiekcie z powodu TYPÓW: `@lovable.dev/vite-tanstack-config`
  deklaruje `cloudflare` jako `{ nodeCompat?, deployConfig? }`, czyli weak type -
  obiekt z samym `wrangler` nie miałby z nim ani jednego wspólnego pola i nie
  skompilowałby się. Zweryfikowane na typach paczki (2.8.5) i na ścieżce runtime,
  która forwarduje cały obiekt `cloudflare` (w sandboxie przez spread). Bez
  żadnego rzutowania.

## 2. Podgląd robots.txt w panelu redakcji

`src/components/admin/seo/RobotsTxtPreview.tsx` (molekuła, wpięta w
`/admin/settings/seo`) renderuje treść pliku **tym samym builderem**, którego
używa trasa (`buildRobotsTxt` + `aiCrawlerDirectives`), i linkuje do żywego
`/robots.txt`.

To nie kosmetyka: awaria trwała miesiącami także dlatego, że nigdzie w panelu nie
było widać, co ta powierzchnia publikuje. Teraz rozjazd między polityką z ekranu
a rzeczywistą odpowiedzią jest widoczny w dwóch kliknięciach, bez narzędzi
deweloperskich. Test (`__tests__/RobotsTxtPreview.test.tsx`) porównuje podgląd
bajt w bajt z wyjściem buildera - podgląd, który mógłby się rozjechać z trasą,
byłby gorszy niż jego brak.

Podgląd pokazuje politykę domeny PUBLIKACJI: na hoście edytora/lokalnym
`crawlerPublishOrigin` dałoby `http://localhost/...`, co redakcja odczytałaby
jako błąd konfiguracji, więc dla takich hostów pokazujemy origin marki i mówimy
to wprost w podpowiedzi (PL + EN).

## 3. Bramka: `*.html` odpowiada też pod adresem bez rozszerzenia

`assetUrlPaths` liczyło dodatkowy adres tylko dla `index.html`. Tymczasem
domyślne `html_handling: auto-trailing-slash` (Workers Assets, tak samo Vite)
wystawia KAŻDY dokument `.html` również bez rozszerzenia, więc
`public/sitemap.html` przesłania trasę `/sitemap` - adres, którego w nazwie pliku
nie widać. Dołożone do bramki plus dwa testy (mapowanie adresu i wykrycie
kolizji).

## 4. Pliki

| Plik                                                        | Zmiana                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| `vite.config.ts`                                            | `assets.run_worker_first` z `MACHINE_SURFACES`                 |
| `src/components/admin/seo/RobotsTxtPreview.tsx`             | nowa molekuła podglądu                                        |
| `src/components/admin/seo/__tests__/RobotsTxtPreview.test.tsx` | nowy - zgodność podglądu z builderem (4)                     |
| `src/routes/admin.settings.seo.tsx`                         | wpięcie podglądu w sekcję kanałów i sitemap                   |
| `src/lib/ci/staticAssetShadowing.ts`                        | `*.html` → także adres bez rozszerzenia                       |
| `src/lib/ci/__tests__/staticAssetShadowing.test.ts`         | dwa testy tej reguły                                          |
| `src/lib/locale/{pl,en}.ts`                                 | klucze podglądu robots.txt (parytet PL/EN)                    |
| `.github/workflows/ci.yml`                                  | test podglądu w kroku kontraktu SEO                           |

## 5. Weryfikacja

| Sprawdzenie                                                | Wynik                                              |
| ---------------------------------------------------------- | -------------------------------------------------- |
| `vitest run` (kontrakty SEO, host, bramka CI, polityka, podgląd) | przechodzi                                   |
| Typy opcji nitro/wranglera                                 | sprawdzone na typach paczki - bez rzutowania       |
| `bun install` w sandboxie                                  | niedostępny (polityka sieci blokuje rejestr) - pełny `build` i e2e weryfikuje CI |
