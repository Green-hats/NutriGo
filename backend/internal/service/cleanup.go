// 后台清理任务
package service

import (
	"log/slog"
	"os"
	"time"

	"gorm.io/gorm"

	"nutri.go/backend/internal/model"
)

const retentionDays = 7               // 图片保留天数
const cleanupInterval = 1 * time.Hour // 清理间隔

// StartImageCleanup 启动后台 goroutine，定期删除过期图片
func StartImageCleanup(db *gorm.DB) {
	go func() {
		for {
			runImageCleanup(db)
			time.Sleep(cleanupInterval)
		}
	}()
}

// runImageCleanup 执行一次清理：删除超过保留期的图片（先删磁盘文件，再删 DB 记录）。
// 独立函数便于单元测试。
func runImageCleanup(db *gorm.DB) {
	cutoff := time.Now().AddDate(0, 0, -retentionDays)

	var images []model.FoodImage
	db.Where("created_at < ?", cutoff).Find(&images)

	for _, img := range images {
		// 先删磁盘文件
		if _, err := os.Stat(img.Path); err == nil {
			if err := os.Remove(img.Path); err != nil {
				slog.Error("删除图片文件失败", "id", img.ID, "path", img.Path, "error", err)
				continue
			}
		}
		// 再删数据库记录
		db.Delete(&img)
		slog.Info("已清理过期图片", "id", img.ID, "filename", img.Filename)
	}

	if len(images) > 0 {
		slog.Info("本次清理过期图片", "count", len(images))
	}
}
