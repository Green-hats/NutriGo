// 食物图片模型
package model

import "time"

// FoodImage 用户上传的食物图片记录
type FoodImage struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"not null;index" json:"user_id"`
	Filename  string    `gorm:"not null" json:"filename"` // UUID 重命名后的文件名
	Path      string    `gorm:"not null" json:"-"`        // 服务器上的完整路径，JSON 不暴露
	MimeType  string    `json:"mime_type"`
	SizeBytes int64     `json:"size_bytes"`
	CreatedAt time.Time `json:"created_at"`
}
