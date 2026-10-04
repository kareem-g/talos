/**
 * Config — the machine card (connection truth, token copy, config path,
 * endpoints with reachability), integrations, about, and the unpair gate.
 */

import * as React from 'react'
import { Linking, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { mcpApi, remoteApi, settingsApi } from '@/lib/api'
import { clearPairing } from '@/lib/pairing'
import { DEMO_SESSION_ID } from '@/lib/demo'
import type { RootStack } from '../navigation'
import { useStore } from '@/store'
import { Btn, Dot, Label, Tap, Text, haptic } from '../ui'
import { MONO } from '../design/fonts'
import { color } from '../design/tokens'
import { ChevronRight, External, Monitor } from '../design/icons'

/** One context-assembly switch, shown as a state rather than a control. */
function AssemblyRow({ label, hint, on }: { label: string; hint: string; on: boolean }) {
  return (
    <View className="min-h-[54px] flex-row items-center gap-3 px-4 py-3">
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] text-ink">{label}</Text>
        <Text className="mt-0.5 text-[12.5px] leading-[17px] text-ink-2">{hint}</Text>
      </View>
      <Text className={on ? 'shrink-0 text-[13px] font-semibold text-green' : 'shrink-0 text-[13px] font-semibold text-ink-3'}>
        {on ? 'On' : 'Off'}
      </Text>
    </View>
  )
}

function Divider() {
  return <View className="ml-4 h-px bg-line" />
}

export function ConfigScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>()
  const insets = useSafeAreaInsets()
  const connection = useStore((s) => s.connection)
  const desktopName = useStore((s) => s.desktopName)
  const [configPath, setConfigPath] = React.useState<string | null>(null)
  const [endpoints, setEndpoints] = React.useState<Array<{ url?: string; reachable?: boolean }>>([])
  const [mcp, setMcp] = React.useState<Array<Record<string, unknown>>>([])
  const [assembly, setAssembly] = React.useState<Record<string, unknown> | null>(null)

  React.useEffect(() => {
    void settingsApi
      .get()
      .then((payload) => {
        const settings = (payload as { settings?: Record<string, unknown> }).settings ?? {}
        setConfigPath((payload as { config_path?: string }).config_path ?? null)
        const assembly = settings.context_assembly as Record<string, unknown> | undefined
        if (assembly) setAssembly(assembly)
      })
      .catch(() => undefined)
    void remoteApi
      .endpoints()
      .then((data) => {
        const list = (data as { endpoints?: Array<{ base_url?: string; reachable?: boolean }> }).endpoints ?? []
        setEndpoints(list.map((entry) => ({ url: entry.base_url, reachable: entry.reachable })))
      })
      .catch(() => undefined)
    void mcpApi
      .list()
      .then((data) => setMcp((data as { servers?: Array<Record<string, unknown>> }).servers ?? []))
      .catch(() => undefined)
  }, [])

  const connected = connection === 'connected'
  const statusLabel = connected ? 'Connected' : connection.charAt(0).toUpperCase() + connection.slice(1)

  return (
    <View className="flex-1 bg-canvas">
      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="px-5" style={{ paddingTop: insets.top + 16 }}>
          <Text className="text-[33px] font-bold leading-[37px] text-ink" style={{ letterSpacing: -0.5 }}>
            Config
          </Text>
        </View>

        {/* Machine */}
        <Label>Machine</Label>
        <View className="mx-4 overflow-hidden rounded-[16px] bg-surface">
          <View className="min-h-[54px] flex-row items-center gap-3 px-4 py-3">
            <View className="size-[30px] shrink-0 items-center justify-center rounded-lg bg-accent-tint">
              <Monitor size={16} color={color.accent} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[15px] font-semibold text-ink" numberOfLines={1}>
                {desktopName}
              </Text>
              <View className="mt-0.5 flex-row items-center gap-1.5">
                <Dot tone={connected ? 'green' : connection === 'connecting' || connection === 'reconnecting' ? 'orange' : 'red'} size={6} />
                <Text className="text-[14px] text-ink-2" numberOfLines={1}>
                  {statusLabel} · This machine
                </Text>
              </View>
            </View>
          </View>
          {configPath ? (
            <View className="border-t border-line px-4 pb-[13px] pt-[11px]">
              <Text className="text-[11px] font-semibold uppercase text-ink-3" style={{ letterSpacing: 0.5 }}>
                Config path
              </Text>
              <Text className="mt-[3px] text-[12px] text-ink-2" style={{ fontFamily: MONO }} numberOfLines={1}>
                {configPath}
              </Text>
            </View>
          ) : null}
          <View className="border-t border-line px-4 pb-[13px] pt-[11px]">
            <Text className="text-[11px] font-semibold uppercase text-ink-3" style={{ letterSpacing: 0.5 }}>
              Endpoints
            </Text>
            {endpoints.length === 0 ? (
              <Text className="mt-1.5 text-[12.5px] text-ink-3">None advertised.</Text>
            ) : (
              endpoints.slice(0, 4).map((endpoint, index) => (
                <View key={index} className="mt-1.5 flex-row items-center gap-2">
                  <Dot tone={endpoint.reachable ? 'green' : 'red'} size={6} />
                  <Text className="min-w-0 flex-1 text-[11.5px] text-ink-2" style={{ fontFamily: MONO }} numberOfLines={1}>
                    {endpoint.url ?? 'unknown'}
                    {endpoint.reachable === false ? ' — unreachable' : ''}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>

        {/* Integrations */}
        <Label>Integrations</Label>
        <View className="mx-4 overflow-hidden rounded-[16px] bg-surface">
          <View className="min-h-[54px] flex-row items-center gap-3 px-4 py-3">
            <Text className="min-w-0 flex-1 text-[15px] text-ink">MCP servers</Text>
            <Text className="shrink-0 text-[15px] text-ink-3">{mcp.length}</Text>
            <ChevronRight size={15} color={color.ink3} />
          </View>
          <View className="ml-[58px] h-px bg-line" />
          <View className="min-h-[54px] justify-center px-4 py-3">
            <Text className="text-[15px] text-ink">API providers</Text>
            <Text className="mt-0.5 text-[12.5px] leading-[17px] text-ink-2">
              Custom OpenAI/Anthropic-compatible endpoints are managed on the desktop's configuration page.
            </Text>
          </View>
          <View className="ml-[58px] h-px bg-line" />
          <View className="min-h-[54px] justify-center px-4 py-3">
            <Text className="text-[15px] text-ink">Daemon settings</Text>
            <Text className="mt-0.5 text-[12.5px] leading-[17px] text-ink-2">
              Every key the desktop exposes is editable there; this device mirrors the state.
            </Text>
          </View>
        </View>

        {/* Context assembly — what the daemon folds into a prompt before the
            agent sees it: the environment block, project skills, past
            trajectories and project memory. Read here, edited in the desktop's
            config file: the daemon's settings endpoint does not accept writes
            to this group, and a toggle that silently does nothing is worse
            than no toggle. */}
        <Label>Context assembly</Label>
        <View className="mx-4 overflow-hidden rounded-[16px] bg-surface">
          {assembly ? (
            <>
              <AssemblyRow
                label="Environment"
                hint="A git / OS / workspace section at the top of each prompt."
                on={assembly.environment_enabled === true}
              />
              <Divider />
              <AssemblyRow
                label="Project skills"
                hint="Loads .agentdeck/skills into the injected context."
                on={assembly.skills_enabled === true}
              />
              <Divider />
              <AssemblyRow
                label="Past trajectories"
                hint={`Up to ${String(assembly.max_trajectories ?? 0)} similar runs, injected as examples.`}
                on={assembly.trajectory_injection_enabled === true}
              />
              <Divider />
              <AssemblyRow
                label="Project memory"
                hint={`Up to ${String(assembly.max_memories ?? 0)} remembered entries per prompt.`}
                on={assembly.memory_enabled === true}
              />
              <Divider />
              <View className="px-4 py-3">
                <Text className="text-[12.5px] leading-[18px] text-ink-2">
                  Similarity threshold {String(assembly.similarity_threshold ?? '—')} — a trajectory must match at
                  least this closely to be injected.
                </Text>
              </View>
            </>
          ) : (
            <View className="px-4 py-3.5">
              <Text className="text-[13px] leading-[19px] text-ink-2">
                The desktop has not reported its context-assembly settings to this device yet.
              </Text>
            </View>
          )}
          <Divider />
          <View className="px-4 py-3">
            <Text className="text-[11.5px] leading-[17px] text-ink-3">
              Edited in config.toml on the desktop{configPath ? ` — ${configPath}` : ''}. Turn memory on or off for
              one project from a session's Memory page.
            </Text>
          </View>
        </View>

        {/* About */}
        <Label>About</Label>
        <View className="mx-4 overflow-hidden rounded-[16px] bg-surface">
          <View className="px-4 py-3.5">
            <Text className="text-[15px] text-ink">QAI for phones</Text>
            <Text className="mt-0.5 text-[12.5px] leading-[17px] text-ink-2">
              The desktop's shell, machined for touch — paired to your daemon over the same API the browser uses.
            </Text>
          </View>
          <View className="ml-4 h-px bg-line" />
          <Tap
            accessibilityRole="link"
            onPress={() => void Linking.openURL('https://github.com/kareem-g/agentdeck-linux').catch(() => undefined)}
            className="min-h-[54px] flex-row items-center gap-3 px-4 py-3"
          >
            <Text className="min-w-0 flex-1 text-[15px] font-medium text-accent">Documentation</Text>
            <External size={14} color={color.ink3} />
          </Tap>
        </View>

        {/* Developer — the fixture transcript, so every event card can be
            inspected on a device without waiting for a session to emit one.
            Rendered only in development. */}
        {__DEV__ ? (
          <>
            <Label>Developer</Label>
            <View className="mx-4 overflow-hidden rounded-[16px] bg-surface">
              <Tap
                accessibilityRole="button"
                accessibilityLabel="Preview the demo transcript"
                onPress={() => {
                  void haptic('select')
                  navigation.navigate('Session', { sessionId: DEMO_SESSION_ID })
                }}
                className="min-h-[54px] flex-row items-center gap-3 px-4 py-3"
              >
                <View className="min-w-0 flex-1">
                  <Text className="text-[15px] text-ink">Demo transcript</Text>
                  <Text className="mt-0.5 text-[12.5px] leading-[17px] text-ink-2">
                    One fabricated conversation containing every event card — plan, approvals, tool runs, subagents.
                  </Text>
                </View>
                <ChevronRight size={15} color={color.ink3} />
              </Tap>
            </View>
          </>
        ) : null}

        {/* Danger zone */}
        <Label>Danger zone</Label>
        <View className="mx-4 overflow-hidden rounded-[16px] bg-surface">
          <View className="min-h-[56px] flex-row items-center gap-3 px-4 py-3">
            <View className="min-w-0 flex-1">
              <Text className="text-[15px] text-red">Unpair this device</Text>
              <Text className="mt-0.5 text-[12.5px] text-ink-2">Revokes the token and returns to pairing.</Text>
            </View>
            <Btn
              size="sm"
              kind="danger"
              label="Unpair"
              onPress={() => {
                void haptic('warn')
                void clearPairing()
              }}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  )
}