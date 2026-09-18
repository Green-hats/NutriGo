package model

import "time"

// DietBatch 保存提交回执，使断网后的同一请求重试不会重复记账。
type DietBatch struct {
	ID          uint   `gorm:"primaryKey"`
	UserID      uint   `gorm:"not null;uniqueIndex:idx_diet_batch_request"`
	RequestID   string `gorm:"not null;uniqueIndex:idx_diet_batch_request"`
	PayloadHash string `gorm:"not null"`
	Response    string `gorm:"not null"`
	CreatedAt   time.Time
}
