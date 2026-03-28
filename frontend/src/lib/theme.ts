export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'overseer-theme'

export function getTheme(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'light'
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme)
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function initTheme() {
  setTheme(getTheme())
}
