// 图片上传与获取 handler 测试
package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"

	"nutri.go/backend/internal/model"
)

// 1x1 红色 PNG，头部为合法 PNG 魔数，可供 http.DetectContentType 识别
var tinyPNG = []byte{
	0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 'I', 'H', 'D', 'R',
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
	0xde, 0x00, 0x00, 0x00, 0x0c, 'I', 'D', 'A', 'T',
	0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00,
	0x00, 0x03, 0x00, 0x01, 0xff, 0xff, 0x00, 0x00,
	0x00, 0x00, 'I', 'E', 'N', 'D', 0xae, 0x42, 0x60,
	0x82,
}

// newUploadRequest 构造一个 multipart 上传请求
func newUploadRequest(t *testing.T, filename string, content []byte) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("image", filename)
	if err != nil {
		t.Fatalf("创建表单失败: %v", err)
	}
	part.Write(content)
	if err := writer.Close(); err != nil {
		t.Fatalf("关闭 writer 失败: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/images/upload", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

// 测试 Upload：合法 PNG 上传成功，文件落盘并记录 DB
func TestImageUploadSuccess(t *testing.T) {
	t.Chdir(t.TempDir()) // 让 uploads/ 目录落在临时目录，避免污染仓库
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &ImageHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Request = newUploadRequest(t, "meal.png", tinyPNG)

	h.Upload(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("状态码 = %d, 期望 201, body=%s", w.Code, w.Body.String())
	}

	body := mustJSONBody(t, w.Body.Bytes())
	if body["id"].(float64) == 0 {
		t.Error("返回的图片 id 不应为 0")
	}
	if body["mime_type"] != "image/png" {
		t.Errorf("mime_type = %v, 期望 image/png", body["mime_type"])
	}

	// 文件应已写入 uploads/ 目录
	entries, err := os.ReadDir(uploadDir)
	if err != nil {
		t.Fatalf("uploads 目录不存在: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("uploads 文件数 = %d, 期望 1", len(entries))
	}
}

// 测试 Upload：非图片文件（文本）返回 400
func TestImageUploadRejectsNonImage(t *testing.T) {
	t.Chdir(t.TempDir())
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &ImageHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Request = newUploadRequest(t, "evil.txt", []byte("hello world not an image"))

	h.Upload(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("状态码 = %d, 期望 400", w.Code)
	}
}

// 测试 Upload：超过 10MB 返回 400
func TestImageUploadRejectsTooLarge(t *testing.T) {
	t.Chdir(t.TempDir())
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &ImageHandler{DB: db}

	// 在合法 PNG 头部后面追加超大块，模拟超大图片
	content := append(append([]byte{}, tinyPNG...), make([]byte, maxFileSize)...)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Request = newUploadRequest(t, "big.png", content)

	h.Upload(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("状态码 = %d, 期望 400", w.Code)
	}
}

// 测试 GetMeta：内部路由读取元信息成功
func TestImageGetMeta(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	image := model.FoodImage{UserID: 1, Filename: "abc.png", Path: "/tmp/abc.png", MimeType: "image/png", SizeBytes: 100}
	db.Create(&image)
	h := &ImageHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = []gin.Param{{Key: "id", Value: fmt.Sprint(image.ID)}}

	h.GetMeta(c)
	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 200", w.Code)
	}
	body := mustJSONBody(t, w.Body.Bytes())
	if body["user_id"].(float64) != 1 {
		t.Errorf("user_id = %v, 期望 1", body["user_id"])
	}
}

// 测试 GetMeta：图片不存在返回 404
func TestImageGetMetaNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &ImageHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = []gin.Param{{Key: "id", Value: "999"}}

	h.GetMeta(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("状态码 = %d, 期望 404", w.Code)
	}
}

// 测试 GetData：返回图片二进制内容
func TestImageGetData(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "meal.png")
	if err := os.WriteFile(path, tinyPNG, 0644); err != nil {
		t.Fatalf("写测试文件失败: %v", err)
	}
	image := model.FoodImage{UserID: 1, Filename: "meal.png", Path: path, MimeType: "image/png", SizeBytes: int64(len(tinyPNG))}
	db.Create(&image)
	h := &ImageHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = []gin.Param{{Key: "id", Value: fmt.Sprint(image.ID)}}
	c.Request = httptest.NewRequest(http.MethodGet, "/api/images/"+fmt.Sprint(image.ID)+"/data", nil)

	h.GetData(c)
	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 200", w.Code)
	}
	if !bytes.Equal(w.Body.Bytes(), tinyPNG) {
		t.Error("返回的二进制与文件内容不一致")
	}
}

// 测试 GetData：磁盘文件丢失返回 404
func TestImageGetDataFileMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	image := model.FoodImage{UserID: 1, Filename: "gone.png", Path: filepath.Join(t.TempDir(), "gone.png"), MimeType: "image/png"}
	db.Create(&image)
	h := &ImageHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = []gin.Param{{Key: "id", Value: fmt.Sprint(image.ID)}}

	h.GetData(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("状态码 = %d, 期望 404", w.Code)
	}
}

// 测试 Delete：删除自己的图片，DB 与磁盘文件一并删除
func TestImageDeleteOwn(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "meal.png")
	if err := os.WriteFile(path, tinyPNG, 0644); err != nil {
		t.Fatalf("写测试文件失败: %v", err)
	}
	image := model.FoodImage{UserID: 1, Filename: "meal.png", Path: path, MimeType: "image/png"}
	db.Create(&image)
	h := &ImageHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Params = []gin.Param{{Key: "id", Value: fmt.Sprint(image.ID)}}
	c.Request = httptest.NewRequest(http.MethodDelete, "/api/images/"+fmt.Sprint(image.ID), nil)

	h.Delete(c)
	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 200", w.Code)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("磁盘文件应已被删除")
	}
	var count int64
	db.Model(&model.FoodImage{}).Count(&count)
	if count != 0 {
		t.Errorf("DB 记录应已删除，剩余 %d 条", count)
	}
}

// 测试 Delete：删除他人图片返回 403
func TestImageDeleteOthersForbidden(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	image := model.FoodImage{UserID: 2, Filename: "other.png", Path: filepath.Join(t.TempDir(), "other.png"), MimeType: "image/png"}
	db.Create(&image)
	h := &ImageHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Params = []gin.Param{{Key: "id", Value: fmt.Sprint(image.ID)}}
	c.Request = httptest.NewRequest(http.MethodDelete, "/api/images/"+fmt.Sprint(image.ID), nil)

	h.Delete(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("状态码 = %d, 期望 403", w.Code)
	}
}

// 测试 Delete：图片不存在返回 404
func TestImageDeleteNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	h := &ImageHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("userID", uint(1))
	c.Params = []gin.Param{{Key: "id", Value: "999"}}
	c.Request = httptest.NewRequest(http.MethodDelete, "/api/images/999", nil)

	h.Delete(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("状态码 = %d, 期望 404", w.Code)
	}
}

// 测试 GetMeta 响应不泄露磁盘路径
func TestImageMetaHidesPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := setupTestDB(t)
	image := model.FoodImage{UserID: 1, Filename: "abc.png", Path: "/etc/secret-path.png", MimeType: "image/png", SizeBytes: 100}
	db.Create(&image)
	h := &ImageHandler{DB: db}

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = []gin.Param{{Key: "id", Value: fmt.Sprint(image.ID)}}

	h.GetMeta(c)
	if w.Code != http.StatusOK {
		t.Fatalf("状态码 = %d, 期望 200", w.Code)
	}
	if bytes.Contains(w.Body.Bytes(), []byte("secret-path")) {
		t.Error("GetMeta 不应泄露磁盘路径")
	}
	var raw map[string]json.RawMessage
	_ = json.Unmarshal(w.Body.Bytes(), &raw)
	if _, ok := raw["path"]; ok {
		t.Error("GetMeta 不应返回 path 字段")
	}
}
