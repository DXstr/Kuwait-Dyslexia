import { createContext, useContext } from 'react'
import type { ProbeRuntime } from './runtime'

export const ProbeContext = createContext<ProbeRuntime | null>(null)
export function useProbe() { return useContext(ProbeContext) }
