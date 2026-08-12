// 程序入口。初始化数据库 → 注册路由 → 启动 HTTP 服务 (:3333)
//
// 路由分三类：公共（无需认证）、受保护（需 JWT）、内部（需 Internal Token）
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"nutri.go/backend/internal/config"
	"nutri.go/backend/internal/handler"
	"nutri.go/backend/internal/httperr"
	"nutri.go/backend/internal/middleware"
	"nutri.go/backend/internal/model"
	"nutri.go/backend/internal/service"
)

const shutdownTimeout = 10 * time.Second

func main() {
	logger := slog.Default()

	// 生产环境校验密钥（缺失则启动失败）
	if err := config.InitSecrets(); err != nil {
		logger.Error("安全配置错误，启动中止", "error", err)
		os.Exit(1)
	}

	if err := config.InitDB(); err != nil {
		logger.Error("连接数据库失败，启动中止", "error", err)
		os.Exit(1)
	}

	// 自动建表
	if err := config.DB.AutoMigrate(&model.User{}, &model.UserProfile{}, &model.FoodImage{}, &model.FoodDiary{}, &model.DailySummary{}, &model.RefreshToken{}, &model.BlacklistedToken{}); err != nil {
		logger.Error("自动建表失败，启动中止", "error", err)
		os.Exit(1)
	}

	// 启动后台任务
	service.StartImageCleanup(config.DB)   // 每 1 小时删除 7 天前的图片
	service.StartDietAggregator(config.DB) // 每 24 小时聚合 7 天前的饮食记录
	service.StartTokenCleanup(config.DB)   // 每 6 小时清理过期令牌

	// 认证接口限流（令牌桶，防密码爆破）
	authLimiter := middleware.NewIPRateLimiter(config.AuthRateLimitRPS(), config.AuthRateLimitBurst())
	authLimiter.StartCleanup(5 * time.Minute)

	r := gin.New()
	r.Use(gin.Recovery())
	metrics := middleware.NewMetrics()
	r.Use(metrics.Middleware())

	// 创建各处理器实例
	authHandler := &handler.AuthHandler{DB: config.DB}
	profileHandler := &handler.ProfileHandler{DB: config.DB}
	imageHandler := &handler.ImageHandler{DB: config.DB}
	dietHandler := &handler.DietHandler{DB: config.DB}
	summaryHandler := &handler.SummaryHandler{DB: config.DB}

	// 公共路由：无需认证
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})
	// 就绪探针：校验数据库连接可用
	r.GET("/api/ready", func(c *gin.Context) {
		sqlDB, err := config.DB.DB()
		if err == nil {
			err = sqlDB.Ping()
		}
		if err != nil {
			httperr.Response(c, http.StatusServiceUnavailable, "数据库不可用: "+err.Error())
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})
	// 指标：Prometheus 文本格式
	r.GET("/api/metrics", metrics.Handler())
	r.POST("/api/auth/register", authLimiter.Middleware(), authHandler.Register)
	r.POST("/api/auth/login", authLimiter.Middleware(), authHandler.Login)
	r.POST("/api/auth/refresh", authLimiter.Middleware(), authHandler.Refresh)

	// 受保护路由：需要 JWT
	protected := r.Group("/api")
	protected.Use(middleware.JWTAuth(config.DB))
	{
		// 登出：吊销当前 access token + 可选 refresh token
		protected.POST("/auth/logout", authHandler.Logout)
		protected.GET("/protected/example", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"message":  "受保护路由示例",
				"user_id":  c.GetUint("userID"),
				"username": c.GetString("username"),
			})
		})
		// 健康档案
		protected.GET("/users/:id/profile", profileHandler.GetProfile)
		protected.PUT("/users/:id/profile", profileHandler.UpdateProfile)
		// 图片
		protected.POST("/images/upload", imageHandler.Upload)
		protected.DELETE("/images/:id", imageHandler.Delete)
		// 饮食记录
		protected.POST("/diet/logs", dietHandler.Create)
		protected.GET("/diet/logs", dietHandler.List)
		protected.DELETE("/diet/logs/:id", dietHandler.Delete)
		// 每日汇总
		protected.GET("/diet/summaries", summaryHandler.List)
	}

	// 内部路由：供 Python Agent 调用
	internal := r.Group("/api")
	internal.Use(middleware.InternalAuth())
	{
		internal.GET("/internal/example", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"message": "内部鉴权通过"})
		})
		// Python 通过 image_id 获取图片信息和二进制数据
		internal.GET("/images/:id", imageHandler.GetMeta)
		internal.GET("/images/:id/data", imageHandler.GetData)
		// 健康档案查询（Python 需要了解用户过敏原、目标等）
		internal.GET("/internal/users/:id/profile", profileHandler.GetProfileInternal)
		// 饮食记录查询（Python 需要用户历史饮食来做分析）
		internal.GET("/internal/diet/logs", dietHandler.ListInternal)
		// 每日营养汇总（Python 需要多日趋势来做分析）
		internal.GET("/internal/diet/summaries", summaryHandler.ListInternal)
	}

	srv := &http.Server{
		Addr:              ":3333",
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// 启动 HTTP 服务（goroutine 内运行，主协程等待退出信号）
	go func() {
		logger.Info("HTTP 服务启动", "addr", ":3333")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP 服务异常退出", "error", err)
			os.Exit(1)
		}
	}()

	// 监听 SIGINT/SIGTERM，触发优雅关闭
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	logger.Info("收到退出信号，开始优雅关闭")

	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("优雅关闭超时或失败", "error", err)
		os.Exit(1)
	}
	logger.Info("HTTP 服务已关闭")
}
