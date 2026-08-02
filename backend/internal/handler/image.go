// 图片上传与获取处理器
package handler

import (
	"crypto/rand"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"nutri.go/backend/internal/model"
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

	// 读取上传文件
	file, header, err := c.Request.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请上传图片文件"})
		return
	}
	defer file.Close()

	// 大小校验
	if header.Size > maxFileSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "图片大小不能超过 10MB"})
		return
	}

	// 读取文件头部字节，检测真实 MIME 类型
	buf := make([]byte, 512)
	if _, err := file.Read(buf); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败"})
		return
	}
	mimeType := http.DetectContentType(buf)
	if mimeType != "image/jpeg" && mimeType != "image/png" && mimeType != "image/webp" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "只支持 jpg/png/webp 格式"})
		return
	}

	// 生成唯一文件名（UUID v4 风格）
	ext := filepath.Ext(header.Filename)
	if ext == "" {
		// 根据真实 MIME 类型补扩展名
		switch mimeType {
		case "image/jpeg":
			ext = ".jpg"
		case "image/png":
			ext = ".png"
		case "image/webp":
			ext = ".webp"
		}
	}
	filename := uuid4() + ext
	savePath := filepath.Join(uploadDir, filename)

	// 确保 uploads 目录存在
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建目录失败"})
		return
	}

	// 重置文件指针到头，写入磁盘
	if _, err := file.Seek(0, 0); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败"})
		return
	}
	dst, err := os.Create(savePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存文件失败"})
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "写入文件失败"})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存记录失败"})
		return
	}

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
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的图片ID"})
		return
	}

	var image model.FoodImage
	if result := h.DB.First(&image, id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "图片不存在"})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的图片ID"})
		return
	}

	var image model.FoodImage
	if result := h.DB.First(&image, id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "图片不存在"})
		return
	}

	// 检查文件是否存在
	if _, err := os.Stat(image.Path); os.IsNotExist(err) {
		c.JSON(http.StatusNotFound, gin.H{"error": "图片文件已丢失"})
		return
	}

	c.File(image.Path)
}

// Delete DELETE /api/images/:id（JWT 保护）
// 只能删除自己的图片。同时删除数据库记录和磁盘文件。
func (h *ImageHandler) Delete(c *gin.Context) {
	userID := c.GetUint("userID")

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的图片ID"})
		return
	}

	var image model.FoodImage
	if result := h.DB.First(&image, id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "图片不存在"})
		return
	}

	if image.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权删除他人的图片"})
		return
	}

	// 先删磁盘文件（如果还存在）
	if _, err := os.Stat(image.Path); err == nil {
		if err := os.Remove(image.Path); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "删除文件失败"})
			return
		}
	}

	// 再删数据库记录
	if err := h.DB.Delete(&image).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除记录失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// uuid4 生成一个随机 UUID（简单实现，不依赖第三方库）
func uuid4() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
