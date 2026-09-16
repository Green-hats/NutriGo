package service

import (
	"log/slog"
	"os"
	"strconv"
	"time"

	"gorm.io/gorm"
	"nutri.go/backend/internal/model"
)

const cleanupInterval = time.Hour

func StartImageCleanup(db *gorm.DB) {
	go func() {
		for {
			runImageCleanup(db)
			time.Sleep(cleanupInterval)
		}
	}()
}

// 已关联饮食记录的照片永久保留。0 关闭未关联照片的自动清理。
func runImageCleanup(db *gorm.DB) {
	days := 7
	if value := os.Getenv("UNATTACHED_IMAGE_RETENTION_DAYS"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 0 || n > 36500 {
			slog.Error("图片保留期配置无效，跳过清理")
			return
		}
		days = n
	}
	if days == 0 {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -days)
	const orphan = "NOT EXISTS (SELECT 1 FROM food_diaries WHERE food_diaries.image_id = food_images.id)"
	var images []model.FoodImage
	if err := db.Where("created_at < ?", cutoff).Where(orphan).Find(&images).Error; err != nil {
		slog.Error("查询待清理图片失败", "error", err)
		return
	}
	for _, img := range images {
		// 带条件删除，避免查询后已有记录关联的照片被清理。文件只在 DB 删除成功后移除。
		result := db.Where("id = ? AND created_at < ?", img.ID, cutoff).Where(orphan).Delete(&model.FoodImage{})
		if result.Error != nil {
			slog.Error("清理图片记录失败", "id", img.ID, "error", result.Error)
			continue
		}
		if result.RowsAffected == 0 {
			continue
		}
		if err := os.Remove(img.Path); err != nil && !os.IsNotExist(err) {
			slog.Error("清理未关联图片文件失败，需要重试文件清理", "id", img.ID, "path", img.Path, "error", err)
		}
	}
}
