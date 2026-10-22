# Pakiet kontekstu I9.2 – zgłoszenia do domknięcia (prompt §9.2)

Stan: gałąź robocza `claude/loving-einstein-caze7r` = `4b1aa96d3` (PR #530 + scalenie main). Głowa PR na origin: `75133fe2`.
Najwyższa migracja: `20261020161400_data_retention_panel.sql`; najwyższy bliźniak drizzle: `0372_data_retention_panel` (idx 372, `when` 1792477933912, kolejne +60000).
UWAGA kolejność: S7 (gałąź `hub/s7-zakladki-diagnostyka-c`) ma 3 migracje bloku 15 (`20261020150000`, `150050`, `150100`) bez bliźniaków – dostaną `0373…0375`; potem I9d. Migracje I9.2 – wersje po najwyższej `2026102016*` istniejącej w chwili startu (`ls supabase/migrations | grep ^2026102016 | tail`), bliźniaki od następnego wolnego numeru.

Źródła: prompt `docs/PROMPT_KONTYNUACJI_HUB_2026-10-20.md:616-633`; dziennik `docs/WDROZENIE_HUB_PRZYCHOD_LEJEK_2026-10.md` (§16.4-16.5 l.1411/1436, §18 l.1840-1842, §20.5 l.2329-2337, §21.7 l.2794-2800, I9c l.3682-3683, §21.21 l.3891-3896).

---

## 0. Pułapki wspólne dla wszystkich zgłoszeń (przeczytaj najpierw)

1. **Manifest I9 (`src/lib/ci/hubDelivery.ts:818-950`)** – każdy plik zmieniony w I9.2, którego nie ma w `HUB_SLICE_MANIFESTS.I9`, czerwieni `scripts/hub-slice-guard.ts I9`. Brakuje m.in.: `src/lib/billing/billingDocuments.server.ts` (+test), `src/routes/profile.organization.tsx`, `src/lib/i18n-membership.ts`, `src/routes/__tests__/profileOrganizationRoute.test.tsx`, `src/lib/crm/importMapping.ts`, `src/components/admin/crm/ImportLeadsCsvDialog.tsx` (+testy), `src/components/admin/newsletter/outbox/**`, `src/lib/i18n-admin-email-outbox.ts`, `src/lib/email/provider.server.ts`, `src/lib/journeys/{triggers,templates/**}.ts` (+testy), `supabase/tests/event_identity_consents_r12_test.sql`. Testy pgTAP I9.2: obecne globy to `hub_i9b_*`, `hub_i9c_*` – dodaj `supabase/tests/hub_i9_*_test.sql` albo nazywaj pliki zgodnie z istniejącym globem. Pliki S8 (`src/components/admin/journeys/**`) już są w manifeście I9.
2. **Bramka CIALO-Z dla redefinicji w I9 (`hubDelivery.ts:1323-1331, 1427-1465`)** – `HUB_I9_REDEFINITIONS` ma JEDNĄ wersję na funkcję i bramka wymaga `marker == rejestr` ORAZ `rejestr == najnowsza wcześniejsza definicja w hubie` (`hubLatest` liczone narastająco, l.1504). Funkcja innego wycinka redefiniowana w I9 DRUGI raz (np. `admin_journey_stats` – już w `20261020161200`, `journey_rollup_daily`, `journey_record_message_event`, `journey_contact_for_send`, `admin_journey_settings_*`) daje nieusuwalne `zly-cialo-z` (pierwsza redefinicja wymaga starej wersji, druga – nowej). Dla funkcji sprzed huba z `HUB_CIALO_Z` druga redefinicja musi nieść wersję sprzed huba (myląca). **Wymagana zmiana bramki** (I9 jest właścicielem `hubDelivery.ts`): rejestr = najnowsza definicja SPRZED bloku I9, a znacznik = `hubLatest` przed tym trafieniem; + fikstury w `src/lib/ci/__tests__/hubDelivery.gate.test.ts`. Sprawdź, czy I9d tego już nie zrobił.
3. **Nowe funkcje SQL**: wpis `FUNCTION_TABLE` (`hubDelivery.ts:102-313`, owner `I9`, rodzaj), `SECURITY DEFINER` + `SET search_path = public, pg_temp`, REVOKE/GRANT w tym samym pliku; funkcje `internal`/`trigger`/`service` muszą trafić na listę `hub-grants` w `supabase/tests/hub_shared_helpers_test.sql:80-133` (zgodność listy z rejestrem przypina `hubDelivery.gate.test.ts`).
4. **Nowe tabele**: `tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE`, RLS, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, GRANT jawny (wzór archiwum: `20261020161000_data_retention_core.sql:174-217`), `types.ts` (plik współdzielony I9), `check:types-freshness`.
5. **Harnessy**: migracja z literałem `public.contact_messages` wpada w selektor `scripts/careers-harness/run.sh:96`; jeśli sięga poza moduł (CRM, szyna) – osobna linia `-- careers-harness: exclude` (regex `^--\s*careers-harness:\s*exclude\s*$`, l.124) z uzasadnieniem (wzór `20261020160900:108`).
6. **Budżet `public`** zamrożony 2881; ostatni pomiar 2778,6 (§21.21 l.3968-3969) – zapas ≈102 KB. `overall` 5023 (5021,2) – ratchet wg pkt 4.5 promptu.
7. **i18n**: parytet PL/EN; prefiksy bramkowane w `src/__tests__/i18nParity.gate.test.ts:24-60` (m.in. `adminDataRetention`; `adminOutbox`, `membership` NIE są na liście – parytet i tak wymagany zasadą).

---

## Z-S2-07 – środowisko dokumentów i `subscription.renewed.v1`

**Opis** (dziennik l.1411-1415, 1436): przy INSERT do `billing_documents` ustawić `environment` i `subscription_id` (= `user_subscriptions.id` po `external_ref`). Dziś nowe dokumenty mają `environment NULL` → liczone w `unknown_environment_documents` i poza przychodem; wyzwalacz odnowienia nigdy nie strzela.

**Kod**
- `src/lib/billing/billingDocuments.server.ts` (460 l.): `TransactionDocumentInput` l.73-100 (`environment: StripeEnv` l.88 – już jest, `subscriptionId` = id subskrypcji operatora `sub_…`); `ownerFor` l.211-264; `recordTransactionDocument` l.305-418; INSERT l.385-400 – **brak `environment` i `subscription_id`**; gałąź UPDATE l.336-370 (`select("id, number, amount_cents, status, order_id")` l.329).
- Wołający: `src/lib/billing/webhookDispatch.server.ts:2237-2250` (`outcome === "failed"` → throw → 500 → Stripe ponawia; zapis idempotentny).
- Schemat: `billing_documents` (`20260723060905…:1-21`, `20260723151000:27-`): `subscription_id uuid REFERENCES public.user_subscriptions(id) ON DELETE SET NULL`, `order_id`, `kind CHECK IN ('invoice','receipt','credit_note')`, `status CHECK IN ('paid','open','void','refunded')`, `provider DEFAULT 'stripe'`, `UNIQUE (provider, provider_document_id)`. `environment text CHECK (environment IN ('sandbox','live'))` NULL-owalne (`20261020090000_hub_schema_revenue_ledger.sql:65-66`). `StripeEnv = "sandbox" | "live"` (`src/lib/stripe.server.ts:21`) – zgodne z CHECK.
- `user_subscriptions.external_ref` UNIQUE (`20261013100300`), kolumny `tenant_id`, `user_id` (types.ts ~23847); `external_ref` = `input.subscriptionId` (`webhookDispatch.server.ts:731`).
- Wyzwalacz `tg_billing_documents_renewed_emit` (`20261020110100_subscription_revenue_history.sql:444-490`): `AFTER INSERT OR UPDATE OF subscription_id, environment, status`; emituje, gdy `subscription_id NOT NULL AND order_id IS NULL AND kind='invoice' AND status='paid' AND environment='live' AND provider<>'mock'`; raz (OLD spełniający warunek → RETURN). Ładunek `{subscription_id, user_id, document_id}`, agregat `subscription` (= UPRAWNIENIE `user_subscriptions`, `domainEvents.ts:205-218`). Konsumenci: `eventInvalidationMap.ts:191`, `.admin.ts:91`, wyzwalacz ścieżek `src/lib/journeys/triggers.ts:198-203` (identity `user`).
- Diagnostyka: `admin_revenue_realized` (`20261020110400_revenue_aggregates.sql:18`, licznik l.765-769: `COALESCE(d.environment, o.environment) IS NULL`), TS `src/lib/revenue/finance/parse.ts:141,669`, i18n `i18n-admin-revenue-finance.ts:150,362` (`unknownEnvironment`).
- Backfill historyczny `20261020110200_revenue_backfill.sql:15-21,50-80` – środowisko z zamówienia albo przez `user_subscriptions.external_ref = subscriptions.provider_subscription_id`; bez powiązania zostaje NULL (celowo).

**Proponowana zmiana (TS, bez SQL)**
1. INSERT: `environment: input.environment`, `subscription_id: entitlementId` – tylko gdy `input.kind === "invoice" && input.subscriptionId`: `supabase.from("user_subscriptions").select("id").eq("external_ref", input.subscriptionId).eq("tenant_id", owner.tenantId).eq("user_id", owner.userId).maybeSingle()`. Błąd odczytu RZUCA (jak `ownerFor` – „nie wiem” ≠ „brak”) → `failed` → ponowienie webhooka; brak wiersza → `null`.
2. UPDATE: `environment` dopisz, gdy `existing.environment` NULL (bez emisji – stare dokumenty nie mają `subscription_id`). `subscription_id` dopisz WYŁĄCZNIE przy przejściu `existing.status !== 'paid'` → `paid` (faktura `open` opłacona później = prawdziwe odnowienie). **Nie** dopisuj do już opłaconych starych dokumentów – inaczej późne `invoice.updated` wyemituje spóźnione `subscription.renewed.v1` i zapisze kontakt na ścieżkę. Rozszerz `select` l.329 o `environment, subscription_id`.
3. Bez backfillu SQL `subscription_id` (ten sam powód – masowa emisja odnowień przez UPDATE OF subscription_id). Historyczne `unknown_environment_documents` zostają – opisać w runbooku.

**Testy** (`src/lib/billing/__tests__/billingDocuments.server.test.ts`, atrapa `supabaseFromStub` z `@/test/billing/fixtures`, wzór asercji `writtenRow("billing_documents","insert")` l.418-438): (a) insert niesie `environment` z wejścia (`sandbox`/`live`); (b) faktura subskrypcji → `subscription_id` = id uprawnienia tego najemcy i konta; (c) paragon / brak `subscriptionId` → `subscription_id: null` i brak zapytania do `user_subscriptions`; (d) uprawnienie innego najemcy nie jest wiązane; (e) awaria odczytu uprawnienia → `failed` bez zapisu; (f) UPDATE `open→paid` dopina `subscription_id`; już `paid` bez `subscription_id` – bez dopięcia; `environment` NULL uzupełniany. pgTAP wyzwalacza już jest: `supabase/tests/revenue_subscription_history_test.sql:350-398` (opcjonalnie: UPDATE OF environment na dokumencie bez subskrypcji = brak zdarzenia).

---

## Z-S5-01 – emiter `contact_message.submitted.v1` → szablon `pricing_enquiry_b2b`

**Opis** (§20.5 l.2332; SPEC P25 l.1234/1752 „odłożone po M3”; prompt §9.2 każe domknąć): szablon niedostępny, instalacja zwraca `template_unavailable`.

**Kod**
- Szablon `src/lib/journeys/templates/pricing_enquiry_b2b.ts:13-25`: `availability: { status: "unavailable", awaitedEvent: "contact_message.submitted.v1" }`, `settings.triggerEventType: "crm_lead.created.v1"`, `reentry: "never"`, cel `crm_lead.stage_changed.v1 {new_stage:"proposal"}`, bez maili (notify_staff + create_crm_task + wait 2d + if_else `crm_stage in [new]`).
- Odmowa instalacji `src/lib/journeys/journeys.functions.ts:270-279`; `isTemplateAvailable` `templates/index.ts:47-49`.
- Formularz: `submitContactMessage` `src/lib/contact.functions.ts:213-` – INSERT `contact_messages` l.347-376 (`tenant_id` z hosta, `source`, `form_id`, `form_name`, `form_type`…), potem RPC `crm_upsert_from_form` l.388-399. Dialog cennika `src/components/pricing/organisms/ContactSalesDialog.tsx:71-84`: `source: "pricing"`, `formId: "pricing-contact-sales"`.
- Wyzwalacz CRM `trg_contact_messages_to_lead` AFTER INSERT (`20260630053403:259`), ciało najnowsze `contact_messages_to_lead()` w `20261012180900_marketing_consent_unsubscribe_contact_crm_staff.sql:235-337` (`crm_upsert_lead(...)`).
- Szyna: `public.emit_domain_event(p_tenant_id, p_aggregate_type, p_aggregate_id, p_event_type, p_payload, p_actor)` (najnowsza `20260808190000…:34`); wzorzec emitera z `_log_emit_error`: `20261020110100:444-475`.
- Tożsamość ścieżki: `journey_resolve_lead` (`20261020140000_journeys_routing.sql:136-`) – kolejność: agregat `crm_lead` → `payload.lead_id` → `user_id` → osoba → subskrybent. Typ wyzwalacza `TriggerIdentity = "lead"`, katalog `src/lib/journeys/triggers.ts` (wzór `crm_lead.created.v1` l.293-298).

**Proponowana zmiana**
1. Migracja I9: funkcja wyzwalacza `public.tg_contact_messages_submitted_emit()` (owner I9, `trigger`), wyzwalacz AFTER INSERT ON `contact_messages`. **Nazwa wyzwalacza musi sortować się PO `trg_contact_messages_to_lead`** (wyzwalacze AFTER odpalają alfabetycznie), np. `trg_contact_messages_to_lead_submitted_emit` – inaczej lead jeszcze nie istnieje. W ciele: `lead_id` = `crm_leads` po (`tenant_id`, `email_norm = lower(btrim(NEW.email))`); `form_kind` wyliczony z białej listy (np. `pricing` gdy `form_id = 'pricing-contact-sales' OR source = 'pricing'`, `careers`, `newsletter` z `form_type`, inaczej `contact`) – `source` to wolny tekst z klienta (max 500), nie warunek. Ładunek BEZ PII: `{message_id, lead_id, form_kind, form_id}`; agregat `contact_message`, id = `NEW.id`; `EXCEPTION WHEN OTHERS → _log_emit_error` (zapis formularza nie może paść). Nagłówek: `-- careers-harness: exclude` (sięga do CRM i szyny). REVOKE ALL FROM PUBLIC, anon, authenticated.
2. TS: `DOMAIN_EVENT_TYPES` + agregat `contact_message` w `DOMAIN_AGGREGATE_TYPES` (`src/lib/realtime/domainEvents.ts:217,280`); reguła inwalidacji w `eventInvalidationMap.ts` (test „covers every domain event type”, `__tests__/eventInvalidationMap.test.ts:31-41` – min. `crmKeys.leadsAll()` + `pendingCounterKeys.tenant()`; skrzynka `/admin/contact` używa literału `["admin-contact-messages"]` `admin.contact.tsx:106` – poza fabrykami); wpis `JOURNEY_TRIGGERS` (`group: "crm"`, `identity: "lead"`, `payloadKeys`, `conditionFields: [ENUM("form_kind", [...])]`); szablon: `availability: {status:"available"}`, `triggerEventType: "contact_message.submitted.v1"`, `triggerCondition: { form_kind: "pricing" }`; ewentualnie `syncManifest.ts` (domena CRM, l.457).
3. Opis zdarzenia: `domainEventCatalog.test.ts` skanuje literały `'a.b.v1'` w SQL – literał musi być w migracji.

**Testy do zmiany**: `src/lib/journeys/__tests__/templates.test.ts:63-64` (lista niedostępnych → `[]`), `journeys.functions.test.ts:310-315` (ścieżka `template_unavailable` – zostaw na syntetycznym szablonie albo usuń przypadek), **S8** `hub/s8-sciezki-panel-c:src/components/admin/journeys/list/__tests__/JourneyTemplateGallery.test.tsx:108-119` (karta `pricing_enquiry_b2b` jako niedostępna) + komentarz `JourneyTemplateGallery.tsx:12`. Nowe: pgTAP `hub_i9_contact_message_event_test.sql` (INSERT formularza cennika → 1 zdarzenie z `lead_id` istniejącego leada, ładunek bez e-maila/imienia, `form_kind`; awaria emitera nie wycofuje INSERT; ACL funkcji); vitest triggers (`triggers.test.ts` – pole warunku ∈ payloadKeys).

---

## Z-S5-04 – wspólny pomocnik wycofania zgody marketingowej

**Opis** (§20.5 l.2335; tabela odchyleń l.2269): `_journey_unsubscribe` powtarza logikę `crm_leads_marketing_consent_withdraw` (to RPC wymaga sesji personelu).

**Kod**
- `crm_leads_marketing_consent_withdraw(p_lead_ids uuid[]) RETURNS integer` – jedyna definicja `20261012180900_marketing_consent_unsubscribe_contact_crm_staff.sql:345-402`: bramka `auth.uid()` + `current_tenant_id()` + `has_role admin|editor|super_admin`, sufit 500, CTE `UPDATE crm_leads SET marketing_consent=false, updated_at=now() WHERE tenant_id=v_tenant AND id=ANY(...)` (także już odznaczonych) + INSERT `crm_consent_log (tenant_id,email,source_type 'other',source_id=lead,form_id 'crm_staff:withdraw',form_name 'staff',consent_key 'marketing',consent_text,…,given=false)`; zwraca liczbę wierszy księgi. Granty: `REVOKE ALL FROM PUBLIC, anon; GRANT authenticated, service_role`. Wołający TS `src/lib/crm.functions.ts:1022-1046`.
- `_journey_unsubscribe(p_tenant uuid, p_lead uuid, p_message_id text) RETURNS integer` – `20261020140500_journeys_tracking_stats.sql:216-273` (S5, `FUNCTION_TABLE` S5 internal): UPDATE tylko `WHERE marketing_consent`, wpis księgi `form_id 'journey:unsubscribe'`, `form_name 'journey'`, potem `email_unsubscribe_by_token` albo `email_record_suppression(...)`, wyjście zapisów marketingowych `exited/unsubscribed`. REVOKE także od `service_role`. Wołane przez `journey_record_message_event` (najnowsza `20261020161300:89`).

**Proponowana zmiana** (migracja I9):
- Nowy `public._crm_marketing_consent_withdraw(p_tenant uuid, p_lead_ids uuid[], p_form_id text, p_form_name text, p_text text) RETURNS integer` (I9 `internal`, REVOKE ALL FROM PUBLIC, anon, authenticated, service_role): UPDATE tylko wierszy z `marketing_consent` (bez zbędnego `updated_at`), wpis księgi dla KAŻDEGO kontaktu najemcy z e-mailem (zachowuje semantykę obu: CRM zwraca liczbę objętych, test r12 oczekuje 1).
- Redefinicja `crm_leads_marketing_consent_withdraw` (`-- CIALO-Z: 20261012180900`; wpis `HUB_CIALO_Z` + `FUNCTION_TABLE ["crm_leads_marketing_consent_withdraw","I9","panel"]`; powtórz REVOKE/GRANT) – bramka + sufit zostają, reszta = wywołanie pomocnika.
- Redefinicja `_journey_unsubscribe` (`-- CIALO-Z: 20261020140500`, `HUB_I9_REDEFINITIONS._journey_unsubscribe = "20261020140500"` – pierwsza redefinicja w I9, bez problemu z pkt 0.2).
- Pomocnik dopisać do listy `hub-grants` (`hub_shared_helpers_test.sql`).
- Opcjonalnie (szerzej, osobna decyzja): `email_unsubscribe_by_token` (najnowsza `20261012180900:77`) też przez pomocnik – istotne dla Z-S5-05 opcja A.

**Testy**: istniejące muszą zostać zielone – `supabase/tests/event_identity_consents_r12_test.sql:164-165,480-508` (ACL, wynik 1, obcy najemca nietknięty, wiersz `crm_staff:withdraw`, forbidden bez roli), `journeys_tracking_stats_test.sql:16-17,176-193` (wypis: zgoda wycofana z wpisem, blokada `unsubscribe`, zapisy marketingowe `exited/unsubscribed`). Nowy pgTAP: pomocnik bez EXECUTE dla anon/authenticated/service_role; identyczny ślad księgi z obu ścieżek (różnią się tylko `form_id`/`form_name`); kontakt już odznaczony – wpis księgi jest, `updated_at` bez zmian.

---

## Z-S5-05 – czy mail ścieżki ma dwie stopki wypisu

**Wniosek z analizy kodu: TAK, na produkcji (platforma) mail marketingowy ścieżki ma dwie stopki, a nagłówek RFC 8058 ścieżki ginie.**
- Render: `renderJourneyEmail` `src/lib/journeys/render.server.ts:187-226` – stopka (`FOOTER`/`UNSUBSCRIBE_LABEL` l.179-186) w HTML l.215-222 i tekście l.225-226, gdy `unsubscribeUrl` ≠ null (tylko kategoria `marketing`, runner `src/lib/server/journeysRunner.server.ts:368-371`). URL: `journeyUnsubscribeUrl` l.99-102 (`NEWSLETTER_UNSUBSCRIBE_API_PATH` + podpisany token wiadomości).
- Kolejka: `enqueueRawEmail` `src/lib/email/transactional.server.ts:473-540` – payload zawsze ma `sender_domain: SENDER_DOMAIN` (`notify.mail.neweuropeanstrategies.com`, l.39), `unsubscribe_token: ensureUnsubscribeToken(...)` (l.510-511; komentarz: „stopkę wypisu dokleja platforma”), `unsubscribe_url`, `purpose: "transactional"`. Etykieta `journey` → `category: "bulk"`.
- Dren: `src/lib/email/queueDrain.server.ts:583-603` przekazuje `listUnsubscribeUrl`, `unsubscribeToken`, `senderDomain`.
- Dostawca: `sendEmail` `src/lib/email/provider.server.ts:220-262` – przy `senderDomain && platformMailerConfigured()` (`LOVABLE_API_KEY`, l.73-75) ZAWSZE `sendViaPlatformMailer` (l.169-197): przekazuje `unsubscribe_token`, **pomija `listUnsubscribeUrl`** (nagłówki `List-Unsubscribe` tylko w ścieżce Resend, `extraHeaders` l.109-116). `src/lib/email/unsubscribeToken.server.ts:1-11`: platforma dokleja własną stopkę wypisu, „nie da się jej wyłączyć”.
- Stopka platformy prowadzi do `/email/unsubscribe` (`src/routes/email/unsubscribe.ts`, `email_unsubscribe_by_token`): blokada `unsubscribe` + zdjęcie subskrypcji – NIE wycofuje zgody CRM wprost i nie wychodzi z zapisów (te zatrzyma dopiero bramka zgody przy kolejnym kroku: `_journey_marketing_consent` → `unsubscribed`).

**Opcje naprawy**
- **A (rekomendacja):** jedna stopka = stopka platformy na ścieżce platformy. Render owija stopkę znacznikami (np. `<!--nes:unsub-->…<!--/nes:unsub-->` w HTML i ostatni akapit tekstu), `sendViaPlatformMailer` wycina oznaczony blok (platforma i tak dokleja swoją); ścieżka Resend (kampanie, awaryjnie) zostawia stopkę ścieżki + RFC 8058. Dla pełnej semantyki wypisu (wyjście z zapisów, zgoda CRM) – `email_unsubscribe_by_token` przez pomocnika Z-S5-04 (redefinicja funkcji sprzed huba, `HUB_CIALO_Z: 20261012180900`) albo akceptacja, że zapis wyjdzie przy następnym kroku z powodem z bramki zgody.
- B: zostawić obie stopki – sprzeczne z §9.2 („poprawić”).
- C: wysyłać `journey` bez `sender_domain` (Resend) – Resend nie zna domeny `notify.*` (403 → i tak platforma, `provider.server.ts:224-247`); odrzucone.

**Testy**: rozszerz `src/lib/journeys/__tests__/render.server.test.ts:153-198` (znacznik obejmuje dokładnie jedną stopkę; usługa bez znacznika), `src/lib/email/__tests__/provider.server.test.ts:195-210,378` (platforma: HTML/tekst bez bloku znacznika, `unsubscribe_token` przekazany; Resend: blok zostaje + `List-Unsubscribe`/One-Click). Integracyjny: render → `enqueueRawEmail` (atrapa RPC `enqueue_email`) → `sendEmail` z atrapą `@lovable.dev/email-js` → w ciele do platformy 0 wystąpień `UNSUBSCRIBE_LABEL`. Dziennik §20.9 pkt 7 (test na żywo M3) – „stopka występuje raz” zostaje jako weryfikacja właściciela.

---

## Z-S5-06 – dymek: otwarcia ludzkie i CTOR to górna granica (Apple MPP)

**Stan: zrobione w S8.2 na gałęzi `hub/s8-sciezki-panel-c` (`a760cf07d`)** – po integracji S8 tylko potwierdzić i zamknąć wpisem w dzienniku.
- `src/components/admin/journeys/results/JourneyEmailsTable.tsx:11-14, 97-104` – dymek na nagłówkach kolumn (`adminJourneys.results.emails.mppLabel`/`mppBody`, przycisk 24 px z klawiatury, `data-mpp-hint`).
- `src/components/admin/journeys/editor/JourneyStatsOverlay.tsx:16,224` – legenda MPP na kanwie; test `__tests__/JourneyStatsOverlay.test.tsx:179-217` (title zawiera „MPP”, axe).
- Słownik `src/lib/i18n-admin-journeys-results.ts:142-145` (PL) / 388-391 (EN), `statsOverlay.legend` l.223, `opens`/`ctor` l.228-230; A/B: `JourneyAbCard.tsx:9`, `ab.hint` l.106.
- Próg: `machine_open_seconds` (ustawienia silnika; `i18n-admin-journeys.ts:241,557`).
**Do sprawdzenia przy I9**: czy kafle KPI `JourneyResults` (klucze `results.kpi` l.47-56) nie pokazują otwarć bez dymku (dziś nie pokazują – brak). Brak dodatkowej pracy.

---

## Z-I9b-09 – `/profile/organization`: limit Zespołu > 20 z sugestią Enterprise

**Fakt odbiegający od opisu w dzienniku (l.2794):** profil NIE woła `setTeamSeatLimit` (tylko `src/routes/admin.organizations.$id.tsx:31,897`). W profilu limit 20 trafia przy **zaproszeniu**: `inviteOrgSeat` (`src/lib/organizations/selfservice.functions.ts:55-70`, RPC `org_add_seat`, błąd obcięty do 120 zn.) → wyzwalacz `tg_organization_seats_team_seat_cap` (`20261020160300…:88-130`, `RAISE 'orgs: team seats max'` 23514) → `onInvite` `src/routes/profile.organization.tsx:195-217` mapuje tylko `includes("limit")`/`includes("exists")` → **ogólny `membership.organization.inviteError`**.

**Zmiana**: w `onInvite` najpierw `isTeamSeatsMaxError(msg)` (`src/lib/organizations/teamSeats.ts:66-69`, czysty moduł; stałe `TEAM_TIER_MAX_SEATS = 20` l.24) → `toast.error(t("membership.organization.teamSeatsMax", { max: TEAM_TIER_MAX_SEATS }))`, z sugestią Enterprise (np. `description`/akcja z linkiem `/pricing`). Nowy klucz w `src/lib/i18n-membership.ts` (sekcja `organization` PL l.36-58, EN l.148-170), tekst wzorem `i18n-admin-organizations.ts:118` (`teamCap.addBlocked`). Budżet `public`: + kilkaset bajtów (zapas ≈102 KB) – bez ratchetu. Opcjonalnie: przy `org.tier_key === "team"` i 20 aktywnych miejscach – wyłączony przycisk z tym samym zdaniem (`teamSeatAddBlocked` l.47-52).

**Test**: `src/routes/__tests__/profileOrganizationRoute.test.tsx` – wzór l.221-223, 684-699 (`h.inviteResult = { ok:false, error: BLAD_LIMITU }` → `h.toastError` = [klucz]); dodaj `BLAD_ZESPOLU = "orgs: team seats max"` → `["membership.organization.teamSeatsMax"]` (przed gałęzią `limit`).

---

## Z-I9b-14 – alias `is_admin_or_editor` w generatorze snapshotu autoryzacji

**Pomiar (skrypt w scratchpadzie, kopia `src/lib/ci/authzGates.ts` z aliasem na `deriveAuthzSnapshot`/`selectAuthzSnapshot`/`renderAuthzSnapshotModule`):**
- `is_admin_or_editor()` – `20260824074231_4a952090…sql:60-72` (`has_role(auth.uid(),'admin') OR has_role(...,'editor')`, `search_path = public` bez `pg_temp`).
- Najnowsze definicje funkcji wołających alias: **11** (`_journey_staff_tenant`, `admin_coupon_campaign_set_status`, `admin_crm_set_lifecycle_stage`, `admin_newsletter_settings_patch`, `admin_revenue_access_inventory`, `admin_revenue_clubs_summary`, `admin_revenue_email_health`, `admin_revenue_events_summary`, `admin_revenue_funnel`, `admin_revenue_offer_matrix`, `install_workflow_template`) + 22 polityki RLS (journey_*, workflow_*, career_*, integration_*, paywall_hits, revenue_diagnostic_snoozes…).
- Pełny skan: `roleGates` – 4 zmienione + 29 nowych wpisów, ale **żaden nie jest w macierzy** (`DOCUMENTED_ROLE_GATE_REFS`, `src/lib/authz/permissionRows.ts`), więc nie trafia do pliku.
- **Wygenerowany `src/lib/authz/authzSnapshot.generated.ts`: zmienia się DOKŁADNIE 1 linia** – l.74 `premium_content` / `fn:admin_revenue_access_inventory/0`: `bypassRoles: []` → `["admin","editor"]`.
- **Skutek uboczny (decydujący):** `buildTierRow` (`src/lib/authz/permissionMatrix.ts:267-298`) bierze SUMĘ `bypassRoles` wszystkich bramek flagi → wiersz `cap_premium_content` w `/admin/permissions` pokazałby admin i editor jako „pełny dostęp” do treści premium, choć `admin_revenue_access_inventory` to raport personelu (Z-S3-06, §21.11 B2), a jedyna bramka czytelnika `has_content_access` (l.75) nie ma obejść. To fałsz w ekranie audytu.

**Rekomendacja: zostawić (świadomie) z uzasadnieniem** – zmiana nie jest szeroka w artefakcie (1 linia), ale wprowadza błędną informację w macierzy. Jeśli właściciel chce alias: najpierw mechanizm adnotacji „raport personelu ≠ bramka flagi” w `authzGates.ts` (wykluczenie z `featureGates` funkcji z bramką ról, która tylko RAPORTUJE flagę), test w `src/lib/authz/__tests__/permissionMatrix*.test.ts`. Zgodnie z prompt §11 – zgłosić właścicielowi z tym pomiarem.

---

## Z-I9b-15 – import CSV leadów: tag > 64 znaków

**Kod**: limit `CRM_TAG_MAX` (`src/lib/crm/lifecycle.ts`, = 64; I9b B7). Walidator serwera `importCrmLeads` `src/lib/crm-tasks.functions.ts:279-294` (`tags: z.array(z.string().trim().min(1).max(CRM_TAG_MAX)).max(20)`, `rows.max(CRM_IMPORT_CHUNK_SIZE)`) – zod odrzuca CAŁĄ porcję. Mapowanie `src/lib/crm/importMapping.ts`: `splitTags` l.135-141 (separatory `| ; ,`, `IMPORT_MAX_TAGS = 20`), `mapImportRows` l.165-219 (`MappedImportRows` l.148-158). Dialog `src/components/admin/crm/ImportLeadsCsvDialog.tsx`: słownik lokalny PL/EN w komponencie (l.52-130), `mapped` l.148-155, `doImport` l.172-205 (błąd porcji → `toast.error(err.message)`).

**Zmiana** (zasada AGENTS.md: odrzucać, nigdy nie przycinać): `mapImportRows` zwraca dodatkowo `oversizedTags: { row: number; tag: string }[]` (numer wiersza pliku, długość > `CRM_TAG_MAX`); wiersz zostaje w wyniku, ale dialog pokazuje komunikat (liczba wierszy, pierwsze numery, limit) i blokuje „Importuj” do poprawy pliku. **Ta sama klasa błędu** dla innych pól: `row[field] = value.slice(0, IMPORT_VALUE_MAX_LENGTH)` (300, l.213) przy limitach serwera `first_name 100`, `phone 40`, `country 80`… (l.279-286) – przycina i/lub wywraca porcję; rozważ wspólny `oversizedValues` z limitami z jednego źródła (zasada „share limits across client/server”).

**Testy**: `src/lib/crm/__tests__/importMapping.test.ts` (tag 64 przechodzi, 65 raportowany z numerem wiersza, bez przycięcia), `src/components/admin/crm/__tests__/crmDialogs.test.tsx` (komunikat widoczny, przycisk zablokowany, `importFn` niewołane; axe).

---

## Z-I9c-02 – etykiety PL/EN powodów w Skrzynce wysyłek

**Kod**: panel `src/components/admin/newsletter/outbox/EmailOutboxPanel.tsx:300-302` wypisuje surowe `row.errorMessage`; dane `src/lib/admin/emailOutbox.functions.ts:72,180,195` (`email_send_log.error_message`); słownik `src/lib/i18n-admin-email-outbox.ts` (`adminOutbox.table.error` „Powód”, `status.*`). Test `outbox/__tests__/emailOutboxPanel.test.tsx`.

**Kody do etykiet (źródła)**:
- `suppressed:<SuppressionReason>` – `suppressionSkipReason` `src/lib/email/suppressionPolicy.ts:109-111`; `SuppressionReason` l.26-27: `hard_bounce | soft_bounce | complaint | manual | unsubscribe | invalid | blocked`; goły `suppressed` (`transactional.server.ts:226`, `queueDrain.server.ts:545`).
- `cancelled:account_deleted` – `ACCOUNT_DELETED_CANCEL_REASON` `suppressionPolicy.ts:316` (SQL `20261020160900:361`, odbiorca `[redacted]`).
- `skipped:*` z `email_queue_send_recheck` (`20261020160900:480-525`), logowane w drenie `queueDrain.server.ts:566-575`: `skipped:enrollment_missing`, `skipped:exited:<exit_reason>` (`JOURNEY_EXIT_REASONS` `src/lib/journeys/limits.ts:87-101`: completed, goal, exit_event, consent, unsubscribed, suppressed, manual, journey_archived, error, entry_filter, account_deleted), `skipped:<werdykt _journey_marketing_consent>` (`no_consent`, `unsubscribed` – `20261020140200:111-131`), `skipped:account_deleted`, `skipped:digest_disabled`.
- Inne w kolumnie: `rate_limited`, `http_<status>`, teksty dostawcy (`queueDrain.server.ts:627,648`) – zostają surowe.
- Uwaga: I9d-Y1 (wygaszanie subskrybentów) może dodać nowe kody/etykiety – uwzględnić.

**Zmiana**: czysty `src/lib/admin/emailOutboxReason.ts` – `outboxReasonLabel(code): { key: string; params?: Record<string,string> } | null` (prefiksy jw., nieznany → `null` = surowy kod); w panelu etykieta + surowy kod w `title`/`<code>` (dla wsparcia). Klucze `adminOutbox.reason.*` PL/EN (powody wyjścia: własne klucze z testem parytetu z `JOURNEY_EXIT_REASONS` – słownik `adminJourneys` jest ładowany leniwie w innym chunku).
**Testy**: vitest helpera (każdy `SuppressionReason`, każdy `JOURNEY_EXIT_REASONS`, stałe z SQL – parytet przez odczyt `20261020160900` jak `src/lib/email/__tests__/accountBoundLabelsParity.test.ts:11-34`), RTL panelu (etykieta + `title` z kodem, nieznany kod surowo), parytet PL/EN.

---

## Z-I9c-05 – czytelnicy surowych zdarzeń kampanii/ścieżek → archiwum/rollup

**Mechanizm retencji** (§21.21; `20261020161100_data_retention_executor.sql:144-210`): `_data_retention_fold_campaign_events` składa zdarzenia kampanii starsze niż próg do `newsletter_campaign_engagement_archive` (`20261020161000:174-185`: PK `campaign_id`, `opens`, `clicks`, `unique_openers`, `unique_clickers`, `archived_before`, BEZ wymiaru dnia) i usuwa surowe. Odbiorcy kampanii (`newsletter_campaign_recipients`) nie są usuwani, tylko redagowani (`email → '[redacted]:<id>'`, `subscriber_id NULL`; l.295-303). Ścieżki: pieczęć `journey_node_daily_stats` (`20261020090400:122-146`, dzień × węzeł × wersja: entered, succeeded…, emails_sent, unique_opens, unique_human_opens, unique_clicks, unsubscribes, goal_reached) przez `_journey_rollup_days` (`20261020161000:446-529`), stan `data_retention_state(scope 'journey_stats', sealed_through)`. Jedyny już przełączony czytelnik kampanii: `newsletter_campaign_engagement` (`20261020161200:434-490`, surowe + archiwum).

**Czytelnicy surowych zdarzeń (najnowsze definicje, skan `extractLatestDefinitions`)**:
| Funkcja | Wersja | Właściciel / rejestr | Okno | Proponowane źródło |
|---|---|---|---|---|
| `admin_revenue_email_health(p_since,p_until)` (zdrowie poczty S1) | `20261020100300` (l.85-160: kohorta kampania×subskrybent, `EXISTS` po zdarzeniach) | S1 panel → `HUB_I9_REDEFINITIONS` | kampanie wysłane w oknie | per kampania: surowe pary + `archive.unique_openers/clickers` (kohorta kampanii, bez subskrybenta) |
| `admin_dashboard_marketing(p_since,p_until,p_prev_since,…)` (kokpit/„pulpit”) | `20260912110000` (l.382-480: `count(*)` zdarzeń po `created_at`) | sprzed huba → `HUB_CIALO_Z` + `FUNCTION_TABLE` I9 | data zdarzenia | wymaga dziennego wymiaru – nowa tabela dzienna (niżej) |
| `analytics_semantic_snapshot(p_since,p_until)` (warstwa semantyczna) | `20261003180000` (l.291-369) | sprzed huba | data zdarzenia | j.w.; metadane TS: `src/lib/analytics/semantic/streams.ts:239`, `metrics.ts:578,603,630` (formuły) |
| `compute_crm_lead_score(p_lead_id)` (scoring) | `20260721113000` (l.52-125: opens/clicks osoby, `horizon_days` domyślnie 365, CHECK 7-1095) | sprzed huba | horyzont | **zostawić** – dane o zachowaniu osoby muszą zniknąć z retencją (minimalizacja); efektywny horyzont = min(horyzont, retencja) – dopisać w ustawieniach scoringu/runbooku |
| `admin_journey_series(p_journey_id,p_since,p_until)` | `20261020140500:555-608` (enrolled/goal/exited z zapisów, `emails_queued` z `journey_messages`, `unique_clicks` z `journey_message_events`) | S5 panel → `HUB_I9_REDEFINITIONS` | dzień | dni ≤ `sealed_through`: maile z `journey_node_daily_stats` (uwaga: rollup ma `emails_sent`, nie `queued`, i liczy po dniu przebiegu kroku), zapisy z rollupu Z-I9c-06 |

**Rekomendowany zakres w I9**: (1) `admin_journey_series` razem z Z-I9c-06 (ta sama tabela); (2) `admin_revenue_email_health` – archiwum per kampania pasuje 1:1 do kohorty; (3) kokpit + warstwa semantyczna: nowa tabela `newsletter_campaign_engagement_daily (tenant_id NOT NULL FK CASCADE, campaign_id FK CASCADE, day date, opens, clicks, PK (campaign_id, day))` wypełniana w `_data_retention_fold_campaign_events` (funkcja I9, jedna dodatkowa agregacja w CTE `stats` po `created_at::date`) – sumy dzienne bez identyfikatorów; unikalnych nie da się sumować po dniach. Alternatywa „świadomie zostawić” dla (3) z uzasadnieniem: domyślna retencja 13 mies. > typowe okna kokpitu; ale pierwsze uruchomienie po karencji usuwa całą historię > 13 mies., więc okna historyczne kokpitu spadną od razu.
**Ryzyko**: I9d-Y1 usuwa nieaktywnych subskrybentów – `newsletter_campaign_events.subscriber_id ON DELETE SET NULL` (`20260711083456…:72`) → `COUNT(DISTINCT subscriber_id)` w surowych spada dla starych kampanii (zasięg unikalny maleje). Rozważ złożenie zdarzeń usuwanego subskrybenta do archiwum przed usunięciem.
**Testy**: pgTAP na wzór `hub_i9c_data_retention_aggregates_test` (okno sprzed progu i przecinające próg – wynik identyczny przed i po czyszczeniu) dla każdej przełączonej funkcji.

---

## Z-I9c-06 – dzienny rollup statusów zapisów ścieżek

**Kod**: `admin_journey_stats` (najnowsza `20261020161200_data_retention_reads.sql:494-…`, l.545-571): podsumowanie (`enrolled`, `active`, `waiting`, `completed`, `goal_reached`, `failed`, `exited` per `exit_reason`, `goal_rate`) liczone z SUROWYCH `journey_enrollments` po `entered_at` w oknie; `v_rollup` (l.552-554) przełącza tylko węzły. Usuwanie: `_data_retention_journey_enrollments` (`20261020161100:571-604`) kasuje zakończone (`completed|goal_reached|exited|failed`) z `finished_at < cut` (cut ≤ dzień po `sealed_through`). S8.2 pokazuje uczciwy stan („podsumowanie zapisów obejmuje tylko zachowane zapisy”, `i18n-admin-journeys-results.ts:57-63` `results.rollup.*`, `kpi.partial`).

**Zmiana** (migracja I9):
- Tabela `journey_enrollment_daily_stats (tenant_id uuid NOT NULL FK tenants CASCADE, journey_id uuid NOT NULL, version_id uuid NOT NULL, entered_day date NOT NULL, finished_day date NOT NULL, status text NOT NULL CHECK (status IN ('completed','goal_reached','exited','failed')), exit_reason text NOT NULL DEFAULT '', n integer NOT NULL CHECK (n >= 0), PK (journey_id, version_id, entered_day, finished_day, status, exit_reason), FK (tenant_id, journey_id) → journey_definitions(tenant_id,id) ON DELETE CASCADE)` – jak `journey_node_daily_stats`; RLS, REVOKE od klientów, odczyt personelu przez RPC (albo polityka `staff_read` jak `journey_node_daily_stats_staff_read`).
- Złożenie PRZED usunięciem w `_data_retention_journey_enrollments` (funkcja I9 – redefinicja w bloku I9 bez rejestru; `-- CIALO-Z: 20261020161100` dla porządku): `INSERT … SELECT … GROUP BY … ON CONFLICT DO UPDATE SET n = n + EXCLUDED.n` w tej samej instrukcji co DELETE (CTE `doomed` + `fold`), bez zapisów testowych (`NOT is_test`).
- Odczyt: `admin_journey_stats` = surowe (pozostałe) + złożone dla `entered_day` w oknie (rozłączne, bo złożone wiersze usunięto); `active/waiting` tylko z surowych. **Druga redefinicja `admin_journey_stats` w I9 → pułapka 0.2 (zmiana bramki)**. `admin_journey_series`: `enrolled` po `entered_day`, `goal_reached/exited` po `finished_day`.
- Po wdrożeniu zaktualizować tekst S8 `results.rollup.body` (już nie „tylko zachowane zapisy”) – plik `src/lib/i18n-admin-journeys-results.ts` (S8, w manifeście I9 przez `src/components/admin/journeys/**`? NIE – słownik `src/lib/i18n-admin-journeys-results.ts` dopisać do manifestu).
**Testy**: pgTAP – zapisy zakończone sprzed progu: liczby podsumowania i serii identyczne przed i po czyszczeniu; idempotencja (2. przebieg nie dubluje), zapisy testowe pominięte, ACL tabeli; vitest `parse.ts`/`dto.ts` jeśli zmieni się kształt.

---

## Z-I9c-10 – archiwum kampanii: podwójne liczenie zasięgu

**Mechanizm błędu** (`_data_retention_fold_campaign_events`, `20261020161100:176-205`): zasięg unikalny archiwum liczy subskrybenta, jeśli w chwili złożenia nie ma jego zdarzenia po progu (`NOT EXISTS … r.created_at >= p_cutoff`). Subskrybent złożony nocą N (otwarcie tylko przed progiem), który otworzy kampanię PONOWNIE po złożeniu, przy kolejnym złożeniu liczy się drugi raz (`unique_openers = a.unique_openers + EXCLUDED…`, l.196-199); w odczycie (`20261020161200:465-468`) surowe + archiwum mogą też liczyć go raz w surowych i raz w archiwum, dopóki nowe zdarzenie nie zostanie złożone.
**Opcje**: (A, rekomendacja) **udokumentować** (dziennik + runbook + dymek przy zasięgu kampanii starszej niż retencja): różnica ≤ liczba powrotów po progu retencji (min. 3 mies. od wysyłki – zjawisko marginalne); opcjonalnie w odczycie `LEAST(unique_openers, liczba odbiorców kampanii)` (wiersze `newsletter_campaign_recipients` zostają po redakcji) – zasięg nigdy > 100 %. (B) dokładnie: znacznik `first_opened_at/first_clicked_at` na wierszu odbiorcy przy złożeniu (bez nowych identyfikatorów) i wykluczanie takich subskrybentów z surowych – działa tylko dopóki `subscriber_id` odbiorcy nie zostanie zredagowany (kategoria `email_send_log` ma osobny próg) – złożone, nie polecam.
**Test (dla A z LEAST)**: pgTAP – kampania 3 odbiorców, scenariusz powrotu po złożeniu: `unique_openers ≤ 3`.

---

## Z-S3-04 – e2e S3 w CI

**Potwierdzone zielone** (REST `gh api`, bez GraphQL): głowa PR `75133fe20df7aa6a294c443edb1575608123eabc`, check-run `e2e` = success (2026-10-20T21:04:40Z, job `118883702498`, https://github.com/NewEUStrategies/neweustrategies-dc633fb5/actions/runs/39496624037/job/118883702498), `e2e-seeded` = success. Log: `114 passed, 25 skipped`; przeszły m.in. `e2e/checkout.spec.ts:66` („checkout step is gated behind authentication when logged out”), `:57/:87/:98`, wszystkie 8 przypadków `e2e/login-return.spec.ts` (`:50`, `:66` ×5 wrogich `next`, `:78`, `:84`) i `e2e/paywall.spec.ts:45,58,65,79,86`. Workflow `.github/workflows/e2e.yml` (pull_request), `playwright.config.ts:38` pomija tylko `boot-*`.
**Działanie**: zamknąć w dzienniku („Zamknięte … (I9, §NN): zielone w CI na `75133fe2`, job 118883702498”) i odhaczyć kryteria §18 l.2003, 2007; po pushu I9 sprawdzić ponownie check-run `e2e` na nowej głowie (`gh api repos/NewEUStrategies/neweustrategies-dc633fb5/commits/<sha>/check-runs`).

---

## Z-I9c-03 i Z-S3-02 – znane skutki (tylko runbook)

`docs/RUNBOOK_HUB_PRZYCHOD_LEJEK.md` jeszcze NIE istnieje (tworzy go I9 – kryterium §9.1). Sekcja „Znane skutki i granice pomiaru”:
- **Z-I9c-03** (l.3683): zerowanie autora przy usunięciu konta przesuwa `updated_at` wierszy z wyzwalaczem `set_updated_at`/`_tg_touch_updated_at` (`pages`, `legal_document_versions`, `event_registrations`, `club_applications`) na chwilę usunięcia; treść bez zmian, bez nowej rewizji (`20261020160900:182`). Diagnoza: „masowa zmiana `updated_at` bez rewizji w tej samej sekundzie = usunięcie konta personelu; sprawdź `audit_log`”.
- **Z-S3-02** (l.1840): uderzenia GOŚCI w paywall to dolna granica – bez cookie licznika `nes_mvid` (zakładane dopiero przy konsumpcji limitu) uderzenie nie jest liczone; PHR/PSCR liczą konta, nie gości.
- Dołożyć tu: Z-S5-06 (MPP), Z-I9c-10 (zasięg), Z-S2-07 (historyczne `unknown_environment_documents`), Z-I9b-14 (uzasadnienie braku aliasu).

---

## Rekomendacja wdrożenia

**Kolejność (zależności):**
1. Bramka CIALO-Z dla wielokrotnych redefinicji w I9 (`hubDelivery.ts` + `hubDelivery.gate.test.ts`) – jeśli I9d jej nie zrobił; bez tego Z-I9c-06 nie przejdzie.
2. TS bez SQL (niezależne, równolegle): Z-S2-07 (`billingDocuments.server.ts` + test), Z-I9b-09 (profil + `i18n-membership` + test), Z-I9b-15 (`importMapping.ts`, dialog + testy), Z-I9c-02 (helper + panel + słownik + testy), Z-S5-05 część TS (render znaczniki + `provider.server.ts` + testy).
3. Migracja A (`2026102016xxxx_crm_marketing_consent_shared.sql`): pomocnik Z-S5-04, redefinicje `crm_leads_marketing_consent_withdraw` (CIALO-Z `20261012180900`) i `_journey_unsubscribe` (CIALO-Z `20261020140500`); opcjonalnie `email_unsubscribe_by_token` (CIALO-Z `20261012180900`) dla Z-S5-05.
4. Migracja B (`…_contact_message_submitted_event.sql`): emiter Z-S5-01 (`-- careers-harness: exclude`), + TS szyna/wyzwalacze/szablon + poprawa testów S5/S8.
5. Migracja C (`…_journey_enrollment_rollup.sql`): tabela Z-I9c-06, redefinicje `_data_retention_journey_enrollments`, `admin_journey_stats`, `admin_journey_series`; + Z-I9c-05 (`admin_revenue_email_health`; tabela dzienna kampanii + `_data_retention_fold_campaign_events`, `admin_dashboard_marketing` CIALO-Z `20260912110000`, `analytics_semantic_snapshot` CIALO-Z `20261003180000` – jeśli w zakresie). Plik ≤ 45 KiB (`scripts/split-migration.ts --dry-run`), w razie potrzeby rozbić C na dwie wersje.
6. Bliźniaki drizzle `cp` bajt w bajt od następnego wolnego numeru (po S7 `0373-0375` i I9d), `_journal.json` idx+1, `when` +60000; `types.ts` (nowe tabele), `hubDelivery.ts` (FUNCTION_TABLE, HUB_CIALO_Z, HUB_I9_REDEFINITIONS, manifest I9), `hub_shared_helpers_test.sql` (hub-grants), `bun run generate:authz-snapshot` (nowe funkcje z `has_role` mogą zmienić snapshot).
7. Z-S5-06, Z-S3-04, Z-I9b-14, Z-I9c-03, Z-S3-02, Z-I9c-10 (A) – wyłącznie dziennik/runbook.

**Wersje**: najwyższa istniejąca `20261020161400`; I9.2 = po najwyższej `2026102016*` po S7/I9d (zakres huba `< 20261020170000`, `HUB_VERSION_RANGE` `hubDelivery.ts:49`). Bliźniaki: po `0372` (+S7, +I9d).

**Testy (celowane)**: `TZ=UTC bunx vitest run --maxWorkers=2 src/lib/billing/__tests__/billingDocuments.server.test.ts src/routes/__tests__/profileOrganizationRoute.test.tsx src/lib/crm/__tests__/importMapping.test.ts src/components/admin/crm/__tests__/crmDialogs.test.tsx src/components/admin/newsletter/outbox src/lib/journeys src/lib/email/__tests__ src/lib/realtime src/lib/ci src/lib/authz`; pgTAP: `revenue_subscription_history`, `event_identity_consents_r12`, `journeys_tracking_stats`, `hub_shared_helpers`, `hub_i9c_data_retention_aggregates` + nowe `hub_i9_*`; harnessy (careers – znacznik!), `generate:ts-sql-contract`, `check:rpc-contract`, `check:types-freshness`, `check:migration-lanes`, `generate:authz-snapshot --check`, `hub-slice-guard I9`.

## Otwarte pytania / ryzyka

1. **Z-I9b-14** – decyzja właściciela (prompt §11): rekomendacja „zostawić”, bo alias fałszuje wiersz `premium_content` w macierzy uprawnień (pomiar wyżej).
2. **Z-S5-05** – faktyczny wygląd stopki platformy i to, czy platforma dokleja własny `List-Unsubscribe`, potwierdza dopiero test na żywo (M3). Opcja A zmienia semantykę wypisu z linku stopki (przez `email_unsubscribe_by_token`) – czy rozszerzać tę funkcję o wycofanie zgody CRM i wyjście z zapisów (pre-hub, szerszy zasięg)?
3. **Z-S5-01** – SPEC P25 mówił „po M3”; prompt §9.2 każe w I9. Biała lista `form_kind` i reguła „pricing” (`form_id`/`source` są kontrolowane przez klienta – każdy może wywołać ścieżkę B2B; skutek: powiadomienie i zadanie personelu, ograniczone limitem formularza 5/10 min IP i 3/h adres).
4. **Z-S2-07** – brak backfillu `subscription_id` (świadomie, by nie wywołać masowych spóźnionych `subscription.renewed.v1`); historyczne dokumenty bez zamówienia zostają `unknown_environment_documents`.
5. **Z-I9c-05** – zakres: rekomendacja (1)+(2) obowiązkowo, (3) decyzja kosztu (nowa tabela dzienna + 2 redefinicje funkcji sprzed huba); scoring – świadomie bez zmian (minimalizacja). Interakcja z I9d-Y1 (usuwanie subskrybentów zeruje `subscriber_id` w zdarzeniach).
6. **Bramka CIALO-Z** – bez jej zmiany druga redefinicja funkcji S5 w I9 jest niemożliwa (dotyczy też I9d-Y2: `journey_contact_for_send`, render/tracking).
7. **Z-I9b-09** – opis w dzienniku wskazuje `setTeamSeatLimit`, a realna ścieżka profilu to zaproszenie (`org_add_seat`); poprawić opis przy zamknięciu.
8. **Z-I9c-06** – po wdrożeniu rollupu zmienia się tekst S8 (`results.rollup.body`, `kpi.partial`) – koordynacja ze słownikiem S8 i jego testami.
