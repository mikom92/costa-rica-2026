# Private notes — design

**Status:** approved 2026-08-13. Every open question has an owner's answer:
§8 read-only (2026-08-12); §2 its own table, §3 flat list with no `category`, and §4 an
explicit empty state (all 2026-08-13). No implementation started.
**Date:** 2026-08-13
**Next step:** invoke the `writing-plans` skill. Do not start implementing straight from
this document.

**On trusting this document.** Its factual claims about `index.html` and `README.md` were
re-checked against the code on 2026-08-13 and held. Its *arguments* deserve more suspicion
than that: §10 records a case where this document confidently asserted a verified fact that
was false, and shipping on it broke production. Where a section reasons rather than cites,
check the code.

This document is written to be read cold. It assumes no memory of the conversation that
produced it.

---

## 1. What already exists

The page already has a working sign-in and a private-data path. **This feature does not
add authentication** — a previous attempt at this task assumed it had to, and that
assumption is wrong.

Landed in commit `c9272c8` ("Move private trip details behind sign-in, out of the page
source"):

| Piece | Where | What it does |
| --- | --- | --- |
| Magic-link sign-in | `signInWithOtp` in the `Private` module | email link, no password, no OAuth app |
| Session tracking | `sb.auth.onAuthStateChange` → `refresh()` | re-fetches on every auth change |
| Token cleanup | end of `Private.init()` | strips `access_token` from the address bar |
| Private values | `trip_private` table + `[data-private]` spans | RLS-gated `key → value`, injected by `paint()` |

**Find these by searching, not by line number.** Absolute line numbers went stale three
times while this document was being written — every edit to `index.html` above a reference
moves it, and a number that is silently four or seventeen lines off is worse than no
number at all. The patterns below are stable; `grep -n` gives you the current position.

| What | `grep -n` for |
| --- | --- |
| private-details block | `===== PRIVATE DETAILS =====` |
| the private-values store | `const PRIV={` |
| the module | `const Private=(function(){` |
| the repaint entry point | `function paint(){` |
| the fetch | `async function refresh(){` |
| the orphaned card CSS (§4) | `^\.crew{` and `^\.person{` |
| nav links (§4) | `<a href="#packing"` |
| checklist section (§4) | `<!-- CHECKLIST -->` |

There is no uncommitted local state.

There is **no `index-en.html`**. There is one `index.html` and it is already in English.

## 2. Decision

Private notes get their **own table, `private_notes`**, fetched alongside `trip_private`
in the existing `refresh()`.

**Why not reuse `trip_private`.** That table is `key → value`, and its values are
substituted in place inside sentences (`base.code` → the booking code). A note needs a
title, an ordering and a paragraph of body text. Encoding that into a `value` column as
JSON, or into prefixed keys like `note.<slug>`, pretends the two are the same problem. With
prefixed keys the ordering has to be smuggled into the key name and the title concatenated
with the body — a permanent readability cost to save one `select`.

**Why not one table with a `kind` column.** Cleanest on a blank slate, but it requires
migrating the existing `trip_private` rows and rewriting working code that has nothing to
do with this change. Risk with no payoff.

**Cost of the chosen option:** one extra table and one extra query. Explicitly *not* a
second auth implementation — one session, one `refresh()`, one repaint. That was the only
real way to get this wrong.

## 3. Data model

```sql
create table if not exists public.private_notes (
  id    bigint   generated always as identity primary key,
  title text     not null,
  body  text     not null default '',
  sort  smallint not null default 0
);

alter table public.private_notes enable row level security;

-- Read-only from the page, and only for one signed-in address.
-- Replace the email with your own before running this.
create policy "owner reads" on public.private_notes
  for select to authenticated
  using (auth.email() = '<your email>');
```

**No insert/update/delete policy, deliberately.** README lines 95–97 state as an
invariant that the page can never write to `trip_private` "even if someone signs in".
`private_notes` inherits that invariant: rows are managed in the Supabase table editor.
This was considered and confirmed — see §8.

**Policy style:** `auth.email() = '...'`, matching the existing `trip_private` policy in
README. Do not switch to `auth.jwt() ->> 'email'`; two styles in one project is how an
audit goes wrong.

**Ordering.** `sort` drives the order of the list, `title` breaks ties. Nothing else
depends on it.

**No `category` column — decided 2026-08-13.** Notes render as one flat list. Grouping was
offered and declined: at the expected volume, headings would cost a field on every row to
organise a page that fits on one screen. If categories are ever wanted, adding the column
is additive — but read §4 first, because a grouped list also has to decide the order of the
groups, and a single `sort` column cannot express both without renumbering.

**Seeding.** Rows are inserted in the Supabase table editor. The README section must use
placeholder content only. The repository is public: real note content is exactly the
material that was removed from the public page in the first place, and pasting it into a
seed snippet in README re-publishes it. Do not paste real titles or bodies here, and do not
describe what the notes are about — the subject matter is itself part of what was removed.

## 4. Where it renders

A new section between `#practical` and `#checklist`:

```html
<section id="notes" hidden>
  <div class="wrap">
    <div class="shead"><h2>Private notes</h2><span class="tag">visible only to you</span></div>
    <div id="notesList"></div>
  </div>
</section>
```

plus a nav link `<a href="#notes" hidden>Notes</a>` **between `#practical` and `#checklist`,
matching where the section sits.** An earlier draft put it after `#packing`; that is a bug.
The scrollspy derives its section list from the order of the nav links, not from the
document (`links.map(a=>document.querySelector(a.getAttribute('href')))`), and highlights
the first visible one. The comment there claiming "document order" holds only because the
two orders coincide today — break the coincidence and scrolling through the notes leaves
"Packing" lit instead.
**Both `hidden` attributes are toggled together, driven by `email` — not by how many notes
came back.** `paint()` already reads `email` from the `Private` closure to label the footer
button, so this needs no new state. Signed in reveals the section; signed out hides it.

**Reuse the orphaned CSS.** `.crew` (line 201) and `.person` (line 202) are defined but
used by no markup — leftovers from the crew section that was scrubbed before the repo went
public. Notes are exactly that shape: a grid of cards, each a title plus a paragraph.
Render one `.crew` grid of `.person` cards — no headings, since there are no categories
(§3).

The only new CSS needed is `white-space:pre-wrap` on the body text so paragraph breaks
survive. Check whether `.person h4` inherits acceptably during implementation; add one
rule if not.

**`hidden` works here** — `section{...}` (line 89) and `.navin a{...}` (lines 84–85) set no
`display` property, so the UA stylesheet's `[hidden]{display:none}` is not overridden.

**Signed out, the section is absent — not shown locked.** The inline `[data-private]`
spans need a `🔒` placeholder because they sit inside sentences that would otherwise break.
A whole section has no sentence to hold together, and an empty "sign in to see" block
only advertises to the public that something is hidden. The footer button stays the way in.

**Scrollspy needs no change.** The `IntersectionObserver` IIFE snapshots its links and
sections at load; a `display:none` section never intersects, so it is never marked active,
and it is picked up automatically once unhidden.

**Signed in with zero notes says so — decided 2026-08-13.** Render one line in place of the
grid: *"No notes yet — add them in the Supabase table editor."* An earlier draft of this
document accepted silence here, reasoning that the owner seeds the rows and knows whether
any exist. That was overturned deliberately.

The reason is not convenience. Silence makes a **broken setup** — table missing, RLS policy
wrong, email in the policy not matching the signed-in address — look exactly like a
correctly empty list. This project has already paid for that class of bug once: a wrong SRI
digest presented itself as the word "offline", and the cause was found only after it
reached production. A failure that renders as ordinary emptiness is the expensive kind.

The privacy argument for silence does not apply. It was about the **signed-out** state,
where an empty "sign in to see" block advertises to the public that something is hidden.
This line appears only once `email` is set, so it is visible to nobody but the owner.

## 5. Fetching — changes to `refresh()`

Add a module-level `const NOTES=[];` next to `const PRIV={}`, plus `let NOTES_ERR=false;`
— §4 has to tell "empty" apart from "broken", and only the fetch knows which happened.
Inside `refresh()`:

```js
Object.keys(PRIV).forEach(k=>delete PRIV[k]);
NOTES.length=0;NOTES_ERR=false;                  // cleared BEFORE the if, not inside it
if(email){
  const [priv,notes]=await Promise.all([
    sb.from('trip_private').select('key,value'),
    sb.from('private_notes').select('title,body,sort').order('sort').order('title')
  ]);
  if(!priv.error)(priv.data||[]).forEach(r=>{PRIV[r.key]=r.value;});
  if(notes.error)NOTES_ERR=true;else NOTES.push(...(notes.data||[]));
}
applyToBudget();
paint();
```

**Three states to render, not two** (§4). `NOTES_ERR` → *"Could not load notes — check the
table and its policy."*; empty and no error → *"No notes yet…"*; otherwise the grid.
Collapsing the first two back into one message re-creates exactly the silence this design
decided against.

Four requirements, each of which is a bug if missed:

1. **`NOTES.length=0` before `if(email)`.** `signOut()` calls `refresh()`, which takes the
   false branch. Clearing only on the fetch path leaves notes on screen after sign-out.
2. **`Promise.all`.** Both queries depend on the session but not on each other. Sequential
   awaits double the wall-clock time for no reason.
3. **Explicit `.order()`.** Postgres does not guarantee row order. The `sort` column exists
   precisely to control this and must actually be used.
4. **Render from inside `paint()`**, not as a separate call site. `paint()` is already the
   single repaint entry point, and `init()` calls it before `refresh()` resolves — at which
   point `email` is still `null`, which correctly leaves the section hidden. Note the
   guard is `email`, not `NOTES.length`: a signed-in owner with no notes must reach the
   "No notes yet…" state (§4), and a length check would silently swallow it.

**Rendering rules.** Rebuild the list wholesale (`list.textContent=''` first), never
append: `init()` calls `refresh()` and `onAuthStateChange` fires it again, so an appending
renderer duplicates every note. Insert content with `textContent` on created elements, not
`innerHTML` — this matches the existing `paint()` idiom and needs no escaping. (`esc()`
exists at the top of the script block if markup ever has to be built by hand.)

## 6. Failure modes

Unchanged from the existing private-data path:

| Situation | Result |
| --- | --- |
| Not signed in | RLS returns an empty set, not an error. Section hidden. |
| Signed in, no rows | Section shown, "No notes yet…" (§4). |
| Query error / table missing / policy wrong | Section shown, "Could not load notes…" (§4). |
| Supabase CDN blocked or unreachable | No client, so no session. Section hidden. |
| Offline | Same as above. |

**The gap this closes.** An earlier draft accepted that forgetting to create the table
would look exactly like being correctly signed out. That trade is no longer taken: the
last two rows above are now distinguishable, and distinguishable from each other. The RLS
verification query in README remains the check for setup errors, but it is no longer the
*only* way to discover one.

**What stays silent, deliberately.** A blocked CDN still hides the section rather than
explaining itself, because with no client there is no session and the page cannot know
whether anyone would have been signed in. That path already announces itself in the
console via `SB.get()`, which is the right place for it.

## 7. Known limitation — no offline access

Design constraint 1 in README says the page must work with no signal, because it is used
in Monteverde and on the Caribbean coast where coverage disappears. **Private notes will
not be available there**, since they are fetched on demand and never cached. Caching them
would defeat the entire property that makes this design safe: the data never lands in the
page source or in local storage.

This is not a regression — `trip_private` already has exactly this limitation, and it was
accepted when that landed. Recorded here so it is a known trade rather than a surprise.
Out of scope for this change.

## 8. RESOLVED — read-only

**Decided 2026-08-12: notes are read-only from the page.** Rows are authored in the
Supabase table editor, restoring material that was removed from the public page.

The question was whether notes should be writable from a phone while travelling. They
should not: the owner's phone is for reading the trip page, not authoring it. Read-only
preserves the invariant README already states in writing — the page cannot write to a
private table even when someone is signed in — and avoids write policies, optimistic UI,
conflict handling and a new abuse surface.

**Do not add a write path** without revisiting §3 (write policies plus length `CHECK`
constraints, which are what actually bound abuse), §4 (form UI) and §5 (an optimistic
write path modelled on `Sync.write()`). Retrofitting writes is the expensive order, so
this is a deliberate closed door rather than an omission.

## 9. Documentation changes this requires

- **New README section, "Supabase — private notes"**: `CREATE TABLE`, the RLS policy, and
  a seed template using placeholders only (§3).
- **README line 146, the RLS verification query**, currently checks only `pachanga_board`.
  It should become `where relname in ('pachanga_board','trip_private','private_notes')` —
  it is the check that catches the failure where the publishable key exposes every table.
- **The auth dialog subtitle**, `index.html` line 859 ("Address, booking code and costs"),
  goes stale once notes are behind the same sign-in.
- **README "Editing the content"** (line 168): add a bullet stating notes are edited in
  Supabase, not in the file.
- **`sw.js`: bump `VERSION` to `cr26-v5`.** `v4` shipped with `9843c2e`, so this change
  needs its own bump — see §10.

## 10. Repository state

**There is no uncommitted local state.** Everything a fresh clone needs is on the remote.
This section previously warned about three modified-but-uncommitted files; they were
landed as `9843c2e` before this branch was pushed, precisely so that a session working
from a clone is not reasoning about a repository it cannot see.

`9843c2e` — "Pin Supabase to 2.112.3 with an SRI digest" — is unrelated to private notes
but affects this document in three ways:

1. **It shifted `index.html` line numbers**, as did every later commit touching that file.
   This is why §1 now locates code by search pattern instead. The remaining absolute
   numbers in §4 are CSS and markup near the top of the file, which nothing has moved yet —
   treat them as hints and confirm with `grep -n` before relying on one.
2. **`sw.js` is at `cr26-v4`, and `v4` is claimed by that commit.** The notes change
   therefore needs its own bump to `cr26-v5` (§9). Returning visitors otherwise keep the
   cached copy. The number is spent the moment `9843c2e` exists, whether or not it has
   reached Pages yet, so a later change cannot reuse it.
3. **The SRI digest is `sha384-l8ah+VgaWtk1mvOe9VC+OirC6qHFF4yH7l7mKRidV9MSti3E9F463bMp6ZVN4kuC`,
   and it is correct.** Hashing the pinned URL on a machine that can reach the CDN returns
   exactly this value. Do not change it without re-running README's one-liner.

   **A cautionary note, because this document previously said the opposite.** A session
   without network access to `cdn.jsdelivr.net` tried to verify the digest through npm
   instead — fetching the `2.112.3` tarball, authenticating it against the registry's own
   sha512, and hashing `dist/umd/supabase.js`, the file the package's `jsdelivr` field
   names. That produced `sha384-qafw21c/…`, and on that basis the digest above was
   declared fabricated and replaced. The replacement shipped to production and broke the
   very thing the pin protects: the browser refused the script, `window.supabase` stayed
   undefined, and the board silently dropped to read-only local data.

   The npm route is wrong. Whatever a bare `@supabase/supabase-js@2.112.3` URL returns
   from jsDelivr, it is **not** byte-identical to `dist/umd/supabase.js` in the npm
   tarball. That equivalence was an assumption, it was never tested, and it is false. The
   internal consistency of the npm method — an authenticated tarball, the documented
   `jsdelivr` field, a reproducible command — made a wrong answer look rigorous.

   **Therefore: an SRI digest may only be generated by hashing the exact URL in the
   `src` attribute.** Any other source is a guess wearing a proof's clothing. If the CDN
   is unreachable from where you are working, you cannot verify the digest there — get
   the value from a machine that can reach it, and do not substitute a different source.
   README's one-liner is the whole procedure:

   ```bash
   V=2.112.3
   curl -sL "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@$V" \
     | openssl dgst -sha384 -binary | openssl base64 -A
   ```

**Where the pin lives depends on whether PR #3 has merged, so check — do not trust this
paragraph.** The spec and the pin live on `claude/sri-digest-spec-lines-pvvqou`, the sole
branch carrying them, and PR #3 proposes them onto `main`:

```bash
git fetch origin main
git merge-base --is-ancestor 9843c2e origin/main \
  && echo "merged — the pin is live, since Pages serves main" \
  || echo "not merged — main still tracks @2 and has neither the spec nor the pin"
```

GitHub Pages serves `main`, so that check is also the answer to "is the pinned Supabase
tag live?". Before the merge, work from the branch: a clone of `main` gets neither this
document nor the pin, and its `index.html` line numbers are 4 lower than every reference
here. After the merge, `main` is the right base and the line numbers hold there.

Merging PR #3 is what puts the pin into production. That was deliberately kept as a
separate decision from writing the spec, because it changes what visitors load.

The private-notes work should branch from `main` once this branch is merged, or rebase
onto it.

## 11. Scope

**In scope:** the table, the RLS policy, the fetch, the render, the section and nav entry,
and the documentation changes in §9.

**Out of scope:** offline access to notes (§7), writing notes from the page (§8, decided),
any change to `trip_private`, the pachanga board, or the budget console.
