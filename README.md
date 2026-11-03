# Locale

A local community app: meet people nearby who share your interests, and shop the things you see in their photos. iOS and Android from one Expo codebase, backed by Supabase. ("Locale" is a placeholder name.)

## Status

Built so far:

1. **Sign-up:** email code → approximate area → interests → profile (18+).
2. **Nearby feed + photo posts:** post 1–10 photos with a caption and up to 3 tags. The feed shows posts from your cell and the 8 around it (~15 km), newest first, filterable by your interests, and you can delete your own posts.

3. **Shoppable items + public discovery:** tag items on photos (name, brand, store, optional link and price, affiliate label). Tap a photo to see its tags, and tap a tag for details and a link that names the real site. An **Everywhere** tab and item search show public posts from anywhere.

4. **Groups:** one interest × the creator's area. Public groups are readable and joinable by anyone nearby. Private groups show only that they exist; posts and members are for approved members. Kid-related groups are always private. Owner, moderators and members, with requests, approvals, removal (which bans) and promotion. Group posts appear only in the group.

5. **Reporting and blocking:** every post has a ••• menu (Delete for yours; Report post, Report person or Block for others), groups can be reported, and Settings lists blocked accounts.

Next up: follows and messaging (core-loop step 6).

## Stack

Expo SDK 58 (Expo Router, TypeScript strict) · TanStack Query · Supabase (Postgres + RLS, Auth, Storage, Edge Functions) · Jest + React Native Testing Library · pgTAP.

```
src/app/              routes (Expo Router): (auth), (onboarding), (app)
src/components/       shared UI
src/features/<name>/  feature modules: api, hooks, helpers
src/lib/              supabase client, generated DB types, errors
supabase/migrations/  SQL migrations (RLS + policies live with their tables)
supabase/functions/   Edge Functions (Deno); _shared/ is plain TS, unit-tested by Jest
supabase/tests/       pgTAP tests for policies and RPCs
supabase/templates/   auth email templates
```

## Setup

1. `npm install`
2. Create a Supabase **dev** project and link it: `npx supabase link --project-ref <ref>`
3. Apply the schema (this also creates the two private storage buckets): `npx supabase db push`
   Deploy the Edge Function: `npx supabase functions deploy publish-post`
4. Sign-in uses a 6-digit code, not a link. In the dashboard, open **Authentication → Emails**. Make the *Magic Link* and *Confirm signup* templates show `{{ .Token }}` (copy `supabase/templates/otp.html`), and set OTP expiry to 600 seconds. Local `supabase start` picks this up from `config.toml` automatically.
5. `cp .env.example .env.local` and fill in the project URL and **anon** key.
6. `npm run db:types` to regenerate `src/lib/database.types.ts` from the real schema. The checked-in file was written by hand because the generator needs Docker.
7. `npx expo start`. Location and the photo picker need a development build (`npx expo run:ios` or `eas build --profile development`).

## Checks

```
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm test            # Jest + RNTL
deno check supabase/functions/publish-post/index.ts
npm run db:test     # pgTAP (supabase test db; needs `supabase start`)
```

## Privacy design (step 1)

- **Location.** The OS location permission is approximate only: reduced accuracy on iOS, and fine location blocked on Android. The phone turns its fix into a ~5 km geohash cell and reverse-geocodes the *cell centre* for a name. Only the cell and name reach Supabase, and the server computes the stored centre itself.
- **Private data.** Area and the 18+ confirmation live in `profile_private`, which is readable only by its owner. Interest choices are owner-only too, so no one can list "people in area X who picked *Toddlers*".
- **Writes go through server functions.** All area, interest and onboarding changes go through `security definer` RPCs. Clients can edit only their own handle, display name and bio.
- **Limits.** Area changes are capped at 5 per 24 hours, and reserved handles (`admin`, `support`, …) are blocked at the database level.

## Photo privacy (step 2)

- **Who can see a post.** Only people whose area is the post's cell or one of the 8 around it, and the author. This rule lives in RLS, so it covers the feed, direct table reads and image downloads alike.
- **Where photos are stored.** Images sit in a private bucket and reach the app as 1-hour signed URLs. Deleting a post makes its images unreadable immediately.
- **Metadata removal.** The phone re-encodes photos, which drops EXIF. The `publish-post` function then strips EXIF/GPS/XMP/IPTC and anything appended to the file at byte level before publishing, so it doesn't rely on the phone.
- **Limits.** 20 posts per 24 hours, 1–10 photos, up to 3 interest tags.

## Public discovery and item links (step 3)

- **Public by default.** Posts appear nearby, in Everywhere and in item search. Authors can switch a post to *Nearby only*.
- **Area stays local.** Viewers outside the area see the photo, items and handle, but not the poster's neighborhood. Everywhere and search go through `discover_posts()`, which decides exactly which fields leave, while the `posts` table itself stays nearby-only.
- **Kid-tagged posts never leave the area.** Posts tagged Toddlers, School-age kids or Parenting teens stay local, and the server enforces this regardless of the switch.
- **Links are checked by the database.** `https` only, a real ASCII host name (so no lookalike Unicode or IP addresses), no `user@host` tricks and no link shorteners, so the domain on the button is where it goes. Affiliate links are labelled.

## Groups (step 4)

- **Who sees what.** Groups are visible to people in the 3×3 area block. A private group's posts, tagged items, images and member list are for active members only, and pending requests are visible only to moderators and the person asking. Nobody outside a group can list who's in it.
- **Group posts stay in the group.** They never appear in Nearby, Everywhere or search, and are never globally searchable (a database constraint).
- **Moderation.** Removing a member bans them from rejoining. Nobody can remove the owner, and only the owner can promote, demote or remove moderators.

## Safety (step 5)

- **Blocking is two-way and silent.** Neither person sees the other's posts, tags, images or profile anywhere (feeds, search, group feeds, direct table reads, storage). The blocked person can't tell they've been blocked.
- **Reports are private** to the reporter and the service role. Each person can report a given thing once, up to 30 reports a day, and only things they can see.
- **Auto-hide pending review.** A post is hidden after one child-safety report or reports from 3 different people. A malicious reporter can wrongly hide a post this way; that trade-off is deliberate.
- **Review.** In the Supabase SQL editor, `select * from moderation_queue;` lists open reports, child-safety first. `select resolve_report('post', '<id>', 'remove' | 'dismiss');` acts on one: dismissing restores a hidden post, removing takes it down.
- **Known limitation.** A moderator who blocks a group member can't see them in the member list to remove them. Unblock, remove, then re-block.

## Before public launch (from the trust reviews)

- **Child-safety reporting process.** US providers have legal obligations when they become aware of apparent child sexual abuse material (reporting to NCMEC's CyberTipline, preserving evidence). Set up the human process, response times and legal review before launch. The `child_safety` reason and the auto-hide are the technical hooks, not the process.
- **A real moderator console** to replace SQL-editor review. It needs reviewer accounts, an audit log, and actions on profiles and groups (today only posts can be taken down).

- **Stronger gates for kids' groups.** Approval is currently the only barrier, and moderators see just a handle and name. Before launch, give moderators more signal (account age, groups in common, reports) and give them guidance; consider verified-parent badges.

- **Image safety scanning.** Hash-match every upload against known child-abuse imagery, via an industry hash-matching service, inside `publish-post` before anything is published. Required for an app with family content and photo uploads.
- **Malicious-link screening.** Check item links against a URL reputation service (e.g. Google Web Risk) in `publish-post`. The current rules stop disguised links, not bad sites.
- **Reporting, blocking and a moderation queue.** Global discovery makes this more urgent. Blocked users must disappear from each other's feeds.
- **Storage cleanup job.** It should purge images of deleted posts and holding uploads older than a day; abandoned uploads currently stay in storage.
- In-app account deletion (an App Store requirement) that removes the profile and the user's storage objects.
- CAPTCHA on sign-in (Supabase Auth supports hCaptcha/Turnstile) and a custom SMTP provider with sensible rate limits.
- The 18+ gate is self-attested; get the age-rating questionnaire and COPPA position reviewed.
- Moderation for area and display names.

## License

No license has been chosen yet; until one is added, all rights are reserved.
