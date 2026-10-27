/** All 753 local levels of Nepal with their ward counts. Data: github.com/sagautam5/local-states-nepal (MIT). Loaded only when a form needs it. */
export type Kind = 'MC' | 'SMC' | 'M' | 'RM'
export type Place = [ne: string, en: string, kind: Kind, wards: number]
export const KIND_NAME: Record<Kind, [string, string]> = { MC: ['महानगरपालिका', 'Metropolitan City'], SMC: ['उप-महानगरपालिका', 'Sub-Metropolitan City'], M: ['नगरपालिका', 'Municipality'], RM: ['गाउँपालिका', 'Rural Municipality'] }

let cache: Promise<Record<string, Place[]>> | null = null
export function loadPlaces(): Promise<Record<string, Place[]>> {
  cache ??= import('./places.json').then((m) => m.default as unknown as Record<string, Place[]>)
  return cache
}
