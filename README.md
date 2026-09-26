# Fun3ds v2 — setup guide

A rebuild of the Fun3ds storefront: product catalog with live stock, Google/
email sign-in, embedded Stripe checkout, custom print requests (MakerWorld
link or dog photo), an admin dashboard, and auto-send-to-FlowQ on paid/
accepted orders.

## What's real vs. what needs your input

Every screen, form, Firestore read/write, and Cloud Function here is fully
wired and functional. The things only you can fill in:

- Your Firebase project's config keys
- Your Stripe publishable + secret keys and webhook secret
- Your admin email (three places — see below)
- Your FlowQ Cloudflare Worker proxy URL
- Real product photos (image URLs) and starting stock

**No Firebase Storage.** Storage now requires a billing account attached
regardless of usage, so dog-print photos skip it entirely: the browser
resizes/compresses the photo with a canvas and stores it as a base64 string
directly on the Firestore request document. Firestore documents cap out at
~1 MiB, so photos are capped there too — plenty for a reference photo, not
for anything you'd print at full resolution yourself.

One honest limitation: **"auto-send to FlowQ" only works once a file
actually exists.** For catalog products, that's the FlowQ file ID you set in
admin — paid orders send automatically. For a custom request (a MakerWorld
link, or a dog turned into a print), there's no ready file the moment
someone asks — you still have to slice/model it. The **Accept** dialog in
admin has a FlowQ file ID field: fill it in when you accept and it auto-
queues right then; leave it blank and send it later once the file's ready.

## 1. Create the Firebase project

1. https://console.firebase.google.com → Add project.
2. Enable **Authentication** → Sign-in method → turn on **Google** and
   **Email/Password**.
3. Enable **Firestore Database** (production mode). Storage is not needed.
4. Project settings → Your apps → Add app → Web. Copy the config object into
   `public/js/firebase-config.js` (`firebaseConfig`).
5. Set `ADMIN_EMAIL` in `public/js/firebase-config.js` to the Google or
   email/password account you'll sign in with as admin.

## 2. Set the admin email everywhere

This value has to match **exactly** in three files or admin access breaks:

- `public/js/firebase-config.js` → `ADMIN_EMAIL`
- `functions/index.js` → `ADMIN_EMAIL`
- `firestore.rules` → the email string inside `isAdmin()`

## 3. Stripe

Get both keys from https://dashboard.stripe.com → Developers → API keys —
you'll paste them into GitHub Secrets in step 5, not into any file.

After your first deploy, go to Stripe Dashboard → Developers → Webhooks →
add an endpoint pointing at your deployed `stripeWebhook` function URL
(shown in the GitHub Actions run's deploy step), listening for
`payment_intent.succeeded`. Copy the webhook's signing secret too — it's
also a GitHub Secret, not something you type into a file.

## 4. FlowQ

You just need the Cloudflare Worker proxy URL (the one already fronting your
FlowQ print queue API) — this also goes into GitHub Secrets, in step 5.
`sendToFlowQ()` in `functions/index.js` posts `{ fileId, label }` to
`${FLOWQ_PROXY_URL}/queue` — adjust that request shape if your worker
expects something different.

## 5. GitHub Secrets — nothing sensitive lives in the repo

`.github/workflows/deploy.yml` deploys everything on every push to `main`,
pulling all credentials from GitHub repo secrets at deploy time. In your
repo: **Settings → Secrets and variables → Actions → New repository secret**,
add each of these:

| Secret name | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | `fun3ds-41428` |
| `FIREBASE_SERVICE_ACCOUNT` | JSON key for a service account with Firebase Admin + Cloud Functions Admin roles (Firebase Console → Project settings → Service accounts → Generate new private key — paste the whole JSON file's contents) |
| `STRIPE_PUBLISHABLE_KEY` | from Stripe, starts with `pk_` |
| `STRIPE_SECRET_KEY` | from Stripe, starts with `sk_` |
| `STRIPE_WEBHOOK_SECRET` | from the Stripe webhook you create after first deploy, starts with `whsec_` |
| `FLOWQ_PROXY_URL` | your Cloudflare Worker URL |

Once these are set, push to `main` and the workflow does the rest: it swaps
the publishable key into `checkout.js` at deploy time (never committed), sets
the two Stripe secrets in Cloud Functions Secret Manager, writes
`functions/.env` with the FlowQ URL, and runs `firebase deploy`. You can also
trigger it manually from the Actions tab (`workflow_dispatch`).

If you ever want to deploy from your own machine instead, run:
```
cd functions && npm install && cd ..
firebase login
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
echo "FLOWQ_PROXY_URL=https://YOUR-WORKER.workers.dev" > functions/.env
sed -i "s|__STRIPE_PUBLISHABLE_KEY__|pk_your_real_key|g" public/js/checkout.js  # then don't commit this change
firebase deploy --only firestore:rules,functions,hosting
```

## 6. Add your products

Sign in on the live site with your admin account, go to `/admin.html` →
Products tab, and add each item (name, price, stock, description, image URL,
and — if you already have the file loaded in FlowQ — its FlowQ file ID so
paid orders queue automatically).

## Project structure

```
.github/workflows/deploy.yml  CI: deploys to Firebase using GitHub Secrets
public/
  index.html            storefront: product grid, sign-in, checkout modal
  custom-print.html     online-print / dog-print request forms
  admin.html            orders, custom requests, product management
  success.html          post-checkout confirmation
  css/styles.css        design tokens + all styling
  js/firebase-config.js Firebase init — fill in your keys here
  js/auth.js            Google + email/password sign-in helpers
  js/store.js           product grid rendering
  js/checkout.js        embedded Stripe Payment Element flow (publishable
                         key injected by CI, never committed)
  js/custom-print.js    custom request forms + customer's own request list
  js/admin.js           admin dashboard logic
functions/
  index.js              Stripe PaymentIntent + webhook, FlowQ send,
                         admin-only accept/decline callables
  .env                   NOT committed — written by CI with FLOWQ_PROXY_URL
firestore.rules
firebase.json
```

## Pushing to GitHub

```
git init
git add .
git commit -m "Fun3ds v2"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/fun3ds-v2.git
git push -u origin main
```

Add secrets in GitHub (Settings → Secrets and variables → Actions) *before or
after* this push — the workflow only runs on `push`/`workflow_dispatch`, so
it's safe to push first and add secrets right after. `.gitignore` already
excludes `node_modules/` and `functions/.env` — no key ever touches the repo.
