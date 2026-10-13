import { StyleSheet, View } from 'react-native'
import type { BudgetLine } from '../finance'
import { formatMoney, formatPercent } from '../format'
import { metricLabel, useI18n } from '../i18n'
import { space, useColors } from '../theme'
import { Icon } from './Icons'
import { Card, Divider } from './Layout'
import { Txt } from './Txt'

export function BudgetTable({ lines, currency }: { lines: BudgetLine[]; currency: string | null }) {
  const { lang, t } = useI18n()
  const c = useColors()
  return (
    <Card>
      {lines.map((l, i) => {
        const tone = l.favorable === null ? c.muted : l.favorable ? c.good : c.bad
        const actualPct = l.actual !== null && l.budget ? Math.min(1, Math.max(0, l.actual / l.budget)) : 0
        return (
          <View key={l.metric} style={{ gap: 6 }}>
            {i > 0 ? <Divider /> : null}
            <View style={styles.row}>
              <Txt variant="label" color={c.text} style={{ flex: 1 }}>
                {metricLabel(l.metric, lang)}
              </Txt>
              {l.favorable !== null ? (
                <View style={styles.row}>
                  <Icon name={l.favorable ? 'up' : 'down'} color={tone} size={14} />
                  <Txt variant="small" color={tone} style={{ fontWeight: '700' }}>
                    {(l.favorable ? t.favorable : t.unfavorable) + (l.variancePct !== null ? ` ${formatPercent(l.variancePct, lang)}` : '')}
                  </Txt>
                </View>
              ) : null}
            </View>
            <View style={[styles.track, { backgroundColor: c.bg }]}>
              <View style={[styles.fill, { width: `${actualPct * 100}%`, backgroundColor: tone }]} />
            </View>
            <View style={styles.row}>
              <Txt variant="small" style={{ flex: 1 }}>
                {t.actual}: {l.actual !== null ? formatMoney(l.actual, currency, lang) : '—'}
              </Txt>
              <Txt variant="small">
                {t.budget}: {formatMoney(l.budget, currency, lang)}
              </Txt>
            </View>
          </View>
        )
      })}
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 }
})
