// Centralized configuration for value decoding

export type TemperatureUnit = 'K' | 'C' | 'F'

// Read desired unit from environment. Defaults to Celsius ('C').
// Use EMPIRBUS_TEMP_UNIT=K|C|F when starting the app.
export function getTemperatureUnit(): TemperatureUnit {
  const env = (process.env.EMPIRBUS_TEMP_UNIT || process.env.TEMP_UNIT || 'C').toUpperCase()
  if (env === 'K' || env === 'C' || env === 'F') return env as TemperatureUnit
  return 'C'
}
