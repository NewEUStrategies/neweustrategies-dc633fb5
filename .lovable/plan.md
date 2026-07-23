# Bramkowanie czatu per tier + „inMail" do ekspertów

## Cel

- **Plus (`member`)**: może pisać na czacie w ekosystemie (do zaakceptowanych kontaktów), ALE nie do ekspertów - do eksperta wysyła sformalizowany „inMail" (temat, powód, pytania, oczekiwane odpowiedzi, linki).
- **Pro (`pro`) i wyżej**: może pisać DM do wszystkich, w tym do ekspertów/prelegentów.
- **Reader (`reader`) i niżej**: bez czatu (bez zmiany dla anonimowych).
- Panel admina i profil użytkownika dostają zakładkę „inMail" (tenant-scoped).

## Model danych (migracja)

1. Helper `public.is_expert_user(uuid)`:
   - `TRUE`, gdy użytkownik ma wiersz w `expert_profiles` (jest ekspertem) LUB jest przypisany jako prelegent w `event_speakers` LUB występuje w `podcast_episode_people` jako gość.
2. Rejestr feature flag na warstwach (`membership_tiers.features`):
   - `chat_enabled` - Plus i wyżej (member, pro, vip, corporate, partner, partner_general, presidents_circle, team, ngo, educator, student).
   - `chat_experts_direct` - Pro i wyżej (pro, vip, corporate, partner, partner_general, presidents_circle).
3. `public.expert_inmails` (nowa tabela):
   - kolumny: `tenant_id`, `sender_id`, `recipient_id`, `subject`, `reason`, `questions text[]`, `expected_answers text`, `external_links text[]`, `status` (`pending|approved|declined|answered`), `admin_note`, `responded_at`, `converted_conversation_id`.
   - RLS: nadawca i odbiorca widzą swoje; super_admin widzi wszystkie tego samego tenantu.
   - GRANT dla `authenticated` + `service_role`.
4. RPC `public.get_or_create_direct_conversation(p_peer_id)` - rozszerzenie:
   - odrzuca, gdy caller nie ma `chat_enabled`: `chat: tier disabled`.
   - odrzuca, gdy peer jest ekspertem i caller nie ma `chat_experts_direct`: `chat: expert requires inmail`.
5. RPC `public.send_expert_inmail(...)` i `public.resolve_expert_inmail(...)` (SECURITY DEFINER, tenant-scoped, walidacja długości pól).

## Klient

- `src/lib/billing/capabilities.ts` - dopisać `chat_enabled` i `chat_experts_direct` (`enforced: true`).
- `src/lib/chat/useChatPermissions.ts` (nowy) - `useCanDm(peerId)` → `{ canDm, requiresInmail, disabled, reason }`, oparte o profil warstw z `useMyTier` + `is_expert_user` (przez publiczne `profiles.is_expert` cache'owane w widoku, aby uniknąć N+1).
- `src/lib/chat/useInmails.ts` (nowy) - `useMyInmails()`, `useSendInmail()`, `useResolveInmail()`.
- `src/components/chat/InMailDialog.tsx` (nowy) - formularz z floating inputami (`subject`, `reason`, tablica pytań max 5, oczekiwane odpowiedzi, linki max 3), walidacja Zod, PL/EN, dark/light.
- `useStartConversation` przechwytuje błąd `chat: expert requires inmail` → otwiera `InMailDialog` (przez event/store) zamiast toastu.
- Toast dla `chat: tier disabled` → CTA „Zobacz plany" (link `/pricing`).

## UI - admin + profil

- `src/routes/admin.inmails.tsx` - lista wszystkich inmaili tenanta: filtry (status, nadawca, ekspert), drawer szczegółów, akcje: „Zatwierdź i utwórz DM", „Odrzuć", notatka wewnętrzna. Wymaga roli super_admin.
- `src/routes/profile.inmails.tsx` - dwie zakładki „Wysłane" i „Otrzymane" (ekspert widzi otrzymane), stany, opcja odpowiedzi (dla eksperta → tworzy DM z pre-fill wiadomości).
- Wpięcie w `admin.tsx` navbar oraz `ProfileNav.tsx`.

## Cennik / i18n / dokumenty

- `src/lib/i18n-pricing.ts`: nowe wiersze macierzy `chatMembers` (Plus+) i `chatExperts` (Pro+), PL/EN.
- Migracja katalogu benefitów (`apply_pricing_catalog_v5` nie dotyka features - features seedowane w `seed_pricing_defaults`): dodać jeden krok ustawiający `chat_enabled`/`chat_experts_direct` na odpowiednich progach dla wszystkich tenantów.
- `src/locales/pl.ts` / `en.ts`: klucze `chat.gate.tierDisabled`, `chat.gate.needsInmail`, `chat.inmail.*`, `admin.inmails.*`, `profile.inmails.*`.

## Szczegóły techniczne

- Wszystkie RPC są `SECURITY DEFINER` + `SET search_path = public` + `REVOKE ... FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated`.
- Tenant scoping: `sender.tenant_id = recipient.tenant_id = auth profile.tenant_id`; RLS SELECT/UPDATE ograniczone do własnego tenantu.
- Walidacja: `subject 5-140`, `reason 20-2000`, `questions[]` 1-5 pozycji × 5-500 znaków, `external_links[]` 0-3 × walidacja `https?://`.
- Zerowa regresja: bramka DM dotyczy tylko `get_or_create_direct_conversation`; RLS `messages` (raz utworzona konwersacja) nie zmienia się - inMail nie tworzy konwersacji, dopóki nie zostanie „approved".
- Testy: rozszerzyć `capabilities.test.ts` o dwie nowe flagi; dodać `tierCatalogParity` sprawdzający seed.

## Struktura zmian

```text
supabase/migrations/
  20260723170000_chat_tier_gating_and_inmails.sql   (nowe: helper, tabela, RLS, RPC, seed features)
src/lib/billing/capabilities.ts                     (rejestr + 2 flagi)
src/lib/chat/useChatPermissions.ts                  (nowy hook)
src/lib/chat/useInmails.ts                          (nowe RPC hooki)
src/components/chat/InMailDialog.tsx                (formularz inMail)
src/lib/chat/useConversations.ts                    (przechwycenie błędu → dialog)
src/routes/admin.inmails.tsx                        (panel admina)
src/routes/profile.inmails.tsx                      (skrzynka użytkownika)
src/components/admin/AdminNav.tsx                   (wpięcie)
src/components/profile/ProfileNav.tsx               (wpięcie)
src/lib/i18n-pricing.ts                             (2 nowe wiersze macierzy)
src/locales/pl.ts, en.ts                            (klucze)
```
