import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom 未实现 scrollIntoView，补充一个 no-op 避免组件报错
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

afterEach(() => {
  cleanup()
})
