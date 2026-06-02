import { message } from 'ant-design-vue'
import { defineStore } from 'pinia'

import { initConfig, makeURL } from '@/apis'
import { useMediaStore } from './media'
import { TextPayload } from '@renderer/interface/eventType'
import { BargeInConfig, DEFAULT_BARGE_IN_CONFIG } from '@/helpers/bargeInDetector'
import { ParticipantInfo, emptyParticipantInfo } from '@/interface/participant'

type ChatRecord = {
  id: string
  role: 'human' | 'avatar'
  message: string
  cancelled?: boolean
  invalid?: boolean
} & TextPayload

interface AppState {
  avatarType: '' | 'lam'
  avatarWSRoute: string
  wsSessionRoute: string
  avatarAssetsPath: string
  rtcConfig: RTCConfiguration | undefined
  chatMode: 'webrtc' | 'ws'
  chatRecords: ChatRecord[]

  toolsVisible: boolean
  inputVisible: boolean
  /** Voice barge-in (client-side mic VAD) settings; tunable + toggleable. */
  bargeIn: BargeInConfig
  /** Personalization: whether to send participant info, and the form fields. */
  participantEnabled: boolean
  participant: ParticipantInfo
}

export const useAppStore = defineStore('appStore', {
  state: (): AppState => ({
    avatarType: '',
    avatarWSRoute: '',
    wsSessionRoute: '',
    avatarAssetsPath: '',
    rtcConfig: undefined,
    chatMode: 'webrtc',
    chatRecords: [],
    toolsVisible: true,
    inputVisible: true,
    bargeIn: { ...DEFAULT_BARGE_IN_CONFIG },
    participantEnabled: true,
    participant: emptyParticipantInfo(),
  }),
  actions: {
    async init() {
      const mediaStore = useMediaStore()
      return initConfig()
        .then((res) => res.json())
        .then((config) => {
          if (config.detail) {
            message.error(config.detail)
            return
          }
          if (config.rtc_configuration) {
            this.rtcConfig = config.rtc_configuration
          }
          if (config.chat_mode) {
            this.chatMode = config.chat_mode === 'ws' ? 'ws' : 'webrtc'
          }
          config.avatar_config = config.avatar_config || {}
          if (config.avatar_config) {
            this.avatarType = config.avatar_config.avatar_type || ''
            this.avatarWSRoute = config.avatar_config.avatar_ws_route || ''
            this.avatarAssetsPath = config.avatar_config.avatar_assets_path
              ? makeURL(config.avatar_config.avatar_assets_path)
              : ''
            if (config.avatar_config.ws_session_route) {
              this.wsSessionRoute = config.avatar_config.ws_session_route
              if (!this.avatarWSRoute) {
                this.avatarWSRoute = config.avatar_config.ws_session_route
              }
            }
          }
          if (config.ws_session_route) {
            this.wsSessionRoute = config.ws_session_route
            if (!this.avatarWSRoute) {
              this.avatarWSRoute = config.ws_session_route
            }
          }
          if (config.track_constraints) {
            mediaStore.setTrackConstraints(config.track_constraints)
          }
          // Optional server-side override of barge-in settings (non-breaking).
          if (config.barge_in && typeof config.barge_in === 'object') {
            this.bargeIn = { ...this.bargeIn, ...(config.barge_in as Partial<BargeInConfig>) }
          }
        })
        .catch((e) => {
          message.error(
            `服务端链接失败，请检查是否能正确访问到 OpenAvatarChat 服务端: ${e instanceof Error ? e.message : String(e)}`
          )
        })
    },
    resetChatRecords() {
      this.chatRecords = []
    },
  },
})
