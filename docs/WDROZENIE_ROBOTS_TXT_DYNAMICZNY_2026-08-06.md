# Wdrożenie: /robots.txt odzyskany z warstwy assetów (2026-08-06)

Realizacja findingu nr 2 z `OCENA_FUNKCJI_TABELE_2026-08-06_R2.md` (MODUŁ 8 -
SEO/GEO/AEO, ocena `robots.txt` **9 → 4**) wraz z dwiema dziurami tej samej
powierzchni, które wyszły przy naprawie.

| Finding / rekomendacja                                                                                | Status      |
| ----------------------------------------------------------------------------------------------------- | ----------- |
| `public/robots.txt` przesłania dynamiczną trasę - produkcja oddaje `Allow: /` każdemu hostowi         | ✅ wdrożone |
| „Usunąć `public/robots.txt` i dopisać test/e2e, który potwierdza, że `/robots.txt` odpowiada z trasy" | ✅ wdrożone |
| „Inwariant: `public/` nie zawiera plików kolidujących z trasami" (wiersz `llms.txt`)                  | ✅ wdrożone |
| Polityka crawlerów AI z panelu nie docierała do robots.txt (`aiCrawlerDirectives` bez wołającego)     | ✅ wdrożone |
| Domena tenanta klasyfikowana jako host nieznany → zakaz indeksowania całego serwisu tenanta           | ✅ wdrożone |

---

## 1. Przyczyna: asset wygrywa z workerem

Wdrożenie celuje w Cloudflare (`nitro`, preset `cloudflare-module`). Generowany
`wrangler.json` wiąże `.output/public/` jako `assets`, a **Asset Worker
odpowiada PRZED naszym workerem**. Zacommitowany `public/robots.txt` (4 linie)
trafiał do artefaktu, więc trasa `/robots.txt` nigdy się na produkcji nie
wykonała. Crawler dostawał:

```
User-agent: *
Allow: /

Sitemap: https://neweuropeanstrategies.com/sitemap.xml
```

czyli: zaproszenie do indeksowania **dla każdego hosta** (aliasy `*.pages.dev`,
`*.workers.dev` i domeny historyczne włącznie - a te równolegle dostają 301 na
origin kanoniczny), brak `X-Robots-Tag`, brak ogłoszenia `/news-sitemap.xml`
(główny argument podniesienia oceny 03.08) i zero logiki per tenant.

Dlaczego nikt tego nie zauważył: `robots.test.ts` testuje **builder**, e2e
uderza w **dev-server**, w którym przed routerem nie ma warstwy assetów, a
`llms.txt` uratował wyłącznie przypadek (nikt nie dodał `public/llms.txt`).
Klasa błędu była całkowicie niewidoczna w repo.

## 2. Naprawa

| Zmiana                                                             | Plik                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Usunięty statyczny plik                                            | `public/robots.txt` (delete)                                                                |
| Trasa cienka jak pozostałe powierzchnie maszynowe                  | `src/routes/robots[.]txt.ts`                                                                |
| Cała logika żądania: host → klasa → tenant → ustawienia → treść    | `src/lib/server/robotsRequest.server.ts` (nowy)                                             |
| Grupy per user-agent + nagłówki odpowiedzi w czystym builderze     | `src/lib/seo/robots.ts`                                                                     |
| Polityka crawlerów AI jako STRUKTURY, nie linie tekstu             | `src/lib/seo/settings.ts` (`aiCrawlerGroups`)                                               |
| Jedna klasyfikacja hosta dla robots.txt i sitemapy                 | `src/lib/http/host.ts` (`classifyCrawlHost`, `crawlHostOrigin`)                             |
| Ścisłe dopasowanie domeny tenanta (bez fallbacku)                  | `src/lib/server/tenant.server.ts` (`resolveDomainBinding`)                                  |
| Sitemapa korzysta z tej samej klasyfikacji (bez zmiany zachowania) | `src/lib/server/sitemapRequest.server.ts`                                                   |
| Podgląd pliku dla redakcji (PL/EN) + link do żywego adresu         | `src/components/admin/seo/RobotsTxtPreview.tsx` (nowy), `src/routes/admin.settings.seo.tsx` |

### Klasy hosta

| Klasa     | Kiedy                                                  | robots.txt                                | `X-Robots-Tag`      |
| --------- | ------------------------------------------------------ | ----------------------------------------- | ------------------- |
| `brand`   | `CANONICAL_SITE_HOSTS` (apex + www)                    | `Allow: /` + sitemapy na originie marki   | `all`               |
| `tenant`  | dokładne dopasowanie `tenants.domain` (± www)          | `Allow: /` + sitemapy na WŁASNYM originie | `all`               |
| `alias`   | `*.pages.dev`, `*.workers.dev`, `LEGACY_HOST_SUFFIXES` | `Disallow: /`                             | `noindex, nofollow` |
| `editor`  | localhost, `id-preview--*`, `EDITOR_HOST_SUFFIXES`     | `Disallow: /`                             | `noindex, nofollow` |
| `unknown` | domena, której nie objął żaden tenant                  | `Disallow: /` (fail-closed)               | `noindex, nofollow` |

Kolejność reguł jest częścią kontraktu: **marka > podgląd/alias > katalog
domen**, więc wpisanie aliasu hostingu jako domeny tenanta nie otwiera
indeksowania. Katalog domen jest odpytywany dopiero, gdy reguły statyczne nie
rozstrzygają - host marki nie zależy więc od dostępności bazy.

### Wcześniej: domena tenanta = `Disallow: /`

`CANONICAL_SITE_HOSTS` to hosty marki, a domena zajęta przez innego tenanta nie
jest ani marką, ani aliasem, ani podglądem - lądowała w `unknown`, czyli w
pełnym zakazie indeksowania. Równocześnie `/sitemap.xml` publikował dla tego
hosta jego własne adresy. Dwie powierzchnie SEO twierdziły coś przeciwnego;
teraz obie liczą origin tą samą funkcją.

### Niepewność ≠ zakaz na godziny

Gdy katalog domen jest nieosiągalny, odpowiedź pozostaje fail-closed, ale plan
jest oznaczony jako `volatile` i idzie z `Cache-Control: private, no-store`.
Bez tego minutowa awaria bazy zamrażałaby `Disallow: /` w CDN (30 min okna
stale) i w Google. Host marki tej ścieżki nie dotyka.

### Nie ogłaszamy adresów, które odpowiedzą 404

`/news-sitemap.xml` jest ogłaszany tylko przy `news_sitemap_enabled`, a
JAKAKOLWIEK sitemapa - tylko gdy trasy mapy nie odpowiedzą dla tego hosta
fail-closed (`crawlerDegradeIsSafe`). Wcześniej `/sitemap.xml` był ogłaszany
bezwarunkowo, co na hoście bez tenanta kierowało crawlera na 404.

### Polityka crawlerów AI faktycznie w pliku

`aiCrawlerDirectives` zwracał gotowe linie i **nie miał ani jednego
wołającego** - redakcja mogła w `/admin/settings/seo` zabronić crawlerom
treningowym lub wyszukiwawczym, a robots.txt nigdy o tym nie wspomniał.
Funkcja zwraca teraz `RobotsGroup[]`, a plik składa jeden builder. Blokada
botów AI to OSOBNE grupy - crawler stosuje tylko najlepiej dopasowaną grupę,
więc `User-agent: *` z `Allow: /` pozostaje nietknięty.

## 3. Bariery przed powrotem problemu

1. **Bramka CI `check:public-assets`** (`scripts/check-public-asset-shadowing.ts`,
   logika: `src/lib/ci/publicAssetShadowing.ts`) - błąd, gdy jakikolwiek plik z
   `public/` odpowiada pod adresem trasy. Dwie niezależne wyrocznie adresów tras
   (wygenerowane `routeTree.gen.ts` + konwencja nazw plików, żeby nieodświeżone
   drzewo nie ukryło nowej trasy) i reguła `html_handling` Cloudflare Assets
   (`foo.html` odpowiada też pod `/foo`, `foo/index.html` pod `/foo` i `/foo/`).
2. **`assets.run_worker_first`** w `vite.config.ts` - lista adresów pochodzi z
   `MACHINE_SURFACES`, więc nowy feed czy sitemapa jest chroniona automatycznie.
   Nitro scala `cloudflare.wrangler` (defu) z własnymi `overrides`, więc
   `assets.binding`/`assets.directory` zostają nitrowe. Build loguje przy tym
   `[cloudflare] Wrangler config 'assets' ... is overridden` - dotyczy
   nadpisywanych podkluczy, nie `run_worker_first`; tak wygląda poprawne
   scalanie.
3. **E2E** (`e2e/seo.spec.ts`) - „robots.txt is served by the route, not by a
   static asset": obecność `X-Robots-Tag` (statyczny asset go nie ma) oraz
   RÓŻNA treść dla `localhost` i dla `x-forwarded-host:
neweuropeanstrategies.com` (statyczny plik nie zmienia treści per host).
4. **Test repo-inwariantu** w `src/lib/ci/__tests__/publicAssetShadowing.test.ts`
   - imiennie pilnuje, że `public/robots.txt` nie wraca, a trasa istnieje.

## 4. Testy

| Zakres                                                                                                                                   | Plik                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Builder: grupy per agent, kolejność, puste grupy, komentarz per host, nagłówki (w tym `no-store` przy `volatile`)                        | `src/lib/seo/__tests__/robots.test.ts`              |
| Polityka AI: struktury + dotarcie do gotowego pliku                                                                                      | `src/lib/seo/__tests__/settings.test.ts`            |
| Klasyfikacja hosta i origin publikacji                                                                                                   | `src/lib/http/__tests__/host.test.ts`               |
| Plan żądania: 5 klas hosta, news sitemap, degradacja ustawień, `volatile`, tenant z własnym originem (zaślepione tylko dwie granice I/O) | `src/lib/server/__tests__/robotsRequest.test.ts`    |
| Bramka anty-przesłonięcia: logika + inwariant repo                                                                                       | `src/lib/ci/__tests__/publicAssetShadowing.test.ts` |
| E2E powierzchni                                                                                                                          | `e2e/seo.spec.ts`                                   |

## 5. Weryfikacja ręczna po wdrożeniu

```bash
# 1. Host kanoniczny: Allow + sitemapy + X-Robots-Tag: all
curl -sI https://neweuropeanstrategies.com/robots.txt | grep -i x-robots-tag
curl -s  https://neweuropeanstrategies.com/robots.txt

# 2. Alias hostingu: pełny zakaz, ZERO deklaracji sitemap
curl -s https://<alias>.workers.dev/robots.txt

# 3. Każda ogłoszona sitemapa musi odpowiadać 200
curl -s https://neweuropeanstrategies.com/robots.txt \
  | awk '/^Sitemap: /{print $2}' | xargs -I{} curl -o /dev/null -sw "%{http_code} {}\n" {}
```

Po wdrożeniu warto poprosić w Search Console o ponowne pobranie robots.txt -
Google trzyma poprzednią wersję w cache do 24 h.
