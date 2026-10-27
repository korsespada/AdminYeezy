import { describe, expect, it } from 'vitest'

import { batchPublishPreviewMessage } from '@/lib/batch-publish-preview'

const base = {
  total: 664,
  newCount: 0,
  updateCount: 664,
  skippedCount: 0,
  deleteCount: 0,
  videoCount: 0,
  replaceMissing: false,
}

describe('batch publish preview message', () => {
  it('называет товары, которые останутся в каталоге после удаления их из партии', () => {
    const message = batchPublishPreviewMessage({ ...base, missingCount: 2 })

    expect(message).toContain('Будет удалено из каталога: 0')
    expect(message).toContain('В каталоге останутся товары, которых нет в партии: 2')
    expect(message).toContain('«Заменить каталог текущей версией»')
  })

  it('не добавляет предупреждение, когда из партии ничего не удалено', () => {
    const message = batchPublishPreviewMessage({ ...base, missingCount: 0 })

    expect(message).not.toContain('останутся товары')
    expect(message).toContain('Продолжить публикацию?')
  })

  it('в режиме замены каталога показывает удаление вместо предупреждения', () => {
    const message = batchPublishPreviewMessage({
      ...base,
      deleteCount: 2,
      missingCount: 2,
      replaceMissing: true,
    })

    expect(message).toContain('Будет удалено из каталога: 2')
    expect(message).not.toContain('останутся товары')
  })
})
