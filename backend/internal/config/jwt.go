// JWT 签发与配置
package config

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWTSecret 签名密钥。⚠️ 生产环境必须改为从环境变量读取
var JWTSecret = []byte("nutri-go-secret-key-change-in-production")

// JWTClaims 定义 JWT 的 payload 结构。
// jwt.RegisteredClaims 通过嵌入展开，自动包含 ExpiresAt、IssuedAt 等标准字段。
type JWTClaims struct {
	UserID   uint   `json:"user_id"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// GenerateToken 签发 JWT，有效期 72 小时
func GenerateToken(userID uint, username string) (string, error) {
	claims := JWTClaims{
		UserID:   userID,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(72 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(JWTSecret)
}
