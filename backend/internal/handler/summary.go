// 每日汇总查询处理器
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"nutri.go/backend/internal/model"
)

// SummaryHandler 处理每日营养汇总查询
type SummaryHandler struct {
	DB *gorm.DB
}

// List GET /api/diet/summaries?start=2026-01-01&end=2026-08-01
func (h *SummaryHandler) List(c *gin.Context) {
	userID := c.GetUint("userID")
	start := c.Query("start")
	end := c.Query("end")
	if start == "" || end == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 start 和 end 参数，格式 YYYY-MM-DD"})
		return
	}

	var summaries []model.DailySummary
	h.DB.Where("user_id = ? AND date >= ? AND date <= ?", userID, start, end).
		Order("date DESC").
		Find(&summaries)

	c.JSON(http.StatusOK, summaries)
}
