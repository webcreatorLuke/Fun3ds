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
3. Enable **Firestore Database** (production mode) and **Storage**.
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

1. https://dashboard.stripe.com → Developers → API keys. Copy the
   **publishable key** into `public/js/checkout.js` (replace
   `pk_live_or_test_YOUR_PUBLISHABLE_KEY`).
2. Set the **secret key** as a Cloud Functions secret (never put this in
   client code or commit it):
   ```
   firebase functions:secrets:set STRIPE_SECRET_KEY
   ```
3. After first deploy, in Stripe Dashboard → Developers → Webhooks, add an
   endpoint pointing at your deployed `stripeWebhook` function URL (shown in
   the `firebase deploy` output), listening for `payment_intent.succeeded`.
   Copy the webhook's signing secret and set it:
   ```
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   ```

## 4. FlowQ

Set the Cloudflare Worker proxy URL (the one already fronting your FlowQ
print queue API) as an env var for the functions codebase:

```
firebase functions:config:set flowq.proxy_url="https://YOUR-WORKER.workers.dev"
```

`sendToFlowQ()` in `functions/index.js` posts `{ fileId, label }` to
`${FLOWQ_PROXY_URL}/queue` — adjust that request shape if your worker
expects something different.

## 5. Install and deploy

```
cd functions && npm install && cd ..
firebase login
firebase use --add        # pick/create your Firebase project
firebase deploy --only firestore:rules,storage:rules,functions,hosting
```

## 6. Add your products

Sign in on the live site with your admin account, go to `/admin.html` →
Products tab, and add each item (name, price, stock, description, image URL,
and — if you already have the file loaded in FlowQ — its FlowQ file ID so
paid orders queue automatically).

## Project structure

```
public/
  index.html            storefront: product grid, sign-in, checkout modal
  custom-print.html     online-print / dog-print request forms
  admin.html            orders, custom requests, product management
  success.html          post-checkout confirmation
  css/styles.css        design tokens + all styling
  js/firebase-config.js Firebase init — fill in your keys here
  js/auth.js            Google + email/password sign-in helpers
  js/store.js           product grid rendering
  js/checkout.js        embedded Stripe Payment Element flow
  js/custom-print.js    custom request forms + customer's own request list
  js/admin.js           admin dashboard logic
functions/
  index.js              Stripe PaymentIntent + webhook, FlowQ send,
                         admin-only accept/decline callables
firestore.rules
storage.rules
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

Add a `.gitignore` with `node_modules/` before committing — Stripe/Firebase
secrets live in Cloud Functions config, never in the repo.
