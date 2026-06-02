import { WS } from '@/helpers/ws'
import { SignalBody, TextPayload, WsEventTypes, WsProtocol } from '@/interface/eventType'
import { StreamState } from '@/interface/voiceChat'
import { AvatarHandler } from '@renderer/handlers/avatarHandler'
import { BargeInDetector } from '@/helpers/bargeInDetector'
import { setupWebRTC, stop } from '@/utils/webrtcUtils'
import { message } from 'ant-design-vue'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { createWS } from '@/apis'
import { useAppStore } from './app'
import { useChatStore } from './chat'
import { useMediaStore } from './media'
import { useVisionStore } from './vision'
import { watch } from 'vue'

interface VideoChatState {
  streamState: StreamState
  peerConnection: RTCPeerConnection | null
  webRTCId: string
  gsLoadPercent: number
  localAvatarRenderer: AvatarHandler | null
  chatDataChannel: RTCDataChannel | null
  bargeInDetector: BargeInDetector | null
  bargeInUnwatch: (() => void) | null
}

export const useVideoChatStore = defineStore('videoChatStore', {
  state: (): VideoChatState => {
    return {
      streamState: StreamState.closed,
      peerConnection: null,
      webRTCId: '',
      gsLoadPercent: 0,
      localAvatarRenderer: null,
      chatDataChannel: null,
      bargeInDetector: null,
      bargeInUnwatch: null,
    }
  },
  getters: {},
  actions: {
    async startWebRTC() {
      const visionState = useVisionStore()
      const mediaStore = useMediaStore()
      const appStore = useAppStore()
      const chatStore = useChatStore()
      if (this.streamState === 'closed') {
        appStore.resetChatRecords()
        this.peerConnection = new RTCPeerConnection(appStore.rtcConfig)
        this.peerConnection.addEventListener('connectionstatechange', async () => {
          switch (this.peerConnection!.connectionState) {
            case 'connected':
              this.streamState = StreamState.open
              break
            case 'disconnected':
              this.streamState = StreamState.closed
              this.teardownBargeIn()
              stop(this.peerConnection!)
              break
            default:
              break
          }
        })
        this.streamState = StreamState.waiting
        await setupWebRTC(mediaStore.stream!, this.peerConnection!, visionState.remoteVideoRef!)
          .then(([dataChannel, webRTCId]) => {
            this.streamState = StreamState.open
            this.webRTCId = webRTCId as string
            this.chatDataChannel = dataChannel as RTCDataChannel
            this.initChatDataChannel()
            this.setupBargeIn(mediaStore.stream)

            if (appStore.avatarType === 'lam') {
              if (appStore.wsSessionRoute) {
                const ws = this.initWebsocket(appStore.wsSessionRoute, this.webRTCId)
                this.localAvatarRenderer = this.initAvatarHandler(ws, appStore.avatarAssetsPath)
                chatStore.showChatRecords = true
              }
            }
          })
          .catch((e: unknown) => {
            console.info('catching', e)
            this.streamState = StreamState.closed
            const errorMessage = e instanceof Error ? e.message : String(e)
            message.error(errorMessage)
            message.error('请检查是否超过数字人并发上限')
          })
      } else if (this.streamState === 'waiting') {
        // waiting 中不允许操作
      } else {
        stop(this.peerConnection!)
        this.streamState = StreamState.closed
        appStore.resetChatRecords()
        this.teardownBargeIn()
        this.chatDataChannel = null
        chatStore.replying = false
        await mediaStore.accessDevice()
        if (appStore.avatarType === 'lam') {
          this.localAvatarRenderer?.exit()
          if (this.localAvatarRenderer instanceof AvatarHandler) {
            this.localAvatarRenderer.removeAllListeners()
          }
          this.localAvatarRenderer = null
          chatStore.setActiveRenderer(null)
          this.gsLoadPercent = 0
        }
      }
    },
    sendText(text: string) {
      if (!text || !this.chatDataChannel) return
      const chatStore = useChatStore()
      this.chatDataChannel.send(
        JSON.stringify({
          header: {
            name: WsProtocol.SendHumanText,
            request_id: nanoid(),
          },
          payload: {
            request_id: nanoid(),
            stream_key: nanoid(),
            mode: 'full_text',
            text,
            end_of_speech: true,
          },
        })
      )
      console.log('sendText', text)
      chatStore.replying = true
    },
    interrupt() {
      const chatStore = useChatStore()
      console.log('interrupt')
      const appStore = useAppStore()
      if (appStore.avatarType === 'lam') {
        this.localAvatarRenderer?.interrupt()
        chatStore.replying = false
      } else if (this.chatDataChannel) {
        this.chatDataChannel.send(
          JSON.stringify({
            header: {
              name: WsProtocol.Interrupt,
              request_id: nanoid(),
            },
            payload: {},
          })
        )
      }
    },
    /**
     * Voice barge-in (BARGEIN_DESIGN.md Option A). Attaches a client-side mic VAD
     * that, while the bot is speaking, reuses the existing `interrupt()` sender.
     * Armed only during bot playback via the `chatStore.replying` flag.
     */
    setupBargeIn(stream: MediaStream | null) {
      this.teardownBargeIn()
      if (!stream) return
      const appStore = useAppStore()
      const chatStore = useChatStore()

      const detector = new BargeInDetector(() => {
        // Same path the manual interrupt button uses — do not invent a new signal.
        this.interrupt()
      }, appStore.bargeIn)
      detector.attach(stream)
      this.bargeInDetector = detector

      // Arm only while the bot is replying (CLIENT_PLAYBACK active) and the
      // feature is enabled. Re-reading appStore.bargeIn keeps runtime tuning live.
      this.bargeInUnwatch = watch(
        () => [chatStore.replying, appStore.bargeIn.enabled] as const,
        ([replying, enabled]) => {
          detector.updateConfig(appStore.bargeIn)
          detector.setArmed(Boolean(replying) && Boolean(enabled))
        },
        { immediate: true }
      )
    },
    teardownBargeIn() {
      if (this.bargeInUnwatch) {
        this.bargeInUnwatch()
        this.bargeInUnwatch = null
      }
      if (this.bargeInDetector) {
        this.bargeInDetector.detach()
        this.bargeInDetector = null
      }
    },
    initChatDataChannel() {
      if (!this.chatDataChannel) return
      const chatStore = useChatStore()
      this.chatDataChannel.addEventListener('message', (event) => {
        const data = JSON.parse(event.data)
        const headerName = data?.header?.name as WsProtocol | undefined
        if (headerName === WsProtocol.EchoHumanText || headerName === WsProtocol.EchoAvatarText) {
          const payload = (data.payload || {}) as TextPayload
          if (typeof payload.text !== 'string') return
          const role = headerName === WsProtocol.EchoAvatarText ? 'avatar' : 'human'
          chatStore.updateChatRecords({ ...payload, role }, role)
        } else if (
          headerName === WsProtocol.InterruptNotification ||
          headerName === WsProtocol.EndSpeech
        ) {
          chatStore.replying = false
        } else if (headerName === WsProtocol.ChatSignal) {
          chatStore.handleChatSignal((data.payload || {}) as SignalBody)
        }
      })
    },
    initWebsocket(ws_route: string, webRTCId: string): WS {
      const ws = createWS(ws_route, webRTCId)
      ws.on(WsEventTypes.WS_OPEN, () => {
        console.log('socket opened')
      })
      ws.on(WsEventTypes.WS_CLOSE, () => {
        console.log('socket closed')
      })
      ws.on(WsEventTypes.WS_ERROR, (event) => {
        console.log('socket error', event)
      })
      ws.on(WsEventTypes.WS_MESSAGE, (data) => {
        console.log('socket on message', data)
      })
      return ws
    },
    initAvatarHandler(ws: WS, assetsPath: string): AvatarHandler {
      const visionState = useVisionStore()
      const chatStore = useChatStore()
      const handler = new AvatarHandler({
        container: visionState.remoteVideoContainerRef!,
        assetsPath,
        ws,
        rendererType: 'lam',
        loadProgress: (progress) => {
          console.log('gs loadProgress', progress)
          this.gsLoadPercent = progress
        },
      })

      chatStore.bindAvatarHandler(handler)
      chatStore.setActiveRenderer(handler)

      return handler
    },
  },
})

export function setupElectron(): void {
  if (window.electron) {
    const chatStore = useChatStore()
    window.electron.ipcRenderer.on('state-changed', (_event, data) => {
      void _event
      console.log('🚀 ~ state-changed:', data)
      const { key, value } = data
      const appStore = useAppStore()
      if (key in appStore.$state) {
        ;(appStore as unknown as Record<string, unknown>)[key] = value
      } else if (key in chatStore.$state) {
        ;(chatStore as unknown as Record<string, unknown>)[key] = value
      } else {
        const videoChatStore = useVideoChatStore()
        ;(videoChatStore as unknown as Record<string, unknown>)[key] = value
      }
    })
    window.electron.ipcRenderer.send('app-ready')
    watch(
      () => chatStore.showChatRecords,
      (newValue) => {
        console.log('🚀 ~ newValue:', newValue)
        window.electron.ipcRenderer.send('state-changed', {
          key: 'showChatRecords',
          value: newValue,
        })
      }
    )
    window.addEventListener('resize', () => {
      if (chatStore.showChatRecords) {
        chatStore.updateWrapperRect()
      }
    })
  }
}
