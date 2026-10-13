// Small stroke icons drawn with react-native-svg (no icon font needed).
import Svg, { Circle, Path, Rect } from 'react-native-svg'

export type IconName = 'home' | 'bell' | 'calendar' | 'gear' | 'critical' | 'warning' | 'info' | 'chevron' | 'doc' | 'report' | 'decision' | 'up' | 'down'

interface Props {
  name: IconName
  color: string
  size?: number
  /** Mirror horizontally (for direction-sensitive glyphs like chevrons in RTL). */
  flip?: boolean
}

export function Icon({ name, color, size = 22, flip }: Props) {
  const p = { stroke: color, strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={flip ? { transform: [{ scaleX: -1 }] } : undefined}>
      {name === 'home' && <Path {...p} d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />}
      {name === 'bell' && (
        <>
          <Path {...p} d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
          <Path {...p} d="M10 20.5a2 2 0 0 0 4 0" />
        </>
      )}
      {name === 'calendar' && (
        <>
          <Rect {...p} x={3.5} y={5} width={17} height={15.5} rx={2} />
          <Path {...p} d="M3.5 10h17M8 3v4M16 3v4" />
        </>
      )}
      {name === 'gear' && (
        <>
          <Circle {...p} cx={12} cy={12} r={3} />
          <Path
            {...p}
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
          />
        </>
      )}
      {name === 'critical' && (
        <>
          <Path {...p} d="M8.2 2.5h7.6l5.7 5.7v7.6l-5.7 5.7H8.2l-5.7-5.7V8.2z" />
          <Path {...p} d="M12 7.5v5.5M12 16.5v.01" />
        </>
      )}
      {name === 'warning' && (
        <>
          <Path {...p} d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <Path {...p} d="M12 9v4.5M12 17v.01" />
        </>
      )}
      {name === 'info' && (
        <>
          <Circle {...p} cx={12} cy={12} r={9} />
          <Path {...p} d="M12 11v5.5M12 7.5v.01" />
        </>
      )}
      {name === 'chevron' && <Path {...p} d="m9 5 7 7-7 7" />}
      {name === 'doc' && (
        <>
          <Path {...p} d="M14 3H6.5a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
          <Path {...p} d="M14 3v5h5M8.5 13h7M8.5 17h5" />
        </>
      )}
      {name === 'report' && (
        <>
          <Rect {...p} x={4} y={3} width={16} height={18} rx={2} />
          <Path {...p} d="M8 17v-4M12 17V9M16 17v-6" />
        </>
      )}
      {name === 'decision' && <Path {...p} d="M12 3v18M12 7h6l2 2.5-2 2.5h-6M12 13H6l-2 2.5L6 18h6" />}
      {name === 'up' && <Path {...p} d="M12 19V5M6 11l6-6 6 6" />}
      {name === 'down' && <Path {...p} d="M12 5v14M6 13l6 6 6-6" />}
    </Svg>
  )
}
