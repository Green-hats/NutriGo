// 饮食记录模型
package model

import "time"

// FoodDiary 用户每日饮食记录
type FoodDiary struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"not null;index" json:"user_id"`
	Date      string    `gorm:"not null;index" json:"date"`     // "2026-08-01" 格式
	MealType  string    `json:"meal_type"`                       // breakfast / lunch / dinner / snack
	FoodName  string    `gorm:"not null" json:"food_name"`
	Portion   string    `json:"portion"`                         // "200g", "1碗"
	Calories  float64   `json:"calories"`
	ProteinG  float64   `json:"protein_g"`
	FatG      float64   `json:"fat_g"`
	CarbsG    float64   `json:"carbs_g"`
	Notes     string    `json:"notes"`
	ImageID   *uint     `json:"image_id"`                        // 指针类型，允许 NULL
	CreatedAt time.Time `json:"created_at"`
}
