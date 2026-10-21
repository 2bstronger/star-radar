// 固定分类表：脚本（translate.mjs 校验 LLM 输出）与前端（web/src/lib/taxonomy.js）各同步一份
// 修改时请两处同步，保持顺序一致。
export const CATEGORIES = [
  '人工智能',
  '前端开发',
  '后端框架',
  'CLI工具',
  '自托管服务',
  'DevOps运维',
  '数据库',
  '安全隐私',
  '数据可视化',
  '移动开发',
  '测试工具',
  '效率工具',
  '学习资源',
  '设计资源',
  '游戏娱乐',
  '其他',
]

export function isValidCategory(name) {
  return CATEGORIES.includes(name)
}
