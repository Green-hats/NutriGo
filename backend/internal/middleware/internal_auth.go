// 内部服务鉴权中间件
// 验证 X-Internal-Token 请求头，用于 Python Agent 调用 Go 时的安全校验
package middleware

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

func InternalAuth() gin.HandlerFunc {
	expectedToken := os.Getenv("INTERNAL_TOKEN")
	if expectedToken == "" {
		expectedToken = "nutri-go-internal-token-dev" // 开发环境默认值
	}

	return func(c *gin.Context) {
		token := c.GetHeader("X-Internal-Token")
		if token != expectedToken {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "内部服务鉴权失败"})
			return
		}
		c.Next()
	}
}
