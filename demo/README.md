# DockSignal walkthrough video

- `docksignal-demo.mp4` is the rendered video: 1920×1080, 30 fps, about 3 minutes.
- `devpost-post.md` holds the Devpost submission text, form fields, and a YouTube description with chapters.

## What is real and what is simulated

Every screen comes from a production build of this repository. Playwright drives the real UI, which talks to the real API routes and a throwaway PostgreSQL database. Only the CALL-E boundary is simulated. `scripts/calle-sim.cjs` answers requests to `api.heycall-e.com` in the same shapes the real API uses, and the capture delivers webhooks to the app the way CALL-E would. The call voices are synthetic (Kokoro-82M, generated locally). The video labels every call as simulated. None of this code ships in the app, which still has no mock mode.

## Rebuild

`node_modules` is a directory junction to `C:\Users\HLC\.cache\docksignal-demo\node_modules`, because D: is almost full. Running `npm install` here replaces the junction with a real folder on D:, so move it back afterwards if you reinstall.

```bash
npm run voices     # Kokoro TTS for every line, plus sound effects -> public/audio
npm run capture    # builds the app, drives the UI, writes public/shots and public/capture.json
npm run render     # Remotion -> docksignal-demo.mp4
```

The scenario lives in `src/dialogue.ts` (call lines and results), the edit in `src/storyboard.ts` (clicks, camera, highlight colours), and the capture script is `scripts/capture.ts`.
