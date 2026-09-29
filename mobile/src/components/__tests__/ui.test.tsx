/**
 * The primitives, tested as the user meets them.
 *
 * The redesign's whole claim is that a screen can be built from these and get
 * 44pt targets, correct roles, and token colours for free. That claim is only
 * worth anything if it is checked, so these assert the three things a
 * regression would actually break:
 *
 *   1. Every interactive primitive exposes an accessible name and role.
 *   2. Small controls still get a full-size touch target via hitSlop.
 *   3. Tone colour is never the only channel — a state always carries a word.
 *
 * Rendered with `react-test-renderer`, not @testing-library/react-native: RNTL
 * 14 ships both `src/` and `dist/`, and under jest-expo a test file resolves one
 * copy while the library's own imports resolve the other, which leaves its
 * `screen` singleton unwired. This is the constraint documented in
 * `chat/__tests__/prose.test.tsx`; the helpers below are the same idea applied
 * to a component tree instead of a markdown string.
 */

import * as React from 'react'
import { Text, View } from 'react-native'
import TestRenderer from 'react-test-renderer'
import type { ReactTestInstance } from 'react-test-renderer'

import {
  Badge,
  Button,
  Card,
  Dot,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Loading,
  Row,
  ScreenHeader,
  Segmented,
  StatusPill,
  ToggleRow,
  TOUCH_MIN,
  compatTone,
  haptic,
  palette,
} from '@app/components/ui'
import { toneColor } from '@app/design/tokens'

/* ── Tree helpers ─────────────────────────────────────────────────────────── */

function render(element: React.ReactElement): ReactTestInstance {
  let tree!: TestRenderer.ReactTestRenderer
  TestRenderer.act(() => {
    tree = TestRenderer.create(element)
  })
  return tree.root
}

/**
 * Host nodes matching a predicate.
 *
 * `react-test-renderer` exposes each element twice — once as the composite
 * component and once as the host view. State that reaches the platform
 * (accessibilityState, the rendered style) is asserted on the host, because
 * that is what a device actually sees.
 */
function hosts(root: ReactTestInstance, predicate: (node: ReactTestInstance) => boolean) {
  return root.findAll((node) => typeof node.type === 'string' && predicate(node), { deep: true })
}

/**
 * The node that owns a press handler for a given accessible name.
 *
 * Handlers live on the composite, not the host, so this is what `press` needs.
 * `findAll` returns a parent before its children, so the composite matches
 * first.
 */
function pressable(root: ReactTestInstance, label: string): ReactTestInstance {
  const node = root.findAll(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function',
    { deep: true },
  )[0]
  if (!node) throw new Error(`no pressable labelled ${JSON.stringify(label)}`)
  return node
}

/** Concatenate all text rendered in the tree. */
function textOf(node: ReactTestInstance): string {
  let collected = ''
  const walk = (current: ReactTestInstance | string): void => {
    if (typeof current === 'string') {
      collected += current
      return
    }
    for (const child of current.children) walk(child as ReactTestInstance | string)
  }
  walk(node)
  return collected
}

function press(node: ReactTestInstance) {
  TestRenderer.act(() => {
    node.props.onPress?.()
  })
}

/* ── Buttons ──────────────────────────────────────────────────────────────── */

describe('Button', () => {
  it('names itself for a screen reader', () => {
    const root = render(<Button label="Archive" accessibilityLabel="Archive this session" onPress={() => {}} />)
    expect(pressable(root, 'Archive this session')).toBeDefined()
  })

  it('defaults the accessible name to the visible label', () => {
    const root = render(<Button label="Resume" onPress={() => {}} />)
    expect(pressable(root, 'Resume')).toBeDefined()
  })

  it('is marked disabled for assistive tech', () => {
    // `react-test-renderer` cannot synthesise a real press, and a disabled
    // Pressable's own guard is exactly what we want to trust here rather than
    // re-test. What is asserted is the contract the user perceives: the control
    // reports itself as disabled, so VoiceOver announces it as unavailable
    // instead of offering an action that does nothing.
    const root = render(<Button label="Send" onPress={() => {}} disabled />)
    const button = hosts(root, (n) => n.props?.accessibilityRole === 'button')[0]
    expect(button.props.accessibilityState).toMatchObject({ disabled: true })
  })

  it('fires onPress when enabled', () => {
    const onPress = jest.fn()
    const root = render(<Button label="Approve" onPress={onPress} />)
    press(pressable(root, 'Approve'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})

/* ── Touch targets ────────────────────────────────────────────────────────── */

describe('IconButton', () => {
  it('is reachable by label', () => {
    const root = render(
      <IconButton label="Star this session" onPress={() => {}}>
        <Text>*</Text>
      </IconButton>,
    )
    expect(pressable(root, 'Star this session')).toBeDefined()
  })

  it('grows a small control to a full-size touch target', () => {
    // The point of hitSlop: a 36pt star is right visually and wrong as a tap
    // target. The slop has to make up the difference to TOUCH_MIN.
    const root = render(
      <IconButton label="Star" size={36} onPress={() => {}}>
        <Text>*</Text>
      </IconButton>,
    )
    const slop = pressable(root, 'Star').props.hitSlop
    expect(slop).toBeDefined()
    expect(36 + slop.left + slop.right).toBeGreaterThanOrEqual(TOUCH_MIN)
    expect(36 + slop.top + slop.bottom).toBeGreaterThanOrEqual(TOUCH_MIN)
  })

  it('does not shrink a control that is already large enough', () => {
    const root = render(
      <IconButton label="Star" size={56} onPress={() => {}}>
        <Text>*</Text>
      </IconButton>,
    )
    const slop = pressable(root, 'Star').props.hitSlop
    expect(slop.left).toBe(0)
  })
})

/* ── Status: colour is never the only channel ─────────────────────────────── */

describe('status is never conveyed by colour alone', () => {
  it('StatusPill pairs its dot with a word', () => {
    const root = render(<StatusPill tone="wait" label="Needs approval" />)
    expect(textOf(root)).toContain('Needs approval')
  })

  it('StatusPill announces the state explicitly', () => {
    const root = render(<StatusPill tone="danger" label="Failed" />)
    expect(hosts(root, (n) => n.props?.accessibilityLabel === 'Status: Failed').length).toBeGreaterThan(0)
  })

  it('draws the states that need a human larger than the states that do not', () => {
    // `wait`/`danger` are drawn bigger so they are findable while scrolling —
    // a second, non-colour channel for the most important distinction.
    const widthOf = (tone: 'ok' | 'wait' | 'danger' | 'info' | 'muted'): number => {
      const root = render(<Dot tone={tone} />)
      const sized = hosts(root, (n) => typeof n.props?.style?.width === 'number')
      return sized[0]?.props.style.width
    }
    expect(widthOf('wait')).toBeGreaterThan(widthOf('ok'))
    expect(widthOf('danger')).toBeGreaterThan(widthOf('info'))
    expect(widthOf('ok')).toBeGreaterThan(widthOf('muted'))
  })

  it('hides the decorative dot from assistive tech', () => {
    // A pulsing dot would otherwise be announced as a separate element.
    const root = render(<StatusPill tone="ok" label="Live" />)
    const dots = hosts(root, (n) => n.props?.importantForAccessibility === 'no-hide-descendants')
    expect(dots.length).toBeGreaterThan(0)
  })
})

describe('Badge', () => {
  it('renders its text', () => {
    expect(textOf(render(<Badge tone="accent">3 live</Badge>))).toContain('3 live')
  })
})

/* ── Inputs ───────────────────────────────────────────────────────────────── */

describe('Field', () => {
  /**
   * The rendered `TextInput`.
   *
   * Found by the props it is given rather than by its type, because whether
   * the renderer hands back a composite or a host view depends on the RN
   * version — and a test that breaks on an unrelated upgrade is a test that
   * gets deleted instead of read.
   */
  const inputOf = (root: ReactTestInstance) =>
    root.findAll((n) => n.props?.placeholderTextColor !== undefined, { deep: true })[0]

  it('is labelled by its label prop', () => {
    const root = render(
      <Field label="Workspace" placeholder="/home/me/project" onChangeText={() => {}} />,
    )
    expect(inputOf(root).props.accessibilityLabel).toBe('Workspace')
  })

  it('lets an explicit accessibility label win', () => {
    const root = render(
      <Field
        label="Workspace"
        accessibilityLabel="Project directory"
        onChangeText={() => {}}
      />,
    )
    expect(inputOf(root).props.accessibilityLabel).toBe('Project directory')
  })

  it('shows an error', () => {
    expect(textOf(render(<Field label="Host" error="That host did not answer" />))).toContain(
      'That host did not answer',
    )
  })

  it('accepts typed text', () => {
    const onChangeText = jest.fn()
    const input = inputOf(render(<Field label="Search" onChangeText={onChangeText} />))
    TestRenderer.act(() => input.props.onChangeText('api'))
    expect(onChangeText).toHaveBeenCalledWith('api')
  })
})

describe('ToggleRow', () => {
  it('is a switch that reports its state', () => {
    const root = render(<ToggleRow label="Notifications" value onChange={() => {}} />)
    const toggle = hosts(root, (n) => n.props?.accessibilityRole === 'switch')[0]
    expect(toggle.props.accessibilityState).toMatchObject({ checked: true })
  })

  it('toggles on press', () => {
    const onChange = jest.fn()
    const root = render(<ToggleRow label="Notifications" value={false} onChange={onChange} />)
    press(pressable(root, 'Notifications'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('Segmented', () => {
  const options = [
    { value: 'all' as const, label: 'All' },
    { value: 'active' as const, label: 'Live' },
  ]

  it('marks the selected tab', () => {
    const root = render(<Segmented options={options} value="all" onChange={() => {}} label="Filter" />)
    const tabs = hosts(root, (n) => n.props?.accessibilityRole === 'tab')
    expect(tabs[0].props.accessibilityState).toMatchObject({ selected: true })
    expect(tabs[1].props.accessibilityState).toMatchObject({ selected: false })
  })

  it('reports the chosen option', () => {
    const onChange = jest.fn()
    const root = render(<Segmented options={options} value="all" onChange={onChange} />)
    press(pressable(root, 'Live'))
    expect(onChange).toHaveBeenCalledWith('active')
  })
})

/* ── Rows ─────────────────────────────────────────────────────────────────── */

describe('Row', () => {
  it('names itself and hints at its detail', () => {
    const root = render(<Row primary="api-gateway" secondary="claude · 2m ago" onPress={() => {}} />)
    const row = pressable(root, 'api-gateway')
    expect(row.props.accessibilityLabel).toBe('api-gateway')
    expect(row.props.accessibilityHint).toBe('claude · 2m ago')
  })

  it('opens on press', () => {
    const onPress = jest.fn()
    const root = render(<Row primary="api-gateway" onPress={onPress} />)
    press(pressable(root, 'api-gateway'))
    expect(onPress).toHaveBeenCalled()
  })

  it('is not a button when it has no action', () => {
    const root = render(<Row primary="Read-only" />)
    expect(hosts(root, (n) => n.props?.accessibilityRole === 'button').length).toBe(0)
  })
})

/* ── States are actionable ────────────────────────────────────────────────── */

describe('error and empty states tell the user what to do', () => {
  it('ErrorState announces itself as an alert', () => {
    const root = render(<ErrorState message="Could not reach the daemon" onRetry={() => {}} />)
    const alert = hosts(root, (n) => n.props?.accessibilityRole === 'alert')[0]
    expect(alert).toBeDefined()
    expect(textOf(alert)).toContain('Could not reach the daemon')
  })

  it('ErrorState offers a retry when one is possible', () => {
    const onRetry = jest.fn()
    const root = render(<ErrorState message="Could not reach the daemon" onRetry={onRetry} />)
    press(pressable(root, 'Try again'))
    expect(onRetry).toHaveBeenCalled()
  })

  it('EmptyState says what to do next', () => {
    const text = textOf(render(<EmptyState title="No sessions yet" body="Start an agent from here." />))
    expect(text).toContain('No sessions yet')
    expect(text).toContain('Start an agent from here.')
  })

  it('Loading announces what it is waiting for', () => {
    const root = render(<Loading label="Loading sessions…" />)
    expect(hosts(root, (n) => n.props?.accessibilityLabel === 'Loading sessions…').length).toBeGreaterThan(0)
  })
})

describe('ScreenHeader and Card', () => {
  it('shows a title and subtitle', () => {
    const text = textOf(render(<ScreenHeader title="MacBook" subtitle="Connected" />))
    expect(text).toContain('MacBook')
    expect(text).toContain('Connected')
  })

  it('Card renders its children', () => {
    expect(textOf(render(<Card><Text>inside</Text></Card>))).toContain('inside')
  })
})

/* ── Token discipline ─────────────────────────────────────────────────────── */

describe('tone compatibility', () => {
  it('maps legacy tone names to current ones', () => {
    // The old vocabulary named hues; the new one names meanings. Screens
    // mid-migration pass either and must get the same colour either way.
    expect(compatTone('green')).toBe('ok')
    expect(compatTone('orange')).toBe('wait')
    expect(compatTone('red')).toBe('danger')
    expect(compatTone('dim')).toBe('muted')
    expect(compatTone('accent')).toBe('accent')
  })

  it('leaves current tone names alone', () => {
    expect(compatTone('ok')).toBe('ok')
    expect(compatTone('wait')).toBe('wait')
  })

  it('gives every tone a distinct colour', () => {
    const tones = ['ok', 'wait', 'danger', 'info', 'accent', 'muted'] as const
    expect(new Set(tones.map((tone) => toneColor[tone])).size).toBe(tones.length)
  })

  it('does not paint muted metadata with a status hue', () => {
    // `muted` is metadata, not a state — borrowing a status colour would make
    // every timestamp look like something had gone wrong.
    expect(toneColor.muted).toBe(palette.ink3)
    expect(toneColor.muted).not.toBe(toneColor.danger)
    expect(toneColor.muted).not.toBe(toneColor.wait)
  })
})

describe('haptics', () => {
  it('never throws when the platform cannot vibrate', async () => {
    // Feedback is a nicety; a device with no taptic engine must still be able
    // to use every action.
    await expect(haptic('success')).resolves.toBeUndefined()
    await expect(haptic('error')).resolves.toBeUndefined()
  })
})
