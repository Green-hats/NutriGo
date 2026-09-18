package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"nutri.go/backend/internal/httperr"
	"nutri.go/backend/internal/model"
)

var batchIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var errBatchConflict = errors.New("本次提交内容已变化，请刷新日记后再记录")

// CreateBatch 将一张照片的多项食物作为一个事务保存。
func (h *DietHandler) CreateBatch(c *gin.Context) {
	var req struct {
		RequestID string      `json:"request_id"`
		Records   []dietInput `json:"records"`
	}
	if c.ShouldBindJSON(&req) != nil || !batchIDPattern.MatchString(req.RequestID) || len(req.Records) < 1 || len(req.Records) > 12 {
		httperr.Response(c, http.StatusBadRequest, "请提交有效的请求编号及 1 到 12 项食物")
		return
	}
	for i := range req.Records {
		if message := req.Records[i].validate(); message != "" {
			httperr.Response(c, http.StatusBadRequest, message)
			return
		}
	}
	payload, err := json.Marshal(req.Records)
	if err != nil {
		httperr.Response(c, http.StatusBadRequest, "记录格式无效")
		return
	}
	digest := sha256.Sum256(payload)
	userID := c.GetUint("userID")
	receipt := model.DietBatch{UserID: userID, RequestID: req.RequestID, PayloadHash: hex.EncodeToString(digest[:])}
	status := http.StatusCreated
	err = h.DB.Transaction(func(tx *gorm.DB) error {
		// INSERT 先获得 SQLite 写锁，唯一键同时保护并发重试。
		insert := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&receipt)
		if insert.Error != nil {
			return insert.Error
		}
		if insert.RowsAffected == 0 {
			var existing model.DietBatch
			if err := tx.Where("user_id = ? AND request_id = ?", userID, req.RequestID).First(&existing).Error; err != nil {
				return err
			}
			if existing.PayloadHash != receipt.PayloadHash {
				return errBatchConflict
			}
			receipt = existing
			status = http.StatusOK
			return nil
		}
		records := make([]model.FoodDiary, 0, len(req.Records))
		for _, r := range req.Records {
			if err := checkDietImage(tx, r.ImageID, userID); err != nil {
				return err
			}
			records = append(records, model.FoodDiary{UserID: userID, Date: r.Date, MealType: r.MealType,
				FoodName: r.FoodName, Portion: r.Portion, Calories: r.Calories, ProteinG: r.ProteinG,
				FatG: r.FatG, CarbsG: r.CarbsG, Notes: r.Notes, ImageID: r.ImageID})
		}
		if err := tx.Create(&records).Error; err != nil {
			return err
		}
		body, err := json.Marshal(records)
		if err != nil {
			return err
		}
		receipt.Response = string(body)
		return tx.Model(&receipt).Update("response", receipt.Response).Error
	})
	if errors.Is(err, errBatchConflict) {
		httperr.Response(c, http.StatusConflict, errBatchConflict.Error())
		return
	}
	if err != nil {
		dietWriteError(c, err)
		return
	}
	c.Data(status, "application/json; charset=utf-8", []byte(receipt.Response))
}
