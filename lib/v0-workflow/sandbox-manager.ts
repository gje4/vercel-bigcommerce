import { Sandbox } from '@vercel/sandbox'
import { createSandbox } from '@/lib/sandbox/creation'
import { runInProject, PROJECT_DIR } from '@/lib/sandbox/commands'
import { pushChangesToBranch } from '@/lib/sandbox/git'
import { SandboxConfig, SandboxResult } from '@/lib/sandbox/types'
import { TaskLogger } from '@/lib/utils/task-logger'
import { getUserGitHubToken } from '@/lib/github/user-token'
import { getServerSession } from '@/lib/session/get-server-session'

export interface V0GeneratedFile {
  name: string
  content: string
}

export interface V0SandboxState {
  sandbox?: Sandbox
  sandboxId?: string
  repoUrl?: string
  owner?: string
  repo?: string
  branch?: string
}

/**
 * Creates a sandbox from a selected GitHub repository
 */
export async function createV0SandboxFromRepo(
  repoUrl: string,
  owner: string,
  repo: string,
  branch: string = 'main',
  logger?: TaskLogger,
): Promise<SandboxResult> {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      throw new Error('Unauthorized: No session found')
    }

    const githubToken = await getUserGitHubToken()
    if (!githubToken) {
      throw new Error('GitHub token not found. Please connect your GitHub account.')
    }

    // Create a simple logger if none provided
    const taskLogger =
      logger ||
      ({
        info: async (msg: string) => console.log(`[V0 Sandbox] ${msg}`),
        error: async (msg: string) => console.error(`[V0 Sandbox] ${msg}`),
        command: async (msg: string) => console.log(`[V0 Sandbox] $ ${msg}`),
      } as TaskLogger)

    const config: SandboxConfig = {
      taskId: `v0-workflow-${Date.now()}`,
      repoUrl,
      githubToken,
      gitAuthorName: session.user.name || session.user.username || 'V0 Workflow',
      gitAuthorEmail: session.user.email || `${session.user.username || 'v0-workflow'}@users.noreply.github.com`,
      timeout: '30m', // 30 minutes for V0 workflow
      ports: [3000, 5173], // Support both Next.js and Vite
      runtime: 'node22',
      resources: { vcpus: 4 },
      installDependencies: true,
      keepAlive: true, // Keep sandbox alive for multiple operations
      preDeterminedBranchName: branch,
      createNewRepo: false, // We're cloning an existing repo
      selectedAgent: 'v0', // Use V0 agent - doesn't require ANTHROPIC_API_KEY
    }

    await taskLogger.info(`Creating sandbox from repository: ${owner}/${repo}`)
    const result = await createSandbox(config, taskLogger)

    if (!result.success || !result.sandbox) {
      throw new Error(result.error || 'Failed to create sandbox')
    }

    await taskLogger.info('Sandbox created successfully')
    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    console.error('V0 Sandbox creation error:', error)
    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Writes V0-generated files to the sandbox
 */
export async function writeV0FilesToSandbox(
  sandbox: Sandbox,
  files: V0GeneratedFile[],
  logger?: TaskLogger,
): Promise<{ success: boolean; error?: string }> {
  try {
    const taskLogger =
      logger ||
      ({
        info: async (msg: string) => console.log(`[V0 Sandbox] ${msg}`),
        error: async (msg: string) => console.error(`[V0 Sandbox] ${msg}`),
      } as TaskLogger)

    await taskLogger.info(`Writing ${files.length} file(s) to sandbox...`)

    for (const file of files) {
      // Ensure directory exists
      const filePath = file.name
      const dirPath = filePath.substring(0, filePath.lastIndexOf('/'))
      
      if (dirPath) {
        const mkdirResult = await runInProject(sandbox, 'mkdir', ['-p', dirPath])
        if (!mkdirResult.success) {
          await taskLogger.error(`Failed to create directory: ${dirPath}`)
          // Continue anyway - the file write might still work
        }
      }

      // Write file content using a here-document approach
      // This handles special characters, newlines, and quotes properly
      // Use a unique delimiter to avoid conflicts
      const delimiter = `V0_EOF_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      // Escape the file path for shell safety
      const escapedPath = filePath.replace(/'/g, "'\\''")
      
      // Write content using here-document with quoted delimiter to prevent variable expansion
      const writeCommand = `cat > '${escapedPath}' << '${delimiter}'
${file.content}
${delimiter}`
      
      const writeResult = await runInProject(sandbox, 'sh', ['-c', writeCommand])
      
      if (!writeResult.success) {
        await taskLogger.error(`Failed to write file: ${filePath}`)
        if (writeResult.error) {
          await taskLogger.error(`Error: ${writeResult.error}`)
        }
        return {
          success: false,
          error: `Failed to write file: ${filePath}`,
        }
      }

      await taskLogger.info(`Written: ${filePath}`)
    }

    await taskLogger.info('All files written successfully')
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    console.error('V0 File write error:', error)
    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Pushes sandbox changes to a new GitHub repository
 */
export async function pushV0SandboxToNewRepo(
  sandbox: Sandbox,
  newRepoOwner: string,
  newRepoName: string,
  commitMessage: string = 'Add V0 generated code',
  logger?: TaskLogger,
): Promise<{ success: boolean; repoUrl?: string; error?: string }> {
  try {
    const session = await getServerSession()
    if (!session?.user?.id) {
      throw new Error('Unauthorized: No session found')
    }

    const githubToken = await getUserGitHubToken()
    if (!githubToken) {
      throw new Error('GitHub token not found. Please connect your GitHub account.')
    }

    const taskLogger =
      logger ||
      ({
        info: async (msg: string) => console.log(`[V0 Sandbox] ${msg}`),
        error: async (msg: string) => console.error(`[V0 Sandbox] ${msg}`),
        command: async (msg: string) => console.log(`[V0 Sandbox] $ ${msg}`),
      } as TaskLogger)

    await taskLogger.info(`Pushing sandbox to new repository: ${newRepoOwner}/${newRepoName}`)

    // First, create the new repository via GitHub API
    // We'll do this in the API route, but we need the repo URL here
    const newRepoUrl = `https://github.com/${newRepoOwner}/${newRepoName}.git`
    const authenticatedRepoUrl = `https://${githubToken}:x-oauth-basic@github.com/${newRepoOwner}/${newRepoName}.git`

    // Update the remote to point to the new repository
    await taskLogger.info('Updating git remote to new repository...')
    const updateRemoteResult = await runInProject(sandbox, 'git', [
      'remote',
      'set-url',
      'origin',
      authenticatedRepoUrl,
    ])

    if (!updateRemoteResult.success) {
      // Try adding the remote if it doesn't exist
      const addRemoteResult = await runInProject(sandbox, 'git', [
        'remote',
        'add',
        'origin',
        authenticatedRepoUrl,
      ])
      if (!addRemoteResult.success) {
        throw new Error('Failed to set git remote')
      }
    }

    // Commit any uncommitted changes
    await taskLogger.info('Checking for uncommitted changes...')
    const statusResult = await runInProject(sandbox, 'git', ['status', '--porcelain'])
    
    if (statusResult.output?.trim()) {
      await taskLogger.info('Staging all changes...')
      const addResult = await runInProject(sandbox, 'git', ['add', '.'])
      if (!addResult.success) {
        throw new Error('Failed to stage changes')
      }

      await taskLogger.info('Committing changes...')
      const commitResult = await runInProject(sandbox, 'git', ['commit', '-m', commitMessage])
      if (!commitResult.success) {
        throw new Error('Failed to commit changes')
      }
    }

    // Push to the new repository
    await taskLogger.info('Pushing to new repository...')
    const pushResult = await pushChangesToBranch(sandbox, 'main', commitMessage, taskLogger, true)

    if (!pushResult.success) {
      throw new Error(pushResult.pushFailed ? 'Failed to push to repository' : 'Failed to commit changes')
    }

    await taskLogger.info('Successfully pushed to new repository')
    return {
      success: true,
      repoUrl: `https://github.com/${newRepoOwner}/${newRepoName}`,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    console.error('V0 Push to new repo error:', error)
    return {
      success: false,
      error: errorMessage,
    }
  }
}

