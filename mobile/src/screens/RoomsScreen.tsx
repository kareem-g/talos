/**
 * Rooms — the daemon's orchestration channels, managed from the phone.
 *
 * A room is a named roster of workers plus a channel session they all report
 * into: you give a room a task and it fans out across its workers, merging the
 * answers. The desktop keeps this in a sidebar section with its own modal; on a
 * phone it is a Station destination, because a room is part of what the daemon
 * *runs* rather than a preference about this device.
 *
 * Writes go to the same handlers the desktop uses and the daemon broadcasts
 * `RoomUpsert` / `RoomDeleted` over the socket, so a room created here appears
 * in a browser looking at the same daemon without either side polling.
 *
 * The roster editor is deliberately thin: naming a room and deciding whether it
 * runs with prompts is the decision you make from a phone. Building a worker's
 * skills and avatar is desk work, and pretending otherwise would produce a
 * fiddly form nobody uses.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { MessagesSquare, Plus, Users } from 'lucide-react-native'

import { roomsApi, type RoomInfo } from '@app/lib/api'
import { palette } from '@app/design/tokens'
import { BackButton, Card, ListCard, ScreenScaffold, Section } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import { FormSheet } from '@app/components/Sheet'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconTile,
  Mono,
  ToggleRow,
  haptic,
  toast,
} from '@app/components/ui'

/** A slug the daemon will accept: lowercase, hyphenated, no spaces. */
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function RoomsScreen() {
  const navigation = useNavigation()

  const [rooms, setRooms] = React.useState<RoomInfo[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<RoomInfo | null>(null)
  const [name, setName] = React.useState('')
  const [skipPermissions, setSkipPermissions] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null)
  const [busyRemove, setBusyRemove] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      setRooms(await roomsApi.list())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load rooms')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  function openCreate() {
    setEditing(null)
    setName('')
    setSkipPermissions(false)
    setSheetOpen(true)
  }

  function openEdit(room: RoomInfo) {
    setEditing(room)
    setName(room.name)
    setSkipPermissions(!!room.skip_permissions)
    setSheetOpen(true)
  }

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      if (editing) {
        // A rename keeps the id — a room's history is keyed by it, so changing
        // it would orphan the channel. The list only carries the derived
        // identity, so the stored record is rebuilt from it; workers are
        // preserved by the daemon's opaque store, which we are not replacing.
        await roomsApi.upsert({
          id: editing.id,
          name: trimmed,
          workers: (editing.roster ?? []).map(([workerName, skills]) => ({
            name: workerName,
            skills,
          })),
          chief: editing.chief ?? null,
          skipPermissions,
        })
        toast({ message: `${trimmed} updated`, tone: 'ok' })
      } else {
        const id = slugify(trimmed)
        if (!id) {
          toast({ message: 'Give the room a name with letters or numbers', tone: 'danger' })
          setSaving(false)
          return
        }
        await roomsApi.create({ id, name: trimmed, workers: [], skipPermissions })
        toast({ message: `${trimmed} created`, tone: 'ok' })
      }
      setSheetOpen(false)
      await load()
    } catch (cause) {
      toast({
        message: editing ? 'Could not save that room' : 'Could not create that room',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setBusyRemove(id)
    try {
      await roomsApi.remove(id)
      setConfirmRemove(null)
      await load()
      toast({ message: `${id} removed`, tone: 'ok' })
    } catch (cause) {
      toast({
        message: 'Could not remove that room',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      setBusyRemove(null)
    }
  }

  return (
    <ScreenScaffold
      title="Rooms"
      eyebrow="Station · orchestration"
      subtitle="A roster of workers and the channel they report into. Give a room a task and it fans out, then merges the answers."
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      scroll
      contentClassName="gap-6 pb-12"
      headerLeft={<BackButton onPress={() => navigation.goBack()} label="Back to Station" />}
      headerRight={
        <Button
          size="sm"
          variant="primary"
          label="New"
          icon={<Plus size={15} color={palette.accentInk} strokeWidth={2.6} />}
          accessibilityLabel="Create a room"
          onPress={() => {
            void haptic('light')
            openCreate()
          }}
        />
      }
    >
      {error ? (
        <View className="mx-4">
          <ErrorState message={error} onRetry={() => void load()} retryLabel="Retry" />
        </View>
      ) : null}

      <Section
        eyebrow="Channels"
        title={rooms.length > 0 ? `${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'}` : undefined}
        enterIndex={0}
      >
        {rooms.length === 0 ? (
          <Card>
            <EmptyState
              title={loading ? 'Loading rooms' : 'No rooms yet'}
              body={
                loading
                  ? 'Asking the desktop what is configured.'
                  : 'A room fans a task out across several engines and merges what comes back.'
              }
              icon={<Users size={22} color={palette.ink3} />}
              action={loading ? null : <Button size="sm" variant="primary" label="Create a room" onPress={openCreate} />}
            />
          </Card>
        ) : (
          <ListCard inset={64}>
            {rooms.map((room, index) => (
              <RoomRow
                key={room.id}
                room={room}
                index={index}
                confirming={confirmRemove === room.id}
                busy={busyRemove === room.id}
                onEdit={() => {
                  void haptic('light')
                  openEdit(room)
                }}
                onRemove={() => {
                  void haptic('warn')
                  setConfirmRemove(room.id)
                }}
                onConfirmRemove={() => void remove(room.id)}
              />
            ))}
          </ListCard>
        )}
      </Section>

      <FormSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        eyebrow="Room"
        title={editing ? 'Edit room' : 'New room'}
        submitLabel={saving ? 'Saving…' : editing ? 'Save room' : 'Create room'}
        onSubmit={() => void save()}
        busy={saving}
        disabled={!name.trim()}
      >
        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Review squad"
          accessibilityLabel="Room name"
          hint={
            editing
              ? 'The id stays the same — a room’s history is keyed by it.'
              : 'The id is derived from this, and is what sessions refer to.'
          }
        />
        {!editing && name.trim() ? (
          <Mono className="text-[11px] text-ink-3">{`id: ${slugify(name)}`}</Mono>
        ) : null}
        <ToggleRow
          label="Run without prompts"
          description="Workers in this room act without asking for approval. Useful for a trusted roster, dangerous for anything else."
          value={skipPermissions}
          onChange={setSkipPermissions}
        />
      </FormSheet>
    </ScreenScaffold>
  )
}

/**
 * One room.
 *
 * The row leads with the roster, because that is what the daemon's list can
 * actually tell us. It carries no channel session id — that lives in the stored
 * record, which only reaches clients over `RoomUpsert` — so there is no "open
 * channel" button here rather than one that would do nothing.
 */
function RoomRow({
  room,
  index,
  confirming,
  busy,
  onEdit,
  onRemove,
  onConfirmRemove,
}: {
  room: RoomInfo
  index: number
  confirming: boolean
  busy: boolean
  onEdit: () => void
  onRemove: () => void
  onConfirmRemove: () => void
}) {
  const enter = useEnter(staggerDelay(Math.min(index, 5)), false)
  // The list carries the daemon's derived roster as tuples, not the stored
  // worker objects — counting it is the honest readout.
  const workers = room.roster?.length ?? 0
  return (
    <View style={rowEnterStyle(enter)}>
      <View className="min-h-16 flex-row items-center gap-3 px-4 py-3">
        <IconTile icon={<MessagesSquare size={16} color={palette.accent} />} tone="accent" />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-[14.5px] leading-[20px] font-medium text-ink" numberOfLines={1}>
            {room.name}
          </Text>
          <Mono className="text-[11.5px] leading-[15px]" numberOfLines={1}>
            {workers > 0 ? `${workers} ${workers === 1 ? 'worker' : 'workers'}` : 'no workers yet'}
            {room.chief ? ` · chief ${room.chief}` : ''}
          </Mono>
        </View>
        <View className="items-end gap-1">
          {room.skip_permissions ? (
            <Badge tone="danger" outline mono>
              auto
            </Badge>
          ) : null}
        </View>
        {confirming ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Confirm removing ${room.name}`}
            disabled={busy}
            onPress={onConfirmRemove}
            hitSlop={8}
            className="min-h-9 items-center justify-center rounded-sm border px-3 active:opacity-70"
            style={{
              borderColor: palette.dangerBorder,
              backgroundColor: palette.dangerSoft,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <Text className="text-[12px] leading-[16px] font-bold text-danger">
              {busy ? 'Removing…' : 'Confirm remove'}
            </Text>
          </Pressable>
        ) : (
          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${room.name}`}
              onPress={onEdit}
              hitSlop={8}
              className="min-h-9 items-center justify-center rounded-sm border border-line px-3 active:bg-raised"
            >
              <Text className="text-[12px] leading-[16px] font-semibold text-ink-2">Edit</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${room.name}`}
              onPress={onRemove}
              hitSlop={8}
              className="min-h-9 items-center justify-center rounded-sm border border-line px-3 active:bg-raised"
            >
              <Text className="text-[12px] leading-[16px] font-semibold text-danger">Remove</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  )
}