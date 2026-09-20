package config

import (
	"os"
	"strconv"
)

type UploadLimits struct {
	UserBytes, TotalBytes, UserFiles, MinFreeBytes int64
	PerMinute, Burst                               int
}

func positiveLimit(name string, fallback int64) int64 {
	value, err := strconv.ParseInt(os.Getenv(name), 10, 64)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func LoadUploadLimits() UploadLimits {
	return UploadLimits{
		UserBytes:    positiveLimit("IMAGE_USER_MAX_BYTES", 512<<20),
		TotalBytes:   positiveLimit("IMAGE_TOTAL_MAX_BYTES", 10<<30),
		UserFiles:    positiveLimit("IMAGE_USER_MAX_FILES", 1000),
		MinFreeBytes: positiveLimit("UPLOAD_MIN_FREE_BYTES", 2<<30),
		PerMinute:    int(positiveLimit("UPLOAD_RATE_PER_MIN", 10)),
		Burst:        int(positiveLimit("UPLOAD_RATE_BURST", 3)),
	}
}
