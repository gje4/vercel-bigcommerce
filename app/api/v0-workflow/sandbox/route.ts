import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/session/get-server-session'
import { createV0SandboxFromRepo, writeV0FilesToSandbox, pushV0SandboxToNewRepo, V0GeneratedFile } from '@/lib/v0-workflow/sandbox-manager'
import { registerSandbox, getSandbox } from '@/lib/sandbox/sandbox-registry'
import { TaskLogger } from '@/lib/utils/task-logger'

// Simple in-memory logger for API routes
const createApiLogger = (): TaskLogger => ({
  info: async (msg: string) => {
    console.log(`[V0 Workflow API] ${msg}`)
  },
  error: async (msg: string) => {
    console.error(`[V0 Workflow API] ${msg}`)
  },
  command: async (msg: string) => {
    console.log(`[V0 Workflow API] $ ${msg}`)
  },
})

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action } = body

    if (action === 'create') {
      // Create sandbox from selected repo
      const { repoUrl, owner, repo, branch } = body

      if (!repoUrl || !owner || !repo) {
        return NextResponse.json(
          { error: 'repoUrl, owner, and repo are required' },
          { status: 400 },
        )
      }

      const logger = createApiLogger()
      const result = await createV0SandboxFromRepo(
        repoUrl,
        owner,
        repo,
        branch || 'main',
        logger,
      )

      if (!result.success || !result.sandbox) {
        return NextResponse.json(
          { error: result.error || 'Failed to create sandbox' },
          { status: 500 },
        )
      }

      // Register sandbox with a unique ID
      const sandboxId = `v0-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      registerSandbox(sandboxId, result.sandbox, true)

      return NextResponse.json({
        success: true,
        sandboxId,
        branch: result.branchName || branch || 'main',
      })
    }

    if (action === 'write-files') {
      // Write V0-generated files to sandbox
      const { sandboxId, files } = body

      if (!sandboxId) {
        return NextResponse.json({ error: 'sandboxId is required' }, { status: 400 })
      }

      if (!files || !Array.isArray(files)) {
        return NextResponse.json({ error: 'files array is required' }, { status: 400 })
      }

      const sandbox = getSandbox(sandboxId)
      if (!sandbox) {
        return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 })
      }

      const logger = createApiLogger()
      const v0Files: V0GeneratedFile[] = files.map((f: { name: string; content: string }) => ({
        name: f.name,
        content: f.content,
      }))

      const result = await writeV0FilesToSandbox(sandbox, v0Files, logger)

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Failed to write files' },
          { status: 500 },
        )
      }

      return NextResponse.json({
        success: true,
        filesWritten: files.length,
      })
    }

    if (action === 'push-to-new-repo') {
      // Push sandbox to new repository
      const { sandboxId, newRepoOwner, newRepoName, commitMessage } = body

      if (!sandboxId) {
        return NextResponse.json({ error: 'sandboxId is required' }, { status: 400 })
      }

      if (!newRepoOwner || !newRepoName) {
        return NextResponse.json(
          { error: 'newRepoOwner and newRepoName are required' },
          { status: 400 },
        )
      }

      const sandbox = getSandbox(sandboxId)
      if (!sandbox) {
        return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 })
      }

      // First, create the new repository
      const createRepoResponse = await fetch(`${request.nextUrl.origin}/api/github/repos/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newRepoName,
          owner: newRepoOwner,
          private: false,
          description: 'Repository created from V0 workflow',
        }),
      })

      if (!createRepoResponse.ok) {
        const errorData = await createRepoResponse.json().catch(() => ({}))
        return NextResponse.json(
          { error: errorData.error || 'Failed to create new repository' },
          { status: createRepoResponse.status },
        )
      }

      const logger = createApiLogger()
      const result = await pushV0SandboxToNewRepo(
        sandbox,
        newRepoOwner,
        newRepoName,
        commitMessage || 'Add V0 generated code',
        logger,
      )

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Failed to push to new repository' },
          { status: 500 },
        )
      }

      return NextResponse.json({
        success: true,
        repoUrl: result.repoUrl,
        fullName: `${newRepoOwner}/${newRepoName}`,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('V0 Workflow API error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

