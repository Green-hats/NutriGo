// 通用参数校验辅助
package handler

import (
	"regexp"
	"time"
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
