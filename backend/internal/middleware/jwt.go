// JWT 认证中间件
// 从 Authorization 头提取 Bearer token → 验签 → 把 userID/username 存入上下文
package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	"nutri.go/backend/internal/config"
)

func JWTAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "未提供认证信息"})
			return
		}

		// 切分 "Bearer <token>" → ["Bearer", "<token>"]
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "认证格式错误"})
			return
		}

		// 解析 + 验签 + 过期检查
		token, err := jwt.ParseWithClaims(parts[1], &config.JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
			return config.JWTSecret, nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token无效或已过期"})
			return
		}

		// 类型断言：取出我们嵌入的 JWTClaims
		claims, ok := token.Claims.(*config.JWTClaims)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token解析失败"})
			return
		}

		// 存入上下文，后续 handler 通过 c.GetUint("userID") 获取
		c.Set("userID", claims.UserID)
		c.Set("username", claims.Username)
		c.Next()
	}
}
