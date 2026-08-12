// 饮食记录聚合任务
// 每天运行一次：将 7 天前的原始记录聚合为每日汇总，释放明细存储空间
package service

import (
	"log"
	"time"

	"gorm.io/gorm"

	"nutri.go/backend/internal/config"
	"nutri.go/backend/internal/model"
)

const aggregationInterval = 24 * time.Hour

// StartDietAggregator 启动后台 goroutine，定期将旧记录聚合为每日汇总
func StartDietAggregator(db *gorm.DB) {
	go func() {
		for {
			cutoff := time.Now().AddDate(0, 0, -config.AggregationRetentionDays).Format("2006-01-02")

			var results []struct {
				UserID     uint    `gorm:"column:user_id"`
				Date       string  `gorm:"column:date"`
				TotalCal   float64 `gorm:"column:total_cal"`
				TotalPro   float64 `gorm:"column:total_pro"`
				TotalFat   float64 `gorm:"column:total_fat"`
				TotalCarb  float64 `gorm:"column:total_carb"`
				MealCount  int     `gorm:"column:meal_count"`
			}

			// 按 (user_id, date) 分组计算总和
			err := db.Model(&model.FoodDiary{}).
				Select("user_id, date, SUM(calories) AS total_cal, "+
					"SUM(protein_g) AS total_pro, SUM(fat_g) AS total_fat, "+
					"SUM(carbs_g) AS total_carb, COUNT(*) AS meal_count").
				Where("date < ?", cutoff).
				Group("user_id, date").
				Find(&results).Error

			if err != nil {
				log.Printf("[aggregator] 查询失败: %v", err)
				time.Sleep(aggregationInterval)
				continue
			}

			inserted := 0
			for _, r := range results {
				summary := model.DailySummary{
					UserID:        r.UserID,
					Date:          r.Date,
					TotalCalories: r.TotalCal,
					TotalProteinG: r.TotalPro,
					TotalFatG:     r.TotalFat,
					TotalCarbsG:   r.TotalCarb,
					MealCount:     r.MealCount,
				}
				// ON CONFLICT: 同一天已存在则更新
				db.Where("user_id = ? AND date = ?", r.UserID, r.Date).
					Assign(summary).
					FirstOrCreate(&summary)
				inserted++
			}

			// 删除已聚合的原始记录
			if inserted > 0 {
				result := db.Where("date < ?", cutoff).Delete(&model.FoodDiary{})
				log.Printf("[aggregator] 聚合 %d 天数据 → %d 条汇总, 删除 %d 条原始记录",
					len(results), inserted, result.RowsAffected)
			}

			time.Sleep(aggregationInterval)
		}
	}()
}
