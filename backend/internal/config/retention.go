// 共享业务常量
package config

// AggregationRetentionDays 明细聚合保留期：
// 距今超过该天数的 food_diaries 原始记录会被后台任务聚合进 daily_summaries。
// handler（查询合并逻辑）与 service（聚合任务）共用此值，避免常量漂移。
const AggregationRetentionDays = 7
