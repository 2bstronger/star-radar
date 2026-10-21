export function relTime(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} 个月前`
  return `${Math.floor(mo / 12)} 年前`
}

export function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function fmtNum(n) {
  if (n == null) return '—'
  if (n >= 10000) return Math.round(n / 1000) + 'k'
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

const LANG_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Rust: '#dea584',
  Go: '#00ADD8', C: '#555555', 'C++': '#f34b7d', 'C#': '#178600', Java: '#b07219',
  Ruby: '#701516', PHP: '#4F5D95', Swift: '#F05138', Kotlin: '#A97BFF',
  Dart: '#00B4AB', Vue: '#41b883', HTML: '#e34c26', CSS: '#563d7c',
  Shell: '#89e051', PowerShell: '#012456', Lua: '#000080', Haskell: '#5e5086',
  Elixir: '#6e4a7e', Zig: '#ec915c', 'Jupyter Notebook': '#DA5B0B', Nix: '#7e7eff',
  SCSS: '#c6538c', Makefile: '#427819', Dockerfile: '#384d54', MDX: '#fcb32c',
}

export function langColor(name) {
  if (!name) return '#94a3b8'
  if (LANG_COLORS[name]) return LANG_COLORS[name]
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360
  return `hsl(${h} 65% 55%)`
}

export async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t)
    return true
  } catch {
    return false
  }
}
