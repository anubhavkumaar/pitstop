#!/usr/bin/env node

/**
 * Deploy script: Builds and ships Pit Stop to Firebase Hosting.
 * Usage: npm run deploy
 *
 * Prereq: install the Firebase CLI once globally and log in:
 *   npm install -g firebase-tools
 *   firebase login
 */

import { execSync } from 'child_process'

function run(command, description) {
  try {
    console.log(`\n📦 ${description}...`)
    execSync(command, { stdio: 'inherit' })
    console.log(`✅ ${description} complete`)
  } catch (error) {
    console.error(`❌ ${description} failed:`, error.message)
    process.exit(1)
  }
}

async function deploy() {
  console.log('🏁 Pit Stop deploy starting...\n')

  run('npm run build', 'Building app')
  run('firebase deploy --only hosting:pitstop-services', 'Deploying to Firebase Hosting')

  console.log('\n🎉 Live at: https://pitstop-services.web.app\n')
}

deploy().catch(console.error)
