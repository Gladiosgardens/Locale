# Locale

A fashion and design social app: post outfits and rooms, tag every piece, and let people shop what they see. iOS and Android from one Expo codebase, backed by Supabase. ("Locale" is a placeholder name.)

The app started as a local community app. The local features (areas, the Nearby feed, groups) are still in the code and the database, switched off with `LOCAL_FEATURES` in `src/lib/features.ts`.

## Status

Built so far:

1. **Sign-up:** email code → approximate area → interests → profile (18+).
2. **Nearby feed + photo posts:** post 1–10 photos with a caption and up to 3 tags. The feed shows posts from your cell and the 8 around it (~15 km), newest first, filterable by your interests, and you can delete your own posts.

3. **Shoppable items + public discovery:** tag items on photos (name, brand, store, optional link and price, affiliate label). Tap a photo to see its tags, and tap a tag for details and a link that names the real site. An **Everywhere** tab and item search show public posts from anywhere.

4. **Groups:** one interest × the creator's area. Public groups are readable and joinable by anyone nearby. Private groups show only that they exist; posts and members are for approved members. Kid-related groups are always private. Owner, moderators and members, with requests, approvals, removal (which bans) and promotion. Group posts appear only in the group.

5. **Reporting and blocking:** every post has a ••• menu (Delete for yours; Report post, Report person or Block for others), groups can be reported, and Settings lists blocked accounts.

6. **Follows and messaging:** open follows, a **Following** tab and profile pages. One-to-one messages with text and shared posts, where strangers' first messages arrive as **requests**, plus a "who can message me" setting.

7. **Push notifications:** new messages, message requests, group join requests (to moderators) and approvals. Notifications never contain message text. Settings has an on/off switch per category, and tapping a notification opens the conversation or group.

8. **Global fashion mode and redesign:** no area step at sign-up; fashion and design interests (the local and kids ones are retired, not deleted); bottom tabs (Home, Explore, New post, Messages, Profile). Home has **For you** and **Following**. Explore is a two-column photo grid with item search. Profiles are three-column grids, and a single post has its own page. Under each post, a **Shop the look** strip shows its tagged items as hang tags. The look: black and white with one ultramarine accent for anything shoppable, Bodoni Moda for names and headings, Instrument Sans for everything else.

9. **Everyday posts and finding friends:** everyday topics (food, travel, pets, fitness, music and more) sit next to the style ones, so anyone can post anything and tag what's in it. Follows stay open. **Find friends** (from Profile, Home and Explore) has:
   - search by name or @username, also shown in Explore results;
   - **Suggested for you**: people who follow you, friends of friends, popular accounts, then new people;
   - **Invite friends**: shares a `locale://u/<handle>` link (set `EXPO_PUBLIC_WEB_URL` once there are web pages, so links work without the app);
   - **Your QR code**: friends scan it with their camera to open your profile;
   - **Contacts**: the phone hashes its contacts' email addresses (SHA-256) and sends only the hashes, which are matched against accounts and not stored. Limited to 5 checks a day, and anyone can opt out in Settings → Finding you.
   New followers get a push notification (with its own switch in Settings).

10. **Topics for everyone and a personal For you feed:** new topics where people shop from photos (Tech & gadgets, Phones, Audio, Desk & gaming setups, Gaming, Smart home, Motorcycles, Watches, Grooming, Fragrance, Outdoor & camping gear, Grilling & BBQ, DIY & tools), grouped into sections (Style, Home, Tech & cars, Food & drink, Active & outdoors, Everyday) at sign-up and in the composer. Nobody is asked their gender. **For you** ranks posts in your topics (+36 hours) and from people you follow (+24 hours) above other recent posts; with no topics or follows it is newest first. The strip under a post says "Shop the look" for style posts and "Shop this" for everything else.

11. **Share to Stories (Instagram, Snapchat, TikTok, Facebook):** a share icon on every post (and an item in its menu) makes a 1080x1920 story image (the photo with numbered dots, up to three tagged pieces with prices, the Locale wordmark and the poster's @handle, kept clear of Instagram's reply bar) and opens the phone's share sheet, which lists Instagram, Snapchat, TikTok, Facebook and any other app that takes photos. Opening one app directly, skipping the share sheet, needs that company's developer kit and app ID (Meta, Snap Creative Kit, TikTok Share Kit); link stickers need the public web pages (next step).

12. **Likes, comments and saves:** a heart, comment, share and bookmark row under every post, with like counts and "View all N comments". Comments are flat, up to 1,000 characters; the commenter or the post's author can delete one, and others can report it (one child-safety report or three reporters hide it pending review). The bookmark saves a post; **Save to wishlist** in an item's sheet saves that item. Both appear in **Saved** (bookmark icon on your profile). The post's author gets a push for new comments (switch in Settings). Who liked a post is not listed, only the count.

Before a public launch, work through the list at the bottom of this file.

### Updating an existing install to step 12

`git pull`, `npx supabase db push --remote`, then `npx supabase functions deploy deliver-notifications` (comment notifications). No new build needed beyond step 11's.

### Updating an existing install to step 11

`git pull`, `npm install`, then a new development build (image capture and sharing are native code). No database changes.

### Updating an existing install to step 10

`git pull`, then `npx supabase db push --remote`. No new build is needed if you already made the step 9 build.

### Updating an existing install to step 9

1. `git pull` and `npm install`.
2. `npx supabase db push --remote` applies the new migrations.
3. `npx supabase functions deploy deliver-notifications` (new-follower notifications).
4. Make a new development build, since step 9 adds contacts access (native code): `npx eas-cli@latest build --profile development --platform android`.

### Updating an existing install to step 8

1. `git pull` and `npm install` (new packages: fonts, icons, haptics).
2. `npx supabase db push --remote` applies `20261105100000_global_mode.sql`.
3. Make a new development build (`npx eas-cli@latest build --profile development --platform android`), because the new packages include native code. Install it over the old app.

## Stack

Expo SDK 58 (Expo Router, TypeScript strict) · TanStack Query · Supabase (Postgres + RLS, Auth, Storage, Edge Functions) · Jest + React Native Testing Library · pgTAP.

```
src/app/              routes (Expo Router): (auth), (onboarding), (app)
src/components/       shared UI
src/theme.ts          design tokens (colours, fonts, type scale, spacing)
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
3. Apply the schema (this also creates the two private storage buckets): `npx supabase db push --remote` (without `--remote`, newer CLIs target a local Docker database)
   Deploy the Edge Function: `npx supabase functions deploy publish-post`
4. Sign-in uses a 6-digit code, not a link. In the dashboard, open **Authentication → Emails**. Make the *Magic Link* and *Confirm signup* templates show `{{ .Token }}` (copy `supabase/templates/otp.html`), and set OTP expiry to 600 seconds. Local `supabase start` picks this up from `config.toml` automatically.
5. `cp .env.example .env.local` and fill in the project URL and **anon** key.
6. `npm run db:types` to regenerate `src/lib/database.types.ts` from the real schema. The checked-in file was written by hand because the generator needs Docker.
7. **Development build** (location, photos and notifications need one; Expo Go won't work). Run `npx eas-cli@latest build --profile development --platform android`, which builds in Expo's cloud and gives you an APK to install on an Android phone. iOS needs a paid Apple Developer account.
8. `npx expo start --dev-client`, then open the Locale app on the phone. Phone and Mac must be on the same Wi-Fi.

## Test builds for other people

Testers' builds run without your Mac, so the app's two public settings must live in EAS (they are not secret; never add the service-role key):

```
npx eas-cli@27.4.1 env:create --environment preview --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR-REF.supabase.co --visibility plaintext
npx eas-cli@27.4.1 env:create --environment preview --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value YOUR-ANON-KEY --visibility plaintext
```

- **Android:** `npx eas-cli@27.4.1 build --profile preview --platform android` makes an installable APK with a link to share. Testers allow "install unknown apps" once. Google Play internal testing ($25 one-time developer account) comes later.
- **iPhone:** needs an Apple Developer account ($99/year). Then `npx eas-cli@27.4.1 build --profile production --platform ios` and `npx eas-cli@27.4.1 submit --platform ios` put it in TestFlight, where you invite testers by email.

## Checks

```
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm test            # Jest + RNTL
deno check supabase/functions/publish-post/index.ts supabase/functions/deliver-notifications/index.ts
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

## Follows and messaging (step 6)

- **Follows are open.** Profiles show counts but never follower or following lists, so nobody can scrape someone's graph. The Following feed and profile post lists go through `discover_posts()`, so nearby-only and kid-tagged posts stay local and far viewers never see an area.
- **Connections message freely.** That means mutual follows, or members of the same group.
- **Strangers send one request.** Anyone else's first message lands in Requests, and the sender can't send another until it's accepted (replying accepts). Deleting a request is silent: the sender keeps seeing "Request sent". Settings → *Who can message me* → *Connections only* turns stranger requests off entirely.
- **Limits:** 20 new conversations a day and 30 messages a minute.
- **Blocks** hide the conversation and stop messaging both ways.
- **Shared posts respect visibility.** A kid-tagged or nearby-only post shared with someone who can't see it shows as "Post unavailable", image included.
- **Reporting a message** (long-press) copies that one message into the report for reviewers. `resolve_report('message', id, 'remove')` clears it.
- **Live delivery** uses Supabase Realtime on `messages`; RLS decides who receives each insert. The migration adds the table to the `supabase_realtime` publication. The app polls every 20 s as a fallback.

## Push notifications (step 7)

**How it works.** Database triggers write to a `notifications` outbox, keeping the rules in tested SQL: blocks, per-category preferences, declined requests, who moderates. While one notification for a conversation or group is unsent, more events don't add more. The `deliver-notifications` Edge Function claims rows, sends them through Expo's push service in batches of 100, removes tokens Expo reports as dead, and marks rows sent. A failed send is retried after 5 minutes. Sent rows are pruned after 7 days.

**Privacy.** A push carries only who and what kind of event ("Ben sent you a message", "New message request"), never message text. Push content passes through Apple and Google and shows on lock screens. The app asks for permission from a card in Messages or from Settings, never at launch, and signing out removes the device's token.

### One-time setup

1. **EAS project id** ✅ already set in `app.json` (`extra.eas.projectId`). Running `npx eas-cli@latest init` later will link to this same project.
2. **Device credentials.**
   - iOS needs a paid Apple Developer account; `npx eas-cli build --profile development --platform ios` offers to create the push key.
   - Android needs a Firebase project, with its FCM service-account key uploaded via `npx eas-cli credentials`.
3. **Secret and deploy.**
   ```bash
   npx supabase secrets set NOTIFY_SECRET=$(openssl rand -hex 32)   # note the value
   npx supabase functions deploy deliver-notifications --no-verify-jwt
   ```
   Optionally, also set `EXPO_ACCESS_TOKEN` if you turn on Expo's enhanced push security.
4. **Webhook, for instant delivery.** In the dashboard, go to **Database → Webhooks → Create** (labels may differ slightly). Use table `public.notifications`, event *Insert*, type *Supabase Edge Function* → `deliver-notifications`, method POST, and add the header `x-notify-secret: <your secret>`.
5. **Cron, as a safety net.** Enable the `pg_cron` and `pg_net` extensions, then run in the SQL editor:
   ```sql
   select vault.create_secret('<your secret>', 'notify_secret');
   select cron.schedule('deliver-notifications', '* * * * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/deliver-notifications',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret',
         (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret')),
       body := '{}'::jsonb);
   $$);
   ```

**Not yet done.** Expo push *receipts*, a second check minutes after sending that catches a few more dead tokens, aren't polled. Unread badges on the app icon aren't set.

## Before public launch (from the trust reviews)

- **Production email sender.** Replace the testing Gmail SMTP with a sending service on your own domain, with SPF/DKIM set up, so sign-in codes don't land in spam.

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
- **Contacts matching disclosures.** Describe it in the privacy policy and in the App Store / Play data-safety forms (hashed emails, not stored). Email hashes can be guessed for common addresses, so keep the daily limit and the opt-out.

## License

No license has been chosen yet; until one is added, all rights are reserved.
