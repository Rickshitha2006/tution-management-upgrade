# Password reset by email (free)

Users who forget their password can request a reset link by email.
This uses **Brevo**'s free plan (300 emails per day, no domain needed) and your
Cloudflare Worker. It takes about 10 minutes, once.

## How it works
1. On the login page the user taps **Forgot password?** and enters their email.
2. The Worker emails a one-time link, valid for 30 minutes. It always shows the same
   message, so nobody can use it to find out which emails have accounts.
3. The link opens `reset-password.html`, where they choose a new password.
4. All their old sessions are signed out, and they get a "password changed" notice.

Security built in: only a hash of the link token is stored, links work once, each
account can request at most 3 emails per hour, and the link address always comes from
your own `APP_URL` setting (it can never be changed by a visitor).

## Setup

### 1. Create a free Brevo account and verify a sender
1. Sign up at https://www.brevo.com (free plan).
2. Go to **Senders, Domains & Dedicated IPs → Senders → Add a sender**.
3. Enter the email address you want reset emails to come from (a Gmail address works) and
   click the verification link Brevo sends to it.

### 2. Create an API key
**SMTP & API → API Keys → Generate a new API key.** Copy it.

### 3. Tell the Worker (from the `worker` folder)
Open `wrangler.toml` and fill in the three values at the bottom:

```toml
[vars]
APP_URL = "https://your-academy.pages.dev"   # your website address, no trailing slash
MAIL_FROM_EMAIL = "you@gmail.com"            # the sender you verified in Brevo
MAIL_FROM_NAME = "Smart Academy System"
```

Store the API key as a **secret** (it is never written in any file):

```bash
wrangler secret put BREVO_API_KEY
```
Paste the key when asked, then apply the new database table and deploy:

```bash
wrangler d1 migrations apply tuition-manager-db --remote
wrangler deploy
```

### 4. Test it
Open the login page, tap **Forgot password?**, enter your email, and check your inbox
(and spam folder the first time).

## Good to know
- Until `APP_URL`, `MAIL_FROM_EMAIL` and `BREVO_API_KEY` are set, the forgot-password
  form shows "Password reset email is not set up yet".
- For local testing, leave `APP_URL` empty: links are built from `http://localhost:...`.
- Emails sent from a free Gmail address may land in spam at first. Marking one as "Not
  spam" helps. A custom domain gives better delivery but is optional and not free.
- Cloudflare's own email-sending service is another option if you prefer to keep
  everything in one place, but Brevo's free plan needs no domain.
