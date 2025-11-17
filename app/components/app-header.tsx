"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { Loader2 } from "lucide-react"
import { RepoSelector } from "@/components/repo-selector"
import { Button } from "@/components/ui/button"
import { githubSelectionAtom } from "@/lib/atoms/github-selection"
import { githubConnectionAtom, githubConnectionInitializedAtom } from "@/lib/atoms/github-connection"

type SessionInfo = {
  user?: {
    id: string
    username: string
    email?: string
    name?: string
    avatar?: string
  }
  authProvider?: "github" | "vercel"
}

type GitHubStatusResponse = {
  connected: boolean
  username?: string
  connectedAt?: string
}

export default function AppHeader() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [statusLoading, setStatusLoading] = useState(true)

  const [selection, setSelection] = useAtom(githubSelectionAtom)
  const githubConnection = useAtomValue(githubConnectionAtom)
  const selectedOwner = selection?.owner ?? ""
  const selectedRepo = selection?.repo ?? ""
  const selectedFullName = selection?.owner && selection.repo ? `${selection.owner}/${selection.repo}` : null

  const setGithubConnection = useSetAtom(githubConnectionAtom)
  const setGithubConnectionInitialized = useSetAtom(githubConnectionInitializedAtom)

  const currentPath = useMemo(() => {
    if (typeof window === "undefined") return "/"
    return window.location.pathname + window.location.search + window.location.hash
  }, [])


  const fetchSession = useCallback(async () => {
    setSessionLoading(true)
    try {
      const response = await fetch("/api/auth/info", { cache: "no-store" })
      if (!response.ok) {
        throw new Error(`Failed to fetch session: ${response.status}`)
      }
      const data = (await response.json()) as SessionInfo
      setSession(data)
    } catch (error) {
      console.error("Failed to load session", error)
      setSession(null)
    } finally {
      setSessionLoading(false)
    }
  }, [])

  const fetchGitHubStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const response = await fetch("/api/auth/github/status", { cache: "no-store" })
      if (!response.ok) {
        throw new Error(`Failed to fetch GitHub status: ${response.status}`)
      }
      const data = (await response.json()) as GitHubStatusResponse

      setGithubConnection({
        connected: data.connected,
        username: data.username,
        connectedAt: data.connectedAt ? new Date(data.connectedAt) : undefined,
      })

      if (!data.connected) {
        setSelection(null)
      }

      return data
    } catch (error) {
      console.error("Failed to load GitHub status", error)
      setGithubConnection({ connected: false })
      setSelection(null)
      return { connected: false } satisfies GitHubStatusResponse
    } finally {
      setStatusLoading(false)
      setGithubConnectionInitialized(true)
    }
  }, [setGithubConnection, setGithubConnectionInitialized, setSelection])

  useEffect(() => {
    void fetchSession()
  }, [fetchSession])

  useEffect(() => {
    if (!session?.user) {
      setGithubConnection({ connected: false })
      setSelection(null)
      setStatusLoading(false)
      setGithubConnectionInitialized(true)
      return
    }

    let isMounted = true

    const loadStatus = async () => {
      const status = await fetchGitHubStatus()
      if (!isMounted) return
      if (!status.connected) {
        setSelection(null)
      }
    }

    void loadStatus()

    return () => {
      isMounted = false
    }
  }, [session?.user, fetchGitHubStatus, setGithubConnection, setSelection])

  const handleOwnerChange = useCallback(
    (owner: string) => {
      if (!owner) {
        setSelection(null)
        return
      }

      setSelection((prev) => ({
        owner,
        repo: "",
        branch: prev?.branch ?? "main",
      }))
    },
    [setSelection],
  )

  const handleRepoChange = useCallback(
    (repo: string) => {
      if (!repo) {
        setSelection((prev) => (prev ? { ...prev, repo: "" } : prev))
        return
      }

      setSelection((prev) => {
        if (!prev?.owner) return prev
        return {
          ...prev,
          repo,
        }
      })
    },
    [setSelection],
  )


  const handleSignIn = useCallback(async () => {
    try {
      const response = await fetch(`/api/auth/signin/vercel?next=${encodeURIComponent(currentPath)}`, {
        method: "POST",
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || "Failed to start sign-in flow")
      }

      const data = (await response.json()) as { url: string }
      window.location.href = data.url
    } catch (error) {
      console.error("Failed to start Vercel sign-in", error)
      alert("Unable to initiate sign-in. Please try again.")
    }
  }, [currentPath])

  const handleConnectGitHub = useCallback(() => {
    const next = encodeURIComponent(currentPath)
    window.location.href = `/api/auth/signin/github?next=${next}`
  }, [currentPath])

  const handleSignOut = useCallback(async () => {
    try {
      const response = await fetch(`/api/auth/signout?next=${encodeURIComponent(currentPath)}`)
      if (!response.ok) {
        throw new Error(`Failed to sign out: ${response.status}`)
      }
      const data = (await response.json()) as { url?: string }
      setSelection(null)
      setGithubConnection({ connected: false })
      window.location.href = data.url || "/"
    } catch (error) {
      console.error("Failed to sign out", error)
      alert("Unable to sign out. Please try again.")
    }
  }, [currentPath, setGithubConnection, setSelection])


  return (
    <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Commerce Starter</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connect GitHub to pull repositories directly into your workspace.
          </p>
        </div>

        <div className="flex w-full flex-col gap-4 sm:w-auto sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            {sessionLoading ? (
              <span className="text-sm text-zinc-500">Loading session…</span>
            ) : session?.user ? (
              <div className="text-right">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {session.user.name || session.user.username}
                </p>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Sign in with Vercel
              </button>
            )}
          </div>

          {session?.user ? (
            <div className="flex w-full flex-col gap-3">
              {statusLoading ? (
                <span className="text-sm text-zinc-500">Checking GitHub…</span>
              ) : (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    {githubConnection.connected ? (
                      <>
                        <div className="text-sm text-zinc-600 dark:text-zinc-300">
                          Connected as{" "}
                          <span className="font-medium">{githubConnection.username || selection?.owner}</span>
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <RepoSelector
                            selectedOwner={selectedOwner}
                            selectedRepo={selectedRepo}
                            onOwnerChange={handleOwnerChange}
                            onRepoChange={handleRepoChange}
                            size="sm"
                          />
                          {selectedFullName && (
                            <a
                              className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
                              href={`https://github.com/${selectedFullName}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {selectedFullName}
                            </a>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-600 dark:text-zinc-300">
                          Connect your GitHub account to select a repository.
                        </span>
                        <Button variant="outline" size="sm" onClick={handleConnectGitHub}>
                          Connect GitHub
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}

