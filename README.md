# Instagram Follower Counter (official API)

Node.js + Express web service for Render. It shows your Instagram follower count using Meta's
official **Instagram API with Instagram Login**. No database. The count is exact (not rounded).

## Requirements
- A **Business or Creator** Instagram account (free to switch: Instagram > Settings > Account type and tools).
  Personal accounts cannot use the API.
- A free Meta developer app and an access token (Part 1 below).

## Routes
`/` dashboard, `/api/followers` JSON (accountName, accountId, followerCount, updatedAt, source, isEstimate),
`/health` returns 200 without calling Instagram.

## Part 1: Get your access token (one time, about 10 minutes)
1. Go to developers.facebook.com, log in, and click **My Apps > Create App**. Choose the use case
   **Other / Business** and a **Business** app type (wording changes from time to time).
2. In the app dashboard, add the product **Instagram** and open **API setup with Instagram login**.
3. Under **Generate access tokens**, click **Add account**, log in with your Instagram account, and accept.
   (While the app is in development mode, only accounts added as app roles/testers can do this. Your own account is fine.)
4. Click **Generate token** next to your account and copy the token. Keep it secret like a password.
   This dashboard token is valid for **60 days**.

## Part 2: Deploy
1. Unzip the project and upload everything to a new GitHub repository (include the `public` folder, not `node_modules`).
2. On render.com: **New + > Blueprint**, select the repo, **Connect**.
3. Render asks for two values:
   - `INSTAGRAM_ACCESS_TOKEN`: paste your token.
   - `INSTAGRAM_EXPECTED_USERNAME` (optional): your handle without @. The app then refuses data from any other account.
4. Click **Apply**. When status is **Live**, open the `.onrender.com` URL.
   (If you create a plain Web Service instead: build `npm install`, start `npm start`, health check `/health`, then add the two variables under **Environment**.)

First visit after the free plan sleeps (~15 min idle) can take 30-60 seconds.

## Keeping it working: token expiry
Tokens last 60 days. Before then, generate a new token in the Meta dashboard (same screen) and replace
`INSTAGRAM_ACCESS_TOKEN` in Render > your service > **Environment**; it redeploys automatically.
Set a phone reminder for about 50 days. When the token expires the page keeps the last count marked
"may be out of date" and shows `TOKEN_INVALID`. Render's free tier has no storage, so the app can't
safely save a self-refreshed token.

## Behavior
- Server cache: 2 minutes. One request at a time. 60-second pause after a failure.
- Failed refresh: last good count stays on screen, amber, with an error message. Numbers are never invented.
- The token is only read from environment variables, never sent to the browser or logged.

## Troubleshooting (Render > Logs, or open `/api/followers`)
- `CONFIG_MISSING`: token variable not set.
- `TOKEN_INVALID`: token expired or wrong. Generate a new one.
- `PERMISSION_DENIED`: account isn't Business/Creator, or token lacks `instagram_business_basic`.
- `ACCOUNT_MISMATCH`: token is for a different account than `INSTAGRAM_EXPECTED_USERNAME`.
- `RATE_LIMITED`, `TIMEOUT`, `NETWORK`: usually temporary.

Run locally (Node 18+): `INSTAGRAM_ACCESS_TOKEN=xxx npm start`, open http://localhost:3000. Self-test: `npm test` (uses a fake API).
