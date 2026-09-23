import { formatUnits } from 'viem'

export function formatFixed(decimals: number, value: bigint): number {
  return Number(formatUnits(value, decimals))
}
