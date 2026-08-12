// handler 包共享测试辅助
package handler

import (
	"encoding/json"
	"testing"
)

// mustJSONBody 解析 JSON 响应体，失败则 t.Fatalf
func mustJSONBody(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatalf("解析响应体失败: %v", err)
	}
	return body
}
