// 认证接口限流配置
package config

// 认证接口限流（令牌桶算法）：
//   - AuthRateLimitRPS：每秒补充令牌数（每分钟 5 次）
//   - AuthRateLimitBurst：桶容量，允许的瞬时突发请求数
const (
	AuthRateLimitRPS   = float64(5) / 60.0
	AuthRateLimitBurst = 5
)
