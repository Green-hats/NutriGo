// 基于 IP 的令牌桶限流中间件
// 用于登录/注册等敏感接口，防止密码爆破与恶意高频请求。
package middleware

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// limiterEntry 一个 IP 对应的限流器及其最近活跃时间
type limiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// IPRateLimiter 按客户端 IP 维护独立的令牌桶
type IPRateLimiter struct {
	mu      sync.Mutex
	entries map[string]*limiterEntry
	rps     rate.Limit    // 令牌补充速率（个/秒）
	burst   int           // 桶容量（瞬时突发上限）
	idleTTL time.Duration // 空闲多久后从内存清除，防 map 无限膨胀
}

// NewIPRateLimiter 创建限流器。rps 为每秒补充令牌数，burst 为突发上限。
func NewIPRateLimiter(rps float64, burst int) *IPRateLimiter {
	return &IPRateLimiter{
		entries: make(map[string]*limiterEntry),
		rps:     rate.Limit(rps),
		burst:   burst,
		idleTTL: 10 * time.Minute,
	}
}

// get 获取（或创建）某 IP 对应的限流器，并刷新活跃时间
func (l *IPRateLimiter) get(ip string) *rate.Limiter {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[ip]
	if !ok {
		e = &limiterEntry{
			limiter:  rate.NewLimiter(l.rps, l.burst),
			lastSeen: now,
		}
		l.entries[ip] = e
	} else {
		e.lastSeen = now
	}
	return e.limiter
}

// cleanup 删除超过 idleTTL 未活动的限流器，释放内存
func (l *IPRateLimiter) cleanup(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for ip, e := range l.entries {
		if now.Sub(e.lastSeen) > l.idleTTL {
			delete(l.entries, ip)
		}
	}
}

// StartCleanup 启动后台定时清理空闲限流器
func (l *IPRateLimiter) StartCleanup(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for now := range ticker.C {
			l.cleanup(now)
		}
	}()
}

// Middleware 返回 gin 中间件：超限返回 429
func (l *IPRateLimiter) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := ClientIP(c)
		if !l.get(ip).Allow() {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "请求过于频繁，请稍后再试"})
			return
		}
		c.Next()
	}
}

// ClientIP 获取客户端真实 IP：
// 生产环境经 Caddy 反向代理，优先取 X-Forwarded-For 首个地址；
// 其次 X-Real-IP；兜底解析 RemoteAddr。
func ClientIP(c *gin.Context) string {
	if ip := c.GetHeader("X-Forwarded-For"); ip != "" {
		if idx := strings.IndexByte(ip, ','); idx > 0 {
			ip = ip[:idx] // 取最左侧真实来源
		}
		return strings.TrimSpace(ip)
	}
	if ip := c.GetHeader("X-Real-IP"); ip != "" {
		return strings.TrimSpace(ip)
	}
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		return c.Request.RemoteAddr
	}
	return host
}
