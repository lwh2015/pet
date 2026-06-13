# Plan 3 — Manual Verification (file ingestion & vault)

Run `npm run dev`. Then verify:

## Feed paths
- [ ] **Drop on pet:** drag a file onto the Live2D character → pet plays `receive`,
      and the file appears in the panel's file library (open the panel from the tray).
- [ ] **Panel "Feed file":** click "Feed file" → OS picker → choose file(s) → they
      appear in the list.
- [ ] **Drag onto panel:** drag a file onto the panel drop zone → it appears.

## Library actions
- [ ] **Open:** click Open → file launches in its default app (correct extension).
- [ ] **Reveal:** click Reveal → OS file manager highlights the blob.
- [ ] **Delete:** click Delete → row disappears; deleting the last reference to a
      blob removes it from `userData/vault/blobs/...`.
- [ ] **Search:** type in the search box → list filters by name/ext/mime.

## Dedup & integrity
- [ ] Feeding the SAME file twice (same name+content) → only ONE row.
- [ ] Feeding identical content under two different names → TWO rows, ONE blob on disk
      (check `userData/vault/blobs/<ab>/<cd>/`).

## Robustness
- [ ] DB + vault live under `userData` (Windows `%AppData%/pet`): `library.db`,
      `vault/blobs`, `vault/tmp` (empty after ingests).
- [ ] Quitting and relaunching → previously fed files still listed.
- [ ] Pet passthrough / drag / tray all still work (no Plan 1/2 regression).

## Where to find userData
- Windows: `%AppData%/pet`
- macOS: `~/Library/Application Support/pet`
