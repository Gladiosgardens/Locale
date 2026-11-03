# Locale

A local community app: meet people nearby who share your interests, and shop the things you see in their photos. iOS and Android from one Expo codebase, backed by Supabase. ("Locale" is a placeholder name.)

## Status

Core-loop step 1 is built: **email-code sign-in → approximate area → interests → profile (18+) → home**. The feed is next.

## Stack

Expo SDK 58 (Expo Router, TypeScript strict) · TanStack Query · Supabase (Postgres + RLS, Auth) · Jest + React Native Testing Library · pgTAP.

```
src/app/              routes (Expo Router): (auth), (onboarding), (app)
src/components/       shared UI
src/features/<name>/  feature modules: api, hooks, helpers
src/lib/              supabase client, generated DB types, errors
supabase/migrations/  SQL migrations (RLS + policies live with their tables)
supabase/tests/       pgTAP tests for policies and RPCs
supabase/templates/   auth email templates
```

## Setup

1. `npm install`
2. Create a Supabase **dev** project and link it: `npx supabase link --project-ref <ref>`
3. Apply the schema: `npx supabase db push`
4. Sign-in uses a 6-digit code, not a link. In the dashboard, open **Authentication → Emails**. Make the *Magic Link* and *Confirm signup* templates show `{{ .Token }}` (copy `supabase/templates/otp.html`), and set OTP expiry to 600 seconds. Local `supabase start` picks this up from `config.toml` automatically.
5. `cp .env.example .env.local` and fill in the project URL and **anon** key.
6. `npm run db:types` to regenerate `src/lib/database.types.ts` from the real schema. The checked-in file was written by hand because the generator needs Docker.
7. `npx expo start`. Location permission needs a development build (`npx expo run:ios` or `eas build --profile development`).

## Checks

```
npm run typecheck   # tsc --noEmit
npm test            # Jest + RNTL
npm run db:test     # pgTAP (supabase test db; needs `supabase start`)
```

## Privacy design (step 1)

- **Location.** The OS location permission is approximate only: reduced accuracy on iOS, and fine location blocked on Android. The phone turns its fix into a ~5 km geohash cell and reverse-geocodes the *cell centre* for a name. Only the cell and name reach Supabase, and the server computes the stored centre itself.
- **Private data.** Area and the 18+ confirmation live in `profile_private`, which is readable only by its owner. Interest choices are owner-only too, so no one can list "people in area X who picked *Toddlers*".
- **Writes go through server functions.** All area, interest and onboarding changes go through `security definer` RPCs. Clients can edit only their own handle, display name and bio.
- **Limits.** Area changes are capped at 5 per 24 hours, and reserved handles (`admin`, `support`, …) are blocked at the database level.

## Before public launch (from the trust review)

- In-app account deletion (an App Store requirement) that removes the profile and the user's storage objects.
- CAPTCHA on sign-in (Supabase Auth supports hCaptcha/Turnstile) and a custom SMTP provider with sensible rate limits.
- The 18+ gate is self-attested; get the age-rating questionnaire and COPPA position reviewed.
- Moderation for area and display names.

## License

No license has been chosen yet; until one is added, all rights are reserved.
