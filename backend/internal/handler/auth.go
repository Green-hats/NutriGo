// 用户认证处理器
package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"nutri.go/backend/internal/config"
	"nutri.go/backend/internal/model"
)

// AuthHandler 处理登录注册，通过 DB 字段持有数据库连接
type AuthHandler struct {
	DB *gorm.DB
}

// Register POST /api/auth/register
// 流程：解析 JSON → 校验参数 → 查重 → bcrypt 加密 → 写入数据库
func (h *AuthHandler) Register(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required,min=3,max=32"`
		Password string `json:"password" binding:"required,min=6,max=128"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数无效: " + err.Error()})
		return
	}

	// 查重：用户名已存在则返回 409
	var existUser model.User
	if result := h.DB.Where("username = ?", req.Username).First(&existUser); result.Error == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "用户名已存在"})
		return
	}

	// bcrypt 加密。DefaultCost=10，迭代 2^10 轮
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}

	user := model.User{
		Username: req.Username,
		Password: string(hashedPassword),
	}
	if result := h.DB.Create(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "注册失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":       user.ID,
		"username": user.Username,
	})
}

// Login POST /api/auth/login
// 流程：解析 JSON → 查用户 → 验密码 → 签发 JWT + 刷新令牌 → 返回
func (h *AuthHandler) Login(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数无效: " + err.Error()})
		return
	}

	// 按用户名查找
	var user model.User
	if result := h.DB.Where("username = ?", req.Username).First(&user); result.Error != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	// bcrypt 验密码：比对密文和明文
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	accessToken, refreshToken, err := h.issueTokenPair(&user, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "登录失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":         accessToken,
		"refresh_token": refreshToken,
		"expires_in":    int(config.AccessTokenTTL.Seconds()),
		"id":            user.ID,
		"username":      user.Username,
	})
}

// Refresh POST /api/auth/refresh
// 用刷新令牌换取新的令牌对，并轮换（旧刷新令牌立即失效）。
// 已吊销的令牌被再次使用 → 判定为令牌泄露，吊销整个令牌家族。
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refresh_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 refresh_token 参数"})
		return
	}

	var rt model.RefreshToken
	if err := h.DB.Where("token_hash = ?", config.HashToken(req.RefreshToken)).First(&rt).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh_token 无效或已过期"})
		return
	}

	// 已吊销却被再次使用 → 重放攻击信号，吊销整个家族
	if rt.RevokedAt != nil {
		h.revokeTokenFamily(rt.FamilyID, rt.UserID)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh_token 已失效"})
		return
	}
	if time.Now().After(rt.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh_token 已过期"})
		return
	}

	// 轮换：吊销旧刷新令牌（防重放）
	now := time.Now()
	rt.RevokedAt = &now
	if err := h.DB.Save(&rt).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "刷新失败"})
		return
	}

	// 签发新令牌对（继承同一家族）
	var user model.User
	if err := h.DB.First(&user, rt.UserID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户不存在"})
		return
	}
	accessToken, refreshToken, err := h.issueTokenPair(&user, rt.FamilyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "刷新失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":         accessToken,
		"refresh_token": refreshToken,
		"expires_in":    int(config.AccessTokenTTL.Seconds()),
		"id":            user.ID,
		"username":      user.Username,
	})
}

// revokeTokenFamily 吊销某用户下整个令牌家族中仍有效的刷新令牌
func (h *AuthHandler) revokeTokenFamily(familyID string, userID uint) {
	if familyID == "" {
		return
	}
	now := time.Now()
	h.DB.Model(&model.RefreshToken{}).
		Where("user_id = ? AND family_id = ? AND revoked_at IS NULL", userID, familyID).
		Update("revoked_at", now)
}

// Logout POST /api/auth/logout（需 JWT）
// 将当前 access token 的 jti 加入黑名单使其立即失效；若附上 refresh_token 则一并吊销。
// 两个写入在单个事务中完成，保证一致性。
func (h *AuthHandler) Logout(c *gin.Context) {
	userID := c.GetUint("userID")
	jti := c.GetString("jti")

	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求体无效"})
		return
	}

	// 事务：黑名单写入 + refresh 吊销要么都成功，要么都回滚
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		if jti != "" {
			if err := tx.Create(&model.BlacklistedToken{
				UserID:    userID,
				JTI:       jti,
				ExpiresAt: c.GetTime("tokenExp"),
			}).Error; err != nil {
				return err
			}
		}
		if req.RefreshToken != "" {
			now := time.Now()
			if err := tx.Model(&model.RefreshToken{}).
				Where("user_id = ? AND token_hash = ?", userID, config.HashToken(req.RefreshToken)).
				Update("revoked_at", now).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "登出失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "退出成功"})
}

// issueTokenPair 签发 access + refresh 令牌对，并将 refresh 令牌哈希持久化。
// familyID 为空时创建新家族（登录场景）；轮换场景传入原家族 ID。
func (h *AuthHandler) issueTokenPair(user *model.User, familyID string) (accessToken, refreshToken string, err error) {
	accessToken, err = config.GenerateToken(user.ID, user.Username)
	if err != nil {
		return "", "", err
	}
	refreshToken, err = config.GenerateRefreshToken()
	if err != nil {
		return "", "", err
	}
	if familyID == "" {
		familyID = config.NewTokenID()
	}
	rt := model.RefreshToken{
		UserID:    user.ID,
		FamilyID:  familyID,
		TokenHash: config.HashToken(refreshToken),
		ExpiresAt: time.Now().Add(config.RefreshTokenTTL),
	}
	if err = h.DB.Create(&rt).Error; err != nil {
		return "", "", err
	}
	return accessToken, refreshToken, nil
}
