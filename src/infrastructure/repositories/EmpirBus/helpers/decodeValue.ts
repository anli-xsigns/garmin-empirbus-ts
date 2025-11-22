import { Channel } from '../../../../domain/Channel'
import { getTemperatureUnit } from '../../../../shared/settings'

/**
 * Decode raw channel value coming from the bus into user-friendly form.
 * For analog percentage channels (dataItemFormatType=14, dataType=2), map 0..255 -> 0..100 (%).
 */
export function decodeValue(ch: Channel, raw: number): number | boolean | string | null {
    // Generic value conversion based on dataItemFormatType (valueTypeIdentifier)
    // DEC3 (14): values are scaled by 1000. For percent-ish channels, render with % and two decimals.
    if (ch) {
        // Type 22: TEMPERATURE_KELVIN_DEC3 (raw is milli-Kelvin)
        if (ch.dataItemFormatType === 22) {
            const K = Number(raw) / 1000
            const unit = getTemperatureUnit()
            if (unit === 'K')
                return Number(K.toFixed(2))
            const C = K - 273.15
            if (unit === 'C')
                return Number(C.toFixed(2))
            const F = C * 9 / 5 + 32
            return Number(F.toFixed(2))
        }
        else if (ch.dataItemFormatType === 14) {
            const scaled = Number(raw) / 1000
            const text = ((ch.description || ch.name || '') + '').toLowerCase()
            const isPercent = text.includes('%') || text.includes(' value %') || text.includes('percent')
            return isPercent ? `${scaled.toFixed(2)}%` : scaled
        }
    }
    return raw
}
