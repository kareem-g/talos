/**
 * Engine Switch Modal — desktop parity.
 *
 * Switch the engine backing an existing session to another ready CLI or API
 * provider while keeping the same session row, workspace and transcript.
 */

import * as React from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { Bot, Cpu, X } from 'lucide-react-native'

import { useStore, type MobileAgent } from '@app/store'
import { Button, GlassSurface, Mono } from './ui'
import { palette } from '@app/design/tokens'

export function EngineSwitchModal({
  open,
  onClose,
  sessionId,
  currentAgent,
}: {
  open: boolean
  onClose: () => void
  sessionId: string
  currentAgent?: string
}) {
  const agents = useStore((s) => s.agents)
  const switchEngine = useStore((s) => s.switchEngine)

  const readyAgents = agents.filter((a) => a.available)
  const [selectedAgent, setSelectedAgent] = React.useState<string>(currentAgent ?? '')
  const [selectedModel, setSelectedModel] = React.useState<string | undefined>()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setSelectedAgent(currentAgent ?? readyAgents[0]?.id ?? '')
      setSelectedModel(undefined)
      setError(null)
    }
  }, [open, currentAgent])

  const agentObj = agents.find((a) => a.id === selectedAgent)
  const models = Array.isArray(agentObj?.models) ? (agentObj!.models as Array<string | { id?: string }>) : []

  async function handleSwitch() {
    if (!selectedAgent) return
    setBusy(true)
    setError(null)
    try {
      const ok = await switchEngine(sessionId, selectedAgent, selectedModel)
      if (ok) {
        onClose()
      } else {
        setError('Could not switch session engine')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Switch failed')
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
              <Cpu size={16} color={palette.accent} />
              <Text className="text-[15px] font-semibold text-ink">Switch Session Engine</Text>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close" className="size-8 items-center justify-center rounded-full active:bg-hover">
              <X size={16} color={palette.ink3} />
            </Pressable>
          </View>

          <Text className="mb-3 text-[12px] leading-5 text-ink-2">
            Switch the agent process running this session. A digest of the previous turns is handed over to the new provider so context is preserved.
          </Text>

          {error ? <Text className="mb-2 text-[12px] text-red">{error}</Text> : null}

          <ScrollView className="max-h-[320px]">
            <Mono className="mb-2 text-[10px] uppercase tracking-wider text-ink-3">Available Agents</Mono>
            <View className="gap-1.5">
              {readyAgents.map((agent) => {
                const active = agent.id === selectedAgent
                return (
                  <Pressable
                    key={agent.id}
                    onPress={() => {
                      setSelectedAgent(agent.id)
                      setSelectedModel(undefined)
                    }}
                    className={`min-h-12 flex-row items-center gap-3 rounded-xl border p-2.5 ${
                      active ? 'border-accent bg-accent-tint' : 'border-line bg-field active:bg-hover'
                    }`}
                  >
                    <Bot size={18} color={active ? palette.accent : palette.ink3} />
                    <View className="min-w-0 flex-1">
                      <Text className={`text-[13px] font-medium ${active ? 'text-ink' : 'text-ink-2'}`}>
                        {agent.name}
                      </Text>
                      <Mono className="text-[10px] text-ink-3">{agent.id}</Mono>
                    </View>
                    {agent.id === currentAgent ? (
                      <Mono className="rounded bg-line px-1.5 py-0.5 text-[9.5px] uppercase text-ink-3">
                        current
                      </Mono>
                    ) : null}
                  </Pressable>
                )
              })}
            </View>

            {models.length > 0 ? (
              <View className="mt-3 gap-1.5">
                <Mono className="text-[10px] uppercase tracking-wider text-ink-3">Model (optional)</Mono>
                <View className="flex-row flex-wrap gap-1.5">
                  {models.map((m, idx) => {
                    const modelId = typeof m === 'string' ? m : m.id ?? ''
                    const active = selectedModel === modelId
                    return (
                      <Pressable
                        key={idx}
                        onPress={() => setSelectedModel(active ? undefined : modelId)}
                        className={`min-h-8 items-center justify-center rounded-lg border px-2.5 ${
                          active ? 'border-accent bg-accent-tint' : 'border-line bg-field'
                        }`}
                      >
                        <Text className={`text-[11.5px] ${active ? 'text-ink font-medium' : 'text-ink-2'}`}>
                          {modelId}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View className="mt-4 flex-row items-center gap-2">
            <Button variant="ghost" label="Cancel" onPress={onClose} className="flex-1" />
            <Button
              variant="primary"
              label={busy ? 'Switching…' : 'Switch engine'}
              disabled={busy || !selectedAgent || selectedAgent === currentAgent}
              onPress={() => void handleSwitch()}
              className="flex-1"
            />
          </View>
        </GlassSurface>
      </View>
    </Modal>
  )
}
