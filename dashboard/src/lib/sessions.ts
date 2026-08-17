/**
 * Creates a session with the first available configured agent (falling back to
 * `claude`) and an optional initial prompt. Returns the new session id.
 * Used by the empty state, header and command palette so "new session" always
 * means a real backend session — never a fake local state.
 */
export async function createSessionWithDefaultAgent(prompt = '', project?: string): Promise<string> {
  const agentsRes = await fetch('/api/agents')
  const agentsData = await agentsRes.json()
  const available = (agentsData.agents || []).filter((agent: { available?: boolean }) => agent.available)
  const agent = (available[0]?.id as string | undefined) || 'claude'
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, prompt, project }),
  })
  const data = await res.json()
  if (!data.id) throw new Error(data.error || 'Could not create the session.')
  return data.id as string
}
