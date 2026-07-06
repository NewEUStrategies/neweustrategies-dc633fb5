## Cel

Każdy widget formularzowy (Dołącz do nas, Formularz kontaktowy, Newsletter, Logowanie, Rejestracja, Odzyskaj hasło, Ustaw nowe hasło) dostaje spójny, w pełni edytowalny zestaw pól:

- pokaż / ukryj pole
- wymagane / opcjonalne
- edytowalna etykieta (label PL/EN)
- edytowalny placeholder PL/EN
- dodatkowe custom pola (hybryda: text / textarea / select / checkbox) - trafiają do `metadata` JSON + do CRM `aliases.custom`

Walidacja: klient + serwer (`form_field_policies` tabela + kontrakt schematu widgetu weryfikowany w server function).

## Zakres zmian

### 1. Warstwa schematów (`src/lib/builder/schemas.ts`)

Nowy helper `formFieldSchema(key, { defaultShow, defaultRequire, defaultLabelPl, defaultLabelEn })` generujący 4 wpisy: `show{Key}`, `require{Key}`, `{key}Label` (i18nText), `{key}Placeholder` (i18nText). Pogrupowane w UI edytora przez prefix `Pole: <Nazwa>`.

Nowy typ pola `formFields` (JSON array editor) - lista custom pól z: `id`, `type` (text|email|tel|textarea|select|checkbox), `labelPl/En`, `placeholderPl/En`, `required`, `options[]` (dla select). Renderowany jako lista kart w prawym panelu edytora widgetu.

Rozszerzenia schematów:
- `newsletter`: dołożone showFirstName/showLastName/showCompany + require + label + placeholder + `customFields`
- `join-us`: dołożone edytowalne `*Label` (i18nText) do wszystkich istniejących pól + `customFields`
- `contact-form`: dołożone `*Label` + `customFields`
- `login-form`: pola `email`, `password` + `showRemember/require*` + labelki + placeholders
- `register-form`: `email`, `password`, `firstName`, `lastName` + labelki/placeholders + `customFields`
- `lost-password-form`: `email` + labelki/placeholders
- `reset-password-form`: `password`, `passwordConfirm` + labelki/placeholders

### 2. Editor UI (`src/components/admin/builder/ui/molecules/SchemaFieldEditor.tsx` lub podobny)

Nowy renderer dla typu `formFields` - lista kart z: przełącznikiem `required`, selektorem typu, dwoma polami label (PL/EN), dwoma placeholder (PL/EN), edytorem opcji dla select. Reorder, dodaj, usuń.

Grupowanie pól w edytorze przez rozpoznawanie prefiksu `show*/require*/*Label/*Placeholder` w jeden collapsible "Pole: X".

### 3. Renderery form-widgetów

Dla każdego z: `JoinUsForm.tsx`, `ContactFormView.tsx`, `NewsletterForm` (nowy - obecnie inline), `LoginFormView`, `RegisterFormView`, `LostPasswordFormView`, `ResetPasswordFormView`:

- czytają z propsów per-field `show`, `require`, `label`, `placeholder` i renderują dynamicznie
- iterują po `customFields[]` i renderują odpowiedni input
- walidacja klient: zod schema budowany z konfiguracji widgetu
- wysyłka: obok znanych pól przekazują `custom` map do server function

### 4. Warstwa serwerowa

- `crm_upsert_from_form`: rozszerzone o parametr `_custom jsonb` - append do `aliases -> 'custom' -> field_id -> [...]`
- Server functions (`newsletter.functions.ts`, `contact.functions.ts`, nowa `auth.functions.ts` wrapper dla register) czytają widget schema z payload (przekazywane z klienta) i weryfikują: required, typy, długości. `form_field_policies` (istniejąca) używana jako globalny fallback / audyt.

### 5. Migracja DB

- `crm_upsert_from_form`: dodatkowy parametr `_custom jsonb default '{}'::jsonb`, logika append-only
- brak nowych tabel (custom fields żyją w widget content jako JSON)

### 6. i18n

Wszystkie stringi renderera przez `t()` z fallbackiem do wartości z widget content (PL/EN). Placeholdery: `content[keyPlaceholder_pl|_en]`.

### 7. Testy

- `tests/widgets/joinUsForm.test.tsx`: renderuje z minimalną / pełną konfiguracją, sprawdza wymagane pola i custom fields
- `tests/widgets/contactForm.test.tsx`: analogicznie
- `tests/widgets/authForms.test.tsx`: login/register/reset - custom labels + required
- `tests/lib/crm_upsert_custom.test.ts` (integracja z Supabase): custom fields append-only

## Kolejność implementacji (3 kolejne tury)

**Tura A - dzisiaj (ta tura):**
1. Rozszerzone schematy dla WSZYSTKICH 7 widgetów + typ pola `formFields` + defaults w registry
2. Migracja `crm_upsert_from_form` z `_custom`

**Tura B:**
3. `SchemaFieldEditor` obsługa `formFields` (UI karty)
4. Renderery `NewsletterForm`, `LoginFormView`, `RegisterFormView`, `LostPasswordFormView`, `ResetPasswordFormView` - wyciągnięcie do osobnych plików, obsługa nowych propsów
5. Rozszerzenie `JoinUsForm` i `ContactFormView` o custom labels + customFields

**Tura C:**
6. Server-side walidacja per-widget-schema + zapis `custom` do CRM
7. Testy (vitest)

## Ryzyka / decyzje

- Brak przełomowej zmiany typów - `WidgetContent` już akceptuje `Json[]`, więc `customFields` = tablica obiektów mieści się.
- Wsteczna kompatybilność: brak `*Label` w istniejących widgetach = fallback do domyślnych stringów z t().
- `login-form` / `register-form` idą przez Supabase Auth - custom fields NIE trafiają do `auth.users`, tylko do `profiles.metadata` + CRM.

Potwierdź podział na 3 tury albo powiedz "zrób wszystko naraz" - wtedy jedziemy sekwencyjnie w tej samej sesji (dłuższy czas odpowiedzi).