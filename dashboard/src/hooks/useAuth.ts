import { useState } from 'react'

interface AuthState {
  isAuthenticated: boolean
  token: string | null
  deviceName: string | null
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(() => {
    const token = localStorage.getItem('agentdeck-token')
    return {
      isAuthenticated: !!token,
      token,
      deviceName: localStorage.getItem('agentdeck-device'),
    }
  })

  const login = (token: string, deviceName: string) => {
    localStorage.setItem('agentdeck-token', token)
    localStorage.setItem('agentdeck-device', deviceName)
    setAuth({ isAuthenticated: true, token, deviceName })
  }

  const logout = () => {
    localStorage.removeItem('agentdeck-token')
    localStorage.removeItem('agentdeck-device')
    setAuth({ isAuthenticated: false, token: null, deviceName: null })
  }

  return { ...auth, login, logout }
}
