// 饮食记录处理器
package handler

import (
	"net/http"
	"nutri.go/backend/internal/httperr"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"nutri.go/backend/internal/model"
)

// DietHandler 处理饮食记录的增删查
type DietHandler struct {
	DB *gorm.DB
}

// Create POST /api/diet/logs
func (h *DietHandler) Create(c *gin.Context) {
	userID := c.GetUint("userID")

	var req struct {
		Date     string  `json:"date" binding:"required"`
		MealType string  `json:"meal_type"`
		FoodName string  `json:"food_name" binding:"required"`
		Portion  string  `json:"portion"`
		Calories float64 `json:"calories"`
		ProteinG float64 `json:"protein_g"`
		FatG     float64 `json:"fat_g"`
		CarbsG   float64 `json:"carbs_g"`
		Notes    string  `json:"notes"`
		ImageID  *uint   `json:"image_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		httperr.Response(c, http.StatusBadRequest, "参数无效: "+err.Error())
		return
	}

	record := model.FoodDiary{
		UserID:   userID,
		Date:     req.Date,
		MealType: req.MealType,
		FoodName: req.FoodName,
		Portion:  req.Portion,
		Calories: req.Calories,
		ProteinG: req.ProteinG,
		FatG:     req.FatG,
		CarbsG:   req.CarbsG,
		Notes:    req.Notes,
		ImageID:  req.ImageID,
	}

	if err := h.DB.Create(&record).Error; err != nil {
		httperr.Response(c, http.StatusInternalServerError, "创建记录失败")
		return
	}

	c.JSON(http.StatusCreated, record)
}

// List GET /api/diet/logs?date=2026-08-01
func (h *DietHandler) List(c *gin.Context) {
	userID := c.GetUint("userID")
	date := c.Query("date")
	if date == "" {
		httperr.Response(c, http.StatusBadRequest, "请提供 date 参数，格式 YYYY-MM-DD")
		return
	}
	if !validDate(date) {
		httperr.Response(c, http.StatusBadRequest, "date 参数格式应为 YYYY-MM-DD")
		return
	}

	var records []model.FoodDiary
	h.DB.Where("user_id = ? AND date = ?", userID, date).
		Order("created_at DESC").
		Find(&records)

	c.JSON(http.StatusOK, records)
}

// Delete DELETE /api/diet/logs/:id
func (h *DietHandler) Delete(c *gin.Context) {
	userID := c.GetUint("userID")

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		httperr.Response(c, http.StatusBadRequest, "无效的记录ID")
		return
	}

	var record model.FoodDiary
	if result := h.DB.First(&record, id); result.Error != nil {
		httperr.Response(c, http.StatusNotFound, "记录不存在")
		return
	}

	if record.UserID != userID {
		httperr.Response(c, http.StatusForbidden, "无权删除他人的记录")
		return
	}

	if err := h.DB.Delete(&record).Error; err != nil {
		httperr.Response(c, http.StatusInternalServerError, "删除失败")
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// ListInternal GET /api/diet/logs?user_id=1&date=2026-08-01（内部路由）
func (h *DietHandler) ListInternal(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Query("user_id"), 10, 64)
	if err != nil {
		httperr.Response(c, http.StatusBadRequest, "请提供 user_id 参数")
		return
	}

	date := c.Query("date")
	if date == "" {
		httperr.Response(c, http.StatusBadRequest, "请提供 date 参数，格式 YYYY-MM-DD")
		return
	}
	if !validDate(date) {
		httperr.Response(c, http.StatusBadRequest, "date 参数格式应为 YYYY-MM-DD")
		return
	}

	var records []model.FoodDiary
	h.DB.Where("user_id = ? AND date = ?", userID, date).
		Order("created_at DESC").
		Find(&records)

	c.JSON(http.StatusOK, records)
}
