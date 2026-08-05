// 内部服务鉴权中间件
// 验证 X-Internal-Token 请求头，用于 Python Agent 调用 Go 时的安全校验
package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"nutri.go/backend/internal/config"
)

func InternalAuth() gin.HandlerFunc {
	expectedToken := config.InternalToken

	return func(c *gin.Context) {
		token := c.GetHeader("X-Internal-Token")
		if token != expectedToken {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "内部服务鉴权失败"})
			return
		}
		c.Next()
	}
}
