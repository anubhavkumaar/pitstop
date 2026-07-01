import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { Routes, Route, Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useInView, useMotionValue, useReducedMotion, animate } from 'framer-motion'
import { db, auth, secondaryAuth, storage } from './firebase'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import {
  collection, addDoc, deleteDoc, doc, setDoc, getDoc, getDocs, onSnapshot,
  query, where, orderBy, serverTimestamp, updateDoc,
} from 'firebase/firestore'
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signOut as signOutSecondary, updatePassword,
} from 'firebase/auth'
import { CheckeredStrip } from './Logo'
import { IconWrench, IconUpgrade, IconGauge, IconWash, IconPickup, IconRescue, IconFlag, IconCash, IconCamera, IconStar } from './icons'
import { HeroBackplate } from './HeroArt'
import akLogo from './assets/blue.png'
import bennysLogo from './assets/bennys-logo.png'
import pitstopLogo from './assets/pitstop-logo-wide.png'
import brandRevealVideo from './assets/brand-reveal.mp4'
import heroGarageVideo from './assets/hero-garage.mp4'
import './App.css'

/* ─── Static seed data ─────────────────────────────────────── */

// Bootstrap owner UID — a hardcoded fallback so the very first admin can always
// reach /admin even before any pitstop_users docs exist. All subsequent admins
// are managed through /admin's Users panel and stored as role='admin' in Firestore.
const OWNER_UIDS = [
  '9Fm4u9BgskRYczz4U7xq93DEZjx2',
]
const isBootstrapOwner = user => !!user && OWNER_UIDS.includes(user.uid)
// Admin = bootstrap owner OR Firestore role='admin'
const isAdmin = (user, role) => isBootstrapOwner(user) || role === 'admin' || role === 'management'
// Staff = anyone signed in with a non-blocked role (or the bootstrap owner)
const isStaff = (user, role) => !!user && role !== 'blocked' && (isBootstrapOwner(user) || role === 'admin' || role === 'management' || role === 'crew')

// Benny's launch giveaway — narrow, single-purpose roles. Deliberately NOT
// folded into isStaff(): that gate covers the full staff dashboard (booking
// inbox, work logs, gallery, reviews), which a Soochi partner account should
// never see.
const canRepairTokens = (user, role) => isAdmin(user, role) || role === 'crew' || role === 'bennys'
const canFoodTokens   = (user, role) => isAdmin(user, role) || role === 'soochi'
// Benny's crew can issue membership tokens too (not just the dedicated
// 'membership' role) — they run the counter where memberships are sold.
const canMemberTokens = (user, role) => isAdmin(user, role) || role === 'membership' || role === 'bennys'
// Editing/deleting raw ticket entries (not just draw results) is deliberately
// narrower than isAdmin() — management only, per request, even though plain
// admins can do everything else in the giveaway tooling.
const canManageEntries = (user, role) => isBootstrapOwner(user) || role === 'management'

// Giveaway car allocation — 1 car drawn per ticket channel. The other 7 of
// the 10 launch-day cars come from separate, non-ticket activities run live
// at the event and aren't tracked by this tool.
const CARS_PER_CHANNEL = { repair: 1, food: 1, membership: 1 }
// Per-channel ticket code prefix and the human label used everywhere a draw is
// named. Keep these three channels in sync with CARS_PER_CHANNEL.
const CHANNEL_PREFIX     = { repair: 'R', food: 'F', membership: 'M' }
const CHANNEL_DRAW_LABEL = { repair: 'Repair Lucky Draw', food: 'Soochi Lucky Draw', membership: 'Membership Lucky Draw' }
const channelDrawLabel = channel => CHANNEL_DRAW_LABEL[channel] || channel

// Contact-form cooldown so one visitor can't spam the inbox.
const BOOKING_COOLDOWN_MS = 6 * 60 * 60 * 1000   // 6 hours
const BOOKING_COOLDOWN_KEY = 'pitstop_lastBookingAt'

function getBookingCooldownMs() {
  try {
    const last = +localStorage.getItem(BOOKING_COOLDOWN_KEY) || 0
    if (!last) return 0
    const remaining = BOOKING_COOLDOWN_MS - (Date.now() - last)
    return remaining > 0 ? remaining : 0
  } catch { return 0 }
}

function formatCooldown(ms) {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const TEAM_SEED = [
  { id: 'masoom',  name: 'Masoom',         role: 'Owner',             bio: 'Founded Pit Stop and runs it. Sets the direction, makes the final calls on partnerships, pricing, and crew. Spends time on the floor too — knows every car that comes through and stays close to the actual work. The reason the shop exists. Civilian.', hue: 8,   avatar: '' },
  { id: 'zara',    name: 'Zara Hayat',     role: 'Co-Owner',          bio: 'Co-owner alongside Masoom. First voice clients hear when they reach out — handles intake, scheduling, and the relationships that turn a one-time job into a repeat customer. Sits in on every big call: pricing, partnerships, crew hires. Also keeps the books and the day-to-day flow moving. Civilian.', hue: 48,  avatar: '' },
  { id: 'tyson',   name: 'Tyson Nash',     role: 'Manager',           bio: 'Part of management alongside Masoom and Zara. Strong car knowledge — knows what each model needs and what a fair build should cost. People person too: handles client conversations, structures deals, and closes jobs. Also runs the tech side of the shop — website, work logs, scheduling. Civilian. Day job: car dealer at Luxury Autos.', hue: 28,  avatar: 'https://i.vgy.me/YPplB0.png' },
  { id: 'shane',   name: 'Shane Klebitz',  role: 'Field Technician',  bio: "The shop's hands-on mechanic. Engine work, suspension, brakes, drivetrain, body — if it's bolted to a car, Shane has fixed one. Years of accumulated knowledge across makes and models, so diagnosis happens fast and the repair is right the first time. When a job is on the lift, Shane is the one with tools in hand. Civilian.", hue: 0,   avatar: '' },
  { id: 'ken',     name: 'Ken Richman',    role: 'Car Expert',        bio: 'The build and tuning specialist. Picks parts, plans modifications, and dials in the setup so the car actually performs the way it should — tyres matched to the weight, gearing tuned to the use case, suspension set up for the road or the track. If a client wants a specific feel or lap time, Ken is who maps the spec sheet to reality. Civilian.', hue: 200, avatar: '' },
]

const SERVICES = [
  { Icon: IconWrench, name: 'Full Repair',              desc: 'Body repair, engine parts, suspension, brakes — the heavy mechanical work. We return the car better than it left.',                  price: 'TBA · parts at cost' },
  { Icon: IconUpgrade, name: 'Custom Builds & Upgrades', desc: "Parts, looks, ECU tunes, suspension and drivetrain upgrades — built to your spec, not the showroom's.",                                price: 'TBA · parts at cost' },
  { Icon: IconGauge,  name: 'Stable Builds',            desc: "Daily-driver tuning that won't bite back. Balanced power, predictable handling, built to be driven hard every single day.",          price: 'TBA · parts at cost' },
  { Icon: IconFlag,   name: 'Performance Builds',       desc: 'Track-ready, straight-line monsters, whatever the spec calls for. Built for the podium, not the parking lot.',                        price: 'TBA · parts at cost' },
  { Icon: IconWash,   name: 'Wash & Cleaning',          desc: 'Exterior wash, interior wipe, glass, tire shine. The full clean.',                                                                     price: 'TBA' },
  { Icon: IconPickup, name: 'Pickup & Drop-off',        desc: "We'll grab the car from wherever and park it in whichever public garage you want. Hands-free.",                                       price: 'Included' },
  { Icon: IconRescue, name: 'Roadside Recovery',        desc: 'Wrecked it on a street race or rolled it off Chiliad? We come out, hook it up, and tow it in.',                                       price: 'TBA · tow at cost' },
]

const FAQ = [
  { q: 'Why use Pit Stop?',
    a: "The few mechanic options out there fill up fast and won't park your car for you. We close that gap end-to-end — pickup, repair, custom builds and upgrades, cleaning, and drop-off wherever you want it." },
  { q: 'Where are you located?',
    a: "Benny's Original Motor Works, our real shop, opening July 1st. We still collect from anywhere in Los Santos and drop into any public garage you want, too." },
  { q: 'What does the service fee cover?',
    a: "Pickup, all the work agreed on, full clean, and drop-off to the garage of your choice. The fee is being finalized for Benny's opening, prices announcing soon. Parts costs are passed through at cost on top." },
]

/* ─── Helpers ──────────────────────────────────────────────── */

const userDocId = email => (email || '').replace(/[@.]/g, '_')

function useAuth() {
  const [user, setUser]   = useState(null)
  const [role, setRole]   = useState(undefined)   // undefined = not loaded yet, null = signed in but no profile doc
  const [loaded, setLoaded] = useState(false)

  useEffect(() => onAuthStateChanged(auth, u => {
    setUser(u); setLoaded(true)
    if (!u) setRole(undefined)
  }), [])

  useEffect(() => {
    if (!user) return
    const unsub = onSnapshot(
      doc(db, 'pitstop_users', user.uid),
      snap => setRole(snap.exists() ? (snap.data().role || null) : null),
      () => setRole(null)
    )
    return unsub
  }, [user])

  return { user, role, loaded }
}

// Single source of truth for crew data — both the homepage teaser and the
// full /team page read this, so they can never drift out of sync with each
// other or with what's actually configured in Admin -> Roster.
function useRoster() {
  const [roster, setRoster] = useState(TEAM_SEED)
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'pitstop_roster'), orderBy('order')), snap => {
      const live = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      if (live.length) setRoster(live)
    }, () => { /* offline / not configured — fall back to seed */ })
    return unsub
  }, [])
  return roster
}

// Issues one Benny's-giveaway ticket: a short, collision-checked code plus
// the Firestore doc. One doc per ticket (buying twice = two docs) so ticket
// weight in the draw falls out naturally — no separate count field needed.
async function issueGiveawayToken({ channel, name, citizenId, note, issuer }) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const n = 1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000)
    const code = `${CHANNEL_PREFIX[channel] || 'X'}-${n}`
    const dupe = await getDocs(query(collection(db, 'bennys_tokens'), where('code', '==', code)))
    if (!dupe.empty) continue
    const issuedByLabel = issuer?.email || 'unknown'
    await addDoc(collection(db, 'bennys_tokens'), {
      code, channel, name: name.trim(), citizenId: (citizenId || '').trim(), note: (note || '').trim(),
      issuedByUid:   issuer?.uid   || null,
      issuedByLabel,
      createdAt: serverTimestamp(),
      won: false, wonPrize: null, wonAt: null,
    })
    // Fire-and-forget backup to Google Sheets (only from the /bennys and
    // /soochi issuance flow — see AdminSettings for the "only writer" intent).
    // No-op until an admin configures pitstop_secrets/sheets.
    postToSheets({ type: 'ticket', code, channel, name: name.trim(), citizenId: (citizenId || '').trim(), note: (note || '').trim(), issuedByLabel })
    logAudit({ action: 'created', code, channel, name: name.trim(), actor: issuer })
    return code
  }
  throw new Error('Could not generate a unique code — try again.')
}

async function postToSheets(payload) {
  try {
    const snap = await getDoc(doc(db, 'pitstop_secrets', 'sheets'))
    const url = snap.exists() ? (snap.data()?.url || '') : ''
    if (!url) return
    // text/plain avoids a CORS preflight against the Apps Script web app,
    // which doesn't reliably answer OPTIONS requests.
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
  } catch (err) {
    console.error('[sheets backup] failed:', err)
  }
}

// Management-only audit trail — every giveaway entry created, edited, or
// removed, who did it, and when. Write-only for whoever performed the
// action; the log itself is immutable (see firestore.rules).
async function logAudit({ action, code, channel, name, before, after, actor }) {
  try {
    await addDoc(collection(db, 'bennys_audit_log'), {
      action, code, channel, name,
      before: before || null,
      after:  after  || null,
      performedByUid:   actor?.uid   || null,
      performedByLabel: actor?.email || 'unknown',
      createdAt: serverTimestamp(),
    })
  } catch (err) {
    console.error('[audit log] failed:', err)
  }
}

// CSV export — manual backup snapshot for the giveaway (see AdminGiveaway).
function toCSV(rows, headers) {
  const escape = v => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(escape).join(',')]
  for (const row of rows) lines.push(headers.map(h => escape(row[h])).join(','))
  return lines.join('\n')
}

// Full date + time stamp (IST) for any Firestore timestamp — shared by the
// giveaway ticket tables, the winners list, and the audit log so every entry
// reads the same. Returns '—' for docs whose serverTimestamp hasn't resolved.
function fmtStamp(ts) {
  return ts?.toDate
    ? ts.toDate().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST'
    : '—'
}

function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: .55, ease: [0.22, 1, 0.36, 1] },
}

/* ─── Modal + toast system (replaces native alert / confirm) ─── */

// Tiny external store so any handler — even outside a React component — can pop
// a styled confirm dialog or a toast without threading context through props.
const uiStore = {
  confirm: null,          // { title, message, confirmLabel, cancelLabel, danger, resolve } | null
  toasts: [],             // [{ id, message, type }]
  listeners: new Set(),
  emit() { this.listeners.forEach(l => l()) },
  subscribe(l) { this.listeners.add(l); return () => this.listeners.delete(l) },
}

// Promise-based confirm: `if (await showConfirm({…})) …`. Accepts a plain string
// for quick cases, or an options object for a title / danger styling / labels.
function showConfirm(opts) {
  const o = typeof opts === 'string' ? { message: opts } : (opts || {})
  return new Promise(resolve => {
    uiStore.confirm = {
      title:        o.title        || 'Are you sure?',
      message:      o.message      || '',
      confirmLabel: o.confirmLabel || 'Confirm',
      cancelLabel:  o.cancelLabel  || 'Cancel',
      danger:       !!o.danger,
      resolve,
    }
    uiStore.emit()
  })
}

let toastSeq = 0
// Non-blocking toast (replaces alert). type: 'ok' | 'err' | 'info'.
function showToast(message, type = 'info') {
  const id = ++toastSeq
  uiStore.toasts = [...uiStore.toasts, { id, message, type }]
  uiStore.emit()
  setTimeout(() => {
    uiStore.toasts = uiStore.toasts.filter(t => t.id !== id)
    uiStore.emit()
  }, type === 'err' ? 6000 : 4000)
}

function useUiStore() {
  const [, setTick] = useState(0)
  useEffect(() => uiStore.subscribe(() => setTick(t => t + 1)), [])
  return uiStore
}

// Renders whatever the store currently holds — one confirm dialog at a time
// plus a stack of toasts. Mounted once at the app root.
function ModalHost() {
  const store = useUiStore()
  const { confirm, toasts } = store

  const resolveConfirm = result => {
    const c = store.confirm
    store.confirm = null
    store.emit()
    c?.resolve(result)
  }
  const dismissToast = id => { store.toasts = store.toasts.filter(t => t.id !== id); store.emit() }

  useEffect(() => {
    if (!confirm) return
    const onKey = e => {
      if (e.key === 'Escape') resolveConfirm(false)
      if (e.key === 'Enter')  resolveConfirm(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <AnimatePresence>
        {confirm && (
          <motion.div className="modal-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: .18 }}
            onClick={() => resolveConfirm(false)}>
            <motion.div className="modal-card" role="dialog" aria-modal="true"
              initial={{ opacity: 0, y: 16, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: .97 }}
              transition={{ duration: .22, ease: [0.22, 1, 0.36, 1] }}
              onClick={e => e.stopPropagation()}>
              <div className="modal-title">{confirm.title}</div>
              {confirm.message && <p className="modal-message">{confirm.message}</p>}
              <div className="modal-actions">
                <button className="btn btn--ghost" onClick={() => resolveConfirm(false)}>{confirm.cancelLabel}</button>
                <button className={`btn ${confirm.danger ? 'btn--del' : 'btn--primary'}`}
                  onClick={() => resolveConfirm(true)} autoFocus>{confirm.confirmLabel}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="toast-stack" aria-live="polite">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id} className={`toast toast--${t.type}`}
              initial={{ opacity: 0, y: 14, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }} transition={{ duration: .24, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => dismissToast(t.id)}>
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  )
}

/* ─── Shared chrome ────────────────────────────────────────── */

/* ─── Animation primitives ─────────────────────────────────── */

function AnimatedNumber({ value, format = (v) => Math.round(v).toLocaleString(), duration = 1.4, prefix = '', suffix = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-30px' })
  const mv = useMotionValue(0)
  const [display, setDisplay] = useState(format(0))

  useEffect(() => {
    if (!inView) return
    const controls = animate(mv, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: v => setDisplay(format(v)),
    })
    return controls.stop
  }, [inView, value, duration, format, mv])

  return <span ref={ref}>{prefix}{display}{suffix}</span>
}

function FloatingOrb({ x, y, size, color, delay = 0 }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className="orb"
      style={{
        left: x, top: y, width: size, height: size,
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
      }}
      animate={reduce ? {} : {
        x: [0, 24, -16, 0],
        y: [0, -32, 16, 0],
        scale: [1, 1.08, 0.95, 1],
      }}
      transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut', delay }}
    />
  )
}

function PageTransition({ children }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -8, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  )
}

/* ─── Mechanical floating parts ─────────────────────────────── */

// Involute-profile gear: inner/outer radii, tooth count
function gearPts(cx, cy, teeth, outerR, innerR) {
  const step = (Math.PI * 2) / teeth
  const tw = step * 0.36
  const pts = []
  for (let i = 0; i < teeth; i++) {
    const m = i * step - Math.PI / 2
    pts.push(
      `${(cx + Math.cos(m - step / 2 + tw) * innerR).toFixed(2)},${(cy + Math.sin(m - step / 2 + tw) * innerR).toFixed(2)}`,
      `${(cx + Math.cos(m - tw) * outerR).toFixed(2)},${(cy + Math.sin(m - tw) * outerR).toFixed(2)}`,
      `${(cx + Math.cos(m + tw) * outerR).toFixed(2)},${(cy + Math.sin(m + tw) * outerR).toFixed(2)}`,
      `${(cx + Math.cos(m + step / 2 - tw) * innerR).toFixed(2)},${(cy + Math.sin(m + step / 2 - tw) * innerR).toFixed(2)}`
    )
  }
  return pts.join(' ')
}

const GearSVG = ({ size, fill, teeth = 8 }) => {
  const c = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden="true">
      <polygon points={gearPts(c, c, teeth, c * 0.92, c * 0.64)} fill={fill}/>
      <circle cx={c} cy={c} r={c * 0.3} fill="rgba(0,0,0,0.35)"/>
      <circle cx={c} cy={c} r={c * 0.09} fill={fill} opacity="0.6"/>
    </svg>
  )
}

// Combination wrench: closed-ring box-end (left) + handle + open-jaw end (right)
// viewBox 200×56, wrench centered at cy=28
const WrenchSVG = ({ size, fill }) => (
  <svg width={size} height={Math.round(size * 0.28)} viewBox="0 0 200 56" fill="none" aria-hidden="true">
    {/* Box-end ring */}
    <circle cx="28" cy="28" r="26" fill={fill}/>
    {/* Handle connecting both ends */}
    <rect x="28" y="19" width="104" height="18" fill={fill}/>
    {/* Open-end — upper jaw: angled outer face, parallel inner face, jaw tip */}
    <polygon points="132,19 180,7 200,7 200,17 180,17 132,23" fill={fill}/>
    {/* Open-end — lower jaw */}
    <polygon points="132,37 180,49 200,49 200,39 180,39 132,33" fill={fill}/>
    {/* Box-end inner threaded hole */}
    <circle cx="28" cy="28" r="11" fill="rgba(0,0,0,0.4)"/>
    {/* Subtle wrench-face line on box end */}
    <circle cx="28" cy="28" r="18" fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="2"/>
  </svg>
)

// Hex-head bolt (side elevation): octagonal head + threaded shaft
const BoltSVG = ({ size, fill }) => {
  const w = size
  const headH = Math.round(w * 0.54)
  // Octagonal head — flat-top orientation (two horizontal flats, four angled faces)
  const h8 = `M${Math.round(w*0.22)},0 L${Math.round(w*0.78)},0 L${w},${Math.round(headH*0.3)} L${w},${Math.round(headH*0.7)} L${Math.round(w*0.78)},${headH} L${Math.round(w*0.22)},${headH} L0,${Math.round(headH*0.7)} L0,${Math.round(headH*0.3)} Z`
  const shaftW = Math.round(w * 0.38)
  const shaftX = Math.round((w - shaftW) / 2)
  const shaftTop = headH
  const shaftH = Math.round(w * 1.3)
  const totalH = shaftTop + shaftH
  return (
    <svg width={w} height={totalH} viewBox={`0 0 ${w} ${totalH}`} fill="none" aria-hidden="true">
      {/* Hex head */}
      <path d={h8} fill={fill}/>
      {/* Bearing-face line at base of head */}
      <line x1="0" y1={headH - 2} x2={w} y2={headH - 2} stroke="rgba(0,0,0,0.18)" strokeWidth="1.5"/>
      {/* Shaft */}
      <rect x={shaftX} y={shaftTop} width={shaftW} height={shaftH} rx="2" fill={fill}/>
      {/* Thread lines */}
      {Array.from({ length: 7 }, (_, i) => {
        const y = shaftTop + shaftH * (i + 0.5) / 7
        return <line key={i} x1={shaftX} y1={y} x2={shaftX + shaftW} y2={y}
          stroke="rgba(0,0,0,0.2)" strokeWidth="1.5"/>
      })}
    </svg>
  )
}

// Hex nut (top view): flat-top hexagon, chamfer ring, threaded through-hole
const NutSVG = ({ size, fill }) => {
  const c = size / 2, r = c * 0.93
  // Flat-top hexagon: vertices at 30°, 90°, 150°, 210°, 270°, 330°
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = i * (Math.PI / 3) + Math.PI / 6
    return `${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`
  }).join(' ')
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden="true">
      <polygon points={pts} fill={fill}/>
      {/* Chamfer circle (subtle inner bevel ring) */}
      <circle cx={c} cy={c} r={c * 0.56} fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="1.5"/>
      {/* Threaded through-hole */}
      <circle cx={c} cy={c} r={c * 0.35} fill="rgba(0,0,0,0.44)"/>
    </svg>
  )
}

function FloatingGear({ x, y, size, teeth = 8, dir = 1, delay = 0, spinDur = 16, floatDur = 9, fill = 'rgba(230,57,70,0.16)' }) {
  const reduce = useReducedMotion()
  return (
    <motion.div className="mech-part" style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0.3 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] }}>
      <motion.div
        animate={reduce ? {} : { y: [0, -14, 8, -6, 0], x: [0, 5, -3, 2, 0] }}
        transition={{ duration: floatDur, repeat: Infinity, ease: 'easeInOut', delay: delay + 0.9 }}>
        <motion.div
          animate={reduce ? {} : { rotate: dir > 0 ? [0, 360] : [0, -360] }}
          transition={{ duration: spinDur, repeat: Infinity, ease: 'linear' }}>
          <GearSVG size={size} teeth={teeth} fill={fill}/>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

// Wrench drifts horizontally, rocks slightly — like it's resting on a surface with vibration
function FloatingWrench({ x, y, size, delay = 0, fill = 'rgba(230,57,70,0.16)' }) {
  const reduce = useReducedMotion()
  return (
    <motion.div className="mech-part" style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}>
      <motion.div
        animate={reduce ? {} : { y: [0, -16, 8, -10, 0], x: [0, 10, -5, 4, 0], rotate: [-8, 6, -3, 10, -8] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: delay + 0.8 }}>
        <WrenchSVG size={size} fill={fill}/>
      </motion.div>
    </motion.div>
  )
}

// Bolt tumbles slowly — like a fastener dropped in zero-g
function FloatingBolt({ x, y, size, delay = 0, fill = 'rgba(165,180,195,0.2)' }) {
  const reduce = useReducedMotion()
  return (
    <motion.div className="mech-part" style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}>
      <motion.div
        animate={reduce ? {} : { y: [0, -20, 12, -14, 5, 0], x: [0, 5, -8, 3, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: delay + 0.7 }}>
        <motion.div
          animate={reduce ? {} : { rotate: [0, 180, 360] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}>
          <BoltSVG size={size} fill={fill}/>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

// Nut spins on its axis — like spinning on a bolt thread
function FloatingNut({ x, y, size, delay = 0, fill = 'rgba(165,180,195,0.2)' }) {
  const reduce = useReducedMotion()
  return (
    <motion.div className="mech-part" style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}>
      <motion.div
        animate={reduce ? {} : { y: [0, -10, 7, -5, 0] }}
        transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: delay + 0.7 }}>
        <motion.div
          animate={reduce ? {} : { rotate: [0, -360] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}>
          <NutSVG size={size} fill={fill}/>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

const SPARKS_DATA = [
  { x: '12%', delay: 0,   dur: 2.0, rpt: 5.5 },
  { x: '38%', delay: 1.5, dur: 2.3, rpt: 6.0 },
  { x: '64%', delay: 0.8, dur: 2.1, rpt: 5.8 },
  { x: '90%', delay: 2.2, dur: 1.8, rpt: 6.2 },
]

function Sparks() {
  const reduce = useReducedMotion()
  if (reduce) return null
  return (
    <div className="sparks-layer" aria-hidden="true">
      {SPARKS_DATA.map((s, i) => (
        <motion.div key={i} className="spark" style={{ left: s.x }}
          animate={{ y: [0, -110], opacity: [0, 1, 0.7, 0], scaleY: [1, 0.4] }}
          transition={{ duration: s.dur, delay: s.delay, repeat: Infinity, repeatDelay: s.rpt, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

// Illustrated empty state — small icon badge + title + optional subtitle
function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <motion.div className="empty-state"
      initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{duration:.4}}>
      <div className="empty-state-ic"><Icon size={30}/></div>
      <div className="empty-state-title">{title}</div>
      {subtitle && <p className="empty-state-sub">{subtitle}</p>}
    </motion.div>
  )
}

function Nav() {
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => { setOpen(false) }, [loc.pathname])
  const { user, role, loaded } = useAuth()

  const links = [
    { to: '/',         label: 'Home' },
    { to: '/services', label: 'Services' },
    { to: '/work-log', label: 'Work Log' },
    { to: '/reviews',  label: 'Reviews' },
    { to: '/gallery',  label: 'Gallery' },
    { to: '/team',     label: 'Crew' },
    { to: '/request',  label: 'Contact' },
    // /pitch is intentionally unlinked — reachable by direct URL only.
  ]

  // The signed-in side of the nav grows with whatever this account can
  // actually do — a crew login sees nothing extra, an admin sees everything.
  const roleLinks = (loaded && user) ? [
    canRepairTokens(user, role) && { to: '/bennys', label: "Benny's" },
    canFoodTokens(user, role)   && { to: '/soochi', label: 'Soochi' },
    canMemberTokens(user, role) && { to: '/membership', label: 'Membership' },
    isAdmin(user, role)         && { to: '/admin',  label: 'Admin' },
  ].filter(Boolean) : []

  return (
    <header className="nav">
      <Link to="/" className="nav-brand">
        <img src={bennysLogo} alt="Benny's Original Motor Works" className="nav-logo"/>
        <span className="nav-brand-by">by</span>
        <img src={pitstopLogo} alt="Pit Stop" className="nav-logo-sub"/>
      </Link>
      <button className="nav-burger" aria-label="Menu" onClick={() => setOpen(o => !o)}>
        <span/><span/><span/>
      </button>
      <nav className={`nav-links ${open ? 'is-open' : ''}`}>
        {links.map(l => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({isActive}) => `nav-link ${isActive ? 'is-active' : ''}`}>
            {l.label}
          </NavLink>
        ))}
        {roleLinks.map(l => (
          <NavLink key={l.to} to={l.to} className={({isActive}) => `nav-link nav-link--role ${isActive ? 'is-active' : ''}`}>
            {l.label}
          </NavLink>
        ))}
        {loaded && user ? (
          <span className="nav-user">
            <Link to="/staff" className="nav-link nav-link--ghost" title={user.email}>Staff</Link>
            <button className="nav-link nav-link--ghost" onClick={() => signOut(auth)}>Sign out</button>
          </span>
        ) : (
          <Link to="/staff" className="nav-link nav-link--ghost">Sign in</Link>
        )}
      </nav>
    </header>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <CheckeredStrip height={4}/>
      <div className="footer-inner">
        <div className="footer-brand">
          <img src={bennysLogo} alt="Benny's Original Motor Works" className="footer-logo"/>
          <div className="footer-brand-sub">
            <span className="nav-brand-by">by</span>
            <img src={pitstopLogo} alt="Pit Stop" className="footer-logo-sub"/>
            <div className="footer-tag">San Andreas</div>
          </div>
        </div>
        <div className="footer-cols">
          <div>
            <div className="footer-h">Location</div>
            <div>Benny's Original Motor Works</div>
            <div className="t3">Pickup & drop-off still available anywhere in Los Santos</div>
          </div>
          <div>
            <div className="footer-h">Contact</div>
            <div><b>Services app → Mechanics → Pit Stop</b></div>
            <div className="t3">Call or text any crew member directly</div>
          </div>
          <div>
            <div className="footer-h">Hours</div>
            <div>Whenever the crew is on shift</div>
            <div className="t3">24/7 best-effort</div>
          </div>
        </div>
      </div>
      <div className="footer-fine">
        <div>© {new Date().getFullYear()} Pit Stop · Los Santos</div>
        <div className="credit">
          Made &amp; designed by
          <img className="credit-ak" src={akLogo} alt="AK" width="28" height="28"/>
        </div>
      </div>
    </footer>
  )
}

/* ─── HOME ─────────────────────────────────────────────────── */

function BennysAnnounce() {
  return (
    <section className="bennys-announce">
      <motion.div className="bennys-announce-card" {...fadeUp}>
        <div className="bennys-announce-video-wrap">
          <video
            className="bennys-announce-video"
            src={brandRevealVideo}
            autoPlay muted loop playsInline
            aria-label="Pit Stop's logo transforming into Benny's Original Motor Works"
          />
          {/* Masks the AI video tool's watermark in the corner — not part of the brand mark. */}
          <div className="bennys-announce-video-mask" aria-hidden="true"/>
        </div>
        <div className="bennys-announce-body">
          <div className="bennys-announce-kicker">Now opening · July 1st</div>
          <h2 className="bennys-announce-title">A real shop, finally. Benny's is opening.</h2>
          <p className="bennys-announce-sub">
            To celebrate, we're giving away 10 cars on launch day across a full day of activities.
            Three of them: every paid repair earns a raffle ticket, so does every meal from our
            friends at Soochi, and so does every membership you pick up — all drawn live, day one.
          </p>
          <Link to="/services" className="btn btn--primary btn--magnetic">Book a repair →</Link>
        </div>
      </motion.div>
    </section>
  )
}

function ServiceBoard({ items, lg = false }) {
  return (
    <div className={`service-board ${lg ? 'service-board--lg' : ''}`}>
      {items.map((s, i) => (
        <motion.div key={s.name} className="service-row"
          initial={{opacity:0, y:16}} whileInView={{opacity:1, y:0}}
          viewport={{once:true, margin:'-40px'}}
          transition={{duration:.45, delay: i*0.04}}>
          <div className="service-row-ic"><s.Icon size={22}/></div>
          <div className="service-row-body">
            <div className="service-row-name">{s.name}</div>
            <p className="service-row-desc">{s.desc}</p>
          </div>
          <div className="service-row-price">{s.price}</div>
        </motion.div>
      ))}
    </div>
  )
}

function ServiceTagRow({ items }) {
  return (
    <div className="service-tags">
      {items.map(s => (
        <div key={s.name} className="service-tag">
          <s.Icon size={16}/>
          <span>{s.name}</span>
        </div>
      ))}
    </div>
  )
}

function CrewStrip({ roster }) {
  return (
    <div className="crew-strip">
      {roster.map((m, i) => (
        <motion.div key={m.id} className="crew-chip"
          style={{ '--hue': m.hue }}
          initial={{opacity:0, y:14}} whileInView={{opacity:1, y:0}}
          viewport={{once:true, margin:'-40px'}}
          transition={{duration:.45, delay: i*0.05}}>
          <div className={`crew-chip-avatar ${m.avatar ? 'crew-chip-avatar--img' : ''}`} aria-hidden="true">
            {m.avatar
              ? <img src={m.avatar} alt={m.name}/>
              : <span>{m.name.split(' ').map(x => x[0]).slice(0,2).join('')}</span>}
          </div>
          <div className="crew-chip-name">{m.name}</div>
          <div className="crew-chip-role">{m.role}</div>
        </motion.div>
      ))}
    </div>
  )
}

function HomePage() {
  const roster = useRoster()
  return (
    <main className="page page--home">

      <section className="hero">
        <video className="hero-video-bg" src={heroGarageVideo} autoPlay muted loop playsInline aria-hidden="true"/>
        <div className="hero-vignette" aria-hidden="true"/>
        <div className="hero-video-mask" aria-hidden="true"/>
        <HeroBackplate/>
        <div className="hero-grain" aria-hidden="true"/>
        <div className="hero-orbs" aria-hidden="true">
          <FloatingOrb x="10%"  y="20%" size={320} color="rgba(230,57,70,0.16)" delay={0}/>
          <FloatingOrb x="75%"  y="65%" size={260} color="rgba(230,57,70,0.12)" delay={2.5}/>
          <FloatingOrb x="55%"  y="10%" size={200} color="rgba(245,197,24,0.10)" delay={5}/>
        </div>

        <div className="hero-parts" aria-hidden="true">
          <FloatingGear  x="72%" y="4%"  size={96}  teeth={10} dir={1}  delay={0}   spinDur={20} floatDur={10}/>
          <FloatingGear  x="2%"  y="52%" size={72}  teeth={8}  dir={-1} delay={1.5} spinDur={24} floatDur={12}/>
          <FloatingWrench x="86%" y="46%" size={58} delay={0.8}/>
          <FloatingBolt   x="46%" y="3%"  size={28} delay={0.4}/>
          <FloatingNut    x="20%" y="22%" size={32} delay={2.5}/>
        </div>
        <Sparks/>

        <div className="hero-content">
        <motion.div className="hero-eyebrow"
          initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{duration:.5}}>
          <span className="dot"/> <span className="hero-eyebrow-text">Benny's Original Motor Works · Los Santos</span>
        </motion.div>

        <motion.h1 className="hero-title"
          initial="hidden" animate="visible"
          variants={{
            hidden: { opacity: 1 },
            visible: { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
          }}>
          {['Harmony’s far.', 'Paleto’s farther.'].map((line, i) => (
            <motion.span key={i} className="hero-line hero-line--setup"
              variants={{
                hidden:  { opacity: 0, y: 28, filter: 'blur(8px)' },
                visible: { opacity: 1, y: 0,  filter: 'blur(0px)' },
              }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
              {line}
            </motion.span>
          ))}
          <motion.span className="hero-line hero-accent"
            variants={{
              hidden:  { opacity: 0, y: 28, filter: 'blur(8px)' },
              visible: { opacity: 1, y: 0,  filter: 'blur(0px)' },
            }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}>
            Benny's. Right here. Open now.
          </motion.span>
        </motion.h1>

        <motion.p className="hero-sub"
          initial={{opacity:0, y:12}} animate={{opacity:1, y:0}} transition={{duration:.7, delay:.55}}>
          Pit Stop's first real shop, opening July 1st. Full repair, custom builds, performance upgrades,
          detailing — walk in, or we'll still come to you. Fee, prices announcing soon.
        </motion.p>
        <motion.div className="hero-cta"
          initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{duration:.5, delay:.7}}>
          <Link to="/services" className="btn btn--primary btn--magnetic">See services →</Link>
          <Link to="/work-log" className="btn btn--ghost btn--magnetic">Work log</Link>
        </motion.div>

        <motion.div className="hero-strip"
          initial={{opacity:0, y:14}} animate={{opacity:1, y:0}} transition={{duration:.6, delay:.85}}>
          <div className="strip-cell">
            <b>Jul 1st</b>
            <span>Benny's opens</span>
          </div>
          <div className="strip-cell">
            <b>Custom</b>
            <span>builds & upgrades</span>
          </div>
          <div className="strip-cell">
            <b><AnimatedNumber value={24} suffix="/7"/></b>
            <span>best-effort pickup</span>
          </div>
          <div className="strip-cell">
            <b><AnimatedNumber value={5} suffix="+"/></b>
            <span>core crew</span>
          </div>
        </motion.div>
        </div>
      </section>

      <BennysAnnounce/>

      <section className="section section--services">
        <motion.div {...fadeUp} className="section-head">
          <div className="kicker">What we do</div>
          <h2 className="section-title">The full pit-stop, on demand.</h2>
          <p className="section-sub">
            The existing options fill up fast and barely touch builds. Nobody picks the
            car up. Nobody parks it for you. We close that gap end-to-end.
          </p>
        </motion.div>

        <ServiceTagRow items={SERVICES}/>
        <div className="section-foot">
          <Link to="/services" className="btn btn--primary">Full services &amp; pricing →</Link>
        </div>
      </section>

      <section className="section section--alt">
        <motion.div {...fadeUp} className="section-head">
          <div className="kicker">The crew</div>
          <h2 className="section-title">The crew.</h2>
          <p className="section-sub">
            Real people, real specialties — mechanic work, builds, ops, and the tech keeping the lights on.
          </p>
        </motion.div>

        <CrewStrip roster={roster.slice(0, 5)}/>
        <div className="section-foot">
          <Link to="/team" className="btn btn--ghost">Full bios →</Link>
        </div>
      </section>

      <section className="section">
        <motion.div {...fadeUp} className="section-head">
          <div className="kicker">Pricing</div>
          <h2 className="section-title">New shop, new board.</h2>
        </motion.div>

        <div className="price-board">
          <div className="price-row"><span>Service fee (any scope)</span><b>TBA</b></div>
          <div className="price-row"><span>Repair, builds & upgrades (parts)</span><b>At cost</b></div>
          <div className="price-row"><span>Pickup &amp; drop-off</span><b>Included</b></div>
          <div className="price-row price-row--total">
            <span>What you pay</span>
            <b className="t2">Prices are being finalized for Benny's opening — announcing soon. Parts are always passed through at cost.</b>
          </div>
        </div>
      </section>

      <section className="section">
        <motion.div {...fadeUp} className="section-head">
          <div className="kicker">FAQ</div>
          <h2 className="section-title">Common questions.</h2>
        </motion.div>
        <div className="faq">
          {FAQ.map((f, i) => <FaqItem key={i} q={f.q} a={f.a}/>)}
        </div>
      </section>

      <section className="section section--cta">
        <motion.div {...fadeUp} className="cta-card">
          <div className="cta-badge"><span className="dot"/> Fastest way to reach us</div>
          <h2 className="cta-title">Open the Services app. Call or text any crew member.</h2>
          <p className="cta-sub">Pull out your phone, open the <b>Services app</b>, find <b>Pit Stop</b> under Mechanics, and tap any crew member to call or text. The form on /contact is here as a backup if you can&apos;t reach anyone.</p>
          <div className="cta-actions">
            <Link to="/team"    className="btn btn--primary btn--lg">See the crew →</Link>
            <Link to="/request" className="btn btn--ghost btn--lg">Or use the form</Link>
          </div>
        </motion.div>
      </section>

    </main>
  )
}

function TeamCard({ m, i = 0 }) {
  return (
    <motion.div className="team-card"
      style={{ '--hue': m.hue }}
      initial={{opacity:0, y:20}} whileInView={{opacity:1, y:0}}
      viewport={{once:true, margin:'-40px'}}
      transition={{duration:.5, delay: i*0.05}}>
      <div className="team-card-corner" aria-hidden="true"/>
      <div className={`team-avatar ${m.avatar ? 'team-avatar--img' : ''}`} aria-hidden="true">
        {m.avatar
          ? <img src={m.avatar} alt={m.name}/>
          : <span>{m.name.split(' ').map(x => x[0]).slice(0,2).join('')}</span>}
      </div>
      <div className="team-meta">
        <div className="team-name">{m.name}</div>
        <span className="team-role-pill">{m.role}</span>
        <p className="team-bio">{m.bio}</p>
      </div>
    </motion.div>
  )
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <motion.div className={`faq-item ${open ? 'is-open' : ''}`} {...fadeUp}>
      <button className="faq-q" onClick={() => setOpen(o => !o)}>
        <span>{q}</span>
        <span className="faq-caret" aria-hidden="true">{open ? '–' : '+'}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="faq-a"
            initial={{height:0, opacity:0}}
            animate={{height:'auto', opacity:1}}
            exit={{height:0, opacity:0}}
            transition={{duration:.25}}>
            <p>{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ─── SERVICES ─────────────────────────────────────────────── */

function ServicesPage() {
  return (
    <main className="page">
      <PageHeader kicker="Services" title="Everything we do, on the board.">
        Repair, custom builds, performance upgrades, or just a wash — pick what you need. It&apos;s one
        service fee either way — pickup, work, clean, and drop-off included — prices announcing soon
        for Benny's opening. Parts are passed through at cost.
      </PageHeader>

      <section className="section section--services">
        <ServiceBoard items={SERVICES} lg/>
      </section>

      <section className="section">
        <div className="proc">
          <div className="proc-h">How a job runs</div>
          <ol className="proc-list">
            <li><b>Book.</b> Drop your name, plate, and where the car is.</li>
            <li><b>Pickup.</b> A crew member rolls out and collects the vehicle.</li>
            <li><b>Work.</b> Repair, builds, upgrades, cleaning — whichever scope you asked for.</li>
            <li><b>Drop.</b> Parked in whichever public garage you choose.</li>
            <li><b>Bill.</b> Service fee (TBA) + parts at cost. Paid on delivery.</li>
          </ol>
        </div>
      </section>
    </main>
  )
}

/* ─── TEAM ─────────────────────────────────────────────────── */

function TeamPage() {
  const roster = useRoster()

  return (
    <main className="page">
      <PageHeader kicker="Crew" title="The people behind Benny's.">
        The Pit Stop crew, now running a real shop. Real specialties — mechanic work, build expertise, ops, and tech. Tyson also works at Luxury Autos as a car dealer.
      </PageHeader>

      <section className="section">
        <div className="team-grid">
          {roster.map((m, i) => <TeamCard key={m.id} m={m} i={i}/>)}
        </div>
        <div className="t3 center" style={{marginTop:'1.5rem'}}>
          More crew joining as we scale. Want in? Talk to Zara.
        </div>
      </section>
    </main>
  )
}

/* ─── REQUEST ──────────────────────────────────────────────── */

function RequestPage() {
  const [form, setForm] = useState({
    clientName: '', contact: '', carCount: 1, vehicle: '',
    location: '', scope: [], dropGarage: '', notes: '',
  })
  const [status, setStatus] = useState({ state: 'idle', msg: '' })
  const [cooldownMs, setCooldownMs] = useState(() => getBookingCooldownMs())
  const onCooldown = cooldownMs > 0

  useEffect(() => {
    if (!onCooldown) return
    const tick = () => {
      const next = getBookingCooldownMs()
      setCooldownMs(next)
    }
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [onCooldown])

  const toggleScope = s => setForm(f => ({
    ...f,
    scope: f.scope.includes(s) ? f.scope.filter(x => x !== s) : [...f.scope, s],
  }))

  const submit = async e => {
    e.preventDefault()
    if (onCooldown) {
      setStatus({ state: 'err', msg: `You sent a message recently — please wait ${formatCooldown(cooldownMs)} before sending another, or use the Services app to reach us right now.` }); return
    }
    if (!form.clientName.trim()) {
      setStatus({ state: 'err', msg: 'Your name is required so we know who to call back.' }); return
    }
    setStatus({ state: 'sending', msg: '' })
    try {
      await addDoc(collection(db, 'pitstop_requests'), {
        ...form,
        carCount: +form.carCount || 1,
        status: 'new',
        createdAt: serverTimestamp(),
      })
      try { localStorage.setItem(BOOKING_COOLDOWN_KEY, String(Date.now())) } catch {}
      setCooldownMs(BOOKING_COOLDOWN_MS)
      setStatus({ state: 'ok', msg: 'Message sent. The crew will get back to you.' })
      setForm({ clientName: '', contact: '', carCount: 1, vehicle: '', location: '', scope: [], dropGarage: '', notes: '' })
    } catch (err) {
      setStatus({ state: 'err', msg: 'Could not send — check your connection and try again.' })
    }
  }

  const scopes = ['Full Repair', 'Custom Build / Upgrade', 'Wash & Cleaning', 'Roadside Recovery', 'Pickup & Drop-off']

  return (
    <main className="page">
      <PageHeader kicker="Contact" title="The fastest way to reach us is your phone.">
        Open the Services app and call or text any of our crew directly. The form below is just a backup.
      </PageHeader>

      <section className="section section--narrow">
        <motion.div className="services-app-callout" {...fadeUp}>
          <div className="sa-icon" aria-hidden="true">
            <svg viewBox="0 0 64 64" fill="none">
              <rect x="18" y="6" width="28" height="52" rx="6" fill="#0B0B0F" stroke="#E63946" strokeWidth="2.5"/>
              <rect x="22" y="12" width="20" height="32" rx="2" fill="#15171C"/>
              <circle cx="32" cy="51" r="2.5" fill="#E63946"/>
              <path d="M27 22 L32 27 L37 22 M32 27 L32 38" stroke="#E63946" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
          </div>
          <div className="sa-body">
            <div className="sa-eyebrow">Primary contact channel</div>
            <h2 className="sa-title">Services app · Mechanics · Pit Stop</h2>
            <p className="sa-steps">
              Open your phone → <b>Services</b> app → <b>Mechanics</b> → <b>Pit Stop</b> → tap any crew member to <b>call</b> or <b>text</b>.
            </p>
            <Link to="/team" className="btn btn--primary btn--sm">See who&apos;s on the crew →</Link>
          </div>
        </motion.div>

        <div className="services-app-divider">
          <span>or leave a message below</span>
        </div>

        {onCooldown && (
          <div className="cooldown-banner">
            <div className="cooldown-h">You&apos;ve already sent a message recently.</div>
            <p>
              The contact form is rate-limited to one message every 6 hours. Try again in <b>{formatCooldown(cooldownMs)}</b>,
              or reach out via the Services app right now — that&apos;s the fastest path anyway.
            </p>
          </div>
        )}

        <form className="form" onSubmit={submit}>
          <div className="form-row">
            <label className="field">
              <span>Your name *</span>
              <input value={form.clientName} onChange={e => setForm({...form, clientName: e.target.value})} placeholder="Tyson Nash"/>
            </label>
            <label className="field">
              <span>How to reach you (phone)</span>
              <input value={form.contact} onChange={e => setForm({...form, contact: e.target.value})} placeholder="555-0140"/>
            </label>
          </div>

          <div className="form-row">
            <label className="field">
              <span>How many cars?</span>
              <input type="number" min="1" value={form.carCount} onChange={e => setForm({...form, carCount: e.target.value})}/>
            </label>
            <label className="field">
              <span>What kind?</span>
              <input value={form.vehicle} onChange={e => setForm({...form, vehicle: e.target.value})} placeholder="Sultan Classic Custom, or list a few"/>
            </label>
          </div>

          <label className="field">
            <span>Where are the cars now?</span>
            <input value={form.location} onChange={e => setForm({...form, location: e.target.value})} placeholder="Outside Legion Square, Vinewood, Sandy Shores garage…"/>
          </label>

          <div className="field">
            <span>What do you need?</span>
            <div className="chips">
              {scopes.map(s => (
                <button type="button" key={s}
                  className={`chip ${form.scope.includes(s) ? 'chip--on' : ''}`}
                  onClick={() => toggleScope(s)}>{s}</button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Drop the car(s) at which garage?</span>
            <input value={form.dropGarage} onChange={e => setForm({...form, dropGarage: e.target.value})} placeholder="Eclipse Towers, Casino, Sandy Shores…"/>
          </label>

          <label className="field">
            <span>Anything else?</span>
            <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={3}
              placeholder="Brake mod / specific parts you already have / leaving car keys with valet…"/>
          </label>

          <div className="form-foot">
            <button type="submit" className="btn btn--primary"
              disabled={status.state === 'sending' || onCooldown}
              title={onCooldown ? `Cooldown: ${formatCooldown(cooldownMs)} left` : ''}>
              {onCooldown
                ? `Cooldown · try again in ${formatCooldown(cooldownMs)}`
                : status.state === 'sending' ? 'Sending…' : 'Send message →'}
            </button>
            {status.state === 'ok'  && <span className="form-ok">{status.msg}</span>}
            {status.state === 'err' && <span className="form-err">{status.msg}</span>}
          </div>
        </form>
      </section>
    </main>
  )
}

/* ─── ImageField (URL paste or upload) ─────────────────────── */

async function uploadImageToStorage(file, folder) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${folder || 'pitstop_uploads'}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`
  const ref  = storageRef(storage, path)
  await uploadBytes(ref, file, { contentType: file.type })
  return await getDownloadURL(ref)
}

// Upload to vgy.me using the admin-stored userkey. Returns the public i.vgy.me URL.
// Throws on any failure so the caller can fall back.
async function uploadImageToVgy(file, userkey) {
  if (!userkey) throw new Error('No vgy.me token configured.')
  const form = new FormData()
  form.append('file', file)
  form.append('userkey', userkey)
  const res = await fetch('https://vgy.me/upload', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`vgy.me responded ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(data.messages?.[0] || 'vgy.me rejected the upload')
  const url = data.image || data.url
  if (!url) throw new Error('vgy.me did not return an image URL')
  return url
}

function ImageField({ label, value, onChange, folder = 'pitstop_uploads', placeholder, hideLabel = false, vgyToken = null, urlOnly = false }) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  const uploadFile = async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setErr('Pick an image file.'); return }
    if (file.size > 8 * 1024 * 1024)     { setErr('File too big — max 8 MB.'); return }
    setErr(''); setUploading(true)
    try {
      let url
      if (vgyToken) {
        try {
          url = await uploadImageToVgy(file, vgyToken)
        } catch (vgyErr) {
          console.warn('[image upload] vgy.me failed, falling back to Firebase Storage:', vgyErr)
        }
      }
      if (!url) url = await uploadImageToStorage(file, folder)
      onChange(url)
    } catch (e2) {
      console.error('[image upload] failed:', e2)
      setErr('Upload failed: ' + (e2.message || e2.code || 'unknown error'))
    }
    setUploading(false)
  }

  const pickFile = () => inputRef.current?.click()
  const onFile = e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) uploadFile(file)
  }

  // Ctrl/Cmd+V on the URL input: if clipboard has an image (e.g. from the
  // Snipping Tool), upload it instead of pasting raw text.
  // In urlOnly mode we skip this — only text URL pastes are accepted.
  const onPaste = e => {
    if (urlOnly) return
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          uploadFile(file)
          return
        }
      }
    }
    // else: fall through, default text paste behavior
  }

  const onDrop = e => {
    if (urlOnly) return
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) uploadFile(file)
  }

  const handleDragOver = e => {
    if (urlOnly) return
    e.preventDefault()
    setDragOver(true)
  }

  return (
    <label className={`field image-field ${hideLabel ? 'image-field--bare' : ''} ${dragOver ? 'image-field--drag' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}>
      {!hideLabel && <span>{label}</span>}
      <div className="image-field-row">
        <input
          type="text"
          className="image-field-url"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          onPaste={onPaste}
          placeholder={placeholder || (urlOnly ? 'Paste an image URL (e.g. https://i.vgy.me/…)' : 'Paste URL · Ctrl+V an image · or upload →')}
        />
        {!urlOnly && (
          <button type="button" className={`image-field-btn ${vgyToken ? 'image-field-btn--vgy' : ''}`}
            onClick={pickFile} disabled={uploading}
            title={vgyToken ? 'Uploads to vgy.me (clean URL)' : 'Uploads to Firebase Storage'}>
            {uploading ? '…' : 'Upload'}
          </button>
        )}
        {value && (
          <button type="button" className="image-field-clear" onClick={() => onChange('')} title="Clear">×</button>
        )}
        {!urlOnly && <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFile}/>}
      </div>
      {value && (
        <a href={value} target="_blank" rel="noreferrer" className="image-field-preview">
          <img src={value} alt={label || ''} loading="lazy"/>
        </a>
      )}
      {dragOver && !urlOnly && <div className="image-field-drop-hint">Drop the image to upload</div>}
      {err && <span className="form-err">{err}</span>}
    </label>
  )
}

/* ─── Modal primitive ──────────────────────────────────────── */

function Modal({ open, onClose, children, title, wide }) {
  useEffect(() => {
    if (!open) return
    const onEsc = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEsc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal" onClick={onClose}
          initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0, transition:{duration:.14}}}
          transition={{duration:.2}}>
          <motion.div className={`modal-card ${wide ? 'modal-card--wide' : ''}`}
            onClick={e => e.stopPropagation()}
            initial={{opacity:0, y:14, scale:.98}}
            animate={{opacity:1, y:0,  scale:1}}
            exit={{opacity:0, y:8, scale:.98, transition:{duration:.15, ease:[0.4,0,1,1]}}}
            transition={{duration:.22, ease:[0.22, 1, 0.36, 1]}}>
            <div className="modal-head">
              <div className="modal-title">{title}</div>
              <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
            </div>
            <div className="modal-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ─── Lightbox (multi-image viewer) ────────────────────────── */

function Lightbox({ lightbox, onClose, onChange }) {
  const total = lightbox?.images?.length || 0
  const idx   = lightbox?.index ?? 0
  const img   = total > 0 ? lightbox.images[idx] : null

  const go = useMemo(() => ({
    prev: () => onChange({ ...lightbox, index: (idx - 1 + total) % total }),
    next: () => onChange({ ...lightbox, index: (idx + 1) % total }),
  }), [lightbox, idx, total, onChange])

  useEffect(() => {
    if (!lightbox) return
    const onKey = e => {
      if (e.key === 'Escape')     onClose()
      if (e.key === 'ArrowLeft'  && total > 1) go.prev()
      if (e.key === 'ArrowRight' && total > 1) go.next()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [lightbox, total, onClose, go])

  return (
    <AnimatePresence>
      {lightbox && img && (
        <motion.div className="lightbox" onClick={onClose}
          initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0, transition:{duration:.14}}}
          transition={{duration:.2}}>

          <motion.div className="lightbox-card" onClick={e => e.stopPropagation()}
            initial={{opacity:0, scale:.96, y:10}}
            animate={{opacity:1, scale:1,   y:0}}
            exit={{opacity:0, scale:.97, y:6, transition:{duration:.15, ease:[0.4,0,1,1]}}}
            transition={{duration:.22, ease:[0.22, 1, 0.36, 1]}}>

            <div className="lightbox-bar">
              {lightbox.title && <div className="lightbox-title">{lightbox.title}</div>}
              <div className="lightbox-counter">
                <b>{img.label}</b>
                {total > 1 && <span> · {idx + 1} of {total}</span>}
              </div>
              <button className="lightbox-close" onClick={onClose} aria-label="Close (Esc)">
                <span>×</span>
                <span className="lightbox-close-text">Close</span>
              </button>
            </div>

            <div className="lightbox-stage-wrap">
              <motion.div className="lightbox-stage" key={img.url}
                initial={{opacity:0, scale:.97}} animate={{opacity:1, scale:1}}
                exit={{opacity:0, scale:.97}} transition={{duration:.2}}>
                <img src={img.url} alt={img.label}/>
              </motion.div>

              {total > 1 && (
                <>
                  <button className="lightbox-nav lightbox-nav--prev" onClick={go.prev} aria-label="Previous (←)">‹</button>
                  <button className="lightbox-nav lightbox-nav--next" onClick={go.next} aria-label="Next (→)">›</button>
                </>
              )}
            </div>

            {total > 1 && (
              <div className="lightbox-strip">
                {lightbox.images.map((it, i) => (
                  <button key={i}
                    className={`lightbox-dot ${i === idx ? 'is-on' : ''}`}
                    onClick={() => onChange({ ...lightbox, index: i })}>
                    {it.label}
                  </button>
                ))}
              </div>
            )}

            <div className="lightbox-hint">Esc to close · ← → to navigate</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ─── WORK LOG (public portfolio) ──────────────────────────── */

const todayISO = () => new Date().toISOString().slice(0, 10)

const EMPTY_LOG = {
  clientName: '', vehicle: '', plate: '',
  jobDate: todayISO(),
  scope: [],
  costBreakdown: { repair: '', serviceFee: '', extras: '', extrasLabel: '' },
  evidence: { bill: '', before: '', after: '' },
  extraImages: [],
  handledBy: '', notes: '',
  paid: false,
}

function logToDraft(log) {
  if (!log) return { ...EMPTY_LOG, jobDate: todayISO() }
  return {
    clientName: log.clientName || '',
    vehicle:    log.vehicle    || '',
    plate:      log.plate      || '',
    jobDate:    log.jobDate    || (log.createdAt?.toDate ? log.createdAt.toDate().toISOString().slice(0,10) : todayISO()),
    scope:      log.scope      || [],
    costBreakdown: {
      repair:      log.costBreakdown?.repair ?? log.costBreakdown?.parts ?? '',
      serviceFee:  log.costBreakdown?.serviceFee ?? '',
      extras:      log.costBreakdown?.extras ?? '',
      extrasLabel: log.costBreakdown?.extrasLabel || '',
    },
    evidence: {
      bill:   log.evidence?.bill   || '',
      before: log.evidence?.before || '',
      after:  log.evidence?.after  || '',
    },
    extraImages: (log.extraImages || []).map(x => ({ label: x.label || '', url: x.url || '' })),
    handledBy: (log.handledBy || []).join(', '),
    notes:     log.notes || '',
    paid:      log.paid ?? false,
  }
}

function logTotal(log) {
  const cb = log.costBreakdown || {}
  const repair = +(cb.repair ?? cb.parts ?? 0) || 0
  return log.total ?? (repair + (+cb.serviceFee || 0) + (+cb.extras || 0))
}

function WorkLogPage() {
  const [logs, setLogs] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const [modal, setModal] = useState(null)
  const [billMode, setBillMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [billCopied, setBillCopied] = useState(false)
  const { user } = useAuth()

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'pitstop_logs'), orderBy('createdAt', 'desc')),
      snap => { setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoaded(true) },
      err => { console.error('[work-log] read failed:', err); setLoaded(true) }
    )
    return unsub
  }, [])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return logs
    return logs.filter(l => {
      const hay = [l.clientName, l.vehicle, l.plate, ...(l.scope || []), ...(l.handledBy || [])]
        .filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [logs, filter])

  const remove = async log => {
    if (!(await showConfirm({ title: 'Delete work log?', message: `Delete the log for ${log.clientName || 'this customer'}? This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return
    try { await deleteDoc(doc(db, 'pitstop_logs', log.id)) }
    catch (err) { showToast('Delete failed: ' + (err.message || err.code || 'unknown error'), 'err') }
  }

  const toggleSelect = id => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const exitBillMode = () => { setBillMode(false); setSelected(new Set()) }

  const billTotal = useMemo(() =>
    logs.filter(l => selected.has(l.id)).reduce((sum, l) => sum + logTotal(l), 0),
    [logs, selected]
  )

  const copyBill = async () => {
    const msg = `Thank you for using services provided by PIT STOP. Your total bill is $${billTotal.toLocaleString()}. Requesting you to make the payment to A/C No. 4791 3057\n\nTo take a look at your detailed bill, you can visit -> pitstop-services.web.app/work-log`
    try {
      await navigator.clipboard.writeText(msg)
      setBillCopied(true); setTimeout(() => setBillCopied(false), 2500)
    } catch { window.prompt('Copy this bill message:', msg) }
  }

  return (
    <main className="page">
      <PageHeader kicker="Work Log" title="Every job we've done.">
        A running ledger of completed work — cars, scope, totals, before/after photos, and bills.
        Updated by the crew after every job.
      </PageHeader>

      <section className="section">
        <div className="log-bar">
          <input
            className="log-search"
            placeholder="Search by name, car, plate, scope…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <div className="log-count t3">{filtered.length} {filtered.length === 1 ? 'job' : 'jobs'}</div>
          {user && !billMode && <>
            <button className="btn btn--ghost btn--sm" onClick={() => setBillMode(true)}>Calculate bill</button>
            <button className="btn btn--primary btn--sm" onClick={() => setModal({ mode: 'new' })}>+ Add entry</button>
          </>}
          {user && billMode && (
            <button className="btn btn--del btn--sm" onClick={exitBillMode}>Cancel</button>
          )}
        </div>

        {billMode && (
          <div className="bill-bar">
            <div className="bill-bar-info">
              {selected.size === 0
                ? <span className="t3">Tap job cards to select them for billing</span>
                : <>
                    <span className="bill-bar-count">{selected.size} {selected.size === 1 ? 'job' : 'jobs'} selected</span>
                    <span className="bill-bar-sep">·</span>
                    <span className="bill-bar-total">${billTotal.toLocaleString()}</span>
                  </>
              }
            </div>
            <button
              className={`btn btn--sm ${billCopied ? 'btn--primary' : 'btn--ghost'}`}
              onClick={copyBill}
              disabled={selected.size === 0}>
              {billCopied ? '✓ Copied!' : 'Copy bill message'}
            </button>
          </div>
        )}

        {!loaded && <div className="loading">Loading…</div>}
        {loaded && filtered.length === 0 && (
          logs.length === 0
            ? <EmptyState icon={IconWrench} title="No jobs logged yet" subtitle="Once the crew completes work, it shows up here."/>
            : <div className="empty">No jobs match that filter.</div>
        )}

        <div className="log-grid">
          {filtered.map(l => (
            <LogCard
              key={l.id}
              log={l}
              index={logs.length - logs.indexOf(l)}
              onView={setLightbox}
              canEdit={!!user}
              onEdit={() => setModal({ mode: 'edit', log: l })}
              onDelete={() => remove(l)}
              billMode={billMode}
              isSelected={selected.has(l.id)}
              onToggleSelect={() => toggleSelect(l.id)}
            />
          ))}
        </div>
      </section>

      <Lightbox lightbox={lightbox} onClose={() => setLightbox(null)} onChange={setLightbox}/>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        wide
        title={modal?.mode === 'edit' ? 'Edit log entry' : 'New work log entry'}>
        {modal && user && (
          <LogForm
            user={user}
            existing={modal.mode === 'edit' ? modal.log : null}
            onDone={() => setModal(null)}
          />
        )}
      </Modal>
    </main>
  )
}

function LogCard({ log, index, onView, canEdit, onEdit, onDelete, billMode, isSelected, onToggleSelect }) {
  const { user, role } = useAuth()
  const [paidToggling, setPaidToggling] = useState(false)
  const ev = log.evidence || {}
  const extras = log.extraImages || []
  const cb = log.costBreakdown || {}
  const repairCost = cb.repair ?? cb.parts
  const total = log.total ?? ((+repairCost || 0) + (+cb.serviceFee || 0) + (+cb.extras || 0))
  const num = String(index).padStart(4, '0')
  const dateSource = log.jobDate ? new Date(log.jobDate + 'T00:00:00') : (log.createdAt?.toDate ? log.createdAt.toDate() : null)
  const date = dateSource ? dateSource.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
  const staff = isStaff(user, role)

  // Ordered gallery for the lightbox.
  const gallery = [
    ev.bill   && { url: ev.bill,   label: 'Bill'   },
    ev.before && { url: ev.before, label: 'Before' },
    ev.after  && { url: ev.after,  label: 'After Service' },
    ...extras.filter(x => x.url).map((x, i) => ({ url: x.url, label: x.label || `Photo ${i + 1}` })),
  ].filter(Boolean)
  const openAt = idx => onView({ images: gallery, index: idx, title: `#${num} · ${log.clientName || 'Job'}` })

  const togglePaid = async e => {
    e.stopPropagation()
    if (paidToggling) return
    setPaidToggling(true)
    try { await updateDoc(doc(db, 'pitstop_logs', log.id), { paid: !log.paid }) }
    catch (err) { showToast('Failed to update paid status: ' + (err.message || err.code), 'err') }
    finally { setPaidToggling(false) }
  }

  const cardCls = ['log-card', billMode && isSelected ? 'log-card--selected' : ''].filter(Boolean).join(' ')

  return (
    <motion.article
      className={cardCls}
      {...fadeUp}
      onClick={billMode ? onToggleSelect : undefined}
      style={billMode ? { cursor: 'pointer' } : undefined}
    >
      {billMode && (
        <div className={`log-check ${isSelected ? 'log-check--on' : ''}`} aria-hidden="true">
          {isSelected ? '✓' : ''}
        </div>
      )}

      <header className="log-card-head">
        <div className="log-id">#{num}</div>
        {date && <div className="log-date">{date}</div>}
        {staff && (
          <span className={`log-paid-badge ${log.paid ? 'log-paid-badge--paid' : 'log-paid-badge--unpaid'}`}>
            {log.paid ? 'Paid' : 'Unpaid'}
          </span>
        )}
      </header>

      <div className="log-client">{log.clientName || '—'}</div>
      <div className="log-vehicle">
        {log.vehicle || '—'} · <span className="plate">{log.plate || '—'}</span>
      </div>

      {log.scope?.length > 0 && (
        <div className="log-chips">
          {log.scope.map(s => <span key={s} className="chip chip--sm chip--on">{s}</span>)}
        </div>
      )}

      <div className="log-receipt">
        {repairCost != null && +repairCost !== 0 && (
          <div className="log-receipt-row"><span>Repair</span><span className="dots"/><b>${(+repairCost).toLocaleString()}</b></div>
        )}
        {cb.serviceFee != null && +cb.serviceFee !== 0 && (
          <div className="log-receipt-row"><span>Service fee</span><span className="dots"/><b>${(+cb.serviceFee).toLocaleString()}</b></div>
        )}
        {cb.extras != null && +cb.extras !== 0 && (
          <div className="log-receipt-row"><span>{cb.extrasLabel || 'Extras'}</span><span className="dots"/><b>${(+cb.extras).toLocaleString()}</b></div>
        )}
        <div className="log-receipt-row log-receipt-total">
          <span>Total</span>
          <span className="dots"/>
          <b>${(+total).toLocaleString()}</b>
        </div>
      </div>

      {gallery.length > 0 && (
        <div className="log-evidence">
          {gallery.map((img, i) => {
            const modCls = img.label === 'Bill'   ? 'log-thumb--bill'
                         : img.label === 'Before' ? 'log-thumb--before'
                         : img.label === 'After Service' ? 'log-thumb--after'
                         :                          'log-thumb--extra'
            return (
              <button key={i} className={`log-thumb log-thumb--img ${modCls}`} onClick={e => { e.stopPropagation(); openAt(i) }} title={`Click to view ${img.label.toLowerCase()}`}>
                <img src={img.url} alt={img.label} loading="lazy"/>
                <span className="log-thumb-tag">{img.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {log.handledBy?.length > 0 && (
        <footer className="log-foot">
          <span className="t3">Handled by</span>{' '}
          {log.handledBy.slice(0, 3).join(' · ')}
          {log.handledBy.length > 3 && <span className="t3"> +{log.handledBy.length - 3}</span>}
        </footer>
      )}

      {canEdit && !billMode && (
        <div className="log-actions">
          {staff && (
            <button
              className={`btn btn--sm ${log.paid ? 'btn--primary' : 'btn--ghost'}`}
              onClick={togglePaid}
              disabled={paidToggling}>
              {log.paid ? 'Paid ✓' : 'Mark paid'}
            </button>
          )}
          <ShareReceiptButton log={log}/>
          <button className="btn btn--ghost btn--sm" onClick={e => { e.stopPropagation(); onEdit() }}>Edit</button>
          <button className="btn btn--del btn--sm" onClick={e => { e.stopPropagation(); onDelete() }}>Delete</button>
        </div>
      )}
    </motion.article>
  )
}

function buildReceipt(log) {
  const cb     = log.costBreakdown || {}
  const repair = +(cb.repair ?? cb.parts ?? 0) || 0
  const fee    = +cb.serviceFee || 0
  const extras = +cb.extras     || 0
  const ev     = log.evidence   || {}
  const extraImages = (log.extraImages || []).filter(x => x.url)

  const numbers   = [repair, fee, extras].filter(n => n > 0)
  const total     = log.total ?? numbers.reduce((s, n) => s + n, 0)
  const totalExpr = numbers.length > 0 ? numbers.join(' +') : '0'

  const lines = []
  lines.push(`Client: ${log.clientName || '—'}`)
  lines.push(`Car: ${log.vehicle || '—'}`)
  lines.push(`Vehicle Plate: ${log.plate || '—'}`)
  if (log.scope?.length) lines.push(`Scope Of Work: ${log.scope.join(' + ')}`)
  lines.push(`Total: ${totalExpr} = $${(+total).toLocaleString()}`)
  if (ev.bill || ev.before || ev.after || extraImages.length > 0) {
    lines.push(`Evidence: `)
    if (ev.bill)   lines.push(`Bill - ${ev.bill}`)
    if (ev.before) lines.push(`Before - ${ev.before}`)
    if (ev.after)  lines.push(`After Service - ${ev.after}`)
    for (const x of extraImages) lines.push(`${x.label || 'Photo'} - ${x.url}`)
  }
  return lines.join('\n')
}

function ShareReceiptButton({ log, compact = false }) {
  const [copied, setCopied] = useState(false)
  const share = async (e) => {
    e?.stopPropagation()
    const text = buildReceipt(log)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this receipt:', text)
    }
  }

  if (compact) {
    return (
      <button
        className={`log-icon-btn log-icon-btn--share ${copied ? 'is-copied' : ''}`}
        onClick={share}
        title="Copy receipt to clipboard">
        {copied ? '✓' : '📋'}
      </button>
    )
  }

  return (
    <button className={`btn btn--sm ${copied ? 'btn--primary' : 'btn--ghost'}`} onClick={share}>
      {copied ? '✓ Copied' : 'Share receipt'}
    </button>
  )
}

/* ─── Log form (used by Work Log modal) ────────────────────── */

const SCOPES = ['Full Repair', 'Normal Repair', 'Custom Build', 'Performance Upgrade', 'Wash & Cleaning', 'Roadside Recovery', 'Pickup & Drop-off']

function LogForm({ user, existing, onDone }) {
  const [draft, setDraft] = useState(() => logToDraft(existing))
  const [status, setStatus] = useState({ state: 'idle', msg: '' })
  const [vgyToken, setVgyToken] = useState(null)
  const [requireFields, setRequireFields] = useState(true)
  const editing = !!existing

  // Pull the vgy.me userkey from Firestore (admin-only read by rule). If the
  // signed-in user is an admin and a token is configured, image uploads go to
  // vgy.me instead of Firebase Storage so receipts get clean i.vgy.me URLs.
  useEffect(() => {
    let cancelled = false
    getDoc(doc(db, 'pitstop_secrets', 'vgy'))
      .then(snap => { if (!cancelled && snap.exists()) setVgyToken(snap.data().token || null) })
      .catch(() => {})    // non-admin or no doc — fine, fall back to Storage
    return () => { cancelled = true }
  }, [])

  const total = useMemo(() => {
    const cb = draft.costBreakdown || {}
    return (+cb.repair || 0) + (+cb.serviceFee || 0) + (+cb.extras || 0)
  }, [draft])

  const toggleScope = s => setDraft(d => ({
    ...d, scope: d.scope.includes(s) ? d.scope.filter(x => x !== s) : [...d.scope, s],
  }))
  const cbField = (k, v) => setDraft(d => ({ ...d, costBreakdown: { ...d.costBreakdown, [k]: v } }))
  const evField = (k, v) => setDraft(d => ({ ...d, evidence:      { ...d.evidence,      [k]: v } }))

  const addExtra = () => setDraft(d => ({ ...d, extraImages: [...d.extraImages, { label: '', url: '' }] }))
  const setExtra = (i, k, v) => setDraft(d => ({
    ...d,
    extraImages: d.extraImages.map((x, idx) => idx === i ? { ...x, [k]: v } : x),
  }))
  const removeExtra = i => setDraft(d => ({ ...d, extraImages: d.extraImages.filter((_, idx) => idx !== i) }))

  const save = async e => {
    e.preventDefault()
    if (requireFields && (!draft.clientName.trim() || !draft.vehicle.trim() || !draft.plate.trim())) {
      setStatus({ state: 'err', msg: 'Client, vehicle, and plate are required.' }); return
    }
    setStatus({ state: 'sending', msg: '' })

    const cb = draft.costBreakdown
    const payload = {
      clientName: draft.clientName.trim(),
      vehicle:    draft.vehicle.trim(),
      plate:      draft.plate.trim().toUpperCase(),
      jobDate:    draft.jobDate || todayISO(),
      scope:      draft.scope,
      costBreakdown: {
        repair:      +cb.repair || 0,
        serviceFee:  +cb.serviceFee || 0,
        extras:      +cb.extras || 0,
        extrasLabel: cb.extrasLabel || '',
      },
      total,
      evidence: {
        bill:   draft.evidence.bill.trim(),
        before: draft.evidence.before.trim(),
        after:  draft.evidence.after.trim(),
      },
      extraImages: draft.extraImages
        .map(x => ({ label: (x.label || '').trim(), url: (x.url || '').trim() }))
        .filter(x => x.url),
      handledBy: draft.handledBy.split(',').map(s => s.trim()).filter(Boolean),
      notes:     draft.notes.trim(),
      loggedBy:  user?.email || '',
      paid:      draft.paid ?? false,
    }

    try {
      if (editing) {
        await updateDoc(doc(db, 'pitstop_logs', existing.id), payload)
      } else {
        await addDoc(collection(db, 'pitstop_logs'), { ...payload, createdAt: serverTimestamp() })
      }
      setStatus({ state: 'ok', msg: 'Saved.' })
      onDone?.()
    } catch (err) {
      console.error('[log save] failed:', err)
      const friendly = err.code === 'permission-denied'
        ? "Permission denied — your account isn't allowed to write logs. Check Firestore rules are deployed and you're signed in."
        : (err.message || err.code || 'Unknown error.')
      setStatus({ state: 'err', msg: 'Save failed: ' + friendly })
    }
  }

  return (
    <form className="form form--log" onSubmit={save}>
      <div className="form-row">
        <label className="field"><span>Client *</span>
          <input value={draft.clientName} onChange={e => setDraft({...draft, clientName: e.target.value})} placeholder="Tyson Nash"/>
        </label>
        <label className="field"><span>Vehicle *</span>
          <input value={draft.vehicle} onChange={e => setDraft({...draft, vehicle: e.target.value})} placeholder="Sultan Classic Custom"/>
        </label>
      </div>

      <div className="form-row">
        <label className="field"><span>Plate *</span>
          <input value={draft.plate} onChange={e => setDraft({...draft, plate: e.target.value})} placeholder="36UX0NUO" style={{textTransform: 'uppercase'}}/>
        </label>
        <label className="field"><span>Job date</span>
          <input type="date" value={draft.jobDate} onChange={e => setDraft({...draft, jobDate: e.target.value})}/>
        </label>
      </div>

      <div className="field">
        <span>Scope of work</span>
        <div className="chips">
          {SCOPES.map(s => (
            <button type="button" key={s}
              className={`chip ${draft.scope.includes(s) ? 'chip--on' : ''}`}
              onClick={() => toggleScope(s)}>{s}</button>
          ))}
        </div>
      </div>

      <div className="form-card">
        <div className="form-card-h">
          <span className="form-card-h-ic"><IconCash size={16}/></span>
          <span>Cost breakdown</span>
        </div>
        <div className="form-row">
          <label className="field"><span>Repair / parts ($)</span>
            <input type="number" value={draft.costBreakdown.repair} onChange={e => cbField('repair', e.target.value)} placeholder="1605"/>
          </label>
          <label className="field"><span>Service fee ($)</span>
            <input type="number" value={draft.costBreakdown.serviceFee} onChange={e => cbField('serviceFee', e.target.value)} placeholder="0"/>
          </label>
        </div>
        <div className="form-row">
          <label className="field"><span>Extras label</span>
            <input value={draft.costBreakdown.extrasLabel} onChange={e => cbField('extrasLabel', e.target.value)} placeholder="Towing, parking, etc."/>
          </label>
          <label className="field"><span>Extras ($)</span>
            <input type="number" value={draft.costBreakdown.extras} onChange={e => cbField('extras', e.target.value)} placeholder="0"/>
          </label>
        </div>

        <div className="form-total">
          <div className="form-total-formula">
            {[
              { v: +draft.costBreakdown.repair     || 0, label: 'Repair'  },
              { v: +draft.costBreakdown.serviceFee || 0, label: 'Service' },
              { v: +draft.costBreakdown.extras     || 0, label: draft.costBreakdown.extrasLabel || 'Extras' },
            ].filter(x => x.v > 0).map((x, i, arr) => (
              <Fragment key={i}>
                <span className="form-total-part" title={x.label}>${x.v.toLocaleString()}</span>
                {i < arr.length - 1 && <span className="form-total-op">+</span>}
              </Fragment>
            ))}
            {total === 0 && <span className="form-total-part form-total-part--zero">—</span>}
            <span className="form-total-op">=</span>
          </div>
          <b>${total.toLocaleString()}</b>
        </div>
      </div>

      <div className="form-card">
        <div className="form-card-h">
          <span className="form-card-h-ic"><IconCamera size={16}/></span>
          <span>Evidence</span>
          {vgyToken && <span className="form-card-h-badge">vgy.me</span>}
        </div>
        <ImageField label="Bill (receipt screenshot)" value={draft.evidence.bill} onChange={v => evField('bill', v)} folder="pitstop_logs/bill" vgyToken={vgyToken}/>
        <ImageField label="Before (vehicle as received)" value={draft.evidence.before} onChange={v => evField('before', v)} folder="pitstop_logs/before" vgyToken={vgyToken}/>
        <ImageField label="After Service (vehicle when work is done)" value={draft.evidence.after} onChange={v => evField('after', v)} folder="pitstop_logs/after" vgyToken={vgyToken}/>

        {draft.extraImages.length > 0 && <div className="form-card-divider"/>}

        <div className="extras-list">
          {draft.extraImages.map((x, i) => (
            <div key={i} className="extras-row">
              <label className="field"><span>Photo {i + 1} label</span>
                <input value={x.label} onChange={e => setExtra(i, 'label', e.target.value)} placeholder="e.g. Engine bay, Receipt 2"/>
              </label>
              <ImageField label={`Photo ${i + 1}`} value={x.url} onChange={v => setExtra(i, 'url', v)} folder="pitstop_logs/extras" vgyToken={vgyToken}/>
              <button type="button" className="extras-del" onClick={() => removeExtra(i)} aria-label="Remove">×</button>
            </div>
          ))}
          <button type="button" className="btn btn--ghost btn--sm" onClick={addExtra}>+ Add another photo</button>
        </div>
      </div>

      <div className="form-row">
        <label className="field"><span>Handled by (comma-separated)</span>
          <input value={draft.handledBy} onChange={e => setDraft({...draft, handledBy: e.target.value})} placeholder="Jeremy, Tyson"/>
        </label>
        <label className="field"><span>Notes</span>
          <input value={draft.notes} onChange={e => setDraft({...draft, notes: e.target.value})} placeholder="Optional"/>
        </label>
      </div>

      <div className="form-row">
        <div className="field field--toggle">
          <span>Payment received</span>
          <button type="button" className={`toggle-switch ${draft.paid ? 'toggle-switch--on' : ''}`} onClick={() => setDraft(d => ({ ...d, paid: !d.paid }))} aria-label="Mark as paid">
            <span className="toggle-thumb"/>
          </button>
          <span className="t3">{draft.paid ? 'Paid' : 'Unpaid'}</span>
        </div>
        <div className="field field--toggle">
          <span>Require client / vehicle / plate</span>
          <button type="button" className={`toggle-switch ${requireFields ? 'toggle-switch--on' : ''}`} onClick={() => setRequireFields(v => !v)} aria-label="Toggle required fields">
            <span className="toggle-thumb"/>
          </button>
          <span className="t3">{requireFields ? 'Enforced' : 'Disabled'}</span>
        </div>
      </div>

      <div className="form-foot">
        <button type="submit" className="btn btn--primary" disabled={status.state === 'sending'}>
          {status.state === 'sending' ? 'Saving…' : (editing ? 'Save changes' : 'Publish log →')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>Cancel</button>
        {status.state === 'ok'  && <span className="form-ok">{status.msg}</span>}
        {status.state === 'err' && <span className="form-err">{status.msg}</span>}
      </div>
    </form>
  )
}

/* ─── GALLERY ──────────────────────────────────────────────── */

function GalleryPage() {
  const [photos, setPhotos]   = useState([])
  const [loaded, setLoaded]   = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const { user, role } = useAuth()
  const staff = isStaff(user, role)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'pitstop_gallery'), orderBy('createdAt', 'desc')),
      snap => { setPhotos(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoaded(true) },
      err  => { console.error('[gallery] read failed:', err); setLoaded(true) }
    )
    return unsub
  }, [])

  const remove = async id => {
    if (!(await showConfirm({ title: 'Remove photo?', message: 'Remove this photo from the gallery?', confirmLabel: 'Remove', danger: true }))) return
    try { await deleteDoc(doc(db, 'pitstop_gallery', id)) }
    catch (err) { showToast('Delete failed: ' + (err.message || err.code), 'err') }
  }

  const gallery = photos.map(p => ({ url: p.url, label: p.caption || 'Photo' }))

  return (
    <main className="page">
      <PageHeader kicker="Gallery" title="Happy customers.">
        Our community — customers and their cars, fresh off a Pit Stop job.
      </PageHeader>

      <section className="section">
        {staff && (
          <div className="log-bar" style={{marginBottom: '1.5rem'}}>
            <div className="log-count t3">{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</div>
            <button className="btn btn--primary btn--sm" onClick={() => setAddOpen(true)}>+ Post photo</button>
          </div>
        )}

        {!loaded && <div className="loading">Loading…</div>}
        {loaded && photos.length === 0 && (
          <EmptyState icon={IconCamera} title="No photos posted yet" subtitle="Check back soon — the crew posts shots after every job."/>
        )}

        <div className="gallery-grid">
          {photos.map((p, i) => (
            <div key={p.id} className="gallery-item">
              <button
                className="gallery-img-btn"
                onClick={() => setLightbox({ images: gallery, index: i, title: 'Gallery' })}>
                <img src={p.url} alt={p.caption || 'Gallery photo'} loading="lazy"/>
              </button>
              {p.caption && <div className="gallery-caption">{p.caption}</div>}
              {staff && (
                <button className="gallery-del" onClick={() => remove(p.id)} title="Remove photo">×</button>
              )}
            </div>
          ))}
        </div>
      </section>

      <Lightbox lightbox={lightbox} onClose={() => setLightbox(null)} onChange={setLightbox}/>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Post a photo">
        {addOpen && user && <GalleryForm user={user} onDone={() => setAddOpen(false)}/>}
      </Modal>
    </main>
  )
}

function GalleryForm({ user, onDone }) {
  const [url, setUrl]         = useState('')
  const [caption, setCaption] = useState('')
  const [status, setStatus]   = useState({ state: 'idle', msg: '' })
  const [vgyToken, setVgyToken] = useState(null)

  useEffect(() => {
    let cancelled = false
    getDoc(doc(db, 'pitstop_secrets', 'vgy'))
      .then(snap => { if (!cancelled && snap.exists()) setVgyToken(snap.data().token || null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const save = async e => {
    e.preventDefault()
    if (!url.trim()) { setStatus({ state: 'err', msg: 'Photo is required.' }); return }
    setStatus({ state: 'sending', msg: '' })
    try {
      await addDoc(collection(db, 'pitstop_gallery'), {
        url:       url.trim(),
        caption:   caption.trim(),
        addedBy:   user.email || '',
        createdAt: serverTimestamp(),
      })
      onDone?.()
    } catch (err) {
      setStatus({ state: 'err', msg: 'Failed: ' + (err.message || err.code) })
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <ImageField label="Photo" value={url} onChange={setUrl} folder="pitstop_gallery" vgyToken={vgyToken}/>
      <label className="field"><span>Caption (optional)</span>
        <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Happy customer — Sultan Classic Custom"/>
      </label>
      <div className="form-foot">
        <button type="submit" className="btn btn--primary" disabled={status.state === 'sending'}>
          {status.state === 'sending' ? 'Posting…' : 'Post →'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>Cancel</button>
        {status.state === 'err' && <span className="form-err">{status.msg}</span>}
      </div>
    </form>
  )
}

/* ─── PITCH (CoC proposal) ─────────────────────────────────── */

function PitchPage() {
  return (
    <main className="page">
      <PageHeader kicker="For the Chamber of Commerce" title="Why Pit Stop should be a chartered business.">
        A standalone, full-service mechanic operation closing a real, observable gap in
        San Andreas auto care.
      </PageHeader>

      <section className="section section--narrow">
        <div className="pitch">
          <PitchBlock n="01" t="The market gap is verifiable.">
            Only a handful of mechanic operations are running right now, and the ones that are
            operate at the geographic edges — inconvenient for the bulk of the Los Santos
            population. None of them touch custom builds or performance upgrades. None will pick
            up, drop off, or clean. There is a permanent service backlog and no premium tier.
          </PitchBlock>
          <PitchBlock n="02" t="Pit Stop is the premium tier.">
            We&apos;re not trying to replace what exists — we wrap it. The customer talks to one team.
            That team handles pickup, supervises the actual repair or build, cleans the car,
            and parks it in the customer&apos;s garage of choice.
          </PitchBlock>
          <PitchBlock n="03" t="A transparent fee.">
            One service fee, regardless of scope (the exact rate is being finalized for
            Benny's opening). Parts are passed through at cost — no markup, no
            surprises. The customer sees exactly what they&apos;re paying for.
          </PitchBlock>
          <PitchBlock n="04" t="A civilian crew with real specialties.">
            Five members, each with a defined role. Masoom owns the operation. Zara co-runs it
            and handles client relationships. Tyson rounds out the management team — strong
            car knowledge, client-facing, deal-structuring, and the tech that keeps the shop
            running. Shane is the hands-on mechanic. Ken is the build and tuning expert.
            Tyson also works as a car dealer at Luxury Autos, giving us day-to-day visibility
            into the local vehicle market.
          </PitchBlock>
          <PitchBlock n="05" t="What we&apos;re asking for.">
            A charter to operate Pit Stop as a permanent mechanic shop. With the charter we can
            move into a physical location, scale the crew, and publish standard pricing on the
            board for every customer to see.
          </PitchBlock>
        </div>

        <div className="pitch-foot">
          <Link to="/team"     className="btn btn--ghost">Meet the crew →</Link>
          <Link to="/work-log" className="btn btn--primary">See completed jobs →</Link>
        </div>
      </section>
    </main>
  )
}

function PitchBlock({ n, t, children }) {
  return (
    <motion.div className="pitch-block" {...fadeUp}>
      <div className="pitch-n">{n}</div>
      <div className="pitch-body">
        <div className="pitch-t">{t}</div>
        <p>{children}</p>
      </div>
    </motion.div>
  )
}

/* ─── STAFF (login + manage requests) ──────────────────────── */

function StaffPage() {
  const { user, role, loaded } = useAuth()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')

  const submit = async e => {
    e.preventDefault(); setErr('')
    try { await signInWithEmailAndPassword(auth, email, pw) }
    catch (e) { setErr('Wrong email or password.') }
  }

  if (!loaded) return <main className="page"><div className="loading">Loading…</div></main>

  if (!user) return (
    <main className="page">
      <PageHeader kicker="Staff" title="Crew sign-in."/>
      <section className="section section--narrow">
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@pitstop.gg"/>
          </label>
          <label className="field">
            <span>Password</span>
            <input value={pw} onChange={e => setPw(e.target.value)} type="password" placeholder="••••••••"/>
          </label>
          <div className="form-foot">
            <button className="btn btn--primary" type="submit">Sign in</button>
            {err && <span className="form-err">{err}</span>}
          </div>
        </form>
      </section>
    </main>
  )

  if (role === 'blocked') return (
    <main className="page">
      <PageHeader kicker="Staff" title="Access revoked.">
        Your account has been disabled. Contact an admin if you think this is wrong.
      </PageHeader>
      <section className="section section--narrow center">
        <button className="btn btn--ghost" onClick={() => signOut(auth)}>Sign out</button>
      </section>
    </main>
  )

  return <StaffDashboard user={user} role={role}/>
}

function PortalDashboard({ user, role }) {
  const cards = [
    { to: '?view=requests', icon: IconFlag,    title: 'Job Board',  desc: 'Open requests from customers. Accept, finish, or cancel.', staffNav: true },
    { to: '?view=reviews',  icon: IconStar,    title: 'Reviews',    desc: 'Moderate customer reviews before they go public.', staffNav: true },
    { to: '/work-log',      icon: IconCash,    title: 'Work Log',   desc: 'Log completed jobs — evidence, billing, who handled it.' },
    { to: '/gallery',       icon: IconCamera,  title: 'Gallery',    desc: 'Post photos of finished cars for the public site.' },
    canRepairTokens(user, role) && { to: '/bennys', icon: IconWrench, title: "Benny's Tickets", desc: 'Issue a giveaway ticket per paid repair.' },
    canFoodTokens(user, role)   && { to: '/soochi', icon: IconWash,   title: 'Soochi Tickets',   desc: 'Add a giveaway ticket per meal sold.' },
    canMemberTokens(user, role) && { to: '/membership', icon: IconStar, title: 'Membership Tickets', desc: 'Add a giveaway ticket per membership sold.' },
    isAdmin(user, role) && { to: '/admin', icon: IconUpgrade, title: 'Admin Panel', desc: 'Roster, users, the giveaway, and settings.' },
    isAdmin(user, role) && { to: '/repair-draw', icon: IconGauge, title: 'Repair Lucky Draw', desc: 'Live spin, stream-ready.', external: true },
    isAdmin(user, role) && { to: '/soochi-draw', icon: IconGauge, title: 'Soochi Lucky Draw', desc: 'Live spin, stream-ready.', external: true },
    isAdmin(user, role) && { to: '/membership-draw', icon: IconGauge, title: 'Membership Lucky Draw', desc: 'Live spin, stream-ready.', external: true },
  ].filter(Boolean)

  return (
    <div className="portal-grid">
      {cards.map(c => (
        <Link key={c.to} to={c.staffNav ? `/staff${c.to}` : c.to}
          target={c.external ? '_blank' : undefined} rel={c.external ? 'noreferrer' : undefined}
          className="portal-card">
          <div className="portal-card-ic"><c.icon size={22}/></div>
          <div className="portal-card-title">{c.title}</div>
          <div className="portal-card-desc">{c.desc}</div>
        </Link>
      ))}
    </div>
  )
}

function StaffDashboard({ user, role }) {
  const loc = useLocation()
  const nav = useNavigate()
  // The tab is derived straight from the URL (not local state) so portal-
  // dashboard card links (?view=requests) and the tab buttons stay in sync
  // automatically, including when navigating to the same route.
  const queryView = new URLSearchParams(loc.search).get('view')
  const view = queryView === 'reviews' ? 'reviews' : queryView === 'requests' ? 'requests' : 'dashboard'
  const setView = v => nav(v === 'dashboard' ? '/staff' : `/staff?view=${v}`)

  const titles = {
    dashboard: { title: 'Welcome back.', sub: "Everything your account can do, in one place." },
    requests:  { title: 'Job board.',    sub: 'Open requests from customers. Accept, mark done, or cancel.' },
    reviews:   { title: 'Reviews.',      sub: 'Moderate customer reviews. Approve to make them public; delete or unapprove anytime.' },
  }
  const { title, sub } = titles[view]

  return (
    <main className="page">
      <PageHeader kicker="Staff" title={title}>{sub}</PageHeader>

      <section className="section">
        <StaffToolbar user={user}/>

        <div className="tabs tabs--main">
          <button className={`tab ${view === 'dashboard' ? 'is-on' : ''}`} onClick={() => setView('dashboard')}>Dashboard</button>
          <button className={`tab ${view === 'requests' ? 'is-on' : ''}`} onClick={() => setView('requests')}>Requests</button>
          <button className={`tab ${view === 'reviews'  ? 'is-on' : ''}`} onClick={() => setView('reviews')}>Reviews</button>
        </div>

        {view === 'dashboard' && <PortalDashboard user={user} role={role}/>}
        {view === 'requests'  && <StaffRequests/>}
        {view === 'reviews'   && <StaffReviews/>}
      </section>
    </main>
  )
}

function StaffRequests() {
  const [reqs, setReqs] = useState([])
  const [filter, setFilter] = useState('open')

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'pitstop_requests'), orderBy('createdAt', 'desc')), snap => {
      setReqs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [])

  const filtered = reqs.filter(r => {
    if (filter === 'open') return r.status !== 'done' && r.status !== 'cancelled'
    if (filter === 'done') return r.status === 'done'
    if (filter === 'cancelled') return r.status === 'cancelled'
    return true
  })

  const setStatus = async (id, s) => updateDoc(doc(db, 'pitstop_requests', id), { status: s })

  const counts = useMemo(() => ({
    open: reqs.filter(r => r.status !== 'done' && r.status !== 'cancelled').length,
    done: reqs.filter(r => r.status === 'done').length,
    cancelled: reqs.filter(r => r.status === 'cancelled').length,
    all: reqs.length,
  }), [reqs])

  return (
    <>
      <div className="tabs">
        {[
          ['open',      `Open (${counts.open})`],
          ['done',      `Done (${counts.done})`],
          ['cancelled', `Cancelled (${counts.cancelled})`],
          ['all',       `All (${counts.all})`],
        ].map(([k, label]) => (
          <button key={k} className={`tab ${filter === k ? 'is-on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      <div className="reqs">
        {filtered.length === 0 && <div className="empty">No requests here yet.</div>}
        {filtered.map(r => (
          <div key={r.id} className="req">
            <div className="req-head">
              <div>
                <div className="req-name">{r.clientName || '—'}</div>
                <div className="req-vehicle">
                  {r.carCount ? <><b className="t1">{r.carCount}</b> car{r.carCount > 1 ? 's' : ''}</> : ''}
                  {r.carCount && r.vehicle ? ' · ' : ''}
                  {r.vehicle || (!r.carCount && '—')}
                </div>
              </div>
              <span className={`status status--${r.status || 'new'}`}>{r.status || 'new'}</span>
            </div>
            {r.scope?.length > 0 && (
              <div className="req-chips">
                {r.scope.map(s => <span key={s} className="chip chip--sm chip--on">{s}</span>)}
              </div>
            )}
            <dl className="req-grid">
              {r.location   && <><dt>Location</dt><dd>{r.location}</dd></>}
              {r.dropGarage && <><dt>Drop at</dt><dd>{r.dropGarage}</dd></>}
              {r.contact    && <><dt>Contact</dt><dd>{r.contact}</dd></>}
              {r.notes      && <><dt>Notes</dt><dd>{r.notes}</dd></>}
            </dl>
            <div className="req-foot">
              {r.status !== 'accepted'  && <button className="btn btn--ghost btn--sm" onClick={() => setStatus(r.id, 'accepted')}>Accept</button>}
              {r.status !== 'done'      && <button className="btn btn--primary btn--sm" onClick={() => setStatus(r.id, 'done')}>Mark done</button>}
              {r.status !== 'cancelled' && <button className="btn btn--del btn--sm" onClick={() => setStatus(r.id, 'cancelled')}>Cancel</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ─── REVIEWS (public + staff moderation) ──────────────────── */

function Stars({ value = 0, onChange, size = 'md' }) {
  const interactive = !!onChange
  return (
    <div className={`stars stars--${size} ${interactive ? 'stars--input' : ''}`} role={interactive ? 'radiogroup' : 'img'} aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map(n => (
        interactive
          ? <button type="button" key={n} className={`star ${n <= value ? 'is-on' : ''}`} onClick={() => onChange(n)} aria-label={`${n} star${n>1?'s':''}`}>★</button>
          : <span key={n} className={`star ${n <= value ? 'is-on' : ''}`} aria-hidden="true">★</span>
      ))}
    </div>
  )
}

function ReviewsPage() {
  const [reviews, setReviews] = useState([])
  const [loaded, setLoaded]   = useState(false)
  const [draft, setDraft]     = useState({ customerName: '', rating: 5, vehicle: '', comment: '', images: [] })
  const [status, setStatus]   = useState({ state: 'idle', msg: '' })
  const [lightbox, setLightbox] = useState(null)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'pitstop_reviews'), where('approved', '==', true)),
      snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        docs.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
        setReviews(docs)
        setLoaded(true)
      },
      err => { console.error('[reviews] read failed:', err); setLoaded(true) }
    )
    return unsub
  }, [])

  const avg = useMemo(() => {
    if (reviews.length === 0) return 0
    return reviews.reduce((s, r) => s + (+r.rating || 0), 0) / reviews.length
  }, [reviews])

  const submit = async e => {
    e.preventDefault()
    if (!draft.customerName.trim() || !draft.comment.trim()) {
      setStatus({ state: 'err', msg: 'Name and review are both required.' }); return
    }
    setStatus({ state: 'sending', msg: '' })
    try {
      await addDoc(collection(db, 'pitstop_reviews'), {
        customerName: draft.customerName.trim(),
        rating:       +draft.rating || 5,
        vehicle:      draft.vehicle.trim(),
        comment:      draft.comment.trim(),
        images:       (draft.images || []).filter(Boolean),
        approved:     false,
        createdAt:    serverTimestamp(),
      })
      setStatus({ state: 'ok', msg: 'Thanks! Your review will appear once the crew approves it.' })
      setDraft({ customerName: '', rating: 5, vehicle: '', comment: '', images: [] })
    } catch (err) {
      console.error('[reviews] submit failed:', err)
      setStatus({ state: 'err', msg: 'Could not send: ' + (err.message || err.code || 'unknown error') })
    }
  }

  return (
    <main className="page">
      <PageHeader kicker="Reviews" title="What customers say.">
        Real feedback from real jobs. Leave one of your own after we work on your car.
      </PageHeader>

      <section className="section">
        {reviews.length > 0 && (
          <div className="review-summary">
            <div className="review-avg">{avg.toFixed(1)}</div>
            <div>
              <Stars value={Math.round(avg)} size="lg"/>
              <div className="t3" style={{fontSize: '.85rem', marginTop: '.3rem'}}>
                Based on {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
              </div>
            </div>
          </div>
        )}

        {!loaded && <div className="loading">Loading…</div>}
        {loaded && reviews.length === 0 && (
          <EmptyState icon={IconStar} title="No reviews yet" subtitle="Be the first to leave one below."/>
        )}

        <div className="review-grid">
          {reviews.map(r => <ReviewCard key={r.id} r={r} onView={setLightbox}/>)}
        </div>
      </section>

      <section className="section section--narrow">
        <div className="section-head">
          <div className="kicker">Leave a review</div>
          <h2 className="section-title">How did we do?</h2>
        </div>

        <form className="form" onSubmit={submit}>
          <div className="form-row">
            <label className="field"><span>Your name *</span>
              <input value={draft.customerName} onChange={e => setDraft({...draft, customerName: e.target.value})} placeholder="Tyson Nash"/>
            </label>
            <label className="field"><span>Your car</span>
              <input value={draft.vehicle} onChange={e => setDraft({...draft, vehicle: e.target.value})} placeholder="Sultan Classic Custom"/>
            </label>
          </div>

          <div className="field">
            <span>Rating</span>
            <Stars value={draft.rating} onChange={v => setDraft({...draft, rating: v})} size="lg"/>
          </div>

          <label className="field"><span>Your review *</span>
            <textarea value={draft.comment} rows={4}
              onChange={e => setDraft({...draft, comment: e.target.value})}
              placeholder="How was the work, the timing, the crew?"/>
          </label>

          <div className="extras-list">
            {(draft.images || []).map((url, i) => (
              <div key={i} className="extras-row extras-row--single">
                <ImageField
                  label={`Photo ${i + 1} URL`}
                  value={url}
                  onChange={v => setDraft(d => ({ ...d, images: d.images.map((x, idx) => idx === i ? v : x) }))}
                  urlOnly
                />
                <button type="button" className="extras-del"
                  onClick={() => setDraft(d => ({ ...d, images: d.images.filter((_, idx) => idx !== i) }))}
                  aria-label="Remove">×</button>
              </div>
            ))}
            <button type="button" className="btn btn--ghost btn--sm"
              onClick={() => setDraft(d => ({ ...d, images: [...(d.images || []), ''] }))}>
              + Add a photo (optional)
            </button>
          </div>

          <div className="form-foot">
            <button type="submit" className="btn btn--primary" disabled={status.state === 'sending'}>
              {status.state === 'sending' ? 'Sending…' : 'Submit review →'}
            </button>
            {status.state === 'ok'  && <span className="form-ok">{status.msg}</span>}
            {status.state === 'err' && <span className="form-err">{status.msg}</span>}
          </div>
        </form>
      </section>

      <Lightbox lightbox={lightbox} onClose={() => setLightbox(null)} onChange={setLightbox}/>
    </main>
  )
}


function ReviewCard({ r, onView }) {
  const date = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''
  const images = (r.images || []).filter(Boolean)
  const gallery = images.map((url, i) => ({ url, label: `${r.customerName || 'Review'} · Photo ${i + 1}` }))
  return (
    <motion.div className="review-card" {...fadeUp}>
      <div className="review-head">
        <Stars value={+r.rating || 0}/>
        {date && <span className="review-date">{date}</span>}
      </div>
      <p className="review-body">“{r.comment}”</p>
      {images.length > 0 && (
        <div className="review-images">
          {images.map((url, i) => (
            <button key={i} type="button" className="review-thumb"
              onClick={() => onView?.({ images: gallery, index: i, title: r.customerName || 'Review' })}>
              <img src={url} alt={`Review photo ${i + 1}`} loading="lazy"/>
            </button>
          ))}
        </div>
      )}
      <div className="review-foot">
        <div className="review-name">— {r.customerName}</div>
        {r.vehicle && <div className="review-vehicle">{r.vehicle}</div>}
      </div>
    </motion.div>
  )
}

function StaffReviews() {
  const [reviews, setReviews] = useState([])
  const [filter, setFilter]   = useState('pending')

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'pitstop_reviews'), orderBy('createdAt', 'desc')),
      snap => setReviews(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.error('[reviews staff] read failed:', err)
    )
    return unsub
  }, [])

  const counts = useMemo(() => ({
    pending:  reviews.filter(r => !r.approved).length,
    approved: reviews.filter(r =>  r.approved).length,
    all:      reviews.length,
  }), [reviews])

  const filtered = reviews.filter(r => {
    if (filter === 'pending')  return !r.approved
    if (filter === 'approved') return  r.approved
    return true
  })

  const setApproved = async (id, approved) => {
    try { await updateDoc(doc(db, 'pitstop_reviews', id), { approved }) }
    catch (err) { showToast('Update failed: ' + (err.message || err.code), 'err') }
  }
  const remove = async id => {
    if (!(await showConfirm({ title: 'Delete review?', message: 'Delete this review?', confirmLabel: 'Delete', danger: true }))) return
    try { await deleteDoc(doc(db, 'pitstop_reviews', id)) }
    catch (err) { showToast('Delete failed: ' + (err.message || err.code), 'err') }
  }

  return (
    <>
      <div className="tabs">
        {[
          ['pending',  `Pending (${counts.pending})`],
          ['approved', `Approved (${counts.approved})`],
          ['all',      `All (${counts.all})`],
        ].map(([k, label]) => (
          <button key={k} className={`tab ${filter === k ? 'is-on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      <div className="reqs">
        {filtered.length === 0 && <div className="empty">Nothing here.</div>}
        {filtered.map(r => (
          <div key={r.id} className="req">
            <div className="req-head">
              <div>
                <div className="req-name">{r.customerName || '—'}</div>
                <div className="req-vehicle">
                  {r.vehicle && <>{r.vehicle} · </>}
                  <Stars value={+r.rating || 0}/>
                </div>
              </div>
              <span className={`status status--${r.approved ? 'done' : 'new'}`}>
                {r.approved ? 'Approved' : 'Pending'}
              </span>
            </div>
            <p style={{margin: '.4rem 0 .8rem', color: 'var(--t2)'}}>“{r.comment}”</p>
            <div className="req-foot">
              {!r.approved && <button className="btn btn--primary btn--sm" onClick={() => setApproved(r.id, true)}>Approve</button>}
              { r.approved && <button className="btn btn--ghost  btn--sm" onClick={() => setApproved(r.id, false)}>Unapprove</button>}
              <button className="btn btn--del btn--sm" onClick={() => remove(r.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ─── BENNY'S LAUNCH GIVEAWAY (token issuance) ─────────────── */

function GiveawayPageHeader({ kicker, title, children }) {
  return (
    <>
      <div className="giveaway-logo-wrap">
        <img src={bennysLogo} alt="Benny's Original Motor Works" className="giveaway-logo"/>
      </div>
      <PageHeader kicker={kicker} title={title}>{children}</PageHeader>
    </>
  )
}

function GiveawayIssuePage({ channel, canIssue, kicker, deniedLabel, title, sub, nameLabel, namePlaceholder, showNote, noteLabel, notePlaceholder, showQuantity }) {
  const { user, role, loaded } = useAuth()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')

  const submitLogin = async e => {
    e.preventDefault(); setErr('')
    try { await signInWithEmailAndPassword(auth, email, pw) }
    catch { setErr('Wrong email or password.') }
  }

  if (!loaded) return <main className="page"><div className="loading">Loading…</div></main>

  if (!user) return (
    <main className="page">
      <GiveawayPageHeader kicker={kicker} title="Sign in.">{sub}</GiveawayPageHeader>
      <section className="section section--narrow">
        <form className="form" onSubmit={submitLogin}>
          <label className="field">
            <span>Email</span>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@pitstop.gg"/>
          </label>
          <label className="field">
            <span>Password</span>
            <input value={pw} onChange={e => setPw(e.target.value)} type="password" placeholder="••••••••"/>
          </label>
          <div className="form-foot">
            <button className="btn btn--primary" type="submit">Sign in</button>
            {err && <span className="form-err">{err}</span>}
          </div>
        </form>
      </section>
    </main>
  )

  if (role === undefined) return <main className="page"><div className="loading">Loading…</div></main>

  if (!canIssue(user, role)) return (
    <main className="page">
      <GiveawayPageHeader kicker={kicker} title="Not authorized.">
        Signed in as <b>{user.email}</b>, but this account can&apos;t issue {deniedLabel} tokens.
      </GiveawayPageHeader>
      <section className="section section--narrow center">
        <button className="btn btn--ghost" onClick={() => signOut(auth)}>Sign out</button>
      </section>
    </main>
  )

  return (
    <TokenIssuer
      user={user} role={role} channel={channel} kicker={kicker} title={title} sub={sub}
      nameLabel={nameLabel} namePlaceholder={namePlaceholder}
      showNote={showNote} noteLabel={noteLabel} notePlaceholder={notePlaceholder}
      showQuantity={showQuantity}
    />
  )
}

function TicketTable({ tickets, showNote, noteLabel, user, role }) {
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState({ name: '', citizenId: '', note: '' })
  const [busyId, setBusyId] = useState(null)
  const canManage = canManageEntries(user, role)
  const cols = showNote ? 6 : 5

  const startEdit = t => { setEditingId(t.id); setDraft({ name: t.name || '', citizenId: t.citizenId || '', note: t.note || '' }) }
  const cancelEdit = () => setEditingId(null)

  const saveEdit = async t => {
    if (!draft.name.trim()) return
    setBusyId(t.id)
    try {
      const after = { name: draft.name.trim(), citizenId: draft.citizenId.trim(), note: draft.note.trim() }
      await updateDoc(doc(db, 'bennys_tokens', t.id), after)
      logAudit({ action: 'edited', code: t.code, channel: t.channel, name: after.name, before: { name: t.name, citizenId: t.citizenId || '', note: t.note || '' }, after, actor: user })
      setEditingId(null)
    } catch (err) {
      showToast('Could not save: ' + (err.message || err.code), 'err')
    } finally { setBusyId(null) }
  }

  const deleteTicket = async t => {
    if (!(await showConfirm({ title: 'Delete ticket?', message: `Delete ticket ${t.code} (${t.name})? This removes it from the pool entirely.`, confirmLabel: 'Delete', danger: true }))) return
    setBusyId(t.id)
    try {
      await deleteDoc(doc(db, 'bennys_tokens', t.id))
      logAudit({ action: 'removed', code: t.code, channel: t.channel, name: t.name, before: { name: t.name, citizenId: t.citizenId || '', note: t.note || '' }, actor: user })
    }
    catch (err) { showToast('Could not delete: ' + (err.message || err.code), 'err') }
    finally { setBusyId(null) }
  }

  return (
    <div className="ticket-table-wrap">
      <table className="ticket-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Code</th>
            <th>Name</th>
            <th>Citizen ID</th>
            {showNote && <th>{noteLabel || 'Note'}</th>}
            <th>Date &amp; time</th>
            {canManage && <th>Manage</th>}
          </tr>
        </thead>
        <tbody>
          {tickets.length === 0 && (
            <tr><td colSpan={canManage ? cols + 1 : cols} className="empty">No tickets issued yet.</td></tr>
          )}
          {tickets.map((t, i) => (
            <tr key={t.id}>
              <td>{i + 1}</td>
              <td className="ticket-table-code">{t.code}</td>
              {editingId === t.id ? (
                <>
                  <td><input className="ticket-table-input" value={draft.name} onChange={e => setDraft({...draft, name: e.target.value})}/></td>
                  <td><input className="ticket-table-input" value={draft.citizenId} onChange={e => setDraft({...draft, citizenId: e.target.value})}/></td>
                  {showNote && <td><input className="ticket-table-input" value={draft.note} onChange={e => setDraft({...draft, note: e.target.value})}/></td>}
                </>
              ) : (
                <>
                  <td>{t.name}</td>
                  <td>{t.citizenId || '—'}</td>
                  {showNote && <td>{t.note || '—'}</td>}
                </>
              )}
              <td className="ticket-table-time">{fmtStamp(t.createdAt)}</td>
              {canManage && (
                <td className="ticket-table-actions">
                  {editingId === t.id ? (
                    <>
                      <button className="btn btn--ghost btn--sm" onClick={() => saveEdit(t)} disabled={busyId === t.id}>Save</button>
                      <button className="btn btn--ghost btn--sm" onClick={cancelEdit} disabled={busyId === t.id}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn--ghost btn--sm" onClick={() => startEdit(t)} disabled={busyId === t.id}>Edit</button>
                      <button className="btn btn--del btn--sm" onClick={() => deleteTicket(t)} disabled={busyId === t.id}>
                        {busyId === t.id ? '…' : 'Delete'}
                      </button>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TokenIssuer({ user, role, channel, kicker, title, sub, nameLabel, namePlaceholder, showNote, noteLabel, notePlaceholder, showQuantity }) {
  const [name, setName] = useState('')
  const [citizenId, setCitizenId] = useState('')
  const [note, setNote] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [status, setStatus] = useState({ state: 'idle', msg: '' })
  const [lastCodes, setLastCodes] = useState([])
  const [tickets, setTickets] = useState([])
  const nameRef = useRef(null)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'bennys_tokens'), where('channel', '==', channel)),
      snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        docs.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
        setTickets(docs)
      },
      err => console.error('[giveaway] read failed:', err)
    )
    return unsub
  }, [channel])

  const issue = async e => {
    e.preventDefault()
    if (!name.trim()) { setStatus({ state: 'err', msg: 'Enter a name first.' }); return }
    if (!citizenId.trim()) { setStatus({ state: 'err', msg: 'Enter a Citizen ID.' }); return }
    const qty = showQuantity ? Math.max(1, Math.min(50, +quantity || 1)) : 1
    setStatus({ state: 'sending', msg: '' })
    try {
      const codes = []
      for (let i = 0; i < qty; i++) {
        codes.push(await issueGiveawayToken({ channel, name, citizenId, note, issuer: user }))
      }
      setLastCodes(codes)
      setStatus({ state: 'ok', msg: '' })
      setName(''); setCitizenId(''); setNote(''); setQuantity(1)
      nameRef.current?.focus()
    } catch (err) {
      setStatus({ state: 'err', msg: err.message || 'Could not issue token.' })
    }
  }

  return (
    <main className="page">
      <GiveawayPageHeader kicker={kicker} title={title}>{sub}</GiveawayPageHeader>
      <section className="section section--narrow">
        <StaffToolbar user={user}/>

        <form className="form" onSubmit={issue}>
          <div className="form-row">
            <label className="field">
              <span>{nameLabel}</span>
              <input ref={nameRef} value={name} onChange={e => setName(e.target.value)} placeholder={namePlaceholder} autoFocus/>
            </label>
            {showQuantity && (
              <label className="field">
                <span>How many meals</span>
                <input type="number" min="1" max="50" value={quantity}
                  onChange={e => setQuantity(e.target.value)}/>
              </label>
            )}
          </div>
          <label className="field">
            <span>Citizen ID</span>
            <input value={citizenId} onChange={e => setCitizenId(e.target.value)} placeholder="e.g. 1234"/>
          </label>
          {showNote && (
            <label className="field">
              <span>{noteLabel}</span>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder={notePlaceholder}/>
            </label>
          )}
          <div className="form-foot">
            <button className="btn btn--primary" type="submit" disabled={status.state === 'sending'}>
              {status.state === 'sending' ? 'Issuing…' : showQuantity && +quantity > 1 ? `Issue ${quantity} tokens →` : 'Issue token →'}
            </button>
            {status.state === 'err' && <span className="form-err">{status.msg}</span>}
          </div>
        </form>

        {lastCodes.length > 0 && (
          <div className="ticket-reveal">
            <div className="ticket-reveal-label">{lastCodes.length > 1 ? `${lastCodes.length} tickets issued` : 'Ticket issued'}</div>
            <div className="ticket-reveal-code">{lastCodes.join(' · ')}</div>
          </div>
        )}

        <div className="log-list-h">Today&apos;s tickets · {tickets.length}</div>
        <TicketTable tickets={tickets} showNote={showNote} noteLabel={noteLabel} user={user} role={role}/>
      </section>
    </main>
  )
}

function BennysPage() {
  return (
    <GiveawayIssuePage
      channel="repair"
      canIssue={canRepairTokens}
      kicker="Benny's"
      deniedLabel="Benny's"
      title="Issue a giveaway token."
      sub="One token per paid repair. Enter the customer's name — the code is their raffle ticket for the launch-day car giveaway."
      nameLabel="Customer name"
      namePlaceholder="Maria Chen"
      showNote
      noteLabel="Vehicle / plate (optional)"
      notePlaceholder="Sultan Classic Custom · 36UX0NUO"
    />
  )
}

function SoochiPage() {
  return (
    <GiveawayIssuePage
      channel="food"
      canIssue={canFoodTokens}
      kicker="Soochi"
      deniedLabel="Soochi"
      title="Add a giveaway token."
      sub="One token per meal purchase. Buying again? Add the same name again — every purchase is another ticket."
      nameLabel="Buyer name"
      namePlaceholder="Maria Chen"
      showNote={false}
      showQuantity
    />
  )
}

function MembershipPage() {
  return (
    <GiveawayIssuePage
      channel="membership"
      canIssue={canMemberTokens}
      kicker="Membership"
      deniedLabel="Membership"
      title="Issue a giveaway token."
      sub="One token per membership purchase — any tier counts the same. Enter the buyer's name; the code is their raffle ticket for the launch-day car giveaway."
      nameLabel="Member name"
      namePlaceholder="Maria Chen"
      showNote
      noteLabel="Membership / tier (optional)"
      notePlaceholder="Gold"
    />
  )
}

/* ─── ADMIN (admin-only roster + users) ────────────────────── */

function AdminPage() {
  const { user, role, loaded } = useAuth()
  const nav = useNavigate()
  useEffect(() => {
    if (loaded && !user) nav('/staff')
  }, [loaded, user, nav])

  if (!loaded || !user || role === undefined) return <main className="page"><div className="loading">Loading…</div></main>
  if (!isAdmin(user, role)) {
    return (
      <main className="page">
        <PageHeader kicker="Admin" title="Admins only."/>
        <section className="section section--narrow">
          <div className="empty">You&apos;re signed in as <b>{user.email}</b>, but you don&apos;t have admin access. Ask an existing admin to grant it.</div>
        </section>
      </main>
    )
  }

  return <AdminInner user={user} role={role}/>
}

// Standalone, chrome-free draw page for one channel — meant to be put up
// full-screen on stream during the live draw, separate from the admin panel
// where both pools sit side by side for bookkeeping.
function AdminDrawPage({ channel, label }) {
  const { user, role, loaded } = useAuth()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')

  const submitLogin = async e => {
    e.preventDefault(); setErr('')
    try { await signInWithEmailAndPassword(auth, email, pw) }
    catch { setErr('Wrong email or password.') }
  }

  if (!loaded) return <main className="draw-page"><div className="loading">Loading…</div></main>

  // No redirect — this URL is meant to be opened directly (e.g. as an OBS
  // browser source) and sign in right here, not bounce through /staff.
  if (!user) return (
    <main className="draw-page">
      <div className="draw-page-stage">
        <form className="form" onSubmit={submitLogin}>
          <div className="form-h">{label} — admin sign-in</div>
          <label className="field">
            <span>Email</span>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@pitstop.gg" autoFocus/>
          </label>
          <label className="field">
            <span>Password</span>
            <input value={pw} onChange={e => setPw(e.target.value)} type="password" placeholder="••••••••"/>
          </label>
          <div className="form-foot">
            <button className="btn btn--primary" type="submit">Sign in</button>
            {err && <span className="form-err">{err}</span>}
          </div>
        </form>
      </div>
    </main>
  )

  if (role === undefined) return <main className="draw-page"><div className="loading">Loading…</div></main>

  if (!isAdmin(user, role)) return (
    <main className="draw-page">
      <div className="draw-page-stage">
        <div className="empty">Signed in as <b>{user.email}</b>, but this account doesn&apos;t have admin access.</div>
        <div className="form-foot" style={{justifyContent: 'center', marginTop: '1rem'}}>
          <button className="btn btn--ghost" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </div>
    </main>
  )

  return (
    <main className="draw-page">
      <Link to="/admin" className="draw-page-back">← Admin</Link>
      <div className="draw-page-stage">
        <GiveawayPool channel={channel} label={label}/>
      </div>
    </main>
  )
}

function RepairDrawPage() { return <AdminDrawPage channel="repair" label="Repair Lucky Draw"/> }
function SoochiDrawPage() { return <AdminDrawPage channel="food"   label="Soochi Lucky Draw"/> }
function MembershipDrawPage() { return <AdminDrawPage channel="membership" label="Membership Lucky Draw"/> }

function AdminInner({ user, role }) {
  const [tab, setTab] = useState('roster')
  const isManagement = canManageEntries(user, role)

  const titles = {
    roster:   { title: 'Manage the roster.', sub: 'Add, edit, or remove crew on the public /team page.' },
    users:    { title: 'Manage users.',      sub: 'Create accounts, change roles, block, or remove access. Management-only.' },
    giveaway: { title: "Benny's launch giveaway.", sub: "Repair, food, and membership ticket pools, plus the live spin-wheel draw — 1 car each. The other 7 of the 10 launch-day cars come from separate activities, not tracked here." },
    settings: { title: 'Settings.',          sub: 'Integrations and secrets. Admin-only — never visible to public visitors.' },
    audit:    { title: 'Audit log.',         sub: 'Every giveaway entry created, edited, or removed — when (IST) and by which account. Management-only.' },
  }
  const t = titles[tab] || titles.roster

  return (
    <main className="page">
      <PageHeader kicker="Admin" title={t.title}>{t.sub}</PageHeader>

      <section className="section">
        <StaffToolbar user={user}/>

        <div className="admin-quick-actions">
          <span className="admin-quick-actions-label">Lucky draw, for stream:</span>
          <Link to="/repair-draw" target="_blank" rel="noreferrer" className="btn btn--primary btn--sm">Repair Lucky Draw ↗</Link>
          <Link to="/soochi-draw" target="_blank" rel="noreferrer" className="btn btn--primary btn--sm">Soochi Lucky Draw ↗</Link>
          <Link to="/membership-draw" target="_blank" rel="noreferrer" className="btn btn--primary btn--sm">Membership Lucky Draw ↗</Link>
        </div>

        <div className="tabs tabs--main">
          <button className={`tab ${tab === 'roster'   ? 'is-on' : ''}`} onClick={() => setTab('roster')}>Roster</button>
          {isManagement && <button className={`tab ${tab === 'users' ? 'is-on' : ''}`} onClick={() => setTab('users')}>Users</button>}
          <button className={`tab ${tab === 'giveaway' ? 'is-on' : ''}`} onClick={() => setTab('giveaway')}>Giveaway</button>
          <button className={`tab ${tab === 'settings' ? 'is-on' : ''}`} onClick={() => setTab('settings')}>Settings</button>
          {isManagement && <button className={`tab ${tab === 'audit' ? 'is-on' : ''}`} onClick={() => setTab('audit')}>Audit Log</button>}
        </div>

        {tab === 'roster'   && <AdminRoster/>}
        {tab === 'users'    && isManagement && <AdminUsers currentUser={user}/>}
        {tab === 'giveaway' && <AdminGiveaway/>}
        {tab === 'settings' && <AdminSettings/>}
        {tab === 'audit' && isManagement && <AdminAuditLog/>}
      </section>
    </main>
  )
}

function AdminSettings() {
  const [configured, setConfigured] = useState(false)
  const [updatedAt, setUpdatedAt]   = useState(null)
  const [loaded, setLoaded]         = useState(false)
  const [newToken, setNewToken]     = useState('')
  const [status, setStatus]         = useState({ state: 'idle', msg: '' })

  // We only read metadata (whether a token is set + when), never the token itself.
  // The actual token value stays in Firestore and is fetched on demand by LogForm
  // when an admin actually uploads an image — never bound to the UI.
  const refresh = async () => {
    try {
      const snap = await getDoc(doc(db, 'pitstop_secrets', 'vgy'))
      const has = !!(snap.exists() && snap.data()?.token)
      setConfigured(has)
      setUpdatedAt(snap.exists() ? snap.data().updatedAt?.toDate?.() || null : null)
      setLoaded(true)
    } catch (err) {
      console.error(err); setLoaded(true)
      setStatus({ state: 'err', msg: 'Could not read settings: ' + (err.message || err.code) })
    }
  }
  useEffect(() => { refresh() }, [])

  const save = async e => {
    e.preventDefault()
    if (!newToken.trim()) { setStatus({ state: 'err', msg: 'Paste a token first.' }); return }
    setStatus({ state: 'sending', msg: '' })
    try {
      await setDoc(doc(db, 'pitstop_secrets', 'vgy'), {
        token: newToken.trim(),
        updatedAt: serverTimestamp(),
      })
      setNewToken('')
      setStatus({ state: 'ok', msg: configured ? 'Token replaced.' : 'Token saved.' })
      await refresh()
    } catch (err) {
      console.error(err)
      setStatus({ state: 'err', msg: 'Save failed: ' + (err.message || err.code) })
    }
  }

  const clear = async () => {
    if (!(await showConfirm({ title: 'Remove vgy.me token?', message: 'Image uploads will fall back to Firebase Storage.', confirmLabel: 'Remove token', danger: true }))) return
    try {
      await setDoc(doc(db, 'pitstop_secrets', 'vgy'), { token: '', updatedAt: serverTimestamp() })
      setStatus({ state: 'ok', msg: 'Token removed.' })
      await refresh()
    } catch (err) {
      setStatus({ state: 'err', msg: 'Could not remove: ' + (err.message || err.code) })
    }
  }

  const [sheetsUrl, setSheetsUrl] = useState('')
  const [sheetsConfigured, setSheetsConfigured] = useState(false)
  const [sheetsLoaded, setSheetsLoaded] = useState(false)
  const [sheetsStatus, setSheetsStatus] = useState({ state: 'idle', msg: '' })

  const refreshSheets = async () => {
    try {
      const snap = await getDoc(doc(db, 'pitstop_secrets', 'sheets'))
      setSheetsConfigured(!!(snap.exists() && snap.data()?.url))
      setSheetsLoaded(true)
    } catch (err) {
      console.error(err); setSheetsLoaded(true)
    }
  }
  useEffect(() => { refreshSheets() }, [])

  const saveSheets = async e => {
    e.preventDefault()
    if (!sheetsUrl.trim()) { setSheetsStatus({ state: 'err', msg: 'Paste the Apps Script web app URL first.' }); return }
    setSheetsStatus({ state: 'sending', msg: '' })
    try {
      await setDoc(doc(db, 'pitstop_secrets', 'sheets'), { url: sheetsUrl.trim(), updatedAt: serverTimestamp() })
      setSheetsUrl('')
      setSheetsStatus({ state: 'ok', msg: 'Saved. Tickets issued from /bennys and /soochi now back up to your sheet as they happen.' })
      await refreshSheets()
    } catch (err) {
      setSheetsStatus({ state: 'err', msg: 'Save failed: ' + (err.message || err.code) })
    }
  }

  const clearSheets = async () => {
    if (!(await showConfirm({ title: 'Stop Google Sheets backup?', message: 'New tickets will no longer be mirrored to your Google Sheet.', confirmLabel: 'Stop backup', danger: true }))) return
    try {
      await setDoc(doc(db, 'pitstop_secrets', 'sheets'), { url: '', updatedAt: serverTimestamp() })
      setSheetsStatus({ state: 'ok', msg: 'Backup disabled.' })
      await refreshSheets()
    } catch (err) {
      setSheetsStatus({ state: 'err', msg: 'Could not remove: ' + (err.message || err.code) })
    }
  }

  if (!loaded || !sheetsLoaded) return <div className="loading">Loading…</div>

  return (
    <>
    <form className="admin-add" onSubmit={save}>
      <div className="form-h">vgy.me image hosting</div>
      <p className="t2" style={{margin: '0 0 1rem', fontSize: '.9rem'}}>
        Configure once. The token is stored in Firestore with admin-only access. After saving,
        admin work-log uploads automatically use vgy.me so receipts get clean <code>i.vgy.me/…</code> URLs.
        Get / rotate the userkey at <a href="https://vgy.me/account/details" target="_blank" rel="noreferrer">vgy.me/account/details</a>.
        <br/><br/>
        <b>Set-and-forget</b> — you don&apos;t need to add it again. Public visitors and customer-submitted
        review photos never touch this token (those uploads use Firebase Storage).
      </p>

      <div className={`secret-status ${configured ? 'secret-status--ok' : 'secret-status--off'}`}>
        <span className="secret-dot"/>
        {configured ? 'Token configured' : 'Not configured'}
        {configured && updatedAt && (
          <span className="t3" style={{marginLeft: 'auto', fontSize: '.75rem'}}>
            Updated {updatedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        )}
      </div>

      <label className="field">
        <span>{configured ? 'Replace token' : 'Paste token'}</span>
        <input
          type="password"
          className="image-field-url"
          value={newToken}
          onChange={e => setNewToken(e.target.value)}
          placeholder={configured ? '••••••••  (leave blank to keep current)' : 'paste userkey from vgy.me/account/details'}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <div className="form-foot">
        <button type="submit" className="btn btn--primary" disabled={status.state === 'sending' || !newToken.trim()}>
          {status.state === 'sending' ? 'Saving…' : (configured ? 'Replace token' : 'Save token')}
        </button>
        {configured && <button type="button" className="btn btn--del btn--sm" onClick={clear}>Remove token</button>}
        {status.state === 'ok'  && <span className="form-ok">{status.msg}</span>}
        {status.state === 'err' && <span className="form-err">{status.msg}</span>}
      </div>
    </form>

    <form className="admin-add" onSubmit={saveSheets}>
      <div className="form-h">Google Sheets backup</div>
      <p className="t2" style={{margin: '0 0 1rem', fontSize: '.9rem'}}>
        Every ticket issued from /bennys or /soochi gets posted to a Google Sheet as a live backup,
        independent of Firestore — confirmed winners aren&apos;t included (that stays the admin draw
        tool's job; use the CSV export on the Giveaway tab for those). Needs a small Google Apps Script
        deployed on your own sheet first — ask Claude for the script and the deploy steps — then paste
        the resulting Web App URL below. Keep the sheet itself shared with admins only.
      </p>

      <div className={`secret-status ${sheetsConfigured ? 'secret-status--ok' : 'secret-status--off'}`}>
        <span className="secret-dot"/>
        {sheetsConfigured ? 'Backup configured' : 'Not configured'}
      </div>

      <label className="field">
        <span>{sheetsConfigured ? 'Replace Web App URL' : 'Apps Script Web App URL'}</span>
        <input
          type="url"
          className="image-field-url"
          value={sheetsUrl}
          onChange={e => setSheetsUrl(e.target.value)}
          placeholder={sheetsConfigured ? 'https://script.google.com/macros/s/…/exec (leave blank to keep current)' : 'https://script.google.com/macros/s/…/exec'}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <div className="form-foot">
        <button type="submit" className="btn btn--primary" disabled={sheetsStatus.state === 'sending' || !sheetsUrl.trim()}>
          {sheetsStatus.state === 'sending' ? 'Saving…' : (sheetsConfigured ? 'Replace URL' : 'Save URL')}
        </button>
        {sheetsConfigured && <button type="button" className="btn btn--del btn--sm" onClick={clearSheets}>Disable backup</button>}
        {sheetsStatus.state === 'ok'  && <span className="form-ok">{sheetsStatus.msg}</span>}
        {sheetsStatus.state === 'err' && <span className="form-err">{sheetsStatus.msg}</span>}
      </div>
    </form>
    </>
  )
}

function AdminRoster() {
  const [roster, setRoster] = useState([])
  const [draft, setDraft]   = useState({ name: '', role: 'Crew', bio: '', avatar: '', hue: 48, order: 100 })

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'pitstop_roster'), orderBy('order')), snap => {
      setRoster(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return unsub
  }, [])

  const add = async () => {
    if (!draft.name) return
    await addDoc(collection(db, 'pitstop_roster'), draft)
    setDraft({ name: '', role: 'Crew', bio: '', avatar: '', hue: 48, order: 100 })
  }
  const update = async (id, patch) => updateDoc(doc(db, 'pitstop_roster', id), patch)
  const remove = async id => { if (await showConfirm({ title: 'Remove crew member?', message: 'This removes them from the public roster.', confirmLabel: 'Remove', danger: true })) await deleteDoc(doc(db, 'pitstop_roster', id)) }

  const seedDefaults = async () => {
    if (!(await showConfirm({ title: 'Seed roster?', message: 'Seed the roster with the core members? Existing entries with the same IDs will be overwritten, others stay.', confirmLabel: 'Seed defaults' }))) return
    for (let i = 0; i < TEAM_SEED.length; i++) {
      const m = TEAM_SEED[i]
      await setDoc(doc(db, 'pitstop_roster', m.id), { ...m, order: (i + 1) * 10 })
    }
  }

  const wipeAndReseed = async () => {
    if (!(await showConfirm({ title: 'Wipe & reseed roster?', message: 'Delete ALL roster entries and replace with the current seed? This cannot be undone.', confirmLabel: 'Continue', danger: true }))) return
    if (!(await showConfirm({ title: 'Really wipe everything?', message: 'Every crew member doc will be removed first, then the 5-member seed will be written.', confirmLabel: 'Wipe & reseed', danger: true }))) return
    const snap = await getDocs(collection(db, 'pitstop_roster'))
    for (const d of snap.docs) {
      await deleteDoc(doc(db, 'pitstop_roster', d.id))
    }
    for (let i = 0; i < TEAM_SEED.length; i++) {
      const m = TEAM_SEED[i]
      await setDoc(doc(db, 'pitstop_roster', m.id), { ...m, order: (i + 1) * 10 })
    }
  }

  return (
    <>
      <div className="admin-head">
        <button className="btn btn--ghost btn--sm" onClick={seedDefaults}>Seed defaults</button>
        <button className="btn btn--del btn--sm"   onClick={wipeAndReseed}>Wipe &amp; reseed</button>
      </div>

      <div className="admin-add">
        <div className="form-row">
          <label className="field"><span>Name</span><input value={draft.name} onChange={e => setDraft({...draft, name: e.target.value})}/></label>
          <label className="field"><span>Role label</span><input value={draft.role} onChange={e => setDraft({...draft, role: e.target.value})} placeholder="Crew"/></label>
        </div>
        <label className="field"><span>Bio</span><textarea rows={2} value={draft.bio} onChange={e => setDraft({...draft, bio: e.target.value})}/></label>
        <label className="field"><span>Avatar URL (optional)</span><input value={draft.avatar} onChange={e => setDraft({...draft, avatar: e.target.value})} placeholder="https://i.vgy.me/…"/></label>
        <div className="form-row">
          <label className="field"><span>Color hue (0-360)</span><input type="number" min="0" max="360" value={draft.hue} onChange={e => setDraft({...draft, hue: +e.target.value})}/></label>
          <label className="field"><span>Sort order</span><input type="number" value={draft.order} onChange={e => setDraft({...draft, order: +e.target.value})}/></label>
        </div>
        <div className="form-foot">
          <button className="btn btn--primary" onClick={add}>Add crew member</button>
        </div>
      </div>

      <div className="admin-list">
        {roster.map(m => (
          <div key={m.id} className="admin-row" style={{'--hue': m.hue}}>
            <div className={`admin-avatar ${m.avatar ? 'admin-avatar--img' : ''}`}>
              {m.avatar
                ? <img src={m.avatar} alt={m.name || ''}/>
                : <span>{(m.name || '').split(' ').map(x => x[0]).slice(0,2).join('')}</span>}
            </div>
            <div className="admin-meta">
              <input value={m.name} onChange={e => update(m.id, { name: e.target.value })}/>
              <input value={m.role} onChange={e => update(m.id, { role: e.target.value })}/>
              <textarea rows={2} value={m.bio || ''} onChange={e => update(m.id, { bio: e.target.value })}/>
              <input value={m.avatar || ''} onChange={e => update(m.id, { avatar: e.target.value })} placeholder="Avatar URL (optional)"/>
            </div>
            <div className="admin-side">
              <input type="number" min="0" max="360" value={m.hue ?? 48} onChange={e => update(m.id, { hue: +e.target.value })} title="Hue"/>
              <input type="number" value={m.order ?? 100} onChange={e => update(m.id, { order: +e.target.value })} title="Order"/>
              <button className="btn btn--del btn--sm" onClick={() => remove(m.id)}>Remove</button>
            </div>
          </div>
        ))}
        {roster.length === 0 && <div className="empty">No live roster yet. Hit "Seed defaults" to load the six core members.</div>}
      </div>
    </>
  )
}

/* ─── Admin · Giveaway panel (pools + spin-wheel draw) ─────── */

function GiveawayPool({ channel, label, streamLink }) {
  const [tickets, setTickets]     = useState([])
  const [spinning, setSpinning]   = useState(false)
  const [display, setDisplay]     = useState(null)
  const [pendingWinner, setPendingWinner] = useState(null)
  const [busy, setBusy]           = useState(false)
  const [celebrate, setCelebrate] = useState(false)
  const [reel, setReel] = useState([])   // rolling list of names shown while spinning
  const timerRef = useRef(null)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'bennys_tokens'), where('channel', '==', channel)),
      snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        docs.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
        setTickets(docs)
      },
      err => console.error('[admin giveaway] read failed:', err)
    )
    return () => { unsub(); clearTimeout(timerRef.current) }
  }, [channel])

  const winners   = useMemo(() => tickets.filter(t => t.won).sort((a, b) => (b.wonAt?.seconds ?? 0) - (a.wonAt?.seconds ?? 0)), [tickets])
  const wonNames  = useMemo(() => new Set(winners.map(w => w.name)), [winners])
  const eligible  = useMemo(() => tickets.filter(t => !t.won && !wonNames.has(t.name)), [tickets, wonNames])
  // How many winners to draw this session — operator-selectable (1–8). Seeded
  // from the planned cars-per-channel but no longer locked to it, so a single
  // pool can hand out several cars in one run.
  const [target, setTarget] = useState(CARS_PER_CHANNEL[channel] || 1)
  const slotsLeft = target - winners.length

  const spin = () => {
    if (spinning || eligible.length === 0 || slotsLeft <= 0) return
    setPendingWinner(null)
    setSpinning(true)
    setCelebrate(false)
    setReel([])
    const idx = crypto.getRandomValues(new Uint32Array(1))[0] % eligible.length
    const winner = eligible[idx]

    // Slot-reel cadence: names blur past fast early, then the delay ramps up
    // steeply over the final ticks for a long, suspenseful slow-down before it
    // lands. easeInQuint keeps the curve flat early and spikes late; the tuning
    // below totals ≈ 22s so it plays well on stream.
    const totalTicks = 64
    const minDelay = 28
    const maxDelay = 1900
    const easeInQuint = p => p * p * p * p * p

    let ticks = 0
    const tick = () => {
      ticks++
      if (ticks >= totalTicks) {
        setDisplay(winner)
        setSpinning(false)
        setPendingWinner(winner)
        setCelebrate(true)
        setReel([])
        return
      }
      // Never flash the actual winner mid-spin — in a tiny pool that would spoil
      // the reveal — so nudge off it if the random pick lands on the winner.
      let pickIdx = Math.floor(Math.random() * eligible.length)
      if (eligible.length > 1 && eligible[pickIdx].id === winner.id) pickIdx = (pickIdx + 1) % eligible.length
      const pick = eligible[pickIdx]
      setDisplay(pick)
      // Keep a short rolling window of recent names so the stage reads as a live
      // list scrolling by, not a single flickering label.
      setReel(prev => [...prev, { key: `${ticks}-${pick.id}`, code: pick.code, name: pick.name }].slice(-6))
      const delay = minDelay + (maxDelay - minDelay) * easeInQuint(ticks / totalTicks)
      timerRef.current = setTimeout(tick, delay)
    }
    tick()
  }

  const confirmWinner = async () => {
    if (!pendingWinner) return
    setBusy(true)
    try {
      await updateDoc(doc(db, 'bennys_tokens', pendingWinner.id), {
        won: true,
        wonPrize: `${label} — Car #${winners.length + 1}`,
        wonAt: serverTimestamp(),
      })
      setPendingWinner(null); setDisplay(null); setCelebrate(false)
    } catch (err) {
      showToast('Could not confirm winner: ' + (err.message || err.code), 'err')
    } finally { setBusy(false) }
  }

  const reSpin = () => spin()

  const undoLast = async () => {
    const last = winners[0]
    if (!last) return
    if (!(await showConfirm({ title: 'Undo last win?', message: `Undo ${last.name}'s win (${last.wonPrize})? They'll go back in the pool.`, confirmLabel: 'Undo win', danger: true }))) return
    setBusy(true)
    try { await updateDoc(doc(db, 'bennys_tokens', last.id), { won: false, wonPrize: null, wonAt: null }) }
    catch (err) { showToast('Could not undo: ' + (err.message || err.code), 'err') }
    finally { setBusy(false) }
  }

  // Clears every confirmed winner for this channel and sends all tickets back
  // into the pool — so a practice/example spin doesn't lock the real draw.
  const resetPool = async () => {
    if (winners.length === 0) return
    if (!(await showConfirm({ title: `Reset ${label}?`, message: `This clears ${winners.length} confirmed winner(s) and sends every ticket back into the pool.`, confirmLabel: 'Reset draws', danger: true }))) return
    setBusy(true)
    try {
      await Promise.all(winners.map(w =>
        updateDoc(doc(db, 'bennys_tokens', w.id), { won: false, wonPrize: null, wonAt: null })))
      setPendingWinner(null); setDisplay(null); setCelebrate(false)
      showToast(`${label} reset — all tickets back in the pool.`, 'ok')
    } catch (err) {
      showToast('Could not reset: ' + (err.message || err.code), 'err')
    } finally { setBusy(false) }
  }

  return (
    <div className="card giveaway-pool">
      <div className="giveaway-pool-head">
        <div className="card-title">{label}</div>
        {streamLink && <Link to={streamLink} className="btn btn--ghost btn--sm" target="_blank" rel="noreferrer">Open for stream ↗</Link>}
      </div>
      <div className="giveaway-stats">
        <span className="status status--accepted">{eligible.length} eligible</span>
        <span className={`status status--${slotsLeft > 0 ? 'new' : 'done'}`}>{winners.length} / {target} drawn</span>
      </div>

      {!spinning && !pendingWinner && (
        <div className="draw-target">
          <span className="draw-target-label">Winners to draw</span>
          <div className="draw-target-opts">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
              <button key={n} type="button"
                className={`draw-target-opt ${target === n ? 'is-on' : ''}`}
                onClick={() => setTarget(n)}
                disabled={n < winners.length}
                title={n < winners.length ? `${winners.length} already drawn` : `Draw ${n} winner${n > 1 ? 's' : ''}`}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`draw-stage ${spinning ? 'is-spinning' : ''} ${celebrate ? 'is-celebrating' : ''}`}>
        <div className="draw-stage-glow" aria-hidden="true"/>
        {celebrate && (
          <div className="draw-sparks" aria-hidden="true">
            {Array.from({ length: 26 }).map((_, i) => (
              <motion.span key={i} className="draw-spark"
                initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                animate={{
                  x: Math.cos((i / 26) * Math.PI * 2) * (78 + (i % 4) * 22),
                  y: Math.sin((i / 26) * Math.PI * 2) * (78 + (i % 4) * 22) - 12,
                  opacity: 0, scale: 0,
                }}
                transition={{ duration: 1, ease: 'easeOut', delay: (i % 3) * .04 }}
              />
            ))}
          </div>
        )}
        {spinning ? (
          <div className="draw-reel" aria-hidden="true">
            <AnimatePresence initial={false} mode="popLayout">
              {reel.map((r, i) => {
                const depth = reel.length - 1 - i   // 0 = current (bottom), higher = older/up
                const active = depth === 0
                return (
                  <motion.div key={r.key} layout
                    className={`draw-reel-row ${active ? 'is-active' : ''}`}
                    initial={{ opacity: 0, y: 28, filter: 'blur(3px)' }}
                    animate={{ opacity: active ? 1 : Math.max(.12, .5 - depth * .12), y: 0, filter: active ? 'blur(0px)' : 'blur(1px)' }}
                    exit={{ opacity: 0, y: -24 }}
                    transition={{ duration: .16, ease: 'easeOut' }}>
                    <span className="draw-reel-code">{r.code}</span>
                    <span className="draw-reel-name">{r.name}</span>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        ) : display ? (
          <motion.div className="draw-stage-content"
            initial={{ scale: 1.5, opacity: 0, rotate: -3 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 13, mass: .7 }}>
            <div className="draw-stage-code">Ticket {display.code}</div>
            <div className="draw-stage-name">{display.name}</div>
          </motion.div>
        ) : (
          <div className="draw-stage-empty">Spin to draw a winner</div>
        )}
      </div>

      <div className="form-foot">
        {!pendingWinner ? (
          slotsLeft > 0 ? (
            <button className="btn btn--primary btn--lg" onClick={spin} disabled={spinning || eligible.length === 0}>
              {spinning ? 'Spinning…' : eligible.length === 0 ? 'No one left to draw' : `Spin for Car #${winners.length + 1}`}
            </button>
          ) : (
            // Target reached — never a dead end: one tap raises the target so the
            // operator can keep drawing more winners from the same pool.
            <button className="btn btn--primary btn--lg" onClick={() => setTarget(t => t + 1)} disabled={eligible.length === 0}>
              {eligible.length === 0 ? 'No one left to draw' : '+ Draw another winner'}
            </button>
          )
        ) : (
          <>
            <button className="btn btn--primary btn--lg" onClick={confirmWinner} disabled={busy}>Confirm {pendingWinner.name} →</button>
            <button className="btn btn--ghost btn--lg" onClick={reSpin} disabled={busy || spinning}>Re-spin</button>
          </>
        )}
        {winners.length > 0 && !pendingWinner && (
          <>
            <button className="btn btn--ghost btn--sm" onClick={undoLast} disabled={busy}>Undo last win</button>
            <button className="btn btn--del btn--sm" onClick={resetPool} disabled={busy}>Reset all draws</button>
          </>
        )}
      </div>
    </div>
  )
}

function AdminAuditLog() {
  const [logs, setLogs] = useState([])

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'bennys_audit_log'),
      snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        docs.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
        setLogs(docs)
      },
      err => console.error('[audit log] read failed:', err)
    )
    return unsub
  }, [])

  const actionStatus = a => a === 'created' ? 'accepted' : a === 'removed' ? 'cancelled' : 'new'

  return (
    <div className="ticket-table-wrap">
      <table className="ticket-table">
        <thead>
          <tr>
            <th>When (IST)</th>
            <th>Action</th>
            <th>Ticket</th>
            <th>Name</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 && <tr><td colSpan={5} className="empty">No activity logged yet.</td></tr>}
          {logs.map(l => (
            <tr key={l.id}>
              <td>{fmtStamp(l.createdAt)}</td>
              <td><span className={`status status--${actionStatus(l.action)}`}>{l.action}</span></td>
              <td className="ticket-table-code">{l.code}</td>
              <td>{l.name}</td>
              <td>{l.performedByLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminGiveaway() {
  const [allTickets, setAllTickets] = useState([])
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'bennys_tokens'),
      snap => setAllTickets(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.error('[admin giveaway] read failed:', err)
    )
    return unsub
  }, [])

  const winners = useMemo(() =>
    allTickets.filter(t => t.won).sort((a, b) => (b.wonAt?.seconds ?? 0) - (a.wonAt?.seconds ?? 0)),
    [allTickets])

  const copyWinners = () => {
    const text = winners.map(w => `${w.wonPrize} — ${w.name} (ticket ${w.code}, ${channelDrawLabel(w.channel)})`).join('\n')
    navigator.clipboard?.writeText(text || 'No winners yet.')
  }

  // Manual backup snapshot — exports every ticket (not just winners) to a CSV
  // any spreadsheet app opens. There's no live/auto-sync to an external sheet
  // (that needs OAuth + a Sheets API setup this app doesn't have); re-click
  // this anytime during the event — e.g. after every confirmed winner — and
  // you've got an offline copy independent of Firestore.
  const exportCSV = () => {
    const headers = ['code', 'channel', 'name', 'citizenId', 'note', 'issuedByLabel', 'createdAt', 'won', 'wonPrize']
    const rows = allTickets
      .slice()
      .sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))
      .map(t => ({
        code: t.code, channel: t.channel, name: t.name, citizenId: t.citizenId || '', note: t.note || '',
        issuedByLabel: t.issuedByLabel || '',
        createdAt: t.createdAt?.toDate ? t.createdAt.toDate().toLocaleString() : '',
        won: t.won ? 'yes' : 'no', wonPrize: t.wonPrize || '',
      }))
    downloadCSV(`bennys-giveaway-${todayISO()}.csv`, toCSV(rows, headers))
  }

  // Deletes any drawn winner, not just the most recent one per channel (that's
  // GiveawayPool's "Undo last win"). Sends the ticket back into its pool.
  const deleteWinner = async w => {
    if (!(await showConfirm({ title: 'Delete win?', message: `Delete ${w.name}'s win (${w.wonPrize})? They'll go back into the pool.`, confirmLabel: 'Delete win', danger: true }))) return
    setBusyId(w.id)
    try { await updateDoc(doc(db, 'bennys_tokens', w.id), { won: false, wonPrize: null, wonAt: null }) }
    catch (err) { showToast('Could not delete: ' + (err.message || err.code), 'err') }
    finally { setBusyId(null) }
  }

  return (
    <>
      <div className="giveaway-grid">
        <GiveawayPool channel="repair"     label="Repair Lucky Draw"     streamLink="/repair-draw"/>
        <GiveawayPool channel="food"       label="Soochi Lucky Draw"     streamLink="/soochi-draw"/>
        <GiveawayPool channel="membership" label="Membership Lucky Draw" streamLink="/membership-draw"/>
      </div>

      <div className="log-list-h">All winners · {winners.length}</div>
      <div className="form-foot" style={{marginBottom: '1rem'}}>
        <button className="btn btn--ghost btn--sm" onClick={copyWinners} disabled={winners.length === 0}>Copy winners list</button>
        <button className="btn btn--ghost btn--sm" onClick={exportCSV} disabled={allTickets.length === 0}>Export all tickets (CSV backup)</button>
      </div>
      <div className="reqs">
        {winners.length === 0 && <div className="empty">No winners drawn yet.</div>}
        {winners.map(w => (
          <div key={w.id} className="req">
            <div className="req-head">
              <div className="req-name">{w.name}</div>
              <span className="status status--done">{w.wonPrize}</span>
            </div>
            <div className="req-vehicle">Ticket {w.code} · {channelDrawLabel(w.channel)}</div>
            <div className="req-foot">
              <button className="btn btn--del btn--sm" onClick={() => deleteWinner(w)} disabled={busyId === w.id}>
                {busyId === w.id ? 'Deleting…' : 'Delete win'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ─── Admin · Users panel ──────────────────────────────────── */

function AdminUsers({ currentUser }) {
  const [users, setUsers]   = useState([])
  const [draft, setDraft]   = useState({ email: '', password: '', displayName: '', role: 'crew' })
  const [status, setStatus] = useState({ state: 'idle', msg: '' })
  const [secretsMap, setSecretsMap] = useState({})  // uid → stored password (management-only)
  const [pwDrafts, setPwDrafts]     = useState({})  // uid → new-password text
  const [pwBusy, setPwBusy]         = useState(null) // uid currently saving

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'pitstop_users'), orderBy('createdAt', 'desc')),
      snap => setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
      err => console.error('[admin users] read failed:', err)
    )
    return unsub
  }, [])

  // Stored-password mirror (only readable by management). Drives which accounts
  // can be reset client-side — ones without an entry have no known password to
  // re-login with, so their reset control is hidden.
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'pitstop_user_secrets'),
      snap => { const m = {}; snap.docs.forEach(d => { m[d.id] = d.data().password }); setSecretsMap(m) },
      err => console.error('[admin secrets] read failed:', err)
    )
    return unsub
  }, [])

  const create = async e => {
    e.preventDefault()
    setStatus({ state: 'idle', msg: '' })
    if (!draft.email.trim() || draft.password.length < 6) {
      setStatus({ state: 'err', msg: 'Email is required and password must be at least 6 characters.' }); return
    }
    setStatus({ state: 'sending', msg: '' })
    try {
      // Create the new auth user on the secondary app so the current admin
      // session is not affected.
      const cred = await createUserWithEmailAndPassword(secondaryAuth, draft.email.trim(), draft.password)
      const uid  = cred.user.uid

      await setDoc(doc(db, 'pitstop_users', uid), {
        email:       draft.email.trim(),
        displayName: draft.displayName.trim() || draft.email.split('@')[0],
        role:        draft.role,
        createdAt:   serverTimestamp(),
        createdBy:   currentUser.email,
      })

      // Mirror the password (management-only collection) so it can be reset
      // later without a server/Admin SDK. See setPassword() below.
      await setDoc(doc(db, 'pitstop_user_secrets', uid), { password: draft.password }).catch(() => {})

      // Sign the secondary session out so the next create starts clean.
      await signOutSecondary(secondaryAuth).catch(() => {})

      setStatus({ state: 'ok', msg: `Created ${draft.email} as ${draft.role}.` })
      setDraft({ email: '', password: '', displayName: '', role: 'crew' })
    } catch (err) {
      console.error('[admin users] create failed:', err)
      const friendly =
        err.code === 'auth/email-already-in-use' ? 'That email is already registered.' :
        err.code === 'auth/invalid-email'        ? 'That email looks invalid.' :
        err.code === 'auth/weak-password'        ? 'Password is too weak (min 6 characters).' :
        (err.message || err.code || 'Unknown error.')
      setStatus({ state: 'err', msg: friendly })
    }
  }

  const setRole = async (uid, role) => {
    try { await updateDoc(doc(db, 'pitstop_users', uid), { role }) }
    catch (err) { showToast('Update failed: ' + (err.message || err.code), 'err') }
  }

  const removeUser = async u => {
    if (!(await showConfirm({ title: `Remove ${u.email}?`, message: 'This only removes their role doc — the Auth account itself stays until you delete it from Firebase Console → Authentication → Users.', confirmLabel: 'Remove user', danger: true }))) return
    try {
      await deleteDoc(doc(db, 'pitstop_users', u.uid))
      await deleteDoc(doc(db, 'pitstop_user_secrets', u.uid)).catch(() => {})
    }
    catch (err) { showToast('Delete failed: ' + (err.message || err.code), 'err') }
  }

  // Reset another account's password without a backend: sign into the secondary
  // auth app *as that user* using their stored password, change it, then mirror
  // the new one. Only works for accounts that have a stored password.
  const setPassword = async u => {
    const newPass = (pwDrafts[u.uid] || '')
    if (newPass.length < 6) { showToast('Password must be at least 6 characters.', 'err'); return }
    const storedPass = secretsMap[u.uid]
    if (!storedPass) { showToast("No stored password for this account, so it can't be reset here. Recreate the account, or have the user change it from their own login.", 'err'); return }
    if (!(await showConfirm({ title: `Reset password for ${u.email}?`, message: 'Anyone using that login will need the new password.', confirmLabel: 'Set password' }))) return
    setPwBusy(u.uid)
    try {
      await signInWithEmailAndPassword(secondaryAuth, u.email, storedPass)
      await updatePassword(secondaryAuth.currentUser, newPass)
      await signOutSecondary(secondaryAuth).catch(() => {})
      await setDoc(doc(db, 'pitstop_user_secrets', u.uid), { password: newPass }, { merge: true })
      setPwDrafts(d => ({ ...d, [u.uid]: '' }))
      showToast(`Password updated for ${u.email}.`, 'ok')
    } catch (err) {
      // Stored password no longer matches Auth (e.g. changed elsewhere) → can't re-login.
      const msg = (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')
        ? 'Stored password is out of date for this account — reset it from the Firebase Console once, then it works here again.'
        : (err.message || err.code)
      showToast('Could not set password: ' + msg, 'err')
    } finally { setPwBusy(null) }
  }

  return (
    <>
      <form className="admin-add" onSubmit={create}>
        <div className="form-h">Create user</div>
        <div className="form-row">
          <label className="field"><span>Email</span>
            <input type="email" value={draft.email} onChange={e => setDraft({...draft, email: e.target.value})} placeholder="zara@pitstop.gg"/>
          </label>
          <label className="field"><span>Password (min 6)</span>
            <input type="password" value={draft.password} onChange={e => setDraft({...draft, password: e.target.value})} placeholder="••••••••"/>
          </label>
        </div>
        <div className="form-row">
          <label className="field"><span>Display name</span>
            <input value={draft.displayName} onChange={e => setDraft({...draft, displayName: e.target.value})} placeholder="Zara Hayat"/>
          </label>
          <label className="field"><span>Role</span>
            <select value={draft.role} onChange={e => setDraft({...draft, role: e.target.value})}>
              <option value="crew">Crew — staff dashboard, logs, reviews</option>
              <option value="bennys">Benny's — issues repair + membership tokens</option>
              <option value="soochi">Soochi — giveaway food-token issuer only</option>
              <option value="membership">Membership — giveaway membership-token issuer only</option>
              <option value="admin">Admin — full site + giveaway (not user management)</option>
              <option value="management">Management — everything, incl. users &amp; passwords</option>
            </select>
          </label>
        </div>
        <div className="form-foot">
          <button className="btn btn--primary" type="submit" disabled={status.state === 'sending'}>
            {status.state === 'sending' ? 'Creating…' : 'Create user →'}
          </button>
          {status.state === 'ok'  && <span className="form-ok">{status.msg}</span>}
          {status.state === 'err' && <span className="form-err">{status.msg}</span>}
        </div>
      </form>

      <div className="log-list-h">Existing users · {users.length}</div>
      <div className="reqs">
        {users.length === 0 && <div className="empty">No managed users yet. Create the first one above.</div>}
        {users.map(u => (
          <div key={u.uid} className="req">
            <div className="req-head">
              <div>
                <div className="req-name">{u.displayName || u.email}</div>
                <div className="req-vehicle">
                  {u.email}
                  {u.uid === currentUser.uid && <> · <span className="t3">(you)</span></>}
                </div>
              </div>
              <span className={`status status--${u.role === 'admin' || u.role === 'management' ? 'done' : u.role === 'blocked' ? 'cancelled' : 'accepted'}`}>
                {u.role || 'unknown'}
              </span>
            </div>
            <div className="req-foot">
              <select value={u.role || 'crew'} onChange={e => setRole(u.uid, e.target.value)} disabled={u.uid === currentUser.uid}>
                <option value="crew">Crew</option>
                <option value="bennys">Benny's</option>
                <option value="soochi">Soochi</option>
                <option value="membership">Membership</option>
                <option value="admin">Admin</option>
                <option value="management">Management</option>
                <option value="blocked">Blocked</option>
              </select>
              <button className="btn btn--del btn--sm" onClick={() => removeUser(u)} disabled={u.uid === currentUser.uid}>Remove</button>
            </div>
            <div className="req-foot user-pw-row">
              {secretsMap[u.uid] ? (
                <>
                  <input type="password" className="user-pw-input" placeholder="New password (min 6)"
                    autoComplete="new-password" value={pwDrafts[u.uid] || ''}
                    onChange={e => setPwDrafts(d => ({ ...d, [u.uid]: e.target.value }))}/>
                  <button className="btn btn--ghost btn--sm" onClick={() => setPassword(u)}
                    disabled={pwBusy === u.uid || (pwDrafts[u.uid] || '').length < 6}>
                    {pwBusy === u.uid ? 'Setting…' : 'Set password'}
                  </button>
                </>
              ) : (
                <span className="user-pw-none">No stored password — reset unavailable for this account.</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ─── Shared bits ──────────────────────────────────────────── */

// Per-page identity confirmation + sign out. Cross-tool jumps (Bennys, Soochi,
// Admin, …) now live in the main Nav itself, which grows based on who's
// signed in — this stays focused on "who's on this device right now."
function StaffToolbar({ user }) {
  return (
    <div className="staff-bar">
      <div className="staff-user"><span className="dot dot--ok"/> <b>{user.email}</b></div>
      <div className="staff-actions">
        <button className="btn btn--ghost btn--sm" onClick={() => signOut(auth)}>Sign out</button>
      </div>
    </div>
  )
}

function PageHeader({ kicker, title, children }) {
  return (
    <section className="page-header">
      <div className="hero-grid" aria-hidden="true"/>
      <motion.div
        initial={{opacity:0, y:14}} animate={{opacity:1, y:0}} transition={{duration:.5}}>
        <div className="kicker">{kicker}</div>
        <h1 className="page-title">{title}</h1>
        {children && <p className="page-sub">{children}</p>}
      </motion.div>
    </section>
  )
}

function ScrollToTop() {
  const loc = useLocation()
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [loc.pathname])
  return null
}

/* ─── ROOT ─────────────────────────────────────────────────── */

export default function App() {
  const loc = useLocation()
  const isDrawPage = loc.pathname === '/repair-draw' || loc.pathname === '/soochi-draw' || loc.pathname === '/membership-draw'
  return (
    <Fragment>
      <ScrollToTop/>
      <ModalHost/>
      {!isDrawPage && <Nav/>}
      <AnimatePresence mode="wait">
        <PageTransition key={loc.pathname}>
          <Routes location={loc}>
            <Route path="/"          element={<HomePage/>}/>
            <Route path="/services"  element={<ServicesPage/>}/>
            <Route path="/team"      element={<TeamPage/>}/>
            <Route path="/request"   element={<RequestPage/>}/>
            <Route path="/work-log"  element={<WorkLogPage/>}/>
            <Route path="/reviews"   element={<ReviewsPage/>}/>
            <Route path="/gallery"   element={<GalleryPage/>}/>
            <Route path="/pitch"     element={<PitchPage/>}/>
            <Route path="/staff"     element={<StaffPage/>}/>
            <Route path="/bennys"    element={<BennysPage/>}/>
            <Route path="/soochi"    element={<SoochiPage/>}/>
            <Route path="/membership" element={<MembershipPage/>}/>
            <Route path="/admin"     element={<AdminPage/>}/>
            <Route path="/repair-draw" element={<RepairDrawPage/>}/>
            <Route path="/soochi-draw" element={<SoochiDrawPage/>}/>
            <Route path="/membership-draw" element={<MembershipDrawPage/>}/>
            <Route path="*"          element={<NotFound/>}/>
          </Routes>
        </PageTransition>
      </AnimatePresence>
      {!isDrawPage && <Footer/>}
    </Fragment>
  )
}

function NotFound() {
  return (
    <main className="page">
      <PageHeader kicker="404" title="Took a wrong turn.">
        That page doesn&apos;t exist. Head back to the pit lane.
      </PageHeader>
      <section className="section section--narrow center">
        <Link to="/" className="btn btn--primary">← Home</Link>
      </section>
    </main>
  )
}
