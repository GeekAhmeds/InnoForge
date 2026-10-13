import { useColorScheme } from 'react-native'

export interface Palette {
  scheme: 'light' | 'dark'
  bg: string
  card: string
  border: string
  text: string
  muted: string
  primary: string
  onPrimary: string
  good: string
  bad: string
  critical: string
  warning: string
  info: string
  revenue: string
  expenses: string
  budget: string
}

const light: Palette = {
  scheme: 'light',
  bg: '#F3F5F8',
  card: '#FFFFFF',
  border: '#E1E6EC',
  text: '#13202E',
  muted: '#5E6B7A',
  primary: '#0F2A44',
  onPrimary: '#FFFFFF',
  good: '#1B7F4B',
  bad: '#C0392B',
  critical: '#B42318',
  warning: '#B54708',
  info: '#1D5FA8',
  revenue: '#2A6FDB',
  expenses: '#D9822B',
  budget: '#98A2B3'
}

const dark: Palette = {
  scheme: 'dark',
  bg: '#0B1219',
  card: '#151F2A',
  border: '#24313F',
  text: '#E8EDF2',
  muted: '#93A1B0',
  primary: '#6FA8E8',
  onPrimary: '#0B1219',
  good: '#4CC38A',
  bad: '#F07167',
  critical: '#F97066',
  warning: '#FDB022',
  info: '#7CB4F5',
  revenue: '#6FA8E8',
  expenses: '#F2A65A',
  budget: '#667085'
}

export function useColors(): Palette {
  return useColorScheme() === 'dark' ? dark : light
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }
export const radius = 12
