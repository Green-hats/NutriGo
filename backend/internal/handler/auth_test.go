// 用户认证 handler 测试
package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"nutri.go/backend/internal/config"
	"nutri.go/backend/internal/model"
)

// 测试 Register：成功注册返回 201，密码已 bcrypt 加密存储
func TestRegisterSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &AuthHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/register",
		bytes.NewBufferString(`{"username":"xiaoming","password":"secret123"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.Register(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("状态码 = %d, 期望 201", w.Code)
	}

	var user model.User
	if err := db.First(&user).Error; err != nil {
		t.Fatalf("用户未写入数据库: %v", err)
	}
	if user.Username != "xiaoming" {
		t.Errorf("username = %q, 期望 xiaoming", user.Username)
	}
	if user.Password == "secret123" {
		t.Error("密码不应明文存储")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte("secret123")); err != nil {
		t.Error("存储的 bcrypt 哈希无法验证明文密码")
	}
}

// 测试 Register：用户名重复返回 409
func TestRegisterDuplicateUsername(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	db.Create(&model.User{Username: "xiaoming", Password: "hashed"})
	h := &AuthHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/register",
		bytes.NewBufferString(`{"username":"xiaoming","password":"secret123"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.Register(c)
	if w.Code != http.StatusConflict {
		t.Fatalf("状态码 = %d, 期望 409", w.Code)
	}
}

// 测试 Register：参数无效（密码太短）返回 400
func TestRegisterInvalidParams(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &AuthHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/register",
		bytes.NewBufferString(`{"username":"xiaoming","password":"123"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.Register(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("状态码 = %d, 期望 400", w.Code)
	}
}

// 测试 Register：缺少字段返回 400
func TestRegisterMissingFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &AuthHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/register",
		bytes.NewBufferString(`{}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.Register(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("状态码 = %d, 期望 400", w.Code)
	}
}

// 测试 Login：正确凭据返回 token
func TestLoginSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	hashed, _ := bcrypt.GenerateFromPassword([]byte("secret123"), bcrypt.DefaultCost)
	db.Create(&model.User{Username: "xiaoming", Password: string(hashed)})
	h := &AuthHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"username":"xiaoming","password":"secret123"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.Login(c)
	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 200", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("解析响应失败: %v", err)
	}
	if body["token"] == nil || body["token"] == "" {
		t.Error("登录成功应返回非空 token")
	}
	if body["username"] != "xiaoming" {
		t.Errorf("username = %v, 期望 xiaoming", body["username"])
	}
}

// 测试 Login：错误密码返回 401，且与不存在的用户返回一致（防用户枚举）
func TestLoginWrongPasswordAndUnknownUserSameError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	hashed, _ := bcrypt.GenerateFromPassword([]byte("secret123"), bcrypt.DefaultCost)
	db.Create(&model.User{Username: "xiaoming", Password: string(hashed)})
	h := &AuthHandler{DB: db}

	wrongPass := httptest.NewRecorder()
	c1, _ := gin.CreateTestContext(wrongPass)
	c1.Request = httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"username":"xiaoming","password":"wrong"}`))
	c1.Request.Header.Set("Content-Type", "application/json")
	h.Login(c1)

	unknown := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(unknown)
	c2.Request = httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"username":"nobody","password":"wrong"}`))
	c2.Request.Header.Set("Content-Type", "application/json")
	h.Login(c2)

	if wrongPass.Code != http.StatusUnauthorized {
		t.Fatalf("错误密码状态码 = %d, 期望 401", wrongPass.Code)
	}
	if unknown.Code != http.StatusUnauthorized {
		t.Fatalf("未知用户状态码 = %d, 期望 401", unknown.Code)
	}
	if wrongPass.Body.String() != unknown.Body.String() {
		t.Errorf("错误密码与未知用户的响应应一致（防枚举），got %q vs %q",
			wrongPass.Body.String(), unknown.Body.String())
	}
}

// 测试 Login：缺少字段返回 400
func TestLoginMissingParams(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &AuthHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"username":"xiaoming"}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.Login(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("状态码 = %d, 期望 400", w.Code)
	}
	// 统一错误码契约
	body := mustJSONBody(t, w.Body.Bytes())
	if body["code"] != "VALIDATION_ERROR" {
		t.Errorf("错误码 = %v, 期望 VALIDATION_ERROR", body["code"])
	}
	if body["message"] == "" {
		t.Error("错误响应应包含 message")
	}
}

// ============================================================
// 刷新令牌 + 登出黑名单测试
// ============================================================

// loginForTokens 注册并登录，返回响应体（含 token / refresh_token）
func loginForTokens(t *testing.T, db *gorm.DB) map[string]any {
	t.Helper()
	hashed, _ := bcrypt.GenerateFromPassword([]byte("secret123"), bcrypt.DefaultCost)
	db.Create(&model.User{Username: "xiaoming", Password: string(hashed)})
	h := &AuthHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"username":"xiaoming","password":"secret123"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.Login(c)
	if w.Code != http.StatusOK {
		t.Fatalf("登录状态码 = %d, 期望 200", w.Code)
	}
	return mustJSONBody(t, w.Body.Bytes())
}

// 测试 Login：返回 refresh_token，且刷新令牌以哈希入库
func TestLoginReturnsRefreshToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	body := loginForTokens(t, db)

	if body["refresh_token"] == nil || body["refresh_token"] == "" {
		t.Fatal("登录应返回 refresh_token")
	}
	if body["token"] == nil || body["token"] == "" {
		t.Fatal("登录应返回 token")
	}

	// 数据库只存哈希，不存明文
	var count int64
	db.Model(&model.RefreshToken{}).Count(&count)
	if count != 1 {
		t.Fatalf("refresh 记录数 = %d, 期望 1", count)
	}
	raw := body["refresh_token"].(string)
	var hashedCount int64
	db.Model(&model.RefreshToken{}).Where("token_hash = ?", config.HashToken(raw)).Count(&hashedCount)
	if hashedCount != 1 {
		t.Error("refresh_token 应以 SHA-256 哈希入库")
	}
	var plainCount int64
	db.Model(&model.RefreshToken{}).Where("token_hash = ?", raw).Count(&plainCount)
	if plainCount > 0 {
		t.Error("数据库不应存 refresh_token 明文")
	}
}

// 测试 Refresh：轮换机制——旧刷新令牌立即失效，新令牌对可用
func TestRefreshRotatesTokens(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	body := loginForTokens(t, db)
	oldRefresh := body["refresh_token"].(string)

	h := &AuthHandler{DB: db}
	// 用旧刷新令牌换取新令牌对
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/refresh",
		bytes.NewBufferString(`{"refresh_token":"`+oldRefresh+`"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.Refresh(c)
	if w.Code != http.StatusOK {
		t.Fatalf("刷新状态码 = %d, 期望 200", w.Code)
	}
	newBody := mustJSONBody(t, w.Body.Bytes())
	if newBody["refresh_token"].(string) == oldRefresh {
		t.Error("刷新后应返回新的 refresh_token")
	}

	// 旧刷新令牌已被轮换，再次使用应失败（防重放）
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	c2.Request = httptest.NewRequest(http.MethodPost, "/api/auth/refresh",
		bytes.NewBufferString(`{"refresh_token":"`+oldRefresh+`"}`))
	c2.Request.Header.Set("Content-Type", "application/json")
	h.Refresh(c2)
	if w2.Code != http.StatusUnauthorized {
		t.Fatalf("复用旧 refresh_token 状态码 = %d, 期望 401", w2.Code)
	}
}

// 测试 Refresh：无效/缺失令牌返回 401/400
func TestRefreshRejectsInvalid(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &AuthHandler{DB: db}

	// 缺失字段
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/refresh", bytes.NewBufferString(`{}`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.Refresh(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("缺失字段状态码 = %d, 期望 400", w.Code)
	}

	// 伪造令牌
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	c2.Request = httptest.NewRequest(http.MethodPost, "/api/auth/refresh",
		bytes.NewBufferString(`{"refresh_token":"fake-token"}`))
	c2.Request.Header.Set("Content-Type", "application/json")
	h.Refresh(c2)
	if w2.Code != http.StatusUnauthorized {
		t.Fatalf("伪造令牌状态码 = %d, 期望 401", w2.Code)
	}
}

// 测试 Logout：将当前 access token 的 jti 加入黑名单，并可吊销 refresh token
func TestLogoutBlacklistsAccessToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	body := loginForTokens(t, db)
	h := &AuthHandler{DB: db}

	// 解析 access token 的 jti 和过期时间
	tokenStr := body["token"].(string)
	claims := &config.JWTClaims{}
	_, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		return config.JWTSecret, nil
	})
	if err != nil {
		t.Fatalf("解析 token 失败: %v", err)
	}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Set("jti", claims.ID)
	c.Set("tokenExp", claims.ExpiresAt.Time)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/logout",
		bytes.NewBufferString(`{"refresh_token":"`+body["refresh_token"].(string)+`"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.Logout(c)
	if w.Code != http.StatusOK {
		t.Fatalf("登出状态码 = %d, 期望 200", w.Code)
	}

	// jti 已入黑名单
	var blackCount int64
	db.Model(&model.BlacklistedToken{}).Where("jti = ?", claims.ID).Count(&blackCount)
	if blackCount != 1 {
		t.Errorf("jti 应写入黑名单, 命中 %d 条", blackCount)
	}

	// refresh token 已吊销
	var rt model.RefreshToken
	if err := db.Where("token_hash = ?", config.HashToken(body["refresh_token"].(string))).First(&rt).Error; err != nil {
		t.Fatalf("查询 refresh 记录失败: %v", err)
	}
	if rt.RevokedAt == nil {
		t.Error("refresh token 应被吊销")
	}
}

// 测试 Refresh：重放检测——被轮换的旧令牌再次使用，吊销整个令牌家族
func TestRefreshReuseRevokesFamily(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	body := loginForTokens(t, db)
	h := &AuthHandler{DB: db}

	// 第一次刷新：轮换，得到新令牌对
	oldRefresh := body["refresh_token"].(string)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auth/refresh",
		bytes.NewBufferString(`{"refresh_token":"`+oldRefresh+`"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.Refresh(c)
	if w.Code != http.StatusOK {
		t.Fatalf("首次刷新状态码 = %d, 期望 200", w.Code)
	}
	newRefresh := mustJSONBody(t, w.Body.Bytes())["refresh_token"].(string)

	// 攻击者重放旧令牌 → 401，且触发家族吊销
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	c2.Request = httptest.NewRequest(http.MethodPost, "/api/auth/refresh",
		bytes.NewBufferString(`{"refresh_token":"`+oldRefresh+`"}`))
	c2.Request.Header.Set("Content-Type", "application/json")
	h.Refresh(c2)
	if w2.Code != http.StatusUnauthorized {
		t.Fatalf("重放旧令牌状态码 = %d, 期望 401", w2.Code)
	}

	// 家族已被吊销：刚换到的新令牌也不可用
	w3 := httptest.NewRecorder()
	c3, _ := gin.CreateTestContext(w3)
	c3.Request = httptest.NewRequest(http.MethodPost, "/api/auth/refresh",
		bytes.NewBufferString(`{"refresh_token":"`+newRefresh+`"}`))
	c3.Request.Header.Set("Content-Type", "application/json")
	h.Refresh(c3)
	if w3.Code != http.StatusUnauthorized {
		t.Fatalf("家族吊销后新令牌状态码 = %d, 期望 401", w3.Code)
	}
}
