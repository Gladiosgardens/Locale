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
  invalid_comment: 'Comments can be up to 1,000 characters.',
  avatar_failed: 'We couldn’t update your photo. Please try again.',
  invalid_caption: 'Captions can be up to 2,200 characters.',
  comment_not_found: 'That comment is no longer there.',
  story_rate_limited: 'You’ve shared a lot of stories today. Try again tomorrow.',
  invalid_highlight_name: 'Give the highlight a name, up to 30 characters.',
  highlight_limit: 'You can have up to 50 highlights.',
  highlight_full: 'A highlight can hold up to 100 stories.',
  highlight_not_found: 'That highlight is no longer there.',
  too_many_people_tags: 'You can tag up to 20 people in a post.',
  invalid_people_tag: 'That tag couldn’t be placed. Try again.',
  person_not_found: 'You can’t tag that person.',
  collection_exists: 'You already have a collection with that name.',
  invalid_collection_name: 'Give the collection a name, up to 40 characters.',
  collection_limit: 'You can have up to 100 collections.',
  collection_not_found: 'That collection is no longer there.',
  detection_rate_limited: 'You’ve used automatic item finding a lot today. Try again tomorrow, or tag items by hand.',
  detection_not_configured: 'Automatic item finding isn’t set up on the server yet.',
  detection_failed: 'We couldn’t look for items right now. You can tag them by hand.',
  video_too_long: 'Videos can be up to 60 seconds. Trim it in your Photos app, then try again.',
  invalid_video: 'That video couldn’t be used. Try another one.',
  video_processing: 'The video is taking a while to process. Please try posting again in a minute.',
  video_rate_limited: 'You’ve uploaded a lot of videos today. Try again tomorrow.',
  video_not_configured: 'Video isn’t set up on the server yet.',
  comment_rate_limited: 'You’re commenting very fast. Take a short break and try again.',
  like_rate_limited: 'You’ve liked a lot of posts in the last hour. Try again later.',
  item_not_found: 'That item is no longer on the post.',
  save_limit: 'You’ve saved the maximum number of things. Remove some to save more.',
  follow_rate_limited: 'You’ve followed a lot of people today. Try again tomorrow.',
  contacts_rate_limited: 'You’ve checked your contacts several times today. Try again tomorrow.',
  too_many_tags: 'Up to 5 tagged items per photo and 20 per post.',
  invalid_tag: 'One of the tagged items is missing a name or has invalid details.',
  invalid_url: 'Links must start with https:// and point to a real website.',
  shortened_url: 'Please paste the full store link, not a shortened one.',
  query_too_short: 'Type at least 2 letters to search.',
  not_a_member: 'Only group members can do that.',
  not_a_moderator: 'Only the group’s moderators can do that.',
  not_owner: 'Only the group’s owner can do that.',
  owner_cannot_leave: 'Owners can’t leave their own group.',
  banned_from_group: 'You can’t join this group.',
  group_not_found: 'That group isn’t available in your area.',
  group_rate_limited: 'You’ve created 3 groups today. Try again tomorrow.',
  invalid_group: 'Group names are 3–60 characters; descriptions up to 500.',
  cannot_remove: 'You can’t remove that member.',
  request_not_found: 'That request was already handled.',
  member_not_found: 'That person isn’t an active member.',
  cannot_block_self: 'You can’t block yourself.',
  profile_not_found: 'That account no longer exists.',
  report_rate_limited: 'You’ve sent a lot of reports today. Try again tomorrow.',
  report_target_not_found: 'That’s no longer available to report.',
  invalid_report: 'Please choose a reason.',
  cannot_follow_self: 'You can’t follow yourself.',
  empty_message: 'Write something first.',
  message_too_long: 'Messages can be up to 2,000 characters.',
  post_unavailable: 'That post isn’t available to share.',
  message_rate_limited: 'You’re sending messages too fast. Wait a moment.',
  conversation_not_found: 'That conversation isn’t available.',
  cannot_message: 'You can’t message this person.',
  request_rate_limited: 'You’ve started a lot of new conversations today. Try again tomorrow.',
  messages_closed: 'This person only accepts messages from people they’re connected with.',
  awaiting_acceptance: 'You can send more once they accept your message request.',
  invalid_setting: 'That setting isn’t available.',
  invalid_push_token: 'This device couldn’t be registered for notifications.',
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
