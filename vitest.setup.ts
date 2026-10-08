import '@testing-library/jest-dom'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverMock,
})

Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: {
    configurable: true,
    value: () => false,
  },
  setPointerCapture: {
    configurable: true,
    value: () => undefined,
  },
  releasePointerCapture: {
    configurable: true,
    value: () => undefined,
  },
  scrollIntoView: {
    configurable: true,
    value: () => undefined,
  },
})

/**
 * Node без --localstorage-file отдаёт пустой localStorage и затирает реализацию
 * jsdom. Компоненты админки хранят там выбранный режим просмотра, поэтому в
 * тестах нужна рабочая in-memory подмена.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length() {
    return this.store.size
  }

  clear() {
    this.store.clear()
  }

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string) {
    this.store.delete(key)
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value))
  }
}

const memoryStorage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage })
Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage })
