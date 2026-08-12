// 令牌模型
package model

import "time"

// RefreshToken 刷新令牌（持久化）。
// 只存 TokenHash（SHA-256），不存明文；轮换时旧令牌置 RevokedAt。
// FamilyID 标识令牌家族：一次登录派生的所有刷新令牌同属一个家族，
// 用于检测重放——某令牌被轮换后再次使用视为泄露，吊销整个家族。
type RefreshToken struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	UserID    uint       `gorm:"not null;index" json:"user_id"`
	FamilyID  string     `gorm:"not null;index;default:''" json:"-"`
	TokenHash string     `gorm:"not null;uniqueIndex" json:"-"`
	ExpiresAt time.Time  `gorm:"not null;index" json:"expires_at"`
	RevokedAt *time.Time `json:"revoked_at"`
	CreatedAt time.Time  `json:"created_at"`
}

// BlacklistedToken 被吊销的访问令牌（按 jti 记录，到期后由清理任务删除）
type BlacklistedToken struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"not null;index" json:"user_id"`
	JTI       string    `gorm:"not null;uniqueIndex" json:"-"`
	ExpiresAt time.Time `gorm:"not null;index" json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}
