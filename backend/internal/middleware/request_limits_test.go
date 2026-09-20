package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRequestLimitsBeforeHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, size := range []int{65536, 65537, 2 << 20} {
		for _, known := range []bool{true, false} {
			r := gin.New()
			r.Use(RequestLimits())
			called := false
			r.POST("/json", func(c *gin.Context) {
				called = true
				body, _ := io.ReadAll(c.Request.Body)
				if len(body) != size {
					t.Errorf("body not preserved: %d", len(body))
				}
				c.Status(200)
			})
			req := httptest.NewRequest("POST", "/json", strings.NewReader(strings.Repeat("x", size)))
			if !known {
				req.ContentLength = -1
				req.TransferEncoding = []string{"chunked"}
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if size <= 65536 && (w.Code != 200 || !called) {
				t.Fatalf("valid body rejected: %d", w.Code)
			}
			if size > 65536 && (w.Code != 413 || called) {
				t.Fatalf("oversized body reached handler (known=%v): %d", known, w.Code)
			}
		}
	}
}

func TestRequestLimitsUploadAndCompression(t *testing.T) {
	r := gin.New()
	r.Use(RequestLimits())
	r.POST("/api/images/upload", func(c *gin.Context) { c.Status(401) })
	for _, size := range []int{65537, 11<<20 + 1} {
		req := httptest.NewRequest("POST", "/api/images/upload", nil)
		req.ContentLength = int64(size)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		expected := http.StatusUnauthorized
		if size > 11<<20 {
			expected = http.StatusRequestEntityTooLarge
		}
		if w.Code != expected {
			t.Fatalf("upload status=%d", w.Code)
		}
	}
	req := httptest.NewRequest("POST", "/api/images/upload", strings.NewReader("gzip-data"))
	req.Header.Set("Content-Encoding", "gzip")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatal(w.Code)
	}
}
