// 饮食记录 handler 测试
package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"nutri.go/backend/internal/model"
)

// 测试 Create：成功创建记录返回 201，归属当前用户
func TestDietCreateSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &DietHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(7))
	c.Request = httptest.NewRequest(http.MethodPost, "/api/diet/logs",
		bytes.NewBufferString(`{"date":"2026-08-01","meal_type":"lunch","food_name":"宫保鸡丁","portion":"1份","calories":450,"protein_g":30}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.Create(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("状态码 = %d, 期望 201", w.Code)
	}

	var created model.FoodDiary
	if err := db.First(&created).Error; err != nil {
		t.Fatalf("记录未写入数据库: %v", err)
	}
	if created.UserID != 7 {
		t.Errorf("UserID = %d, 期望 7", created.UserID)
	}
	if created.FoodName != "宫保鸡丁" {
		t.Errorf("FoodName = %q, 期望 宫保鸡丁", created.FoodName)
	}
}

// 测试 Create：缺少必填字段（date/food_name）返回 400
func TestDietCreateMissingFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &DietHandler{DB: db}

	for _, body := range []string{`{"food_name":"米饭"}`, `{"date":"2026-08-01"}`} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("userID", uint(1))
		c.Request = httptest.NewRequest(http.MethodPost, "/api/diet/logs", bytes.NewBufferString(body))
		c.Request.Header.Set("Content-Type", "application/json")

		h.Create(c)
		if w.Code != http.StatusBadRequest {
			t.Errorf("body=%s 状态码 = %d, 期望 400", body, w.Code)
		}
	}
}

// 测试 List：只返回当前用户某一天的记录，按创建时间倒序
func TestDietListByUserAndDate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	db.Create(&model.FoodDiary{UserID: 1, Date: "2026-08-01", FoodName: "A"})
	db.Create(&model.FoodDiary{UserID: 1, Date: "2026-08-01", FoodName: "B"})
	db.Create(&model.FoodDiary{UserID: 2, Date: "2026-08-01", FoodName: "C"})
	db.Create(&model.FoodDiary{UserID: 1, Date: "2026-08-02", FoodName: "D"})
	h := &DietHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Request = httptest.NewRequest(http.MethodGet, "/api/diet/logs?date=2026-08-01", nil)

	h.List(c)
	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 200", w.Code)
	}

	var records []model.FoodDiary
	if err := json.Unmarshal(w.Body.Bytes(), &records); err != nil {
		t.Fatalf("解析响应失败: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("记录条数 = %d, 期望 2（仅用户1 的 08-01）", len(records))
	}
	for _, r := range records {
		if r.UserID != 1 {
			t.Errorf("返回了他人记录: %+v", r)
		}
	}
}

// 测试 List：缺 date 参数返回 400
func TestDietListMissingDate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &DietHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Request = httptest.NewRequest(http.MethodGet, "/api/diet/logs", nil)

	h.List(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("状态码 = %d, 期望 400", w.Code)
	}
}

// 测试 List：非法日期格式返回 400
func TestDietListInvalidDate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &DietHandler{DB: db}

	for _, date := range []string{"2026-8-1", "2026/08/01", "2026-08-32", "20260801", "2026-08-01T00:00:00"} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("userID", uint(1))
		c.Request = httptest.NewRequest(http.MethodGet, "/api/diet/logs?date="+date, nil)

		h.List(c)
		if w.Code != http.StatusBadRequest {
			t.Errorf("date=%q 状态码 = %d, 期望 400", date, w.Code)
		}
	}
}

// 测试 Delete：本人记录删除成功
func TestDietDeleteOwnRecord(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	record := model.FoodDiary{UserID: 1, Date: "2026-08-01", FoodName: "A"}
	db.Create(&record)
	h := &DietHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Params = []gin.Param{{Key: "id", Value: fmt.Sprint(record.ID)}}
	c.Request = httptest.NewRequest(http.MethodDelete, "/api/diet/logs/"+fmt.Sprint(record.ID), nil)

	h.Delete(c)
	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 200", w.Code)
	}
	var count int64
	db.Model(&model.FoodDiary{}).Count(&count)
	if count != 0 {
		t.Errorf("删除后剩余 %d 条记录", count)
	}
}

// 测试 Delete：删除他人记录返回 403
func TestDietDeleteOthersRecordForbidden(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	record := model.FoodDiary{UserID: 2, Date: "2026-08-01", FoodName: "A"}
	db.Create(&record)
	h := &DietHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Params = []gin.Param{{Key: "id", Value: fmt.Sprint(record.ID)}}
	c.Request = httptest.NewRequest(http.MethodDelete, "/api/diet/logs/"+fmt.Sprint(record.ID), nil)

	h.Delete(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("状态码 = %d, 期望 403", w.Code)
	}
	var count int64
	db.Model(&model.FoodDiary{}).Count(&count)
	if count != 1 {
		t.Errorf("他人记录不应被删除，剩余 %d 条", count)
	}
}

// 测试 Delete：记录不存在返回 404
func TestDietDeleteNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &DietHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Params = []gin.Param{{Key: "id", Value: "999"}}
	c.Request = httptest.NewRequest(http.MethodDelete, "/api/diet/logs/999", nil)

	h.Delete(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("状态码 = %d, 期望 404", w.Code)
	}
}

// 测试 ListInternal：缺 user_id 或 date 返回 400
func TestDietListInternalMissingParams(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &DietHandler{DB: db}

	for _, url := range []string{"/api/internal/diet/logs?date=2026-08-01", "/api/internal/diet/logs?user_id=1"} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, url, nil)
		h.ListInternal(c)
		if w.Code != http.StatusBadRequest {
			t.Errorf("url=%s 状态码 = %d, 期望 400", url, w.Code)
		}
	}
}

func dietRequest(t *testing.T, h *DietHandler, method, id, body string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Params = []gin.Param{{Key: "id", Value: id}}
	c.Request = httptest.NewRequest(method, "/api/diet/logs", bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if method == http.MethodPut {
		h.Update(c)
	} else {
		h.Create(c)
	}
	return w
}

func TestDietRejectsInvalidCreateAndUpdate(t *testing.T) {
	cases := []string{
		`{"date":"2026-02-30","meal_type":"lunch","food_name":"米饭"}`,
		`{"date":"2026-8-1","meal_type":"lunch","food_name":"米饭"}`,
		`{"date":"2026-08-01","meal_type":"invalid","food_name":"米饭"}`,
		`{"date":"2026-08-01","food_name":"米饭"}`,
		`{"date":"2026-08-01","meal_type":"lunch","food_name":"  "}`,
		`{"date":"2026-08-01","meal_type":"lunch","food_name":"米饭","calories":-1}`,
		`{"date":"2026-08-01","meal_type":"lunch","food_name":"米饭","protein_g":-1}`,
		`{"date":"2026-08-01","meal_type":"lunch","food_name":"米饭","fat_g":-1}`,
		`{"date":"2026-08-01","meal_type":"lunch","food_name":"米饭","carbs_g":-1}`,
		`{"date":"2026-08-01","meal_type":"lunch","food_name":"米饭","calories":1e100}`,
		`{"date":"2026-08-01","meal_type":"lunch","food_name":"米饭","image_id":0}`,
	}
	for _, method := range []string{http.MethodPost, http.MethodPut} {
		for _, body := range cases {
			db := setupTestDB(t)
			r := model.FoodDiary{UserID: 1, Date: "2026-08-01", FoodName: "original", Calories: 1}
			db.Create(&r)
			w := dietRequest(t, &DietHandler{DB: db}, method, fmt.Sprint(r.ID), body)
			if w.Code != 400 {
				t.Fatalf("%s %s: got %d %s", method, body, w.Code, w.Body.String())
			}
			var rows []model.FoodDiary
			db.Find(&rows)
			if len(rows) != 1 || rows[0].FoodName != "original" {
				t.Fatal("无效请求修改了记录")
			}
		}
	}
}

func TestDietImageOwnershipAndEditZeroValues(t *testing.T) {
	db := setupTestDB(t)
	h := &DietHandler{DB: db}
	own := model.FoodImage{UserID: 1, Filename: "own", Path: "own"}
	other := model.FoodImage{UserID: 2, Filename: "other", Path: "other"}
	db.Create(&own)
	db.Create(&other)
	valid := `{"date":"2026-08-01","meal_type":"lunch","food_name":"米饭","calories":120,"image_id":%d}`
	w := dietRequest(t, h, http.MethodPost, "", fmt.Sprintf(valid, own.ID))
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	var record model.FoodDiary
	json.Unmarshal(w.Body.Bytes(), &record)
	for _, method := range []string{http.MethodPost, http.MethodPut} {
		for _, id := range []uint{other.ID, 99999} {
			w = dietRequest(t, h, method, fmt.Sprint(record.ID), fmt.Sprintf(valid, id))
			if w.Code != 400 {
				t.Fatal(method, "应拒绝他人或不存在图片", w.Code)
			}
		}
	}
	w = dietRequest(t, h, http.MethodPut, fmt.Sprint(record.ID), `{"date":"2026-07-01","meal_type":"breakfast","food_name":"  白开水  ","portion":"1杯","calories":0,"protein_g":0,"fat_g":0,"carbs_g":0,"image_id":null}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	record = model.FoodDiary{}
	db.First(&record, 1)
	if record.Calories != 0 || record.ImageID != nil || record.Date != "2026-07-01" || record.FoodName != "白开水" || record.MealType != "breakfast" {
		t.Fatalf("编辑未保存零值/日期/餐次: %+v", record)
	}
	var count int64
	db.Model(&model.FoodDiary{}).Count(&count)
	if count != 1 {
		t.Fatal("编辑不应创建重复记录")
	}
}

func TestDietUpdateOwnershipAndMissing(t *testing.T) {
	db := setupTestDB(t)
	r := model.FoodDiary{UserID: 2, Date: "2026-08-01", FoodName: "other"}
	db.Create(&r)
	h := &DietHandler{DB: db}
	body := `{"date":"2026-08-01","meal_type":"lunch","food_name":"new"}`
	for id, want := range map[string]int{fmt.Sprint(r.ID): 403, "99999": 404, "0": 400, "bad": 400} {
		if w := dietRequest(t, h, http.MethodPut, id, body); w.Code != want {
			t.Fatal(id, w.Code, w.Body.String())
		}
	}
}

func TestDietDatabaseFailureIsNotEmptySuccess(t *testing.T) {
	db := setupTestDB(t)
	db.Migrator().DropTable(&model.FoodDiary{})
	h := &DietHandler{DB: db}
	for _, internal := range []bool{false, true} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("userID", uint(1))
		c.Request = httptest.NewRequest("GET", "/api/diet/logs?user_id=1&date=2026-08-01", nil)
		if internal {
			h.ListInternal(c)
		} else {
			h.List(c)
		}
		if w.Code != 500 {
			t.Fatal("查询错误应返回500", w.Code)
		}
	}
	w := dietRequest(t, h, http.MethodPut, "1", `{"date":"2026-08-01","meal_type":"lunch","food_name":"rice"}`)
	if w.Code != 500 {
		t.Fatal("数据库失败不应伪装为404", w.Code)
	}
}
