// 通用参数校验辅助
package handler

import (
	"regexp"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// dateRe 匹配严格 YYYY-MM-DD 格式（防 2026-1-5 这类非零填充输入）
var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// validDate 校验字符串是否为合法日期（YYYY-MM-DD）：
// 先匹配格式，再交给 time.Parse 验证日历合法性（如拒绝 2026-02-30）
func validDate(s string) bool {
	if !dateRe.MatchString(s) {
		return false
	}
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

// parsePagination 解析 limit/offset 查询参数，带默认值与上限。
// 非法值回退默认，避免注入负数/超大值。
func parsePagination(c *gin.Context, defaultLimit, maxLimit int) (limit, offset int) {
	limit = defaultLimit
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	offset = 0
	if v := c.Query("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return limit, offset
}
