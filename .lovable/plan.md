## Cel

Dodać ikonę notyfikacji obok menu konta w headerze, z rozwijaną listą po kliknięciu i pełną skrzynką użytkownika pod `/profile/notifications`. Multi-tenant: każdy widzi wyłącznie własne notyfikacje (RLS na `auth.uid()` + `tenant_id`).

## Zakres

### 1. Baza danych (migracja)

Tabela `public.notifications`:
- `id uuid PK`
- `user_id uuid` - FK do `auth.users`, ON DELETE CASCADE
- `tenant_id uuid NOT NULL` - izolacja tenantów
- `kind text` - np. `system`, `comment`, `follow`, `subscription`, `content`
- `title_pl text`, `title_en text`
- `body_pl text`, `body_en text`
- `href text` - link docelowy (np. `/posts/xyz`)
- `icon text` - nazwa ikony Lucide (opcjonalnie)
- `read_at timestamptz` - null = nieprzeczytana
- `created_at timestamptz DEFAULT now()`
- Indeks: `(user_id, tenant_id, created_at DESC)` i częściowy `WHERE read_at IS NULL`

Grants + RLS:
```
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
```
Polityki:
- SELECT: `auth.uid() = user_id AND tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())`
- UPDATE (tylko `read_at`): `auth.uid() = user_id`
- DELETE: `auth.uid() = user_id`
- INSERT: tylko `service_role` (systemowe eventy) - brak polityki dla `authenticated`

Trigger walidacyjny: przy INSERT wymusza `tenant_id` zgodny z `profiles.tenant_id` odbiorcy.

### 2. Komponenty frontendowe (atomic design)

`src/components/notifications/NotificationsBell.tsx` (molecule):
- Przycisk z ikoną `Bell` (Lucide) + badge z liczbą nieprzeczytanych
- Popover (Radix, ten sam wzorzec animacji co AccountMenu - fade+scale+slide 220ms, `sticky="always"`)
- Lista ostatnich 10 - tytuł, opis, względny czas (`Intl.RelativeTimeFormat`), ikona kind
- Akcje: "Oznacz wszystkie jako przeczytane", "Otwórz skrzynkę" -> `/profile/notifications`
- Realtime: subskrypcja Supabase channel `notifications:user_id=eq.<uid>` -> refetch + odznaczenie badge z animacją pulse

`src/lib/notifications/useNotifications.ts` (hook):
- TanStack Query: `list()`, `unreadCount()`, `markAllRead()`, `markRead(id)`, `remove(id)`
- Realtime hook `useNotificationsRealtime()`

### 3. Strona skrzynki

`src/routes/_authenticated/profile/notifications.tsx`:
- Pełna lista z filtrami: Wszystkie / Nieprzeczytane / wg kind
- Zaznacz/odznacz, usuń, "oznacz wszystkie", stronicowanie
- Empty state + i18n PL/EN

### 4. Integracja w headerze

W `AccountMenuWidget.tsx`:
- Przed przyciskiem trigger, wewnątrz tego samego kontenera flex, renderowany `<NotificationsBell />` (tylko gdy `session`)
- Dopasowanie do gap/height triggera, spójne z motywem (używa tokenów semantycznych)

### 5. i18n

Klucze w `pl.json` i `en.json`:
- `notifications.title`, `notifications.empty`, `notifications.markAllRead`, `notifications.openInbox`, `notifications.unread`, `notifications.filters.*`

### 6. Testy

- `NotificationsBell.test.tsx` - badge liczy poprawnie, popover otwiera/zamyka, mark-all-read wywołuje mutację
- `useNotifications.test.ts` - filtrowanie po tenant i kind, sortowanie po `created_at`

## Zasady techniczne

- Zero `any` / `as any`, wszędzie typy z `Database` (`src/integrations/supabase/types.ts`)
- Semantyczne tokeny motywu (`bg-popover`, `text-muted-foreground`, `--tt-*`), brak hardcoded kolorów
- Dzwonek respektuje `prefers-reduced-motion`
- Realtime subskrypcja czyszczona w `useEffect` cleanup
- Server functions: `createServerFn` + `requireSupabaseAuth` dla `markAllRead` bulk (opcjonalnie); prosty CRUD jednostkowy przez klient Supabase w hooku

## Poza zakresem tej iteracji

- Wysyłka notyfikacji e-mail
- Preferencje kanałów w profilu (kolejna iteracja - `notifications.settings`)
- Panel admina do broadcastu (dołożymy po zatwierdzeniu MVP)

## Diagram przepływu

```text
[System event] --(service_role INSERT)--> notifications
                                            |
                       realtime channel <---+
                                            |
[Browser: useNotificationsRealtime] --refetch--> Bell badge + popover
                                            |
                            klik "Otwórz skrzynkę" --> /profile/notifications
```
