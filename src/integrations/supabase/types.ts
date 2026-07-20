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
          body: string
          created_at: string
          edited_at: string | null
          id: string
          parent_id: string | null
          post_id: string
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          post_id: string
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          post_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
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
          aliases: Json
          created_at: string
          domain: string | null
          id: string
          name: string
          name_norm: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          aliases?: Json
          created_at?: string
          domain?: string | null
          id?: string
          name: string
          name_norm?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          aliases?: Json
          created_at?: string
          domain?: string | null
          id?: string
          name?: string
          name_norm?: string | null
          tenant_id?: string
          updated_at?: string
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
          stage: Database["public"]["Enums"]["crm_stage"]
          tags: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          aliases?: Json
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
          stage?: Database["public"]["Enums"]["crm_stage"]
          tags?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          aliases?: Json
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
          provider: string
          provider_intent_id: string | null
          provider_session_id: string
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
          provider?: string
          provider_intent_id?: string | null
          provider_session_id: string
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
          provider?: string
          provider_intent_id?: string | null
          provider_session_id?: string
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
      events: {
        Row: {
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
          timezone: string
          title_en: string
          title_pl: string
          updated_at: string
          visibility: string
        }
        Insert: {
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
          host_user_id?: string | null
          id?: string
          join_url?: string | null
          kind?: string
          location?: string | null
          min_tier_rank?: number
          program_id?: string | null
          recording_url?: string | null
          region_id?: string | null
          rsvp_opens_at?: string | null
          slug: string
          starts_at: string
          status?: string
          tenant_id?: string
          timezone?: string
          title_en: string
          title_pl: string
          updated_at?: string
          visibility?: string
        }
        Update: {
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
          host_user_id?: string | null
          id?: string
          join_url?: string | null
          kind?: string
          location?: string | null
          min_tier_rank?: number
          program_id?: string | null
          recording_url?: string | null
          region_id?: string | null
          rsvp_opens_at?: string | null
          slug?: string
          starts_at?: string
          status?: string
          tenant_id?: string
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
            foreignKeyName: "events_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
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
          tenant_id: string
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
      job_runner_settings: {
        Row: {
          base_url: string
          enabled: boolean
          id: number
          secret: string
          updated_at: string
        }
        Insert: {
          base_url?: string
          enabled?: boolean
          id?: number
          secret?: string
          updated_at?: string
        }
        Update: {
          base_url?: string
          enabled?: boolean
          id?: number
          secret?: string
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
          seats_limit: number
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
          seats_limit?: number
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
          seats_limit?: number
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
          benefits: Json
          created_at: string
          description_en: string | null
          description_pl: string | null
          features: Json
          id: string
          is_default: boolean
          key: string
          name_en: string
          name_pl: string
          rank: number
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          benefits?: Json
          created_at?: string
          description_en?: string | null
          description_pl?: string | null
          features?: Json
          id?: string
          is_default?: boolean
          key: string
          name_en: string
          name_pl: string
          rank?: number
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          benefits?: Json
          created_at?: string
          description_en?: string | null
          description_pl?: string | null
          features?: Json
          id?: string
          is_default?: boolean
          key?: string
          name_en?: string
          name_pl?: string
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
          search_vector: unknown | null
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
          search_vector?: unknown | null
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
          search_vector?: unknown | null
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
          campaign_id: string
          created_at: string
          email: string
          error: string | null
          id: string
          language: string
          sent_at: string | null
          status: string
          subscriber_id: string | null
          tenant_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          email: string
          error?: string | null
          id?: string
          language?: string
          sent_at?: string | null
          status?: string
          subscriber_id?: string | null
          tenant_id?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          email?: string
          error?: string | null
          id?: string
          language?: string
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
          popup_doc: Json | null
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
          popup_doc?: Json | null
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
          popup_doc?: Json | null
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
          enabled_comment: boolean
          enabled_connection: boolean
          enabled_content: boolean
          enabled_follow: boolean
          enabled_message: boolean
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
          enabled_comment?: boolean
          enabled_connection?: boolean
          enabled_content?: boolean
          enabled_follow?: boolean
          enabled_message?: boolean
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
          enabled_comment?: boolean
          enabled_connection?: boolean
          enabled_content?: boolean
          enabled_follow?: boolean
          enabled_message?: boolean
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
          id: string
          invited_email: string
          org_id: string
          role: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          id?: string
          invited_email: string
          org_id: string
          role?: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          id?: string
          invited_email?: string
          org_id?: string
          role?: string
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
      outbound_link_checks: {
        Row: {
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
          provider_subscription_id: string | null
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
          provider_subscription_id?: string | null
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
          provider_subscription_id?: string | null
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
          layout_overrides: Json | null
          og_image_generated_url: string | null
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
          status: Database["public"]["Enums"]["post_status"]
          takeaways_en: string[]
          takeaways_pl: string[]
          takeaways_variant: string | null
          template_id: string | null
          tenant_id: string
          title_en: string
          title_pl: string
          toc_override: Json | null
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
          layout_overrides?: Json | null
          og_image_generated_url?: string | null
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
          status?: Database["public"]["Enums"]["post_status"]
          takeaways_en?: string[]
          takeaways_pl?: string[]
          takeaways_variant?: string | null
          template_id?: string | null
          tenant_id: string
          title_en?: string
          title_pl?: string
          toc_override?: Json | null
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
          layout_overrides?: Json | null
          og_image_generated_url?: string | null
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
          status?: Database["public"]["Enums"]["post_status"]
          takeaways_en?: string[]
          takeaways_pl?: string[]
          takeaways_variant?: string | null
          template_id?: string | null
          tenant_id?: string
          title_en?: string
          title_pl?: string
          toc_override?: Json | null
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
          granted_by: string | null
          id: string
          note: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          badge: string
          created_at?: string
          granted_by?: string | null
          id?: string
          note?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          badge?: string
          created_at?: string
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
          contact_email: string | null
          cover_url: string | null
          created_at: string
          current_company: string | null
          discoverable: boolean
          discovery_search: string | null
          display_name: string | null
          email: string | null
          facebook_url: string | null
          first_name: string | null
          gender: Database["public"]["Enums"]["name_gender"] | null
          id: string
          instagram_url: string | null
          job_title: string | null
          last_name: string | null
          linkedin_url: string | null
          location: string | null
          phone: string | null
          prefs: Json
          profile_view_mode: string
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
          contact_email?: string | null
          cover_url?: string | null
          created_at?: string
          current_company?: string | null
          discoverable?: boolean
          discovery_search?: string | null
          display_name?: string | null
          email?: string | null
          facebook_url?: string | null
          first_name?: string | null
          gender?: Database["public"]["Enums"]["name_gender"] | null
          id: string
          instagram_url?: string | null
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          prefs?: Json
          profile_view_mode?: string
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
          contact_email?: string | null
          cover_url?: string | null
          created_at?: string
          current_company?: string | null
          discoverable?: boolean
          discovery_search?: string | null
          display_name?: string | null
          email?: string | null
          facebook_url?: string | null
          first_name?: string | null
          gender?: Database["public"]["Enums"]["name_gender"] | null
          id?: string
          instagram_url?: string | null
          job_title?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          prefs?: Json
          profile_view_mode?: string
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
        ]
      }
      programs: {
        Row: {
          cover_url: string | null
          created_at: string
          description_en: string | null
          description_pl: string | null
          id: string
          is_active: boolean
          kind: string
          name_en: string
          name_pl: string
          slug: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          description_en?: string | null
          description_pl?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name_en: string
          name_pl: string
          slug: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          description_en?: string | null
          description_pl?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name_en?: string
          name_pl?: string
          slug?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
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
            referencedRelation: "research_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      research_programs: {
        Row: {
          accent_color: string
          category_id: string | null
          contact_email: string | null
          created_at: string
          hero_image_url: string | null
          icon: string
          id: string
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
          created_at?: string
          hero_image_url?: string | null
          icon?: string
          id?: string
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
          created_at?: string
          hero_image_url?: string | null
          icon?: string
          id?: string
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
            foreignKeyName: "research_programs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_programs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          id: string
          last_alert_at: string | null
          last_alert_check_at: string | null
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
          id?: string
          last_alert_at?: string | null
          last_alert_check_at?: string | null
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
          id?: string
          last_alert_at?: string | null
          last_alert_check_at?: string | null
          last_seen_published_at?: string | null
          name?: string
          params?: Json
          tenant_id?: string
          url?: string | null
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
          consent_key: string
          created_at: string
          given: boolean
          id: string
          ip: string | null
          lang: string | null
          source: string | null
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          consent_key: string
          created_at?: string
          given: boolean
          id?: string
          ip?: string | null
          lang?: string | null
          source?: string | null
          user_agent?: string | null
          user_id: string
          version: string
        }
        Update: {
          consent_key?: string
          created_at?: string
          given?: boolean
          id?: string
          ip?: string | null
          lang?: string | null
          source?: string | null
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      user_consents: {
        Row: {
          consent_key: string
          created_at: string
          given: boolean
          given_at: string | null
          ip: string | null
          lang: string | null
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
          ip?: string | null
          lang?: string | null
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
          ip?: string | null
          lang?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string
          version?: string
          withdrawn_at?: string | null
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
      author_profiles_public: {
        Row: {
          avatar_url: string | null
          bio_en: string | null
          bio_pl: string | null
          brand_accent: string | null
          brand_accent_dark: string | null
          company: string | null
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
      content_access_public: {
        Row: {
          created_at: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["access_entity_type"] | null
          id: string | null
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
      profiles_public: {
        Row: {
          avatar_url: string | null
          bio_en: string | null
          bio_pl: string | null
          cover_url: string | null
          current_company: string | null
          display_name: string | null
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
          avatar_url?: string | null
          bio_en?: string | null
          bio_pl?: string | null
          cover_url?: string | null
          current_company?: string | null
          display_name?: string | null
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
          avatar_url?: string | null
          bio_en?: string | null
          bio_pl?: string | null
          cover_url?: string | null
          current_company?: string | null
          display_name?: string | null
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
    }
    Functions: {
      _are_connected: { Args: { _a: string; _b: string }; Returns: boolean }
      _caller_tenant: { Args: never; Returns: string }
      _suggest_score: {
        Args: { _a: string; _b: string; _q: string }
        Returns: number
      }
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
      admin_clear_content_password: {
        Args: {
          _entity_id: string
          _entity_type: Database["public"]["Enums"]["access_entity_type"]
        }
        Returns: undefined
      }
      admin_community_stats: { Args: never; Returns: Json }
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
      can_publish_content: { Args: { _user_id?: string }; Returns: boolean }
      change_user_role: {
        Args: {
          _new_role: Database["public"]["Enums"]["app_role"]
          _target_user_id: string
        }
        Returns: Database["public"]["Enums"]["app_role"][]
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
          can_invite: boolean
          connection_id: string
          mutual_count: number
          status: string
          user_id: string
        }[]
      }
      connection_suggestions: {
        Args: { p_limit?: number }
        Returns: {
          avatar_url: string
          current_company: string
          display_name: string
          job_title: string
          location: string
          mutual_count: number
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
      content_access_has_password: {
        Args: {
          _entity_id: string
          _entity_type: Database["public"]["Enums"]["access_entity_type"]
        }
        Returns: boolean
      }
      create_event_group: { Args: { p_event_id: string }; Returns: string }
      create_group_conversation: {
        Args: { p_member_ids: string[]; p_title: string }
        Returns: string
      }
      crm_get_merydian_secrets: {
        Args: { _tenant?: string }
        Returns: {
          api_key: string
          webhook_secret: string
        }[]
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
      emit_domain_event: {
        Args: {
          p_aggregate_id: string
          p_aggregate_type: string
          p_event_type: string
          p_payload?: Json
          p_tenant_id: string
        }
        Returns: string
      }
      endorse_skill: { Args: { p_skill_id: string }; Returns: string }
      enforce_form_field_policy: {
        Args: { _form_type: string; _payload: Json; _tenant: string }
        Returns: string[]
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
          specialization: string
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
        }[]
      }
      get_event_rsvp_counts: {
        Args: { p_event_ids: string[] }
        Returns: {
          event_id: string
          going: number
          interested: number
        }[]
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
      get_my_qa_question_ids: {
        Args: { p_session_id: string }
        Returns: string[]
      }
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
          contact_email: string | null
          cover_url: string | null
          created_at: string
          current_company: string | null
          discoverable: boolean
          discovery_search: string | null
          display_name: string | null
          email: string | null
          facebook_url: string | null
          first_name: string | null
          gender: Database["public"]["Enums"]["name_gender"] | null
          id: string
          instagram_url: string | null
          job_title: string | null
          last_name: string | null
          linkedin_url: string | null
          location: string | null
          phone: string | null
          prefs: Json
          profile_view_mode: string
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
          layout_overrides: Json | null
          og_image_generated_url: string | null
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
          status: Database["public"]["Enums"]["post_status"]
          takeaways_en: string[]
          takeaways_pl: string[]
          takeaways_variant: string | null
          template_id: string | null
          tenant_id: string
          title_en: string
          title_pl: string
          toc_override: Json | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: false
          isSetofReturn: true
        }
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
      get_tracker_stats: { Args: never; Returns: Json }
      guess_gender_from_name: {
        Args: { _name: string }
        Returns: Database["public"]["Enums"]["name_gender"]
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
      is_blocked_pair: { Args: { _a: string; _b: string }; Returns: boolean }
      is_conversation_member: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      is_form_field_active: {
        Args: { _field: string; _form_type: string; _tenant: string }
        Returns: boolean
      }
      is_org_owner: { Args: { p_org: string }; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      is_super_admin: { Args: { _user_id?: string }; Returns: boolean }
      is_tenant_conversation_member: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
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
      linked_item_label: {
        Args: { p_id: string; p_type: string }
        Returns: string
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
      my_introduction_requests: {
        Args: { p_role?: string }
        Returns: {
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
      nes_search_positive_rest: { Args: { _q: string }; Returns: string }
      nes_search_tsquery: { Args: { _q: string }; Returns: unknown }
      nes_search_tsquery_adv: {
        Args: { _match?: string; _q: string }
        Returns: unknown
      }
      newsletter_min_tier_emails: {
        Args: { p_min: number; p_tenant: string }
        Returns: {
          email: string
        }[]
      }
      org_add_seat: {
        Args: { p_email: string; p_org: string; p_role?: string }
        Returns: string
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
      popular_searches: {
        Args: { _days?: number; _limit?: number }
        Returns: {
          cnt: number
          q: string
        }[]
      }
      post_canonical_href: { Args: { _post_id: string }; Returns: string }
      process_mentions: {
        Args: {
          p_actor_id: string
          p_body: string
          p_href: string
          p_kind: string
          p_source_id: string
          p_source_type: string
          p_tenant_id: string
        }
        Returns: number
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
      prune_command_idempotency: { Args: never; Returns: number }
      prune_domain_events: { Args: { p_keep?: string }; Returns: number }
      prune_integration_deliveries: { Args: never; Returns: number }
      prune_push_queue: { Args: { p_keep?: string }; Returns: number }
      public_tenant_id: { Args: never; Returns: string }
      publish_due_pages: { Args: never; Returns: number }
      publish_due_posts: { Args: never; Returns: number }
      rate_limit_hit: {
        Args: {
          _max: number
          _scope: string
          _subject: string
          _window_minutes?: number
        }
        Returns: {
          allowed: boolean
          hits: number
          window_start: string
        }[]
      }
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
      related_posts_signals: {
        Args: { _since_days?: number; _tenant: string }
        Returns: Json
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
      request_correlation_id: { Args: never; Returns: string }
      request_introduction: {
        Args: { p_bridge: string; p_message: string; p_target: string }
        Returns: string
      }
      request_public_host: { Args: never; Returns: string }
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
      rsvp_event: {
        Args: { p_event_id: string; p_status: string }
        Returns: Json
      }
      run_event_reminders: { Args: never; Returns: number }
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
      search_people: {
        Args: {
          p_company?: string
          p_limit?: number
          p_location?: string
          p_offset?: number
          p_query?: string
          p_specialization?: string
        }
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
      search_messages: {
        Args: {
          _conversation_id?: string
          _limit?: number
          _offset?: number
          _q?: string
        }
        Returns: {
          conversation_id: string
          created_at: string
          id: string
          kind: string
          rank: number
          snippet: string
          sender_id: string
          total_count: number
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
      seed_membership_tiers: { Args: { p_tenant: string }; Returns: undefined }
      set_user_consent: {
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
          ip: string | null
          lang: string | null
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
      plan_interval: "month" | "year" | "one_time"
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
      plan_interval: ["month", "year", "one_time"],
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
