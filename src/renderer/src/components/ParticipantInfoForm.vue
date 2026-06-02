<script setup lang="ts">
/**
 * Participant info form (PERSONALIZATION_DESIGN.md Option A). All fields optional.
 * Stored in the app store and sent to the backend on connect; the backend merges them
 * into the LLM system prompt for the session. Toggle off (or leave empty) => unchanged.
 */
import { storeToRefs } from 'pinia'
import { useAppStore } from '@/store/app'
import { PARTICIPANT_FIELDS } from '@/interface/participant'

const appStore = useAppStore()
const { participant, participantEnabled } = storeToRefs(appStore)
</script>

<template>
  <div class="participant-form">
    <label class="participant-toggle">
      <input v-model="participantEnabled" type="checkbox" />
      <span>个性化 / Personalize</span>
    </label>
    <div v-if="participantEnabled" class="participant-fields">
      <div v-for="f in PARTICIPANT_FIELDS" :key="f.key" class="participant-row">
        <span class="participant-label">{{ f.label }}</span>
        <input
          v-model="participant[f.key]"
          class="participant-input"
          type="text"
          :placeholder="f.placeholder"
        />
      </div>
      <p class="participant-hint">填写后将用于个性化回复；留空则与默认行为一致。</p>
    </div>
  </div>
</template>

<style lang="less" scoped>
.participant-form {
  width: 100%;
  max-width: 360px;
  margin: 0 auto 12px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 13px;
}
.participant-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.participant-fields {
  margin-top: 8px;
}
.participant-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.participant-label {
  flex: 0 0 96px;
  opacity: 0.85;
}
.participant-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  outline: none;
}
.participant-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}
.participant-hint {
  margin: 8px 0 0;
  opacity: 0.6;
  font-size: 12px;
}
</style>
