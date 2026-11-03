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
