// 数据模型
package model

// User 用户表。GORM 会自动转为 snake_case 复数作为表名：users
type User struct {
	ID       uint   `gorm:"primaryKey" json:"id"`
	Username string `gorm:"uniqueIndex;not null" json:"username"`
	Password string `gorm:"not null" json:"-"` // json:"-" 序列化时隐藏，防止密码泄露
}

// UserProfile 用户健康档案。和 User 一对一关联
type UserProfile struct {
	ID              uint     `gorm:"primaryKey" json:"id"`
	UserID          uint     `gorm:"uniqueIndex;not null" json:"user_id"` // 一对一：一个用户只有一份档案
	HeightCm        float64  `json:"height_cm"`                           // 身高（厘米）
	WeightKg        float64  `json:"weight_kg"`                           // 体重（公斤）
	Age             int      `json:"age"`                                 // 年龄
	Gender          string   `json:"gender"`                              // male / female / other
	Goal            string   `json:"goal"`                                // lose_weight / maintain / gain_muscle
	Allergies       []string `gorm:"serializer:json" json:"allergies"`    // 过敏原列表，存储为 JSON 数组
	DietaryHabits   []string `gorm:"serializer:json" json:"dietary_habits"` // 饮食习惯 ["vegetarian", "no_pork"]
	ChronicDiseases []string `gorm:"serializer:json" json:"chronic_diseases"` // 基础病列表 ["hypertension", "diabetes"]
}
