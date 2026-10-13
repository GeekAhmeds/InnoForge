import Constants from 'expo-constants'
import { router } from 'expo-router'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import { api, type ServerConfig } from './api'

export type PushStatus = 'enabled' | 'denied' | 'no-device' | 'no-project' | 'error'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
})

function projectId(): string | undefined {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
  return fromConfig || Constants.easConfig?.projectId || undefined
}

/**
 * Asks for permission (when `prompt` is true), fetches the Expo push token and
 * registers it with Inno Server. Safe to call repeatedly.
 */
export async function registerForPush(cfg: ServerConfig, prompt: boolean): Promise<PushStatus> {
  if (!Device.isDevice) return 'no-device'
  const id = projectId()
  if (!id) return 'no-project'
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Azim Command',
        importance: Notifications.AndroidImportance.HIGH
      })
    }
    let { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted' && prompt) status = (await Notifications.requestPermissionsAsync()).status
    if (status !== 'granted') return 'denied'
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id })
    await api.registerPush(cfg, token, Platform.OS)
    return 'enabled'
  } catch {
    return 'error'
  }
}

/** Opens the reminders tab when the user taps a push notification (server pushes due reminders). */
export function useNotificationNavigation(signedIn: boolean): void {
  const response = Notifications.useLastNotificationResponse()
  const handled = useRef<string | null>(null)
  useEffect(() => {
    const id = response?.notification.request.identifier
    if (!signedIn || !id || handled.current === id) return
    handled.current = id
    router.navigate('/reminders')
  }, [response, signedIn])
}
