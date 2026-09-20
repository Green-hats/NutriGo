package model

import "time"

// ImageDeletion 与图片元信息的删除在同一事务中写入，文件删除成功后才移除。
// 独立保存任务，避免进程退出或文件系统故障让待删除文件失去追踪。
type ImageDeletion struct {
	ID        uint   `gorm:"primaryKey"`
	ImageID   uint   `gorm:"not null;uniqueIndex"`
	Path      string `gorm:"not null"`
	UserID    uint   `gorm:"not null;default:0;index"`
	SizeBytes int64  `gorm:"not null;default:0"`
	CreatedAt time.Time
}
