# Costa Rica · 4–25 November 2026

A single-page trip manifest: day-by-day itinerary, a shared "pachanga" board the local
crew can write to, a live budget console and pre-departure checklists.

Everything is one static `index.html` with no build step. Open the file, or serve the
folder over HTTP:

```bash
npx http-server -p 8899 .
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole page: markup, styles and behaviour |
| `sw.js` | Service worker — offline cache |
| `manifest.webmanifest` | PWA metadata (installable on a phone) |
| `icon.svg` | Favicon / app icon (the carreta wheel) |

## Design constraints

Three of these drove most of the implementation choices, so they are worth stating:

1. **It has to work with no signal.** The plan is used in Monteverde and along the
   Caribbean, where the page's own practical notes warn that coverage disappears. The
   itinerary, budget and checklists therefore have no network dependency at all, and
   `sw.js` caches the page for fully offline use.
2. **A failed CDN must not take the page down.** Supabase is loaded `defer` and only
   the board uses it. If the bundle cannot load, the board renders read-only from local
   data and everything else is unaffected.
3. **It is read on a phone in daylight.** Small type sits at a 5:1 contrast floor or
   better; tap targets are at least 44px.

## Supabase — board sync

The board syncs through a single table. The URL and publishable key in `index.html` are
public by design; **row-level security is the only thing protecting the data**, so the
schema below is not optional.

```sql
create table if not exists public.pachanga_board (
  day        smallint primary key check (day between 4 and 25),
  who        text        not null check (char_length(who)  between 1 and 60),
  what       text        not null default '' check (char_length(what) <= 200),
  updated_at timestamptz not null default now()
);

alter table public.pachanga_board enable row level security;

-- Open to anonymous visitors on purpose: the crew should not need accounts.
-- The CHECK constraints above are what actually bound the damage.
create policy "read"   on public.pachanga_board for select to anon using (true);
create policy "insert" on public.pachanga_board for insert to anon with check (true);
create policy "update" on public.pachanga_board for update to anon using (true) with check (true);
create policy "delete" on public.pachanga_board for delete to anon using (true);

-- Required for live sync; without it the page silently falls back to 60s polling.
alter publication supabase_realtime add table public.pachanga_board;
```

Notes:

- `day` must be the primary key — the client uses `upsert(..., { onConflict: 'day' })`.
- `day between 4 and 25` and the length caps are the real abuse limit. Without them a
  single request can insert an unbounded blob or thousands of rows.
- The table is world-writable by anyone who finds this repository. That is an accepted
  trade for a group of friends with no logins. If it is ever abused, the smallest fix is
  to drop the `delete` policy (the "Clear entries" button stops working, nothing else
  does) and re-create rows manually.

### Verify RLS is actually on

If RLS is left disabled, the publishable key exposes **every** table in the project, not
just this one. Check it:

```sql
select relname, relrowsecurity from pg_class where relname = 'pachanga_board';
-- relrowsecurity must be true
```

## Known follow-ups

- **Pin Supabase with an SRI hash.** The script tag currently tracks the latest v2. To
  pin it, pick an exact version and generate the digest:

  ```bash
  V=2.45.4   # replace with the version you want
  curl -sL "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@$V" \
    | openssl dgst -sha384 -binary | openssl base64 -A
  ```

  then use `src="…@$V" integrity="sha384-<digest>" crossorigin="anonymous"`.
  Do not guess the digest — a wrong one blocks the script entirely.
- **`og:image`.** The Open Graph tags have no image, so a link shared to WhatsApp shows
  title and description but no thumbnail. Adding one needs a real PNG (≈1200×630);
  SVG is not rendered as an OG image by most platforms.
- **The itinerary is duplicated in three places** — the overview grid, the day sections
  and the `CTX` map in the script. They currently agree, but nothing enforces that.
  Deriving all three from one data array would remove the drift risk.

## Editing the content

- **Itinerary days** — the `<section id="w1|w2|w3">` blocks, plus the matching card in
  the `.ov` overview grid and the label in `CTX`.
- **Checklist / packing items** — the `CHECK` and `PACK` arrays. Each entry is
  `[text, note, 'req' | 'rec' | '']`. Saved ticks are keyed by a slug of the category
  and item text, so reordering or inserting items is safe; **rewording an item resets
  that one tick**, which is the intended trade for that safety.
- **Budget** — `BUDGET_DEFAULTS` and the fixed rows inside `calcBudget()`. Fixed costs
  (lodging, car) are marked `true` and render in jade.

## Deploying

Static hosting, nothing to build. On GitHub Pages, serve the repository root from the
default branch. The service worker requires HTTPS (or `localhost`), which Pages provides.

After changing `index.html`, bump `VERSION` in `sw.js` so returning visitors get the new
copy instead of the cached one. Navigation requests are network-first, so this mostly
matters for the fonts and icon.
