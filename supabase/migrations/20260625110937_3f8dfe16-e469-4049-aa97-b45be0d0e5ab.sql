UPDATE public.pages
SET builder_data = jsonb_build_object(
  'version', 1,
  'sections', jsonb_build_array(
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'kind', 'section',
      'layout', jsonb_build_object('width', 1200, 'contentWidth', 'boxed'),
      'children', jsonb_build_array(
        jsonb_build_object(
          'id', gen_random_uuid()::text,
          'kind', 'column',
          'span', jsonb_build_object('desktop', 12),
          'children', jsonb_build_array(
            jsonb_build_object(
              'id', gen_random_uuid()::text,
              'kind', 'widget',
              'type', 'heading',
              'content', jsonb_build_object(
                'tag', 'h1',
                'text_pl', 'Logowanie członków',
                'text_en', 'Member Login',
                'variant', 'default',
                'sizePreset', 'display'
              )
            )
          )
        )
      )
    ),
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'kind', 'section',
      'layout', jsonb_build_object('width', 1200, 'contentWidth', 'boxed'),
      'children', jsonb_build_array(
        jsonb_build_object(
          'id', gen_random_uuid()::text,
          'kind', 'column',
          'span', jsonb_build_object('desktop', 12),
          'children', jsonb_build_array(
            jsonb_build_object(
              'id', gen_random_uuid()::text,
              'kind', 'widget',
              'type', 'login-form',
              'content', jsonb_build_object(
                'variant', 'card',
                'title_pl', 'Zaloguj się', 'title_en', 'Sign in',
                'subtitle_pl', 'Witaj ponownie - zaloguj się do panelu członka.',
                'subtitle_en', 'Welcome back - sign in to the member area.',
                'submitLabel_pl', 'Zaloguj', 'submitLabel_en', 'Sign in',
                'showRemember', true,
                'showShowPassword', true,
                'showForgot', true,
                'showRegister', true,
                'showOAuthGoogle', true,
                'redirectTo', '/',
                'registerHref', '/subksrybuj',
                'forgotHref', '/membership-login/password-reset'
              )
            )
          )
        )
      )
    )
  )
)
WHERE slug = 'membership-login-2';