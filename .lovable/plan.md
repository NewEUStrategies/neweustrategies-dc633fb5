# Port PR#54 (`claude/platform-evaluation-tyr1yh`) → Lovable

PR#54 (77 files, +12 196 / -4 759) był zmergowany na GitHubie 2026-07-11, ale
nie zsynchronizował się z tym sandboxem. Dodatkowo używa nazw sprzed naszych
zmian (`follows`, `notification_prefs`, `profile_experience`), więc portujemy
etapami z mapowaniem na obecny schemat.

Mapowanie nazw:
- `follows` → `user_follows`
- `notification_prefs` → `notification_preferences`
- `profile_experience` → `profile_experiences`

## Etapy

- [x] **1. Notification producer helper** — `public.enqueue_notification()` (SECURITY DEFINER, exception-safe, dedup w oknie 5 min).
- [x] **2. Komentarze** — tabela `public.comments` + RLS + BEFORE INSERT/UPDATE trigger + notyfikacja autora + moderacja `/admin/comments` + publiczny `<CommentsSection>` pod wpisami + i18n (PL/EN). `allow_comments` ustawione na `true`.
- [x] **3. Producenci powiadomień** — triggery na `user_follows` (nowy obserwator), `posts` (publikacja → obserwatorzy autora + kategorii + tagów, dedup 5 min), `user_subscriptions` (aktywacja).
- [x] **4. Newsletter — samoobsługowy unsubscribe** — kolumna `unsubscribe_token` (auto-generowana trigger BEFORE INSERT, backfill dla istniejących), publiczny `/api/public/newsletter/unsubscribe` (GET walidacja + POST wypisanie), strona `/newsletter/unsubscribe` (dwuklik: potwierdzenie chroniące przed skanerami URL), stopka „Unsubscribe" w mailu DOI, i18n PL/EN.
- [x] **5. Newsletter — kampanie** — tabele `newsletter_campaigns` + `newsletter_campaign_recipients` (log wysyłek per odbiorca, dedup przez UNIQUE(campaign_id,email)), admin `/admin/newsletter/campaigns` (lista + edytor dwujęzyczny PL/EN z filtrem audytorium `{languages, statuses, source}`, licznikiem odbiorców na żywo, test-mailem, wysyłką paczkami po 20 e-maili przez Resend z `List-Unsubscribe` per odbiorca i renderowaniem `{{firstName}}`/`{{lastName}}`/`{{email}}`). RLS: admin/editor tenanta.
- [x] **6. Publiczny profil CV** — sekcja `<AuthorCvSections>` na `/author/$slug` renderuje `profile_experiences` (timeline z logo i lokalizacją), `profile_education` (grid kart), `profile_skills` (pigułki z paskami `role="meter"` per level, grupowanie po `category`), `profile_awards` (siatka kart, opcjonalny link) i `profile_hobbies` (pigułki). Pusta sekcja jest ukryta. Query publiczne (anon SELECT) w `src/lib/queries/authorCv.ts`.
- [x] **7. Obserwowanie autorów w scoringu** — czysty moduł `src/lib/recommendations.scoring.ts` (waga: +4 followed author, +3 followed category, +2 followed tag, +1 history overlap, +1 recency <30 dni) z testami vitest; `getRecommendedPosts` przełączony na scorer; nowy `getFollowedFeed({limit})` (dedup po `post_id` z autorów/kategorii/tagów, order by `published_at desc`). Feed „Obserwowane" na `/reading-list` renderuje siatkę wpisów z obserwowanych źródeł pod chipsami autorów/kategorii/tagów, i18n PL/EN.
- [x] **8. Alt-text mediów** — edytowalne pole `alt_text` (do 500 znaków) w panelu szczegółów MediaManager (przycisk „Zapisz" pojawia się dopiero po edycji, obsługa `admin.media.altText` i18n) oraz inline-edytor w MediaPickerDialog pod siatką (widoczny po zaznaczeniu obrazu, `invalidateQueries(["media-picker"])` po zapisie).
- [x] **9. Bezpieczeństwo P0** — `REVOKE SELECT (password_hash)` na `content_access` dla `anon`/`authenticated`; nowa funkcja `content_access_has_password(entity_type, entity_id)` (SECURITY DEFINER, tylko flaga obecności) zamiast czytania skrótu; `useContentAccess`, `PostGeneralOverview` i `AccessSettingsPane` używają jawnej listy bezpiecznych kolumn + RPC `content_access_has_password`. Trigger `payment_orders_secure_insert_trg` (BEFORE INSERT) wymusza dla zwykłych użytkowników `status='pending'`, brak `provider_session_id`/`provider_intent_id`/`invoice_url`/`paid_at` oraz `user_id = auth.uid()` (service_role bez zmian).
- [ ] **10. Stripe** — realne `cancel_at_period_end` przy anulowaniu, webhook `customer.subscription.updated`, `charge.refunded`, triale (`trial_period_days` → Stripe).
- [ ] **11. Web Stories** — publiczne archiwum + OG image.
- [ ] **12. Live Blog** — picker postów/bloków (zamiast wklejania UUID), edycja wpisów, `occurred_at` backdating.
- [ ] **13. People Discovery** — GIN `pg_trgm` na haystacku (skala).
- [ ] **14. Personality** — trwały panel wyników OCEAN (paski, `role="meter"`, i18n).

Referencyjny SHA head PR#54: `d7c4757cee74cf25097c3f4a7a1237c9a23838ea`.
