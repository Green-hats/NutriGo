// 饮食记录的新增、编辑、查询与删除。
package handler

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"nutri.go/backend/internal/httperr"
	"nutri.go/backend/internal/model"
)

type DietHandler struct{ DB *gorm.DB }

type dietInput struct {
	Date     string  `json:"date"`
	MealType string  `json:"meal_type"`
	FoodName string  `json:"food_name"`
	Portion  string  `json:"portion"`
	Calories float64 `json:"calories"`
	ProteinG float64 `json:"protein_g"`
	FatG     float64 `json:"fat_g"`
	CarbsG   float64 `json:"carbs_g"`
	Notes    string  `json:"notes"`
	ImageID  *uint   `json:"image_id"`
}

func (r *dietInput) validate() string {
	r.FoodName = strings.TrimSpace(r.FoodName)
	r.Portion = strings.TrimSpace(r.Portion)
	r.Notes = strings.TrimSpace(r.Notes)
	if !validDate(r.Date) {
		return "date 参数应为有效日期，格式 YYYY-MM-DD"
	}
	switch r.MealType {
	case "breakfast", "lunch", "dinner", "snack":
	default:
		return "请选择早餐、午餐、晚餐或加餐"
	}
	if r.FoodName == "" || utf8.RuneCountInString(r.FoodName) > 200 {
		return "食物名称不能为空，且不能超过 200 字"
	}
	if utf8.RuneCountInString(r.Portion) > 100 || utf8.RuneCountInString(r.Notes) > 2000 {
		return "份量不能超过 100 字，备注不能超过 2000 字"
	}
	for _, n := range []float64{r.Calories, r.ProteinG, r.FatG, r.CarbsG} {
		if math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 1000000 {
			return "营养数值必须是 0 到 1000000 之间的有限数字"
		}
	}
	if r.ImageID != nil && *r.ImageID == 0 {
		return "图片 ID 无效"
	}
	return ""
}

var errDietForbidden = errors.New("无权修改他人的记录")
var errDietImage = errors.New("图片不存在或不属于当前账户")

func checkDietImage(tx *gorm.DB, imageID *uint, userID uint) error {
	if imageID == nil {
		return nil
	}
	var image model.FoodImage
	err := tx.Where("id = ? AND user_id = ?", *imageID, userID).First(&image).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errDietImage
	}
	return err
}

func dietWriteError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errDietImage):
		httperr.Response(c, http.StatusBadRequest, errDietImage.Error())
	case errors.Is(err, gorm.ErrRecordNotFound):
		httperr.Response(c, http.StatusNotFound, "记录不存在")
	case errors.Is(err, errDietForbidden):
		httperr.Response(c, http.StatusForbidden, "无权操作他人的记录")
	default:
		httperr.Response(c, http.StatusInternalServerError, "保存记录失败，请稍后重试")
	}
}

func bindDiet(c *gin.Context) (dietInput, bool) {
	var req dietInput
	if err := c.ShouldBindJSON(&req); err != nil {
		httperr.Response(c, http.StatusBadRequest, "参数无效，请检查填写内容")
		return req, false
	}
	if message := req.validate(); message != "" {
		httperr.Response(c, http.StatusBadRequest, message)
		return req, false
	}
	return req, true
}

func (h *DietHandler) Create(c *gin.Context) {
	req, ok := bindDiet(c)
	if !ok {
		return
	}
	userID := c.GetUint("userID")
	record := model.FoodDiary{UserID: userID, Date: req.Date, MealType: req.MealType, FoodName: req.FoodName, Portion: req.Portion, Calories: req.Calories, ProteinG: req.ProteinG, FatG: req.FatG, CarbsG: req.CarbsG, Notes: req.Notes, ImageID: req.ImageID}
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := checkDietImage(tx, req.ImageID, userID); err != nil {
			return err
		}
		return tx.Create(&record).Error
	})
	if err != nil {
		dietWriteError(c, err)
		return
	}
	c.JSON(http.StatusCreated, record)
}

func dietID(c *gin.Context) (uint64, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		httperr.Response(c, http.StatusBadRequest, "无效的记录ID")
		return 0, false
	}
	return id, true
}

// Update 使用完整表单更新；map 保证零值和 image_id=null 可以正确保存。
func (h *DietHandler) Update(c *gin.Context) {
	id, ok := dietID(c)
	if !ok {
		return
	}
	req, ok := bindDiet(c)
	if !ok {
		return
	}
	userID := c.GetUint("userID")
	var record model.FoodDiary
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&record, id).Error; err != nil {
			return err
		}
		if record.UserID != userID {
			return errDietForbidden
		}
		if err := checkDietImage(tx, req.ImageID, userID); err != nil {
			return err
		}
		values := map[string]any{"date": req.Date, "meal_type": req.MealType, "food_name": req.FoodName, "portion": req.Portion, "calories": req.Calories, "protein_g": req.ProteinG, "fat_g": req.FatG, "carbs_g": req.CarbsG, "notes": req.Notes, "image_id": req.ImageID}
		if err := tx.Model(&record).Updates(values).Error; err != nil {
			return err
		}
		return tx.First(&record, id).Error
	})
	if err != nil {
		dietWriteError(c, err)
		return
	}
	c.JSON(http.StatusOK, record)
}

func (h *DietHandler) list(c *gin.Context, userID uint64) {
	date := c.Query("date")
	if !validDate(date) {
		httperr.Response(c, http.StatusBadRequest, "date 参数应为有效日期，格式 YYYY-MM-DD")
		return
	}
	records := make([]model.FoodDiary, 0)
	if err := h.DB.Where("user_id = ? AND date = ?", userID, date).Order("created_at DESC, id DESC").Find(&records).Error; err != nil {
		httperr.Response(c, http.StatusInternalServerError, "查询饮食记录失败，请稍后重试")
		return
	}
	c.JSON(http.StatusOK, records)
}
func (h *DietHandler) List(c *gin.Context) { h.list(c, uint64(c.GetUint("userID"))) }
func (h *DietHandler) ListInternal(c *gin.Context) {
	id, err := strconv.ParseUint(c.Query("user_id"), 10, 64)
	if err != nil || id == 0 {
		httperr.Response(c, http.StatusBadRequest, "请提供有效的 user_id 参数")
		return
	}
	h.list(c, id)
}

func (h *DietHandler) Delete(c *gin.Context) {
	id, ok := dietID(c)
	if !ok {
		return
	}
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		var record model.FoodDiary
		if err := tx.First(&record, id).Error; err != nil {
			return err
		}
		if record.UserID != c.GetUint("userID") {
			return errDietForbidden
		}
		return tx.Delete(&record).Error
	})
	if err != nil {
		dietWriteError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}
