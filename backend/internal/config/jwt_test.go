// JWT 签发与解析单元测试
package config

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// 测试 GenerateToken 能成功签发并包含正确的 payload
func TestGenerateToken(t *testing.T) {
	tokenStr, err := GenerateToken(42, "xiaoming")
	if err != nil {
		t.Fatalf("GenerateToken 失败: %v", err)
	}
	if tokenStr == "" {
		t.Fatal("token 为空")
	}

	// 解析并验证 payload
	claims := &JWTClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		return JWTSecret, nil
	})
	if err != nil {
		t.Fatalf("解析 token 失败: %v", err)
	}
	if !token.Valid {
		t.Fatal("token 无效")
	}
	if claims.UserID != 42 {
		t.Errorf("UserID = %d, 期望 42", claims.UserID)
	}
	if claims.Username != "xiaoming" {
		t.Errorf("Username = %q, 期望 xiaoming", claims.Username)
	}
}

// 测试 token 有效期约为 72 小时
func TestTokenExpiry(t *testing.T) {
	tokenStr, err := GenerateToken(1, "test")
	if err != nil {
		t.Fatalf("GenerateToken 失败: %v", err)
	}

	claims := &JWTClaims{}
	_, err = jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		return JWTSecret, nil
	})
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}

	// ExpiresAt 应约为 72 小时后
	expected := time.Now().Add(72 * time.Hour)
	delta := claims.ExpiresAt.Time.Sub(expected)
	if delta < -time.Minute || delta > time.Minute {
		t.Errorf("ExpiresAt 偏移异常: %v, 期望约72h", delta)
	}
}

// 测试错误密钥无法验签
func TestTokenRejectsWrongSecret(t *testing.T) {
	tokenStr, err := GenerateToken(1, "test")
	if err != nil {
		t.Fatalf("GenerateToken 失败: %v", err)
	}

	// 用错误密钥解析应失败
	claims := &JWTClaims{}
	_, err = jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		return []byte("wrong-secret"), nil
	})
	if err == nil {
		t.Fatal("错误密钥不应验签成功")
	}
}

// 测试被篡改的 token 无法解析
func TestTokenRejectsTampered(t *testing.T) {
	tokenStr, err := GenerateToken(1, "test")
	if err != nil {
		t.Fatalf("GenerateToken 失败: %v", err)
	}

	// 篡改 payload（把 user_id 改成 999）
	tampered := tokenStr[:len(tokenStr)-6] + "AAAAAA"
	claims := &JWTClaims{}
	_, err = jwt.ParseWithClaims(tampered, claims, func(token *jwt.Token) (interface{}, error) {
		return JWTSecret, nil
	})
	if err == nil {
		t.Fatal("被篡改的 token 不应验签成功")
	}
}
