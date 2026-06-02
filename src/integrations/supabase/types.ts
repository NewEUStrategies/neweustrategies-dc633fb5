export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_plans: {
        Row: {
          active: boolean
          created_at: string
          currency: string
          description_en: string | null
          description_pl: string | null
          id: string
          interval: Database["public"]["Enums"]["plan_interval"]
          name_en: string
          name_pl: string
          price_cents: number
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          currency?: string
          description_en?: string | null
          description_pl?: string | null
          id?: string
          interval?: Database["public"]["Enums"]["plan_interval"]
          name_en?: string
          name_pl?: string
          price_cents?: number
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          currency?: string
          description_en?: string | null
          description_pl?: string | null
          id?: string
          interval?: Database["public"]["Enums"]["plan_interval"]
          name_en?: string
          name_pl?: string
          price_cents?: number
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip: unknown
          metadata: Json | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip?: unknown
          metadata?: Json | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip?: unknown
          metadata?: Json | null
          tenant_id?: string
        }
        Relationships: []
      }
      builder_template_revisions: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          name: string
          note: string | null
          template_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          id?: string
          name: string
          note?: string | null
          template_id: string
          tenant_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          name?: string
          note?: string | null
          template_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_template_revisions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "builder_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_templates: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          name: string
          scope: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          id?: string
          name: string
          scope?: string
          tenant_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          name?: string
          scope?: string
          tenant_id?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          description_en: string | null
          description_pl: string | null
          id: string
          name_en: string
          name_pl: string
          slug: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          description_en?: string | null
          description_pl?: string | null
          id?: string
          name_en: string
          name_pl: string
          slug: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          description_en?: string | null
          description_pl?: string | null
          id?: string
          name_en?: string
          name_pl?: string
          slug?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      content_access: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["access_entity_type"]
          id: string
          mode: Database["public"]["Enums"]["access_mode"]
          one_time_currency: string | null
          one_time_price_cents: number | null
          plan_ids: string[]
          teaser_en: string | null
          teaser_pl: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["access_entity_type"]
          id?: string
          mode?: Database["public"]["Enums"]["access_mode"]
          one_time_currency?: string | null
          one_time_price_cents?: number | null
          plan_ids?: string[]
          teaser_en?: string | null
          teaser_pl?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["access_entity_type"]
          id?: string
          mode?: Database["public"]["Enums"]["access_mode"]
          one_time_currency?: string | null
          one_time_price_cents?: number | null
          plan_ids?: string[]
          teaser_en?: string | null
          teaser_pl?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      content_revisions: {
        Row: {
          author_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          note: string | null
          snapshot: Json
          tenant_id: string
        }
        Insert: {
          author_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          note?: string | null
          snapshot: Json
          tenant_id: string
        }
        Update: {
          author_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          note?: string | null
          snapshot?: Json
          tenant_id?: string
        }
        Relationships: []
      }
      media: {
        Row: {
          alt_text: string | null
          created_at: string
          deleted_at: string | null
          filename: string
          id: string
          mime_type: string | null
          public_url: string
          size_bytes: number | null
          storage_path: string
          tenant_id: string
          uploader_id: string | null
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          deleted_at?: string | null
          filename: string
          id?: string
          mime_type?: string | null
          public_url: string
          size_bytes?: number | null
          storage_path: string
          tenant_id: string
          uploader_id?: string | null
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          deleted_at?: string | null
          filename?: string
          id?: string
          mime_type?: string | null
          public_url?: string
          size_bytes?: number | null
          storage_path?: string
          tenant_id?: string
          uploader_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_settings: {
        Row: {
          description_en: string
          description_pl: string
          double_opt_in: boolean
          enabled: boolean
          heading_en: string
          heading_pl: string
          policy_html_en: string | null
          policy_html_pl: string | null
          success_message_en: string
          success_message_pl: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          description_en?: string
          description_pl?: string
          double_opt_in?: boolean
          enabled?: boolean
          heading_en?: string
          heading_pl?: string
          policy_html_en?: string | null
          policy_html_pl?: string | null
          success_message_en?: string
          success_message_pl?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          description_en?: string
          description_pl?: string
          double_opt_in?: boolean
          enabled?: boolean
          heading_en?: string
          heading_pl?: string
          policy_html_en?: string | null
          policy_html_pl?: string | null
          success_message_en?: string
          success_message_pl?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      newsletter_subscribers: {
        Row: {
          confirmation_expires_at: string | null
          confirmation_token: string | null
          confirmed_at: string | null
          created_at: string
          display_name: string | null
          email: string
          id: string
          ip: unknown
          language: string
          meta: Json | null
          source: string | null
          status: string
          tenant_id: string
          unsubscribed_at: string | null
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          confirmation_expires_at?: string | null
          confirmation_token?: string | null
          confirmed_at?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          ip?: unknown
          language?: string
          meta?: Json | null
          source?: string | null
          status?: string
          tenant_id?: string
          unsubscribed_at?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          confirmation_expires_at?: string | null
          confirmation_token?: string | null
          confirmed_at?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          ip?: unknown
          language?: string
          meta?: Json | null
          source?: string | null
          status?: string
          tenant_id?: string
          unsubscribed_at?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      pages: {
        Row: {
          author_id: string | null
          builder_data: Json | null
          content_en: string | null
          content_pl: string | null
          cover_image_url: string | null
          created_at: string
          deleted_at: string | null
          editor: Database["public"]["Enums"]["editor_type"]
          excerpt_en: string | null
          excerpt_pl: string | null
          id: string
          layout_overrides: Json | null
          menu_order: number
          parent_id: string | null
          published_at: string | null
          slug: string
          status: Database["public"]["Enums"]["post_status"]
          template_id: string | null
          tenant_id: string
          title_en: string
          title_pl: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          builder_data?: Json | null
          content_en?: string | null
          content_pl?: string | null
          cover_image_url?: string | null
          created_at?: string
          deleted_at?: string | null
          editor?: Database["public"]["Enums"]["editor_type"]
          excerpt_en?: string | null
          excerpt_pl?: string | null
          id?: string
          layout_overrides?: Json | null
          menu_order?: number
          parent_id?: string | null
          published_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["post_status"]
          template_id?: string | null
          tenant_id: string
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          builder_data?: Json | null
          content_en?: string | null
          content_pl?: string | null
          cover_image_url?: string | null
          created_at?: string
          deleted_at?: string | null
          editor?: Database["public"]["Enums"]["editor_type"]
          excerpt_en?: string | null
          excerpt_pl?: string | null
          id?: string
          layout_overrides?: Json | null
          menu_order?: number
          parent_id?: string | null
          published_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["post_status"]
          template_id?: string | null
          tenant_id?: string
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "builder_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      post_categories: {
        Row: {
          category_id: string
          post_id: string
        }
        Insert: {
          category_id: string
          post_id: string
        }
        Update: {
          category_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_categories_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_layout_settings: {
        Row: {
          audio_layout: string
          center_entry_meta: boolean
          center_header: boolean
          featured_ratio_l10: number
          featured_ratio_l11: number
          featured_ratio_l6: number
          gallery_layout: string
          has_sidebar_max_width: number
          hyperlink_color: string | null
          hyperlink_color_dark: string | null
          hyperlink_style: string
          hyperlink_underline: boolean
          image_caption_left_border: boolean
          list_style: string
          no_sidebar_max_width: number
          paragraph_spacing_rem: number
          prev_next_mobile_hide: boolean
          quick_view_info: boolean
          show_author_card: boolean
          show_bottom_newsletter: boolean
          show_post_tags_bar: boolean
          show_prev_next: boolean
          show_sources_bar: boolean
          show_via_bar: boolean
          standard_layout: string
          tenant_id: string
          underline_color: string | null
          underline_color_dark: string | null
          updated_at: string
          updated_by: string | null
          video_layout: string
          wide_align_max_width: number
        }
        Insert: {
          audio_layout?: string
          center_entry_meta?: boolean
          center_header?: boolean
          featured_ratio_l10?: number
          featured_ratio_l11?: number
          featured_ratio_l6?: number
          gallery_layout?: string
          has_sidebar_max_width?: number
          hyperlink_color?: string | null
          hyperlink_color_dark?: string | null
          hyperlink_style?: string
          hyperlink_underline?: boolean
          image_caption_left_border?: boolean
          list_style?: string
          no_sidebar_max_width?: number
          paragraph_spacing_rem?: number
          prev_next_mobile_hide?: boolean
          quick_view_info?: boolean
          show_author_card?: boolean
          show_bottom_newsletter?: boolean
          show_post_tags_bar?: boolean
          show_prev_next?: boolean
          show_sources_bar?: boolean
          show_via_bar?: boolean
          standard_layout?: string
          tenant_id?: string
          underline_color?: string | null
          underline_color_dark?: string | null
          updated_at?: string
          updated_by?: string | null
          video_layout?: string
          wide_align_max_width?: number
        }
        Update: {
          audio_layout?: string
          center_entry_meta?: boolean
          center_header?: boolean
          featured_ratio_l10?: number
          featured_ratio_l11?: number
          featured_ratio_l6?: number
          gallery_layout?: string
          has_sidebar_max_width?: number
          hyperlink_color?: string | null
          hyperlink_color_dark?: string | null
          hyperlink_style?: string
          hyperlink_underline?: boolean
          image_caption_left_border?: boolean
          list_style?: string
          no_sidebar_max_width?: number
          paragraph_spacing_rem?: number
          prev_next_mobile_hide?: boolean
          quick_view_info?: boolean
          show_author_card?: boolean
          show_bottom_newsletter?: boolean
          show_post_tags_bar?: boolean
          show_prev_next?: boolean
          show_sources_bar?: boolean
          show_via_bar?: boolean
          standard_layout?: string
          tenant_id?: string
          underline_color?: string | null
          underline_color_dark?: string | null
          updated_at?: string
          updated_by?: string | null
          video_layout?: string
          wide_align_max_width?: number
        }
        Relationships: []
      }
      post_tags: {
        Row: {
          post_id: string
          tag_id: string
        }
        Insert: {
          post_id: string
          tag_id: string
        }
        Update: {
          post_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_tags_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string | null
          blocks_data: Json | null
          builder_data: Json | null
          content_en: string | null
          content_pl: string | null
          cover_image_url: string | null
          created_at: string
          deleted_at: string | null
          editor: Database["public"]["Enums"]["editor_type"]
          excerpt_en: string | null
          excerpt_pl: string | null
          id: string
          layout_overrides: Json | null
          parent_page_id: string
          post_format: string
          published_at: string | null
          read_minutes: number | null
          slug: string
          status: Database["public"]["Enums"]["post_status"]
          takeaways_en: string[]
          takeaways_pl: string[]
          template_id: string | null
          tenant_id: string
          title_en: string
          title_pl: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          blocks_data?: Json | null
          builder_data?: Json | null
          content_en?: string | null
          content_pl?: string | null
          cover_image_url?: string | null
          created_at?: string
          deleted_at?: string | null
          editor?: Database["public"]["Enums"]["editor_type"]
          excerpt_en?: string | null
          excerpt_pl?: string | null
          id?: string
          layout_overrides?: Json | null
          parent_page_id: string
          post_format?: string
          published_at?: string | null
          read_minutes?: number | null
          slug: string
          status?: Database["public"]["Enums"]["post_status"]
          takeaways_en?: string[]
          takeaways_pl?: string[]
          template_id?: string | null
          tenant_id: string
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          blocks_data?: Json | null
          builder_data?: Json | null
          content_en?: string | null
          content_pl?: string | null
          cover_image_url?: string | null
          created_at?: string
          deleted_at?: string | null
          editor?: Database["public"]["Enums"]["editor_type"]
          excerpt_en?: string | null
          excerpt_pl?: string | null
          id?: string
          layout_overrides?: Json | null
          parent_page_id?: string
          post_format?: string
          published_at?: string | null
          read_minutes?: number | null
          slug?: string
          status?: Database["public"]["Enums"]["post_status"]
          takeaways_en?: string[]
          takeaways_pl?: string[]
          template_id?: string | null
          tenant_id?: string
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_parent_page_id_fkey"
            columns: ["parent_page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "builder_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          cover_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          prefs: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          cover_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          prefs?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          cover_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          prefs?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          id: string
          scope: string
          subject_id: string
          window_start: string
        }
        Insert: {
          count?: number
          id?: string
          scope: string
          subject_id: string
          window_start?: string
        }
        Update: {
          count?: number
          id?: string
          scope?: string
          subject_id?: string
          window_start?: string
        }
        Relationships: []
      }
      site_design_tokens: {
        Row: {
          colors: Json
          fonts: Json
          global_colors: Json
          scale: Json
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          colors?: Json
          fonts?: Json
          global_colors?: Json
          scale?: Json
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          colors?: Json
          fonts?: Json
          global_colors?: Json
          scale?: Json
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      tags: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_bookmarks: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          tenant_id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_follows: {
        Row: {
          created_at: string
          id: string
          target_id: string
          target_type: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          target_id: string
          target_type: string
          tenant_id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          target_id?: string
          target_type?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_purchases: {
        Row: {
          amount_cents: number
          currency: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["access_entity_type"]
          external_ref: string | null
          id: string
          purchased_at: string
          status: Database["public"]["Enums"]["purchase_status"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          currency?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["access_entity_type"]
          external_ref?: string | null
          id?: string
          purchased_at?: string
          status?: Database["public"]["Enums"]["purchase_status"]
          tenant_id: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          currency?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["access_entity_type"]
          external_ref?: string | null
          id?: string
          purchased_at?: string
          status?: Database["public"]["Enums"]["purchase_status"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_read_history: {
        Row: {
          id: string
          post_id: string
          read_at: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          id?: string
          post_id: string
          read_at?: string
          tenant_id?: string
          user_id: string
        }
        Update: {
          id?: string
          post_id?: string
          read_at?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_subscriptions: {
        Row: {
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          external_ref: string | null
          id: string
          plan_id: string
          started_at: string
          status: Database["public"]["Enums"]["purchase_status"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          external_ref?: string | null
          id?: string
          plan_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["purchase_status"]
          tenant_id: string
          user_id: string
        }
        Update: {
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          external_ref?: string | null
          id?: string
          plan_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["purchase_status"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "access_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      wp_import_jobs: {
        Row: {
          actor_id: string
          created_at: string
          error: string | null
          failed: number
          finished_at: string | null
          id: string
          imported: number
          language: string
          log: Json
          media_imported: number
          options: Json
          processed: number
          site: string
          skipped: number
          status: string
          tenant_id: string
          total: number
          updated_at: string
          updated_count: number
        }
        Insert: {
          actor_id: string
          created_at?: string
          error?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          imported?: number
          language?: string
          log?: Json
          media_imported?: number
          options?: Json
          processed?: number
          site: string
          skipped?: number
          status?: string
          tenant_id: string
          total?: number
          updated_at?: string
          updated_count?: number
        }
        Update: {
          actor_id?: string
          created_at?: string
          error?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          imported?: number
          language?: string
          log?: Json
          media_imported?: number
          options?: Json
          processed?: number
          site?: string
          skipped?: number
          status?: string
          tenant_id?: string
          total?: number
          updated_at?: string
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "wp_import_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_tenant_id: { Args: never; Returns: string }
      has_content_access: {
        Args: {
          _entity_id: string
          _entity_type: Database["public"]["Enums"]["access_entity_type"]
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      page_breadcrumbs: {
        Args: { _page_id: string }
        Returns: {
          depth: number
          full_path: string
          id: string
          slug: string
          title_en: string
          title_pl: string
        }[]
      }
      page_full_path: { Args: { _page_id: string }; Returns: string }
      resolve_path: {
        Args: { _segments: string[] }
        Returns: {
          page_id: string
          post_id: string
        }[]
      }
      storage_path_tenant: { Args: { _name: string }; Returns: string }
    }
    Enums: {
      access_entity_type: "post" | "page" | "media"
      access_mode: "public" | "members" | "paid"
      app_role: "admin" | "editor" | "author" | "user"
      editor_type: "richtext" | "markdown" | "builder" | "blocks"
      plan_interval: "month" | "year" | "one_time"
      post_status: "draft" | "published" | "archived"
      purchase_status: "pending" | "active" | "refunded" | "canceled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      access_entity_type: ["post", "page", "media"],
      access_mode: ["public", "members", "paid"],
      app_role: ["admin", "editor", "author", "user"],
      editor_type: ["richtext", "markdown", "builder", "blocks"],
      plan_interval: ["month", "year", "one_time"],
      post_status: ["draft", "published", "archived"],
      purchase_status: ["pending", "active", "refunded", "canceled"],
    },
  },
} as const
