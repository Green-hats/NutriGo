// 程序入口。初始化数据库 → 注册路由 → 启动 HTTP 服务 (:3333)
//
// 路由分三类：公共（无需认证）、受保护（需 JWT）、内部（需 Internal Token）
package main

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"nutri.go/backend/internal/config"
	"nutri.go/backend/internal/handler"
	"nutri.go/backend/internal/middleware"
	"nutri.go/backend/internal/model"
	"nutri.go/backend/internal/service"
)

func main() {
	// 生产环境校验密钥（缺失则启动失败）
	if err := config.InitSecrets(); err != nil {
		panic("安全配置错误: " + err.Error())
	}

	if err := config.InitDB(); err != nil {
		panic("连接数据库失败: " + err.Error())
	}

	// 自动建表
	config.DB.AutoMigrate(&model.User{}, &model.UserProfile{}, &model.FoodImage{}, &model.FoodDiary{}, &model.DailySummary{})

	// 启动后台任务
	service.StartImageCleanup(config.DB)    // 每 1 小时删除 7 天前的图片
	service.StartDietAggregator(config.DB)  // 每 24 小时聚合 7 天前的饮食记录

	r := gin.Default()

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
	r.POST("/api/auth/register", authHandler.Register)
	r.POST("/api/auth/login", authHandler.Login)

	// 受保护路由：需要 JWT
	protected := r.Group("/api")
	protected.Use(middleware.JWTAuth())
	{
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

	r.Run(":3333")
}
