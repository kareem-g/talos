/**
 * Engines — one tab, two segments. Agents is the daemon's provider report
 * (ready first, unavailable ones say why). Browsers is the CDP fleet: every
 * session can start or stop the built-in browser.
 */

import * as React from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useStore } from '@/store'
import { browserApi, providersApi, type BrowserInstance } from '@/lib/api'
import { Btn, Pill, Seg, Tap, Text, haptic } from '../ui'
import { MONO } from '../design/fonts'
import { color } from '../design/tokens'
import { Refresh } from '../design/icons'

type Segment = 'agents' | 'browsers'

export function EnginesScreen({ initial = 'agents' }: { initial?: Segment }) {
  const insets = useSafeAreaInsets()
  const agents = useStore((s) => s.agents)
  const sessions = useStore((s) => s.sessions)
  const loadSnapshot = useStore((s) => s.loadSnapshot)
  const [segment, setSegment] = React.useState<Segment>(initial)
  const [busy, setBusy] = React.useState(false)

  const [instances, setInstances] = React.useState<BrowserInstance[] | null>(null)
  const [browserBusy, setBrowserBusy] = React.useState<string | null>(null)

  const refreshBrowsers = React.useCallback(
    () => browserApi.status().then((data) => setInstances(data.sessions ?? [])).catch(() => setInstances([])),
    [],
  )

  React.useEffect(() => {
    if (segment === 'browsers') void refreshBrowsers()
  }, [segment, refreshBrowsers])

  async function toggle(sessionId: string) {
    setBrowserBusy(sessionId)
    void haptic('medium')
    try {
      const running = (instances ?? []).some((instance) => instance.session_id === sessionId)
      if (running) await browserApi.stop(sessionId)
      else await browserApi.start(sessionId)
      await refreshBrowsers()
    } catch {
      // refresh below still runs
    } finally {
      setBrowserBusy(null)
    }
  }

  const ordered = React.useMemo(
    () => agents.slice().sort((a, b) => Number(b.available) - Number(a.available)),
    [agents],
  )

  const browserRows = sessions.filter((session) => session.status !== 'archived')
  const runningIds = new Set((instances ?? []).map((instance) => instance.session_id))

  function rescan() {
    if (segment === 'browsers') {
      void refreshBrowsers()
      return
    }
    // Re-probe the machine, not just the cache: installing a CLI changes what
    // the daemon can run, and only `providers/refresh` asks it to look again.
    // Reading the snapshot alone leaves a freshly installed engine invisible.
    setBusy(true)
    void providersApi
      .refresh()
      .catch(() => undefined)
      .then(() => loadSnapshot())
      .finally(() => setBusy(false))
  }

  return (
    <View className="flex-1 bg-canvas">
      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center px-5" style={{ paddingTop: insets.top + 16 }}>
          <Text className="text-[33px] font-bold leading-[37px] text-ink" style={{ letterSpacing: -0.5 }}>
            Engines
          </Text>
          <View className="flex-1" />
          <Tap
            accessibilityRole="button"
            accessibilityLabel={segment === 'agents' ? (busy ? 'Scanning…' : 'Re-scan agents') : 'Re-check browsers'}
            onPress={() => {
              void haptic('light')
              rescan()
            }}
            squeeze={0.92}
            className="h-9 w-9 items-center justify-center rounded-full bg-field"
          >
            <Refresh size={16} color={color.ink} stroke={2} />
          </Tap>
        </View>

        <View className="mt-3 px-5">
          <Seg
            value={segment}
            options={[
              { value: 'agents' as const, label: 'Agents' },
              { value: 'browsers' as const, label: 'Browsers' },
            ]}
            onChange={(value) => {
              void haptic('select')
              setSegment(value)
            }}
          />
        </View>

        {segment === 'agents' ? (
          <View className="mt-4">
            <View className="mx-4 overflow-hidden rounded-[16px] bg-surface">
              {ordered.length === 0 ? (
                <Text className="p-6 text-center text-[13px] text-ink-3">No providers yet — re-scan to detect installed CLIs.</Text>
              ) : (
                ordered.map((agent, index) => {
                  const ready = agent.available
                  return (
                    <React.Fragment key={agent.id}>
                      {index > 0 ? <View className="ml-4 h-px bg-line" /> : null}
                      <View className="min-h-[58px] flex-row items-center gap-3 px-4 py-[13px]">
                        <View className="size-2 shrink-0 rounded-full" style={{ backgroundColor: ready ? color.green : color.orange }} />
                        <View className="min-w-0 flex-1">
                          <View className="flex-row items-baseline gap-2">
                            <Text className="shrink text-[15.5px] text-ink" numberOfLines={1}>
                              {agent.name}
                            </Text>
                            {agent.protocol ? (
                              <Text className="text-[10px] uppercase text-ink-3" style={{ fontFamily: MONO, letterSpacing: 0.6 }}>
                                {agent.protocol}
                              </Text>
                            ) : null}
                          </View>
                          <Text className={ready ? 'mt-0.5 text-[14px] text-ink-2' : 'mt-0.5 text-[14px] text-orange'} numberOfLines={2}>
                            {ready ? 'Ready' : 'Not ready — check the CLI on the desktop'}
                          </Text>
                        </View>
                        <Pill label={ready ? 'Ready' : 'Down'} tone={ready ? 'green' : 'orange'} />
                      </View>
                    </React.Fragment>
                  )
                })
              )}
            </View>
            <Text className="mx-4 mt-4 text-[11.5px] leading-[17px] text-ink-3">
              A ready agent can take tasks right now. Entries that are not ready say what is missing and how to fix it — nothing is hidden.
            </Text>
          </View>
        ) : (
          <View className="mt-4">
            {instances === null ? (
              <Text className="py-8 text-center text-[13px] text-ink-3">Checking browser engines…</Text>
            ) : browserRows.length === 0 ? (
              <View className="mx-4 rounded-[16px] border border-dashed border-line p-6">
                <Text className="text-center text-[12.5px] text-ink-3">No workspace sessions yet. Open a project to give the agent a browser.</Text>
              </View>
            ) : (
              <View className="mx-4 overflow-hidden rounded-[16px] bg-surface">
                {browserRows.map((session, index) => {
                  const running = runningIds.has(session.id)
                  return (
                    <React.Fragment key={session.id}>
                      {index > 0 ? <View className="ml-4 h-px bg-line" /> : null}
                      <View className="min-h-[58px] flex-row items-center gap-3 px-4 py-[13px]">
                        <View className="size-2 shrink-0 rounded-full" style={{ backgroundColor: running ? color.green : color.ink3 }} />
                        <View className="min-w-0 flex-1">
                          <Text className="text-[15.5px] text-ink" numberOfLines={1}>
                            {session.name}
                          </Text>
                          <Text className="mt-0.5 text-[11px] text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
                            {session.project ? session.project.split('/').pop() ?? session.project : 'no project — inbox'}
                          </Text>
                        </View>
                        {session.project ? (
                          <Btn
                            size="sm"
                            kind={running ? 'plate' : 'primary'}
                            label={browserBusy === session.id ? 'Working…' : running ? 'Stop' : 'Start'}
                            disabled={browserBusy === session.id}
                            onPress={() => void toggle(session.id)}
                          />
                        ) : (
                          <Pill label="Needs project" tone="dim" />
                        )}
                      </View>
                    </React.Fragment>
                  )
                })}
              </View>
            )}
            <Text className="mx-4 mt-4 text-[11.5px] leading-[17px] text-ink-3">
              Sessions with a workspace project can run the built-in browser engine — the agent drives it through the same tools.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  )
}

/** The tab route: Engines opening on its Agents segment. */
export function AgentsScreen() {
  return <EnginesScreen initial="agents" />
}