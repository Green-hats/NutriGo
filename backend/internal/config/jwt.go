// JWT 签发与配置
package config

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// 令牌有效期
const (
	AccessTokenTTL  = 2 * time.Hour       // 访问令牌（JWT）有效期
	RefreshTokenTTL = 14 * 24 * time.Hour // 刷新令牌有效期
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
// jwt.RegisteredClaims 通过嵌入展开，自动包含 ExpiresAt、IssuedAt、ID(jti) 等标准字段。
type JWTClaims struct {
	UserID   uint   `json:"user_id"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// GenerateToken 签发访问令牌（JWT）。
// 携带唯一 jti（用于登出后加入黑名单），有效期 AccessTokenTTL。
func GenerateToken(userID uint, username string) (string, error) {
	claims := JWTClaims{
		UserID:   userID,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        NewTokenID(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(AccessTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(JWTSecret)
}

// NewTokenID 生成随机 JTI（16 字节 → 32 位十六进制）
func NewTokenID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(b)
}

// GenerateRefreshToken 生成不透明刷新令牌（32 字节随机数，base64url）
func GenerateRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// HashToken 对令牌做 SHA-256 哈希。
// 刷新令牌以哈希形式入库，即使数据库泄露也无法被直接盗用。
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
