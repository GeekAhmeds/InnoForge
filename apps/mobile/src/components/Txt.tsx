import { StyleSheet, Text, type TextProps } from 'react-native'
import { useI18n } from '../i18n'
import { useColors } from '../theme'

type Variant = 'body' | 'title' | 'heading' | 'label' | 'muted' | 'small' | 'figure'

interface Props extends TextProps {
  variant?: Variant
  color?: string
  center?: boolean
}

/** Text that follows the app language direction (alignment + writing direction). */
export function Txt({ variant = 'body', color, center, style, ...rest }: Props) {
  const { rtl } = useI18n()
  const c = useColors()
  const base = styles[variant]
  const defaultColor = variant === 'muted' || variant === 'small' || variant === 'label' ? c.muted : c.text
  return (
    <Text
      {...rest}
      style={[
        base,
        { color: color ?? defaultColor, textAlign: center ? 'center' : rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' },
        style
      ]}
    />
  )
}

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22 },
  title: { fontSize: 22, fontWeight: '700', lineHeight: 30 },
  heading: { fontSize: 17, fontWeight: '700', lineHeight: 24 },
  label: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  muted: { fontSize: 14, lineHeight: 20 },
  small: { fontSize: 12, lineHeight: 17 },
  figure: { fontSize: 20, fontWeight: '700', lineHeight: 28, fontVariant: ['tabular-nums'] }
})
