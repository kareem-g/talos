export function workspaceKey(project?: string | null): string {
  return project?.trim() || '/'
}

export function workspaceRoute(project?: string | null): string {
  return `/workspace/${encodeURIComponent(workspaceKey(project))}`
}

export function decodeWorkspaceRoute(value: string | undefined): string {
  if (!value) return '/'
  try {
    return decodeURIComponent(value) || '/'
  } catch {
    return '/'
  }
}
