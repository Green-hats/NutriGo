// JWT 认证中间件
// 从 Authorization 头提取 Bearer token → 验签 → 查黑名单 → 把 userID/jti/username 存入上下文
package middleware

import (
	"net/http"
	"nutri.go/backend/internal/httperr"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"

	"nutri.go/backend/internal/config"
	"nutri.go/backend/internal/model"
)

// JWTAuth 返回 JWT 认证中间件。
// db 用于查询被登出吊销的令牌黑名单。
func JWTAuth(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			httperr.Abort(c, http.StatusUnauthorized, "未提供认证信息")
			return
		}

		// 切分 "Bearer <token>" → ["Bearer", "<token>"]
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			httperr.Abort(c, http.StatusUnauthorized, "认证格式错误")
			return
		}

		// 解析 + 验签 + 过期检查
		token, err := jwt.ParseWithClaims(parts[1], &config.JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
			return config.JWTSecret, nil
		})
		if err != nil || !token.Valid {
			httperr.Abort(c, http.StatusUnauthorized, "token无效或已过期")
			return
		}

		// 类型断言：取出我们嵌入的 JWTClaims
		claims, ok := token.Claims.(*config.JWTClaims)
		if !ok {
			httperr.Abort(c, http.StatusUnauthorized, "token解析失败")
			return
		}

		// 查黑名单：登出后的 jti 应立即失效
		if claims.ID != "" {
			var count int64
			db.Model(&model.BlacklistedToken{}).Where("jti = ?", claims.ID).Count(&count)
			if count > 0 {
				httperr.Abort(c, http.StatusUnauthorized, "token已失效，请重新登录")
				return
			}
		}

		// 存入上下文，后续 handler 通过 c.GetUint("userID") 获取
		c.Set("userID", claims.UserID)
		c.Set("username", claims.Username)
		c.Set("jti", claims.ID)
		c.Set("tokenExp", claims.ExpiresAt.Time)
		c.Next()
	}
}
