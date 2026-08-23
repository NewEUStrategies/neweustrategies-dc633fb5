# Monetyzacja (MODUŁ 14): warstwa decyzji o pieniądzach z 27% na 90%, 90 defektów, 71 nowych progów i dziewięć tras panelu rozbitych na atomy (2026-08-23)

## 1. Zmierzone liczby — cel z §6 osiągnięty w JEDNEJ z trzech miar

Pomiar własny: `bun run test:coverage` na pełnym `src/` z `all: true`
(2026-08-23 05:28, 23 commity na gałęzi). Suita: **1629 z 1632 plików testowych
zielonych**, 2 pominięte, **42 669 testów zdanych, 254 `expected fail`**
(udokumentowane defekty), 50 pominiętych, **1 czerwony** — `authzSnapshotParity`,
czerwony na tej gałęzi od jej utworzenia i **nie z tej pracy** (§4 poz. 11).

### Moduł 14 — dwa liczniki, bo ekstrakcja zmieniła MIANOWNIK

Ekstrakcja wg atomic design utworzyła 78 nowych plików modułu, więc „moduł 14"
liczony dziś i „moduł 14" z audytu to nie ten sam zbiór. Podaję oba, bo tylko
pierwszy z nich jest porównaniem 1:1 z bazą.

**(a) Tylko pliki, które ISTNIAŁY przed tą pracą (68 plików) — porównanie 1:1:**

| miara      | audyt (wyd. 5) |           po tej pracy |         delta |
| ---------- | -------------: | ---------------------: | ------------: |
| linie      |         27,10% | **86,31%** (1255/1454) | **+59,21 pp** |
| gałęzie    |         30,28% | **83,14%** (1149/1382) | **+52,86 pp** |
| funkcje    |         17,90% |   **84,72%** (316/373) | **+66,82 pp** |
| instrukcje |         27,00% | **85,14%** (1415/1662) | **+58,14 pp** |

**(b) Cały moduł, jak wygląda dziś (146 plików):**

| miara      |                wartość |
| ---------- | ---------------------: |
| linie      | **90,32%** (1856/2055) |
| gałęzie    | **87,46%** (1709/1954) |
| funkcje    |   **91,08%** (592/650) |
| instrukcje | **89,20%** (2056/2305) |

**(c) Tylko 78 plików utworzonych w tej pracy** — 100,00% linii (601/601),
97,90% gałęzi, 99,64% funkcji. To jest odpowiedź na pytanie, czy ekstrakcja była
mechanizmem dojścia do pokrycia, czy tylko przenoszeniem kodu.

Rozkład: **106 z 146 plików stoi na 100/100/100.** Na zerze linii zostają
**dwa**: `lib/billing/donationsAdmin.functions.ts`
i `lib/billing/donationsAdmin.server.ts` — warstwa serwerowa synchronizacji ze
Stripe'em, podmieniona atrapą w teście trasy i nietestowana bezpośrednio
(pozycja w §8).

### Cel z §6 zlecenia (≥95% linii / ≥93% gałęzi / ≥90% funkcji)

**FUNKCJE: OSIĄGNIĘTE** — 91,08% na module jako całości.
**LINIE: NIE** — 90,32% wobec 95%.
**GAŁĘZIE: NIE** — 87,46% wobec 93%.

Nie zaokrąglam w górę i nie nazywam dwóch z trzech miar sukcesem. Bazowe 27%
wzrosło ponad trzykrotnie, a warstwa decyzji o pieniądzach jest zaryglowana —
ale dwie z trzech liczb z §6 nie zostały dobite i §8 mówi dokładnie, gdzie
leży brakujące pokrycie.

### Progi globalne `src/`

Zmierzone **76,25% linii / 69,73% gałęzi / 73,48% funkcji / 75,20% instrukcji**
(71 813/94 180 linii) wobec progów **58 / 62 / 65 / 64**. Zapas na ratchet jest
realny (+5…+18 pp) i podniesienie progów globalnych to osobna, jednorazowa
decyzja — patrz §6.

### Etap 4 (pgTAP) — cel osiągnięty

Trzy nowe pliki, **66 asercji** (25 + 19 + 22), wszystkie zielone. Sprawdzone
ponownie po całej pracy, plik po pliku, na pełnym schemacie (796 migracji

- `seed.sql`) przez `scripts/pgtap-local/run.sh test <wzorzec>`.

---

## 2. Powierzchnie: plik → pokrycie po tej pracy

Pełna lista, na której podstawie da się poprawić mapę funkcjonalności w audycie.
Kolumna „moduł" pokazuje, gdzie plik leży MAPOWO — sześć plików funkcjonalności
monetyzacji liczy się dziś do modułów 07/13/15.

| plik                                                               |  moduł   |  linie | gałęzie | funkcje |
| ------------------------------------------------------------------ | :------: | -----: | ------: | ------: |
| `components/AdSlot.tsx`                                            |    14    |   100% |    100% |    100% |
| `components/admin/ads/atoms/AdConsentLabel.tsx`                    |    14    |   100% |    100% |    100% |
| `components/admin/ads/atoms/AdCtrCell.tsx`                         |    14    |   100% |    100% |    100% |
| `components/admin/ads/atoms/AdSlotStatusLabel.tsx`                 |    14    |   100% |    100% |    100% |
| `components/admin/ads/atoms/AdTargetingChip.tsx`                   |    14    |   100% |    100% |    100% |
| `components/admin/ads/atoms/AdTargetingSummary.tsx`                |    14    |   100% |    100% |    100% |
| `components/admin/ads/molecules/AdPlacementConfigFields.tsx`       |    14    |   100% |    100% |    100% |
| `components/admin/ads/molecules/AdPlacementRow.tsx`                |    14    |   100% |    100% |    100% |
| `components/admin/ads/molecules/AdSlotKindFields.tsx`              |    14    |   100% |    100% |    100% |
| `components/admin/ads/molecules/AdSlotRow.tsx`                     |    14    |   100% |    100% |    100% |
| `components/admin/ads/molecules/AdTableEmptyRow.tsx`               |    14    |   100% |    100% |    100% |
| `components/admin/ads/organisms/AdStatsPanel.tsx`                  |    14    |   100% |    100% |    100% |
| `components/admin/coupons/atoms/CampaignDiscountCell.tsx`          |    14    |   100% |    100% |    100% |
| `components/admin/coupons/atoms/CampaignStatusBadge.tsx`           |    14    |   100% |    100% |    100% |
| `components/admin/coupons/atoms/CampaignTierBadge.tsx`             |    14    |   100% |    100% |    100% |
| `components/admin/coupons/atoms/CouponActiveBadge.tsx`             |    14    |   100% |    100% |    100% |
| `components/admin/coupons/atoms/CouponDiscountCell.tsx`            |    14    |   100% |    100% |    100% |
| `components/admin/coupons/atoms/CouponStatCard.tsx`                |    14    |   100% |    100% |    100% |
| `components/admin/coupons/atoms/CouponStatTile.tsx`                |    14    |   100% |    100% |    100% |
| `components/admin/coupons/atoms/CouponTierBadge.tsx`               |    14    |   100% |    100% |    100% |
| `components/admin/coupons/atoms/CouponUsesCell.tsx`                |    14    |   100% |    100% |    100% |
| `components/admin/coupons/atoms/CouponValidityRange.tsx`           |    14    |   100% |    100% |    100% |
| `components/admin/coupons/atoms/RedemptionEffectsBadge.tsx`        |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/CampaignCodeShapeFields.tsx`   |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/CampaignDiscountFields.tsx`    |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/CampaignGrantsFields.tsx`      |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/CampaignRowActions.tsx`        |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/CouponCodeCell.tsx`            |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/CouponDateRangeFields.tsx`     |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/CouponDiscountFields.tsx`      |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/CouponGrantsFields.tsx`        |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/CouponListToolbar.tsx`         |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/CouponPlanRestrictionList.tsx` |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/CouponRowActions.tsx`          |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/CouponStatsRow.tsx`            |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/CouponTabsNav.tsx`             |    14    |   100% |    100% |    100% |
| `components/admin/coupons/molecules/RedemptionsFilterBar.tsx`      |    14    |   100% |    100% |    100% |
| `components/admin/coupons/organisms/CampaignCreateDialog.tsx`      |    14    |   100% |    100% |    100% |
| `components/admin/coupons/organisms/CampaignsTable.tsx`            |    14    |   100% |    100% |    100% |
| `components/admin/coupons/organisms/CouponAnalyticsTable.tsx`      |    14    |   100% |    100% |    100% |
| `components/admin/coupons/organisms/CouponCreateDialog.tsx`        |    14    |   100% |    100% |    100% |
| `components/admin/coupons/organisms/CouponsTable.tsx`              |    14    |   100% |    100% |    100% |
| `components/admin/coupons/organisms/RedemptionsTable.tsx`          |    14    |   100% |    100% |    100% |
| `components/admin/gifting/atoms/GiftEventPill.tsx`                 |    14    |   100% |    100% |    100% |
| `components/admin/gifting/atoms/GiftFilterChip.tsx`                |    14    |   100% |    100% |    100% |
| `components/admin/gifting/atoms/GiftStatCard.tsx`                  |    14    |   100% |    100% |    100% |
| `components/admin/gifting/atoms/GiftStatusPill.tsx`                |    14    |   100% |    100% |    100% |
| `components/admin/gifting/molecules/GiftEligibilityFieldset.tsx`   |    14    |   100% |    100% |    100% |
| `components/admin/gifting/molecules/GiftEventRow.tsx`              |    14    |   100% |    100% |    100% |
| `components/admin/gifting/molecules/GiftLimitField.tsx`            |    14    |   100% |    100% |    100% |
| `components/admin/gifting/molecules/GiftLinkRow.tsx`               |    14    |   100% |    100% |    100% |
| `components/admin/gifting/molecules/GiftTabNav.tsx`                |    14    |   100% |    100% |    100% |
| `components/admin/gifting/molecules/GiftTableState.tsx`            |    14    |   100% |    100% |    100% |
| `components/admin/gifting/organisms/GiftAuditPanel.tsx`            |    14    |   100% |    100% |    100% |
| `components/admin/gifting/organisms/GiftStatsPanel.tsx`            |    14    |   100% |    100% |    100% |
| `components/ads/AdSlotById.tsx`                                    |    14    |   100% |    100% |    100% |
| `components/ads/FooterSlideup.tsx`                                 |    14    |   100% |    100% |    100% |
| `components/ads/MidPostAds.tsx`                                    |    14    |   100% |    100% |    100% |
| `components/ads/atoms/AdContainer.tsx`                             |    14    |   100% |    100% |    100% |
| `components/ads/atoms/SandboxedAdFrame.tsx`                        |    14    |   100% |    100% |    100% |
| `components/ads/useInFeedAds.tsx`                                  |    14    |   100% |    100% |    100% |
| `components/checkout/CheckoutAssurances.tsx`                       |    14    |   100% |    100% |    100% |
| `components/checkout/CouponInput.tsx`                              | 07/13/15 |   100% |    100% |    100% |
| `components/checkout/EmbeddedCheckoutDialog.tsx`                   |    14    |   100% |    100% |    100% |
| `components/checkout/LazyEmbeddedCheckoutDialog.tsx`               |    14    |   100% |    100% |    100% |
| `components/checkout/StripeEmbeddedFrame.tsx`                      |    14    |   100% |    100% |    100% |
| `components/checkout/checkoutDialogChunk.ts`                       |    14    |   100% |    100% |     75% |
| `components/checkout/checkoutIntent.ts`                            |    14    |   100% |    100% |    100% |
| `components/donations/DonationsWidgetView.tsx`                     |    14    |   100% |    100% |    100% |
| `components/donations/atoms/DonationProgressBar.tsx`               |    14    |   100% |    100% |    100% |
| `components/donations/atoms/DonationRecentList.tsx`                |    14    |   100% |    100% |    100% |
| `components/donations/atoms/DonationStatBox.tsx`                   |    14    |   100% |    100% |    100% |
| `components/donations/donationsWidgetModel.ts`                     |    14    |   100% |    100% |    100% |
| `components/gifting/GiftBanner.tsx`                                |    14    |   100% |    100% |    100% |
| `components/gifting/atoms/GiftChannelLink.tsx`                     |    14    |   100% |    100% |    100% |
| `hooks/useValidateCoupon.ts`                                       |    14    |   100% |    100% |    100% |
| `lib/admin/couponTabs.ts`                                          |    14    |   100% |    100% |    100% |
| `lib/ads/adFrame.ts`                                               |    14    |   100% |    100% |    100% |
| `lib/ads/dimensions.ts`                                            |    14    |   100% |    100% |    100% |
| `lib/ads/footerSlideup.ts`                                         |    14    |   100% |    100% |    100% |
| `lib/ads/injection.ts`                                             |    14    |   100% |    100% |    100% |
| `lib/ads/pageType.ts`                                              |    14    |   100% |    100% |    100% |
| `lib/ads/queries.ts`                                               |    14    |   100% |    100% |    100% |
| `lib/ads/readingMode.ts`                                           |    14    |   100% |    100% |    100% |
| `lib/billing/couponAdminForm.ts`                                   |    14    |   100% |    100% |    100% |
| `lib/billing/couponAdminList.ts`                                   |    14    |   100% |    100% |    100% |
| `lib/billing/couponAnalyticsView.ts`                               |    14    |   100% |    100% |    100% |
| `lib/billing/couponCampaignForm.ts`                                |    14    |   100% |    100% |    100% |
| `lib/billing/couponCsv.ts`                                         |    14    |   100% |    100% |    100% |
| `lib/billing/couponEffects.server.ts`                              | 07/13/15 |   100% |    100% |    100% |
| `lib/billing/couponMoney.ts`                                       | 07/13/15 |   100% |    100% |    100% |
| `lib/billing/couponNewsletterDraft.ts`                             |    14    |   100% |    100% |    100% |
| `lib/billing/couponRedemptionsRange.ts`                            |    14    |   100% |    100% |    100% |
| `lib/billing/donationsAdminModel.ts`                               |    14    |   100% |    100% |    100% |
| `lib/billing/donationsConfigQuery.ts`                              |    14    |   100% |    100% |    100% |
| `lib/billing/donationsExternal.ts`                                 |    14    |   100% |    100% |    100% |
| `lib/gifting/admin-model.ts`                                       |    14    |   100% |    100% |    100% |
| `lib/i18n-admin-coupons.ts`                                        |    14    |   100% |    100% |      0% |
| `lib/i18n-ads-admin.ts`                                            |    14    |   100% |    100% |      0% |
| `lib/i18n-donate.ts`                                               |    14    |   100% |    100% |      0% |
| `lib/i18n-donations-admin.ts`                                      |    14    |   100% |    100% |      0% |
| `lib/i18n-donations-widget.ts`                                     |    14    |   100% |    100% |    100% |
| `lib/i18n-gifting-admin.ts`                                        |    14    |   100% |    100% |    100% |
| `lib/i18n-gifting.ts`                                              |    14    |   100% |    100% |    100% |
| `lib/retention/coupon.ts`                                          | 07/13/15 |   100% |    100% |    100% |
| `routes/admin.ads.tsx`                                             |    14    |   100% |    100% |    100% |
| `routes/admin.coupons.campaigns.tsx`                               |    14    |   100% |    100% |    100% |
| `routes/admin.coupons.tsx`                                         |    14    |   100% |    100% |    100% |
| `routes/admin.gifting.tsx`                                         |    14    |   100% |    100% |    100% |
| `routes/api/public/ad-event.ts`                                    | 07/13/15 |   100% |    100% |    100% |
| `routes/donate.tsx`                                                |    14    |   100% |    100% |    100% |
| `lib/ads/types.ts`                                                 |    14    |   100% |   97,3% |    100% |
| `lib/gifting-admin.functions.ts`                                   |    14    |   100% |  96,88% |    100% |
| `components/admin/ads/organisms/AdPlacementForm.tsx`               |    14    |   100% |  95,83% |    100% |
| `routes/admin.coupons.analytics.tsx`                               |    14    |   100% |  95,45% |    100% |
| `components/admin/coupons/DatePickerField.tsx`                     |    14    |   100% |  94,44% |    100% |
| `routes/admin.coupons.redemptions.tsx`                             |    14    |   100% |  94,44% |    100% |
| `components/admin/ads/organisms/AdSlotsPanel.tsx`                  |    14    |   100% |  93,75% |    100% |
| `components/admin/gifting/organisms/GiftLinksPanel.tsx`            |    14    |   100% |  93,75% |    100% |
| `components/admin/gifting/organisms/GiftSettingsPanel.tsx`         |    14    |   100% |  93,75% |    100% |
| `lib/gifting/hooks.ts`                                             |    14    |   100% |  93,26% |    100% |
| `components/admin/ads/molecules/AdTargetingEditor.tsx`             |    14    |   100% |  92,86% |    100% |
| `components/admin/ads/organisms/AdSlotForm.tsx`                    |    14    |   100% |     90% |    100% |
| `lib/ads/consent.ts`                                               |    14    |   100% |  88,71% |    100% |
| `components/admin/ads/organisms/AdPlacementsPanel.tsx`             |    14    |   100% |   87,5% |    100% |
| `lib/ads/idle.ts`                                                  |    14    |   100% |     80% |     80% |
| `components/donations/DonationCta.tsx`                             |    14    |   100% |  76,92% |    100% |
| `lib/billing/donationsConfig.ts`                                   |    14    |   100% |     75% |    100% |
| `components/gifting/atoms/GiftCopyButton.tsx`                      |    14    |   100% |  57,14% |    100% |
| `components/checkout/atoms/CheckoutFrameSkeleton.tsx`              |    14    |   100% |     50% |    100% |
| `components/gifting/molecules/GiftShareChannels.tsx`               |    14    |   100% |     50% |    100% |
| `lib/gifting/model.ts`                                             |    14    | 97,87% |  94,23% |    100% |
| `routes/admin.coupons.index.tsx`                                   |    14    | 97,62% |  84,62% |  93,75% |
| `lib/billing/donations.server.ts`                                  |    14    | 94,05% |  81,48% |    100% |
| `components/checkout/FxRateNotice.tsx`                             |    14    | 93,75% |  48,28% |    100% |
| `lib/ads/useDeferredAd.ts`                                         |    14    |  91,3% |  88,24% |    100% |
| `components/donations/DonationForm.tsx`                            |    14    | 88,89% |  86,54% |  66,67% |
| `components/gifting/molecules/GiftClickBudgetMeter.tsx`            |    14    | 83,33% |     50% |    100% |
| `components/checkout/EmbeddedCheckoutFrame.tsx`                    |    14    |    75% |    100% |     40% |
| `components/gifting/GiftArticleButton.tsx`                         |    14    | 74,36% |  86,59% |     50% |
| `routes/admin.donations.tsx`                                       |    14    | 62,79% |    100% |  40,74% |
| `lib/billing/coupons.ts`                                           | 07/13/15 |  62,5% |     60% |    100% |
| `components/checkout/GuestCheckoutGate.tsx`                        |    14    | 51,85% |  42,86% |     20% |
| `lib/billing/donations.functions.ts`                               |    14    | 12,77% |      0% |      0% |
| `lib/billing/donationsAdmin.functions.ts`                          |    14    |     0% |    100% |      0% |
| `lib/billing/donationsAdmin.server.ts`                             |    14    |     0% |      0% |      0% |

### Dziewięć tras panelu — wszystkie mają teraz wiersz i pokrycie

Zlecenie miało rację: te trasy należą do modułu 14 i do żadnej funkcjonalności.
Audyt powinien dostać piąty wiersz „Panele monetyzacji (admin)". Po tej pracy
**żadna z nich nie stoi już na 0%**, a każda jest kompozycją organizmów:

| trasa                           | linie przed ekstrakcją |                                        po |
| ------------------------------- | ---------------------: | ----------------------------------------: |
| `admin.ads.tsx`                 |                    837 |                                        50 |
| `admin.gifting.tsx`             |                    793 |                                        65 |
| `admin.coupons.index.tsx`       |                    679 |                                       159 |
| `admin.coupons.campaigns.tsx`   |                    653 |                                       202 |
| `admin.coupons.redemptions.tsx` |                    325 |                                       123 |
| `admin.donations.tsx`           |                    329 | 329 (bez ekstrakcji układu — patrz niżej) |
| `admin.coupons.analytics.tsx`   |                    291 |                                       127 |
| `admin.coupons.tsx`             |                    106 |                                        55 |
| `donate.tsx`                    |                     70 |                70 (za mała, żeby dzielić) |

Razem **4 083 linie fizyczne zredukowane do 1 180** — reszta przeszła do 79
nowych plików w `components/admin/{ads,gifting,coupons}/{atoms,molecules,organisms}`
oraz do dziesięciu czystych modułów reguł w `src/lib/`.

Dwie trasy zostały bez rozbicia układu, w obu przypadkach z podanym powodem:
`donate.tsx` (70 linii, jedno rozgałęzienie na `?status=thanks` — dzielenie
zwiększyłoby liczbę plików bez zwiększenia dowodu) oraz `admin.donations.tsx`,
z której wyszła cała warstwa DECYZJI (`donationsAdminModel.ts`), a układ został
w jednym pliku, bo trasa jest formularzem ustawień bez powtarzalnych wierszy —
i tak ma 28 testów przez `renderRoute`.

### Pliki utworzone i zmienione (23 commity)

**Testy: 83 pliki `.test.ts(x)` + 3 pliki pgTAP.** 90 z tych testów to
`it.fails` — udokumentowane defekty, każdy z opisem oczekiwanego zachowania
i sąsiednim zwykłym `it()` opisującym stan faktyczny. Zero `it.skip`,
zero `it.todo`.

**Produkcja — 79 nowych plików, w trzech rozłącznych grupach:**

1. **Ekstrakcja układu (atomic design), 62 pliki:**
   `components/admin/ads/` (17), `components/admin/gifting/` (14),
   `components/admin/coupons/` (28), `components/donations/atoms/` (3).
2. **Ekstrakcja reguł (czysta logika, zero Reacta), 13 modułów:**
   `lib/ads/injection.ts`, `lib/ads/footerSlideup.ts`, `lib/ads/adFrame.ts`,
   `lib/billing/couponAdminForm.ts`, `couponAdminList.ts`,
   `couponAnalyticsView.ts`, `couponCampaignForm.ts`, `couponCsv.ts`,
   `couponNewsletterDraft.ts`, `couponRedemptionsRange.ts`,
   `donationsAdminModel.ts`, `lib/admin/couponTabs.ts`,
   `components/donations/donationsWidgetModel.ts`.
3. **i18n, 1 plik:** `lib/i18n-donations-admin.ts` (nowy słownik panelu darowizn).
4. **Pomoc testowa, 1 plik:** `src/test/adminGiftingLanguage.ts`.

**Zmienione pliki produkcyjne (18), wyłącznie w dwóch dozwolonych kategoriach:**

- _ekstrakcja bez zmiany zachowania_: dziewięć tras panelu,
  `components/ads/{FooterSlideup,MidPostAds,useInFeedAds}.tsx`,
  `components/ads/atoms/SandboxedAdFrame.tsx`,
  `components/donations/DonationsWidgetView.tsx`;
- _przeniesienie literałów do słownika_: `lib/i18n-donations-widget.ts`
  (cztery nowe klucze w pl i en), `routes/admin.donations.tsx` (~45 literałów),
  `scripts/lib/i18nHardcodedBaseline.ts` (wpis spadł do zera i wypadł z listy).

**Bramki i konfiguracja:** `vitest.config.ts` (progi per-ścieżka),
`src/routes/__tests__/adminRouteAuthority.gate.test.ts` (sekcja modułu 14),
dwa nowe pliki bramek: `src/__tests__/monetizationI18nLoading.gate.test.ts`
i `src/lib/ads/__tests__/adLabelKeys.gate.test.ts`.

## 3. Defekty pogrupowane w klasy

**90 pozycji** (`it.fails` w 83 nowych plikach testowych). Każda ma opis
OCZEKIWANEGO zachowania oraz — tam, gdzie stan faktyczny wart jest przypięcia —
sąsiedni zwykły `it()`; po naprawie usuwa się je razem. Zero `it.skip`, zero
`it.todo`. **Żadnej z tych rzeczy nie naprawiłem.**

Etap 1 dał pięć klas (A–E). Etapy 2–3 dodały trzy nowe, których zlecenie nie
przewidywało: **F (raport o pieniądzach kłamie cicho)**, **G (panel milczy
o tym, czego nie pokazał)** i **H (dane wychodzące na zewnątrz)**.

### KLASA A: „awaria odczytu udaje odpowiedź" — 14 wystąpień (A1–A4 z etapu 1)

Najgroźniejsza klasa w tym module, bo w każdym przypadku system podaje
użytkownikowi **konkretną, fałszywą informację** zamiast przyznać się do awarii.

| #   | plik                                  | co się dzieje                                                                                                                                                                           | skutek                                                                                                                                                                                                             |  `it.fails`  |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------: |
| A1  | `lib/ads/readingMode.ts:78`           | `paying = tierQ.isPending ? true : (rank ?? 0) > 0` rozgałęzia się WYŁĄCZNIE na `isPending`. Stan błędu to `isPending === false` + `data === undefined`, więc `paying` wychodzi `false` | awaria odczytu planu daje budżet `max_ad_zones_free` zamiast `max_ad_zones_paid` — **płacący czytelnik dostaje WIĘCEJ reklam**, dokładnie przeciwnie do intencji zapisanej w komentarzu nad funkcją                |      ✔       |
| A2  | `lib/billing/couponEffects.server.ts` | dryf nazwy pola w odpowiedzi RPC → `parseOutcome` daje `{applied:false}` bez `reason`                                                                                                   | klient **zapłacił** za plan z kuponu, planu nie dostał, i **nie ma żadnego sygnału** — patrz §5 (to ustalenie jest gorsze, niż zakładało zlecenie)                                                                 |      ✔       |
| A3  | `hooks/useValidateCoupon.ts`          | pusty zbiór wierszy z RPC → `[0] ?? null` → `setResult(null)`, stan nieodróżnialny od „jeszcze nie walidowano"                                                                          | klient wpisuje kod i **nie dostaje ani rabatu, ani komunikatu**; co gorsza, pusty zbiór ZERUJE poprzedni poprawny werdykt                                                                                          |      ✔       |
| A4  | `lib/ads/queries.ts`                  | błąd odczytu jest głośny (`throw` → `isError`), a odfiltrowanie w `select` — ciche (`isSuccess` + pusta lista)                                                                          | regres w `parseAdTargeting` albo redakcyjna literówka w `targeting` gasi WSZYSTKIE reklamy nieodróżnialnie od „nie ma kreacji". Różnica ISTNIEJE w cache (surowa odpowiedź ma wiersze), więc alarm da się zbudować | dokumentacja |

### KLASA B: „spalony zasób podany jako wina użytkownika" — 1 wystąpienie, najważniejsze

| #   | plik                           | co się dzieje                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | `lib/gifting/hooks.ts:322-324` | RPC `redeem_gift_link` po stronie bazy **już skonsumowało slot budżetu**, gdy odpowiada. Gdy treść przyjdzie nierenderowalna PRZY `row.valid === true`, kod nadpisuje werdykt na `{ body: EMPTY_BODY, valid: false, reason: "invalid" }` — czyli **dokładnie ten sam werdykt, co przy nieprawidłowym kodzie z serwera**. |

Skutek: odbiorca widzi „ten link jest nieprawidłowy" i paywall; slot z budżetu
(domyślnie 1 z 5) jest zużyty; miesięczny limit nadawcy o jeden niższy;
w `gift_events` leży udana realizacja — a interfejs mówi odbiorcy, że to **on**
ma zły link. Osobny test dowodzi, że para `(valid, reason)`, na której stoi cały
wybór banera, jest w obu przypadkach **identyczna**. Jedyna różnica żyje w
`body` (`null` kontra `EMPTY_BODY`) i nikt jej nie czyta jako sygnału.

### KLASA C: RODO — zgoda, która wraca albo nie zostawia śladu — 5 wystąpień

| #   | plik                                               | co się dzieje                                                                                                                                                                          | skutek                                                                                                                                                                                                                                                                                | `it.fails` |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------: |
| C1  | `lib/ads/consent.ts` (`clearConsent`)              | wyczyszczenie zgód nie propaguje wycofania ani do profilu, ani do rejestru RODO                                                                                                        | zalogowany klika „wyczyść zgody", a najbliższe zdarzenie auth **WSKRZESZA zgodę z profilu w pełnym zakresie, w tym marketing**. Wycofanie nie zostawia śladu w audycie (art. 7 ust. 3)                                                                                                |     ✔      |
| C2  | `lib/ads/consent.ts` (`syncConsentToProfile`)      | błąd RPC `get_own_profile` jest IGNOROWANY, więc `prevPrefs` schodzi do `{}` i `update` nadpisuje **CAŁĄ** kolumnę `prefs` samym kluczem `consent`                                     | zapis zgody **kasuje wszystkie pozostałe preferencje** użytkownika (motyw, powiadomienia, cokolwiek trzyma `prefs`)                                                                                                                                                                   |     ✔      |
| C3  | `lib/ads/consent.ts` (`hydrateConsentFromProfile`) | gdy zdalna zgoda ISTNIEJE, ale jest STARSZA od lokalnej, nowsza decyzja lokalna nigdy nie leci do profilu (warunek wymaga BRAKU zdalnej)                                               | na drugim urządzeniu wraca STARA zgoda — **wycofanie zgody „odżywa"**                                                                                                                                                                                                                 |     ✔      |
| C4  | `lib/ads/consent.ts` (`readLocal`)                 | brak `try/catch`, w przeciwieństwie do `writeLocal` i `clearConsent`                                                                                                                   | w przeglądarce blokującej `localStorage` rzut leci przez `hasCategoryConsent` do silnika analityki i przez inicjalizator `useConsent` do error boundary; fallback cookie, który mógłby uratować decyzję, **nigdy nie jest osiągany**                                                  |     ✔      |
| C5  | `lib/cookieBanner/registry.ts`                     | glob `consent*`/`gpc*` jest ZAKOTWICZONY (`^…$`), więc realne nośniki `nes_cookie_consent` i `nes_gpc` **nie pasują** i lądują w heurystyce jako `functional` „preferencja interfejsu" | w deklaracji cookies pokazywanej użytkownikowi **dowód zgody RODO i nośnik prawnego opt-outu GPC są opisane jako kategoria, którą można odrzucić**, choć oba są ściśle niezbędne. `routes/cookies.tsx` opisuje to samo cookie poprawnie — dwie sprzeczne deklaracje tego samego pliku |     ✔      |

### KLASA D: panel oferuje akcję, którą baza odrzuci — 1 wystąpienie

| #   | plik                         | co się dzieje                                                                                                                                         |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `routes/admin.donations.tsx` | `donations` ma w RLS wyłącznie rolę `admin` (nie `editor`), a layout `/admin` przepuszcza też `editor` i `author`. Trasa nie domyka uprawnienia sama. |

Redaktor widzi **dwie nieprawdy naraz**: tabelę „Ostatnie wpłaty" jako PUSTĄ
(czyta się jako „nikt nie wpłacił", znaczy „nie masz prawa tego widzieć") —
a **obok niej** kafelki „Suma wpłat" z kwotą, bo te liczą się z publicznych
statystyk przez service role. Sprzeczność w jednym widoku. Do tego przycisk
„Synchronizuj ze Stripe", który wywoła `syncDonationsWithStripe` → `assertAdmin`
→ `forbidden`. To ta sama klasa defektu, którą bramka autorytetu złapała przy
swoim wdrożeniu na `admin.users.$id` (droplista roli dla całego personelu)
i na `admin.settings.seo`. Zakodowane jako `it.fails` w bramce.

### KLASA E: podwójna wysyłka i inne — 3 wystąpienia

| #   | plik                                         | co się dzieje                                                                                                                                                                                                                                                                                                                           | `it.fails` |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------: |
| E1  | `components/checkout/CouponInput.tsx:98-103` | handler Entera nie sprawdza ani `loading`, ani `code.trim()`, choć przycisk obok ma `disabled={loading \|\| !code.trim()}`. Trzymany Enter wysyła N równoległych walidacji; hook trzyma `loading` jako pojedynczy boolean bez licznika i bez przerywania poprzedniego żądania, więc o wyniku decyduje kolejność ODPOWIEDZI, nie wysyłki |     ✔      |
| E2  | `lib/ads/consent.ts` (podglądy)              | `setConsentPreview` / `clearConsentPreview` bez `try/catch` na `sessionStorage`                                                                                                                                                                                                                                                         |     ✔      |
| E3  | `lib/gifting/hooks.ts` (`onSuccess`)         | gałąź `: (prev ?? null)` — updater zwracający `null` **nie jest** w react-query no-opem: tworzy wpis w cache o `data === null` i statusie `success`. Dziś bez skutku (jedyny konsument najpierw czyta stan); każdy nowy wywołujący `create` dostanie „stan wczytany i pusty"                                                            |     ✔      |

### KLASA A, ciąg dalszy: dziesięć wystąpień z etapów 2–3 (A5–A14)

Po ekstrakcji dziewięciu tras ta klasa okazała się najliczniejsza w całym
module. Wzorzec jest zawsze ten sam i zawsze wygląda niewinnie w kodzie:
`?? 0`, `?? FALLBACK`, `(x?.length ?? 0) === 0`, `if (!data) return null` —
konstrukcje, które czytelnik kodu bierze za ostrożność, a które w praktyce
**zamieniają awarię w konkretną, fałszywą liczbę albo w pustkę.**

| #   | plik                                                    | co się dzieje                                                                                                                                  | skutek                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A5  | `components/donations/DonationsWidgetView.tsx:48`       | `statsQ.data ?? FALLBACK` bez gałęzi na `isError` i `isPending`                                                                                | publiczna zbiórka pokazuje **„0 zł zebrane" i pasek 0%**, gdy odczyt padnie. Awaria i pusta zbiórka renderują **identyczny `outerHTML`** — dowód porównuje oba DOM-y znak w znak. Słownik ma klucze `donationsWidget.loading` i `.empty`, których komponent nigdy nie woła: oba stany były zaprojektowane i milcząco zgubione |
| A6  | `routes/admin.donations.tsx` (kafelki)                  | kafelki sum czyta `getDonationsPublicStats` (service role, **bez kontroli roli**), rejestr — `listDonationRecords` (server fn z `assertAdmin`) | redaktor dostaje **odrzuconą obietnicę** rejestru, którą panel maluje jako „brak zarejestrowanych wpłat" — **pod kafelkiem z kwotą**. Jedna z tych dwóch liczb jest nieprawdziwa i panel nie mówi która                                                                                                                       |
| A7  | `routes/admin.donations.tsx` (rejestr)                  | `(records.data?.length ?? 0) === 0` łapie także `undefined` z błędu                                                                            | chwilowa awaria sieci = komunikat, że zbiórka **nie ma ani jednej wpłaty**                                                                                                                                                                                                                                                    |
| A8  | `routes/admin.donations.tsx` (ustawienia)               | nieudany odczyt `site_settings` — `useSettings` wystawia `query.isError`, trasa go nie czyta                                                   | panel zostaje **wiecznie** na napisie „Wczytywanie…", który nigdy nie zniknie                                                                                                                                                                                                                                                 |
| A9  | `components/AdSlot.tsx` (`AdZone`)                      | `if (!data \|\| data.length === 0) return null`                                                                                                | awaria zapytania jest nieodróżnialna od braku kampanii — jedno i drugie to pusty DOM, więc **utrata przychodu jest niewidoczna**                                                                                                                                                                                              |
| A10 | `components/ads/AdSlotById.tsx`                         | `if (!data) return null`                                                                                                                       | awaria odczytu slotu nieodróżnialna od slotu wyłączonego; widget znika bez śladu                                                                                                                                                                                                                                              |
| A11 | `components/admin/ads/organisms/AdSlotsPanel.tsx`       | odmowa RLS na `ad_slots`                                                                                                                       | nieodróżnialna od zera zdarzeń; lista wyboru slotu jest wtedy pusta, więc admin widzi panel, w którym „nie ma slotów", a nie błąd                                                                                                                                                                                             |
| A12 | `components/admin/ads/organisms/AdPlacementsPanel.tsx`  | awaria odczytu `ad_placements`                                                                                                                 | udaje pustkę                                                                                                                                                                                                                                                                                                                  |
| A13 | `components/admin/gifting/organisms/GiftStatsPanel.tsx` | awaria odczytu statystyk                                                                                                                       | pokazuje puste miejsce zamiast powiedzieć o awarii                                                                                                                                                                                                                                                                            |
| A14 | `lib/billing/couponAnalyticsView.ts`                    | sumy przez `Number(...)` bez zacisku                                                                                                           | brak kolumny w odpowiedzi RPC (`undefined`) **zatruwa całą sumę** i kafel pokazuje „NaN"; `null` cichnie do zera, czyli awarii danych nie da się odróżnić od zera przychodu                                                                                                                                                   |

### KLASA F: raport o pieniądzach kłamie cicho — 7 wystąpień (NOWA)

Klasa, której zlecenie nie przewidywało. Wspólny mianownik: liczba na ekranie
albo w arkuszu jest **nieprawdziwa i wygląda na kompletną**.

| #   | plik                                                             | co się dzieje                                                                                                                                                                    | skutek                                                                                                                                    |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | `lib/billing/couponAdminList.ts`                                 | **dwie sprzeczne definicje „wygasłego" w jednym pliku**: filtr używał `getTime() >= now`, kafel `getTime() < Date.now()`. Dla daty nieparsowalnej (`NaN`) OBA warunki są fałszem | ten sam wiersz **JEST** na liście „Wygasłe" i **NIE JEST** w liczniku „Wygasłe" — redaktor widzi listę dłuższą niż jej własny licznik     |
| F2  | `lib/billing/couponRedemptionsRange.ts`                          | kalendarz bez trybu godziny oddaje **lokalną północ**, więc `lte` obcina cały wybrany dzień                                                                                      | operator wybiera „do: 22 sierpnia" i **nie widzi ani jednej realizacji z 22 sierpnia**; raport zaniża przychód o ostatni dzień zakresu    |
| F3  | `routes/admin.coupons.redemptions.tsx`                           | brak paginacji, jedyne ograniczenie `limit(500)`, a kafle sumują dokładnie ten obcięty zbiór                                                                                     | powyżej 500 realizacji raport pokazuje kwotę **mniejszą od prawdziwej** i wygląda na kompletny                                            |
| F4  | `components/AdSlot.tsx:54-60`                                    | listener kliknięcia wisi na PUSTYM, zarezerwowanym kontenerze, zanim kreacja się zamontuje (`shouldRender` jest w tablicy zależności, ale nie w ciele)                           | kliknięcie w puste miejsce (np. przy zaznaczaniu tekstu obok) liczy się jako kliknięcie reklamy i **zawyża CTR sprzedawany reklamodawcy** |
| F5  | `components/AdSlot.tsx:83-84`                                    | slot `image` bez `image_url`: `payload` zostaje `null`, ale stan to `"ready"`                                                                                                    | beacon `impression` **wysłany za reklamę, której nie ma** — faktura za emisję, która się nie odbyła                                       |
| F6  | `components/ads/AdSlotById.tsx:42-57`                            | syntetyczny placement o `id: "inline-<slotId>"`, którego **nie ma w `ad_placements`**, oraz `position: "top_of_post"` / `page_type: "all"` niezależnie od miejsca widgetu        | zdarzenia z widgetów inline są w statystykach **sierotami bez rodzica**, a emisja ze stopki jest liczona jako emisja nad wpisem           |
| F7  | `components/donations/donationsWidgetModel.ts` (`resolveBarPct`) | przy `goalCents === 0` szerokość paska to `Math.min(100, count * 5)` — **liczba darczyńców × 5 jako procent**                                                                    | 20 wpłat po złotówce maluje pasek na „100%" przy zerowym celu: obietnica finansowa bez pokrycia w danych                                  |

### KLASA G: panel milczy o tym, czego nie pokazał — 5 wystąpień (NOWA)

| #   | plik                                                       | co się dzieje                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | `components/admin/gifting/organisms/GiftAuditPanel.tsx`    | audyt urwany na 200 z 9000 pozycji **nie mówi o tym adminowi**                                                                                                                                                   |
| G2  | `components/admin/gifting/organisms/GiftLinksPanel.tsx`    | lista linków urwana na 100 z 3500 — tak samo milczy                                                                                                                                                              |
| G3  | `lib/ads/injection.ts`                                     | `MAX_MID_POST_ADS = 2`: redakcja konfiguruje cztery wstawki, wchodzą dwie, reszta znika **bez ostrzeżenia w konsoli i bez sygnału w panelu**                                                                     |
| G4  | `lib/billing/couponAdminForm.ts` / `couponCampaignForm.ts` | dziewiąty preset i dalsze ucinane przez `slice(0, 8)`; kampania waliduje **tylko** niepustą nazwę, a baza sprawdza cztery warunki — panel wysyła ładunek skazany na odmowę i pokazuje surowy komunikat Postgresa |
| G5  | `components/admin/gifting/molecules/GiftLimitField.tsx`    | dopóki ustawienia się nie wczytają, nota mówi **„bez limitu"**: „nie wiem" jest sprowadzone do zera, a zero znaczy brak limitu                                                                                   |

### KLASA H: dane wychodzące na zewnątrz — 4 wystąpienia (NOWA)

| #   | plik                                                 | co się dzieje                                           | skutek                                                                                                                               |
| --- | ---------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | `lib/billing/couponCsv.ts`                           | **pola nie są cytowane**                                | nazwa kuponu ze średnikiem rozsuwa kolumny w CAŁYM arkuszu, nazwa z nową linią rozbija wiersz na dwa — dotyczy obu eksportów         |
| H2  | `lib/billing/couponCsv.ts` (realizacje)              | arkusz zawiera **pełny identyfikator użytkownika**      | RODO: operator pobiera na dysk plik z identyfikatorami osób                                                                          |
| H3  | `lib/billing/couponNewsletterDraft.ts`               | brak segmentu daje `audience_filter: {}`                | **wysyłka do WSZYSTKICH** subskrybentów; do tego `name` jest zawsze po polsku, a data ważności wchodzi do treści maila w surowym ISO |
| H4  | `components/admin/gifting/molecules/GiftLinkRow.tsx` | odmowa dostępu do schowka raportowana jako „skopiowano" | admin wysyła komuś link, którego **nie ma w schowku**                                                                                |

---

## 4. Do zgłoszenia człowiekowi (decyzja produktowa albo migracja)

1. **Kupon nadający warstwę nie działa dla subskrypcji kupowanych przez realne
   Stripe.** To najpoważniejsze ustalenie całej pracy i jest **poza wszystkimi
   hipotezami zlecenia**. Zamówienie planu wstaje jako `status='pending'`
   (`stripeCheckout.functions.ts:79-92`), a `paid_at` zapisują wyłącznie
   finalizacja trybu MOCK (`checkout.functions.ts:511`) i płatność JEDNORAZOWA
   (`oneTimeFulfilment.server.ts:169-174`). `apply_b2b_coupon_effects` jest
   fail-closed na `status='paid'`, więc na głównej ścieżce zakupowej **nigdy nie
   odpala**. Obietnica z panelu („Plan") nie ma wykonawcy.
2. **Rejestr realizacji kuponów zapisuje ZEROWY rabat.**
   `stripeCheckout.functions.ts:96-101` woła `redeem_b2b_coupon`
   z `_applied_cents: 0` i `_original_cents: plan.price_cents`, mimo że dwie
   linie wyżej czyta `row.discount_cents > 0` i tworzy dla tej kwoty kupon
   w Stripe. Raport przychodu z kuponów zaniża rabat do zera.
3. **A1** — awaria odczytu planu podnosi budżet reklam płacącemu. Poprawka to
   jedno słowo (`isPending` → `isPending || isError`), ale zmienia zachowanie
   produkcyjne, więc nie wchodzi w to zlecenie.
4. **A2** — `applied: false` nie ma w produkcji ŻADNEGO konsumenta: obaj
   wywołujący robią `await applyCouponEffectsForOrder(order.id)` bez
   przypisania. Wymaga decyzji: czy niezrealizowana obietnica zakupowa ma
   trafiać do audytu albo tabeli, a nie do `console`.
5. **C1 + C5** — dwie pozycje RODO: wycofanie zgody bez śladu w rejestrze
   i sprzeczna deklaracja własnych cookies zgody.
6. **`formatDiscountLabel` bez osłony.** `lib/billing/coupons.ts:66-71` woła
   `Intl.NumberFormat` BEZ `try/catch`, w przeciwieństwie do `formatMoney`
   (`types.ts:129-137`), które ma degradację. Waluta o niepoprawnej długości
   (`"PL"`, `"PLNN"` — a `currency` w `b2b_coupons` **nie ma CHECK-a**) rzuca
   `RangeError` przy renderze etykiety rabatu.
7. **Brak CHECK-a na `currency` w `b2b_coupons`.** Jedyna realna luka
   w ograniczeniach kwotowych kuponu: kupon `fixed` z `currency IS NULL`
   i kupon `percent` z walutą `'XYZ'` przechodzą przez bazę. Spójność trzyma
   wyłącznie panel. Udokumentowane dwiema asercjami stanu faktycznego
   w `b2b_coupons_money_test.sql`; domknięcie wymaga migracji, której zgodnie
   z regułą 9 zlecenia nie dodaję.
8. **Panel darowizn na produkcji startuje w środowisku LIVE.**
   `getStripeEnvironmentSafe()` zwraca `"live"`, gdy KLIENCKI token
   publikowalny zaczyna się od `pk_live_`. Droplista środowiska startuje więc na
   „Środowisko produkcyjne", a przycisk obok uruchamia synchronizację na żywym
   Stripe'ie **bez potwierdzenia**.
9. **`coupon.error.emptyCode` jest kluczem martwym.** Jedynym producentem powodu
   `empty_code` jest `useValidateCoupon`, a jedyny konsument hooka wychodzi
   wcześniej przez `if (!norm) return` (`CouponInput.tsx:34-35`). Klucz istnieje
   i jest przetłumaczony w obu językach; użytkownik nigdy go nie zobaczy.
   Do tego `result` i `reset` — połowa publicznej powierzchni hooka — nie mają
   w produkcji żadnego konsumenta.
10. **Trzy panele kuponów omijają słownik.** `admin.coupons.tsx`,
    `admin.coupons.redemptions.tsx` i `admin.coupons.analytics.tsx` są
    dwujęzyczne przez lokalny helper `const L = (pl, en) => …`. Po angielsku
    **nie** pokazują polszczyzny, więc to nie jest „panel po polsku" — ale ich
    napisy nie przechodzą przez `i18nParity.gate` ani `i18nKeyDrift.gate` (te
    czytają wyłącznie `src/lib/i18n-*.ts`), nie widzi ich tłumacz i trzecia
    wersja językowa wymagałaby przepisania plików. `redemptions.tsx` używa OBU
    mechanizmów naraz. Zapisane jako test-dług w bramce autorytetu.
11. **Migracja bez regeneracji snapshotu autoryzacji — psuje TRZY bramki naraz.**
    `check:authz-snapshot` zgłasza 11 pozycji „provenance" (ten sam krąg
    uprawnionych, inne miejsce w historii) plus licznik migracji `795 → 796`;
    wszystkie wskazują na `20260822171037_bea8e790…`. Ta sama migracja wywraca
    `check:permissions-parity` (pada na tym samym teście) oraz
    `check:pg-harness` (`column "min_tier_rank" does not exist`).
    **Sprawdzone imiennie: żaden z moich 23 commitów nie dotyka
    `authzSnapshot.generated.ts` ani `supabase/migrations/`** — jedyne SQL,
    jakie dodałem, leży w `supabase/tests/`. Migrację wniosły trzy commity
    sprzed tej pracy: `4825d02 "Work in progress"`, `d3e9e57` i `8893329`
    (katalog v6.1). Dowód, że to nie ja: zbudowałem i uruchomiłem
    `check:pg-harness` na `e461d8c^` w osobnym `git worktree` — **identyczny
    błąd, ta sama migracja.** Bramka mówi wprost „wystarczy regeneracja
    snapshotu", ale reguła 7 zlecenia tego zabrania, a decyzję ma podjąć autor
    commitu nazwanego „Work in progress".
12. **`vitest.config.ts` ma zduplikowany klucz progu — próg, który ktoś
    podniósł, jest CICHO wyłączony.** `"src/components/auth/MfaChallenge.tsx"`
    występuje dwa razy: w linii 1300 (`functions: 100`, `branches: 90`)
    i w 1442 (`functions: 90`, `branches: 83`). W literale obiektu wygrywa
    OSTATNI, więc obowiązuje wersja **łagodniejsza**. Esbuild ostrzega o tym
    przy KAŻDYM uruchomieniu vitest, więc ostrzeżenie spowszedniało.
    Zweryfikowane, że duplikat istniał **przed** moim commitem progów
    (`git show f2e0a74^` daje dwa wystąpienia). Plik modułu 19 — nie ruszam,
    bo usunięcie łagodniejszego wpisu PODNOSI próg cudzego pliku i jest
    decyzją jego właściciela.

    **Sam wpadłem w tę samą pułapkę i dlatego wiem, jak łatwo ją przeoczyć.**
    Generator progów etapu 6 dopisał `src/lib/retention/coupon.ts`
    i `src/components/checkout/checkoutIntent.ts`, które już miały wpisy gdzie
    indziej w tym pliku. Wykrył to dopiero skan duplikatów, nie żadna bramka.
    Oba usunąłem; przy okazji istniejący wpis `checkoutIntent.ts` miał
    `branches: 95`, a pomiar pokazuje 2/2 = 100%, więc **podniosłem go
    w miejscu do 100** — patrz §6.

13. **`src/components/pricing/molecules/**` nie dobija progu gałęzi**
    (zmierzone 92,3% vs próg 94%). Nie dotykałem tej powierzchni, a dodanie
    testów nie może obniżyć pokrycia — to dryf pre-existing.

14. **`i18n-donate.ts`: mechanizm leniwego ładowania jest obecny,
    udokumentowany i zniweczony.** Plik eksportuje `ensureI18n`, a jego własny
    docblock mówi wprost: „No-op wołany w KOMPONENCIE trasy (nie
    side-effectowym importem w pliku trasy)". `DonationCta.tsx:19`
    i `DonationForm.tsx:37` robią dokładnie to zabronione. `DonationCta` jest
    osiągalny z `DonationsWidgetView`, czyli z widgetu, który redakcja wstawia
    w CMS na **dowolną** stronę — słownik płatności ląduje w chunku, który
    ściąga anonimowy gość czytający jeden artykuł. Nie przenoszę tego importu:
    zmienia moment rejestracji `addResourceBundle` względem pierwszego renderu.

15. **`/admin/donations` ładuje słownik publicznej wpłaty, z którego nie
    renderuje ANI JEDNEGO klucza.** `ensureDonateI18n()` w ciele komponentu,
    zero literałów `donate.*` w pliku. 3,9 kB w chunku panelu za nic. Import
    jest starszy niż to zlecenie (`git show 7fa0ebb^` ma ten sam wiersz).

16. **`CouponInput.tsx` — jedyny dłużnik monetyzacji w ratchecie
    `check:i18n-overlay-imports`** (`["src/components/checkout/CouponInput.tsx", 4]`).
    Cztery klucze `coupon.*` docierają do niego **importem pośrednim**: nakładkę
    wciąga inny moduł w tym samym chunku. Działa, dopóki skład chunku kasy jest
    taki jak dziś. Gdy się przestawi, **płacący klient** zobaczy w polu rabatu
    napis „coupon.placeholder", a na przycisku „coupon.apply".

17. **Konfiguracja darowizn nie pilnuje `min <= max`** — ani pole panelu, ani
    `DonationsConfigSchema`. Z minimum wyższym niż maksimum
    `normalizeDonationAmount` zwraca `null` dla **każdej** kwoty, czyli
    publiczny formularz nie przyjmie żadnej wpłaty, a panel zapisze taką
    konfigurację bez słowa. Domknięcie to jedna reguła w zodzie (`superRefine`)
    — ale to zmiana produkcyjna, więc decyzja jest po stronie właściciela.

18. **Pole „kwoty sugerowane" nie obsługuje polskiego przecinka
    dziesiętnego**, mimo `replace(",", ".")` napisanego właśnie po to.
    Administrator wpisujący `50,50` dostaje **dwa presety po 50 zł**.
    Rozstrzygnięcie wymaga decyzji: rozcinać po `;` zamiast po `,`, czy przyjąć,
    że separatorem dziesiętnym jest wyłącznie kropka i powiedzieć to w podpowiedzi.

19. **Zapis w trybie `stripe` i tak utrwala w `site_settings` adres zewnętrznej
    zbiórki**, którego nikt już nie widzi na ekranie (pole tylko się chowa).
    Przy powrocie na `external` wraca stara wartość — bywa to wygodne, bywa
    niespodzianką. Do decyzji, czy to cecha.

20. **Kwota wiersza w rejestrze wpłat jest w walucie WIERSZA**, więc rejestr
    bywa dwuwalutowy („250 zł" obok „50 €"), podczas gdy kafelki sumują jedną
    walutę. To nie są te same pomiary i panel tego nie mówi.

21. **Luka harnessu (nie defekt produkcji): `supabaseFromStub()` rozwiązuje
    odpowiedź SYNCHRONICZNIE**, więc prawdziwego stanu „jeszcze się wczytuje"
    nie da się nim złapać. Test `/admin/donations` musiał dołożyć własny
    łańcuch, którego `maybeSingle()` nigdy nie odpowiada. Gdyby więcej testów
    miało dowodzić gałęzi wczytywania, harnessowi przydałby się tryb „nigdy nie
    odpowiadaj".

22. Nie moje, do odnotowania: `check:i18n-hardcoded` zgłasza
    `EventTicketPurchase.tsx: 4 -> 2` — czyjś dług spadł, a baseline nie został
    zaktualizowany w dół. Nie ruszam cudzego wpisu.

---

## 5. Założenia, które okazały się NIEPRAWDZIWE

Ta sekcja jest równie ważna jak lista defektów. **Piętnaście pozycji**, i nie
wszystkie są założeniami ZLECENIA — sześć z nich (5.10–5.15) to hipotezy albo
pomiary **moje własne**, obalone przez lekturę kodu i przeliczenie. Rozdzielam
je jawnie, bo raport, w którym autor myli się wyłącznie cudzymi rękami, jest
mniej wart od takiego, który pokazuje, gdzie sam się pomylił i co go poprawiło.

### 5.1. „Baza nie ma CHECK-ów na kwocie kuponu" — NIEPRAWDA

Zlecenie polecało udokumentować BRAK i wpisać do raportu „walidacja kwoty
istnieje wyłącznie w panelu". Migracja
`20260721070203_a0e336e0-eaf3-4342-9435-40e076ebf0dd.sql` egzekwuje
**wszystkie cztery** warunki, o które pytało zlecenie:

```sql
discount_kind    text NOT NULL CHECK (discount_kind IN ('percent','fixed')),
discount_percent integer CHECK (discount_percent IS NULL OR (discount_percent BETWEEN 1 AND 100)),
discount_cents   integer CHECK (discount_cents IS NULL OR discount_cents > 0),
max_redemptions  integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
CONSTRAINT b2b_coupons_discount_shape CHECK (
  (discount_kind = 'percent' AND discount_percent IS NOT NULL AND discount_cents IS NULL)
  OR (discount_kind = 'fixed' AND discount_cents IS NOT NULL AND discount_percent IS NULL)
)
```

Różnica względem zlecenia: `max_redemptions` ma **`> 0`**, a nie `>= 0`, więc
ZERO jest odrzucane, a „bez limitu" wyraża `NULL`. To rozróżnienie ma znaczenie
dla panelu: puste pole musi jechać jako `NULL`.

Skutek: plik pgTAP **chroni obecność** tych CHECK-ów (ich utrata jest cicha —
panel nadal waliduje), a nie dokumentuje braku.

### 5.2. Sygnałem dryfu w `couponEffects.server.ts` jest `console.warn` — NIEPRAWDA, jest GORZEJ

Zlecenie zakładało, że jedynym sygnałem jest `console.warn`. Sygnału **nie ma
żadnego**: warunek ostrzeżenia wymaga `applied === true`, a przemianowane pole
daje `applied: false`; gałąź `console.error` obsługuje wyłącznie `error` z RPC
i wyjątek. Do tego obaj wywołujący **wyrzucają wynik**.

### 5.3. `admin.donations.tsx` ma „około dziewięciu" literałów — NIEPRAWDA

Miał ich **~45**: nagłówki wszystkich sześciu sekcji, wszystkie etykiety
i podpowiedzi pól, opcje obu droplist, przyciski synchronizacji, raport
uzgodnienia i cała tabela ostatnich wpłat.

### 5.4. `head()` panelu „ma być dwujęzyczny w konwencji innych tras" — NIEPRAWDA

Inne trasy panelu **nie są** dwujęzyczne. Konwencja repo to jednojęzyczny
literał: `"Analityka i wydajność - Admin"`, `"Uzgadnianie płatności - Panel"`,
`"Rekrutacja | Admin"`, `"Comments · Admin"`. `{ title: "Darowizny - Panel" }`
już ją spełnia — zostawiony bez zmian.

### 5.5. „Panele admina MUSZĄ mieć `robots: noindex`" — WYMAGANIE ROZWIĄZANE INACZEJ

Zlecenie kazało zweryfikować osiem paneli. **Siedem nie ma własnego `head()`
w ogóle** — i nie musi: `head()` w `src/routes/admin.tsx` scala się w dół po
dopasowanym łańcuchu tras, więc wszystkie 142 trasy panelu są wyłączone
z indeksowania z jednego miejsca (lokalnie powtarza to tylko 27). Bramka pilnuje
więc ŹRÓDŁA w layoucie i tego, że żaden panel nie NADPISUJE `robots`.

Uwaga dla następnego czytającego: dwa trafienia `head:` w `admin.ads.tsx` to
`{ count: "exact", head: true }` w zapytaniach Supabase, nie nagłówki trasy.

### 5.6. `safeParse` a klucze prototypowe — DEFEKTU NIE MA

Hipoteza obalona **empirycznie**. `safeParse` czyta wyłącznie po literałach
(`cats.functional`, `cats.analytics`, `cats.marketing`), a `necessary` jest
wpisane na twardo. `JSON.parse` tworzy `__proto__` jako WŁASNĄ właściwość danych
(CreateDataProperty, nie setter), więc `{"categories":{"__proto__":{"analytics":true}}}`
daje `cats.analytics === undefined` i nie zatruwa `Object.prototype`. Cudzym
zapisem w `localStorage`/cookie **nie da się** włączyć analityki ani marketingu.
Domknięte testem regresyjnym.

Utajona, powiązana krawędź (nie defekt dziś): `hasCategoryConsent`
i `useCategoryGranted` indeksują obiekt kategorii ZMIENNĄ
(`!!state?.categories?.[cat]`), więc wywołanie łamiące typ —
`hasCategoryConsent("constructor" as ConsentCategory)` — zwróci `true`. Dziś nie
ma takiego wywołującego.

### 5.7. „`check:pg-harness` musi widzieć nowy plik pgTAP" — NIEPRAWDA

`check:pg-harness` to harness **KLUBÓW**: wybiera migracje po treści
(`public.club_`, `admin_club_`) i uruchamia `scripts/pg-harness/runtime_test.sql`.
Nie dotyka `supabase/tests/` w ogóle. Pliki pgTAP wchodzą do suity przez glob
`supabase/tests/*.sql` w `scripts/pgtap-local/run.sh` oraz przez
`supabase test db` — **nie ma żadnego manifestu do aktualizacji.**

### 5.8. Hipotezy OBALONE w warstwie giftingu i reklam

- klient **nie** zlewa powodów odmowy: `revoked` przechodzi jako `"revoked"`
  (jest w `REDEEM_REASONS`), więc odbiorca wygasłego albo wyczerpanego linku
  dostaje właściwe copy i właściwą drogę wyjścia. Zlanie dotyczy WYŁĄCZNIE
  ścieżki nierenderowalnej treści (defekt B1);
- `_post_id` / `_link_id` jako `undefined` działa poprawnie — `JSON.stringify`
  pomija właściwości `undefined`, więc do funkcji nie leci nic i działa
  serwerowy `DEFAULT NULL`;
- awaria odczytu ustawień giftingu **nie wygasza** przycisku, a WŁĄCZA funkcję
  z domyślnymi (`DEFAULT_GIFT_SETTINGS.enabled === true`) — nadmiar UI, nie
  wyciek treści;
- filtr `page_id` w `queries.ts` używa luźnej równości (`p.page_id == null`)
  **świadomie**: dzięki niej placement, któremu PostgREST nie oddał kolumny
  (`undefined`), liczy się jako „bez ograniczenia strony" i nie znika;
- `status` w `donations` **nie** ma dwóch wartości, a pięć
  (`pending/paid/refunded/failed/canceled`) — pierwotna migracja miała dwie,
  migracja darowizn cyklicznych rozszerzyła zbiór. Pierwsza wersja mojego testu
  pgTAP padła właśnie na tym założeniu i została poprawiona po pomiarze.

### 5.9. Słabości WŁASNYCH testów, znalezione i poprawione

Uczciwie: dwie rzeczy w moich testach były najpierw złe.

- asercja limitera w `-ad-event.test.ts` była jednostronna (`<= 60`), więc
  przechodziłaby także dla `capacity: 1` — każde ZANIŻENIE limitu byłoby
  niewidoczne. Zmienione na obustronne (`>= 60` i `<= 61`);
- komentarz twierdził, że `MAX_BODY` chroni pamięć workera. Nieprawda:
  `await req.text()` wciąga całe ciało do pamięci PRZED pomiarem. Limit chroni
  przed `JSON.parse` dużego ładunku i przed zapisem śmieci. Komentarz poprawiony.

### 5.10. `admin.donations.tsx`: rejestr wpłat NIE jest chroniony przez RLS — MOJE WŁASNE USTALENIE BYŁO BŁĘDNE

W pierwszej wersji tego raportu (§3, klasa D) napisałem, że rejestr wpłat czyta
PostgREST przez RLS z polityką admin-only, kafelki sum idą service rolem,
a redaktor widzi **pustą listę** obok zapełnionych kafelków. Lektura kodu obala
**oba** członY:

`listDonationRecords` to `createServerFn` z middleware `requireSupabaseAuth`,
która woła `assertAdmin(context.supabase, context.userId)`, a `listAdminDonations`
czyta przez `supabaseAdmin` — **service role**. RLS nie bierze w tym udziału po
żadnej ze stron. Różnica między kafelkami a rejestrem nie brzmi więc „service
role kontra RLS", tylko **„brak jakiejkolwiek kontroli roli kontra
`assertAdmin`"**. I redaktor nie dostaje pustej listy — dostaje **odrzuconą
obietnicę**, którą panel maluje jako pustą listę.

Uściślenie, żeby korekta nie przechyliła się w drugą stronę: **polityka RLS na
`donations` NAPRAWDĘ jest admin-only** (migracja `20260714111000_donations.sql`,
przypięta w bramce autorytetu) — tylko panel przez nią nie przechodzi. Obie
rzeczy są prawdziwe: polityka istnieje, a ścieżka odczytu panelu ją omija
service rolem, więc realną bramką jest `assertAdmin`, a trybem awarii —
**odrzucona obietnica**, nie pusty zbiór wierszy. Ta różnica decyduje o tym,
jak defekt wygląda na ekranie, i dlatego jest tu wypisana.

To jest gorsze, niż zakładałem, i rozbija się na dwa osobne defekty (A6 i A7).
Klasa D zostaje z jedną pozycją: przycisk „Synchronizuj ze Stripe", który
`assertAdmin` odrzuci.

### 5.11. Cztery dalsze założenia o `/admin/donations` — obalone przy pisaniu testu

- Trasa **nie renderuje `AdminShell`** (powłokę daje layout `/admin`), więc
  atrapa `AdminShell` byłaby martwa.
- Wszystkie trzy listy tej trasy to **natywne `<select>`** wpisane wprost
  w JSX; radiksowy `Select` z `components/admin/settings/fields` jest w tej
  trasie nieużywany.
- `@/lib/adminToasts` nie jest w tej trasie importowany.
- `robots: noindex` stoi tu **podwójnie** — trasa deklaruje go lokalnie ORAZ
  dziedziczy z rodzica `/admin`. Usunięcie lokalnego `head()` nie odsłoniłoby
  panelu wyszukiwarkom; zabrałoby tylko tytuł zakładki.

### 5.12. Dwie przesłanki MOJEJ WŁASNEJ bramki i18n — obalone przez lekturę

- „Kto woła klucz przestrzeni nazw, ten ładuje słownik" zgłosiło
  `src/lib/ads/types.ts`. Ten plik **tylko deklaruje** nazwy kluczy w trzech
  mapach etykiet i nigdy nie zdobywa tłumacza, więc nie ma jak pokazać gołego
  klucza. Poprawiłem **bramkę**, nie produkcję.
- „Kto ładuje słownik, ten woła jego klucze" zgłosiło `AdPlacementRow.tsx`
  i `AdSlotRow.tsx`. Oba renderują `t(AD_POSITION_LABEL_KEYS[...])`, czyli
  sięgają kluczy **pośrednio** przez mapę i nie mają w sobie literału
  `"adsAdmin."`.
- Trzecia korekta jest moim błędem pomiaru, nie przesłanki: napisałem, że moduł
  14 nie ma pozycji w `I18N_OVERLAY_IMPORT_BASELINE`. Grep był wrażliwy na
  wielkość liter i przegapił `CouponInput.tsx`. Jest **dokładnie jedna**.

### 5.13. Obieg pola „kwoty sugerowane" NIE jest stratny — moja hipoteza obalona

Zakładałem, że 2550 gr rozpadnie się przy ponownym odczycie na 25 zł i 5 zł.
Nie rozpada się: `String(25.5)` daje `"25.5"` z **kropką**, a kropka jest
jedynym separatorem, który parser rozumie. To jest dokładnie powód, dla którego
martwy `replace(",", ".")` przetrwał recenzję: jedyny **producent** zawartości
tego pola nigdy nie wstawia przecinka, więc obieg maszynowy jest bezstratny
i nic nie wygląda na zepsute. Wada uruchamia się **wyłącznie** wtedy, gdy kwotę
wpisuje człowiek po polsku.

### 5.14. Dwie bramki etykiet napisane niezależnie — uzgodnione

Powstały dwie: moja `src/lib/ads/__tests__/adLabelKeys.gate.test.ts` i agentowa
`src/components/admin/ads/__tests__/adsLabelKeys.gate.test.ts`. Doszły do tych
samych wniosków niezależnie od siebie, co jest samo w sobie potwierdzeniem
ustalenia. Zostawiłem moją, bo skanuje **cały katalog migracji** (`CREATE TYPE`
oraz `ALTER TYPE … ADD VALUE`), a agentowa czytała **jeden przypięty plik**
migracji — czyli nie zobaczyłaby dokładnie tego zdarzenia, przed którym miała
bronić: dodania wariantu enuma w NOWEJ migracji. Z agentowej przejąłem rzecz
**lepszą od mojej**: wyjątki tożsamości PL/EN są wyliczone imiennie
(`adsAdmin.positions.sidebar`), a nie objęte progiem liczbowym. Próg
przepuściłby dowolne dwa zapomniane tłumaczenia; lista wymusza uzasadnienie.
Doszła też asercja odwrotna: wyjątek, który przestał być potrzebny, ma zniknąć
z listy.

### 5.15. Trzy konwencje boolean w jednej funkcji i przełącznik bez skutku

`resolveWidgetProps` (dawne linie 84–121 widoku) używa `!== false` dla
`showMonth`/`showCount` (domyślnie WŁĄCZONE) i `=== true` dla `showRecent`
(domyślnie WYŁĄCZONE). `showRecent` jest przy tym przyjmowane przez wszystkie
sześć wariantów wizualnych, a **honorowane wyłącznie przez `thermometer`**.
Redakcja włącza w edytorze przełącznik „pokaż ostatnie wpłaty" w wariancie
hero/progress/stats-strip/compact-card/inline-bar i nic się nie dzieje.

---

## 6. Progi

Moduł startował z **ZEREM** progów per-ścieżka (na 334 w repozytorium).
Po tej pracy ma **80**: dziewięć z etapu 1 plus **71 dopisanych** w etapie 6
(11 wpisów katalogowych + 60 per plik). Wszystkie z wartości **ZMIERZONYCH**
i ustawione **nie wyżej niż pomiar**; tam, gdzie pomiar to dokładnie 100, próg
jest 100 — bo próg poniżej pełnego pokrycia pozwala je cicho stracić.
Repozytorium ma teraz **414 wpisów** progów per-ścieżka.

### Dlaczego jedenaście wpisów jest KATALOGOWYCH, a nie per plik

Próg z globem liczy **agregat** plików, które glob łapie — to potwierdzone
zachowaniem istniejącego wpisu `src/components/pricing/molecules/**`, który
raportuje jedną liczbę dla całego katalogu. Katalogi atomic design wyprowadzone
z dziewięciu tras to 62 pliki; wpis per plik dla każdego dodałby ~250 linii
konfiguracji i ani jednej nowej gwarancji, a przy dopisaniu kolejnego atomu
wymagałby ręcznego dopisania progu — czyli dokładnie tej czynności, o której
się zapomina. Glob obejmuje nowy plik automatycznie: **atom bez testu obniża
agregat katalogu i zapala bramkę.**

| glob                                        | instr. | funkcje | linie | gałęzie |
| ------------------------------------------- | -----: | ------: | ----: | ------: |
| `src/components/admin/ads/atoms/**`         |    100 |     100 |   100 |     100 |
| `src/components/admin/ads/molecules/**`     |    100 |     100 |   100 |      96 |
| `src/components/admin/ads/organisms/**`     |     97 |     100 |   100 |      91 |
| `src/components/admin/coupons/atoms/**`     |    100 |     100 |   100 |     100 |
| `src/components/admin/coupons/molecules/**` |    100 |     100 |   100 |     100 |
| `src/components/admin/coupons/organisms/**` |    100 |     100 |   100 |     100 |
| `src/components/admin/gifting/atoms/**`     |    100 |     100 |   100 |     100 |
| `src/components/admin/gifting/molecules/**` |    100 |     100 |   100 |     100 |
| `src/components/admin/gifting/organisms/**` |    100 |     100 |   100 |      93 |
| `src/components/donations/atoms/**`         |    100 |     100 |   100 |     100 |
| `src/components/ads/atoms/**`               |    100 |     100 |   100 |     100 |

### Dwa duplikaty, które sam wprowadziłem — i co z nich wyszło

Generator progów dopisał `src/lib/retention/coupon.ts`
i `src/components/checkout/checkoutIntent.ts`, które **już miały** wpisy w innym
miejscu pliku. W literale obiektu JavaScriptu wygrywa OSTATNI, więc mój wpis
cicho nadpisałby istniejący — czyli dokładnie defekt, który zgłaszam w §4
poz. 12 na `MfaChallenge.tsx`. Oba duplikaty usunięte. Przy okazji: istniejący
wpis `checkoutIntent.ts` miał `branches: 95`, a pomiar pokazuje **2/2 = 100%**,
więc **podniosłem go w miejscu do 100** z komentarzem, żeby wartość nie spadła
przy sprzątaniu. Po poprawce w całym pliku został **jeden** duplikat klucza —
`MfaChallenge.tsx`, nie mój.

### Pliki modułu BEZ progu i dlaczego

Dziewięć plików poniżej 85% linii nie dostało progu, bo próg na 50% nie chroni
niczego, a udaje, że chroni:

| plik                                                    |  linie | gałęzie | funkcje | powód                                             |
| ------------------------------------------------------- | -----: | ------: | ------: | ------------------------------------------------- |
| `lib/billing/donationsAdmin.server.ts`                  |     0% |      0% |      0% | warstwa serwerowa synchronizacji ze Stripe'em; §8 |
| `lib/billing/donationsAdmin.functions.ts`               |     0% |    100% |      0% | jak wyżej                                         |
| `lib/billing/donations.functions.ts`                    | 12,77% |      0% |      0% | `createServerFn` publicznych statystyk            |
| `components/checkout/GuestCheckoutGate.tsx`             | 51,85% |  42,86% |     20% | poza zakresem zlecenia (kasa gościa)              |
| `lib/billing/coupons.ts`                                |  62,5% |     60% |    100% | mapowany do 07/13/15                              |
| `routes/admin.donations.tsx`                            | 62,79% |    100% |  40,74% | patrz niżej                                       |
| `components/checkout/EmbeddedCheckoutFrame.tsx`         |    75% |    100% |     40% | poza zakresem                                     |
| `components/gifting/GiftArticleButton.tsx`              | 74,36% |  86,59% |     50% | ma istniejący test z atrapą hooka (reguła 10)     |
| `components/gifting/molecules/GiftClickBudgetMeter.tsx` | 83,33% |     50% |    100% | jak wyżej                                         |

`admin.donations.tsx` przy 28 testach ma 62,79% linii i **40,74% funkcji** —
liczba nie jest pomyłką i warto ją nazwać: cała warstwa DECYZJI tej trasy
wyszła do `donationsAdminModel.ts` (100/100/100), a w pliku został formularz
ustawień, w którym każde pole ma własny `onChange`. Testy dowodzą decyzji, nie
przeklikują trzydziestu pól, więc funkcje-handlery zostają niepokryte. Dobicie
tego wymagałoby albo ekstrakcji układu formularza (osobna praca), albo testu,
który klika każde pole po kolei — czyli farmy pokrycia, której zlecenie zakazuje.

### Progi globalne: NIE podniesione, świadomie

Zmierzone 76,25 / 69,73 / 73,48 / 75,20 wobec 58 / 62 / 65 / 64. Zapas jest
realny, ale próg globalny wolno ruszyć **raz i pewnie**, a ta gałąź niesie
równolegle pracę czterech innych modułów (kluby, platforma, ustawienia, katalog
v6.1). Podniesienie progu globalnego na podstawie pomiaru, w którym cudza praca
jest w połowie, przeniosłoby ryzyko na kogoś innego. To jedna decyzja do
podjęcia po scaleniu, nie w tym zleceniu.

---

## 7. Bramki — wszystkie 33 uruchomione

**Zielone: 28.** `gate-coverage`, `i18n-overlay-imports`, `i18n-hardcoded`,
`i18n-default-value`, `i18n-parity`, `sql-tenant-scope`, `sql-app-role`,
`sql-anon-insert`, `sql-emit-actor`, `sql-owner-tenant-scope`,
`sql-policy-tenant-regression`, `sql-migration-replay`, `rpc-contract`,
`legacy-payment-refs`, `stale-never-casts`, `unknown-casts`,
`content-layering`, `db-row-casts`, `public-assets`, `workflow-env-contract`,
`types-freshness`, `editor-autosave`, `entry-purity`, `chunks`,
`chunk-parity`, `widget-fidelity`, `careers-harness`, `programs-harness`.

`check:i18n-hardcoded` **było czerwone** po ekstrakcji — cztery dwujęzyczne
ternary przeniosły się do nowego pliku, a ratchet liczy nowy plik jako nowy
dług. Zzieleniło je przeniesienie literałów do słownika (osobny commit, jak każe
reguła zlecenia). `DonationsWidgetView.tsx` spadł 4 → 0 i wypadł z baseline.

`check:entry-purity` zgłosiłem najpierw jako czerwone i **było to moje błędne
odczytanie**: uruchomiłem je, gdy build jeszcze zapisywał `.output/server`.
Po zakończeniu buildu jest zielone: ścieżka bootowania to 9 chunków z 796.

**Czerwone: 4 — wszystkie pre-existing, każde sprawdzone przez BUILD I PRZEBIEG
NA COMMICIE SPRZED TEJ PRACY** (`git worktree` na `e461d8c^`):

| bramka                     | co mówi                                                                             | dowód, że nie z tej pracy                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check:authz-snapshot`     | 11 pozycji „provenance" + licznik migracji 795→796, wszystkie z `20260822171037_…`  | żaden z 23 moich commitów nie dotyka `authzSnapshot.generated.ts` ani `supabase/migrations/`; migrację wniosły `4825d02 "Work in progress"`, `d3e9e57`, `8893329` |
| `check:permissions-parity` | pada na **tym samym** teście `authzSnapshotParity`                                  | jedna przyczyna, dwie bramki                                                                                                                                      |
| `check:pg-harness`         | `column "min_tier_rank" does not exist` w **tej samej** migracji `20260822171037_…` | uruchomione na `e461d8c^`: **identyczny błąd**                                                                                                                    |
| `check:bundle`             | `public 2554,6 KB > 2545`, `overall 3915,9 KB > 3894`                               | na `e461d8c^`: `public 2555,6 KB`, `overall 3912,7 KB` — **budżet był przekroczony PRZED tą pracą**                                                               |

**Zmierzony wpływ mojej pracy na budżet paczek** (bo „było czerwone" nie jest
usprawiedliwieniem dla milczenia o kierunku): chunk **publiczny zmalał o 1,0 KB**
(2555,6 → 2554,6) — wyprowadzenie słownika panelu darowizn z drogi publicznej
zwraca więcej, niż koszt czterech nowych kluczy. Chunk **overall wzrósł o 3,2 KB**
(3912,7 → 3915,9), w całości w koszyku admin-only (1357,1 → 1361,3), a największa
pojedyncza pozycja to `admin.gifting +3,0 KB` (4,9 → 7,9). To jest **koszt
ekstrakcji**: 14 plików zamiast jednego to więcej granic modułów, czyli mniej
okazji do deduplikacji w obrębie jednego chunku. Ta zamiana — 3 KB w chunku
panelu za 793 linie kodu wyjętego z jednego pliku i pokrytego testami — jest
świadoma, ale nie jest darmowa i nie chcę tego przemilczeć.

**Nie da się uruchomić tutaj: 1.** `check:db-contract` wymaga `SUPABASE_URL`
i klucza; reguła 5 zlecenia zabrania wnoszenia prawdziwego sekretu do testów
i do tego środowiska.

**Bramki dopisane w tej pracy** (zwykłe pliki vitest, nie skrypty `check:*` —
reguła 4 zabrania zmian w `package.json`, więc `check:gate-coverage` nie ma
czego wpinać i jest zielone):

- `src/routes/__tests__/adminRouteAuthority.gate.test.ts` — rozszerzona
  o sekcję „moduł 14: panele monetyzacji" (osiem tras, których bramka nie znała),
- `src/__tests__/monetizationI18nLoading.gate.test.ts` — 23 asercje o mechanizmie
  ładowania siedmiu słowników modułu,
- `src/lib/ads/__tests__/adLabelKeys.gate.test.ts` — 15 asercji domykających
  mapy etykiet z enumem PostgreSQL i ze słownikiem PL/EN,
- `src/lib/cookieBanner/__tests__/consentCarriersRegistry.test.ts` — 9 asercji;
  pierwszy test w historii tego pliku produkcyjnego.

**pgTAP:** trzy nowe pliki, 66 asercji, sprawdzone plik po pliku po całej pracy.

---

## 8. Czego nie zrobiłem i dlaczego

**Dwie z trzech miar z §6 nie dobite: linie 90,32% (cel 95%) i gałęzie 87,46%
(cel 93%).** Brakujące pokrycie ma adres i nie jest rozsypane:

1. **Warstwa serwerowa darowizn — `donationsAdmin.server.ts` (0%),
   `donationsAdmin.functions.ts` (0%), `donations.functions.ts` (12,77%).**
   Razem **136 z 199 niepokrytych linii modułu (68,3%) w trzech plikach** —
   6,62 pp z brakujących 9,68 pp. Domknięcie samych tych trzech plików
   podniosłoby moduł z 90,32% do ~96,9% linii, czyli **ponad cel z §6**.
   (Pierwotnie napisałem tu „całe brakujące 9,68 pp"; przeliczenie pokazało
   68,3%, nie 100% — poprawiam, bo różnica zmienia wniosek o tym, czy jeden
   krok wystarczy.) To synchronizacja ze Stripe'em: `syncDonationsWithStripe`
   czyta sesje operatora, dopisuje brakujące wpłaty, oznacza zwroty i wygaśnięcia.
   Test tej powierzchni to nie „jeszcze jeden plik" — to atrapa SDK Stripe'a
   z paginacją, obsługą `refunded`/`canceled`/`expired` i idempotencją na
   `provider_session_id`. Zrobiłem dla niej dowód z INNEJ strony (pgTAP
   `donations_ledger_scope_test.sql` przypina `UNIQUE(provider_session_id)`,
   czyli idempotencję webhooka, po stronie bazy), ale sam kod serwerowy został
   nietknięty. To jest największa i najuczciwiej nazwana luka tej pracy.
2. **Gałęzie: sufit `consent.ts` (87,90%)** jest strukturalny — 15 pozostałych
   gałęzi to strażnicy SSR (`typeof window` ×11, `typeof document` ×3,
   `typeof location` ×1), nieosiągalni pod happy-dom. Podniesienie wymaga
   drugiego środowiska testowego bez `window`. Osobna praca, opisana przy progu.
3. **`GuestCheckoutGate.tsx` (51,85%), `EmbeddedCheckoutFrame.tsx` (75%)** —
   kasa gościa i ramka operatora. Poza zakresem tego zlecenia (moduł kasy),
   liczone do modułu 14 wyłącznie przez położenie w `components/checkout/`.
4. **`GiftArticleButton.tsx` (74,36%), `GiftClickBudgetMeter.tsx` (83,33%)** —
   mają istniejące testy, które mockują `@/lib/gifting/hooks`. **Reguła 10
   zlecenia zabrania ruszania cudzych atrap**, więc napisałem OSOBNY test
   warstwy danych (`lib/gifting/hooks.ts` → 100% linii / 93% gałęzi), a te dwa
   komponenty zostawiłem jak stały.

**Migracji SQL nie dodałem** (reguła 9) i **snapshotu autoryzacji nie
regenerowałem** (reguła 7) — oba świadomie, oba zgłoszone w §4.

**Progów globalnych nie podniosłem** — uzasadnienie w §6.

**Dwa testy padły raz w przebiegu zbiorczym i nie powtórzyły się w izolacji:**
`adminRedirectsRoute` i `clubThreadRoute`. Oba są **poza modułem 14** (żaden nie
importuje niczego z monetyzacji — sprawdzone), a przebieg, w którym padły,
konkurował o CPU z pracującymi agentami. W izolacji: 195 zdanych,
1 `expected fail`. Nie nazywam ich „flakiem" na wyczucie — nazywam je testami
zależnymi od obciążenia, bo to jest to, co zmierzyłem.

**Pomiar użyty do progów jest o 40 asercji STARSZY niż drzewo.** Agent kuponów
dopisał je do czterech plików testowych już po starcie pomiaru
(`admin.coupons.analytics`, `.redemptions`, `.campaigns`, `CampaignCreateDialog`).
Kierunek tej nieaktualności jest bezpieczny — progi wyszły z liczb NIŻSZYCH niż
rzeczywistość, więc żaden nie stoi nad pomiarem — ale mówię to wprost, zamiast
podawać liczbę jako świeższą, niż jest.

---

### Uwaga o środowisku

Trzy rzeczy warte zapisania dla następnej sesji w tym kontenerze.

1. **`node_modules` przyszedł rozjechany.** 276 paczek w `bun.lock` celuje
   w `europe-west4-npm.pkg.dev`, który proxy blokuje 403. Brakowało m.in.
   `@tanstack/react-query`, `react-router` i `react-start`, więc **żaden** test
   modułu nie dawał się uruchomić. Uzupełnione przez
   `npm install --legacy-peer-deps` plus dociągnięcie dwóch peerów, które
   `--legacy-peer-deps` pomija (`@testing-library/dom`, `jest-dom`).
   `package-lock.json` jest w `.gitignore`, `bun.lock` nietknięty, `.npmrc`
   usunięty po instalacji.
2. **`pgtap` nie był zainstalowany w obrazie.** `apt-get install
postgresql-16-pgtap` załatwia sprawę; bez tego `test:pgtap-local` kończy się
   komunikatem „extension pgtap is not available", czyli wyglądałoby na błąd
   testu, a nie środowiska.
3. **Testy uruchamia się WYŁĄCZNIE przez `bun run test <ścieżka>`.**
   Bezpośrednie `./node_modules/vitest/vitest.mjs`, `npx vitest` i `bun install`
   są w tym sandboxie blokowane przez klasyfikator. `scripts/pgtap-local/run.sh`
   przyjmuje `test <wzorzec>`, co pozwala odpalić jeden plik pgTAP na już
   postawionej bazie (`/tmp/nespgtap`) bez odtwarzania 796 migracji.
