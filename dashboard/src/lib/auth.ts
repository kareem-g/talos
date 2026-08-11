export interface DeviceCredential {
  token: string
  deviceId: string
  deviceName: string
  pairedAt?: string
}

const STORAGE_KEY = 'agentdeck-device-credential'

export function getDeviceCredential(): DeviceCredential | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const credential = JSON.parse(raw) as DeviceCredential
    if (!credential.token || !credential.deviceId) return null
    return credential
  } catch {
    return null
  }
}

export function setDeviceCredential(credential: DeviceCredential) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(credential))
  // Keep the legacy keys in sync for existing desktop settings integrations.
  localStorage.setItem('agentdeck-token', credential.token)
  localStorage.setItem('agentdeck-device', credential.deviceName)
}

export function clearDeviceCredential() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem('agentdeck-token')
  localStorage.removeItem('agentdeck-device')
}

export function deviceAuthHeaders(): HeadersInit {
  const credential = getDeviceCredential()
  return credential ? { Authorization: `Bearer ${credential.token}` } : {}
}
