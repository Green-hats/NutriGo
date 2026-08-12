// 每日汇总查询处理器
package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"nutri.go/backend/internal/config"
	"nutri.go/backend/internal/model"
)

// SummaryHandler 处理每日营养汇总查询
type SummaryHandler struct {
	DB *gorm.DB
}

// List GET /api/diet/summaries?start=2026-01-01&end=2026-08-01
func (h *SummaryHandler) List(c *gin.Context) {
	userID := c.GetUint("userID")
	start := c.Query("start")
	end := c.Query("end")
	if start == "" || end == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 start 和 end 参数，格式 YYYY-MM-DD"})
		return
	}

	var summaries []model.DailySummary
	h.DB.Where("user_id = ? AND date >= ? AND date <= ?", userID, start, end).
		Order("date DESC").
		Find(&summaries)

	c.JSON(http.StatusOK, summaries)
}

// ListInternal GET /api/internal/diet/summaries?user_id=&start=&end=（内部路由）
// 合并两段数据保证任意日期都有汇总：
//   - 近 aggregationRetentionDays 天：从 food_diaries 原始表实时 SUM 聚合
//   - 更早日期：查 daily_summaries 聚合表（后台任务已生成）
func (h *SummaryHandler) ListInternal(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Query("user_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 user_id 参数"})
		return
	}
	start := c.Query("start")
	end := c.Query("end")
	if start == "" || end == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 start 和 end 参数，格式 YYYY-MM-DD"})
		return
	}

	// 以 date -> summary 的 map 合并两段数据
	merged := make(map[string]map[string]any)

	// 1. 近 N 天：实时聚合 food_diaries
	cutoff := time.Now().AddDate(0, 0, -config.AggregationRetentionDays).Format("2006-01-02")
	var recent []struct {
		Date      string  `gorm:"column:date"`
		TotalCal  float64 `gorm:"column:total_cal"`
		TotalPro  float64 `gorm:"column:total_pro"`
		TotalFat  float64 `gorm:"column:total_fat"`
		TotalCarb float64 `gorm:"column:total_carb"`
		MealCount int     `gorm:"column:meal_count"`
	}
	h.DB.Model(&model.FoodDiary{}).
		Select("date, SUM(calories) AS total_cal, SUM(protein_g) AS total_pro, "+
			"SUM(fat_g) AS total_fat, SUM(carbs_g) AS total_carb, COUNT(*) AS meal_count").
		Where("user_id = ? AND date >= ? AND date <= ?", userID, cutoff, end).
		Group("date").
		Find(&recent)
	for _, r := range recent {
		merged[r.Date] = map[string]any{
			"date":             r.Date,
			"total_calories":   r.TotalCal,
			"total_protein_g":  r.TotalPro,
			"total_fat_g":      r.TotalFat,
			"total_carbs_g":    r.TotalCarb,
			"meal_count":       r.MealCount,
			"source":           "live",
		}
	}

	// 2. 更早日期：查聚合表（用 map 避免与实时部分重复的天）
	var summaries []model.DailySummary
	h.DB.Where("user_id = ? AND date >= ? AND date <= ?", userID, start, end).
		Find(&summaries)
	for _, s := range summaries {
		if _, exists := merged[s.Date]; exists {
			continue
		}
		merged[s.Date] = map[string]any{
			"date":            s.Date,
			"total_calories":  s.TotalCalories,
			"total_protein_g": s.TotalProteinG,
			"total_fat_g":     s.TotalFatG,
			"total_carbs_g":   s.TotalCarbsG,
			"meal_count":      s.MealCount,
			"source":          "aggregated",
		}
	}

	// 3. 排序输出（date ASC）
	result := make([]map[string]any, 0, len(merged))
	for _, v := range merged {
		result = append(result, v)
	}
	// 简单插入排序（数据量小）
	for i := 1; i < len(result); i++ {
		for j := i; j > 0 && result[j-1]["date"].(string) > result[j]["date"].(string); j-- {
			result[j-1], result[j] = result[j], result[j-1]
		}
	}

	c.JSON(http.StatusOK, result)
}
