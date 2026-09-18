package handler

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"nutri.go/backend/internal/model"
)

func batchRequest(t *testing.T, db *gorm.DB, user uint, id string, records []dietInput) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{"request_id": id, "records": records})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", user)
	c.Request = httptest.NewRequest("POST", "/api/diet/logs/batch", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	(&DietHandler{DB: db}).CreateBatch(c)
	return w
}

func TestDietBatchAtomicAndIdempotent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	id := "de7b36a7-d2fa-4162-82ab-0d559ca6f125"
	records := []dietInput{
		{Date: "2026-09-18", MealType: "lunch", FoodName: "米饭", Calories: 200},
		{Date: "2026-09-18", MealType: "lunch", FoodName: "炒青菜", Calories: 150},
	}
	first := batchRequest(t, db, 7, id, records)
	if first.Code != 201 {
		t.Fatalf("%d %s", first.Code, first.Body)
	}
	retry := batchRequest(t, db, 7, id, records)
	if retry.Code != 200 || retry.Body.String() != first.Body.String() {
		t.Fatalf("重试未返回原回执: %d %s", retry.Code, retry.Body)
	}
	var count int64
	db.Model(&model.FoodDiary{}).Count(&count)
	if count != 2 {
		t.Fatalf("重复记账: %d", count)
	}
	records[0].Calories = 300
	if w := batchRequest(t, db, 7, id, records); w.Code != 409 {
		t.Fatalf("同一编号不同内容应拒绝: %d", w.Code)
	}
	// 用户之间的请求编号隔离，不返回别人的回执。
	if w := batchRequest(t, db, 8, id, records); w.Code != 201 {
		t.Fatalf("账户未隔离: %d", w.Code)
	}
	var userRecords []model.FoodDiary
	db.Where("user_id = ?", 8).Find(&userRecords)
	if len(userRecords) != 2 || userRecords[0].Calories != 300 {
		t.Fatal("返回了其他用户的数据")
	}
}

func TestDietBatchFailureRollsBackReceiptAndAllRecords(t *testing.T) {
	db := setupTestDB(t)
	image := model.FoodImage{UserID: 8, Filename: "other.jpg"}
	if err := db.Create(&image).Error; err != nil {
		t.Fatal(err)
	}
	id := "de7b36a7-d2fa-4162-82ab-0d559ca6f125"
	records := []dietInput{
		{Date: "2026-09-18", MealType: "dinner", FoodName: "米饭"},
		{Date: "2026-09-18", MealType: "dinner", FoodName: "炒青菜", ImageID: &image.ID},
	}
	if w := batchRequest(t, db, 7, id, records); w.Code != 400 {
		t.Fatalf("未拒绝他人的照片: %d", w.Code)
	}
	for _, table := range []any{&model.FoodDiary{}, &model.DietBatch{}} {
		var count int64
		db.Model(table).Count(&count)
		if count != 0 {
			t.Fatal("失败事务留有部分数据")
		}
	}
	records[1].ImageID = nil
	if w := batchRequest(t, db, 7, id, records); w.Code != 201 {
		t.Fatalf("失败回执阻止修正: %d", w.Code)
	}
}

func TestDietBatchValidation(t *testing.T) {
	db := setupTestDB(t)
	id := "de7b36a7-d2fa-4162-82ab-0d559ca6f125"
	for _, records := range [][]dietInput{nil, make([]dietInput, 13), {{Date: "2026-02-31", MealType: "lunch", FoodName: "米饭"}}} {
		if w := batchRequest(t, db, 7, id, records); w.Code != 400 {
			t.Fatalf("无效输入应拒绝: %d", w.Code)
		}
	}
	if w := batchRequest(t, db, 7, "bad", []dietInput{{Date: "2026-09-18", MealType: "lunch", FoodName: "米饭"}}); w.Code != 400 {
		t.Fatalf("无效编号: %d", w.Code)
	}
}
