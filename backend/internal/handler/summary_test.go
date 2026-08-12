// 每日汇总 handler 测试
// 用内存 SQLite + gin test mode 验证 ListInternal 的合并逻辑
package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"nutri.go/backend/internal/model"
)

// setupTestDB 创建内存 SQLite 并建表
func setupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("打开内存库失败: %v", err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.FoodDiary{}, &model.DailySummary{}, &model.UserProfile{}, &model.FoodImage{}, &model.RefreshToken{}, &model.BlacklistedToken{}); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	return db
}

// 测试 ListInternal 合并实时记录 + 聚合表，且按日期排序
func TestListInternalMergesLiveAndAggregated(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)

	// 用相对日期保证与聚合保留期（7 天）逻辑一致，不受运行日期影响
	now := time.Now()
	day := func(offset int) string {
		return now.AddDate(0, 0, offset).Format("2006-01-02")
	}
	recent1 := day(-2) // 近 7 天内 → 实时聚合
	recent2 := day(-1)
	old := day(-30) // 7 天前 → 已聚合进 daily_summaries

	// 近 7 天的记录存在 food_diaries（实时聚合）
	db.Create(&model.FoodDiary{UserID: 1, Date: recent1, FoodName: "米饭", Calories: 200, ProteinG: 6})
	db.Create(&model.FoodDiary{UserID: 1, Date: recent2, FoodName: "面条", Calories: 300, ProteinG: 8})

	// 7 天前的记录已聚合进 daily_summaries
	db.Create(&model.DailySummary{UserID: 1, Date: old, TotalCalories: 500, TotalProteinG: 20, MealCount: 2})

	h := &SummaryHandler{DB: db}

	// 构造请求：跨两段日期
	req := httptest.NewRequest(http.MethodGet,
		fmt.Sprintf("/api/internal/diet/summaries?user_id=1&start=%s&end=%s", day(-31), day(0)), nil)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.ListInternal(c)

	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 200", w.Code)
	}

	var result []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("解析响应失败: %v", err)
	}
	if len(result) != 3 {
		t.Fatalf("结果条数 = %d, 期望 3 (2 live + 1 aggregated)", len(result))
	}

	// 验证日期升序排序
	if result[0]["date"] != old || result[1]["date"] != recent1 || result[2]["date"] != recent2 {
		t.Errorf("排序错误: %v", []string{
			fmt.Sprint(result[0]["date"]), fmt.Sprint(result[1]["date"]), fmt.Sprint(result[2]["date"]),
		})
	}

	// 验证 source 标记
	if result[0]["source"] != "aggregated" {
		t.Errorf("%s 应来自聚合表, got %v", old, result[0]["source"])
	}
	if result[1]["source"] != "live" {
		t.Errorf("%s 应来自实时聚合, got %v", recent1, result[1]["source"])
	}

	// 验证实时聚合的热量正确（只有 200，无 recent2 混淆）
	if cal := result[1]["total_calories"].(float64); cal != 200 {
		t.Errorf("%s 热量 = %v, 期望 200", recent1, cal)
	}
}

// 测试 ListInternal 缺 user_id 返回 400
func TestListInternalMissingUserID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &SummaryHandler{DB: db}

	req := httptest.NewRequest(http.MethodGet,
		"/api/internal/diet/summaries?start=2026-07-01&end=2026-08-31", nil)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.ListInternal(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("状态码 = %d, 期望 400", w.Code)
	}
	if !strings.Contains(w.Body.String(), "user_id") {
		t.Errorf("错误信息应提示 user_id, got %s", w.Body.String())
	}
}

// 测试 ListInternal 缺日期参数返回 400
func TestListInternalMissingDates(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &SummaryHandler{DB: db}

	req := httptest.NewRequest(http.MethodGet, "/api/internal/diet/summaries?user_id=1", nil)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.ListInternal(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("状态码 = %d, 期望 400", w.Code)
	}
}

// 测试 ListInternal 非法日期格式返回 400
func TestListInternalInvalidDates(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &SummaryHandler{DB: db}

	for _, qs := range []string{
		"user_id=1&start=2026-7-1&end=2026-08-31",
		"user_id=1&start=2026-07-01&end=2026/08/31",
		"user_id=1&start=2026-02-30&end=2026-08-31",
		"user_id=1&start=20260701&end=2026-08-31",
	} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/internal/diet/summaries?"+qs, nil)

		h.ListInternal(c)
		if w.Code != http.StatusBadRequest {
			t.Errorf("query=%q 状态码 = %d, 期望 400", qs, w.Code)
		}
	}
}

// 测试 List：分页返回 { items, total, limit, offset }
func TestListPaginated(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	// 插入 5 条不同日期的汇总
	for i, d := range []string{"2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"} {
		db.Create(&model.DailySummary{UserID: 1, Date: d, TotalCalories: float64(i + 1), MealCount: 1})
	}
	h := &SummaryHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Request = httptest.NewRequest(http.MethodGet,
		"/api/diet/summaries?start=2026-08-01&end=2026-08-31&limit=2&offset=2", nil)

	h.List(c)
	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 200", w.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("解析响应失败: %v", err)
	}
	if body["total"].(float64) != 5 {
		t.Errorf("total = %v, 期望 5", body["total"])
	}
	if body["limit"].(float64) != 2 || body["offset"].(float64) != 2 {
		t.Errorf("limit/offset = %v/%v, 期望 2/2", body["limit"], body["offset"])
	}
	items := body["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("items 条数 = %d, 期望 2", len(items))
	}
	// 按日期倒序：第 3/4 条 → 08-03、08-02
	first := items[0].(map[string]any)
	if first["date"] != "2026-08-03" {
		t.Errorf("第一项日期 = %v, 期望 2026-08-03（倒序+分页）", first["date"])
	}
}

// 测试 List：limit 超过上限被钳制，非法 offset 回退 0
func TestListPaginationClamps(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	db.Create(&model.DailySummary{UserID: 1, Date: "2026-08-01", TotalCalories: 1, MealCount: 1})
	h := &SummaryHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Request = httptest.NewRequest(http.MethodGet,
		"/api/diet/summaries?start=2026-08-01&end=2026-08-31&limit=9999&offset=-5", nil)

	h.List(c)
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["limit"].(float64) != 100 {
		t.Errorf("limit = %v, 期望钳制为 100", body["limit"])
	}
	if body["offset"].(float64) != 0 {
		t.Errorf("offset = %v, 期望非法值回退 0", body["offset"])
	}
}
