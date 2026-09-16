package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"nutri.go/backend/internal/httperr"
	"nutri.go/backend/internal/model"
)

type SummaryHandler struct{ DB *gorm.DB }

type dietSummary struct {
	model.DailySummary
	Source string `json:"source"`
}

// daily_summaries 只保留旧版本已删除明细的历史汇总，不再写入新快照。
// 将这些历史基数与长期保留的明细相加，补记/修改/删除后立即反映最新总量。
const summarySQL = `SELECT user_id, date,
 SUM(total_calories) AS total_calories, SUM(total_protein_g) AS total_protein_g,
 SUM(total_fat_g) AS total_fat_g, SUM(total_carbs_g) AS total_carbs_g,
 SUM(meal_count) AS meal_count,
 CASE WHEN MIN(origin) = MAX(origin) THEN MIN(origin) ELSE 'mixed' END AS source
 FROM (
 SELECT user_id, date, calories AS total_calories, protein_g AS total_protein_g,
 fat_g AS total_fat_g, carbs_g AS total_carbs_g, 1 AS meal_count, 'live' AS origin
 FROM food_diaries WHERE user_id = ? AND date >= ? AND date <= ?
 UNION ALL
 SELECT user_id, date, total_calories, total_protein_g, total_fat_g, total_carbs_g, meal_count, 'aggregated' AS origin
 FROM daily_summaries WHERE user_id = ? AND date >= ? AND date <= ?
 ) GROUP BY user_id, date`

func (h *SummaryHandler) query(userID uint64, start, end string) *gorm.DB {
	return h.DB.Table("(?) AS totals", h.DB.Raw(summarySQL, userID, start, end, userID, start, end))
}
func summaryDates(c *gin.Context) (string, string, bool) {
	start, end := c.Query("start"), c.Query("end")
	if !validDate(start) || !validDate(end) || start > end {
		httperr.Response(c, http.StatusBadRequest, "start/end 应为有效日期（YYYY-MM-DD），且开始日期不能晚于结束日期")
		return "", "", false
	}
	return start, end, true
}
func (h *SummaryHandler) List(c *gin.Context) {
	start, end, ok := summaryDates(c)
	if !ok {
		return
	}
	userID := uint64(c.GetUint("userID"))
	limit, offset := parsePagination(c, 30, 100)
	var total int64
	if err := h.query(userID, start, end).Count(&total).Error; err != nil {
		httperr.Response(c, http.StatusInternalServerError, "查询汇总失败")
		return
	}
	items := make([]dietSummary, 0)
	if err := h.query(userID, start, end).Order("date DESC").Limit(limit).Offset(offset).Scan(&items).Error; err != nil {
		httperr.Response(c, http.StatusInternalServerError, "查询汇总失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "limit": limit, "offset": offset})
}
func (h *SummaryHandler) ListInternal(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Query("user_id"), 10, 64)
	if err != nil || userID == 0 {
		httperr.Response(c, http.StatusBadRequest, "请提供有效的 user_id 参数")
		return
	}
	start, end, ok := summaryDates(c)
	if !ok {
		return
	}
	items := make([]dietSummary, 0)
	if err := h.query(userID, start, end).Order("date ASC").Scan(&items).Error; err != nil {
		httperr.Response(c, http.StatusInternalServerError, "查询汇总失败")
		return
	}
	c.JSON(http.StatusOK, items)
}
