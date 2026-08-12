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

// 测试 token 有效期约为 AccessTokenTTL
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

	// ExpiresAt 应约为 AccessTokenTTL 后
	expected := time.Now().Add(AccessTokenTTL)
	delta := claims.ExpiresAt.Time.Sub(expected)
	if delta < -time.Minute || delta > time.Minute {
		t.Errorf("ExpiresAt 偏移异常: %v, 期望约 %v", delta, AccessTokenTTL)
	}
}

// 测试 token 携带唯一 jti（供登出黑名单使用）
func TestTokenHasUniqueJTI(t *testing.T) {
	token1, err := GenerateToken(1, "a")
	if err != nil {
		t.Fatalf("GenerateToken 失败: %v", err)
	}
	token2, err := GenerateToken(1, "a")
	if err != nil {
		t.Fatalf("GenerateToken 失败: %v", err)
	}

	extractJTI := func(s string) string {
		claims := &JWTClaims{}
		_, err := jwt.ParseWithClaims(s, claims, func(token *jwt.Token) (interface{}, error) {
			return JWTSecret, nil
		})
		if err != nil {
			t.Fatalf("解析 token 失败: %v", err)
		}
		return claims.ID
	}

	jti1, jti2 := extractJTI(token1), extractJTI(token2)
	if jti1 == "" || jti2 == "" {
		t.Fatal("jti 不应为空")
	}
	if jti1 == jti2 {
		t.Errorf("两次签发的 jti 应不同, got %q", jti1)
	}
}

// 测试刷新令牌：生成结果唯一且可哈希
func TestGenerateAndHashRefreshToken(t *testing.T) {
	t1, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken 失败: %v", err)
	}
	t2, err := GenerateRefreshToken()
	if err != nil {
		t.Fatalf("GenerateRefreshToken 失败: %v", err)
	}
	if t1 == "" || t1 == t2 {
		t.Errorf("刷新令牌应唯一非空, got %q vs %q", t1, t2)
	}
	if HashToken(t1) == t1 {
		t.Error("哈希结果不应等于明文")
	}
	if HashToken(t1) == HashToken(t2) {
		t.Error("不同令牌哈希应不同")
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

// 测试生产环境：未设置密钥时启动必须失败
func TestInitSecretsProductionRequiresKeys(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("INTERNAL_TOKEN", "")

	if err := InitSecrets(); err == nil {
		t.Fatal("生产环境未设置 JWT_SECRET/INTERNAL_TOKEN 应报错")
	}
}

// 测试生产环境：使用默认值也必须失败（防止误用已知密钥）
func TestInitSecretsProductionRejectsDefaults(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", devJWTSecret)
	t.Setenv("INTERNAL_TOKEN", devInternalToken)

	if err := InitSecrets(); err == nil {
		t.Fatal("生产环境使用默认密钥应报错")
	}
}

// 测试生产环境：正确设置密钥则通过，且加载生效
func TestInitSecretsProductionAcceptsCustom(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "prod-secret-abc-123-xyz")
	t.Setenv("INTERNAL_TOKEN", "prod-token-xyz-789")

	if err := InitSecrets(); err != nil {
		t.Fatalf("生产环境正确设置密钥应通过: %v", err)
	}
	if string(JWTSecret) != "prod-secret-abc-123-xyz" {
		t.Errorf("JWTSecret 未加载, got %q", JWTSecret)
	}
	if InternalToken != "prod-token-xyz-789" {
		t.Errorf("InternalToken 未加载, got %q", InternalToken)
	}
}

// 测试开发环境：允许默认值
func TestInitSecretsDevelopmentAllowsDefaults(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("INTERNAL_TOKEN", "")

	if err := InitSecrets(); err != nil {
		t.Fatalf("开发环境允许默认值: %v", err)
	}
}
