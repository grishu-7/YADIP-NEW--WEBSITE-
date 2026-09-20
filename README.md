# YADIP Advanced / Premium Production Version

## What was upgraded

- Existing Firebase-based website preserved.
- ZapUPI browser SDK removed from the website.
- Direct video URL (`.mp4`, `.webm`, `.ogg`) support added.
- Product PID and Reseller Duration String fields added.
- Secure Node/Express backend added.
- Firebase ID-token authentication for backend.
- Admin-only integration settings endpoint.
- Reseller API adapter with server-side API key/master key.
- Generic FamPay/custom gateway adapter with server-side API key/secret.
- Payment callback + webhook endpoints.
- Idempotent order/key generation checks.
- SQLite order/log database.
- `.env` configuration.
- Render/Docker deployment files.
- Firebase security-rule template.

## Important gateway note

The reseller API and the FamPay gateway must be configured using their real documentation. This project intentionally does **not** guess undocumented endpoints, field names, or signature rules.

The backend expects:
- Reseller: POST JSON with `action`, `pid`, `product_id`, `duration`, `duration_string`, `order_id`.
- Payment create: POST JSON with `action=create_payment`.
- Payment verify: POST JSON with `action=verify_payment`.
- Webhook/callback: `order_id` + `payment_id`/`transaction_id`/`txn_id`.

If your provider uses different fields or authentication, edit the adapter functions in `backend/server.js` after checking the provider documentation.

## Android setup

### A. Prepare Firebase

1. Open Firebase Console in Chrome.
2. Select your project.
3. Confirm Authentication > Sign-in method has Email/Password enabled.
4. Confirm Realtime Database is enabled.
5. Deploy `database/firebase.rules.json` after replacing `YOUR_ADMIN_EMAIL`.
6. Do NOT upload a Firebase service-account JSON to the public site.
7. Create a Firebase service account only for the backend.

Firebase Security Rules are enforced by Firebase for reads/writes, so production rules should be reviewed before launch.

### B. Run/deploy the full stack

For a single-service deployment, the Node backend also serves `index.html`, so frontend and backend share one origin.

Render:
1. Create a GitHub repository from this folder.
2. In Chrome on Android, open Render Dashboard.
3. New > Web Service.
4. Select the repository.
5. Build command: `npm install`
6. Start command: `npm start`
7. Add environment variables from `.env.example`.
8. Deploy.
9. Open `https://YOUR-SERVICE.onrender.com`.
10. Admin login > Integrations.
11. Enter reseller and payment settings.
12. Test the backend at `/api/health`.

Render web services require the app to listen on `0.0.0.0`; this project already does that.

### C. Environment variables

Set these on the server, not in HTML:

- `ADMIN_EMAILS`
- `FIREBASE_DATABASE_URL`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `PUBLIC_BASE_URL`
- `OUTBOUND_TIMEOUT_MS`

Do not put reseller/payment secrets into `api-config.js`.

### D. Admin setup

1. Login to `/admin.html`.
2. Tap **Integrations**.
3. Enter backend URL only if frontend/backend are separate.
4. Enter Reseller API URL.
5. Enter API Key/Master Key.
6. Enter payment gateway URL/key/secret.
7. Set default PID and Duration String.
8. Set direct video URL.
9. Save.
10. Test each gateway.

### E. Product setup

Admin > Add Panel:
- Product name
- Normal video URL
- PID
- Reseller Duration String
- Plans and prices
- Update link
- Description

Existing panel data remains compatible.

## Free hosting

A practical free setup is a free Node Web Service provider that can run Express. Render currently documents free Web Services and notes that free services can spin down after inactivity. That means the first request after idle may be slower.

For a static-only frontend such as Netlify, keep the secure backend on a Node host and set `window.API_BASE_URL` in `api-config.js` to the backend URL. Never put API secrets in the static frontend.

## Paid hosting

For production, use a VPS/cloud Node service:
1. Upload/push this project.
2. Install Node 20+.
3. Run `npm install`.
4. Configure environment variables.
5. Run `npm start` behind HTTPS/reverse proxy.
6. Use a persistent disk for `database/app.sqlite`, or migrate the database to PostgreSQL.
7. Configure the gateway webhook to:
   `https://YOUR-DOMAIN/api/payment/webhook`
8. Configure callback:
   `https://YOUR-DOMAIN/api/payment/callback`
9. Test payment verification.
10. Test reseller key generation.
11. Enable backups.

## Production checklist

- Replace `YOUR_ADMIN_EMAIL`.
- Configure Firebase rules.
- Configure Firebase service account on backend only.
- Configure real reseller API documentation.
- Configure real payment gateway documentation.
- Implement the provider's exact webhook signature verification if it differs from HMAC-SHA256.
- Test successful, failed, pending and duplicate payments.
- Test reseller API timeout/failure.
- Confirm no secret appears in browser DevTools or page source.
- Back up the database.

## API flow

Customer -> create order -> payment gateway -> verified webhook/callback -> mark paid -> reseller API -> save key -> update Firebase -> customer history.

The server never trusts the browser's displayed price; it reloads the product/plan from Firebase before creating the payment.

# YADIPWEB Premium Production V4 — Reseller + FamGateway

## क्या बदला गया
- Reseller API अब exact form-urlencoded request इस्तेमाल करता है:
  - URL: `https://bantibhaiya.to/api/reseller_v1.php`
  - Header: `x-master-key`
  - Body: `api_key`, `action=buy`, `product_id`, `duration`
  - `android_id` केवल configured Device-Bound/V1 products के लिए भेजा जाता है।
- FamGateway integration:
  - Create order: `POST https://famgateway.in/api/create-order`
  - Verify order: `GET https://famgateway.in/api/verify-order.php?order_id=...`
  - API key केवल backend header `X-Api-Key` में जाता है।
  - Customer को hosted `checkout_url` पर भेजा जाता है।
- Browser refresh/polling पर backend authoritative payment verification करता है।
- Webhook/callback में FamGateway `order_id` को local order के `payment_id` से map किया जाता है।
- Duplicate fulfillment रोकने के लिए existing key/order checks रखे गए हैं।
- Admin में PID, reseller duration और optional Android ID fields हैं।
- ZapUPI frontend SDK हटाया गया है।

## Android mobile setup — सबसे आसान तरीका

### A. Free frontend + backend
इस project में Netlify static frontend और Render backend दोनों files मौजूद हैं। Production payment/reseller secrets **Netlify frontend में नहीं डालने हैं**।

1. Android में ZIP download/extract करो।
2. GitHub में project upload करो।
3. Render पर **New → Web Service** चुनो।
4. GitHub repository connect करो।
5. Build command: `npm install`
6. Start command: `npm start`
7. Environment variables में `.env.example` की values भरो।
8. `PUBLIC_BASE_URL` में Render URL डालो।
9. `ADMIN_EMAILS` में admin Firebase email डालो।
10. Firebase service-account JSON backend environment variable में डालो।
11. Render deploy होने के बाद backend URL copy करो।
12. Netlify site में `api-config.js` की `window.API_BASE_URL` को backend URL पर set करके redeploy करो।
13. Admin Panel → Advanced Integrations में Reseller और FamGateway values save करो।

### B. Reseller API values
Admin → **Advanced Integrations → Reseller API**:

- Reseller API URL: `https://bantibhaiya.to/api/reseller_v1.php`
- API Key: अपना reseller API key
- Master Key: अपना master key
- Default PID: अपना exact PID
- Default Duration: जैसे `1 Day`, `7 Days`, `3 Hours`

Product add/edit करते समय भी PID और Duration set कर सकते हो। Device-Bound/V1 product के लिए optional Android ID field भरो। V2 product के लिए Android ID खाली छोड़ सकते हो।

### C. FamGateway values
Admin → **Advanced Integrations → FamGateway**:

- Create Order URL: `https://famgateway.in/api/create-order`
- Verify Order URL: `https://famgateway.in/api/verify-order.php`
- API Key: अपना FamGateway API key
- Secret: webhook signing secret, यदि gateway account में configured है
- Webhook URL: `https://YOUR-BACKEND-DOMAIN/api/payment/webhook`
- Redirect URL: `https://YOUR-FRONTEND-DOMAIN/?payment=success`

Backend payment flow:

`Product → Local Order → FamGateway Order → Hosted Checkout → Server Verification → Reseller Buy API → Key → Firebase/SQLite`

### D. Important security
- API key/master key को `index.html`, `admin.html`, `api-config.js`, GitHub public repo या Netlify में मत डालो।
- Reseller endpoint का `action=buy` real key create करता है, इसलिए admin का **Test Reseller API** button real purchase नहीं करता; वह केवल configuration validate करता है।
- Reseller request में SSL verification disable नहीं किया गया है।
- Production में HTTPS use करो।

## Paid hosting
VPS/managed Node hosting पर यही `npm install && npm start` deployment use कर सकते हो। Domain + SSL लगाकर `PUBLIC_BASE_URL` update करो और webhook URL उसी HTTPS domain पर रखो। Persistent database backups भी enable करो।

## Final testing checklist
1. Admin login काम करता है।
2. Product में exact PID और duration save है।
3. FamGateway API key configured है।
4. Test Payment configuration सफल है।
5. Customer order create करता है।
6. Customer hosted FamGateway checkout पर जाता है।
7. Payment के बाद backend `/verify-order.php` से status check करता है।
8. केवल verified payment पर reseller `action=buy` call होता है।
9. Returned key local order + Firebase में save होती है।
10. Same order refresh/webhook से duplicate key नहीं बनती।


## v4.2 admin update
- Payment Settings now includes direct FamGateway Create URL, Verify URL, API Key, Merchant ID, redirect URL, and webhook URL controls.
- FamGateway settings are saved through the authenticated admin backend instead of being stored as frontend source values.
- Empty database secret settings now fall back to the corresponding Render environment variables, so `FAMPAY_API_KEY` and reseller credentials remain usable when no admin override is saved.
- Render configuration now declares the reseller and FamGateway environment variables as deploy-time secrets.
- Pricing plans require an individual Reseller Duration String; add/edit validation prevents incomplete or duplicate plan names.
