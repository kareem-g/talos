/**
 * Command Palette (⌘K) — desktop parity.
 *
 * Fast navigation and execution modal:
 * - Search and jump to any session
 * - Navigate to any rail destination
 * - Trigger station actions (New task, Re-scan agents, Discover past CLI runs)
 */

import * as React from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import {
  BarChart3,
  Bot,
  Command,
  Compass,
  FilePlus,
  Globe,
  History,
  Home,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  X,
} from 'lucide-react-native'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'

import { useStore } from '@app/store'
import { useOpenSession, type DrawerParamList } from '@app/navigation'
import { basename, relativeTime } from '@/lib/format'
import { GlassSurface, Mono, TextField } from './ui'
import { providersApi } from '@app/lib/api'

export function CommandPalette({
  open,
  onClose,
  onNewTask,
  onDiscover,
}: {
  open: boolean
  onClose: () => void
  onNewTask?: () => void
  onDiscover?: () => void
}) {
  const [query, setQuery] = React.useState('')
  const [busyAction, setBusyAction] = React.useState<string | null>(null)
  const [actionNotice, setActionNotice] = React.useState<string | null>(null)

  const sessions = useStore((s) => s.sessions)
  const loadSnapshot = useStore((s) => s.loadSnapshot)
  const openSession = useOpenSession()
  const navigation = useNavigation<DrawerNavigationProp<DrawerParamList>>()

  React.useEffect(() => {
    if (open) {
      setQuery('')
      setActionNotice(null)
    }
  }, [open])

  const q = query.trim().toLowerCase()

  const matchingSessions = React.useMemo(() => {
    if (!q) return sessions.slice(0, 10)
    return sessions
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.agent.toLowerCase().includes(q) ||
          (s.project && s.project.toLowerCase().includes(q)),
      )
      .slice(0, 20)
  }, [sessions, q])

  async function rescanAgents() {
    setBusyAction('rescan')
    try {
      await providersApi.refresh()
      await loadSnapshot()
      setActionNotice('Re-scanned $PATH and updated providers')
      setTimeout(() => setActionNotice(null), 2500)
    } catch {
      setActionNotice('Failed to re-scan providers')
    } finally {
      setBusyAction(null)
    }
  }

  function navigateTo(screen: keyof DrawerParamList) {
    onClose()
    navigation.navigate(screen)
  }

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 justify-start bg-black/75 px-4 pt-16">
        <Pressable onPress={(e) => e.stopPropagation()} className="w-full">
          <GlassSurface
            effect="regular"
            radius={20}
            className="overflow-hidden border border-line bg-surface/95 shadow-2xl shadow-black/60"
          >
            {/* Search Input Bar */}
            <View className="flex-row items-center border-b border-line px-3.5 py-3">
              <Command size={18} color="#7e7e86" />
              <TextField
                value={query}
                onChangeText={setQuery}
                placeholder="Type a command or search sessions…"
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 border-0 bg-transparent px-2.5 text-[14px]"
              />
              <Pressable
                onPress={onClose}
                accessibilityLabel="Close"
                className="size-8 items-center justify-center rounded-full active:bg-hover"
              >
                <X size={16} color="#7e7e86" />
              </Pressable>
            </View>

            {actionNotice ? (
              <View className="bg-accent-tint px-4 py-2 border-b border-accent/20">
                <Text className="text-[12px] text-accent font-medium">{actionNotice}</Text>
              </View>
            ) : null}

            <ScrollView className="max-h-[460px] p-2" keyboardShouldPersistTaps="handled">
              {/* Quick Actions */}
              <Mono className="px-3 pb-1 pt-2 text-[9.5px] uppercase tracking-wider text-ink-3">
                Actions
              </Mono>

              <Pressable
                onPress={() => {
                  onClose()
                  onNewTask?.()
                }}
                className="flex-row items-center gap-2.5 rounded-lg px-3 py-2.5 active:bg-hover"
              >
                <FilePlus size={15} color="#5b8def" />
                <Text className="text-[13px] font-medium text-ink">New Task</Text>
                <Mono className="ml-auto text-[10px] text-ink-3">Create session</Mono>
              </Pressable>

              <Pressable
                onPress={() => void rescanAgents()}
                disabled={busyAction !== null}
                className="flex-row items-center gap-2.5 rounded-lg px-3 py-2.5 active:bg-hover"
              >
                <RefreshCw size={15} color="#5b8def" className={busyAction === 'rescan' ? 'animate-spin' : ''} />
                <Text className="text-[13px] font-medium text-ink">
                  {busyAction === 'rescan' ? 'Re-scanning…' : 'Re-scan $PATH & Providers'}
                </Text>
                <Mono className="ml-auto text-[10px] text-ink-3">Refresh</Mono>
              </Pressable>

              {onDiscover ? (
                <Pressable
                  onPress={() => {
                    onClose()
                    onDiscover()
                  }}
                  className="flex-row items-center gap-2.5 rounded-lg px-3 py-2.5 active:bg-hover"
                >
                  <Compass size={15} color="#db6d28" />
                  <Text className="text-[13px] font-medium text-ink">Discover CLI Sessions</Text>
                  <Mono className="ml-auto text-[10px] text-ink-3">Import</Mono>
                </Pressable>
              ) : null}

              {/* Navigation Destinations */}
              <Mono className="mt-2 px-3 pb-1 pt-2 text-[9.5px] uppercase tracking-wider text-ink-3">
                Destinations
              </Mono>

              <View className="flex-row flex-wrap gap-1 px-1">
                <Pressable
                  onPress={() => navigateTo('Home')}
                  className="min-h-9 flex-row items-center gap-2 rounded-lg px-2.5 active:bg-hover"
                >
                  <Home size={14} color="#b0b0b6" />
                  <Text className="text-[12px] text-ink-2">Home</Text>
                </Pressable>
                <Pressable
                  onPress={() => navigateTo('Agents')}
                  className="min-h-9 flex-row items-center gap-2 rounded-lg px-2.5 active:bg-hover"
                >
                  <Bot size={14} color="#b0b0b6" />
                  <Text className="text-[12px] text-ink-2">Agents</Text>
                </Pressable>
                <Pressable
                  onPress={() => navigateTo('Browsers')}
                  className="min-h-9 flex-row items-center gap-2 rounded-lg px-2.5 active:bg-hover"
                >
                  <Globe size={14} color="#b0b0b6" />
                  <Text className="text-[12px] text-ink-2">Browsers</Text>
                </Pressable>
                <Pressable
                  onPress={() => navigateTo('History')}
                  className="min-h-9 flex-row items-center gap-2 rounded-lg px-2.5 active:bg-hover"
                >
                  <History size={14} color="#b0b0b6" />
                  <Text className="text-[12px] text-ink-2">History</Text>
                </Pressable>
                <Pressable
                  onPress={() => navigateTo('Usage')}
                  className="min-h-9 flex-row items-center gap-2 rounded-lg px-2.5 active:bg-hover"
                >
                  <BarChart3 size={14} color="#b0b0b6" />
                  <Text className="text-[12px] text-ink-2">Usage</Text>
                </Pressable>
                <Pressable
                  onPress={() => navigateTo('Config')}
                  className="min-h-9 flex-row items-center gap-2 rounded-lg px-2.5 active:bg-hover"
                >
                  <Settings size={14} color="#b0b0b6" />
                  <Text className="text-[12px] text-ink-2">Configuration</Text>
                </Pressable>
              </View>

              {/* Sessions */}
              <Mono className="mt-2 px-3 pb-1 pt-2 text-[9.5px] uppercase tracking-wider text-ink-3">
                Sessions ({matchingSessions.length})
              </Mono>

              {matchingSessions.length === 0 ? (
                <Text className="px-3 py-3 text-[12px] text-ink-3">No matching sessions found.</Text>
              ) : (
                matchingSessions.map((session) => (
                  <Pressable
                    key={session.id}
                    onPress={() => {
                      onClose()
                      openSession(session.id)
                    }}
                    className="flex-row items-center gap-2.5 rounded-lg px-3 py-2 active:bg-hover"
                  >
                    <View
                      className={`size-2 rounded-full ${
                        session.status === 'running'
                          ? 'bg-accent'
                          : session.status === 'error'
                            ? 'bg-red'
                            : 'bg-ink-3'
                      }`}
                    />
                    <View className="min-w-0 flex-1">
                      <Text className="text-[12.5px] text-ink font-medium" numberOfLines={1}>
                        {session.name}
                      </Text>
                      <Mono className="text-[10px] text-ink-3" numberOfLines={1}>
                        {session.agent}
                        {session.project ? ` · ${basename(session.project)}` : ''} ·{' '}
                        {relativeTime(session.updated_at)}
                      </Mono>
                    </View>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </GlassSurface>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
