/**
 * BargeInDetector — client-side voice barge-in (Option A from BARGEIN_DESIGN.md).
 *
 * Runs a lightweight energy-based VAD on the existing microphone stream. While the
 * bot is speaking (the detector is "armed"), sustained user speech fires a single
 * `onBargeIn` callback, which the caller wires to the existing manual-interrupt
 * sender (`videoChatStore.interrupt()` → data-channel `Interrupt` message). We do
 * NOT invent a new signal — we reuse the backend cancel chain that already exists.
 *
 * Anti-false-trigger guards (BARGEIN_DESIGN.md §3):
 *   1. Echo cancellation: handled on the mic stream itself (see store/media.ts).
 *   2. Minimum sustained duration: `minSpeechMs` before firing.
 *   3. Threshold + hysteresis: separate `startThresholdDb` / `stopThresholdDb`.
 *   4. Armed only while the bot is speaking: `setArmed(true)` is driven by
 *      `chatStore.replying`.
 *   5. Cooldown after a fire so one barge-in doesn't fire repeatedly.
 *
 * Kept intentionally simple (energy + duration + hysteresis). Per §6, upgrade to a
 * WASM Silero VAD only if the false-trigger rate proves too high in live testing.
 */

export interface BargeInConfig {
  /** Master switch. When false the detector never fires (manual button still works). */
  enabled: boolean
  /** Level (dBFS) the user's voice must exceed to start counting as speech. */
  startThresholdDb: number
  /** Level (dBFS) below which the speech run resets (hysteresis: < startThresholdDb). */
  stopThresholdDb: number
  /** Sustained ms above startThresholdDb required before firing a barge-in. */
  minSpeechMs: number
  /** Quiet period (ms) after a fire during which we won't fire again. */
  cooldownMs: number
}

export const DEFAULT_BARGE_IN_CONFIG: BargeInConfig = {
  enabled: true,
  startThresholdDb: -45,
  stopThresholdDb: -55,
  minSpeechMs: 250,
  cooldownMs: 800,
}

type AudioContextCtor = typeof AudioContext

export class BargeInDetector {
  private config: BargeInConfig
  private onBargeIn: () => void

  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  // Backed by a concrete ArrayBuffer so the type matches AnalyserNode.getFloatTimeDomainData,
  // which (TS 5.7+ DOM typings) requires Float32Array<ArrayBuffer>, not ArrayBufferLike.
  private timeData: Float32Array<ArrayBuffer> | null = null
  private rafId: number | null = null

  private armed = false
  /** Accumulated ms of consecutive above-threshold audio. */
  private speechMs = 0
  private lastFrameTs = 0
  /** Timestamp of the last fired barge-in, for cooldown. */
  private lastFireTs = 0

  constructor(onBargeIn: () => void, config: Partial<BargeInConfig> = {}) {
    this.onBargeIn = onBargeIn
    this.config = { ...DEFAULT_BARGE_IN_CONFIG, ...config }
  }

  updateConfig(config: Partial<BargeInConfig>): void {
    this.config = { ...this.config, ...config }
  }

  getConfig(): BargeInConfig {
    return { ...this.config }
  }

  /** Attach to a mic stream. Safe to call repeatedly; re-attaches cleanly. */
  attach(stream: MediaStream): void {
    this.detach()
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      console.warn('[bargeIn] stream has no audio track; detector not attached')
      return
    }
    const Ctor: AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext
    this.audioContext = new Ctor()
    // Analyse only the audio so the simulated video track is irrelevant.
    this.source = this.audioContext.createMediaStreamSource(new MediaStream(audioTracks))
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.2
    this.timeData = new Float32Array(
      new ArrayBuffer(this.analyser.fftSize * Float32Array.BYTES_PER_ELEMENT)
    )
    this.source.connect(this.analyser)
    this.lastFrameTs = performance.now()
    this.loop()
    console.log('[bargeIn] detector attached', this.config)
  }

  detach(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.source?.disconnect()
    this.analyser?.disconnect()
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {})
    }
    this.source = null
    this.analyser = null
    this.audioContext = null
    this.timeData = null
    this.armed = false
    this.speechMs = 0
  }

  /** Arm/disarm. Driven by bot-speaking state; resets the speech accumulator. */
  setArmed(armed: boolean): void {
    if (this.armed === armed) return
    this.armed = armed
    this.speechMs = 0
    this.lastFrameTs = performance.now()
  }

  /** Current input level in dBFS, for debugging / tuning UI. */
  getCurrentDb(): number {
    if (!this.analyser || !this.timeData) return -Infinity
    this.analyser.getFloatTimeDomainData(this.timeData)
    return this.rmsDb(this.timeData)
  }

  private rmsDb(buf: Float32Array): number {
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    if (rms <= 1e-8) return -Infinity
    return 20 * Math.log10(rms)
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop)
    if (!this.analyser || !this.timeData) return

    const now = performance.now()
    const dt = now - this.lastFrameTs
    this.lastFrameTs = now

    // Only evaluate while armed (bot speaking) and enabled.
    if (!this.armed || !this.config.enabled) {
      this.speechMs = 0
      return
    }
    // Cooldown after a recent fire.
    if (now - this.lastFireTs < this.config.cooldownMs) {
      this.speechMs = 0
      return
    }

    this.analyser.getFloatTimeDomainData(this.timeData)
    const db = this.rmsDb(this.timeData)

    if (db >= this.config.startThresholdDb) {
      this.speechMs += dt
    } else if (db < this.config.stopThresholdDb) {
      // Hysteresis: only reset once we drop below the lower threshold.
      this.speechMs = 0
    }
    // Between stop and start thresholds: hold the accumulator (no change).

    if (this.speechMs >= this.config.minSpeechMs) {
      this.fire()
    }
  }

  private fire(): void {
    this.lastFireTs = performance.now()
    this.speechMs = 0
    // Disarm immediately; caller re-arms on the next bot-speaking turn.
    this.armed = false
    console.log('[bargeIn] barge-in detected → firing interrupt')
    try {
      this.onBargeIn()
    } catch (e) {
      console.error('[bargeIn] onBargeIn callback failed', e)
    }
  }
}
