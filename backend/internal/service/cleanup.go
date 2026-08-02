// 后台清理任务
package service

import (
	"log"
	"os"
	"time"

	"gorm.io/gorm"

	"nutri.go/backend/internal/model"
)

const retentionDays = 7            // 图片保留天数
const cleanupInterval = 1 * time.Hour // 清理间隔

// StartImageCleanup 启动后台 goroutine，定期删除过期图片
func StartImageCleanup(db *gorm.DB) {
	go func() {
		for {
			cutoff := time.Now().AddDate(0, 0, -retentionDays)

			var images []model.FoodImage
			db.Where("created_at < ?", cutoff).Find(&images)

			for _, img := range images {
				// 先删磁盘文件
				if _, err := os.Stat(img.Path); err == nil {
					if err := os.Remove(img.Path); err != nil {
						log.Printf("[cleanup] 删除文件失败 id=%d path=%s: %v", img.ID, img.Path, err)
						continue
					}
				}
				// 再删数据库记录
				db.Delete(&img)
				log.Printf("[cleanup] 已清理过期图片 id=%d name=%s", img.ID, img.Filename)
			}

			if len(images) > 0 {
				log.Printf("[cleanup] 本次清理 %d 张图片", len(images))
			}

			time.Sleep(cleanupInterval)
		}
	}()
}
