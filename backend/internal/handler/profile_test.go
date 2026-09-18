// 健康档案 handler 测试
package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"nutri.go/backend/internal/model"
)

// 测试 GetProfile：越权访问他人档案返回 403
func TestGetProfileForbiddenForOtherUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &ProfileHandler{DB: db}

	// JWT 中的 userID=1，但请求路径是 /users/2/profile
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Params = []gin.Param{{Key: "id", Value: "2"}}

	h.GetProfile(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("状态码 = %d, 期望 403", w.Code)
	}
}

// 测试 GetProfile：自己的档案返回 200
func TestGetProfileOwnProfile(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	db.Create(&model.UserProfile{
		UserID:    1,
		HeightCm:  175,
		WeightKg:  78,
		Age:       32,
		Gender:    "male",
		Goal:      "lose_weight",
		Allergies: []string{"peanut"},
	})
	h := &ProfileHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Params = []gin.Param{{Key: "id", Value: "1"}}

	h.GetProfile(c)
	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 200", w.Code)
	}

	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["height_cm"].(float64) != 175 {
		t.Errorf("height_cm = %v, 期望 175", body["height_cm"])
	}
	allergies, _ := body["allergies"].([]any)
	if len(allergies) != 1 || allergies[0] != "peanut" {
		t.Errorf("allergies = %v, 期望 [peanut]", body["allergies"])
	}
}

// 测试 GetProfile：未填档案返回空默认值而非 404
func TestGetProfileEmptyReturnsDefaults(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &ProfileHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Params = []gin.Param{{Key: "id", Value: "1"}}

	h.GetProfile(c)
	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 200（空档案返回默认值）", w.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["height_cm"].(float64) != 0 {
		t.Errorf("空档案 height_cm = %v, 期望 0", body["height_cm"])
	}
	if body["allergies"] == nil {
		t.Error("空档案 allergies 应为空数组而非 null")
	}
}

// 测试 UpdateProfile：创建 + 更新档案（含基础病）
func TestUpdateProfileCreateAndUpdate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &ProfileHandler{DB: db}

	// 创建
	body := `{"height_cm":170,"weight_kg":70,"age":30,"gender":"male","goal":"maintain",
		"allergies":["peanut"],"dietary_habits":[],"chronic_diseases":["hypertension","diabetes"]}`
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Params = []gin.Param{{Key: "id", Value: "1"}}
	c.Request = httptest.NewRequest(http.MethodPut, "/api/users/1/profile", bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")

	h.UpdateProfile(c)
	if w.Code != http.StatusOK {
		t.Fatalf("创建状态码 = %d, 期望 200", w.Code)
	}
	var created map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	chronic, _ := created["chronic_diseases"].([]any)
	if len(chronic) != 2 {
		t.Errorf("chronic_diseases = %v, 期望 2 项", created["chronic_diseases"])
	}

	// 更新
	body2 := `{"height_cm":175,"weight_kg":75,"age":31,"gender":"male","goal":"gain_muscle",
		"allergies":[],"dietary_habits":[],"chronic_diseases":["gout"]}`
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	c2.Set("userID", uint(1))
	c2.Params = []gin.Param{{Key: "id", Value: "1"}}
	c2.Request = httptest.NewRequest(http.MethodPut, "/api/users/1/profile", bytes.NewBufferString(body2))
	c2.Request.Header.Set("Content-Type", "application/json")

	h.UpdateProfile(c2)
	if w2.Code != http.StatusOK {
		t.Fatalf("更新状态码 = %d, 期望 200", w2.Code)
	}
	var updated map[string]any
	_ = json.Unmarshal(w2.Body.Bytes(), &updated)
	if updated["height_cm"].(float64) != 175 {
		t.Errorf("更新后 height_cm = %v, 期望 175", updated["height_cm"])
	}
	gout, _ := updated["chronic_diseases"].([]any)
	if len(gout) != 1 || gout[0] != "gout" {
		t.Errorf("更新后 chronic_diseases = %v, 期望 [gout]", updated["chronic_diseases"])
	}
}

// 测试 UpdateProfile：越权修改他人档案返回 403
func TestUpdateProfileForbiddenForOtherUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &ProfileHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Params = []gin.Param{{Key: "id", Value: "2"}}
	c.Request = httptest.NewRequest(http.MethodPut, "/api/users/2/profile",
		bytes.NewBufferString(`{"height_cm":170}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.UpdateProfile(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("状态码 = %d, 期望 403", w.Code)
	}
}

func TestUpdateProfileInvalidInputDoesNotChangeProfile(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name, body, message string
	}{
		{"decimal age", `{"height_cm":180,"age":10.9}`, "年龄请输入 0–150 之间的整数"},
		{"negative age", `{"height_cm":180,"age":-1}`, "年龄请输入 0–150 之间的整数"},
		{"age too large", `{"height_cm":180,"age":151}`, "年龄请输入 0–150 之间的整数"},
		{"age overflow", `{"age":99999999999999999999999}`, "年龄请输入 0–150 之间的整数"},
		{"string age", `{"age":"10.9"}`, "年龄请输入 0–150 之间的整数"},
		{"wrong field type", `{"height_cm":"wrong"}`, "档案格式不正确，请检查填写内容"},
		{"malformed JSON", `{"age":`, "档案格式不正确，请检查填写内容"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupTestDB(t)
			original := model.UserProfile{UserID: 1, Age: 32, HeightCm: 175}
			if err := db.Create(&original).Error; err != nil {
				t.Fatal(err)
			}
			h := &ProfileHandler{DB: db}
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Set("userID", uint(1))
			c.Params = []gin.Param{{Key: "id", Value: "1"}}
			c.Request = httptest.NewRequest(http.MethodPut, "/api/users/1/profile", bytes.NewBufferString(tc.body))
			c.Request.Header.Set("Content-Type", "application/json")
			h.UpdateProfile(c)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
			}
			body := mustJSONBody(t, w.Body.Bytes())
			if body["code"] != "VALIDATION_ERROR" || body["message"] != tc.message {
				t.Fatalf("unexpected error: %v", body)
			}
			var saved model.UserProfile
			if err := db.Where("user_id = ?", 1).First(&saved).Error; err != nil {
				t.Fatal(err)
			}
			if saved.Age != original.Age || saved.HeightCm != original.HeightCm {
				t.Fatalf("invalid request modified profile: %+v", saved)
			}
		})
	}
}

func TestUpdateProfileAgeBoundsAndDecimalMeasurements(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, age := range []int{0, 11, 150} {
		db := setupTestDB(t)
		h := &ProfileHandler{DB: db}
		payload, err := json.Marshal(map[string]any{"age": age, "height_cm": 175.5, "weight_kg": 68.2})
		if err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("userID", uint(1))
		c.Params = []gin.Param{{Key: "id", Value: "1"}}
		c.Request = httptest.NewRequest(http.MethodPut, "/api/users/1/profile", bytes.NewReader(payload))
		c.Request.Header.Set("Content-Type", "application/json")
		h.UpdateProfile(c)
		if w.Code != http.StatusOK {
			t.Fatalf("age %d: status = %d, body = %s", age, w.Code, w.Body.String())
		}
		body := mustJSONBody(t, w.Body.Bytes())
		if body["age"] != float64(age) || body["height_cm"] != 175.5 || body["weight_kg"] != 68.2 {
			t.Fatalf("unexpected saved values: %v", body)
		}
	}
}
