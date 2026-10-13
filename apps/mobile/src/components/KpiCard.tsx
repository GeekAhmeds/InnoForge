import { StyleSheet, View } from 'react-native'
import type { Kpi } from '../finance'
import { formatMoney, formatPercent, formatPeriod } from '../format'
import { metricLabel, useI18n } from '../i18n'
import { radius, space, useColors } from '../theme'
import { Icon } from './Icons'
import { Txt } from './Txt'

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const { lang, t } = useI18n()
  const c = useColors()
  const tone = kpi.good === null ? c.muted : kpi.good ? c.good : c.bad
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Txt variant="label" numberOfLines={1}>
        {metricLabel(kpi.metric, lang)}
      </Txt>
      <Txt variant="figure" numberOfLines={1} adjustsFontSizeToFit>
        {formatMoney(kpi.value, kpi.currency, lang)}
      </Txt>
      {kpi.changePct !== null ? (
        <View style={styles.row}>
          {kpi.changePct !== 0 ? <Icon name={kpi.changePct > 0 ? 'up' : 'down'} color={tone} size={14} /> : null}
          <Txt variant="small" color={tone} style={{ fontWeight: '600' }}>
            {formatPercent(kpi.changePct, lang)}
          </Txt>
          <Txt variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
            {t.vsPrevious}
          </Txt>
        </View>
      ) : null}
      <Txt variant="small">{formatPeriod(kpi.period, lang)}</Txt>
    </View>
  )
}

export function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  return (
    <View style={styles.grid}>
      {kpis.map((k) => (
        <KpiCard key={k.metric} kpi={k} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: { flexBasis: '48%', flexGrow: 1, borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, padding: space.md, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 }
})
