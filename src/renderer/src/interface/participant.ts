/**
 * Participant basic info (PERSONALIZATION_DESIGN.md, Option A — frontend form).
 * All fields optional/free-text. Sent to the backend, where the SAME merge function
 * (build_personalized_system_prompt) injects them into the LLM system prompt per session.
 */
export interface ParticipantInfo {
  name: string
  age: string
  language: string
  background: string
  context: string
}

/** Field order + labels + placeholders for the form. Keys match the backend dict keys. */
export const PARTICIPANT_FIELDS: ReadonlyArray<{
  key: keyof ParticipantInfo
  label: string
  placeholder: string
}> = [
  { key: 'name', label: '称呼 / Name', placeholder: '如何称呼你' },
  { key: 'age', label: '年龄 / Age', placeholder: '可选' },
  { key: 'language', label: '语言 / Language', placeholder: '可选' },
  { key: 'background', label: '背景 / Background', placeholder: '如：高中生、医生' },
  { key: 'context', label: '场景 / Context', placeholder: '如：博物馆讲解' },
]

export function emptyParticipantInfo(): ParticipantInfo {
  return { name: '', age: '', language: '', background: '', context: '' }
}

/** Trimmed, non-empty fields only — the payload shape the backend expects. */
export function nonEmptyParticipantFields(info: ParticipantInfo): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { key } of PARTICIPANT_FIELDS) {
    const v = (info[key] || '').trim()
    if (v) out[key] = v
  }
  return out
}
