## Cel

Wszystkie publiczne formularze (newsletter + kontakt + auth-blocki) mają wyglądać i zachowywać się identycznie jak `JoinUsForm` — jedno spójne DNA pól, labeli, dropdownów, przycisków i linków w light/dark mode.

## Wzorzec referencyjny (JoinUsForm)

- **Pola tekstowe / email / tel / textarea** → `<FloatingInput as="…">` (floating label, 0.8125rem, 6px rounding, jasnoszary placeholder, `--td-input-*` respektujące Theme Design).
- **Dropdown / multiselect** → trigger `flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm` + `ChevronDown` z `rotate-180` na open + portalowany popover `rounded-lg border border-border bg-popover shadow-2xl`.
- **Przycisk submit** → `<SubscribeButton>` (bubbly, brand, `w-full sm:w-auto`) z opcjonalną `lucide` ikoną 16 px po lewej.
- **Chipy tematów** → `rounded-full border px-2.5 py-1 text-xs`, aktywny = `border-brand bg-brand text-brand-foreground`.
- **Linki (polityka, regulamin)** → `underline underline-offset-2 hover:text-brand-ink transition-colors`, respekt dark mode.
- **Consent copy** → `text-[11px] leading-relaxed text-muted-foreground`.
- **Odstępy formularza** → `space-y-3`, grid 2-kolumnowy dla imię/e-mail (`grid gap-2 sm:grid-cols-2`).

## Pliki do refaktoru

```text
src/components/NewsletterForm.tsx          (public inline / footer newsletter)
src/components/NewsletterPopupForm.tsx     (modal-owy popup)
src/components/NewsletterPopup.tsx         (host popupu — tylko linki + consent)
src/components/pages/ContactForm.tsx       (formularz kontaktowy)
src/components/blocks/ContactFormView.tsx  (CMS block „contact-form")
src/components/blocks/AuthFormBlocks.tsx   (login / register / reset w blockach)
```

## Zakres zmian per plik

1. **Wymiana natywnych `<input>` / `<Input>` / `<textarea>` na `<FloatingInput>`** (dla textarea dodam `as="textarea"` w komponencie, jeśli jeszcze go nie obsługuje).
2. **Wymiana `<Button>` / natywnych `<button type="submit">` na `<SubscribeButton>`** z identyczną ikoną i klasą szerokości.
3. **Ujednolicenie triggerów select/dropdown**: te same klasy co w `JoinUsForm` (border-border, rounded-md, chevron 16 px z rotacją).
4. **Linki (polityka / regulamin / ToS / privacy)** → wspólny helper `<FormLink>` (nowy plik `src/components/ui/form-link.tsx`) używany we wszystkich sześciu formularzach.
5. **Consent / error / helper text** → te same klasy Tailwind co w wzorcu.
6. **Kolejność i odstępy pól** → `space-y-3`, 2-kolumnowy grid dla par imię+e-mail.

## Nowy wspólny komponent

- `src/components/ui/form-link.tsx` — `<FormLink href to className>` z `underline underline-offset-2 text-brand-ink hover:opacity-80 transition-colors`. Używany wszędzie tam, gdzie w consent copy pojawia się link do polityki / regulaminu.

## Rozszerzenia istniejących komponentów

- **`FloatingInput`** — dopisany wariant `as="textarea"` z auto-rows + zachowaniem floating label (jeżeli aktualnie renderuje tylko `<input>`). Bez zmiany dotychczasowego API dla trybu `input`.

## Testy

- Snapshot / RTL test w `src/components/__tests__/formsUnified.test.tsx`:
  - `FloatingInput` znajduje się w każdym z sześciu formularzy (queries po roli + label).
  - `SubscribeButton` jest jedynym elementem submit w każdym.
  - `FormLink` renderuje `underline` klasę.
- pgTAP / RLS bez zmian (to jest wyłącznie warstwa UI).

## i18n / dark mode / a11y

- Wszystkie etykiety idą przez `useTranslation` (istniejące klucze zostają, brak nowych kluczy).
- Klasy używają wyłącznie tokenów semantycznych (`bg-background`, `text-foreground`, `border-border`, `bg-brand`, `text-brand-foreground`, `text-muted-foreground`) — dark mode działa automatycznie.
- Wszystkie inputy mają `aria-required` / `aria-invalid` gdzie trzeba; przyciski `type="submit"` + `aria-busy` w stanie loading (już w `SubscribeButton`).

## Poza zakresem (świadomie)

- Admin panele (`admin.newsletter.*`, `admin.contact.*`) — to wewnętrzne narzędzia, nie ruszamy.
- Widgety CMS builder (poza `ContactFormView` który jest publicznym rendererem).
- Backend / server functions / RLS — bez zmian.
