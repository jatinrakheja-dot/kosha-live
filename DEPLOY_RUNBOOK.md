# Deploying Kosha live on Hostinger (shared/Business hosting, cPanel)

## Prerequisites
- Hostinger Business hosting plan with cPanel access
- Your domain already pointed at Hostinger (A record / nameservers already set up when you bought hosting there)

## Step 1 — Upload files
1. hPanel → **Files** → **File Manager**
2. Navigate to the folder for your domain (usually `public_html`, or `public_html/yourdomain.com` if it's an addon domain)
3. Create this structure:
   ```
   public_html/
     server.js
     package.json
     public/
       index.html   <- your patched kosha-platform_1.html, renamed
   ```
4. Upload `server.js` and `package.json` (from this project) to `public_html`
5. Upload your patched `index.html` into `public_html/public/`

## Step 2 — Set up the Node.js app via cPanel
1. hPanel → **Advanced** → **Setup Node.js App** (sometimes under "Software")
2. Click **Create Application**
3. Fill in:
   - **Node.js version**: 18.x or 20.x (whichever is available)
   - **Application mode**: Production
   - **Application root**: the folder you uploaded to (e.g. `public_html` or a subfolder like `kosha`)
   - **Application URL**: your domain or subdomain
   - **Application startup file**: `server.js`
4. Click **Create**
5. cPanel will show you a command to "Run NPM Install" — click that button (it runs `npm install` inside the app's virtual environment, pulling in Express from your `package.json`)
6. Click **Restart** to start the app

## Step 3 — Verify
1. Visit `https://yourdomain.com/api/health` — should return JSON like `{"ok":true,"cachedRows":0,...}` on first load
2. Visit `https://yourdomain.com/` — should load the Kosha dashboard
3. Open browser dev tools → Network tab → confirm a request to `/api/bhavcopy` succeeds (200) and returns an array

## Step 4 — Keep it warm (cron, optional but recommended)
Shared Node.js apps under Passenger can go idle and take a few seconds to
"wake up" on the next request. To keep it responsive during market hours:

1. hPanel → **Advanced** → **Cron Jobs**
2. Add a job every 5 minutes, 9:00–15:35 IST, that just hits your app:
   ```
   */5 9-15 * * 1-5  curl -s https://yourdomain.com/api/health > /dev/null
   ```
   (Adjust hours for your server's timezone if it's not already IST.)

## Troubleshooting

**App won't start / 503 error**
- Check the Node.js app's log file (cPanel shows a "stderr log" link on the app's page)
- Most common cause: `npm install` wasn't run, so `express` isn't available

**`/api/bhavcopy` returns an empty array**
- NSE sometimes changes its cookie/header requirements; check the stderr log for the fetch error
- NSE's site can also rate-limit or block Hostinger's shared IP ranges — if this persists, we may need a paid market-data API (e.g. Kite Connect, Upstox API, or a commercial NSE data vendor) as a more reliable source than scraping NSE's own website

**Frontend loads but shows no holdings/prices**
- Open the browser console — if `BHAV` stayed empty after boot, the fetch failed; check Network tab for the actual error on `/api/bhavcopy`

## About the MCP servers (nseindia.com/nse-mcp, tapetide.com)

These are not used in this deployment. They're MCP (Model Context Protocol)
tools meant for AI assistants to call inside a chat session, not something a
browser or Node backend calls directly over plain HTTP. `server.js` instead
talks to NSE's own public JSON API directly. If you want to incorporate data
specifically from tapetide.com as a secondary/enrichment source later, that
would require either:
- tapetide.com exposing a normal REST API (separate from its MCP endpoint), or
- running an MCP client library inside `server.js` (Node has `@modelcontextprotocol/sdk`)
  to call it server-side, then merging that data into the `/api/bhavcopy` response.

Neither is needed for the dashboard to go live with real NSE prices.
