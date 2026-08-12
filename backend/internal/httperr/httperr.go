// 统一错误响应契约 — { "code": "...", "message": "..." }
package httperr

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// 错误码（前端按 code 分支处理）
const (
	CodeValidationError = "VALIDATION_ERROR" // 400 参数/请求体无效
	CodeUnauthorized    = "UNAUTHORIZED"     // 401 未认证 / 令牌无效 / 凭据错误
	CodeForbidden       = "FORBIDDEN"        // 403 越权
	CodeNotFound        = "NOT_FOUND"        // 404 资源不存在
	CodeConflict        = "CONFLICT"         // 409 冲突（如用户名已存在）
	CodeRateLimited     = "RATE_LIMITED"     // 429 请求过于频繁
	CodeInternalError   = "INTERNAL_ERROR"   // 500 服务内部错误
)

// codeForStatus 由 HTTP 状态码映射到统一错误码
func codeForStatus(status int) string {
	switch status {
	case http.StatusBadRequest:
		return CodeValidationError
	case http.StatusUnauthorized:
		return CodeUnauthorized
	case http.StatusForbidden:
		return CodeForbidden
	case http.StatusNotFound:
		return CodeNotFound
	case http.StatusConflict:
		return CodeConflict
	case http.StatusTooManyRequests:
		return CodeRateLimited
	default:
		return CodeInternalError
	}
}

// Response 输出统一错误响应并保留默认 gin 错误体
func Response(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"code": codeForStatus(status), "message": message})
}

// Abort 中断请求链并输出统一错误响应（中间件使用）
func Abort(c *gin.Context, status int, message string) {
	c.AbortWithStatusJSON(status, gin.H{"code": codeForStatus(status), "message": message})
}
