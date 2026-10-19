// Состояние EN-перевода приходит из Rails в translations.en.state
// (missing | partial | machine | reviewed | stale) и пересчитывается при каждом сохранении.
export const TRANSLATION_STATE_LABELS: Record<string, string> = {
  missing: 'нет перевода',
  partial: 'неполный',
  machine: 'машинный',
  reviewed: 'проверен',
  stale: 'устарел',
}

export function englishTranslationState(translations?: Record<string, any> | null): string {
  const state = translations?.en?.state
  return typeof state === 'string' && state in TRANSLATION_STATE_LABELS ? state : 'missing'
}

// «Проверено» можно поставить, когда перевод есть и ещё не отмечен проверенным.
export function canReviewTranslation(state: string) {
  return state === 'machine' || state === 'partial' || state === 'stale'
}
