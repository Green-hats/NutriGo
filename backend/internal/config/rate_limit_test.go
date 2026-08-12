// 限流配置单元测试
package config

import (
	"testing"
)

// 测试：默认限流值（每分钟 5 次）
func TestRateLimitDefaults(t *testing.T) {
	t.Setenv("AUTH_RATE_LIMIT_PER_MIN", "")
	t.Setenv("AUTH_RATE_LIMIT_BURST", "")
	if rps := AuthRateLimitRPS(); rps != 5.0/60.0 {
		t.Errorf("默认 RPS = %v, 期望 %v", rps, 5.0/60.0)
	}
	if burst := AuthRateLimitBurst(); burst != 5 {
		t.Errorf("默认 burst = %d, 期望 5", burst)
	}
}

// 测试：环境变量覆盖限流值
func TestRateLimitEnvOverride(t *testing.T) {
	t.Setenv("AUTH_RATE_LIMIT_PER_MIN", "120")
	t.Setenv("AUTH_RATE_LIMIT_BURST", "100")
	if rps := AuthRateLimitRPS(); rps != 120.0/60.0 {
		t.Errorf("覆盖后 RPS = %v, 期望 %v", rps, 2.0)
	}
	if burst := AuthRateLimitBurst(); burst != 100 {
		t.Errorf("覆盖后 burst = %d, 期望 100", burst)
	}
}

// 测试：非法环境变量回退默认值
func TestRateLimitEnvInvalidFallsBack(t *testing.T) {
	t.Setenv("AUTH_RATE_LIMIT_PER_MIN", "abc")
	t.Setenv("AUTH_RATE_LIMIT_BURST", "-5")
	if rps := AuthRateLimitRPS(); rps != 5.0/60.0 {
		t.Errorf("非法 PER_MIN 应回退默认, got %v", rps)
	}
	if burst := AuthRateLimitBurst(); burst != 5 {
		t.Errorf("非法 BURST 应回退默认, got %d", burst)
	}
}
