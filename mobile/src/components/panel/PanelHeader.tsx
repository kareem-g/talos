/**
 * PanelHeader — the workbench pane opener, shared by every rail tab.
 *
 * Its own module because both the rail and the daemon-backed tabs
 * (`panel/Tabs.tsx`) render it, and a component imported by a module that
 * imports it back is a cycle waiting to happen.
 */

import * as React from 'react'
import { View } from 'react-native'

import { palette } from '@app/design/tokens'
import { Eyebrow } from '@app/components/ui'

export function PanelHeader({
  eyebrow,
  right,
}: {
  eyebrow: string
  right?: React.ReactNode
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 12,
        paddingBottom: 9,
        borderBottomWidth: 1,
        borderBottomColor: palette.line,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
        <View style={{ width: 2, height: 13, borderRadius: 1, backgroundColor: palette.accent }} />
        <Eyebrow>{eyebrow}</Eyebrow>
      </View>
      {right}
    </View>
  )
}
