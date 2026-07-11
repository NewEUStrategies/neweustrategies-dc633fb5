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
- [ ] **5. Newsletter — kampanie** — tabela `newsletter_campaigns`, admin `/admin/newsletter/campaigns` (dwujęzyczny edytor, test-mail, licznik odbiorców, wysyłka paczkami via Resend).
- [ ] **6. Publiczny profil CV** — render `profile_experiences` / `profile_education` / `profile_skills` / `profile_awards` / `profile_hobbies` na `/author/$slug`.
- [ ] **7. Obserwowanie autorów w scoringu** — `lib/recommendations.scoring.ts` z boostem +4, feed „Obserwowane".
- [ ] **8. Alt-text mediów** — pole edycyjne w MediaManager + MediaPickerDialog.
- [ ] **9. Bezpieczeństwo P0** — revoke SELECT(password_hash) + jawna lista kolumn w useContentAccess, zawężenie INSERT payment_orders.
- [ ] **10. Stripe** — realne `cancel_at_period_end` przy anulowaniu, webhook `customer.subscription.updated`, `charge.refunded`, triale (`trial_period_days` → Stripe).
- [ ] **11. Web Stories** — publiczne archiwum + OG image.
- [ ] **12. Live Blog** — picker postów/bloków (zamiast wklejania UUID), edycja wpisów, `occurred_at` backdating.
- [ ] **13. People Discovery** — GIN `pg_trgm` na haystacku (skala).
- [ ] **14. Personality** — trwały panel wyników OCEAN (paski, `role="meter"`, i18n).

Referencyjny SHA head PR#54: `d7c4757cee74cf25097c3f4a7a1237c9a23838ea`.
