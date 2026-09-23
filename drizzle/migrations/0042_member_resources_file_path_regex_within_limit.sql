ALTER TABLE public.member_resources DROP CONSTRAINT IF EXISTS member_resources_file_path_check;
ALTER TABLE public.member_resources ADD CONSTRAINT member_resources_file_path_check
  CHECK (file_path ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{2,}$' AND char_length(file_path) <= 300);
