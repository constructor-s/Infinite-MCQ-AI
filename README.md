# IWorld

IWorld is a local-first MCCQE clinical reasoning PWA. It generates one question at a time with Gemini, keeps ten fresh questions in IndexedDB, and falls back to missed-first review when generation is unavailable.

## Local setup

1. Install Node.js 22 or newer and run `npm install`.
2. Copy `.env.example` to `.env.local` and set a Google AI Studio free-tier `GEMINI_API_KEY`.
3. Run `npm run dev`. Vite binds to all network interfaces; open the printed **Network** URL on a phone connected to the same LAN.

If the phone shows a cached page but generation cannot connect, confirm the terminal still shows the dev server running, reload the Network URL, and ensure the operating-system firewall permits incoming Node.js connections.

No clinical questions are shipped in the application. A first launch therefore requires a working Gemini key and network connection. Topics and relative weights are maintained in `curriculum/topics.json`; editing them requires a rebuild.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

## Vercel deployment

1. Import this directory into a Vercel project.
2. Add `GEMINI_API_KEY` to the project environment variables and redeploy.
3. Under **Settings → Deployment Protection**, enable **Vercel Authentication** for **All Deployments**. Do not expose the production deployment publicly: the server endpoint uses your Gemini key.
4. Confirm in a private browser window that Vercel requires sign-in, then verify first-question generation and background queue filling.

Questions, attempts, the queue, and the selected model remain in that browser's IndexedDB. Clearing site data removes them.

## Current boundaries

The curriculum is a curated starter set, not an official or complete MCC objective import. AI-generated educational content may be wrong and must not replace clinical guidance. Authentication-backed sync, cloud storage, adaptive mastery, analytics, and data export/import are intentionally deferred.
