# Strona „O nas" — korekty treści + zbiórka biogramów Rady

> Runbook dla zespołu marketingu. Zadanie dotyczy **treści strony „O nas"**, a nie kodu
> aplikacji. Poniżej: dokładnie gdzie i co poprawić w panelu admina oraz gotowy wzór prośby
> o biogramy dla członków Rady.

---

## 0. Gdzie „mieszka" ta treść (ważne)

Karty osób na stronie „O nas" **nie są zapisane w repozytorium**. To treść tworzona w
**kreatorze stron** i przechowywana w bazie (Supabase, projekt `unnltowbgszpdzwpawdu`).
Renderuje ją widget „Team member". Dlatego wszystkich sześciu poprawek nie da się wprowadzić
jako zmiany w kodzie / commit w tej gałęzi — trzeba je zrobić w **panelu admina** (lub
udostępnić mi dostęp do bazy / wkleić aktualną treść kart, wtedy przygotuję dokładne wartości).

Karta osoby może mieć treść wpisaną **ręcznie** albo **pobraną z profilu eksperta**
(`author_profiles` + `profiles`). Jeśli karta jest powiązana z ekspertem, część pól (imię,
stanowisko, e-mail, LinkedIn, bio) pochodzi z profilu tej osoby — ręczne wpisy w karcie mają
jednak **pierwszeństwo**. Dlatego przy każdej poprawce sprawdź oba miejsca (patrz niżej).

### Gdzie klikać

- **Karta na stronie:** Admin → **Strony** → otwórz stronę **„O nas"** → w kreatorze kliknij
  daną **kartę osoby (widget „Team member")** → panel właściwości po prawej.
- **Profil eksperta (jeśli karta jest powiązana):** Admin → **Eksperci / Użytkownicy** →
  profil danej osoby.

### Nazwy pól (żeby nie było wątpliwości)

| Co widać na karcie | Pole w karcie (widget) | Odpowiednik w profilu eksperta |
|---|---|---|
| Imię i nazwisko | `name` | `profiles.display_name` |
| Rola / stanowisko | `position_pl`, `position_en` | `author_profiles.job_title` |
| E-mail | `email` | `author_profiles.contact_email` |
| LinkedIn | `linkedin` | `author_profiles.linkedin_url` / `profiles.linkedin_url` |
| Biogram | `bio_pl`, `bio_en` | `author_profiles.full_bio_pl/_en` lub `profiles.bio_pl/_en` |

---

## 1. Poprawki na stronie „O nas"

| # | Problem | Co zrobić | Pole | Potrzebna informacja |
|---|---|---|---|---|
| 1 | **Lorem Ipsum** w biogramach | Usunąć placeholder, wstawić prawdziwy biogram (Część 2) | `bio_pl` / `bio_en` | ⛔ treść biogramu (od osoby) |
| 2a | Literówka nazwiska **„Dropński"** | Poprawić na **„Dropiński"** | `name` | ✅ jednoznaczne |
| 2b | **Berent / Bernat** | Ustalić, która forma jest poprawna, i ujednolicić | `name` | ⛔ potwierdzenie, która pisownia jest prawidłowa |
| 3 | **Błędny LinkedIn** — karta linkuje do profilu **Nowaka**, a należy do **Pawlikowskiego** | Podmienić URL LinkedIn na właściwy profil Pawlikowskiego | `linkedin` | ⛔ prawidłowy URL LinkedIn Pawlikowskiego |
| 4 | **Podmienione e-maile** — Szumowski i Wójcik mają nawzajem swoje adresy | Zamienić adresy miejscami (przywrócić właściwe do właściwych osób) | `email` | ⚠️ potwierdzić, że to prosta zamiana 1↔1 |
| 5 | **Literówka w roli „Analityka"** | Poprawić na prawidłową formę | `position_pl` / `position_en` | ⛔ prawidłowa forma (np. „Analityk" / „Analityczka" — zależnie od osoby) |

**Uwaga o punktach oznaczonych ⛔:** nie wypełniam ich „na wyczucie" — nazwisko, adres URL
LinkedIn, adres e-mail i poprawna forma roli to dane, których nie da się zgadnąć bez ryzyka
wpisania błędnej informacji o realnej osobie. Podaj te wartości (albo dostęp do aktualnej
treści kart), a przygotuję dokładny, gotowy do wklejenia tekst.

**Checklista wykonania (do odhaczenia w adminie):**

- [ ] Karta z „Dropński" → „Dropiński"
- [ ] Ustalona i poprawiona pisownia Berent/Bernat
- [ ] LinkedIn Pawlikowskiego = jego własny profil (nie Nowaka)
- [ ] E-maile Szumowski ↔ Wójcik przywrócone do właściwych osób
- [ ] Rola „Analityka" poprawiona (PL i EN)
- [ ] Wszystkie „Lorem ipsum" usunięte i zastąpione biogramami (Część 2)
- [ ] Publikacja strony + sprawdzenie podglądu PL i EN

---

## 2. Zbiórka biogramów Rady

Cel: od każdego członka Rady **2–4 zdania** biogramu (PL; jeśli mają, także EN), do wstawienia
w pole `bio_pl` / `bio_en` jego karty.

### 2a. Wzór prośby (PL) — e-mail do członka Rady

> **Temat:** Prośba o krótki biogram na stronę „O nas"
>
> Szanowna Pani / Szanowny Panie [Nazwisko],
>
> aktualizujemy sekcję „O nas" na stronie NEW EU Strategies i chcielibyśmy zaprezentować
> Radę w jednolitej, profesjonalnej formie. Bardzo prosimy o **krótki biogram (2–4 zdania)**,
> który umieścimy na Pani/Pana karcie.
>
> Pomocne będzie ujęcie: obecnej roli/funkcji, kluczowego obszaru ekspertyzy oraz — jeśli
> Pani/Pan zechce — jednego istotnego osiągnięcia lub obszaru zainteresowań.
>
> Przy okazji prosimy o potwierdzenie danych do karty:
> - **Imię i nazwisko** (w formie do publikacji): …
> - **Rola / funkcja w Radzie**: …
> - **E-mail kontaktowy** (jeśli ma być widoczny): …
> - **Profil LinkedIn** (link): …
> - **Zdjęcie** (jeśli chce Pani/Pan zaktualizować): w załączniku
>
> Będziemy wdzięczni za odpowiedź **do [data]**. W razie pytań pozostajemy do dyspozycji.
>
> Z wyrazami szacunku,
> [Imię i nazwisko] · Zespół Marketingu · NEW EU Strategies
> marketing@neweuropeanstrategies.com

### 2b. Wzór prośby (EN) — dla członków anglojęzycznych

> **Subject:** Short bio for our „About us" page
>
> Dear [Name],
>
> we are refreshing the „About us" section of the NEW EU Strategies website and would like to
> present the Board in a consistent, professional way. Could you send us a **short bio (2–4
> sentences)** to place on your card?
>
> It helps to mention: your current role/function, your main area of expertise, and — if you
> wish — one notable achievement or interest.
>
> Please also confirm the card details:
> - **Full name** (as it should appear): …
> - **Role / function on the Board**: …
> - **Contact e-mail** (if it should be shown): …
> - **LinkedIn profile** (link): …
> - **Photo** (if you'd like to update it): attached
>
> We would be grateful for your reply **by [date]**. Happy to answer any questions.
>
> Kind regards,
> [Name] · Marketing Team · NEW EU Strategies
> marketing@neweuropeanstrategies.com

### 2c. Arkusz zbiórki (uzupełniać w miarę spływania odpowiedzi)

> Uzupełnij listę o pełny skład Rady. Poniżej tylko nazwiska wynikające z zadania — do
> zweryfikowania i rozszerzenia.

| Osoba | Rola (PL / EN) | E-mail (potwierdzony) | LinkedIn | Biogram 2–4 zd. (PL) | Biogram (EN) | Status |
|---|---|---|---|---|---|---|
| Pawlikowski | … | … | ⛔ właściwy URL | … | … | prośba wysłana? |
| Szumowski | … | ⚠️ zamiana z Wójcikiem | … | … | … | prośba wysłana? |
| Wójcik | … | ⚠️ zamiana z Szumowskim | … | … | … | prośba wysłana? |
| Nowak | … | … | (LinkedIn był błędnie na innej karcie) | … | … | prośba wysłana? |
| Berent / Bernat | … | … | … | … | … | ustalić pisownię |
| Dropiński | … | … | … | … | … | prośba wysłana? |
| … | … | … | … | … | … | … |

---

## 3. Jak mogę pomóc dalej

Gdy dostanę **aktualną treść kart** (zrzut/eksport lub dostęp do bazy) oraz **brakujące
wartości** (poprawny LinkedIn Pawlikowskiego, właściwe e-maile, poprawna forma roli, pisownia
Berent/Bernat) i **biogramy**, przygotuję gotowe do wklejenia teksty pól `name` / `position_*`
/ `email` / `linkedin` / `bio_*` dla każdej karty — albo, jeśli udostępnicie zapis do bazy,
naniosę poprawki bezpośrednio.
