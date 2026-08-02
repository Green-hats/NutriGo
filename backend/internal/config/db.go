// 数据库初始化和连接管理
package config

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// DB 是全局数据库连接，整个程序共享这一个实例
var DB *gorm.DB

// InitDB 打开 SQLite 数据库文件 data.db，初始化全局 DB 变量
func InitDB() error {
	var err error
	DB, err = gorm.Open(sqlite.Open("data.db"), &gorm.Config{})
	if err != nil {
		return err
	}
	return nil
}
