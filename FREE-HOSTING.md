# Put your Smart Academy website online for free

The project has two parts, and both can run on Cloudflare's free plans:

| Part | What it is | Where it runs (free) |
|---|---|---|
| **Website + app** | `index.html` (public website), `dashboard.html` and the other pages | Cloudflare Pages |
| **Backend** | `worker/` (API + database) | Cloudflare Workers + D1 |

Your site gets a free address like `https://your-academy.pages.dev`.
(A custom domain such as `youracademy.com` is the only thing that costs money, and it is optional.)

---

## Step 1: Deploy the backend (once)

From the `worker` folder:

```bash
wrangler login
wrangler d1 migrations apply tuition-manager-db --remote
wrangler deploy
```

`wrangler deploy` prints your Worker URL (for example
`https://tuition-manager-api.yourname.workers.dev`). Make sure that same URL is set in
`js/config.js`:

```js
const TM_API_BASE = "https://tuition-manager-api.yourname.workers.dev";
```

## Step 2: Put the website online

### Easiest: drag and drop (no GitHub needed)
1. Create a free account at https://dash.cloudflare.com.
2. Open **Workers & Pages → Create → Pages → Upload assets**.
3. Name the project (this becomes `your-name.pages.dev`).
4. Drag in the project folder contents (the files next to `index.html`: `css`, `js`,
   `icons`, `*.html`, `manifest.json`, `service-worker.js`). You can leave out the
   `worker` folder.
5. Click **Deploy site**. In a minute your website is live.

To publish a change later: open the project, choose **Create new deployment** and upload
the updated files again.

### Automatic updates with GitHub
1. Create a free GitHub account and a new repository, then upload the project.
2. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
3. Leave **Build command** empty and set **Build output directory** to `/`.
4. Every time you push a change, the site updates automatically.

### Alternatives (also free)
- **Netlify**: drag the folder onto https://app.netlify.com/drop.
- **GitHub Pages**: repository **Settings → Pages**, deploy from the main branch.

## Step 3: Check it
- Open your address: you should see the public website.
- Click **Get started free**, create an account, and you land in the dashboard.
- On a phone, open the address and choose **Add to Home Screen** to install it as an app.

## Good to know
- The backend allows requests from any website address, so nothing else needs
  configuring when you move to a new domain.
- Cloudflare's free plans include generous daily limits for Workers and D1, which is
  far more than a typical academy uses. Check Cloudflare's current pricing page if your
  academy becomes very large.
- Do not share your Cloudflare API tokens, and take regular backups from the app's
  Settings page.
