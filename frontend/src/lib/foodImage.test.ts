import { expect, it } from 'vitest'
import { prepareFoodImage } from './foodImage'

it('选择超过 10 MiB 的照片时在解码和上传前给出明确提示', async () => {
  const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.jpg', {
    type: 'image/jpeg',
  })
  await expect(prepareFoodImage(file)).rejects.toThrow('照片超过 10 MiB')
})
