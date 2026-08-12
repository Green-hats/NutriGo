// 用户认证 handler 测试
package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

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
}
