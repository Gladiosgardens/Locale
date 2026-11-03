// Maps server error codes raised by our RPCs to user-facing text.
const MESSAGES: Record<string, string> = {
  handle_taken: 'That handle is taken. Try another.',
  invalid_profile: "That handle isn't allowed. Use 3–20 lowercase letters, numbers or underscores.",
  adult_required: 'You need to confirm you are 18 or older.',
  area_required: 'Set your area first.',
  interest_count: 'Pick between 3 and 15 interests.',
  unknown_interest: 'One of those interests is no longer available.',
  invalid_geohash: "We couldn't read your location. Pick your area from the list instead.",
  invalid_area_name: "We couldn't name your area. Pick it from the list instead.",
  area_not_found: 'That area no longer exists.',
  area_rate_limited: "You've changed your area several times today. Try again tomorrow.",
  not_authenticated: 'Your session expired. Sign in again.',
  post_rate_limited: "You've reached today's posting limit. Try again tomorrow.",
  invalid_image: "One of those photos couldn't be processed. Try a different one.",
  upload_missing: "A photo didn't finish uploading. Please try again.",
  media_count: 'Add between 1 and 10 photos.',
  too_many_interests: 'Pick up to 3 interests for a post.',
  not_onboarded: 'Finish setting up your profile first.',
  post_not_found: 'That post is already gone.',
  too_many_tags: 'Up to 5 tagged items per photo and 20 per post.',
  invalid_tag: 'One of the tagged items is missing a name or has invalid details.',
  invalid_url: 'Links must start with https:// and point to a real website.',
  shortened_url: 'Please paste the full store link, not a shortened one.',
  query_too_short: 'Type at least 2 letters to search.',
  publish_failed: "We couldn't publish your post. Please try again.",
};

export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message;
  if (message && MESSAGES[message]) return MESSAGES[message];
  return 'Something went wrong. Please try again.';
}

// supabase-js returns { data, error }; turn that into a thrown Error for TanStack Query.
export function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

// For RPCs that return nothing.
export function check(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}
