// 后台任务（聚合/清理）单元测试
package service

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"nutri.go/backend/internal/model"
)

// setupServiceDB 创建内存 SQLite 并迁移相关表
func setupServiceDB(t *testing.T, models ...any) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("打开内存库失败: %v", err)
	}
	if err := db.AutoMigrate(append(models, &model.ImageDeletion{})...); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	return db
}

func daysAgo(n int) time.Time {
	return time.Now().AddDate(0, 0, -n)
}

// ============================================================
// 图片清理任务
// ============================================================

func TestImageCleanupRemovesExpired(t *testing.T) {
	db := setupServiceDB(t, &model.FoodImage{}, &model.FoodDiary{})
	dir := t.TempDir()

	// 过期图片：磁盘文件存在
	oldPath := filepath.Join(dir, "old.png")
	if err := os.WriteFile(oldPath, []byte("x"), 0644); err != nil {
		t.Fatalf("写测试文件失败: %v", err)
	}
	db.Create(&model.FoodImage{UserID: 1, Filename: "old.png", Path: oldPath, CreatedAt: daysAgo(10)})

	// 新图片（保留期内）
	newPath := filepath.Join(dir, "new.png")
	db.Create(&model.FoodImage{UserID: 1, Filename: "new.png", Path: newPath, CreatedAt: time.Now()})

	runImageCleanup(db)

	// DB：旧记录删除，新记录保留
	var images []model.FoodImage
	db.Find(&images)
	if len(images) != 1 {
		t.Fatalf("图片条数 = %d, 期望 1", len(images))
	}
	// 磁盘：旧文件删除
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Error("过期图片的磁盘文件应被删除")
	}
}

func TestImageCleanupSkipsMissingFile(t *testing.T) {
	db := setupServiceDB(t, &model.FoodImage{}, &model.FoodDiary{})
	// 过期但文件已丢失：清理应跳过删除，仍删 DB 记录
	db.Create(&model.FoodImage{UserID: 1, Filename: "gone.png", Path: filepath.Join(t.TempDir(), "gone.png"), CreatedAt: daysAgo(10)})

	runImageCleanup(db)
	var count int64
	db.Model(&model.FoodImage{}).Count(&count)
	if count != 0 {
		t.Fatalf("DB 记录应被清理, 剩余 %d", count)
	}
}

func TestImageCleanupNoDataNoError(t *testing.T) {
	db := setupServiceDB(t, &model.FoodImage{}, &model.FoodDiary{})
	runImageCleanup(db) // 空库不应报错
}

// ============================================================
// 令牌清理任务
// ============================================================

func TestTokenCleanupRemovesExpiredAndRevoked(t *testing.T) {
	db := setupServiceDB(t, &model.BlacklistedToken{}, &model.RefreshToken{})

	// 过期黑名单 + 有效黑名单
	db.Create(&model.BlacklistedToken{UserID: 1, JTI: "expired-jti", ExpiresAt: daysAgo(1)})
	db.Create(&model.BlacklistedToken{UserID: 1, JTI: "valid-jti", ExpiresAt: time.Now().Add(24 * time.Hour)})

	// 过期刷新 + 已吊销刷新 + 有效刷新
	revokedAt := daysAgo(1)
	db.Create(&model.RefreshToken{UserID: 1, TokenHash: "expired-rt", ExpiresAt: daysAgo(1)})
	db.Create(&model.RefreshToken{UserID: 1, TokenHash: "revoked-rt", ExpiresAt: time.Now().Add(24 * time.Hour), RevokedAt: &revokedAt})
	db.Create(&model.RefreshToken{UserID: 1, TokenHash: "valid-rt", ExpiresAt: time.Now().Add(24 * time.Hour)})

	runTokenCleanup(db)

	var blackCount, rtCount int64
	db.Model(&model.BlacklistedToken{}).Count(&blackCount)
	db.Model(&model.RefreshToken{}).Count(&rtCount)
	if blackCount != 1 {
		t.Errorf("黑名单剩余 = %d, 期望 1（仅有效）", blackCount)
	}
	if rtCount != 1 {
		t.Errorf("刷新令牌剩余 = %d, 期望 1（仅有效）", rtCount)
	}
}

func TestTokenCleanupNoDataNoError(t *testing.T) {
	db := setupServiceDB(t, &model.BlacklistedToken{}, &model.RefreshToken{})
	runTokenCleanup(db)
}

func TestImageCleanupPreservesLinkedHistory(t *testing.T) {
	db := setupServiceDB(t, &model.FoodImage{}, &model.FoodDiary{})
	p := filepath.Join(t.TempDir(), "saved.jpg")
	if err := os.WriteFile(p, []byte("photo"), 0600); err != nil {
		t.Fatal(err)
	}
	img := model.FoodImage{UserID: 1, Filename: "saved.jpg", Path: p, CreatedAt: daysAgo(90)}
	db.Create(&img)
	record := model.FoodDiary{UserID: 1, Date: daysAgo(90).Format("2006-01-02"), FoodName: "历史午餐", ImageID: &img.ID}
	db.Create(&record)
	runImageCleanup(db)
	if err := db.First(&record, record.ID).Error; err != nil {
		t.Fatal("历史明细不能被清理", err)
	}
	if err := db.First(&img, img.ID).Error; err != nil {
		t.Fatal("已关联图片不能被清理", err)
	}
	if _, err := os.Stat(p); err != nil {
		t.Fatal("已关联图片文件不能被清理", err)
	}
}

func TestImageCleanupDisabledOrInvalidRetention(t *testing.T) {
	for _, value := range []string{"0", "invalid", "-1"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("UNATTACHED_IMAGE_RETENTION_DAYS", value)
			db := setupServiceDB(t, &model.FoodImage{}, &model.FoodDiary{})
			img := model.FoodImage{UserID: 1, Filename: "old.jpg", Path: "/missing", CreatedAt: daysAgo(90)}
			db.Create(&img)
			runImageCleanup(db)
			if err := db.First(&img, img.ID).Error; err != nil {
				t.Fatal("禁用或错误配置不能触发删除", err)
			}
		})
	}
}

func TestImageCleanupQueryFailurePreservesFiles(t *testing.T) {
	db := setupServiceDB(t, &model.FoodImage{})
	p := filepath.Join(t.TempDir(), "old.jpg")
	os.WriteFile(p, []byte("photo"), 0600)
	img := model.FoodImage{UserID: 1, Filename: "old.jpg", Path: p, CreatedAt: daysAgo(90)}
	db.Create(&img)
	runImageCleanup(db)
	if _, err := os.Stat(p); err != nil {
		t.Fatal(err)
	}
}

func TestImageDeletionRetrySurvivesRestartWithRetentionDisabled(t *testing.T) {
	t.Setenv("UNATTACHED_IMAGE_RETENTION_DAYS", "0")
	dir := t.TempDir()
	dbFile := filepath.Join(dir, "test.db")
	db, err := gorm.Open(sqlite.Open(dbFile), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.FoodImage{}, &model.FoodDiary{}, &model.ImageDeletion{}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "nonempty")
	os.Mkdir(path, 0700)
	block := filepath.Join(path, "block")
	os.WriteFile(block, []byte("x"), 0600)
	img := model.FoodImage{UserID: 1, Path: path, Filename: "meal.png", CreatedAt: daysAgo(10)}
	db.Create(&img)
	job, err := QueueImageDeletion(db, img.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := CompleteImageDeletion(db, job); err == nil {
		t.Fatal("expected filesystem failure")
	}
	sqlDB, _ := db.DB()
	sqlDB.Close()
	// 模拟服务重启，任务仍存在。
	db, err = gorm.Open(sqlite.Open(dbFile), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ = db.DB()
	t.Cleanup(func() { sqlDB.Close() })
	os.Remove(block)
	runImageCleanup(db)
	var count int64
	db.Model(&model.ImageDeletion{}).Count(&count)
	if count != 0 {
		t.Fatal("retry task not completed")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("retry did not delete file", err)
	}
}

func TestImageReconciliationPreservesTrackedAndRecentFiles(t *testing.T) {
	db := setupServiceDB(t, &model.FoodImage{}, &model.FoodDiary{})
	dir := t.TempDir()
	paths := make([]string, 5)
	for i := range paths {
		paths[i] = filepath.Join(dir, fmt.Sprintf("00000000-0000-4000-8000-%012d.png", i))
		os.WriteFile(paths[i], []byte("x"), 0600)
		os.Chtimes(paths[i], daysAgo(2), daysAgo(2))
	}
	db.Create(&model.FoodImage{UserID: 1, Filename: filepath.Base(paths[1]), Path: paths[1]})
	db.Create(&model.ImageDeletion{ImageID: 100, Path: paths[2]})
	os.Chtimes(paths[3], time.Now(), time.Now())
	os.Remove(paths[4])
	os.Symlink(paths[1], paths[4])
	unknown := filepath.Join(dir, "keep-me.txt")
	os.WriteFile(unknown, []byte("x"), 0600)
	os.Chtimes(unknown, daysAgo(2), daysAgo(2))
	reconcileImageFiles(db, dir, time.Now().Add(-24*time.Hour))
	if _, err := os.Stat(paths[0]); !os.IsNotExist(err) {
		t.Fatal("orphan was not removed")
	}
	for _, path := range append(paths[1:], unknown) {
		if _, err := os.Lstat(path); err != nil {
			t.Fatal("protected file removed", path, err)
		}
	}
}

func TestImageReconciliationDatabaseFailurePreservesFile(t *testing.T) {
	db := setupServiceDB(t, &model.FoodDiary{})
	dir := t.TempDir()
	path := filepath.Join(dir, "00000000-0000-4000-8000-000000000000.png")
	os.WriteFile(path, []byte("x"), 0600)
	os.Chtimes(path, daysAgo(2), daysAgo(2))
	reconcileImageFiles(db, dir, time.Now().Add(-24*time.Hour))
	if _, err := os.Stat(path); err != nil {
		t.Fatal("database failure must not delete files", err)
	}
}

func TestConcurrentDiaryAttachPreventsStaleImageDeletion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "race.db")
	db, err := gorm.Open(sqlite.Open(path+"?_journal_mode=WAL&_busy_timeout=1000"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.FoodImage{}, &model.FoodDiary{}, &model.ImageDeletion{}); err != nil {
		t.Fatal(err)
	}
	other, err := gorm.Open(sqlite.Open(path+"?_journal_mode=WAL&_busy_timeout=1000"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, conn := range []*gorm.DB{db, other} {
		raw, _ := conn.DB()
		t.Cleanup(func() { raw.Close() })
	}
	img := model.FoodImage{UserID: 1, Filename: "meal.png", Path: filepath.Join(t.TempDir(), "meal.png")}
	os.WriteFile(img.Path, []byte("x"), 0600)
	if err := db.Create(&img).Error; err != nil {
		t.Fatal(err)
	}
	selected := make(chan struct{})
	resume := make(chan struct{})
	db.Callback().Delete().Before("gorm:delete").Register("test:pause_delete", func(tx *gorm.DB) {
		close(selected)
		<-resume
	})
	done := make(chan error, 1)
	go func() { _, err := QueueImageDeletion(db, img.ID, 1); done <- err }()
	<-selected
	// 另一个连接在删除事务读完图片之后，先提交新的日记关联。
	attachErr := other.Create(&model.FoodDiary{UserID: 1, Date: "2026-09-18", FoodName: "米饭", ImageID: &img.ID}).Error
	close(resume)
	deleteErr := <-done
	if attachErr != nil {
		t.Fatal(attachErr)
	}
	if deleteErr == nil {
		t.Fatal("stale delete must not succeed after a concurrent attach")
	}
	if err := other.First(&img, img.ID).Error; err != nil {
		t.Fatal("referenced image removed", err)
	}
	if _, err := os.Stat(img.Path); err != nil {
		t.Fatal(err)
	}
	var count int64
	other.Model(&model.ImageDeletion{}).Count(&count)
	if count != 0 {
		t.Fatal("failed transaction left a deletion job")
	}
}
