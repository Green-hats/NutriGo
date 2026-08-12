// 可观测性中间件：结构化请求日志 + 内置指标 + /metrics 暴露
package middleware

import (
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Metrics 进程内计数指标，暴露为 Prometheus 文本格式
type Metrics struct {
	mu       sync.Mutex
	started  time.Time
	total    int64
	byStatus map[int]int64
	byMethod map[string]int64
}

// NewMetrics 创建指标收集器
func NewMetrics() *Metrics {
	return &Metrics{
		started:  time.Now(),
		byStatus: make(map[int]int64),
		byMethod: make(map[string]int64),
	}
}

// Middleware 返回 gin 中间件：记录请求指标 + 输出结构化访问日志
func (m *Metrics) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		status := c.Writer.Status()
		m.record(c.Request.Method, status)

		// 结构化访问日志（替代 gin 默认 Logger）
		slog.Info("http request",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", status,
			"duration_ms", time.Since(start).Milliseconds(),
			"client_ip", ClientIP(c),
			"user_id", c.GetUint("userID"),
		)
	}
}

func (m *Metrics) record(method string, status int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.total++
	m.byStatus[status]++
	m.byMethod[method]++
}

// Handler 返回 /metrics 处理器（Prometheus 文本格式）
func (m *Metrics) Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		m.mu.Lock()
		defer m.mu.Unlock()

		var b []byte
		b = append(b, fmt.Sprintf("# HELP nutrigo_uptime_seconds 服务运行秒数\n")...)
		b = append(b, fmt.Sprintf("# TYPE nutrigo_uptime_seconds gauge\n")...)
		b = append(b, fmt.Sprintf("nutrigo_uptime_seconds %d\n", int(time.Since(m.started).Seconds()))...)
		b = append(b, fmt.Sprintf("# TYPE nutrigo_requests_total counter\n")...)
		b = append(b, fmt.Sprintf("nutrigo_requests_total %d\n", m.total)...)
		b = append(b, fmt.Sprintf("# TYPE nutrigo_requests_by_status counter\n")...)
		for status, n := range m.byStatus {
			b = append(b, fmt.Sprintf("nutrigo_requests_by_status{status=\"%d\"} %d\n", status, n)...)
		}
		b = append(b, fmt.Sprintf("# TYPE nutrigo_requests_by_method counter\n")...)
		for method, n := range m.byMethod {
			b = append(b, fmt.Sprintf("nutrigo_requests_by_method{method=\"%s\"} %d\n", method, n)...)
		}

		c.Data(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", b)
	}
}
