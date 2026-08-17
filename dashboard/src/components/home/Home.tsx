import { useSearchParams } from 'react-router-dom'
import { SessionDetail } from '../SessionDetail'
import { EmptyState } from './EmptyState'

/**
 * Root home: the main application. Opens the chat for the selected session
 * (`?session=<id>`), or the polished empty state when nothing is open. Old
 * `/session/:id` links redirect here and preserve their target session.
 */
export function Home() {
  const [searchParams, setSearchParams] = useSearchParams()
  const sessionParam = searchParams.get('session') || searchParams.get('task')
  const sessionId = sessionParam ? decodeURIComponent(sessionParam) : null
  const project = searchParams.get('project') || undefined

  if (sessionId) {
    return <SessionDetail sessionId={sessionId} />
  }
  return <EmptyState project={project} onOpenSession={(id) => setSearchParams({ session: id })} />
}
