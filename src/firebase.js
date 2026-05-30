// ─── FIREBASE CONFIG ─────────────────────────────────────────────────────────
// Project: pitstop-services
// Console: https://console.firebase.google.com/u/1/project/pitstop-services
//
// Auth & owner identification use Firebase UID (not email). To make yourself
// the owner:
//   1. Authentication → Users → Add user → create your account
//   2. Copy the User UID column for that account
//   3. Paste it into OWNER_UIDS in src/App.jsx
//   4. Paste the same UID into the Firestore rules below where shown
//
// Firestore rules (paste into Firestore Database → Rules):
// see firestore.rules in the project root.

import { initializeApp, getApps } from 'firebase/app'
import { getAnalytics, isSupported as analyticsSupported } from 'firebase/analytics'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'

export const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

const app = initializeApp(firebaseConfig)
export const db      = getFirestore(app)
export const auth    = getAuth(app)
export const storage = getStorage(app)

// Secondary app — used to create new auth users from the admin panel without
// signing out the currently logged-in admin. Same config, different instance.
const secondaryApp = getApps().find(a => a.name === 'secondary') || initializeApp(firebaseConfig, 'secondary')
export const secondaryAuth = getAuth(secondaryApp)

// Analytics only works in supported browser contexts (not SSR / not http://localhost without https) —
// guard so it never blocks app boot.
analyticsSupported().then(ok => { if (ok) getAnalytics(app) }).catch(() => {})
