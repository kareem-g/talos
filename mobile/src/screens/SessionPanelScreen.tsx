/**
 * Session panel — the workspace rail as a full screen.
 *
 * The rail itself lives in `components/panel/WorkspaceRail` because the
 * desktop mobile shell surfaces it twice: pushed full screen (this file,
 * deep-linkable via `qai://session/:id/panel`) and as the session screen's
 * right side sheet. One implementation, two presentations — the desktop's
 * own rule for the RightRail.
 */

import { View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { useStore } from '@app/store'
import type { RootStackParamList } from '@app/navigation'
import { AppBar, BackButton } from '@app/components/Screen'
import { WorkspaceRail, type PanelTabId } from '@app/components/panel/WorkspaceRail'

export type { PanelTabId }
export { PanelHeader } from '@app/components/panel/PanelHeader'

export function SessionPanelScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'SessionPanel'>>()
  const { sessionId, tab } = route.params

  const session = useStore((state) => state.sessions.find((row) => row.id === sessionId))

  return (
    <View className="flex-1 bg-canvas">
      <AppBar
        title={session?.name ?? 'Session'}
        subtitle={session?.project ?? 'Inbox'}
        left={<BackButton onPress={() => navigation.goBack()} label="Back to the session" />}
      />
      <WorkspaceRail sessionId={sessionId} initialTab={tab} />
    </View>
  )
}
