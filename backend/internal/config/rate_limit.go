// 认证接口限流配置
package config

import (
	"os"
	"strconv"
)

// 认证接口限流（令牌桶算法）默认值：每分钟 5 次、突发 5。
// 可通过环境变量覆盖（部署/集成测试调参）：
//
//	AUTH_RATE_LIMIT_PER_MIN  每分钟可放行的请求数
//	AUTH_RATE_LIMIT_BURST    允许的瞬时突发请求数
const (
	authRateLimitPerMin = 5
	authRateLimitBurst  = 5
)

// AuthRateLimitRPS 每秒补充令牌数（个/秒）
func AuthRateLimitRPS() float64 {
	if v := os.Getenv("AUTH_RATE_LIMIT_PER_MIN"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return float64(n) / 60.0
		}
	}
	return float64(authRateLimitPerMin) / 60.0
}

// AuthRateLimitBurst 桶容量（瞬时突发上限）
func AuthRateLimitBurst() int {
	if v := os.Getenv("AUTH_RATE_LIMIT_BURST"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return authRateLimitBurst
}
