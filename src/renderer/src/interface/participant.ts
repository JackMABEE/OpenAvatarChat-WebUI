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
  { key: 'name', label: 'Name', placeholder: 'What should I call you?' },
  { key: 'age', label: 'Age', placeholder: 'Optional' },
  { key: 'language', label: 'Language', placeholder: 'Optional' },
  { key: 'background', label: 'Background', placeholder: 'e.g. high-school student, doctor' },
  { key: 'context', label: 'Context', placeholder: 'e.g. museum guide' },
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
