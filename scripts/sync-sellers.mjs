// Weekly sellers sync — reads the Benny's ops roster sheet (Rank + Name) and
// adds any new people to the pitstop_sellers collection, so the membership
// form's category → name dropdown stays current. Additive only: it never
// renames or removes existing entries (edit those in Admin → Sellers).
//
// Runs in CI (see .github/workflows/sync-sellers.yml). Requires:
//   - GOOGLE_APPLICATION_CREDENTIALS -> a service-account JSON with Firestore write
//   - SELLERS_SHEET_CSV -> the sheet's CSV export URL (sheet must be link-viewable)
import admin from 'firebase-admin'

const SHEET_CSV = process.env.SELLERS_SHEET_CSV
if (!SHEET_CSV) { console.error('SELLERS_SHEET_CSV is not set'); process.exit(1) }

// Minimal CSV parser that respects quoted fields (the sheet quotes every cell).
function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

const key = (category, name) => `${(category || '').trim().toLowerCase()}|${(name || '').trim().toLowerCase()}`

async function main() {
  const res = await fetch(SHEET_CSV)
  if (!res.ok) { console.error(`Sheet fetch failed: HTTP ${res.status} — is it shared as "Anyone with the link"?`); process.exit(1) }
  const rows = parseCSV(await res.text())

  // Column layout: [ , Rank, Name, Status, ... ]. Keep rows with a rank + name,
  // skipping the header ("Name") and empty rows.
  const people = []
  for (const r of rows) {
    const category = (r[1] || '').trim()
    const name = (r[2] || '').trim()
    if (!category || !name) continue
    if (name.toLowerCase() === 'name' || category.toLowerCase() === 'rank') continue
    people.push({ category, name })
  }
  if (people.length === 0) { console.error('No people parsed from the sheet — aborting to avoid a bad sync.'); process.exit(1) }

  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'pitstop-services' })
  const db = admin.firestore()

  const snap = await db.collection('pitstop_sellers').get()
  const have = new Set(snap.docs.map(d => key(d.data().category, d.data().name)))

  let added = 0
  for (const p of people) {
    if (have.has(key(p.category, p.name))) continue
    await db.collection('pitstop_sellers').add({
      name: p.name, category: p.category,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'sheet-sync',
    })
    have.add(key(p.category, p.name))
    added++
  }
  console.log(`Sellers sync: parsed ${people.length}, roster had ${snap.size}, added ${added}.`)
}

main().catch(err => { console.error('Sync failed:', err); process.exit(1) })
