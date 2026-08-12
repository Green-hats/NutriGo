// 可观测性中间件测试
package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// 测试：Metrics 中间件记录请求指标，/metrics 输出 Prometheus 文本
func TestMetricsCountsRequestsAndExposesPrometheus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	m := NewMetrics()
	r := gin.New()
	r.Use(m.Middleware())
	r.GET("/ok", func(c *gin.Context) { c.Status(http.StatusOK) })
	r.GET("/metrics", m.Handler())

	// 打 2 次 200 + 1 次 404
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/ok", nil))
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/ok", nil))
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/missing", nil))

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/metrics", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("/metrics 状态码 = %d, 期望 200", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, "nutrigo_requests_total 3") {
		t.Errorf("请求总数应含 3, got:\n%s", body)
	}
	if !strings.Contains(body, `nutrigo_requests_by_status{status="200"} 2`) {
		t.Errorf("200 计数应含 2, got:\n%s", body)
	}
	if !strings.Contains(body, `nutrigo_requests_by_status{status="404"} 1`) {
		t.Errorf("404 计数应含 1, got:\n%s", body)
	}
	if !strings.Contains(body, `nutrigo_requests_by_method{method="GET"} 3`) {
		t.Errorf("GET 计数应含 3, got:\n%s", body)
	}
}

// 测试：uptime 指标存在
func TestMetricsIncludesUptime(t *testing.T) {
	gin.SetMode(gin.TestMode)
	m := NewMetrics()
	r := gin.New()
	r.GET("/metrics", m.Handler())

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/metrics", nil))

	if !strings.Contains(w.Body.String(), "nutrigo_uptime_seconds") {
		t.Errorf("应有 uptime 指标, got:\n%s", w.Body.String())
	}
}
