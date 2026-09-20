package service

import (
	"errors"
	"os"

	"gorm.io/gorm"
	"nutri.go/backend/internal/model"
)

var ErrImageInUse = errors.New("图片仍被饮食记录使用，请先解除关联")
var ErrImageForbidden = errors.New("无权删除他人的图片")

const unreferencedImage = "NOT EXISTS (SELECT 1 FROM food_diaries WHERE food_diaries.image_id = food_images.id)"

// QueueImageDeletion 先原子移除可关联的图片记录并登记任务，再由调用者删除文件。
// 日记的图片检查和写入也在 SQLite 事务内，因此并发关联与删除不能同时成功。
func QueueImageDeletion(db *gorm.DB, imageID, userID uint) (model.ImageDeletion, error) {
	var job model.ImageDeletion
	err := db.Transaction(func(tx *gorm.DB) error {
		var img model.FoodImage
		if err := tx.First(&img, imageID).Error; err != nil {
			return err
		}
		if img.UserID != userID {
			return ErrImageForbidden
		}
		result := tx.Where("id = ?", img.ID).Where(unreferencedImage).Delete(&model.FoodImage{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrImageInUse
		}
		job = model.ImageDeletion{ImageID: img.ID, Path: img.Path, UserID: img.UserID, SizeBytes: img.SizeBytes}
		return tx.Create(&job).Error
	})
	return job, err
}

// CompleteImageDeletion 可重复执行；文件已不存在也算成功，失败保留任务供下次重试。
func CompleteImageDeletion(db *gorm.DB, job model.ImageDeletion) error {
	if err := os.Remove(job.Path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return db.Delete(&job).Error
}
