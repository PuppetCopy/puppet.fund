import { formatUnits, parseUnits } from 'viem'

export function formatFixed(decimals: number, value: bigint): number {
  return Number(formatUnits(value, decimals))
}

export function parseFixed(decimals: number, input: string | number) {
  return parseUnits(String(input), decimals)
}
