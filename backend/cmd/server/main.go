package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default() //创建 gin 引擎

	//返回一个json数据表示jing的健康状态
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{ //gin.H 是 map[string]any 的快捷写法
			"status": "healthy",
		})
	})

	r.Run(":3333") //在端口3333运行
}
