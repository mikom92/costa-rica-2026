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

## Supabase — private trip details

The public page carries no address, booking code or cost figures. They live in a second
table that anonymous requests cannot select from, and the page fetches them only after
the owner signs in. **Nothing here is hidden with CSS or JavaScript** — an unauthenticated
browser never receives the values at all, so viewing the source reveals nothing.

```sql
create table if not exists public.trip_private (
  key   text primary key,
  value text not null
);

alter table public.trip_private enable row level security;

-- Read-only from the page, and only for one signed-in address.
-- Replace <your email> INCLUDING THE ANGLE BRACKETS: 'you@example.com', not
-- '<you@example.com>'. The drop makes this safe to re-run.
drop policy if exists "owner reads" on public.trip_private;

create policy "owner reads" on public.trip_private
  for select to authenticated
  using (auth.email() = '<your email>');
```

> **The placeholder is the one that bites.** Leave `<your email>` unreplaced, or keep the
> angle brackets around a real address, and the policy compares your address against a
> string it can never equal. Nothing errors: the table simply returns nothing, forever, and
> the page reports it as having no data rather than as being misconfigured. Verify what
> actually landed rather than trusting that the statement ran — see
> [Verify RLS is actually on](#verify-rls-is-actually-on) below, which prints the stored
> expression.
>
> `create policy` does **not** overwrite an existing policy; it fails with
> `42710: policy … already exists` and leaves the old, broken one in place. That is why the
> snippet drops first — otherwise a corrected re-run appears to fail while actually
> changing nothing.

There is deliberately **no insert/update/delete policy**: rows are managed in the
Supabase table editor, so the page can never write to this table even if someone
signs in.

Seed the values (adjust to taste — `key` must match the `data-private` attributes in
`index.html`):

**Fill in the real values in the Supabase editor, not here** — this file is in the same
public repository, so anything pasted below is exactly as exposed as it was in
`index.html`. The placeholders are intentional.

```sql
insert into public.trip_private (key, value) values
  ('base.address',        '<street, town>'),          -- "Calle N, Town centre"
  ('base.street',         '<street>'),                -- short form for the day-1 tag
  ('base.short',          '<street> · <booking code>'),
  ('base.code',           '<booking code>'),
  ('base.cost',           '<amount> zł · 21 nights'),
  ('base.charged',        '<date the card was charged>'),
  ('base.cancel',         'until <free cancellation deadline>'),
  ('car.deposit',         '$<deposit hold>'),
  ('insurance.plan',      '<insurer and plan>'),
  ('insurance.bank',      '<bank / card>'),
  ('budget.lodging',      '<lodging cost, PLN, digits only>'),
  ('budget.lodgingLabel', 'Lodging · <town>, 21 nights'),
  ('budget.flights',      '<flight quote, PLN, digits only>')
on conflict (key) do update set value = excluded.value;
```

`budget.lodging` and `budget.flights` are numbers in PLN. Signed out, the budget console
shows round estimates (3,400 and 4,000) so it stays usable without revealing the actual
booked amounts. `budget.flights` only pre-sets the slider if it has never been dragged.

### Sign-in

Email magic link, no OAuth app to register and no password:

1. Supabase dashboard → **Authentication → Providers → Email**, enable it.
2. **Authentication → URL Configuration**, add the deployed page URL to the redirect
   allow-list. Without this the link in the email will refuse to come back.
3. Optionally restrict signups entirely — the RLS policy already pins access to one
   address, so anyone else who signs in sees exactly nothing.

Click **🔒 Private details** in the footer, or any locked `🔒` value on the page.

## Supabase — private notes

Longer notes that belong to the owner alone: a title and a paragraph, rather than the
single values `trip_private` slots into sentences. Same sign-in, same guarantee — the page
never receives them until someone is signed in, so the public source shows nothing.

```sql
create table if not exists public.private_notes (
  id    bigint   generated always as identity primary key,
  title text     not null,
  body  text     not null default '',
  sort  smallint not null default 0
);

alter table public.private_notes enable row level security;

-- Read-only from the page, and only for one signed-in address.
-- Replace <your email> INCLUDING THE ANGLE BRACKETS: 'you@example.com', not
-- '<you@example.com>'. The drop makes this safe to re-run.
drop policy if exists "owner reads" on public.private_notes;

create policy "owner reads" on public.private_notes
  for select to authenticated
  using (auth.email() = '<your email>');
```

The placeholder warning under `trip_private` applies here too, and this table is where it
hurts less obviously: a wrong address here shows up as "No notes yet", which reads like an
empty table rather than a broken policy.

As with `trip_private`, there is deliberately **no insert/update/delete policy**. Notes are
written in the Supabase table editor; the page can only read them.

**Write the real notes in the Supabase editor, not here.** This file sits in the same
public repository, and the note content is exactly the material that was taken off the
public page — pasting it below would put it straight back.

```sql
insert into public.private_notes (title, body, sort) values
  ('<note title>', '<first paragraph>' || chr(10) || chr(10) || '<second paragraph>', 10),
  ('<note title>', '<body>', 20);
```

`sort` orders the list, `title` breaks ties. Number in tens so a note can be slipped
between two others without renumbering. Blank lines inside `body` survive to the page.

Nothing appears until you are signed in. Signed in with an empty table the section says
so, and a table that is missing or whose policy does not match your address reports that
differently — the two are deliberately not the same message.

### Verify RLS is actually on

If RLS is left disabled, the publishable key exposes **every** table in the project, not
just this one. Check it:

```sql
select relname, relrowsecurity from pg_class
where relname in ('pachanga_board','trip_private','private_notes');
-- relrowsecurity must be true for all three
```

Then check what the policies actually say, which is the step that catches an unreplaced
placeholder:

```sql
select tablename, policyname, qual
from pg_policies
where tablename in ('trip_private','private_notes');
```

`qual` must contain your real address, bare — `(auth.email() = 'you@example.com'::text)`.
Anything with angle brackets still in it, or the literal `<your email>`, means the policy
was created from the unedited snippet and will match nobody.

## Bumping the pinned Supabase version

The script tag is pinned to an exact version with an SRI digest, so an upgrade is two
edits that must be made together. Generate the digest from the URL you are about to
use — never guess it, because a wrong digest blocks the script entirely:

```bash
V=2.112.3   # replace with the version you want
curl -sL "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@$V" \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

Then update both `src="…@$V"` and `integrity="sha384-<digest>"` in `index.html`.

A blocked script is not a page-down: the board falls back to read-only local data, the
same path as an unreachable CDN. So a botched bump degrades quietly rather than loudly —
check the console for an integrity error if the board stops syncing after an upgrade.

## Editing the content

- **Private notes** — not in this file at all. Rows in the `private_notes` table, edited in
  the Supabase table editor; nothing in the repository needs touching to add, reword or
  reorder one. Same for the values in `trip_private`.
- **Itinerary days** — the `.day[data-days]` blocks are the single source of truth. The
  overview grid (`#ovGrid`) and the per-day labels in `CTX` are both generated from them
  at load, so edit the day block only. The generation reads these attributes:

  | Attribute | Feeds |
  | --- | --- |
  | `data-days` | `"7"` or `"12-14"` — which November days the block covers |
  | `data-ctx` | the short label shown on the pachanga board for those days |
  | `data-ov-date`, `data-ov-title`, `data-ov-sub` | the three lines of the overview card |
  | `data-ov-cls` | optional extra class on the overview card |

  A day left out of every `data-days` range gets no `CTX` label and shows `—` on the board.
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
