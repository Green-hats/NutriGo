package middleware

import (
	"bytes"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"nutri.go/backend/internal/httperr"
)

const JSONBodyLimit int64 = 64 << 10
const UploadBodyLimit int64 = 11 << 20 // 10 MiB 图片 + multipart 开销

// RequestLimits 在 JSON 解析前限流读取整个请求，包含无 Content-Length 的分块请求。
// 图片交给鉴权后的上传准入处理，不在中间件预读 11 MiB。
func RequestLimits() gin.HandlerFunc {
	reading := make(chan struct{}, 64)
	return func(c *gin.Context) {
		limit := JSONBodyLimit
		upload := c.Request.Method == http.MethodPost && c.Request.URL.Path == "/api/images/upload"
		if upload {
			limit = UploadBodyLimit
		}
		if c.Request.ContentLength > limit {
			httperr.Abort(c, http.StatusRequestEntityTooLarge, "请求内容过大，请缩小后重试")
			return
		}
		if encoding := c.GetHeader("Content-Encoding"); encoding != "" && !strings.EqualFold(encoding, "identity") {
			httperr.Abort(c, http.StatusUnsupportedMediaType, "不支持压缩请求体")
			return
		}
		if upload || c.Request.Body == nil || c.Request.Body == http.NoBody {
			c.Next()
			return
		}
		select {
		case reading <- struct{}{}:
		default:
			httperr.Abort(c, http.StatusServiceUnavailable, "服务器繁忙，请稍后重试")
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, limit))
		_ = c.Request.Body.Close()
		<-reading
		if err != nil {
			var maxErr *http.MaxBytesError
			var netErr net.Error
			switch {
			case errors.As(err, &maxErr):
				httperr.Abort(c, http.StatusRequestEntityTooLarge, "请求内容过大，请缩小后重试")
			case errors.As(err, &netErr) && netErr.Timeout():
				httperr.Abort(c, http.StatusRequestTimeout, "上传请求超时，请重试")
			default:
				httperr.Abort(c, http.StatusBadRequest, "无法读取请求内容")
			}
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		c.Next()
	}
}
