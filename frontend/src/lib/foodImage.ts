/** 将手机大图压缩为后端支持的 JPEG，避免原始相机照片超过上传限制。 */
export async function prepareFoodImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('请选择食物照片')
  if (file.size > 25 * 1024 * 1024) throw new Error('照片过大，请选择小于 25MB 的图片')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    try {
      await image.decode()
    } catch {
      throw new Error('无法读取这张照片，请选择 JPG、PNG 或 WebP 图片')
    }
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法处理照片，请重试')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('照片处理失败')), 'image/jpeg', 0.85)
    })
    if (blob.size > 10 * 1024 * 1024) throw new Error('照片仍然过大，请换一张图片')
    return new File([blob], 'meal.jpg', { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(url)
  }
}
