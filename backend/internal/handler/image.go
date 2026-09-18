// 图片上传与获取处理器
package handler

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"nutri.go/backend/internal/httperr"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"nutri.go/backend/internal/model"
	"nutri.go/backend/internal/service"
)

const uploadDir = "uploads"
const maxFileSize = 10 << 20 // 10MB

// ImageHandler 处理图片上传和获取
type ImageHandler struct {
	DB *gorm.DB
}

// Upload POST /api/images/upload
// 接收 multipart/form-data，字段名 "image"
func (h *ImageHandler) Upload(c *gin.Context) {
	userID := c.GetUint("userID")

	// 限制整个 multipart 请求，并释放解析时产生的临时文件。
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxFileSize+(1<<20))
	defer func() {
		if c.Request.MultipartForm != nil {
			_ = c.Request.MultipartForm.RemoveAll()
		}
	}()
	// 读取上传文件
	file, header, err := c.Request.FormFile("image")
	if err != nil {
		httperr.Response(c, http.StatusBadRequest, "请上传图片文件")
		return
	}
	defer file.Close()

	// 大小校验
	if header.Size > maxFileSize {
		httperr.Response(c, http.StatusBadRequest, "图片大小不能超过 10MB")
		return
	}

	// 读取文件头部字节，检测真实 MIME 类型
	buf := make([]byte, 512)
	if _, err := file.Read(buf); err != nil {
		httperr.Response(c, http.StatusInternalServerError, "读取文件失败")
		return
	}
	mimeType := http.DetectContentType(buf)
	if mimeType != "image/jpeg" && mimeType != "image/png" && mimeType != "image/webp" {
		httperr.Response(c, http.StatusBadRequest, "只支持 jpg/png/webp 格式")
		return
	}

	// 扩展名来自实际 MIME，避免保留任意客户端后缀。
	ext := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mimeType]
	filename := uuid4() + ext
	savePath := filepath.Join(uploadDir, filename)

	// 确保 uploads 目录存在
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		httperr.Response(c, http.StatusInternalServerError, "创建目录失败")
		return
	}

	// 重置文件指针到头，写入磁盘
	if _, err := file.Seek(0, 0); err != nil {
		httperr.Response(c, http.StatusInternalServerError, "读取文件失败")
		return
	}
	dst, err := os.OpenFile(savePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		httperr.Response(c, http.StatusInternalServerError, "保存文件失败")
		return
	}
	saved := false
	defer func() {
		_ = dst.Close()
		if !saved {
			if err := os.Remove(savePath); err != nil && !os.IsNotExist(err) {
				slog.Error("上传失败后移除图片失败，等待文件核对清理", "error", err)
			}
		}
	}()
	if _, err := io.Copy(dst, file); err != nil {
		httperr.Response(c, http.StatusInternalServerError, "写入文件失败")
		return
	}
	if err := dst.Sync(); err != nil {
		httperr.Response(c, http.StatusInternalServerError, "保存文件失败")
		return
	}
	if err := dst.Close(); err != nil {
		httperr.Response(c, http.StatusInternalServerError, "保存文件失败")
		return
	}

	// 记录到数据库
	image := model.FoodImage{
		UserID:    userID,
		Filename:  filename,
		Path:      savePath,
		MimeType:  mimeType,
		SizeBytes: header.Size,
	}
	if err := h.DB.Create(&image).Error; err != nil {
		httperr.Response(c, http.StatusInternalServerError, "保存记录失败")
		return
	}

	saved = true
	c.JSON(http.StatusCreated, gin.H{
		"id":        image.ID,
		"filename":  image.Filename,
		"mime_type": image.MimeType,
		"size":      image.SizeBytes,
	})
}

// GetMeta GET /api/images/:id（内部路由）
// Python 通过 image_id 获取图片元信息
func (h *ImageHandler) GetMeta(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		httperr.Response(c, http.StatusBadRequest, "无效的图片ID")
		return
	}

	var image model.FoodImage
	if result := h.DB.First(&image, id); result.Error != nil {
		imageReadError(c, result.Error)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":        image.ID,
		"user_id":   image.UserID,
		"filename":  image.Filename,
		"mime_type": image.MimeType,
		"size":      image.SizeBytes,
	})
}

// GetData GET /api/images/:id/data（内部路由）
// Python 通过 image_id 获取图片二进制数据
func (h *ImageHandler) GetData(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		httperr.Response(c, http.StatusBadRequest, "无效的图片ID")
		return
	}

	var image model.FoodImage
	if result := h.DB.First(&image, id); result.Error != nil {
		imageReadError(c, result.Error)
		return
	}

	// 检查文件是否存在
	if _, err := os.Stat(image.Path); os.IsNotExist(err) {
		httperr.Response(c, http.StatusNotFound, "图片文件已丢失")
		return
	}

	c.File(image.Path)
}

// Delete DELETE /api/images/:id（JWT 保护）。仍有关联记录时拒绝删除。
func (h *ImageHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		httperr.Response(c, http.StatusBadRequest, "无效的图片ID")
		return
	}
	job, err := service.QueueImageDeletion(h.DB, uint(id), c.GetUint("userID"))
	if err != nil {
		switch {
		case errors.Is(err, service.ErrImageForbidden):
			httperr.Response(c, http.StatusForbidden, err.Error())
		case errors.Is(err, service.ErrImageInUse):
			httperr.Response(c, http.StatusConflict, err.Error())
		default:
			imageReadError(c, err)
		}
		return
	}
	if err := service.CompleteImageDeletion(h.DB, job); err != nil {
		slog.Error("图片文件删除待重试", "image_id", id, "error", err)
		c.JSON(http.StatusAccepted, gin.H{"message": "删除已受理，文件清理将自动重试"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

func imageReadError(c *gin.Context, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		httperr.Response(c, http.StatusNotFound, "图片不存在")
		return
	}
	slog.Error("图片数据操作失败", "error", err)
	httperr.Response(c, http.StatusInternalServerError, "图片暂时无法处理，请稍后重试")
}

// uuid4 生成一个随机 UUID（简单实现，不依赖第三方库）
func uuid4() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
