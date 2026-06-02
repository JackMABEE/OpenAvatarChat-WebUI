# Voice Barge-In (client-side mic VAD)

Implements "user speaks while the bot is talking → bot stops promptly" for the
WebRTC / LiteAvatar config, per `BARGEIN_DESIGN.md` **Option A** (frontend mic VAD).

## Why frontend, not backend
The backend already has the full cancel chain (`rtc_stream.py` parses an `Interrupt`
data-channel message → emits `INTERRUPT` → `interrupt_handler.py` cancels the
`CLIENT_PLAYBACK` stream chain, stopping TTS + avatar). The *only* missing half was a
**trigger**: previously the sole sender of `Interrupt` was a manual button that isn't
even shown in voice mode. The server mic is simplex (VAD is disabled during playback),
so detection has to happen in the browser, where echo cancellation is also easy.

This change adds the trigger and **reuses the existing `interrupt()` sender** — no new
signal, no backend change required.

## What was added / changed
- **`src/renderer/src/helpers/bargeInDetector.ts`** (new): `BargeInDetector`, an
  energy-based VAD over the mic stream (`AnalyserMode` RMS → dBFS). Fires `onBargeIn`
  once when armed and speech is sustained past a threshold.
- **`store/webrtc.ts`**: creates the detector on connect (`setupBargeIn`), arms it only
  while `chatStore.replying` is true (bot playing) via a `watch`, calls the existing
  `interrupt()` on a detected barge-in, and tears it down on stop/disconnect.
- **`store/app.ts`**: `bargeIn` config in the app store (toggle + thresholds), with an
  optional server-side override (`config.barge_in`).
- **`store/media.ts`**: mic constraints now request
  `echoCancellation / noiseSuppression / autoGainControl` — the key guard so the bot's
  own voice isn't picked up and self-interrupted.

## Anti-false-trigger guards (BARGEIN_DESIGN.md §3)
1. **Echo cancellation** on the mic stream (`media.ts`).
2. **Minimum sustained duration** — `minSpeechMs` (default 250 ms) before firing.
3. **Threshold + hysteresis** — separate `startThresholdDb` / `stopThresholdDb`.
4. **Armed only while the bot speaks** — driven by `chatStore.replying`.
5. **Cooldown** after a fire (`cooldownMs`) so one barge-in fires once.

## Config / tuning
Defaults in `bargeInDetector.ts` (`DEFAULT_BARGE_IN_CONFIG`), overridable via the app
store (`appStore.bargeIn`) at runtime, or from the server config payload as `barge_in`:

| key | default | meaning |
|---|---|---|
| `enabled` | `true` | master switch; `false` ⇒ manual button only |
| `startThresholdDb` | `-45` | dBFS to start counting as speech |
| `stopThresholdDb` | `-55` | dBFS below which the run resets (hysteresis) |
| `minSpeechMs` | `250` | sustained ms required to fire |
| `cooldownMs` | `800` | quiet window after firing |

**To disable:** set `appStore.bargeIn.enabled = false` (or send `barge_in.enabled:false`
from the server). The manual interrupt button path is unchanged and remains the fallback.

## Verified / not verified
- **Build: passes.** `pnpm build` (`vue-tsc && vite build`) completes and emits `dist`
  with these changes bundled.
- **Typecheck of this change: clean.** `vue-tsc` reports 0 errors in the 5 files of this
  commit. (The standalone `pnpm typecheck` shows 26 *pre-existing* errors in 17 untouched
  upstream files — unused vars, an optional LAM-only missing module, preload window
  globals — none introduced here. The `build` script's bare `vue-tsc` is a no-op because
  root `tsconfig.json` has `"files": []`, which is why upstream builds are green.)
- **Not verified: live behavior.** No mic/runtime test yet — see `BARGEIN_DESIGN.md` §5
  (speak-over-bot stops it; silence/echo does not; noise does not; manual button still
  works). Thresholds (esp. `startThresholdDb`) likely need tuning against a real mic + room.
