# Private notes — implementation plan

**Spec:** `docs/superpowers/specs/2026-08-12-private-notes-design.md`, approved 2026-08-13.
**Status:** proposed. Not started.
**Base:** `main` at `89c69fe`.

Read the spec first. This plan does not restate the reasoning, only the work. Where the two
disagree, the spec is wrong and §7 below says why.

Line numbers here are hints. Locate code by the search patterns in spec §1.

---

## 0. Prerequisite — Supabase, done by the owner

Nothing in the page works until the table exists. This step is manual, in the Supabase SQL
editor, and is **not** part of any commit:

```sql
create table if not exists public.private_notes (
  id    bigint   generated always as identity primary key,
  title text     not null,
  body  text     not null default '',
  sort  smallint not null default 0
);

alter table public.private_notes enable row level security;

create policy "owner reads" on public.private_notes
  for select to authenticated
  using (auth.email() = '<your email>');
```

Substitute the real address for `<your email>`. No insert/update/delete policy: the page
must not be able to write (spec §3, §8).

Then verify RLS is actually on — this is the check that catches a publishable key exposing
every table:

```sql
select relname, relrowsecurity from pg_class
where relname in ('pachanga_board','trip_private','private_notes');
```

All three must show `relrowsecurity = true`.

**Ordering when seeding:** `sort` ascending, ties broken by `title`. Leave gaps (10, 20,
30) so a note can be inserted between two others without renumbering.

---

## 1. Markup — the section

Insert immediately before `<!-- CHECKLIST -->`, so the section sits between `#practical`
and `#checklist`:

```html
<!-- PRIVATE NOTES -->
<section id="notes" hidden>
  <div class="wrap">
    <div class="shead"><h2>Private notes</h2><span class="tag">visible only to you</span></div>
    <div id="notesList"></div>
  </div>
</section>
```

## 2. Markup — the nav link

**Between `#practical` and `#checklist`, not after `#packing`.** The spec says after
`#packing`; that is wrong and §7 explains the failure.

```html
  <a href="#practical">Practical</a>
  <a href="#notes" hidden>Notes</a>
  <a href="#checklist">✓ Checklist</a>
```

## 3. CSS — one rule

Next to the `.person` rules:

```css
.person p{white-space:pre-wrap}
```

Paragraph breaks in `body` otherwise collapse. Check whether `.person h4` sizing is
acceptable for a note title during step 8; add a rule only if it is not.

## 4. State

Beside `const PRIV={}`:

```js
const NOTES=[];
let NOTES_ERR=false;
```

## 5. Fetch — inside `refresh()`

Replace the existing clear-and-fetch with:

```js
Object.keys(PRIV).forEach(k=>delete PRIV[k]);
NOTES.length=0;NOTES_ERR=false;
if(email){
  const [priv,notes]=await Promise.all([
    sb.from('trip_private').select('key,value'),
    sb.from('private_notes').select('title,body,sort').order('sort').order('title')
  ]);
  if(!priv.error)(priv.data||[]).forEach(r=>{PRIV[r.key]=r.value;});
  if(notes.error)NOTES_ERR=true;else NOTES.push(...(notes.data||[]));
}
```

`applyToBudget(); paint();` stay as they are. The clears must precede `if(email)` — sign-out
takes the false branch, and clearing inside it leaves notes on screen (spec §5).

## 6. Render — inside `paint()`

Called from `paint()`, not a separate call site, so every repaint path is covered:

```js
function paintNotes(){
  const sec=$('notes'),list=$('notesList'),link=document.querySelector('#nav a[href="#notes"]');
  if(!sec||!list)return;
  const show=!!email;                       // NOT NOTES.length — see spec §4, §5
  sec.hidden=!show;if(link)link.hidden=!show;
  list.textContent='';                      // rebuild wholesale; refresh() runs more than once
  if(!show)return;
  if(NOTES_ERR){
    const p=document.createElement('p');p.className='mono';p.style.color='var(--red-t)';
    p.textContent='Could not load notes — check the table and its policy.';
    list.appendChild(p);return;
  }
  if(!NOTES.length){
    const p=document.createElement('p');p.className='mono';p.style.color='var(--dim2)';
    p.textContent='No notes yet — add them in the Supabase table editor.';
    list.appendChild(p);return;
  }
  const grid=document.createElement('div');grid.className='crew';
  NOTES.forEach(n=>{
    const card=document.createElement('div');card.className='person';
    const h=document.createElement('h4');h.textContent=n.title||'';
    const p=document.createElement('p');p.textContent=n.body||'';
    card.append(h,p);grid.appendChild(card);
  });
  list.appendChild(grid);
}
```

Add `paintNotes();` to the end of `paint()`. Built with `createElement` + `textContent`,
matching the existing idiom — no escaping needed, and no `innerHTML`.

## 7. Corrections to the spec found while planning

**The nav link position is wrong in spec §4.** It says to put the link after `#packing`
while the section sits before `#checklist`. The scrollspy builds its section list from the
**nav order**, not the document order:

```js
const links=[...document.querySelectorAll('#nav a')];
const secs=links.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);
const active=secs.map(s=>s.id).find(id=>visible.has(id));
```

The comment above that last line claims "first visible section in document order", which
holds today only because nav order and document order happen to coincide. Following §4
would break the coincidence: `#notes` would sort last, so it would win the highlight only
when no other section is on screen, and scrolling through the notes would leave "Packing"
lit. Step 2 keeps the two orders aligned.

Fold this correction back into the spec as part of this work.

## 8. Documentation

- **README, new section "Supabase — private notes"** after "Supabase — private trip
  details": the `CREATE TABLE`, the policy, the RLS check from step 0. **Placeholders only**
  — the repository is public, and the note content is exactly what was removed from the
  public page (spec §3).
- **README line 146**, the RLS verification query: extend to
  `where relname in ('pachanga_board','trip_private','private_notes')`.
- **README "Editing the content"** (line 168): a bullet saying notes are edited in Supabase,
  not in the file.
- **Auth dialog subtitle**, `index.html` line 859, "Address, booking code and costs": goes
  stale once notes sit behind the same sign-in.
- **`sw.js`: `VERSION` to `cr26-v5`.** `v4` is spent and has shipped to Pages.

## 9. Verification before it is called done

Automated, in the sandbox:

1. `node --check` on the extracted inline script.
2. Every search pattern in spec §1 still resolves.
3. Nav order matches document order (step 7's failure, caught mechanically).

Manual, by the owner — these cannot be checked from here, because the egress policy blocks
`mikom92.github.io`:

4. Signed out: no Notes section, no nav link, nothing in the page source about notes.
5. Signed in, table empty: section visible, "No notes yet…".
6. Signed in, table seeded: notes in `sort` order, paragraph breaks intact.
7. Sign out with notes on screen: section disappears — the clear-before-`if` in step 5.
8. Rename the table in Supabase, reload: "Could not load notes…", not "No notes yet…".
   This is the state the whole empty-state decision exists for; if it renders as the wrong
   message, the decision was implemented but not delivered. Rename it back afterwards.
9. Scroll through the notes: "Notes" is lit in the nav, not "Packing" (step 7).

## 10. Sequencing

One commit for steps 1–7, one for step 8. The docs commit is separate because it is the
only part that is safe to land before the table exists.

Nothing here touches the pin, the board, the budget, or `trip_private`. If a change starts
reaching into those, stop — it is out of scope (spec §11).
