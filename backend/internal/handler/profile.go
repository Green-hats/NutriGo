// 用户健康档案处理器
package handler

import (
	"net/http"
	"nutri.go/backend/internal/httperr"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"nutri.go/backend/internal/model"
)

// ProfileHandler 处理用户健康档案的查看和更新
type ProfileHandler struct {
	DB *gorm.DB
}

// GetProfile GET /api/users/:id/profile
// 只能查看自己的档案（JWT 中的 userID 必须匹配路由参数 :id）
func (h *ProfileHandler) GetProfile(c *gin.Context) {
	userID := c.GetUint("userID")
	paramID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || uint(paramID) != userID {
		httperr.Response(c, http.StatusForbidden, "无权查看其他用户的档案")
		return
	}

	var profile model.UserProfile
	result := h.DB.Where("user_id = ?", userID).First(&profile)
	if result.Error != nil {
		// 没填过档案，返回空数据而非 404
		c.JSON(http.StatusOK, gin.H{
			"height_cm":        0,
			"weight_kg":        0,
			"age":              0,
			"gender":           "",
			"goal":             "",
			"allergies":        []string{},
			"dietary_habits":   []string{},
			"chronic_diseases": []string{},
		})
		return
	}

	c.JSON(http.StatusOK, profile)
}

// UpdateProfile PUT /api/users/:id/profile
// 如果档案不存在则创建，存在则更新。只能更新自己的档案。
func (h *ProfileHandler) UpdateProfile(c *gin.Context) {
	userID := c.GetUint("userID")
	paramID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || uint(paramID) != userID {
		httperr.Response(c, http.StatusForbidden, "无权修改其他用户的档案")
		return
	}

	var req struct {
		HeightCm        float64  `json:"height_cm"`
		WeightKg        float64  `json:"weight_kg"`
		Age             int      `json:"age"`
		Gender          string   `json:"gender"`
		Goal            string   `json:"goal"`
		Allergies       []string `json:"allergies"`
		DietaryHabits   []string `json:"dietary_habits"`
		ChronicDiseases []string `json:"chronic_diseases"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		httperr.Response(c, http.StatusBadRequest, "参数无效: "+err.Error())
		return
	}

	// 先查是否存在，不存在就创建，存在就更新
	var profile model.UserProfile
	result := h.DB.Where("user_id = ?", userID).First(&profile)

	if result.Error != nil {
		// 不存在 → 创建
		profile = model.UserProfile{
			UserID:          userID,
			HeightCm:        req.HeightCm,
			WeightKg:        req.WeightKg,
			Age:             req.Age,
			Gender:          req.Gender,
			Goal:            req.Goal,
			Allergies:       req.Allergies,
			DietaryHabits:   req.DietaryHabits,
			ChronicDiseases: req.ChronicDiseases,
		}
		if err := h.DB.Create(&profile).Error; err != nil {
			httperr.Response(c, http.StatusInternalServerError, "创建档案失败")
			return
		}
	} else {
		// 存在 → 更新
		profile.HeightCm = req.HeightCm
		profile.WeightKg = req.WeightKg
		profile.Age = req.Age
		profile.Gender = req.Gender
		profile.Goal = req.Goal
		profile.Allergies = req.Allergies
		profile.DietaryHabits = req.DietaryHabits
		profile.ChronicDiseases = req.ChronicDiseases
		if err := h.DB.Save(&profile).Error; err != nil {
			httperr.Response(c, http.StatusInternalServerError, "更新档案失败")
			return
		}
	}

	c.JSON(http.StatusOK, profile)
}

// GetProfileInternal GET /api/users/:id/profile（内部路由，无归属权校验）
func (h *ProfileHandler) GetProfileInternal(c *gin.Context) {
	userID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		httperr.Response(c, http.StatusBadRequest, "无效的用户ID")
		return
	}

	var profile model.UserProfile
	result := h.DB.Where("user_id = ?", userID).First(&profile)
	if result.Error != nil {
		c.JSON(http.StatusOK, gin.H{
			"height_cm": 0, "weight_kg": 0, "age": 0,
			"gender": "", "goal": "",
			"allergies": []string{}, "dietary_habits": []string{},
			"chronic_diseases": []string{},
		})
		return
	}

	c.JSON(http.StatusOK, profile)
}
