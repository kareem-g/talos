import { useState } from 'react'
import { clearDeviceCredential, getDeviceCredential, setDeviceCredential, type DeviceCredential } from '../lib/auth'

interface AuthState {
  isAuthenticated: boolean
  token: string | null
  deviceName: string | null
  deviceId: string | null
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(() => {
    const credential = getDeviceCredential()
    const token = credential?.token || localStorage.getItem('agentdeck-token')
    return {
      isAuthenticated: !!token,
      token,
      deviceName: credential?.deviceName || localStorage.getItem('agentdeck-device'),
      deviceId: credential?.deviceId || null,
    }
  })

  const login = (token: string, deviceName: string) => {
    const credential: DeviceCredential = {
      token,
      deviceId: 'legacy',
      deviceName,
    }
    setDeviceCredential(credential)
    setAuth({ isAuthenticated: true, token, deviceName, deviceId: credential.deviceId })
  }

  const loginWithCredential = (credential: DeviceCredential) => {
    setDeviceCredential(credential)
    setAuth({
      isAuthenticated: true,
      token: credential.token,
      deviceName: credential.deviceName,
      deviceId: credential.deviceId,
    })
  }

  const logout = () => {
    clearDeviceCredential()
    setAuth({ isAuthenticated: false, token: null, deviceName: null, deviceId: null })
  }

  return { ...auth, login, loginWithCredential, logout }
}
