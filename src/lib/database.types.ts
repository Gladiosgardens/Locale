// Mirrors `supabase gen types typescript` output for the onboarding migration.
// Regenerate with `npm run db:types` once the project is linked; do not edit by hand after that.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type AreaRow = {
  center_lat: number;
  center_lng: number;
  created_at: string;
  geohash5: string;
  id: string;
  name: string;
};

type ProfileRow = {
  bio: string | null;
  created_at: string;
  display_name: string | null;
  handle: string | null;
  id: string;
  onboarded_at: string | null;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      areas: {
        Row: AreaRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      interests: {
        Row: { id: number; label: string; slug: string; sort_order: number };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: never;
        Update: { bio?: string | null; display_name?: string | null; handle?: string | null };
        Relationships: [];
      };
      profile_private: {
        Row: {
          adult_confirmed_at: string | null;
          area_id: string | null;
          profile_id: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'profile_private_area_id_fkey';
            columns: ['area_id'];
            isOneToOne: false;
            referencedRelation: 'areas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'profile_private_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profile_interests: {
        Row: { created_at: string; interest_id: number; profile_id: string };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'profile_interests_interest_id_fkey';
            columns: ['interest_id'];
            isOneToOne: false;
            referencedRelation: 'interests';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      choose_area: { Args: { p_area_id: string }; Returns: AreaRow };
      complete_onboarding: {
        Args: { p_confirm_adult: boolean; p_display_name: string; p_handle: string };
        Returns: ProfileRow;
      };
      geohash_center: { Args: { p_hash: string }; Returns: { lat: number; lng: number } };
      set_my_area: { Args: { p_geohash5: string; p_name: string }; Returns: AreaRow };
      set_my_interests: { Args: { p_interest_ids: number[] }; Returns: undefined };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
