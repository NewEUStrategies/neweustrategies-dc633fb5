ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'all';

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS menu_items_visibility_check;

ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_visibility_check
  CHECK (visibility IN ('all', 'guest', 'auth'));

COMMENT ON COLUMN public.menu_items.visibility IS
  'Widocznosc pozycji menu: all = wszyscy, guest = tylko niezalogowani, auth = tylko zalogowani.';