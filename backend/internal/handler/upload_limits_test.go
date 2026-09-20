package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"nutri.go/backend/internal/config"
	"nutri.go/backend/internal/model"
	"nutri.go/backend/internal/service"
)

func uploadGuard() *service.UploadGuard {
	g := service.NewUploadGuard(config.LoadUploadLimits(), uploadDir)
	g.FreeBytes = func() (uint64, error) { return 100 << 30, nil }
	return g
}

func TestUploadQuotaAndDiskFailClosed(t *testing.T) {
	for _, kind := range []string{"user_bytes", "user_files", "total_bytes", "disk_low", "disk_error", "db_error", "pending_delete"} {
		t.Run(kind, func(t *testing.T) {
			t.Chdir(t.TempDir())
			db := setupTestDB(t)
			g := uploadGuard()
			expected := http.StatusConflict
			switch kind {
			case "user_bytes":
				g.Limits.UserBytes = int64(len(tinyPNG)) - 1
			case "user_files":
				g.Limits.UserFiles = 1
				db.Create(&model.FoodImage{UserID: 1, Filename: "old.png", Path: "old.png"})
			case "total_bytes":
				g.Limits.TotalBytes = int64(len(tinyPNG)) - 1
				expected = 507
			case "disk_low":
				g.FreeBytes = func() (uint64, error) { return uint64(g.Limits.MinFreeBytes), nil }
				expected = 507
			case "disk_error":
				g.FreeBytes = func() (uint64, error) { return 0, errors.New("unavailable") }
				expected = 507
			case "db_error":
				db.Migrator().DropTable(&model.FoodImage{})
				expected = 503
			case "pending_delete":
				g.Limits.UserBytes = 100
				db.Create(&model.ImageDeletion{UserID: 1, ImageID: 12, Path: "pending.png", SizeBytes: 100})
			}
			h := &ImageHandler{DB: db, Uploads: g}
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Set("userID", uint(1))
			c.Request = newUploadRequest(t, "meal.png", tinyPNG)
			h.Upload(c)
			if w.Code != expected {
				t.Fatalf("expected %d got %d: %s", expected, w.Code, w.Body.String())
			}
			entries, err := os.ReadDir(uploadDir)
			if err != nil || len(entries) != 0 {
				t.Fatalf("rejected upload left files: %v %v", entries, err)
			}
			// 拒绝请求也必须释放在途名额。
			g.FreeBytes = func() (uint64, error) { return 100 << 30, nil }
			finish, err := g.Begin(1)
			if err != nil {
				t.Fatal(err)
			}
			finish()
		})
	}
}

func TestUploadRateConcurrencyAndReservations(t *testing.T) {
	db := setupTestDB(t)
	g := uploadGuard()
	g.Limits.TotalBytes = 100
	var releases []func()
	for id := uint(1); id <= 4; id++ {
		finish, err := g.Begin(id)
		if err != nil {
			t.Fatal(err)
		}
		releases = append(releases, finish)
	}
	if _, err := g.Begin(5); !errors.Is(err, service.ErrUploadBusy) {
		t.Fatal("global admission failed", err)
	}
	if _, err := g.Begin(1); !errors.Is(err, service.ErrUploadBusy) {
		t.Fatal("user admission failed", err)
	}
	var wg sync.WaitGroup
	var success atomic.Int32
	for id := uint(1); id <= 4; id++ {
		wg.Go(func() {
			if err := g.Reserve(db, id, 100); err == nil {
				success.Add(1)
			}
		})
	}
	wg.Wait()
	if success.Load() != 1 {
		t.Fatalf("concurrent reservations exceeded total quota: %d", success.Load())
	}
	for _, finish := range releases {
		finish()
		finish()
	}
	g = uploadGuard()
	g.Limits.Burst = 1
	finish, err := g.Begin(1)
	if err != nil {
		t.Fatal(err)
	}
	finish()
	if _, err := g.Begin(1); !errors.Is(err, service.ErrUploadBusy) {
		t.Fatal("sequential rate limit failed", err)
	}
}

func TestSuccessfulDeletionRestoresQuota(t *testing.T) {
	t.Chdir(t.TempDir())
	db := setupTestDB(t)
	g := uploadGuard()
	g.Limits.UserBytes = int64(len(tinyPNG))
	h := &ImageHandler{DB: db, Uploads: g}
	call := func() int {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("userID", uint(1))
		c.Request = newUploadRequest(t, "meal.png", tinyPNG)
		h.Upload(c)
		return w.Code
	}
	if code := call(); code != 201 {
		t.Fatal(code)
	}
	if code := call(); code != 409 {
		t.Fatal(code)
	}
	var img model.FoodImage
	db.First(&img)
	job, err := service.QueueImageDeletion(db, img.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if job.SizeBytes != img.SizeBytes || job.UserID != img.UserID {
		t.Fatal("deletion lost quota ownership")
	}
	if err := service.CompleteImageDeletion(db, job); err != nil {
		t.Fatal(err)
	}
	if code := call(); code != 201 {
		t.Fatal(code)
	}
}
