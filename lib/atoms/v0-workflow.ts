import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export interface V0WorkflowState {
  sandboxId?: string
  repoUrl?: string
  owner?: string
  repo?: string
  branch?: string
  filesWritten?: number
  lastError?: string
}

export const v0WorkflowStateAtom = atomWithStorage<V0WorkflowState | null>('v0-workflow-state', null)

export const v0WorkflowLoadingAtom = atom<boolean>(false)

export const v0WorkflowErrorAtom = atom<string | null>(null)

