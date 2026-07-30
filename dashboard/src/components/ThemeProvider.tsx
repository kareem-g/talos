import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface ThemeContextType {
  theme: string
  setTheme: (theme: string) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'tokyo-night',
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem('agentdeck-theme') || 'tokyo-night'
  })

  const setTheme = useCallback((newTheme: string) => {
    setThemeState(newTheme)
    localStorage.setItem('agentdeck-theme', newTheme)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useThemeContext() {
  return useContext(ThemeContext)
}
