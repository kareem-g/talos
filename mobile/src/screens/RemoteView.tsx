/**
 * RemoteView — the live remote screen and its controls.
 *
 * The viewport is the product: the frame fills as much of the screen as it can,
 * with a thin chrome bar and a controls tray. Touch is mapped to a real pointer
 * (tap = click, double tap = double click, two-finger tap = right click,
 * two-finger drag = scroll, pinch = zoom, long press = configurable, and an
 * explicit Mouse mode for precise relative movement), a virtual keyboard and a
 * sticky-modifier shortcut bar drive the remote machine, and every connection
 * state has a screen of its own rather than an endless spinner.
 */

import * as React from 'react'
import { Animated, BackHandler, Image, Keyboard, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { clipboardAvailable, getClipboardString, setClipboardString } from '@/lib/clipboard'
import { RemoteSocket } from '@/lib/remoteView'
import {
  clampPan,
  computeViewport,
  fitScale,
  frameToScreenRotated,
  rotatedSize,
  screenToFrameRotated,
  scrollFromDrag,
  type Size,
} from '@/lib/touch'
import { haptic } from '@/lib/haptics'
import {
  DEFAULT_OPTIONS,
  REMOTE_STATE_LABEL,
  parseTargetKey,
  type Capabilities,
  type HostInfo,
  type InputEvent,
  type Modifiers,
  type NamedKey,
  type PermissionReport,
  type RemoteFrame,
  type RemoteServerMessage,
  type RemoteState,
  type RemoteStreamStats,
  type StreamOptions,
} from '@/types/remoteView'
import { Btn, IconBtn, Pill, Sheet, Tap, Text, touchSlop } from '../ui'
import { color } from '../design/tokens'
import { ChevronLeft, Close } from '../design/icons'

const QUALITY_PRESETS: Array<{ id: string; label: string; options: StreamOptions }> = [
  { id: 'low', label: 'Data saver', options: { ...DEFAULT_OPTIONS, max_width: 960, quality: 55, max_fps: 15 } },
  { id: 'medium', label: 'Balanced', options: { ...DEFAULT_OPTIONS, max_width: 1440, quality: 68, max_fps: 22 } },
  { id: 'high', label: 'Sharp', options: { ...DEFAULT_OPTIONS, max_width: 1920, quality: 80, max_fps: 30 } },
]

type LongPressAction = 'drag' | 'right_click'

export function RemoteViewScreen({ route, navigation }: { route: { params: { targetKey: string; label: string } }; navigation: { goBack: () => void } }) {
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  const target = React.useMemo(() => parseTargetKey(route.params.targetKey), [route.params.targetKey])

  const [frame, setFrame] = React.useState<RemoteFrame | null>(null)
  /** A short-lived marker at the last tap, so touch has feedback without a
   *  fake pointer being drawn over the remote desktop. */
  const [ripple, setRipple] = React.useState<{ x: number; y: number; key: number } | null>(null)
  const rippleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [stats, setStats] = React.useState<RemoteStreamStats | null>(null)
  const [state, setState] = React.useState<RemoteState>('connecting')
  const [detail, setDetail] = React.useState<string | undefined>(undefined)
  /** The latest non-fatal stream error, shown so a black screen is never silent. */
  const [streamNotice, setStreamNotice] = React.useState<string | null>(null)
  const [capabilities, setCapabilities] = React.useState<Capabilities | null>(null)
  const [permissions, setPermissions] = React.useState<PermissionReport | null>(null)
  const [host, setHost] = React.useState<HostInfo | null>(null)
  const [qualityId, setQualityId] = React.useState('medium')
  const [qualityOpen, setQualityOpen] = React.useState(false)
  const [clipboardOpen, setClipboardOpen] = React.useState(false)
  const [clipboardText, setClipboardText] = React.useState('')

  const [zoom, setZoom] = React.useState(1)
  const [pan, setPan] = React.useState({ x: 0, y: 0 })
  /** 0 | 90 | 180 | 270 — how the remote picture is turned on the phone. */
  const [rotation, setRotation] = React.useState(0)
  const [mouseMode, setMouseMode] = React.useState(false)
  const [dragOn, setDragOn] = React.useState(false)
  const [keyboardOpen, setKeyboardOpen] = React.useState(false)
  const [mods, setMods] = React.useState<Modifiers>({ ctrl: false, alt: false, shift: false, meta: false })
  const [longPressAction, setLongPressAction] = React.useState<LongPressAction>('drag')

  // Refs mirror the render state so gesture callbacks never read a stale value.
  const socketRef = React.useRef<RemoteSocket | null>(null)
  const frameSizeRef = React.useRef<Size>({ width: 0, height: 0 })
  const viewportRef = React.useRef<Size>({ width: 0, height: 0 })
  const zoomRef = React.useRef(1)
  const panRef = React.useRef({ x: 0, y: 0 })
  const rotationRef = React.useRef(0)
  const modsRef = React.useRef(mods)
  const mouseModeRef = React.useRef(mouseMode)
  const dragRef = React.useRef(dragOn)
  const longPressRef = React.useRef(longPressAction)
  const pinchBaseRef = React.useRef(1)
  const lastScrollRef = React.useRef(0)

  React.useEffect(() => void (zoomRef.current = zoom), [zoom])
  React.useEffect(() => void (panRef.current = pan), [pan])
  React.useEffect(() => void (rotationRef.current = rotation), [rotation])
  React.useEffect(() => void (modsRef.current = mods), [mods])
  React.useEffect(() => void (mouseModeRef.current = mouseMode), [mouseMode])
  React.useEffect(() => void (dragRef.current = dragOn), [dragOn])
  React.useEffect(() => void (longPressRef.current = longPressAction), [longPressAction])

  /* ── Keyboard ─────────────────────────────────────────────────────────── */

  const keyInputRef = React.useRef<TextInput>(null)

  /**
   * Close the on-screen keyboard for real. The remote keyboard is drawn by the
   * OS over the bottom bar, so both the toggle and the close control have to be
   * reachable above it — and the hardware back gesture must dismiss it rather
   * than leaving the viewer, which is how it previously got stuck open.
   */
  const closeKeyboard = React.useCallback(() => {
    setKeyboardOpen(false)
    keyInputRef.current?.blur()
    Keyboard.dismiss()
  }, [])

  React.useEffect(() => {
    if (!keyboardOpen) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeKeyboard()
      return true
    })
    return () => subscription.remove()
  }, [keyboardOpen, closeKeyboard])

  const send = React.useCallback((event: InputEvent) => {
    socketRef.current?.input(event)
  }, [])

  /** Touch feedback at the point that was touched. */
  const showRipple = React.useCallback((x: number, y: number) => {
    if (rippleTimer.current) clearTimeout(rippleTimer.current)
    setRipple({ x, y, key: Date.now() })
    rippleTimer.current = setTimeout(() => setRipple(null), 420)
  }, [])

  React.useEffect(
    () => () => {
      if (rippleTimer.current) clearTimeout(rippleTimer.current)
    },
    [],
  )

  const currentViewport = React.useCallback(() => {
    return computeViewport(
      viewportRef.current,
      rotatedSize(frameSizeRef.current, rotationRef.current),
      zoomRef.current,
      panRef.current.x,
      panRef.current.y,
    )
  }, [])

  /** Keep the remote pointer in view when zoomed: nudge the pan only when the
   *  pointer's drawn position drifts near an edge. Rotation-aware, so a turned
   *  picture still follows the pointer. */
  const focusOn = React.useCallback((fx: number, fy: number) => {
    const frameSize = frameSizeRef.current
    const container = viewportRef.current
    if (zoomRef.current <= 1 || frameSize.width === 0) return
    const rotation = rotationRef.current
    const point = frameToScreenRotated(
      container,
      frameSize,
      rotation,
      zoomRef.current,
      panRef.current.x,
      panRef.current.y,
      fx,
      fy,
    )
    const marginX = container.width * 0.22
    const marginY = container.height * 0.22
    let dx = 0
    let dy = 0
    if (point.x < marginX) dx = marginX - point.x
    else if (point.x > container.width - marginX) dx = container.width - marginX - point.x
    if (point.y < marginY) dy = marginY - point.y
    else if (point.y > container.height - marginY) dy = container.height - marginY - point.y
    if (dx === 0 && dy === 0) return
    const nextX = panRef.current.x + dx
    const nextY = panRef.current.y + dy
    setPan(
      clampPan(
        computeViewport(container, rotatedSize(frameSize, rotation), zoomRef.current, nextX, nextY),
        nextX,
        nextY,
      ),
    )
  }, [])

  const moveTo = React.useCallback(
    (screenX: number, screenY: number) => {
      const point = screenToFrameRotated(
        viewportRef.current,
        frameSizeRef.current,
        rotationRef.current,
        zoomRef.current,
        panRef.current.x,
        panRef.current.y,
        screenX,
        screenY,
      )
      send({ kind: 'pointer_move', x: point.x, y: point.y })
      focusOn(point.x, point.y)
      return point
    },
    [focusOn, send],
  )

  /* ── Socket lifecycle ─────────────────────────────────────────────────── */

  React.useEffect(() => {
    const socket = new RemoteSocket({
      onFrame: (next) => {
        frameSizeRef.current = { width: next.width, height: next.height }
        setFrame(next)
      },
      onMessage: (message: RemoteServerMessage) => {
        switch (message.type) {
          case 'Ready':
            setHost(message.payload.host)
            setCapabilities(message.payload.capabilities)
            setPermissions(message.payload.permissions)
            break
          case 'Cursor':
            // The remote cursor is drawn by the machine itself (embedded in the
            // Wayland stream, composited into X11 frames), so the phone does not
            // paint a second one on top.
            break
          case 'StreamStats':
            setStats(message.payload)
            break
          case 'Clipboard':
            setClipboardText(message.payload.text)
            setClipboardOpen(true)
            break
          case 'PermissionRequired':
            setPermissions(message.payload.permissions)
            setDetail(message.payload.message)
            break
          case 'Error':
            // Non-fatal stream errors (the capture pipeline failing, a stream
            // ending) would otherwise leave a connected-but-black screen with no
            // explanation. Show them.
            if (!message.payload.fatal) {
              setStreamNotice(`${message.payload.code}: ${message.payload.message}`)
            }
            break
          case 'State':
            break
          default:
            break
        }
      },
      onState: (nextState, nextDetail) => {
        setState(nextState)
        setDetail(nextDetail)
      },
    })
    socketRef.current = socket
    socket.connect(target, QUALITY_PRESETS.find((preset) => preset.id === qualityId)?.options ?? DEFAULT_OPTIONS)
    return () => {
      socket.close()
      socketRef.current = null
    }
    // Reconnect only when the target changes; quality changes ride the socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const applyQuality = React.useCallback((id: string) => {
    setQualityId(id)
    const preset = QUALITY_PRESETS.find((entry) => entry.id === id)
    if (preset) socketRef.current?.setQuality(preset.options)
    setQualityOpen(false)
  }, [])

  /* ── Gestures ─────────────────────────────────────────────────────────── */

  const gestures = React.useMemo(() => {
    // Every gesture runs its callbacks on the JS thread. React Native Gesture
    // Handler auto-workletizes callbacks when Reanimated is installed, and these
    // callbacks call JS functions (`send`, `setState`) and mutate refs — all of
    // which are illegal from a worklet. On Android that is a warning; on iOS it
    // is a hard crash the moment the viewer mounts. `runOnJS(true)` keeps them
    // where they belong.
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        pinchBaseRef.current = zoomRef.current
      })
      .onUpdate((event) => {
        const next = Math.max(1, Math.min(6, pinchBaseRef.current * event.scale))
        zoomRef.current = next
        setZoom(next)
      })

    // Two fingers drag → scroll the remote content.
    const scrollPan = Gesture.Pan()
      .runOnJS(true)
      .minPointers(2)
      .maxPointers(2)
      .onChange((event) => {
        const now = Date.now()
        if (now - lastScrollRef.current < 16) return
        lastScrollRef.current = now
        const delta = scrollFromDrag(event.changeX, event.changeY)
        send({ kind: 'scroll', dx: delta.dx * 1.4, dy: delta.dy * 1.4 })
      })

    // One finger → move the pointer (touch mode) or the local pointer
    // relatively (mouse mode). In drag mode the left button is held.
    const movePan = Gesture.Pan()
      .runOnJS(true)
      .minPointers(1)
      .maxPointers(1)
      .minDistance(1)
      .onChange((event) => {
        if (mouseModeRef.current) {
          const scale = currentViewport().scale || 1
          send({ kind: 'pointer_move_relative', dx: event.changeX / scale, dy: event.changeY / scale })
          return
        }
        moveTo(event.x, event.y)
      })
      .onEnd(() => {
        if (dragRef.current && !mouseModeRef.current) {
          send({ kind: 'button_up', button: 'left' })
          setDragOn(false)
        }
      })

    const singleTap = Gesture.Tap()
      .runOnJS(true)
      .maxDuration(250)
      .maxDistance(12)
      .onEnd((event) => {
        void haptic('light')
        showRipple(event.x, event.y)
        if (mouseModeRef.current) {
          send({ kind: 'click', button: 'left', count: 1 })
          return
        }
        moveTo(event.x, event.y)
        send({ kind: 'click', button: 'left', count: 1 })
      })

    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .maxDuration(260)
      .maxDistance(16)
      .onEnd((event) => {
        void haptic('light')
        showRipple(event.x, event.y)
        if (!mouseModeRef.current) moveTo(event.x, event.y)
        send({ kind: 'click', button: 'left', count: 2 })
      })

    const longPress = Gesture.LongPress()
      .runOnJS(true)
      .minDuration(420)
      .onStart((event) => {
        void haptic('select')
        if (longPressRef.current === 'right_click') {
          if (!mouseModeRef.current) moveTo(event.x, event.y)
          send({ kind: 'click', button: 'right', count: 1 })
          return
        }
        // Drag: press the left button and hold it until the next pan ends.
        if (!mouseModeRef.current) moveTo(event.x, event.y)
        send({ kind: 'button_down', button: 'left' })
        setDragOn(true)
      })

    return Gesture.Simultaneous(
      pinch,
      scrollPan,
      Gesture.Race(movePan, Gesture.Exclusive(doubleTap, singleTap), longPress),
    )
  }, [currentViewport, moveTo, send, showRipple])

  /* ── Keyboard helpers ─────────────────────────────────────────────────── */

  const pressKey = React.useCallback((key: NamedKey, extra?: Partial<Modifiers>) => {
    const modifiers: Modifiers = { ...modsRef.current, ...extra }
    send({ kind: 'key_down', key, modifiers })
    send({ kind: 'key_up', key })
  }, [send])

  const chord = React.useCallback((key: string, modifiers: Modifiers) => {
    socketRef.current?.input({ kind: 'chord', key, modifiers })
  }, [])

  const toggleMod = React.useCallback((name: keyof Modifiers) => {
    void haptic('select')
    setMods((current) => ({ ...current, [name]: !current[name] }))
  }, [])

  /* ── Render ───────────────────────────────────────────────────────────── */

  const viewportSize = { width: window.width, height: window.height }
  viewportRef.current = viewportSize
  const frameSize: Size = frame ? { width: frame.width, height: frame.height } : { width: 0, height: 0 }
  const viewport = computeViewport(viewportSize, rotatedSize(frameSize, rotation), zoom, pan.x, pan.y)
  const zoomed = zoom > 1.01

  const qualityOptions = React.useMemo(
    () => QUALITY_PRESETS.find((preset) => preset.id === qualityId)?.options ?? DEFAULT_OPTIONS,
    [qualityId],
  )

  const statePillTone = state === 'connected' ? 'green' : state === 'connecting' || state === 'reconnecting' ? 'orange' : state === 'permission_required' ? 'orange' : 'red'

  return (
    <View style={styles.root}>
      <GestureDetector gesture={gestures}>
        <View
          style={StyleSheet.absoluteFill}
          onLayout={(event) => {
            viewportRef.current = {
              width: event.nativeEvent.layout.width,
              height: event.nativeEvent.layout.height,
            }
          }}
        >
          <FrameSurface
            data={frame?.data ?? null}
            left={viewport.offsetX}
            top={viewport.offsetY}
            width={viewport.drawWidth}
            height={viewport.drawHeight}
            rotation={rotation}
            scale={viewport.scale}
            frameWidth={frameSize.width}
            frameHeight={frameSize.height}
          />

          {ripple ? (
            <TouchRipple key={ripple.key} x={ripple.x} y={ripple.y} />
          ) : null}
        </View>
      </GestureDetector>

      {/* Top chrome */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <IconBtn label="Back" onPress={() => { socketRef.current?.stop(); navigation.goBack() }}>
          <ChevronLeft size={20} color={color.ink} stroke={2.2} />
        </IconBtn>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-ink" numberOfLines={1}>
            {route.params.label}
          </Text>
          <View className="mt-0.5 flex-row items-center gap-1.5">
            <Pill label={REMOTE_STATE_LABEL[state]} tone={statePillTone} pulse={state === 'connecting' || state === 'reconnecting'} />
            {stats ? (
              <Text className="text-[11px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
                {Math.round(stats.fps)} fps · {Math.round(stats.kbps)} kbps
              </Text>
            ) : null}
            {host ? <Text className="text-[11px] text-ink-3">{host.session_label}</Text> : null}
          </View>
        </View>
        <IconBtn label="Quality" onPress={() => setQualityOpen(true)}>
          <Text className="text-[11px] font-semibold text-ink-2">{zoomed ? `${zoom.toFixed(1)}×` : 'Fit'}</Text>
        </IconBtn>
        {/* Keyboard close lives in the top bar: the on-screen keyboard covers the
            bottom controls, so a close button down there can be unreachable. */}
        {keyboardOpen ? (
          <IconBtn label="Close keyboard" onPress={closeKeyboard}>
            <Close size={18} color={color.ink} />
          </IconBtn>
        ) : null}
      </View>

      {/* A connected-but-silent stream (a capture that keeps failing) must not
          look like a plain black screen. */}
      {streamNotice && state === 'connected' ? (
        <View style={[styles.streamNotice, { top: insets.top + 58 }]}>
          <Text className="min-w-0 flex-1 text-[11.5px] leading-[16px] text-ink-2" numberOfLines={3}>
            {streamNotice}
          </Text>
          <Tap accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => setStreamNotice(null)} hitSlop={8} className="p-1">
            <Close size={13} color={color.ink3} />
          </Tap>
        </View>
      ) : null}

      {/* Non-connected states get a real explanation and an action. */}
      {state !== 'connected' ? (
        <StateOverlay
          state={state}
          detail={detail}
          permissions={permissions}
          onRetry={() => socketRef.current?.retry(target, qualityOptions)}
          onBack={() => navigation.goBack()}
        />
      ) : null}

      {/* Bottom controls */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {mouseMode ? (
          <View className="mb-2 flex-row items-center justify-center gap-2">
            <Btn size="sm" kind="plate" label="L" onPress={() => send({ kind: 'click', button: 'left', count: 1 })} />
            <Btn size="sm" kind="plate" label="M" onPress={() => send({ kind: 'click', button: 'middle', count: 1 })} />
            <Btn size="sm" kind="plate" label="R" onPress={() => send({ kind: 'click', button: 'right', count: 1 })} />
            <Btn
              size="sm"
              kind={dragOn ? 'primary' : 'plate'}
              label="Drag"
              onPress={() => {
                const next = !dragOn
                setDragOn(next)
                send({ kind: next ? 'button_down' : 'button_up', button: 'left' })
              }}
            />
          </View>
        ) : null}

        <View className="flex-row items-center justify-center gap-2">
          <Btn size="sm" kind={mouseMode ? 'primary' : 'plate'} label="Mouse" onPress={() => { void haptic('select'); setMouseMode((value) => !value) }} />
          <Btn size="sm" kind={keyboardOpen ? 'primary' : 'plate'} label="Keyboard" onPress={() => { void haptic('select'); if (keyboardOpen) closeKeyboard(); else setKeyboardOpen(true) }} />
          <Btn size="sm" kind="plate" label={zoomed ? 'Fit' : '1:1'} onPress={() => { void haptic('select'); setZoom(zoomed ? 1 : Math.min(6, 1 / (fitScale(viewportSize, rotatedSize(frameSize, rotation)) || 1))); setPan({ x: 0, y: 0 }) }} />
          <Btn
            size="sm"
            kind={rotation !== 0 ? 'primary' : 'plate'}
            label={`${rotation}°`}
            onPress={() => {
              void haptic('select')
              setRotation((value) => (value + 90) % 360)
            }}
          />
          <Btn size="sm" kind="plate" label="Edit" onPress={() => { void haptic('select'); setLongPressAction((value) => (value === 'drag' ? 'right_click' : 'drag')) }} />
          <Btn size="sm" kind="plate" label="Clip" onPress={() => { socketRef.current?.clipboardGet(); setClipboardOpen(true) }} />
        </View>

        {keyboardOpen ? (
          <ShortcutBar mods={mods} onToggleMod={toggleMod} onKey={pressKey} onChord={chord} />
        ) : null}

        {keyboardOpen ? (
          <View className="mt-2 flex-row items-center gap-2 rounded-[12px] bg-field px-3">
            <TextInput
              ref={keyInputRef}
              autoFocus
              value=""
              onChangeText={(text) => {
                if (text) send({ kind: 'text', text })
              }}
              onKeyPress={(event) => {
                const key = event.nativeEvent.key
                if (key === 'Backspace') pressKey('backspace')
                else if (key === 'Enter') pressKey('enter')
                else if (key === 'Tab') pressKey('tab')
              }}
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              blurOnSubmit={false}
              placeholder="Type on the computer…"
              placeholderTextColor={color.ink3}
              className="h-10 min-w-0 flex-1 text-[15px] text-ink"
              style={{ paddingVertical: 0 }}
            />
            <Tap accessibilityRole="button" accessibilityLabel="Close keyboard" hitSlop={touchSlop(30)} onPress={closeKeyboard} className="p-1">
              <Close size={16} color={color.ink3} />
            </Tap>
          </View>
        ) : null}
      </View>

      <Sheet open={qualityOpen} onClose={() => setQualityOpen(false)} title="Stream quality">
        <View className="px-4 pt-1">
          {QUALITY_PRESETS.map((preset) => (
            <Tap
              key={preset.id}
              accessibilityRole="button"
              accessibilityState={{ selected: preset.id === qualityId }}
              onPress={() => applyQuality(preset.id)}
              className={`mb-2 flex-row items-center justify-between rounded-[12px] px-4 py-3 ${preset.id === qualityId ? 'bg-accent-tint' : 'bg-card'}`}
            >
              <View>
                <Text className="text-[15px] text-ink">{preset.label}</Text>
                <Text className="mt-0.5 text-[12.5px] text-ink-2">
                  up to {preset.options.max_width}px · {preset.options.quality}% · {preset.options.max_fps}fps
                </Text>
              </View>
              {preset.id === qualityId ? <Text className="text-[13px] font-semibold text-accent">On</Text> : null}
            </Tap>
          ))}
          {capabilities ? (
            <Text className="mt-2 text-[12px] leading-[17px] text-ink-3">
              {capabilities.platform === 'macos' ? 'macOS' : 'Linux'} · {capabilities.codecs.join(', ')}
              {capabilities.hardware_encode ? ' · hardware encode' : ''}
            </Text>
          ) : null}
        </View>
      </Sheet>

      <Sheet
        open={clipboardOpen}
        onClose={() => setClipboardOpen(false)}
        title="Clipboard"
        foot={
          <View className="gap-2">
            <Btn
              kind="primary"
              wide
              label="Copy to phone"
              onPress={() => {
                setClipboardString(clipboardText)
                setClipboardOpen(false)
              }}
            />
            <Btn
              kind="plate"
              wide
              label="Paste from phone"
              onPress={() => {
                void getClipboardString().then((value) => {
                  if (value != null) socketRef.current?.clipboardSet(value)
                  setClipboardOpen(false)
                })
              }}
            />
          </View>
        }
      >
        <View className="px-4 py-3">
          <Text className="text-[12.5px] leading-[18px] text-ink-2">
            {clipboardText || 'Nothing on the computer’s clipboard yet. Use “Paste from phone” to send this phone’s clipboard over.'}
          </Text>
          {!clipboardAvailable() ? (
            <Text className="mt-2 text-[12px] leading-[17px] text-ink-3">
              This phone’s clipboard is not available in Expo Go — copy and paste work in a development build of the app.
            </Text>
          ) : null}
        </View>
      </Sheet>
    </View>
  )
}

/* ── Frame surface — double-buffered, so the picture never blinks ─────────── */

/**
 * Draws the live frame from two alternating layers.
 *
 * React Native's `Image` clears to nothing while it decodes a new `source`, and
 * the viewer changes its source every frame — so a single image visibly blinks
 * between frames (worse the lower the frame rate on a slow link). Two layers are
 * kept instead: the new frame is decoded on the hidden one and only swapped in
 * when it has actually loaded, so the previous frame stays on screen throughout.
 */
function FrameSurface({
  data,
  left,
  top,
  width,
  height,
  rotation,
  scale,
  frameWidth,
  frameHeight,
}: {
  data: string | null
  left: number
  top: number
  width: number
  height: number
  rotation: number
  scale: number
  frameWidth: number
  frameHeight: number
}) {
  const [buffers, setBuffers] = React.useState<{ a: string | null; b: string | null }>({ a: null, b: null })
  const [front, setFront] = React.useState<'a' | 'b'>('a')
  const frontRef = React.useRef<'a' | 'b'>('a')
  const lastRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!data) return
    const uri = `data:image/jpeg;base64,${data}`
    if (uri === lastRef.current) return
    lastRef.current = uri
    const back: 'a' | 'b' = frontRef.current === 'a' ? 'b' : 'a'
    setBuffers((previous) => ({ ...previous, [back]: uri }))
  }, [data])

  const commit = (slot: 'a' | 'b') => () => {
    if (frontRef.current === slot) return
    frontRef.current = slot
    setFront(slot)
  }

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left, top, width, height, overflow: 'hidden' }}>
      {(['a', 'b'] as const).map((slot) => {
        const source = buffers[slot]
        if (!source) return null
        return (
          <Image
            key={slot}
            source={{ uri: source }}
            style={[
              {
                position: 'absolute',
                // The image is the frame at its own aspect and scale, centred in
                // the (possibly rotated) box, then turned about that centre — so
                // a 90° turn lands exactly in a box of swapped dimensions.
                width: frameWidth * scale,
                height: frameHeight * scale,
                left: (width - frameWidth * scale) / 2,
                top: (height - frameHeight * scale) / 2,
                transform: [{ rotate: `${rotation}deg` }],
              },
              front === slot ? null : styles.frameHidden,
            ]}
            resizeMode="stretch"
            fadeDuration={0}
            onLoad={commit(slot)}
          />
        )
      })}
    </View>
  )
}

/* ── Touch ripple ─────────────────────────────────────────────────────────── */

/**
 * A ring where the finger landed, fading out.
 *
 * Native touch feedback instead of a synthetic pointer: the remote cursor is
 * drawn by the machine itself, so the phone only shows that it registered the
 * touch.
 */
function TouchRipple({ x, y }: { x: number; y: number }) {
  const progress = React.useRef(new Animated.Value(0)).current
  React.useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 420, useNativeDriver: true }).start()
  }, [progress])
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.35] })
  const opacity = progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 0] })
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ripple, { left: x - 22, top: y - 22, opacity, transform: [{ scale }] }]}
    />
  )
}

/* ── Shortcut bar ─────────────────────────────────────────────────────────── */

function ShortcutBar({
  mods,
  onToggleMod,
  onKey,
  onChord,
}: {
  mods: Modifiers
  onToggleMod: (name: keyof Modifiers) => void
  onKey: (key: NamedKey, extra?: Partial<Modifiers>) => void
  onChord: (key: string, modifiers: Modifiers) => void
}) {
  const modEntries: Array<{ name: keyof Modifiers; label: string }> = [
    { name: 'ctrl', label: 'CTRL' },
    { name: 'alt', label: 'ALT' },
    { name: 'shift', label: 'SHIFT' },
    { name: 'meta', label: 'CMD' },
  ]
  return (
    <View className="mt-2">
      <View className="flex-row flex-wrap items-center justify-center gap-1.5">
        {modEntries.map((entry) => (
          <Chip key={entry.name} label={entry.label} on={mods[entry.name]} onPress={() => onToggleMod(entry.name)} />
        ))}
        <Chip label="ESC" on={false} onPress={() => onKey('escape')} />
        <Chip label="TAB" on={false} onPress={() => onKey('tab')} />
        <Chip label="↑" on={false} onPress={() => onKey('arrow_up')} />
        <Chip label="↓" on={false} onPress={() => onKey('arrow_down')} />
        <Chip label="←" on={false} onPress={() => onKey('arrow_left')} />
        <Chip label="→" on={false} onPress={() => onKey('arrow_right')} />
      </View>
      <View className="mt-1.5 flex-row flex-wrap items-center justify-center gap-1.5">
        <Chip label="CTRL+C" on={false} onPress={() => onChord('c', { ctrl: true, alt: false, shift: false, meta: false })} />
        <Chip label="CTRL+V" on={false} onPress={() => onChord('v', { ctrl: true, alt: false, shift: false, meta: false })} />
        <Chip label="CTRL+Z" on={false} onPress={() => onChord('z', { ctrl: true, alt: false, shift: false, meta: false })} />
        <Chip label="⌘C" on={false} onPress={() => onChord('c', { ctrl: false, alt: false, shift: false, meta: true })} />
        <Chip label="⌘V" on={false} onPress={() => onChord('v', { ctrl: false, alt: false, shift: false, meta: true })} />
        <Chip label="⌘Z" on={false} onPress={() => onChord('z', { ctrl: false, alt: false, shift: false, meta: true })} />
      </View>
    </View>
  )
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Tap
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={() => {
        void haptic('select')
        onPress()
      }}
      hitSlop={8}
      className={`h-[30px] items-center justify-center rounded-pill px-3 ${on ? 'bg-accent' : 'bg-field'}`}
    >
      <Text className={`text-[12px] font-semibold ${on ? 'text-accent-ink' : 'text-ink-2'}`}>{label}</Text>
    </Tap>
  )
}

/* ── State overlay ────────────────────────────────────────────────────────── */

function StateOverlay({
  state,
  detail,
  permissions,
  onRetry,
  onBack,
}: {
  state: RemoteState
  detail?: string
  permissions: PermissionReport | null
  onRetry: () => void
  onBack: () => void
}) {
  const copy: Record<RemoteState, { title: string; body: string; action?: string }> = {
    idle: { title: 'Not connected', body: 'Start a session to view this screen.', action: 'Connect' },
    connecting: { title: 'Connecting', body: 'Reaching the computer and starting the stream…' },
    connected: { title: '', body: '' },
    reconnecting: { title: 'Reconnecting', body: 'The connection dropped. Rejoining the session…' },
    disconnected: { title: 'Disconnected', body: 'The session ended. Reconnect to continue.', action: 'Reconnect' },
    permission_required: {
      title: 'Permission required',
      body: detail ?? permissions?.message ?? 'This computer needs permission before it can be shared.',
      action: 'Retry',
    },
    unauthorized: { title: 'Unauthorized', body: detail ?? 'This device is no longer paired.', action: 'Back' },
    unsupported: { title: 'Unsupported platform', body: detail ?? 'This computer cannot be shared with the current setup.' },
    error: { title: 'Something went wrong', body: detail ?? 'The remote session failed.', action: 'Retry' },
  }
  const entry = copy[state]
  if (!entry.title) return null
  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View className="mx-6 max-w-[360px] items-center gap-2 rounded-[18px] bg-card px-6 py-6">
        <Text className="text-center text-[17px] font-semibold text-ink">{entry.title}</Text>
        <Text className="text-center text-[13px] leading-[19px] text-ink-2">{entry.body}</Text>
        {state === 'connecting' || state === 'reconnecting' ? (
          <View className="mt-1 flex-row items-center gap-1.5">
            {[0, 1, 2].map((index) => (
              <View key={index} className="size-[6px] rounded-full bg-ink-3" />
            ))}
          </View>
        ) : null}
        {permissions?.settings_hint ? (
          <Text className="mt-1 text-center text-[12px] leading-[17px] text-ink-3">{permissions.settings_hint}</Text>
        ) : null}
        {entry.action ? (
          <View className="mt-2 flex-row gap-2">
            {state === 'unauthorized' ? (
              <Btn kind="plate" label="Back" onPress={onBack} />
            ) : (
              <Btn kind="primary" label={entry.action} onPress={onRetry} />
            )}
            <Btn kind="plate" label="Close" onPress={onBack} />
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingBottom: 8,
    backgroundColor: 'rgba(10, 10, 12, 0.86)',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: 'rgba(10, 10, 12, 0.86)',
  },
  streamNotice: {
    position: 'absolute',
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(90, 62, 8, 0.94)',
  },
  ripple: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: color.accent,
    backgroundColor: 'rgba(10, 132, 255, 0.18)',
  },
  /** The back buffer: decoded but not yet swapped to the front. */
  frameHidden: { opacity: 0 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
})