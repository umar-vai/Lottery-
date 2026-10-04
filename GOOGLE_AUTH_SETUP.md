# Google Login Setup — DRAW//01

The database, scheduler, realtime draw system, and GitHub Pages frontend are already connected. Google OAuth is the only account-level setup that requires your Google credentials.

## 1. Google Cloud Console

Create an OAuth 2.0 Client ID with application type **Web application**.

Use this exact Authorized redirect URI:

`https://mwtlsnneooxmryondrex.supabase.co/auth/v1/callback`

Copy the generated **Client ID** and **Client Secret**.

## 2. Supabase Google provider

Open Supabase project **Lottery DRAW01** → Authentication → Providers → Google.

Enable Google and paste the Client ID and Client Secret from Google Cloud.

## 3. Supabase URL configuration

Open Authentication → URL Configuration.

Set Site URL to:

`https://umar-vai.github.io/Lottery-/`

Add the same exact URL to Additional Redirect URLs:

`https://umar-vai.github.io/Lottery-/`

## 4. Test

Open:

`https://umar-vai.github.io/Lottery-/`

Click **Continue with Google**. After successful login you should return to the site and be able to submit tickets.

## Security note

Never put the Google Client Secret or a Supabase service-role/secret key in this repository or in browser JavaScript. `config.js` contains only the Supabase project URL and publishable key, which are designed for public frontend use together with RLS.
