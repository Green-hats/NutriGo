// 限流中间件单元测试
package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// rateTestRouter 挂载限流中间件 + 空 handler 的测试路由
func rateTestRouter(l *IPRateLimiter) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/test", l.Middleware(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	return r
}

// doRequest 发起一次带指定来源 IP 的请求
func doRequest(r *gin.Engine, remoteAddr string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.RemoteAddr = remoteAddr + ":12345"
	r.ServeHTTP(w, req)
	return w
}

// 测试：同一 IP 在突发额度内放行，超出后返回 429
func TestRateLimitBlocksAfterBurst(t *testing.T) {
	l := NewIPRateLimiter(1, 2) // 1 req/s 补充，桶容量 2
	r := rateTestRouter(l)

	// 桶初始满 2 个令牌，两次请求应放行
	for i := 0; i < 2; i++ {
		if w := doRequest(r, "1.2.3.4"); w.Code != http.StatusOK {
			t.Fatalf("第 %d 次请求状态码 = %d, 期望 200", i+1, w.Code)
		}
	}
	// 第 3 次令牌耗尽，应被限流
	if w := doRequest(r, "1.2.3.4"); w.Code != http.StatusTooManyRequests {
		t.Fatalf("超出限额状态码 = %d, 期望 429", w.Code)
	}
}

// 测试：不同 IP 的限额相互独立
func TestRateLimitIndependentPerIP(t *testing.T) {
	l := NewIPRateLimiter(1, 1) // 每 IP 最多 1 次突发
	r := rateTestRouter(l)

	if w := doRequest(r, "1.2.3.4"); w.Code != http.StatusOK {
		t.Fatalf("IP 1.2.3.4 首次请求 = %d, 期望 200", w.Code)
	}
	if w := doRequest(r, "1.2.3.4"); w.Code != http.StatusTooManyRequests {
		t.Fatalf("IP 1.2.3.4 二次请求 = %d, 期望 429", w.Code)
	}
	// 不同 IP 不受影响
	if w := doRequest(r, "5.6.7.8"); w.Code != http.StatusOK {
		t.Fatalf("IP 5.6.7.8 首次请求 = %d, 期望 200", w.Code)
	}
}

// 测试：令牌随时间恢复（等待一个补充周期后可再次放行）
func TestRateLimitTokensRefill(t *testing.T) {
	l := NewIPRateLimiter(1, 1) // 每秒补充 1 个
	r := rateTestRouter(l)

	if w := doRequest(r, "1.2.3.4"); w.Code != http.StatusOK {
		t.Fatalf("首次请求 = %d, 期望 200", w.Code)
	}
	if w := doRequest(r, "1.2.3.4"); w.Code != http.StatusTooManyRequests {
		t.Fatalf("二次请求 = %d, 期望 429", w.Code)
	}
	// 等待超过 1 秒，令牌补充 1 个
	time.Sleep(1100 * time.Millisecond)
	if w := doRequest(r, "1.2.3.4"); w.Code != http.StatusOK {
		t.Fatalf("恢复后请求 = %d, 期望 200", w.Code)
	}
}

// 测试：X-Forwarded-For 与 X-Real-IP 优先于 RemoteAddr
func TestClientIPPicksForwardedHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ip": ClientIP(c)})
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.RemoteAddr = "203.0.113.9:9999"
	req.Header.Set("X-Forwarded-For", "198.51.100.7, 10.0.0.1")
	r.ServeHTTP(w, req)
	if body := w.Body.String(); body != `{"ip":"198.51.100.7"}` {
		t.Errorf("X-Forwarded-For 应取首个地址, got %s", body)
	}

	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet, "/test", nil)
	req2.RemoteAddr = "203.0.113.9:9999"
	req2.Header.Set("X-Real-IP", "192.0.2.55")
	r.ServeHTTP(w2, req2)
	if body := w2.Body.String(); body != `{"ip":"192.0.2.55"}` {
		t.Errorf("X-Real-IP 应被采用, got %s", body)
	}

	w3 := httptest.NewRecorder()
	req3 := httptest.NewRequest(http.MethodGet, "/test", nil)
	req3.RemoteAddr = "203.0.113.9:9999"
	r.ServeHTTP(w3, req3)
	if body := w3.Body.String(); body != `{"ip":"203.0.113.9"}` {
		t.Errorf("无代理头应解析 RemoteAddr, got %s", body)
	}
}

// 测试：超限请求被中间件拦截（无 X-Forwarded-For 时用 RemoteAddr）
func TestRateLimitUsesRemoteAddrByDefault(t *testing.T) {
	l := NewIPRateLimiter(1, 1)
	r := rateTestRouter(l)

	if w := doRequest(r, "9.9.9.9"); w.Code != http.StatusOK {
		t.Fatalf("首次请求 = %d, 期望 200", w.Code)
	}
	if w := doRequest(r, "9.9.9.9"); w.Code != http.StatusTooManyRequests {
		t.Fatalf("二次请求 = %d, 期望 429", w.Code)
	}
}

// 测试：cleanup 移除空闲条目，防止内存膨胀
func TestRateLimitCleanupIdleEntries(t *testing.T) {
	l := NewIPRateLimiter(1, 1)
	l.idleTTL = -time.Second // 任意经过时长都视为空闲

	l.get("1.2.3.4")
	l.get("5.6.7.8")
	if len(l.entries) != 2 {
		t.Fatalf("清理前条目数 = %d, 期望 2", len(l.entries))
	}

	l.cleanup(time.Now().Add(time.Second))
	if len(l.entries) != 0 {
		t.Fatalf("清理后条目数 = %d, 期望 0", len(l.entries))
	}

	// 清理后新请求可正常创建条目
	if w := doRequest(rateTestRouter(l), "1.2.3.4"); w.Code != http.StatusOK {
		t.Fatalf("清理后首次请求 = %d, 期望 200", w.Code)
	}
}
