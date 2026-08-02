// 每日营养汇总模型
package model

// DailySummary 某用户某天的饮食汇总（聚合自 food_diary 原始记录）
type DailySummary struct {
	ID            uint    `gorm:"primaryKey" json:"id"`
	UserID        uint    `gorm:"not null;uniqueIndex:idx_user_date" json:"user_id"`
	Date          string  `gorm:"not null;uniqueIndex:idx_user_date" json:"date"`
	TotalCalories float64 `json:"total_calories"`
	TotalProteinG float64 `json:"total_protein_g"`
	TotalFatG     float64 `json:"total_fat_g"`
	TotalCarbsG   float64 `json:"total_carbs_g"`
	MealCount     int     `json:"meal_count"`
}
