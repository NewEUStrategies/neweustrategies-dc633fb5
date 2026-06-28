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
          badge_en: string | null
          badge_pl: string | null
          created_at: string
          currency: string
          description_en: string | null
          description_pl: string | null
          features_en: Json
          features_pl: Json
          highlighted: boolean
          id: string
          interval: Database["public"]["Enums"]["plan_interval"]
          name_en: string
          name_pl: string
          price_cents: number
          sort_order: number
          tenant_id: string
          trial_days: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          badge_en?: string | null
          badge_pl?: string | null
          created_at?: string
          currency?: string
          description_en?: string | null
          description_pl?: string | null
          features_en?: Json
          features_pl?: Json
          highlighted?: boolean
          id?: string
          interval?: Database["public"]["Enums"]["plan_interval"]
          name_en?: string
          name_pl?: string
          price_cents?: number
          sort_order?: number
          tenant_id?: string
          trial_days?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          badge_en?: string | null
          badge_pl?: string | null
          created_at?: string
          currency?: string
          description_en?: string | null
          description_pl?: string | null
          features_en?: Json
          features_pl?: Json
          highlighted?: boolean
          id?: string
          interval?: Database["public"]["Enums"]["plan_interval"]
          name_en?: string
          name_pl?: string
          price_cents?: number
          sort_order?: number
          tenant_id?: string
          trial_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      ad_placements: {
        Row: {
          active: boolean
          config: Json
          created_at: string
          ends_at: string | null
          id: string
          page_id: string | null
          page_type: Database["public"]["Enums"]["ad_page_type"]
          position: Database["public"]["Enums"]["ad_position"]
          slot_id: string
          sort_order: number
          starts_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          config?: Json
          created_at?: string
          ends_at?: string | null
          id?: string
          page_id?: string | null
          page_type?: Database["public"]["Enums"]["ad_page_type"]
          position: Database["public"]["Enums"]["ad_position"]
          slot_id: string
          sort_order?: number
          starts_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          config?: Json
          created_at?: string
          ends_at?: string | null
          id?: string
          page_id?: string | null
          page_type?: Database["public"]["Enums"]["ad_page_type"]
          position?: Database["public"]["Enums"]["ad_position"]
          slot_id?: string
          sort_order?: number
          starts_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_placements_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "ad_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_placements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_slots: {
        Row: {
          created_at: string
          height: number | null
          html: string | null
          id: string
          image_alt: string | null
          image_link: string | null
          image_url: string | null
          kind: Database["public"]["Enums"]["ad_slot_kind"]
          name: string
          notes: string | null
          requires_consent: boolean
          script: string | null
          status: Database["public"]["Enums"]["ad_slot_status"]
          targeting: Json
          tenant_id: string
          updated_at: string
          width: number | null
        }
        Insert: {
          created_at?: string
          height?: number | null
          html?: string | null
          id?: string
          image_alt?: string | null
          image_link?: string | null
          image_url?: string | null
          kind?: Database["public"]["Enums"]["ad_slot_kind"]
          name: string
          notes?: string | null
          requires_consent?: boolean
          script?: string | null
          status?: Database["public"]["Enums"]["ad_slot_status"]
          targeting?: Json
          tenant_id?: string
          updated_at?: string
          width?: number | null
        }
        Update: {
          created_at?: string
          height?: number | null
          html?: string | null
          id?: string
          image_alt?: string | null
          image_link?: string | null
          image_url?: string | null
          kind?: Database["public"]["Enums"]["ad_slot_kind"]
          name?: string
          notes?: string | null
          requires_consent?: boolean
          script?: string | null
          status?: Database["public"]["Enums"]["ad_slot_status"]
          targeting?: Json
          tenant_id?: string
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_slots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      billing_profiles: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          company: string | null
          country_code: string
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_company: boolean
          phone: string | null
          postal_code: string | null
          region: string | null
          tax_id: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          company?: string | null
          country_code?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_company?: boolean
          phone?: string | null
          postal_code?: string | null
          region?: string | null
          tax_id?: string | null
          tenant_id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          company?: string | null
          country_code?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_company?: boolean
          phone?: string | null
          postal_code?: string | null
          region?: string | null
          tax_id?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          featured_template_id: string | null
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
          featured_template_id?: string | null
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
          featured_template_id?: string | null
          id?: string
          name_en?: string
          name_pl?: string
          slug?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_featured_template_id_fkey"
            columns: ["featured_template_id"]
            isOneToOne: false
            referencedRelation: "builder_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_errors: {
        Row: {
          created_at: string
          id: string
          message: string
          meta: Json | null
          path: string | null
          source: string | null
          stack: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          meta?: Json | null
          path?: string | null
          source?: string | null
          stack?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          meta?: Json | null
          path?: string | null
          source?: string | null
          stack?: string | null
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          company: string | null
          consent: boolean
          created_at: string
          email: string
          id: string
          lang: string
          message: string
          name: string
          phone: string | null
          recipient: string | null
          status: string
          subject: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          company?: string | null
          consent?: boolean
          created_at?: string
          email: string
          id?: string
          lang?: string
          message: string
          name: string
          phone?: string | null
          recipient?: string | null
          status?: string
          subject?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          company?: string | null
          consent?: boolean
          created_at?: string
          email?: string
          id?: string
          lang?: string
          message?: string
          name?: string
          phone?: string | null
          recipient?: string | null
          status?: string
          subject?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
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
      custom_crop_sizes: {
        Row: {
          created_at: string
          height: number
          id: string
          name: string
          position: number
          ratio_h: number
          ratio_w: number
          tenant_id: string
          updated_at: string
          width: number
        }
        Insert: {
          created_at?: string
          height: number
          id?: string
          name: string
          position?: number
          ratio_h: number
          ratio_w: number
          tenant_id: string
          updated_at?: string
          width: number
        }
        Update: {
          created_at?: string
          height?: number
          id?: string
          name?: string
          position?: number
          ratio_h?: number
          ratio_w?: number
          tenant_id?: string
          updated_at?: string
          width?: number
        }
        Relationships: []
      }
      icon_library: {
        Row: {
          created_at: string
          default_variant: string
          id: string
          kind: string
          label: string | null
          name: string
          position: number
          tenant_id: string
          updated_at: string
          url_dark: string
          url_default: string
          url_light: string
        }
        Insert: {
          created_at?: string
          default_variant?: string
          id?: string
          kind: string
          label?: string | null
          name: string
          position?: number
          tenant_id: string
          updated_at?: string
          url_dark?: string
          url_default?: string
          url_light?: string
        }
        Update: {
          created_at?: string
          default_variant?: string
          id?: string
          kind?: string
          label?: string | null
          name?: string
          position?: number
          tenant_id?: string
          updated_at?: string
          url_dark?: string
          url_default?: string
          url_light?: string
        }
        Relationships: []
      }
      live_blog_entries: {
        Row: {
          block_id: string
          body_html: string
          created_at: string
          created_by: string | null
          id: string
          lang: string
          occurred_at: string
          pinned: boolean
          post_id: string
          tenant_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          block_id: string
          body_html?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lang?: string
          occurred_at?: string
          pinned?: boolean
          post_id: string
          tenant_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          block_id?: string
          body_html?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lang?: string
          occurred_at?: string
          pinned?: boolean
          post_id?: string
          tenant_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_blog_entries_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
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
          popup_accent_color: string | null
          popup_accent_text_color: string | null
          popup_bg_color: string | null
          popup_border_radius_px: number | null
          popup_cover_url: string | null
          popup_cta_en: string
          popup_cta_pl: string
          popup_delay_seconds: number
          popup_description_en: string
          popup_description_pl: string
          popup_enabled: boolean
          popup_extended_fields: boolean
          popup_eyebrow_en: string | null
          popup_eyebrow_pl: string | null
          popup_frequency_days: number
          popup_layout: string
          popup_mailing_lists: Json
          popup_muted_color: string | null
          popup_overlay_color: string | null
          popup_require_terms: boolean
          popup_scroll_percent: number
          popup_side_image_url: string | null
          popup_terms_html_en: string | null
          popup_terms_html_pl: string | null
          popup_text_color: string | null
          popup_title_en: string
          popup_title_pl: string
          popup_trigger: string
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
          popup_accent_color?: string | null
          popup_accent_text_color?: string | null
          popup_bg_color?: string | null
          popup_border_radius_px?: number | null
          popup_cover_url?: string | null
          popup_cta_en?: string
          popup_cta_pl?: string
          popup_delay_seconds?: number
          popup_description_en?: string
          popup_description_pl?: string
          popup_enabled?: boolean
          popup_extended_fields?: boolean
          popup_eyebrow_en?: string | null
          popup_eyebrow_pl?: string | null
          popup_frequency_days?: number
          popup_layout?: string
          popup_mailing_lists?: Json
          popup_muted_color?: string | null
          popup_overlay_color?: string | null
          popup_require_terms?: boolean
          popup_scroll_percent?: number
          popup_side_image_url?: string | null
          popup_terms_html_en?: string | null
          popup_terms_html_pl?: string | null
          popup_text_color?: string | null
          popup_title_en?: string
          popup_title_pl?: string
          popup_trigger?: string
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
          popup_accent_color?: string | null
          popup_accent_text_color?: string | null
          popup_bg_color?: string | null
          popup_border_radius_px?: number | null
          popup_cover_url?: string | null
          popup_cta_en?: string
          popup_cta_pl?: string
          popup_delay_seconds?: number
          popup_description_en?: string
          popup_description_pl?: string
          popup_enabled?: boolean
          popup_extended_fields?: boolean
          popup_eyebrow_en?: string | null
          popup_eyebrow_pl?: string | null
          popup_frequency_days?: number
          popup_layout?: string
          popup_mailing_lists?: Json
          popup_muted_color?: string | null
          popup_overlay_color?: string | null
          popup_require_terms?: boolean
          popup_scroll_percent?: number
          popup_side_image_url?: string | null
          popup_terms_html_en?: string | null
          popup_terms_html_pl?: string | null
          popup_text_color?: string | null
          popup_title_en?: string
          popup_title_pl?: string
          popup_trigger?: string
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
          header_override: string | null
          id: string
          layout_overrides: Json | null
          menu_order: number
          parent_id: string | null
          published_at: string | null
          slug: string
          status: Database["public"]["Enums"]["post_status"]
          template_id: string | null
          template_type: string
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
          header_override?: string | null
          id?: string
          layout_overrides?: Json | null
          menu_order?: number
          parent_id?: string | null
          published_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["post_status"]
          template_id?: string | null
          template_type?: string
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
          header_override?: string | null
          id?: string
          layout_overrides?: Json | null
          menu_order?: number
          parent_id?: string | null
          published_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["post_status"]
          template_id?: string | null
          template_type?: string
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
      payment_orders: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["access_entity_type"] | null
          id: string
          invoice_url: string | null
          kind: Database["public"]["Enums"]["order_kind"]
          metadata: Json
          paid_at: string | null
          plan_id: string | null
          provider: string
          provider_intent_id: string | null
          provider_session_id: string | null
          receipt_email: string | null
          status: Database["public"]["Enums"]["order_status"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          currency?: string
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["access_entity_type"] | null
          id?: string
          invoice_url?: string | null
          kind: Database["public"]["Enums"]["order_kind"]
          metadata?: Json
          paid_at?: string | null
          plan_id?: string | null
          provider?: string
          provider_intent_id?: string | null
          provider_session_id?: string | null
          receipt_email?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["access_entity_type"] | null
          id?: string
          invoice_url?: string | null
          kind?: Database["public"]["Enums"]["order_kind"]
          metadata?: Json
          paid_at?: string | null
          plan_id?: string | null
          provider?: string
          provider_intent_id?: string | null
          provider_session_id?: string | null
          receipt_email?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_orders_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "access_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      podcast_settings: {
        Row: {
          apple_url: string | null
          autoplay_next: boolean
          default_player_variant: string
          google_url: string | null
          rss_url: string | null
          show_speed_control: boolean
          spotify_url: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          apple_url?: string | null
          autoplay_next?: boolean
          default_player_variant?: string
          google_url?: string | null
          rss_url?: string | null
          show_speed_control?: boolean
          spotify_url?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          apple_url?: string | null
          autoplay_next?: boolean
          default_player_variant?: string
          google_url?: string | null
          rss_url?: string | null
          show_speed_control?: boolean
          spotify_url?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "podcast_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcast_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      podcasts: {
        Row: {
          audio_url: string
          author_id: string | null
          cover_image_url: string | null
          created_at: string
          deleted_at: string | null
          duration_seconds: number
          episode_number: number | null
          excerpt_en: string
          excerpt_pl: string
          id: string
          published_at: string | null
          season: number | null
          show_notes_en: string
          show_notes_pl: string
          slug: string
          status: string
          tenant_id: string
          title_en: string
          title_pl: string
          transcript_en: string
          transcript_pl: string
          updated_at: string
        }
        Insert: {
          audio_url: string
          author_id?: string | null
          cover_image_url?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number
          episode_number?: number | null
          excerpt_en?: string
          excerpt_pl?: string
          id?: string
          published_at?: string | null
          season?: number | null
          show_notes_en?: string
          show_notes_pl?: string
          slug: string
          status?: string
          tenant_id: string
          title_en?: string
          title_pl: string
          transcript_en?: string
          transcript_pl?: string
          updated_at?: string
        }
        Update: {
          audio_url?: string
          author_id?: string | null
          cover_image_url?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number
          episode_number?: number | null
          excerpt_en?: string
          excerpt_pl?: string
          id?: string
          published_at?: string | null
          season?: number | null
          show_notes_en?: string
          show_notes_pl?: string
          slug?: string
          status?: string
          tenant_id?: string
          title_en?: string
          title_pl?: string
          transcript_en?: string
          transcript_pl?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "podcasts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcasts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      post_custom_meta_defs: {
        Row: {
          created_at: string
          icon: string
          id: string
          key: string
          label_en: string
          label_pl: string
          position: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          icon?: string
          id?: string
          key: string
          label_en?: string
          label_pl?: string
          position?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          icon?: string
          id?: string
          key?: string
          label_en?: string
          label_pl?: string
          position?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      post_layout_settings: {
        Row: {
          audio_layout: string
          auto_load_next_post: boolean
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
          show_floating_share_bar: boolean
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
          auto_load_next_post?: boolean
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
          show_floating_share_bar?: boolean
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
          auto_load_next_post?: boolean
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
          show_floating_share_bar?: boolean
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
      post_sidebar_layouts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          name: string
          tenant_id: string
          updated_at: string
          widgets: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name: string
          tenant_id: string
          updated_at?: string
          widgets?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
          widgets?: Json
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
      post_views: {
        Row: {
          id: string
          post_id: string
          tenant_id: string
          user_id: string | null
          viewed_at: string
          viewer_hash: string
        }
        Insert: {
          id?: string
          post_id: string
          tenant_id: string
          user_id?: string | null
          viewed_at?: string
          viewer_hash: string
        }
        Update: {
          id?: string
          post_id?: string
          tenant_id?: string
          user_id?: string | null
          viewed_at?: string
          viewer_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_views_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_views_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          custom_meta: Json
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
          related_override: Json | null
          sidebar_layout_id: string | null
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
          custom_meta?: Json
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
          related_override?: Json | null
          sidebar_layout_id?: string | null
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
          custom_meta?: Json
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
          related_override?: Json | null
          sidebar_layout_id?: string | null
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
            foreignKeyName: "posts_sidebar_layout_id_fkey"
            columns: ["sidebar_layout_id"]
            isOneToOne: false
            referencedRelation: "post_sidebar_layouts"
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
          bio_en: string | null
          bio_pl: string | null
          cover_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          linkedin_url: string | null
          prefs: Json
          slug: string | null
          tenant_id: string
          twitter_url: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          bio_en?: string | null
          bio_pl?: string | null
          cover_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          linkedin_url?: string | null
          prefs?: Json
          slug?: string | null
          tenant_id: string
          twitter_url?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          bio_en?: string | null
          bio_pl?: string | null
          cover_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          linkedin_url?: string | null
          prefs?: Json
          slug?: string | null
          tenant_id?: string
          twitter_url?: string | null
          updated_at?: string
          website_url?: string | null
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
      related_posts_config: {
        Row: {
          after_paragraph: number
          columns: number
          created_at: string
          enabled: boolean
          items_limit: number
          layout: string
          position: string
          recency_boost_days: number
          show_cover: boolean
          show_excerpt: boolean
          show_meta: boolean
          slider_autoplay: boolean
          slider_interval_ms: number
          source_strategy: string
          tenant_id: string
          title_en: string
          title_pl: string
          updated_at: string
        }
        Insert: {
          after_paragraph?: number
          columns?: number
          created_at?: string
          enabled?: boolean
          items_limit?: number
          layout?: string
          position?: string
          recency_boost_days?: number
          show_cover?: boolean
          show_excerpt?: boolean
          show_meta?: boolean
          slider_autoplay?: boolean
          slider_interval_ms?: number
          source_strategy?: string
          tenant_id?: string
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Update: {
          after_paragraph?: number
          columns?: number
          created_at?: string
          enabled?: boolean
          items_limit?: number
          layout?: string
          position?: string
          recency_boost_days?: number
          show_cover?: boolean
          show_excerpt?: boolean
          show_meta?: boolean
          slider_autoplay?: boolean
          slider_interval_ms?: number
          source_strategy?: string
          tenant_id?: string
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "related_posts_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          tenant_id: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      tags: {
        Row: {
          created_at: string
          featured_template_id: string | null
          id: string
          name: string
          slug: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          featured_template_id?: string | null
          id?: string
          name: string
          slug: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          featured_template_id?: string | null
          id?: string
          name?: string
          slug?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_featured_template_id_fkey"
            columns: ["featured_template_id"]
            isOneToOne: false
            referencedRelation: "builder_templates"
            referencedColumns: ["id"]
          },
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
      web_stories: {
        Row: {
          author_id: string | null
          cover_url: string | null
          created_at: string
          description_en: string
          description_pl: string
          id: string
          pages: Json
          published_at: string | null
          slug: string
          status: string
          tenant_id: string
          title_en: string
          title_pl: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          cover_url?: string | null
          created_at?: string
          description_en?: string
          description_pl?: string
          id?: string
          pages?: Json
          published_at?: string | null
          slug: string
          status?: string
          tenant_id: string
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          cover_url?: string | null
          created_at?: string
          description_en?: string
          description_pl?: string
          id?: string
          pages?: Json
          published_at?: string | null
          slug?: string
          status?: string
          tenant_id?: string
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_stories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      web_vitals: {
        Row: {
          created_at: string
          id: string
          metric: string
          path: string | null
          rating: string | null
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          metric: string
          path?: string | null
          rating?: string | null
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          metric?: string
          path?: string | null
          rating?: string | null
          value?: number
        }
        Relationships: []
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
      get_entity_content: {
        Args: {
          _entity_id: string
          _entity_type: Database["public"]["Enums"]["access_entity_type"]
        }
        Returns: {
          blocks_data: Json
          builder_data: Json
          content_en: string
          content_pl: string
        }[]
      }
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
      public_tenant_id: { Args: never; Returns: string }
      record_post_view: {
        Args: { _post_id: string; _viewer_hash: string }
        Returns: undefined
      }
      resolve_path: {
        Args: { _segments: string[] }
        Returns: {
          page_id: string
          post_id: string
        }[]
      }
      search_posts: {
        Args: {
          _q: string
          _limit?: number
          _author?: string | null
          _date_from?: string | null
          _date_to?: string | null
        }
        Returns: {
          id: string
          slug: string
          title_pl: string
          title_en: string
          excerpt_pl: string | null
          excerpt_en: string | null
          cover_image_url: string | null
          published_at: string | null
          parent_page_id: string
          author_id: string | null
          rank: number
        }[]
      }
      search_quick: {
        Args: { _q: string; _limit?: number }
        Returns: {
          kind: string
          id: string
          slug: string
          title_pl: string
          title_en: string
          rank: number
        }[]
      }
      storage_path_tenant: { Args: { _name: string }; Returns: string }
      trending_posts: {
        Args: { _days?: number; _limit?: number }
        Returns: {
          cover_image_url: string
          id: string
          parent_page_id: string
          published_at: string
          slug: string
          title_en: string
          title_pl: string
          views_count: number
        }[]
      }
    }
    Enums: {
      access_entity_type: "post" | "page" | "media"
      access_mode: "public" | "members" | "paid"
      ad_page_type:
        | "all"
        | "home"
        | "post"
        | "page"
        | "category"
        | "tag"
        | "archive"
        | "search"
      ad_position:
        | "header_banner"
        | "top_of_post"
        | "mid_post"
        | "bottom_of_post"
        | "sidebar"
        | "in_feed"
        | "footer_slideup"
      ad_slot_kind: "html" | "script" | "image"
      ad_slot_status: "active" | "paused"
      app_role: "admin" | "editor" | "author" | "user"
      editor_type: "richtext" | "markdown" | "builder" | "blocks"
      order_kind: "subscription" | "one_time"
      order_status:
        | "pending"
        | "processing"
        | "paid"
        | "failed"
        | "refunded"
        | "canceled"
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
      ad_page_type: [
        "all",
        "home",
        "post",
        "page",
        "category",
        "tag",
        "archive",
        "search",
      ],
      ad_position: [
        "header_banner",
        "top_of_post",
        "mid_post",
        "bottom_of_post",
        "sidebar",
        "in_feed",
        "footer_slideup",
      ],
      ad_slot_kind: ["html", "script", "image"],
      ad_slot_status: ["active", "paused"],
      app_role: ["admin", "editor", "author", "user"],
      editor_type: ["richtext", "markdown", "builder", "blocks"],
      order_kind: ["subscription", "one_time"],
      order_status: [
        "pending",
        "processing",
        "paid",
        "failed",
        "refunded",
        "canceled",
      ],
      plan_interval: ["month", "year", "one_time"],
      post_status: ["draft", "published", "archived"],
      purchase_status: ["pending", "active", "refunded", "canceled"],
    },
  },
} as const
