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
          tier_key: string | null
          trial_days: number
          updated_at: string
          volume_price_cents: number | null
          volume_threshold_seats: number | null
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
          tier_key?: string | null
          trial_days?: number
          updated_at?: string
          volume_price_cents?: number | null
          volume_threshold_seats?: number | null
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
          tier_key?: string | null
          trial_days?: number
          updated_at?: string
          volume_price_cents?: number | null
          volume_threshold_seats?: number | null
        }
        Relationships: []
      }
      ad_events: {
        Row: {
          created_at: string
          id: string
          kind: string
          path: string | null
          placement_id: string | null
          slot_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          path?: string | null
          placement_id?: string | null
          slot_id: string
          tenant_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          path?: string | null
          placement_id?: string | null
          slot_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_events_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "ad_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_events_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "ad_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      analytics_events: {
        Row: {
          anon_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_name: string
          event_type: string
          id: number
          lang: string | null
          meta: Json
          path: string | null
          referrer: string | null
          session_id: string | null
          tenant_id: string
          ua: string | null
          user_id: string | null
        }
        Insert: {
          anon_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_name: string
          event_type: string
          id?: number
          lang?: string | null
          meta?: Json
          path?: string | null
          referrer?: string | null
          session_id?: string | null
          tenant_id?: string
          ua?: string | null
          user_id?: string | null
        }
        Update: {
          anon_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_name?: string
          event_type?: string
          id?: number
          lang?: string | null
          meta?: Json
          path?: string | null
          referrer?: string | null
          session_id?: string | null
          tenant_id?: string
          ua?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      archive_layout_settings: {
        Row: {
          archive_type: string
          columns: number
          created_at: string
          hero_bg_style: string
          id: string
          layout_variant: number
          list_style: string
          posts_per_page: number
          show_breadcrumbs: boolean
          show_description: boolean
          show_featured_top: boolean
          show_follow: boolean
          show_hero: boolean
          show_podcasts: boolean
          show_related_taxonomies: boolean
          show_sidebar: boolean
          sidebar_position: string
          sidebar_widgets: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          archive_type: string
          columns?: number
          created_at?: string
          hero_bg_style?: string
          id?: string
          layout_variant?: number
          list_style?: string
          posts_per_page?: number
          show_breadcrumbs?: boolean
          show_description?: boolean
          show_featured_top?: boolean
          show_follow?: boolean
          show_hero?: boolean
          show_podcasts?: boolean
          show_related_taxonomies?: boolean
          show_sidebar?: boolean
          sidebar_position?: string
          sidebar_widgets?: Json
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          archive_type?: string
          columns?: number
          created_at?: string
          hero_bg_style?: string
          id?: string
          layout_variant?: number
          list_style?: string
          posts_per_page?: number
          show_breadcrumbs?: boolean
          show_description?: boolean
          show_featured_top?: boolean
          show_follow?: boolean
          show_hero?: boolean
          show_podcasts?: boolean
          show_related_taxonomies?: boolean
          show_sidebar?: boolean
          sidebar_position?: string
          sidebar_widgets?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "archive_layout_settings_tenant_id_fkey"
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
      auth_email_events: {
        Row: {
          action_url_host: string | null
          created_at: string
          duration_ms: number | null
          email_type: string
          error_message: string | null
          greeting_name: string | null
          id: string
          lang: string | null
          lang_fallback: boolean
          lang_raw: string | null
          lang_source: string | null
          message_id: string | null
          metadata: Json
          recipient_domain: string | null
          recipient_masked: string | null
          redirect_to: string | null
          run_id: string | null
          sender: string | null
          sender_domain: string | null
          status: string
          subject: string | null
        }
        Insert: {
          action_url_host?: string | null
          created_at?: string
          duration_ms?: number | null
          email_type: string
          error_message?: string | null
          greeting_name?: string | null
          id?: string
          lang?: string | null
          lang_fallback?: boolean
          lang_raw?: string | null
          lang_source?: string | null
          message_id?: string | null
          metadata?: Json
          recipient_domain?: string | null
          recipient_masked?: string | null
          redirect_to?: string | null
          run_id?: string | null
          sender?: string | null
          sender_domain?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          action_url_host?: string | null
          created_at?: string
          duration_ms?: number | null
          email_type?: string
          error_message?: string | null
          greeting_name?: string | null
          id?: string
          lang?: string | null
          lang_fallback?: boolean
          lang_raw?: string | null
          lang_source?: string | null
          message_id?: string | null
          metadata?: Json
          recipient_domain?: string | null
          recipient_masked?: string | null
          redirect_to?: string | null
          run_id?: string | null
          sender?: string | null
          sender_domain?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      author_profiles: {
        Row: {
          avatar_url: string | null
          bio_en: string | null
          bio_pl: string | null
          brand_accent: string | null
          brand_accent_dark: string | null
          company: string | null
          contact_email: string | null
          counterpart_lang: string | null
          counterpart_user_id: string | null
          created_at: string
          custom_socials: Json
          facebook_url: string | null
          full_bio_en: string | null
          full_bio_pl: string | null
          id: string
          instagram_url: string | null
          is_public: boolean
          job_title: string | null
          layout_overrides: Json | null
          layout_preset: string | null
          layout_section_order: string[] | null
          layout_template_id: string | null
          linkedin_url: string | null
          media_contact_email: string | null
          media_contact_name: string | null
          media_contact_phone: string | null
          org_functions: Json
          phone: string | null
          spotify_url: string | null
          tenant_id: string
          updated_at: string
          user_id: string
          website_url: string | null
          x_url: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio_en?: string | null
          bio_pl?: string | null
          brand_accent?: string | null
          brand_accent_dark?: string | null
          company?: string | null
          contact_email?: string | null
          counterpart_lang?: string | null
          counterpart_user_id?: string | null
          created_at?: string
          custom_socials?: Json
          facebook_url?: string | null
          full_bio_en?: string | null
          full_bio_pl?: string | null
          id?: string
          instagram_url?: string | null
          is_public?: boolean
          job_title?: string | null
          layout_overrides?: Json | null
          layout_preset?: string | null
          layout_section_order?: string[] | null
          layout_template_id?: string | null
          linkedin_url?: string | null
          media_contact_email?: string | null
          media_contact_name?: string | null
          media_contact_phone?: string | null
          org_functions?: Json
          phone?: string | null
          spotify_url?: string | null
          tenant_id: string
          updated_at?: string
          user_id: string
          website_url?: string | null
          x_url?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio_en?: string | null
          bio_pl?: string | null
          brand_accent?: string | null
          brand_accent_dark?: string | null
          company?: string | null
          contact_email?: string | null
          counterpart_lang?: string | null
          counterpart_user_id?: string | null
          created_at?: string
          custom_socials?: Json
          facebook_url?: string | null
          full_bio_en?: string | null
          full_bio_pl?: string | null
          id?: string
          instagram_url?: string | null
          is_public?: boolean
          job_title?: string | null
          layout_overrides?: Json | null
          layout_preset?: string | null
          layout_section_order?: string[] | null
          layout_template_id?: string | null
          linkedin_url?: string | null
          media_contact_email?: string | null
          media_contact_name?: string | null
          media_contact_phone?: string | null
          org_functions?: Json
          phone?: string | null
          spotify_url?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
          website_url?: string | null
          x_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "author_profiles_counterpart_user_id_fkey"
            columns: ["counterpart_user_id"]
            isOneToOne: false
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "author_profiles_counterpart_user_id_fkey"
            columns: ["counterpart_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "author_profiles_counterpart_user_id_fkey"
            columns: ["counterpart_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "author_profiles_layout_template_id_fkey"
            columns: ["layout_template_id"]
            isOneToOne: false
            referencedRelation: "builder_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "author_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_coupon_campaigns: {
        Row: {
          code_count: number
          code_length: number
          created_at: string
          created_by: string | null
          currency: string | null
          description: string | null
          discount_cents: number | null
          discount_kind: string
          discount_percent: number | null
          generated_count: number
          grants_duration_days: number | null
          grants_tier_key: string | null
          id: string
          max_redemptions_per_code: number | null
          metadata: Json
          name: string
          newsletter_campaign_id: string | null
          newsletter_segment: string | null
          plan_ids: string[]
          prefix: string
          status: string
          tenant_id: string
          updated_at: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          code_count: number
          code_length?: number
          created_at?: string
          created_by?: string | null
          currency?: string | null
          description?: string | null
          discount_cents?: number | null
          discount_kind: string
          discount_percent?: number | null
          generated_count?: number
          grants_duration_days?: number | null
          grants_tier_key?: string | null
          id?: string
          max_redemptions_per_code?: number | null
          metadata?: Json
          name: string
          newsletter_campaign_id?: string | null
          newsletter_segment?: string | null
          plan_ids?: string[]
          prefix?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          code_count?: number
          code_length?: number
          created_at?: string
          created_by?: string | null
          currency?: string | null
          description?: string | null
          discount_cents?: number | null
          discount_kind?: string
          discount_percent?: number | null
          generated_count?: number
          grants_duration_days?: number | null
          grants_tier_key?: string | null
          id?: string
          max_redemptions_per_code?: number | null
          metadata?: Json
          name?: string
          newsletter_campaign_id?: string | null
          newsletter_segment?: string | null
          plan_ids?: string[]
          prefix?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "b2b_coupon_campaigns_newsletter_campaign_id_fkey"
            columns: ["newsletter_campaign_id"]
            isOneToOne: false
            referencedRelation: "newsletter_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_coupon_redemptions: {
        Row: {
          applied_cents: number
          coupon_id: string
          created_at: string
          currency: string
          effects_applied_at: string | null
          id: string
          order_id: string | null
          original_cents: number
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          applied_cents: number
          coupon_id: string
          created_at?: string
          currency: string
          effects_applied_at?: string | null
          id?: string
          order_id?: string | null
          original_cents: number
          tenant_id?: string
          user_id?: string | null
        }
        Update: {
          applied_cents?: number
          coupon_id?: string
          created_at?: string
          currency?: string
          effects_applied_at?: string | null
          id?: string
          order_id?: string | null
          original_cents?: number
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "b2b_coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "b2b_coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_coupon_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_coupons: {
        Row: {
          active: boolean
          assigned_company_id: string | null
          assigned_lead_id: string | null
          campaign_id: string | null
          code: string
          created_at: string
          created_by: string | null
          currency: string | null
          description: string | null
          discount_cents: number | null
          discount_kind: string
          discount_percent: number | null
          grants_duration_days: number | null
          grants_tier_key: string | null
          id: string
          lead_score_bonus: number
          max_redemptions: number | null
          metadata: Json
          name: string | null
          newsletter_segment: string | null
          organization_id: string | null
          plan_ids: string[]
          prefix: string | null
          redemptions_count: number
          tenant_id: string
          updated_at: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          active?: boolean
          assigned_company_id?: string | null
          assigned_lead_id?: string | null
          campaign_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          description?: string | null
          discount_cents?: number | null
          discount_kind: string
          discount_percent?: number | null
          grants_duration_days?: number | null
          grants_tier_key?: string | null
          id?: string
          lead_score_bonus?: number
          max_redemptions?: number | null
          metadata?: Json
          name?: string | null
          newsletter_segment?: string | null
          organization_id?: string | null
          plan_ids?: string[]
          prefix?: string | null
          redemptions_count?: number
          tenant_id?: string
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          active?: boolean
          assigned_company_id?: string | null
          assigned_lead_id?: string | null
          campaign_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          description?: string | null
          discount_cents?: number | null
          discount_kind?: string
          discount_percent?: number | null
          grants_duration_days?: number | null
          grants_tier_key?: string | null
          id?: string
          lead_score_bonus?: number
          max_redemptions?: number | null
          metadata?: Json
          name?: string | null
          newsletter_segment?: string | null
          organization_id?: string | null
          plan_ids?: string[]
          prefix?: string | null
          redemptions_count?: number
          tenant_id?: string
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "b2b_coupons_assigned_company_id_fkey"
            columns: ["assigned_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_coupons_assigned_lead_id_fkey"
            columns: ["assigned_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "b2b_coupons_assigned_lead_id_fkey"
            columns: ["assigned_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_coupons_assigned_lead_id_fkey"
            columns: ["assigned_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_all"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_coupons_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "b2b_coupon_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_coupons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "member_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_documents: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          hosted_url: string | null
          id: string
          issued_at: string
          kind: string
          number: string | null
          order_id: string | null
          pdf_url: string | null
          provider: string
          provider_document_id: string
          status: string
          subscription_id: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          currency?: string
          hosted_url?: string | null
          id?: string
          issued_at?: string
          kind?: string
          number?: string | null
          order_id?: string | null
          pdf_url?: string | null
          provider?: string
          provider_document_id: string
          status?: string
          subscription_id?: string | null
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          hosted_url?: string | null
          id?: string
          issued_at?: string
          kind?: string
          number?: string | null
          order_id?: string | null
          pdf_url?: string | null
          provider?: string
          provider_document_id?: string
          status?: string
          subscription_id?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_documents_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "user_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      builder_experiment_events: {
        Row: {
          created_at: string
          event: Database["public"]["Enums"]["builder_experiment_event"]
          experiment_id: string
          id: string
          path: string | null
          variant: Database["public"]["Enums"]["builder_ab_variant"]
          visitor_id: string
        }
        Insert: {
          created_at?: string
          event: Database["public"]["Enums"]["builder_experiment_event"]
          experiment_id: string
          id?: string
          path?: string | null
          variant: Database["public"]["Enums"]["builder_ab_variant"]
          visitor_id: string
        }
        Update: {
          created_at?: string
          event?: Database["public"]["Enums"]["builder_experiment_event"]
          experiment_id?: string
          id?: string
          path?: string | null
          variant?: Database["public"]["Enums"]["builder_ab_variant"]
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_experiment_events_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "builder_experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_experiments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          status: Database["public"]["Enums"]["builder_experiment_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          status?: Database["public"]["Enums"]["builder_experiment_status"]
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["builder_experiment_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_experiments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_global_widgets: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          name: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_global_widgets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_popups: {
        Row: {
          builder_data: Json
          created_at: string
          created_by: string | null
          id: string
          name: string
          settings: Json
          status: Database["public"]["Enums"]["builder_popup_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          builder_data?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          settings?: Json
          status?: Database["public"]["Enums"]["builder_popup_status"]
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          builder_data?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          settings?: Json
          status?: Database["public"]["Enums"]["builder_popup_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_popups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_revisions: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          entity_id: string
          entity_type: string
          id: string
          name: string
          note: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          entity_id: string
          entity_type: string
          id?: string
          name: string
          note?: string | null
          tenant_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          entity_id?: string
          entity_type?: string
          id?: string
          name?: string
          note?: string | null
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
      career_application_events: {
        Row: {
          actor_id: string | null
          application_id: string
          created_at: string
          from_stage: Database["public"]["Enums"]["career_stage"] | null
          id: string
          note: string
          tenant_id: string
          to_stage: Database["public"]["Enums"]["career_stage"]
        }
        Insert: {
          actor_id?: string | null
          application_id: string
          created_at?: string
          from_stage?: Database["public"]["Enums"]["career_stage"] | null
          id?: string
          note?: string
          tenant_id: string
          to_stage: Database["public"]["Enums"]["career_stage"]
        }
        Update: {
          actor_id?: string | null
          application_id?: string
          created_at?: string
          from_stage?: Database["public"]["Enums"]["career_stage"] | null
          id?: string
          note?: string
          tenant_id?: string
          to_stage?: Database["public"]["Enums"]["career_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "career_application_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "career_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "career_application_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      career_applications: {
        Row: {
          created_at: string
          id: string
          message_id: string
          next_step_at: string | null
          owner_id: string | null
          rating: number | null
          rejection_reason: string
          stage: Database["public"]["Enums"]["career_stage"]
          stage_changed_at: string
          stage_note: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          next_step_at?: string | null
          owner_id?: string | null
          rating?: number | null
          rejection_reason?: string
          stage?: Database["public"]["Enums"]["career_stage"]
          stage_changed_at?: string
          stage_note?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          next_step_at?: string | null
          owner_id?: string | null
          rating?: number | null
          rejection_reason?: string
          stage?: Database["public"]["Enums"]["career_stage"]
          stage_changed_at?: string
          stage_note?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_applications_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "contact_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "career_applications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      career_cv_gc_queue: {
        Row: {
          attempts: number
          claimed_at: string | null
          enqueued_at: string
          id: string
          last_error: string | null
          path: string
          reason: string
          tenant_id: string | null
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          enqueued_at?: string
          id?: string
          last_error?: string | null
          path: string
          reason: string
          tenant_id?: string | null
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          enqueued_at?: string
          id?: string
          last_error?: string | null
          path?: string
          reason?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "career_cv_gc_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      career_page_sections: {
        Row: {
          is_visible: boolean
          key: string
          sort_order: number
          subtitle_en: string | null
          subtitle_pl: string | null
          tenant_id: string
          title_en: string | null
          title_pl: string | null
          updated_at: string
        }
        Insert: {
          is_visible?: boolean
          key: string
          sort_order?: number
          subtitle_en?: string | null
          subtitle_pl?: string | null
          tenant_id?: string
          title_en?: string | null
          title_pl?: string | null
          updated_at?: string
        }
        Update: {
          is_visible?: boolean
          key?: string
          sort_order?: number
          subtitle_en?: string | null
          subtitle_pl?: string | null
          tenant_id?: string
          title_en?: string | null
          title_pl?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_page_sections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      career_roles: {
        Row: {
          created_at: string
          department: string
          engagement: string
          id: string
          is_published: boolean
          location: string
          requirements_en: string[]
          requirements_pl: string[]
          responsibilities_en: string[]
          responsibilities_pl: string[]
          seniority: string
          slug: string
          sort_order: number
          summary_en: string
          summary_pl: string
          tenant_id: string
          title_en: string
          title_pl: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department: string
          engagement: string
          id?: string
          is_published?: boolean
          location: string
          requirements_en?: string[]
          requirements_pl?: string[]
          responsibilities_en?: string[]
          responsibilities_pl?: string[]
          seniority: string
          slug: string
          sort_order?: number
          summary_en?: string
          summary_pl?: string
          tenant_id?: string
          title_en: string
          title_pl: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department?: string
          engagement?: string
          id?: string
          is_published?: boolean
          location?: string
          requirements_en?: string[]
          requirements_pl?: string[]
          responsibilities_en?: string[]
          responsibilities_pl?: string[]
          seniority?: string
          slug?: string
          sort_order?: number
          summary_en?: string
          summary_pl?: string
          tenant_id?: string
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      career_settings: {
        Row: {
          cv_retention_days: number
          orphan_grace_hours: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cv_retention_days?: number
          orphan_grace_hours?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cv_retention_days?: number
          orphan_grace_hours?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          description_en: string | null
          description_pl: string | null
          featured_template_id: string | null
          id: string
          kind: string
          logo_url: string | null
          name_en: string
          name_pl: string
          parent_id: string | null
          slug: string
          tenant_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description_en?: string | null
          description_pl?: string | null
          featured_template_id?: string | null
          id?: string
          kind?: string
          logo_url?: string | null
          name_en: string
          name_pl: string
          parent_id?: string | null
          slug: string
          tenant_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description_en?: string | null
          description_pl?: string | null
          featured_template_id?: string | null
          id?: string
          kind?: string
          logo_url?: string | null
          name_en?: string
          name_pl?: string
          parent_id?: string | null
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
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
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
      checkout_settings: {
        Row: {
          allow_promotion_codes: boolean
          automatic_tax: boolean
          billing_address_collection: string
          invoice_creation: boolean
          tax_id_collection: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allow_promotion_codes?: boolean
          automatic_tax?: boolean
          billing_address_collection?: string
          invoice_creation?: boolean
          tax_id_collection?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allow_promotion_codes?: boolean
          automatic_tax?: boolean
          billing_address_collection?: string
          invoice_creation?: boolean
          tax_id_collection?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkout_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
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
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          meta?: Json | null
          path?: string | null
          source?: string | null
          stack?: string | null
          tenant_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          meta?: Json | null
          path?: string | null
          source?: string | null
          stack?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_errors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_anonymity_salts: {
        Row: {
          created_at: string
          salt: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          salt: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          salt?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_anonymity_salts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_applications: {
        Row: {
          admin_note: string
          availability: string
          city: string
          club_id: string | null
          company: string
          consent: boolean
          contribution: string
          country: string
          created_at: string
          crm_error: string | null
          crm_last_attempt_at: string | null
          crm_lead_id: string | null
          crm_sync_status: string
          crm_synced_at: string | null
          email: string
          expertise: string
          first_name: string
          goals: string
          id: string
          industry: string
          job_position: string
          lang: string
          languages: string
          last_name: string
          linkedin_url: string
          marketing_consent: boolean
          motivation: string
          notified_at: string | null
          notified_status: string | null
          notify_error: string | null
          phone: string
          referral_source: string
          reviewed_at: string | null
          reviewed_by: string | null
          seniority: string
          specialization_slug: string
          status: string
          tenant_id: string
          tier_key: string
          tier_rank: number
          updated_at: string
          user_id: string
          years_experience: number | null
        }
        Insert: {
          admin_note?: string
          availability?: string
          city?: string
          club_id?: string | null
          company?: string
          consent?: boolean
          contribution?: string
          country?: string
          created_at?: string
          crm_error?: string | null
          crm_last_attempt_at?: string | null
          crm_lead_id?: string | null
          crm_sync_status?: string
          crm_synced_at?: string | null
          email: string
          expertise?: string
          first_name: string
          goals?: string
          id?: string
          industry?: string
          job_position?: string
          lang?: string
          languages?: string
          last_name?: string
          linkedin_url?: string
          marketing_consent?: boolean
          motivation?: string
          notified_at?: string | null
          notified_status?: string | null
          notify_error?: string | null
          phone?: string
          referral_source?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          seniority?: string
          specialization_slug: string
          status?: string
          tenant_id: string
          tier_key?: string
          tier_rank?: number
          updated_at?: string
          user_id: string
          years_experience?: number | null
        }
        Update: {
          admin_note?: string
          availability?: string
          city?: string
          club_id?: string | null
          company?: string
          consent?: boolean
          contribution?: string
          country?: string
          created_at?: string
          crm_error?: string | null
          crm_last_attempt_at?: string | null
          crm_lead_id?: string | null
          crm_sync_status?: string
          crm_synced_at?: string | null
          email?: string
          expertise?: string
          first_name?: string
          goals?: string
          id?: string
          industry?: string
          job_position?: string
          lang?: string
          languages?: string
          last_name?: string
          linkedin_url?: string
          marketing_consent?: boolean
          motivation?: string
          notified_at?: string | null
          notified_status?: string | null
          notify_error?: string | null
          phone?: string
          referral_source?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          seniority?: string
          specialization_slug?: string
          status?: string
          tenant_id?: string
          tier_key?: string
          tier_rank?: number
          updated_at?: string
          user_id?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "club_applications_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_board_notices: {
        Row: {
          author_id: string
          body: string
          closed_at: string | null
          club_id: string
          created_at: string
          expires_at: string
          group_id: string | null
          id: string
          kind: string
          status: string
          tenant_id: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          closed_at?: string | null
          club_id: string
          created_at?: string
          expires_at?: string
          group_id?: string | null
          id?: string
          kind: string
          status?: string
          tenant_id: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          closed_at?: string | null
          club_id?: string
          created_at?: string
          expires_at?: string
          group_id?: string | null
          id?: string
          kind?: string
          status?: string
          tenant_id?: string
          topic?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_board_notices_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_board_notices_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "club_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_board_notices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_documents: {
        Row: {
          club_id: string
          created_at: string
          download_count: number
          external_url: string | null
          file_size: number | null
          file_url: string | null
          group_id: string | null
          id: string
          kind: string
          language: string
          mime_type: string | null
          pinned_at: string | null
          published_at: string | null
          slug: string
          source_label: string | null
          status: string
          summary_en: string | null
          summary_pl: string | null
          tenant_id: string
          thread_id: string | null
          title_en: string
          title_pl: string
          updated_at: string
          uploaded_by: string | null
          version: string | null
          visibility: string
        }
        Insert: {
          club_id: string
          created_at?: string
          download_count?: number
          external_url?: string | null
          file_size?: number | null
          file_url?: string | null
          group_id?: string | null
          id?: string
          kind?: string
          language?: string
          mime_type?: string | null
          pinned_at?: string | null
          published_at?: string | null
          slug: string
          source_label?: string | null
          status?: string
          summary_en?: string | null
          summary_pl?: string | null
          tenant_id: string
          thread_id?: string | null
          title_en: string
          title_pl: string
          updated_at?: string
          uploaded_by?: string | null
          version?: string | null
          visibility?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          download_count?: number
          external_url?: string | null
          file_size?: number | null
          file_url?: string | null
          group_id?: string | null
          id?: string
          kind?: string
          language?: string
          mime_type?: string | null
          pinned_at?: string | null
          published_at?: string | null
          slug?: string
          source_label?: string | null
          status?: string
          summary_en?: string | null
          summary_pl?: string | null
          tenant_id?: string
          thread_id?: string | null
          title_en?: string
          title_pl?: string
          updated_at?: string
          uploaded_by?: string | null
          version?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_documents_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_documents_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "club_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_documents_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_event_rsvps: {
        Row: {
          created_at: string
          event_id: string
          state: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          state?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          state?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "club_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_event_rsvps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_events: {
        Row: {
          all_day: boolean
          anchor_event_id: string | null
          capacity: number | null
          club_id: string
          created_at: string
          created_by: string | null
          description_en: string | null
          description_pl: string | null
          ends_at: string | null
          going_count: number
          group_id: string | null
          id: string
          kind: string
          location: string | null
          meeting_url: string | null
          min_tier_rank: number
          rsvp_enabled: boolean
          slug: string
          starts_at: string
          status: string
          tenant_id: string
          thread_id: string | null
          title_en: string
          title_pl: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          anchor_event_id?: string | null
          capacity?: number | null
          club_id: string
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          ends_at?: string | null
          going_count?: number
          group_id?: string | null
          id?: string
          kind?: string
          location?: string | null
          meeting_url?: string | null
          min_tier_rank?: number
          rsvp_enabled?: boolean
          slug: string
          starts_at: string
          status?: string
          tenant_id: string
          thread_id?: string | null
          title_en: string
          title_pl: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          anchor_event_id?: string | null
          capacity?: number | null
          club_id?: string
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          ends_at?: string | null
          going_count?: number
          group_id?: string | null
          id?: string
          kind?: string
          location?: string | null
          meeting_url?: string | null
          min_tier_rank?: number
          rsvp_enabled?: boolean
          slug?: string
          starts_at?: string
          status?: string
          tenant_id?: string
          thread_id?: string | null
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_events_anchor_event_id_fkey"
            columns: ["anchor_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_events_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "club_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_events_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_expert_pings: {
        Row: {
          created_at: string
          requested_by: string
          tenant_id: string
          thread_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          requested_by: string
          tenant_id: string
          thread_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          requested_by?: string
          tenant_id?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_expert_pings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_expert_pings_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_groups: {
        Row: {
          accent_color: string | null
          anchor_id: string | null
          anchor_type: string | null
          attribution_mode: string | null
          closes_at: string | null
          club_id: string
          created_at: string
          created_by: string | null
          description_en: string | null
          description_pl: string | null
          icon: string | null
          id: string
          last_activity_at: string | null
          min_tier_rank: number | null
          moderation_mode: string | null
          name_en: string
          name_pl: string
          opens_at: string | null
          slug: string
          sort_order: number
          status: string
          tenant_id: string
          thread_count: number
          updated_at: string
          visibility: string | null
          who_can_post: string | null
        }
        Insert: {
          accent_color?: string | null
          anchor_id?: string | null
          anchor_type?: string | null
          attribution_mode?: string | null
          closes_at?: string | null
          club_id: string
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          icon?: string | null
          id?: string
          last_activity_at?: string | null
          min_tier_rank?: number | null
          moderation_mode?: string | null
          name_en: string
          name_pl: string
          opens_at?: string | null
          slug: string
          sort_order?: number
          status?: string
          tenant_id: string
          thread_count?: number
          updated_at?: string
          visibility?: string | null
          who_can_post?: string | null
        }
        Update: {
          accent_color?: string | null
          anchor_id?: string | null
          anchor_type?: string | null
          attribution_mode?: string | null
          closes_at?: string | null
          club_id?: string
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          icon?: string | null
          id?: string
          last_activity_at?: string | null
          min_tier_rank?: number | null
          moderation_mode?: string | null
          name_en?: string
          name_pl?: string
          opens_at?: string | null
          slug?: string
          sort_order?: number
          status?: string
          tenant_id?: string
          thread_count?: number
          updated_at?: string
          visibility?: string | null
          who_can_post?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_groups_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_invitations: {
        Row: {
          club_id: string
          club_role: string
          created_at: string
          expires_at: string
          group_id: string | null
          id: string
          invitee_id: string
          inviter_id: string | null
          message: string | null
          responded_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          club_id: string
          club_role?: string
          created_at?: string
          expires_at?: string
          group_id?: string | null
          id?: string
          invitee_id: string
          inviter_id?: string | null
          message?: string | null
          responded_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          club_id?: string
          club_role?: string
          created_at?: string
          expires_at?: string
          group_id?: string | null
          id?: string
          invitee_id?: string
          inviter_id?: string | null
          message?: string | null
          responded_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_invitations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "club_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_invite_link_uses: {
        Row: {
          link_id: string
          used_at: string
          user_id: string
        }
        Insert: {
          link_id: string
          used_at?: string
          user_id: string
        }
        Update: {
          link_id?: string
          used_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_invite_link_uses_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "club_invite_links"
            referencedColumns: ["id"]
          },
        ]
      }
      club_invite_links: {
        Row: {
          club_id: string
          club_role: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          group_id: string | null
          id: string
          label: string | null
          max_uses: number | null
          requires_approval: boolean
          revoked_at: string | null
          tenant_id: string
          token: string
          used_count: number
        }
        Insert: {
          club_id: string
          club_role?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          group_id?: string | null
          id?: string
          label?: string | null
          max_uses?: number | null
          requires_approval?: boolean
          revoked_at?: string | null
          tenant_id: string
          token: string
          used_count?: number
        }
        Update: {
          club_id?: string
          club_role?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          group_id?: string | null
          id?: string
          label?: string | null
          max_uses?: number | null
          requires_approval?: boolean
          revoked_at?: string | null
          tenant_id?: string
          token?: string
          used_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "club_invite_links_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_invite_links_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "club_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_invite_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_member_expertise: {
        Row: {
          club_id: string
          created_at: string
          tenant_id: string
          topic: string
          user_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          tenant_id: string
          topic: string
          user_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          tenant_id?: string
          topic?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_member_expertise_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_member_expertise_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_member_spotlight: {
        Row: {
          blurb_en: string | null
          blurb_pl: string | null
          club_id: string
          created_at: string
          created_by: string | null
          id: string
          tenant_id: string
          updated_at: string
          user_id: string
          week_start: string
        }
        Insert: {
          blurb_en?: string | null
          blurb_pl?: string | null
          club_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
          user_id: string
          week_start: string
        }
        Update: {
          blurb_en?: string | null
          blurb_pl?: string | null
          club_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_member_spotlight_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_member_spotlight_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_members: {
        Row: {
          banned_reason: string | null
          club_id: string
          created_at: string
          id: string
          invite_source: string
          invited_by: string | null
          joined_at: string
          last_read_at: string | null
          notify_level: string
          role: string
          role_expires_at: string | null
          rules_accepted_at: string | null
          status: string
          tenant_id: string
          unread_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          banned_reason?: string | null
          club_id: string
          created_at?: string
          id?: string
          invite_source?: string
          invited_by?: string | null
          joined_at?: string
          last_read_at?: string | null
          notify_level?: string
          role?: string
          role_expires_at?: string | null
          rules_accepted_at?: string | null
          status?: string
          tenant_id: string
          unread_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          banned_reason?: string | null
          club_id?: string
          created_at?: string
          id?: string
          invite_source?: string
          invited_by?: string | null
          joined_at?: string
          last_read_at?: string | null
          notify_level?: string
          role?: string
          role_expires_at?: string | null
          rules_accepted_at?: string | null
          status?: string
          tenant_id?: string
          unread_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_members_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_milestones: {
        Row: {
          club_id: string
          created_at: string
          created_by: string | null
          description_en: string | null
          description_pl: string | null
          due_on: string | null
          id: string
          order_index: number
          progress: number
          slug: string
          starts_on: string | null
          state: string
          tenant_id: string
          thread_id: string | null
          title_en: string
          title_pl: string
          updated_at: string
        }
        Insert: {
          club_id: string
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          due_on?: string | null
          id?: string
          order_index?: number
          progress?: number
          slug: string
          starts_on?: string | null
          state?: string
          tenant_id: string
          thread_id?: string | null
          title_en: string
          title_pl: string
          updated_at?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          due_on?: string | null
          id?: string
          order_index?: number
          progress?: number
          slug?: string
          starts_on?: string | null
          state?: string
          tenant_id?: string
          thread_id?: string | null
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_milestones_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_milestones_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_milestones_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_moderation_log: {
        Row: {
          action: string
          club_id: string
          created_at: string
          id: string
          moderator_id: string | null
          reason: string | null
          target_id: string
          target_type: string
          tenant_id: string
        }
        Insert: {
          action: string
          club_id: string
          created_at?: string
          id?: string
          moderator_id?: string | null
          reason?: string | null
          target_id: string
          target_type: string
          tenant_id: string
        }
        Update: {
          action?: string
          club_id?: string
          created_at?: string
          id?: string
          moderator_id?: string | null
          reason?: string | null
          target_id?: string
          target_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_moderation_log_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_moderation_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_post_likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "club_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      club_posts: {
        Row: {
          attachments: Json
          author_id: string | null
          body: string
          club_id: string
          created_at: string
          edited_at: string | null
          group_id: string | null
          id: string
          like_count: number
          status: string
          tenant_id: string
          thread_id: string | null
          updated_at: string
        }
        Insert: {
          attachments?: Json
          author_id?: string | null
          body?: string
          club_id: string
          created_at?: string
          edited_at?: string | null
          group_id?: string | null
          id?: string
          like_count?: number
          status?: string
          tenant_id: string
          thread_id?: string | null
          updated_at?: string
        }
        Update: {
          attachments?: Json
          author_id?: string | null
          body?: string
          club_id?: string
          created_at?: string
          edited_at?: string | null
          group_id?: string | null
          id?: string
          like_count?: number
          status?: string
          tenant_id?: string
          thread_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_posts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_posts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "club_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_posts_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_reactions: {
        Row: {
          club_id: string
          created_at: string
          id: string
          kind: string
          target_id: string
          target_type: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          id?: string
          kind: string
          target_id: string
          target_type: string
          tenant_id: string
          user_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          id?: string
          kind?: string
          target_id?: string
          target_type?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_reactions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_reactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_replies: {
        Row: {
          author_id: string | null
          body: string
          club_id: string
          created_at: string
          depth: number
          edit_count: number
          edited_at: string | null
          id: string
          is_anonymous: boolean
          parent_id: string | null
          posted_by_admin_id: string | null
          reaction_count: number
          search_vector: unknown
          status: string
          tenant_id: string
          thread_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          club_id: string
          created_at?: string
          depth?: number
          edit_count?: number
          edited_at?: string | null
          id?: string
          is_anonymous?: boolean
          parent_id?: string | null
          posted_by_admin_id?: string | null
          reaction_count?: number
          search_vector?: unknown
          status?: string
          tenant_id: string
          thread_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          club_id?: string
          created_at?: string
          depth?: number
          edit_count?: number
          edited_at?: string | null
          id?: string
          is_anonymous?: boolean
          parent_id?: string | null
          posted_by_admin_id?: string | null
          reaction_count?: number
          search_vector?: unknown
          status?: string
          tenant_id?: string
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_replies_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_replies_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "club_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_replies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_replies_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_segment_rules: {
        Row: {
          club_id: string
          club_role: string
          created_at: string
          created_by: string | null
          id: string
          last_run_at: string | null
          last_sent: number
          name: string
          rule: Json
          tenant_id: string
        }
        Insert: {
          club_id: string
          club_role?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_run_at?: string | null
          last_sent?: number
          name: string
          rule?: Json
          tenant_id: string
        }
        Update: {
          club_id?: string
          club_role?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_run_at?: string | null
          last_sent?: number
          name?: string
          rule?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_segment_rules_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_segment_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_specializations: {
        Row: {
          created_at: string
          desc_en: string | null
          desc_pl: string | null
          icon: string
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          label_en: string
          label_pl: string
          lead_en: string | null
          lead_pl: string | null
          slug: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          desc_en?: string | null
          desc_pl?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          label_en: string
          label_pl: string
          lead_en?: string | null
          lead_pl?: string | null
          slug: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          desc_en?: string | null
          desc_pl?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          label_en?: string
          label_pl?: string
          lead_en?: string | null
          lead_pl?: string | null
          slug?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      club_stances: {
        Row: {
          club_id: string
          created_at: string
          id: string
          rationale: string | null
          stance: string
          tenant_id: string
          thread_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          id?: string
          rationale?: string | null
          stance: string
          tenant_id: string
          thread_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          id?: string
          rationale?: string | null
          stance?: string
          tenant_id?: string
          thread_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_stances_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_stances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_stances_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_thread_documents: {
        Row: {
          added_by: string | null
          byte_size: number | null
          club_id: string
          created_at: string
          description: string | null
          id: string
          is_primary: boolean
          kind: string
          mime_type: string | null
          published_on: string | null
          search_vector: unknown
          sort_order: number
          source_label: string | null
          status: string
          tenant_id: string
          thread_id: string
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          added_by?: string | null
          byte_size?: number | null
          club_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_primary?: boolean
          kind?: string
          mime_type?: string | null
          published_on?: string | null
          search_vector?: unknown
          sort_order?: number
          source_label?: string | null
          status?: string
          tenant_id: string
          thread_id: string
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          added_by?: string | null
          byte_size?: number | null
          club_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_primary?: boolean
          kind?: string
          mime_type?: string | null
          published_on?: string | null
          search_vector?: unknown
          sort_order?: number
          source_label?: string | null
          status?: string
          tenant_id?: string
          thread_id?: string
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_thread_documents_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_documents_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_thread_embeddings: {
        Row: {
          embedding: string | null
          source_hash: string | null
          tenant_id: string
          thread_id: string
          updated_at: string
        }
        Insert: {
          embedding?: string | null
          source_hash?: string | null
          tenant_id: string
          thread_id: string
          updated_at?: string
        }
        Update: {
          embedding?: string | null
          source_hash?: string | null
          tenant_id?: string
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_thread_embeddings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_embeddings_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: true
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_thread_links: {
        Row: {
          club_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          related_thread_id: string
          relation: string
          tenant_id: string
          thread_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          related_thread_id: string
          relation?: string
          tenant_id: string
          thread_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          related_thread_id?: string
          relation?: string
          tenant_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_thread_links_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_links_related_thread_id_fkey"
            columns: ["related_thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_links_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_thread_milestones: {
        Row: {
          all_day: boolean
          club_id: string
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          event_id: string | null
          id: string
          kind: string
          location: string | null
          owner_id: string | null
          search_vector: unknown
          sort_order: number
          starts_at: string
          status: string
          tenant_id: string
          thread_id: string
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          all_day?: boolean
          club_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          event_id?: string | null
          id?: string
          kind?: string
          location?: string | null
          owner_id?: string | null
          search_vector?: unknown
          sort_order?: number
          starts_at: string
          status?: string
          tenant_id: string
          thread_id: string
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          all_day?: boolean
          club_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          event_id?: string | null
          id?: string
          kind?: string
          location?: string | null
          owner_id?: string | null
          search_vector?: unknown
          sort_order?: number
          starts_at?: string
          status?: string
          tenant_id?: string
          thread_id?: string
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_thread_milestones_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_milestones_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_milestones_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_milestones_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_thread_polls: {
        Row: {
          club_id: string
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          poll_id: string
          sort_order: number
          tenant_id: string
          thread_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          poll_id: string
          sort_order?: number
          tenant_id: string
          thread_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          poll_id?: string
          sort_order?: number
          tenant_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_thread_polls_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_polls_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_polls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_polls_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_thread_question_votes: {
        Row: {
          created_at: string
          question_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          question_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          question_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_thread_question_votes_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "club_thread_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_question_votes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_thread_questions: {
        Row: {
          answer_body: string | null
          answered_at: string | null
          answered_by: string | null
          author_id: string | null
          body: string
          club_id: string
          created_at: string
          id: string
          is_anonymous: boolean
          search_vector: unknown
          status: string
          tenant_id: string
          thread_id: string
          updated_at: string
          vote_count: number
        }
        Insert: {
          answer_body?: string | null
          answered_at?: string | null
          answered_by?: string | null
          author_id?: string | null
          body: string
          club_id: string
          created_at?: string
          id?: string
          is_anonymous?: boolean
          search_vector?: unknown
          status?: string
          tenant_id: string
          thread_id: string
          updated_at?: string
          vote_count?: number
        }
        Update: {
          answer_body?: string | null
          answered_at?: string | null
          answered_by?: string | null
          author_id?: string | null
          body?: string
          club_id?: string
          created_at?: string
          id?: string
          is_anonymous?: boolean
          search_vector?: unknown
          status?: string
          tenant_id?: string
          thread_id?: string
          updated_at?: string
          vote_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "club_thread_questions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_questions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_thread_questions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_thread_subscriptions: {
        Row: {
          created_at: string
          state: string
          thread_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          state?: string
          thread_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          state?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_thread_subscriptions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "club_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      club_threads: {
        Row: {
          anchor_id: string | null
          anchor_type: string | null
          attribution_mode: string | null
          author_id: string | null
          body: string
          club_id: string
          created_at: string
          edit_count: number
          edited_at: string | null
          group_id: string
          hotness: number
          icon: string | null
          id: string
          is_anonymous: boolean
          kind: string
          last_reply_at: string | null
          locked_at: string | null
          participant_count: number
          pinned_at: string | null
          poll_id: string | null
          posted_by_admin_id: string | null
          reaction_count: number
          reply_count: number
          resolved_reply_id: string | null
          search_vector: unknown
          slug: string
          status: string
          tenant_id: string
          title: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          anchor_id?: string | null
          anchor_type?: string | null
          attribution_mode?: string | null
          author_id?: string | null
          body: string
          club_id: string
          created_at?: string
          edit_count?: number
          edited_at?: string | null
          group_id: string
          hotness?: number
          icon?: string | null
          id?: string
          is_anonymous?: boolean
          kind?: string
          last_reply_at?: string | null
          locked_at?: string | null
          participant_count?: number
          pinned_at?: string | null
          poll_id?: string | null
          posted_by_admin_id?: string | null
          reaction_count?: number
          reply_count?: number
          resolved_reply_id?: string | null
          search_vector?: unknown
          slug: string
          status?: string
          tenant_id: string
          title: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          anchor_id?: string | null
          anchor_type?: string | null
          attribution_mode?: string | null
          author_id?: string | null
          body?: string
          club_id?: string
          created_at?: string
          edit_count?: number
          edited_at?: string | null
          group_id?: string
          hotness?: number
          icon?: string | null
          id?: string
          is_anonymous?: boolean
          kind?: string
          last_reply_at?: string | null
          locked_at?: string | null
          participant_count?: number
          pinned_at?: string | null
          poll_id?: string | null
          posted_by_admin_id?: string | null
          reaction_count?: number
          reply_count?: number
          resolved_reply_id?: string | null
          search_vector?: unknown
          slug?: string
          status?: string
          tenant_id?: string
          title?: string
          topic?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_threads_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_threads_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "club_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_threads_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_threads_resolved_reply_fk"
            columns: ["resolved_reply_id"]
            isOneToOne: false
            referencedRelation: "club_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_threads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      club_topics: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          label_en: string
          label_pl: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          label_en: string
          label_pl: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          label_en?: string
          label_pl?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      clubs: {
        Row: {
          accent_color: string | null
          attribution_mode: string
          cover_image_url: string | null
          created_at: string
          created_by: string | null
          description_en: string | null
          description_pl: string | null
          group_count: number
          icon: string
          id: string
          join_policy: string
          last_activity_at: string | null
          layout: string
          member_count: number
          min_tier_rank: number
          moderation_mode: string
          name_en: string
          name_pl: string
          policy_area: string | null
          rules_en: string | null
          rules_pl: string | null
          slug: string
          specialization_slug: string | null
          status: string
          tagline_en: string | null
          tagline_pl: string | null
          tenant_id: string
          thread_count: number
          updated_at: string
          visibility: string
          who_can_post: string
        }
        Insert: {
          accent_color?: string | null
          attribution_mode?: string
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          group_count?: number
          icon?: string
          id?: string
          join_policy?: string
          last_activity_at?: string | null
          layout?: string
          member_count?: number
          min_tier_rank?: number
          moderation_mode?: string
          name_en: string
          name_pl: string
          policy_area?: string | null
          rules_en?: string | null
          rules_pl?: string | null
          slug: string
          specialization_slug?: string | null
          status?: string
          tagline_en?: string | null
          tagline_pl?: string | null
          tenant_id: string
          thread_count?: number
          updated_at?: string
          visibility?: string
          who_can_post?: string
        }
        Update: {
          accent_color?: string | null
          attribution_mode?: string
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          group_count?: number
          icon?: string
          id?: string
          join_policy?: string
          last_activity_at?: string | null
          layout?: string
          member_count?: number
          min_tier_rank?: number
          moderation_mode?: string
          name_en?: string
          name_pl?: string
          policy_area?: string | null
          rules_en?: string | null
          rules_pl?: string | null
          slug?: string
          specialization_slug?: string | null
          status?: string
          tagline_en?: string | null
          tagline_pl?: string | null
          tenant_id?: string
          thread_count?: number
          updated_at?: string
          visibility?: string
          who_can_post?: string
        }
        Relationships: [
          {
            foreignKeyName: "clubs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      command_idempotency: {
        Row: {
          actor_id: string | null
          command: string
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          idempotency_key: string
          result: Json | null
          status: string
          tenant_id: string
        }
        Insert: {
          actor_id?: string | null
          command: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          idempotency_key: string
          result?: Json | null
          status?: string
          tenant_id: string
        }
        Update: {
          actor_id?: string | null
          command?: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          idempotency_key?: string
          result?: Json | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "command_idempotency_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_name: string | null
          body: string
          created_at: string
          edited_at: string | null
          id: string
          parent_id: string | null
          post_id: string
          status: string
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          author_name?: string | null
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          post_id: string
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          author_name?: string | null
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          post_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      connection_suggestion_dismissals: {
        Row: {
          created_at: string
          dismissed_user_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dismissed_user_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          dismissed_user_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connection_suggestion_dismissals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_form_settings: {
        Row: {
          auto_reply_body_en: string
          auto_reply_body_pl: string
          auto_reply_enabled: boolean
          auto_reply_subject_en: string
          auto_reply_subject_pl: string
          created_at: string
          default_recipient: string | null
          from_address: string | null
          from_name: string | null
          newsletter_double_optin: boolean
          notify_admin_enabled: boolean
          notify_admin_subject_en: string
          notify_admin_subject_pl: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auto_reply_body_en?: string
          auto_reply_body_pl?: string
          auto_reply_enabled?: boolean
          auto_reply_subject_en?: string
          auto_reply_subject_pl?: string
          created_at?: string
          default_recipient?: string | null
          from_address?: string | null
          from_name?: string | null
          newsletter_double_optin?: boolean
          notify_admin_enabled?: boolean
          notify_admin_subject_en?: string
          notify_admin_subject_pl?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auto_reply_body_en?: string
          auto_reply_body_pl?: string
          auto_reply_enabled?: boolean
          auto_reply_subject_en?: string
          auto_reply_subject_pl?: string
          created_at?: string
          default_recipient?: string | null
          from_address?: string | null
          from_name?: string | null
          newsletter_double_optin?: boolean
          notify_admin_enabled?: boolean
          notify_admin_subject_en?: string
          notify_admin_subject_pl?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_form_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          archived_at: string | null
          assigned_to: string | null
          company: string | null
          confirmation_sent_at: string | null
          consent: boolean
          consents: Json
          created_at: string
          custom: Json
          email: string
          first_name: string | null
          form_id: string | null
          form_name: string | null
          form_type: string
          id: string
          ip: string | null
          lang: string
          last_name: string | null
          message: string
          name: string
          newsletter_opt_in: boolean
          page_url: string | null
          phone: string | null
          read_at: string | null
          recipient: string | null
          referer: string | null
          source: string | null
          status: string
          subject: string | null
          tags: string[]
          tenant_id: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          archived_at?: string | null
          assigned_to?: string | null
          company?: string | null
          confirmation_sent_at?: string | null
          consent?: boolean
          consents?: Json
          created_at?: string
          custom?: Json
          email: string
          first_name?: string | null
          form_id?: string | null
          form_name?: string | null
          form_type?: string
          id?: string
          ip?: string | null
          lang?: string
          last_name?: string | null
          message: string
          name: string
          newsletter_opt_in?: boolean
          page_url?: string | null
          phone?: string | null
          read_at?: string | null
          recipient?: string | null
          referer?: string | null
          source?: string | null
          status?: string
          subject?: string | null
          tags?: string[]
          tenant_id?: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          archived_at?: string | null
          assigned_to?: string | null
          company?: string | null
          confirmation_sent_at?: string | null
          consent?: boolean
          consents?: Json
          created_at?: string
          custom?: Json
          email?: string
          first_name?: string | null
          form_id?: string | null
          form_name?: string | null
          form_type?: string
          id?: string
          ip?: string | null
          lang?: string
          last_name?: string | null
          message?: string
          name?: string
          newsletter_opt_in?: boolean
          page_url?: string | null
          phone?: string | null
          read_at?: string | null
          recipient?: string | null
          referer?: string | null
          source?: string | null
          status?: string
          subject?: string | null
          tags?: string[]
          tenant_id?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      content_access: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["access_entity_type"]
          id: string
          metering_policy: string
          min_tier_rank: number
          mode: Database["public"]["Enums"]["access_mode"]
          one_time_currency: string | null
          one_time_price_cents: number | null
          password_hash: string | null
          password_hint_en: string | null
          password_hint_pl: string | null
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
          metering_policy?: string
          min_tier_rank?: number
          mode?: Database["public"]["Enums"]["access_mode"]
          one_time_currency?: string | null
          one_time_price_cents?: number | null
          password_hash?: string | null
          password_hint_en?: string | null
          password_hint_pl?: string | null
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
          metering_policy?: string
          min_tier_rank?: number
          mode?: Database["public"]["Enums"]["access_mode"]
          one_time_currency?: string | null
          one_time_price_cents?: number | null
          password_hash?: string | null
          password_hint_en?: string | null
          password_hint_pl?: string | null
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
      contributor_submissions: {
        Row: {
          created_at: string
          editor_note: string | null
          id: string
          language: string
          pitch: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          editor_note?: string | null
          id?: string
          language?: string
          pitch: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tenant_id?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          editor_note?: string | null
          id?: string
          language?: string
          pitch?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contributor_submissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_nicknames: {
        Row: {
          conversation_id: string
          created_at: string
          nickname: string
          set_by: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          nickname: string
          set_by?: string | null
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          nickname?: string
          set_by?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_nicknames_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_nicknames_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          archived_at: string | null
          cleared_before: string | null
          conversation_id: string
          created_at: string
          id: string
          last_delivered_at: string | null
          last_read_at: string | null
          muted_until: string | null
          pinned_at: string | null
          role: string
          tenant_id: string
          unread_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          cleared_before?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          last_delivered_at?: string | null
          last_read_at?: string | null
          muted_until?: string | null
          pinned_at?: string | null
          role?: string
          tenant_id: string
          unread_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          cleared_before?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          last_delivered_at?: string | null
          last_read_at?: string | null
          muted_until?: string | null
          pinned_at?: string | null
          role?: string
          tenant_id?: string
          unread_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          direct_key: string | null
          id: string
          kind: string
          last_message_at: string | null
          last_message_kind: string | null
          last_message_preview: string | null
          last_message_sender: string | null
          message_ttl_seconds: number | null
          quick_emoji: string | null
          tenant_id: string
          theme: string | null
          title: string | null
          updated_at: string
          wallpaper: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          direct_key?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          last_message_kind?: string | null
          last_message_preview?: string | null
          last_message_sender?: string | null
          message_ttl_seconds?: number | null
          quick_emoji?: string | null
          tenant_id: string
          theme?: string | null
          title?: string | null
          updated_at?: string
          wallpaper?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          direct_key?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          last_message_kind?: string | null
          last_message_preview?: string | null
          last_message_sender?: string | null
          message_ttl_seconds?: number | null
          quick_emoji?: string | null
          tenant_id?: string
          theme?: string | null
          title?: string | null
          updated_at?: string
          wallpaper?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_companies: {
        Row: {
          address: string | null
          aliases: Json
          branch: string | null
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          domain: string | null
          id: string
          logo_url: string | null
          name: string
          name_norm: string | null
          phone: string | null
          postal_code: string | null
          tenant_id: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          aliases?: Json
          branch?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          domain?: string | null
          id?: string
          logo_url?: string | null
          name: string
          name_norm?: string | null
          phone?: string | null
          postal_code?: string | null
          tenant_id: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          aliases?: Json
          branch?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          domain?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          name_norm?: string | null
          phone?: string | null
          postal_code?: string | null
          tenant_id?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      crm_consent_log: {
        Row: {
          consent_key: string
          consent_text: string
          consent_version: string | null
          created_at: string
          email: string
          form_id: string | null
          form_name: string | null
          given: boolean
          id: string
          ip: string | null
          lang: string | null
          source_id: string | null
          source_type: Database["public"]["Enums"]["crm_source_type"]
          tenant_id: string
          user_agent: string | null
        }
        Insert: {
          consent_key: string
          consent_text: string
          consent_version?: string | null
          created_at?: string
          email: string
          form_id?: string | null
          form_name?: string | null
          given: boolean
          id?: string
          ip?: string | null
          lang?: string | null
          source_id?: string | null
          source_type: Database["public"]["Enums"]["crm_source_type"]
          tenant_id?: string
          user_agent?: string | null
        }
        Update: {
          consent_key?: string
          consent_text?: string
          consent_version?: string | null
          created_at?: string
          email?: string
          form_id?: string | null
          form_name?: string | null
          given?: boolean
          id?: string
          ip?: string | null
          lang?: string | null
          source_id?: string | null
          source_type?: Database["public"]["Enums"]["crm_source_type"]
          tenant_id?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      crm_integrations: {
        Row: {
          consent_mapping: Json
          created_at: string
          forward_stages: Database["public"]["Enums"]["crm_stage"][]
          id: string
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          merydian_api_base: string | null
          merydian_api_key_id: string | null
          merydian_enabled: boolean
          merydian_mode: string
          merydian_webhook_secret_id: string | null
          merydian_webhook_url: string | null
          merydian_workspace_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          consent_mapping?: Json
          created_at?: string
          forward_stages?: Database["public"]["Enums"]["crm_stage"][]
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          merydian_api_base?: string | null
          merydian_api_key_id?: string | null
          merydian_enabled?: boolean
          merydian_mode?: string
          merydian_webhook_secret_id?: string | null
          merydian_webhook_url?: string | null
          merydian_workspace_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          consent_mapping?: Json
          created_at?: string
          forward_stages?: Database["public"]["Enums"]["crm_stage"][]
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          merydian_api_base?: string | null
          merydian_api_key_id?: string | null
          merydian_enabled?: boolean
          merydian_mode?: string
          merydian_webhook_secret_id?: string | null
          merydian_webhook_url?: string | null
          merydian_workspace_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_lead_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          is_internal: boolean
          lead_id: string
          tenant_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          is_internal?: boolean
          lead_id: string
          tenant_id?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          lead_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "crm_lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_all"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_leads: {
        Row: {
          aliases: Json
          club_application_count: number
          club_applied_at: string | null
          club_specializations: string[]
          company: string | null
          company_id: string | null
          country: string | null
          created_at: string
          email: string
          email_norm: string
          first_name: string | null
          follow_up_at: string | null
          id: string
          last_activity_at: string
          last_name: string | null
          linkedin_url: string | null
          marketing_consent: boolean
          newsletter_status: string | null
          owner_id: string | null
          phone: string | null
          phone_norm: string | null
          position: string | null
          score: number
          score_band: string
          score_breakdown: Json
          score_updated_at: string | null
          source_count: number
          source_type: string
          stage: Database["public"]["Enums"]["crm_stage"]
          tags: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          aliases?: Json
          club_application_count?: number
          club_applied_at?: string | null
          club_specializations?: string[]
          company?: string | null
          company_id?: string | null
          country?: string | null
          created_at?: string
          email: string
          email_norm: string
          first_name?: string | null
          follow_up_at?: string | null
          id?: string
          last_activity_at?: string
          last_name?: string | null
          linkedin_url?: string | null
          marketing_consent?: boolean
          newsletter_status?: string | null
          owner_id?: string | null
          phone?: string | null
          phone_norm?: string | null
          position?: string | null
          score?: number
          score_band?: string
          score_breakdown?: Json
          score_updated_at?: string | null
          source_count?: number
          source_type?: string
          stage?: Database["public"]["Enums"]["crm_stage"]
          tags?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          aliases?: Json
          club_application_count?: number
          club_applied_at?: string | null
          club_specializations?: string[]
          company?: string | null
          company_id?: string | null
          country?: string | null
          created_at?: string
          email?: string
          email_norm?: string
          first_name?: string | null
          follow_up_at?: string | null
          id?: string
          last_activity_at?: string
          last_name?: string | null
          linkedin_url?: string | null
          marketing_consent?: boolean
          newsletter_status?: string | null
          owner_id?: string | null
          phone?: string | null
          phone_norm?: string | null
          position?: string | null
          score?: number
          score_band?: string
          score_breakdown?: Json
          score_updated_at?: string | null
          source_count?: number
          source_type?: string
          stage?: Database["public"]["Enums"]["crm_stage"]
          tags?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_scoring_settings: {
        Row: {
          cool_threshold: number
          enabled: boolean
          half_life_days: number
          horizon_days: number
          hot_threshold: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
          warm_threshold: number
          weights: Json
        }
        Insert: {
          cool_threshold?: number
          enabled?: boolean
          half_life_days?: number
          horizon_days?: number
          hot_threshold?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          warm_threshold?: number
          weights?: Json
        }
        Update: {
          cool_threshold?: number
          enabled?: boolean
          half_life_days?: number
          horizon_days?: number
          hot_threshold?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          warm_threshold?: number
          weights?: Json
        }
        Relationships: [
          {
            foreignKeyName: "crm_scoring_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          due_at: string
          id: string
          lead_id: string
          note: string | null
          reminded_at: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at: string
          id?: string
          lead_id: string
          note?: string | null
          reminded_at?: string | null
          status?: string
          tenant_id?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string
          id?: string
          lead_id?: string
          note?: string | null
          reminded_at?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "crm_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_all"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_webhook_endpoints: {
        Row: {
          auth_kind: string
          consent_mapping: Json
          created_at: string
          endpoint_id: string
          forward_stages: Database["public"]["Enums"]["crm_stage"][]
          tenant_id: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          auth_kind?: string
          consent_mapping?: Json
          created_at?: string
          endpoint_id: string
          forward_stages?: Database["public"]["Enums"]["crm_stage"][]
          tenant_id?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          auth_kind?: string
          consent_mapping?: Json
          created_at?: string
          endpoint_id?: string
          forward_stages?: Database["public"]["Enums"]["crm_stage"][]
          tenant_id?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_webhook_endpoints_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: true
            referencedRelation: "integration_endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_webhook_endpoints_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cross_references: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          relation: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          relation?: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          relation?: string
          source_id?: string
          source_type?: string
          target_id?: string
          target_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cross_references_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      domain_events: {
        Row: {
          actor_id: string | null
          aggregate_id: string
          aggregate_type: string
          correlation_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json
          tenant_id: string
        }
        Insert: {
          actor_id?: string | null
          aggregate_id: string
          aggregate_type: string
          correlation_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          tenant_id: string
        }
        Update: {
          actor_id?: string | null
          aggregate_id?: string
          aggregate_type?: string
          correlation_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      donations: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          donor_email: string | null
          id: string
          message: string | null
          paid_at: string | null
          provider: string
          provider_intent_id: string | null
          provider_session_id: string
          provider_subscription_id: string | null
          recurring: boolean
          status: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          donor_email?: string | null
          id?: string
          message?: string | null
          paid_at?: string | null
          provider?: string
          provider_intent_id?: string | null
          provider_session_id: string
          provider_subscription_id?: string | null
          recurring?: boolean
          status?: string
          tenant_id?: string
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          donor_email?: string | null
          id?: string
          message?: string | null
          paid_at?: string | null
          provider?: string
          provider_intent_id?: string | null
          provider_session_id?: string
          provider_subscription_id?: string | null
          recurring?: boolean
          status?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "donations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_delivery_events: {
        Row: {
          bounce_class: string | null
          campaign_id: string | null
          created_at: string
          diagnostic: string | null
          email: string | null
          email_norm: string | null
          event_type: string
          id: string
          kind: string
          occurred_at: string
          payload: Json
          provider: string
          provider_event_id: string
          provider_message_id: string | null
          subscriber_id: string | null
          tenant_id: string | null
        }
        Insert: {
          bounce_class?: string | null
          campaign_id?: string | null
          created_at?: string
          diagnostic?: string | null
          email?: string | null
          email_norm?: string | null
          event_type: string
          id?: string
          kind: string
          occurred_at?: string
          payload?: Json
          provider?: string
          provider_event_id: string
          provider_message_id?: string | null
          subscriber_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          bounce_class?: string | null
          campaign_id?: string | null
          created_at?: string
          diagnostic?: string | null
          email?: string | null
          email_norm?: string | null
          event_type?: string
          id?: string
          kind?: string
          occurred_at?: string
          payload?: Json
          provider?: string
          provider_event_id?: string
          provider_message_id?: string | null
          subscriber_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_delivery_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "newsletter_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_delivery_events_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_delivery_events_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "newsletter_subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_delivery_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_suppressions: {
        Row: {
          campaign_id: string | null
          created_at: string
          created_by: string | null
          diagnostic: string | null
          email: string
          email_norm: string | null
          expires_at: string | null
          first_seen_at: string
          id: string
          last_event_id: string | null
          last_seen_at: string
          meta: Json
          note: string | null
          occurrences: number
          provider: string
          provider_message_id: string | null
          reason: string
          released_at: string | null
          released_by: string | null
          scope: string
          source: string
          subscriber_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          diagnostic?: string | null
          email: string
          email_norm?: string | null
          expires_at?: string | null
          first_seen_at?: string
          id?: string
          last_event_id?: string | null
          last_seen_at?: string
          meta?: Json
          note?: string | null
          occurrences?: number
          provider?: string
          provider_message_id?: string | null
          reason?: string
          released_at?: string | null
          released_by?: string | null
          scope?: string
          source?: string
          subscriber_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          diagnostic?: string | null
          email?: string
          email_norm?: string | null
          expires_at?: string | null
          first_seen_at?: string
          id?: string
          last_event_id?: string | null
          last_seen_at?: string
          meta?: Json
          note?: string | null
          occurrences?: number
          provider?: string
          provider_message_id?: string | null
          reason?: string
          released_at?: string | null
          released_by?: string | null
          scope?: string
          source?: string
          subscriber_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_suppressions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "newsletter_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_suppressions_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_suppressions_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "newsletter_subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_suppressions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      eu_policy_follows: {
        Row: {
          created_at: string
          item_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          item_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          item_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eu_policy_follows_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "eu_policy_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eu_policy_follows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      eu_policy_items: {
        Row: {
          committee: string | null
          created_at: string
          created_by: string | null
          id: string
          importance: number
          lead_dg: string | null
          next_milestone_at: string | null
          next_milestone_en: string | null
          next_milestone_pl: string | null
          policy_area: string
          rapporteur: string | null
          reference: string | null
          slug: string
          source_url: string | null
          stage: string
          status: string
          summary_en: string | null
          summary_pl: string | null
          tenant_id: string
          title_en: string
          title_pl: string
          updated_at: string
        }
        Insert: {
          committee?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          importance?: number
          lead_dg?: string | null
          next_milestone_at?: string | null
          next_milestone_en?: string | null
          next_milestone_pl?: string | null
          policy_area?: string
          rapporteur?: string | null
          reference?: string | null
          slug: string
          source_url?: string | null
          stage?: string
          status?: string
          summary_en?: string | null
          summary_pl?: string | null
          tenant_id?: string
          title_en: string
          title_pl: string
          updated_at?: string
        }
        Update: {
          committee?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          importance?: number
          lead_dg?: string | null
          next_milestone_at?: string | null
          next_milestone_en?: string | null
          next_milestone_pl?: string | null
          policy_area?: string
          rapporteur?: string | null
          reference?: string | null
          slug?: string
          source_url?: string | null
          stage?: string
          status?: string
          summary_en?: string | null
          summary_pl?: string | null
          tenant_id?: string
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eu_policy_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      eu_policy_links: {
        Row: {
          created_at: string
          created_by: string | null
          item_id: string
          related_item_id: string
          relation: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          item_id: string
          related_item_id: string
          relation?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          item_id?: string
          related_item_id?: string
          relation?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eu_policy_links_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "eu_policy_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eu_policy_links_related_item_id_fkey"
            columns: ["related_item_id"]
            isOneToOne: false
            referencedRelation: "eu_policy_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eu_policy_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      eu_policy_positions: {
        Row: {
          country_code: string
          item_id: string
          note_en: string | null
          note_pl: string | null
          stance: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          country_code: string
          item_id: string
          note_en?: string | null
          note_pl?: string | null
          stance: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          country_code?: string
          item_id?: string
          note_en?: string | null
          note_pl?: string | null
          stance?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eu_policy_positions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "eu_policy_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eu_policy_positions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      eu_policy_updates: {
        Row: {
          created_at: string
          created_by: string | null
          happened_on: string
          id: string
          item_id: string
          note_en: string
          note_pl: string
          source_url: string | null
          stage_from: string | null
          stage_to: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          happened_on?: string
          id?: string
          item_id: string
          note_en: string
          note_pl: string
          source_url?: string | null
          stage_from?: string | null
          stage_to?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          happened_on?: string
          id?: string
          item_id?: string
          note_en?: string
          note_pl?: string
          source_url?: string | null
          stage_from?: string | null
          stage_to?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eu_policy_updates_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "eu_policy_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eu_policy_updates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_rsvps: {
        Row: {
          created_at: string
          event_id: string
          id: string
          reminded_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
          waitlisted_at: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          reminded_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          user_id: string
          waitlisted_at?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          reminded_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          waitlisted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_speakers: {
        Row: {
          event_id: string
          sort_order: number
          user_id: string
        }
        Insert: {
          event_id: string
          sort_order?: number
          user_id: string
        }
        Update: {
          event_id?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_speakers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_types: {
        Row: {
          accent_color: string | null
          created_at: string
          default_capacity: number | null
          default_chatham_house: boolean
          default_duration_minutes: number | null
          default_format: string
          default_guest_mode: string
          default_min_tier_rank: number
          default_registration_flow: string
          default_registration_mode: string
          description_en: string
          description_pl: string
          icon: string
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          name_en: string
          name_pl: string
          requires_ticket: boolean
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          created_at?: string
          default_capacity?: number | null
          default_chatham_house?: boolean
          default_duration_minutes?: number | null
          default_format?: string
          default_guest_mode?: string
          default_min_tier_rank?: number
          default_registration_flow?: string
          default_registration_mode?: string
          description_en?: string
          description_pl?: string
          icon?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          name_en: string
          name_pl: string
          requires_ticket?: boolean
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          created_at?: string
          default_capacity?: number | null
          default_chatham_house?: boolean
          default_duration_minutes?: number | null
          default_format?: string
          default_guest_mode?: string
          default_min_tier_rank?: number
          default_registration_flow?: string
          default_registration_mode?: string
          description_en?: string
          description_pl?: string
          icon?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          name_en?: string
          name_pl?: string
          requires_ticket?: boolean
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          branding: Json
          cancelled_at: string | null
          capacity: number | null
          chatham_house: boolean
          conversation_id: string | null
          cover_url: string | null
          created_at: string
          created_by: string | null
          description_en: string | null
          description_pl: string | null
          early_rsvp_rank: number | null
          ends_at: string | null
          event_type_id: string | null
          external_registration_url: string | null
          format: string
          guest_mode: string
          host_user_id: string | null
          id: string
          join_url: string | null
          kind: string
          location: string | null
          min_tier_rank: number
          program_id: string | null
          published_at: string | null
          recording_url: string | null
          region_id: string | null
          registration_flow: string
          registration_mode: string
          root_page_id: string | null
          rsvp_opens_at: string | null
          slug: string
          starts_at: string
          status: string
          tenant_id: string
          ticket_currency: string
          ticket_price_cents: number | null
          timezone: string
          title_en: string
          title_pl: string
          updated_at: string
          visibility: string
        }
        Insert: {
          branding?: Json
          cancelled_at?: string | null
          capacity?: number | null
          chatham_house?: boolean
          conversation_id?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          early_rsvp_rank?: number | null
          ends_at?: string | null
          event_type_id?: string | null
          external_registration_url?: string | null
          format?: string
          guest_mode?: string
          host_user_id?: string | null
          id?: string
          join_url?: string | null
          kind?: string
          location?: string | null
          min_tier_rank?: number
          program_id?: string | null
          published_at?: string | null
          recording_url?: string | null
          region_id?: string | null
          registration_flow?: string
          registration_mode?: string
          root_page_id?: string | null
          rsvp_opens_at?: string | null
          slug: string
          starts_at: string
          status?: string
          tenant_id?: string
          ticket_currency?: string
          ticket_price_cents?: number | null
          timezone?: string
          title_en: string
          title_pl: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          branding?: Json
          cancelled_at?: string | null
          capacity?: number | null
          chatham_house?: boolean
          conversation_id?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          early_rsvp_rank?: number | null
          ends_at?: string | null
          event_type_id?: string | null
          external_registration_url?: string | null
          format?: string
          guest_mode?: string
          host_user_id?: string | null
          id?: string
          join_url?: string | null
          kind?: string
          location?: string | null
          min_tier_rank?: number
          program_id?: string | null
          published_at?: string | null
          recording_url?: string | null
          region_id?: string | null
          registration_flow?: string
          registration_mode?: string
          root_page_id?: string | null
          rsvp_opens_at?: string | null
          slug?: string
          starts_at?: string
          status?: string
          tenant_id?: string
          ticket_currency?: string
          ticket_price_cents?: number | null
          timezone?: string
          title_en?: string
          title_pl?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_event_type_id_fkey"
            columns: ["event_type_id"]
            isOneToOne: false
            referencedRelation: "event_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "research_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_root_page_id_fkey"
            columns: ["root_page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_expertise_areas: {
        Row: {
          area_id: string
          sort_order: number
          user_id: string
        }
        Insert: {
          area_id: string
          sort_order?: number
          user_id: string
        }
        Update: {
          area_id?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_expertise_areas_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "expertise_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_inmails: {
        Row: {
          admin_note: string | null
          converted_conversation_id: string | null
          created_at: string
          decline_reason: string | null
          expected_answers: string | null
          external_links: string[]
          id: string
          questions: string[]
          reason: string
          recipient_id: string
          responded_at: string | null
          sender_id: string
          status: string
          subject: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          converted_conversation_id?: string | null
          created_at?: string
          decline_reason?: string | null
          expected_answers?: string | null
          external_links?: string[]
          id?: string
          questions?: string[]
          reason: string
          recipient_id: string
          responded_at?: string | null
          sender_id: string
          status?: string
          subject: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          converted_conversation_id?: string | null
          created_at?: string
          decline_reason?: string | null
          expected_answers?: string | null
          external_links?: string[]
          id?: string
          questions?: string[]
          reason?: string
          recipient_id?: string
          responded_at?: string | null
          sender_id?: string
          status?: string
          subject?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_inmails_converted_conversation_id_fkey"
            columns: ["converted_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_inmails_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_layout_settings: {
        Row: {
          accent_color: string | null
          accent_color_dark: string | null
          bio_bullet_color: string | null
          bio_bullet_color_dark: string | null
          center_details: boolean
          center_hero: boolean
          created_at: string
          default_preset: string
          hero_bg_color: string | null
          hero_bg_color_dark: string | null
          hero_text_color: string | null
          hero_text_color_dark: string | null
          max_width: number
          name_size_base: number
          name_size_lg: number
          role_size_base: number
          role_size_lg: number
          section_order: string[]
          show_contact_card: boolean
          show_cv: boolean
          show_details: boolean
          show_expertise_bar: boolean
          show_hero_cover: boolean
          show_materials: boolean
          show_media_mentions: boolean
          show_podcast_strip: boolean
          show_programs: boolean
          show_social_row: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          accent_color_dark?: string | null
          bio_bullet_color?: string | null
          bio_bullet_color_dark?: string | null
          center_details?: boolean
          center_hero?: boolean
          created_at?: string
          default_preset?: string
          hero_bg_color?: string | null
          hero_bg_color_dark?: string | null
          hero_text_color?: string | null
          hero_text_color_dark?: string | null
          max_width?: number
          name_size_base?: number
          name_size_lg?: number
          role_size_base?: number
          role_size_lg?: number
          section_order?: string[]
          show_contact_card?: boolean
          show_cv?: boolean
          show_details?: boolean
          show_expertise_bar?: boolean
          show_hero_cover?: boolean
          show_materials?: boolean
          show_media_mentions?: boolean
          show_podcast_strip?: boolean
          show_programs?: boolean
          show_social_row?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          accent_color_dark?: string | null
          bio_bullet_color?: string | null
          bio_bullet_color_dark?: string | null
          center_details?: boolean
          center_hero?: boolean
          created_at?: string
          default_preset?: string
          hero_bg_color?: string | null
          hero_bg_color_dark?: string | null
          hero_text_color?: string | null
          hero_text_color_dark?: string | null
          max_width?: number
          name_size_base?: number
          name_size_lg?: number
          role_size_base?: number
          role_size_lg?: number
          section_order?: string[]
          show_contact_card?: boolean
          show_cv?: boolean
          show_details?: boolean
          show_expertise_bar?: boolean
          show_hero_cover?: boolean
          show_materials?: boolean
          show_media_mentions?: boolean
          show_podcast_strip?: boolean
          show_programs?: boolean
          show_social_row?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_layout_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expertise_areas: {
        Row: {
          created_at: string
          id: string
          name_en: string
          name_pl: string
          slug: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name_en: string
          name_pl: string
          slug: string
          sort_order?: number
          tenant_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          name_en?: string
          name_pl?: string
          slug?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expertise_areas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      form_field_policies: {
        Row: {
          active: boolean
          created_at: string
          field_key: string
          form_type: string
          id: string
          max_length: number | null
          min_length: number | null
          notes: string | null
          pattern: string | null
          required: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          field_key: string
          form_type: string
          id?: string
          max_length?: number | null
          min_length?: number | null
          notes?: string | null
          pattern?: string | null
          required?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          field_key?: string
          form_type?: string
          id?: string
          max_length?: number | null
          min_length?: number | null
          notes?: string | null
          pattern?: string | null
          required?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_field_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_article_settings: {
        Row: {
          eligibility: string
          enabled: boolean
          link_ttl_days: number
          max_redemptions_per_link: number
          monthly_limit: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          eligibility?: string
          enabled?: boolean
          link_ttl_days?: number
          max_redemptions_per_link?: number
          monthly_limit?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          eligibility?: string
          enabled?: boolean
          link_ttl_days?: number
          max_redemptions_per_link?: number
          monthly_limit?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gift_article_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_events: {
        Row: {
          actor_id: string | null
          code: string | null
          created_at: string
          event_type: string
          id: string
          link_id: string | null
          metadata: Json
          post_id: string | null
          tenant_id: string
        }
        Insert: {
          actor_id?: string | null
          code?: string | null
          created_at?: string
          event_type: string
          id?: string
          link_id?: string | null
          metadata?: Json
          post_id?: string | null
          tenant_id: string
        }
        Update: {
          actor_id?: string | null
          code?: string | null
          created_at?: string
          event_type?: string
          id?: string
          link_id?: string | null
          metadata?: Json
          post_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_events_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "post_gift_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_events_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      glossary_terms: {
        Row: {
          created_at: string
          definition_en: string | null
          definition_pl: string
          id: string
          slug: string
          tenant_id: string
          term_en: string
          term_pl: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          definition_en?: string | null
          definition_pl: string
          id?: string
          slug: string
          tenant_id?: string
          term_en?: string
          term_pl: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          definition_en?: string | null
          definition_pl?: string
          id?: string
          slug?: string
          tenant_id?: string
          term_en?: string
          term_pl?: string
          updated_at?: string
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
      impersonation_sessions: {
        Row: {
          actor_user_id: string
          ended_at: string | null
          id: string
          ip: string | null
          reason: string | null
          started_at: string
          target_user_id: string
          tenant_id: string | null
          user_agent: string | null
        }
        Insert: {
          actor_user_id: string
          ended_at?: string | null
          id?: string
          ip?: string | null
          reason?: string | null
          started_at?: string
          target_user_id: string
          tenant_id?: string | null
          user_agent?: string | null
        }
        Update: {
          actor_user_id?: string
          ended_at?: string | null
          id?: string
          ip?: string | null
          reason?: string | null
          started_at?: string
          target_user_id?: string
          tenant_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      integration_deliveries: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          endpoint_id: string
          event_id: string | null
          event_type: string
          id: string
          last_error: string | null
          next_attempt_at: string
          payload: Json
          status: string
          tenant_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id: string
          event_id?: string | null
          event_type: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          payload: Json
          status?: string
          tenant_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id?: string
          event_id?: string | null
          event_type?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "integration_endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_deliveries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_endpoints: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          event_types: string[]
          id: string
          integration: string
          name: string
          secret_id: string | null
          tenant_id: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          event_types?: string[]
          id?: string
          integration?: string
          name: string
          secret_id?: string | null
          tenant_id?: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          event_types?: string[]
          id?: string
          integration?: string
          name?: string
          secret_id?: string | null
          tenant_id?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_endpoints_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      introduction_requests: {
        Row: {
          bridge_id: string
          created_at: string
          id: string
          message: string
          requester_id: string
          responded_at: string | null
          status: string
          target_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          bridge_id: string
          created_at?: string
          id?: string
          message: string
          requester_id: string
          responded_at?: string | null
          status?: string
          target_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          bridge_id?: string
          created_at?: string
          id?: string
          message?: string
          requester_id?: string
          responded_at?: string | null
          status?: string
          target_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      job_runner_runs: {
        Row: {
          actor_id: string | null
          created_at: string
          duration_ms: number
          error: string | null
          id: number
          job: string
          ok: boolean
          result: Json | null
          source: string
          tenant_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          duration_ms?: number
          error?: string | null
          id?: never
          job?: string
          ok: boolean
          result?: Json | null
          source: string
          tenant_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          duration_ms?: number
          error?: string | null
          id?: never
          job?: string
          ok?: boolean
          result?: Json | null
          source?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_runner_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runner_settings: {
        Row: {
          auto_armed_at: string | null
          base_url: string
          community_last_tick_at: string | null
          community_last_tick_error: string | null
          community_last_tick_status: string | null
          community_tick_count: number
          enabled: boolean
          failure_streak: number
          id: number
          last_app_error: string | null
          last_app_ok_at: string | null
          last_app_run_at: string | null
          last_invoked_at: string | null
          last_tick_at: string | null
          last_tick_error: string | null
          last_tick_status: string | null
          secret: string
          tick_count: number
          updated_at: string
        }
        Insert: {
          auto_armed_at?: string | null
          base_url?: string
          community_last_tick_at?: string | null
          community_last_tick_error?: string | null
          community_last_tick_status?: string | null
          community_tick_count?: number
          enabled?: boolean
          failure_streak?: number
          id?: number
          last_app_error?: string | null
          last_app_ok_at?: string | null
          last_app_run_at?: string | null
          last_invoked_at?: string | null
          last_tick_at?: string | null
          last_tick_error?: string | null
          last_tick_status?: string | null
          secret?: string
          tick_count?: number
          updated_at?: string
        }
        Update: {
          auto_armed_at?: string | null
          base_url?: string
          community_last_tick_at?: string | null
          community_last_tick_error?: string | null
          community_last_tick_status?: string | null
          community_tick_count?: number
          enabled?: boolean
          failure_streak?: number
          id?: number
          last_app_error?: string | null
          last_app_ok_at?: string | null
          last_app_run_at?: string | null
          last_invoked_at?: string | null
          last_tick_at?: string | null
          last_tick_error?: string | null
          last_tick_status?: string | null
          secret?: string
          tick_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      legal_document_versions: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          doc_key: string
          effective_from: string | null
          id: string
          label: string
          note: string | null
          published_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          content: Json
          created_at?: string
          created_by?: string | null
          doc_key: string
          effective_from?: string | null
          id?: string
          label: string
          note?: string | null
          published_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          doc_key?: string
          effective_from?: string | null
          id?: string
          label?: string
          note?: string | null
          published_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
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
          folder_path: string
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
          folder_path?: string
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
          folder_path?: string
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
      media_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          path: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          path: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          path?: string
          tenant_id?: string
        }
        Relationships: []
      }
      media_mentions: {
        Row: {
          cover_url: string | null
          created_at: string
          id: string
          is_public: boolean
          kind: string
          language: string | null
          outlet: string
          published_on: string
          tenant_id: string
          title: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          id?: string
          is_public?: boolean
          kind?: string
          language?: string | null
          outlet: string
          published_on: string
          tenant_id?: string
          title: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          id?: string
          is_public?: boolean
          kind?: string
          language?: string | null
          outlet?: string
          published_on?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_mentions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_bookings: {
        Row: {
          attendee_user_id: string
          created_at: string
          id: string
          note: string | null
          slot_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attendee_user_id: string
          created_at?: string
          id?: string
          note?: string | null
          slot_id: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attendee_user_id?: string
          created_at?: string
          id?: string
          note?: string | null
          slot_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_bookings_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "meeting_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_bookings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_slots: {
        Row: {
          created_at: string
          ends_at: string
          event_id: string | null
          host_user_id: string
          id: string
          is_public: boolean
          location: string | null
          starts_at: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          event_id?: string | null
          host_user_id: string
          id?: string
          is_public?: boolean
          location?: string | null
          starts_at: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          event_id?: string | null
          host_user_id?: string
          id?: string
          is_public?: boolean
          location?: string | null
          starts_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_slots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_slots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      member_organizations: {
        Row: {
          brand_accent: string | null
          brand_ink: string | null
          brand_primary: string | null
          city: string | null
          contact_email: string | null
          country: string | null
          created_at: string
          created_by: string | null
          crm_company_id: string | null
          description: string | null
          expires_at: string | null
          id: string
          logo_favicon: string | null
          logo_h_dark: string | null
          logo_h_light: string | null
          logo_v_dark: string | null
          logo_v_light: string | null
          name: string
          note: string | null
          provider_subscription_id: string | null
          seats_grace_days: number
          seats_grace_reminder_days: number[]
          seats_limit: number
          seats_source: string
          sector: string | null
          slug: string | null
          starts_at: string
          status: string
          tenant_id: string
          tier_key: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          brand_accent?: string | null
          brand_ink?: string | null
          brand_primary?: string | null
          city?: string | null
          contact_email?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          crm_company_id?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          logo_favicon?: string | null
          logo_h_dark?: string | null
          logo_h_light?: string | null
          logo_v_dark?: string | null
          logo_v_light?: string | null
          name: string
          note?: string | null
          provider_subscription_id?: string | null
          seats_grace_days?: number
          seats_grace_reminder_days?: number[]
          seats_limit?: number
          seats_source?: string
          sector?: string | null
          slug?: string | null
          starts_at?: string
          status?: string
          tenant_id?: string
          tier_key?: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          brand_accent?: string | null
          brand_ink?: string | null
          brand_primary?: string | null
          city?: string | null
          contact_email?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          crm_company_id?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          logo_favicon?: string | null
          logo_h_dark?: string | null
          logo_h_light?: string | null
          logo_v_dark?: string | null
          logo_v_light?: string | null
          name?: string
          note?: string | null
          provider_subscription_id?: string | null
          seats_grace_days?: number
          seats_grace_reminder_days?: number[]
          seats_limit?: number
          seats_source?: string
          sector?: string | null
          slug?: string | null
          starts_at?: string
          status?: string
          tenant_id?: string
          tier_key?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_organizations_crm_company_id_fkey"
            columns: ["crm_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_organizations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_organizations_tenant_id_tier_key_fkey"
            columns: ["tenant_id", "tier_key"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["tenant_id", "key"]
          },
        ]
      }
      member_resources: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description_en: string | null
          description_pl: string | null
          download_count: number
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
          min_tier_rank: number
          published: boolean
          sort_order: number
          tenant_id: string
          title_en: string
          title_pl: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          download_count?: number
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          min_tier_rank?: number
          published?: boolean
          sort_order?: number
          tenant_id?: string
          title_en: string
          title_pl: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          download_count?: number
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          min_tier_rank?: number
          published?: boolean
          sort_order?: number
          tenant_id?: string
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_resources_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_grants: {
        Row: {
          created_at: string
          expires_at: string | null
          granted_by: string | null
          id: string
          note: string | null
          revoked_at: string | null
          source: string
          source_donation_id: string | null
          starts_at: string
          tenant_id: string
          tier_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          note?: string | null
          revoked_at?: string | null
          source?: string
          source_donation_id?: string | null
          starts_at?: string
          tenant_id: string
          tier_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          note?: string | null
          revoked_at?: string | null
          source?: string
          source_donation_id?: string | null
          starts_at?: string
          tenant_id?: string
          tier_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_grants_source_donation_id_fkey"
            columns: ["source_donation_id"]
            isOneToOne: false
            referencedRelation: "donations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_grants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_grants_tenant_id_tier_key_fkey"
            columns: ["tenant_id", "tier_key"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["tenant_id", "key"]
          },
        ]
      }
      membership_tiers: {
        Row: {
          active: boolean
          audience_key: string | null
          badge_en: string | null
          badge_pl: string | null
          benefits: Json
          contact_url: string | null
          created_at: string
          cta_mode: string
          description_en: string | null
          description_pl: string | null
          features: Json
          highlight: boolean
          id: string
          is_default: boolean
          key: string
          name_en: string
          name_pl: string
          per_seat: boolean
          price_note_en: string | null
          price_note_pl: string | null
          rank: number
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          audience_key?: string | null
          badge_en?: string | null
          badge_pl?: string | null
          benefits?: Json
          contact_url?: string | null
          created_at?: string
          cta_mode?: string
          description_en?: string | null
          description_pl?: string | null
          features?: Json
          highlight?: boolean
          id?: string
          is_default?: boolean
          key: string
          name_en: string
          name_pl: string
          per_seat?: boolean
          price_note_en?: string | null
          price_note_pl?: string | null
          rank?: number
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          audience_key?: string | null
          badge_en?: string | null
          badge_pl?: string | null
          benefits?: Json
          contact_url?: string | null
          created_at?: string
          cta_mode?: string
          description_en?: string | null
          description_pl?: string | null
          features?: Json
          highlight?: boolean
          id?: string
          is_default?: boolean
          key?: string
          name_en?: string
          name_pl?: string
          per_seat?: boolean
          price_note_en?: string | null
          price_note_pl?: string | null
          rank?: number
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_tiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          created_at: string
          css_class: string
          href: string
          icon: string
          id: string
          item_type: Database["public"]["Enums"]["menu_item_type"]
          label_en: string
          label_pl: string
          mega_config: Json
          mega_enabled: boolean
          menu_id: string
          parent_id: string | null
          position: number
          ref_id: string | null
          target: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          css_class?: string
          href?: string
          icon?: string
          id?: string
          item_type: Database["public"]["Enums"]["menu_item_type"]
          label_en?: string
          label_pl?: string
          mega_config?: Json
          mega_enabled?: boolean
          menu_id: string
          parent_id?: string | null
          position?: number
          ref_id?: string | null
          target?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          css_class?: string
          href?: string
          icon?: string
          id?: string
          item_type?: Database["public"]["Enums"]["menu_item_type"]
          label_en?: string
          label_pl?: string
          mega_config?: Json
          mega_enabled?: boolean
          menu_id?: string
          parent_id?: string | null
          position?: number
          ref_id?: string | null
          target?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menus: {
        Row: {
          created_at: string
          id: string
          key: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menus_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          conversation_id: string
          created_at: string
          emoji: string
          id: string
          message_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      message_stars: {
        Row: {
          conversation_id: string
          created_at: string
          message_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          message_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          message_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_stars_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_stars_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_stars_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_duration: number | null
          attachment_mime: string | null
          attachment_name: string | null
          attachment_path: string | null
          attachment_size: number | null
          body: string | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          expires_at: string | null
          forwarded: boolean
          id: string
          kind: string
          reply_to_id: string | null
          search_vector: unknown
          sender_id: string
          tenant_id: string
        }
        Insert: {
          attachment_duration?: number | null
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          body?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          expires_at?: string | null
          forwarded?: boolean
          id?: string
          kind?: string
          reply_to_id?: string | null
          search_vector?: unknown
          sender_id: string
          tenant_id: string
        }
        Update: {
          attachment_duration?: number | null
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          body?: string | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          expires_at?: string | null
          forwarded?: boolean
          id?: string
          kind?: string
          reply_to_id?: string | null
          search_vector?: unknown
          sender_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      metered_views: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["access_entity_type"]
          id: string
          period_month: string
          tenant_id: string
          user_id: string | null
          visitor_id: string | null
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["access_entity_type"]
          id?: string
          period_month?: string
          tenant_id: string
          user_id?: string | null
          visitor_id?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["access_entity_type"]
          id?: string
          period_month?: string
          tenant_id?: string
          user_id?: string | null
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metered_views_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      metering_event_log: {
        Row: {
          entity_id: string | null
          entity_type: string | null
          id: number
          metadata: Json
          monthly_limit: number | null
          occurred_at: string
          outcome: string
          reason: string | null
          tenant_id: string
          used_before: number | null
          user_id: string | null
          visitor_id: string | null
        }
        Insert: {
          entity_id?: string | null
          entity_type?: string | null
          id?: number
          metadata?: Json
          monthly_limit?: number | null
          occurred_at?: string
          outcome: string
          reason?: string | null
          tenant_id?: string
          used_before?: number | null
          user_id?: string | null
          visitor_id?: string | null
        }
        Update: {
          entity_id?: string | null
          entity_type?: string | null
          id?: number
          metadata?: Json
          monthly_limit?: number | null
          occurred_at?: string
          outcome?: string
          reason?: string | null
          tenant_id?: string
          used_before?: number | null
          user_id?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      metering_settings: {
        Row: {
          anon_monthly_limit: number
          enabled: boolean
          member_monthly_limit: number
          meter_members: boolean
          meter_paid: boolean
          show_counter: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          anon_monthly_limit?: number
          enabled?: boolean
          member_monthly_limit?: number
          meter_members?: boolean
          meter_paid?: boolean
          show_counter?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          anon_monthly_limit?: number
          enabled?: boolean
          member_monthly_limit?: number
          meter_members?: boolean
          meter_paid?: boolean
          show_counter?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "metering_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      mobile_drawer_configs: {
        Row: {
          created_at: string
          id: string
          nav_items: Json
          section_order: string[]
          tenant_id: string
          top_tools: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          nav_items?: Json
          section_order?: string[]
          tenant_id: string
          top_tools?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          nav_items?: Json
          section_order?: string[]
          tenant_id?: string
          top_tools?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mobile_drawer_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      name_dictionary: {
        Row: {
          created_at: string
          created_by: string | null
          dative_pl: string | null
          display_name: string | null
          english_form: string | null
          gender: Database["public"]["Enums"]["name_gender"]
          genitive_pl: string | null
          id: string
          instrumental_pl: string | null
          is_compound: boolean
          key: string | null
          name: string
          name_normalized: string
          notes: string | null
          origin: string | null
          origin_country: string | null
          updated_at: string
          vocative_en: string | null
          vocative_pl: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dative_pl?: string | null
          display_name?: string | null
          english_form?: string | null
          gender: Database["public"]["Enums"]["name_gender"]
          genitive_pl?: string | null
          id?: string
          instrumental_pl?: string | null
          is_compound?: boolean
          key?: string | null
          name: string
          name_normalized: string
          notes?: string | null
          origin?: string | null
          origin_country?: string | null
          updated_at?: string
          vocative_en?: string | null
          vocative_pl?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dative_pl?: string | null
          display_name?: string | null
          english_form?: string | null
          gender?: Database["public"]["Enums"]["name_gender"]
          genitive_pl?: string | null
          id?: string
          instrumental_pl?: string | null
          is_compound?: boolean
          key?: string | null
          name?: string
          name_normalized?: string
          notes?: string | null
          origin?: string | null
          origin_country?: string | null
          updated_at?: string
          vocative_en?: string | null
          vocative_pl?: string | null
        }
        Relationships: []
      }
      newsletter_campaign_events: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          kind: string
          subscriber_id: string | null
          tenant_id: string
          url: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          kind: string
          subscriber_id?: string | null
          tenant_id?: string
          url?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          kind?: string
          subscriber_id?: string | null
          tenant_id?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_campaign_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "newsletter_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_campaign_events_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_campaign_events_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "newsletter_subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_campaign_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_campaign_recipients: {
        Row: {
          bounce_class: string | null
          bounced_at: string | null
          campaign_id: string
          complained_at: string | null
          created_at: string
          delivered_at: string | null
          delivery_state: string
          email: string
          error: string | null
          id: string
          language: string
          provider_message_id: string | null
          sent_at: string | null
          status: string
          subscriber_id: string | null
          tenant_id: string
        }
        Insert: {
          bounce_class?: string | null
          bounced_at?: string | null
          campaign_id: string
          complained_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_state?: string
          email: string
          error?: string | null
          id?: string
          language?: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          subscriber_id?: string | null
          tenant_id?: string
        }
        Update: {
          bounce_class?: string | null
          bounced_at?: string | null
          campaign_id?: string
          complained_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_state?: string
          email?: string
          error?: string | null
          id?: string
          language?: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          subscriber_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "newsletter_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_campaign_recipients_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "newsletter_campaign_recipients_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "newsletter_subscribers"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_campaigns: {
        Row: {
          audience_filter: Json
          content_doc: Json | null
          created_at: string
          created_by: string | null
          editor: string
          failed_count: number
          finished_at: string | null
          from_email: string | null
          from_name: string | null
          html_en: string
          html_pl: string
          id: string
          last_error: string | null
          lease_until: string | null
          name: string
          recipient_count: number
          reply_to: string | null
          scheduled_at: string | null
          sent_count: number
          started_at: string | null
          status: string
          subject_en: string
          subject_pl: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          audience_filter?: Json
          content_doc?: Json | null
          created_at?: string
          created_by?: string | null
          editor?: string
          failed_count?: number
          finished_at?: string | null
          from_email?: string | null
          from_name?: string | null
          html_en?: string
          html_pl?: string
          id?: string
          last_error?: string | null
          lease_until?: string | null
          name: string
          recipient_count?: number
          reply_to?: string | null
          scheduled_at?: string | null
          sent_count?: number
          started_at?: string | null
          status?: string
          subject_en?: string
          subject_pl?: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          audience_filter?: Json
          content_doc?: Json | null
          created_at?: string
          created_by?: string | null
          editor?: string
          failed_count?: number
          finished_at?: string | null
          from_email?: string | null
          from_name?: string | null
          html_en?: string
          html_pl?: string
          id?: string
          last_error?: string | null
          lease_until?: string | null
          name?: string
          recipient_count?: number
          reply_to?: string | null
          scheduled_at?: string | null
          sent_count?: number
          started_at?: string | null
          status?: string
          subject_en?: string
          subject_pl?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      newsletter_popup_events: {
        Row: {
          created_at: string
          error_code: string | null
          event: string
          id: string
          lang: string
          layout: string | null
          meta: Json
          session_id: string | null
          source: string | null
          tenant_id: string
          variant: string | null
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          event: string
          id?: string
          lang?: string
          layout?: string | null
          meta?: Json
          session_id?: string | null
          source?: string | null
          tenant_id: string
          variant?: string | null
        }
        Update: {
          created_at?: string
          error_code?: string | null
          event?: string
          id?: string
          lang?: string
          layout?: string | null
          meta?: Json
          session_id?: string | null
          source?: string | null
          tenant_id?: string
          variant?: string | null
        }
        Relationships: []
      }
      newsletter_settings: {
        Row: {
          description_en: string
          description_pl: string
          double_opt_in: boolean
          enabled: boolean
          heading_en: string
          heading_pl: string
          inline_doc: Json | null
          mode: string
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
          popup_design: Json
          popup_doc: Json | null
          popup_enabled: boolean
          popup_extended_fields: boolean
          popup_eyebrow_en: string | null
          popup_eyebrow_pl: string | null
          popup_fields: Json
          popup_frequency_days: number
          popup_layout: string
          popup_mailing_lists: Json
          popup_muted_color: string | null
          popup_note_en: string | null
          popup_note_pl: string | null
          popup_overlay_color: string | null
          popup_privacy_html_en: string | null
          popup_privacy_html_pl: string | null
          popup_require_privacy: boolean
          popup_require_terms: boolean
          popup_scroll_percent: number
          popup_showcase_brand_en: string
          popup_showcase_brand_pl: string
          popup_showcase_grad_from: string | null
          popup_showcase_grad_to: string | null
          popup_showcase_images: Json
          popup_showcase_rotate_ms: number
          popup_showcase_show_brand: boolean
          popup_showcase_show_caption: boolean
          popup_showcase_show_dots: boolean
          popup_showcase_side: string
          popup_showcase_tagline_en: string
          popup_showcase_tagline_pl: string
          popup_side_image_url: string | null
          popup_terms_html_en: string | null
          popup_terms_html_pl: string | null
          popup_text_color: string | null
          popup_title_en: string
          popup_title_pl: string
          popup_trigger: string
          sender_email: string | null
          sender_name: string | null
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
          inline_doc?: Json | null
          mode?: string
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
          popup_design?: Json
          popup_doc?: Json | null
          popup_enabled?: boolean
          popup_extended_fields?: boolean
          popup_eyebrow_en?: string | null
          popup_eyebrow_pl?: string | null
          popup_fields?: Json
          popup_frequency_days?: number
          popup_layout?: string
          popup_mailing_lists?: Json
          popup_muted_color?: string | null
          popup_note_en?: string | null
          popup_note_pl?: string | null
          popup_overlay_color?: string | null
          popup_privacy_html_en?: string | null
          popup_privacy_html_pl?: string | null
          popup_require_privacy?: boolean
          popup_require_terms?: boolean
          popup_scroll_percent?: number
          popup_showcase_brand_en?: string
          popup_showcase_brand_pl?: string
          popup_showcase_grad_from?: string | null
          popup_showcase_grad_to?: string | null
          popup_showcase_images?: Json
          popup_showcase_rotate_ms?: number
          popup_showcase_show_brand?: boolean
          popup_showcase_show_caption?: boolean
          popup_showcase_show_dots?: boolean
          popup_showcase_side?: string
          popup_showcase_tagline_en?: string
          popup_showcase_tagline_pl?: string
          popup_side_image_url?: string | null
          popup_terms_html_en?: string | null
          popup_terms_html_pl?: string | null
          popup_text_color?: string | null
          popup_title_en?: string
          popup_title_pl?: string
          popup_trigger?: string
          sender_email?: string | null
          sender_name?: string | null
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
          inline_doc?: Json | null
          mode?: string
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
          popup_design?: Json
          popup_doc?: Json | null
          popup_enabled?: boolean
          popup_extended_fields?: boolean
          popup_eyebrow_en?: string | null
          popup_eyebrow_pl?: string | null
          popup_fields?: Json
          popup_frequency_days?: number
          popup_layout?: string
          popup_mailing_lists?: Json
          popup_muted_color?: string | null
          popup_note_en?: string | null
          popup_note_pl?: string | null
          popup_overlay_color?: string | null
          popup_privacy_html_en?: string | null
          popup_privacy_html_pl?: string | null
          popup_require_privacy?: boolean
          popup_require_terms?: boolean
          popup_scroll_percent?: number
          popup_showcase_brand_en?: string
          popup_showcase_brand_pl?: string
          popup_showcase_grad_from?: string | null
          popup_showcase_grad_to?: string | null
          popup_showcase_images?: Json
          popup_showcase_rotate_ms?: number
          popup_showcase_show_brand?: boolean
          popup_showcase_show_caption?: boolean
          popup_showcase_show_dots?: boolean
          popup_showcase_side?: string
          popup_showcase_tagline_en?: string
          popup_showcase_tagline_pl?: string
          popup_side_image_url?: string | null
          popup_terms_html_en?: string | null
          popup_terms_html_pl?: string | null
          popup_text_color?: string | null
          popup_title_en?: string
          popup_title_pl?: string
          popup_trigger?: string
          sender_email?: string | null
          sender_name?: string | null
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
          consents: Json
          created_at: string
          display_name: string | null
          email: string
          first_name: string | null
          id: string
          ip: unknown
          language: string
          last_name: string | null
          meta: Json | null
          source: string | null
          source_form_id: string | null
          source_form_name: string | null
          status: string
          tenant_id: string
          unsubscribe_token: string
          unsubscribed_at: string | null
          updated_at: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          confirmation_expires_at?: string | null
          confirmation_token?: string | null
          confirmed_at?: string | null
          consents?: Json
          created_at?: string
          display_name?: string | null
          email: string
          first_name?: string | null
          id?: string
          ip?: unknown
          language?: string
          last_name?: string | null
          meta?: Json | null
          source?: string | null
          source_form_id?: string | null
          source_form_name?: string | null
          status?: string
          tenant_id?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          confirmation_expires_at?: string | null
          confirmation_token?: string | null
          confirmed_at?: string | null
          consents?: Json
          created_at?: string
          display_name?: string | null
          email?: string
          first_name?: string | null
          id?: string
          ip?: unknown
          language?: string
          last_name?: string | null
          meta?: Json | null
          source?: string | null
          source_form_id?: string | null
          source_form_name?: string | null
          status?: string
          tenant_id?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          allow_connections_from: string
          allow_messages_from: string
          auto_mark_on_open: boolean
          chat_bell_enabled: boolean
          created_at: string
          digest_last_sent_at: string | null
          email_digest: string
          enabled_club: boolean
          enabled_comment: boolean
          enabled_connection: boolean
          enabled_content: boolean
          enabled_crm_task: boolean
          enabled_endorsement: boolean
          enabled_expert_request: boolean
          enabled_follow: boolean
          enabled_introduction: boolean
          enabled_meeting_booking: boolean
          enabled_message: boolean
          enabled_profile_view: boolean
          enabled_recommendation: boolean
          enabled_saved_search: boolean
          enabled_security: boolean
          enabled_subscription: boolean
          enabled_system: boolean
          enabled_tracker: boolean
          group_by_conversation: boolean
          push_enabled: boolean
          read_receipts_enabled: boolean
          show_online_status: boolean
          tenant_id: string
          typing_indicators_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_connections_from?: string
          allow_messages_from?: string
          auto_mark_on_open?: boolean
          chat_bell_enabled?: boolean
          created_at?: string
          digest_last_sent_at?: string | null
          email_digest?: string
          enabled_club?: boolean
          enabled_comment?: boolean
          enabled_connection?: boolean
          enabled_content?: boolean
          enabled_crm_task?: boolean
          enabled_endorsement?: boolean
          enabled_expert_request?: boolean
          enabled_follow?: boolean
          enabled_introduction?: boolean
          enabled_meeting_booking?: boolean
          enabled_message?: boolean
          enabled_profile_view?: boolean
          enabled_recommendation?: boolean
          enabled_saved_search?: boolean
          enabled_security?: boolean
          enabled_subscription?: boolean
          enabled_system?: boolean
          enabled_tracker?: boolean
          group_by_conversation?: boolean
          push_enabled?: boolean
          read_receipts_enabled?: boolean
          show_online_status?: boolean
          tenant_id: string
          typing_indicators_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_connections_from?: string
          allow_messages_from?: string
          auto_mark_on_open?: boolean
          chat_bell_enabled?: boolean
          created_at?: string
          digest_last_sent_at?: string | null
          email_digest?: string
          enabled_club?: boolean
          enabled_comment?: boolean
          enabled_connection?: boolean
          enabled_content?: boolean
          enabled_crm_task?: boolean
          enabled_endorsement?: boolean
          enabled_expert_request?: boolean
          enabled_follow?: boolean
          enabled_introduction?: boolean
          enabled_meeting_booking?: boolean
          enabled_message?: boolean
          enabled_profile_view?: boolean
          enabled_recommendation?: boolean
          enabled_saved_search?: boolean
          enabled_security?: boolean
          enabled_subscription?: boolean
          enabled_system?: boolean
          enabled_tracker?: boolean
          group_by_conversation?: boolean
          push_enabled?: boolean
          read_receipts_enabled?: boolean
          show_online_status?: boolean
          tenant_id?: string
          typing_indicators_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_push_queue: {
        Row: {
          attempts: number
          created_at: string
          id: number
          next_attempt_at: string
          notification_id: string | null
          payload: Json
          sent_at: string | null
          status: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: never
          next_attempt_at?: string
          notification_id?: string | null
          payload: Json
          sent_at?: string | null
          status?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: never
          next_attempt_at?: string
          notification_id?: string | null
          payload?: Json
          sent_at?: string | null
          status?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_push_queue_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_push_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body_en: string | null
          body_pl: string | null
          created_at: string
          href: string | null
          icon: string | null
          id: string
          kind: string
          read_at: string | null
          tenant_id: string
          title_en: string | null
          title_pl: string
          user_id: string
        }
        Insert: {
          body_en?: string | null
          body_pl?: string | null
          created_at?: string
          href?: string | null
          icon?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          tenant_id: string
          title_en?: string | null
          title_pl: string
          user_id: string
        }
        Update: {
          body_en?: string | null
          body_pl?: string | null
          created_at?: string
          href?: string | null
          icon?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          tenant_id?: string
          title_en?: string | null
          title_pl?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_seats: {
        Row: {
          claimed_at: string | null
          created_at: string
          grace_until: string | null
          id: string
          invited_by: string | null
          invited_email: string
          last_invited_at: string | null
          org_id: string
          role: string
          status: string
          suspended_at: string | null
          suspended_reason: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          grace_until?: string | null
          id?: string
          invited_by?: string | null
          invited_email: string
          last_invited_at?: string | null
          org_id: string
          role?: string
          status?: string
          suspended_at?: string | null
          suspended_reason?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          grace_until?: string | null
          id?: string
          invited_by?: string | null
          invited_email?: string
          last_invited_at?: string | null
          org_id?: string
          role?: string
          status?: string
          suspended_at?: string | null
          suspended_reason?: string | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_seats_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "member_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_seats_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_link_alerts: {
        Row: {
          broken_count: number
          notified_at: string
          tenant_id: string
        }
        Insert: {
          broken_count?: number
          notified_at?: string
          tenant_id: string
        }
        Update: {
          broken_count?: number
          notified_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_link_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_link_checks: {
        Row: {
          archive_checked_at: string | null
          archive_timestamp: string | null
          archive_url: string | null
          checked_at: string
          error: string | null
          id: string
          ok: boolean
          post_id: string
          status_code: number | null
          tenant_id: string
          url: string
        }
        Insert: {
          archive_checked_at?: string | null
          archive_timestamp?: string | null
          archive_url?: string | null
          checked_at?: string
          error?: string | null
          id?: string
          ok: boolean
          post_id: string
          status_code?: number | null
          tenant_id: string
          url: string
        }
        Update: {
          archive_checked_at?: string | null
          archive_timestamp?: string | null
          archive_url?: string | null
          checked_at?: string
          error?: string | null
          id?: string
          ok?: boolean
          post_id?: string
          status_code?: number | null
          tenant_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_link_checks_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
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
          og_image_generated_url: string | null
          parent_id: string | null
          publish_at: string | null
          published_at: string | null
          search_vector: unknown
          seo_canonical_url: string | null
          seo_description_en: string | null
          seo_description_pl: string | null
          seo_noindex: boolean
          seo_og_image_url: string | null
          seo_title_en: string | null
          seo_title_pl: string | null
          slug: string
          status: Database["public"]["Enums"]["post_status"]
          takeaways_en: string[]
          takeaways_pl: string[]
          takeaways_variant: string | null
          template_id: string | null
          template_type: string
          tenant_id: string
          title_en: string
          title_pl: string
          toc_override: Json | null
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
          og_image_generated_url?: string | null
          parent_id?: string | null
          publish_at?: string | null
          published_at?: string | null
          search_vector?: unknown
          seo_canonical_url?: string | null
          seo_description_en?: string | null
          seo_description_pl?: string | null
          seo_noindex?: boolean
          seo_og_image_url?: string | null
          seo_title_en?: string | null
          seo_title_pl?: string | null
          slug: string
          status?: Database["public"]["Enums"]["post_status"]
          takeaways_en?: string[]
          takeaways_pl?: string[]
          takeaways_variant?: string | null
          template_id?: string | null
          template_type?: string
          tenant_id: string
          title_en?: string
          title_pl?: string
          toc_override?: Json | null
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
          og_image_generated_url?: string | null
          parent_id?: string | null
          publish_at?: string | null
          published_at?: string | null
          search_vector?: unknown
          seo_canonical_url?: string | null
          seo_description_en?: string | null
          seo_description_pl?: string | null
          seo_noindex?: boolean
          seo_og_image_url?: string | null
          seo_title_en?: string | null
          seo_title_pl?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["post_status"]
          takeaways_en?: string[]
          takeaways_pl?: string[]
          takeaways_variant?: string | null
          template_id?: string | null
          template_type?: string
          tenant_id?: string
          title_en?: string
          title_pl?: string
          toc_override?: Json | null
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
      payment_integration_state: {
        Row: {
          catalog_fingerprint: string | null
          created_at: string
          environment: string
          fingerprint: string | null
          last_error: string | null
          last_reason: string | null
          last_report: Json | null
          last_status: string | null
          last_synced_at: string | null
          updated_at: string
        }
        Insert: {
          catalog_fingerprint?: string | null
          created_at?: string
          environment: string
          fingerprint?: string | null
          last_error?: string | null
          last_reason?: string | null
          last_report?: Json | null
          last_status?: string | null
          last_synced_at?: string | null
          updated_at?: string
        }
        Update: {
          catalog_fingerprint?: string | null
          created_at?: string
          environment?: string
          fingerprint?: string | null
          last_error?: string | null
          last_reason?: string | null
          last_report?: Json | null
          last_status?: string | null
          last_synced_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payment_orders: {
        Row: {
          amount_cents: number
          anonymized_at: string | null
          created_at: string
          currency: string
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["access_entity_type"] | null
          environment: string
          id: string
          invoice_url: string | null
          kind: Database["public"]["Enums"]["order_kind"]
          metadata: Json
          paid_at: string | null
          plan_id: string | null
          provider: string
          provider_intent_id: string | null
          provider_session_id: string | null
          provider_subscription_id: string | null
          receipt_email: string | null
          retention_hold: boolean
          retention_until: string | null
          status: Database["public"]["Enums"]["order_status"]
          subject_ref: string | null
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_cents?: number
          anonymized_at?: string | null
          created_at?: string
          currency?: string
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["access_entity_type"] | null
          environment?: string
          id?: string
          invoice_url?: string | null
          kind: Database["public"]["Enums"]["order_kind"]
          metadata?: Json
          paid_at?: string | null
          plan_id?: string | null
          provider?: string
          provider_intent_id?: string | null
          provider_session_id?: string | null
          provider_subscription_id?: string | null
          receipt_email?: string | null
          retention_hold?: boolean
          retention_until?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subject_ref?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          anonymized_at?: string | null
          created_at?: string
          currency?: string
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["access_entity_type"] | null
          environment?: string
          id?: string
          invoice_url?: string | null
          kind?: Database["public"]["Enums"]["order_kind"]
          metadata?: Json
          paid_at?: string | null
          plan_id?: string | null
          provider?: string
          provider_intent_id?: string | null
          provider_session_id?: string | null
          provider_subscription_id?: string | null
          receipt_email?: string | null
          retention_hold?: boolean
          retention_until?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subject_ref?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
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
      payment_webhook_events: {
        Row: {
          created_at: string
          customer_id: string | null
          duration_ms: number | null
          environment: string
          error: string | null
          event_id: string
          event_type: string
          id: string
          last_retried_at: string | null
          occurred_at: string | null
          payload: Json
          processed_at: string | null
          retried_by: string | null
          retry_count: number
          status: string
          subscription_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          duration_ms?: number | null
          environment: string
          error?: string | null
          event_id: string
          event_type: string
          id?: string
          last_retried_at?: string | null
          occurred_at?: string | null
          payload?: Json
          processed_at?: string | null
          retried_by?: string | null
          retry_count?: number
          status?: string
          subscription_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          duration_ms?: number | null
          environment?: string
          error?: string | null
          event_id?: string
          event_type?: string
          id?: string
          last_retried_at?: string | null
          occurred_at?: string | null
          payload?: Json
          processed_at?: string | null
          retried_by?: string | null
          retry_count?: number
          status?: string
          subscription_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      personality_questions: {
        Row: {
          axis: string
          id: number
          reverse: boolean
          sort_order: number
          text_en: string
          text_pl: string
        }
        Insert: {
          axis: string
          id: number
          reverse?: boolean
          sort_order?: number
          text_en: string
          text_pl: string
        }
        Update: {
          axis?: string
          id?: number
          reverse?: boolean
          sort_order?: number
          text_en?: string
          text_pl?: string
        }
        Relationships: []
      }
      personality_result_history: {
        Row: {
          agreeableness: number
          answers: Json | null
          conscientiousness: number
          created_at: string
          extraversion: number
          id: string
          neuroticism: number
          openness: number
          taken_at: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          agreeableness: number
          answers?: Json | null
          conscientiousness: number
          created_at?: string
          extraversion: number
          id?: string
          neuroticism: number
          openness: number
          taken_at?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          agreeableness?: number
          answers?: Json | null
          conscientiousness?: number
          created_at?: string
          extraversion?: number
          id?: string
          neuroticism?: number
          openness?: number
          taken_at?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personality_result_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      personality_results: {
        Row: {
          agreeableness: number
          answers: Json
          conscientiousness: number
          created_at: string
          extraversion: number
          neuroticism: number
          openness: number
          taken_at: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agreeableness: number
          answers?: Json
          conscientiousness: number
          created_at?: string
          extraversion: number
          neuroticism: number
          openness: number
          taken_at?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agreeableness?: number
          answers?: Json
          conscientiousness?: number
          created_at?: string
          extraversion?: number
          neuroticism?: number
          openness?: number
          taken_at?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personality_results_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_ticket_claims: {
        Row: {
          claimed_at: string
          currency: string
          event_id: string
          face_value_cents: number
          id: string
          org_id: string | null
          period_end: string
          period_start: string
          released_at: string | null
          tenant_id: string
          tier_key: string
          user_id: string
        }
        Insert: {
          claimed_at?: string
          currency?: string
          event_id: string
          face_value_cents?: number
          id?: string
          org_id?: string | null
          period_end: string
          period_start: string
          released_at?: string | null
          tenant_id: string
          tier_key: string
          user_id: string
        }
        Update: {
          claimed_at?: string
          currency?: string
          event_id?: string
          face_value_cents?: number
          id?: string
          org_id?: string | null
          period_end?: string
          period_start?: string
          released_at?: string | null
          tenant_id?: string
          tier_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_ticket_claims_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_ticket_claims_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "member_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_ticket_claims_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      podcast_episode_people: {
        Row: {
          created_at: string
          display_name: string
          episode_id: string
          id: string
          profile_id: string | null
          role: string
          sort_order: number
          tenant_id: string
          url: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string
          episode_id: string
          id?: string
          profile_id?: string | null
          role?: string
          sort_order?: number
          tenant_id: string
          url?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          episode_id?: string
          id?: string
          profile_id?: string | null
          role?: string
          sort_order?: number
          tenant_id?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "podcast_episode_people_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcast_episode_people_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "podcast_episode_people_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcast_episode_people_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcast_episode_people_tenant_id_fkey"
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
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "podcast_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcast_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      podcast_shows: {
        Row: {
          apple_url: string | null
          cover_image_url: string | null
          created_at: string
          deleted_at: string | null
          description_en: string
          description_pl: string
          id: string
          slug: string
          sort_order: number
          spotify_url: string | null
          status: string
          tenant_id: string
          title_en: string
          title_pl: string
          updated_at: string
          youtube_url: string | null
        }
        Insert: {
          apple_url?: string | null
          cover_image_url?: string | null
          created_at?: string
          deleted_at?: string | null
          description_en?: string
          description_pl?: string
          id?: string
          slug: string
          sort_order?: number
          spotify_url?: string | null
          status?: string
          tenant_id: string
          title_en?: string
          title_pl: string
          updated_at?: string
          youtube_url?: string | null
        }
        Update: {
          apple_url?: string | null
          cover_image_url?: string | null
          created_at?: string
          deleted_at?: string | null
          description_en?: string
          description_pl?: string
          id?: string
          slug?: string
          sort_order?: number
          spotify_url?: string | null
          status?: string
          tenant_id?: string
          title_en?: string
          title_pl?: string
          updated_at?: string
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "podcast_shows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      podcasts: {
        Row: {
          audio_url: string
          author_id: string | null
          category_id: string | null
          chapters: Json
          cover_image_url: string | null
          created_at: string
          deleted_at: string | null
          duration_seconds: number
          episode_number: number | null
          excerpt_en: string
          excerpt_pl: string
          id: string
          program_id: string | null
          published_at: string | null
          quotes: Json
          region_id: string | null
          resources: Json
          season: number | null
          show_id: string | null
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
          category_id?: string | null
          chapters?: Json
          cover_image_url?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number
          episode_number?: number | null
          excerpt_en?: string
          excerpt_pl?: string
          id?: string
          program_id?: string | null
          published_at?: string | null
          quotes?: Json
          region_id?: string | null
          resources?: Json
          season?: number | null
          show_id?: string | null
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
          category_id?: string | null
          chapters?: Json
          cover_image_url?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number
          episode_number?: number | null
          excerpt_en?: string
          excerpt_pl?: string
          id?: string
          program_id?: string | null
          published_at?: string | null
          quotes?: Json
          region_id?: string | null
          resources?: Json
          season?: number | null
          show_id?: string | null
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
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "podcasts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcasts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcasts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcasts_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcasts_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "research_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcasts_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcasts_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "podcast_shows"
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
      poll_votes: {
        Row: {
          created_at: string
          option_idx: number
          poll_id: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          option_idx: number
          poll_id: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          option_idx?: number
          poll_id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          options: Json
          post_id: string | null
          question_en: string
          question_pl: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          options: Json
          post_id?: string | null
          question_en: string
          question_pl: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          options?: Json
          post_id?: string | null
          question_en?: string
          question_pl?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "polls_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      popup_events: {
        Row: {
          created_at: string
          id: string
          kind: string
          popup_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          popup_id: string
          tenant_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          popup_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "popup_events_popup_id_fkey"
            columns: ["popup_id"]
            isOneToOne: false
            referencedRelation: "builder_popups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "popup_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      post_authors: {
        Row: {
          post_id: string
          sort_order: number
          user_id: string
        }
        Insert: {
          post_id: string
          sort_order?: number
          user_id: string
        }
        Update: {
          post_id?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_authors_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
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
      post_changelog: {
        Row: {
          created_at: string
          created_by: string | null
          entry_date: string
          id: string
          note_en: string | null
          note_pl: string
          post_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          note_en?: string | null
          note_pl: string
          post_id: string
          tenant_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          note_en?: string | null
          note_pl?: string
          post_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_changelog_post_id_fkey"
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
      post_embeddings: {
        Row: {
          content_hash: string
          embedding: string
          post_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          content_hash: string
          embedding: string
          post_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          content_hash?: string
          embedding?: string
          post_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_embeddings_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_embeddings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      post_feedback: {
        Row: {
          created_at: string
          helpful: boolean
          id: string
          post_id: string
          tenant_id: string
          voter_hash: string | null
        }
        Insert: {
          created_at?: string
          helpful: boolean
          id?: string
          post_id: string
          tenant_id: string
          voter_hash?: string | null
        }
        Update: {
          created_at?: string
          helpful?: boolean
          id?: string
          post_id?: string
          tenant_id?: string
          voter_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_feedback_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_gift_links: {
        Row: {
          code: string
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          last_redeemed_at: string | null
          max_redemptions: number
          period_month: string
          post_id: string
          redemption_count: number
          revoked_at: string | null
          tenant_id: string
        }
        Insert: {
          code?: string
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          last_redeemed_at?: string | null
          max_redemptions?: number
          period_month?: string
          post_id: string
          redemption_count?: number
          revoked_at?: string | null
          tenant_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          last_redeemed_at?: string | null
          max_redemptions?: number
          period_month?: string
          post_id?: string
          redemption_count?: number
          revoked_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_gift_links_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_gift_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      post_gift_redemptions: {
        Row: {
          first_seen_at: string
          hits: number
          id: string
          last_seen_at: string
          link_id: string
          post_id: string
          recipient_id: string | null
          recipient_key: string
          tenant_id: string
        }
        Insert: {
          first_seen_at?: string
          hits?: number
          id?: string
          last_seen_at?: string
          link_id: string
          post_id: string
          recipient_id?: string | null
          recipient_key: string
          tenant_id: string
        }
        Update: {
          first_seen_at?: string
          hits?: number
          id?: string
          last_seen_at?: string
          link_id?: string
          post_id?: string
          recipient_id?: string | null
          recipient_key?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_gift_redemptions_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "post_gift_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_gift_redemptions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_gift_redemptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          header_excerpt_size_base: number
          header_excerpt_size_lg: number
          header_excerpt_size_md: number
          header_title_size_base: number
          header_title_size_lg: number
          header_title_size_md: number
          hyperlink_color: string | null
          hyperlink_color_dark: string | null
          hyperlink_style: string
          hyperlink_underline: boolean
          image_caption_left_border: boolean
          layout_sidebar_overrides: Json
          list_style: string
          no_sidebar_max_width: number
          overlay_excerpt_size_base: number
          overlay_excerpt_size_lg: number
          overlay_excerpt_size_md: number
          overlay_title_size_base: number
          overlay_title_size_lg: number
          overlay_title_size_md: number
          paragraph_spacing_rem: number
          prev_next_mobile_hide: boolean
          quick_view_info: boolean
          show_author_card: boolean
          show_bottom_newsletter: boolean
          show_citation: boolean
          show_floating_share_bar: boolean
          show_post_tags_bar: boolean
          show_prev_next: boolean
          show_quote_share: boolean
          show_sources_bar: boolean
          show_via_bar: boolean
          standard_layout: string
          tenant_id: string
          title_size_source: string
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
          header_excerpt_size_base?: number
          header_excerpt_size_lg?: number
          header_excerpt_size_md?: number
          header_title_size_base?: number
          header_title_size_lg?: number
          header_title_size_md?: number
          hyperlink_color?: string | null
          hyperlink_color_dark?: string | null
          hyperlink_style?: string
          hyperlink_underline?: boolean
          image_caption_left_border?: boolean
          layout_sidebar_overrides?: Json
          list_style?: string
          no_sidebar_max_width?: number
          overlay_excerpt_size_base?: number
          overlay_excerpt_size_lg?: number
          overlay_excerpt_size_md?: number
          overlay_title_size_base?: number
          overlay_title_size_lg?: number
          overlay_title_size_md?: number
          paragraph_spacing_rem?: number
          prev_next_mobile_hide?: boolean
          quick_view_info?: boolean
          show_author_card?: boolean
          show_bottom_newsletter?: boolean
          show_citation?: boolean
          show_floating_share_bar?: boolean
          show_post_tags_bar?: boolean
          show_prev_next?: boolean
          show_quote_share?: boolean
          show_sources_bar?: boolean
          show_via_bar?: boolean
          standard_layout?: string
          tenant_id?: string
          title_size_source?: string
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
          header_excerpt_size_base?: number
          header_excerpt_size_lg?: number
          header_excerpt_size_md?: number
          header_title_size_base?: number
          header_title_size_lg?: number
          header_title_size_md?: number
          hyperlink_color?: string | null
          hyperlink_color_dark?: string | null
          hyperlink_style?: string
          hyperlink_underline?: boolean
          image_caption_left_border?: boolean
          layout_sidebar_overrides?: Json
          list_style?: string
          no_sidebar_max_width?: number
          overlay_excerpt_size_base?: number
          overlay_excerpt_size_lg?: number
          overlay_excerpt_size_md?: number
          overlay_title_size_base?: number
          overlay_title_size_lg?: number
          overlay_title_size_md?: number
          paragraph_spacing_rem?: number
          prev_next_mobile_hide?: boolean
          quick_view_info?: boolean
          show_author_card?: boolean
          show_bottom_newsletter?: boolean
          show_citation?: boolean
          show_floating_share_bar?: boolean
          show_post_tags_bar?: boolean
          show_prev_next?: boolean
          show_quote_share?: boolean
          show_sources_bar?: boolean
          show_via_bar?: boolean
          standard_layout?: string
          tenant_id?: string
          title_size_source?: string
          underline_color?: string | null
          underline_color_dark?: string | null
          updated_at?: string
          updated_by?: string | null
          video_layout?: string
          wide_align_max_width?: number
        }
        Relationships: []
      }
      post_preview_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          post_id: string
          tenant_id: string
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          post_id: string
          tenant_id?: string
          token: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          post_id?: string
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_preview_tokens_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_programs: {
        Row: {
          post_id: string
          program_id: string
        }
        Insert: {
          post_id: string
          program_id: string
        }
        Update: {
          post_id?: string
          program_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_programs_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_programs_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_programs_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "research_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      post_regions: {
        Row: {
          post_id: string
          region_id: string
        }
        Insert: {
          post_id: string
          region_id: string
        }
        Update: {
          post_id?: string
          region_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_regions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_regions_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      post_series: {
        Row: {
          created_at: string
          part_number: number
          post_id: string
          series_id: string
        }
        Insert: {
          created_at?: string
          part_number?: number
          post_id: string
          series_id: string
        }
        Update: {
          created_at?: string
          part_number?: number
          post_id?: string
          series_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_series_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_series_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
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
      post_tts_renditions: {
        Row: {
          byte_size: number
          char_count: number
          content_hash: string
          created_at: string
          lang: string
          model: string
          post_id: string
          storage_path: string
          synth_count: number
          synthesized_at: string
          tenant_id: string
          updated_at: string
          voice_id: string
        }
        Insert: {
          byte_size?: number
          char_count?: number
          content_hash: string
          created_at?: string
          lang: string
          model: string
          post_id: string
          storage_path: string
          synth_count?: number
          synthesized_at?: string
          tenant_id: string
          updated_at?: string
          voice_id: string
        }
        Update: {
          byte_size?: number
          char_count?: number
          content_hash?: string
          created_at?: string
          lang?: string
          model?: string
          post_id?: string
          storage_path?: string
          synth_count?: number
          synthesized_at?: string
          tenant_id?: string
          updated_at?: string
          voice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_tts_renditions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_tts_renditions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          audio_url_en: string | null
          audio_url_pl: string | null
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
          is_sponsored: boolean
          layout_overrides: Json | null
          og_image_generated_url: string | null
          organization_id: string | null
          organization_logo_url: string | null
          organization_name: string | null
          organization_website: string | null
          outbound_links_checked_at: string | null
          parent_page_id: string
          post_format: string
          publish_at: string | null
          published_at: string | null
          read_minutes: number | null
          related_override: Json | null
          search_vector: unknown
          seo_canonical_url: string | null
          seo_description_en: string | null
          seo_description_pl: string | null
          seo_noindex: boolean
          seo_og_image_url: string | null
          seo_title_en: string | null
          seo_title_pl: string | null
          sidebar_layout_id: string | null
          slug: string
          sponsored_advertiser_name: string | null
          sponsored_advertiser_url: string | null
          sponsored_affiliate: boolean
          sponsored_kind: string | null
          sponsored_marked_at: string | null
          sponsored_marked_by: string | null
          sponsored_note_en: string | null
          sponsored_note_pl: string | null
          sponsored_order_ref: string | null
          sponsored_payer_name: string | null
          sponsored_political: boolean
          sponsored_political_process: string | null
          sponsored_sponsor_controller: string | null
          status: Database["public"]["Enums"]["post_status"]
          takeaways_en: string[]
          takeaways_pl: string[]
          takeaways_variant: string | null
          template_id: string | null
          tenant_id: string
          title_en: string
          title_pl: string
          toc_override: Json | null
          tts_voice_en: string | null
          tts_voice_pl: string | null
          updated_at: string
        }
        Insert: {
          audio_url_en?: string | null
          audio_url_pl?: string | null
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
          is_sponsored?: boolean
          layout_overrides?: Json | null
          og_image_generated_url?: string | null
          organization_id?: string | null
          organization_logo_url?: string | null
          organization_name?: string | null
          organization_website?: string | null
          outbound_links_checked_at?: string | null
          parent_page_id: string
          post_format?: string
          publish_at?: string | null
          published_at?: string | null
          read_minutes?: number | null
          related_override?: Json | null
          search_vector?: unknown
          seo_canonical_url?: string | null
          seo_description_en?: string | null
          seo_description_pl?: string | null
          seo_noindex?: boolean
          seo_og_image_url?: string | null
          seo_title_en?: string | null
          seo_title_pl?: string | null
          sidebar_layout_id?: string | null
          slug: string
          sponsored_advertiser_name?: string | null
          sponsored_advertiser_url?: string | null
          sponsored_affiliate?: boolean
          sponsored_kind?: string | null
          sponsored_marked_at?: string | null
          sponsored_marked_by?: string | null
          sponsored_note_en?: string | null
          sponsored_note_pl?: string | null
          sponsored_order_ref?: string | null
          sponsored_payer_name?: string | null
          sponsored_political?: boolean
          sponsored_political_process?: string | null
          sponsored_sponsor_controller?: string | null
          status?: Database["public"]["Enums"]["post_status"]
          takeaways_en?: string[]
          takeaways_pl?: string[]
          takeaways_variant?: string | null
          template_id?: string | null
          tenant_id: string
          title_en?: string
          title_pl?: string
          toc_override?: Json | null
          tts_voice_en?: string | null
          tts_voice_pl?: string | null
          updated_at?: string
        }
        Update: {
          audio_url_en?: string | null
          audio_url_pl?: string | null
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
          is_sponsored?: boolean
          layout_overrides?: Json | null
          og_image_generated_url?: string | null
          organization_id?: string | null
          organization_logo_url?: string | null
          organization_name?: string | null
          organization_website?: string | null
          outbound_links_checked_at?: string | null
          parent_page_id?: string
          post_format?: string
          publish_at?: string | null
          published_at?: string | null
          read_minutes?: number | null
          related_override?: Json | null
          search_vector?: unknown
          seo_canonical_url?: string | null
          seo_description_en?: string | null
          seo_description_pl?: string | null
          seo_noindex?: boolean
          seo_og_image_url?: string | null
          seo_title_en?: string | null
          seo_title_pl?: string | null
          sidebar_layout_id?: string | null
          slug?: string
          sponsored_advertiser_name?: string | null
          sponsored_advertiser_url?: string | null
          sponsored_affiliate?: boolean
          sponsored_kind?: string | null
          sponsored_marked_at?: string | null
          sponsored_marked_by?: string | null
          sponsored_note_en?: string | null
          sponsored_note_pl?: string | null
          sponsored_order_ref?: string | null
          sponsored_payer_name?: string | null
          sponsored_political?: boolean
          sponsored_political_process?: string | null
          sponsored_sponsor_controller?: string | null
          status?: Database["public"]["Enums"]["post_status"]
          takeaways_en?: string[]
          takeaways_pl?: string[]
          takeaways_variant?: string | null
          template_id?: string | null
          tenant_id?: string
          title_en?: string
          title_pl?: string
          toc_override?: Json | null
          tts_voice_en?: string | null
          tts_voice_pl?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
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
      pricing_audiences: {
        Row: {
          active: boolean
          created_at: string
          icon: string
          id: string
          key: string
          name_en: string
          name_pl: string
          sort_order: number
          tagline_en: string | null
          tagline_pl: string | null
          tenant_id: string
          trust_en: string | null
          trust_pl: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          icon?: string
          id?: string
          key: string
          name_en: string
          name_pl: string
          sort_order?: number
          tagline_en?: string | null
          tagline_pl?: string | null
          tenant_id: string
          trust_en?: string | null
          trust_pl?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          icon?: string
          id?: string
          key?: string
          name_en?: string
          name_pl?: string
          sort_order?: number
          tagline_en?: string | null
          tagline_pl?: string | null
          tenant_id?: string
          trust_en?: string | null
          trust_pl?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_audiences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_faq_items: {
        Row: {
          active: boolean
          answer_en: string
          answer_pl: string
          audience_key: string | null
          created_at: string
          id: string
          question_en: string
          question_pl: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          answer_en: string
          answer_pl: string
          audience_key?: string | null
          created_at?: string
          id?: string
          question_en: string
          question_pl: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          answer_en?: string
          answer_pl?: string
          audience_key?: string | null
          created_at?: string
          id?: string
          question_en?: string
          question_pl?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_faq_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_awards: {
        Row: {
          awarded_at: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          issuer: string | null
          kind: string
          sort_order: number
          tenant_id: string
          title: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          awarded_at?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          issuer?: string | null
          kind?: string
          sort_order?: number
          tenant_id: string
          title: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          awarded_at?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          issuer?: string | null
          kind?: string
          sort_order?: number
          tenant_id?: string
          title?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_awards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_badges: {
        Row: {
          badge: string
          created_at: string
          grant_source: string
          granted_by: string | null
          id: string
          note: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          badge: string
          created_at?: string
          grant_source?: string
          granted_by?: string | null
          id?: string
          note?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          badge?: string
          created_at?: string
          grant_source?: string
          granted_by?: string | null
          id?: string
          note?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_badges_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_cv_files: {
        Row: {
          created_at: string
          file_name: string
          file_url: string
          id: string
          is_current: boolean
          mime_type: string | null
          size_bytes: number
          tenant_id: string
          updated_at: string
          uploaded_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          file_name: string
          file_url: string
          id?: string
          is_current?: boolean
          mime_type?: string | null
          size_bytes?: number
          tenant_id: string
          updated_at?: string
          uploaded_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          file_name?: string
          file_url?: string
          id?: string
          is_current?: boolean
          mime_type?: string | null
          size_bytes?: number
          tenant_id?: string
          updated_at?: string
          uploaded_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_cv_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_education: {
        Row: {
          created_at: string
          degree: string | null
          description: string | null
          end_date: string | null
          field: string | null
          id: string
          logo_url: string | null
          school: string
          sort_order: number
          start_date: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          degree?: string | null
          description?: string | null
          end_date?: string | null
          field?: string | null
          id?: string
          logo_url?: string | null
          school: string
          sort_order?: number
          start_date?: string | null
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          degree?: string | null
          description?: string | null
          end_date?: string | null
          field?: string | null
          id?: string
          logo_url?: string | null
          school?: string
          sort_order?: number
          start_date?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_education_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_embeddings: {
        Row: {
          content_hash: string
          embedding: string
          profile_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          content_hash: string
          embedding: string
          profile_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          content_hash?: string
          embedding?: string
          profile_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_embeddings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "profile_embeddings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_embeddings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_embeddings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_experiences: {
        Row: {
          company: string | null
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          is_current: boolean
          location: string | null
          logo_url: string | null
          role_title: string
          sort_order: number
          start_date: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_current?: boolean
          location?: string | null
          logo_url?: string | null
          role_title: string
          sort_order?: number
          start_date?: string | null
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_current?: boolean
          location?: string | null
          logo_url?: string | null
          role_title?: string
          sort_order?: number
          start_date?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_experiences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_hobbies: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          label: string
          sort_order: number
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          label: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          label?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_hobbies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_recommendations: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          recipient_id: string
          relationship: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          recipient_id: string
          relationship?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          recipient_id?: string
          relationship?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      profile_skill_endorsements: {
        Row: {
          created_at: string
          endorser_id: string
          id: string
          recipient_id: string
          skill_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          endorser_id: string
          id?: string
          recipient_id: string
          skill_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          endorser_id?: string
          id?: string
          recipient_id?: string
          skill_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_skill_endorsements_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "profile_skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_skill_endorsements_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "profile_skills_public"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_skills: {
        Row: {
          category: string | null
          created_at: string
          id: string
          label: string
          level: number
          sort_order: number
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          label: string
          level?: number
          sort_order?: number
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          label?: string
          level?: number
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_skills_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_view_alert_state: {
        Row: {
          last_alert_at: string
          last_alerted_view_at: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          last_alert_at?: string
          last_alerted_view_at: string
          tenant_id: string
          user_id: string
        }
        Update: {
          last_alert_at?: string
          last_alerted_view_at?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_view_alert_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_view_events: {
        Row: {
          id: string
          profile_id: string
          tenant_id: string
          viewed_at: string
          viewer_id: string | null
          viewer_mode: string
          viewer_snapshot: Json | null
        }
        Insert: {
          id?: string
          profile_id: string
          tenant_id: string
          viewed_at?: string
          viewer_id?: string | null
          viewer_mode?: string
          viewer_snapshot?: Json | null
        }
        Update: {
          id?: string
          profile_id?: string
          tenant_id?: string
          viewed_at?: string
          viewer_id?: string | null
          viewer_mode?: string
          viewer_snapshot?: Json | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          bio_en: string | null
          bio_pl: string | null
          completeness_score: number
          contact_email: string | null
          cover_url: string | null
          created_at: string
          current_company: string | null
          current_company_id: string | null
          discoverable: boolean
          discovery_search: string | null
          display_name: string | null
          email: string | null
          expert_requests_enabled: boolean
          facebook_url: string | null
          first_name: string | null
          gender: Database["public"]["Enums"]["name_gender"] | null
          hide_avatar: boolean
          id: string
          instagram_url: string | null
          intent_updated_at: string | null
          job_title: string | null
          last_name: string | null
          linkedin_url: string | null
          location: string | null
          offering_en: string | null
          offering_pl: string | null
          open_to: string[]
          phone: string | null
          prefs: Json
          profile_view_mode: string
          seeking_en: string | null
          seeking_pl: string | null
          slug: string | null
          specialization: string | null
          spotify_url: string | null
          tenant_id: string
          twitter_url: string | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          website_url: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          bio_en?: string | null
          bio_pl?: string | null
          completeness_score?: number
          contact_email?: string | null
          cover_url?: string | null
          created_at?: string
          current_company?: string | null
          current_company_id?: string | null
          discoverable?: boolean
          discovery_search?: string | null
          display_name?: string | null
          email?: string | null
          expert_requests_enabled?: boolean
          facebook_url?: string | null
          first_name?: string | null
          gender?: Database["public"]["Enums"]["name_gender"] | null
          hide_avatar?: boolean
          id: string
          instagram_url?: string | null
          intent_updated_at?: string | null
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          location?: string | null
          offering_en?: string | null
          offering_pl?: string | null
          open_to?: string[]
          phone?: string | null
          prefs?: Json
          profile_view_mode?: string
          seeking_en?: string | null
          seeking_pl?: string | null
          slug?: string | null
          specialization?: string | null
          spotify_url?: string | null
          tenant_id: string
          twitter_url?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          website_url?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          bio_en?: string | null
          bio_pl?: string | null
          completeness_score?: number
          contact_email?: string | null
          cover_url?: string | null
          created_at?: string
          current_company?: string | null
          current_company_id?: string | null
          discoverable?: boolean
          discovery_search?: string | null
          display_name?: string | null
          email?: string | null
          expert_requests_enabled?: boolean
          facebook_url?: string | null
          first_name?: string | null
          gender?: Database["public"]["Enums"]["name_gender"] | null
          hide_avatar?: boolean
          id?: string
          instagram_url?: string | null
          intent_updated_at?: string | null
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          location?: string | null
          offering_en?: string | null
          offering_pl?: string | null
          open_to?: string[]
          phone?: string | null
          prefs?: Json
          profile_view_mode?: string
          seeking_en?: string | null
          seeking_pl?: string | null
          slug?: string | null
          specialization?: string | null
          spotify_url?: string | null
          tenant_id?: string
          twitter_url?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_current_company_id_fkey"
            columns: ["current_company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      program_members: {
        Row: {
          created_at: string
          program_id: string
          role_en: string | null
          role_pl: string | null
          sort_order: number
          user_id: string
        }
        Insert: {
          created_at?: string
          program_id: string
          role_en?: string | null
          role_pl?: string | null
          sort_order?: number
          user_id: string
        }
        Update: {
          created_at?: string
          program_id?: string
          role_en?: string | null
          role_pl?: string | null
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_members_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_members_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "research_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          accent_color: string
          category_id: string | null
          contact_email: string | null
          cover_url: string | null
          created_at: string
          created_by: string | null
          description_en: string | null
          description_pl: string | null
          hero_image_url: string | null
          icon: string
          id: string
          is_active: boolean
          kind: string
          name_en: string
          name_pl: string
          research_questions: Json
          scope_en: string | null
          scope_pl: string | null
          slug: string
          sort_order: number
          status: string
          tagline_en: string | null
          tagline_pl: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accent_color?: string
          category_id?: string | null
          contact_email?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          hero_image_url?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          kind?: string
          name_en: string
          name_pl: string
          research_questions?: Json
          scope_en?: string | null
          scope_pl?: string | null
          slug: string
          sort_order?: number
          status?: string
          tagline_en?: string | null
          tagline_pl?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          accent_color?: string
          category_id?: string | null
          contact_email?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          description_en?: string | null
          description_pl?: string | null
          hero_image_url?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          kind?: string
          name_en?: string
          name_pl?: string
          research_questions?: Json
          scope_en?: string | null
          scope_pl?: string | null
          slug?: string
          sort_order?: number
          status?: string
          tagline_en?: string | null
          tagline_pl?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failed_at: string | null
          id: string
          last_seen_at: string
          p256dh: string
          tenant_id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failed_at?: string | null
          id?: string
          last_seen_at?: string
          p256dh: string
          tenant_id?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failed_at?: string | null
          id?: string
          last_seen_at?: string
          p256dh?: string
          tenant_id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_question_votes: {
        Row: {
          created_at: string
          question_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          question_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          question_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_question_votes_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "qa_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_question_votes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_questions: {
        Row: {
          answer_body: string | null
          answered_at: string | null
          answered_by: string | null
          author_display: string | null
          body: string
          created_at: string
          id: string
          is_anonymous: boolean
          session_id: string
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answer_body?: string | null
          answered_at?: string | null
          answered_by?: string | null
          author_display?: string | null
          body: string
          created_at?: string
          id?: string
          is_anonymous?: boolean
          session_id: string
          status?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answer_body?: string | null
          answered_at?: string | null
          answered_by?: string | null
          author_display?: string | null
          body?: string
          created_at?: string
          id?: string
          is_anonymous?: boolean
          session_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_questions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "qa_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_questions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_sessions: {
        Row: {
          closes_at: string | null
          created_at: string
          created_by: string | null
          event_id: string | null
          host_user_id: string
          id: string
          intro_en: string | null
          intro_pl: string | null
          opens_at: string | null
          post_id: string | null
          slug: string
          status: string
          tenant_id: string
          title_en: string
          title_pl: string
          updated_at: string
        }
        Insert: {
          closes_at?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          host_user_id: string
          id?: string
          intro_en?: string | null
          intro_pl?: string | null
          opens_at?: string | null
          post_id?: string | null
          slug: string
          status?: string
          tenant_id?: string
          title_en: string
          title_pl: string
          updated_at?: string
        }
        Update: {
          closes_at?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          host_user_id?: string
          id?: string
          intro_en?: string | null
          intro_pl?: string | null
          opens_at?: string | null
          post_id?: string | null
          slug?: string
          status?: string
          tenant_id?: string
          title_en?: string
          title_pl?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_sessions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_sessions_tenant_id_fkey"
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
      redirects: {
        Row: {
          created_at: string
          created_by: string | null
          hit_count: number
          id: string
          is_enabled: boolean
          last_hit_at: string | null
          note: string | null
          source: string
          source_path: string
          status_code: number
          target_path: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hit_count?: number
          id?: string
          is_enabled?: boolean
          last_hit_at?: string | null
          note?: string | null
          source?: string
          source_path: string
          status_code?: number
          target_path: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hit_count?: number
          id?: string
          is_enabled?: boolean
          last_hit_at?: string | null
          note?: string | null
          source?: string
          source_path?: string
          status_code?: number
          target_path?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "redirects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
          created_at: string
          id: string
          name_en: string
          name_pl: string
          slug: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name_en: string
          name_pl: string
          slug: string
          sort_order?: number
          tenant_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          name_en?: string
          name_pl?: string
          slug?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "regions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      related_post_clicks: {
        Row: {
          clicked_at: string
          id: string
          source_post_id: string
          target_post_id: string
          tenant_id: string
          user_id: string | null
          viewer_hash: string
        }
        Insert: {
          clicked_at?: string
          id?: string
          source_post_id: string
          target_post_id: string
          tenant_id: string
          user_id?: string | null
          viewer_hash: string
        }
        Update: {
          clicked_at?: string
          id?: string
          source_post_id?: string
          target_post_id?: string
          tenant_id?: string
          user_id?: string | null
          viewer_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "related_post_clicks_source_post_id_fkey"
            columns: ["source_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "related_post_clicks_target_post_id_fkey"
            columns: ["target_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "related_post_clicks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      related_posts_config: {
        Row: {
          after_paragraph: number
          columns: number
          created_at: string
          enabled: boolean
          items_limit: number
          layout: string
          min_score: number
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
          use_idf: boolean
          weight_author: number
          weight_categories: number
          weight_dwell: number
          weight_personalization: number
          weight_popularity: number
          weight_recency: number
          weight_tags: number
        }
        Insert: {
          after_paragraph?: number
          columns?: number
          created_at?: string
          enabled?: boolean
          items_limit?: number
          layout?: string
          min_score?: number
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
          use_idf?: boolean
          weight_author?: number
          weight_categories?: number
          weight_dwell?: number
          weight_personalization?: number
          weight_popularity?: number
          weight_recency?: number
          weight_tags?: number
        }
        Update: {
          after_paragraph?: number
          columns?: number
          created_at?: string
          enabled?: boolean
          items_limit?: number
          layout?: string
          min_score?: number
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
          use_idf?: boolean
          weight_author?: number
          weight_categories?: number
          weight_dwell?: number
          weight_personalization?: number
          weight_popularity?: number
          weight_recency?: number
          weight_tags?: number
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
      research_program_items: {
        Row: {
          created_at: string
          event_id: string | null
          id: string
          item_type: string
          podcast_id: string | null
          post_id: string | null
          program_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          id?: string
          item_type: string
          podcast_id?: string | null
          post_id?: string | null
          program_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          event_id?: string | null
          id?: string
          item_type?: string
          podcast_id?: string | null
          post_id?: string | null
          program_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "research_program_items_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_program_items_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_program_items_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_program_items_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_program_items_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "research_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      research_program_members: {
        Row: {
          created_at: string
          is_lead: boolean
          member_role_en: string | null
          member_role_pl: string | null
          profile_id: string
          program_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          is_lead?: boolean
          member_role_en?: string | null
          member_role_pl?: string | null
          profile_id: string
          program_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          is_lead?: boolean
          member_role_en?: string | null
          member_role_pl?: string | null
          profile_id?: string
          program_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "research_program_members_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_program_members_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "research_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      research_program_partners: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          program_id: string
          sort_order: number
          updated_at: string
          url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          program_id: string
          sort_order?: number
          updated_at?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          program_id?: string
          sort_order?: number
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "research_program_partners_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_program_partners_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "research_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      research_program_projects: {
        Row: {
          created_at: string
          id: string
          name_en: string
          name_pl: string
          program_id: string
          project_status: string
          sort_order: number
          summary_en: string | null
          summary_pl: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name_en: string
          name_pl: string
          program_id: string
          project_status?: string
          sort_order?: number
          summary_en?: string | null
          summary_pl?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name_en?: string
          name_pl?: string
          program_id?: string
          project_status?: string
          sort_order?: number
          summary_en?: string | null
          summary_pl?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "research_program_projects_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_program_projects_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "research_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_downloads: {
        Row: {
          created_at: string
          id: string
          resource_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          resource_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          resource_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_downloads_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "member_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_downloads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_feedback: {
        Row: {
          comment: string | null
          coupon_code: string | null
          created_at: string
          id: string
          offer_accepted: boolean
          offer_shown: boolean
          reason_id: string | null
          reason_label: string
          subscription_id: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          coupon_code?: string | null
          created_at?: string
          id?: string
          offer_accepted?: boolean
          offer_shown?: boolean
          reason_id?: string | null
          reason_label: string
          subscription_id?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          comment?: string | null
          coupon_code?: string | null
          created_at?: string
          id?: string
          offer_accepted?: boolean
          offer_shown?: boolean
          reason_id?: string | null
          reason_label?: string
          subscription_id?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_feedback_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "retention_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_feedback_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_reasons: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label_en: string
          label_pl: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label_en: string
          label_pl: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label_en?: string
          label_pl?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_reasons_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_settings: {
        Row: {
          coupon_valid_days: number
          discount_pct: number
          discount_periods: number
          enabled: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          coupon_valid_days?: number
          discount_pct?: number
          discount_periods?: number
          enabled?: boolean
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          coupon_valid_days?: number
          discount_pct?: number
          discount_periods?: number
          enabled?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retention_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_audit_log: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          new_roles: Database["public"]["Enums"]["app_role"][]
          old_roles: Database["public"]["Enums"]["app_role"][]
          target_user_id: string
          tenant_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          new_roles?: Database["public"]["Enums"]["app_role"][]
          old_roles?: Database["public"]["Enums"]["app_role"][]
          target_user_id: string
          tenant_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          new_roles?: Database["public"]["Enums"]["app_role"][]
          old_roles?: Database["public"]["Enums"]["app_role"][]
          target_user_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_searches: {
        Row: {
          alert_enabled: boolean
          created_at: string
          entity: string
          id: string
          last_alert_at: string | null
          last_alert_check_at: string | null
          last_seen_profile_at: string | null
          last_seen_published_at: string | null
          name: string
          params: Json
          tenant_id: string
          url: string | null
          user_id: string
        }
        Insert: {
          alert_enabled?: boolean
          created_at?: string
          entity?: string
          id?: string
          last_alert_at?: string | null
          last_alert_check_at?: string | null
          last_seen_profile_at?: string | null
          last_seen_published_at?: string | null
          name: string
          params?: Json
          tenant_id?: string
          url?: string | null
          user_id: string
        }
        Update: {
          alert_enabled?: boolean
          created_at?: string
          entity?: string
          id?: string
          last_alert_at?: string | null
          last_alert_check_at?: string | null
          last_seen_profile_at?: string | null
          last_seen_published_at?: string | null
          name?: string
          params?: Json
          tenant_id?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      saved_views: {
        Row: {
          config: Json
          created_at: string
          entity: string
          id: string
          is_shared: boolean
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          entity: string
          id?: string
          is_shared?: boolean
          name: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          config?: Json
          created_at?: string
          entity?: string
          id?: string
          is_shared?: boolean
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      search_query_log: {
        Row: {
          created_at: string
          id: number
          lang: string
          q: string
          results: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          lang?: string
          q: string
          results?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: never
          lang?: string
          q?: string
          results?: number
          tenant_id?: string
        }
        Relationships: []
      }
      seo_404_hits: {
        Row: {
          first_seen: string
          hits: number
          last_referrer: string | null
          last_seen: string
          path: string
          tenant_id: string
        }
        Insert: {
          first_seen?: string
          hits?: number
          last_referrer?: string | null
          last_seen?: string
          path: string
          tenant_id: string
        }
        Update: {
          first_seen?: string
          hits?: number
          last_referrer?: string | null
          last_seen?: string
          path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_404_hits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      series: {
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
          name_en?: string
          name_pl: string
          slug: string
          tenant_id?: string
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
      site_settings_revisions: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          key: string
          note: string | null
          operation: string
          tenant_id: string
          value: Json
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          key: string
          note?: string | null
          operation?: string
          tenant_id: string
          value: Json
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          key?: string
          note?: string | null
          operation?: string
          tenant_id?: string
          value?: Json
        }
        Relationships: []
      }
      speaker_profiles: {
        Row: {
          bio_en: string | null
          bio_pl: string | null
          created_at: string
          crm_lead_id: string | null
          headline_en: string | null
          headline_pl: string | null
          id: string
          is_public: boolean
          languages: string[]
          rating: number
          reviews_count: number
          talks_count: number
          tenant_id: string
          topics_en: string[]
          topics_pl: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          bio_en?: string | null
          bio_pl?: string | null
          created_at?: string
          crm_lead_id?: string | null
          headline_en?: string | null
          headline_pl?: string | null
          id?: string
          is_public?: boolean
          languages?: string[]
          rating?: number
          reviews_count?: number
          talks_count?: number
          tenant_id?: string
          topics_en?: string[]
          topics_pl?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          bio_en?: string | null
          bio_pl?: string | null
          created_at?: string
          crm_lead_id?: string | null
          headline_en?: string | null
          headline_pl?: string | null
          id?: string
          is_public?: boolean
          languages?: string[]
          rating?: number
          reviews_count?: number
          talks_count?: number
          tenant_id?: string
          topics_en?: string[]
          topics_pl?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "speaker_profiles_crm_lead_id_fkey"
            columns: ["crm_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "speaker_profiles_crm_lead_id_fkey"
            columns: ["crm_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speaker_profiles_crm_lead_id_fkey"
            columns: ["crm_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads_all"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speaker_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          last_dunning_at: string | null
          last_dunning_transaction_id: string | null
          last_event_at: string | null
          last_payment_at: string | null
          last_payment_failed_at: string | null
          payment_failure_count: number
          price_id: string
          product_id: string
          provider_customer_id: string
          provider_subscription_id: string
          quantity: number
          status: string
          tenant_id: string
          trial_ends_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          last_dunning_at?: string | null
          last_dunning_transaction_id?: string | null
          last_event_at?: string | null
          last_payment_at?: string | null
          last_payment_failed_at?: string | null
          payment_failure_count?: number
          price_id: string
          product_id: string
          provider_customer_id: string
          provider_subscription_id: string
          quantity?: number
          status?: string
          tenant_id?: string
          trial_ends_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          last_dunning_at?: string | null
          last_dunning_transaction_id?: string | null
          last_event_at?: string | null
          last_payment_at?: string | null
          last_payment_failed_at?: string | null
          payment_failure_count?: number
          price_id?: string
          product_id?: string
          provider_customer_id?: string
          provider_subscription_id?: string
          quantity?: number
          status?: string
          tenant_id?: string
          trial_ends_at?: string | null
          updated_at?: string
          user_id?: string
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
      tenant_host_assertion_keys: {
        Row: {
          active: boolean
          created_at: string
          kid: string
          retired_at: string | null
          secret_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          kid: string
          retired_at?: string | null
          secret_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          kid?: string
          retired_at?: string | null
          secret_id?: string
        }
        Relationships: []
      }
      tenant_pending_counters: {
        Row: {
          counter_key: string
          tenant_id: string
          updated_at: string
          value: number
        }
        Insert: {
          counter_key: string
          tenant_id: string
          updated_at?: string
          value?: number
        }
        Update: {
          counter_key?: string
          tenant_id?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_pending_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          aliases: string[]
          created_at: string
          domain: string | null
          id: string
          is_default: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          domain?: string | null
          id?: string
          is_default?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          created_at?: string
          domain?: string | null
          id?: string
          is_default?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          tenant_id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          tenant_id: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      user_connections: {
        Row: {
          addressee_id: string
          created_at: string
          id: string
          message: string | null
          requester_id: string
          responded_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          addressee_id: string
          created_at?: string
          id?: string
          message?: string | null
          requester_id: string
          responded_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          addressee_id?: string
          created_at?: string
          id?: string
          message?: string | null
          requester_id?: string
          responded_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_consent_events: {
        Row: {
          banner_version: string | null
          consent_key: string
          created_at: string
          decision_id: string | null
          given: boolean
          gpc: boolean
          id: string
          ip: string | null
          lang: string | null
          page_url: string | null
          source: string | null
          tenant_id: string | null
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          banner_version?: string | null
          consent_key: string
          created_at?: string
          decision_id?: string | null
          given: boolean
          gpc?: boolean
          id?: string
          ip?: string | null
          lang?: string | null
          page_url?: string | null
          source?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id: string
          version: string
        }
        Update: {
          banner_version?: string | null
          consent_key?: string
          created_at?: string
          decision_id?: string | null
          given?: boolean
          gpc?: boolean
          id?: string
          ip?: string | null
          lang?: string | null
          page_url?: string | null
          source?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_consent_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_consents: {
        Row: {
          consent_key: string
          created_at: string
          given: boolean
          given_at: string | null
          gpc: boolean
          ip: string | null
          lang: string | null
          tenant_id: string | null
          updated_at: string
          user_agent: string | null
          user_id: string
          version: string
          withdrawn_at: string | null
        }
        Insert: {
          consent_key: string
          created_at?: string
          given: boolean
          given_at?: string | null
          gpc?: boolean
          ip?: string | null
          lang?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id: string
          version: string
          withdrawn_at?: string | null
        }
        Update: {
          consent_key?: string
          created_at?: string
          given?: boolean
          given_at?: string | null
          gpc?: boolean
          ip?: string | null
          lang?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string
          version?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_consents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      user_invitations: {
        Row: {
          accepted_at: string | null
          auth_user_id: string | null
          created_at: string
          display_name: string | null
          email: string
          expires_at: string | null
          id: string
          invited_by: string | null
          last_error: string | null
          metadata: Json
          mode: Database["public"]["Enums"]["invitation_mode"]
          role: Database["public"]["Enums"]["app_role"]
          sent_at: string | null
          source: string | null
          status: Database["public"]["Enums"]["invitation_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          last_error?: string | null
          metadata?: Json
          mode?: Database["public"]["Enums"]["invitation_mode"]
          role?: Database["public"]["Enums"]["app_role"]
          sent_at?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["invitation_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          last_error?: string | null
          metadata?: Json
          mode?: Database["public"]["Enums"]["invitation_mode"]
          role?: Database["public"]["Enums"]["app_role"]
          sent_at?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["invitation_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_pending_counters: {
        Row: {
          counter_key: string
          tenant_id: string
          updated_at: string
          user_id: string
          value: number
        }
        Insert: {
          counter_key: string
          tenant_id: string
          updated_at?: string
          user_id: string
          value?: number
        }
        Update: {
          counter_key?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_pending_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_purchases: {
        Row: {
          amount_cents: number
          anonymized_at: string | null
          currency: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["access_entity_type"]
          external_ref: string | null
          id: string
          purchased_at: string
          retention_hold: boolean
          retention_until: string | null
          status: Database["public"]["Enums"]["purchase_status"]
          subject_ref: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          amount_cents?: number
          anonymized_at?: string | null
          currency?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["access_entity_type"]
          external_ref?: string | null
          id?: string
          purchased_at?: string
          retention_hold?: boolean
          retention_until?: string | null
          status?: Database["public"]["Enums"]["purchase_status"]
          subject_ref?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          anonymized_at?: string | null
          currency?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["access_entity_type"]
          external_ref?: string | null
          id?: string
          purchased_at?: string
          retention_hold?: boolean
          retention_until?: string | null
          status?: Database["public"]["Enums"]["purchase_status"]
          subject_ref?: string | null
          tenant_id?: string
          user_id?: string | null
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
      user_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          reason: string
          reported_id: string
          reporter_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reported_id: string
          reporter_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reported_id?: string
          reporter_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      verification_domains: {
        Row: {
          academic: boolean
          active: boolean
          badge: string
          created_at: string
          created_by: string | null
          domain: string
          grants_tier_key: string | null
          id: string
          note: string | null
          require_email_confirmed: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          academic?: boolean
          active?: boolean
          badge?: string
          created_at?: string
          created_by?: string | null
          domain: string
          grants_tier_key?: string | null
          id?: string
          note?: string | null
          require_email_confirmed?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          academic?: boolean
          active?: boolean
          badge?: string
          created_at?: string
          created_by?: string | null
          domain?: string
          grants_tier_key?: string | null
          id?: string
          note?: string | null
          require_email_confirmed?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_domains_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          tenant_id: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          metric: string
          path?: string | null
          rating?: string | null
          tenant_id?: string
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          metric?: string
          path?: string | null
          rating?: string | null
          tenant_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "web_vitals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_definitions: {
        Row: {
          condition: Json
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          name: string
          steps: Json
          template_key: string | null
          tenant_id: string
          trigger_event_type: string
          updated_at: string
        }
        Insert: {
          condition?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          name: string
          steps?: Json
          template_key?: string | null
          tenant_id: string
          trigger_event_type: string
          updated_at?: string
        }
        Update: {
          condition?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          name?: string
          steps?: Json
          template_key?: string | null
          tenant_id?: string
          trigger_event_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_definitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          correlation_id: string | null
          created_at: string
          error: string | null
          event_id: string | null
          event_type: string
          id: string
          status: string
          steps_completed: number
          tenant_id: string
          workflow_id: string
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          error?: string | null
          event_id?: string | null
          event_type: string
          id?: string
          status: string
          steps_completed?: number
          tenant_id: string
          workflow_id: string
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          error?: string | null
          event_id?: string | null
          event_type?: string
          id?: string
          status?: string
          steps_completed?: number
          tenant_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_templates: {
        Row: {
          condition: Json
          created_at: string
          description_en: string
          description_pl: string
          key: string
          name_en: string
          name_pl: string
          steps: Json
          trigger_event_type: string
        }
        Insert: {
          condition?: Json
          created_at?: string
          description_en: string
          description_pl: string
          key: string
          name_en: string
          name_pl: string
          steps?: Json
          trigger_event_type: string
        }
        Update: {
          condition?: Json
          created_at?: string
          description_en?: string
          description_pl?: string
          key?: string
          name_en?: string
          name_pl?: string
          steps?: Json
          trigger_event_type?: string
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
      analytics_events_daily: {
        Row: {
          day: string | null
          event_name: string | null
          event_type: string | null
          hits: number | null
          tenant_id: string | null
          unique_sessions: number | null
          unique_users: number | null
        }
        Relationships: []
      }
      author_profiles_public: {
        Row: {
          avatar_url: string | null
          bio_en: string | null
          bio_pl: string | null
          brand_accent: string | null
          brand_accent_dark: string | null
          company: string | null
          contact_email: string | null
          counterpart_lang: string | null
          counterpart_user_id: string | null
          created_at: string | null
          custom_socials: Json | null
          facebook_url: string | null
          full_bio_en: string | null
          full_bio_pl: string | null
          id: string | null
          instagram_url: string | null
          is_public: boolean | null
          job_title: string | null
          layout_overrides: Json | null
          layout_preset: string | null
          layout_section_order: string[] | null
          layout_template_id: string | null
          linkedin_url: string | null
          media_contact_name: string | null
          org_functions: Json | null
          spotify_url: string | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
          website_url: string | null
          x_url: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio_en?: string | null
          bio_pl?: string | null
          brand_accent?: string | null
          brand_accent_dark?: string | null
          company?: string | null
          contact_email?: never
          counterpart_lang?: string | null
          counterpart_user_id?: string | null
          created_at?: string | null
          custom_socials?: Json | null
          facebook_url?: string | null
          full_bio_en?: string | null
          full_bio_pl?: string | null
          id?: string | null
          instagram_url?: string | null
          is_public?: boolean | null
          job_title?: string | null
          layout_overrides?: Json | null
          layout_preset?: string | null
          layout_section_order?: string[] | null
          layout_template_id?: string | null
          linkedin_url?: string | null
          media_contact_name?: string | null
          org_functions?: Json | null
          spotify_url?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          website_url?: string | null
          x_url?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio_en?: string | null
          bio_pl?: string | null
          brand_accent?: string | null
          brand_accent_dark?: string | null
          company?: string | null
          contact_email?: never
          counterpart_lang?: string | null
          counterpart_user_id?: string | null
          created_at?: string | null
          custom_socials?: Json | null
          facebook_url?: string | null
          full_bio_en?: string | null
          full_bio_pl?: string | null
          id?: string | null
          instagram_url?: string | null
          is_public?: boolean | null
          job_title?: string | null
          layout_overrides?: Json | null
          layout_preset?: string | null
          layout_section_order?: string[] | null
          layout_template_id?: string | null
          linkedin_url?: string | null
          media_contact_name?: string | null
          org_functions?: Json | null
          spotify_url?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          website_url?: string | null
          x_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "author_profiles_counterpart_user_id_fkey"
            columns: ["counterpart_user_id"]
            isOneToOne: false
            referencedRelation: "crm_funnel_view"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "author_profiles_counterpart_user_id_fkey"
            columns: ["counterpart_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "author_profiles_counterpart_user_id_fkey"
            columns: ["counterpart_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "author_profiles_layout_template_id_fkey"
            columns: ["layout_template_id"]
            isOneToOne: false
            referencedRelation: "builder_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "author_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      career_page_sections_public: {
        Row: {
          is_visible: boolean | null
          key: string | null
          sort_order: number | null
          subtitle_en: string | null
          subtitle_pl: string | null
          title_en: string | null
          title_pl: string | null
        }
        Insert: {
          is_visible?: boolean | null
          key?: string | null
          sort_order?: number | null
          subtitle_en?: never
          subtitle_pl?: never
          title_en?: never
          title_pl?: never
        }
        Update: {
          is_visible?: boolean | null
          key?: string | null
          sort_order?: number | null
          subtitle_en?: never
          subtitle_pl?: never
          title_en?: never
          title_pl?: never
        }
        Relationships: []
      }
      content_access_public: {
        Row: {
          created_at: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["access_entity_type"] | null
          id: string | null
          metering_policy: string | null
          mode: Database["public"]["Enums"]["access_mode"] | null
          one_time_currency: string | null
          one_time_price_cents: number | null
          plan_ids: string[] | null
          teaser_en: string | null
          teaser_pl: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["access_entity_type"] | null
          id?: string | null
          metering_policy?: string | null
          mode?: Database["public"]["Enums"]["access_mode"] | null
          one_time_currency?: string | null
          one_time_price_cents?: number | null
          plan_ids?: string[] | null
          teaser_en?: string | null
          teaser_pl?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["access_entity_type"] | null
          id?: string | null
          metering_policy?: string | null
          mode?: Database["public"]["Enums"]["access_mode"] | null
          one_time_currency?: string | null
          one_time_price_cents?: number | null
          plan_ids?: string[] | null
          teaser_en?: string | null
          teaser_pl?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      crm_funnel_view: {
        Row: {
          avatar_url: string | null
          confirmed_at: string | null
          consents: Json | null
          contact_id: string | null
          contact_score: number | null
          contact_stage: Database["public"]["Enums"]["crm_stage"] | null
          created_at: string | null
          display_name: string | null
          email: string | null
          email_norm: string | null
          first_name: string | null
          id: string | null
          is_contact: boolean | null
          is_registered: boolean | null
          language: string | null
          last_name: string | null
          profile_id: string | null
          source: string | null
          source_form_id: string | null
          source_form_name: string | null
          status: string | null
          tenant_id: string | null
          unsubscribed_at: string | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
      crm_leads_all: {
        Row: {
          aliases: Json | null
          company: string | null
          company_id: string | null
          country: string | null
          created_at: string | null
          email: string | null
          email_norm: string | null
          first_name: string | null
          follow_up_at: string | null
          id: string | null
          last_activity_at: string | null
          last_name: string | null
          linkedin_url: string | null
          marketing_consent: boolean | null
          newsletter_status: string | null
          owner_id: string | null
          phone: string | null
          phone_norm: string | null
          position: string | null
          score: number | null
          score_band: string | null
          score_breakdown: Json | null
          score_updated_at: string | null
          source_count: number | null
          stage: Database["public"]["Enums"]["crm_stage"] | null
          tags: string[] | null
          tenant_id: string | null
          tenant_name: string | null
          tenant_slug: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "crm_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      personality_results_public: {
        Row: {
          agreeableness: number | null
          conscientiousness: number | null
          extraversion: number | null
          neuroticism: number | null
          openness: number | null
          taken_at: string | null
          user_id: string | null
        }
        Insert: {
          agreeableness?: number | null
          conscientiousness?: number | null
          extraversion?: number | null
          neuroticism?: number | null
          openness?: number | null
          taken_at?: string | null
          user_id?: string | null
        }
        Update: {
          agreeableness?: number | null
          conscientiousness?: number | null
          extraversion?: number | null
          neuroticism?: number | null
          openness?: number | null
          taken_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      profile_awards_public: {
        Row: {
          awarded_at: string | null
          description: string | null
          icon: string | null
          id: string | null
          issuer: string | null
          kind: string | null
          sort_order: number | null
          title: string | null
          url: string | null
          user_id: string | null
        }
        Insert: {
          awarded_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string | null
          issuer?: string | null
          kind?: string | null
          sort_order?: number | null
          title?: string | null
          url?: string | null
          user_id?: string | null
        }
        Update: {
          awarded_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string | null
          issuer?: string | null
          kind?: string | null
          sort_order?: number | null
          title?: string | null
          url?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      profile_education_public: {
        Row: {
          degree: string | null
          description: string | null
          end_date: string | null
          field: string | null
          id: string | null
          logo_url: string | null
          school: string | null
          sort_order: number | null
          start_date: string | null
          user_id: string | null
        }
        Insert: {
          degree?: string | null
          description?: string | null
          end_date?: string | null
          field?: string | null
          id?: string | null
          logo_url?: string | null
          school?: string | null
          sort_order?: number | null
          start_date?: string | null
          user_id?: string | null
        }
        Update: {
          degree?: string | null
          description?: string | null
          end_date?: string | null
          field?: string | null
          id?: string | null
          logo_url?: string | null
          school?: string | null
          sort_order?: number | null
          start_date?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      profile_experiences_public: {
        Row: {
          company: string | null
          description: string | null
          end_date: string | null
          id: string | null
          is_current: boolean | null
          location: string | null
          logo_url: string | null
          role_title: string | null
          sort_order: number | null
          start_date: string | null
          user_id: string | null
        }
        Insert: {
          company?: string | null
          description?: string | null
          end_date?: string | null
          id?: string | null
          is_current?: boolean | null
          location?: string | null
          logo_url?: string | null
          role_title?: string | null
          sort_order?: number | null
          start_date?: string | null
          user_id?: string | null
        }
        Update: {
          company?: string | null
          description?: string | null
          end_date?: string | null
          id?: string | null
          is_current?: boolean | null
          location?: string | null
          logo_url?: string | null
          role_title?: string | null
          sort_order?: number | null
          start_date?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      profile_hobbies_public: {
        Row: {
          icon: string | null
          id: string | null
          label: string | null
          sort_order: number | null
          user_id: string | null
        }
        Insert: {
          icon?: string | null
          id?: string | null
          label?: string | null
          sort_order?: number | null
          user_id?: string | null
        }
        Update: {
          icon?: string | null
          id?: string | null
          label?: string | null
          sort_order?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      profile_skills_public: {
        Row: {
          category: string | null
          id: string | null
          label: string | null
          level: number | null
          sort_order: number | null
          user_id: string | null
        }
        Insert: {
          category?: string | null
          id?: string | null
          label?: string | null
          level?: number | null
          sort_order?: number | null
          user_id?: string | null
        }
        Update: {
          category?: string | null
          id?: string | null
          label?: string | null
          level?: number | null
          sort_order?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      profiles_public: {
        Row: {
          avatar_url: string | null
          bio_en: string | null
          bio_pl: string | null
          cover_url: string | null
          current_company: string | null
          display_name: string | null
          expert_requests_enabled: boolean | null
          facebook_url: string | null
          first_name: string | null
          id: string | null
          instagram_url: string | null
          job_title: string | null
          last_name: string | null
          linkedin_url: string | null
          slug: string | null
          specialization: string | null
          spotify_url: string | null
          tenant_id: string | null
          twitter_url: string | null
          updated_at: string | null
          verified_at: string | null
          website_url: string | null
        }
        Insert: {
          avatar_url?: never
          bio_en?: string | null
          bio_pl?: string | null
          cover_url?: string | null
          current_company?: string | null
          display_name?: string | null
          expert_requests_enabled?: boolean | null
          facebook_url?: string | null
          first_name?: string | null
          id?: string | null
          instagram_url?: string | null
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          slug?: string | null
          specialization?: string | null
          spotify_url?: string | null
          tenant_id?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          verified_at?: string | null
          website_url?: string | null
        }
        Update: {
          avatar_url?: never
          bio_en?: string | null
          bio_pl?: string | null
          cover_url?: string | null
          current_company?: string | null
          display_name?: string | null
          expert_requests_enabled?: boolean | null
          facebook_url?: string | null
          first_name?: string | null
          id?: string | null
          instagram_url?: string | null
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          slug?: string | null
          specialization?: string | null
          spotify_url?: string | null
          tenant_id?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          verified_at?: string | null
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
      research_programs: {
        Row: {
          accent_color: string | null
          category_id: string | null
          contact_email: string | null
          created_at: string | null
          created_by: string | null
          hero_image_url: string | null
          icon: string | null
          id: string | null
          name_en: string | null
          name_pl: string | null
          research_questions: Json | null
          scope_en: string | null
          scope_pl: string | null
          slug: string | null
          sort_order: number | null
          status: string | null
          tagline_en: string | null
          tagline_pl: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          accent_color?: string | null
          category_id?: string | null
          contact_email?: string | null
          created_at?: string | null
          created_by?: string | null
          hero_image_url?: string | null
          icon?: string | null
          id?: string | null
          name_en?: string | null
          name_pl?: string | null
          research_questions?: Json | null
          scope_en?: string | null
          scope_pl?: string | null
          slug?: string | null
          sort_order?: number | null
          status?: string | null
          tagline_en?: string | null
          tagline_pl?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          accent_color?: string | null
          category_id?: string | null
          contact_email?: string | null
          created_at?: string | null
          created_by?: string | null
          hero_image_url?: string | null
          icon?: string | null
          id?: string | null
          name_en?: string | null
          name_pl?: string | null
          research_questions?: Json | null
          scope_en?: string | null
          scope_pl?: string | null
          slug?: string | null
          sort_order?: number | null
          status?: string | null
          tagline_en?: string | null
          tagline_pl?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "programs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string | null
          email: string | null
          id: string | null
          metadata: Json | null
          reason: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string | null
          metadata?: Json | null
          reason?: never
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string | null
          metadata?: Json | null
          reason?: never
        }
        Relationships: []
      }
    }
    Functions: {
      _are_connected: { Args: { _a: string; _b: string }; Returns: boolean }
      _caller_tenant: { Args: never; Returns: string }
      _suggest_score: {
        Args: { _a: string; _b: string; _q: string }
        Returns: number
      }
      accounting_metadata_minimum: { Args: { p_metadata: Json }; Returns: Json }
      accounting_retention_until: { Args: { p_at: string }; Returns: string }
      accounting_subject_ref: { Args: { p_user_id: string }; Returns: string }
      add_cross_reference: {
        Args: {
          p_created_by?: string
          p_relation?: string
          p_source_id: string
          p_source_type: string
          p_target_id: string
          p_target_type: string
          p_tenant_id: string
        }
        Returns: string
      }
      add_group_members: {
        Args: { p_conversation_id: string; p_member_ids: string[] }
        Returns: number
      }
      admin_assert_verification_admin: { Args: never; Returns: string }
      admin_clear_content_password: {
        Args: {
          _entity_id: string
          _entity_type: Database["public"]["Enums"]["access_entity_type"]
        }
        Returns: undefined
      }
      admin_club_application_crm_retry: {
        Args: { p_id: string }
        Returns: {
          crm_error: string
          crm_last_attempt_at: string
          crm_sync_status: string
          crm_synced_at: string
        }[]
      }
      admin_club_application_mark_notified: {
        Args: {
          p_error?: string
          p_id: string
          p_ok: boolean
          p_status: string
        }
        Returns: undefined
      }
      admin_club_application_notify_payload: {
        Args: { p_id: string }
        Returns: {
          email: string
          first_name: string
          lang: string
          last_name: string
          specialization_slug: string
          status: string
          tenant_id: string
        }[]
      }
      admin_club_application_set_status: {
        Args: { p_id: string; p_note?: string; p_status: string }
        Returns: undefined
      }
      admin_club_applications_counts: {
        Args: never
        Returns: {
          pending: number
          specialization_slug: string
          total: number
        }[]
      }
      admin_club_applications_list: {
        Args: {
          p_club_id?: string
          p_limit?: number
          p_search?: string
          p_specialization?: string
          p_status?: string
        }
        Returns: {
          admin_note: string
          availability: string
          city: string
          club_id: string
          club_name_en: string
          club_name_pl: string
          company: string
          contribution: string
          country: string
          created_at: string
          crm_error: string
          crm_last_attempt_at: string
          crm_lead_id: string
          crm_sync_status: string
          crm_synced_at: string
          email: string
          expertise: string
          first_name: string
          goals: string
          id: string
          industry: string
          job_position: string
          lang: string
          languages: string
          last_name: string
          linkedin_url: string
          marketing_consent: boolean
          motivation: string
          notified_at: string
          notified_status: string
          notify_error: string
          phone: string
          referral_source: string
          reviewed_at: string
          seniority: string
          specialization_slug: string
          status: string
          tier_key: string
          tier_rank: number
          user_id: string
          years_experience: number
        }[]
      }
      admin_club_bulk_member_role: {
        Args: { p_club_id: string; p_role: string; p_user_ids: string[] }
        Returns: number
      }
      admin_club_bulk_moderate: {
        Args: {
          p_action: string
          p_reason?: string
          p_target_ids: string[]
          p_target_type: string
        }
        Returns: number
      }
      admin_club_capabilities_preview: {
        Args: { _club_id: string; _group_id?: string; _user_id: string }
        Returns: {
          can_invite: boolean
          can_manage: boolean
          can_moderate: boolean
          can_post_thread: boolean
          can_react: boolean
          can_read: boolean
          can_reply: boolean
          can_reveal_author: boolean
          can_see_members: boolean
          effective_role: string
          reason: string
        }[]
      }
      admin_club_get: {
        Args: { p_club_id: string }
        Returns: {
          accent_color: string
          attribution_mode: string
          cover_image_url: string
          created_at: string
          description_en: string
          description_pl: string
          group_count: number
          icon: string
          id: string
          join_policy: string
          last_activity_at: string
          layout: string
          member_count: number
          min_tier_rank: number
          moderation_mode: string
          name_en: string
          name_pl: string
          policy_area: string
          rules_en: string
          rules_pl: string
          slug: string
          status: string
          tagline_en: string
          tagline_pl: string
          thread_count: number
          updated_at: string
          visibility: string
          who_can_post: string
        }[]
      }
      admin_club_group_delete: {
        Args: { p_group_id: string; p_move_to_group_id?: string }
        Returns: number
      }
      admin_club_group_reorder: {
        Args: { p_club_id: string; p_group_ids: string[] }
        Returns: number
      }
      admin_club_group_upsert: { Args: { p_payload: Json }; Returns: string }
      admin_club_groups: {
        Args: { p_club_id: string }
        Returns: {
          accent_color: string
          anchor_id: string
          anchor_type: string
          attribution_mode: string
          attribution_mode_inherited: boolean
          closes_at: string
          club_id: string
          description_en: string
          description_pl: string
          icon: string
          id: string
          last_activity_at: string
          min_tier_rank: number
          min_tier_rank_inherited: boolean
          moderation_mode: string
          moderation_mode_inherited: boolean
          name_en: string
          name_pl: string
          opens_at: string
          slug: string
          sort_order: number
          status: string
          thread_count: number
          visibility: string
          visibility_inherited: boolean
          who_can_post: string
          who_can_post_inherited: boolean
        }[]
      }
      admin_club_invitations: {
        Args: { p_club_id: string }
        Returns: {
          channel: string
          club_role: string
          created_at: string
          expires_at: string
          id: string
          inviter_name: string
          recipient: string
          status: string
        }[]
      }
      admin_club_invite_link_create: {
        Args: {
          p_club_id: string
          p_expires_at?: string
          p_group_id?: string
          p_label?: string
          p_max_uses?: number
          p_requires_approval?: boolean
          p_role?: string
        }
        Returns: {
          id: string
          token: string
        }[]
      }
      admin_club_invite_link_revoke: {
        Args: { p_link_id: string }
        Returns: boolean
      }
      admin_club_invite_links: {
        Args: { p_club_id: string }
        Returns: {
          club_role: string
          created_at: string
          expires_at: string
          id: string
          label: string
          max_uses: number
          requires_approval: boolean
          revoked_at: string
          token: string
          used_count: number
        }[]
      }
      admin_club_invite_segment: {
        Args: {
          p_club_id: string
          p_group_id?: string
          p_max?: number
          p_message?: string
          p_role?: string
          p_rule: Json
          p_save_rule?: boolean
        }
        Returns: {
          invited: number
          rule_id: string
        }[]
      }
      admin_club_list: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
          p_visibility?: string
        }
        Returns: {
          accent_color: string
          attribution_mode: string
          created_at: string
          group_count: number
          icon: string
          id: string
          join_policy: string
          last_activity_at: string
          lead_names: string[]
          member_count: number
          min_tier_rank: number
          moderation_mode: string
          name_en: string
          name_pl: string
          pending_count: number
          policy_area: string
          slug: string
          status: string
          thread_count: number
          total_count: number
          visibility: string
          who_can_post: string
        }[]
      }
      admin_club_member_remove: {
        Args: { p_club_id: string; p_user_id: string }
        Returns: boolean
      }
      admin_club_member_upsert: {
        Args: {
          p_club_id: string
          p_role?: string
          p_role_expires_at?: string
          p_status?: string
          p_user_id: string
        }
        Returns: string
      }
      admin_club_moderation_log: {
        Args: { p_club_id: string; p_limit?: number }
        Returns: {
          action: string
          created_at: string
          id: string
          moderator_name: string
          reason: string
          target_id: string
          target_type: string
        }[]
      }
      admin_club_moderation_queue: {
        Args: { p_club_id: string; p_limit?: number; p_offset?: number }
        Returns: {
          author_name: string
          body: string
          created_at: string
          is_anonymous: boolean
          target_id: string
          target_type: string
          thread_slug: string
          title: string
          total_count: number
        }[]
      }
      admin_club_pending_counts: {
        Args: never
        Returns: {
          join_requests: number
          moderation_pending: number
        }[]
      }
      admin_club_poll_create: {
        Args: {
          p_author_id?: string
          p_body: string
          p_ends_at?: string
          p_group_id: string
          p_options: Json
          p_question_en: string
          p_question_pl: string
          p_title: string
        }
        Returns: {
          poll_id: string
          thread_id: string
          thread_slug: string
        }[]
      }
      admin_club_replies: {
        Args: { p_limit?: number; p_offset?: number; p_thread_id: string }
        Returns: {
          author_id: string
          author_name: string
          body: string
          created_at: string
          depth: number
          edited_at: string
          id: string
          is_anonymous: boolean
          parent_id: string
          posted_by_admin_name: string
          reaction_count: number
          status: string
          total_count: number
        }[]
      }
      admin_club_reply_create: {
        Args: {
          p_author_id?: string
          p_body: string
          p_parent_id?: string
          p_thread_id: string
        }
        Returns: string
      }
      admin_club_restore: {
        Args: { p_reason?: string; p_target_id: string; p_target_type: string }
        Returns: boolean
      }
      admin_club_segment_preview: {
        Args: { p_club_id: string; p_rule: Json }
        Returns: {
          already_member: number
          blocked: number
          matched: number
          will_send: number
        }[]
      }
      admin_club_slug_available: {
        Args: { p_club_id?: string; p_slug: string }
        Returns: boolean
      }
      admin_club_specialization_delete: {
        Args: { _id: string }
        Returns: boolean
      }
      admin_club_specialization_set_active: {
        Args: { _id: string; _is_active: boolean }
        Returns: boolean
      }
      admin_club_specialization_upsert: {
        Args: { p_payload: Json }
        Returns: string
      }
      admin_club_specializations_list: {
        Args: never
        Returns: {
          clubs_count: number
          desc_en: string
          desc_pl: string
          icon: string
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          label_en: string
          label_pl: string
          lead_en: string
          lead_pl: string
          slug: string
          sort_order: number
        }[]
      }
      admin_club_stats: {
        Args: { p_club_id: string }
        Returns: {
          active_members_30d: number
          banned_count: number
          group_count: number
          leads_count: number
          median_first_reply_hours: number
          member_count: number
          moderators_count: number
          pending_members: number
          replies_30d: number
          reply_count: number
          thread_count: number
          threads_30d: number
          unanswered_count: number
          unanswered_pct: number
        }[]
      }
      admin_club_thread_create: {
        Args: {
          p_author_id?: string
          p_body: string
          p_group_id: string
          p_kind?: string
          p_pinned?: boolean
          p_title: string
          p_topic?: string
        }
        Returns: {
          thread_id: string
          thread_slug: string
        }[]
      }
      admin_club_thread_move: {
        Args: { p_group_id: string; p_thread_id: string }
        Returns: boolean
      }
      admin_club_threads: {
        Args: {
          p_club_id: string
          p_group_id?: string
          p_kind?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: {
          attribution_mode: string
          author_id: string
          author_name: string
          created_at: string
          group_id: string
          group_name_en: string
          group_name_pl: string
          id: string
          is_anonymous: boolean
          kind: string
          last_reply_at: string
          locked_at: string
          participant_count: number
          pinned_at: string
          posted_by_admin_name: string
          reaction_count: number
          reply_count: number
          slug: string
          status: string
          title: string
          total_count: number
        }[]
      }
      admin_club_topic_delete: { Args: { _id: string }; Returns: boolean }
      admin_club_topic_set_active: {
        Args: { _id: string; _is_active: boolean }
        Returns: boolean
      }
      admin_club_topic_upsert: {
        Args: {
          _id?: string
          _is_active?: boolean
          _key: string
          _label_en: string
          _label_pl: string
          _sort_order?: number
        }
        Returns: string
      }
      admin_club_topics_list: {
        Args: never
        Returns: {
          clubs_count: number
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          label_en: string
          label_pl: string
          sort_order: number
          threads_count: number
        }[]
      }
      admin_club_upsert: { Args: { p_payload: Json }; Returns: string }
      admin_community_stats: { Args: never; Returns: Json }
      admin_consent_decisions: {
        Args: { p_limit?: number; p_offset?: number; p_source?: string }
        Returns: {
          banner_version: string
          decided_at: string
          decision_id: string
          denied_keys: string[]
          display_name: string
          email: string
          gpc: boolean
          granted_keys: string[]
          lang: string
          page_url: string
          source: string
          user_id: string
        }[]
      }
      admin_consent_stats: {
        Args: { p_days?: number }
        Returns: {
          banner_versions: string[]
          consent_key: string
          denied: number
          gpc_events: number
          granted: number
          last_event_at: string
        }[]
      }
      admin_delete_speaker_profile: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      admin_delete_verification_domain: {
        Args: { p_id: string }
        Returns: undefined
      }
      admin_event_type_delete: { Args: { _id: string }; Returns: boolean }
      admin_event_type_reassign: {
        Args: { _from_id: string; _to_id: string }
        Returns: number
      }
      admin_event_type_set_active: {
        Args: { _id: string; _is_active: boolean }
        Returns: boolean
      }
      admin_event_type_upsert: { Args: { p_payload: Json }; Returns: string }
      admin_event_types_list: {
        Args: never
        Returns: {
          accent_color: string | null
          default_capacity: number | null
          default_chatham_house: boolean
          default_duration_minutes: number | null
          default_format: string
          default_guest_mode: string
          default_min_tier_rank: number
          default_registration_flow: string
          default_registration_mode: string
          description_en: string
          description_pl: string
          icon: string
          id: string
          key: string
          name_en: string
          name_pl: string
          requires_ticket: boolean
          sort_order: number
          events_count: number
          is_active: boolean
          is_system: boolean
          published_events_count: number
        }[]
      }
      admin_get_author_profile: {
        Args: { _user_id: string }
        Returns: {
          avatar_url: string | null
          bio_en: string | null
          bio_pl: string | null
          brand_accent: string | null
          brand_accent_dark: string | null
          company: string | null
          contact_email: string | null
          counterpart_lang: string | null
          counterpart_user_id: string | null
          created_at: string
          custom_socials: Json
          facebook_url: string | null
          full_bio_en: string | null
          full_bio_pl: string | null
          id: string
          instagram_url: string | null
          is_public: boolean
          job_title: string | null
          layout_overrides: Json | null
          layout_preset: string | null
          layout_section_order: string[] | null
          layout_template_id: string | null
          linkedin_url: string | null
          media_contact_email: string | null
          media_contact_name: string | null
          media_contact_phone: string | null
          org_functions: Json
          phone: string | null
          spotify_url: string | null
          tenant_id: string
          updated_at: string
          user_id: string
          website_url: string | null
          x_url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "author_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_get_event: {
        Args: { p_id: string }
        Returns: {
          capacity: number | null
          chatham_house: boolean
          conversation_id: string | null
          cover_url: string | null
          created_at: string
          created_by: string | null
          description_en: string | null
          description_pl: string | null
          early_rsvp_rank: number | null
          ends_at: string | null
          host_user_id: string | null
          id: string
          join_url: string | null
          kind: string
          location: string | null
          min_tier_rank: number
          program_id: string | null
          recording_url: string | null
          region_id: string | null
          rsvp_opens_at: string | null
          slug: string
          starts_at: string
          status: string
          tenant_id: string
          ticket_currency: string
          ticket_price_cents: number | null
          timezone: string
          title_en: string
          title_pl: string
          updated_at: string
          visibility: string
        }[]
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_get_speaker_profile: {
        Args: { p_user_id: string }
        Returns: {
          bio_en: string
          bio_pl: string
          crm_lead_id: string
          headline_en: string
          headline_pl: string
          id: string
          is_public: boolean
          languages: string[]
          rating: number
          reviews_count: number
          talks_count: number
          topics_en: string[]
          topics_pl: string[]
          updated_at: string
          user_id: string
        }[]
      }
      admin_get_user: {
        Args: { _user_id: string }
        Returns: {
          avatar_url: string
          bio: string
          bio_en: string
          bio_pl: string
          contact_email: string
          cover_url: string
          created_at: string
          current_company: string
          display_name: string
          email: string
          facebook_url: string
          first_name: string
          gender: Database["public"]["Enums"]["name_gender"]
          id: string
          instagram_url: string
          job_title: string
          last_name: string
          linkedin_url: string
          location: string
          phone: string
          prefs: Json
          roles: Database["public"]["Enums"]["app_role"][]
          slug: string
          specialization: string
          spotify_url: string
          twitter_url: string
          updated_at: string
          website_url: string
        }[]
      }
      admin_get_user_consent: { Args: { _user_id: string }; Returns: Json }
      admin_grant_membership: {
        Args: {
          p_email: string
          p_months?: number
          p_note?: string
          p_tier_key: string
        }
        Returns: string
      }
      admin_grant_profile_badge: {
        Args: { p_badge: string; p_note?: string; p_user_id: string }
        Returns: string
      }
      admin_list_events: {
        Args: { p_q?: string; p_status?: string }
        Returns: {
          capacity: number | null
          chatham_house: boolean
          conversation_id: string | null
          cover_url: string | null
          created_at: string
          created_by: string | null
          description_en: string | null
          description_pl: string | null
          early_rsvp_rank: number | null
          ends_at: string | null
          host_user_id: string | null
          id: string
          join_url: string | null
          kind: string
          location: string | null
          min_tier_rank: number
          program_id: string | null
          recording_url: string | null
          region_id: string | null
          rsvp_opens_at: string | null
          slug: string
          starts_at: string
          status: string
          tenant_id: string
          ticket_currency: string
          ticket_price_cents: number | null
          timezone: string
          title_en: string
          title_pl: string
          updated_at: string
          visibility: string
        }[]
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_list_expert_requests: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: {
          admin_note: string | null
          converted_conversation_id: string | null
          created_at: string
          decline_reason: string | null
          expected_answers: string | null
          external_links: string[]
          id: string
          questions: string[]
          reason: string
          recipient_id: string
          responded_at: string | null
          sender_id: string
          status: string
          subject: string
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "expert_inmails"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_list_inmails: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: {
          admin_note: string | null
          converted_conversation_id: string | null
          created_at: string
          decline_reason: string | null
          expected_answers: string | null
          external_links: string[]
          id: string
          questions: string[]
          reason: string
          recipient_id: string
          responded_at: string | null
          sender_id: string
          status: string
          subject: string
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "expert_inmails"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_list_membership_grants: {
        Args: never
        Returns: {
          created_at: string
          display_name: string
          email: string
          expires_at: string
          id: string
          note: string
          revoked_at: string
          source: string
          starts_at: string
          tier_key: string
          user_id: string
        }[]
      }
      admin_list_profile_badges: {
        Args: { p_limit?: number }
        Returns: {
          badge: string
          created_at: string
          grant_source: string
          granted_by: string
          id: string
          member_avatar_url: string
          member_display_name: string
          member_email: string
          note: string
          tenant_id: string
          user_id: string
        }[]
      }
      admin_list_user_reports: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: {
          created_at: string
          details: string
          id: string
          reason: string
          reported_id: string
          reported_name: string
          reporter_id: string
          reporter_name: string
          resolution_note: string
          resolved_at: string
          status: string
          total_count: number
        }[]
      }
      admin_list_users: {
        Args: never
        Returns: {
          avatar_url: string
          bio: string
          bio_en: string
          bio_pl: string
          cover_url: string
          created_at: string
          display_name: string
          email: string
          id: string
          linkedin_url: string
          roles: Database["public"]["Enums"]["app_role"][]
          slug: string
          twitter_url: string
          updated_at: string
          website_url: string
        }[]
      }
      admin_list_verification_domains: {
        Args: never
        Returns: {
          academic: boolean
          active: boolean
          badge: string
          created_at: string
          created_by: string | null
          domain: string
          grants_tier_key: string | null
          id: string
          note: string | null
          require_email_confirmed: boolean
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "verification_domains"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_member_activity_series: {
        Args: { p_days?: number }
        Returns: {
          active_members: number
          day: string
          new_members: number
        }[]
      }
      admin_member_funnel: {
        Args: { p_days?: number }
        Returns: {
          active_members: number
          chat_senders: number
          commenters: number
          discoverable_new: number
          discoverable_total: number
          members_new: number
          members_total: number
          newsletter_subscribed: number
          paying_members: number
          readers: number
        }[]
      }
      admin_member_retention: {
        Args: { p_weeks?: number }
        Returns: {
          active_members: number
          cohort_size: number
          cohort_start: string
          week_offset: number
        }[]
      }
      admin_network_stats: {
        Args: never
        Returns: {
          accepted_30d: number
          avg_hours_to_accept_30d: number
          connections_total: number
          invites_30d: number
          members_with_connection: number
          pending_total: number
          responded_30d: number
        }[]
      }
      admin_resolve_user_report: {
        Args: { p_action: string; p_note?: string; p_report_id: string }
        Returns: undefined
      }
      admin_revoke_profile_badge: {
        Args: { p_badge_id: string }
        Returns: boolean
      }
      admin_revoke_user_profile_badge: {
        Args: { p_badge: string; p_user_id: string }
        Returns: boolean
      }
      admin_run_org_verification: { Args: never; Returns: Json }
      admin_set_content_password: {
        Args: {
          _entity_id: string
          _entity_type: Database["public"]["Enums"]["access_entity_type"]
          _hint_en: string
          _hint_pl: string
          _password: string
        }
        Returns: undefined
      }
      admin_set_expert_requests_enabled: {
        Args: { p_enabled: boolean; p_user_id: string }
        Returns: undefined
      }
      admin_set_profile_verification: {
        Args: { p_user_id: string; p_verified: boolean }
        Returns: undefined
      }
      admin_soft_delete_message: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      admin_update_user_avatar: {
        Args: { _avatar_url: string; _user_id: string }
        Returns: undefined
      }
      admin_upsert_speaker_profile: {
        Args: {
          p_bio_en?: string
          p_bio_pl?: string
          p_headline_en?: string
          p_headline_pl?: string
          p_is_public?: boolean
          p_languages?: string[]
          p_rating?: number
          p_reviews_count?: number
          p_sync_crm?: boolean
          p_talks_count?: number
          p_topics_en?: string[]
          p_topics_pl?: string[]
          p_user_id: string
        }
        Returns: Json
      }
      admin_upsert_verification_domain: {
        Args: {
          p_academic?: boolean
          p_active?: boolean
          p_badge?: string
          p_domain: string
          p_grants_tier_key?: string
          p_note?: string
          p_require_email_confirmed?: boolean
        }
        Returns: string
      }
      analytics_semantic_snapshot: {
        Args: { p_since: string; p_until: string }
        Returns: Json
      }
      anonymize_accounting_evidence_for_user: {
        Args: { p_user_id: string }
        Returns: Json
      }
      anonymize_club_applications_for_user: {
        Args: { _user_id: string }
        Returns: number
      }
      anonymize_payment_orders_for_user: {
        Args: { p_user_id: string }
        Returns: Json
      }
      anonymize_user_purchases_for_user: {
        Args: { p_user_id: string }
        Returns: Json
      }
      apply_b2b_coupon_effects: { Args: { _order_id: string }; Returns: Json }
      apply_pricing_catalog_v3: {
        Args: { p_tenant: string }
        Returns: undefined
      }
      apply_pricing_catalog_v4: {
        Args: { p_tenant: string }
        Returns: undefined
      }
      apply_pricing_catalog_v5: {
        Args: { p_tenant: string }
        Returns: undefined
      }
      arm_job_runner: { Args: { p_base_url: string }; Returns: Json }
      ask_qa_question: {
        Args: { p_anonymous?: boolean; p_body: string; p_session_id: string }
        Returns: string
      }
      assert_admin_tenant: { Args: never; Returns: string }
      authorize_resource_download: {
        Args: { p_resource: string }
        Returns: {
          file_name: string
          file_path: string
          mime_type: string
        }[]
      }
      auto_connect_experts: { Args: never; Returns: number }
      b2b_coupons_analytics: {
        Args: { _from: string; _to: string }
        Returns: {
          code: string
          coupon_id: string
          discount_cents_total: number
          name: string
          redemptions: number
          revenue_cents: number
        }[]
      }
      b64url_decode: { Args: { p_value: string }; Returns: string }
      b64url_encode: { Args: { p_value: string }; Returns: string }
      book_meeting_slot: {
        Args: { p_note?: string; p_slot_id: string }
        Returns: Json
      }
      bulk_generate_coupons_for_campaign: {
        Args: { _campaign_id: string }
        Returns: number
      }
      bump_tenant_counter: {
        Args: { p_delta: number; p_key: string; p_tenant_id: string }
        Returns: undefined
      }
      bump_user_counter: {
        Args: {
          p_delta: number
          p_key: string
          p_tenant_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      caller_is_connected_to: { Args: { p_user_id: string }; Returns: boolean }
      caller_is_tenant_staff: { Args: never; Returns: boolean }
      can_access_entity_presence: {
        Args: { _entity_id: string; _entity_type: string }
        Returns: boolean
      }
      can_gift_articles: { Args: never; Returns: boolean }
      can_manage_profile_verification: {
        Args: { _user_id?: string }
        Returns: boolean
      }
      can_publish_content: { Args: { _user_id?: string }; Returns: boolean }
      can_share_full_article: { Args: never; Returns: boolean }
      cancel_my_meeting_booking: {
        Args: { p_slot_id: string }
        Returns: boolean
      }
      career_cv_gc_claim: { Args: { _limit?: number }; Returns: Json }
      career_cv_gc_done: { Args: { _paths: string[] }; Returns: number }
      career_cv_gc_fail: {
        Args: { _error: string; _path: string }
        Returns: undefined
      }
      career_cv_gc_scan: { Args: { _limit?: number }; Returns: Json }
      change_user_role: {
        Args: {
          _new_role: Database["public"]["Enums"]["app_role"]
          _target_user_id: string
        }
        Returns: Database["public"]["Enums"]["app_role"][]
      }
      chat_accepts_new_thread: {
        Args: { _initiator: string; _peer: string }
        Returns: boolean
      }
      chat_allow_messages_from: { Args: { _user: string }; Returns: string }
      chat_check_upload_quota: { Args: never; Returns: undefined }
      chat_clear_history: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      chat_purge_expired_messages: { Args: never; Returns: number }
      chat_read_receipts_enabled: { Args: { _user: string }; Returns: boolean }
      chat_set_appearance: {
        Args: {
          p_conversation_id: string
          p_quick_emoji?: string
          p_theme?: string
          p_wallpaper?: string
        }
        Returns: undefined
      }
      chat_set_archived: {
        Args: { p_archived: boolean; p_conversation_id: string }
        Returns: undefined
      }
      chat_set_group_description: {
        Args: { p_conversation_id: string; p_description: string }
        Returns: undefined
      }
      chat_set_message_ttl: {
        Args: { p_conversation_id: string; p_ttl_seconds: number }
        Returns: undefined
      }
      chat_set_muted: {
        Args: { p_conversation_id: string; p_seconds: number }
        Returns: undefined
      }
      chat_set_nickname: {
        Args: {
          p_conversation_id: string
          p_nickname: string
          p_user_id: string
        }
        Returns: undefined
      }
      chat_set_pinned: {
        Args: { p_conversation_id: string; p_pinned: boolean }
        Returns: undefined
      }
      chat_show_online_status: { Args: { _user: string }; Returns: boolean }
      chat_topic_conversation_id: { Args: { _topic: string }; Returns: string }
      claim_command: {
        Args: { p_command: string; p_key: string }
        Returns: Json
      }
      claim_due_digests: {
        Args: { p_frequency: string; p_limit?: number }
        Returns: {
          display_name: string
          email: string
          items: Json
          user_id: string
        }[]
      }
      claim_included_event_ticket: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      claim_integration_deliveries: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          delivered_at: string | null
          endpoint_id: string
          event_id: string | null
          event_type: string
          id: string
          last_error: string | null
          next_attempt_at: string
          payload: Json
          status: string
          tenant_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "integration_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_my_org_seats: { Args: never; Returns: number }
      claim_push_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          id: number
          next_attempt_at: string
          notification_id: string | null
          payload: Json
          sent_at: string | null
          status: string
          tenant_id: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_push_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      club_accept_rules: { Args: { p_club_id: string }; Returns: boolean }
      club_activity_feed: {
        Args: {
          p_limit?: number
          p_per_club?: number
          p_policy_area?: string
          p_sort?: string
        }
        Returns: {
          author_alias: string
          author_name: string
          club_cover_image_url: string
          club_id: string
          club_name_en: string
          club_name_pl: string
          club_policy_area: string
          club_slug: string
          created_at: string
          excerpt: string
          group_name_en: string
          group_name_pl: string
          is_anonymous: boolean
          kind: string
          last_reply_at: string
          participant_count: number
          reply_count: number
          status: string
          thread_id: string
          thread_slug: string
          title: string
        }[]
      }
      club_activity_series: {
        Args: { p_club_id: string; p_days?: number }
        Returns: {
          day: string
          participants: number
          replies: number
          threads: number
        }[]
      }
      club_anchor_label: {
        Args: { p_id: string; p_type: string }
        Returns: string
      }
      club_anchor_suggest: {
        Args: { p_anchor_type?: string; p_limit?: number; p_query: string }
        Returns: {
          anchor_id: string
          anchor_type: string
          hint: string
          label_en: string
          label_pl: string
        }[]
      }
      club_anonymity_salt: { Args: { _tenant_id: string }; Returns: string }
      club_application_crm_sync: { Args: { p_id: string }; Returns: string }
      club_apply_submit: { Args: { p: Json }; Returns: string }
      club_author_alias: {
        Args: { _author_id: string; _thread_id: string }
        Returns: string
      }
      club_ban_member: {
        Args: {
          p_banned: boolean
          p_club_id: string
          p_reason?: string
          p_user_id: string
        }
        Returns: boolean
      }
      club_board_notice_close: {
        Args: { p_notice_id: string }
        Returns: boolean
      }
      club_board_notice_create: {
        Args: {
          p_body: string
          p_club_id: string
          p_days?: number
          p_kind: string
          p_topic?: string
        }
        Returns: string
      }
      club_board_notices_list: {
        Args: {
          p_club_id: string
          p_include_closed?: boolean
          p_kind?: string
          p_limit?: number
          p_mine?: boolean
          p_offset?: number
          p_topic?: string
        }
        Returns: {
          author_avatar: string
          author_headline: string
          author_id: string
          author_name: string
          author_slug: string
          body: string
          can_close: boolean
          closed_at: string
          created_at: string
          expires_at: string
          id: string
          is_expired: boolean
          is_mine: boolean
          kind: string
          status: string
          topic: string
          total_count: number
        }[]
      }
      club_bump_unread: {
        Args: { p_actor_id: string; p_club_id: string }
        Returns: undefined
      }
      club_capabilities: {
        Args: { _club_id: string; _group_id?: string; _user_id?: string }
        Returns: {
          can_invite: boolean
          can_manage: boolean
          can_moderate: boolean
          can_post_thread: boolean
          can_react: boolean
          can_read: boolean
          can_reply: boolean
          can_reveal_author: boolean
          can_see_members: boolean
          effective_role: string
          reason: string
        }[]
      }
      club_create_thread: {
        Args: {
          p_anchor_id?: string
          p_anchor_type?: string
          p_anonymous?: boolean
          p_attribution_mode?: string
          p_body: string
          p_group_id: string
          p_icon?: string
          p_idempotency_key?: string
          p_kind?: string
          p_lock_replies?: boolean
          p_title: string
          p_topic?: string
        }
        Returns: {
          id: string
          slug: string
          status: string
        }[]
      }
      club_document_delete: {
        Args: { p_document_id: string }
        Returns: boolean
      }
      club_document_register_download: {
        Args: { p_document_id: string }
        Returns: boolean
      }
      club_document_upsert: {
        Args: { p_club_id: string; p_payload: Json }
        Returns: string
      }
      club_documents_list: {
        Args: {
          p_club_id: string
          p_group_id?: string
          p_kind?: string
          p_kinds?: string[]
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: {
          can_manage: boolean
          club_id: string
          created_at: string
          download_count: number
          external_url: string
          file_size: number
          file_url: string
          group_id: string
          group_name_en: string
          group_name_pl: string
          id: string
          kind: string
          language: string
          mime_type: string
          pinned_at: string
          published_at: string
          slug: string
          source_label: string
          status: string
          summary_en: string
          summary_pl: string
          thread_id: string
          thread_slug: string
          title_en: string
          title_pl: string
          total_count: number
          updated_at: string
          uploader_name: string
          version: string
          visibility: string
        }[]
      }
      club_edit_reply: {
        Args: { p_body: string; p_reply_id: string }
        Returns: boolean
      }
      club_edit_thread: {
        Args: { p_body: string; p_thread_id: string; p_title: string }
        Returns: boolean
      }
      club_effective_member_role: {
        Args: { _role: string; _role_expires_at: string }
        Returns: string
      }
      club_event_attendees: {
        Args: { p_event_id: string; p_limit?: number }
        Returns: {
          avatar_url: string
          display_name: string
          headline: string
          is_me: boolean
          profile_slug: string
          state: string
          total_count: number
          user_id: string
        }[]
      }
      club_event_delete: { Args: { p_event_id: string }; Returns: boolean }
      club_event_rsvp: {
        Args: { p_event_id: string; p_state: string }
        Returns: boolean
      }
      club_event_upsert: {
        Args: { p_club_id: string; p_payload: Json }
        Returns: string
      }
      club_event_view: {
        Args: { p_club_id: string; p_slug: string }
        Returns: {
          all_day: boolean
          anchor_event_id: string
          can_manage: boolean
          capacity: number
          club_id: string
          created_at: string
          description_en: string
          description_pl: string
          ends_at: string
          going_count: number
          group_id: string
          group_name_en: string
          group_name_pl: string
          id: string
          kind: string
          location: string
          meeting_url: string
          my_rsvp: string
          rsvp_enabled: boolean
          slug: string
          starts_at: string
          status: string
          thread_id: string
          thread_slug: string
          title_en: string
          title_pl: string
        }[]
      }
      club_events_list: {
        Args: {
          p_club_id: string
          p_from?: string
          p_kind?: string
          p_limit?: number
          p_to?: string
        }
        Returns: {
          all_day: boolean
          anchor_event_id: string
          can_manage: boolean
          capacity: number
          club_id: string
          created_at: string
          description_en: string
          description_pl: string
          ends_at: string
          going_count: number
          group_id: string
          group_name_en: string
          group_name_pl: string
          id: string
          kind: string
          location: string
          meeting_url: string
          min_tier_rank: number
          my_rsvp: string
          rsvp_enabled: boolean
          slug: string
          starts_at: string
          status: string
          thread_id: string
          thread_slug: string
          title_en: string
          title_pl: string
        }[]
      }
      club_expertise_areas: {
        Args: { p_club_id: string }
        Returns: {
          people: number
          topic: string
        }[]
      }
      club_expertise_mine: {
        Args: { p_club_id: string }
        Returns: {
          topic: string
        }[]
      }
      club_expertise_set: {
        Args: { p_club_id: string; p_topics: string[] }
        Returns: number
      }
      club_experts_list: {
        Args: {
          p_club_id: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_topic?: string
        }
        Returns: {
          avatar_url: string
          club_role: string
          display_name: string
          headline: string
          joined_at: string
          last_active_at: string
          profile_slug: string
          reply_count: number
          thread_count: number
          topics: string[]
          total_count: number
          user_id: string
        }[]
      }
      club_export_my_data: { Args: { p_limit?: number }; Returns: Json }
      club_groups_list: {
        Args: { p_club_id: string }
        Returns: {
          accent_color: string
          anchor_id: string
          anchor_type: string
          attribution_mode: string
          attribution_mode_inherited: boolean
          can_post_thread: boolean
          can_read: boolean
          closes_at: string
          club_id: string
          description_en: string
          description_pl: string
          icon: string
          id: string
          last_activity_at: string
          min_tier_rank: number
          min_tier_rank_inherited: boolean
          moderation_mode: string
          moderation_mode_inherited: boolean
          name_en: string
          name_pl: string
          opens_at: string
          reason: string
          slug: string
          sort_order: number
          status: string
          thread_count: number
          visibility: string
          visibility_inherited: boolean
          who_can_post: string
          who_can_post_inherited: boolean
        }[]
      }
      club_invite: {
        Args: {
          p_club_id: string
          p_group_id?: string
          p_message?: string
          p_role?: string
          p_user_id: string
        }
        Returns: string
      }
      club_invite_by_email: {
        Args: {
          p_club_id: string
          p_email: string
          p_group_id?: string
          p_role?: string
        }
        Returns: string
      }
      club_invite_quota_ok: { Args: { _user_id: string }; Returns: boolean }
      club_is_any_moderator: { Args: { _user_id: string }; Returns: boolean }
      club_join: { Args: { p_club_id: string }; Returns: string }
      club_leave: { Args: { p_club_id: string }; Returns: boolean }
      club_linked_item_label: {
        Args: { p_id: string; p_type: string }
        Returns: string
      }
      club_list: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          accent_color: string
          can_read: boolean
          cover_image_url: string
          group_count: number
          icon: string
          id: string
          join_policy: string
          last_activity_at: string
          member_count: number
          min_tier_rank: number
          my_role: string
          my_status: string
          name_en: string
          name_pl: string
          policy_area: string
          slug: string
          status: string
          tagline_en: string
          tagline_pl: string
          thread_count: number
          total_count: number
          visibility: string
        }[]
      }
      club_list_by_specialization: {
        Args: { p_limit?: number; p_offset?: number; p_slug: string }
        Returns: {
          accent_color: string
          can_read: boolean
          cover_image_url: string
          group_count: number
          icon: string
          id: string
          join_policy: string
          last_activity_at: string
          member_count: number
          min_tier_rank: number
          my_role: string
          my_status: string
          name_en: string
          name_pl: string
          policy_area: string
          slug: string
          specialization_slug: string
          status: string
          tagline_en: string
          tagline_pl: string
          thread_count: number
          total_count: number
          visibility: string
        }[]
      }
      club_mark_read: { Args: { p_club_id: string }; Returns: number }
      club_member_spotlight_current: {
        Args: { p_club_id: string }
        Returns: {
          avatar_url: string
          bio_en: string
          bio_pl: string
          blurb_en: string
          blurb_pl: string
          club_role: string
          curated: boolean
          display_name: string
          headline: string
          joined_at: string
          profile_slug: string
          topics: string[]
          user_id: string
          week_start: string
        }[]
      }
      club_member_spotlight_delete: { Args: { p_id: string }; Returns: boolean }
      club_member_spotlight_history: {
        Args: { p_club_id: string; p_limit?: number }
        Returns: {
          avatar_url: string
          blurb_en: string
          blurb_pl: string
          can_manage: boolean
          display_name: string
          headline: string
          id: string
          is_current: boolean
          profile_slug: string
          topics: string[]
          user_id: string
          week_start: string
        }[]
      }
      club_member_spotlight_upsert: {
        Args: {
          p_blurb_en?: string
          p_blurb_pl?: string
          p_club_id: string
          p_user_id: string
          p_week_start?: string
        }
        Returns: string
      }
      club_members_list: {
        Args: {
          p_club_id: string
          p_limit?: number
          p_offset?: number
          p_status?: string
        }
        Returns: {
          avatar_url: string
          current_company: string
          display_name: string
          invite_source: string
          job_title: string
          joined_at: string
          role: string
          role_expires_at: string
          slug: string
          status: string
          total_count: number
          user_id: string
          verified: boolean
        }[]
      }
      club_mention_visible_to: {
        Args: { p_source_id: string; p_source_type: string; p_user_id: string }
        Returns: boolean
      }
      club_milestone_delete: {
        Args: { p_milestone_id: string }
        Returns: boolean
      }
      club_milestone_upsert: {
        Args: { p_club_id: string; p_payload: Json }
        Returns: string
      }
      club_milestones_list: {
        Args: { p_club_id: string }
        Returns: {
          can_manage: boolean
          club_id: string
          created_at: string
          description_en: string
          description_pl: string
          due_on: string
          id: string
          order_index: number
          progress: number
          slug: string
          starts_on: string
          state: string
          thread_id: string
          thread_slug: string
          title_en: string
          title_pl: string
        }[]
      }
      club_moderate: {
        Args: {
          p_action: string
          p_reason?: string
          p_target_id: string
          p_target_type: string
        }
        Returns: boolean
      }
      club_moderator_reveal_author: {
        Args: { p_reason: string; p_target_id: string; p_target_type: string }
        Returns: {
          author_id: string
          display_name: string
          profile_slug: string
        }[]
      }
      club_my_applications: {
        Args: never
        Returns: {
          club_id: string
          club_name_en: string
          club_name_pl: string
          created_at: string
          id: string
          reviewed_at: string
          specialization_slug: string
          status: string
        }[]
      }
      club_my_invitations: {
        Args: never
        Returns: {
          club_icon: string
          club_id: string
          club_name_en: string
          club_name_pl: string
          club_role: string
          club_slug: string
          created_at: string
          expires_at: string
          id: string
          inviter_name: string
          message: string
        }[]
      }
      club_my_memberships: {
        Args: never
        Returns: {
          accent_color: string
          club_id: string
          icon: string
          last_activity_at: string
          last_read_at: string
          member_count: number
          name_en: string
          name_pl: string
          notify_level: string
          role: string
          role_expires_at: string
          slug: string
          status: string
          thread_count: number
          unread_count: number
        }[]
      }
      club_my_subscription: { Args: { p_thread_id: string }; Returns: string }
      club_notify: {
        Args: {
          _actor_id: string
          _body_en: string
          _body_pl: string
          _href: string
          _title_en: string
          _title_pl: string
          _user_id: string
        }
        Returns: undefined
      }
      club_post_create: {
        Args: {
          p_attachments?: Json
          p_body?: string
          p_club_id: string
          p_group_id?: string
          p_thread_id?: string
        }
        Returns: {
          post_id: string
        }[]
      }
      club_post_delete: { Args: { p_post_id: string }; Returns: boolean }
      club_post_toggle_like: {
        Args: { p_post_id: string }
        Returns: {
          like_count: number
          liked: boolean
        }[]
      }
      club_posts_list: {
        Args: {
          p_club_id: string
          p_cursor?: string
          p_group_id?: string
          p_limit?: number
          p_thread_id?: string
        }
        Returns: {
          attachments: Json
          author_avatar: string
          author_id: string
          author_name: string
          author_slug: string
          body: string
          can_manage: boolean
          club_id: string
          created_at: string
          edited_at: string
          group_id: string
          group_name_en: string
          group_name_pl: string
          id: string
          like_count: number
          liked_by_me: boolean
          thread_id: string
          thread_slug: string
          thread_title: string
          total_count: number
        }[]
      }
      club_prune_thread_embeddings: { Args: never; Returns: number }
      club_react: {
        Args: { p_kind: string; p_target_id: string; p_target_type: string }
        Returns: boolean
      }
      club_reaction_actors: {
        Args: {
          p_limit?: number
          p_target_ids: string[]
          p_target_type: string
        }
        Returns: {
          actor_rank: number
          avatar_url: string
          display_name: string
          headline: string
          is_me: boolean
          kind: string
          slug: string
          target_id: string
          user_id: string
        }[]
      }
      club_reactions_for: {
        Args: { p_target_ids: string[]; p_target_type: string }
        Returns: {
          kind: string
          mine: boolean
          target_id: string
          total: number
        }[]
      }
      club_redeem_invite_link: {
        Args: { p_token: string }
        Returns: {
          club_slug: string
          status: string
        }[]
      }
      club_replies_list: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_sort?: string
          p_thread_id: string
        }
        Returns: {
          author_alias: string
          author_avatar: string
          author_id: string
          author_name: string
          author_slug: string
          author_stance: string
          body: string
          created_at: string
          depth: number
          edited_at: string
          id: string
          is_anonymous: boolean
          is_resolution: boolean
          parent_id: string
          posted_by_admin_name: string
          reaction_count: number
          status: string
          total_count: number
        }[]
      }
      club_reply: {
        Args: {
          p_anonymous?: boolean
          p_body: string
          p_parent_id?: string
          p_thread_id: string
        }
        Returns: {
          reply_id: string
          reply_status: string
        }[]
      }
      club_report_content: {
        Args: {
          p_details?: string
          p_reason: string
          p_target_id: string
          p_target_type: string
        }
        Returns: string
      }
      club_require_curator: { Args: { _club_id: string }; Returns: string }
      club_resolve_thread: {
        Args: { p_reply_id: string; p_thread_id: string }
        Returns: boolean
      }
      club_respond_invitation: {
        Args: { p_accept: boolean; p_invitation_id: string }
        Returns: string
      }
      club_roster_signal: {
        Args: { p_club_id: string; p_limit?: number }
        Returns: {
          active_24h: number
          active_7d: number
          faces: Json
          members_total: number
          new_7d: number
        }[]
      }
      club_scheduler_tick: { Args: never; Returns: Json }
      club_search: {
        Args: { p_club_id?: string; p_limit?: number; p_query: string }
        Returns: {
          club_id: string
          club_name_en: string
          club_name_pl: string
          club_slug: string
          kind: string
          last_reply_at: string
          rank: number
          reply_count: number
          snippet: string
          thread_id: string
          thread_slug: string
          title: string
        }[]
      }
      club_segment_candidate_ids: {
        Args: { p_rule: Json }
        Returns: {
          user_id: string
        }[]
      }
      club_segment_recipients: {
        Args: { p_club_id: string; p_rule: Json }
        Returns: {
          user_id: string
        }[]
      }
      club_semantic_search: {
        Args: {
          p_club_id?: string
          p_embedding: number[]
          p_limit?: number
          p_threshold?: number
        }
        Returns: {
          club_id: string
          club_name_en: string
          club_name_pl: string
          club_slug: string
          kind: string
          last_reply_at: string
          reply_count: number
          similarity: number
          thread_id: string
          thread_slug: string
          title: string
        }[]
      }
      club_set_cover: {
        Args: { p_club_id: string; p_url: string }
        Returns: string
      }
      club_set_notify_level: {
        Args: { p_club_id: string; p_level: string }
        Returns: boolean
      }
      club_set_role: {
        Args: {
          p_club_id: string
          p_expires_at?: string
          p_role: string
          p_user_id: string
        }
        Returns: boolean
      }
      club_set_stance: {
        Args: { p_rationale?: string; p_stance: string; p_thread_id: string }
        Returns: boolean
      }
      club_specializations_public: {
        Args: never
        Returns: {
          club_count: number
          desc_en: string
          desc_pl: string
          icon: string
          key: string
          label_en: string
          label_pl: string
          lead_en: string
          lead_pl: string
          slug: string
          sort_order: number
        }[]
      }
      club_stance_summary: {
        Args: { p_thread_id: string }
        Returns: {
          mine: boolean
          stance: string
          total: number
        }[]
      }
      club_subscribe_thread: {
        Args: { p_state: string; p_thread_id: string }
        Returns: boolean
      }
      club_thread_access: {
        Args: { p_thread_id: string }
        Returns: {
          attribution_mode: string
          author_id: string
          can_moderate: boolean
          can_read: boolean
          can_reply: boolean
          club_id: string
          group_id: string
          hide_identity: boolean
          is_locked: boolean
          tenant_id: string
          thread_id: string
        }[]
      }
      club_thread_document_remove: {
        Args: { p_document_id: string }
        Returns: undefined
      }
      club_thread_document_upsert: {
        Args: { p_payload: Json }
        Returns: string
      }
      club_thread_documents_list: {
        Args: { p_kind?: string; p_limit?: number; p_thread_id: string }
        Returns: {
          added_by_id: string
          added_by_name: string
          added_by_slug: string
          byte_size: number
          can_edit: boolean
          created_at: string
          description: string
          id: string
          is_primary: boolean
          kind: string
          mime_type: string
          published_on: string
          sort_order: number
          source_label: string
          title: string
          url: string
        }[]
      }
      club_thread_embedding_source: {
        Args: { p_thread_id: string }
        Returns: string
      }
      club_thread_expert_ping: {
        Args: { p_thread_id: string; p_user_id: string }
        Returns: boolean
      }
      club_thread_experts: {
        Args: { p_limit?: number; p_thread_id: string }
        Returns: {
          avatar_url: string
          club_role: string
          display_name: string
          headline: string
          in_thread: boolean
          pinged_by_me: boolean
          profile_slug: string
          topic: string
          topics: string[]
          user_id: string
        }[]
      }
      club_thread_hotness: {
        Args: {
          _created_at: string
          _participant_count: number
          _quality_reactions: number
          _reply_count: number
          _stance_count: number
        }
        Returns: number
      }
      club_thread_insights: {
        Args: { p_buckets?: number; p_thread_id: string }
        Returns: {
          bucket_end: string
          bucket_index: number
          bucket_start: string
          documents: number
          milestones: number
          questions: number
          replies: number
        }[]
      }
      club_thread_link_add: {
        Args: {
          p_note?: string
          p_related_thread_id: string
          p_relation?: string
          p_thread_id: string
        }
        Returns: string
      }
      club_thread_link_remove: {
        Args: { p_link_id: string }
        Returns: undefined
      }
      club_thread_links_list: {
        Args: { p_thread_id: string }
        Returns: {
          can_remove: boolean
          club_name_en: string
          club_name_pl: string
          club_slug: string
          created_at: string
          direction: string
          id: string
          kind: string
          last_reply_at: string
          note: string
          relation: string
          reply_count: number
          status: string
          thread_id: string
          thread_slug: string
          title: string
        }[]
      }
      club_thread_milestone_remove: {
        Args: { p_milestone_id: string }
        Returns: undefined
      }
      club_thread_milestone_upsert: {
        Args: { p_payload: Json }
        Returns: string
      }
      club_thread_milestones_list: {
        Args: {
          p_from?: string
          p_limit?: number
          p_thread_id: string
          p_to?: string
        }
        Returns: {
          all_day: boolean
          can_edit: boolean
          created_at: string
          description: string
          ends_at: string
          event_id: string
          event_slug: string
          id: string
          kind: string
          location: string
          owner_id: string
          owner_name: string
          owner_slug: string
          sort_order: number
          starts_at: string
          status: string
          title: string
          url: string
        }[]
      }
      club_thread_participants: {
        Args: { p_limit?: number; p_thread_id: string }
        Returns: {
          alias: string
          avatar_url: string
          club_role: string
          display_name: string
          document_count: number
          first_at: string
          is_thread_author: boolean
          last_at: string
          participant_key: string
          profile_slug: string
          question_count: number
          reactions_received: number
          reply_count: number
          stance: string
          user_id: string
        }[]
      }
      club_thread_poll_create: {
        Args: {
          p_ends_at?: string
          p_label?: string
          p_options: Json
          p_question_en: string
          p_question_pl: string
          p_thread_id: string
        }
        Returns: string
      }
      club_thread_poll_detach: {
        Args: { p_link_id: string }
        Returns: undefined
      }
      club_thread_polls_list: {
        Args: { p_thread_id: string }
        Returns: {
          can_remove: boolean
          created_at: string
          ends_at: string
          id: string
          label: string
          poll_id: string
          poll_status: string
          question_en: string
          question_pl: string
          sort_order: number
        }[]
      }
      club_thread_quality_score: {
        Args: { _thread_id: string }
        Returns: number
      }
      club_thread_question_answer: {
        Args: { p_body: string; p_question_id: string; p_status?: string }
        Returns: undefined
      }
      club_thread_question_ask: {
        Args: { p_anonymous?: boolean; p_body: string; p_thread_id: string }
        Returns: string
      }
      club_thread_question_vote: {
        Args: { p_on?: boolean; p_question_id: string }
        Returns: number
      }
      club_thread_questions_list: {
        Args: {
          p_limit?: number
          p_sort?: string
          p_status?: string
          p_thread_id: string
        }
        Returns: {
          answer_body: string
          answered_at: string
          answered_by_id: string
          answered_by_name: string
          author_alias: string
          author_avatar: string
          author_id: string
          author_name: string
          author_slug: string
          body: string
          can_answer: boolean
          can_edit: boolean
          created_at: string
          id: string
          my_vote: boolean
          status: string
          vote_count: number
        }[]
      }
      club_thread_seam_context: {
        Args: { p_thread_id: string }
        Returns: {
          club_id: string
          club_slug: string
          emit: boolean
          group_id: string
          hide_actor: boolean
          tenant_id: string
          thread_slug: string
        }[]
      }
      club_thread_search: {
        Args: { p_limit?: number; p_query: string; p_thread_id: string }
        Returns: {
          author_label: string
          item_id: string
          occurred_at: string
          rank: number
          section: string
          snippet: string
          title: string
        }[]
      }
      club_thread_view: {
        Args: { p_club_id: string; p_slug: string }
        Returns: {
          anchor_id: string
          anchor_type: string
          attribution_mode: string
          author_alias: string
          author_avatar: string
          author_id: string
          author_name: string
          author_slug: string
          body: string
          can_moderate: boolean
          can_reply: boolean
          club_id: string
          created_at: string
          edited_at: string
          group_id: string
          icon: string
          id: string
          is_anonymous: boolean
          kind: string
          locked_at: string
          participant_count: number
          pinned_at: string
          poll_id: string
          posted_by_admin_name: string
          reaction_count: number
          reason: string
          reply_count: number
          resolved_reply_id: string
          slug: string
          status: string
          title: string
          topic: string
        }[]
      }
      club_thread_workspace: {
        Args: { p_thread_id: string }
        Returns: {
          can_contribute: boolean
          can_curate: boolean
          document_count: number
          link_count: number
          milestone_count: number
          next_milestone_at: string
          open_poll_count: number
          open_question_count: number
          participant_count: number
          poll_count: number
          question_count: number
          reply_count: number
          thread_id: string
          upcoming_count: number
        }[]
      }
      club_threads_for_anchor: {
        Args: { p_anchor_id: string; p_anchor_type: string; p_limit?: number }
        Returns: {
          club_name_en: string
          club_name_pl: string
          club_slug: string
          kind: string
          last_reply_at: string
          reply_count: number
          thread_id: string
          thread_slug: string
          title: string
        }[]
      }
      club_threads_list: {
        Args: {
          p_anchored?: boolean
          p_club_id: string
          p_cursor?: string
          p_group_id?: string
          p_kind?: string
          p_limit?: number
          p_sort?: string
          p_status?: string
          p_topic?: string
          p_unread_only?: boolean
        }
        Returns: {
          anchor_id: string
          anchor_label: string
          anchor_type: string
          author_alias: string
          author_avatar: string
          author_id: string
          author_name: string
          author_slug: string
          created_at: string
          cursor_value: string
          excerpt: string
          group_id: string
          group_name_en: string
          group_name_pl: string
          hotness: number
          icon: string
          id: string
          insightful_count: number
          is_anonymous: boolean
          is_unread: boolean
          kind: string
          last_reply_at: string
          participant_count: number
          pinned_at: string
          posted_by_admin_name: string
          reaction_count: number
          reply_count: number
          slug: string
          status: string
          title: string
          topic: string
        }[]
      }
      club_threads_mark_dormant: { Args: { p_limit?: number }; Returns: number }
      club_threads_needing_embeddings: {
        Args: { p_limit?: number }
        Returns: {
          source: string
          source_hash: string
          tenant_id: string
          thread_id: string
        }[]
      }
      club_threads_refresh_hotness: {
        Args: { p_limit?: number }
        Returns: number
      }
      club_topic_valid: { Args: { _topic: string }; Returns: boolean }
      club_topics_active: {
        Args: never
        Returns: {
          key: string
          label_en: string
          label_pl: string
          sort_order: number
        }[]
      }
      club_unreact: {
        Args: { p_kind: string; p_target_id: string; p_target_type: string }
        Returns: boolean
      }
      club_upsert_thread_embedding: {
        Args: {
          p_embedding: number[]
          p_source_hash: string
          p_thread_id: string
        }
        Returns: boolean
      }
      club_view: {
        Args: { p_slug: string }
        Returns: {
          accent_color: string
          attribution_mode: string
          can_invite: boolean
          can_manage: boolean
          can_moderate: boolean
          can_post_thread: boolean
          can_read: boolean
          can_reply: boolean
          can_see_members: boolean
          cover_image_url: string
          created_at: string
          description_en: string
          description_pl: string
          group_count: number
          icon: string
          id: string
          join_policy: string
          last_activity_at: string
          layout: string
          member_count: number
          min_tier_rank: number
          moderation_mode: string
          my_role: string
          my_status: string
          name_en: string
          name_pl: string
          policy_area: string
          reason: string
          rules_accepted_at: string
          rules_en: string
          rules_pl: string
          slug: string
          status: string
          tagline_en: string
          tagline_pl: string
          thread_count: number
          visibility: string
          who_can_post: string
        }[]
      }
      club_workspace_stats: {
        Args: { p_club_id: string; p_days?: number }
        Returns: {
          active_participants: number
          documents_count: number
          group_breakdown: Json
          kind_breakdown: Json
          median_first_reply_hours: number
          open_milestones: number
          replies_total: number
          replies_window: number
          threads_total: number
          threads_window: number
          top_contributors: Json
          unanswered: number
          upcoming_events: number
        }[]
      }
      comments_moderation_enabled: {
        Args: { _tenant_id: string }
        Returns: boolean
      }
      complete_command: {
        Args: { p_key: string; p_result?: Json; p_succeeded: boolean }
        Returns: undefined
      }
      compute_crm_lead_score: {
        Args: { p_lead_id: string }
        Returns: undefined
      }
      connection_cancel: {
        Args: { p_connection_id: string }
        Returns: undefined
      }
      connection_remove: { Args: { p_user_id: string }; Returns: undefined }
      connection_request: {
        Args: { p_message?: string; p_user_id: string }
        Returns: string
      }
      connection_respond: {
        Args: { p_accept: boolean; p_connection_id: string }
        Returns: undefined
      }
      connection_statuses: {
        Args: { p_user_ids: string[] }
        Returns: {
          bridge_avatar: string
          bridge_id: string
          bridge_name: string
          bridge_slug: string
          can_invite: boolean
          connection_id: string
          degree: number
          mutual_count: number
          status: string
          user_id: string
        }[]
      }
      connection_suggestions: {
        Args: { p_limit?: number }
        Returns: {
          avatar_url: string
          bridge_avatar: string
          bridge_id: string
          bridge_name: string
          bridge_slug: string
          completeness_score: number
          current_company: string
          degree: number
          display_name: string
          job_title: string
          location: string
          mutual_count: number
          open_to: string[]
          shared_events: number
          shared_follows: number
          slug: string
          specialization: string
          user_id: string
          verified: boolean
        }[]
      }
      connections_allowed_from: {
        Args: { _requester: string; _target: string }
        Returns: boolean
      }
      consume_metered_view: {
        Args: {
          _entity_id: string
          _entity_type: Database["public"]["Enums"]["access_entity_type"]
          _visitor_id?: string
        }
        Returns: {
          blocks_data: Json
          builder_data: Json
          consumed: boolean
          content_en: string
          content_pl: string
          granted: boolean
          monthly_limit: number
          remaining: number
          requires_registration: boolean
          show_counter: boolean
          used: number
        }[]
      }
      content_access_has_password: {
        Args: {
          _entity_id: string
          _entity_type: Database["public"]["Enums"]["access_entity_type"]
        }
        Returns: boolean
      }
      contribution_scores: {
        Args: { p_since: string }
        Returns: {
          breakdown: Json
          points: number
          user_id: string
        }[]
      }
      create_company_self_service: {
        Args: {
          _address?: string
          _branch?: string
          _city?: string
          _country?: string
          _domain?: string
          _logo_url?: string
          _name: string
          _phone?: string
          _postal_code?: string
          _website?: string
        }
        Returns: string
      }
      create_event_group: { Args: { p_event_id: string }; Returns: string }
      create_gift_link: {
        Args: { _post_id: string }
        Returns: {
          code: string
          expires_at: string
          max_redemptions: number
          monthly_limit: number
          redemption_count: number
          redemptions_remaining: number
          remaining: number
          used: number
        }[]
      }
      create_group_conversation: {
        Args: { p_member_ids: string[]; p_title: string }
        Returns: string
      }
      create_my_meeting_slot: {
        Args: {
          p_ends_at: string
          p_event_id?: string
          p_location?: string
          p_starts_at: string
        }
        Returns: string
      }
      crm_backfill_all_leads: {
        Args: never
        Returns: {
          profiles_synced: number
          subscribers_synced: number
        }[]
      }
      crm_companies_aggregates: {
        Args: { _company_ids: string[] }
        Returns: {
          company_id: string
          contacts_count: number
          last_lead_activity_at: string
          leads_count: number
        }[]
      }
      crm_enqueue_lead_push: {
        Args: { p_endpoint_id?: string; p_lead_id: string }
        Returns: number
      }
      crm_funnel_stats: {
        Args: never
        Returns: {
          contacts: number
          pending: number
          registered: number
          subscribed: number
          total: number
          unsubscribed: number
        }[]
      }
      crm_get_merydian_secrets: {
        Args: { _tenant?: string }
        Returns: {
          api_key: string
          webhook_secret: string
        }[]
      }
      crm_import_leads: {
        Args: { p_rows: Json; p_source?: string }
        Returns: Json
      }
      crm_normalize_phone: { Args: { _phone: string }; Returns: string }
      crm_score_touch_user: {
        Args: { p_tenant: string; p_user: string }
        Returns: undefined
      }
      crm_scoring_default_weights: { Args: never; Returns: Json }
      crm_set_merydian_secret: {
        Args: { _kind: string; _plaintext: string }
        Returns: undefined
      }
      crm_upsert_from_form:
        | {
            Args: {
              _company: string
              _country: string
              _email: string
              _first_name: string
              _last_name: string
              _linkedin: string
              _phone: string
              _position: string
              _source: string
              _tenant: string
            }
            Returns: string
          }
        | {
            Args: {
              _company: string
              _country: string
              _custom?: Json
              _email: string
              _first_name: string
              _last_name: string
              _linkedin: string
              _phone: string
              _position: string
              _source: string
              _tenant: string
            }
            Returns: string
          }
      crm_upsert_lead: {
        Args: {
          _company: string
          _email: string
          _first_name: string
          _last_name: string
          _marketing: boolean
          _newsletter: boolean
          _phone: string
          _tenant: string
        }
        Returns: string
      }
      crm_upsert_lead_from_profile: {
        Args: { _profile_id: string }
        Returns: undefined
      }
      crm_upsert_lead_from_subscriber: {
        Args: { _sub_id: string }
        Returns: undefined
      }
      current_membership_tier: {
        Args: never
        Returns: {
          features: Json
          key: string
          name_en: string
          name_pl: string
          rank: number
        }[]
      }
      current_tenant_id: { Args: never; Returns: string }
      current_tier_rank: { Args: never; Returns: number }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_my_meeting_slot: { Args: { p_slot_id: string }; Returns: boolean }
      discovery_search_norm: { Args: { _q: string }; Returns: string }
      dismiss_connection_suggestion: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      early_access_window: { Args: never; Returns: string }
      email_apply_delivery_event: {
        Args: {
          p_bounce_class?: string
          p_campaign_hint?: string
          p_diagnostic?: string
          p_email: string
          p_event_id: string
          p_event_type: string
          p_kind: string
          p_occurred_at?: string
          p_payload?: Json
          p_provider: string
          p_provider_message_id?: string
          p_subscriber_hint?: string
          p_tenant_hint?: string
        }
        Returns: Json
      }
      email_default_tenant_id: { Args: never; Returns: string }
      email_deliverability_counts: {
        Args: { p_days?: number; p_tenant: string }
        Returns: Json
      }
      email_filter_suppressed: {
        Args: { p_emails: string[]; p_tenant: string }
        Returns: {
          email: string
          expires_at: string
          reason: string
          scope: string
        }[]
      }
      email_is_suppressed: {
        Args: { p_email: string; p_tenant: string }
        Returns: boolean
      }
      email_queue_depth: { Args: never; Returns: Json }
      email_queue_dispatch: { Args: never; Returns: undefined }
      email_record_suppression: {
        Args: {
          p_campaign?: string
          p_diagnostic?: string
          p_email: string
          p_event_id?: string
          p_meta?: Json
          p_provider?: string
          p_provider_message_id?: string
          p_reason: string
          p_source?: string
          p_subscriber?: string
          p_tenant: string
        }
        Returns: Json
      }
      email_resolve_tenant_for_address: {
        Args: { p_email: string }
        Returns: string
      }
      email_suppression_add: {
        Args: { p_email: string; p_note?: string; p_reason?: string }
        Returns: Json
      }
      email_suppression_release: {
        Args: { p_id: string; p_resubscribe?: boolean }
        Returns: Json
      }
      email_suppression_severity: {
        Args: { p_reason: string }
        Returns: number
      }
      email_unsubscribe_by_token: { Args: { p_token: string }; Returns: Json }
      emit_domain_event: {
        Args: {
          p_actor_id?: string
          p_aggregate_id: string
          p_aggregate_type: string
          p_event_type: string
          p_payload?: Json
          p_suppress_actor?: boolean
          p_tenant_id: string
        }
        Returns: string
      }
      endorse_skill: { Args: { p_skill_id: string }; Returns: string }
      enforce_form_field_policy: {
        Args: { _form_type: string; _payload: Json; _tenant: string }
        Returns: string[]
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      enqueue_notification: {
        Args: {
          p_body_en?: string
          p_body_pl?: string
          p_href?: string
          p_icon?: string
          p_kind: string
          p_title_en: string
          p_title_pl: string
          p_user_id: string
        }
        Returns: string
      }
      event_types_active: {
        Args: never
        Returns: {
          accent_color: string | null
          default_capacity: number | null
          default_chatham_house: boolean
          default_duration_minutes: number | null
          default_format: string
          default_guest_mode: string
          default_min_tier_rank: number
          default_registration_flow: string
          default_registration_mode: string
          description_en: string
          description_pl: string
          icon: string
          id: string
          key: string
          name_en: string
          name_pl: string
          requires_ticket: boolean
          sort_order: number
        }[]
      }
      filter_group_candidates: {
        Args: { p_candidates: string[]; p_inviter: string }
        Returns: string[]
      }
      finish_integration_delivery: {
        Args: { p_error?: string; p_id: string; p_succeeded: boolean }
        Returns: undefined
      }
      get_chat_peers: {
        Args: { p_user_ids: string[] }
        Returns: {
          avatar_url: string
          current_company: string
          display_name: string
          id: string
          job_title: string
          slug: string
          specialization: string
        }[]
      }
      get_contributor_leaderboard: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          avatar_url: string
          board_position: number
          breakdown: Json
          display_name: string
          points: number
          slug: string
          user_id: string
        }[]
      }
      get_correlated_events: {
        Args: { p_correlation_id: string }
        Returns: {
          actor_id: string | null
          aggregate_id: string
          aggregate_type: string
          correlation_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json
          tenant_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "domain_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_engagement_overview: { Args: never; Returns: Json }
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
      get_event_access: {
        Args: { p_event_id: string }
        Returns: {
          can_join: boolean
          can_watch: boolean
          join_url: string
          reason: string
          recording_url: string
          watch_reason: string
        }[]
      }
      get_event_rsvp_counts: {
        Args: { p_event_ids: string[] }
        Returns: {
          event_id: string
          going: number
          interested: number
          waitlist: number
        }[]
      }
      get_event_waitlist_position: {
        Args: { p_event_id: string }
        Returns: number
      }
      get_expert_hub: { Args: { _slug_or_id: string }; Returns: Json }
      get_expert_materials: {
        Args: {
          _category_slug?: string
          _kind?: string
          _page?: number
          _page_size?: number
          _program_slug?: string
          _region_slug?: string
          _slug_or_id: string
          _tag_slug?: string
          _year?: number
        }
        Returns: Json
      }
      get_followed_feed: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          author_id: string
          cover_image_url: string
          excerpt_en: string
          excerpt_pl: string
          id: string
          parent_page_id: string
          published_at: string
          reasons: string[]
          slug: string
          title_en: string
          title_pl: string
          total_count: number
        }[]
      }
      get_gift_stats_admin: {
        Args: never
        Returns: {
          active_links: number
          created_this_month: number
          exhausted_links: number
          expired_links: number
          redeemed_this_month: number
          revoked_links: number
          total_created: number
          total_redeemed: number
          unique_gifters: number
          unique_recipients: number
        }[]
      }
      get_linked_items: {
        Args: { p_item_id: string; p_item_type: string }
        Returns: {
          created_at: string
          direction: string
          item_id: string
          item_type: string
          label: string
          reference_id: string
          relation: string
        }[]
      }
      get_my_public_exposure: {
        Args: never
        Returns: {
          by_author_profile: boolean
          by_editorial_role: boolean
          by_expert_badge: boolean
          by_published_content: boolean
          by_speaker_profile: boolean
          discoverable: boolean
          is_public: boolean
        }[]
      }
      get_my_qa_question_ids: {
        Args: { p_session_id: string }
        Returns: string[]
      }
      get_my_reputation: { Args: { p_days?: number }; Returns: Json }
      get_or_create_direct_conversation: {
        Args: { p_peer_id: string }
        Returns: string
      }
      get_own_author_profile: {
        Args: never
        Returns: {
          avatar_url: string | null
          bio_en: string | null
          bio_pl: string | null
          brand_accent: string | null
          brand_accent_dark: string | null
          company: string | null
          contact_email: string | null
          counterpart_lang: string | null
          counterpart_user_id: string | null
          created_at: string
          custom_socials: Json
          facebook_url: string | null
          full_bio_en: string | null
          full_bio_pl: string | null
          id: string
          instagram_url: string | null
          is_public: boolean
          job_title: string | null
          layout_overrides: Json | null
          layout_preset: string | null
          layout_section_order: string[] | null
          layout_template_id: string | null
          linkedin_url: string | null
          media_contact_email: string | null
          media_contact_name: string | null
          media_contact_phone: string | null
          org_functions: Json
          phone: string | null
          spotify_url: string | null
          tenant_id: string
          updated_at: string
          user_id: string
          website_url: string | null
          x_url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "author_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_own_profile: {
        Args: never
        Returns: {
          avatar_url: string | null
          bio: string | null
          bio_en: string | null
          bio_pl: string | null
          completeness_score: number
          contact_email: string | null
          cover_url: string | null
          created_at: string
          current_company: string | null
          current_company_id: string | null
          discoverable: boolean
          discovery_search: string | null
          display_name: string | null
          email: string | null
          expert_requests_enabled: boolean
          facebook_url: string | null
          first_name: string | null
          gender: Database["public"]["Enums"]["name_gender"] | null
          hide_avatar: boolean
          id: string
          instagram_url: string | null
          intent_updated_at: string | null
          job_title: string | null
          last_name: string | null
          linkedin_url: string | null
          location: string | null
          offering_en: string | null
          offering_pl: string | null
          open_to: string[]
          phone: string | null
          prefs: Json
          profile_view_mode: string
          seeking_en: string | null
          seeking_pl: string | null
          slug: string | null
          specialization: string | null
          spotify_url: string | null
          tenant_id: string
          twitter_url: string | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          website_url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_page_for_edit: {
        Args: { _slug: string }
        Returns: {
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
          og_image_generated_url: string | null
          parent_id: string | null
          publish_at: string | null
          published_at: string | null
          search_vector: unknown
          seo_canonical_url: string | null
          seo_description_en: string | null
          seo_description_pl: string | null
          seo_noindex: boolean
          seo_og_image_url: string | null
          seo_title_en: string | null
          seo_title_pl: string | null
          slug: string
          status: Database["public"]["Enums"]["post_status"]
          takeaways_en: string[]
          takeaways_pl: string[]
          takeaways_variant: string | null
          template_id: string | null
          template_type: string
          tenant_id: string
          title_en: string
          title_pl: string
          toc_override: Json | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "pages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_password_hint: {
        Args: {
          _entity_id: string
          _entity_type: Database["public"]["Enums"]["access_entity_type"]
        }
        Returns: {
          hint_en: string
          hint_pl: string
        }[]
      }
      get_policy_follower_counts: {
        Args: { p_item_ids: string[] }
        Returns: {
          followers: number
          item_id: string
        }[]
      }
      get_poll_results: { Args: { p_poll_id: string }; Returns: Json }
      get_poll_results_bulk: {
        Args: { p_poll_ids: string[] }
        Returns: {
          poll_id: string
          result: Json
        }[]
      }
      get_post_for_edit: {
        Args: { _slug: string }
        Returns: {
          audio_url_en: string | null
          audio_url_pl: string | null
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
          is_sponsored: boolean
          layout_overrides: Json | null
          og_image_generated_url: string | null
          organization_id: string | null
          organization_logo_url: string | null
          organization_name: string | null
          organization_website: string | null
          outbound_links_checked_at: string | null
          parent_page_id: string
          post_format: string
          publish_at: string | null
          published_at: string | null
          read_minutes: number | null
          related_override: Json | null
          search_vector: unknown
          seo_canonical_url: string | null
          seo_description_en: string | null
          seo_description_pl: string | null
          seo_noindex: boolean
          seo_og_image_url: string | null
          seo_title_en: string | null
          seo_title_pl: string | null
          sidebar_layout_id: string | null
          slug: string
          sponsored_advertiser_name: string | null
          sponsored_advertiser_url: string | null
          sponsored_affiliate: boolean
          sponsored_kind: string | null
          sponsored_marked_at: string | null
          sponsored_marked_by: string | null
          sponsored_note_en: string | null
          sponsored_note_pl: string | null
          sponsored_order_ref: string | null
          sponsored_payer_name: string | null
          sponsored_political: boolean
          sponsored_political_process: string | null
          sponsored_sponsor_controller: string | null
          status: Database["public"]["Enums"]["post_status"]
          takeaways_en: string[]
          takeaways_pl: string[]
          takeaways_variant: string | null
          template_id: string | null
          tenant_id: string
          title_en: string
          title_pl: string
          toc_override: Json | null
          tts_voice_en: string | null
          tts_voice_pl: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_post_refs: {
        Args: { _post_ids: string[] }
        Returns: {
          author_avatar: string
          author_id: string
          author_name: string
          author_slug: string
          cover_image_url: string
          excerpt_en: string
          excerpt_pl: string
          id: string
          published_at: string
          slug: string
          title_en: string
          title_pl: string
        }[]
      }
      get_program_members: {
        Args: { p_program_ids: string[] }
        Returns: {
          avatar_url: string
          display_name: string
          is_lead: boolean
          job_title: string
          member_role_en: string
          member_role_pl: string
          profile_id: string
          profile_slug: string
          program_id: string
          sort_order: number
        }[]
      }
      get_public_meeting_slots: {
        Args: {
          p_days?: number
          p_event_id?: string
          p_host_user_id?: string
          p_limit?: number
        }
        Returns: {
          booked_by_me: boolean
          ends_at: string
          event_id: string
          host_avatar_url: string
          host_name: string
          host_slug: string
          host_user_id: string
          id: string
          is_booked: boolean
          is_mine: boolean
          location: string
          starts_at: string
        }[]
      }
      get_public_speakers: {
        Args: { p_event_id?: string; p_limit?: number; p_user_ids?: string[] }
        Returns: {
          avatar_url: string
          bio_en: string
          bio_pl: string
          company: string
          display_name: string
          has_speaker_profile: boolean
          headline_en: string
          headline_pl: string
          is_expert: boolean
          job_title: string
          languages: string[]
          rating: number
          reviews_count: number
          slug: string
          sort_order: number
          talks_count: number
          topics_en: string[]
          topics_pl: string[]
          user_id: string
        }[]
      }
      get_recommended_posts_v2: {
        Args: {
          p_category_ids?: string[]
          p_limit?: number
          p_offset?: number
          p_tag_ids?: string[]
        }
        Returns: {
          author_id: string
          cover_image_url: string
          excerpt_en: string
          excerpt_pl: string
          id: string
          parent_page_id: string
          published_at: string
          reasons: string[]
          score: number
          slug: string
          title_en: string
          title_pl: string
        }[]
      }
      get_related_posts_config: {
        Args: never
        Returns: {
          after_paragraph: number
          columns: number
          created_at: string
          enabled: boolean
          items_limit: number
          layout: string
          min_score: number
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
          use_idf: boolean
          weight_author: number
          weight_categories: number
          weight_dwell: number
          weight_personalization: number
          weight_popularity: number
          weight_recency: number
          weight_tags: number
        }[]
        SetofOptions: {
          from: "*"
          to: "related_posts_config"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_tracker_stats: { Args: never; Returns: Json }
      get_user_monthly_metering_count: {
        Args: { _user_id: string }
        Returns: {
          monthly_limit: number
          period_month: string
          remaining: number
          used: number
        }[]
      }
      gift_article_state: {
        Args: { _post_id: string }
        Returns: {
          can_gift: boolean
          eligibility: string
          enabled: boolean
          existing_code: string
          expires_at: string
          max_redemptions: number
          monthly_limit: number
          redemption_count: number
          redemptions_remaining: number
          remaining: number
          requires_auth: boolean
          requires_subscription: boolean
          used: number
        }[]
      }
      gift_share_eligibility: { Args: never; Returns: string }
      guess_gender_from_name: {
        Args: { _name: string }
        Returns: Database["public"]["Enums"]["name_gender"]
      }
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string }
        Returns: boolean
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
      has_tier_feature: { Args: { _feature: string }; Returns: boolean }
      has_tier_rank: { Args: { _min: number }; Returns: boolean }
      has_verified_mfa: { Args: never; Returns: boolean }
      install_workflow_template: { Args: { p_key: string }; Returns: string }
      integration_endpoint_get_secret: {
        Args: { _endpoint_id: string }
        Returns: string
      }
      integration_endpoint_set_secret: {
        Args: { _endpoint_id: string; _plaintext: string }
        Returns: undefined
      }
      invoke_billing_cron: { Args: never; Returns: undefined }
      invoke_community_cron: { Args: { p_job?: string }; Returns: undefined }
      invoke_jobs_tick: { Args: never; Returns: undefined }
      is_blocked_pair: { Args: { _a: string; _b: string }; Returns: boolean }
      is_club_admin: { Args: { _user_id?: string }; Returns: boolean }
      is_connected_pair: { Args: { _a: string; _b: string }; Returns: boolean }
      is_conversation_member: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      is_experiment_running: {
        Args: { _experiment_id: string }
        Returns: boolean
      }
      is_expert_user:
        | { Args: { _uid: string }; Returns: boolean }
        | { Args: { _tenant: string; _uid: string }; Returns: boolean }
      is_form_field_active: {
        Args: { _field: string; _form_type: string; _tenant: string }
        Returns: boolean
      }
      is_gated_recipient:
        | { Args: { _uid: string }; Returns: boolean }
        | { Args: { _tenant: string; _uid: string }; Returns: boolean }
      is_nes_staff: { Args: { _user_id?: string }; Returns: boolean }
      is_org_owner: { Args: { p_org: string }; Returns: boolean }
      is_service_role_caller: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      is_super_admin: { Args: { _user_id?: string }; Returns: boolean }
      is_tenant_conversation_member: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      is_vip_user:
        | { Args: { _uid: string }; Returns: boolean }
        | { Args: { _tenant: string; _uid: string }; Returns: boolean }
      job_runner_autoarm: { Args: never; Returns: boolean }
      job_runner_base_url: { Args: never; Returns: string }
      job_scheduler_health: { Args: never; Returns: Json }
      join_us_link_and_backfill: {
        Args: {
          _company: string
          _country: string
          _email: string
          _first_name: string
          _last_name: string
          _linkedin: string
          _phone: string
          _position: string
          _tenant_id: string
          _user_id: string
        }
        Returns: undefined
      }
      jsonb_append_distinct: {
        Args: { _key: string; _obj: Json; _val: string }
        Returns: Json
      }
      leave_group_conversation: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      like_escape: { Args: { _s: string }; Returns: string }
      link_current_company: {
        Args: { _company_id: string }
        Returns: undefined
      }
      linked_item_label: {
        Args: { p_id: string; p_type: string }
        Returns: string
      }
      list_gift_events_admin: {
        Args: {
          _event_type?: string
          _limit?: number
          _link_id?: string
          _offset?: number
        }
        Returns: {
          actor_email: string
          actor_id: string
          actor_name: string
          code: string
          created_at: string
          event_type: string
          id: string
          link_id: string
          metadata: Json
          post_id: string
          post_title: string
          total_count: number
        }[]
      }
      list_gift_links_admin: {
        Args: {
          _limit?: number
          _offset?: number
          _post_id?: string
          _status?: string
        }
        Returns: {
          code: string
          created_at: string
          created_by: string
          creator_email: string
          creator_name: string
          expires_at: string
          id: string
          last_redeemed_at: string
          max_redemptions: number
          post_id: string
          post_slug: string
          post_title: string
          redemption_count: number
          revoked_at: string
          total_count: number
          unique_recipients: number
        }[]
      }
      list_my_expert_requests: {
        Args: { p_box?: string }
        Returns: {
          admin_note: string | null
          converted_conversation_id: string | null
          created_at: string
          decline_reason: string | null
          expected_answers: string | null
          external_links: string[]
          id: string
          questions: string[]
          reason: string
          recipient_id: string
          responded_at: string | null
          sender_id: string
          status: string
          subject: string
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "expert_inmails"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_my_inmails: {
        Args: { p_box?: string }
        Returns: {
          admin_note: string | null
          converted_conversation_id: string | null
          created_at: string
          decline_reason: string | null
          expected_answers: string | null
          external_links: string[]
          id: string
          questions: string[]
          reason: string
          recipient_id: string
          responded_at: string | null
          sender_id: string
          status: string
          subject: string
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "expert_inmails"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_qa_questions: {
        Args: { p_session_id: string }
        Returns: {
          answer_body: string
          answered_at: string
          author_display: string
          body: string
          created_at: string
          id: string
          is_anonymous: boolean
          is_priority: boolean
          my_vote: boolean
          session_id: string
          status: string
          votes: number
        }[]
      }
      list_recommendations: {
        Args: { p_recipient: string }
        Returns: {
          author_avatar: string
          author_headline: string
          author_id: string
          author_name: string
          body: string
          created_at: string
          id: string
          relationship: string
          status: string
        }[]
      }
      log_metering_event: {
        Args: {
          _entity_id: string
          _entity_type: string
          _monthly_limit?: number
          _outcome: string
          _reason?: string
          _used_before?: number
          _visitor_id?: string
        }
        Returns: undefined
      }
      log_search_query: {
        Args: { _lang?: string; _q: string; _results?: number }
        Returns: undefined
      }
      mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      mark_conversations_delivered: { Args: never; Returns: undefined }
      mark_notification_unread: { Args: { p_id: string }; Returns: undefined }
      mark_notifications_read: { Args: { p_ids: string[] }; Returns: number }
      mark_notifications_unread: { Args: { p_ids: string[] }; Returns: number }
      mark_push_subscription_failed: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      member_conversation_ids: { Args: never; Returns: string[] }
      membership_year_window: {
        Args: { p_user: string }
        Returns: {
          period_end: string
          period_start: string
        }[]
      }
      metering_impact_preview: {
        Args: { _proposed_member_limit: number }
        Returns: {
          anon_blocked: number
          avg_used: number
          max_used: number
          members_blocked: number
          members_safe: number
          members_warning: number
          total_anon: number
          total_members: number
          total_views: number
        }[]
      }
      metering_state: {
        Args: { _visitor_id?: string }
        Returns: {
          enabled: boolean
          monthly_limit: number
          remaining: number
          requires_registration: boolean
          show_counter: boolean
          used: number
        }[]
      }
      monetization_dashboard: {
        Args: {
          _from?: string
          _organization_id?: string
          _plan_id?: string
          _to?: string
        }
        Returns: Json
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      mutual_connections: {
        Args: { p_limit?: number; p_offset?: number; p_user_id: string }
        Returns: {
          avatar_url: string
          current_company: string
          display_name: string
          job_title: string
          location: string
          slug: string
          total_count: number
          user_id: string
          verified: boolean
        }[]
      }
      my_academic_domain_verification: { Args: never; Returns: Json }
      my_connection_requests: {
        Args: { p_direction?: string; p_limit?: number; p_offset?: number }
        Returns: {
          avatar_url: string
          connection_id: string
          current_company: string
          display_name: string
          job_title: string
          location: string
          message: string
          requested_at: string
          slug: string
          specialization: string
          total_count: number
          user_id: string
          verified: boolean
        }[]
      }
      my_connections: {
        Args: { p_limit?: number; p_offset?: number; p_query?: string }
        Returns: {
          avatar_url: string
          connected_at: string
          connection_id: string
          current_company: string
          display_name: string
          job_title: string
          location: string
          slug: string
          specialization: string
          total_count: number
          user_id: string
          verified: boolean
        }[]
      }
      my_dismissed_suggestions_count: { Args: never; Returns: number }
      my_effective_tier_features: { Args: never; Returns: Json }
      my_event_participation: {
        Args: never
        Returns: {
          ends_at: string
          event_id: string
          event_status: string
          kind: string
          rsvp_status: string
          rsvp_updated_at: string
          slug: string
          starts_at: string
          title_en: string
          title_pl: string
        }[]
      }
      my_expert_request_quota: { Args: never; Returns: Json }
      my_has_feature: { Args: { p_key: string }; Returns: boolean }
      my_inmail_quota: { Args: never; Returns: Json }
      my_introduction_requests: {
        Args: { p_role?: string }
        Returns: {
          bridge_avatar: string
          bridge_id: string
          bridge_name: string
          created_at: string
          id: string
          message: string
          requester_avatar: string
          requester_id: string
          requester_name: string
          status: string
          target_avatar: string
          target_id: string
          target_name: string
        }[]
      }
      my_network_counts: {
        Args: never
        Returns: {
          connections: number
          pending_in: number
          pending_out: number
        }[]
      }
      my_organization: {
        Args: never
        Returns: {
          expires_at: string
          my_role: string
          name: string
          org_id: string
          seats_limit: number
          seats_used: number
          starts_at: string
          status: string
          tier_key: string
        }[]
      }
      my_profile_viewers: {
        Args: { p_limit?: number }
        Returns: {
          avatar_url: string
          company: string
          display_name: string
          job_title: string
          viewed_at: string
          viewer_id: string
          viewer_mode: string
        }[]
      }
      my_resource_downloads: {
        Args: never
        Returns: {
          category: string
          downloaded_at: string
          resource_id: string
          title_en: string
          title_pl: string
        }[]
      }
      my_ticket_allowance: { Args: never; Returns: Json }
      nes_jsonb_text: { Args: { _j: Json }; Returns: string }
      nes_pages_search_vector: {
        Args: {
          _builder: Json
          _content_en: string
          _content_pl: string
          _excerpt_en: string
          _excerpt_pl: string
          _slug: string
          _title_en: string
          _title_pl: string
        }
        Returns: unknown
      }
      nes_pl_light_stem: { Args: { _term: string }; Returns: string }
      nes_polish_tsquery: { Args: { _q: string }; Returns: unknown }
      nes_post_embedding_source: {
        Args: {
          p_excerpt_en: string
          p_excerpt_pl: string
          p_title_en: string
          p_title_pl: string
        }
        Returns: string
      }
      nes_post_matches_term_group: {
        Args: { p_group_csv: string; p_post_id: string }
        Returns: boolean
      }
      nes_posts_search_vector: {
        Args: {
          _blocks: Json
          _builder: Json
          _content_en: string
          _content_pl: string
          _excerpt_en: string
          _excerpt_pl: string
          _slug: string
          _takeaways_en: string[]
          _takeaways_pl: string[]
          _title_en: string
          _title_pl: string
        }
        Returns: unknown
      }
      nes_profile_completeness: { Args: { p_user_id: string }; Returns: number }
      nes_profile_completeness_row: {
        Args: {
          p_avatar_url: string
          p_bio_en: string
          p_bio_pl: string
          p_current_company: string
          p_display_name: string
          p_education: number
          p_experiences: number
          p_first_name: string
          p_job_title: string
          p_last_name: string
          p_location: string
          p_open_to: string[]
          p_seeking_en: string
          p_seeking_pl: string
          p_skills: number
          p_specialization: string
        }
        Returns: number
      }
      nes_profile_embedding_source: {
        Args: { p_user_id: string }
        Returns: string
      }
      nes_profile_href: { Args: { _user_id: string }; Returns: string }
      nes_profile_label: {
        Args: { _fallback?: string; _user_id: string }
        Returns: string
      }
      nes_profile_open_to_catalog: { Args: never; Returns: string[] }
      nes_search_positive_rest: { Args: { _q: string }; Returns: string }
      nes_search_tsquery: { Args: { _q: string }; Returns: unknown }
      nes_search_tsquery_adv: {
        Args: { _match?: string; _q: string }
        Returns: unknown
      }
      newsletter_campaign_engagement: {
        Args: { p_campaign: string }
        Returns: {
          clicks: number
          opens: number
          unique_clickers: number
          unique_openers: number
        }[]
      }
      newsletter_deliverability_metrics: {
        Args: { p_days?: number }
        Returns: Json
      }
      newsletter_min_tier_emails: {
        Args: { p_min: number; p_tenant: string }
        Returns: {
          email: string
        }[]
      }
      newsletter_popup_event_stats: {
        Args: { _days?: number }
        Returns: {
          count: number
          day: string
          event: string
        }[]
      }
      newsletter_record_campaign_event: {
        Args: {
          p_campaign: string
          p_kind: string
          p_occurred_at?: string
          p_subscriber: string
          p_url?: string
        }
        Returns: Json
      }
      normalize_public_host: { Args: { p_raw: string }; Returns: string }
      notification_actor_name: { Args: { p_user_id: string }; Returns: string }
      notification_profile_ref: { Args: { p_user_id: string }; Returns: string }
      org_add_seat: {
        Args: { p_email: string; p_org: string; p_role?: string }
        Returns: string
      }
      org_apply_subscription_seats: {
        Args: { p_quantity: number; p_subscription_id: string }
        Returns: Json
      }
      org_expire_seat_grace: { Args: never; Returns: Json }
      org_reconcile_seats: { Args: { p_org: string }; Returns: Json }
      org_set_seats_grace_days: {
        Args: { p_days: number; p_org: string }
        Returns: Json
      }
      org_set_seats_grace_reminder_days: {
        Args: { p_days: number[]; p_org: string }
        Returns: Json
      }
      org_set_seats_limit: {
        Args: { p_limit: number; p_org: string; p_source?: string }
        Returns: Json
      }
      org_touch_seat_invite: {
        Args: { p_seat: string }
        Returns: {
          invited_email: string
          last_invited_at: string
          org_name: string
          seat_id: string
        }[]
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
      page_full_paths: {
        Args: { _page_ids: string[] }
        Returns: {
          full_path: string
          page_id: string
        }[]
      }
      payment_order_mark_session: {
        Args: {
          _order_id: string
          _session_id?: string
          _status?: Database["public"]["Enums"]["order_status"]
        }
        Returns: boolean
      }
      people_filter_options: {
        Args: never
        Returns: {
          cnt: number
          field: string
          value: string
        }[]
      }
      policy_item_followers: {
        Args: { p_item_id: string; p_limit?: number }
        Returns: {
          avatar_url: string
          current_company: string
          display_name: string
          job_title: string
          slug: string
          total_count: number
          user_id: string
          verified: boolean
        }[]
      }
      popular_post_ids: {
        Args: { _days?: number; _limit?: number }
        Returns: {
          post_id: string
        }[]
      }
      popular_searches: {
        Args: { _days?: number; _limit?: number }
        Returns: {
          cnt: number
          q: string
        }[]
      }
      post_canonical_href: { Args: { _post_id: string }; Returns: string }
      post_view_count: { Args: { _post_id: string }; Returns: number }
      posts_needing_embeddings: {
        Args: { _limit?: number }
        Returns: {
          content_hash: string
          embed_text: string
          post_id: string
          tenant_id: string
        }[]
      }
      pricing_catalog_business_rows: {
        Args: never
        Returns: {
          audience_key: string
          badge_en: string
          badge_pl: string
          benefits: Json
          cta_mode: string
          desc_en: string
          desc_pl: string
          features: Json
          highlight: boolean
          is_default: boolean
          key: string
          name_en: string
          name_pl: string
          per_seat: boolean
          price_note_en: string
          price_note_pl: string
          rank: number
          sort_order: number
        }[]
      }
      pricing_catalog_v3_rows: {
        Args: never
        Returns: {
          audience_key: string
          badge_en: string
          badge_pl: string
          benefits: Json
          cta_mode: string
          desc_en: string
          desc_pl: string
          features: Json
          highlight: boolean
          is_default: boolean
          key: string
          name_en: string
          name_pl: string
          per_seat: boolean
          price_note_en: string
          price_note_pl: string
          rank: number
          sort_order: number
        }[]
      }
      pricing_catalog_v4_benefits: {
        Args: never
        Returns: {
          benefits: Json
          key: string
        }[]
      }
      pricing_catalog_v5_benefits: {
        Args: never
        Returns: {
          benefits: Json
          key: string
        }[]
      }
      process_mentions: {
        Args: {
          p_actor_id: string
          p_actor_label?: string
          p_body: string
          p_href: string
          p_kind: string
          p_record_actor?: boolean
          p_source_id: string
          p_source_type: string
          p_tenant_id: string
        }
        Returns: number
      }
      profile_badge_activity_points: {
        Args: { p_since?: string; p_tenant_id: string; p_user_id: string }
        Returns: number
      }
      profile_has_public_presence: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: boolean
      }
      profile_is_public: { Args: { _user_id: string }; Returns: boolean }
      profile_view_stats: {
        Args: never
        Returns: {
          last_30: number
          last_7: number
          last_90: number
        }[]
      }
      profiles_generate_unique_slug: {
        Args: { _base: string }
        Returns: string
      }
      profiles_needing_embeddings: {
        Args: { _limit?: number; _min_completeness?: number }
        Returns: {
          content_hash: string
          embed_text: string
          profile_id: string
          tenant_id: string
        }[]
      }
      profiles_tenant_pin_bypass: { Args: never; Returns: boolean }
      promote_event_waitlist: { Args: { p_event_id: string }; Returns: number }
      prune_command_idempotency: { Args: never; Returns: number }
      prune_domain_events: { Args: { p_keep?: string }; Returns: number }
      prune_integration_deliveries: { Args: never; Returns: number }
      prune_profile_embeddings: { Args: never; Returns: number }
      prune_push_queue: { Args: { p_keep?: string }; Returns: number }
      public_tenant_id: { Args: never; Returns: string }
      publish_due_pages: { Args: never; Returns: number }
      publish_due_posts: { Args: never; Returns: number }
      publish_legal_version: {
        Args: { _id: string }
        Returns: {
          content: Json
          created_at: string
          created_by: string | null
          doc_key: string
          effective_from: string | null
          id: string
          label: string
          note: string | null
          published_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "legal_document_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      publish_qa_session_summary: {
        Args: { p_publish?: boolean; p_session_id: string }
        Returns: Json
      }
      purge_expired_accounting_evidence: { Args: never; Returns: Json }
      purge_expired_payment_orders: { Args: never; Returns: number }
      purge_expired_user_purchases: { Args: never; Returns: number }
      qa_escape_html: { Args: { p_text: string }; Returns: string }
      qa_text_to_html: { Args: { p_text: string }; Returns: string }
      rate_limit_hit: {
        Args: {
          _max: number
          _scope: string
          _subject: string
          _window_minutes?: number
        }
        Returns: {
          allowed: boolean
          bucket_start: string
          hits: number
        }[]
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      recommendation_relationships: { Args: never; Returns: string[] }
      recompute_crm_lead_score: { Args: { p_lead_id: string }; Returns: Json }
      recompute_crm_lead_scores: {
        Args: { p_after_id?: string; p_limit?: number }
        Returns: Json
      }
      recompute_my_pending_counters: { Args: never; Returns: undefined }
      recompute_tenant_pending_counters: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      recompute_user_pending_counters: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      reconcile_due_profile_badges: {
        Args: { p_limit?: number }
        Returns: number
      }
      reconcile_profile_badge_for_user: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: boolean
      }
      record_job_run: {
        Args: {
          p_actor_id?: string
          p_duration_ms?: number
          p_error?: string
          p_job?: string
          p_ok?: boolean
          p_result?: Json
          p_source: string
          p_tenant_id?: string
        }
        Returns: number
      }
      record_post_tts_rendition: {
        Args: {
          _byte_size: number
          _char_count: number
          _content_hash: string
          _lang: string
          _model: string
          _post_id: string
          _storage_path: string
          _voice_id: string
        }
        Returns: undefined
      }
      record_post_view: {
        Args: { _post_id: string; _viewer_hash: string }
        Returns: undefined
      }
      record_profile_view: { Args: { p_profile: string }; Returns: undefined }
      record_redirect_hit: { Args: { _id: string }; Returns: undefined }
      record_seo_404: {
        Args: { _path: string; _referrer?: string; _tenant_id: string }
        Returns: undefined
      }
      redeem_b2b_coupon: {
        Args: {
          _applied_cents: number
          _coupon_id: string
          _currency: string
          _order_id: string
          _original_cents: number
        }
        Returns: boolean
      }
      redeem_b2b_coupon_with_effects: {
        Args: {
          _applied_cents: number
          _coupon_id: string
          _currency: string
          _order_id: string
          _original_cents: number
        }
        Returns: boolean
      }
      redeem_gift_link: {
        Args: { _code: string; _post_id: string; _visitor_id?: string }
        Returns: {
          blocks_data: Json
          builder_data: Json
          content_en: string
          content_pl: string
          max_redemptions: number
          reason: string
          redemption_count: number
          redemptions_remaining: number
          valid: boolean
        }[]
      }
      related_posts_signals: { Args: { _since_days?: number }; Returns: Json }
      release_b2b_coupon: {
        Args: { _coupon_id: string; _order_id: string }
        Returns: boolean
      }
      release_included_event_ticket: {
        Args: { p_event_id: string; p_user?: string }
        Returns: boolean
      }
      rename_group_conversation: {
        Args: { p_conversation_id: string; p_title: string }
        Returns: undefined
      }
      report_push_job: {
        Args: { p_dead?: boolean; p_id: number; p_ok: boolean }
        Returns: undefined
      }
      report_user: {
        Args: { p_details?: string; p_reason: string; p_user_id: string }
        Returns: string
      }
      request_asserted_host: { Args: never; Returns: string }
      request_correlation_id: { Args: never; Returns: string }
      request_introduction: {
        Args: { p_bridge: string; p_message: string; p_target: string }
        Returns: string
      }
      request_public_host: { Args: never; Returns: string }
      request_public_host_trust: { Args: never; Returns: string }
      request_verified_host: { Args: never; Returns: string }
      resolve_expert_inmail: {
        Args: { p_action: string; p_inmail_id: string; p_note?: string }
        Returns: Json
      }
      resolve_expert_request: {
        Args: { p_action: string; p_note?: string; p_request_id: string }
        Returns: Json
      }
      resolve_job_runner_base_url: { Args: never; Returns: string }
      resolve_path: {
        Args: { _segments: string[] }
        Returns: {
          page_id: string
          post_id: string
        }[]
      }
      respond_introduction: {
        Args: { p_action: string; p_id: string }
        Returns: undefined
      }
      respond_recommendation: {
        Args: { p_action: string; p_id: string }
        Returns: undefined
      }
      restore_connection_suggestions: { Args: never; Returns: number }
      retire_tenant_host_assertion_key: {
        Args: { p_kid: string }
        Returns: boolean
      }
      revoke_gift_link_admin: { Args: { _link_id: string }; Returns: boolean }
      rsvp_event: {
        Args: { p_event_id: string; p_status: string }
        Returns: Json
      }
      run_crm_task_reminders: { Args: never; Returns: number }
      run_event_reminders: { Args: never; Returns: number }
      run_profile_view_alerts: {
        Args: { p_max_profiles?: number }
        Returns: number
      }
      run_saved_search_alerts: {
        Args: { p_max_searches?: number }
        Returns: number
      }
      run_workflow_step: {
        Args: {
          p_event: Database["public"]["Tables"]["domain_events"]["Row"]
          p_step: Json
        }
        Returns: undefined
      }
      search_autosuggest: {
        Args: { _limit?: number; _q: string }
        Returns: {
          id: string
          kind: string
          label_en: string
          label_pl: string
          parent_page_id: string
          score: number
          slug: string
        }[]
      }
      search_chat_contacts: {
        Args: { p_limit?: number; p_query?: string }
        Returns: {
          avatar_url: string
          current_company: string
          display_name: string
          id: string
          job_title: string
          location: string
          slug: string
          specialization: string
          total_count: number
          verified: boolean
        }[]
      }
      search_companies_public: {
        Args: { _limit?: number; _query: string }
        Returns: {
          address: string
          branch: string
          city: string
          country: string
          domain: string
          id: string
          logo_url: string
          name: string
          phone: string
          postal_code: string
          website: string
        }[]
      }
      search_facets: {
        Args: {
          _access?: string
          _author?: string
          _category?: string
          _date_from?: string
          _date_to?: string
          _format?: string
          _in?: string
          _lang?: string
          _match?: string
          _q?: string
          _term_groups?: Json
          _terms?: string[]
        }
        Returns: {
          cnt: number
          dim: string
          id: string
          label_en: string
          label_pl: string
          parent_id: string
          slug: string
        }[]
      }
      search_messages: {
        Args: {
          _conversation_id?: string
          _limit?: number
          _offset?: number
          _q: string
        }
        Returns: {
          conversation_id: string
          created_at: string
          id: string
          kind: string
          rank: number
          sender_id: string
          snippet: string
          total_count: number
        }[]
      }
      search_people: {
        Args: {
          p_company?: string
          p_embedding?: number[]
          p_job_title?: string
          p_limit?: number
          p_location?: string
          p_offset?: number
          p_open_to?: string[]
          p_query?: string
          p_specialization?: string
          p_verified_only?: boolean
        }
        Returns: {
          avatar_url: string
          completeness_score: number
          current_company: string
          display_name: string
          id: string
          job_title: string
          location: string
          match_score: number
          open_to: string[]
          seeking_en: string
          seeking_pl: string
          slug: string
          specialization: string
          total_count: number
          verified: boolean
        }[]
      }
      search_people_orgs: {
        Args: { _limit?: number; _q?: string }
        Returns: {
          avatar_url: string
          id: string
          kind: string
          label_en: string
          label_pl: string
          logo_url: string
          post_count: number
          score: number
          slug: string
          sublabel_en: string
          sublabel_pl: string
          verified: boolean
        }[]
      }
      search_posts: {
        Args: {
          _access?: string
          _author?: string
          _category?: string
          _date_from?: string
          _date_to?: string
          _format?: string
          _in?: string
          _lang?: string
          _limit?: number
          _match?: string
          _q?: string
          _sort?: string
          _term_groups?: Json
          _terms?: string[]
        }
        Returns: {
          access_mode: string
          author_id: string
          cover_image_url: string
          excerpt_en: string
          excerpt_pl: string
          fuzzy: boolean
          headline_en: string
          headline_pl: string
          id: string
          parent_page_id: string
          post_format: string
          published_at: string
          rank: number
          slug: string
          title_en: string
          title_pl: string
          total_count: number
        }[]
      }
      search_quick: {
        Args: { _limit?: number; _q: string }
        Returns: {
          id: string
          kind: string
          rank: number
          slug: string
          title_en: string
          title_pl: string
        }[]
      }
      search_suggest: {
        Args: { _limit?: number; _q: string }
        Returns: {
          id: string
          sim: number
          slug: string
          title_en: string
          title_pl: string
        }[]
      }
      seed_chat_tier_flags: { Args: { p_tenant: string }; Returns: undefined }
      seed_membership_tiers: { Args: { p_tenant: string }; Returns: undefined }
      seed_pricing_audiences: { Args: { p_tenant: string }; Returns: undefined }
      seed_pricing_defaults: { Args: { p_tenant: string }; Returns: undefined }
      seed_pricing_faq: { Args: { p_tenant: string }; Returns: undefined }
      seed_pricing_plans_v3: { Args: { p_tenant: string }; Returns: undefined }
      seed_related_posts_config: {
        Args: { _tenant_id: string }
        Returns: undefined
      }
      seed_retention_defaults: {
        Args: { p_tenant: string }
        Returns: undefined
      }
      semantic_search_posts: {
        Args: { _embedding: number[]; _limit?: number }
        Returns: {
          post_id: string
          similarity: number
        }[]
      }
      semantic_search_profiles: {
        Args: { _embedding: number[]; _limit?: number }
        Returns: {
          profile_id: string
          similarity: number
        }[]
      }
      send_expert_inmail: {
        Args: {
          p_expected_answers?: string
          p_external_links?: string[]
          p_questions?: string[]
          p_reason: string
          p_recipient_id: string
          p_subject: string
        }
        Returns: string
      }
      send_expert_request: {
        Args: {
          p_expected_answers?: string
          p_external_links?: string[]
          p_questions?: string[]
          p_reason: string
          p_recipient_id: string
          p_subject: string
        }
        Returns: string
      }
      set_tenant_host_assertion_key: {
        Args: { p_kid: string; p_secret: string }
        Returns: string
      }
      set_user_consent:
        | {
            Args: {
              p_given: boolean
              p_gpc: boolean
              p_ip?: string
              p_key: string
              p_lang?: string
              p_source?: string
              p_user_agent?: string
              p_version: string
            }
            Returns: {
              consent_key: string
              created_at: string
              given: boolean
              given_at: string | null
              gpc: boolean
              ip: string | null
              lang: string | null
              tenant_id: string | null
              updated_at: string
              user_agent: string | null
              user_id: string
              version: string
              withdrawn_at: string | null
            }
            SetofOptions: {
              from: "*"
              to: "user_consents"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_banner_version: string
              p_decision_id: string
              p_given: boolean
              p_gpc: boolean
              p_ip: string
              p_key: string
              p_lang: string
              p_page_url: string
              p_source: string
              p_user_agent: string
              p_version: string
            }
            Returns: {
              consent_key: string
              created_at: string
              given: boolean
              given_at: string | null
              gpc: boolean
              ip: string | null
              lang: string | null
              tenant_id: string | null
              updated_at: string
              user_agent: string | null
              user_id: string
              version: string
              withdrawn_at: string | null
            }
            SetofOptions: {
              from: "*"
              to: "user_consents"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_given: boolean
              p_ip?: string
              p_key: string
              p_lang?: string
              p_source?: string
              p_user_agent?: string
              p_version: string
            }
            Returns: {
              consent_key: string
              created_at: string
              given: boolean
              given_at: string | null
              gpc: boolean
              ip: string | null
              lang: string | null
              tenant_id: string | null
              updated_at: string
              user_agent: string | null
              user_id: string
              version: string
              withdrawn_at: string | null
            }
            SetofOptions: {
              from: "*"
              to: "user_consents"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      skill_endorsement_counts: {
        Args: { p_user: string }
        Returns: {
          by_me: boolean
          cnt: number
          skill_id: string
        }[]
      }
      storage_path_tenant: { Args: { _name: string }; Returns: string }
      sync_org_verification: { Args: { p_user_id: string }; Returns: Json }
      tenant_id_for_public_host: { Args: { p_host: string }; Returns: string }
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
      unaccent: { Args: { "": string }; Returns: string }
      unendorse_skill: { Args: { p_skill_id: string }; Returns: undefined }
      user_has_tier_feature: {
        Args: { _feature: string; p_user: string }
        Returns: boolean
      }
      user_is_editorial: { Args: { p_user: string }; Returns: boolean }
      user_tier_rank: {
        Args: { p_tenant?: string; p_user: string }
        Returns: number
      }
      validate_b2b_coupon: {
        Args: {
          _amount_cents: number
          _code: string
          _currency: string
          _plan_id: string
        }
        Returns: {
          coupon_id: string
          discount_cents: number
          discount_kind: string
          discount_percent: number
          error: string
          final_cents: number
          label: string
          ok: boolean
        }[]
      }
      verification_domain_badges: {
        Args: {
          p_email: string
          p_email_confirmed: boolean
          p_tenant_id: string
        }
        Returns: string[]
      }
      verification_domain_tier: {
        Args: {
          p_email: string
          p_email_confirmed: boolean
          p_tenant_id: string
        }
        Returns: string
      }
      verify_content_password: {
        Args: {
          _entity_id: string
          _entity_type: Database["public"]["Enums"]["access_entity_type"]
          _ip_hash?: string
          _password: string
        }
        Returns: {
          blocks_data: Json
          builder_data: Json
          content_en: string
          content_pl: string
          ok: boolean
        }[]
      }
      verify_tenant_host_assertion: { Args: { p_raw: string }; Returns: string }
      vote_poll: {
        Args: { p_option_idx: number; p_poll_id: string }
        Returns: Json
      }
      web_vitals_daily_p75: {
        Args: { p_since: string; p_tenant: string }
        Returns: {
          day: string
          metric: string
          p75: number
          samples: number
        }[]
      }
      workflow_param_text: {
        Args: {
          p_fixed_key: string
          p_from_key: string
          p_params: Json
          p_payload: Json
        }
        Returns: string
      }
      write_recommendation: {
        Args: { p_body: string; p_recipient: string; p_relationship: string }
        Returns: string
      }
    }
    Enums: {
      access_entity_type: "post" | "page" | "media"
      access_mode: "public" | "members" | "paid" | "password"
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
      app_role: "admin" | "editor" | "author" | "user" | "super_admin"
      builder_ab_variant: "a" | "b"
      builder_experiment_event: "exposure" | "conversion"
      builder_experiment_status: "running" | "paused" | "completed"
      builder_popup_status: "draft" | "active" | "archived"
      career_stage:
        | "new"
        | "screening"
        | "interview"
        | "offer"
        | "hired"
        | "rejected"
        | "withdrawn"
      crm_source_type:
        | "contact_form"
        | "newsletter"
        | "comment"
        | "webinar"
        | "import"
        | "other"
      crm_stage:
        | "new"
        | "contacted"
        | "qualified"
        | "proposal"
        | "won"
        | "lost"
        | "archived"
      editor_type: "richtext" | "markdown" | "builder" | "blocks"
      invitation_mode: "magic_link" | "temp_password"
      invitation_status: "pending" | "sent" | "accepted" | "revoked" | "failed"
      menu_item_type: "page" | "post" | "category" | "tag" | "custom"
      name_gender: "male" | "female" | "neutral"
      order_kind: "subscription" | "one_time"
      order_status:
        | "pending"
        | "processing"
        | "paid"
        | "failed"
        | "refunded"
        | "canceled"
      plan_interval: "month" | "year" | "one_time" | "quarter" | "two_weeks"
      post_status:
        | "draft"
        | "published"
        | "archived"
        | "pending_review"
        | "scheduled"
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
      access_mode: ["public", "members", "paid", "password"],
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
      app_role: ["admin", "editor", "author", "user", "super_admin"],
      builder_ab_variant: ["a", "b"],
      builder_experiment_event: ["exposure", "conversion"],
      builder_experiment_status: ["running", "paused", "completed"],
      builder_popup_status: ["draft", "active", "archived"],
      career_stage: [
        "new",
        "screening",
        "interview",
        "offer",
        "hired",
        "rejected",
        "withdrawn",
      ],
      crm_source_type: [
        "contact_form",
        "newsletter",
        "comment",
        "webinar",
        "import",
        "other",
      ],
      crm_stage: [
        "new",
        "contacted",
        "qualified",
        "proposal",
        "won",
        "lost",
        "archived",
      ],
      editor_type: ["richtext", "markdown", "builder", "blocks"],
      invitation_mode: ["magic_link", "temp_password"],
      invitation_status: ["pending", "sent", "accepted", "revoked", "failed"],
      menu_item_type: ["page", "post", "category", "tag", "custom"],
      name_gender: ["male", "female", "neutral"],
      order_kind: ["subscription", "one_time"],
      order_status: [
        "pending",
        "processing",
        "paid",
        "failed",
        "refunded",
        "canceled",
      ],
      plan_interval: ["month", "year", "one_time", "quarter", "two_weeks"],
      post_status: [
        "draft",
        "published",
        "archived",
        "pending_review",
        "scheduled",
      ],
      purchase_status: ["pending", "active", "refunded", "canceled"],
    },
  },
} as const
