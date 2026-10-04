/**
 * Haptics — expo-haptics behind a total function. Feedback is a nicety; a
 * device with no motor must still be able to run every action.
 */
export async function haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'warn' | 'error' | 'select' = 'light'): Promise<void> {
  try {
    const Haptics = await import('expo-haptics')
    switch (kind) {
      case 'medium':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      case 'heavy':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      case 'select':
        return Haptics.selectionAsync()
      case 'success':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      case 'warn':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      case 'error':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      default:
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  } catch {
    // no motor, no problem
  }
}
