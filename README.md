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

13. **Short videos (Mux):** a post can be one video of up to 60 seconds instead of photos. The phone uploads straight to Mux with a one-time URL from `create-video-upload` (20 a day per person); the app polls `video-status` until Mux has processed it, then `publish-post` re-checks it with Mux (uploaded by this person, ready, at most 60 s) before `create_post_record` attaches it. Items are tagged on the video's poster frame and listed in the "Shop this" strip (no dots on moving video). In feeds, the video on screen plays muted on a loop; tap for sound. Grids show a play icon. Mux credentials are Supabase secrets: `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`.

14. **Automatic item detection:** in the tagging screen, **Find items automatically** sends the photo to `detect-items`, which asks an Anthropic vision model for the shoppable items it sees (never people) and looks each up with Google Lens through SerpApi (photo plus a search phrase), plus one lookup of the whole photo, whose shops go to the main item if its own lookup found none (up to 6 SerpApi searches per detection). The poster picks a match, tags it by name without a link, or ignores it; nothing is tagged without their choice. A photo uploaded for detection is reused when publishing. Viewers get **Find similar online** in an item's sheet (`similar-items`, cached for a week). Limits: 30 detections and 40 new similar lookups per person per day. **Show shopping on this post** (default in Settings → Shopping) turns off tags, links and detection for a post. Secrets: `ANTHROPIC_API_KEY`, `SERPAPI_KEY`, optional `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). In development builds the tagging screen shows why a detection or shop lookup failed (for example `serpapi 401: Invalid API key` means `SERPAPI_KEY` is wrong).

15. **Profile photos, edit profile, activity, replies:** **Edit profile** (on your profile) changes your photo, name, username and bio. Profile photos go through `set-avatar`, which re-encodes the JPEG (stripping location and other metadata) into a public `avatars` bucket and deletes the previous one; photos show next to names everywhere. The heart on Home opens **Activity**: likes, comments, replies and new followers, with a badge for what's new since you last looked. Comments can be liked and replied to (one level deep; replying to a reply joins that thread), and the comment's author gets a push for replies. Your own posts have **Edit caption** in their ••• menu.

16. **People tags, @mentions, #hashtags and collections:** in the composer, **Tag people** on any photo: tap where someone is and pick them (up to 20 per post). Tagged people get a notification, show up as labels when you tap the photo and in a "With @…" line under the post, and the post appears on their profile's **Tagged** tab; they can take themselves off it from the ••• menu. Typing **@** in a caption or comment suggests people; mentions are tappable and notify the person (up to 10 per text; never yourself or anyone with a block). **#hashtags** in captions are tappable and open a page of posts with that tag; searching a single word in Explore offers its hashtag too. **Collections**: ••• → **Save to collection** (adding also saves the post), and Saved → Posts shows them as chips; long-press one to rename or delete it. Settings has a **Mentions and photo tags** push switch, and Activity shows mentions and tags.

17. **Stories with shoppable tags, and highlights:** the row of circles at the top of Home shows your story and the stories of people you follow (a black ring means something new, grey means seen). **+** opens **New story**: one photo or video (up to 60 s), an optional line of text, and item tags, with **Find items automatically** as in posts. A story lasts 24 hours and never appears in feeds, grids, search or hashtag pages. In the viewer, tap right for the next story and left for the previous one, hold to pause; tagged items show as blue dots and a **Shop this** button. Your own stories show **Seen by N** (who viewed them) and a menu with **Add to highlight** and **Delete story**. Highlights sit under your bio and keep stories past their 24 hours. A profile's photo has a ring when that person has a live story. Stories go through `publish-post` (`story: true`), so photos are cleaned the same way; limits are 30 stories a day (separate from 20 posts), 200 characters of text, 50 highlights of up to 100 stories. Mentions in stories don't notify, and people can't be tagged in stories yet.

18. **Creator stats (Insights):** the chart icon on your profile opens **Insights** for the last 7, 30 or 90 days: accounts reached, new followers, item views and taps to shops (in ultramarine), likes, comments and saves, plus your top posts. **View insights** in a post's ••• menu breaks one post down: reach, views, likes, comments, saves, and for each tagged item how many people viewed it, tapped through to the shop and saved it to a wishlist. Stories with items have **Item insights** in their menu. The app records a view when 60% of a post is on screen (batched every few seconds, once per post per session) and an item event when someone opens an item or taps its shop link. Repeat views and taps within 10 minutes count once, authors' own views and taps never count, and only the author sees the numbers; nobody is listed.

19. **Creator earnings (built, switched off until accounts exist):** anyone can earn **70%** of the affiliate commission when someone buys through an item they tagged. Tapping **Shop on …** goes through `shop-link`, which records the tap (`affiliate_clicks`) and returns the network's tracked link with our click id as the custom ID; the item sheet says "the poster and Locale may earn a commission". Sales come in through `import-commissions` (from the network's CSV export with `scripts/import-commissions.mjs`, or its API later) and are credited by `import_commission`: buying through your own post, and links the poster marked as their own affiliate links, aren't credited. A sale is *pending* until the network locks it after the store's return window, then *available*. On the 1st of each month `run-payouts` pays everyone with at least **$25** available and a ready Stripe account by Stripe transfer; a sale returned after payout is taken out of the next one. Creators set up payouts from **Earnings** (Insights card, or Settings → Earnings and payouts) with Stripe Connect Express in any country Stripe can pay, see sales and payouts, and open Stripe's dashboard for bank and tax details. Post insights show sales and earnings per post. Until `AFFILIATE_LINK_TEMPLATE` is set, links open untracked; until `STRIPE_SECRET_KEY` is set, payout setup says payouts aren't on.

20. **Earnings notifications:** a push when someone buys through your post ("Your first sale on Locale!" the first time; later sales on the same post add up into one push), when a payout is sent, and a weekly "You earned $X this week" summary. They open Earnings, and Settings has a **Sales and payouts** switch. The weekly summary runs from pg_cron: `select cron.schedule('weekly-earnings', '0 17 * * 1', $$select public.weekly_earnings_digest()$$);` (Mondays 17:00 UTC; delivery goes through the notifications webhook as usual).

21. **"Where's this from?":** in the composer, **Ask "Where's this from?"** marks a post as asking. It shows a blue "Where's this from?" pill (with the answer count) that opens the answers page, and Explore has **Help find**, a feed of posts still asking. Anyone who can see the post suggests an answer (what it is, a link and/or store, optional price and note; links follow the same rules as tags; up to 3 per person per post, 30 a day). The poster hears about new answers, and **Add to post** turns one into a tagged item *created by the answerer*, so shop taps on it credit the answerer's earnings (shop links now credit whoever created the item). The answerer is notified. **Found it: stop asking** ends the request.

Before a public launch, work through the list at the bottom of this file.

### Going live with earnings

1. **Website on your own domain** (affiliate networks require one), with Privacy Policy and Terms that cover commissions, payouts and the creator rules above.
2. **Affiliate network:** get approved by Sovrn Commerce and/or Skimlinks, then set the link template from their link-wrapping docs, with `{url}` for the destination and `{sub}` for our click id in their custom/sub-ID parameter:
   `npx supabase secrets set AFFILIATE_LINK_TEMPLATE='https://…{url}…{sub}'`
3. **Stripe:** create a Stripe account for your US business, turn on **Connect** (Express accounts, cross-border payouts, and 1099 tax reporting in the Connect settings), then `npx supabase secrets set STRIPE_SECRET_KEY=sk_live_…` (use `sk_test_…` first). Keep enough balance in Stripe to cover payouts (commissions arrive from the network to your bank; move funds to Stripe before the 1st).
4. **Secrets for the jobs:** `npx supabase secrets set IMPORT_SECRET=$(openssl rand -hex 32) PAYOUT_SECRET=$(openssl rand -hex 32)` (note both values).
5. **Deploy:**
   ```
   npx supabase db push --remote
   npx supabase functions deploy shop-link
   npx supabase functions deploy stripe-connect
   npx supabase functions deploy stripe-return --no-verify-jwt
   npx supabase functions deploy import-commissions --no-verify-jwt
   npx supabase functions deploy run-payouts --no-verify-jwt
   ```
6. **Import sales** at least weekly: export the network's commission report as CSV, then
   `SUPABASE_URL=https://REF.supabase.co IMPORT_SECRET=… node scripts/import-commissions.mjs --network sovrn --file report.csv --id "<transaction id column>" --sub "<custom id column>" --commission "<commission column>" --sale "<order value column>" --currency "<currency column>" --status "<status column>" --date "<date column>"`
7. **Monthly payouts:** schedule with pg_cron on the 1st (after importing the latest sales):
   ```sql
   select vault.create_secret('<PAYOUT_SECRET>', 'payout_secret');
   select cron.schedule('run-payouts', '0 15 1 * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/run-payouts',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-payout-secret',
         (select decrypted_secret from vault.decrypted_secrets where name = 'payout_secret')),
       body := '{}'::jsonb);
   $$);
   ```

### Updating an existing install to step 21

```
git pull && npm install
npx supabase db push --remote
npx supabase functions deploy publish-post
npx supabase functions deploy deliver-notifications
```

No new build.

### Updating an existing install to step 20

```
git pull && npm install
npx supabase db push --remote
npx supabase functions deploy deliver-notifications
```

Then schedule the weekly summary (SQL above). No new build.

### Updating an existing install to step 19

```
git pull && npm install
npx supabase db push --remote
npx supabase functions deploy shop-link
```

The rest of the earnings setup waits for the accounts above. No new build is needed.

### Updating an existing install to step 18

```
git pull && npm install
npx supabase db push --remote
```

No functions to deploy and no new build; restart with `npx expo start -c`.

### Updating an existing install to step 17

```
git pull && npm install
npx supabase db push --remote
npx supabase functions deploy publish-post
```

No new build is needed; restart the dev server with `npx expo start --dev-client --clear`.

### Updating an existing install to step 16

```
git pull && npm install
npx supabase db push --remote
npx supabase functions deploy deliver-notifications
```

No new build is needed; restart the dev server with `npx expo start --dev-client --clear`.

### Updating an existing install to step 15

```
git pull && npm install
npx supabase db push --remote
npx supabase functions deploy set-avatar
npx supabase functions deploy deliver-notifications
```

No new build is needed; restart the dev server with `npx expo start --dev-client --clear`.

### Updating an existing install to step 14

```
git pull && npm install
npx supabase secrets set ANTHROPIC_API_KEY=... SERPAPI_KEY=...
npx supabase db push --remote
npx supabase functions deploy detect-items
npx supabase functions deploy similar-items
npx supabase functions deploy publish-post
```

No new build is needed beyond step 13's.

### Updating an existing install to step 13

```
git pull && npm install
npx supabase db push --remote
npx supabase functions deploy create-video-upload
npx supabase functions deploy video-status
npx supabase functions deploy publish-post
npx eas-cli@27.4.1 build --profile development --platform android
```

A new build is needed: video playback is native code.

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
- **Unused uploads.** Photos uploaded for detection but never posted stay in `post-uploads`; add a daily cleanup of files older than a day.
- **Automatic results are third-party data.** SerpApi reads Google's results; review its terms and the Legal Shield plan before relying on it at scale, and disclose "found automatically" (the app already labels similar items).
- **Video privacy and moderation.** Switch Mux playback to signed URLs (tokens issued only for posts the viewer may see), delete the Mux asset when a post is deleted or removed, and scan videos for illegal content (the same requirement as photos) before they go public.
- **Profile photo moderation.** Profile photos are public (anyone with the link can load them) and not yet scanned; include them in image safety scanning and let people report a profile photo.
- **Mention and tag spam.** Mentions are capped at 10 per caption or comment and tags at 20 per post, but there's no daily limit per person yet; add one (and let people limit tags to people they follow) before growth.
- **Expired stories.** Stories past 24 hours that aren't in a highlight stay in storage (the author can still open them). Add an archive screen, or a daily job that deletes them after a set time.
- **Stats disclosure.** Say in the privacy policy that views and item taps are recorded and shown to posters as totals (never who), and prune `post_views` and `item_events` older than 90 days.
- **Earnings before going live.** Have a lawyer review the creator terms, payout and clawback rules; confirm Stripe Connect's 1099 reporting is on; add automatic sync from the network's reporting API once approved (replacing CSV imports); flag unusual patterns (many sales from one buyer, new accounts with big earnings) before payouts; and make account deletion keep payout records (payouts block deleting a profile today).
- **Contacts matching disclosures.** Describe it in the privacy policy and in the App Store / Play data-safety forms (hashed emails, not stored). Email hashes can be guessed for common addresses, so keep the daily limit and the opt-out.

## License

No license has been chosen yet; until one is added, all rights are reserved.
