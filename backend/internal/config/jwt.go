// JWT 签发与配置
package config

import (
	"errors"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// 开发环境默认值（仅当 APP_ENV != production 时允许使用）
const (
	devJWTSecret     = "nutri-go-secret-key-change-in-production"
	devInternalToken = "nutri-go-internal-token-dev"
)

// JWTSecret 签名密钥，由 InitSecrets 初始化
var JWTSecret = []byte(devJWTSecret)

// InternalToken 内部服务鉴权 token，由 InitSecrets 初始化
var InternalToken = devInternalToken

// IsProduction 是否生产环境（通过 APP_ENV 判断）
func IsProduction() bool {
	return os.Getenv("APP_ENV") == "production"
}

// InitSecrets 从环境变量加载密钥。
// 生产环境：必须设置强随机的 JWT_SECRET 和 INTERNAL_TOKEN，缺失则启动失败。
// 开发环境：允许使用内置默认值。
func InitSecrets() error {
	secret := os.Getenv("JWT_SECRET")
	internal := os.Getenv("INTERNAL_TOKEN")

	if IsProduction() {
		if secret == "" || secret == devJWTSecret {
			return errors.New("生产环境必须通过环境变量 JWT_SECRET 设置强随机密钥")
		}
		if internal == "" || internal == devInternalToken {
			return errors.New("生产环境必须通过环境变量 INTERNAL_TOKEN 设置强随机密钥")
		}
	}

	if secret != "" {
		JWTSecret = []byte(secret)
	}
	if internal != "" {
		InternalToken = internal
	}
	return nil
}

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
