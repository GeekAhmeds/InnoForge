import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg'
import type { TrendPoint } from '../finance'
import { formatNumber, formatShortPeriod } from '../format'
import { metricLabel, useI18n } from '../i18n'
import { space, useColors } from '../theme'
import { Txt } from './Txt'

const HEIGHT = 180
const AXIS = 20 // bottom label band

/** Grouped bars: revenue vs expenses per period. Time runs with the reading direction. */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const { lang, rtl } = useI18n()
  const c = useColors()
  const [width, setWidth] = useState(0)
  const data = rtl ? [...points].reverse() : points
  const max = Math.max(1, ...points.flatMap((p) => [p.revenue ?? 0, p.expenses ?? 0]))
  const plot = HEIGHT - AXIS
  const slot = data.length ? width / data.length : 0
  const bar = Math.max(3, Math.min(14, slot / 3))
  const h = (v: number | null) => (v && v > 0 ? (v / max) * (plot - 16) : 0)

  return (
    <View style={{ gap: space.sm }}>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: HEIGHT }}
        accessible
        accessibilityLabel={points
          .map((p) => `${p.period}: ${metricLabel('revenue', lang)} ${p.revenue ?? '-'}, ${metricLabel('expenses', lang)} ${p.expenses ?? '-'}`)
          .join('; ')}
      >
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            <Line x1={0} x2={width} y1={plot} y2={plot} stroke={c.border} strokeWidth={1} />
            <SvgText x={rtl ? width : 0} y={10} fontSize={10} fill={c.muted} textAnchor={rtl ? 'end' : 'start'}>
              {formatNumber(max, lang, true)}
            </SvgText>
            {data.map((p, i) => {
              const cx = slot * i + slot / 2
              const rh = h(p.revenue)
              const eh = h(p.expenses)
              const first = rtl ? c.expenses : c.revenue
              const second = rtl ? c.revenue : c.expenses
              const fh = rtl ? eh : rh
              const sh = rtl ? rh : eh
              return (
                <G key={p.period}>
                  <Rect x={cx - bar - 1} y={plot - fh} width={bar} height={fh} rx={2} fill={first} />
                  <Rect x={cx + 1} y={plot - sh} width={bar} height={sh} rx={2} fill={second} />
                  <SvgText x={cx} y={HEIGHT - 5} fontSize={10} fill={c.muted} textAnchor="middle">
                    {formatShortPeriod(p.period, lang)}
                  </SvgText>
                </G>
              )
            })}
          </Svg>
        ) : null}
      </View>
      <View style={styles.legend}>
        <LegendItem color={c.revenue} label={metricLabel('revenue', lang)} />
        <LegendItem color={c.expenses} label={metricLabel('expenses', lang)} />
      </View>
    </View>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: color }} />
      <Txt variant="small">{label}</Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', gap: space.lg, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 }
})
