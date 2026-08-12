// 统一错误码契约测试
package httperr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func doResponse(status int) map[string]any {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	Response(c, status, "测试消息")
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return body
}

// 测试：400 返回 VALIDATION_ERROR 契约
func TestResponseValidationError(t *testing.T) {
	body := doResponse(http.StatusBadRequest)
	if body["code"] != CodeValidationError {
		t.Errorf("code = %v, 期望 %s", body["code"], CodeValidationError)
	}
	if body["message"] != "测试消息" {
		t.Errorf("message = %v", body["message"])
	}
}

// 测试：各状态码映射到正确错误码
func TestCodeMapping(t *testing.T) {
	cases := []struct {
		status int
		code   string
	}{
		{http.StatusBadRequest, CodeValidationError},
		{http.StatusUnauthorized, CodeUnauthorized},
		{http.StatusForbidden, CodeForbidden},
		{http.StatusNotFound, CodeNotFound},
		{http.StatusConflict, CodeConflict},
		{http.StatusTooManyRequests, CodeRateLimited},
		{http.StatusInternalServerError, CodeInternalError},
	}
	for _, tc := range cases {
		if code := codeForStatus(tc.status); code != tc.code {
			t.Errorf("status %d → code %q, 期望 %q", tc.status, code, tc.code)
		}
	}
}

// 测试：Abort 中断请求链并输出统一错误体
func TestAbortResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	Abort(c, http.StatusUnauthorized, "未认证")
	if !c.IsAborted() {
		t.Error("Abort 后上下文应被中断")
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["code"] != CodeUnauthorized {
		t.Errorf("code = %v, 期望 %s", body["code"], CodeUnauthorized)
	}
}
