// Writes dist/_headers for Cloudflare Pages: a strict content policy and the usual browser protections.
// The only address the app may talk to besides itself is the API, taken from VITE_API_URL.
import { writeFileSync } from 'node:fs'

const api = process.env.VITE_API_URL
if (!api) { console.error('Set VITE_API_URL to the address of the API, for example https://pasal-api.example.workers.dev'); process.exit(1) }
const origin = new URL(api).origin

const csp = [
  "default-src 'self'",
  "script-src 'self'", // no inline or outside scripts, so injected script cannot run
  "style-src 'self' 'unsafe-inline'", // the app styles many elements inline
  "img-src 'self' data: blob: http: https:", // bill pictures, item photos, and camera pictures from the shop network
  `connect-src 'self' ${origin} https://world.openfoodfacts.org https://images.openfoodfacts.org`, // product names and pictures for a barcode
  "font-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const headers = `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(self), bluetooth=(self), usb=(), geolocation=(), microphone=(), payment=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin

/admin*
  X-Robots-Tag: noindex
  Cache-Control: no-store

/index.html
  Cache-Control: no-cache

/sw.js
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`
writeFileSync(new URL('../dist/_headers', import.meta.url), headers)
console.log('dist/_headers written for', origin)
