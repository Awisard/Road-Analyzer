# Connecting Supabase

Stores every analyzed image (original + overlay) in Supabase Storage, and the
analysis result (class breakdown, road type, length estimate) in a Postgres
table alongside it.

## 1. Create a Supabase project
Go to https://supabase.com → New project. Takes a couple of minutes to spin up.

## 2. Get your API credentials
Dashboard → **Settings → API**. You need two values:
- **Project URL** (`https://xxxxx.supabase.co`)
- **`service_role` secret key** — NOT the `anon`/`public` key. The service
  role key bypasses row-level security and must only ever live in the
  backend's `.env` file — never send it to the browser/frontend.

## 3. Create the storage bucket
Dashboard → **Storage** → **New bucket**.
- Name: `road-images` (must match `SUPABASE_BUCKET` below if you rename it)
- **Keep it private** (toggle off "Public bucket"). The backend generates
  short-lived signed URLs to display images, so a private bucket is safe and
  is what `analysisStore.js` assumes.

## 4. Create the database table
Dashboard → **SQL Editor** → New query → paste the contents of
`server/supabase/schema.sql` → **Run**.

## 5. Configure the backend
```bash
cd server
cp .env.example .env
```
Edit `.env` and fill in:
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_BUCKET=road-images
```

## 6. Install and run
```bash
npm install
npm start
```
On startup you should see either `Supabase: connected` or a message telling
you it's not configured yet — check that before assuming it's working.

## What happens automatically
Every successful `POST /api/analyze` now also:
1. Uploads the original image and the overlay PNG to the `road-images` bucket
   under a new folder per analysis (`<uuid>/original-<filename>`,
   `<uuid>/overlay.png`)
2. Inserts one row into `road_analyses` with the analysis results and the
   storage paths
3. Returns `storage: { saved: true, record: {...} }` in the API response —
   or `{ saved: false, reason: "..." }` if Supabase isn't configured or the
   save failed. **The analysis itself still succeeds and returns normally
   either way** — a Supabase outage or misconfiguration never breaks the
   core upload → analyze flow, it just means that one result won't be saved.

## Reading it back
```
GET /api/analyze/history?limit=20
```
Returns the most recent analyses with fresh signed URLs (valid 1 hour) for
each image and overlay. There's no frontend UI for this yet — it's a plain
JSON endpoint for now; wire it into a "History" panel in `client/` if you
want a gallery view.

## Costs / limits worth knowing
Supabase's free tier includes 1GB of storage and a small Postgres instance —
fine for testing, but drone photos add up fast (a few MB each). Worth
checking your usage on the dashboard before this becomes a production data
store, and consider whether you actually need to keep the overlay image
long-term (it's regenerable from the original + model) versus just the
original + the JSON analysis result.
