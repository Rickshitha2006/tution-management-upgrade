# Password recovery with a recovery code (no email needed)

## What it is
When someone creates an account, the app shows a **recovery code** such as
`K7QM-4TXP-92WD-HFN8` and tells them:

- If you forget your password, use this one code to create a new password.
- If you lose this code, you cannot reset your password and your account will be lost.

They must tick "I have saved my recovery code" before they can continue.

## How a user resets a forgotten password
1. Login page → **Forgot password?**
2. Type their email, the recovery code (capital or small letters both work), and a new password.
3. The app shows a **new** recovery code (the old one stops working). They save it again.
4. They log in with the new password. They are signed out on all other devices.

Wrong guesses are limited: after 8 wrong tries that email is locked for 15 minutes.

## Accounts created before this update
They have no code yet. After logging in: **Settings → Recovery Code → enter your password →
Create my recovery code**. Do this once now, and tell your existing users to do the same.

## Putting the update online (about 5 minutes)
1. Open a terminal in the `worker` folder and add the new database columns:
   ```bash
   npx wrangler d1 migrations apply tuition-manager-db --remote
   ```
   (This applies `0006_recovery_code.sql`. It only adds things; no existing data changes.)
2. Publish the Worker:
   ```bash
   npx wrangler deploy
   ```
3. Upload the website files again (the whole project folder to your Pages / GitHub).
   New file: `js/recovery.js`. Changed: `login.html`, `settings.html`, `js/db.js`,
   `js/settings.js`, `css/style.css`, `service-worker.js`.
4. Open the site, press Ctrl+Shift+R once (or close and reopen the installed app) so the
   browser picks up the new files.

## Security notes
- The server stores only a **hash** of the code, never the code itself.
- The code has 80 bits of randomness, so it cannot be guessed.
- A code only works for its own account, and each code works once.
- Creating a new code in Settings needs your current password.
- The email reset link (see `EMAIL-SETUP.md`) is optional. If you set it up later, the
  login page automatically offers both.

## Running the automated tests
```bash
cd worker
npm test        # needs Node 22.5 or newer; installs nothing
```
