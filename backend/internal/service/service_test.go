// 后台任务（聚合/清理）单元测试
package service

import (
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
	if err := db.AutoMigrate(models...); err != nil {
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
