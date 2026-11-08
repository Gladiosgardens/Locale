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
  avatar_path: string | null;
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
        Row: {
          active: boolean;
          id: number;
          is_family: boolean;
          label: string;
          section: string;
          slug: string;
          sort_order: number;
        };
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
          dm_policy: string;
          findable_by_email: boolean;
          shopping_default: boolean;
          notify_comments: boolean;
          notify_follows: boolean;
          notify_groups: boolean;
          notify_messages: boolean;
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
      saved_items: {
        Row: { created_at: string; item_id: string; post_id: string; profile_id: string };
        Insert: never;
        Update: never;
        Relationships: [];
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
      posts: {
        Row: {
          area_id: string | null;
          author_id: string;
          caption: string | null;
          id: string;
          published_at: string;
          group_id: string | null;
          removed_at: string | null;
          searchable: boolean;
          status: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      post_media: {
        Row: { height: number; id: string; position: number; post_id: string; storage_path: string; width: number };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      items: {
        Row: {
          brand: string | null;
          created_at: string;
          created_by: string;
          currency: string | null;
          id: string;
          is_affiliate: boolean;
          price_cents: number | null;
          store_name: string | null;
          title: string;
          url: string | null;
          url_host: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      item_tags: {
        Row: { id: string; item_id: string; post_media_id: string; x: number; y: number };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      post_interests: {
        Row: { interest_id: number; post_id: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      choose_area: { Args: { p_area_id: string }; Returns: AreaRow };
      complete_onboarding: {
        Args: { p_confirm_adult: boolean; p_display_name: string; p_handle: string };
        Returns: ProfileRow;
      };
      discover_posts: {
        Args: {
          p_before_id?: string;
          p_before_published_at?: string;
          p_author_id?: string;
          p_following?: boolean;
          p_for_you?: boolean;
          p_limit?: number;
          p_post_id?: string;
          p_query?: string;
          p_saved?: boolean;
        };
        Returns: {
          area_name: string | null;
          author_display_name: string;
          author_handle: string;
          author_id: string;
          caption: string | null;
          id: string;
          interest_ids: number[];
          matched_item_ids: string[];
          media: Json;
          published_at: string;
          rank_at: string;
          like_count: number;
          comment_count: number;
          i_liked: boolean;
          i_saved: boolean;
        }[];
      };
      set_post_like: { Args: { p_like: boolean; p_post_id: string }; Returns: undefined };
      set_post_saved: { Args: { p_post_id: string; p_saved: boolean }; Returns: undefined };
      set_item_saved: { Args: { p_item_id: string; p_post_id: string; p_saved: boolean }; Returns: undefined };
      add_comment: { Args: { p_body: string; p_parent_id?: string; p_post_id: string }; Returns: string };
      set_comment_like: { Args: { p_comment_id: string; p_like: boolean }; Returns: undefined };
      update_post_caption: { Args: { p_caption: string; p_post_id: string }; Returns: undefined };
      my_activity: {
        Args: { p_before?: string; p_limit?: number };
        Returns: {
          actor_avatar_path: string | null;
          actor_display_name: string;
          actor_handle: string;
          actor_id: string;
          body: string | null;
          created_at: string;
          i_follow_actor: boolean;
          kind: string;
          post_id: string | null;
          post_media_path: string | null;
          post_playback_id: string | null;
        }[];
      };
      my_activity_unread: { Args: Record<string, never>; Returns: number };
      mark_activity_seen: { Args: Record<string, never>; Returns: undefined };
      delete_comment: { Args: { p_comment_id: string }; Returns: undefined };
      list_comments: {
        Args: { p_after_created_at?: string; p_after_id?: string; p_limit?: number; p_post_id: string };
        Returns: {
          author_display_name: string;
          author_handle: string;
          author_id: string;
          body: string;
          can_delete: boolean;
          created_at: string;
          id: string;
          i_liked: boolean;
          like_count: number;
          parent_id: string | null;
        }[];
      };
      my_saved_items: {
        Args: { p_before_created_at?: string; p_limit?: number };
        Returns: {
          brand: string | null;
          currency: string | null;
          is_affiliate: boolean;
          item_id: string;
          photo_path: string | null;
          post_id: string;
          price_cents: number | null;
          saved_at: string;
          store_name: string | null;
          title: string;
          url: string | null;
          url_host: string | null;
        }[];
      };
      list_groups: {
        Args: { p_group_id?: string; p_interest_id?: number; p_mine?: boolean };
        Returns: {
          area_name: string;
          description: string | null;
          id: string;
          interest_id: number;
          member_count: number;
          my_role: string | null;
          my_status: string | null;
          name: string;
          pending_count: number;
          privacy: string;
        }[];
      };
      group_roster: {
        Args: { p_group_id: string };
        Returns: {
          display_name: string;
          handle: string;
          profile_id: string;
          requested_at: string;
          role: string;
          status: string;
        }[];
      };
      create_group: {
        Args: { p_description: string; p_interest_id: number; p_name: string; p_privacy: string };
        Returns: string;
      };
      join_group: { Args: { p_group_id: string }; Returns: string };
      leave_group: { Args: { p_group_id: string }; Returns: undefined };
      respond_to_join_request: {
        Args: { p_approve: boolean; p_group_id: string; p_profile_id: string };
        Returns: undefined;
      };
      remove_group_member: { Args: { p_group_id: string; p_profile_id: string }; Returns: undefined };
      set_group_role: { Args: { p_group_id: string; p_profile_id: string; p_role: string }; Returns: undefined };
      follow_user: { Args: { p_profile_id: string }; Returns: undefined };
      unfollow_user: { Args: { p_profile_id: string }; Returns: undefined };
      profile_summary: {
        Args: { p_profile_id: string };
        Returns: {
          bio: string | null;
          display_name: string;
          follower_count: number;
          following_count: number;
          follows_me: boolean;
          handle: string;
          i_follow: boolean;
          id: string;
          is_me: boolean;
        }[];
      };
      set_dm_policy: { Args: { p_policy: string }; Returns: undefined };
      send_message: {
        Args: { p_body?: string; p_conversation_id?: string; p_shared_post_id?: string; p_to?: string };
        Returns: string;
      };
      respond_to_message_request: { Args: { p_accept: boolean; p_conversation_id: string }; Returns: undefined };
      hide_conversation: { Args: { p_conversation_id: string }; Returns: undefined };
      mark_conversation_read: { Args: { p_conversation_id: string }; Returns: undefined };
      message_status: {
        Args: { p_profile_id: string };
        Returns: { conversation_id: string | null; status: string }[];
      };
      my_conversations: {
        Args: { p_requests?: boolean };
        Returns: {
          awaiting_reply: boolean;
          conversation_id: string;
          last_message: string | null;
          last_message_at: string;
          other_display_name: string;
          other_handle: string;
          other_id: string;
          unread_count: number;
        }[];
      };
      conversation_messages: {
        Args: { p_before_created_at?: string; p_before_id?: string; p_conversation_id: string; p_limit?: number };
        Returns: { body: string | null; created_at: string; id: string; removed: boolean; sender_id: string; shared_post: Json | null }[];
      };
      conversation_summary: {
        Args: { p_conversation_id: string };
        Returns: {
          awaiting_reply: boolean;
          conversation_id: string;
          my_state: string;
          other_display_name: string;
          other_handle: string;
          other_id: string;
        }[];
      };
      set_notification_preferences: {
        Args: { p_comments?: boolean; p_follows?: boolean; p_groups?: boolean; p_messages?: boolean };
        Returns: undefined;
      };
      set_findable_by_email: { Args: { p_findable: boolean }; Returns: undefined };
      set_shopping_default: { Args: { p_enabled: boolean }; Returns: undefined };
      search_people: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          display_name: string;
          follower_count: number;
          follows_me: boolean;
          handle: string;
          i_follow: boolean;
          id: string;
        }[];
      };
      suggested_people: {
        Args: { p_limit?: number };
        Returns: {
          display_name: string;
          handle: string;
          id: string;
          mutual_count: number;
          mutual_name: string | null;
          reason: string;
        }[];
      };
      match_contacts: {
        Args: { p_hashes: string[] };
        Returns: { display_name: string; handle: string; i_follow: boolean; id: string }[];
      };
      register_push_token: { Args: { p_platform: string; p_token: string }; Returns: undefined };
      unregister_push_token: { Args: { p_token: string }; Returns: undefined };
      block_user: { Args: { p_profile_id: string }; Returns: undefined };
      unblock_user: { Args: { p_profile_id: string }; Returns: undefined };
      my_blocked_profiles: {
        Args: Record<string, never>;
        Returns: { blocked_at: string; display_name: string; handle: string; profile_id: string }[];
      };
      report_content: {
        Args: { p_details?: string; p_reason: string; p_target_id: string; p_target_type: string };
        Returns: undefined;
      };
      delete_my_post: { Args: { p_post_id: string }; Returns: undefined };
      nearby_feed: {
        Args: {
          p_before_id?: string;
          p_before_published_at?: string;
          p_group_id?: string;
          p_interest_id?: number;
          p_limit?: number;
        };
        Returns: {
          area_name: string;
          author_display_name: string;
          author_handle: string;
          author_id: string;
          caption: string | null;
          id: string;
          interest_ids: number[];
          media: Json;
          published_at: string;
        }[];
      };
      item_url_host: { Args: { p_url: string }; Returns: string };
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
