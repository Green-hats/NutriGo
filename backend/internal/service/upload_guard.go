package service

import (
	"errors"
	"sync"
	"time"

	"golang.org/x/sys/unix"
	"golang.org/x/time/rate"
	"gorm.io/gorm"
	"nutri.go/backend/internal/config"
)

var ErrUploadBusy = errors.New("上传过于频繁或正在上传，请稍后重试")
var ErrImageQuota = errors.New("照片存储额度已满，请清理不再需要的照片或联系管理员")
var ErrUploadStorage = errors.New("服务器照片存储空间不足，请稍后重试")

type uploadBucket struct {
	limiter *rate.Limiter
	seen    time.Time
}

// UploadGuard 按单进程准入；运行中的请求先预留名额和字节，完成入库后释放预留。
// 不排队，避免慢上传占满内存；多实例部署须迁移到共享准入与配额事务。
type UploadGuard struct {
	mu        sync.Mutex
	Limits    config.UploadLimits
	FreeBytes func() (uint64, error)
	active    map[uint]int64
	buckets   map[uint]uploadBucket
}

func NewUploadGuard(limits config.UploadLimits, path string) *UploadGuard {
	return &UploadGuard{
		Limits: limits, active: make(map[uint]int64), buckets: make(map[uint]uploadBucket),
		FreeBytes: func() (uint64, error) {
			var stat unix.Statfs_t
			if err := unix.Statfs(path, &stat); err != nil {
				return 0, err
			}
			return stat.Bavail * uint64(stat.Bsize), nil
		},
	}
}

// Begin 在解析 multipart 和读取图片之前调用；每用户 1 个、全站 4 个在途上传。
func (g *UploadGuard) Begin(user uint) (func(), error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, busy := g.active[user]; busy || len(g.active) >= 4 {
		return nil, ErrUploadBusy
	}
	now := time.Now()
	for id, entry := range g.buckets {
		if now.Sub(entry.seen) > time.Hour {
			delete(g.buckets, id)
		}
	}
	entry, exists := g.buckets[user]
	if !exists {
		if len(g.buckets) >= 10000 {
			return nil, ErrUploadBusy
		}
		entry.limiter = rate.NewLimiter(rate.Limit(float64(g.Limits.PerMinute)/60), g.Limits.Burst)
	}
	entry.seen = now
	g.buckets[user] = entry
	if !entry.limiter.Allow() {
		return nil, ErrUploadBusy
	}
	// 为所有在途请求的最大 multipart 留余量；检测失败时拒绝写入。
	free, err := g.FreeBytes()
	reserve := uint64(len(g.active)+1) * (11 << 20)
	if err != nil || free < uint64(g.Limits.MinFreeBytes) || free-uint64(g.Limits.MinFreeBytes) < reserve {
		return nil, ErrUploadStorage
	}
	g.active[user] = 0
	return sync.OnceFunc(func() {
		g.mu.Lock()
		defer g.mu.Unlock()
		delete(g.active, user)
	}), nil
}

// Reserve 将图片和待删除任务在同一 SQL 快照中统计，避免删除失败绕过容量限制。
func (g *UploadGuard) Reserve(db *gorm.DB, user uint, size int64) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, admitted := g.active[user]; !admitted || size <= 0 || size > 10<<20 {
		return ErrUploadBusy
	}
	var usage struct{ UserBytes, UserFiles, TotalBytes, TotalFiles int64 }
	if err := db.Raw(`SELECT
		COALESCE(SUM(CASE WHEN user_id = ? THEN size_bytes ELSE 0 END), 0) AS user_bytes,
		COALESCE(SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END), 0) AS user_files,
		COALESCE(SUM(size_bytes), 0) AS total_bytes, COUNT(*) AS total_files
		FROM (SELECT user_id, size_bytes FROM food_images
		UNION ALL SELECT user_id, size_bytes FROM image_deletions)`, user, user).Scan(&usage).Error; err != nil {
		return err
	}
	var reserved int64
	for _, bytes := range g.active {
		reserved += bytes
	}
	if size > g.Limits.UserBytes-usage.UserBytes || usage.UserFiles >= g.Limits.UserFiles {
		return ErrImageQuota
	}
	if size > g.Limits.TotalBytes-usage.TotalBytes-reserved || usage.TotalFiles+int64(len(g.active)) > 20000 {
		return ErrUploadStorage
	}
	g.active[user] = size
	return nil
}
