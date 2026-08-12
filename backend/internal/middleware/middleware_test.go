// 中间件单元测试
package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"nutri.go/backend/internal/config"
	"nutri.go/backend/internal/model"
)

// testTokenDB 创建内存 SQLite 并迁移黑名单表，供 JWTAuth 测试使用
func testTokenDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("打开内存库失败: %v", err)
	}
	if err := db.AutoMigrate(&model.BlacklistedToken{}); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	return db
}

// setupRouter 注册一个挂载了中间件的空 handler，方便测试中间件行为
func setupRouter(mw gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/test", mw, func(c *gin.Context) {
		userID := c.GetUint("userID")
		username, _ := c.Get("username")
		c.JSON(http.StatusOK, gin.H{"user_id": userID, "username": username})
	})
	return r
}

// 测试 JWTAuth：无 Authorization 头返回 401
func TestJWTAuthMissingHeader(t *testing.T) {
	r := setupRouter(JWTAuth(testTokenDB(t)))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("状态码 = %d, 期望 401", w.Code)
	}
}

// 测试 JWTAuth：非 Bearer 格式返回 401
func TestJWTAuthMalformedHeader(t *testing.T) {
	r := setupRouter(JWTAuth(testTokenDB(t)))

	for _, h := range []string{"Token abc", "Bearer", "Bearer ", ""} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("Authorization", h)
		r.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("header=%q 状态码 = %d, 期望 401", h, w.Code)
		}
	}
}

// 测试 JWTAuth：无效/被篡改 token 返回 401
func TestJWTAuthInvalidToken(t *testing.T) {
	r := setupRouter(JWTAuth(testTokenDB(t)))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer invalid.token.here")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("状态码 = %d, 期望 401", w.Code)
	}
}

// 测试 JWTAuth：错误密钥签发的 token 无法通过
func TestJWTAuthWrongSecret(t *testing.T) {
	r := setupRouter(JWTAuth(testTokenDB(t)))

	wrongToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, config.JWTClaims{
		UserID:   1,
		Username: "test",
	}).SignedString([]byte("wrong-secret"))
	if err != nil {
		t.Fatalf("签发测试 token 失败: %v", err)
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+wrongToken)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("状态码 = %d, 期望 401", w.Code)
	}
}

// 测试 JWTAuth：合法 token 通过并把 userID/username 注入上下文
func TestJWTAuthValidToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := setupRouter(JWTAuth(testTokenDB(t)))

	tokenStr, err := config.GenerateToken(42, "xiaoming")
	if err != nil {
		t.Fatalf("GenerateToken 失败: %v", err)
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 200", w.Code)
	}
	if body := w.Body.String(); body != `{"user_id":42,"username":"xiaoming"}` {
		t.Errorf("上下文注入错误, got %s", body)
	}
}

// 测试 JWTAuth：被登出吊销的 token（jti 在黑名单）返回 401
func TestJWTAuthRejectsBlacklistedToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := testTokenDB(t)
	r := setupRouter(JWTAuth(db))

	tokenStr, err := config.GenerateToken(42, "xiaoming")
	if err != nil {
		t.Fatalf("GenerateToken 失败: %v", err)
	}

	// 解析出 jti 并加入黑名单
	claims := &config.JWTClaims{}
	_, err = jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		return config.JWTSecret, nil
	})
	if err != nil {
		t.Fatalf("解析 token 失败: %v", err)
	}
	db.Create(&model.BlacklistedToken{
		UserID:    42,
		JTI:       claims.ID,
		ExpiresAt: claims.ExpiresAt.Time,
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("状态码 = %d, 期望 401（token 已吊销）", w.Code)
	}
}

// 测试 InternalAuth：正确 token 通过
func TestInternalAuthValidToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/test", InternalAuth(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("X-Internal-Token", config.InternalToken)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 200", w.Code)
	}
}

// 测试 InternalAuth：缺失/错误 token 返回 403
func TestInternalAuthRejectsBadToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/test", InternalAuth(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	for _, token := range []string{"", "wrong-token", config.InternalToken + "x"} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("X-Internal-Token", token)
		r.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Errorf("token=%q 状态码 = %d, 期望 403", token, w.Code)
		}
	}
}
