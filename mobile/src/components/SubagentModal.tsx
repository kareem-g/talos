/**
 * Subagent & Orchestration (Fan-out) Modals — desktop parity.
 *
 * Exposes the harness multi-agent execution primitives directly from the phone:
 * - Spawn subagent: run a specialized child agent under this session.
 * - Orchestrate: fan out one prompt to multiple agents concurrently and merge responses.
 */

import * as React from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Layers, Users, X, Zap } from 'lucide-react-native'

import { mobileApi } from '@app/lib/api'
import { useStore } from '@app/store'
import { Button, GlassSurface, Mono, Segmented, TextField } from './ui'

const BUILTIN_ROLES = [
  { id: 'worker', label: 'Worker', desc: 'General-purpose autonomous executor' },
  { id: 'reviewer', label: 'Reviewer', desc: 'Read-only code & design auditor' },
  { id: 'planner', label: 'Planner', desc: 'High-level task decomposition' },
  { id: 'summarizer', label: 'Summarizer', desc: 'Compact synthesis of progress' },
]

export function SubagentModal({
  open,
  onClose,
  sessionId,
  onSpawned,
}: {
  open: boolean
  onClose: () => void
  sessionId: string
  onSpawned?: (childId: string) => void
}) {
  const [mode, setMode] = React.useState<'spawn' | 'orchestrate'>('spawn')
  const [role, setRole] = React.useState('worker')
  const [prompt, setPrompt] = React.useState('')
  const [selectedAgents, setSelectedAgents] = React.useState<string[]>([])
  const [merge, setMerge] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const agents = useStore((s) => s.agents)
  const readyAgents = agents.filter((a) => a.available)

  React.useEffect(() => {
    if (open) {
      setPrompt('')
      setError(null)
      if (readyAgents.length > 0 && selectedAgents.length === 0) {
        setSelectedAgents([readyAgents[0].id])
      }
    }
  }, [open])

  function toggleAgent(agentId: string) {
    setSelectedAgents((prev) =>
      prev.includes(agentId) ? prev.filter((a) => a !== agentId) : [...prev, agentId],
    )
  }

  async function handleExecute() {
    if (!prompt.trim()) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'spawn') {
        const res = await mobileApi.spawnSubagent(sessionId, {
          role,
          prompt: prompt.trim(),
        })
        if (res.child_session_id) {
          onSpawned?.(res.child_session_id)
        }
        onClose()
      } else {
        if (selectedAgents.length === 0) {
          setError('Select at least one agent')
          setBusy(false)
          return
        }
        await mobileApi.orchestrate(sessionId, {
          prompt: prompt.trim(),
          agents: selectedAgents,
          merge,
        })
        onClose()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <GlassSurface effect="regular" radius={24} className="border-t border-line bg-surface/95 p-4 pb-8">
          <View className="mb-3 flex-row items-center justify-between border-b border-line pb-2.5">
            <View className="flex-row items-center gap-2">
              {mode === 'spawn' ? <Users size={16} color="#5b8def" /> : <Layers size={16} color="#5b8def" />}
              <Text className="text-[15px] font-semibold text-ink">
                {mode === 'spawn' ? 'Spawn Subagent' : 'Fan-Out Orchestration'}
              </Text>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close" className="size-8 items-center justify-center rounded-full active:bg-hover">
              <X size={16} color="#7e7e86" />
            </Pressable>
          </View>

          <View className="mb-3">
            <Segmented
              options={[
                { value: 'spawn', label: 'Single Subagent' },
                { value: 'orchestrate', label: 'Fan-Out (Multi-Agent)' },
              ]}
              value={mode}
              onChange={(m) => setMode(m as 'spawn' | 'orchestrate')}
            />
          </View>

          {error ? <Text className="mb-2 text-[12px] text-red">{error}</Text> : null}

          <ScrollView className="max-h-[380px]">
            {mode === 'spawn' ? (
              <View className="gap-2.5">
                <Mono className="text-[10px] uppercase tracking-wider text-ink-3">Built-in Role</Mono>
                <View className="flex-row flex-wrap gap-1.5">
                  {BUILTIN_ROLES.map((r) => {
                    const active = r.id === role
                    return (
                      <Pressable
                        key={r.id}
                        onPress={() => setRole(r.id)}
                        className={`min-h-9 flex-row items-center gap-1.5 rounded-lg border px-3 ${
                          active ? 'border-accent bg-accent-tint' : 'border-line bg-field'
                        }`}
                      >
                        <Text className={`text-[12px] font-medium ${active ? 'text-ink' : 'text-ink-2'}`}>
                          {r.label}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
                <Text className="text-[11px] text-ink-3">
                  {BUILTIN_ROLES.find((r) => r.id === role)?.desc}
                </Text>
              </View>
            ) : (
              <View className="gap-2.5">
                <Mono className="text-[10px] uppercase tracking-wider text-ink-3">Target Agents</Mono>
                <View className="flex-row flex-wrap gap-1.5">
                  {readyAgents.map((agent) => {
                    const active = selectedAgents.includes(agent.id)
                    return (
                      <Pressable
                        key={agent.id}
                        onPress={() => toggleAgent(agent.id)}
                        className={`min-h-9 flex-row items-center gap-1.5 rounded-lg border px-3 ${
                          active ? 'border-accent bg-accent-tint' : 'border-line bg-field'
                        }`}
                      >
                        <View
                          className={`size-2.5 rounded-full ${active ? 'bg-accent' : 'border border-line-strong'}`}
                        />
                        <Text className={`text-[12px] font-medium ${active ? 'text-ink' : 'text-ink-2'}`}>
                          {agent.name}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
                <Pressable
                  onPress={() => setMerge(!merge)}
                  className="flex-row items-center gap-2 py-1"
                >
                  <View
                    className={`size-4 items-center justify-center rounded border ${
                      merge ? 'border-accent bg-accent' : 'border-line-strong'
                    }`}
                  >
                    {merge ? <Text className="text-[10px] text-canvas font-bold">✓</Text> : null}
                  </View>
                  <Text className="text-[12px] text-ink">Merge synthesis (synthesizes one final answer)</Text>
                </Pressable>
              </View>
            )}

            <View className="mt-3 gap-1.5">
              <Mono className="text-[10px] uppercase tracking-wider text-ink-3">Prompt / Task</Mono>
              <TextInput
                value={prompt}
                onChangeText={setPrompt}
                placeholder={
                  mode === 'spawn'
                    ? 'What should this subagent investigate or build?'
                    : 'Describe the task to fan out across multiple agents…'
                }
                placeholderTextColor="#7e7e86"
                multiline
                numberOfLines={4}
                className="min-h-24 rounded-xl border border-line bg-field p-3 text-[13px] text-ink"
              />
            </View>
          </ScrollView>

          <View className="mt-4 flex-row items-center gap-2">
            <Button variant="ghost" label="Cancel" onPress={onClose} className="flex-1" />
            <Button
              variant="primary"
              label={busy ? 'Running…' : mode === 'spawn' ? 'Spawn subagent' : 'Fan out task'}
              disabled={busy || !prompt.trim()}
              onPress={() => void handleExecute()}
              className="flex-1"
            />
          </View>
        </GlassSurface>
      </View>
    </Modal>
  )
}
