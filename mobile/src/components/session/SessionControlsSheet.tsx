/**
 * SessionControlsSheet — the desktop's "Model & permissions" Layer.
 *
 * The desktop SessionView moves model / thinking / permission controls out of
 * the composer and into a sheet behind the Settings2 header button, "so the
 * composer stays one line and the keyboard keeps its room". This is that
 * sheet: the engine row (which opens the engine switcher), then every live
 * configuration dimension the agent advertises — model, permission mode,
 * thought level, effort, mode, anything else — as full-width rows with their
 * current value and mutability, each opening a searchable picker.
 *
 * Dimensions are data: a provider that grows a new one appears here with no
 * release. Changes ride the same `set_config` socket command the desktop
 * sends, and the daemon's `session_config_changed` echo is what flips the
 * row's value — the UI never pretends a change landed before it did.
 */

import * as React from 'react'
import {Pressable, View} from 'react-native'
import { Text } from '@app/components/Text'
import { ChevronRight, Cpu } from 'lucide-react-native'

import type { ConfigOption } from '@/types/provider'
import { socket } from '@app/lib/socket'
import { useStore } from '@app/store'
import { palette } from '@app/design/tokens'
import { PickerSheet, SideSheet } from '@app/components/Sheet'
import { EngineSwitchSheet } from '@app/components/EngineSwitchModal'
import { AgentAvatar, Badge, Eyebrow, Mono, haptic } from '@app/components/ui'

/** Dimensions that are not meaningful as a control row. */
const HIDDEN_OPTIONS = new Set(['worktree', 'cwd', 'command'])

/** The desktop's permission-mode explanations, keyed by the backend's ids. */
const PERMISSION_HINTS: Record<string, string> = {
  ask: 'Pause and ask before any change.',
  auto_edit: 'Apply file edits; still asks for commands.',
  plan: 'Read-only: produce a plan and wait for approval.',
  full: 'Run with fewer confirmations.',
}

export function SessionControlsSheet({
  open,
  onClose,
  sessionId,
  agentId,
}: {
  open: boolean
  onClose: () => void
  sessionId: string
  agentId: string
}) {
  const config = useStore((state) => state.configs[sessionId])
  const agents = useStore((state) => state.agents)
  const [picker, setPicker] = React.useState<ConfigOption | null>(null)
  const [engineOpen, setEngineOpen] = React.useState(false)

  const options = (config?.options ?? []).filter(
    (option) => !HIDDEN_OPTIONS.has(option.id) && option.mutability !== 'start_only',
  )
  const agentName = agents.find((agent) => agent.id === agentId)?.name ?? (agentId || 'agent')

  function choose(value: string) {
    if (!picker) return
    socket.setConfig(sessionId, picker.id, value)
    void haptic('success')
    setPicker(null)
  }

  return (
    <>
      <SideSheet open={open} onClose={onClose} title="Model & permissions" side="right">
        {/* ── Engine ─────────────────────────────────────────────────── */}
        <View className="gap-1.5">
          <Eyebrow>Engine</Eyebrow>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Engine: ${agentName}`}
            accessibilityHint="Move this session to a different CLI or model"
            onPress={() => {
              void haptic('light')
              setEngineOpen(true)
            }}
            className="min-h-[52px] flex-row items-center gap-3 rounded-lg border border-line bg-surface px-3.5 active:bg-raised"
          >
            <AgentAvatar agent={agentId} size={30} name={agentName} />
            <View className="min-w-0 flex-1">
              <Text className="text-[13px] leading-[18px] font-semibold text-ink" numberOfLines={1}>
                {agentName}
              </Text>
              <Mono className="text-[10.5px]" numberOfLines={1}>
                switch engine · keeps the transcript
              </Mono>
            </View>
            <ChevronRight size={15} color={palette.ink4} />
          </Pressable>
        </View>

        {/* ── Live dimensions ────────────────────────────────────────── */}
        <View className="gap-1.5">
          <Eyebrow>Controls{config?.live ? ' · live from the agent' : ''}</Eyebrow>
          {options.length === 0 ? (
            <Text className="px-1 py-2 text-[12px] leading-[17px] text-ink-3">
              This agent has not reported live controls yet. They appear here as soon as the
              session announces them — model, permission mode, thinking level and anything else
              the engine exposes.
            </Text>
          ) : (
            options.map((option) => {
              const current = option.choices.find((choice) => choice.value === option.currentValue)
              const value = current?.name || option.currentValue || '—'
              const live = option.mutability === 'live'
              const hint =
                option.id === 'permission_mode' ? PERMISSION_HINTS[option.currentValue ?? ''] : undefined
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${option.name}: ${value}`}
                  accessibilityHint={live ? 'Applies immediately' : 'Applies to the next run'}
                  onPress={() => {
                    void haptic('light')
                    setPicker(option)
                  }}
                  className="min-h-[52px] flex-row items-center gap-3 rounded-lg border border-line bg-surface px-3.5 active:bg-raised"
                >
                  <View style={{ width: 28, alignItems: 'center' }}>
                    <Cpu size={15} color={option.id === 'permission_mode' ? palette.wait : palette.ink3} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[12.5px] leading-[17px] text-ink-2" numberOfLines={1}>
                      {option.name}
                    </Text>
                    <Text className="text-[13px] leading-[18px] font-semibold text-ink" numberOfLines={1}>
                      {value}
                    </Text>
                    {hint ? (
                      <Text className="mt-0.5 text-[11px] leading-[15px] text-ink-3" numberOfLines={2}>
                        {hint}
                      </Text>
                    ) : null}
                  </View>
                  <Badge tone={live ? 'ok' : 'muted'} outline mono>
                    {live ? 'live' : 'next run'}
                  </Badge>
                  <ChevronRight size={14} color={palette.ink4} />
                </Pressable>
              )
            })
          )}
        </View>

        <Text className="px-1 text-[10.5px] leading-[15px] text-ink-4">
          Changes are sent to the agent over the same channel the desktop uses. A dimension the
          engine declines reports back here rather than silently keeping the old value.
        </Text>
      </SideSheet>

      {/* Nested pickers — rendered inside the sheet's own modal layer, so
          they present above it instead of fighting it. */}
      <PickerSheet
        open={picker !== null}
        onClose={() => setPicker(null)}
        title={picker?.name ?? ''}
        subtitle={
          picker?.mutability === 'live'
            ? 'Applies immediately'
            : 'Applies to the next run of this session'
        }
        value={picker?.currentValue}
        onSelect={choose}
        options={(picker?.choices ?? []).map((choice) => ({
          value: choice.value,
          label: choice.name || choice.value,
          hint: choice.description ?? (picker?.id === 'permission_mode' ? PERMISSION_HINTS[choice.value] : undefined),
        }))}
        allowsCustomValue={picker?.allowsCustomValue}
        customPlaceholder="Any value this agent accepts"
        emptyLabel="This agent reported no options for this setting."
      />

      <EngineSwitchSheet
        open={engineOpen}
        sessionId={sessionId}
        currentAgent={agentId}
        onClose={() => setEngineOpen(false)}
      />
    </>
  )
}
