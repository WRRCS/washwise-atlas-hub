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
      activity_log: {
        Row: {
          action_type: string
          actor_id: string | null
          created_at: string
          description: string
          entity_id: string | null
          entity_type: string
          id: string
          tenant_id: string
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          created_at?: string
          description: string
          entity_id?: string | null
          entity_type: string
          id?: string
          tenant_id: string
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          created_at?: string
          description?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          messages: Json
          tenant_id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          messages?: Json
          tenant_id: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          messages?: Json
          tenant_id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_log: {
        Row: {
          completion_tokens: number
          conversation_id: string | null
          created_at: string
          estimated_cost_cents: number
          id: string
          model: string
          prompt_tokens: number
          tenant_id: string
          total_tokens: number
          user_id: string
        }
        Insert: {
          completion_tokens?: number
          conversation_id?: string | null
          created_at?: string
          estimated_cost_cents?: number
          id?: string
          model: string
          prompt_tokens?: number
          tenant_id: string
          total_tokens?: number
          user_id: string
        }
        Update: {
          completion_tokens?: number
          conversation_id?: string | null
          created_at?: string
          estimated_cost_cents?: number
          id?: string
          model?: string
          prompt_tokens?: number
          tenant_id?: string
          total_tokens?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string
          tenant_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
          tenant_id?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_photos: {
        Row: {
          caption: string | null
          client_id: string
          id: string
          storage_path: string
          tenant_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          client_id: string
          id?: string
          storage_path: string
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          client_id?: string
          id?: string
          storage_path?: string
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_photos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_template_preferences: {
        Row: {
          client_id: string
          created_at: string
          email_template_overrides: Json
          id: string
          quote_template_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          email_template_overrides?: Json
          id?: string
          quote_template_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          email_template_overrides?: Json
          id?: string
          quote_template_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_template_preferences_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_template_preferences_quote_template_id_fkey"
            columns: ["quote_template_id"]
            isOneToOne: false
            referencedRelation: "quote_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_template_preferences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          billing_address: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          is_active: boolean
          is_airbnb_host: boolean
          last_name: string | null
          phone: string | null
          qbo_customer_id: string | null
          service_address: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          billing_address?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          is_airbnb_host?: boolean
          last_name?: string | null
          phone?: string | null
          qbo_customer_id?: string | null
          service_address?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          billing_address?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          is_airbnb_host?: boolean
          last_name?: string | null
          phone?: string | null
          qbo_customer_id?: string | null
          service_address?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body_html: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          subject: string
          tenant_id: string
          trigger_event: Database["public"]["Enums"]["email_trigger_event"]
          updated_at: string
        }
        Insert: {
          body_html?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          subject?: string
          tenant_id: string
          trigger_event: Database["public"]["Enums"]["email_trigger_event"]
          updated_at?: string
        }
        Update: {
          body_html?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          subject?: string
          tenant_id?: string
          trigger_event?: Database["public"]["Enums"]["email_trigger_event"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gps_consent_log: {
        Row: {
          consent_given_at: string
          consent_method: string
          created_at: string
          employee_id: string
          id: string
          ip_address: string | null
          tenant_id: string
        }
        Insert: {
          consent_given_at?: string
          consent_method: string
          created_at?: string
          employee_id: string
          id?: string
          ip_address?: string | null
          tenant_id: string
        }
        Update: {
          consent_given_at?: string
          consent_method?: string
          created_at?: string
          employee_id?: string
          id?: string
          ip_address?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gps_consent_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_errors: {
        Row: {
          created_at: string
          error_message: string
          id: string
          inbound_payload: Json | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          source: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          error_message: string
          id?: string
          inbound_payload?: Json | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          source: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string
          id?: string
          inbound_payload?: Json | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          source?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_errors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          access_token: string | null
          connected_at: string | null
          created_at: string
          external_account_id: string | null
          id: string
          is_connected: boolean
          provider: Database["public"]["Enums"]["integration_provider"]
          refresh_token: string | null
          settings: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          connected_at?: string | null
          created_at?: string
          external_account_id?: string | null
          id?: string
          is_connected?: boolean
          provider: Database["public"]["Enums"]["integration_provider"]
          refresh_token?: string | null
          settings?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          connected_at?: string | null
          created_at?: string
          external_account_id?: string | null
          id?: string
          is_connected?: boolean
          provider?: Database["public"]["Enums"]["integration_provider"]
          refresh_token?: string | null
          settings?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          cost_per_unit_cents: number
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          quantity_on_hand: number
          reorder_threshold: number
          sku: string | null
          tenant_id: string
          unit: string
          updated_at: string
          vendor_name: string | null
          vendor_sku: string | null
        }
        Insert: {
          cost_per_unit_cents?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          quantity_on_hand?: number
          reorder_threshold?: number
          sku?: string | null
          tenant_id: string
          unit?: string
          updated_at?: string
          vendor_name?: string | null
          vendor_sku?: string | null
        }
        Update: {
          cost_per_unit_cents?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          quantity_on_hand?: number
          reorder_threshold?: number
          sku?: string | null
          tenant_id?: string
          unit?: string
          updated_at?: string
          vendor_name?: string | null
          vendor_sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transactions: {
        Row: {
          change_amount: number
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          job_id: string | null
          notes: string | null
          reason: string
          tenant_id: string
        }
        Insert: {
          change_amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          job_id?: string | null
          notes?: string | null
          reason?: string
          tenant_id: string
        }
        Update: {
          change_amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          job_id?: string | null
          notes?: string | null
          reason?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_total_cents: number
          quantity: number
          service_date: string | null
          sort_order: number
          tenant_id: string
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_total_cents?: number
          quantity?: number
          service_date?: string | null
          sort_order?: number
          tenant_id: string
          unit_price_cents?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_total_cents?: number
          quantity?: number
          service_date?: string | null
          sort_order?: number
          tenant_id?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_cents: number
          bundle_month: string | null
          card_surcharge: boolean
          cleanings_count: number | null
          client_id: string
          created_at: string
          currency: string
          due_at: string | null
          due_date: string | null
          id: string
          issue_date: string
          job_id: string | null
          number: string
          paid_at: string | null
          pay_link: string | null
          qbo_id: string | null
          qbo_sync_error: string | null
          qbo_synced_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal_cents: number
          surcharge_cents: number
          tenant_id: string
          total_cents: number
        }
        Insert: {
          amount_cents?: number
          bundle_month?: string | null
          card_surcharge?: boolean
          cleanings_count?: number | null
          client_id: string
          created_at?: string
          currency?: string
          due_at?: string | null
          due_date?: string | null
          id?: string
          issue_date?: string
          job_id?: string | null
          number: string
          paid_at?: string | null
          pay_link?: string | null
          qbo_id?: string | null
          qbo_sync_error?: string | null
          qbo_synced_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_cents?: number
          surcharge_cents?: number
          tenant_id: string
          total_cents?: number
        }
        Update: {
          amount_cents?: number
          bundle_month?: string | null
          card_surcharge?: boolean
          cleanings_count?: number | null
          client_id?: string
          created_at?: string
          currency?: string
          due_at?: string | null
          due_date?: string | null
          id?: string
          issue_date?: string
          job_id?: string | null
          number?: string
          paid_at?: string | null
          pay_link?: string | null
          qbo_id?: string | null
          qbo_sync_error?: string | null
          qbo_synced_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_cents?: number
          surcharge_cents?: number
          tenant_id?: string
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_employees: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          job_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          job_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          job_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_employees_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_employees_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_employees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_photos: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          job_id: string
          photo_type: Database["public"]["Enums"]["photo_type"]
          storage_path: string
          taken_at: string | null
          tenant_id: string
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          job_id: string
          photo_type?: Database["public"]["Enums"]["photo_type"]
          storage_path: string
          taken_at?: string | null
          tenant_id: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          job_id?: string
          photo_type?: Database["public"]["Enums"]["photo_type"]
          storage_path?: string
          taken_at?: string | null
          tenant_id?: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_photos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      job_sop_items: {
        Row: {
          completed: boolean
          completed_at: string | null
          completed_by: string | null
          id: string
          job_id: string
          label: string
          position: number
          tenant_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          id?: string
          job_id: string
          label: string
          position: number
          tenant_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          id?: string
          job_id?: string
          label?: string
          position?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_sop_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_sop_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          external_id: string | null
          external_metadata: Json | null
          external_source: string | null
          id: string
          is_recurring: boolean
          notes: string | null
          price_cents: number
          property_id: string | null
          recurrence_end: string | null
          recurrence_group_id: string | null
          recurrence_rule: string | null
          scheduled_end: string
          scheduled_start: string
          service_type_id: string
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          assigned_to?: string | null
          client_id: string
          created_at?: string
          external_id?: string | null
          external_metadata?: Json | null
          external_source?: string | null
          id?: string
          is_recurring?: boolean
          notes?: string | null
          price_cents?: number
          property_id?: string | null
          recurrence_end?: string | null
          recurrence_group_id?: string | null
          recurrence_rule?: string | null
          scheduled_end: string
          scheduled_start: string
          service_type_id: string
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          assigned_to?: string | null
          client_id?: string
          created_at?: string
          external_id?: string | null
          external_metadata?: Json | null
          external_source?: string | null
          id?: string
          is_recurring?: boolean
          notes?: string | null
          price_cents?: number
          property_id?: string | null
          recurrence_end?: string | null
          recurrence_group_id?: string | null
          recurrence_rule?: string | null
          scheduled_end?: string
          scheduled_start?: string
          service_type_id?: string
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "service_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          client_id: string | null
          created_at: string
          id: string
          last_contacted_at: string | null
          notes: string | null
          payload: Json
          service_interest: string | null
          source: string
          status: Database["public"]["Enums"]["lead_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          last_contacted_at?: string | null
          notes?: string | null
          payload?: Json
          service_interest?: string | null
          source?: string
          status?: Database["public"]["Enums"]["lead_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          last_contacted_at?: string | null
          notes?: string | null
          payload?: Json
          service_interest?: string | null
          source?: string
          status?: Database["public"]["Enums"]["lead_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          id: string
          is_active: boolean
          name: string
          subject: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          body: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          subject?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          subject?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          error: string | null
          id: string
          payload: Json
          recipient_id: string
          recipient_type: Database["public"]["Enums"]["notification_recipient_type"]
          scheduled_for: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          template_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          recipient_id: string
          recipient_type: Database["public"]["Enums"]["notification_recipient_type"]
          scheduled_for?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          template_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          recipient_id?: string
          recipient_type?: Database["public"]["Enums"]["notification_recipient_type"]
          scheduled_for?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          template_name?: string
          tenant_id?: string
          updated_at?: string
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
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          external_transaction_id: string | null
          id: string
          invoice_id: string
          net_to_business_cents: number
          note: string | null
          payment_method_details: Json | null
          processed_at: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          recorded_by: string | null
          status: Database["public"]["Enums"]["payment_status"]
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          surcharge_cents: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          external_transaction_id?: string | null
          id?: string
          invoice_id: string
          net_to_business_cents: number
          note?: string | null
          payment_method_details?: Json | null
          processed_at?: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          recorded_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          surcharge_cents?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          external_transaction_id?: string | null
          id?: string
          invoice_id?: string
          net_to_business_cents?: number
          note?: string | null
          payment_method_details?: Json | null
          processed_at?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          recorded_by?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          surcharge_cents?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_share_log: {
        Row: {
          created_at: string
          id: string
          job_id: string
          photo_id: string
          shared_at: string
          shared_by: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          photo_id: string
          shared_at?: string
          shared_by?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          photo_id?: string
          shared_at?: string
          shared_by?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_share_log_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_share_log_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "job_photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_share_log_tenant_id_fkey"
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
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          phone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
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
      property_specs: {
        Row: {
          access_notes: string | null
          bathrooms: number | null
          bedrooms: number | null
          client_id: string
          created_at: string
          id: string
          key_location: string | null
          parking_notes: string | null
          pets: string | null
          special_instructions: string | null
          square_footage: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_notes?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          client_id: string
          created_at?: string
          id?: string
          key_location?: string | null
          parking_notes?: string | null
          pets?: string | null
          special_instructions?: string | null
          square_footage?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          access_notes?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          client_id?: string
          created_at?: string
          id?: string
          key_location?: string | null
          parking_notes?: string | null
          pets?: string | null
          special_instructions?: string | null
          square_footage?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_specs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_templates: {
        Row: {
          body_html: string
          created_at: string
          footer_html: string
          header_html: string
          id: string
          is_default: boolean
          name: string
          service_type_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          body_html?: string
          created_at?: string
          footer_html?: string
          header_html?: string
          id?: string
          is_default?: boolean
          name: string
          service_type_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          created_at?: string
          footer_html?: string
          header_html?: string
          id?: string
          is_default?: boolean
          name?: string
          service_type_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_templates_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "service_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_type_inventory_recipes: {
        Row: {
          created_at: string
          id: string
          inventory_item_id: string
          quantity_per_job: number
          service_type_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_item_id: string
          quantity_per_job?: number
          service_type_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          inventory_item_id?: string
          quantity_per_job?: number
          service_type_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_type_inventory_recipes_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_type_inventory_recipes_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "service_types"
            referencedColumns: ["id"]
          },
        ]
      }
      service_types: {
        Row: {
          active: boolean
          color: string
          created_at: string
          default_duration_minutes: number
          default_price_cents: number
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["service_kind"]
          name: string
          sop_steps: Json
          tenant_id: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          default_duration_minutes?: number
          default_price_cents?: number
          description?: string | null
          id?: string
          kind: Database["public"]["Enums"]["service_kind"]
          name: string
          sop_steps?: Json
          tenant_id: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          default_duration_minutes?: number
          default_price_cents?: number
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["service_kind"]
          name?: string
          sop_steps?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_attachments: {
        Row: {
          caption: string | null
          id: string
          original_filename: string
          sop_id: string
          storage_path: string
          tenant_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          id?: string
          original_filename: string
          sop_id: string
          storage_path: string
          tenant_id: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          id?: string
          original_filename?: string
          sop_id?: string
          storage_path?: string
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sop_attachments_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_reviews: {
        Row: {
          employee_id: string
          id: string
          job_id: string | null
          reviewed_at: string
          sop_id: string
          tenant_id: string
        }
        Insert: {
          employee_id: string
          id?: string
          job_id?: string | null
          reviewed_at?: string
          sop_id: string
          tenant_id: string
        }
        Update: {
          employee_id?: string
          id?: string
          job_id?: string | null
          reviewed_at?: string
          sop_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_reviews_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_steps: {
        Row: {
          created_at: string
          description: string | null
          id: string
          reference_photo_path: string | null
          sop_id: string
          step_number: number
          tenant_id: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          reference_photo_path?: string | null
          sop_id: string
          step_number: number
          tenant_id: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          reference_photo_path?: string | null
          sop_id?: string
          step_number?: number
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_steps_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sops: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          service_type_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          service_type_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          service_type_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sops_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "service_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sops_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          address: string | null
          ai_assistant_enabled: boolean
          business_email: string | null
          business_hours: Json | null
          business_phone: string | null
          created_at: string
          gps_retention_days: number
          id: string
          locale: string
          name: string
          onboarding_completed: boolean
          plan_tier: string
          quiet_hours: Json | null
          reminder_lead_hours: number
          signed_up_at: string
          slug: string
          timezone: string
          track_gps: boolean
        }
        Insert: {
          address?: string | null
          ai_assistant_enabled?: boolean
          business_email?: string | null
          business_hours?: Json | null
          business_phone?: string | null
          created_at?: string
          gps_retention_days?: number
          id?: string
          locale?: string
          name: string
          onboarding_completed?: boolean
          plan_tier?: string
          quiet_hours?: Json | null
          reminder_lead_hours?: number
          signed_up_at?: string
          slug: string
          timezone?: string
          track_gps?: boolean
        }
        Update: {
          address?: string | null
          ai_assistant_enabled?: boolean
          business_email?: string | null
          business_hours?: Json | null
          business_phone?: string | null
          created_at?: string
          gps_retention_days?: number
          id?: string
          locale?: string
          name?: string
          onboarding_completed?: boolean
          plan_tier?: string
          quiet_hours?: Json | null
          reminder_lead_hours?: number
          signed_up_at?: string
          slug?: string
          timezone?: string
          track_gps?: boolean
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          clock_in_accuracy_meters: number | null
          clock_in_latitude: number | null
          clock_in_longitude: number | null
          clock_out_accuracy_meters: number | null
          clock_out_latitude: number | null
          clock_out_longitude: number | null
          consent_given_at: string | null
          ended_at: string | null
          id: string
          job_id: string
          notes: string | null
          started_at: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          clock_in_accuracy_meters?: number | null
          clock_in_latitude?: number | null
          clock_in_longitude?: number | null
          clock_out_accuracy_meters?: number | null
          clock_out_latitude?: number | null
          clock_out_longitude?: number | null
          consent_given_at?: string | null
          ended_at?: string | null
          id?: string
          job_id: string
          notes?: string | null
          started_at?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          clock_in_accuracy_meters?: number | null
          clock_in_latitude?: number | null
          clock_in_longitude?: number | null
          clock_out_accuracy_meters?: number | null
          clock_out_latitude?: number | null
          clock_out_longitude?: number | null
          consent_given_at?: string | null
          ended_at?: string | null
          id?: string
          job_id?: string
          notes?: string | null
          started_at?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _client_name: { Args: { _client_id: string }; Returns: string }
      current_tenant_id: { Args: never; Returns: string }
      current_tenant_onboarding_completed: { Args: never; Returns: boolean }
      enqueue_notification: {
        Args: {
          _channel: Database["public"]["Enums"]["notification_channel"]
          _payload: Json
          _recipient_id: string
          _recipient_type: Database["public"]["Enums"]["notification_recipient_type"]
          _scheduled_for?: string
          _template_name: string
          _tenant: string
        }
        Returns: string
      }
      get_client_retention: {
        Args: never
        Returns: {
          client_id: string
          first_service_date: string
          full_name: string
          is_recurring: boolean
          last_service_date: string
          lifetime_revenue_cents: number
          months_active_count: number
          total_jobs_count: number
        }[]
      }
      get_employee_productivity: {
        Args: { _from: string; _to: string }
        Returns: {
          avg_job_duration_minutes: number
          employee_id: string
          full_name: string
          jobs_completed_count: number
          revenue_attributed_cents: number
          total_hours_worked: number
        }[]
      }
      get_inventory_usage_detail: {
        Args: { _from: string; _to: string }
        Returns: {
          item_id: string
          item_name: string
          item_unit: string
          month: string
          total_cost_cents: number
          units_used: number
        }[]
      }
      get_revenue_by_month: {
        Args: { _from: string; _to: string }
        Returns: {
          avg_invoice_cents: number
          by_service_type: Json
          invoice_count: number
          month: string
          total_revenue_cents: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_owner: { Args: never; Returns: boolean }
      next_invoice_number: { Args: { _tenant: string }; Returns: string }
      purge_expired_gps: { Args: { _tenant: string }; Returns: number }
    }
    Enums: {
      app_role: "owner" | "employee" | "super_admin"
      email_trigger_event:
        | "booking_confirmation"
        | "appointment_reminder"
        | "invoice_sent"
        | "invoice_overdue"
        | "job_completed_thankyou"
        | "review_request"
      integration_provider:
        | "quickbooks"
        | "stripe"
        | "venmo"
        | "godaddy"
        | "turno"
      invoice_status:
        | "draft"
        | "sent"
        | "paid"
        | "void"
        | "overdue"
        | "cancelled"
      job_status: "scheduled" | "in_progress" | "completed" | "canceled"
      lead_status: "new" | "contacted" | "qualified" | "won" | "lost"
      notification_channel: "sms" | "email"
      notification_recipient_type: "client" | "employee" | "owner"
      notification_status: "pending" | "sent" | "failed"
      payment_provider: "venmo" | "card" | "ach" | "manual"
      payment_status: "pending" | "succeeded" | "failed" | "refunded"
      photo_type: "before" | "after" | "other"
      service_kind:
        | "airbnb_turnover"
        | "move_in"
        | "move_out"
        | "residential"
        | "apartment_move_in"
        | "apartment_move_out"
        | "commercial"
        | "residential_deep"
        | "post_construction"
        | "window_cleaning"
        | "carpet_cleaning"
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
      app_role: ["owner", "employee", "super_admin"],
      email_trigger_event: [
        "booking_confirmation",
        "appointment_reminder",
        "invoice_sent",
        "invoice_overdue",
        "job_completed_thankyou",
        "review_request",
      ],
      integration_provider: [
        "quickbooks",
        "stripe",
        "venmo",
        "godaddy",
        "turno",
      ],
      invoice_status: ["draft", "sent", "paid", "void", "overdue", "cancelled"],
      job_status: ["scheduled", "in_progress", "completed", "canceled"],
      lead_status: ["new", "contacted", "qualified", "won", "lost"],
      notification_channel: ["sms", "email"],
      notification_recipient_type: ["client", "employee", "owner"],
      notification_status: ["pending", "sent", "failed"],
      payment_provider: ["venmo", "card", "ach", "manual"],
      payment_status: ["pending", "succeeded", "failed", "refunded"],
      photo_type: ["before", "after", "other"],
      service_kind: [
        "airbnb_turnover",
        "move_in",
        "move_out",
        "residential",
        "apartment_move_in",
        "apartment_move_out",
        "commercial",
        "residential_deep",
        "post_construction",
        "window_cleaning",
        "carpet_cleaning",
      ],
    },
  },
} as const
