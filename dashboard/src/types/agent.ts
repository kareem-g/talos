export interface Agent {
  id: string
  name: string
  version: string
  available: boolean
  features: string[]
}

export interface AgentConfig {
  binary: string
  args: string[]
  env: Record<string, string>
}
