import { NextRequest, NextResponse } from 'next/server'
import { createClient } from 'v0-sdk'
import { getUserGitHubToken } from '@/lib/github/user-token'

type ChatDetail = {
  id: string
  webUrl: string
  apiUrl: string
  shareable: boolean
  privacy: string
  latestVersion?: {
    content?: string
    files?: Array<{
      name: string
      content: string
    }>
  }
  messages?: Array<{
    id: string
    role: string
    content: string
    createdAt: string
  }>
}

function getV0Client() {
  const apiKey = process.env.V0_API_KEY
  if (!apiKey) {
    throw new Error('V0_API_KEY not configured. Please add it to your .env.local file.')
  }
  return createClient({ apiKey })
}

async function fetchChatDetail(
  chatId: string,
  options?: { includeMessages?: boolean },
): Promise<ChatDetail> {
  const client = getV0Client()
  const chat = await client.chats.getById({ chatId })
  const detail: ChatDetail = {
    id: chat.id,
    webUrl: chat.webUrl,
    apiUrl: chat.apiUrl,
    shareable: chat.shareable,
    privacy: chat.privacy,
    latestVersion: chat.latestVersion
      ? {
          content: chat.latestVersion.content,
          files: chat.latestVersion.files?.map((file) => ({
            name: file.name,
            content: file.content,
          })),
        }
      : undefined,
  }

  if (options?.includeMessages) {
    const messagesResponse = await client.chats.findMessages({ chatId, limit: 50 })
    detail.messages =
      messagesResponse.data?.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })) ?? []
  }

  return detail
}

export async function GET(request: NextRequest) {
  try {
    const chatId = request.nextUrl.searchParams.get('chatId')
    if (!chatId) {
      return NextResponse.json({ error: 'chatId query parameter is required' }, { status: 400 })
    }

    const chatDetail = await fetchChatDetail(chatId, { includeMessages: true })

    return NextResponse.json({
      chatId: chatDetail.id,
      webUrl: chatDetail.webUrl,
      apiUrl: chatDetail.apiUrl,
      shareable: chatDetail.shareable,
      privacy: chatDetail.privacy,
      messages: chatDetail.messages ?? [],
    })
  } catch (error) {
    console.error('V0 Chat GET Error:', error)
    const message = error instanceof Error ? error.message : 'Failed to fetch chat details'
    const status = message.includes('V0_API_KEY') ? 500 : 400
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, message, chatId, system, repoContext } = body

    const v0Client = getV0Client()

    if (action === 'create') {
      let chat: ChatDetail

      if (repoContext) {
        // Use chats.init() to import from GitHub repository
        const { owner, repo, branch, repoUrl } = repoContext
        const githubToken = await getUserGitHubToken(request)
        
        // Normalize repository URL - remove .git suffix if present, ensure it's the standard GitHub URL format
        let normalizedRepoUrl = repoUrl
        if (normalizedRepoUrl.endsWith('.git')) {
          normalizedRepoUrl = normalizedRepoUrl.slice(0, -4)
        }
        // Ensure it's the standard format: https://github.com/owner/repo
        if (!normalizedRepoUrl.startsWith('https://github.com/')) {
          normalizedRepoUrl = `https://github.com/${owner}/${repo}`
        }
        
        console.log(`[V0 Chat] Initializing chat from repository: ${normalizedRepoUrl}`)
        console.log(`[V0 Chat] GitHub token available: ${!!githubToken}`)
        if (githubToken) {
          console.log(`[V0 Chat] GitHub token length: ${githubToken.length}, prefix: ${githubToken.substring(0, 4)}...`)
        }
        console.log(`[V0 Chat] Repository: ${owner}/${repo}, Branch: ${branch || 'main'}`)
        
        // Verify token can access the repository by testing with GitHub API first
        if (githubToken) {
          try {
            const testResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
              headers: {
                'Authorization': `Bearer ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
              },
            })
            
            if (!testResponse.ok) {
              console.error(`[V0 Chat] GitHub API test failed: ${testResponse.status} ${testResponse.statusText}`)
              const errorText = await testResponse.text()
              console.error(`[V0 Chat] GitHub API error: ${errorText}`)
              
              if (testResponse.status === 404) {
                return NextResponse.json(
                  {
                    error: `Repository ${owner}/${repo} not found or your GitHub token doesn't have access. 
                    
Please verify:
1. The repository exists at https://github.com/${owner}/${repo}
2. Your GitHub token has the 'repo' scope
3. You have access to this private repository
4. Try disconnecting and reconnecting GitHub in the header to refresh your token`,
                  },
                  { status: 404 },
                )
              }
            } else {
              const repoData = await testResponse.json()
              console.log(`[V0 Chat] GitHub API test successful - repository is accessible: ${repoData.full_name}`)
            }
          } catch (testError) {
            console.error(`[V0 Chat] Error testing GitHub API access:`, testError)
          }
        }
        
        // Build repo config
        const repoConfig: {
          url: string
          branch?: string
          token?: string
        } = {
          url: normalizedRepoUrl,
          branch: branch || 'main',
        }
        
        // Include token for private repositories if available
        if (githubToken) {
          repoConfig.token = githubToken
          console.log(`[V0 Chat] Including GitHub token for private repository access`)
        } else {
          console.log(`[V0 Chat] No GitHub token available - repository must be public`)
          return NextResponse.json(
            {
              error: `No GitHub token found. Private repositories require authentication. Please connect your GitHub account in the header.`,
            },
            { status: 401 },
          )
        }
        
        try {
          // Initialize chat from repository using chats.init()
          const initResult = await v0Client.chats.init({
            type: 'repo',
            repo: repoConfig,
            name: `${owner}/${repo}`,
          })

          if (initResult instanceof ReadableStream) {
            return NextResponse.json(
              { error: 'Streaming response not supported. Please use standard chat initialization.' },
              { status: 400 },
            )
          }

          chat = initResult as ChatDetail
          console.log(`[V0 Chat] Successfully initialized chat: ${chat.id}`)
        } catch (initError) {
          console.error('[V0 Chat] Error initializing chat from repository:', initError)
          
          // Try to extract more details from the error
          let errorMessage = 'Unknown error'
          let errorStatus = 500
          
          if (initError instanceof Error) {
            errorMessage = initError.message
            
            // Check if it's a structured error with response
            if ('response' in initError && initError.response) {
              const response = initError.response as { status?: number; data?: unknown }
              errorStatus = response.status || 500
              
              if (response.data && typeof response.data === 'object') {
                const errorData = response.data as { error?: { message?: string; type?: string } }
                if (errorData.error?.message) {
                  errorMessage = errorData.error.message
                }
                console.error('[V0 Chat] V0 API error details:', JSON.stringify(response.data, null, 2))
              }
            }
          }
          
          // Provide more helpful error messages
          if (errorMessage.includes('not found') || errorMessage.includes('404') || errorStatus === 404) {
            return NextResponse.json(
              {
                error: `Repository ${owner}/${repo} not found or access denied by v0 Platform.

The GitHub token was verified and can access the repository, but v0 Platform API returned a 404 error.

Possible solutions:
1. Ensure your v0 API key has the necessary permissions
2. The repository might need to be connected through v0's GitHub integration first
3. Try using a public repository to test if the issue is specific to private repos
4. Check v0 Platform dashboard for GitHub integration settings`,
                details: errorMessage,
              },
              { status: 404 },
            )
          }
          
          return NextResponse.json(
            {
              error: `Failed to initialize chat from repository: ${errorMessage}`,
              details: initError instanceof Error ? initError.stack : String(initError),
            },
            { status: errorStatus },
          )
        }

        // If user provided a message, send it as the first message after initialization
        if (message && message.trim() && message.trim() !== 'Hello!') {
          console.log(`[V0 Chat] Sending initial message after repo import`)
          const messageResponse = await v0Client.chats.sendMessage({
            chatId: chat.id,
            message: message,
            responseMode: 'sync',
          })

          if (messageResponse instanceof ReadableStream) {
            // If streaming, just use the initialized chat
            const refreshedChat = await fetchChatDetail(chat.id)
            return NextResponse.json({
              chatId: refreshedChat.id,
              webUrl: refreshedChat.webUrl,
              apiUrl: refreshedChat.apiUrl,
              shareable: refreshedChat.shareable,
              privacy: refreshedChat.privacy,
              message: 'Chat initialized from repository',
              response: 'Repository imported successfully. Processing your message...',
              files: refreshedChat.latestVersion?.files || [],
            })
          }

          // Update chat with the message response
          const messageChat = messageResponse as ChatDetail
          const refreshedChat = await fetchChatDetail(messageChat.id)

          return NextResponse.json({
            chatId: refreshedChat.id,
            webUrl: refreshedChat.webUrl,
            apiUrl: refreshedChat.apiUrl,
            shareable: refreshedChat.shareable,
            privacy: refreshedChat.privacy,
            message: 'Chat initialized from repository',
            response: refreshedChat.latestVersion?.content || 'Repository imported successfully',
            files: refreshedChat.latestVersion?.files || [],
          })
        }
      } else {
        // No repo context - use regular chats.create() for new projects
        const systemMessage = system || 'You are a helpful coding assistant.'
        const initialMessage = message || 'Hello!'

        const createResult = await v0Client.chats.create({
          message: initialMessage,
          system: systemMessage,
          responseMode: 'sync',
        })

        if (createResult instanceof ReadableStream) {
          return NextResponse.json(
            { error: 'Streaming response not supported. Please use standard chat creation.' },
            { status: 400 },
          )
        }

        chat = createResult as ChatDetail
      }

      // Fetch the final chat details (for cases where no initial message was sent after repo init)
      const refreshedChat = await fetchChatDetail(chat.id)

      return NextResponse.json({
        chatId: refreshedChat.id,
        webUrl: refreshedChat.webUrl,
        apiUrl: refreshedChat.apiUrl,
        shareable: refreshedChat.shareable,
        privacy: refreshedChat.privacy,
        message: repoContext ? 'Chat initialized from repository' : 'Chat created successfully',
        response: refreshedChat.latestVersion?.content || (repoContext ? 'Repository imported successfully' : 'Chat created successfully'),
        files: refreshedChat.latestVersion?.files || [],
      })
    }

    if (action === 'send') {
      if (!chatId || !message) {
        return NextResponse.json(
          { error: 'chatId and message are required for send action' },
          { status: 400 },
        )
      }

      const response = await v0Client.chats.sendMessage({
        chatId,
        message,
        responseMode: 'sync',
      })

      if (response instanceof ReadableStream) {
        return NextResponse.json(
          { error: 'Streaming response not supported. Please use standard message sending.' },
          { status: 400 },
        )
      }

      const chatDetail = response as ChatDetail

      return NextResponse.json({
        success: true,
        response: chatDetail.latestVersion?.content || 'Message sent successfully',
        files: chatDetail.latestVersion?.files || [],
      })
    }

    return NextResponse.json({ error: 'Invalid action. Use "create" or "send"' }, { status: 400 })
  } catch (error) {
    console.error('V0 Chat API Error:', error)
    const message = error instanceof Error ? error.message : 'Failed to process chat request'
    const status = message.includes('V0_API_KEY') ? 500 : 400
    return NextResponse.json({ error: message }, { status })
  }
}

