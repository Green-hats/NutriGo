package service

import (
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"

	"gorm.io/gorm"
	"nutri.go/backend/internal/model"
)

const cleanupInterval = time.Hour

func StartImageCleanup(db *gorm.DB) {
	go func() {
		for {
			runImageCleanup(db)
			time.Sleep(cleanupInterval)
		}
	}()
}

// 已关联饮食记录的照片永久保留。0 关闭未关联照片的自动清理。
func runImageCleanup(db *gorm.DB) {
	// 已受理的删除不受未关联照片保留期影响，包括保留期设置为 0 的情况。
	retryImageDeletions(db)
	reconcileImageFiles(db, "uploads", time.Now().Add(-24*time.Hour))
	days := 7
	if value := os.Getenv("UNATTACHED_IMAGE_RETENTION_DAYS"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 0 || n > 36500 {
			slog.Error("图片保留期配置无效，跳过清理")
			return
		}
		days = n
	}
	if days == 0 {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -days)
	var images []model.FoodImage
	if err := db.Where("created_at < ?", cutoff).Where(unreferencedImage).Find(&images).Error; err != nil {
		slog.Error("查询待清理图片失败", "error", err)
		return
	}
	for _, img := range images {
		job, err := QueueImageDeletion(db, img.ID, img.UserID)
		if errors.Is(err, ErrImageInUse) || errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			slog.Error("登记图片清理任务失败", "id", img.ID, "error", err)
			continue
		}
		if err := CompleteImageDeletion(db, job); err != nil {
			slog.Error("清理未关联图片文件失败，任务保留待重试", "id", img.ID, "error", err)
		}
	}
}

func retryImageDeletions(db *gorm.DB) {
	var jobs []model.ImageDeletion
	// 按主键分批遍历，失败的旧任务不会阻塞后面的任务。
	err := db.FindInBatches(&jobs, 100, func(_ *gorm.DB, _ int) error {
		for _, job := range jobs {
			if err := CompleteImageDeletion(db, job); err != nil {
				slog.Error("重试图片文件删除失败", "image_id", job.ImageID, "error", err)
			}
		}
		return nil
	}).Error
	if err != nil {
		slog.Error("读取图片删除任务失败", "error", err)
	}
}

var managedImageName = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9]{1,10}$`)

// 上传进程崩溃可能留下没有 DB 记录的文件。只核对本应用生成的旧普通文件，
// 不递归、不跟随符号链接，并留出 24 小时避免干扰正在上传的新文件。
func reconcileImageFiles(db *gorm.DB, directory string, cutoff time.Time) {
	dirInfo, err := os.Lstat(directory)
	if os.IsNotExist(err) {
		return
	}
	if err != nil || !dirInfo.IsDir() {
		slog.Error("图片核对目录不可用或不是普通目录", "error", err)
		return
	}
	entries, err := os.ReadDir(directory)
	if os.IsNotExist(err) {
		return
	}
	if err != nil {
		slog.Error("读取图片目录失败", "error", err)
		return
	}
	for _, entry := range entries {
		if !managedImageName.MatchString(entry.Name()) || !entry.Type().IsRegular() {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.ModTime().Before(cutoff) {
			continue
		}
		path := filepath.Join(directory, entry.Name())
		absolute, err := filepath.Abs(path)
		if err != nil {
			return
		}
		var count int64
		// 查询失败时停止，不能把数据库故障当作图片未登记。
		if err := db.Model(&model.FoodImage{}).Where("filename = ? OR path IN ?", entry.Name(), []string{path, absolute}).Count(&count).Error; err != nil {
			slog.Error("图片文件核对失败", "error", err)
			return
		}
		if count != 0 {
			continue
		}
		if err := db.Model(&model.ImageDeletion{}).Where("path IN ?", []string{path, absolute}).Count(&count).Error; err != nil {
			slog.Error("图片删除任务核对失败", "error", err)
			return
		}
		if count == 0 {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				slog.Error("移除未登记图片失败，下次继续核对", "error", err)
			}
		}
	}
}
