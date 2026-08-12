// 令牌清理任务
// 定期删除已过期的黑名单令牌与刷新令牌，防止表无限增长
package service

import (
	"log/slog"
	"time"

	"gorm.io/gorm"

	"nutri.go/backend/internal/model"
)

const tokenCleanupInterval = 6 * time.Hour

// StartTokenCleanup 启动后台 goroutine，清理过期令牌记录
func StartTokenCleanup(db *gorm.DB) {
	go func() {
		for {
			runTokenCleanup(db)
			time.Sleep(tokenCleanupInterval)
		}
	}()
}

// runTokenCleanup 执行一次清理：删除过期黑名单与过期/已吊销刷新令牌。
// 独立函数便于单元测试。
func runTokenCleanup(db *gorm.DB) {
	now := time.Now()

	blacklisted := db.Where("expires_at < ?", now).Delete(&model.BlacklistedToken{})
	expired := db.Where("expires_at < ?", now).Delete(&model.RefreshToken{})
	revoked := db.Where("revoked_at IS NOT NULL").Delete(&model.RefreshToken{})

	if blacklisted.RowsAffected > 0 || expired.RowsAffected > 0 || revoked.RowsAffected > 0 {
		slog.Info("清理过期令牌",
			"blacklisted", blacklisted.RowsAffected,
			"expired_refresh", expired.RowsAffected,
			"revoked_refresh", revoked.RowsAffected,
		)
	}
}
