# St. Jude Music Ministry Volunteer Accounts

A responsive volunteer portal for individuals and whole families, backed by Supabase.

## Included

- Secure email/password login without paid SMS services
- User-created and editable personal Volunteer IDs
- One household account with individual adult and child profiles
- Multiple email addresses and phone numbers on one account
- Required phone-number explanation and communication consent
- Household-wide sign-up tracking
- Personalized volunteer opportunity suggestions
- Responsive desktop and mobile layouts
- Supabase authentication, database storage, and Row Level Security

## Preview

Serve the folder with a static web server, then select **Preview a sample account** to explore the dashboard or create a live account.

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Live data and authentication

- A phone number is required for account validation and volunteer-related communications.
- One household login manages any number of adult and child profiles.
- Every family member chooses a unique Volunteer ID.
- Multiple email addresses and phone numbers may be attached to one household.
- Row Level Security keeps each household's members, contacts, and sign-ups private.

The browser-safe project URL and publishable key are in `config.js`. Never add a database password or `service_role` key to this repository. The database definition is documented in `supabase/schema.sql`.

## Free-only perimeter

This build uses services that can operate at $0/month: GitHub Pages (or Cloudflare Pages) and Supabase Free. Phone numbers are not used for automated SMS because that requires a paid provider. Do not enable a paid Supabase plan or paid messaging service without explicit approval.
